import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {saveCaptureIndex,readCaptureIndex,sampleCaptureSourceFrames} from '../src/capture-source-index.js'
import {CaptureWebm} from '../src/capture-webm.js'

test('Capture WebM retains explicit terminal VFR duration without a nominal frame-rate grid',async t=>{
 const {Input,BufferSource,WEBM,EncodedPacketSink}=await import('mediabunny'),root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-capture-duration-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const file=path.join(root,'capture.webm'),output=await fs.open(file,'wx+'),mux=new CaptureWebm(output,async()=>{})
 try{await mux.start(160,90,undefined,.389);await mux.add({track:1,timestamp:.023,duration:.112,type:'key',data:new Uint8Array([130,73,131,66,0])});await mux.add({track:1,timestamp:.135,duration:.254,type:'key',data:new Uint8Array([130,73,131,66,0])});await assert.rejects(mux.add({track:1,timestamp:-1,duration:1,type:'key',data:new Uint8Array()}),/bounds/)}finally{await output.close()}
 const input=new Input({source:new BufferSource(await fs.readFile(file)),formats:[WEBM]})
 try{const track=(await input.getPrimaryVideoTrack())!,packets=[];for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true}))packets.push(packet)
  assert.deepEqual(packets.map(p=>[p.timestamp,p.duration]),[[.023,.112],[.135,.254]]);assert.ok(Math.abs(await track.computeDuration()-.389)<.000001)
 }finally{input.dispose()}
})

test('Capture WebM preserves a terminal Opus packet with unknown duration while rejecting zero-duration video',async t=>{
 const {Input,BufferSource,WEBM,EncodedPacketSink}=await import('mediabunny'),root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-capture-opus-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const file=path.join(root,'capture.webm'),output=await fs.open(file,'wx+'),mux=new CaptureWebm(output,async()=>{}),header=Buffer.alloc(19);header.write('OpusHead');header[8]=1;header[9]=1;header.writeUInt32LE(48000,12)
 const payload=new Uint8Array([248,255,254])
 try{await mux.start(160,90,{codec:'opus',sampleRate:48000,numberOfChannels:1,description:header},.2);await mux.add({track:1,timestamp:0,duration:.2,type:'key',data:new Uint8Array([130,73,131,66,0])});await mux.add({track:2,timestamp:.12,duration:0,type:'key',data:payload});await assert.rejects(mux.add({track:1,timestamp:.2,duration:0,type:'key',data:payload}),/bounds/)}finally{await output.close()}
 const input=new Input({source:new BufferSource(await fs.readFile(file)),formats:[WEBM]})
 try{const track=(await input.getPrimaryAudioTrack())!,packets=[];for await(const p of new EncodedPacketSink(track).packets())packets.push(p);assert.equal(packets.length,1);assert.equal(packets[0]!.timestamp,.12);assert.equal(packets[0]!.duration,0);assert.deepEqual(packets[0]!.data,payload)}finally{input.dispose()}
})

test('Source PTS indexes reject file-clock substitution, unobserved gaps, stale media/PNGs and foreign Projects',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-source-index-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const video=Buffer.from('owned captured video bytes'),sha=(value:Uint8Array)=>crypto.createHash('sha256').update(value).digest('hex'),png=Buffer.alloc(24)
 Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(320,16);png.writeUInt32BE(180,20)
 await fs.writeFile(path.join(root,'capture.webm'),video)
 const created:string[]=[],base={version:1 as const,sourceArtifactId:'capture.webm',videoSha256:sha(video),basis:'requestVideoFrameCallback.mediaTime' as const,fileTimestampMapping:'unavailable' as const,sourceStartSeconds:0,sourceEndSeconds:60.046801,durationAtStartSeconds:60,sourceDurationSeconds:60.046801}
 await saveCaptureIndex(root,base,[{sourceTimestampSeconds:0,endSourceSeconds:.016,presentedFrames:1,width:320,height:180,data:png.toString('base64')},{sourceTimestampSeconds:59.96,endSourceSeconds:60.046801,presentedFrames:3599,width:320,height:180,data:png.toString('base64')}],null,created,async()=>{})
 const result=await sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[60.02]})
 assert.equal(result.frames[0]!.sourceTimestampSeconds,59.96);assert.equal(result.frames[0]!.fileTimestampSeconds,null);assert.equal(result.timebase,'source');assert.equal(result.fileTimestampMapping,'unavailable')
 await assert.rejects(sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[30]}),/CAPTURE_SOURCE_TIME_UNINDEXED/)
 await assert.rejects(sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[93.5]}),/CAPTURE_SOURCE_TIME_UNINDEXED/)
 await assert.rejects(sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'../capture.webm',sourceTimestampsSeconds:[0]}),/artifactId/)
 const other=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-source-foreign-'));t.after(()=>fs.rm(other,{recursive:true,force:true}));await fs.writeFile(path.join(other,'capture.webm'),video)
 await assert.rejects(sampleCaptureSourceFrames(other,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[0]}),/CAPTURE_SOURCE_INDEX_UNAVAILABLE/)
 const cancelled=new AbortController();cancelled.abort(new Error('source sampling cancelled'));await assert.rejects(readCaptureIndex(root,'capture.webm',cancelled.signal),/cancelled/)
 await fs.appendFile(path.join(root,'capture.webm.source-1.png'),'changed');await assert.rejects(sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[60.02]}),/CAPTURE_SOURCE_CHANGED/)
 await fs.appendFile(path.join(root,'capture.webm'),'changed');await assert.rejects(readCaptureIndex(root,'capture.webm'),/CAPTURE_SOURCE_CHANGED/)
})

