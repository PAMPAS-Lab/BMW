import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {assertSpeechRequest,whisperSegments,speechTimelineRange,assertSpeechEvidence} from '../src/speech-contract.js'
import {assertNativeProcessingRequest,assertMediaProcessRequest,assertMediaWorkerResult} from '../src/media-contract.js'
import {ArtifactJobIO} from '../src/artifact-job-io.js'
import {runSpeechProcess} from '../src/speech-processor.js'
import {LOCAL_ASR_MODELS,LOCAL_ASR_MODEL_REVISION} from '../src/local-asr-assets.js'
const segment=(from=0,to=1000,p=.9,text='中文。')=>({offsets:{from,to},text,tokens:[{text:'[_BEG_]',p:.1},{text:'中文',p},{text:'。',p}]})
const raw=(segments=[segment()])=>({model:{type:'small',multilingual:true},params:{language:'zh',translate:false},result:{language:'zh'},transcription:segments})
const normalization={kind:'speech-pcm' as const,sampleRate:16000 as const,channels:1 as const,sampleType:'pcm-s16le' as const,downmix:'channel-mean' as const,frames:32000,durationSeconds:2,inputSampleRate:48000,inputChannels:2,decodedStartSeconds:0,decodedEndSeconds:2,clippedSamples:0}
const evidence=()=>({kind:'speech-evidence',provider:'whisper.cpp',engineVersion:'1.9.1',model:'small',modelRevision:LOCAL_ASR_MODEL_REVISION,modelSha256:LOCAL_ASR_MODELS.small.sha256,engineSha256:'a'.repeat(64),sourceArtifactId:'speech.wav',sourceSha256:'b'.repeat(64),normalizedArtifactId:'normalized.wav',normalizedSha256:'c'.repeat(64),rawArtifactId:'raw.json',rawSha256:'d'.repeat(64),logArtifactId:'log.json',logSha256:'e'.repeat(64),sampleRate:16000,channels:1,sampleType:'pcm-s16le',downmix:'channel-mean',normalization,timeDomain:'audio-file-seconds',durationSeconds:2,elapsedSeconds:1,createdAt:'2026-10-04T00:00:00.000Z',segments:whisperSegments(raw(),2,'small'),automaticTimingApproved:false,wordTimingAvailable:false})
test('Speech requests admit fixed models and Project artifacts, never executable, cache, language, prompt or CLI options',()=>{
 assert.equal(assertSpeechRequest({action:'media.speech.align',artifactId:'voice.wav'}).model,'small')
 for(const extra of [{model:'arbitrary'},{executable:'/bin/sh'},{modelPath:'/tmp/model'},{args:['-h']},{language:'auto'},{prompt:'invent timings'}])assert.throws(()=>assertSpeechRequest({action:'media.speech.align',artifactId:'voice.wav',...extra}))
 for(const artifactId of ['../voice.wav','/tmp/a.wav','https://example.com/a.mp3'])assert.throws(()=>assertSpeechRequest({action:'media.speech.align',artifactId}))
 assert.equal(assertNativeProcessingRequest({action:'media.speech.normalize',artifactId:'voice.wav'}).action,'media.speech.normalize')
 assert.throws(()=>assertMediaProcessRequest({action:'media.speech.normalize',artifactId:'voice.wav'}))
 assert.throws(()=>assertMediaProcessRequest({action:'media.speech.align',artifactId:'voice.wav'}))
})
test('ASR parser preserves out-of-audio/overlapping boundaries and token probability without claiming word accuracy',()=>{
 const result=whisperSegments(raw([segment(0,2200),segment(1900,2300,.4)]),2,'small')
 assert.equal(result[0].endSeconds,2.2);assert.deepEqual(result[0].warnings,['outside-audio']);assert.equal(result[0].usable,false)
 assert.deepEqual(result[1].warnings,['outside-audio','overlap','low-confidence']);assert.equal(result[1].tokenMeanProbability,.4)
 assert.equal(whisperSegments(raw(),2,'small')[0].tokenMeanProbability,.9)
 for(const invalid of [raw([segment(1000,500)]),raw([segment(0,1000,NaN)]),{...raw(),model:{type:'base',multilingual:true}},{...raw(),params:{language:'zh',translate:true}},{...raw(),transcription:new Array(401).fill(segment())}])assert.throws(()=>whisperSegments(invalid,2,'small'))
})
test('Speech evidence rejects fabricated approval, foreign hashes, frame clocks and silently cleared warnings',()=>{
 assert.equal(assertSpeechEvidence(evidence()).automaticTimingApproved,false)
 for(const extra of [{automaticTimingApproved:true},{wordTimingAvailable:true},{modelSha256:'0'.repeat(64)},{timeDomain:'scene-seconds'},{sourceArtifactId:'/tmp/voice.wav'},{sourceSha256:'bad'},{durationSeconds:2.1},{normalization:{...normalization,frames:30000}}])assert.throws(()=>assertSpeechEvidence({...evidence(),...extra}))
 const changed=evidence();changed.segments=whisperSegments(raw([segment(0,2200)]),2,'small');changed.segments[0].warnings=[];changed.segments[0].usable=true
 assert.throws(()=>assertSpeechEvidence(changed),/altered/)
})
test('Speech mapping uses actual source trim/rate, narration offset and cumulative film time without clamping hidden anchors',()=>{
 const options={sourceStartSeconds:1,playbackRate:2,sceneOffsetSeconds:.5,sceneDurationSeconds:8,filmStartSeconds:16}
 assert.deepEqual(speechTimelineRange(3,5,options),{sceneStartSeconds:1.5,sceneEndSeconds:2.5,filmStartSeconds:17.5,filmEndSeconds:18.5})
 assert.equal(speechTimelineRange(.5,2,options),null);assert.equal(speechTimelineRange(2,17,options),null)
 assert.throws(()=>speechTimelineRange(2,3,{...options,playbackRate:0}))
})
test('Speech normalization replies require actual bounded sample provenance',()=>{
 const request=assertNativeProcessingRequest({action:'media.speech.normalize',artifactId:'voice.wav'})
 assert.equal(assertMediaWorkerResult({kind:'speech-pcm',info:normalization},request).kind,'speech-pcm')
 for(const extra of [{frames:Infinity},{channels:2},{sampleRate:48000},{durationSeconds:3},{decodedEndSeconds:3},{inputChannels:9},{hostPath:'/tmp/voice.wav'},{clippedSamples:-1},{clippedSamples:32001}])assert.throws(()=>assertMediaWorkerResult({kind:'speech-pcm',info:{...normalization,...extra}},request))
})
test('Normalized WAV outputs reject fake headers/sample counts and preserve original Project input',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bmw-speech-io-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'original.wav'),'original')
 const io=await ArtifactJobIO.open(root,{action:'media.speech.normalize',artifactId:'original.wav'});await io.write(0,0,new Uint8Array(100));await assert.rejects(io.finish(1),/WAV/);await io.close()
 assert.deepEqual(await fs.readdir(root),['original.wav']);assert.equal(await fs.readFile(path.join(root,'original.wav'),'utf8'),'original')
})
test('Speech subprocess cancellation waits for termination before rejecting and cannot leave a late output',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bmw-speech-child-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const signal=new AbortController()
 const child=runSpeechProcess(process.execPath,['-e',"process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync('late.txt','bad'),5000);setInterval(()=>{},100)"],root,signal.signal,10000)
 const timer=setTimeout(()=>signal.abort(new Error('test cancellation')),250)
 await assert.rejects(child,/test cancellation/);clearTimeout(timer);assert.equal((await fs.readdir(root)).includes('late.txt'),false)
 const output=await runSpeechProcess(process.execPath,['-e',"process.stdout.write('ok')"],root,new AbortController().signal,5000);assert.equal(output.stdout,'ok')
})
test('Speech subprocess rejects bounded log overflow and version/runtime failures after child settlement',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bmw-speech-log-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const signal=new AbortController().signal
 await assert.rejects(runSpeechProcess(process.execPath,['-e',"process.stdout.write('a'.repeat(2*1024*1024));setInterval(()=>{},100)"],root,signal,5000),/log exceeded/)
 await assert.rejects(runSpeechProcess(process.execPath,['-e','process.exit(3)'],root,signal,5000),/failed/)
 await assert.rejects(runSpeechProcess(process.execPath,['-e','setInterval(()=>{},100)'],root,signal,50),/deadline/)
})

test('Speech fingerprints reject replaced artifacts even when an already-open descriptor still has the original bytes',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bmw-speech-version-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'voice.wav');await fs.writeFile(file,'original')
 const io=await ArtifactJobIO.open(root,{action:'media.inspect',artifactId:'voice.wav'});t.after(()=>io.close());await io.fingerprint()
 await fs.rename(file,path.join(root,'saved-original.wav'));await fs.writeFile(file,'replacement');await assert.rejects(io.fingerprint(),/identity/)
 assert.equal(await fs.readFile(path.join(root,'saved-original.wav'),'utf8'),'original');assert.equal(await fs.readFile(file,'utf8'),'replacement')
})

test('Speech subprocess keeps UTF-8 log characters intact across raw pipe chunks',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bmw-speech-utf8-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const script="const bytes=Buffer.from('中文锚点');process.stdout.write(bytes.subarray(0,1));setTimeout(()=>process.stdout.write(bytes.subarray(1)),20)"
 const output=await runSpeechProcess(process.execPath,['-e',script],root,new AbortController().signal,5000);assert.equal(output.stdout,'中文锚点')
})
