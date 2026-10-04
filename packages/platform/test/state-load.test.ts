import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {ProjectStore} from '../src/project-store.js'
import {GlobalSettingsStore} from '../src/global-settings-store.js'
import {ScheduledTaskStore} from '../src/scheduled-task-store.js'
import {PermissionStore} from '../src/permission-store.js'
import {LayoutStore} from '../src/layout-store.js'
import {StateLoadError} from '../src/state-load.js'

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-state-load-')),filePath=path.join(root,'state.json')
 return {root,filePath,close:()=>fs.rmSync(root,{recursive:true,force:true})}
}
const constructors={
 permissions:(filePath:string)=>new PermissionStore(filePath),
 layout:(filePath:string)=>new LayoutStore({filePath}),
 projects:(filePath:string)=>new ProjectStore({filePath,projectsDirectory:path.join(path.dirname(filePath),'projects'),legacyWorkspacePath:path.join(path.dirname(filePath),'workspace'),onState:undefined}),
 settings:(filePath:string)=>new GlobalSettingsStore({filePath,onState:undefined}),
 tasks:(filePath:string)=>new ScheduledTaskStore({filePath})
}
test('Existing malformed and unsupported state never becomes a first-run replacement',()=>{
 for(const [kind,create] of Object.entries(constructors))for(const original of ['{invalid','null','[]','{"version":999}',kind==='permissions'?'{"version":1,"agentControlGranted":true,"sites":{"origin":{"media":"yes"}}}':kind==='layout'?'{"version":1,"mode":"terminal"}':kind==='settings'?'{"version":1,"proxyMode":"manual","proxyRules":""}':kind==='projects'?'{"version":1,"projects":[],"activeProjectId":null}':'{"version":1,"tasks":[{}],"runs":[]}']){
  const value=fixture();try{fs.writeFileSync(value.filePath,original);assert.throws(()=>create(value.filePath),StateLoadError);assert.equal(fs.readFileSync(value.filePath,'utf8'),original);assert.deepEqual(fs.readdirSync(value.root),['state.json'])}finally{value.close()}
 }
})
test('State read failures preserve the file and reject writes for all startup stores',t=>{
 const value=fixture();try{
  const original='preserved bytes';fs.writeFileSync(value.filePath,original)
  const read=fs.readFileSync.bind(fs)
  t.mock.method(fs,'readFileSync',()=>{throw Object.assign(new Error('temporary read failure'),{code:'ETIMEDOUT'})})
  for(const create of Object.values(constructors))assert.throws(()=>create(value.filePath),StateLoadError)
  t.mock.restoreAll();assert.equal(read(value.filePath,'utf8'),original);assert.deepEqual(fs.readdirSync(value.root),['state.json'])
 }finally{t.mock.restoreAll();value.close()}
})
test('Missing state initializes once and valid Project bindings and tasks survive reload',()=>{
 const value=fixture();try{
  const projectPath=path.join(value.root,'projects.json'),settingsPath=path.join(value.root,'settings.json'),taskPath=path.join(value.root,'tasks.json')
  const project=constructors.projects(projectPath),id=project.active().id
  project.setAgentBinding(id,'dsh',{workspaceId:'workspace',sessionId:'session'})
  project.writeDocument(id,'memory','Preserved memory')
  const settings=constructors.settings(settingsPath);settings.update({edgeNarrationEnabled:false})
  const tasks=constructors.tasks(taskPath);tasks.create({id,sessionId:'session'},{name:'Daily',prompt:'Read only',time:'09:00',timeZone:'Asia/Shanghai',enabled:true})
  const reload=constructors.projects(projectPath)
  assert.equal(reload.active().id,id);assert.equal(reload.agentBinding(id,'dsh').sessionId,'session');assert.equal(reload.readDocument(id,'memory').content,'Preserved memory\n')
  assert.equal(constructors.settings(settingsPath).snapshot().edgeNarrationEnabled,false)
  assert.equal(constructors.tasks(taskPath).list(id).length,1)
 }finally{value.close()}
})

test('A failed layout reload blocks updates until explicit repair without overwriting its original bytes',()=>{
 const value=fixture();try{
  const store=new LayoutStore({filePath:value.filePath});store.update({configured:true,mode:'overlay'})
  const original=fs.readFileSync(value.filePath,'utf8'),broken='{invalid existing layout'
  fs.writeFileSync(value.filePath,broken);assert.throws(()=>store.load(),StateLoadError)
  assert.throws(()=>store.update({visible:false}),StateLoadError);assert.equal(fs.readFileSync(value.filePath,'utf8'),broken)
  fs.writeFileSync(value.filePath,original);store.load();store.update({visible:false});assert.equal(store.snapshot().mode,'overlay');assert.equal(store.snapshot().visible,false)
 }finally{value.close()}
})
