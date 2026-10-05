import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {app,webContents,dialog,BrowserWindow,safeStorage} from 'electron'
import type {AgentDriver,AgentProject,AgentRuntime,AgentSession,AgentWorkspace} from '@bmw-agent/agent-contract'
import {createBmwApplication} from '../packages/platform/src/main.js'
import {bmwProduct} from '../packages/product-bmw/index.js'
import {ProjectStore} from '../packages/platform/src/project-store.js'
import {LayoutStore} from '../packages/platform/src/layout-store.js'

process.on('uncaughtException',(error:Error)=>{console.error(error);process.exit(1)})

/** Contract fixture: no Agent loop, model, child process or network. */
class FixtureRuntime implements AgentRuntime {
 running=false
 readonly url='data:text/html;charset=utf-8,'+encodeURIComponent('<h1>Fixture Agent</h1>')
 private workspaces=new Map<string,AgentWorkspace>()
 private sessions=new Map<string,AgentSession>()
 private sequence=0
 async start(){this.running=true;return this.url}
 stop(){this.running=false}
 async ensureWorkspace(project:AgentProject){
  let workspace=this.workspaces.get(project.directory)
  if(!workspace){workspace={workspaceId:'w'+(++this.sequence),title:project.name,path:project.directory,sessionIds:[]};this.workspaces.set(project.directory,workspace)}
  workspace.title=project.name
  return structuredClone(workspace)
 }
 async activateWorkspace(project:AgentProject){
  const workspace=await this.ensureWorkspace(project)
  const sessionId=project.sessionId&&workspace.sessionIds.includes(project.sessionId)?project.sessionId:workspace.sessionIds[0]||(await this.createProjectSession(project)).sessionId
  return {workspace:await this.ensureWorkspace(project),sessionId}
 }
 async listProjectSessions(project:AgentProject,query=''){
  const workspace=await this.ensureWorkspace(project)
  return {workspaceId:workspace.workspaceId,selectedSessionId:project.sessionId??null,items:workspace.sessionIds.map(id=>this.sessions.get(id)).filter((row):row is AgentSession=>Boolean(row)&&row.title.includes(query)),hasMore:false,membership:workspace.sessionIds}
 }
 async createProjectSession(project:AgentProject){
  await this.ensureWorkspace(project)
  const workspace=this.workspaces.get(project.directory),sessionId='s'+(++this.sequence)
  workspace.sessionIds.push(sessionId);this.sessions.set(sessionId,{sessionId,title:'New conversation',updatedAt:Date.now(),running:false,blank:true,parentSessionId:null,snippet:''})
  return {sessionId}
 }
 async renameSession(id:string,title:string){this.sessions.get(id).title=title}
 async forkSession(id:string){const workspace=[...this.workspaces.values()].find(row=>row.sessionIds.includes(id));return this.createProjectSession({id:'fixture',name:workspace.title,directory:workspace.path})}
 async archiveSession(id:string){for(const row of this.workspaces.values())row.sessionIds=row.sessionIds.filter(item=>item!==id);this.sessions.delete(id)}
 async moveSession(workspaceId:string,id:string,before?:string){const row=[...this.workspaces.values()].find(item=>item.workspaceId===workspaceId);row.sessionIds=row.sessionIds.filter(item=>item!==id);const index=before?row.sessionIds.indexOf(before):-1;row.sessionIds.splice(index<0?row.sessionIds.length:index,0,id)}
 async deleteWorkspace(id:string){for(const [directory,row] of this.workspaces)if(row.workspaceId===id)this.workspaces.delete(directory)}
 async resolveContext(id:string,projects:AgentProject[]){
  const workspace=[...this.workspaces.values()].find(row=>row.sessionIds.includes(id)),session=this.sessions.get(id)
  const owners=projects.filter(project=>project.directory===workspace?.path&&(!project.workspaceId||project.workspaceId===workspace.workspaceId))
  if(!workspace||!session||owners.length!==1)throw new Error('Unbound fixture selection')
  const project=owners[0]
  return {projectId:project.id,projectName:project.name,directory:project.directory,workspaceId:workspace.workspaceId,workspaceTitle:workspace.title,sessionId:id,sessionTitle:session.title,sessionCount:workspace.sessionIds.length}
 }
 async enqueuePrompt(){return 'fixture-ack'}
 async promptAndWait(){return 'fixture-complete'}
 async cancelSession(){return {cancelled:true}}
}
const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-driver-core-')))
process.env.BMW_USER_DATA_DIR=path.join(temporary,'profile')
const store=new ProjectStore({filePath:path.join(process.env.BMW_USER_DATA_DIR,'projects.json'),projectsDirectory:path.join(temporary,'projects'),legacyWorkspacePath:path.join(temporary,'workspace'),onState:undefined})
store.completeInitialSetup({name:'Contract Project',homeUrl:''})
new LayoutStore({filePath:path.join(process.env.BMW_USER_DATA_DIR,'layout-settings.json'),onState:undefined}).update({configured:true,mode:'sidebar'})
const runtime=new FixtureRuntime()
const driver:AgentDriver={
 id:'fixture',label:'Fixture Agent',baseline:'contract-test',preloadPath:path.resolve(import.meta.dirname,'../packages/agent-contract/test/fixture-preload.cjs'),
 createRuntime:()=>runtime,migrateProjectMetadata:value=>value,migrateSettings:value=>value,
 client:{
  async readSelection(surface){const value=await surface.executeJavaScript('document.documentElement.dataset.sessionId||null');if(value!==null&&typeof value!=='string')throw new Error('Invalid fixture selection');return value as string|null},
  async selectSession(surface,id){await surface.executeJavaScript('document.documentElement.dataset.sessionId='+JSON.stringify(id))},
  async applySidebarPolicy(){},async openSettings(){}
 }
}
const scenario=process.env.BMW_STATE_STARTUP_SCENARIO??'retry'
const kind=process.env.BMW_STATE_STARTUP_KIND??'projects'
// Deterministic test encryption; no production keychain or real cookies are used.
Object.assign(safeStorage,{isEncryptionAvailable:()=>true,encryptString:(text:string)=>Buffer.from('fixture:'+text),decryptString:(bytes:Buffer)=>{if(!bytes.toString().startsWith('fixture:'))throw new Error('Fixture decryption failed');return bytes.toString().slice(8)}})
const stateFiles:Record<string,string>={projects:'projects.json',permissions:'permissions.json',layout:'layout-settings.json','continuity-config':'session-continuity.json','continuity-snapshot':'session-cookies.enc'}
assert.ok(stateFiles[kind],'Known startup state kind')
const stateFile=path.join(process.env.BMW_USER_DATA_DIR,stateFiles[kind])
if(kind==='permissions')fs.writeFileSync(stateFile,JSON.stringify({agentControlGranted:false,sites:{}}))
if(kind==='continuity-config')fs.writeFileSync(stateFile,JSON.stringify({sites:{}}))
if(kind==='continuity-snapshot')fs.writeFileSync(stateFile,'fixture:'+JSON.stringify({version:1,cookies:[]}))
const original=fs.readFileSync(stateFile,'utf8'),invalid='{invalid saved state'
fs.writeFileSync(stateFile,invalid)
let prompts=0
const originalDialog=dialog.showMessageBox
Object.assign(dialog,{showMessageBox:async()=>{
 prompts++;assert.equal(fs.readFileSync(stateFile,'utf8'),invalid)
 assert.equal(BrowserWindow.getAllWindows().length,0,'No privileged UI or Agent starts with unreadable Project data')
 if(scenario==='exit'){app.once('will-quit',()=>{assert.equal(fs.readFileSync(stateFile,'utf8'),invalid);assert.equal(runtime.running,false);console.log('PASS startup '+kind+' exit preserves unreadable state');console.log('Startup evidence: '+temporary);app.exit(0)});return {response:1,checkboxChecked:false}}
 fs.writeFileSync(stateFile,original);return {response:0,checkboxChecked:false}
}})
const errors:string[]=[]
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',details=>{if(details.level==='error')errors.push(details.message)}))
createBmwApplication(bmwProduct,driver)
async function waitFor<T>(read:()=>Promise<T|null>):Promise<T>{
 const end=Date.now()+30000
 while(Date.now()<end){const value=await read();if(value!==null)return value;await new Promise(resolve=>setTimeout(resolve,100))}
 throw new Error('Driver contract smoke timed out')
}
let exitCode=0
const watchdog=setTimeout(()=>{console.error('Driver smoke deadline');app.exit(1)},45000)
async function run():Promise<void>{
await app.whenReady()
try{
 const shell=await waitFor(async()=>webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/renderer/shell.html')&&!contents.isLoading())??null)
 await waitFor(async()=>await shell.executeJavaScript("window.bmw.agentContext().then(value=>value.state==='ready'?value:null)"))
 const proof=await shell.executeJavaScript([
 '(async()=>{const api=window.bmw,first=(await api.projectState()).projects[0],initial=await api.listAgentSessions();',
 'const firstId=initial.selectedSessionId;await api.renameAgentSession(firstId,"Original conversation");',
 'const created=await api.createAgentSession();if(created.items.length!==2)throw new Error("Session creation failed");',
 'await api.selectAgentSession(firstId);const selected=await api.listAgentSessions();',
 'let rejected=false;try{await api.selectAgentSession("foreign")}catch{rejected=true}',
 'const next=await api.createProject({name:"Second Contract Project",homeUrl:""});',
 'return {product:await api.productInfo(),first,firstId,selected,rejected,next,status:await api.browser({action:"status"})}})()'
 ].join('\n'))
 assert.equal(prompts,1);assert.equal(proof.first.id,store.active().id);console.log('PASS startup '+kind+' retry resumes with original Project identity');
 assert.equal(proof.product.agent.id,'fixture');assert.equal(runtime.running,true)
 assert.equal(proof.selected.selectedSessionId,proof.firstId);assert.equal(proof.selected.items[0].title,'Original conversation');assert.equal(proof.rejected,true)
 assert.notEqual(proof.next.activeProjectId,proof.first.id)
 assert.equal(Object.hasOwn(proof.next.projects[0].agentBindings,'fixture'),true)
 assert.equal(Object.hasOwn(proof.next.projects[0].agentBindings,'dsh'),false)
 const keys=await shell.executeJavaScript('Object.keys(window.bmw)')
 assert.equal(keys.some((key:string)=>/Dsh|Import|WebRuntime/.test(key)),false)
 assert.equal(errors.length,0,errors.join('\n'))
 console.log('PASS provider-neutral BMW core: lifecycle, Shell, Project bindings, sessions, rename/select, foreign ownership denial and Project transition with fixture driver')
}catch(error){exitCode=1;console.error(error)}
finally{clearTimeout(watchdog);Object.assign(dialog,{showMessageBox:originalDialog});runtime.stop();console.log('Startup evidence: '+temporary);app.exit(exitCode)}

}
void run()
