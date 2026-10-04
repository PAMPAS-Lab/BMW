import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {ProjectStore} from '../src/project-store.js'
import {GlobalSettingsStore} from '../src/global-settings-store.js'
import {dshDriver,migrateDshProjectMetadata} from '../../harness-dsh/index.js'
test('saved DSH bindings migrate atomically while Projects, tabs, documents and other drivers survive',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-driver-binding-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const options={filePath:path.join(root,'projects.json'),projectsDirectory:path.join(root,'projects'),legacyWorkspacePath:path.join(root,'workspace'),onState:undefined}
 const store=new ProjectStore(options),id=store.active().id
 store.writeDocument(id,'memory','Verified material');store.updateTabState(id,{urls:['https://example.com/'],activeUrl:'https://example.com/'})
 const saved=JSON.parse(fs.readFileSync(options.filePath,'utf8'))
 saved.projects[0].dshWorkspaceId='w';saved.projects[0].dshSessionId='s'
 saved.projects[0].agentBindings={fixture:{workspaceId:'fw',sessionId:'fs'}}
 saved.projects[0].connectors={external:{pendingRelays:['discard']}}
 fs.writeFileSync(options.filePath,JSON.stringify(saved))
 const restored=new ProjectStore({...options,migrateProjectMetadata:migrateDshProjectMetadata})
 assert.equal(restored.active().id,id);assert.deepEqual(restored.agentBinding(id,'dsh'),{workspaceId:'w',sessionId:'s'})
 assert.deepEqual(restored.agentBinding(id,'fixture'),{workspaceId:'fw',sessionId:'fs'})
 assert.match(restored.readDocument(id,'memory').content,/Verified material/)
 assert.deepEqual(restored.active().tabState,store.active().tabState)
 const persisted=JSON.parse(fs.readFileSync(options.filePath,'utf8')).projects[0]
 for(const key of ['connectors','dshWorkspaceId','dshSessionId'])assert.equal(Object.hasOwn(persisted,key),false)
 assert.deepEqual(migrateDshProjectMetadata(persisted),persisted)
 restored.setAgentBinding(id,'fixture',{sessionId:'new'});assert.equal(restored.agentBinding(id,'dsh').sessionId,'s')
 assert.throws(()=>restored.setAgentBinding(id,'fixture',{sessionId:42 as unknown as string}),/identifier/)
 assert.equal(restored.agentBinding(id,'fixture').sessionId,'new')
})
test('driver settings migration retains sidebar choice and drops unused settings without touching video templates',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-driver-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const filePath=path.join(root,'settings.json')
 fs.writeFileSync(filePath,JSON.stringify({dshSidebarVisible:true,webContainerModuleUrl:'https://unused.example/',edgeNarrationEnabled:false}))
 const store=new GlobalSettingsStore({filePath,onState:undefined,migrateSettings:dshDriver.migrateSettings})
 assert.equal(store.snapshot().agentSidebarVisible,true);assert.equal(store.snapshot().edgeNarrationEnabled,false)
 const saved=JSON.parse(fs.readFileSync(filePath,'utf8'));assert.equal('dshSidebarVisible' in saved,false);assert.equal('webContainerModuleUrl' in saved,false)
 assert.deepEqual(saved.videoPreferences,store.snapshot().videoPreferences)
})
