import {VideoStudioService} from '../packages/feature-video/src/studio-service.js'
import {MaterialIndexService} from '../packages/feature-video/src/material-index-service.js'
import {VideoStudioStore} from '../packages/feature-video/src/studio-store.js'
import {newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import type {VideoDraft} from '../packages/feature-video/src/studio-contract.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {app,session,BrowserWindow} from 'electron'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {bmwProduct} from '../packages/product-bmw/index.js'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {MediaProcessor} from '../packages/media-native/src/media-processor.js'
import {assertSpeechEvidence,speechSourceSegments} from '../packages/media-native/src/speech-contract.js'
import {mediaRecord} from '../packages/media-native/src/media-contract.js'
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-speech-runtime-'))),artifacts=path.join(root,'project','artifacts'),profile=path.join(root,'profile')
app.on('window-all-closed',()=>{})
fs.mkdirSync(artifacts,{recursive:true});fs.mkdirSync(profile);app.setPath('userData',profile)
const proofDirectory=path.resolve('.bmw-runtime/p0-speech',new Date().toISOString().replaceAll(':','-'));fs.mkdirSync(proofDirectory,{recursive:true})
const hash=(data:Uint8Array)=>crypto.createHash('sha256').update(data).digest('hex')
let cancelStage:string|undefined,controller:AbortController|undefined,code=0
const timer=setTimeout(()=>{process.stderr.write('Speech runtime exceeded four minutes.\n');app.exit(1)},240000)
function tone(channels:number,seconds=1){const frames=48000*seconds,data=Buffer.alloc(44+frames*channels*2);data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(channels,22);data.writeUInt32LE(48000,24);data.writeUInt32LE(48000*channels*2,28);data.writeUInt16LE(channels*2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(frames*channels*2,40);for(let sample=0;sample<frames;sample++)for(let channel=0;channel<channels;channel++)data.writeInt16LE(Math.round(Math.sin(sample/48000*440*2*Math.PI)*.25*32767*(channel===1?-1:1)),44+(sample*channels+channel)*2);return data}
async function run(){
 try{
  await app.whenReady();const isolated=session.fromPartition('bmw-speech-runtime-'+process.pid),options={session:isolated,pagePath:path.resolve('packages/media-native/src/media/processing.html'),preloadPath:path.resolve('packages/media-native/src/preload/processing-preload.cjs')},processor=new MediaProcessor(options)
  for(const channels of [1,2]){
   const input=tone(channels);fs.writeFileSync(path.join(artifacts,'tone-'+channels+'.wav'),input)
   const normalized=mediaRecord(await processor.process({action:'media.speech.normalize',artifactId:'tone-'+channels+'.wav'},artifacts))
   const metadata=mediaRecord(normalized.normalization),data=fs.readFileSync(String(normalized.path));assert.equal(metadata.frames,16000);assert.equal(data.length,32044);assert.equal(normalized.sourceSha256,hash(input));assert.equal(metadata.inputChannels,channels)
   const samples=new Int16Array(data.buffer,data.byteOffset+44,16000);let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample))
   if(channels===1){assert.ok(peak>7900&&peak<8500);for(const index of [500,2000,7000])assert.ok(Math.abs(samples[index]-Math.round(Math.sin(index/16000*440*2*Math.PI)*.25*32767))<400)}else assert.ok(peak<3,'Opposite stereo channels must downmix to silence, without invented gain.')
   console.log('PASS native normalization '+channels+' channel, actual 16000 samples, bounded waveform and original hash')
  }
  fs.writeFileSync(path.join(artifacts,'long-tone.wav'),tone(1,182))
  const range={startSeconds:180,endSeconds:181},interval=mediaRecord(await processor.process({action:'media.speech.normalize',artifactId:'long-tone.wav',sourceRange:range},artifacts)),intervalInfo=mediaRecord(interval.normalization)
  assert.deepEqual(intervalInfo.sourceRange,range);assert.equal(intervalInfo.sourceDurationSeconds,182);assert.equal(intervalInfo.frames,16000);assert.equal(fs.readFileSync(String(interval.path)).length,32044)
  await assert.rejects(processor.process({action:'media.speech.normalize',artifactId:'long-tone.wav'},artifacts),/180|interval/)
  console.log('PASS bounded late interval of a 182-second actual WAV; source origin and PCM sample count measured, implicit full decode rejected')
  const media=new MediaController({session:isolated,pagePath:path.resolve('packages/media-native/src/media/media.html'),preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:(status:{action?:string;stage?:string})=>{if(status.action==='media.speech.align'&&status.stage==='recognizing'&&cancelStage==='inflight')setTimeout(()=>controller?.abort(new Error('runtime cancel inflight')),300);if(status.action==='media.speech.align'&&status.stage===cancelStage)controller?.abort(new Error('runtime cancel '+cancelStage))}})
  const narration=process.env.BMW_SPEECH_FIXTURE?await (async()=>{const fixture=fs.realpathSync(process.env.BMW_SPEECH_FIXTURE!),allowed=path.resolve('.bmw-runtime/p0-speech')+path.sep;if(!fixture.startsWith(allowed)||path.extname(fixture)!=='.wav')throw new Error('Speech fixture must be a saved isolated p0-speech WAV.');fs.copyFileSync(fixture,path.join(artifacts,'saved-isolated-speech.wav'));const info=mediaRecord(await media.processArtifact({action:'media.inspect',artifactId:'saved-isolated-speech.wav'}));console.log('Using saved isolated speech fixture; new TTS generation is not covered by this run.');return {artifactId:'saved-isolated-speech.wav',durationSeconds:info.durationSeconds}})():mediaRecord(await media.narrate({text:'先打开项目，再选择视频。这里有三个步骤，结果需要核对。',provider:'local-matcha',voice:'local-zh-en',ratePercent:0})),sourceArtifactId=String(narration.artifactId),original=fs.readFileSync(path.join(artifacts,sourceArtifactId))
  const result=assertSpeechEvidence(await media.processArtifact({action:'media.speech.align',artifactId:sourceArtifactId,model:'base'}));assert.equal(result.sourceSha256,hash(original));assert.equal(result.automaticTimingApproved,false);assert.equal(result.wordTimingAvailable,false);assert.ok(result.segments.length>0)
  const selectedEnd=Math.min(result.durationSeconds,7),intervalSpeech=assertSpeechEvidence(await media.processArtifact({action:'media.speech.align',artifactId:sourceArtifactId,model:'base',sourceRange:{startSeconds:1,endSeconds:selectedEnd}}))
  assert.equal(intervalSpeech.timeDomain,'normalized-interval-seconds');assert.equal(intervalSpeech.sourceSha256,result.sourceSha256);assert.equal(intervalSpeech.normalization.sourceRange!.startSeconds,1);assert.ok(speechSourceSegments(intervalSpeech).every(s=>s.startSeconds>=1));assert.ok(Math.abs(intervalSpeech.durationSeconds-(selectedEnd-1))<=1/16000)
  const browserWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
  try{
   const kernel=new BrowserKernel({window:browserWindow,session:isolated,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>({id:'speech-public',name:'Disposable speech Project',directory:path.dirname(artifacts)})},capabilityRegistry:new BrowserCapabilityRegistry(bmwProduct),artifactsDirectory:artifacts,onState:()=>{},settingsStore:undefined,sessionContinuity:undefined,allowedActions:undefined});kernel.setRecordingController(media)
   const exposed=assertSpeechEvidence(await kernel.execute({action:'media.speech.align',artifactId:sourceArtifactId,model:'base',language:'zh',sourceRange:{startSeconds:1,endSeconds:selectedEnd}}))
   assert.equal(exposed.sourceSha256,result.sourceSha256);assert.equal(exposed.language,'zh');assert.deepEqual(exposed.normalization.sourceRange,{startSeconds:1,endSeconds:selectedEnd});assert.ok(exposed.segments.length>0);assert.equal(media.isCaptureActive(),false)
   await assert.rejects(kernel.execute({action:'media.speech.align',artifactId:sourceArtifactId,language:'zh',sourceRange:{startSeconds:0,endSeconds:181}}),/180/)
   console.log('PASS public BMW browser interval ASR without a tab, draft edits or source transcript batches; source hash and interval provenance retained')
  }finally{browserWindow.destroy()}

  console.log('PASS actual local interval ASR: unchanged original SHA, raw normalized times and explicit original source projection')
  for(const [artifactId,expected] of [[result.rawArtifactId,result.rawSha256],[result.normalizedArtifactId,result.normalizedSha256],[result.logArtifactId,result.logSha256]]){const bytes=fs.readFileSync(path.join(artifacts,artifactId));assert.equal(hash(bytes),expected)}
  const raw=JSON.parse(fs.readFileSync(path.join(artifacts,result.rawArtifactId),'utf8'));assert.equal(raw.params.model,'model.bin');assert.equal(raw.params.language,'zh')
  fs.writeFileSync(path.join(proofDirectory,'evidence.json'),JSON.stringify(result,null,2));for(const name of [sourceArtifactId,result.rawArtifactId,result.normalizedArtifactId,result.logArtifactId])fs.copyFileSync(path.join(artifacts,name),path.join(proofDirectory,name))
  console.log('PASS actual fixed base ASR, original/raw/normalized/log hashes, measured format, raw intervals and disabled automatic timing')
  const before=fs.readdirSync(artifacts).sort()
  for(const stage of ['normalizing','recognizing','inflight']){cancelStage=stage;controller=new AbortController();await assert.rejects(media.processArtifact({action:'media.speech.align',artifactId:sourceArtifactId,model:'base'},controller.signal),new RegExp('runtime cancel '+stage));assert.equal(media.isCaptureActive(),false);assert.deepEqual(fs.readdirSync(artifacts).sort(),before);assert.deepEqual(fs.readFileSync(path.join(artifacts,sourceArtifactId)),original);console.log('PASS '+stage+' cancellation drains and removes only current outputs')}
  cancelStage=undefined;controller=undefined
  await assert.rejects(media.processArtifact({action:'media.speech.align',artifactId:sourceArtifactId,executable:'/bin/sh'}),/fixed model/);await assert.rejects(media.processArtifact({action:'media.speech.normalize',artifactId:sourceArtifactId}),/private/)
  assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
  const project={id:'speech-studio',name:'Speech Studio',directory:path.dirname(artifacts)},store=new VideoStudioStore(project.directory,'speech-session'),owner={projectId:project.id,sessionId:'speech-session'}
  const service=new VideoStudioService({projectStore:{active:()=>project},execute:async()=>({}),recordingController:media})
  let draft=store.create('Actual speech evidence');draft.scenes=[{...newStudioScene('actual-speech'),narration:'先打开项目，再选择视频。这里有三个步骤，结果需要核对。',audioText:'先打开项目，再选择视频。这里有三个步骤，结果需要核对。',audioArtifactId:sourceArtifactId,audioDurationSeconds:Number(narration.durationSeconds),durationSeconds:Number(narration.durationSeconds)+1,bullets:['语音证据'] }];draft=store.update(draft.id,draft.revision,draft,true)
  // This runtime verifies host bindings, not a human acoustic accuracy label.
  const manual=(await service.execute({operation:'correct-speech',draftId:draft.id,expectedRevision:draft.revision,sceneId:'actual-speech',anchors:[{id:'runtime-span',scriptStart:0,scriptEnd:draft.scenes[0].narration.length,startSeconds:0,endSeconds:Number(narration.durationSeconds)}]},undefined,owner,'agent') as {draft:VideoDraft}).draft;draft=manual
  const aligned=await service.execute({operation:'align-speech',draftId:draft.id,expectedRevision:draft.revision,sceneId:'actual-speech',speechModel:'base'},undefined,owner) as {draft:VideoDraft;manualEditsPreserved:boolean};draft=aligned.draft;assert.equal(aligned.manualEditsPreserved,true);assert.deepEqual(draft.scenes[0].speechAnchors,manual.scenes[0].speechAnchors)
  const read=mediaRecord(await service.execute({operation:'read-speech',draftId:draft.id,expectedRevision:draft.revision,sceneId:'actual-speech'},undefined,owner));assert.equal(read.stale,false);assert.equal(read.wordTimingAvailable,false)
  draft.scenes[0].speechCaptions=true;draft=store.update(draft.id,draft.revision,draft)
  const captions=mediaRecord(await service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat:'vtt'},undefined,owner));assert.ok(captions.provenanceArtifactId)
  fs.writeFileSync(path.join(proofDirectory,'studio-draft.json'),JSON.stringify(draft,null,2)+'\n');fs.writeFileSync(path.join(proofDirectory,'studio-read-speech.json'),JSON.stringify(read,null,2)+'\n')
  for(const id of [draft.scenes[0].speechCandidate!.evidenceArtifactId,String(captions.artifactId),String(captions.provenanceArtifactId)])fs.copyFileSync(path.join(artifacts,id),path.join(proofDirectory,id))
  console.log('PASS Studio actual base ASR/read evidence, actual audio/script SHA, Agent edit provenance, corrected spans preserved and VTT receipt')
  const materialService=new MaterialIndexService(service.kernel,owner,'user'),indexed=mediaRecord(await materialService.execute({operation:'index',artifactId:sourceArtifactId,expectedRevision:0,maxChunks:1})),indexedRecord=mediaRecord(indexed.record),part=mediaRecord((indexedRecord.parts as unknown[])[0]),indexedEvidence=assertSpeechEvidence(JSON.parse(fs.readFileSync(path.join(artifacts,String(part.evidenceArtifactId)),'utf8'))),query=indexedEvidence.segments[0].text.slice(0,2)
  const found=mediaRecord(await materialService.execute({operation:'search',query}));assert.ok(Array.isArray(found.results)&&found.results.some(raw=>mediaRecord(raw).match==='transcript'&&mediaRecord(raw).availability==='verified'));assert.equal(indexedEvidence.automaticTimingApproved,false)
  fs.writeFileSync(path.join(proofDirectory,'material-index-acceptance.json'),JSON.stringify({indexed,found,scope:'Actual native interval ASR on isolated fixture, no semantic or acoustic accuracy approval'},null,2)+'\n');fs.copyFileSync(path.join(artifacts,String(part.evidenceArtifactId)),path.join(proofDirectory,'material-index-evidence.json'))
  console.log('PASS actual Project material interval indexing, immutable speech evidence and source-time transcript search')
  const sourceVideo=mediaRecord(await media.compose({title:'Isolated full-source transcription',width:640,height:360,fps:24,music:false,scenes:[{title:'Speech fixture',durationSeconds:Number(narration.durationSeconds)+1,narration:'先打开项目，再选择视频。这里有三个步骤，结果需要核对。',audioArtifactId:sourceArtifactId}]}))
  const materialList=mediaRecord(await materialService.execute({operation:'list'})),catalog=mediaRecord(materialList.index),batchResult=mediaRecord(await materialService.execute({operation:'transcribe-source',artifactId:sourceVideo.artifactId,expectedRevision:catalog.revision,maxSegments:1,model:'base',language:'zh'})),batch=mediaRecord(batchResult.batch)
  assert.equal(batch.state,'complete');assert.deepEqual(batch.uncoveredRanges,[]);assert.ok(Number(batch.indexedPartCount)>0)
  const beforeResume=fs.readdirSync(artifacts).sort(),resumed=mediaRecord(await materialService.execute({operation:'transcribe-source',artifactId:sourceVideo.artifactId,batchId:batch.id,expectedRevision:batchResult.indexRevision,maxSegments:1,model:'base',language:'zh'}));assert.equal(mediaRecord(resumed.batch).state,'complete');assert.deepEqual(fs.readdirSync(artifacts).sort(),beforeResume)
  fs.writeFileSync(path.join(proofDirectory,'source-batch-acceptance.json'),JSON.stringify({batchResult,resumed,scope:'Actual isolated AAC source → native packet-copy segment → local base ASR; not full-keynote or model-film review'},null,2)+'\n')
  console.log('PASS actual native full-source batch, local segmentation mapping, AAC ASR coverage and idempotent completed resume')
  fs.writeFileSync(path.join(proofDirectory,'result.json'),JSON.stringify({status:'passed' ,profile:'disposable',realAudio:true,humanReferenceComplete:false,automaticTimingApproved:false,proofDirectory,normalizationChannels:[1,2],cancellationStages:['normalizing','recognizing','inflight'],evidence:result},null,2))
 }catch(error){code=1;console.error(error);fs.writeFileSync(path.join(proofDirectory,'result.json'),JSON.stringify({status:'failed',error:error instanceof Error?error.stack:String(error)},null,2))}
 finally{clearTimeout(timer);fs.rmSync(root,{recursive:true,force:true});app.exit(code)}
}
void run()
