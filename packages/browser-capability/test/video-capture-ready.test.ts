import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareVideoCapture} from '../src/video-capture-ready.js'
const ready={width:1920,height:1080,readyState:4,durationSeconds:28,bufferedStartSeconds:0,bufferedEndSeconds:28,requested:'hd1080'}
test('Preparation waits for actual buffered video and pauses before capture can start',async()=>{const calls:string[]=[],result=await prepareVideoCapture({read:async start=>{calls.push(String(start));return ready},pause:async()=>{calls.push('paused')}},new AbortController().signal);assert.equal(result.width,1920);assert.deepEqual(calls,['true','false','paused'])})
test('Unbuffered or zero-size players do not masquerade as ready; timeout drains playback',async()=>{let paused=false;await assert.rejects(prepareVideoCapture({read:async()=>({...ready,width:0,bufferedEndSeconds:2}),pause:async()=>{paused=true}},new AbortController().signal,0),/MEDIA_CAPTURE_BUFFERING/);assert.equal(paused,true)})
test('Cancellation during warmup awaits pause and never returns readiness',async()=>{const c=new AbortController();let paused=false;await assert.rejects(prepareVideoCapture({read:async()=>{c.abort();return {...ready,bufferedEndSeconds:2}},pause:async()=>{paused=true}},c.signal),/abort/i);assert.equal(paused,true)})
