import {VideoStudioService} from '../packages/feature-video/src/studio-service.js'
import {VideoStudioStore} from '../packages/feature-video/src/studio-store.js'
import {newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import type {VideoDraft} from '../packages/feature-video/src/studio-contract.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {app,session} from 'electron'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {MediaProcessor} from '../packages/media-native/src/media-processor.js'
import {assertSpeechEvidence} from '../packages/media-native/src/speech-contract.js'
import {mediaRecord} from '../packages/media-native/src/media-contract.js'
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-speech-runtime-'))),artifacts=path.join(root,'project','artifacts'),profile=path.join(root,'profile')
app.on('window-all-closed',()=>{})
fs.mkdirSync(artifacts,{recursive:true});fs.mkdirSync(profile);app.setPath('userData',profile)
const proofDirectory=path.resolve('.bmw-runtime/p0-speech',new Date().toISOString().replaceAll(':','-'));fs.mkdirSync(proofDirectory,{recursive:true})
const hash=(data:Uint8Array)=>crypto.createHash('sha256').update(data).digest('hex')
let cancelStage:string|undefined,controller:AbortController|undefined,code=0
const timer=setTimeout(()=>{process.stderr.write('Speech runtime exceeded four minutes.\n');app.exit(1)},240000)
function tone(channels:number){const frames=48000,data=Buffer.alloc(44+frames*channels*2);data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(channels,22);data.writeUInt32LE(48000,24);data.writeUInt32LE(48000*channels*2,28);data.writeUInt16LE(channels*2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(frames*channels*2,40);for(let sample=0;sample<frames;sample++)for(let channel=0;channel<channels;channel++)data.writeInt16LE(Math.round(Math.sin(sample/48000*440*2*Math.PI)*.25*32767*(channel===1?-1:1)),44+(sample*channels+channel)*2);return data}
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
  const media=new MediaController({session:isolated,pagePath:path.resolve('packages/media-native/src/media/media.html'),preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:(status:{action?:string;stage?:string})=>{if(status.action==='media.speech.align'&&status.stage==='recognizing'&&cancelStage==='inflight')setTimeout(()=>controller?.abort(new Error('runtime cancel inflight')),300);if(status.action==='media.speech.align'&&status.stage===cancelStage)controller?.abort(new Error('runtime cancel '+cancelStage))}})
  const narration=mediaRecord(await media.narrate({text:'先打开项目，再选择视频。这里有三个步骤，结果需要核对。',provider:'local-matcha',voice:'local-zh-en',ratePercent:0})),sourceArtifactId=String(narration.artifactId),original=fs.readFileSync(path.join(artifacts,sourceArtifactId))
  const result=assertSpeechEvidence(await media.processArtifact({action:'media.speech.align',artifactId:sourceArtifactId,model:'base'}));assert.equal(result.sourceSha256,hash(original));assert.equal(result.automaticTimingApproved,false);assert.equal(result.wordTimingAvailable,false);assert.ok(result.segments.length>0)
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
  fs.writeFileSync(path.join(proofDirectory,'result.json'),JSON.stringify({status:'passed' ,profile:'disposable',realAudio:true,humanReferenceComplete:false,automaticTimingApproved:false,proofDirectory,normalizationChannels:[1,2],cancellationStages:['normalizing','recognizing','inflight'],evidence:result},null,2))
 }catch(error){code=1;console.error(error);fs.writeFileSync(path.join(proofDirectory,'result.json'),JSON.stringify({status:'failed',error:error instanceof Error?error.stack:String(error)},null,2))}
 finally{clearTimeout(timer);fs.rmSync(root,{recursive:true,force:true});app.exit(code)}
}
void run()
