import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {QoderSettings} from '../src/qoder-settings.js'
import type {QoderSettingsOptions} from '../src/qoder-settings.js'
import type {Options} from '@qodercn-ai/qodercn-agent-sdk'
const init={type:'system',subtype:'init',session_id:'fixture-settings',qodercli_version:'1.1.64',tools:['browser'],skills:[],plugins:[],mcp_servers:[{name:'bmw',status:'connected'}]}
function fixture(t:import('node:test').TestContext,unexpected=false,failClose=false){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-qoder-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  let selected:string|null=null,options:Options|undefined,closed=0,modelChanges=0,releasedInputs=0
  const factory:NonNullable<QoderSettingsOptions['queryFactory']>=input=>{
    let release!:()=>void
    const stopped=new Promise<void>(yes=>{release=yes})
    options=input.options
    const inputs=(async()=>{for await(const _message of input.prompt)releasedInputs++})()
    return {async *[Symbol.asyncIterator](){yield init;if(unexpected)yield {type:'assistant',message:{content:[]}};await stopped},async accountInfo(){return {userId:'fixture-account',email:'private@example.invalid'}},async getAvailableModels(){return [{value:'auto',displayName:'Auto',description:'Official',isEnabled:true},{value:'qmodel',displayName:'Disabled',description:'Official',isEnabled:false},{value:'future-model',displayName:'Unknown',description:'Official',isEnabled:true}]},async setModel(){modelChanges++},async close(){closed++;if(failClose&&closed===1)throw new Error('Fixture native cleanup failed');release();await inputs}}
  }
  const port=new QoderSettings({configDirectory:root,connection:{bridgeUrl:'http://127.0.0.1:1',bridgeToken:'fixture-token',mcpServerPath:path.join(root,'mcp.js'),nodeExecutable:process.execPath},model:()=>selected,setModel:value=>{selected=value},queryFactory:factory})
  return {port,options:()=>options,closed:()=>closed,selected:()=>selected,modelChanges:()=>modelChanges,releasedInputs:()=>releasedInputs}
}
test('Qoder settings discover the official models with no persistent session or released user input',async t=>{
  const f=fixture(t),result=await f.port.execute({action:'refresh'},{signal:new AbortController().signal,openExternal:async()=>assert.fail('No login')})
  assert.equal(result.authentication.state,'ready');assert.deepEqual(result.models.map(row=>row.id),['auto']);assert.equal(result.models[0].availability,'verified')
  assert.equal(JSON.stringify(result).includes('private@example.invalid'),false)
  assert.equal(f.options()?.persistSession,false);assert.deepEqual(f.options()?.tools,[]);assert.deepEqual(f.options()?.settingSources,[])
  assert.equal(f.modelChanges(),0);assert.ok(f.closed()>0);assert.equal(f.port.busy,false);assert.equal(f.releasedInputs(),0);await f.port.drain()
})
test('Qoder selection checks the official model catalog and does not persist a disabled model',async t=>{
  const f=fixture(t),context={signal:new AbortController().signal,openExternal:async()=>{}}
  for(const modelId of ['qmodel','future-model']){await assert.rejects(f.port.execute({action:'model.select',modelId},context),/unavailable/);await f.port.drain();assert.equal(f.selected(),null);assert.equal(f.modelChanges(),0)}
  const result=await f.port.execute({action:'model.select',modelId:'auto'},context);assert.equal(f.options()?.model,'auto');assert.equal(f.selected(),'auto');assert.equal(result.models[0].availability,'verified');await f.port.drain()
})
test('Unexpected Qoder model work in a settings control session fails before preference writes',async t=>{
  const f=fixture(t,true)
  await assert.rejects(f.port.execute({action:'model.select',modelId:'auto'},{signal:new AbortController().signal,openExternal:async()=>{}}),/unexpected model work/)
  // A control acknowledgement can arrive before its queued event is consumed.
  // The isolated control model changed, but BMW must not commit that selection.
  assert.equal(f.modelChanges(),1);assert.equal(f.selected(),null);assert.equal(f.releasedInputs(),0);await f.port.drain()
})
test('Qoder preference commit waits for actual cleanup and a failed close retains recovery ownership',async t=>{
  const f=fixture(t,false,true)
  await assert.rejects(f.port.execute({action:'model.select',modelId:'auto'},{signal:new AbortController().signal,openExternal:async()=>{}}),/cleanup failed/)
  assert.equal(f.selected(),null);assert.equal(f.port.busy,true)
  await f.port.drain();assert.equal(f.port.busy,false);assert.equal(f.selected(),null);assert.equal(f.releasedInputs(),0)
})
test('Qoder cold zero-turn login failure exposes login controls; execution results are still rejected',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-qoder-no-login-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  for(const numTurns of [0,1]){
    let inputs=0,closed=0
    const port=new QoderSettings({configDirectory:root,connection:{bridgeUrl:'http://127.0.0.1:1',bridgeToken:'fixture-token',mcpServerPath:path.join(root,'mcp.js'),nodeExecutable:process.execPath},model:()=>null,setModel:()=>assert.fail('No model preference'),queryFactory(input){
      let release!:()=>void;const stopped=new Promise<void>(resolve=>{release=resolve}),reader=(async()=>{for await(const _message of input.prompt)inputs++})()
      return {async *[Symbol.asyncIterator](){yield {type:'result',subtype:'error_during_execution',num_turns:numTurns,total_cost_usd:0,errors:['No qodercli login found. Run "qodercli login" first.']};await stopped},accountInfo:async()=>assert.fail('No account control before init'),getAvailableModels:async()=>assert.fail('No catalog before init'),setModel:async()=>assert.fail('No selection before init'),async close(){closed++;release();await reader}}
    }})
    const operation=port.execute({action:'refresh'},{signal:new AbortController().signal,openExternal:async()=>assert.fail('No login launched')})
    if(numTurns===0){const result=await operation;assert.equal(result.authentication.state,'required');assert.deepEqual(result.models,[]);assert.equal(result.loginMethods[0].id,'qoder-cli')}
    else await assert.rejects(operation,/unexpected model work/)
    await port.drain();assert.equal(port.busy,false);assert.ok(closed>0);assert.equal(inputs,0)
  }
})
