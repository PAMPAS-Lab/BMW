import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {ProjectStore} from '../src/project-store.js'
import {GlobalSettingsStore} from '../src/global-settings-store.js'
test('Project storage rejects native provider mappings without rewriting Project documents or saved bytes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-driver-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const options={filePath:path.join(root,'projects.json'),projectsDirectory:path.join(root,'projects'),initialWorkspacePath:path.join(root,'workspace'),onState:undefined}
 const store=new ProjectStore(options),id=store.active().id
 store.writeDocument(id,'memory','Verified material')
 const saved=JSON.parse(fs.readFileSync(options.filePath,'utf8'));saved.projects[0].agentBindings={dsh:{workspaceId:'native',sessionId:'old'}}
 fs.writeFileSync(options.filePath,JSON.stringify(saved));const before=fs.readFileSync(options.filePath)
 assert.throws(()=>new ProjectStore(options),/Cannot load/)
 assert.deepEqual(fs.readFileSync(options.filePath),before)
 assert.match(store.readDocument(id,'memory').content,/Verified material/)
})
test('Global settings require the current format and reject retired sidebar fields without an automatic conversion',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-settings-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const filePath=path.join(root,'settings.json'),before=JSON.stringify({version:1,dshSidebarVisible:true})
 fs.writeFileSync(filePath,before)
 assert.throws(()=>new GlobalSettingsStore({filePath,onState:undefined}),/Cannot load/)
 assert.equal(fs.readFileSync(filePath,'utf8'),before)
 fs.writeFileSync(filePath,JSON.stringify({version:2,agentSidebarVisible:false}))
 assert.throws(()=>new GlobalSettingsStore({filePath,onState:undefined}),/Cannot load/)
})
