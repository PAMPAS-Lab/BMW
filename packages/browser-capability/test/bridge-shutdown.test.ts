import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
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


test('Native diagram preparation returns hash-bound Project PNG images through the same guarded Bridge admission',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-diagram-bridge-'))),directory=path.join(root,'artifacts');fs.mkdirSync(directory)
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ0kAAAAASUVORK5CYII=','base64'),file=path.join(directory,'native.png');fs.writeFileSync(file,png);let foreign=false,badHash=false
 const bridge=await createBridgeServer({execute:async()=>({frames:[{type:'screenshot',path:foreign?path.join(root,'outside.png'):file,artifactId:'native.png',sha256:badHash?'0'.repeat(64):crypto.createHash('sha256').update(png).digest('hex')}]})},{resolveProject:()=>({id:'p',directory:root}),activeProjectId:()=> 'p'})
 const binding=bridge.registerSession('s',root)
 const call=async(operation:string)=>{const response=await fetch(bridge.url+'/execute',{method:'POST',headers:{authorization:'Bearer '+bridge.token,'content-type':'application/json'},body:JSON.stringify({binding,arguments:{action:'video.studio',studioRequest:{operation:'news-preparation',draftId:'d',expectedRevision:1,preparationRequest:{operation,sceneId:'mechanism'}}}})});return await response.json() as {ok:boolean;images?:unknown[];error?:string}}
 try{
  for(const operation of ['prepare-diagram','read-diagram']){const reply=await call(operation);assert.equal(reply.ok,true);assert.equal(reply.images?.length,1)}
  assert.equal((await call('preflight')).images?.length,0,'metadata operations do not expand image admission')
  badHash=true;assert.match((await call('read-diagram')).error??'',/PNG changed/);badHash=false;foreign=true;fs.writeFileSync(path.join(root,'outside.png'),png);assert.match((await call('read-diagram')).error??'',/outside its Project/)
 }finally{await bridge.close();fs.rmSync(root,{recursive:true,force:true})}
})
