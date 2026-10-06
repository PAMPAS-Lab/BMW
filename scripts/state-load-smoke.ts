import {requireCurrentAgentData} from '../packages/platform/src/agent-data-format.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {app,webContents,dialog,BrowserWindow,safeStorage} from 'electron'
import type {AgentBackend} from '@bmw-agent/agent-contract'
import {assistantPagePath,assistantPreloadPath} from '@bmw-agent/agent-ui'
import {createBmwApplication} from '../packages/platform/src/main.js'
import {bmwProduct} from '../packages/product-bmw/index.js'
import {ProjectStore} from '../packages/platform/src/project-store.js'
import {LayoutStore} from '../packages/platform/src/layout-store.js'

process.on('uncaughtException',(error:Error)=>{console.error(error);process.exit(1)})

const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-driver-core-')))
process.env.BMW_USER_DATA_DIR=path.join(temporary,'profile')
requireCurrentAgentData(process.env.BMW_USER_DATA_DIR)
const store=new ProjectStore({filePath:path.join(process.env.BMW_USER_DATA_DIR,'projects.json'),projectsDirectory:path.join(temporary,'projects'),initialWorkspacePath:path.join(temporary,'workspace'),onState:undefined})
store.completeInitialSetup({name:'Contract Project',homeUrl:''})
new LayoutStore({filePath:path.join(process.env.BMW_USER_DATA_DIR,'layout-settings.json'),onState:undefined}).update({configured:true,mode:'sidebar'})
let backendCreated=0
const assembly={pagePath:assistantPagePath,preloadPath:assistantPreloadPath,defaultDriverId:'fixture',createBackends():AgentBackend[]{
 backendCreated++
 return [{description:{id:'fixture',label:'Fixture',baseline:'contract-test',capabilities:{streaming:false,images:false,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:false}},prepare:async()=>{throw new Error('Startup fixture cannot dispatch model input')},run:async()=>{throw new Error('Startup fixture cannot dispatch model input')},interrupt:async()=>{},respond:async()=>{},close:async()=>{}}]
}}
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
 if(scenario==='exit'){app.once('will-quit',()=>{assert.equal(fs.readFileSync(stateFile,'utf8'),invalid);assert.equal(backendCreated,0);console.log('PASS startup '+kind+' exit preserves unreadable state');console.log('Startup evidence: '+temporary);app.exit(0)});return {response:1,checkboxChecked:false}}
 fs.writeFileSync(stateFile,original);return {response:0,checkboxChecked:false}
}})
const errors:string[]=[]
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',details=>{if(details.level==='error')errors.push(details.message)}))
createBmwApplication(bmwProduct,assembly)
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
 assert.equal(proof.product.agent.label,'BMW Assistant');assert.equal(backendCreated,1)
 assert.equal(proof.selected.selectedSessionId,proof.firstId);assert.equal(proof.selected.items[0].title,'Fixture · Original conversation');assert.equal(proof.rejected,true)
 assert.notEqual(proof.next.activeProjectId,proof.first.id)
 assert.equal(Object.hasOwn(proof.next.projects[0],'agentBindings'),false)
 const keys=await shell.executeJavaScript('Object.keys(window.bmw)')
 assert.equal(keys.some((key:string)=>/Dsh|Import|WebRuntime/.test(key)),false)
 assert.equal(errors.length,0,errors.join('\n'))
 console.log('PASS provider-neutral BMW core: lifecycle, Shell, Project bindings, sessions, rename/select, foreign ownership denial and Project transition with fixture driver')
}catch(error){exitCode=1;console.error(error)}
finally{clearTimeout(watchdog);Object.assign(dialog,{showMessageBox:originalDialog});console.log('Startup evidence: '+temporary);app.exit(exitCode)}

}
void run()
