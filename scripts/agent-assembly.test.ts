import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import test from 'node:test'
import {createBmwAgentAssembly} from '../apps/bmw/agent-assembly.js'
test('BMW composes all three official backends through the neutral Host contract without starting them',async()=>{
  const root=path.resolve('/private/tmp/bmw-assembly-contract'),options={codex:{executable:path.join(root,'codex'),configDirectory:path.join(root,'codex-profile'),model:'gpt-5.5'},qoder:{configDirectory:path.join(root,'qoder-profile')}}
  const assembly=createBmwAgentAssembly(options)
  options.codex.model='mutated-after-composition'
  const settings={model:()=>null,setModel:()=>{},nodeExecutable:process.execPath,definition:{name:'browser' as const,description:'fixture',inputSchema:{}}}
  const backends=assembly.createBackends({...settings,userDataDirectory:path.join(root,'bmw'),projects:()=>[],connection:async()=>{assert.fail('No Agent may connect before a user submission')},legacyConnection:{bridgeUrl:'http://127.0.0.1:1',bridgeToken:'fixture-only',mcpServerPath:path.join(root,'mcp.js')}})
  assert.equal(assembly.defaultDriverId,'dsh')
  assert.deepEqual(backends.map(row=>row.description.id),['dsh','codex','qoder-cn'])
  assert.ok(backends.every(row=>row.description.capabilities.browserOnly===false),'Input preflight remains mandatory for every driver')
  assert.ok(assembly.pagePath.endsWith('/assistant.html'));assert.ok(assembly.preloadPath.endsWith('/assistant-preload.cjs'))
  assert.equal(backends[0].readLegacySessions!==undefined,true)
  await Promise.all(backends.map(row=>row.close()))
  assert.throws(()=>createBmwAgentAssembly({...options,qoder:{configDirectory:'relative'}}),/absolute/)
  const overlap=createBmwAgentAssembly({...options,qoder:{configDirectory:options.codex.configDirectory}})
  assert.throws(()=>overlap.createBackends({...settings,userDataDirectory:root,projects:()=>[],connection:async()=>{assert.fail('No connection')},legacyConnection:{bridgeUrl:'http://127.0.0.1:1',bridgeToken:'fixture-only',mcpServerPath:path.join(root,'mcp.js')}}),/independent profile/)
})
test('BMW default composition derives profiles from its overridden userData and rejects physical aliases',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-assembly-default-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const settings={model:()=>null,setModel:()=>{},nodeExecutable:process.execPath,definition:{name:'browser' as const,description:'fixture',inputSchema:{}},userDataDirectory:root,projects:()=>[],connection:async()=>assert.fail('Composition cannot connect'),legacyConnection:{bridgeUrl:'http://127.0.0.1:1',bridgeToken:'fixture-only',mcpServerPath:path.join(root,'mcp.js')}}
  const defaultAssembly=createBmwAgentAssembly(),backends=defaultAssembly.createBackends(settings)
  assert.deepEqual(backends.map(row=>row.description.id),['dsh','codex','qoder-cn']);assert.equal(fs.existsSync(path.join(root,'agent-drivers')),false,'Construction must not start or initialize provider processes')
  await Promise.all(backends.map(row=>row.close()))
  const original=path.join(root,'physical-profile'),alias=path.join(root,'aliased-profile');fs.mkdirSync(original);fs.symlinkSync(original,alias,'dir')
  const assembly=createBmwAgentAssembly({codex:{configDirectory:original},qoder:{configDirectory:alias}})
  assert.throws(()=>assembly.createBackends(settings),/independent profile/)
})
