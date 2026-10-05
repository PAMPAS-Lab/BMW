import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {findCodexExecutable} from '../src/codex-installation.js'
import {CodexBackend} from '../src/codex-backend.js'
test('Codex public CLI discovery resolves executable files and an explicit missing installation never falls back',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-codex-installation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const cli=path.join(root,process.platform==='win32'?'codex.exe':'codex');fs.writeFileSync(cli,'fixture executable',{mode:0o700})
  assert.equal(findCodexExecutable({env:{PATH:root},installations:[]}),fs.realpathSync(cli))
  assert.equal(findCodexExecutable({env:{PATH:''},installations:[cli]}),fs.realpathSync(cli))
  assert.equal(findCodexExecutable({env:{PATH:root,BMW_CODEX_EXECUTABLE:path.join(root,'missing')},installations:[cli]}),null)
  assert.throws(()=>findCodexExecutable({env:{BMW_CODEX_EXECUTABLE:'relative'},installations:[]}),/absolute/)
})
test('A missing Codex installation keeps BMW settings available and rejects input before opening a connection',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-codex-missing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const previous=process.env.BMW_CODEX_EXECUTABLE;process.env.BMW_CODEX_EXECUTABLE=path.join(root,'missing')
  t.after(()=>{if(previous===undefined)delete process.env.BMW_CODEX_EXECUTABLE;else process.env.BMW_CODEX_EXECUTABLE=previous})
  const backend=new CodexBackend({configDirectory:root,model:'fixture-model',definition:{name:'browser',description:'Fixture',inputSchema:{}},setModel:()=>assert.fail('No preference write'),connection:async()=>assert.fail('Missing CLI cannot connect')})
  const signal=new AbortController().signal,value=await backend.settings({action:'refresh'},{signal,openExternal:async()=>assert.fail('No login')})
  assert.equal(value.authentication.state,'unknown');assert.match(value.authentication.label,/未找到 Codex/);assert.equal(value.models.length,0);assert.equal(value.loginMethods.length,0)
  await assert.rejects(backend.prepare({sessionId:'bmw',externalSessionId:null,runId:'run',messageId:'input',project:{id:'project',name:'Fixture',directory:root},text:'Do not send',context:'',signal}),/未找到 Codex/)
  await backend.drainSettings();await backend.close()
})
