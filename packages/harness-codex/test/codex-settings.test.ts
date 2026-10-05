import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {CodexSettings} from '../src/codex-settings.js'
import type {CodexRpc} from '../src/codex-rpc.js'
function fixture(t:import('node:test').TestContext,authenticated=true){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-codex-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const calls:{method:string;params:unknown}[]=[],notifications=new Set<(method:string,value:unknown)=>void>()
  let selected:string|null=null,closed=0,verifications=0
  const rpc:CodexRpc={async call(method,params){
    calls.push({method,params})
    if(method==='initialize')return {}
    if(method==='account/read')return {account:authenticated?{type:'chatgpt',email:'never-projected@example.invalid'}:null,requiresOpenaiAuth:true}
    if(method==='model/list'){const cursor=(params as {cursor:string|null}).cursor;return {data:cursor?[{model:'gpt-5.5',displayName:'GPT-5.5',description:'Official model'},{model:'future-unsupported',displayName:'Future',description:'Not admitted'}]:[{model:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',description:'Official model'}],nextCursor:cursor?null:'page-2'}}
    if(method==='account/login/start'){for(const listener of notifications)listener('account/login/completed',{loginId:'other',success:false});return {type:'chatgpt',loginId:'login-1',authUrl:'https://auth.openai.com/authorize?fixture=1'}}
    if(method==='account/login/cancel'||method==='account/logout')return {}
    assert.fail('No turn or arbitrary RPC may run in settings: '+method)
  },notify(){},onNotification(listener){notifications.add(listener);return()=>{notifications.delete(listener)}},onRequest(){},onFailure(){},async close(){closed++}}
  const port=new CodexSettings({executable:path.join(root,'codex'),configDirectory:root,definition:{name:'browser',description:'BMW',inputSchema:{}},model:()=>selected,setModel:value=>{selected=value},rpcFactory:()=>rpc,gate:{async verify(){verifications++;assert.fail('Model selection must not start a catalog preflight')}}})
  return {port,rpc,calls,notifications,login:()=>{authenticated=true},verifications:()=>verifications,selected:()=>selected,closed:()=>closed}
}
test('Codex settings project official paginated models and account status without model input or account metadata',async t=>{
  const f=fixture(t),state=await f.port.execute({action:'refresh'},{signal:new AbortController().signal,openExternal:async()=>assert.fail('Refresh cannot open login')})
  assert.deepEqual(state.models.map(row=>row.id),['gpt-6.1-sol','gpt-5.5']);assert.ok(state.models.every(row=>row.availability==='verified'));assert.equal(state.authentication.state,'ready');assert.equal(state.selectedModel,null)
  assert.equal(JSON.stringify(state).includes('example.invalid'),false);assert.equal(f.closed(),0)
  await f.port.drain();assert.equal(f.closed(),1)
  assert.deepEqual(f.calls.map(row=>row.method),['initialize','account/read','model/list','model/list'])
})
test('Codex never commits a verified model while its native settings process fails to close',async t=>{
  const f=fixture(t),close=f.rpc.close.bind(f.rpc);let attempts=0
  f.rpc.close=async()=>{if(++attempts===1)throw new Error('Fixture close failed');await close()}
  await assert.rejects(f.port.execute({action:'model.select',modelId:'gpt-6.1-sol'},{signal:new AbortController().signal,openExternal:async()=>{}}),/close failed/)
  assert.equal(f.selected(),null);assert.equal(f.port.busy,true);await f.port.drain();assert.equal(f.port.busy,false);assert.equal(f.selected(),null)
})
test('Codex selects maintained supported models without user preflight and rejects unsupported catalog entries',async t=>{
  const f=fixture(t),context={signal:new AbortController().signal,openExternal:async()=>{}}
  await assert.rejects(f.port.execute({action:'model.select',modelId:'foreign'},context),/unavailable/);await f.port.drain();assert.equal(f.selected(),null)
  await assert.rejects(f.port.execute({action:'model.select',modelId:'future-unsupported'},context),/unavailable/);await f.port.drain();assert.equal(f.selected(),null)
  const accepted=await f.port.execute({action:'model.select',modelId:'gpt-5.5'},context);assert.equal(f.selected(),'gpt-5.5');assert.equal(accepted.models[1].availability,'verified');await f.port.drain();assert.equal(f.verifications(),0)
})
test('Codex browser login completes only for its login ID and admits an official origin',async t=>{
  const f=fixture(t,false),context={signal:new AbortController().signal,openExternal:async()=>{}}
  const cold=await f.port.execute({action:'refresh'},context);assert.equal(cold.authentication.state,'required');assert.deepEqual(cold.models,[]);assert.equal(cold.loginMethods[0].id,'chatgpt');await f.port.drain()
  await assert.rejects(f.port.execute({action:'model.select',modelId:'gpt-5.5'},context),/unavailable/);await f.port.drain()
  const state=await f.port.execute({action:'auth.login',methodId:'chatgpt',values:{}},{signal:new AbortController().signal,openExternal:async url=>{
    assert.equal(new URL(url).hostname,'auth.openai.com')
    f.login()
    for(const listener of f.notifications){listener('account/login/completed',{loginId:'other',success:false});listener('account/login/completed',{loginId:'login-1',success:true})}
  }})
  assert.equal(state.authentication.state,'ready');assert.equal(f.calls.some(row=>row.method==='account/login/cancel'),false);await f.port.drain()
  assert.deepEqual(state.models.map(row=>row.id),['gpt-6.1-sol','gpt-5.5'])
  await f.port.execute({action:'model.select',modelId:'gpt-5.5'},context);await f.port.drain();assert.equal(f.selected(),'gpt-5.5');assert.equal(f.verifications(),0)
})
test('Cancelling Codex login cancels the native operation and never selects a model',async t=>{
  const f=fixture(t),controller=new AbortController()
  await assert.rejects(f.port.execute({action:'auth.login',methodId:'chatgpt',values:{}},{signal:controller.signal,openExternal:async()=>{controller.abort()}}),/cancelled/)
  assert.equal(f.calls.some(row=>row.method==='account/login/cancel'),true);assert.equal(f.selected(),null);await f.port.drain()
})
