import {requireCurrentAgentData} from '../packages/platform/src/agent-data-format.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {app,webContents,dialog} from 'electron'
import type {AssistantState,AssistantCommand} from '@bmw-agent/agent-contract'
import {agentRecord} from '@bmw-agent/agent-contract'
import {ProjectStore} from '../packages/platform/src/project-store.js'
import {LayoutStore} from '../packages/platform/src/layout-store.js'

process.on('uncaughtException',(error:Error)=>{console.error(error);app.exit(1)})
const rawRoot=process.env.BMW_ASSISTANT_DEFAULT_ROOT,phase=process.env.BMW_ASSISTANT_DEFAULT_PHASE
assert.ok(rawRoot&&path.isAbsolute(rawRoot));assert.ok(phase==='create'||phase==='restore')
const root=fs.realpathSync(rawRoot),temporary=fs.realpathSync(os.tmpdir())
assert.ok(root.startsWith(temporary+path.sep)&&path.basename(root).startsWith('bmw-assistant-default-'),'Disposable test profile required')
const profile=path.join(root,'profile'),sourceHome=path.join(root,'empty-dsh-home'),evidenceFile=path.join(root,'sessions.json')
const fixture=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<title>Shared BMW Project page</title><h1>Shared page</h1>')})
const restorePort=phase==='restore'?new URL(String(agentRecord(JSON.parse(fs.readFileSync(evidenceFile,'utf8'))).pageUrl)).port:'0'
await new Promise<void>(resolve=>fixture.listen(Number(restorePort),'127.0.0.1',resolve))
const address=fixture.address();assert.ok(address&&typeof address==='object')
const pageUrl='http://127.0.0.1:'+address.port+'/shared'
fs.mkdirSync(sourceHome,{recursive:true})
process.env.BMW_USER_DATA_DIR=profile
requireCurrentAgentData(process.env.BMW_USER_DATA_DIR)
process.env.DSH_HOME=sourceHome
process.env.BMW_CODEX_EXECUTABLE=path.join(root,'uninstalled-codex')
if(phase==='create'){
  const projects=new ProjectStore({filePath:path.join(profile,'projects.json'),projectsDirectory:path.join(root,'projects'),initialWorkspacePath:path.join(root,'workspace'),onState:undefined})
  projects.completeInitialSetup({name:'Default entry Project',homeUrl:''})
  new LayoutStore({filePath:path.join(profile,'layout-settings.json'),onState:undefined}).update({configured:true,mode:'sidebar'})
}
dialog.showErrorBox=(title,content)=>{console.error(title+': '+content);app.exit(1)}
const watchdog=setTimeout(()=>{console.error('Default Assistant watchdog expired');app.exit(1)},60000)
await import('./product-entry.js')
async function waitFor<T>(read:()=>Promise<T|null>,label:string):Promise<T>{
  const deadline=Date.now()+30000
  while(Date.now()<deadline){const value=await read();if(value!==null)return value;await new Promise(resolve=>setTimeout(resolve,50))}
  throw new Error('Default entry timeout: '+label)
}
async function run():Promise<void>{
  await app.whenReady()
  const assistant=await waitFor(async()=>webContents.getAllWebContents().find(row=>row.getURL().endsWith('/assistant.html')&&!row.isLoading())??null,'owned Assistant')
  const shell=await waitFor(async()=>webContents.getAllWebContents().find(row=>row.getURL().endsWith('/shell.html')&&!row.isLoading())??null,'Shell')
  const invoke=(command:AssistantCommand):Promise<AssistantState>=>assistant.executeJavaScript('window.bmwAssistant.invoke('+JSON.stringify(command)+')')
  const browser=(request:Record<string,unknown>):Promise<unknown>=>shell.executeJavaScript('window.bmw.browser('+JSON.stringify(request)+')')
  const snapshot=()=>invoke({action:'snapshot'})
  const initial=await waitFor(async()=>{const state=await snapshot();return state.selectedSessionId?state:null},'blank Session')
  const product=agentRecord(await shell.executeJavaScript('window.bmw.productInfo()'))
  assert.equal(agentRecord(product.agent).label,'BMW Assistant')
  assert.deepEqual(initial.drivers.map(row=>row.id),['dsh','codex','qoder-cn'])
  assert.equal(initial.driverId,'dsh');assert.equal(initial.busy,false)
  assert.equal(await assistant.executeJavaScript('typeof window.require'),'undefined')
  const studio=(studioRequest:Record<string,unknown>)=>browser({action:'video.studio',studioRequest})
  if(phase==='restore'){
    const saved=agentRecord(JSON.parse(fs.readFileSync(evidenceFile,'utf8')))
    assert.equal(initial.selectedSessionId,saved.dshSession)
    for(const key of ['dshSession','qoderSession','codexSession'])assert.ok(initial.sessions.some(row=>row.sessionId===saved[key]&&row.externalSessionId===null))
    assert.equal(initial.messages.length,0,'A restart must not submit a prompt or fabricate native history')
    const draft=agentRecord(await studio({operation:'read',draftId:saved.draftId}))
    assert.equal(draft.ownerSessionId,saved.dshSession)
    await waitFor(async()=>{const tabs=agentRecord(await browser({action:'tabs.list'}));return Array.isArray(tabs.tabs)&&tabs.tabs.some(raw=>agentRecord(raw).url===saved.pageUrl)?true:null},'restored Project page')
    await waitFor(async()=>{const page=webContents.getAllWebContents().find(row=>row.getURL()===saved.pageUrl&&!row.isLoading());return page&&await page.executeJavaScript('document.querySelector("h1")?.textContent')==='Shared page'?true:null},'restored live page content')
    console.log('PASS default restart: same BMW identities, Project page and immutable Studio owner')
  }else{
    assert.equal(initial.sessions.length,1);assert.equal(initial.messages.length,0)
    const dshSession=initial.selectedSessionId!
    assert.equal(initial.sessions[0].externalSessionId,null)
    assert.equal(fs.existsSync(path.join(profile,'agent-drivers')),false,'Blank conversations must not start provider processes')
    await assert.rejects(browser({action:'tabs.open',url:pageUrl,reuse:false,foreground:false}),/PERMISSION_REQUIRED|agent control has not been granted/)
    await shell.executeJavaScript('window.bmw.setAgentControl(true)')
    const opened=agentRecord(await browser({action:'tabs.open',url:pageUrl,reuse:false,foreground:false}))
    const draft=agentRecord(await studio({operation:'create',title:'DSH Session owns this draft'}))
    assert.equal(draft.ownerSessionId,dshSession)
    const task=agentRecord(await browser({action:'schedule.create',scheduleName:'Pinned DSH task',schedulePrompt:'Never submit in this admission test',scheduleTime:'23:59',scheduleTimeZone:'Asia/Shanghai',scheduleEnabled:false}))
    assert.equal(task.sessionId,dshSession);assert.equal(task.driverId,'dsh')
    const qoder=await invoke({action:'driver.select',driverId:'qoder-cn'}),qoderSession=qoder.selectedSessionId!
    assert.notEqual(qoderSession,dshSession);assert.equal(qoder.sessions.length,2)
    const list=agentRecord(await studio({operation:'list'}));assert.deepEqual(list.drafts,[])
    await assert.rejects(studio({operation:'read',draftId:draft.id}),/STUDIO_SESSION_MISMATCH/)
    const shared=agentRecord(await browser({action:'tabs.list'}));assert.ok(Array.isArray(shared.tabs)&&shared.tabs.some(raw=>agentRecord(raw).id===opened.id))
    await invoke({action:'settings.run',driverId:'qoder-cn',request:{action:'refresh'}})
    const loggedOut=await waitFor(async()=>{const state=await snapshot();return state.settings?.driverId==='qoder-cn'&&state.settings.phase!=='working'&&!state.busy?state:null},'Qoder empty official profile')
    assert.equal(loggedOut.settings?.phase,'idle');assert.equal(loggedOut.settings?.value?.authentication.state,'required')
    assert.equal(loggedOut.messages.length,0);assert.equal(loggedOut.sessions.find(row=>row.sessionId===qoderSession)?.externalSessionId,null)
    const codex=await invoke({action:'driver.select',driverId:'codex'}),codexSession=codex.selectedSessionId!
    assert.notEqual(codexSession,qoderSession);assert.notEqual(codexSession,dshSession)
    await invoke({action:'settings.run',driverId:'codex',request:{action:'refresh'}})
    const unavailable=await waitFor(async()=>{const state=await snapshot();return state.settings?.driverId==='codex'&&state.settings.phase!=='working'&&!state.busy?state:null},'Codex missing public executable')
    assert.equal(unavailable.settings?.phase,'idle');assert.equal(unavailable.settings?.value?.authentication.state,'unknown')
    assert.deepEqual(unavailable.settings?.value?.models,[])
    const tasks=agentRecord(await shell.executeJavaScript('window.bmw.scheduledTasks()'));assert.ok(Array.isArray(tasks.tasks))
    const pinned=agentRecord(tasks.tasks.find(raw=>agentRecord(raw).id===task.id));assert.equal(pinned.driverId,'dsh');assert.equal(pinned.sessionId,dshSession)
    const sameDsh=await invoke({action:'driver.select',driverId:'dsh'});assert.equal(sameDsh.selectedSessionId,dshSession)
    assert.equal(agentRecord(await studio({operation:'read',draftId:draft.id})).ownerSessionId,dshSession)
    await invoke({action:'driver.select',driverId:'codex'})
    await invoke({action:'session.archive',sessionId:dshSession})
    await shell.executeJavaScript('window.bmw.runScheduledTask('+JSON.stringify(task.id)+')')
    const failed=await waitFor(async()=>{const state=agentRecord(await shell.executeJavaScript('window.bmw.scheduledTasks()'));assert.ok(Array.isArray(state.runs));return state.runs.find(raw=>agentRecord(raw).taskId===task.id&&agentRecord(raw).status==='failed')??null},'invalid saved schedule binding')
    assert.match(String(agentRecord(failed).error),/saved scheduled Session|driver.*unavailable/)
    assert.equal((await snapshot()).driverId,'codex','Invalid task must not select a fallback driver or Session')
    assert.equal((await snapshot()).messages.length,0)
    // Preserve the archived admission-test owner, and create the stable DSH
    // conversation used by the restart proof through the same public controls.
    const returned=await invoke({action:'driver.select',driverId:'dsh'}),restoredDsh=returned.selectedSessionId!
    assert.notEqual(restoredDsh,dshSession)
    await assert.rejects(studio({operation:'read',draftId:draft.id}),/STUDIO_SESSION_MISMATCH/)
    const restartDraft=agentRecord(await studio({operation:'create',title:'Stable restart owner'}))
    assert.equal(restartDraft.ownerSessionId,restoredDsh)
    for(const driverId of ['qoder-cn','codex','dsh']){
      const state=await invoke({action:'driver.select',driverId});assert.equal(state.selectedSessionId,driverId==='dsh'?restoredDsh:driverId==='codex'?codexSession:qoderSession)
      assert.ok(state.sessions.every(row=>row.externalSessionId===null));assert.equal(state.messages.length,0)
    }
    fs.writeFileSync(evidenceFile,JSON.stringify({dshSession:restoredDsh,qoderSession,codexSession,archivedSession:dshSession,draftId:restartDraft.id,pageUrl:opened.url,paidInference:false,nativeDesktopProfileUsed:false},null,2)+'\n')
    console.log('PASS default entry: three independent blank Sessions, shared page, scoped Studio, native auth/install state and invalid schedule rejected before input')
  }
  app.once('will-quit',()=>{clearTimeout(watchdog);fixture.closeAllConnections();fixture.close();app.exit(0)})
  app.quit()
}
void run().catch((error:unknown)=>{console.error(error);clearTimeout(watchdog);fixture.closeAllConnections();fixture.close();app.exit(1)})
