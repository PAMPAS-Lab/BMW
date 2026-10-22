import assert from 'node:assert/strict'
import test from 'node:test'
import { createBridgeServer } from '../src/bridge-server.js'

test('Bridge shutdown cancels the active renderer wait before draining FIFO', { timeout: 5000 }, async () => {
  let entered: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const bridge = await createBridgeServer({ async execute(_input, { signal } = {}) {
    entered()
    return new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } }, { resolveProject: directory => ({ id: 'p', directory }), activeProjectId: () => 'p' })
  const request = async (endpoint: string, body: unknown) => {
    const response = await fetch(`${bridge.url}/${endpoint}`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return await response.json() as { binding?: string; ok?: boolean; error?: string }
  }
  const binding=bridge.registerSession('s','/disposable-project')
  const pending=request('execute',{binding,arguments:{action:'media.screenshot'}})
  await started
  await bridge.close()
  const result = await pending
  assert.equal(result.ok, false)
  assert.match(result.error, /bridge shutting down/)
  assert.equal(bridge.busy, false)
})

test('Host scoped leases use their pinned executor and context without admitting a normal inactive lease',async()=>{
 let valid=true,frontCalls=0,backgroundCalls=0
 const bridge=await createBridgeServer({execute:async()=>{frontCalls++;return {foreground:true}}},{resolveProject:directory=>({id:directory==='/q'?'q':'p',directory}),activeProjectId:()=> 'q',sessionContext:(sessionId,projectId)=>({text:projectId+':'+sessionId})})
 const post=async(binding:string,endpoint='execute')=>{const response=await fetch(bridge.url+'/'+endpoint,{method:'POST',headers:{authorization:'Bearer '+bridge.token,'content-type':'application/json'},body:JSON.stringify({binding,arguments:{action:'status'}})});return await response.json() as {ok:boolean;result?:unknown;text?:string}}
 try{
  const normal=bridge.registerSession('ordinary','/p'),scoped=bridge.registerSession('background','/p',{valid:()=>valid,executor:{execute:async()=>{backgroundCalls++;return {pinned:true}}}})
  assert.equal((await post(normal)).ok,false)
  assert.deepEqual((await post(scoped)).result,{pinned:true})
  assert.equal((await post(scoped,'session/context')).text,'p:background')
  bridge.attachProviderSession(scoped,'fixture','provider')
  valid=false;assert.equal((await post(scoped)).ok,false)
  await bridge.releaseSession(scoped);valid=true;assert.equal((await post(scoped)).ok,false)
  assert.equal(backgroundCalls,1);assert.equal(frontCalls,0)
 }finally{await bridge.close()}
})
