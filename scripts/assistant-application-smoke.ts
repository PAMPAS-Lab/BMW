import {assertVideoDraft,newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import {captureRendererEvidence} from './renderer-evidence.js'
import {requireCurrentAgentData} from '../packages/platform/src/agent-data-format.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { app, ipcMain, webContents,dialog,BrowserWindow } from 'electron'
import type {WebContentsView} from 'electron'
import type { AgentBackend, AgentRunRequest, AssistantState,AgentDriverSettings } from '@bmw-agent/agent-contract'
import { agentRecord } from '@bmw-agent/agent-contract'
import { assistantPagePath, assistantPreloadPath } from '@bmw-agent/agent-ui'
import { createBmwApplication } from '../packages/platform/src/main.js'
import { ProjectStore } from '../packages/platform/src/project-store.js'
import { LayoutStore } from '../packages/platform/src/layout-store.js'
import { bmwProduct } from '../packages/product-bmw/index.js'
import type { AgentBridgeConnection } from '../packages/platform/src/assistant-service.js'
import {loadAssistantStores} from '../packages/platform/src/assistant-service.js'

// Fail in the test channel rather than opening Electron's blocking native error dialog.
process.on('uncaughtException',(error:Error)=>{console.error(error);process.exit(1)})

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-assistant-app-')))
const profile = path.join(root, 'profile')
console.log('Assistant application fixture: '+root)
process.env.BMW_USER_DATA_DIR = profile
requireCurrentAgentData(process.env.BMW_USER_DATA_DIR)
const projects = new ProjectStore({ filePath: path.join(profile, 'projects.json'), projectsDirectory: path.join(root, 'projects'), initialWorkspacePath: path.join(root, 'workspace'), onState: undefined })
projects.completeInitialSetup({ name: 'Assistant contract Project', homeUrl: '' })
new LayoutStore({ filePath: path.join(profile, 'layout-settings.json'), onState: undefined }).update({ configured: true, mode: 'sidebar' })
const startupKind=process.env.BMW_ASSISTANT_STARTUP_KIND,startupScenario=process.env.BMW_ASSISTANT_STARTUP_SCENARIO??'retry'
const scheduleCase=process.env.BMW_ASSISTANT_SCHEDULE_CASE==='1'
if(scheduleCase)assert.equal(startupKind,undefined)
let startupPrompts=0
if(startupKind){
  assert.ok(['conversations','preferences','history'].includes(startupKind))
  const stores=loadAssistantStores(profile,'fixture'),saved=stores.conversations.create(projects.active().id,'fixture','Saved conversation')
  stores.preferences.set(projects.active().id,'fixture')
  stores.conversations.bind(saved.sessionId,'provider-'+saved.sessionId)
  stores.history.prepare(saved.sessionId,'prior-run','prior-message','Interrupted prior process')
  stores.conversations.setStatus(saved.sessionId,'running')
  const files={conversations:path.join(profile,'agent-conversations.json'),preferences:path.join(profile,'agent-preferences.json'),history:path.join(profile,'agent-history',crypto.createHash('sha256').update(saved.sessionId).digest('hex')+'.json')}
  const target=files[startupKind as keyof typeof files],original=fs.readFileSync(target,'utf8'),invalid='{preserved invalid Assistant state'
  fs.writeFileSync(target,invalid)
  const before=new Map(Object.values(files).map(file=>[file,fs.readFileSync(file,'utf8')]))
  Object.assign(dialog,{showMessageBox:async()=>{
    startupPrompts++
    assert.equal(BrowserWindow.getAllWindows().length,0,'Unreadable Assistant state must block privileged windows and backend construction')
    for(const [file,content]of before)assert.equal(fs.readFileSync(file,'utf8'),content,'Validation must finish before recovery writes any saved Assistant table')
    if(startupScenario==='exit'){
      app.once('will-quit',()=>{
        for(const [file,content]of before)assert.equal(fs.readFileSync(file,'utf8'),content)
        console.log('PASS Assistant startup '+startupKind+' exit preserves all tables before UI/backend construction')
        console.log('Assistant startup evidence: '+root);app.exit(0)
      })
      return {response:1,checkboxChecked:false}
    }
    fs.writeFileSync(target,original);return {response:0,checkboxChecked:false}
  }})
}
const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>BMW Assistant bridge</title><h1>Project-owned page</h1>') })
let pageUrl = '', connection: AgentBridgeConnection | null = null, latestRequest: AgentRunRequest | null = null, imageCount = 0, draftOwner = ''
const fixtureReply='BMW browser and Studio completed\n\n**Project** `verified`\n\n<img src=x onerror="window.fixtureHtmlExecuted=true">'
let closeStarted!:()=>void,finishClose!:()=>void,willQuit=false
const scheduledCalls:{driverId:string;sessionId:string;projectId:string;draftId:string}[]=[]
let settingsCleanupStarted=false,finishSettingsCleanup:(()=>void)|undefined
let holdSettingsRefresh=false,settingsRefreshes=0,loginRefreshes=0,finishSettingsRefresh:(()=>void)|undefined
const closing=new Promise<void>(resolve=>{closeStarted=resolve}),closeGate=new Promise<void>(resolve=>{finishClose=resolve})
app.once('will-quit',()=>{willQuit=true})
const backend: AgentBackend = {
  description: { id: 'fixture', label: 'Fixture', baseline: 'No model', capabilities: { streaming: true, images: true, interrupt: true, steer: false, fork: false, approvals: false, nativeOpen: false, browserOnly: true } },
  async prepare(request) { latestRequest = request; return this.description },
  async run(request, emit) {
    await emit({ type: 'session.bound', externalSessionId: request.externalSessionId??'provider-' + request.sessionId })
    await emit({ type: 'input.accepted', receiptId: 'receipt-' + request.runId })
    if(scheduleCase){
      assert.match(request.text,/^\[BMW Scheduled Task/)
      const draft=agentRecord((await connection!.execute({action:'video.studio',studioRequest:{operation:'create',title:'Scheduled '+this.description.id}},request.signal)).result)
      assert.equal(draft.ownerSessionId,request.sessionId)
      scheduledCalls.push({driverId:this.description.id,sessionId:request.sessionId,projectId:request.project.id,draftId:String(draft.id)})
      await emit({type:'message.completed',messageId:'scheduled-'+request.runId,text:'Saved draft '+draft.id})
      await emit({type:'turn.completed',outcome:'success',message:''});return {outcome:'success',message:''}
    }
    if (request.text === 'hold') {
      await new Promise<void>(resolve => { if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true }) })
      await emit({ type: 'turn.completed', outcome: 'interrupted', message: 'Fixture stopped' }); return { outcome: 'interrupted', message: 'Fixture stopped' }
    }
    let sequence = 0
    const browser = async (args: Record<string, unknown>) => {
      const callId = 'call-' + (++sequence)
      await emit({ type: 'tool.started', callId, name: 'browser', action: String(args.action) })
      const reply = await connection!.execute(args, request.signal)
      imageCount += reply.images?.length ?? 0
      await emit({ type: 'tool.completed', callId, success: true, message: '' }); return agentRecord(reply.result)
    }
    const tab = await browser({ action: 'tabs.open', url: pageUrl, foreground: false, reuse: false })
    await browser({ action: 'media.screenshot', tabId: tab.id })
    const draft = await browser({ action: 'video.studio', studioRequest: { operation: 'create', title: 'Assistant-owned draft' } })
    draftOwner = String(draft.ownerSessionId ?? '')
    await emit({ type: 'message.delta', messageId: 'reply-' + request.runId, text: 'BMW ' })
    await emit({ type: 'message.completed', messageId: 'reply-' + request.runId, text: fixtureReply })
    await emit({ type: 'turn.completed', outcome: 'success', message: '' }); return { outcome: 'success', message: '' }
  },
  async interrupt() {}, async respond() { throw new Error('No fixture questions') }, async close() {closeStarted();await closeGate}
}
const handlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>()
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => { handlers.set(channel, listener); handle(channel, listener) }
createBmwApplication(bmwProduct, { pagePath: assistantPagePath, preloadPath: assistantPreloadPath, defaultDriverId: 'fixture',
  createBackends(config) {
    const prepare = backend.prepare.bind(backend)
    backend.prepare = async request => { connection = await config.connection(request); return prepare(request) }
    let settingsCleanup:Promise<void>|undefined
    const settings=():AgentDriverSettings=>({authentication:{state:'ready',label:'官方测试账号已连接'},models:[{id:'fixture-model',label:'Fixture model',description:'No inference',availability:'verified'},{id:'disabled-model',label:'Unavailable model',description:'Not available',availability:'unavailable'}],selectedModel:config.model('fixture'),loginMethods:[{id:'fixture-login',label:'测试凭据',fields:[{id:'apiKey',label:'API Key',secret:true,required:true}]}],canLogout:false})
    backend.settings=async(request,context)=>{
      if(request.action==='refresh'){
        settingsRefreshes++
        if(holdSettingsRefresh)await new Promise<void>(resolve=>{finishSettingsRefresh=resolve})
      }
      await new Promise(resolve=>setImmediate(resolve));context.signal.throwIfAborted()
      if(request.action==='model.select'){assert.equal(request.modelId,'fixture-model');config.setModel('fixture',request.modelId)}
      if(request.action==='auth.login'){
        assert.equal(request.methodId,'fixture-login');assert.equal(request.values.apiKey,'fixture-one-shot-secret')
        settingsCleanup=new Promise(resolve=>{finishSettingsCleanup=resolve})
        await new Promise<void>(resolve=>{if(context.signal.aborted)resolve();else context.signal.addEventListener('abort',()=>resolve(),{once:true})})
        throw new Error('Private provider diagnostic: '+request.values.apiKey)
      }
      return settings()
    }
    backend.drainSettings=async()=>{if(settingsCleanup){settingsCleanupStarted=true;await settingsCleanup;settingsCleanup=undefined}}
    if(scheduleCase){
      const other:AgentBackend={...backend,description:{...backend.description,id:'fixture-other',label:'Other official driver fixture'}}
      other.prepare=async request=>{connection=await config.connection(request);latestRequest=request;return other.description}
      return [backend,other]
    }
    if(!startupKind){
      let authenticated=false
      const other:AgentBackend={...backend,description:{...backend.description,id:'fixture-login',label:'Login driver fixture'},close:async()=>{},drainSettings:async()=>{}}
      other.prepare=async()=>assert.fail('Login settings must not prepare a model turn')
      other.run=async()=>assert.fail('Login settings must not release model input')
      other.settings=async(request,context)=>{
        context.signal.throwIfAborted()
        if(request.action==='refresh')loginRefreshes++
        if(request.action==='auth.login'){assert.equal(request.methodId,'fixture-key');assert.equal(request.values.apiKey,'fixture-login-success');authenticated=true}
        if(request.action==='model.select'){assert.ok(authenticated);assert.equal(request.modelId,'login-model');config.setModel('fixture-login',request.modelId)}
        return {authentication:{state:authenticated?'ready':'required',label:authenticated?'测试账号已登录':'请先登录'},models:[{id:'login-model',label:'Supported login model',description:'No inference',availability:'verified'},{id:'unknown-model',label:'Unknown model',description:'Not admitted',availability:'unverified'},{id:'unavailable-model',label:'Unavailable model',description:'Disabled',availability:'unavailable'}],selectedModel:config.model('fixture-login'),loginMethods:[{id:'fixture-key',label:'测试 API Key',fields:[{id:'apiKey',label:'API Key',secret:true,required:true}]}],canLogout:false}
      }
      return [backend,other]
    }
    return [backend]
  }
})
async function waitFor<T>(read: () => Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) { const value = await read(); if (value !== null) return value; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error('Assistant application timeout: ' + label)
}
const watchdog = setTimeout(() => {console.error('Assistant application watchdog expired');app.exit(1)}, 60000)
let exitCode = 0
async function closeApplication(message:string):Promise<void>{
  app.quit();await closing;await new Promise(resolve=>setTimeout(resolve,100))
  assert.equal(willQuit,false,'Application quit must wait for actual native cleanup')
  app.once('will-quit',()=>{clearTimeout(watchdog);server.closeAllConnections();server.close();console.log(message);app.exit(0)})
  finishClose()
}
async function run():Promise<void>{
await app.whenReady()
if(startupKind&&startupScenario==='exit')return
try {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address === 'object'); pageUrl = 'http://127.0.0.1:' + address.port
  const assistant = await waitFor(async () => webContents.getAllWebContents().find(row => row.getURL().endsWith('/assistant.html') && !row.isLoading()) ?? null, 'Assistant load')
  assistant.on('console-message',details=>{if(details.level==='error')console.error('Assistant Renderer: '+details.message)})
  const shell = await waitFor(async () => webContents.getAllWebContents().find(row => row.getURL().endsWith('/shell.html') && !row.isLoading()) ?? null, 'Shell load')
  const snapshot = async (): Promise<AssistantState> => assistant.executeJavaScript('window.bmwAssistant.invoke({action:"snapshot"})')
  const initial = await waitFor(async () => { const state = await snapshot(); return state.selectedSessionId ? state : null }, 'blank Session visible')
  assert.equal(initial.sessions.length, 1)
  if(startupKind){
    assert.equal(startupPrompts,1);assert.equal(initial.sessions[0].status,'disconnected')
    assert.equal(initial.messages.length,1);assert.equal(initial.events.at(-1)?.event.type,'turn.disconnected')
    assert.equal(initial.sessions[0].externalSessionId,'provider-'+initial.selectedSessionId)
    assert.equal(latestRequest,null,'Startup recovery must not send a model request')
    assert.equal(imageCount,0);assert.equal(draftOwner,'','Startup recovery must not create a Studio draft')
    console.log('PASS Assistant startup '+startupKind+' retry preserves identities and recovers delivery without replay')
    await closeApplication('PASS Assistant startup '+startupKind+' retry drains native resources');return
  }else{assert.equal(initial.sessions[0].externalSessionId,null);assert.equal(initial.messages.length,0)}
  assert.equal(await assistant.executeJavaScript('typeof window.require'), 'undefined')
  const invoke = handlers.get('bmw-assistant-command')!; assert.ok(invoke)
  await assert.rejects(Promise.resolve().then(() => invoke({ sender: shell, senderFrame: shell.mainFrame } as unknown as Parameters<typeof invoke>[0], { action: 'session.create' })), /BMW_SHELL_IPC_DENIED/)
  await assert.rejects(assistant.executeJavaScript('window.bmwAssistant.invoke({action:"execute",code:"process.exit()"})'), /Unknown BMW Assistant command/)
  await shell.executeJavaScript('window.bmw.setAgentControl(true)')
  if(scheduleCase){
    const command=(value:Record<string,unknown>):Promise<AssistantState>=>assistant.executeJavaScript('window.bmwAssistant.invoke('+JSON.stringify(value)+')')
    const browser=(value:Record<string,unknown>):Promise<unknown>=>shell.executeJavaScript('window.bmw.browser('+JSON.stringify(value)+')')
    const createTask=async(name:string)=>agentRecord(await browser({action:'schedule.create',scheduleName:name,schedulePrompt:'Create one scoped Studio draft.',scheduleTime:'23:59',scheduleTimeZone:'Asia/Shanghai',scheduleEnabled:false}))
    const firstSession=initial.selectedSessionId!,firstTask=await createTask('First driver')
    assert.equal(firstTask.sessionId,firstSession);assert.equal(firstTask.driverId,'fixture')
    const other=await command({action:'driver.select',driverId:'fixture-other'}),otherSession=other.selectedSessionId!,otherTask=await createTask('Other driver')
    assert.equal(otherTask.sessionId,otherSession);assert.equal(otherTask.driverId,'fixture-other')
    const runTask=async(taskId:unknown)=>{
      const accepted=agentRecord(await shell.executeJavaScript('window.bmw.runScheduledTask('+JSON.stringify(taskId)+')')),runId=agentRecord(accepted.run).id
      const completed=agentRecord(await waitFor(async()=>{const state=agentRecord(await shell.executeJavaScript('window.bmw.scheduledTasks()'));assert.ok(Array.isArray(state.runs));return state.runs.find(raw=>agentRecord(raw).id===runId&&['completed','failed'].includes(String(agentRecord(raw).status)))??null},'saved schedule completion'))
      assert.equal(completed.status,'completed',String(completed.error));assert.match(String(completed.summary),/Saved draft/)
    }
    await runTask(firstTask.id)
    assert.equal((await snapshot()).selectedSessionId,otherSession);assert.equal((await snapshot()).driverId,'fixture-other')
    assert.deepEqual(scheduledCalls.map(row=>({driverId:row.driverId,sessionId:row.sessionId,projectId:row.projectId})),[{driverId:'fixture',sessionId:firstSession,projectId:initial.project.id}])
    const otherDrafts=agentRecord(await browser({action:'video.studio',studioRequest:{operation:'list'}}));assert.deepEqual(otherDrafts.drafts,[])
    await command({action:'driver.select',driverId:'fixture'})
    await runTask(otherTask.id)
    const restored=await snapshot();assert.equal(restored.selectedSessionId,firstSession);assert.equal(restored.driverId,'fixture')
    assert.deepEqual(scheduledCalls.map(row=>row.driverId),['fixture','fixture-other'])
    assert.deepEqual(scheduledCalls.map(row=>row.sessionId),[firstSession,otherSession])
    const ownDrafts=agentRecord(await browser({action:'video.studio',studioRequest:{operation:'list'}}));assert.ok(Array.isArray(ownDrafts.drafts));assert.equal(ownDrafts.drafts.length,1);assert.equal(agentRecord(ownDrafts.drafts[0]).ownerSessionId,firstSession)
    await assert.rejects(browser({action:'video.studio',studioRequest:{operation:'read',draftId:scheduledCalls[1].draftId}}),/STUDIO_SESSION_MISMATCH/)
    fs.writeFileSync(path.join(root,'schedule-proof.json'),JSON.stringify({scheduledCalls,firstSession,otherSession,restoredSession:restored.selectedSessionId,paidInference:false},null,2)+'\n')
    app.once('will-quit',()=>{clearTimeout(watchdog);server.closeAllConnections();server.close();console.log('PASS cross-driver schedule: both pinned engines/Sessions, real Studio ownership and restored selection');app.exit(0)})
    finishClose();app.quit();return
  }
  if(!startupKind){
    console.log('Settings UI: repeated opens share one pending refresh')
    holdSettingsRefresh=true
    await shell.executeJavaScript('window.bmw.openAgentAdvancedSettings()')
    await waitFor(async()=>finishSettingsRefresh?true:null,'delayed settings refresh began')
    await assistant.executeJavaScript('document.getElementById("agent-settings-open").click();document.getElementById("agent-settings-open").click()')
    await assistant.executeJavaScript('window.bmwAssistant.invoke({action:"settings.run",driverId:"fixture",request:{action:"refresh"}})')
    assert.equal(settingsRefreshes,1,'Repeated settings opens and IPC refresh share one native read')
    assert.equal((await snapshot()).busy,true)
    assert.equal(await assistant.executeJavaScript('document.getElementById("error").hidden'),true)
    assert.match(await assistant.executeJavaScript('document.getElementById("status").textContent'),/正在读取登录状态/)
    holdSettingsRefresh=false;finishSettingsRefresh!()

    await waitFor(async()=>{const state=await snapshot();return state.settings?.phase==='idle'&&!state.busy?state:null},'official settings refresh')
    await waitFor(async()=>await assistant.executeJavaScript('Boolean(document.querySelector("#agent-model option[value=fixture-model]")&&document.querySelector("#agent-login-fields input"))')?true:null,'settings projection rendered')
    assert.equal(await assistant.executeJavaScript('document.getElementById("agent-settings").open'),true)
    assert.equal(await assistant.executeJavaScript('document.querySelector("#agent-model option[value=disabled-model]")===null'),true)
    await assistant.executeJavaScript('document.getElementById("agent-model").value="fixture-model";document.getElementById("agent-model").dispatchEvent(new Event("change"));document.getElementById("agent-model-save").click()')
    await waitFor(async()=>{const state=await snapshot();return state.settings?.phase==='idle'&&state.settings.value?.selectedModel==='fixture-model'&&!state.busy?state:null},'model preference saved')
    assert.ok(fs.readFileSync(path.join(profile,'agent-preferences.json'),'utf8').includes('fixture-model'))
    await waitFor(async()=>await assistant.executeJavaScript('!document.getElementById("agent-settings").open')?true:null,'model confirmation closes dialog')
    await shell.executeJavaScript('window.bmw.openAgentAdvancedSettings()')
    await waitFor(async()=>{const state=await snapshot();return state.settings?.phase==='idle'&&!state.busy?state:null},'settings reopened')
    assert.equal(settingsRefreshes,1,'Reopening completed settings reuses its Profile cache')
    await assistant.executeJavaScript('document.getElementById("agent-settings-close").click();document.getElementById("agent-settings-open").click();document.getElementById("agent-settings-open").click()')
    assert.equal(settingsRefreshes,1,'Repeated completed opens start no native process')
    assert.match(await assistant.executeJavaScript('document.getElementById("agent-auth-checked").textContent'),/登录状态检查/)
    await waitFor(async()=>await assistant.executeJavaScript('document.getElementById("agent-settings").open&&!document.getElementById("agent-refresh").disabled')?true:null,'authentication refresh ready after state publication')
    await assistant.executeJavaScript('document.getElementById("agent-refresh").click()')
    await waitFor(async()=>settingsRefreshes===2&&(await snapshot()).settings?.phase==='idle'&&!(await snapshot()).busy?true:null,'explicit authentication refresh')
    await waitFor(async()=>await assistant.executeJavaScript('!document.getElementById("agent-model-refresh").disabled')?true:null,'model refresh control ready after state publication')
    await assistant.executeJavaScript('document.getElementById("agent-model-refresh").click()')
    await waitFor(async()=>settingsRefreshes===3&&(await snapshot()).settings?.phase==='idle'&&!(await snapshot()).busy?true:null,'explicit model refresh')
    console.log('Settings UI: cached views and both explicit refresh entries; checking compact dialog')
    const window=BrowserWindow.getAllWindows()[0],originalSize=window.getSize();window.setSize(840,560)
    await waitFor(async()=>await assistant.executeJavaScript('(()=>{const r=document.getElementById("agent-settings").getBoundingClientRect(),b=document.getElementById("agent-settings-close").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&b.bottom<=innerHeight})()')?true:null,'compact settings fitting')
    fs.writeFileSync(path.join(root,'assistant-settings.png'),(await captureRendererEvidence(assistant)).toPNG())
    await shell.executeJavaScript('window.bmw.updateGlobalSettings({theme:"light"})')
    await waitFor(async()=>await assistant.executeJavaScript('matchMedia("(prefers-color-scheme: light)").matches&&getComputedStyle(document.documentElement).backgroundColor==="rgb(247, 249, 252)"')?true:null,'Assistant follows BMW light theme')
    fs.writeFileSync(path.join(root,'assistant-settings-light.png'),(await captureRendererEvidence(assistant)).toPNG())
    await shell.executeJavaScript('window.bmw.updateGlobalSettings({theme:"dark"})');window.setSize(originalSize[0],originalSize[1])
    await assistant.executeJavaScript('document.querySelector("#agent-login-fields input").value="fixture-one-shot-secret";document.getElementById("agent-login").requestSubmit()')
    await waitFor(async()=>{const state=await snapshot();return state.settings?.phase==='working'&&state.busy?state:null},'login control owns Host')
    assert.equal(await assistant.executeJavaScript('document.querySelector("#agent-login-fields input").value'),'')
    assert.equal(await assistant.executeJavaScript('document.getElementById("send").disabled'),true)
    assert.equal(JSON.stringify(await snapshot()).includes('fixture-one-shot-secret'),false)
    assert.equal(latestRequest,null,'Settings must not send a model turn')
    await assistant.executeJavaScript('document.getElementById("agent-settings-driver").value="fixture-login";document.getElementById("agent-settings-driver").dispatchEvent(new Event("change"))')
    await waitFor(async()=>settingsCleanupStarted?true:null,'settings cancellation waits for native cleanup')
    await assert.rejects(shell.executeJavaScript('window.bmw.createProject({name:"must not switch during settings cleanup",homeUrl:""})'),/Stop and drain/)
    assert.equal((await snapshot()).busy,true)
    assert.equal((await snapshot()).driverId,'fixture','Driver switch must wait for actual login cleanup')
    await waitFor(async()=>await assistant.executeJavaScript('/正在取消设置并清理/.test(document.getElementById("status").textContent)')?true:null,'cancellation cleanup status rendered')
    await assistant.executeJavaScript('document.getElementById("agent-settings-open").click();document.getElementById("agent-settings-open").click()')
    assert.equal(await assistant.executeJavaScript('document.getElementById("error").hidden'),true,'Opening settings during driver cancellation must not race another refresh')
    finishSettingsCleanup!()
    const cancelled=await waitFor(async()=>{const state=await snapshot();return state.driverId==='fixture-login'&&state.settings?.phase==='idle'&&!state.busy?state:null},'driver switched after actual login cleanup')
    assert.equal(JSON.stringify(cancelled).includes('fixture-one-shot-secret'),false)
    await waitFor(async()=>await assistant.executeJavaScript('document.getElementById("agent-settings").open&&document.getElementById("agent-model-section").hidden&&document.getElementById("send").disabled&&Boolean(document.querySelector("#agent-login-fields input"))')?true:null,'missing authentication opens login dialog')
    await assistant.executeJavaScript('document.querySelector("#agent-login-fields input").value="fixture-not-submitted";document.getElementById("agent-settings-close").click()')
    assert.equal(await assistant.executeJavaScript('document.querySelector("#agent-login-fields input").value'),'')
    const chooseDriver=async(id:string)=>{
      await waitFor(async()=>await assistant.executeJavaScript("!document.getElementById('driver').disabled")?true:null,'visible driver selector accepts interaction')
      await assistant.executeJavaScript('document.getElementById("driver").value='+JSON.stringify(id)+';document.getElementById("driver").dispatchEvent(new Event("change"))')
      await waitFor(async()=>{const state=await snapshot();return state.driverId===id&&state.settings&&state.settings.phase!=='working'&&!state.busy?state:null},'automatic driver settings refresh '+id)
      await waitFor(async()=>await assistant.executeJavaScript('document.getElementById("agent-settings-driver").value==='+JSON.stringify(id)+'&&!document.getElementById("agent-settings-driver").disabled&&!document.getElementById("agent-refresh").disabled')?true:null,'driver settings view ready '+id)
    }
    await chooseDriver('fixture')
    assert.equal((await snapshot()).settings?.value,null,'Cancelled authentication cannot restore cached ready state')
    await waitFor(async()=>await assistant.executeJavaScript('document.getElementById("agent-settings").open&&!document.getElementById("agent-refresh").disabled')?true:null,'authentication refresh ready after state publication')
    await assistant.executeJavaScript('document.getElementById("agent-refresh").click()')
    await waitFor(async()=>{const state=await snapshot();return state.settings?.phase==='idle'&&!state.busy?true:null},'explicit retry after cancelled authentication')
    await assistant.executeJavaScript('document.getElementById("agent-settings-close").click()')
    const beforeSwitchBack=settingsRefreshes
    await chooseDriver('fixture-login')
    assert.equal(loginRefreshes,1,'Switching back to the login driver reuses its first snapshot')
    await waitFor(async()=>await assistant.executeJavaScript('document.getElementById("agent-settings").open&&document.getElementById("agent-model-section").hidden')?true:null,'driver selector automatically opens missing login')
    await assistant.executeJavaScript('document.querySelector("#agent-login-fields input").value="fixture-login-success";document.getElementById("agent-login").requestSubmit()')
    await waitFor(async()=>{const state=await snapshot();return state.settings?.phase==='idle'&&state.settings.value?.authentication.state==='ready'&&!state.busy?state:null},'successful login exposes supported models')
    await waitFor(async()=>await assistant.executeJavaScript('!document.getElementById("agent-model-section").hidden&&document.querySelectorAll("#agent-model option").length===2&&document.querySelector("#agent-login-fields input").value===""')?true:null,'only supported models rendered after login')
    assert.equal(await assistant.executeJavaScript('document.getElementById("agent-model").textContent.includes("验证")'),false)
    assert.equal(await assistant.executeJavaScript('document.getElementById("send").disabled'),true)
    await assistant.executeJavaScript('document.getElementById("input").value="must remain unsent";document.getElementById("composer").requestSubmit()')
    assert.equal((await snapshot()).messages.length,0,'Composer submission must respect missing model confirmation')
    assert.equal(await assistant.executeJavaScript('document.getElementById("input").value'),'must remain unsent')
    await assistant.executeJavaScript('document.getElementById("input").value=""')
    await assistant.executeJavaScript('document.getElementById("agent-model").value="login-model";document.getElementById("agent-model").dispatchEvent(new Event("change"));document.getElementById("agent-model-save").click()')
    await waitFor(async()=>await assistant.executeJavaScript('!document.getElementById("agent-settings").open&&!document.getElementById("send").disabled')?true:null,'supported model confirmation enables conversation')
    assert.ok(fs.readFileSync(path.join(profile,'agent-preferences.json'),'utf8').includes('login-model'))
    assert.equal(latestRequest,null,'Login and model selection must not send inference input')
    await chooseDriver('fixture')
    assert.equal((await snapshot()).selectedSessionId,initial.selectedSessionId)
    assert.equal(settingsRefreshes,beforeSwitchBack,'Switching back to a ready driver starts no native refresh')
    assert.equal(loginRefreshes,1)
    assert.equal(await assistant.executeJavaScript('document.getElementById("agent-settings").open'),false)
    console.log('PASS automatic login dialog: switch during login awaits cleanup; cancel and change drivers; supported-only models; confirmation without inference')
    console.log('PASS actual Assistant settings: Shell entry, model persistence, compact dialog, secret clearing, cancellation and awaited native cleanup')
    console.log('Assistant settings evidence: '+root)
  }
  await assistant.executeJavaScript('window.bmwAssistant.invoke({action:"message.send",sessionId:' + JSON.stringify(initial.selectedSessionId) + ',text:"exercise-browser"})')
  const complete = await waitFor(async () => { const state = await snapshot(); return !state.busy && state.messages.some(row => row.role === 'assistant') ? state : null }, 'real browser and Studio')
  assert.equal(complete.messages.at(-1)?.text, fixtureReply); assert.ok(imageCount > 0)
  await waitFor(async()=>await assistant.executeJavaScript('Boolean(document.querySelector(".message.assistant strong"))')?true:null,'formatted message publication')
  assert.equal(await assistant.executeJavaScript('document.querySelector(".message.assistant strong").textContent'),'Project')
  assert.equal(await assistant.executeJavaScript('document.querySelectorAll(".message img").length'),0)
  assert.equal(await assistant.executeJavaScript('window.fixtureHtmlExecuted===true'),false)
  assert.equal(latestRequest?.sessionId, initial.selectedSessionId)
  assert.equal(draftOwner, initial.selectedSessionId)
  assert.equal(complete.sessions[0].externalSessionId,initial.sessions[0].externalSessionId??'provider-' + initial.selectedSessionId)
  const studio=agentRecord(await assistant.executeJavaScript('window.bmwAssistant.setWorkspaceMode("studio")'))
  assert.equal(studio.mode,'studio')
  const videoView=webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/studio.html'))!
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='simple'&&document.getElementById('draft-select').options.length>0")?true:null,'simple Studio assembly')
  await assistant.executeJavaScript("document.getElementById('input').value='Keep this user input';true")
  await videoView.executeJavaScript("window.bmwStudio.prefill('Add a product demo')")
  await new Promise(resolve=>setTimeout(resolve,80))
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),'Keep this user input','Shortcut does not append to an existing request')
  await assistant.executeJavaScript("document.getElementById('input').value='';document.getElementById('input').dispatchEvent(new Event('input'));true")
  await videoView.executeJavaScript("window.bmwStudio.prefill('Add a product demo')")
  await waitFor(async()=>await assistant.executeJavaScript("document.getElementById('input').value==='Add a product demo'")?true:null,'single empty composer prefill')
  const messageCount=(await snapshot()).messages.length
  assistant.send('bmw-assistant-prefill',{projectId:'foreign',sessionId:initial.selectedSessionId,text:'Foreign prompt'})
  await new Promise(resolve=>setTimeout(resolve,80))
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value.includes('Foreign prompt')"),false);assert.equal((await snapshot()).messages.length,messageCount,'Prefill never dispatches a run')
  // Exercise the actual native Host layout, not a mock FeatureHost or CSS alone.
  const host=BrowserWindow.getAllWindows().find(window=>window.contentView.children.some(child=>(child as WebContentsView).webContents===videoView))!
  assert.ok(host);host.show();host.focus();videoView.focus()
  const studioNative=host.contentView.children.find(child=>(child as WebContentsView).webContents===videoView)!
  const agentNative=host.contentView.children.find(child=>(child as WebContentsView).webContents===assistant)!
  const originalWidth=agentNative.getBounds().width;await assistant.executeJavaScript("document.getElementById('input').dataset.identity='original-composer';document.getElementById('input').value")
  await videoView.executeJavaScript("document.getElementById('add-scene').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.querySelectorAll('#scene-list .scene').length===1&&!document.getElementById('draft-title').disabled")?true:null,'create a real scene for editing layout')
  await waitFor(async()=>{const context=agentRecord(await assistant.executeJavaScript('window.bmwAssistant.composerContext()'));return agentRecord(context.selection).sceneId?true:null},'first scene context')
  const firstContext=agentRecord(await assistant.executeJavaScript('window.bmwAssistant.composerContext()')),firstSelection=agentRecord(firstContext.selection),pinnedSceneId=String(firstSelection.sceneId),pinnedDraftId=String(firstSelection.draftId)
  await assistant.executeJavaScript("document.getElementById('input').value='';document.getElementById('input').dispatchEvent(new Event('input'));document.getElementById('input').value='hold';document.getElementById('input').dispatchEvent(new Event('input'));true")
  const pinnedScope=await assistant.executeJavaScript("document.getElementById('studio-scope').textContent") as string
  assert.match(pinnedScope,/已固定/)
  await videoView.executeJavaScript("document.getElementById('add-scene').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.querySelectorAll('#scene-list .scene').length===2&&!document.getElementById('draft-title').disabled")?true:null,'second scene')
  await waitFor(async()=>{const context=agentRecord(await assistant.executeJavaScript('window.bmwAssistant.composerContext()'));return agentRecord(context.selection).sceneId!==pinnedSceneId?true:null},'different live scene selection')
  assert.equal(await assistant.executeJavaScript("document.getElementById('studio-scope').textContent"),pinnedScope,'Selecting another scene never retargets existing input')
  const pinnedText=await assistant.executeJavaScript("document.getElementById('input').value") as string
  await videoView.executeJavaScript("document.getElementById('view-toggle').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='advanced'&&!document.getElementById('timeline-dock').hidden")?true:null,'advanced editing layout')
  await waitFor(async()=>host.contentView.children.at(-1)===agentNative&&await videoView.executeJavaScript("document.body.dataset.chatOpen==='true'&&document.body.dataset.chatDocked==='false'")?true:null,'Same Assistant automatically becomes a small float')
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText)
  assert.equal(await assistant.executeJavaScript("document.getElementById('studio-scope').textContent"),pinnedScope)
  assert.equal((await snapshot()).messages.length,messageCount,'Automatic float never dispatches a run')
  await waitFor(async()=>{const b=agentNative.getBounds(),transport=await videoView.executeJavaScript("document.getElementById('transport').getBoundingClientRect().top") as number;return b.width===320&&b.height===320&&b.y+b.height<=transport-6?true:null},'Automatic float reserves playback controls')
  await videoView.executeJavaScript("(async()=>{const s=await window.bmwStudio.state();await window.bmwStudio.view({...s.view,confirmStages:true});return true})()")
  assert.ok(host.contentView.children.includes(agentNative),'Task preference changes must not close an open float')
  await assistant.executeJavaScript("document.getElementById('studio-chat-close').click();true")
  await waitFor(async()=>!host.contentView.children.includes(agentNative)?true:null,'User can collapse the automatic float')
  await videoView.executeJavaScript("(async()=>{const s=await window.bmwStudio.state();await window.bmwStudio.view({...s.view,confirmStages:false});return true})()")
  assert.ok(!host.contentView.children.includes(agentNative),'Task preferences must not reopen an explicitly closed float')
  const [hostWidth,hostHeight]=host.getContentSize();assert.deepEqual(studioNative.getBounds(),{x:0,y:0,width:hostWidth,height:hostHeight});assert.deepEqual(host.getMinimumSize(),[420,640],'Advanced editor permits a genuinely compact native window')
  await videoView.executeJavaScript("document.querySelector('[data-resource=elements]').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("!!document.getElementById('layer-add-text')&&!document.getElementById('layer-add-text').disabled")?true:null,'initial avoidance object resource')
  await videoView.executeJavaScript("document.getElementById('layer-add-text').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("!!document.getElementById('layer-text')&&!document.getElementById('layer-text').disabled&&!document.getElementById('seek').disabled")?true:null,'initial avoidance object saved')
  const avoidanceTime=await videoView.executeJavaScript(`(async()=>{const s=await window.bmwStudio.state(),d=s.drafts.find(d=>d.id===${JSON.stringify(pinnedDraftId)}),t=d.scenes.slice(0,-1).reduce((n,s)=>n+s.durationSeconds,0)+.5;const seek=document.getElementById('seek');seek.value=String(t);seek.dispatchEvent(new Event('input',{bubbles:true}));return t})()`) as number
  const avoidanceClock=String(Math.floor(avoidanceTime/60)).padStart(2,'0')+':'+String(Math.floor(avoidanceTime%60)).padStart(2,'0')
  await waitFor(async()=>await videoView.executeJavaScript("!document.getElementById('seek').disabled&&document.getElementById('time').textContent.startsWith("+JSON.stringify(avoidanceClock)+")")?true:null,'selected object actual seek frame painted before geometry')
  const avoidance=await waitFor(async()=>await videoView.executeJavaScript("(()=>{const r=document.querySelector('.canvas-layer-selection:not([hidden])')?.getBoundingClientRect();return r?.width&&r.height?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()") as {x:number;y:number;width:number;height:number}|null,'actual selected canvas pixels for float avoidance')
  await videoView.executeJavaScript("document.querySelector('#studio-workspace>.scenes').dataset.identity='canonical-resources';document.getElementById('inspector').dataset.identity='canonical-properties';true")
  await videoView.executeJavaScript("document.getElementById('studio-chat-launcher').click();true")
  await waitFor(async()=>host.contentView.children.at(-1)===agentNative?true:null,'same Assistant View raised above Studio')
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.chatOpen==='true'&&document.body.dataset.chatDocked==='false'&&getComputedStyle(document.getElementById('inspector')).visibility==='visible'")?true:null,'default floating leaves properties available')
  let floatSamples=0
  await waitFor(async()=>{const inspector=await videoView.executeJavaScript("(()=>{const r=document.getElementById('inspector').getBoundingClientRect();return {x:r.x,top:r.top,bottom:r.bottom}})()") as {x:number;top:number;bottom:number},bounds=agentNative.getBounds();if(++floatSamples===1||floatSamples===20)console.log('Studio float diagnostic',inspector,bounds);return bounds.width===320&&bounds.height>=240&&bounds.height<=320&&bounds.x+bounds.width<=inspector.x&&bounds.y>=inspector.top&&bounds.y+bounds.height<=inspector.bottom?true:null},'native default small float reserves properties and timeline')
  const floatStart=agentNative.getBounds()
  const transportTop=await videoView.executeJavaScript("document.getElementById('transport').getBoundingClientRect().top") as number
  assert.ok(floatStart.y+floatStart.height<=transportTop-6,'Chat must reserve the actual playback bar')
  const compactControls=await assistant.executeJavaScript("(()=>{const ids=['studio-chat-history','studio-chat-dock','studio-chat-close','studio-scope','input','send'];return ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,visible:getComputedStyle(document.getElementById(id)).display!=='none',viewportWidth:innerWidth,viewportHeight:innerHeight}})})()") as {id:string;x:number;y:number;right:number;bottom:number;width:number;height:number;visible:boolean;viewportWidth:number;viewportHeight:number}[]
  for(const r of compactControls)assert.ok(r.visible&&r.width>0&&r.height>0&&r.x>=0&&r.right<=r.viewportWidth&&r.y>=0&&r.bottom<=r.viewportHeight,'Compact floating control remains accessible: '+r.id)
  await assistant.executeJavaScript("document.getElementById('studio-chat-history').click();true")
  assert.equal(await assistant.executeJavaScript("document.body.classList.contains('full-history')&&getComputedStyle(document.querySelector('body>nav')).display!=='none'"),true)
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText)
  await assistant.executeJavaScript("document.getElementById('studio-chat-history').click();true")
  console.log('Native selected avoidance diagnostic',avoidance,floatStart)
  assert.ok(floatStart.x+floatStart.width<=avoidance.x||floatStart.x>=avoidance.x+avoidance.width||floatStart.y+floatStart.height<=avoidance.y||floatStart.y>=avoidance.y+avoidance.height,'Actual initial Native float must avoid selected canvas pixels')
  const resourcesBounds=await videoView.executeJavaScript("(()=>{const r=document.querySelector('#studio-workspace>.scenes').getBoundingClientRect();return {right:r.right}})()") as {right:number};assert.ok(floatStart.x>=resourcesBounds.right)
  const headerPoint=await assistant.executeJavaScript("(()=>{const r=document.querySelector('body>header strong').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()") as {x:number;y:number}
  const hostOrigin=host.getContentBounds(),global={x:hostOrigin.x+floatStart.x+headerPoint.x,y:hostOrigin.y+floatStart.y+headerPoint.y},dx=floatStart.x-resourcesBounds.right>100?-60:60,dy=floatStart.y-(await videoView.executeJavaScript("document.getElementById('inspector').getBoundingClientRect().top") as number)>50?-32:32
  host.show();host.focus();assistant.focus()
  await waitFor(async()=>host.isFocused()&&assistant.isFocused()&&await assistant.executeJavaScript('document.hasFocus()')?true:null,'float native focus settled')
  await assistant.executeJavaScript("(()=>{window.__nativeFloatEvents=[];const h=document.querySelector('body>header');for(const name of ['pointerdown','pointermove'])h.addEventListener(name,event=>window.__nativeFloatEvents.push({name,buttons:event.buttons,captured:h.hasPointerCapture(event.pointerId)}));return true})()")
  assert.equal(await assistant.executeJavaScript('document.querySelector("body>header").contains(document.elementFromPoint('+Math.round(headerPoint.x)+','+Math.round(headerPoint.y)+'))'),true,'Native float starts on its visible header')
  assistant.sendInputEvent({type:'mouseMove',x:Math.round(headerPoint.x),y:Math.round(headerPoint.y),globalX:Math.round(global.x),globalY:Math.round(global.y)})
  assistant.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(headerPoint.x),y:Math.round(headerPoint.y),globalX:Math.round(global.x),globalY:Math.round(global.y)})
  await waitFor(async()=>await assistant.executeJavaScript("window.__nativeFloatEvents.some(e=>e.name==='pointerdown'&&e.buttons===1&&e.captured)")?true:null,'float native pointer captured')
  // Native input coordinates belong to the moving WebContents. Recalculate them
  // after each actual View move so the held pointer remains inside that view.
  for(let step=1;step<=4;step++){
    const bounds=agentNative.getBounds(),gx=global.x+dx*step/4,gy=global.y+dy*step/4,x=Math.round(gx-hostOrigin.x-bounds.x),y=Math.round(gy-hostOrigin.y-bounds.y)
    assert.ok(x>=0&&x<bounds.width&&y>=0&&y<bounds.height,'Live drag input remains inside its owning Native View')
    assistant.sendInputEvent({type:'mouseMove',modifiers:['leftbuttondown'],x,y,globalX:Math.round(gx),globalY:Math.round(gy)})
    await waitFor(async()=>{const next=agentNative.getBounds();return (next.x-floatStart.x)*Math.sign(dx)>=Math.abs(dx)*step/4-3&&Math.abs(next.y-floatStart.y)>=Math.abs(dy)*step/4-3?true:null},'float live native move step '+step)
  }
  assert.equal(await assistant.executeJavaScript("window.__nativeFloatEvents.some(e=>e.name==='pointermove'&&e.buttons===1&&e.captured)"),true,'Native held move retains actual pointer capture')
  await waitFor(async()=>{const b=agentNative.getBounds();return (b.x-floatStart.x)*Math.sign(dx)>30&&Math.abs(b.y-floatStart.y)>10?true:null},'Native float moves before mouse release')
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText)
  assistant.sendInputEvent({type:'keyDown',keyCode:'ESC'});assistant.sendInputEvent({type:'keyUp',keyCode:'ESC'})
  await waitFor(async()=>{const b=agentNative.getBounds();return b.x===floatStart.x&&b.y===floatStart.y&&host.contentView.children.includes(agentNative)?true:null},'Escape restores the live float without closing conversation')
  const afterCancel=agentNative.getBounds();assistant.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(global.x-hostOrigin.x-afterCancel.x),y:Math.round(global.y-hostOrigin.y-afterCancel.y),globalX:Math.round(global.x),globalY:Math.round(global.y)})
  await assert.rejects(assistant.executeJavaScript("window.bmwAssistant.setStudioChat({open:true,docked:false,position:{x:0,y:0},owner:{projectId:'foreign-project',sessionId:'foreign-session'}})"),/another Project or Session/)
  assert.deepEqual(agentNative.getBounds(),floatStart)
  fs.writeFileSync(path.join(root,'studio-live-float.json'),JSON.stringify({initial:floatStart,selected:avoidance,resourceRight:resourcesBounds.right,realPointerMoveBeforeRelease:true,escapeRestored:true,foreignOwnerRejected:true},null,2))
  fs.writeFileSync(path.join(root,'studio-selected-float.png'),(await captureRendererEvidence(videoView)).toPNG())
  console.log('PASS Native live Assistant float: selected canvas/resource avoidance, actual movement before release, Escape restoration, immutable owner rejection and unchanged pinned input')
  await assistant.executeJavaScript('window.bmwAssistant.setStudioChat({open:true,docked:false,position:{x:0,y:1}})')
  await waitFor(async()=>{const b=agentNative.getBounds();return b.x<floatStart.x||b.y>floatStart.y?true:null},'native float moved within upper region')
  host.setContentSize(900,700)
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.chatDocked==='true'")?true:null,'compact native window temporarily docks chat')
  await assistant.executeJavaScript("document.getElementById('studio-chat-close').click();true")
  await waitFor(async()=>!host.contentView.children.includes(agentNative)?true:null,'compact close drains presentation')
  host.setContentSize(hostWidth,hostHeight)
  await videoView.executeJavaScript("document.getElementById('studio-chat-launcher').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.chatDocked==='false'")?true:null,'large window restores chosen float after compact close')
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText)
  console.log('PASS native small Assistant float: automatic 320px presentation, task preference stability, reserved playback/properties/timeline, move, compact forced docking and preferred float/input restored after close/resize')
  host.setContentSize(500,700)
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.studioLayout==='compact'&&!document.getElementById('studio-resources-open').hidden&&!document.getElementById('studio-properties-open').hidden")?true:null,'compact responsive entry buttons')
  await videoView.executeJavaScript("document.getElementById('studio-resources-open').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.getElementById('studio-side-drawer').open&&document.getElementById('studio-drawer-body').querySelector('[data-identity=canonical-resources]')&&document.querySelectorAll('#layer-resource-tabs').length===1")?true:null,'same resource DOM in compact drawer')
  await waitFor(async()=>!host.contentView.children.includes(agentNative)?true:null,'original Assistant hidden behind resource drawer')
  assert.equal(await videoView.executeJavaScript("document.querySelectorAll('#studio-side-drawer [data-resource]').length"),4)
  fs.writeFileSync(path.join(root,'studio-resource-drawer.png'),(await captureRendererEvidence(videoView)).toPNG())
  await videoView.executeJavaScript("document.getElementById('studio-properties-open').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.getElementById('studio-drawer-body').querySelector('[data-identity=canonical-properties]')&&document.querySelectorAll('#layer-text').length===1")?true:null,'single drawer switches to canonical properties')
  await videoView.executeJavaScript("document.getElementById('layer-text').focus();document.getElementById('layer-text').value='Resize retains this pending title';document.getElementById('layer-text').dispatchEvent(new Event('input',{bubbles:true}));true")
  fs.writeFileSync(path.join(root,'studio-property-drawer.png'),(await captureRendererEvidence(videoView)).toPNG())
  host.setContentSize(hostWidth,hostHeight)
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.studioLayout==='wide'&&!document.getElementById('studio-side-drawer').open&&document.querySelector('#studio-workspace>[data-identity=canonical-properties]')&&document.querySelector('#studio-workspace>[data-identity=canonical-resources]')")?true:null,'resize returns the original panels to permanent layout')
  assert.equal(await videoView.executeJavaScript("document.getElementById('layer-text').value"),'Resize retains this pending title')
  await videoView.executeJavaScript("document.getElementById('layer-text').dispatchEvent(new Event('change',{bubbles:true}));true")
  await waitFor(async()=>await videoView.executeJavaScript("!document.getElementById('layer-text').disabled&&!document.getElementById('view-toggle').disabled")?true:null,'promoted pending property saved')
  await waitFor(async()=>host.contentView.children.includes(agentNative)?true:null,'same Assistant restored after drawer promotion')
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText)
  console.log('PASS Native responsive drawers: single canonical resource/property DOM, four categories, pending text survives resize, original Native Assistant hidden/restored with unchanged input')
  await assistant.executeJavaScript("document.getElementById('studio-chat-dock').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.chatOpen==='true'&&getComputedStyle(document.getElementById('inspector')).visibility==='hidden'")?true:null,'chat replaces property area')
  fs.writeFileSync(path.join(root,'studio-advanced-before-chat.png'),(await captureRendererEvidence(videoView)).toPNG())
  let geometrySamples=0
  const measured=await waitFor(async()=>{
    const current=await videoView.executeJavaScript("(()=>{const r=document.getElementById('inspector').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()") as {x:number;y:number;width:number;height:number}
    const actual=agentNative.getBounds();if(++geometrySamples===1||geometrySamples===20)console.log('Studio dock diagnostic',current,actual,await videoView.executeJavaScript("({width:innerWidth,height:innerHeight,upper:(()=>{const r=document.getElementById('studio-workspace').getBoundingClientRect();return {top:r.top,bottom:r.bottom}})()})"));return (['x','y','width','height'] as const).every(axis=>Math.abs(actual[axis]-current[axis])<=2)?current:null
  },'Native dock converges to current renderer property area')
  const chatBounds=agentNative.getBounds();for(const axis of ['x','y','width','height'] as const)assert.ok(Math.abs(chatBounds[axis]-measured[axis])<=2,'Native dock must match renderer property area '+axis)
  console.log('Studio measured/native dock',measured,chatBounds)

  assert.equal(await assistant.executeJavaScript("document.getElementById('input').dataset.identity"),'original-composer')
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText)
  assert.equal((await snapshot()).messages.length,messageCount,'Mode and chat layout do not dispatch a model task')
  await assert.rejects(videoView.executeJavaScript("window.bmwStudio.chat({open:true,position:{x:2,y:0}})"),/floating x/)
  assert.throws(()=>handlers.get('video-studio-geometry')!({sender:shell,senderFrame:shell.mainFrame} as Parameters<Parameters<typeof ipcMain.handle>[1]>[0],{top:.1,bottom:.7,propertyWidth:.2,obscured:false}),/owning Studio/)
  await videoView.executeJavaScript("document.getElementById('studio-more').open=true;true")
  await waitFor(async()=>!host.contentView.children.includes(agentNative)?true:null,'Studio menu is not covered by native chat')
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText,'Menu preserves same composer text')
  await videoView.executeJavaScript("document.getElementById('studio-more').open=false;true")
  await waitFor(async()=>host.contentView.children.at(-1)===agentNative?true:null,'Closing menu restores same chat')
  await assistant.executeJavaScript("document.getElementById('studio-chat-close').click();true")
  await waitFor(async()=>!host.contentView.children.includes(agentNative)&&await videoView.executeJavaScript("getComputedStyle(document.getElementById('inspector')).visibility==='visible'")?true:null,'collapse restores object properties')
  await videoView.executeJavaScript("document.getElementById('view-toggle').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='advanced'&&document.getElementById('status').textContent.includes('STUDIO_ADVANCED_REQUIRED')&&!document.getElementById('view-toggle').disabled")?true:null,'independent avoidance object blocks card return')
  await waitFor(async()=>await videoView.executeJavaScript("!!document.getElementById('layer-remove')&&!document.getElementById('layer-remove').disabled")?true:null,'avoidance object removal ready')
  await videoView.executeJavaScript("document.getElementById('layer-remove').click();true")
  await waitFor(async()=>{const state=agentRecord(await videoView.executeJavaScript('window.bmwStudio.state()')),d=agentRecord((state.drafts as unknown[]).find(d=>agentRecord(d).id===pinnedDraftId));return !(d.layers as unknown[]|undefined)?.length&&(d.scenes as unknown[]).every(scene=>!(agentRecord(scene).layers as unknown[]|undefined)?.length)&&await videoView.executeJavaScript("!document.getElementById('view-toggle').disabled")?true:null},'remove avoidance fixture restores compatibility')
  await videoView.executeJavaScript("document.getElementById('view-toggle').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='simple'&&Boolean(document.querySelector('#card-list .studio-card-editor #script-current'))")?true:null,'return to canonical card editor')
  assert.equal(agentNative.getBounds().width,originalWidth,'Sidebar width restored');assert.deepEqual(host.getMinimumSize(),[960,640],'Ordinary workspace restores its native minimum')
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText)
  console.log('PASS real native Studio immersive bounds, measured Assistant docking, same WebContents/input/history, collapse and card roundtrip')
  const cardsRead=async()=>agentRecord(await videoView.executeJavaScript('(async()=>{const state=await window.bmwStudio.state();return state.drafts.find(draft=>draft.id==='+JSON.stringify(pinnedDraftId)+')})()'))
  const beforeCards=await cardsRead();assert.ok(Array.isArray(beforeCards.scenes));const cardOrder=beforeCards.scenes.map(value=>agentRecord(value).id)
  assert.deepEqual(await videoView.executeJavaScript("[...document.querySelectorAll('.studio-card.selected .studio-card-tools button')].map(button=>button.dataset.cardAction)"),['asset','voice'],'Current card exposes only two local detail actions')
  assert.equal(await videoView.executeJavaScript("!!document.querySelector('.studio-card.selected .studio-card-menu [data-card-action=ask]')"),true,'Assistant delegation is a labeled contextual menu action')
  await videoView.executeJavaScript("document.getElementById('inspector').dataset.identity='canonical-inspector';document.querySelector('.studio-card.selected [data-card-action=voice]').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.getElementById('card-detail').open&&Boolean(document.querySelector('#card-detail-body #voice-actions:not([hidden])'))")?true:null,'card voice details')
  assert.equal(await videoView.executeJavaScript("document.querySelector('#card-detail #inspector').dataset.identity"),'canonical-inspector')
  await videoView.executeJavaScript("document.getElementById('card-detail-close').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("!document.getElementById('card-detail').open&&Boolean(document.querySelector('#studio-workspace>#inspector'))")?true:null,'detail restores canonical inspector')
  await videoView.executeJavaScript("document.querySelector('.studio-card.selected [data-card-action=asset]').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.getElementById('card-detail').open&&document.getElementById('card-detail-title').textContent.includes('更换')")?true:null,'card replacement details')
  assert.equal(await videoView.executeJavaScript("Boolean(document.querySelector('#card-detail #stage-content'))&&document.querySelector('#card-detail #preparation-workspace').hidden"),true,'Matching drawer stays matching rather than reopening preparation')
  await videoView.executeJavaScript("document.getElementById('card-detail-close').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("!document.getElementById('card-detail').open")?true:null,'replacement detail closed')
  await videoView.executeJavaScript("document.querySelector('.studio-card.selected [data-card-action=duplicate]').click();true")
  await waitFor(async()=>{const value=await cardsRead();return Array.isArray(value.scenes)&&value.scenes.length===3&&await videoView.executeJavaScript("!document.getElementById('undo').disabled")?true:null},'card duplicate saved')
  const duplicated=await cardsRead();assert.ok(Array.isArray(duplicated.scenes));assert.equal(new Set(duplicated.scenes.map(value=>agentRecord(value).id)).size,3)
  await videoView.executeJavaScript("document.getElementById('undo').click();true")
  await waitFor(async()=>{const value=await cardsRead();return Array.isArray(value.scenes)&&value.scenes.length===2&&await videoView.executeJavaScript("!document.getElementById('draft-title').disabled")?true:null},'card duplicate undone')
  const restoredCards=await cardsRead();assert.ok(Array.isArray(restoredCards.scenes));assert.deepEqual(restoredCards.scenes.map(value=>agentRecord(value).id),cardOrder)
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText)
  // The canonical card handle uses PointerEvents; obsolete synthetic HTML5 drops no longer exercise it.
  host.show();host.focus();videoView.focus()
  await videoView.executeJavaScript(`document.querySelector('[data-drag-scene="'+${JSON.stringify(cardOrder[1])}+'"]').scrollIntoView({block:'nearest'});true`)
  const pointer=await waitFor(async()=>await videoView.executeJavaScript(`(()=>{const h=document.querySelector('[data-drag-scene="'+${JSON.stringify(cardOrder[1])}+'"]'),t=document.querySelector('[data-card-id="'+${JSON.stringify(cardOrder[0])}+'"]'),a=h.getBoundingClientRect(),b=t.getBoundingClientRect(),x=Math.round(a.x+a.width/2),y=Math.round(a.y+a.height/2),tx=Math.round(b.x+b.width/2),ty=Math.round(Math.max(4,b.y+12));return document.elementFromPoint(x,y)?.closest('[data-drag-scene]')===h&&document.elementFromPoint(tx,ty)?.closest('[data-card-id]')===t?{x,y,tx,ty}:null})()`),'card handle and insertion target painted') as {x:number;y:number;tx:number;ty:number}
  videoView.sendInputEvent({type:'mouseMove',x:pointer.x,y:pointer.y})
  videoView.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:pointer.x,y:pointer.y})
  videoView.sendInputEvent({type:'mouseMove',modifiers:['leftbuttondown'],x:pointer.x+8,y:pointer.y})
  await waitFor(async()=>await videoView.executeJavaScript("document.body.classList.contains('studio-card-sorting')")?true:null,'native card pointer admitted')
  videoView.sendInputEvent({type:'mouseMove',modifiers:['leftbuttondown'],x:pointer.tx,y:pointer.ty})
  await waitFor(async()=>await videoView.executeJavaScript(`document.querySelector('[data-card-id="'+${JSON.stringify(cardOrder[0])}+'"]').classList.contains('sort-before')`)?true:null,'native card insertion marker')
  assert.deepEqual(agentRecord(await cardsRead()).revision,restoredCards.revision,'Pointer movement must not commit before release')
  videoView.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:pointer.tx,y:pointer.ty})
  await waitFor(async()=>{const d=await cardsRead();return Array.isArray(d.scenes)&&agentRecord(d.scenes[0]).id===cardOrder[1]&&await videoView.executeJavaScript("!document.getElementById('undo').disabled&&!document.getElementById('draft-title').disabled")?true:null},'canonical native card move persists reordered identities')
  assert.equal((await cardsRead()).revision,Number(restoredCards.revision)+1,'One card gesture saves one revision')
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText,'Card reordering preserves the same Assistant input')
  await videoView.executeJavaScript("document.getElementById('undo').click();true")
  await waitFor(async()=>{const d=await cardsRead();return Array.isArray(d.scenes)&&agentRecord(d.scenes[0]).id===cardOrder[0]&&await videoView.executeJavaScript("!document.getElementById('draft-title').disabled")?true:null},'card reorder undo restores original identity order')
  console.log('PASS native cards: local details, labeled Assistant menu, canonical Inspector/materials, duplicate, actual pointer insertion/release, one revision, undo and unchanged Assistant input')
  const longCreated=assertVideoDraft(await videoView.executeJavaScript(`window.bmwStudio.command(${JSON.stringify(initial.project.id)},{operation:'create',title:'二十四镜头中文布局验收'})`))
  const longDraft=structuredClone(longCreated),longText='用真实资料说明产品价值，保持可读的脚本与可核查的画面；编辑时保留旁白、字幕与当前选择。'.repeat(10)
  longDraft.scenes=Array.from({length:24},(_,i)=>({...newStudioScene('long-scene-'+i,'第 '+(i+1)+' 镜：中文长标题与完整脚本'),durationSeconds:6,narration:longText}))
  await videoView.executeJavaScript(`window.bmwStudio.command(${JSON.stringify(initial.project.id)},{operation:'update',draftId:${JSON.stringify(longDraft.id)},expectedRevision:${longDraft.revision},draft:${JSON.stringify(longDraft)}})`)
  await waitFor(async()=>await videoView.executeJavaScript(`[...document.getElementById('draft-select').options].some(o=>o.value===${JSON.stringify(longDraft.id)})`)?true:null,'long draft list refreshed')
  await videoView.executeJavaScript(`document.getElementById('draft-select').value=${JSON.stringify(longDraft.id)};document.getElementById('draft-select').dispatchEvent(new Event('change'));true`)
  await waitFor(async()=>await videoView.executeJavaScript("document.querySelectorAll('#card-list .studio-card').length===24&&document.getElementById('cards-add').disabled")?true:null,'all 24 canonical cards render with scene limit')
  const longLayout=await videoView.executeJavaScript(`(()=>{const cards=document.getElementById('card-workspace'),list=document.getElementById('card-list'),preview=document.querySelector('.center');cards.scrollTop=cards.scrollHeight;return {count:list.children.length,oneScript:document.querySelectorAll('#script-current').length,scrollable:cards.scrollHeight>cards.clientHeight,cardWidth:cards.clientWidth,contentWidth:cards.scrollWidth,previewWidth:preview.getBoundingClientRect().width,fullText:document.querySelector('.studio-card:not(.selected) .studio-card-script').textContent===${JSON.stringify(longText)}}})()`) as {count:number;oneScript:number;scrollable:boolean;cardWidth:number;contentWidth:number;previewWidth:number;fullText:boolean}
  assert.equal(longLayout.count,24);assert.equal(longLayout.oneScript,1);assert.equal(longLayout.scrollable,true);assert.equal(longLayout.fullText,true);assert.ok(longLayout.contentWidth<=longLayout.cardWidth+1);assert.ok(longLayout.previewWidth>=220)
  const resetPreview=await videoView.executeJavaScript("(()=>{const canvas=document.getElementById('preview');return {placeholder:!document.getElementById('preview-empty').hidden,time:document.getElementById('time').textContent,seek:document.getElementById('seek').value,pixel:[...canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data]}})()") as {placeholder:boolean;time:string;seek:string;pixel:number[]}
  assert.equal(resetPreview.placeholder,true,'New draft never displays the previous film as its preview');assert.equal(resetPreview.time,'00:00 / 00:00');assert.equal(resetPreview.seek,'0');assert.deepEqual(resetPreview.pixel.slice(0,3),[0,0,0],'Foreign draft pixels are cleared')
  fs.writeFileSync(path.join(root,'studio-draft-preview-reset.json'),JSON.stringify(resetPreview,null,2))
  fs.writeFileSync(path.join(root,'studio-long-cards.json'),JSON.stringify(longLayout,null,2));fs.writeFileSync(path.join(root,'studio-long-cards.png'),(await captureRendererEvidence(videoView)).toPNG())
  await videoView.executeJavaScript(`document.getElementById('draft-select').value=${JSON.stringify(pinnedDraftId)};document.getElementById('draft-select').dispatchEvent(new Event('change'));true`)
  await waitFor(async()=>await videoView.executeJavaScript("document.querySelectorAll('#card-list .studio-card').length===2&&!document.getElementById('draft-title').disabled")?true:null,'original card draft restored')
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText)
  const lifecycle=await videoView.executeJavaScript(`(async()=>{
    const {StudioPreview}=await import('./studio-preview.js'),canvas=document.createElement('canvas');
    let release,started;const gate=new Promise(resolve=>{release=resolve}),loading=new Promise(resolve=>{started=resolve});
    const preview=new StudioPreview(canvas,async()=>{started();await gate;return new Uint8Array()},()=>{});
    const next=${JSON.stringify({...longDraft,scenes:[{...longDraft.scenes[0],narration:'',title:'当前预览'}]})},old=structuredClone(next);old.id='previous-preview';old.scenes[0].imageArtifactId='delayed-image';
    const first=preview.prepare(old);await loading;let drained=false;
    const second=preview.prepare(next),cleanup=preview.dispose().then(()=>{drained=true});
    await new Promise(resolve=>setTimeout(resolve,30));const held=!drained;release();
    const cancelled=await Promise.all([first,second]);await cleanup;
    const ready=await preview.prepare(next),duration=preview.duration;await preview.dispose();
    return {held,cancelled,ready,duration,clearedDuration:preview.duration};
  })()` ) as {held:boolean;cancelled:boolean[];ready:boolean;duration:number;clearedDuration:number}
  assert.equal(lifecycle.held,true,'Preview cleanup waits for actual in-flight asset loading');assert.deepEqual(lifecycle.cancelled,[false,false],'Superseded previews cannot report ready');assert.equal(lifecycle.ready,true);assert.equal(lifecycle.duration,6);assert.equal(lifecycle.clearedDuration,0)
  fs.writeFileSync(path.join(root,'studio-preview-lifecycle.json'),JSON.stringify(lifecycle,null,2))
  console.log('PASS real renderer preview lifecycle: drain pending loads, reject cancelled readiness, preserve next preparation, clear draft pixels/time')
  console.log('PASS 24-scene CJK card layout: complete long script, one canonical editor, independently scrollable cards, no card overflow, usable preview and same unsent Assistant request')

  await videoView.executeJavaScript("document.getElementById('confirm-stages').click();true")
  await waitFor(async()=>agentRecord(await assistant.executeJavaScript('window.bmwAssistant.composerContext()')).view&&agentRecord(agentRecord(await assistant.executeJavaScript('window.bmwAssistant.composerContext()')).view).confirmStages===true?true:null,'confirmation preference Host context')
  assert.equal(await assistant.executeJavaScript('document.documentElement.dataset.sessionId'),initial.selectedSessionId)
  assert.equal(agentRecord(await assistant.executeJavaScript('window.bmwAssistant.setWorkspaceMode("browser")')).mode,'browser')
  const tabs = await shell.executeJavaScript('window.bmw.browser({action:"tabs.list"})')
  assert.ok(tabs.tabs.some((tab: { url: string }) => tab.url === pageUrl + '/'))
  await assistant.executeJavaScript('window.bmwAssistant.setWorkspaceMode("studio")')
  await assert.rejects(assistant.executeJavaScript('window.bmwAssistant.sendStudioPrompt('+JSON.stringify({text:'hold',target:{projectId:'foreign',sessionId:initial.selectedSessionId,draftId:pinnedDraftId,kind:'scene',sceneId:pinnedSceneId}})+')'),/another Project or Session/)
  assert.equal((await snapshot()).messages.length,messageCount,'Rejected scopes do not dispatch input')
  await assert.rejects(assistant.executeJavaScript('window.bmwAssistant.sendStudioPrompt('+JSON.stringify({text:'hold',target:{projectId:initial.project.id,sessionId:initial.selectedSessionId,draftId:pinnedDraftId,kind:'scene',sceneId:'deleted-scene'}})+')'),/pinned scene was deleted/)
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),pinnedText,'Rejected target preserves unsent input')
  await assistant.executeJavaScript("document.getElementById('composer').requestSubmit();true")
  await waitFor(async () => (await snapshot()).busy ? true : null, 'active Host')
  assert.match(latestRequest!.context,/stop for explicit user confirmation/,'Stage preference is frozen in the admitted run context')
  const frozen=latestRequest!.context.split('User-selected edit target (frozen data): ')[1]?.split('\n')[0]
  assert.ok(frozen);assert.equal(agentRecord(JSON.parse(frozen)).sceneId,pinnedSceneId,'Provider receives the first typed scene, not the latest selected scene')
  await waitFor(async()=>await assistant.executeJavaScript("document.getElementById('input').value===''")?true:null,'successful scoped submission clears text')
  console.log('PASS first-input pinned target, selection changes and layout roundtrip, invalid owner/deleted target, actual scoped submission')
  await waitFor(async()=>await videoView.executeJavaScript("!document.getElementById('studio-task').hidden&&!document.getElementById('task-stop').hidden")?true:null,'Studio receives actual Host activity')
  await assert.rejects(shell.executeJavaScript('window.bmw.createProject({name:"must not switch",homeUrl:""})'), /Stop and drain/)
  await assert.rejects(assistant.executeJavaScript('window.bmwAssistant.invoke({action:"session.create"})'), /Stop and drain/)
  await videoView.executeJavaScript('window.bmwStudio.cancelTask()')
  assert.equal((await snapshot()).busy, false)
  // Real independent GUI targets use exact layer IDs; no new Agent loop or fixture-only IPC.
  const wav=Buffer.alloc(44+48000*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(96000,40)
  for(let i=0;i<48000;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/48000)*1000),44+i*2)
  fs.writeFileSync(path.join(projects.active().directory,'artifacts','scope-tone.wav'),wav)
  await videoView.executeJavaScript("document.getElementById('reload').click();true")
  await waitFor(async()=>{const state=agentRecord(await videoView.executeJavaScript('window.bmwStudio.state()'));return Array.isArray(state.assets)&&state.assets.some(a=>agentRecord(a).artifactId==='scope-tone.wav')?true:null},'real Project audio available')
  await videoView.executeJavaScript("document.getElementById('view-toggle').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='advanced'&&!document.getElementById('draft-title').disabled")?true:null,'advanced target editor')
  await videoView.executeJavaScript("document.querySelector('[data-resource=elements]').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("Boolean(document.getElementById('layer-add-text'))")?true:null,'text resource')
  await videoView.executeJavaScript("document.getElementById('layer-add-scope').value='scene';document.getElementById('layer-add-text').click();true")
  const localContext=await waitFor(async()=>{const ctx=agentRecord(await assistant.executeJavaScript('window.bmwAssistant.composerContext()')),selection=agentRecord(ctx.selection);return selection.layer&&selection.sceneId?ctx:null},'exact local visual selection')
  const localSelection=agentRecord(localContext.selection),localLayer=agentRecord(localSelection.layer)
  const localTarget={projectId:initial.project.id,sessionId:initial.selectedSessionId,draftId:pinnedDraftId,kind:'object',sceneId:localSelection.sceneId,layer:{id:localLayer.id,kind:'visual'}}
  const layerMessages=(await snapshot()).messages.length
  await videoView.executeJavaScript("document.getElementById('layer-ask').click();true")
  await waitFor(async()=>await assistant.executeJavaScript("document.getElementById('input').value.includes("+JSON.stringify(String(localLayer.id))+")&&document.getElementById('studio-scope').textContent.includes('已固定')")?true:null,'object shortcut prefills owned composer')
  assert.equal((await snapshot()).messages.length,layerMessages,'Object prefill does not admit a model run')
  await assistant.executeJavaScript("document.getElementById('input').value='hold';document.getElementById('input').dispatchEvent(new Event('input'));true")
  const localPinnedLabel=await assistant.executeJavaScript("document.getElementById('studio-scope').textContent")
  await waitFor(async()=>await videoView.executeJavaScript("!document.querySelector('[data-resource=audio]').disabled")?true:null,'audio category ready after local save')
  await videoView.executeJavaScript("document.querySelector('[data-resource=audio]').click();true")
  console.log('Audio resource entry snapshot',await videoView.executeJavaScript("(async()=>({status:document.getElementById('status').textContent,mode:document.body.dataset.view,active:document.querySelector('[data-resource=audio]').getAttribute('aria-pressed'),resource:document.getElementById('layer-resource-content').textContent,asset:(await window.bmwStudio.state()).assets.find(a=>a.artifactId==='scope-tone.wav')}))()"))
  await waitFor(async()=>await videoView.executeJavaScript("Boolean(document.querySelector('[data-layer-asset=\"scope-tone.wav\"]'))")?true:null,'real audio resource')
  await videoView.executeJavaScript("document.getElementById('layer-add-scope').value='film';document.querySelector('[data-layer-asset=\"scope-tone.wav\"]').click();true")
  const audioContext=await waitFor(async()=>{const ctx=agentRecord(await assistant.executeJavaScript('window.bmwAssistant.composerContext()')),selection=agentRecord(ctx.selection);return selection.layer&&agentRecord(selection.layer).kind==='audio'&&!selection.sceneId?ctx:null},'exact global audio selection')
  const audioLayer=agentRecord(agentRecord(audioContext.selection).layer)
  assert.equal(agentRecord(audioContext.object).scope,'film');assert.equal(agentRecord(audioContext.object).id,audioLayer.id)
  await videoView.executeJavaScript("document.getElementById('layer-ask').click();true")
  await new Promise(resolve=>setTimeout(resolve,80))
  assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),'hold');assert.equal(await assistant.executeJavaScript("document.getElementById('studio-scope').textContent"),localPinnedLabel,'New audio selection and shortcut cannot retarget existing text')
  const badTargets=[{...localTarget,layer:{id:localLayer.id,kind:'audio'}},{...localTarget,sceneId:undefined},{...localTarget,layer:{id:'deleted-object',kind:'visual'}}]
  for(const target of badTargets)await assert.rejects(assistant.executeJavaScript('window.bmwAssistant.sendStudioPrompt('+JSON.stringify({text:'hold',target})+')'),/已删除/)
  assert.equal((await snapshot()).messages.length,layerMessages,'Deleted/wrong-container/wrong-kind objects reject before Host receipt')
  await assistant.executeJavaScript("document.getElementById('composer').requestSubmit();true")
  await waitFor(async()=>(await snapshot()).busy?true:null,'local object Host run')
  let frozenLayer=agentRecord(JSON.parse(latestRequest!.context.split('User-selected edit target (frozen data): ')[1].split('\n')[0]));assert.deepEqual(frozenLayer,localTarget)
  assert.match(latestRequest!.context,/"scope":"scene"/)
  await videoView.executeJavaScript('window.bmwStudio.cancelTask()');assert.equal((await snapshot()).busy,false)
  await waitFor(async()=>await assistant.executeJavaScript("document.getElementById('input').value===''")?true:null,'local run input cleared')
  // First typing now binds the global audio object even without a scene ID.
  await assistant.executeJavaScript("document.getElementById('input').value='hold';document.getElementById('input').dispatchEvent(new Event('input'));true")
  const globalPinnedLabel=await assistant.executeJavaScript("document.getElementById('studio-scope').textContent");assert.match(String(globalPinnedLabel),/音轨.*已固定/)
  await videoView.executeJavaScript("document.getElementById('view-toggle').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='advanced'&&document.getElementById('status').textContent.includes('STUDIO_ADVANCED_REQUIRED')&&!document.getElementById('view-toggle').disabled")?true:null,'global audio target blocks card return')
  assert.equal(await assistant.executeJavaScript("document.getElementById('studio-scope').textContent"),globalPinnedLabel)
  await assistant.executeJavaScript("document.getElementById('composer').requestSubmit();true")
  await waitFor(async()=>(await snapshot()).busy?true:null,'global audio Host run')
  frozenLayer=agentRecord(JSON.parse(latestRequest!.context.split('User-selected edit target (frozen data): ')[1].split('\n')[0]));assert.deepEqual(frozenLayer.layer,{id:audioLayer.id,kind:'audio'});assert.equal(frozenLayer.sceneId,undefined)
  assert.match(latestRequest!.context,/"scope":"film"/)
  await videoView.executeJavaScript('window.bmwStudio.cancelTask()');assert.equal((await snapshot()).busy,false)
  console.log('PASS exact independent Assistant scope: local visual and global measured audio IDs, bounded object context, prefill-only shortcut, existing input protection, guarded card return, wrong-kind/container/deleted rejection and real frozen Host submission')

  // Main narration pieces pin the same exact identity through the original composer/Host.
  let voiceDraft=assertVideoDraft(await videoView.executeJavaScript(`window.bmwStudio.command(${JSON.stringify(initial.project.id)},{operation:'create',title:'Exact narration piece scope'})`))
  voiceDraft.scenes=[{...newStudioScene('scope-voice','旁白范围'),durationSeconds:2,narration:'短旁白',bullets:['旁白片段']}]
  voiceDraft=assertVideoDraft(await videoView.executeJavaScript(`window.bmwStudio.command(${JSON.stringify(initial.project.id)},${JSON.stringify({operation:'update',draftId:voiceDraft.id,expectedRevision:voiceDraft.revision,draft:voiceDraft})})`))
  voiceDraft=assertVideoDraft(await videoView.executeJavaScript(`window.bmwStudio.command(${JSON.stringify(initial.project.id)},${JSON.stringify({operation:'attach',draftId:voiceDraft.id,expectedRevision:voiceDraft.revision,sceneId:'scope-voice',artifactId:'scope-tone.wav',assetKind:'audio'})})`))
  await waitFor(async()=>await videoView.executeJavaScript(`[...document.getElementById('draft-select').options].some(o=>o.value===${JSON.stringify(voiceDraft.id)})`)?true:null,'voice scope draft listed')
  await videoView.executeJavaScript(`document.getElementById('draft-select').value=${JSON.stringify(voiceDraft.id)};document.getElementById('draft-select').dispatchEvent(new Event('change'));true`)
  await waitFor(async()=>await videoView.executeJavaScript('document.getElementById("draft-title").value==='+JSON.stringify(voiceDraft.title)+'&&!document.getElementById("view-toggle").disabled')?true:null,'voice scope draft selection settled')
  if(await videoView.executeJavaScript("document.body.dataset.view==='simple'"))await videoView.executeJavaScript("document.getElementById('view-toggle').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='advanced'&&!document.getElementById('view-toggle').disabled&&!document.getElementById('seek').disabled&&!!document.querySelector('#timeline-voice [data-main-kind]')&&!document.querySelector('#timeline-voice [data-main-kind]').disabled")?true:null,'voice scope timeline active')
  await videoView.executeJavaScript("document.querySelector('#timeline-voice [data-main-kind]').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("!!document.getElementById('main-voice-start')&&!document.getElementById('main-voice-start').disabled&&!document.getElementById('seek').disabled")?true:null,'voice scope original props')
  await videoView.executeJavaScript("document.getElementById('seek').value='1';document.getElementById('seek').dispatchEvent(new Event('input'));true")
  await waitFor(async()=>await videoView.executeJavaScript("Number(document.getElementById('seek').value)===1&&!document.getElementById('timeline-split').disabled")?true:null,'voice scope split position')
  await videoView.executeJavaScript("document.getElementById('timeline-split').click();true")
  const voiceContext=await waitFor(async()=>{const ctx=agentRecord(await assistant.executeJavaScript('window.bmwAssistant.composerContext()')),selection=agentRecord(ctx.selection);return typeof selection.voiceSegmentId==='string'?ctx:null},'exact voice piece context')
  const voiceSelection=agentRecord(voiceContext.selection),voiceObject=agentRecord(voiceContext.object),voiceTarget={projectId:initial.project.id,sessionId:initial.selectedSessionId,draftId:voiceDraft.id,kind:'object',sceneId:'scope-voice',objectKind:'voice',voiceSegmentId:voiceSelection.voiceSegmentId}
  assert.equal(voiceObject.id,voiceTarget.voiceSegmentId);assert.equal(voiceObject.category,'audio');assert.equal(voiceObject.durationSeconds,.5)
  await assistant.executeJavaScript("document.getElementById('input').value='hold';document.getElementById('input').dispatchEvent(new Event('input'));true")
  const voiceLabel=await assistant.executeJavaScript("document.getElementById('studio-scope').textContent");assert.match(String(voiceLabel),/旁白.*片段 2.*已固定/)
  await videoView.executeJavaScript("document.querySelector('#timeline-voice [data-voice-segment-id]').click();true")
  assert.equal(await assistant.executeJavaScript("document.getElementById('studio-scope').textContent"),voiceLabel)
  assert.equal(await videoView.executeJavaScript("Number(document.getElementById('seek').value)"),1,'Voice piece selection does not seek the playhead')
  await videoView.executeJavaScript("document.getElementById('view-toggle').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='simple'")?true:null,'voice scope card roundtrip')
  assert.equal(await assistant.executeJavaScript("document.getElementById('studio-scope').textContent"),voiceLabel)
  const beforeVoiceMessages=(await snapshot()).messages.length
  for(const target of [{...voiceTarget,voiceSegmentId:'deleted-voice-piece'},{...voiceTarget,objectKind:'captions'},{...voiceTarget,sceneId:pinnedSceneId},{...voiceTarget,layer:{id:audioLayer.id,kind:'audio'}}])await assert.rejects(assistant.executeJavaScript('window.bmwAssistant.sendStudioPrompt('+JSON.stringify({text:'hold',target})+')'))
  assert.equal((await snapshot()).messages.length,beforeVoiceMessages);assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),'hold')
  await assistant.executeJavaScript("document.getElementById('composer').requestSubmit();true")
  await waitFor(async()=>(await snapshot()).busy?true:null,'exact voice Host run')
  const frozenVoice=agentRecord(JSON.parse(latestRequest!.context.split('User-selected edit target (frozen data): ')[1].split('\n')[0]));assert.deepEqual(frozenVoice,voiceTarget)
  assert.match(latestRequest!.context,/"kind":"voice"/);await videoView.executeJavaScript('window.bmwStudio.cancelTask()');assert.equal((await snapshot()).busy,false)
  console.log('PASS exact main narration Assistant scope: real GUI split, right-piece identity, first-input pin, selection/card roundtrip, wrong-kind/container/deleted rejection and frozen Host receipt')
  const scopePNG=await videoView.executeJavaScript("(()=>{const c=document.createElement('canvas');c.width=64;c.height=36;const x=c.getContext('2d');x.fillStyle='#b34a35';x.fillRect(0,0,64,36);return c.toDataURL('image/png').split(',')[1]})()") as string
  fs.writeFileSync(path.join(projects.active().directory,'artifacts','scope-frame.png'),Buffer.from(scopePNG,'base64'))
  let visualDraft=assertVideoDraft(await videoView.executeJavaScript('window.bmwStudio.command('+JSON.stringify(initial.project.id)+',{operation:"create",title:"Exact main visual scope"})'))
  visualDraft.scenes=[{...newStudioScene('scope-visual','画面范围'),durationSeconds:2,visualSegments:[{id:'left-frame',imageArtifactId:'scope-frame.png',durationSeconds:1,sourceStartSeconds:0,playbackRate:1,zoom:1,keepSourceAudio:false,sourceVolume:1,transition:'cut',transitionSeconds:.3},{id:'right_frame',imageArtifactId:'scope-frame.png',durationSeconds:1,sourceStartSeconds:0,playbackRate:1,zoom:1,keepSourceAudio:false,sourceVolume:1,transition:'cut',transitionSeconds:.3}]}]
  visualDraft=assertVideoDraft(await videoView.executeJavaScript('window.bmwStudio.command('+JSON.stringify(initial.project.id)+','+JSON.stringify({operation:'update',draftId:visualDraft.id,expectedRevision:visualDraft.revision,draft:visualDraft})+')'))
  await waitFor(async()=>await videoView.executeJavaScript('[...document.getElementById("draft-select").options].some(o=>o.value==='+JSON.stringify(visualDraft.id)+')')?true:null,'visual scope draft listed')
  await videoView.executeJavaScript('document.getElementById("draft-select").value='+JSON.stringify(visualDraft.id)+';document.getElementById("draft-select").dispatchEvent(new Event("change"));true')
  await waitFor(async()=>await videoView.executeJavaScript("!document.getElementById('view-toggle').disabled")?true:null,'visual scope switch ready')
  await videoView.executeJavaScript("document.getElementById('view-toggle').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='advanced'&&!document.getElementById('view-toggle').disabled&&!document.getElementById('seek').disabled")?true:null,'visual scope prepared timeline')
  await videoView.executeJavaScript("document.querySelectorAll('#timeline-visuals [data-visual-segment-id]')[1].click();true")
  const visualContext=await waitFor(async()=>{const ctx=agentRecord(await assistant.executeJavaScript('window.bmwAssistant.composerContext()'));return agentRecord(ctx.selection).visualSegmentId==='right_frame'?ctx:null},'exact main visual context')
  assert.equal(agentRecord(visualContext.object).id,'right_frame');assert.equal(agentRecord(visualContext.object).startSeconds,1)
  const visualTarget={projectId:initial.project.id,sessionId:initial.selectedSessionId,draftId:visualDraft.id,kind:'object',sceneId:'scope-visual',objectKind:'visual',visualSegmentId:'right_frame'}
  await assistant.executeJavaScript("document.getElementById('input').value='hold';document.getElementById('input').dispatchEvent(new Event('input'));true")
  const visualLabel=await assistant.executeJavaScript("document.getElementById('studio-scope').textContent");assert.match(String(visualLabel),/画面.*片段 2.*已固定/)
  await videoView.executeJavaScript("document.querySelector('#timeline-visuals [data-visual-segment-id]').click();true")
  assert.equal(await assistant.executeJavaScript("document.getElementById('studio-scope').textContent"),visualLabel)
  const visualMessages=(await snapshot()).messages.length
  for(const target of [{...visualTarget,visualSegmentId:'deleted-frame'},{...visualTarget,objectKind:'voice'},{...visualTarget,sceneId:'scope-voice'},{...visualTarget,voiceSegmentId:voiceTarget.voiceSegmentId},{...visualTarget,layer:{id:audioLayer.id,kind:'audio'}}])await assert.rejects(assistant.executeJavaScript('window.bmwAssistant.sendStudioPrompt('+JSON.stringify({text:'hold',target})+')'))
  assert.equal((await snapshot()).messages.length,visualMessages);assert.equal(await assistant.executeJavaScript("document.getElementById('input').value"),'hold')
  await videoView.executeJavaScript("document.getElementById('view-toggle').click();true")
  await waitFor(async()=>await videoView.executeJavaScript("document.body.dataset.view==='simple'&&!document.getElementById('view-toggle').disabled")?true:null,'visual scope card roundtrip')
  assert.equal(await assistant.executeJavaScript("document.getElementById('studio-scope').textContent"),visualLabel)
  await assistant.executeJavaScript("document.getElementById('composer').requestSubmit();true")
  await waitFor(async()=>(await snapshot()).busy?true:null,'exact visual Host run')
  const frozenVisual=agentRecord(JSON.parse(latestRequest!.context.split('User-selected edit target (frozen data): ')[1].split('\n')[0]));assert.deepEqual(frozenVisual,visualTarget);assert.match(latestRequest!.context,/"kind":"visual"/)
  await videoView.executeJavaScript('window.bmwStudio.cancelTask()');assert.equal((await snapshot()).busy,false)
  console.log('PASS exact main visual Assistant scope: actual Project image, stable right piece, first-input pin, selection/cards, invalid scope rejection and frozen Host receipt')


  const sessions=agentRecord(await shell.executeJavaScript('window.bmw.listAgentSessions()'))
  assert.ok(Array.isArray(sessions.items)&&sessions.items.every(row=>agentRecord(row).canFork===false))
  await closeApplication('PASS owned BMW Assistant: Project browser/image/Studio ownership, mode switching, sandbox IPC, capability controls, cancellation and awaited native shutdown')
} catch (error: unknown) { exitCode = 1; console.error(error) }
finally { if(exitCode){finishClose();clearTimeout(watchdog);server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));app.exit(exitCode)} }

}
void run()
