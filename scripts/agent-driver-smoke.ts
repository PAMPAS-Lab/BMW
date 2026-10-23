import {requireCurrentAgentData} from '../packages/platform/src/agent-data-format.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createFixtureBrowserClient,fixtureRecord} from './fixture-browser-client.js'
import {app,webContents,ipcMain} from 'electron'
import type {AgentBackend,AgentRunRequest} from '@bmw-agent/agent-contract'
import {assistantPagePath,assistantPreloadPath} from '@bmw-agent/agent-ui'
import type {AgentBridgeConnection} from '../packages/platform/src/assistant-service.js'
import {createBmwApplication} from '../packages/platform/src/main.js'
import {bmwProduct} from '../packages/product-bmw/index.js'
import {ProjectStore} from '../packages/platform/src/project-store.js'
import {PermissionStore} from '../packages/platform/src/permission-store.js'
import {LayoutStore} from '../packages/platform/src/layout-store.js'

const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-driver-core-')))
process.env.BMW_USER_DATA_DIR=path.join(temporary,'profile')
requireCurrentAgentData(process.env.BMW_USER_DATA_DIR)
const store=new ProjectStore({filePath:path.join(process.env.BMW_USER_DATA_DIR,'projects.json'),projectsDirectory:path.join(temporary,'projects'),initialWorkspacePath:path.join(temporary,'workspace'),onState:undefined})
store.completeInitialSetup({name:'Contract Project',homeUrl:''})
new LayoutStore({filePath:path.join(process.env.BMW_USER_DATA_DIR,'layout-settings.json'),onState:undefined}).update({configured:true,mode:'sidebar'})
let connection:AgentBridgeConnection|undefined,finishRun:(()=>void)|undefined,cancelRun:(()=>void)|undefined
const backend:AgentBackend={
 description:{id:'fixture',label:'Fixture',baseline:'contract-test',capabilities:{streaming:false,images:true,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:false}},
 async prepare(request){
   connection.attachProviderSession(request.externalSessionId??'fixture-native:'+request.sessionId)
   const client=createFixtureBrowserClient(connection)
   try{
     await client.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'neutral-preflight',version:'1'}})
     const catalog=fixtureRecord(await client.request('tools/list'));assert.ok(Array.isArray(catalog.tools));assert.deepEqual(catalog.tools.map(tool=>fixtureRecord(tool).name),['browser'])
   }finally{await client.close()}
   return {...this.description,capabilities:{...this.description.capabilities,browserOnly:true}}
 },
 async run(request,emit){
   await emit({type:'session.bound',externalSessionId:request.externalSessionId??'fixture-native:'+request.sessionId})
   await emit({type:'input.accepted',receiptId:'fixture-'+request.runId})
   if(request.text==='Cancelled unknown fixture')throw new Error('Fixture transport lost after acceptance')
   const outcome=await new Promise<'success'|'interrupted'>(resolve=>{finishRun=()=>resolve('success');cancelRun=()=>resolve('interrupted');if(request.signal.aborted)cancelRun()})
   await emit({type:'turn.completed',outcome,message:''});return {outcome,message:''}
 },
 async interrupt(){cancelRun?.()},async respond(){throw new Error('No fixture interactions')},async close(){cancelRun?.()}
}
const errors:string[]=[]
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',details=>{if(details.level==='error')errors.push(details.message)}))
const invokeHandlers=new Map<string,Parameters<typeof ipcMain.handle>[1]>()
const installHandler=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>{invokeHandlers.set(channel,listener);installHandler(channel,listener)}
createBmwApplication(bmwProduct,{pagePath:assistantPagePath,preloadPath:assistantPreloadPath,defaultDriverId:'fixture',createBackends(config){
 const prepare=backend.prepare.bind(backend)
 backend.prepare=async(request:AgentRunRequest)=>{connection=await config.connection(request);return prepare(request)}
 return [backend]
}})
async function waitFor<T>(read:()=>Promise<T|null>):Promise<T>{
 const end=Date.now()+30000
 while(Date.now()<end){const value=await read();if(value!==null)return value;await new Promise(resolve=>setTimeout(resolve,100))}
 throw new Error('Driver contract smoke timed out')
}
const fixtureServer=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<title>Neutral driver browser fixture</title>')})
let model:ReturnType<typeof createFixtureBrowserClient>|undefined
let exitCode=0
const watchdog=setTimeout(()=>{console.error('Driver smoke deadline');app.exit(1)},45000)
async function run():Promise<void>{
await app.whenReady()
try{
 const shell=await waitFor(async()=>webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/renderer/shell.html')&&!contents.isLoading())??null)
 await waitFor(async()=>await shell.executeJavaScript("window.bmw.agentContext().then(value=>value.state==='ready'?value:null)"))
 const foreign=webContents.getAllWebContents().find(contents=>contents!==shell&&!contents.isDestroyed())
 assert.ok(foreign)
 await shell.executeJavaScript(`(()=>{const frame=document.createElement('iframe');frame.id='ipc-child-fixture';frame.srcdoc='<p>Untrusted subframe</p>';document.body.append(frame)})()`)
 const child=await waitFor(async()=>shell.mainFrame.frames.find(frame=>frame.url==='about:srcdoc')??null)
 const shellChannels=[...fs.readFileSync(path.resolve(import.meta.dirname,'../packages/platform/src/preload/shell-preload.cts'),'utf8').matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match=>match[1])
 assert.ok(shellChannels.length>30,'Every exposed Shell invoke must participate')
 for(const channel of shellChannels){
   const handler=invokeHandlers.get(channel);assert.ok(handler,channel)
   for(const event of [{sender:foreign,senderFrame:foreign.mainFrame},{sender:shell,senderFrame:child}]) {
     await assert.rejects(Promise.resolve().then(()=>handler(event as unknown as Parameters<typeof handler>[0])),/BMW_SHELL_IPC_DENIED/,channel)
   }
 }
 await shell.executeJavaScript("document.getElementById('ipc-child-fixture').remove()")
 assert.equal(new PermissionStore(path.join(process.env.BMW_USER_DATA_DIR,'permissions.json')).hasAgentControl(),false)
 console.log('PASS Shell IPC: all '+shellChannels.length+' exposed invokes reject non-Shell and real child-frame events before state changes')
 const assistant=await waitFor(async()=>webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/assistant.html')&&!contents.isLoading())??null)
 const initial=await shell.executeJavaScript('(async()=>({project:(await window.bmw.projectState()).projects[0],sessionId:(await window.bmw.listAgentSessions()).selectedSessionId}))()')
 const startRun=async(sessionId:string)=>{
   finishRun=undefined
   await assistant.executeJavaScript('window.bmwAssistant.invoke('+JSON.stringify({action:'message.send',sessionId,text:'Hold a neutral contract execution lease'})+')')
   await waitFor(async()=>finishRun&&connection?true:null)
 }
 const finish=async()=>{finishRun?.();await waitFor(async()=>await assistant.executeJavaScript('window.bmwAssistant.invoke({action:"snapshot"}).then(value=>!value.busy?true:null)'))}
 await assistant.executeJavaScript('window.bmwAssistant.invoke('+JSON.stringify({action:'message.send',sessionId:initial.sessionId,text:'Cancelled unknown fixture'})+')')
 await waitFor(async()=>await assistant.executeJavaScript('window.bmwAssistant.invoke({action:"snapshot"}).then(value=>!value.busy&&value.uncertainInputs?.length===1?true:null)'))
 await startRun(initial.sessionId)
 const activeBeforeResolution=await assistant.executeJavaScript('window.bmwAssistant.invoke({action:"snapshot"}).then(value=>({runId:value.activeRunId,messages:value.messages,events:value.events}))')
 await assistant.executeJavaScript('document.querySelector("#uncertain-inputs button").click()')
 await waitFor(async()=>await assistant.executeJavaScript('window.bmwAssistant.invoke({action:"snapshot"}).then(value=>value.cancelledUnknownInputs?.length===1&&value.uncertainInputs?.length===0?true:null)'))
 const activeAfterResolution=await assistant.executeJavaScript('window.bmwAssistant.invoke({action:"snapshot"})')
 assert.equal(activeAfterResolution.activeRunId,activeBeforeResolution.runId);assert.equal(activeAfterResolution.busy,true)
 assert.deepEqual(activeAfterResolution.messages,activeBeforeResolution.messages);assert.deepEqual(activeAfterResolution.events,activeBeforeResolution.events)
 assert.match(await assistant.executeJavaScript('document.getElementById("uncertain-inputs").textContent'),/原执行结果未核实/)
 console.log('PASS trusted Assistant unknown cancellation: current input retained, evidence preserved and no replay')
 assert.ok(connection,'Platform must inject a generic Host execution lease')
 const config=connection
 const unauthorized=await fetch(config.bridgeUrl+'/health',{headers:{authorization:'Bearer invalid-fixture'},signal:AbortSignal.timeout(10000)})
 assert.equal(unauthorized.status,401)
 model=createFixtureBrowserClient(config)
 const initialized=fixtureRecord(await model.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'neutral-contract-fixture',version:'1'}}))
 assert.equal(fixtureRecord(initialized.serverInfo).name,'bmw-browser')
 const catalog=fixtureRecord(await model.request('tools/list'))
 assert.ok(Array.isArray(catalog.tools));assert.deepEqual(catalog.tools.map(tool=>fixtureRecord(tool).name),['browser'])
 const binding=await model.register('fixture-native:'+initial.sessionId,initial.project.directory)
 const foreignDirectory=path.join(temporary,'foreign-project');fs.mkdirSync(foreignDirectory)
 await assert.rejects(model.register('foreign',foreignDirectory),/live BMW Host lease/)
 const modelStatus=fixtureRecord((await model.call(binding,{action:'status'})).structuredContent)
 assert.equal(fixtureRecord(modelStatus.activeProject).id,initial.project.id)
 await assert.rejects(model.call(binding,{action:'tabs.list'}),/PERMISSION_REQUIRED/)
 await shell.executeJavaScript('window.bmw.setAgentControl(true)')
 await new Promise<void>(resolve=>fixtureServer.listen(0,'127.0.0.1',()=>resolve()))
 const address=fixtureServer.address();assert.ok(address&&typeof address==='object')
 const url='http://127.0.0.1:'+address.port+'/neutral-model'
 const opened=fixtureRecord((await model.call(binding,{action:'tabs.open',url,foreground:false,reuse:false})).structuredContent)
 assert.equal(typeof opened.id,'string')
 const listed=fixtureRecord((await model.call(binding,{action:'tabs.list'})).structuredContent)
 assert.ok(Array.isArray(listed.tabs));assert.ok(listed.tabs.some(tab=>fixtureRecord(tab).id===opened.id&&fixtureRecord(tab).url===url))
 const gui=await shell.executeJavaScript('window.bmw.browser({action:"tabs.list"})')
 assert.deepEqual(listed.tabs,gui.tabs,'Model MCP calls must reach the same real Project-owned browser as GUI calls')
 const screenshotCall=await model.call(binding,{action:'media.screenshot',tabId:opened.id})
 const originalImage=fixtureRecord(screenshotCall.structuredContent)
 assert.equal(typeof originalImage.artifactId,'string')
 const originalFile=String(originalImage.path),originalBytes=fs.readFileSync(originalFile)
 const annotation=await model.call(binding,{action:'media.image.annotate',artifactId:originalImage.artifactId,shapes:[{type:'rect',x:10,y:10,width:120,height:35,color:'#ff0000'},{type:'arrow',x1:170,y1:90,x2:80,y2:30,color:'#0000ff'}]})
 const annotatedImage=fixtureRecord(annotation.structuredContent)
 assert.notEqual(annotatedImage.artifactId,originalImage.artifactId)
 assert.equal(annotatedImage.width,originalImage.width);assert.equal(annotatedImage.height,originalImage.height)
 assert.ok(Array.isArray(annotation.content));const annotatedPng=annotation.content.map(fixtureRecord).find(part=>part.type==='image');assert.ok(annotatedPng)
 assert.equal(annotatedPng.mimeType,'image/png');assert.equal(annotatedPng.data,fs.readFileSync(String(annotatedImage.path)).toString('base64'))
 assert.deepEqual(fs.readFileSync(originalFile),originalBytes)
 const drawing=await model.call(binding,{action:'media.image.draw',width:320,height:180,shapes:[{type:'text',x:20,y:20,text:'BMW drawing',fontSize:24,color:'#000000'},{type:'arrow',x1:20,y1:80,x2:200,y2:80}]})
 assert.equal(fixtureRecord(drawing.structuredContent).width,320);assert.ok(Array.isArray(drawing.content)&&drawing.content.map(fixtureRecord).some(part=>part.type==='image'))
 console.log('PASS model-side MCP: real screenshot -> native annotation and drawing -> Project PNG and image content, originals preserved')
 await assert.rejects(model.call('b'.repeat(64),{action:'status'}),/Session has ended/)
 await assert.rejects(model.request('tools/call',{name:'shell',arguments:{}}),/Unknown tool/)
 await assert.rejects(model.call(binding,{action:'connector.external.status'}),/Unsupported browser action/)
 await model.call(binding,{action:'tabs.close',tabId:opened.id})
 const hourlyTask=fixtureRecord((await model.call(binding,{action:'schedule.create',scheduleName:'Hourly candidate fixture',schedulePrompt:'Report existing candidate evidence only; no production.',scheduleTime:'06:00',scheduleTimeZone:'UTC',scheduleEnabled:false})).structuredContent)
 await finish()
 await shell.executeJavaScript('document.getElementById("scheduled-task-button").click()')
 await waitFor(async()=>await shell.executeJavaScript('document.querySelector("#scheduled-task-overlay:not(.hidden) .scheduled-task-row")?true:null'))
 await shell.executeJavaScript('Array.from(document.querySelectorAll(".scheduled-task-actions button")).find(button=>button.textContent==="改为每小时").click()')
 await waitFor(async()=>await shell.executeJavaScript('window.bmw.scheduledTasks().then(value=>value.tasks.find(task=>task.id==='+JSON.stringify(hourlyTask.id)+')?.intervalMinutes===60?true:null)'))
 assert.equal(await shell.executeJavaScript('window.bmw.scheduledTasks().then(value=>value.tasks[0].enabled)'),false)
 assert.match(await shell.executeJavaScript('document.querySelector(".scheduled-task-schedule").textContent'),/每小时/)
 await shell.executeJavaScript('document.getElementById("scheduled-task-close").click()')
 console.log('PASS trusted hourly task GUI: persisted60-minute cadence with explicit paused task; no new Agent dispatch')
 const proof=await shell.executeJavaScript([
 '(async()=>{const api=window.bmw,first=(await api.projectState()).projects[0],initial=await api.listAgentSessions();',
 'const firstId=initial.selectedSessionId;await api.renameAgentSession(firstId,"Original conversation");',
 'const created=await api.createAgentSession();if(created.items.length!==2)throw new Error("Session creation failed");',
 'await api.selectAgentSession(firstId);const selected=await api.listAgentSessions();',
 'let rejected=false;try{await api.selectAgentSession("foreign")}catch{rejected=true}',
 'const next=await api.createProject({name:"Second Contract Project",homeUrl:""});',
 'return {product:await api.productInfo(),first,firstId,selected,rejected,next,status:await api.browser({action:"status"})}})()'
 ].join('\n'))
 assert.equal(proof.product.agent.label,'BMW Assistant')
 assert.equal(proof.selected.selectedSessionId,proof.firstId);assert.equal(proof.selected.items[0].title,'Fixture · Original conversation');assert.equal(proof.rejected,true)
 assert.notEqual(proof.next.activeProjectId,proof.first.id)
 assert.equal(Object.hasOwn(proof.next.projects[0],'agentBindings'),false)
 const keys=await shell.executeJavaScript('Object.keys(window.bmw)')
 assert.equal(keys.some((key:string)=>/Dsh|Import|WebRuntime/.test(key)),false)
 await assert.rejects(model.call(binding,{action:'status'}),/Session has ended/)
 await model.post('/session/release',{binding})
 await assert.rejects(model.call(binding,{action:'status'}),/Session has ended/)
 const current=proof.next.projects.find((project:{id:string})=>project.id===proof.next.activeProjectId)
 const currentSession=await shell.executeJavaScript('window.bmw.listAgentSessions().then(value=>value.selectedSessionId)')
 await startRun(currentSession)
 const currentBinding=await model.register('fixture-native:'+currentSession,current.directory)
 assert.equal(fixtureRecord(fixtureRecord((await model.call(currentBinding,{action:'status'})).structuredContent).activeProject).id,current.id)
 await model.post('/session/release',{binding:currentBinding})
 await finish()
 assert.equal(errors.length,0,errors.join('\n'))
 console.log('PASS neutral Browser/Driver connection: injected configuration, MCP initialize/sole browser tool, permission denial, real Project tabs shared with GUI, forged/foreign/released binding denial and Project-switch recovery; no DSH or model')
 console.log('PASS provider-neutral BMW core: lifecycle, Shell, Project bindings, sessions, rename/select, foreign ownership denial and Project transition with fixture driver')
}catch(error){exitCode=1;console.error(error)}
finally{clearTimeout(watchdog);await model?.close();fixtureServer.closeAllConnections();if(fixtureServer.listening)await new Promise<void>(resolve=>fixtureServer.close(()=>resolve()));finishRun?.();app.once('will-quit',()=>{fs.rmSync(temporary,{recursive:true,force:true});app.exit(exitCode)});app.quit()}

}
void run()
