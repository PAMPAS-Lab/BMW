import {requireCurrentAgentData} from '../packages/platform/src/agent-data-format.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { app, ipcMain, webContents,dialog,BrowserWindow } from 'electron'
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
    console.log('PASS Assistant startup '+startupKind+' retry preserves identities and recovers delivery without replay')
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
    await assistant.executeJavaScript('document.getElementById("agent-refresh").click()')
    await waitFor(async()=>settingsRefreshes===2&&(await snapshot()).settings?.phase==='idle'&&!(await snapshot()).busy?true:null,'explicit authentication refresh')
    await waitFor(async()=>await assistant.executeJavaScript('!document.getElementById("agent-model-refresh").disabled')?true:null,'model refresh control ready after state publication')
    await assistant.executeJavaScript('document.getElementById("agent-model-refresh").click()')
    await waitFor(async()=>settingsRefreshes===3&&(await snapshot()).settings?.phase==='idle'&&!(await snapshot()).busy?true:null,'explicit model refresh')
    console.log('Settings UI: cached views and both explicit refresh entries; checking compact dialog')
    const window=BrowserWindow.getAllWindows()[0],originalSize=window.getSize();window.setSize(840,560)
    await waitFor(async()=>await assistant.executeJavaScript('(()=>{const r=document.getElementById("agent-settings").getBoundingClientRect(),b=document.getElementById("agent-settings-close").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&b.bottom<=innerHeight})()')?true:null,'compact settings fitting')
    fs.writeFileSync(path.join(root,'assistant-settings.png'),(await assistant.capturePage()).toPNG())
    await shell.executeJavaScript('window.bmw.updateGlobalSettings({theme:"light"})')
    await waitFor(async()=>await assistant.executeJavaScript('matchMedia("(prefers-color-scheme: light)").matches&&getComputedStyle(document.documentElement).backgroundColor==="rgb(247, 249, 252)"')?true:null,'Assistant follows BMW light theme')
    fs.writeFileSync(path.join(root,'assistant-settings-light.png'),(await assistant.capturePage()).toPNG())
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
      await assistant.executeJavaScript('document.getElementById("driver").value='+JSON.stringify(id)+';document.getElementById("driver").dispatchEvent(new Event("change"))')
      await waitFor(async()=>{const state=await snapshot();return state.driverId===id&&state.settings&&state.settings.phase!=='working'&&!state.busy?state:null},'automatic driver settings refresh '+id)
      await waitFor(async()=>await assistant.executeJavaScript('document.getElementById("agent-settings-driver").value==='+JSON.stringify(id)+'&&!document.getElementById("agent-settings-driver").disabled&&!document.getElementById("agent-refresh").disabled')?true:null,'driver settings view ready '+id)
    }
    await chooseDriver('fixture')
    assert.equal((await snapshot()).settings?.value,null,'Cancelled authentication cannot restore cached ready state')
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
  assert.equal(await assistant.executeJavaScript('document.documentElement.dataset.sessionId'),initial.selectedSessionId)
  assert.equal(agentRecord(await assistant.executeJavaScript('window.bmwAssistant.setWorkspaceMode("browser")')).mode,'browser')
  const tabs = await shell.executeJavaScript('window.bmw.browser({action:"tabs.list"})')
  assert.ok(tabs.tabs.some((tab: { url: string }) => tab.url === pageUrl + '/'))
  await assistant.executeJavaScript('window.bmwAssistant.invoke({action:"message.send",sessionId:' + JSON.stringify(initial.selectedSessionId) + ',text:"hold"})')
  await waitFor(async () => (await snapshot()).busy ? true : null, 'active Host')
  await assert.rejects(shell.executeJavaScript('window.bmw.createProject({name:"must not switch",homeUrl:""})'), /Stop and drain/)
  await assert.rejects(assistant.executeJavaScript('window.bmwAssistant.invoke({action:"session.create"})'), /Stop and drain/)
  await assistant.executeJavaScript('window.bmwAssistant.invoke({action:"message.cancel",sessionId:' + JSON.stringify(initial.selectedSessionId) + '})')
  assert.equal((await snapshot()).busy, false)
  const sessions=agentRecord(await shell.executeJavaScript('window.bmw.listAgentSessions()'))
  assert.ok(Array.isArray(sessions.items)&&sessions.items.every(row=>agentRecord(row).canFork===false))
  app.quit()
  await closing
  await new Promise(resolve=>setTimeout(resolve,100))
  assert.equal(willQuit,false,'Application quit must wait for actual native cleanup')
  app.once('will-quit',()=>{
    clearTimeout(watchdog);server.closeAllConnections();server.close()
    console.log('PASS owned BMW Assistant: Project browser/image/Studio ownership, mode switching, sandbox IPC, capability controls, cancellation and awaited native shutdown')
    app.exit(0)
  })
  finishClose()
} catch (error: unknown) { exitCode = 1; console.error(error) }
finally { if(exitCode){finishClose();clearTimeout(watchdog);server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));app.exit(exitCode)} }

}
void run()
