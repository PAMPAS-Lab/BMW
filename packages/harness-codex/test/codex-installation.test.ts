import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {findCodexExecutable,rememberCodexExecutable,bundledCodexExecutable} from '../src/codex-installation.js'
import {CodexBackend} from '../src/codex-backend.js'
test('Codex public CLI discovery resolves executable files and an explicit missing installation never falls back',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-codex-installation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const cli=path.join(root,process.platform==='win32'?'codex.exe':'codex');fs.writeFileSync(cli,'fixture executable',{mode:0o700})
  assert.equal(findCodexExecutable({bundled:null,env:{PATH:root},installations:[]}),fs.realpathSync(cli))
  assert.equal(findCodexExecutable({bundled:null,env:{PATH:''},installations:[cli]}),fs.realpathSync(cli))
  assert.equal(findCodexExecutable({bundled:null,env:{PATH:root,BMW_CODEX_EXECUTABLE:path.join(root,'missing')},installations:[cli]}),null)
  assert.throws(()=>findCodexExecutable({bundled:null,env:{BMW_CODEX_EXECUTABLE:'relative'},installations:[]}),/absolute/)
})
test('Codex retains only an admitted executable across restarts, with explicit recovery and private bounded pins',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-codex-pin-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const preferred=path.join(root,'preferred'),other=path.join(root,'codex');for(const file of [preferred,other])fs.writeFileSync(file,'fixture',{mode:0o700})
 rememberCodexExecutable(root,preferred)
 assert.equal(findCodexExecutable({bundled:null,env:{PATH:root},configDirectory:root}),fs.realpathSync(preferred))
 assert.equal(findCodexExecutable({bundled:null,env:{PATH:root,BMW_CODEX_EXECUTABLE:other},configDirectory:root}),fs.realpathSync(other))
 fs.rmSync(preferred);assert.throws(()=>findCodexExecutable({bundled:null,env:{PATH:root},configDirectory:root}),/已不可用/)
 fs.writeFileSync(path.join(root,'bmw-executable.json'),'{}');assert.throws(()=>findCodexExecutable({bundled:null,env:{PATH:root},configDirectory:root}),/Invalid/)
 fs.rmSync(path.join(root,'bmw-executable.json'));fs.symlinkSync(other,path.join(root,'bmw-executable.json'));assert.throws(()=>findCodexExecutable({bundled:null,env:{PATH:root},configDirectory:root}),/Invalid/)
 fs.rmSync(other);assert.throws(()=>findCodexExecutable({bundled:null,env:{PATH:root},configDirectory:root}),/Invalid/,'A broken symlink must not fall through to discovery')
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

test('BMW uses its lockfile Codex before older pins and PATH without bypassing explicit recovery',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-codex-upgrade-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const old=path.join(root,'old'),current=path.join(root,'current');for(const file of [old,current])fs.writeFileSync(file,'fixture',{mode:0o700})
 rememberCodexExecutable(root,old);assert.equal(findCodexExecutable({bundled:current,configDirectory:root,env:{PATH:root}}),current)
 fs.rmSync(old);assert.equal(findCodexExecutable({bundled:current,configDirectory:root,env:{PATH:root}}),current,'An obsolete binary can be removed once its managed replacement exists')
 assert.equal(findCodexExecutable({bundled:current,configDirectory:root,env:{BMW_CODEX_EXECUTABLE:old}}),null,'An explicit missing override still fails closed')
 fs.writeFileSync(path.join(root,'bmw-executable.json'),'{}');assert.throws(()=>findCodexExecutable({bundled:current,configDirectory:root}),/Invalid/)
 assert.ok(bundledCodexExecutable(),'npm installs the official native Codex dependency')
})
