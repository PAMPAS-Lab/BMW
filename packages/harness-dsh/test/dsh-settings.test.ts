import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {DshSettings,dshModelRoute} from '../src/dsh-settings.js'
import {DshRuntime} from '../src/dsh-runtime.js'
import {prepareProductDshHome} from '../src/dsh-preset.js'
import type {DshValue} from '../src/dsh-transport.js'
test('Owned DSH initialization privately copies provider credentials and never rewrites their source',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-dsh-credentials-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const sourceHome=path.join(root,'source'),productHome=path.join(root,'bmw'),workspacePath=path.join(root,'workspace');fs.mkdirSync(sourceHome);fs.mkdirSync(productHome)
  const original=path.join(sourceHome,'.credentials.yaml'),owned=path.join(productHome,'.credentials.yaml');fs.writeFileSync(original,'fixture: retained\n')
  const options={sourceHome,productHome,workspacePath,presetSourceDirectory:path.resolve('packages/harness-dsh/dsh/preset/base')}
  prepareProductDshHome(options)
  assert.equal(fs.lstatSync(owned).isSymbolicLink(),false);assert.equal(fs.statSync(owned).mode&0o777,0o600)
  fs.writeFileSync(owned,'fixture: changed only in BMW\n');assert.equal(fs.readFileSync(original,'utf8'),'fixture: retained\n')
  prepareProductDshHome(options);assert.equal(fs.readFileSync(owned,'utf8'),'fixture: changed only in BMW\n')
})
test('A dangling legacy DSH credential link fails closed before official writes can follow it',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-dsh-credentials-missing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const sourceHome=path.join(root,'source'),productHome=path.join(root,'bmw');fs.mkdirSync(sourceHome);fs.mkdirSync(productHome)
  const missing=path.join(sourceHome,'.credentials.yaml'),owned=path.join(productHome,'.credentials.yaml');fs.symlinkSync(missing,owned)
  assert.throws(()=>prepareProductDshHome({sourceHome,productHome,workspacePath:path.join(root,'workspace'),presetSourceDirectory:path.resolve('packages/harness-dsh/dsh/preset/base')}),/Migrate the linked/)
  assert.equal(fs.lstatSync(owned).isSymbolicLink(),true);assert.equal(fs.existsSync(missing),false)
})
test('DSH settings use official redacted control APIs and preserve exact model routes',async()=>{
  let configured=false,selected:string|null=null,stopped=0
  const writes:{method:string;payload:Record<string,unknown>}[]=[]
  class Runtime extends DshRuntime {
    async start(){return 'fixture://dsh'}
    async stopAndWait(){stopped++}
    async call(method:string,payload:Record<string,unknown>={}):Promise<DshValue>{
      const args=payload.args as Record<string,unknown>
      if(method==='settings/describe')return {namespaces:[{value:{apiKey:'DEEPSEEK_API_KEY'}}]}
      if(method==='credentials/describe')return {DEEPSEEK_API_KEY:{configured,writable:true},OTHER_API_KEY:{configured:true,writable:true}}
      if(method==='credentials/set'){writes.push({method,payload:args});configured=true;return {}}
      if(method==='credentials/unset'){writes.push({method,payload:args});configured=false;return {}}
      if(method==='session/modelCatalog')return {groups:[{id:'deepseek-official',name:'DeepSeek',models:[{id:'deepseek-flash',name:'Flash'},{id:'deepseek-future',name:'Not admitted'}]}]}
      assert.fail('No model prompt or arbitrary settings mutation: '+method)
    }
  }
  const port=new DshSettings({createRuntime:()=>new Runtime({}),model:()=>selected,setModel:id=>{selected=id}}),context={signal:new AbortController().signal,openExternal:async()=>assert.fail('No browser login')}
  const first=await port.execute({action:'refresh'},context);assert.equal(first.authentication.state,'required');await port.drain()
  assert.equal(first.models.length,1);assert.equal(first.models[0].availability,'verified')
  await assert.rejects(port.execute({action:'model.select',modelId:first.models[0].id},context),/unavailable/);await port.drain();assert.equal(selected,null)
  const loggedIn=await port.execute({action:'auth.login',methodId:'credential:DEEPSEEK_API_KEY',values:{apiKey:'fixture-one-shot-secret'}},context)
  assert.equal(loggedIn.authentication.state,'ready');assert.equal(JSON.stringify(loggedIn).includes('fixture-one-shot-secret'),false);await port.drain()
  await assert.rejects(port.execute({action:'model.select',modelId:'["foreign","model"]'},context),/unavailable/);await port.drain();assert.equal(selected,null)
  const route=first.models[0].id;await port.execute({action:'model.select',modelId:route},context);await port.drain()
  assert.deepEqual(dshModelRoute(selected!),{provider:'deepseek-official',model:'deepseek-flash'})
  await port.execute({action:'auth.logout'},context);await port.drain();assert.equal(configured,false);assert.equal(stopped,6)
  assert.deepEqual(writes.map(row=>row.method),['credentials/set','credentials/unset'])
  assert.deepEqual(writes.map(row=>row.payload.ref),['DEEPSEEK_API_KEY','DEEPSEEK_API_KEY'])
})
