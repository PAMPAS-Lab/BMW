import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {MaterialIndexStore} from '../src/material-index-store.js'
import {MaterialIndexService,pendingMaterialRanges} from '../src/material-index-service.js'
import {assertMaterialIndexRequest} from '../src/material-index-contract.js'
import {LOCAL_ASR_MODELS,LOCAL_ASR_MODEL_REVISION} from '../../media-native/src/local-asr-assets.js'
import {mediaRecord} from '../../media-native/src/media-contract.js'
import {assertSpeechSourceRange} from '../../media-native/src/speech-range.js'
import type {StudioKernel} from '../src/studio-service.js'
const hash=(data:Uint8Array|string)=>crypto.createHash('sha256').update(data).digest('hex')
async function fixture(durationSeconds=400,noSpeech=false){const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bmw-material-index-'))),artifacts=path.join(directory,'artifacts');await fs.mkdir(artifacts);const file=Buffer.from('Controlled source bytes');await fs.writeFile(path.join(artifacts,'long.wav'),file);let serial=0,beforeSpeech=async()=>{}
 const project={id:'index-project',name:'Index fixture',directory},kernel:StudioKernel={projectStore:{active:()=>project},execute:async()=>({}),recordingController:{compose:async()=>({}),narrate:async()=>({}),processArtifact:async raw=>{const r=mediaRecord(raw);if(r.action==='media.inspect')return {durationSeconds,tracks:[{id:1,type:'audio',codec:'pcm-s16',canDecode:true,startSeconds:0,endSeconds:durationSeconds}]};assert.equal(r.action,'media.speech.align');await beforeSpeech();const range=assertSpeechSourceRange(r.sourceRange),duration=range.endSeconds-range.startSeconds,ids=['normalized-'+(++serial)+'.wav','raw-'+serial+'.json','log-'+serial+'.json'];for(const id of ids)await fs.writeFile(path.join(artifacts,id),'New '+id)
  return {kind:'speech-evidence',provider:'whisper.cpp',engineVersion:'1.9.1',model:'base',language:'auto',modelRevision:LOCAL_ASR_MODEL_REVISION,modelSha256:LOCAL_ASR_MODELS.base.sha256,engineSha256:'a'.repeat(64),sourceArtifactId:'long.wav',sourceSha256:hash(file),normalizedArtifactId:ids[0],normalizedSha256:hash('New '+ids[0]),rawArtifactId:ids[1],rawSha256:hash('New '+ids[1]),logArtifactId:ids[2],logSha256:hash('New '+ids[2]),sampleRate:16000,channels:1,sampleType:'pcm-s16le',downmix:'channel-mean',normalization:{kind:'speech-pcm',sampleRate:16000,channels:1,sampleType:'pcm-s16le',frames:duration*16000,durationSeconds:duration,inputSampleRate:48000,inputChannels:1,decodedStartSeconds:0,decodedEndSeconds:duration,clippedSamples:0,downmix:'channel-mean',sourceRange:range,sourceDurationSeconds:durationSeconds},timeDomain:'normalized-interval-seconds',durationSeconds:duration,elapsedSeconds:1,createdAt:'2026-10-14T00:00:00.000Z',segments:noSpeech?[]:[{id:'segment-1',text:'打开项目并核对结果',startSeconds:0,endSeconds:Math.min(2,duration),tokenMeanProbability:.9,usable:true,warnings:[]}],automaticTimingApproved:false,wordTimingAvailable:false}
 }}}
 return {project,artifacts,kernel,store:new MaterialIndexStore(project),service:new MaterialIndexService(kernel,{projectId:project.id,sessionId:'fixture-session'},'user'),beforeSpeech:(fn:()=>Promise<void>)=>{beforeSpeech=fn},serial:()=>serial,close:()=>fs.rm(directory,{recursive:true,force:true})}
}
test('news research transcribes one measured short preview but rejects longer or cached long sources before ASR or index writes',async()=>{
 for(const seconds of [15,30,30.001,400]){
  const f=await fixture(seconds),bounded=new MaterialIndexService(f.kernel,{projectId:f.project.id,sessionId:'fixture-session'},'agent',true)
  try{
   await assert.rejects(bounded.execute({operation:'index',artifactId:'long.wav',expectedRevision:0,maxChunks:2}),/NEWS_RESEARCH_PREVIEW_ONLY/)
   if(seconds<=30){await bounded.execute({operation:'index',artifactId:'long.wav',expectedRevision:0,maxChunks:1});assert.equal(f.serial(),1);assert.deepEqual((await f.store.snapshot()).records[0].parts[0].sourceRange,{startSeconds:0,endSeconds:seconds})}
   else{
    const before=(await fs.readdir(f.artifacts)).sort();await assert.rejects(bounded.execute({operation:'index',artifactId:'long.wav',expectedRevision:0,maxChunks:1}),/NEWS_RESEARCH_PREVIEW_ONLY/);assert.deepEqual((await fs.readdir(f.artifacts)).sort(),before);assert.equal((await f.store.snapshot()).records.length,0);assert.equal(f.serial(),0)
    await f.service.execute({operation:'index',artifactId:'long.wav',expectedRevision:0,maxChunks:0});const cached=await f.store.snapshot();await assert.rejects(bounded.execute({operation:'index',artifactId:'long.wav',expectedRevision:cached.revision,maxChunks:1}),/NEWS_RESEARCH_PREVIEW_ONLY/);assert.equal(f.serial(),0);assert.equal((await f.store.snapshot()).revision,cached.revision)
   }
  }finally{await f.close()}
 }
})
test('material index durably chunks long source clocks, searches exact original intervals and reuses validated completed work',async()=>{
 const f=await fixture();try{
  const result=mediaRecord(await f.service.execute({operation:'index',artifactId:'long.wav',expectedRevision:0,maxChunks:2})),index=await f.store.snapshot();assert.equal(result.chunksCompleted,2);assert.deepEqual(index.records[0].parts.map(p=>p.sourceRange),[{startSeconds:0,endSeconds:180},{startSeconds:180,endSeconds:360}]);assert.deepEqual(pendingMaterialRanges(index.records[0]),[{startSeconds:360,endSeconds:400}])
  const search=mediaRecord(await f.service.execute({operation:'search',query:'核对',limit:1}));assert.ok(Array.isArray(search.results));assert.equal(search.results.length,1);assert.equal(mediaRecord(search.results[0]).startSeconds,0);assert.equal(mediaRecord(search.results[0]).automaticTimingApproved,false)
  const second=mediaRecord(await f.service.execute({operation:'search',query:'核对',limit:1,offset:search.nextOffset,expectedRevision:search.indexRevision}));assert.equal(mediaRecord(second.results[0]).startSeconds,180)
  await f.service.execute({operation:'index',artifactId:'long.wav',expectedRevision:index.revision,sourceRange:{startSeconds:0,endSeconds:180}});assert.equal(f.serial(),2,'Completed interval is verified, not replayed')
  await f.service.execute({operation:'index',artifactId:'long.wav',expectedRevision:index.revision,maxChunks:10});assert.deepEqual(pendingMaterialRanges((await f.store.snapshot()).records[0]),[]);assert.equal(f.serial(),3)
  await fs.writeFile(path.join(f.artifacts,'long.wav'),'Replaced bytes');const stale=mediaRecord(await f.service.execute({operation:'search',query:'核对'}));assert.ok(Array.isArray(stale.results)&&Array.isArray(stale.unavailable));assert.equal(stale.results.length,0);assert.ok(stale.unavailable.length>0)
 }finally{await f.close()}
})
test('material background chunks reject GUI metadata CAS races, preserve committed parts and clean only new proof outputs',async()=>{
 const f=await fixture();try{
  await f.service.execute({operation:'index',artifactId:'long.wav',expectedRevision:0,maxChunks:0});let state=await f.store.snapshot();await f.service.execute({operation:'set-metadata',artifactId:'long.wav',expectedRevision:state.revision,title:'人工标题',description:'保留人工描述',tags:['人工']});state=await f.store.snapshot();const before=(await fs.readdir(f.artifacts)).sort()
  f.beforeSpeech(async()=>{const current=await f.store.snapshot();current.records[0].description='GUI 并发编辑';await f.store.commit(current,current.revision,()=>{})})
  await assert.rejects(f.service.execute({operation:'index',artifactId:'long.wav',expectedRevision:state.revision,maxChunks:1}),/MATERIAL_INDEX_CONFLICT/);assert.deepEqual((await fs.readdir(f.artifacts)).sort(),before);const current=await f.store.snapshot();assert.equal(current.records[0].description,'GUI 并发编辑');assert.equal(current.records[0].title,'人工标题');assert.equal(current.records[0].parts.length,0)
  const bytes=await fs.readFile(path.join(f.project.directory,'material-index','catalog.json'));await fs.writeFile(path.join(f.project.directory,'material-index','catalog.json'),'{corrupt');await assert.rejects(f.store.snapshot());assert.equal(await fs.readFile(path.join(f.project.directory,'material-index','catalog.json'),'utf8'),'{corrupt');assert.ok(bytes.length>0)
 }finally{await f.close()}
})
test('Zero-result intervals retain raw ASR evidence and coverage without fabricated text, silence claims or repeated processing',async()=>{
 const f=await fixture(400,true);try{
  const result=mediaRecord(await f.service.execute({operation:'index',artifactId:'long.wav',expectedRevision:0,maxChunks:10})),state=await f.store.snapshot(),record=state.records[0]
  assert.equal(result.transcriptStatus,'no-speech-detected')
  assert.equal(record.parts.length,3)
  assert.ok(record.parts.every(part=>part.segmentCount===0))
  assert.deepEqual(pendingMaterialRanges(record),[])
  assert.equal((result.unrecognizedRanges as unknown[]).length,3)
  for(const part of record.parts){const proof=JSON.parse(await fs.readFile(path.join(f.artifacts,part.evidenceArtifactId),'utf8'));assert.deepEqual(proof.segments,[]);assert.ok(proof.rawSha256);assert.ok(proof.normalization.frames>0)}
  const search=mediaRecord(await f.service.execute({operation:'search',query:'fabricated words'}));assert.deepEqual(search.results,[])
  await f.service.execute({operation:'index',artifactId:'long.wav',expectedRevision:state.revision,maxChunks:10})
  assert.equal(f.serial(),3)
 }finally{await f.close()}
})
test('material index paths, cursors and intervals stay closed and symlink catalogs are never replaced',async()=>{
 const f=await fixture();try{
  for(const value of [{operation:'index',artifactId:'../outside.wav',expectedRevision:0},{operation:'index',artifactId:'long.wav',expectedRevision:0,sourceRange:{startSeconds:0,endSeconds:181}},{operation:'search',query:'a',offset:1},{operation:'list',path:'/tmp'},{operation:'set-metadata',artifactId:'long.wav',expectedRevision:0,title:'a',description:'b',tags:[],metadataOrigin:'user'}])assert.throws(()=>assertMaterialIndexRequest(value))
  const outside=path.join(f.project.directory,'untouched.json');await fs.writeFile(outside,'outside');await fs.mkdir(path.join(f.project.directory,'material-index'));await fs.symlink(outside,path.join(f.project.directory,'material-index','catalog.json'));await assert.rejects(f.store.snapshot());await assert.rejects(f.store.commit({version:1,projectId:f.project.id,revision:0,records:[]},0,()=>{}));assert.equal(await fs.readFile(outside,'utf8'),'outside')
 }finally{await f.close()}
})
test('one bounded OR search returns exact reusable pins and oversized sources cannot trap its cursor',async()=>{
 const f=await fixture(10);try{
  await f.service.execute({operation:'index',artifactId:'long.wav',expectedRevision:0,maxChunks:1})
  const found=mediaRecord(await f.service.execute({operation:'search',query:'',queries:['does not exist','核对'],limit:10})),rows=found.results as Record<string,unknown>[]
  assert.equal(rows.length,1);assert.equal(rows[0].match,'transcript');assert.equal(rows[0].sha256,hash('Controlled source bytes'));assert.equal(rows[0].startSeconds,0);assert.equal(f.serial(),1,'Search must reuse raw ASR rather than run it again')
  await assert.rejects(f.service.execute({operation:'search',queries:['x'.repeat(201)]}),/search|text/)
  await fs.truncate(path.join(f.artifacts,'long.wav'),512*1024*1024+1)
  const unavailable=mediaRecord(await f.service.execute({operation:'search',queries:['核对'],query:'',limit:10}));assert.equal(unavailable.nextOffset,null);assert.equal((unavailable.results as unknown[]).length,0);assert.match(JSON.stringify(unavailable.unavailable),/budget/)
 }finally{await f.close()}
})
