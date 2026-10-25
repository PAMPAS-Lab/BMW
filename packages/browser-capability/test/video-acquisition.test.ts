import assert from 'node:assert/strict'
import test from 'node:test'
import {acquireVideoDelivery} from '../src/video-acquisition.js'
import type {VideoAcquisitionPort} from '../src/video-acquisition.js'
import type {VideoTarget} from '@bmw-agent/agent-contract/video-identity'
const target:VideoTarget={identity:{version:1,platform:'youtube',targetId:'zHBrUVyQJWc',resourceId:'zHBrUVyQJWc'},playerUrl:'https://www.youtube.com/watch?v=zHBrUVyQJWc',videoIndex:0,durationSeconds:28,resources:[{url:'https://example.test/observed',role:'sabr',durationSeconds:28,bitrate:1000,audioGroup:'',defaultAudio:true}]}
function setup(){const calls:string[]=[],port:VideoAcquisitionPort={verify:async()=>{calls.push('verify')},busy:()=>false,prepareCapture:async()=>{calls.push('quality');return {}},preserve:async()=>{calls.push('preserve');return {artifactId:'original.mp4'}},capture:async()=>{calls.push('capture');return {artifactId:'captured.webm'}}};return {calls,port}}
test('Direct preservation returns original encoding without starting playback or capture',async()=>{
 const {calls,port}=setup(),result=await acquireVideoDelivery(target,port,new AbortController().signal)
 assert.equal(result.method,'preserve');assert.equal(result.acquisition.reencoded,false);assert.deepEqual(calls,['verify','preserve'])
})
test('Download failure falls back only after preservation drained; public diagnostics omit delivery URLs',async()=>{
 const {calls,port}=setup();let busy=false
 port.preserve=async()=>{calls.push('preserve');busy=true;try{throw new Error('HTTP 403 https://secret.test/token')}finally{busy=false;calls.push('drained')}};port.busy=()=>busy
 const result=await acquireVideoDelivery(target,port,new AbortController().signal)
 assert.equal(result.method,'capture');assert.equal(result.acquisition.reencoded,true);assert.equal(result.acquisition.attempts[0].reason,'HTTP_403')
 assert.ok(calls.indexOf('capture')>calls.indexOf('drained'));assert.ok(calls.indexOf('quality')>calls.indexOf('drained'));assert.ok(!JSON.stringify(result).includes('secret'))
})
test('Cancellation, changed identity, and failed cleanup never start capture',async()=>{
 for(const failure of ['cancel','identity','cleanup']){
  const {calls,port}=setup(),controller=new AbortController()
  port.preserve=async()=>{if(failure==='cancel')controller.abort(new Error('cancelled'));throw new Error(failure==='identity'?'VIDEO_IDENTITY_CHANGED':'download failed')}
  if(failure==='cleanup')port.busy=()=>true
  await assert.rejects(acquireVideoDelivery(target,port,controller.signal));assert.ok(!calls.includes('capture'));assert.ok(!calls.includes('quality'))
 }
})
test('One shared native budget aborts download and awaits its cleanup before fallback',async()=>{
 const {calls,port}=setup()
 port.preserve=async(_url,signal)=>{await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));calls.push('drained');throw signal.reason}
 const hold=setTimeout(()=>{},1000)
 try{const result=await acquireVideoDelivery(target,port,new AbortController().signal,10);assert.equal(result.method,'capture');assert.equal(result.acquisition.attempts[0].reason,'DOWNLOAD_BUDGET_EXHAUSTED');assert.ok(calls.indexOf('capture')>calls.indexOf('drained'))}finally{clearTimeout(hold)}
})
test('Long or unknown sources require explicit archive handling; guards fail before acquiring',async()=>{
 const {calls,port}=setup()
 for(const durationSeconds of [null,1900])await assert.rejects(acquireVideoDelivery({...target,durationSeconds},port,new AbortController().signal),/MEDIA_ACQUIRE_FINITE/)
 port.verify=async()=>{throw new Error('Project changed')}
 await assert.rejects(acquireVideoDelivery(target,port,new AbortController().signal),/Project changed/);assert.deepEqual(calls,[])
})

test('Fallback failures retain the real guard error and bounded download reasons without signed URLs',async()=>{
 const {calls,port}=setup();port.preserve=async()=>{throw new Error('HTTP 403 https://secret.test/token')};port.prepareCapture=async()=>{throw new Error('VIDEO_IDENTITY_CHANGED: Player changed during buffering.')}
 await assert.rejects(acquireVideoDelivery(target,port,new AbortController().signal),error=>{assert.ok(error instanceof Error);assert.match(error.message,/VIDEO_IDENTITY_CHANGED/);assert.match(error.message,/Download attempts: sabr:HTTP_403:[0-9]+ms/);assert.ok(!error.message.includes('secret'));return true})
 assert.ok(!calls.includes('capture'))
})
