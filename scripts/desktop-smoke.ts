import {captureRendererEvidence} from './renderer-evidence.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, WebContentsView, webContents, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import bmw, { agentDriver } from '../apps/bmw/product.js'
import { createBmwApplication } from '../packages/platform/src/main.js'
import { ProjectStore } from '../packages/platform/src/project-store.js'
import { LayoutStore } from '../packages/platform/src/layout-store.js'

const group=process.env.BMW_DESKTOP_GROUP??'workspace'
if(!['workspace','projects','settings','native','restore'].includes(group))throw new Error('Unknown desktop test group')
let stage='bootstrap'
function markStage(message: string): void { stage = message; console.log(message) }
const evidenceDirectory=process.env.BMW_VALIDATION_DIR??path.join(process.cwd(),'.bmw-runtime','desktop-'+group)
fs.mkdirSync(evidenceDirectory,{recursive:true})
const temporary = process.env.BMW_DESKTOP_RESTORE_ROOT??fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-base-desktop-smoke-')))
const userData = path.join(temporary, 'user-data')
fs.mkdirSync(userData,{recursive:true})
process.env.BMW_USER_DATA_DIR = userData
process.env.DSH_HOME = path.join(temporary, 'empty-source-home')
fs.mkdirSync(process.env.DSH_HOME,{recursive:true})
const store = new ProjectStore({ filePath: path.join(userData, 'projects.json'), projectsDirectory: path.join(userData, 'projects'), legacyWorkspacePath: path.join(userData, 'legacy-workspace'), onState: undefined })
if(group!=='restore')store.completeInitialSetup({ name: 'Isolated Base smoke', homeUrl: '' })
const layout = new LayoutStore({ filePath: path.join(userData, 'layout-settings.json'), onState: undefined })
if(group!=='restore')layout.update({ configured: true, mode: 'sidebar' })
const errors: string[] = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error' && /shell|TypeError|ReferenceError/.test(details.message)) errors.push(details.message)
  })
})
const fixture = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><title>BMW popup fixture</title><p>Temporary local fixture.</p>')
})
createBmwApplication(bmw,agentDriver)