test('Mapped captures select middle frames through pause and variable rate, verify decoded PTS and roll back failed PNGs',async t=>{
 const {saveMappedCaptureIndex}=await import('../src/capture-source-index.js')
 const {assertMappedIndex,assertPlaybackPlan}=await import('../src/capture-timeline.js')
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-source-mapped-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const video=Buffer.from('mapped video'),sha=(value:Uint8Array)=>crypto.createHash('sha256').update(value).digest('hex')
 await fs.writeFile(path.join(root,'capture.webm'),video)
 const frames=[0,1,2,3,4].map((sourceTimestampSeconds,i)=>({sourceTimestampSeconds,endSourceSeconds:i+1,fileTimestampSeconds:[.04,1.04,4.04,6.04,6.54][i]!,fileDurationSeconds:[1,3,2,.5,.016667][i]!,presentedFrames:i+1,playbackRate:i<2?1:i<3?.5:2}))
 const base={version:2 as const,sourceArtifactId:'capture.webm',videoSha256:sha(video),basis:'native-source-frame+encoded-packet+demuxed-PTS' as const,fileTimestampMapping:'verified' as const,sourceStartSeconds:0,sourceEndSeconds:5,durationAtStartSeconds:5,sourceDurationSeconds:5,status:'indexed' as const,reason:null,frames,playbackEvents:[{kind:'pause' as const,sourceSeconds:1.1,fileSeconds:1.14,rate:1},{kind:'play' as const,sourceSeconds:1.1,fileSeconds:3.14,rate:1}]}
 await saveMappedCaptureIndex(root,base,[],async()=>{})
 let counter=0
 const decode:import('../src/capture-source-index.js').CaptureFrameDecoder=async request=>({frames:await Promise.all(request.timestampsSeconds.map(async(time,outputIndex)=>{
  const artifactId='decoded-'+counter+++'.png',file=path.join(root,artifactId);await fs.writeFile(file,Buffer.from('verified worker PNG'))
  return {outputIndex,artifactId,path:file,bytes:19,timestampSeconds:time,durationSeconds:.016667,width:320,height:180,type:'screenshot',contentType:'image/png'}
 }))})
 const result=await sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[2.2,1.3,4.999]},undefined,decode)
 assert.equal(result.fileTimestampMapping,'verified');assert.equal(result.engine,'mediabunny-webcodecs-source-map')
 assert.deepEqual(result.frames.map(f=>[f.sourceTimestampSeconds,f.fileTimestampSeconds]),[[2,4.04],[1,1.04],[4,6.54]])
 assert.ok(result.frames.every(f=>f.sha256===sha(Buffer.from('verified worker PNG'))))
 await assert.rejects(sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[5]},undefined,decode),/CAPTURE_SOURCE_TIME_UNINDEXED/)
 const before=await fs.readdir(root)
 await assert.rejects(sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[2.4]},undefined,async request=>{const result=await decode(request);result.frames[0]!.timestampSeconds+=.01;return result}),/Decoded frame PTS/)
 assert.deepEqual(await fs.readdir(root),before)
 assert.throws(()=>assertMappedIndex({...base,frames:[frames[1],frames[0]]},'capture.webm'),/chronological|endpoint/)
 assert.throws(()=>assertMappedIndex({...base,frames:[{...frames[0],fileDurationSeconds:.1},...frames.slice(1)]},'capture.webm'),/continuous/)
 for(const plan of [[{sourceSeconds:1,rate:0}],[{sourceSeconds:1,pauseMs:10001}],[{sourceSeconds:2,rate:2},{sourceSeconds:1,rate:1}],[{sourceSeconds:1}],Array(17).fill({sourceSeconds:1,rate:2}),[{sourceSeconds:1,script:'alert(1)'}]])assert.throws(()=>assertPlaybackPlan(plan))
 assert.deepEqual(assertPlaybackPlan([{sourceSeconds:1,pauseMs:700,rate:.5}]),[{sourceSeconds:1,pauseMs:700,rate:.5}])
 // A live/maximum-duration stop can coincide exactly with the final presented
 // source frame. That encoded frame remains queryable at its exact PTS.
 await fs.writeFile(path.join(root,'capture.webm.source.json'),JSON.stringify({...base,sourceEndSeconds:4,frames:frames.map((f,i)=>i===4?{...f,endSourceSeconds:4}:f)}))
 const endpoint=await sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[4]},undefined,decode)
 assert.equal(endpoint.frames[0]!.sourceTimestampSeconds,4)
 await assert.rejects(sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[4.001]},undefined,decode),/CAPTURE_SOURCE_TIME_UNINDEXED/)
 await fs.appendFile(path.join(root,'capture.webm'),'tamper');await assert.rejects(sampleCaptureSourceFrames(root,{action:'media.capture.frames.sample',artifactId:'capture.webm',sourceTimestampsSeconds:[2]},undefined,decode),/CAPTURE_SOURCE_CHANGED/)
})
