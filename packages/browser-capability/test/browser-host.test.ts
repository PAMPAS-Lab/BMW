import assert from 'node:assert/strict'
import test from 'node:test'
import {assertBrowserActionContext} from '../src/browser-host.js'
import {BrowserCapabilityRegistry} from '../src/browser-capability-registry.js'
import type {BrowserActionContext} from '../src/browser-host.js'

function fixture():BrowserActionContext{return {actor:'user',browserKernel:{projectStore:{active:()=>({id:'p',name:'P',directory:'/isolated/project'})},recordingController:{compose:async()=>({}),narrate:async()=>({}),processArtifact:async()=>({})},execute:async()=>({})}}}
test('Feature dispatch admits the host port and forwards actor, Project and cancellation without replacing them',async()=>{
  const context=fixture(),abort=new AbortController();context.signal=abort.signal;context.sessionOwner={projectId:'p',sessionId:'session-a'}
  const registry=new BrowserCapabilityRegistry({id:'fixture',name:'BMW',features:[{id:'fixture',browserActions:[{action:'fixture.read',description:'Read.',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false},execute(host){assert.equal(host,context);assert.equal(host.signal,abort.signal);assert.equal(host.sessionOwner?.sessionId,'session-a');return host.browserKernel.projectStore.active().id}}]}]})
  assert.deepEqual(await registry.execute('fixture.read',context,{action:'fixture.read'}),{handled:true,value:'p'})
  abort.abort();assert.equal(assertBrowserActionContext(context).signal?.aborted,true)
  await assert.rejects(registry.execute('fixture.read',{...context,actor:'shell'},{action:'fixture.read'}),/context/)
  await assert.rejects(registry.execute('fixture.read',{browserKernel:{projectStore:context.browserKernel.projectStore}},{action:'fixture.read'}),/host port/)
  assert.throws(()=>assertBrowserActionContext({...context,signal:{aborted:false}}),/signal/)
  assert.throws(()=>assertBrowserActionContext({...context,sessionOwner:{projectId:'p',sessionId:''}}),/Session owner/)
})