async function waitFor<T>(operation: () => Promise<T | null>, deadline = Date.now() + 60_000): Promise<T> {
  while (Date.now() < deadline) {
    const result = await operation()
    if (result !== null) return result
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Base desktop smoke timed out.')
}

async function run(): Promise<void> {
let shell: WebContents
const watchdog = setTimeout(() => {
  console.error('Desktop smoke deadline:', webContents.getAllWebContents().map((contents) => ({ id: contents.id, url: contents.getURL(), loading: contents.isLoading() })), errors)
  app.exit(1)
}, 240_000)
try {
  assert.equal(process.versions.electron, '44.5.1', 'The real Electron binary must match the upgraded dependency')
  markStage('Desktop smoke: Electron 44.5.1 ready; waiting for Shell')
  shell = await waitFor(async () => webContents.getAllWebContents().find((contents) => contents.getURL().endsWith('/renderer/shell.html') && !contents.isLoading()) || null)
  markStage('Desktop smoke: Shell loaded; checking product and IPC')
  const result = await shell.executeJavaScript(`(async () => {
    const api = window.bmw
    const product = await api.productInfo()
    const removed = ['productImportPreview', 'productImportProject', 'webRuntimeSettings', 'updateWebRuntimeSettings']
    let denied = false
    try { await api.browser({ action: 'connector.external.status' }) } catch { denied = true }
    return { product, removed: removed.every((key) => !(key in api)), denied,
      chatUi: document.querySelector('[id*="connector"]') !== null,
      projects: await api.projectState() }
  })()`)
  markStage('Desktop smoke: product and IPC returned; checking DSH Session')
  assert.equal(result.product.id, 'bmw')
  assert.deepEqual(result.product.features, ['feature-video'])
  assert.equal(result.removed, true)
  assert.equal(result.denied, true)
  assert.equal(result.chatUi, false)
  assert.equal(Object.hasOwn(result.projects.projects[0],'connectors'), false)
  await waitFor(async () => {
    try {
      const list = await shell.executeJavaScript('window.bmw.listAgentSessions()')
      return list.items?.length ? list : null
    } catch { return null }
  })
  stage = 'Agent startup and context ready'
  await waitFor(async () => (await shell.executeJavaScript('window.bmw.agentContext()')).state === 'ready' ? true : null)
  markStage('Desktop smoke: DSH Session and context ready; creating Project')
  if(group==='restore'){
    stage='projects/restart'
    const expected=JSON.parse(fs.readFileSync(path.join(temporary,'restart.json'),'utf8'))
    const actual=await shell.executeJavaScript('window.bmw.projectState()')
    assert.equal(actual.activeProjectId,expected.activeProjectId)
    assert.deepEqual(actual.projects.map(project=>({id:project.id,agentBindings:project.agentBindings})),expected.projects)
    const restored=await shell.executeJavaScript("window.bmw.browser({action:'status'})")
    assert.deepEqual(restored.tabs.map(tab=>tab.url).sort(),expected.tabUrls)
    assert.equal(await shell.executeJavaScript("window.bmw.readProjectDocument("+JSON.stringify(expected.activeProjectId)+",'memory').then(value=>value.content)"),expected.memory)
    const draft=await shell.executeJavaScript("window.bmw.browser({action:'video.studio',studioRequest:{operation:'read',draftId:"+JSON.stringify(expected.draftId)+"}})")
    assert.equal(draft.id,expected.draftId);assert.equal(draft.title,'Restart preserved draft')
    console.log('PASS real desktop restart: Project IDs, DSH bindings, active pages, memory and Studio draft survived')
    return
  }
  const before = await shell.executeJavaScript('window.bmw.projectState()')

  await new Promise<void>((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve) })
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Popup fixture did not bind')
  const origin = `http://127.0.0.1:${address.port}`
  await shell.executeJavaScript('window.bmw.setAgentControl(true)')
  const firstTab=await shell.executeJavaScript(`window.bmw.browser({action:'tabs.open',url:${JSON.stringify(origin+'/first')},foreground:true,reuse:false})`)
  const otherFirstTab=await shell.executeJavaScript(`window.bmw.browser({action:'tabs.open',url:${JSON.stringify(origin+'/other-first')},foreground:true,reuse:false})`)
  // Close the original blank tab so Project restoration is checked against two real pages.
  await shell.executeJavaScript(`(async()=>{const state=await window.bmw.browser({action:'status'});for(const tab of state.tabs){if(tab.id!==${JSON.stringify(firstTab.id)}&&tab.id!==${JSON.stringify(otherFirstTab.id)})await window.bmw.browser({action:'tabs.close',tabId:tab.id})}return window.bmw.browser({action:'tabs.show',tabId:${JSON.stringify(firstTab.id)}})})()`)

  const host = BrowserWindow.getAllWindows().find(window => window.contentView.children.some(view => view instanceof WebContentsView && view.webContents === shell))!
  host.show();app.focus({steal:true});host.focus()
  const shellView = host.contentView.children.find(view => view instanceof WebContentsView && view.webContents === shell)!
  const visible = async (selector: string) => waitFor(async () => await shell.executeJavaScript('!document.querySelector(' + JSON.stringify(selector) + ').classList.contains("hidden")') ? true : null)
  const click = (selector: string) => shell.executeJavaScript('document.querySelector(' + JSON.stringify(selector) + ').click();true')
  const saveShell = async (name: string) => { await shell.executeJavaScript('new Promise(resolve=>setTimeout(resolve,30))'); fs.mkdirSync(process.env.BMW_VALIDATION_DIR??path.join(process.cwd(), '.bmw-runtime'), {recursive:true}); fs.writeFileSync(path.join(process.env.BMW_VALIDATION_DIR??path.join(process.cwd(), '.bmw-runtime'), name), (await captureRendererEvidence(shell)).toPNG()) }
  const toolbar = await shell.executeJavaScript(`({actions:[...document.querySelectorAll('.chrome > button')].map(button=>button.id),newTabs:document.querySelectorAll('#new-tab').length,newTabInStrip:Boolean(document.querySelector('#tab-strip #new-tab')),statusTag:document.querySelector('#status').tagName,brand:document.querySelector('.brand').textContent.trim(),brandMarks:document.querySelectorAll('.brand .mark').length,actionStyles:['record','agent-toggle'].map(id=>{const element=document.getElementById(id),style=getComputedStyle(element);return {fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,height:element.getBoundingClientRect().height,alignItems:style.alignItems}})})`)
  assert.deepEqual(toolbar.actions, ['project-switcher','record','agent-toggle','more-button'])
  assert.equal(toolbar.brand, 'BMW'); assert.equal(toolbar.brandMarks, 0)
  assert.deepEqual(toolbar.actionStyles, Array.from({length:2},()=>({fontSize:'12px',fontWeight:'400',lineHeight:'18px',height:32,alignItems:'center'})))
  assert.equal(toolbar.newTabs, 1); assert.equal(toolbar.newTabInStrip, true); assert.equal(toolbar.statusTag, 'SPAN')
  const appearanceDsh = await waitFor(async () => webContents.getAllWebContents().find(contents => /^http:\/\/127\.0\.0\.1:/.test(contents.getURL()) && !contents.getURL().startsWith(origin) && !contents.isLoading()) || null)
  await appearanceDsh.executeJavaScript("(()=>{if(document.body.textContent.includes('Preview Notice')){const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Continue');button?.click()}return true})()")
  await waitFor(async()=>await appearanceDsh.executeJavaScript("(()=>{const text=document.body.textContent;if(text.includes('Add an API key to get started')){const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Configure later');button?.click();return false}return !text.includes('Preview Notice')})()")?true:null)
  stage=group
  if(group==='workspace'){
  const sessionBefore=await appearanceDsh.executeJavaScript("localStorage.getItem('dsh.sessions.current')")
  assert.ok(sessionBefore&&JSON.parse(sessionBefore).sessionId,'Mode switching must retain a real DSH Session')
  const windowsBefore=BrowserWindow.getAllWindows().length
  await click('#studio-workspace')
  const studioContents=await waitFor(async()=>webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/studio.html')&&!contents.isLoading())||null)
  await waitFor(async()=>await appearanceDsh.executeJavaScript("Boolean(document.querySelector('#bmw-workspace-mode'))")?true:null)
  assert.equal(await appearanceDsh.executeJavaScript("document.querySelector('#bmw-workspace-mode').getClientRects().length>0"),true,'Composer mode is visible after the upstream welcome notice')
  const composerGeometry=await appearanceDsh.executeJavaScript("(()=>{const rail=document.getElementById('bmw-video-mode'),scroll=document.querySelector('[data-input-scroll]'),placeholder=document.querySelector('[data-composer-placeholder]');const r=rail.getBoundingClientRect(),s=scroll.getBoundingClientRect(),p=placeholder?.getBoundingClientRect();return {sameCard:rail.parentElement===scroll.parentElement,railBottom:r.bottom,scrollTop:s.top,placeholderOverlap:Boolean(p&&r.left<p.right&&r.right>p.left&&r.top<p.bottom&&r.bottom>p.top)}})()")
  assert.equal(composerGeometry.sameCard,true,'Mode control belongs to the official composer card')
  assert.ok(composerGeometry.railBottom<=composerGeometry.scrollTop+1,'Mode rail stays above the editor scroll area')
  assert.equal(composerGeometry.placeholderOverlap,false,'Mode control must not cover the official input placeholder')
  assert.equal(BrowserWindow.getAllWindows().length,windowsBefore,'Studio must not create another window')
  assert.ok(host.contentView.children.some(view=>view instanceof WebContentsView&&view.webContents===studioContents))
  await studioContents.executeJavaScript("document.getElementById('new-draft').click();true")
  await waitFor(async()=>await studioContents.executeJavaScript("document.getElementById('draft-select').value!==''&&!document.getElementById('draft-title').disabled")?true:null)
  assert.equal(await studioContents.executeJavaScript("document.querySelectorAll('#scene-list button').length"),0,'New videos prepare materials before scenes')
  await studioContents.executeJavaScript("document.querySelector('[data-stage=\"1\"]').click();true")
  await waitFor(async()=>await studioContents.executeJavaScript("Boolean(document.querySelector('#script-outline button'))")?true:null)
  await studioContents.executeJavaScript("document.querySelector('#script-outline button').click();true")
  await waitFor(async()=>await studioContents.executeJavaScript("document.querySelectorAll('#scene-list button').length===1&&!document.getElementById('scene-title').disabled")?true:null)
  await studioContents.executeJavaScript("document.getElementById('scene-title').value='同一会话的手动修改';document.getElementById('scene-title').dispatchEvent(new Event('change',{bubbles:true}));true")
  await waitFor(async()=>await appearanceDsh.executeJavaScript("document.querySelector('#bmw-video-context').textContent.includes('同一会话的手动修改')")?true:null)
  const draftContext=await shell.executeJavaScript("window.bmw.browser({action:'video.studio',studioRequest:{operation:'context'}})")
  assert.equal(draftContext.mode,'studio');assert.ok(draftContext.selection.draftId)
  await waitFor(async()=>await studioContents.executeJavaScript("!document.getElementById('draft-title').disabled")?true:null)
  const ownerSession=JSON.parse(sessionBefore).sessionId,ownerDraftId=draftContext.selection.draftId
  await studioContents.executeJavaScript("document.getElementById('draft-title').value='Session-owned desktop draft';document.getElementById('draft-title').dispatchEvent(new Event('input',{bubbles:true}));true")
  const secondSessionSnapshot=await shell.executeJavaScript('window.bmw.createAgentSession()'),secondSession={sessionId:secondSessionSnapshot.selectedSessionId}
  assert.notEqual(secondSession.sessionId,ownerSession)
  const secondStudio=await waitFor(async()=>webContents.getAllWebContents().find(contents=>contents!==studioContents&&contents.getURL().endsWith('/studio.html')&&!contents.isLoading())||null)
  await waitFor(async()=>await secondStudio.executeJavaScript("!document.getElementById('empty-workspace').hidden&&document.getElementById('draft-select').options.length===0")?true:null)
  const foreignDraft=await shell.executeJavaScript("window.bmw.browser({action:'video.studio',studioRequest:{operation:'read',draftId:"+JSON.stringify(ownerDraftId)+"}}).then(()=>false,error=>String(error))")
  assert.match(String(foreignDraft),/STUDIO_SESSION_MISMATCH/)
  await shell.executeJavaScript('window.bmw.selectAgentSession('+JSON.stringify(ownerSession)+')')
  await waitFor(async()=>await studioContents.executeJavaScript("document.getElementById('draft-title').value==='Session-owned desktop draft'&&!document.getElementById('draft-title').disabled")?true:null)
  assert.equal((await shell.executeJavaScript("window.bmw.browser({action:'video.studio',studioRequest:{operation:'read',draftId:"+JSON.stringify(ownerDraftId)+"}})")).ownerSessionId,ownerSession)
  // Official DSH navigation within the same Project also switches Studio.
  await waitFor(async()=>!appearanceDsh.isLoading()&&await appearanceDsh.executeJavaScript("Boolean(document.querySelector('#bmw-workspace-mode'))")?true:null)
  await agentDriver.client.selectSession(appearanceDsh,secondSession.sessionId)
  await waitFor(async()=>await shell.executeJavaScript("window.bmw.browser({action:'video.studio',studioRequest:{operation:'list'}}).then(value=>value.sessionId==="+JSON.stringify(secondSession.sessionId)+")")?true:null)
  await waitFor(async()=>await secondStudio.executeJavaScript("!document.getElementById('empty-workspace').hidden")?true:null)
  await shell.executeJavaScript('window.bmw.selectAgentSession('+JSON.stringify(ownerSession)+')')
  await waitFor(async()=>await studioContents.executeJavaScript("document.getElementById('draft-select').value==="+JSON.stringify(ownerDraftId))?true:null)
  console.log('PASS real DSH Session ownership: Shell creation/selection and official Agent navigation switch Studio, focused edits persist, foreign reads fail and empty state restores')
  const backgroundTab=await shell.executeJavaScript("window.bmw.browser({action:'tabs.show',tabId:"+JSON.stringify(firstTab.id)+"})")
  assert.equal(backgroundTab.id,firstTab.id)
  const page=webContents.getAllWebContents().find(contents=>contents.getURL()===origin+'/first')!
  assert.ok(await page.executeJavaScript('innerWidth>0&&innerHeight>0'),'Hidden browser retains a usable capture viewport')
  markStage('Desktop smoke: capturing browser viewport behind Studio')
  const hiddenCapture=await shell.executeJavaScript("window.bmw.browser({action:'media.screenshot',tabId:"+JSON.stringify(firstTab.id)+",mode:'viewport'})");assert.ok(hiddenCapture.width>0&&hiddenCapture.height>0&&fs.statSync(hiddenCapture.path).size>100,'Studio retains actual browser screenshots')
  await click('#more-button');await visible('#more-menu');assert.equal(host.contentView.children.at(-1),shellView,'More menu stays above Studio and DSH');await click('#toolbar-dismiss')
  markStage('Desktop smoke: browser screenshot passed; capturing Studio and Agent surfaces')
  const composerDom=await appearanceDsh.executeJavaScript("(()=>{let element=document.querySelector('[contenteditable=\"true\"]');const ancestors=[];for(let i=0;element&&i<5;i++,element=element.parentElement)ancestors.push({tag:element.tagName,className:element.className,html:element.outerHTML.slice(0,20000),style:getComputedStyle(element).position});return ancestors})()");fs.mkdirSync('.bmw-runtime/studio-validation',{recursive:true});fs.writeFileSync('.bmw-runtime/studio-validation/dsh-composer-dom.json',JSON.stringify(composerDom,null,2))
  fs.mkdirSync('.bmw-runtime/studio-validation',{recursive:true});fs.writeFileSync('.bmw-runtime/studio-validation/integrated-studio-view.png',(await captureRendererEvidence(studioContents)).toPNG());fs.writeFileSync('.bmw-runtime/studio-validation/integrated-dsh-view.png',(await captureRendererEvidence(appearanceDsh)).toPNG())
  await appearanceDsh.executeJavaScript("document.querySelector('#bmw-workspace-mode').value='browser';document.querySelector('#bmw-workspace-mode').dispatchEvent(new Event('change',{bubbles:true}));true")
  await waitFor(async()=>await shell.executeJavaScript("!document.body.classList.contains('video-workspace')")?true:null)
  assert.equal(studioContents.isDestroyed(),false);assert.equal(host.isDestroyed(),false)
  assert.equal(await appearanceDsh.executeJavaScript("localStorage.getItem('dsh.sessions.current')"),sessionBefore)
  await click('#studio-workspace');await waitFor(async()=>await studioContents.executeJavaScript("document.getElementById('scene-title').value==='同一会话的手动修改'")?true:null)
  await studioContents.executeJavaScript("document.getElementById('leave').click();true")
  await waitFor(async()=>await shell.executeJavaScript("!document.body.classList.contains('video-workspace')")?true:null)
  console.log('PASS integrated Studio: one main window, official DSH composer mode, shared draft, retained browser viewport, menus, return and same Session')
  }
  if(group==='settings'){
  await click('#new-tab')
  const afterNewTab = await waitFor(async () => { const value = await shell.executeJavaScript("window.bmw.browser({action:'status'})"); return value.tabs.length === 3 ? value : null })
  await shell.executeJavaScript(`window.bmw.browser({action:'tabs.close',tabId:${JSON.stringify(afterNewTab.activeTabId)}})`)
  await shell.executeJavaScript(`window.bmw.browser({action:'tabs.show',tabId:${JSON.stringify(firstTab.id)}})`)
  await click('#site-settings-button'); await visible('#site-settings-menu')
  assert.equal(await shell.executeJavaScript("document.querySelector('#site-settings-origin').textContent"), origin)
  await saveShell('balanced-site-settings.png')
  await click('#toolbar-dismiss')
  await waitFor(async () => shellView.getBounds().height === 102 ? true : null)
  assert.equal(await shell.executeJavaScript("(async()=>{try{await window.bmw.toolbarPanel('yes');return false}catch{return true}})()"), true)
  const grantedBefore = (await shell.executeJavaScript("window.bmw.browser({action:'status'})")).agentControlGranted
  await click('#agent-toggle')
  await waitFor(async () => await shell.executeJavaScript("document.querySelector('#agent-toggle').getAttribute('aria-pressed')==='false'") ? true : null)
  assert.equal((await shell.executeJavaScript("window.bmw.browser({action:'status'})")).agentControlGranted, grantedBefore)
  await click('#agent-toggle')
  await waitFor(async () => await shell.executeJavaScript("document.querySelector('#agent-toggle').getAttribute('aria-pressed')==='true'") ? true : null)
  await click('#more-button'); await visible('#more-menu'); await click('#scheduled-task-button'); await visible('#scheduled-task-overlay')
  assert.equal(await shell.executeJavaScript("document.querySelector('#more-menu').classList.contains('hidden')"), true)
  await click('#scheduled-task-close')
  const initialTheme=(await shell.executeJavaScript('window.bmw.globalSettings()')).theme
  await click('#more-button'); await visible('#more-menu'); await click('#settings-button'); await visible('#settings-overlay')
  await shell.executeJavaScript("document.querySelector('#settings-theme').value='light';true")
  await click('[data-settings-category="assistant"]')
  assert.equal(await shell.executeJavaScript("document.querySelector('[data-settings-section=browser]').classList.contains('hidden')"), true)
  await saveShell('balanced-assistant-settings.png')
  await click('#layout-button'); await visible('#layout-overlay')
  assert.equal(await shell.executeJavaScript("document.querySelector('#settings-overlay').classList.contains('hidden')"), true)
  await shell.executeJavaScript("document.querySelector('#layout-width').value='480';true")
  await click('#layout-apply'); await visible('#settings-overlay')
  assert.equal(await shell.executeJavaScript("document.querySelector('#settings-theme').value"), 'light', 'Opening layout must preserve unsaved preferences')
  assert.equal((await shell.executeJavaScript('window.bmw.layoutSettings()')).sidebarWidth, 480)
  await click('[data-settings-category="media"]')
  assert.equal(await shell.executeJavaScript("document.querySelector('[data-settings-section=media]').classList.contains('hidden')"), false)
  await click('[data-settings-category="media"]');assert.equal(await shell.executeJavaScript("document.getElementById('settings-edge-narration').checked"),true)
  await click('[data-settings-category="video"]');assert.equal(await shell.executeJavaScript("document.getElementById('settings-video-tts-voice').value"),'zh-CN-YunxiNeural')
  await shell.executeJavaScript("(()=>{for(const [id,value] of [['ratio','9:16'],['resolution','1080p'],['style','clean-light'],['watermark-text','测试品牌'],['tts-voice','zh-CN-XiaoxiaoNeural'],['tts-rate','10']]){const node=document.getElementById('settings-video-'+id);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}))}document.getElementById('settings-video-template-name').value='竖屏解读';return true})()")
  await click('#settings-video-template-save');await saveShell('video-settings-template.png');await click('#settings-save')
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#settings-message').textContent.startsWith('Saved.')")?true:null);await click('#settings-close')
  const videoSettings=await shell.executeJavaScript('window.bmw.globalSettings()')
  assert.equal(videoSettings.videoPreferences.defaults.aspectRatio,'9:16');assert.equal(videoSettings.videoPreferences.templates[0].name,'竖屏解读');assert.equal(videoSettings.videoPreferences.templates[0].options.watermark.text,'测试品牌');assert.equal(videoSettings.videoPreferences.templates[0].options.tts.voice,'zh-CN-XiaoxiaoNeural');assert.equal(videoSettings.videoPreferences.templates[0].options.tts.ratePercent,10)
  await click('#more-button');await visible('#more-menu');await click('#settings-button');await visible('#settings-overlay');await click('[data-settings-category="video"]')
  assert.equal(await shell.executeJavaScript("document.getElementById('settings-video-ratio').value"),'9:16')
  await shell.executeJavaScript("document.getElementById('settings-video-fps').value='30';document.getElementById('settings-video-fps').dispatchEvent(new Event('change',{bubbles:true}));true")
  await shell.executeJavaScript("window.bmw.browser({action:'video.settings',settingsRequest:{operation:'save-template',name:'并发模板',options:{aspectRatio:'1:1'}}})")
  await click('#settings-save');await waitFor(async()=>await shell.executeJavaScript("document.getElementById('settings-message').textContent.includes('VIDEO_SETTINGS_CONFLICT')")?true:null)
  assert.equal((await shell.executeJavaScript('window.bmw.globalSettings()')).videoPreferences.templates.length,2,'Unsaved GUI preferences cannot overwrite concurrently saved templates')
  await click('#settings-close');await click('#more-button');await visible('#more-menu');await click('#settings-button');await visible('#settings-overlay');await click('[data-settings-category="video"]')
  await shell.executeJavaScript("document.getElementById('settings-video-template').value='竖屏解读';true")
  await click('#settings-video-template-delete');await click('#settings-save')
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#settings-message').textContent.startsWith('Saved.')")?true:null);await click('#settings-close')
  assert.equal((await shell.executeJavaScript('window.bmw.globalSettings()')).videoPreferences.templates.length,1)
  await shell.executeJavaScript('window.bmw.updateGlobalSettings({videoPreferences:{},theme:'+JSON.stringify(initialTheme)+'})')
  await click('#more-button');await visible('#more-menu');await click('#settings-button');await visible('#settings-overlay')
  await click('[data-settings-category="advanced"]')
  assert.equal(await shell.executeJavaScript("document.querySelector('[data-settings-section=advanced]').classList.contains('hidden')"), false)
  await click('#settings-close')
  await waitFor(async () => shellView.getBounds().height === 102 ? true : null)
  await click('#context-session'); await visible('#session-overlay'); await click('#session-close')
  await waitFor(async () => shellView.getBounds().height === 102 ? true : null)
  await saveShell('balanced-toolbar-desktop.png')
  // Verify real computed surfaces in both themes, with scrollable content at the minimum window size.
  const dshFont = await appearanceDsh.executeJavaScript('getComputedStyle(document.body).fontFamily')
  assert.equal(await shell.executeJavaScript('getComputedStyle(document.body).fontFamily'), dshFont, 'BMW and DSH must use the same system font stack')
  const appearanceSettings = await shell.executeJavaScript('window.bmw.globalSettings()')
  const originalBounds = host.getBounds()
  const inspectDialog = async (selector: string) => {
    // Overlay visibility and the native View resize arrive through separate IPC turns.
    await waitFor(async () => {const height=shellView.getBounds().height;return height>102 && await shell.executeJavaScript('innerHeight')===height ? true : null})
    return shell.executeJavaScript(`(()=>{
    const dialog=document.querySelector(${JSON.stringify(selector)}),header=dialog.querySelector('.dialog-header strong'),footer=dialog.querySelector('.dialog-footer'),rect=dialog.getBoundingClientRect(),footerRect=footer.getBoundingClientRect(),style=getComputedStyle(dialog);
    const fonts=[...dialog.querySelectorAll('button,input,select,label,small,p,strong,span')].filter(element=>element.getClientRects().length).map(element=>parseFloat(getComputedStyle(element).fontSize));
    return {background:style.backgroundColor,surface:getComputedStyle(document.querySelector('.context-strip')).backgroundColor,color:style.color,radius:style.borderRadius,title:getComputedStyle(header).fontSize,titleWeight:getComputedStyle(header).fontWeight,minFont:Math.min(...fonts),fits:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,footerFits:footerRect.top>=rect.top&&footerRect.bottom<=rect.bottom,viewport:[innerWidth,innerHeight],rect:[rect.left,rect.top,rect.right,rect.bottom],footerRect:[footerRect.top,footerRect.bottom]}
  })()`)
  }
  for (const theme of ['dark','light']) {
    await shell.executeJavaScript('window.bmw.updateGlobalSettings('+JSON.stringify({...appearanceSettings,theme})+')')
    await waitFor(async()=>await shell.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches") === (theme==='dark') ? true : null)
    await click('#more-button'); await visible('#more-menu'); await click('#settings-button'); await visible('#settings-overlay')
    for(const category of ['browser','assistant','media','video','advanced']) {
      await click('[data-settings-category="'+category+'"]')
      const style=await inspectDialog('.settings-window')
      assert.equal(style.background,style.surface); assert.equal(style.radius,'16px'); assert.equal(style.title,'16px'); assert.equal(style.titleWeight,'500'); assert.ok(style.minFont>=12); assert.ok(style.fits&&style.footerFits)
    }
    await click('[data-settings-category="browser"]')
    assert.equal(await shell.executeJavaScript("getComputedStyle(document.querySelector('#settings-theme')).fontSize"),'13px')
    await saveShell('unified-settings-'+theme+'.png')
    await click('[data-settings-category="assistant"]'); await click('#layout-button'); await visible('#layout-overlay')
    await saveShell('unified-layout-'+theme+'.png'); await click('#layout-close'); await visible('#settings-overlay'); await click('#settings-close')
    await click('#context-session'); await visible('#session-overlay')
    await waitFor(async()=>await shell.executeJavaScript("document.querySelectorAll('.session-row').length")>0?true:null)
    const sessionStyle=await inspectDialog('.session-window')
    assert.equal(sessionStyle.background,sessionStyle.surface); assert.equal(sessionStyle.title,'16px'); assert.equal(sessionStyle.titleWeight,'500'); assert.ok(sessionStyle.minFont>=12); assert.ok(sessionStyle.fits&&sessionStyle.footerFits,JSON.stringify(sessionStyle))
    await saveShell('unified-conversations-'+theme+'.png'); await click('#session-close')
    await click('#more-button'); await visible('#more-menu'); await click('#scheduled-task-button'); await visible('#scheduled-task-overlay')
    const taskStyle=await inspectDialog('.scheduled-task-window')
    assert.equal(taskStyle.background,taskStyle.surface); assert.equal(taskStyle.title,'16px'); assert.ok(taskStyle.minFont>=12); assert.ok(taskStyle.fits&&taskStyle.footerFits)
    await saveShell('unified-scheduled-tasks-'+theme+'.png'); await click('#scheduled-task-close')
    host.setSize(960,640)
    await waitFor(async()=>host.getBounds().width===960?true:null)
    await waitFor(async()=>await shell.executeJavaScript('innerWidth===960')?true:null)
    await shell.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await click('#more-button'); await visible('#more-menu'); await click('#settings-button'); await visible('#settings-overlay')
    const compactStyle=await inspectDialog('.settings-window')
    assert.ok(compactStyle.fits&&compactStyle.footerFits, 'Settings actions remain visible in a short window')
    assert.equal(await shell.executeJavaScript("(()=>{const body=document.querySelector('.settings-body');return body.scrollHeight>body.clientHeight&&getComputedStyle(body).overflowY==='auto'})()"),true)
    await click('#settings-close'); await click('#context-session'); await visible('#session-overlay')
    await shell.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const compactSession=await inspectDialog('.session-window')
    assert.ok(compactSession.fits&&compactSession.footerFits,JSON.stringify(compactSession))
    await click('#session-close'); host.setBounds(originalBounds)
  }
  await shell.executeJavaScript('window.bmw.updateGlobalSettings('+JSON.stringify(appearanceSettings)+')')
  await waitFor(async()=>await shell.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches")?true:null)
  console.log('PASS unified surfaces: BMW/DSH system font, readable type hierarchy, all settings categories, Conversations and schedules in dark/light themes, short-window scrolling and visible actions')

  console.log('PASS balanced toolbar: real menus, native View layering, new tab, site origin, Assistant visibility/permission, scheduled tasks, settings categories, saved layout and preserved draft, conversation entry')

  }
  if(group==='projects'){
  const created = await shell.executeJavaScript("window.bmw.createProject({ name: 'Second isolated Project', homeUrl: '' })")
  assert.equal(created.projects.length, 2)
  assert.notEqual(created.activeProjectId, before.activeProjectId)
  await shell.executeJavaScript(`(async () => { await window.bmw.setAgentControl(true); return window.bmw.browser({ action: 'tabs.open', url: ${JSON.stringify(`${origin}/opener`)}, foreground: true }) })()`)
  const opener = await waitFor(async () => webContents.getAllWebContents().find((contents) => contents.getURL() === `${origin}/opener` && !contents.isLoading()) || null)
  await opener.executeJavaScript(`document.cookie = 'bmw_smoke=1; SameSite=Lax'; window.open(${JSON.stringify(`${origin}/popup`)}, '_blank'); 'opened'`, true)
  const popup = await waitFor(async () => webContents.getAllWebContents().find((contents) => contents.getURL() === `${origin}/popup` && !contents.isLoading()) || null)
  const state = await shell.executeJavaScript("window.bmw.browser({ action: 'status' })") as { activeProject: { id: string }; tabs: { url: string; source: string; projectId: string }[] }
  assert.ok(state.tabs.some((tab) => tab.url === `${origin}/popup` && tab.source === 'page' && tab.projectId === state.activeProject.id))
  assert.equal(popup.session, opener.session)
  const processMetric = app.getAppMetrics().find((metric) => metric.pid === popup.getOSProcessId())
  assert.ok(processMetric, 'The popup renderer must be tracked by Electron')
  if (process.platform === 'darwin' || process.platform === 'win32') assert.equal(processMetric.sandboxed, true)
  assert.equal(await popup.executeJavaScript("typeof require === 'undefined' && typeof window.bmw === 'undefined' && document.cookie.includes('bmw_smoke=1')"), true)
  console.log('PASS popup: Project-owned, shared browser Session, OS sandbox, no Node/privileged preload')

  const agent = await waitFor(async()=>webContents.getAllWebContents().find(contents=>/^http:\/\/127\.0\.0\.1:/.test(contents.getURL())&&!contents.getURL().startsWith(origin)&&!contents.isLoading())||null)
  const selectInDsh=async(id:string)=>{
    await agent.executeJavaScript(`localStorage.setItem('dsh.sessions.current',JSON.stringify({sessionId:${JSON.stringify(id)}}));location.reload()`)
  }
  const firstProject=before.projects.find((project:{id:string})=>project.id===before.activeProjectId)
  await selectInDsh(firstProject.agentBindings.dsh.sessionId)
  await waitFor(async()=>{
    const context=await shell.executeJavaScript('window.bmw.agentContext()')
    const project=await shell.executeJavaScript('window.bmw.projectState()')
    return context.state==='ready'&&context.context?.sessionId===firstProject.agentBindings.dsh.sessionId&&project.activeProjectId===firstProject.id?context:null
  })
  const switched=await shell.executeJavaScript("window.bmw.browser({action:'status'})")
  assert.equal(switched.activeProject.id,firstProject.id)
  assert.equal(switched.activeTabId,firstTab.id,'DSH Workspace selection must restore the last visible Project tab, not the last created tab')
  assert.deepEqual(switched.tabs.map((tab:{id:string})=>tab.id).sort(),[firstTab.id,otherFirstTab.id].sort())
  assert.match(await shell.executeJavaScript("document.querySelector('#context-workspace').textContent"),/Workspace: Isolated Base smoke/)
  const firstWorkspaceId=(await shell.executeJavaScript('window.bmw.agentContext()')).context.workspaceId
  console.log('PASS DSH selected Session: cross-Project tabs restored')
  const sameProject=await shell.executeJavaScript('window.bmw.createAgentSession()')
  assert.notEqual(sameProject.selectedSessionId,firstProject.agentBindings.dsh.sessionId)
  await waitFor(async()=>{const value=await shell.executeJavaScript('window.bmw.agentContext()');return value.context?.sessionId===sameProject.selectedSessionId&&value.state==='ready'?value:null})
  await shell.executeJavaScript(`window.bmw.renameAgentSession(${JSON.stringify(firstProject.agentBindings.dsh.sessionId)},'First conversation')`)
  await selectInDsh(firstProject.agentBindings.dsh.sessionId)
  await waitFor(async()=>{const value=await shell.executeJavaScript('window.bmw.agentContext()');return value.context?.sessionTitle==='First conversation'&&value.state==='ready'?value:null})
  const shared=await shell.executeJavaScript("window.bmw.browser({action:'status'})")
  assert.equal(shared.activeTabId,firstTab.id);assert.deepEqual(shared.tabs.map((tab:{id:string})=>tab.id),switched.tabs.map((tab:{id:string})=>tab.id))
  assert.match(await shell.executeJavaScript("document.querySelector('#context-session').textContent"),/First conversation/)
  const secondProject=created.projects.find((project:{id:string})=>project.id===created.activeProjectId)
  await selectInDsh(secondProject.agentBindings.dsh.sessionId)
  await waitFor(async()=>{const value=await shell.executeJavaScript('window.bmw.agentContext()');const project=await shell.executeJavaScript('window.bmw.projectState()');return value.context?.sessionId===secondProject.agentBindings.dsh.sessionId&&project.activeProjectId===secondProject.id&&value.state==='ready'?value:null})
  const returned=await shell.executeJavaScript("window.bmw.browser({action:'status'})")
  assert.ok(returned.tabs.some((tab:{url:string})=>tab.url===origin+'/popup'))
  assert.equal(returned.tabs.some((tab:{url:string})=>tab.url===origin+'/first'),false)
  assert.equal(await popup.executeJavaScript("typeof window.bmw==='undefined'"),true)

  console.log('PASS same-Project conversations share tabs; return to second Project restores its popup')
  await shell.executeJavaScript('window.bmw.updateGlobalSettings({agentSidebarVisible:true})')
  await agent.executeJavaScript("document.querySelector('button[aria-label=\"Open sidebar\"]')?.click();true")
  await waitFor(async()=>await agent.executeJavaScript(`Boolean(document.querySelector('[data-row-key="workspace:${firstWorkspaceId}"]'))`)?true:null)
  const nativeClick=await agent.executeJavaScript(`(()=>{const row=document.querySelector('[data-row-key="workspace:${firstWorkspaceId}"]');const button=[...row.querySelectorAll('button')].find(button=>/new session|new chat|新会话|新建/i.test(button.getAttribute('aria-label')||''));if(!button)return [...row.querySelectorAll('button')].map(button=>button.getAttribute('aria-label'));button.click();return true})()`)
  assert.equal(nativeClick,true,'The real DSH Workspace create-conversation button must be clicked')
  await waitFor(async()=>{const value=await shell.executeJavaScript('window.bmw.agentContext()');const project=await shell.executeJavaScript('window.bmw.projectState()');return value.state==='ready'&&value.context?.projectId===firstProject.id&&project.activeProjectId===firstProject.id?value:null})
  assert.equal((await shell.executeJavaScript("window.bmw.browser({action:'status'})")).activeTabId,firstTab.id)
  console.log('PASS native DSH Workspace button: creates/selects browser-only session and switches BMW Project/pages')

  const image=await captureRendererEvidence(shell);fs.mkdirSync(path.join(process.cwd(),'.bmw-runtime'),{recursive:true});fs.writeFileSync(path.join(process.cwd(),'.bmw-runtime/context-link-desktop.png'),image.toPNG())
  console.log('PASS context: real DSH selection store + reload, bidirectional Project/page switching, same-Project shared tabs, Workspace and selected Session UI; no real Profile')


  const archivedCandidate=await shell.executeJavaScript('window.bmw.createAgentSession()')
  await shell.executeJavaScript('window.bmw.archiveAgentSession('+JSON.stringify(archivedCandidate.selectedSessionId)+')')
  const afterArchive=await shell.executeJavaScript('window.bmw.listAgentSessions()')
  assert.equal(afterArchive.items.some(item=>item.sessionId===archivedCandidate.selectedSessionId),false)
  assert.ok(afterArchive.selectedSessionId&&afterArchive.selectedSessionId!==archivedCandidate.selectedSessionId)
  // All document delays and browser broadcasts below belong to this disposable Profile.
  const projectEditorState = await shell.executeJavaScript('window.bmw.projectState()')
  const editorStore = new ProjectStore({filePath:path.join(userData,'projects.json'),projectsDirectory:path.join(userData,'projects'),legacyWorkspacePath:path.join(userData,'legacy-workspace'),onState:undefined})
  editorStore.writeDocument(firstProject.id,'instructions','# First instructions')
  editorStore.writeDocument(secondProject.id,'instructions','# Second instructions')
  editorStore.writeDocument(firstProject.id,'memory','# First memory')
  const delayedReads: Promise<void>[]=[]
  const releaseDocumentReads: (()=>void)[]=[]
  let failNextRead=false
  ipcMain.removeHandler('project-document-read')
  ipcMain.handle('project-document-read',async(event,projectId:unknown,kind:unknown)=>{
    assert.equal(event.sender,shell)
    if(typeof projectId!=='string'||typeof kind!=='string')throw new Error('Invalid fixture document input')
    if(failNextRead){failNextRead=false;throw new Error('Fixture read failure')}
    const result=editorStore.readDocument(projectId,kind)
    if(projectId===secondProject.id&&kind==='instructions'){
      const delay=new Promise<void>(resolve=>releaseDocumentReads.push(resolve))
      delayedReads.push(delay);await delay
    }
    return result
  })
  shell.send('project-manager-open',{mode:'manage'})
  await visible('#project-overlay')
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-document').value.trim()==='# First instructions'")?true:null)
  const projectSelector=(id:string)=>'#project-list button[data-project-id="'+id+'"]'
  const nativeProjectClick=async(id:string)=>{
    const point=await shell.executeJavaScript('(()=>{const element=document.querySelector('+JSON.stringify(projectSelector(id))+'),rect=element.getBoundingClientRect();globalThis.projectClickFixture=element;return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()')
    if((group as string)!=='native'){await click(projectSelector(id));return}
    shell.focus()
    shell.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
    shell.send('project-state',projectEditorState)
    await shell.executeJavaScript('true')
    assert.equal(await shell.executeJavaScript('globalThis.projectClickFixture===document.querySelector('+JSON.stringify(projectSelector(id))+')'),true,'Background broadcasts must retain a pressed Project button')
    shell.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
    await waitFor(async()=>await shell.executeJavaScript('document.querySelector('+JSON.stringify(projectSelector(id))+').getAttribute("aria-pressed")==="true"')?true:null)
  }
  await nativeProjectClick(secondProject.id)
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-name').value"),'Second isolated Project')
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-save').disabled"),true,'Save must wait for the selected document')
  await nativeProjectClick(firstProject.id)
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-document').value.trim()==='# First instructions'")?true:null)
  await waitFor(async()=>releaseDocumentReads.length?true:null)
  releaseDocumentReads.splice(0).forEach(resolve=>resolve())
  await Promise.all(delayedReads)
  await shell.executeJavaScript('new Promise(resolve=>setTimeout(resolve,30))')
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-document').value.trim()"),'# First instructions','A stale Project read must not replace the selected document')
  assert.equal((await shell.executeJavaScript('window.bmw.projectState()')).activeProjectId,firstProject.id,'Manager selection edits a Project without changing the running Project')
  await shell.executeJavaScript("document.querySelector('#project-name').value='Unsaved name';document.querySelector('#project-home').value='https://example.org/draft';document.querySelector('#project-document').value='# Unsaved instructions';true")
  await shell.executeJavaScript("window.bmw.browser({action:'reload'})")
  await shell.executeJavaScript('new Promise(resolve=>setTimeout(resolve,50))')
  assert.deepEqual(await shell.executeJavaScript("['project-name','project-home','project-document'].map(id=>document.getElementById(id).value)"),['Unsaved name','https://example.org/draft','# Unsaved instructions'])
  await click('[data-kind="memory"]')
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-document').value.trim()==='# First memory'")?true:null)
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-name').value"),'Unsaved name','Document selection preserves metadata drafts')
  await nativeProjectClick(firstProject.id)
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-name').value"),'Unsaved name','Re-selecting the same Project must preserve drafts')
  await nativeProjectClick(secondProject.id)
  await click('[data-kind="instructions"]')
  await click('#project-new')
  await shell.executeJavaScript("document.querySelector('#project-name').value='Unsaved new Project';true")
  shell.send('project-state',projectEditorState)
  await waitFor(async()=>releaseDocumentReads.length?true:null)
  releaseDocumentReads.splice(0).forEach(resolve=>resolve())
  await Promise.all(delayedReads)
  await shell.executeJavaScript('new Promise(resolve=>setTimeout(resolve,30))')
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-document').value"),'')
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-name').value"),'Unsaved new Project')
  failNextRead=true
  await nativeProjectClick(firstProject.id)
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-message').textContent.includes('Fixture read failure')")?true:null)
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-save').disabled"),true,'Failed reads must not enable saving a blank replacement')
  await nativeProjectClick(secondProject.id)
  await waitFor(async()=>releaseDocumentReads.length?true:null)
  releaseDocumentReads.splice(0).forEach(resolve=>resolve())
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-document').value.trim()==='# Second instructions'&&!document.querySelector('#project-save').disabled")?true:null)
  await shell.executeJavaScript('new Promise(resolve=>setTimeout(resolve,30))')
  await saveShell('project-manager-selection.png')
  await click('#project-close')
  console.log('PASS Project Manager: native row click during broadcasts, selected/current distinction, stale document admission, metadata/document drafts, new-Project draft and failed-read save boundary')

  const persisted=await shell.executeJavaScript('window.bmw.projectState()'),status=await shell.executeJavaScript("window.bmw.browser({action:'status'})")
  const restartDraft=await shell.executeJavaScript("window.bmw.browser({action:'video.studio',studioRequest:{operation:'create',title:'Restart preserved draft'}})")
  const memory=await shell.executeJavaScript("window.bmw.readProjectDocument("+JSON.stringify(persisted.activeProjectId)+",'memory').then(value=>value.content)")
  fs.writeFileSync(path.join(temporary,'restart.json'),JSON.stringify({activeProjectId:persisted.activeProjectId,projects:persisted.projects.map(project=>({id:project.id,agentBindings:project.agentBindings})),tabUrls:status.tabs.map(tab=>tab.url).sort(),memory,draftId:restartDraft.id}))
  if(process.env.BMW_DESKTOP_RESTART_MARKER)fs.writeFileSync(process.env.BMW_DESKTOP_RESTART_MARKER,temporary)
  }
  if(group==='native'){
  markStage('Desktop smoke: integrated workspace verified; checking native focus')
  host.show();app.focus({steal:true});host.focus()
  if(process.platform==='darwin'){app.setActivationPolicy('regular');await app.dock?.show()}
  host.show();app.focus({steal:true});host.focus()
  await waitFor(async () => host.isFocused() ? true : null,Date.now()+15_000)
  await click('#more-button'); await visible('#more-menu')
  await waitFor(async () => shellView.getBounds().height > 102 ? true : null)
  assert.equal(host.contentView.children.at(-1), shellView, 'Toolbar popup must sit above native browser views')
  const menuTab = await shell.executeJavaScript(`window.bmw.browser({action:'tabs.open',url:${JSON.stringify(origin+'/menu-layer')},foreground:true,reuse:false})`)
  assert.equal(host.contentView.children.at(-1), shellView, 'New tabs must not hide an open More menu')
  await saveShell('balanced-more-menu.png')
  await waitFor(async () => shell.isFocused() ? true : null, Date.now() + 5_000)
  shell.sendInputEvent({type:'keyDown',keyCode:'Escape'})
  shell.sendInputEvent({type:'keyUp',keyCode:'Escape'})
  await waitFor(async () => shellView.getBounds().height === 102 ? true : null)
  await waitFor(async () => await shell.executeJavaScript("document.activeElement.id==='more-button'") ? true : null)
  await shell.executeJavaScript(`window.bmw.browser({action:'tabs.close',tabId:${JSON.stringify(menuTab.id)}})`)
  await shell.executeJavaScript(`window.bmw.browser({action:'tabs.show',tabId:${JSON.stringify(firstTab.id)}})`)
  const firstProject=before.projects.find(project=>project.id===before.activeProjectId)
  const created=await shell.executeJavaScript("window.bmw.createProject({name:'Second isolated Project',homeUrl:''})")
  const secondProject=created.projects.find(project=>project.id===created.activeProjectId)
  await appearanceDsh.executeJavaScript("localStorage.setItem('dsh.sessions.current',JSON.stringify({sessionId:"+JSON.stringify(firstProject.agentBindings.dsh.sessionId)+"}));location.reload()")
  await waitFor(async()=>{const value=await shell.executeJavaScript('window.bmw.agentContext()');return value.state==='ready'&&value.context?.projectId===firstProject.id?value:null})
  // All document delays and browser broadcasts below belong to this disposable Profile.
  const projectEditorState = await shell.executeJavaScript('window.bmw.projectState()')
  const editorStore = new ProjectStore({filePath:path.join(userData,'projects.json'),projectsDirectory:path.join(userData,'projects'),legacyWorkspacePath:path.join(userData,'legacy-workspace'),onState:undefined})
  editorStore.writeDocument(firstProject.id,'instructions','# First instructions')
  editorStore.writeDocument(secondProject.id,'instructions','# Second instructions')
  editorStore.writeDocument(firstProject.id,'memory','# First memory')
  const delayedReads: Promise<void>[]=[]
  const releaseDocumentReads: (()=>void)[]=[]
  let failNextRead=false
  ipcMain.removeHandler('project-document-read')
  ipcMain.handle('project-document-read',async(event,projectId:unknown,kind:unknown)=>{
    assert.equal(event.sender,shell)
    if(typeof projectId!=='string'||typeof kind!=='string')throw new Error('Invalid fixture document input')
    if(failNextRead){failNextRead=false;throw new Error('Fixture read failure')}
    const result=editorStore.readDocument(projectId,kind)
    if(projectId===secondProject.id&&kind==='instructions'){
      const delay=new Promise<void>(resolve=>releaseDocumentReads.push(resolve))
      delayedReads.push(delay);await delay
    }
    return result
  })
  shell.send('project-manager-open',{mode:'manage'})
  await visible('#project-overlay')
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-document').value.trim()==='# First instructions'")?true:null)
  const projectSelector=(id:string)=>'#project-list button[data-project-id="'+id+'"]'
  const nativeProjectClick=async(id:string)=>{
    const point=await shell.executeJavaScript('(()=>{const element=document.querySelector('+JSON.stringify(projectSelector(id))+'),rect=element.getBoundingClientRect();globalThis.projectClickFixture=element;return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()')
    if((group as string)!=='native'){await click(projectSelector(id));return}
    shell.focus()
    shell.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
    shell.send('project-state',projectEditorState)
    await shell.executeJavaScript('true')
    assert.equal(await shell.executeJavaScript('globalThis.projectClickFixture===document.querySelector('+JSON.stringify(projectSelector(id))+')'),true,'Background broadcasts must retain a pressed Project button')
    shell.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
    await waitFor(async()=>await shell.executeJavaScript('document.querySelector('+JSON.stringify(projectSelector(id))+').getAttribute("aria-pressed")==="true"')?true:null)
  }
  await nativeProjectClick(secondProject.id)
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-name').value"),'Second isolated Project')
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-save').disabled"),true,'Save must wait for the selected document')
  await nativeProjectClick(firstProject.id)
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-document').value.trim()==='# First instructions'")?true:null)
  await waitFor(async()=>releaseDocumentReads.length?true:null)
  releaseDocumentReads.splice(0).forEach(resolve=>resolve())
  await Promise.all(delayedReads)
  await shell.executeJavaScript('new Promise(resolve=>setTimeout(resolve,30))')
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-document').value.trim()"),'# First instructions','A stale Project read must not replace the selected document')
  assert.equal((await shell.executeJavaScript('window.bmw.projectState()')).activeProjectId,firstProject.id,'Manager selection edits a Project without changing the running Project')
  await shell.executeJavaScript("document.querySelector('#project-name').value='Unsaved name';document.querySelector('#project-home').value='https://example.org/draft';document.querySelector('#project-document').value='# Unsaved instructions';true")
  await shell.executeJavaScript("window.bmw.browser({action:'reload'})")
  await shell.executeJavaScript('new Promise(resolve=>setTimeout(resolve,50))')
  assert.deepEqual(await shell.executeJavaScript("['project-name','project-home','project-document'].map(id=>document.getElementById(id).value)"),['Unsaved name','https://example.org/draft','# Unsaved instructions'])
  await click('[data-kind="memory"]')
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-document').value.trim()==='# First memory'")?true:null)
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-name').value"),'Unsaved name','Document selection preserves metadata drafts')
  await nativeProjectClick(firstProject.id)
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-name').value"),'Unsaved name','Re-selecting the same Project must preserve drafts')
  await nativeProjectClick(secondProject.id)
  await click('[data-kind="instructions"]')
  await click('#project-new')
  await shell.executeJavaScript("document.querySelector('#project-name').value='Unsaved new Project';true")
  shell.send('project-state',projectEditorState)
  await waitFor(async()=>releaseDocumentReads.length?true:null)
  releaseDocumentReads.splice(0).forEach(resolve=>resolve())
  await Promise.all(delayedReads)
  await shell.executeJavaScript('new Promise(resolve=>setTimeout(resolve,30))')
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-document').value"),'')
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-name').value"),'Unsaved new Project')
  failNextRead=true
  await nativeProjectClick(firstProject.id)
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-message').textContent.includes('Fixture read failure')")?true:null)
  assert.equal(await shell.executeJavaScript("document.querySelector('#project-save').disabled"),true,'Failed reads must not enable saving a blank replacement')
  await nativeProjectClick(secondProject.id)
  await waitFor(async()=>releaseDocumentReads.length?true:null)
  releaseDocumentReads.splice(0).forEach(resolve=>resolve())
  await waitFor(async()=>await shell.executeJavaScript("document.querySelector('#project-document').value.trim()==='# Second instructions'&&!document.querySelector('#project-save').disabled")?true:null)
  await shell.executeJavaScript('new Promise(resolve=>setTimeout(resolve,30))')
  await saveShell('project-manager-selection.png')
  await click('#project-close')
  console.log('PASS Project Manager: native row click during broadcasts, selected/current distinction, stale document admission, metadata/document drafts, new-Project draft and failed-read save boundary')

  }
  assert.deepEqual(errors, [])
  console.log('PASS Base desktop: real shell, isolated DSH session, no chat UI/preload/actions/default bindings')
} catch (error) {
  console.error(error)
  process.exitCode = 1
  fs.writeFileSync(path.join(evidenceDirectory,'failure.json'),JSON.stringify({group,stage,error:error instanceof Error?error.stack:String(error),windows:BrowserWindow.getAllWindows().map(window=>({id:window.id,visible:window.isVisible(),focused:window.isFocused(),bounds:window.getBounds()})),contents:webContents.getAllWebContents().map(contents=>({id:contents.id,url:contents.getURL().replace(/([?&]token=)[^&]+/g,'$1[redacted]'),loading:contents.isLoading()}))},null,2))
  if(shell&&!shell.isDestroyed())try{fs.writeFileSync(path.join(evidenceDirectory,'failure-shell.png'),(await captureRendererEvidence(shell)).toPNG())}catch(captureError){fs.writeFileSync(path.join(evidenceDirectory,'failure-capture.txt'),String(captureError))}
} finally {
  fs.writeFileSync(path.join(evidenceDirectory,'result.json'),JSON.stringify({group,stage,status:process.exitCode?'failed':'passed'},null,2))
  clearTimeout(watchdog)
  fixture.closeAllConnections()
  if (fixture.listening) await new Promise<void>((resolve) => fixture.close(() => resolve()))
  app.once('will-quit', () => {
    if(!(group==='projects'&&!process.exitCode&&process.env.BMW_DESKTOP_RESTART_MARKER))fs.rmSync(temporary, { recursive: true, force: true })
    app.exit(Number(process.exitCode || 0))
  })
  app.quit()
}

}
app.whenReady().then(run).catch((error: unknown) => { console.error(error); app.exit(1) })
