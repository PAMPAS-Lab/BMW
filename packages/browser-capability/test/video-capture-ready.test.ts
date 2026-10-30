import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareVideoCapture,capturePreparationPolicy} from '../src/video-capture-ready.js'
const ready={width:1920,height:1080,readyState:4,durationSeconds:28,bufferedStartSeconds:0,bufferedEndSeconds:28,requested:'hd1080'}
test('Current-position warmup requires the future window at that position, not a stale initial buffer',async()=>{
 await assert.rejects(prepareVideoCapture({read:async()=>({...ready,currentTimeSeconds:60,durationSeconds:180,bufferedStartSeconds:0,bufferedEndSeconds:29}),pause:async()=>{}},new AbortController().signal,0,29),/MEDIA_CAPTURE_BUFFERING/)
 const state=await prepareVideoCapture({read:async()=>({...ready,currentTimeSeconds:60,durationSeconds:180,bufferedStartSeconds:50,bufferedEndSeconds:89}),pause:async()=>{}},new AbortController().signal,1000,29)
 assert.equal(state.currentTimeSeconds,60)
})
test('Preparation waits for actual buffered video and pauses before capture can start',async()=>{const calls:string[]=[],result=await prepareVideoCapture({read:async start=>{calls.push(String(start));return ready},pause:async()=>{calls.push('paused')}},new AbortController().signal);assert.equal(result.width,1920);assert.deepEqual(calls,['true','false','paused'])})
test('Unbuffered or zero-size players do not masquerade as ready; timeout drains playback',async()=>{let paused=false;await assert.rejects(prepareVideoCapture({read:async()=>({...ready,width:0,bufferedEndSeconds:2}),pause:async()=>{paused=true}},new AbortController().signal,0),/MEDIA_CAPTURE_BUFFERING/);assert.equal(paused,true)})
test('Cancellation during warmup awaits pause and never returns readiness',async()=>{const c=new AbortController();let paused=false;await assert.rejects(prepareVideoCapture({read:async()=>{c.abort();return {...ready,bufferedEndSeconds:2}},pause:async()=>{paused=true}},c.signal),/abort/i);assert.equal(paused,true)})


test('A short capture needs a bounded startup lead and rejects a source without it',async()=>{
 let paused=false
 const result=await prepareVideoCapture({read:async()=>({...ready,durationSeconds:180,bufferedEndSeconds:10}),pause:async()=>{paused=true}},new AbortController().signal,1000,10)
 assert.equal(result.bufferedEndSeconds,10);assert.equal(paused,true)
 await assert.rejects(prepareVideoCapture({read:async()=>({...ready,durationSeconds:180,bufferedEndSeconds:2}),pause:async()=>{}},new AbortController().signal,0,10),/MEDIA_CAPTURE_BUFFERING.*requiredLead=3/)
})

test('Progressive 29-second capture admits a short future buffer instead of requiring the entire clip in memory',async()=>{
 const policy=capturePreparationPolicy(29000);assert.equal(policy.windowSeconds,29);assert.equal(policy.qualityLevels[0],'hd720');let reads=0,paused=false
 const result=await prepareVideoCapture({read:async()=>{reads++;return {...ready,durationSeconds:143,bufferedEndSeconds:10.36}},pause:async()=>{paused=true}},new AbortController().signal,1000,policy.windowSeconds)
 assert.equal(reads,2);assert.equal(result.bufferedEndSeconds,10.36);assert.equal(result.startupLeadSeconds,3);assert.equal(paused,true)
 assert.equal(capturePreparationPolicy(12000).windowSeconds,12);assert.equal(capturePreparationPolicy(45000).windowSeconds,30)
 for(const value of [0,999,NaN,1800001])assert.throws(()=>capturePreparationPolicy(value))
})
test('A fully consumed player cannot satisfy startup readiness at its endpoint',async()=>{
 await assert.rejects(prepareVideoCapture({read:async()=>({...ready,currentTimeSeconds:28}),pause:async()=>{}},new AbortController().signal,0,29),/MEDIA_CAPTURE_BUFFERING.*position=28/)
})
