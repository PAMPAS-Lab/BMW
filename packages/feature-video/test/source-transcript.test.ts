import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {MaterialIndexService} from '../src/material-index-service.js'
import {MaterialIndexStore} from '../src/material-index-store.js'
import {assertMaterialIndexRequest,materialIndexRequestSchema} from '../src/material-index-contract.js'
import {LOCAL_ASR_MODELS,LOCAL_ASR_MODEL_REVISION} from '../../media-native/src/local-asr-assets.js'
import {mediaRecord} from '../../media-native/src/media-contract.js'
import type {StudioKernel} from '../src/studio-service.js'
import {Ajv2020} from 'ajv/dist/2020.js'
const sha=(v:string|Uint8Array)=>crypto.createHash('sha256').update(v).digest('hex')
async function fixture(){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bmw-source-batch-'))),directory=path.join(root,'artifacts');await fs.mkdir(directory);await fs.writeFile(path.join(directory,'source.mp4'),'original source')
 const project={id:'batch-project',name:'Batch',directory:root},owner={projectId:project.id,sessionId:'batch-session'},durations=new Map([['source.mp4',1801]]);let segments=0,speech=0,frames=0,busy=false,beforeSpeech=async()=>{}
 const kernel:StudioKernel={projectStore:{active:()=>project},execute:async()=>({}),recordingController:{isCaptureActive:()=>busy,compose:async()=>({}),narrate:async()=>({}),processArtifact:async raw=>{
  const r=mediaRecord(raw),artifactId=String(r.artifactId),duration=durations.get(artifactId)??0
  if(r.action==='media.inspect')return {durationSeconds:duration,tracks:[{id:1,type:'video',codec:'avc',canDecode:true,width:640,height:360,startSeconds:0,endSeconds:duration},{id:2,type:'audio',codec:'aac',canDecode:true,startSeconds:0,endSeconds:duration}]}
  if(r.action==='media.image.inspect')return {width:640,height:360,contentType:'image/png',hasAlpha:false}
  if(r.action==='media.segment'){
   const range=mediaRecord(r.segmentRange),start=Number(range.startSeconds),end=Number(range.endSeconds),id=`work-${++segments}.mp4`,bytes='work source '+segments,proof={version:1,kind:'archive-segment',sourceArtifactId:artifactId,sourceSha256:sha(await fs.readFile(path.join(directory,artifactId))),artifactId:id,sha256:sha(bytes),sourceTimeOffsetSeconds:start,requestedSourceRange:{startSeconds:start,endSeconds:end},actualSourceRange:{startSeconds:start,endSeconds:end},durationSeconds:end-start,reencoded:false}
   durations.set(id,end-start);await fs.writeFile(path.join(directory,id),bytes);await fs.writeFile(path.join(directory,id+'.json'),JSON.stringify(proof));return {...proof,proofArtifactId:id+'.json'}
  }
  if(r.action==='media.frames.sample'){const rows=[];for(const seconds of r.timestampsSeconds as number[]){const id=`frame-${++frames}.png`;await fs.writeFile(path.join(directory,id),'frame'+frames);rows.push({artifactId:id,requestedTimestampSeconds:seconds,timestampSeconds:seconds,width:640,height:360})}return {type:'frame-set',sourceArtifactId:artifactId,frames:rows}}
  assert.equal(r.action,'media.speech.align');speech++;await beforeSpeech();const range=mediaRecord(r.sourceRange),seconds=Number(range.endSeconds)-Number(range.startSeconds),ids=['normalized-'+speech+'.wav','raw-'+speech+'.json','log-'+speech+'.json'];for(const id of ids)await fs.writeFile(path.join(directory,id),id)
  return {kind:'speech-evidence',provider:'whisper.cpp',engineVersion:'1.9.1',model:'base',language:'auto',modelRevision:LOCAL_ASR_MODEL_REVISION,modelSha256:LOCAL_ASR_MODELS.base.sha256,engineSha256:'a'.repeat(64),sourceArtifactId:artifactId,sourceSha256:sha(await fs.readFile(path.join(directory,artifactId))),normalizedArtifactId:ids[0],normalizedSha256:sha(ids[0]),rawArtifactId:ids[1],rawSha256:sha(ids[1]),logArtifactId:ids[2],logSha256:sha(ids[2]),sampleRate:16000,channels:1,sampleType:'pcm-s16le',downmix:'channel-mean',normalization:{kind:'speech-pcm',sampleRate:16000,channels:1,sampleType:'pcm-s16le',frames:seconds*16000,durationSeconds:seconds,inputSampleRate:44100,inputChannels:2,decodedStartSeconds:0,decodedEndSeconds:seconds,clippedSamples:0,downmix:'channel-mean',sourceRange:range,sourceDurationSeconds:duration},timeDomain:'normalized-interval-seconds',durationSeconds:seconds,elapsedSeconds:1,createdAt:'2026-10-23T00:00:00Z',segments:[],automaticTimingApproved:false,wordTimingAvailable:false}
 }}}
 const service=new MaterialIndexService(kernel,owner,'agent'),store=new MaterialIndexStore(project)
 const run=async(batchId?:string,maxSegments=8,signal?:AbortSignal)=>service.execute({operation:'transcribe-source',artifactId:'source.mp4',...(batchId?{batchId}:{}),expectedRevision:(await store.snapshot()).revision,maxSegments},signal)
 return {root,directory,kernel,owner,store,service,run,counts:()=>({segments,speech}),busy:(value:boolean)=>{busy=value},beforeSpeech:(fn:()=>Promise<void>)=>{beforeSpeech=fn},close:()=>fs.rm(root,{recursive:true,force:true})}
}
test('One bounded native source request segments locally, batches ASR, resumes committed units and reports full original-time coverage',async()=>{
 const f=await fixture();try{
  const first=mediaRecord(await f.run(undefined,1)),batch=mediaRecord(first.batch);assert.equal(batch.state,'pending');assert.equal(f.counts().segments,1);assert.equal(f.counts().speech,5);assert.equal((batch.uncoveredRanges as unknown[]).length,1)
  const final=mediaRecord(await f.run(String(batch.id))),done=mediaRecord(final.batch);assert.equal(done.state,'complete');assert.equal((done.uncoveredRanges as unknown[]).length,0);assert.equal(f.counts().segments,3);assert.equal(f.counts().speech,11);assert.equal((done.unrecognizedRanges as unknown[]).length,11);assert.match(String(done.authority),/not certified silence/)
  const before=f.counts();await f.run(String(batch.id));assert.deepEqual(f.counts(),before)
  const record=(await f.store.snapshot()).records[0];await fs.writeFile(path.join(f.directory,record.parts[0].evidenceArtifactId),'tampered evidence');await assert.rejects(f.run(String(batch.id)),/changed|hash|fingerprint|evidence/i)
 }finally{await f.close()}
})
test('Batch cancellation preserves completed ASR chunks, awaits cleanup and resumes only on an explicit new request',async()=>{
 const f=await fixture();try{
  const controller=new AbortController();f.beforeSpeech(async()=>{if(f.counts().speech===2){controller.abort(new Error('controlled cancellation'));controller.signal.throwIfAborted()}})
  await assert.rejects(f.run(undefined,8,controller.signal),/controlled cancellation/);const saved=await f.store.snapshot(),batch=saved.sourceBatches![0];assert.equal(batch.state,'interrupted');assert.equal(batch.inFlight,undefined);assert.equal(saved.records[0].parts.length,1);const before=f.counts();assert.equal(before.segments,1)
  f.beforeSpeech(async()=>{});await f.run(batch.id);assert.equal(f.counts().segments,3);assert.equal(f.counts().speech,12)
 }finally{await f.close()}
})
test('In-flight checkpoints require explicit recovery after native cleanup; foreign sessions and changed original bytes are refused',async()=>{
 const f=await fixture();try{
  const first=mediaRecord(await f.run(undefined,1)),id=String(mediaRecord(first.batch).id),catalog=await f.store.snapshot();await f.store.commit({...catalog,sourceBatches:catalog.sourceBatches!.map(b=>({...b,inFlight:'segment' as const}))},catalog.revision,()=>{})
  const before=f.counts();await assert.rejects(f.run(id),/UNCERTAIN/);assert.deepEqual(f.counts(),before)
  f.busy(true);await assert.rejects(f.service.execute({operation:'recover-source-batch',batchId:id,expectedRevision:(await f.store.snapshot()).revision}),/CLEANUP_REQUIRED/)
  f.busy(false);await f.service.execute({operation:'recover-source-batch',batchId:id,expectedRevision:(await f.store.snapshot()).revision});assert.deepEqual(f.counts(),before)
  const foreign=new MaterialIndexService(f.kernel,{...f.owner,sessionId:'foreign'},'agent');await assert.rejects(foreign.execute({operation:'source-batch-status',batchId:id}),/foreign/)
  await fs.writeFile(path.join(f.directory,'source.mp4'),'changed original');await assert.rejects(f.run(id),/SOURCE_CHANGED/)
 }finally{await f.close()}
})
test('Source batching is unavailable during news research and has a closed bounded request contract',async()=>{
 const f=await fixture();try{
  const preview=new MaterialIndexService(f.kernel,f.owner,'agent',true);await assert.rejects(preview.execute({operation:'transcribe-source',artifactId:'source.mp4',expectedRevision:0}),/PREVIEW_ONLY/);assert.deepEqual(f.counts(),{segments:0,speech:0})
  const validate=new Ajv2020({strict:false}).compile(materialIndexRequestSchema);assert.equal(validate({operation:'transcribe-source',artifactId:'source.mp4',expectedRevision:0,maxSegments:8}),true)
  for(const request of [{operation:'transcribe-source',artifactId:'source.mp4',expectedRevision:0,maxSegments:9},{operation:'source-batch-status',path:'/tmp/outside'},{operation:'transcribe-source',artifactId:'source.mp4',expectedRevision:0,model:'external'}])assert.throws(()=>assertMaterialIndexRequest(request))
 }finally{await f.close()}
})
