import {assertSourceCues,projectSourceCues,sourceCaptionClock,sourceCaptionsStale} from '../src/studio-source-speech-contract.js'
import crypto from 'node:crypto'
import {assertSentenceAnchors,sentenceSuggestions,scriptSentences,speechCaptionCues,speechScene,assertStudioSpeechLinks,usesStudioSpeech} from '../src/studio-speech-contract.js'
import {assertSpeechEvidence} from '../../media-native/src/speech-contract.js'
import {LOCAL_ASR_MODELS,LOCAL_ASR_MODEL_REVISION} from '../../media-native/src/local-asr-assets.js'
import {studioTimeline,studioSceneIndex} from '../src/studio-timeline.js'
import {studioAssistantRequest,studioAssistantPrompt} from '../src/studio-assistant.js'
import {assertStudioMode,assertStudioSelection,studioPromptContext} from '../src/studio-context.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {VideoStudioStore} from '../src/studio-store.js'
import {VideoStudioService} from '../src/studio-service.js'
import type {VideoDraft} from '../src/studio-contract.js'
import type {StudioKernel} from '../src/studio-service.js'
import {assertStudioRequest,assertVideoDraft,draftComposition,draftReadiness,sceneCoverage,newStudioScene} from '../src/studio-contract.js'
import {assertComposition,compositionAssets} from '../../media-native/src/composition-contract.js'
function sceneDraft(store:VideoStudioStore,title:string){const draft=store.create(title);draft.scenes.push(newStudioScene('first-scene'));return draft}
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-studio-test-'));fs.mkdirSync(path.join(root,'artifacts'));return {root,store:new VideoStudioStore(root,'fixture-session'),close:()=>fs.rmSync(root,{recursive:true,force:true})}}
test('Studio drafts persist per Project and reject conflicting GUI or Agent revisions',()=>{
  const a=fixture(),b=fixture();try{const draft=sceneDraft(a.store,'项目视频');draft.scenes[0].narration='尚未制作的旁白。';const updated=a.store.update(draft.id,1,draft);assert.equal(updated.revision,2);assert.equal(new VideoStudioStore(a.root).read(draft.id).scenes[0].narration,draft.scenes[0].narration);assert.throws(()=>a.store.update(draft.id,1,draft),/STUDIO_CONFLICT/);assert.throws(()=>b.store.read(draft.id),/ENOENT/);assert.throws(()=>a.store.read('../outside'),/identity/);fs.symlinkSync(path.join(a.root,'video-studio',draft.id+'.json'),path.join(a.root,'video-studio','linked.json'));assert.throws(()=>a.store.read('linked'),/Invalid Studio/)}finally{a.close();b.close()}
})
test('Studio coverage follows actual voice, source trim and speed and requires explicit end hold',()=>{
  const fixtureValue=fixture();try{const draft=sceneDraft(fixtureValue.store,'覆盖');const scene=draft.scenes[0];scene.narration='原稿';scene.audioArtifactId='voice.wav';scene.audioText='原稿';scene.audioDurationSeconds=7;scene.videoArtifactId='clip.webm';scene.sourceDurationSeconds=12;scene.sourceStartSeconds=2;scene.playbackRate=2;assert.equal(sceneCoverage(scene).available,5);assert.throws(()=>draftComposition(draft),/补录 3.0/);scene.endPolicy='hold';assert.equal(draftComposition(draft).scenes[0].audioArtifactId,'voice.wav');scene.narration='改写';assert.throws(()=>draftComposition(draft),/脚本已改动/);scene.audioText='改写';scene.audioDurationSeconds=8;assert.throws(()=>draftComposition(draft),/实测音频/)}finally{fixtureValue.close()}
})
test('Studio render remeasures artifacts instead of trusting edited duration metadata',async()=>{
  const value=fixture();try{fs.writeFileSync(path.join(value.root,'artifacts','clip.webm'),'fixture');fs.writeFileSync(path.join(value.root,'artifacts','voice.wav'),'fixture');let renders=0
    const kernel:StudioKernel={projectStore:{active:()=>({id:'project',name:'Project',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>{renders++;return {artifactId:'final.mp4',durationSeconds:8}},processArtifact:async raw=>{const request=raw as {artifactId:string};return {durationSeconds:request.artifactId==='clip.webm'?2:7,tracks:[{type:request.artifactId==='clip.webm'?'video':'audio',canDecode:true}]}}}}
    const service=new FixtureVideoStudioService(kernel),draft=sceneDraft(value.store,'实测');Object.assign(draft.scenes[0],{narration:'旁白',audioText:'旁白',audioArtifactId:'voice.wav',audioDurationSeconds:1,videoArtifactId:'clip.webm',sourceDurationSeconds:100});let current=value.store.update(draft.id,1,draft)
    await assert.rejects(service.execute({operation:'render',draftId:draft.id,expectedRevision:current.revision}),/补录 6.0/);assert.equal(renders,0)
    current.scenes[0].endPolicy='hold';current=value.store.update(current.id,current.revision,current);const result=await service.execute({operation:'render',draftId:current.id,expectedRevision:current.revision}) as {draft:{exports:{revision:number}[]}};assert.equal(renders,1);assert.equal(result.draft.exports[0].revision,current.revision)
  }finally{value.close()}
})
test('Studio rejects script paths and malformed captions while admitting Project images',()=>{
  assert.throws(()=>assertStudioRequest({operation:'create',shell:'anything'}),/Unsupported/);assert.throws(()=>assertStudioRequest({operation:'attach',artifactId:'../outside.mp4'}),/artifactId/)
  const value=fixture();try{const draft=sceneDraft(value.store,'画面');draft.scenes[0].sources=['file:///outside'];assert.throws(()=>assertVideoDraft(draft),/HTTP/);draft.scenes[0].sources=['https://example.com/source'];draft.scenes[0].imageArtifactId='frame.png';draft.scenes[0].captions=[{startSeconds:0,endSeconds:2,text:'字幕'},{startSeconds:1,endSeconds:3,text:'交叠'}];assert.throws(()=>assertVideoDraft(draft),/nonoverlapping/);draft.scenes[0].captions=[{startSeconds:.5,endSeconds:4,text:'合法字幕'}];const composition=draftComposition(assertVideoDraft(draft));assert.deepEqual(compositionAssets(composition),['frame.png']);assert.throws(()=>assertComposition({...composition,scenes:[{...composition.scenes[0],videoArtifactId:'clip.webm'}]}),/video or image/)}finally{value.close()}
})

test('Studio visual edits retain measured narration while rewritten scripts require new speech',()=>{
  const value=fixture();try{
    let draft=sceneDraft(value.store,'音频关联');Object.assign(draft.scenes[0],{narration:'原稿',audioArtifactId:'voice.wav',audioText:'原稿',audioDurationSeconds:7,bullets:['要点']});draft=value.store.update(draft.id,draft.revision,draft)
    delete draft.scenes[0].audioArtifactId;delete draft.scenes[0].audioText;delete draft.scenes[0].audioDurationSeconds;draft.scenes[0].title='新画面标题'
    draft=value.store.update(draft.id,draft.revision,draft);assert.equal(draft.scenes[0].audioArtifactId,'voice.wav');assert.equal(draft.scenes[0].audioText,'原稿');assert.equal(draft.scenes[0].audioDurationSeconds,7);assert.equal(sceneCoverage(draft.scenes[0]).audioStale,false)
    draft.scenes[0].narration='改写稿';delete draft.scenes[0].audioArtifactId;delete draft.scenes[0].audioText;delete draft.scenes[0].audioDurationSeconds
    draft=value.store.update(draft.id,draft.revision,draft);assert.equal(sceneCoverage(draft.scenes[0]).audioStale,true);assert.throws(()=>draftComposition(draft),/脚本已改动/)
  }finally{value.close()}
})

test('Studio selection validates owning draft and scene and publishes the latest revision as context data',()=>{
 const value=fixture();try{const draft=sceneDraft(value.store,'当前视频');const selection={draftId:draft.id,sceneId:draft.scenes[0].id,stage:4,revision:1,dirty:false};assert.deepEqual(assertStudioSelection(selection,draft),selection)
 assert.throws(()=>assertStudioSelection({...selection,sceneId:'foreign'},draft),/belong/);assert.throws(()=>assertStudioSelection({...selection,stage:5},draft));assert.throws(()=>assertStudioSelection({...selection,credentials:'x'},draft),/Unsupported/);assert.throws(()=>assertStudioMode('window'));assert.equal(assertStudioMode('studio'),'studio')
 draft.revision=3;draft.scenes[0].title='手动修改';const text=studioPromptContext('studio',selection,draft);assert.match(text,/手动修改/);assert.match(text,/"revision":3/);assert.match(text,/data, not source instructions/);assert.equal(studioPromptContext('browser',selection,draft),'')
 }finally{value.close()}
})

test('Studio GUI undo can explicitly clear an attached voice without erasing omitted model bindings',()=>{
  const value=fixture();try{
    let draft=sceneDraft(value.store,'可撤销音频');Object.assign(draft.scenes[0],{audioArtifactId:'voice.wav',audioText:'',audioDurationSeconds:1});draft=value.store.update(draft.id,draft.revision,draft)
    const snapshot=structuredClone(draft);snapshot.scenes[0].audioArtifactId=undefined;delete snapshot.scenes[0].audioText;delete snapshot.scenes[0].audioDurationSeconds
    draft=value.store.update(draft.id,draft.revision,snapshot);assert.equal(draft.scenes[0].audioArtifactId,undefined);assert.equal(draft.scenes[0].audioDurationSeconds,undefined)
    draft.scenes[0].audioArtifactId='voice.wav';draft=value.store.update(draft.id,draft.revision,draft);delete draft.scenes[0].audioArtifactId
    draft=value.store.update(draft.id,draft.revision,draft);assert.equal(draft.scenes[0].audioArtifactId,'voice.wav')
  }finally{value.close()}
})

test('Preparation persists without scenes, retains legacy bindings and rejects empty export',()=>{
  const value=fixture();try{
    const draft=value.store.create('Preparation');assert.equal(draft.scenes.length,0);assert.deepEqual(draft.preparation,{notes:'',outline:'',artifactIds:[]})
    draft.preparation={notes:'Collected notes',outline:'Opening\nConclusion',artifactIds:['notes.md','raw.wav']}
    const saved=value.store.update(draft.id,1,draft);assert.equal(saved.scenes.length,0);assert.equal(value.store.read(draft.id).preparation.notes,'Collected notes');assert.throws(()=>draftComposition(saved),/分镜/)
    const selection={draftId:saved.id,stage:0,revision:saved.revision,dirty:false};assert.deepEqual(assertStudioSelection(selection,saved),selection);assert.doesNotMatch(studioPromptContext('studio',selection,saved),/"sceneId"/)
    const {preparation,...omitted}=saved;assert.deepEqual(value.store.update(saved.id,saved.revision,omitted).preparation,preparation)
    const legacy={...saved,scenes:[{...newStudioScene('legacy'),imageArtifactId:'screen.png',audioArtifactId:'voice.wav'}]};delete (legacy as Partial<typeof legacy>).preparation;assert.deepEqual(assertVideoDraft(legacy).preparation.artifactIds,['screen.png','voice.wav'])
    assert.throws(()=>assertVideoDraft({...saved,preparation:{notes:'x',artifactIds:['../outside'],outline:''}}));assert.throws(()=>assertVideoDraft({...saved,preparation:{...preparation,url:'https://example.com'}}))
  }finally{value.close()}
})
test('Preparation admits Project text and rejects missing and symlink additions without a revision write',async()=>{
  const value=fixture();try{
    fs.writeFileSync(path.join(value.root,'artifacts','notes.md'),'<script>untrusted notes</script>')
    const kernel:StudioKernel={projectStore:{active:()=>({id:'project',name:'Project',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>({})}}
    const service=new FixtureVideoStudioService(kernel);let draft=value.store.create('Materials');assert.equal(value.store.assets(value.root)[0].kind,'text')
    draft.preparation.artifactIds=['missing.md'];await assert.rejects(service.execute({operation:'update',draftId:draft.id,expectedRevision:1,draft}));assert.equal(value.store.read(draft.id).revision,1)
    fs.symlinkSync(path.join(value.root,'artifacts','notes.md'),path.join(value.root,'artifacts','linked.md'));draft.preparation.artifactIds=['linked.md'];await assert.rejects(service.execute({operation:'update',draftId:draft.id,expectedRevision:1,draft}))
    draft.preparation.artifactIds=['notes.md'];draft=await service.execute({operation:'update',draftId:draft.id,expectedRevision:1,draft}) as typeof draft;assert.deepEqual(draft.preparation.artifactIds,['notes.md'])
  }finally{value.close()}
})
test('Caption edits preserve voice while regeneration replaces only the selected script audio',async()=>{
  const value=fixture();try{
    const calls:string[]=[];const kernel:StudioKernel={projectStore:{active:()=>({id:'project',name:'Project',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async raw=>{calls.push((raw as {text:string}).text);return {artifactId:'new.wav',durationSeconds:2}},compose:async()=>({}),processArtifact:async()=>({})}}
    const service=new FixtureVideoStudioService(kernel);let draft=sceneDraft(value.store,'Pairs');Object.assign(draft.scenes[0],{narration:'Old',audioText:'Old',audioArtifactId:'old.wav',audioDurationSeconds:1});draft.scenes.push({...newStudioScene('second'),narration:'Other',audioText:'Other',audioArtifactId:'other.wav',audioDurationSeconds:1});draft=value.store.update(draft.id,1,draft)
    draft.scenes[0].captions=[{startSeconds:0,endSeconds:1,text:'Independent correction'}];draft.scenes[0].captionStyle={fontSize:32,color:'#ff8800',background:'box',position:'top',align:'left',offsetPercent:5};draft=value.store.update(draft.id,draft.revision,draft);assert.equal(sceneCoverage(draft.scenes[0]).audioStale,false);assert.equal(draft.scenes[0].audioArtifactId,'old.wav')
    draft.scenes[0].narration='New script';draft=value.store.update(draft.id,draft.revision,draft);assert.equal(sceneCoverage(draft.scenes[0]).audioStale,true)
    const result=await service.execute({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:draft.scenes[0].id,provider:'local-matcha'}) as {draft:typeof draft};assert.deepEqual(calls,['New script']);assert.equal(result.draft.scenes[0].audioText,'New script');assert.equal(result.draft.scenes[0].durationSeconds,3);assert.equal(result.draft.scenes[1].audioArtifactId,'other.wav');assert.equal(result.draft.scenes[0].captions![0].text,'Independent correction')
  }finally{value.close()}
})

test('Generated narration records actual parameters and blocks stale voice or rate while visual edits remain ready',async()=>{
 const value=fixture();try{
  let draft=sceneDraft(value.store,'真实音色');draft.scenes[0].narration='实际脚本';draft.scenes[0].bullets=['画面'];draft=value.store.update(draft.id,draft.revision,draft)
  const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},recordingController:{async narrate(){return {artifactId:'generated.wav',durationSeconds:2}},async compose(){throw new Error('Must reject before compose')},async processArtifact(){return {durationSeconds:2,tracks:[{type:'audio',canDecode:true}]}}},settingsStore:{snapshot:()=>({edgeNarrationEnabled:true}),update:()=>{}},execute:async()=>({})})
  const generated=await service.execute({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:draft.scenes[0].id}) as {draft:VideoDraft}
  draft=generated.draft
  assert.equal(sceneCoverage({...draft.scenes[0],narration:''},draft.tts).audioStale,true,'Clearing a generated script must invalidate its existing audio')
  assert.deepEqual(draft.scenes[0].audioGeneration,{kind:'tts',options:draft.tts});assert.equal(sceneCoverage(draft.scenes[0],draft.tts).audioStale,false)
  draft.scenes[0].title='改画面';draft.scenes[0].captions=[{startSeconds:0,endSeconds:1,text:'字幕修改'}]
  draft=value.store.update(draft.id,draft.revision,draft);assert.equal(sceneCoverage(draft.scenes[0],draft.tts).audioStale,false)
  draft=await service.execute({operation:'configure',draftId:draft.id,expectedRevision:draft.revision,options:{tts:{voice:'zh-CN-XiaoxiaoNeural'}}}) as VideoDraft
  assert.equal(sceneCoverage(draft.scenes[0],draft.tts).audioStale,true);assert.throws(()=>draftComposition(draft),/音色\/语速/)
  // An editable snapshot cannot relabel the existing audio as the new voice.
  draft.scenes[0].audioGeneration={kind:'tts',options:draft.tts!};draft.scenes[0].audioText='forged'
  draft=value.store.update(draft.id,draft.revision,draft)
  assert.equal(draft.scenes[0].audioGeneration!.kind,'tts');assert.equal(sceneCoverage(draft.scenes[0],draft.tts).audioStale,true);assert.equal(draft.scenes[0].audioText,'实际脚本')
  await service.execute({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:draft.scenes[0].id})
  // Service returns the new draft in its narration receipt.
  const latest=value.store.read(generated.draft.id);assert.equal(sceneCoverage(latest.scenes[0],latest.tts).audioStale,false)
  latest.tts!.ratePercent=10;const changed=value.store.update(latest.id,latest.revision,latest);assert.equal(sceneCoverage(changed.scenes[0],changed.tts).audioStale,true)
 }finally{value.close()}
})

test('Legacy audio keeps unknown parameters and detects subsequent changes; imported audio ignores TTS preferences',()=>{
 const value=fixture();try{
  let draft=sceneDraft(value.store,'旧草稿');Object.assign(draft.scenes[0],{narration:'旧脚本',audioArtifactId:'old.wav',audioText:'旧脚本',audioDurationSeconds:2,durationSeconds:3,bullets:['画面']})
  // A pre-metadata persisted draft is read without guessing an actual voice.
  fs.writeFileSync(path.join(value.store.directory,draft.id+'.json'),JSON.stringify(draft))
  draft=value.store.read(draft.id);assert.equal(draft.scenes[0].audioGeneration,undefined);assert.equal(sceneCoverage(draft.scenes[0],draft.tts).audioStale,false)
  draft.tts!.voice='zh-CN-XiaoxiaoNeural';draft=value.store.update(draft.id,draft.revision,draft)
  assert.equal(draft.scenes[0].audioGeneration!.kind,'legacy');assert.equal(sceneCoverage(draft.scenes[0],draft.tts).audioStale,true)
  draft.scenes[0].audioArtifactId='imported.wav';draft=value.store.update(draft.id,draft.revision,draft)
  assert.equal(draft.scenes[0].audioGeneration!.kind,'imported');draft.tts!.ratePercent=15;draft=value.store.update(draft.id,draft.revision,draft)
  assert.equal(sceneCoverage(draft.scenes[0],draft.tts).audioStale,false)
 }finally{value.close()}
})


test('Production checklist locates timeline gaps, stale speech and invalid starts even with explicit hold',()=>{
 const value=fixture();try{
  const draft=sceneDraft(value.store,'Checklist');Object.assign(draft.scenes[0],{narration:'Pending',videoArtifactId:'clip.mp4',sourceDurationSeconds:6,sourceStartSeconds:2,playbackRate:2})
  draft.scenes.push({...newStudioScene('second'),imageArtifactId:'image.png',durationSeconds:3})
  let report=draftReadiness(draft);assert.equal(report.durationSeconds,11);assert.deepEqual(report.pendingNarrationSceneIds,['first-scene']);assert.deepEqual(report.scenes.map(scene=>[scene.startSeconds,scene.endSeconds]),[[0,8],[8,11]])
  assert.equal(report.scenes[0].gapSeconds,6);assert.equal(report.ready,false);assert.ok(report.issues.some(issue=>issue.code==='footage-gap'&&issue.sceneId==='first-scene'))
  draft.scenes[0].narration='';draft.scenes[0].endPolicy='hold';report=draftReadiness(draft);assert.equal(report.ready,true);assert.equal(report.issues[0].severity,'warning')
  draft.scenes[0].sourceStartSeconds=6;assert.throws(()=>draftComposition(draft),/起点/);assert.equal(draftReadiness(draft).issues[0].code,'source-range')
  assert.equal(draftReadiness(value.store.create('Empty')).issues[0].code,'empty-draft')
  for(const operation of ['check','narrate-pending']){assert.throws(()=>assertStudioRequest({operation}),/requires/);assert.throws(()=>assertStudioRequest({operation,draftId:draft.id,expectedRevision:1,provider:'local-matcha'}),/Unsupported/)}
 }finally{value.close()}
})

test('Measured readiness collects shared and missing asset issues without writes and uses the same export gate',async()=>{
 const value=fixture();try{
  fs.writeFileSync(path.join(value.root,'artifacts','clip.mp4'),'fixture')
  const calls:string[]=[],kernel:StudioKernel={projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>{throw new Error('Must never export')},processArtifact:async raw=>{calls.push((raw as {artifactId:string}).artifactId);return {durationSeconds:3,tracks:[{type:'video',canDecode:true,width:320,height:180}]}}}}
  let draft=sceneDraft(value.store,'Measured');Object.assign(draft.scenes[0],{videoArtifactId:'clip.mp4',sourceDurationSeconds:100})
  draft.scenes.push({...newStudioScene('second'),videoArtifactId:'clip.mp4',sourceDurationSeconds:100,audioArtifactId:'missing.wav',audioText:'',audioDurationSeconds:1},{...newStudioScene('third'),imageArtifactId:'missing.png'})
  draft=value.store.update(draft.id,draft.revision,draft);const before=fs.readFileSync(path.join(value.store.directory,draft.id+'.json'),'utf8'),service=new FixtureVideoStudioService(kernel)
  const report=await service.execute({operation:'check',draftId:draft.id,expectedRevision:draft.revision}) as ReturnType<typeof draftReadiness>&{checkedAssets:{artifactId:string;verification:string}[]}
  assert.equal(report.ready,false);assert.deepEqual(calls,['clip.mp4']);assert.equal(report.scenes[0].availableSeconds,3);assert.equal(report.scenes[0].gapSeconds,5)
  assert.deepEqual(report.issues.filter(issue=>issue.code==='asset-unavailable').map(issue=>issue.sceneId),['second','third']);assert.equal(report.checkedAssets[0].verification,'tracks');assert.equal(fs.readFileSync(path.join(value.store.directory,draft.id+'.json'),'utf8'),before)
  await assert.rejects(service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision}),/补录 5.0/)
 }finally{value.close()}
})

test('Readiness rejects alpha, oversized, undecodable tracks, symlinks and revisions changed during inspection',async()=>{
 const value=fixture();try{
  fs.writeFileSync(path.join(value.root,'artifacts','clip.mp4'),'fixture');fs.symlinkSync(path.join(value.root,'artifacts','clip.mp4'),path.join(value.root,'artifacts','linked.png'))
  let tracks:unknown[]=[{type:'video',canDecode:true,hasAlphaData:true}],changed=false
  const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>{if(changed){const current=value.store.read(draft.id);current.scenes[0].title='Concurrent edit';value.store.update(current.id,current.revision,current)}return {durationSeconds:8,tracks}}}})
  let draft=sceneDraft(value.store,'Admission');draft.scenes[0].videoArtifactId='clip.mp4';draft=value.store.update(draft.id,1,draft)
  for(const input of [[{type:'video',canDecode:true,hasAlphaData:true}],[{type:'video',canDecode:true,width:8192,height:8192}],[{type:'video',canDecode:false}]]){tracks=input;const report=await service.execute({operation:'check',draftId:draft.id,expectedRevision:draft.revision}) as ReturnType<typeof draftReadiness>;assert.ok(report.issues.some(issue=>issue.code==='asset-unavailable'));assert.equal(report.ready,false)}
  tracks=[{type:'video',canDecode:true}];changed=true;await assert.rejects(service.execute({operation:'check',draftId:draft.id,expectedRevision:draft.revision}),/STUDIO_CONFLICT/);assert.equal(value.store.read(draft.id).scenes[0].title,'Concurrent edit')
  changed=false;draft=value.store.read(draft.id);delete draft.scenes[0].videoArtifactId;draft.scenes[0].imageArtifactId='linked.png';draft=value.store.update(draft.id,draft.revision,draft)
  const linked=await service.execute({operation:'check',draftId:draft.id,expectedRevision:draft.revision}) as ReturnType<typeof draftReadiness>;assert.equal(linked.ready,false);assert.equal(linked.issues[0].artifactId,'linked.png')
 }finally{value.close()}
})

test('Pending narration saves each scene, skips current imports and resumes safely after provider failure',async()=>{
 const value=fixture();try{
  const calls:string[]=[],changes:number[]=[];let fail=true
  const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),videoStudioChanged:()=>{changes.push(value.store.read(draft.id).revision)},recordingController:{narrate:async raw=>{const text=(raw as {text:string}).text;calls.push(text);if(text==='Second'&&fail)throw new Error('Provider failed');return {artifactId:text+'.wav',durationSeconds:2}},compose:async()=>({}),processArtifact:async()=>({})}})
  let draft=sceneDraft(value.store,'Batch');draft.tts={provider:'local-matcha',voice:'local-zh-en',ratePercent:0};draft.scenes[0].narration='First';draft.scenes.push({...newStudioScene('second'),narration:'Second'},{...newStudioScene('import'),narration:'Import',audioText:'Import',audioArtifactId:'import.wav',audioDurationSeconds:1},{...newStudioScene('silent'),bullets:['Silent card']})
  draft=value.store.update(draft.id,1,draft)
  await assert.rejects(service.execute({operation:'narrate-pending',draftId:draft.id,expectedRevision:draft.revision}),/Provider failed/)
  let current=value.store.read(draft.id);assert.equal(current.revision,draft.revision+1);assert.equal(current.scenes[0].audioText,'First');assert.equal(current.scenes[1].audioArtifactId,undefined);assert.equal(current.scenes[2].audioArtifactId,'import.wav');assert.ok(changes.includes(current.revision))
  fail=false;const resumed=await service.execute({operation:'narrate-pending',draftId:current.id,expectedRevision:current.revision}) as {draft:VideoDraft;completedSceneIds:string[];skippedSceneIds:string[]};assert.deepEqual(resumed.completedSceneIds,['second']);assert.deepEqual(resumed.skippedSceneIds,['first-scene','import','silent']);assert.deepEqual(calls,['First','Second','Second']);assert.equal(resumed.draft.scenes[1].durationSeconds,3)
  const noop=await service.execute({operation:'narrate-pending',draftId:current.id,expectedRevision:resumed.draft.revision}) as {draft:VideoDraft;completedSceneIds:string[]};assert.equal(noop.draft.revision,resumed.draft.revision);assert.deepEqual(noop.completedSceneIds,[])
 }finally{value.close()}
})

test('Batch cancellation and concurrent edits reject late results without committing or starting later speech',async()=>{
 for(const mode of ['cancel','conflict'] as const){const value=fixture();try{
  let draft=sceneDraft(value.store,'Race');draft.tts={provider:'local-matcha',voice:'local-zh-en',ratePercent:0};draft.scenes[0].narration='First';draft.scenes.push({...newStudioScene('second'),narration:'Second'});draft=value.store.update(draft.id,1,draft)
  const controller=new AbortController();let calls=0
  const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>{calls++;if(mode==='cancel')controller.abort(new Error('Cancelled'));else{const edited=value.store.read(draft.id);edited.scenes[0].narration='GUI edit';value.store.update(edited.id,edited.revision,edited)}return {artifactId:'late.wav',durationSeconds:2}},compose:async()=>({}),processArtifact:async()=>({})}})
  await assert.rejects(service.execute({operation:'narrate-pending',draftId:draft.id,expectedRevision:draft.revision},controller.signal),mode==='cancel'?/Cancelled/:/STUDIO_CONFLICT/)
  assert.equal(calls,1);const current=value.store.read(draft.id);assert.equal(current.scenes[0].audioArtifactId,undefined);assert.equal(current.scenes[1].audioArtifactId,undefined);assert.equal(current.scenes[0].narration,mode==='cancel'?'First':'GUI edit')
 }finally{value.close()}}
})

test('Narration preserves independent caption endpoints and refuses scene or whole-film duration overflow',async()=>{
 const value=fixture();try{
  let seconds=1,draft=sceneDraft(value.store,'Caption timing');draft.tts={provider:'local-matcha',voice:'local-zh-en',ratePercent:0};Object.assign(draft.scenes[0],{narration:'Speech',captions:[{startSeconds:5,endSeconds:7.25,text:'Keep edited timing'}]});draft=value.store.update(draft.id,1,draft)
  const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({artifactId:'voice-'+seconds+'.wav',durationSeconds:seconds}),compose:async()=>({}),processArtifact:async()=>({})}})
  const generated=await service.execute({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:'first-scene'}) as {draft:VideoDraft};assert.equal(generated.draft.scenes[0].durationSeconds,7.25);assert.deepEqual(generated.draft.scenes[0].captions,draft.scenes[0].captions)
  draft=generated.draft;seconds=60
  await assert.rejects(service.execute({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:'first-scene'}),/scene duration/);assert.equal(value.store.read(draft.id).revision,draft.revision)
  draft.scenes.push({...newStudioScene('second'),durationSeconds:60},{...newStudioScene('third'),durationSeconds:60},{...newStudioScene('fourth'),durationSeconds:50});draft=value.store.update(draft.id,draft.revision,draft);seconds=20
  await assert.rejects(service.execute({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:'first-scene'}),/three minutes/);assert.equal(value.store.read(draft.id).scenes[0].audioArtifactId,generated.draft.scenes[0].audioArtifactId)
 }finally{value.close()}
})


test('Batch uses the draft voice snapshot, respects online opt-out and retains completed scenes on cancellation',async()=>{
 const value=fixture();try{
  let draft=sceneDraft(value.store,'Consent');draft.scenes[0].narration='First';draft.scenes.push({...newStudioScene('second'),narration:'Second'});draft=value.store.update(draft.id,1,draft)
  let calls=0,enabled=false;const controller=new AbortController()
  const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),settingsStore:{snapshot:()=>({edgeNarrationEnabled:enabled}),update:()=>{}},recordingController:{narrate:async raw=>{calls++;assert.equal((raw as {voice:string}).voice,'zh-CN-YunxiNeural');if(calls===2)controller.abort(new Error('Stop second'));return {artifactId:'voice-'+calls+'.wav',durationSeconds:1}},compose:async()=>({}),processArtifact:async()=>({})}})
  await assert.rejects(service.execute({operation:'narrate-pending',draftId:draft.id,expectedRevision:draft.revision}),/disabled/);assert.equal(calls,0);assert.equal(value.store.read(draft.id).revision,draft.revision)
  enabled=true;await assert.rejects(service.execute({operation:'narrate-pending',draftId:draft.id,expectedRevision:draft.revision},controller.signal),/Stop second/)
  const current=value.store.read(draft.id);assert.equal(calls,2);assert.equal(current.revision,draft.revision+1);assert.equal(current.scenes[0].audioArtifactId,'voice-1.wav');assert.equal(current.scenes[1].audioArtifactId,undefined)
  const aborted=new AbortController();aborted.abort(new Error('Pre-cancel'));await assert.rejects(service.execute({operation:'check',draftId:current.id,expectedRevision:current.revision},aborted.signal),/Pre-cancel/)
 }finally{value.close()}
})


test('Studio exports Project subtitles and literal bounded text while segment changes retain measured narration',async()=>{
 const value=fixture();try{
  fs.writeFileSync(path.join(value.root,'artifacts','one.png'),'fixture');fs.writeFileSync(path.join(value.root,'artifacts','two.png'),'fixture');fs.writeFileSync(path.join(value.root,'artifacts','notes.md'),'<script>source only</script>')
  let draft=sceneDraft(value.store,'Segments');Object.assign(draft.scenes[0],{imageArtifactId:'one.png',audioArtifactId:'voice.wav',audioText:'',audioDurationSeconds:1,captions:[{startSeconds:.5,endSeconds:1.5,text:'Caption'}]});draft=value.store.update(draft.id,1,draft)
  const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async raw=>{const value=raw as {action:string};if(value.action==='media.image.inspect')return {kind:'image',contentType:'image/png',width:1,height:1,pixels:1,bytes:7,canDecode:true};return {durationSeconds:1,tracks:[{type:'audio',canDecode:true}]}}}})
  draft=await service.execute({operation:'attach',draftId:draft.id,expectedRevision:draft.revision,sceneId:'first-scene',artifactId:'two.png',assetKind:'image',segmentIndex:1}) as VideoDraft
  assert.equal(draft.scenes[0].visualSegments?.length,2);assert.equal(draft.scenes[0].imageArtifactId,undefined);assert.equal(draft.scenes[0].audioArtifactId,'voice.wav');assert.equal(draft.scenes[0].visualSegments![0].durationSeconds,4)
  draft.scenes[0].visualSegments![0].durationSeconds=2;draft.scenes[0].visualSegments![1].durationSeconds=6;draft=value.store.update(draft.id,draft.revision,draft)
  draft=await service.execute({operation:'attach',draftId:draft.id,expectedRevision:draft.revision,sceneId:'first-scene',artifactId:'one.png',assetKind:'image',segmentIndex:1}) as VideoDraft
  assert.deepEqual(draft.scenes[0].visualSegments!.map(segment=>segment.durationSeconds),[2,6],'Replacing the last piece preserves edited allocations')
  const revision=draft.revision,result=await service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:revision,captionFormat:'srt'}) as {artifactId:string;timing:string}
  assert.equal(result.timing,'edited');assert.match(fs.readFileSync(path.join(value.root,'artifacts',result.artifactId),'utf8'),/Caption/);assert.equal(value.store.read(draft.id).revision,revision)
  const material=await service.execute({operation:'read-material',artifactId:'notes.md'}) as {text:string;truncated:boolean};assert.equal(material.text,'<script>source only</script>');assert.equal(material.truncated,false)
  await assert.rejects(service.execute({operation:'read-material',artifactId:'one.png'}),/text material/)
  const prompt=studioAssistantPrompt(draft,'script');assert.match(prompt,/read-material/);assert.match(prompt,/不覆盖/);assert.equal(studioAssistantRequest({projectId:'p',draftId:draft.id,expectedRevision:revision,intent:'script'}).intent,'script');assert.throws(()=>studioAssistantRequest({projectId:'p',draftId:draft.id,expectedRevision:revision,intent:'shell'}))
 }finally{value.close()}
})

function fixtureKernel(kernel:import('../src/studio-service.js').StudioKernel):import('../src/studio-service.js').StudioKernel{
 const process=kernel.recordingController.processArtifact.bind(kernel.recordingController)
 return {...kernel,recordingController:{...kernel.recordingController,processArtifact:async(raw,signal)=>{
 const request=raw as {action:string;width:number;height:number;fps:number};
 if(request.action==='media.encode.check')return {kind:'encoding',width:request.width,height:request.height,fps:request.fps,videoCodec:'avc',audioCodec:'aac',videoSupported:true,audioSupported:true};
 if(request.action==='media.image.inspect')return {kind:'image',contentType:'image/png',width:1,height:1,pixels:1,bytes:1,canDecode:true};
 return process(raw,signal)
 }}}
}
class OwnedVideoStudioService extends VideoStudioService {override execute(raw:unknown,signal?:AbortSignal,owner:import('@bmw-agent/browser-capability/host').BrowserSessionOwner={projectId:this.kernel.projectStore.active().id,sessionId:'fixture-session'}):Promise<unknown>{return super.execute(raw,signal,owner)}}
class FixtureVideoStudioService extends OwnedVideoStudioService {constructor(kernel:import('../src/studio-service.js').StudioKernel){super(fixtureKernel(kernel))}}


test('Measured image budget deduplicates shared pictures and unsupported encoders block export without writes',async()=>{
 const value=fixture();try{
  for(const id of ['a.png','b.png','c.png'])fs.writeFileSync(path.join(value.root,'artifacts',id),'image fixture')
  let draft=sceneDraft(value.store,'Budgets');draft.scenes[0].imageArtifactId='a.png';draft.scenes.push({...newStudioScene('second'),imageArtifactId:'a.png'},{...newStudioScene('third'),imageArtifactId:'a.png'});draft=value.store.update(draft.id,1,draft)
  let images=0,renders=0,supported=true
  const kernel:StudioKernel={projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>{renders++;return {}},processArtifact:async raw=>{const request=raw as {action:string;width:number;height:number;fps:number};if(request.action==='media.image.inspect'){images++;return {kind:'image',contentType:'image/png',width:4096,height:4096,pixels:16777216,bytes:13,canDecode:true}}return {kind:'encoding',width:request.width,height:request.height,fps:request.fps,videoCodec:'avc',audioCodec:'aac',videoSupported:supported,audioSupported:true}}}}
  const service=new OwnedVideoStudioService(kernel),check=()=>service.execute({operation:'check',draftId:draft.id,expectedRevision:draft.revision}) as Promise<{ready:boolean;issues:{code:string}[];checkedAssets:unknown[]}>
  let report=await check();assert.equal(report.ready,true);assert.equal(images,1);assert.equal(report.checkedAssets.length,1)
  supported=false;report=await check();assert.equal(report.ready,false);assert.ok(report.issues.some(issue=>issue.code==='encoding-unavailable'));await assert.rejects(service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision}),/H.264/);assert.equal(renders,0);assert.equal(value.store.read(draft.id).revision,draft.revision)
  supported=true;draft.scenes[1].imageArtifactId='b.png';draft.scenes[2].imageArtifactId='c.png';draft=value.store.update(draft.id,draft.revision,draft);report=await check();assert.equal(report.ready,false);assert.ok(report.issues.some(issue=>issue.code==='asset-budget'));assert.equal(value.store.read(draft.id).revision,draft.revision)
 }finally{value.close()}
})

test('Cover export admits closed options, legacy drafts and independent zero-scene output',async()=>{
 const value=fixture();try{
  assert.throws(()=>assertStudioRequest({operation:'export-cover',draftId:'draft'}),/revision/i)
  for(const cover of [{title:'x',url:'https://example.com'},{sourceArtifactId:'../source.png'},{background:'url(x)'},{timestampSeconds:Infinity},{title:'x'.repeat(81)}])assert.throws(()=>assertStudioRequest({operation:'export-cover',draftId:'draft',expectedRevision:1,cover}))
  const draft=value.store.create('封面标题'),calls:unknown[]=[];let notices=0
  const service=new OwnedVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),videoStudioChanged:()=>{notices++},recordingController:{narrate:async()=>{throw new Error('No narration')},compose:async()=>{throw new Error('No video')},processArtifact:async raw=>{calls.push(raw);fs.writeFileSync(path.join(value.root,'artifacts','cover.png'),'native fixture');return {artifactId:'cover.png',width:draft.width,height:draft.height,type:'screenshot',contentType:'image/png'}}}})
  const result=await service.execute({operation:'export-cover',draftId:draft.id,expectedRevision:1}) as {draft:VideoDraft}
  assert.equal(result.draft.scenes.length,0);assert.equal(result.draft.exports.length,0);assert.equal(result.draft.cover!.title,draft.title);assert.equal(result.draft.coverExports![0].revision,1);assert.equal(result.draft.revision,2);assert.equal(notices,1);assert.equal((calls[0] as {action:string}).action,'video.cover')
  assert.equal(assertVideoDraft({...draft,cover:undefined,coverExports:undefined}).cover!.title,draft.title)
  const current=result.draft;current.coverExports=[];delete current.cover
  const saved=value.store.update(current.id,current.revision,current);assert.equal(saved.coverExports!.length,1);assert.equal(saved.cover!.title,draft.title)
  const persisted=value.store.read(draft.id);assert.equal(persisted.coverExports![0].artifactId,'cover.png')
 }finally{value.close()}
})
test('Cover source admission rejects other Project IDs, audio and symlinks before native work',async()=>{
 const value=fixture();try{
  fs.writeFileSync(path.join(value.root,'artifacts','voice.wav'),'fixture');fs.writeFileSync(path.join(value.root,'artifacts','image.png'),'fixture');fs.symlinkSync(path.join(value.root,'artifacts','image.png'),path.join(value.root,'artifacts','link.png'))
  const draft=value.store.create('Cover');let calls=0
  const service=new OwnedVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>{calls++;return {}}}})
  for(const sourceArtifactId of ['foreign.png','voice.wav','link.png'])await assert.rejects(service.execute({operation:'export-cover',draftId:draft.id,expectedRevision:1,cover:{sourceArtifactId}}),/Project image or video/)
  await assert.rejects(service.execute({operation:'export-cover',draftId:draft.id,expectedRevision:1,cover:{sourceArtifactId:'image.png',timestampSeconds:1}}),/Static/)
  assert.equal(calls,0);assert.equal(value.store.read(draft.id).revision,1)
 }finally{value.close()}
})
test('Cancelled or conflicting cover jobs remove only their new PNG and preserve GUI changes',async()=>{
 for(const mode of ['cancel','conflict'] as const){const value=fixture();try{
  fs.writeFileSync(path.join(value.root,'artifacts','source.png'),'source');const draft=value.store.create('Cover'),abort=new AbortController()
  const service=new OwnedVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>{
   fs.writeFileSync(path.join(value.root,'artifacts','late-cover.png'),'new PNG')
   if(mode==='cancel')abort.abort(new Error('Cover cancelled'));else{const newer=value.store.read(draft.id);newer.title='GUI title';value.store.update(newer.id,newer.revision,newer)}
   return {artifactId:'late-cover.png',width:draft.width,height:draft.height,type:'screenshot',contentType:'image/png'}
  }}})
  await assert.rejects(service.execute({operation:'export-cover',draftId:draft.id,expectedRevision:1},abort.signal),mode==='cancel'?/cancelled/:/STUDIO_CONFLICT/)
  assert.deepEqual(fs.readdirSync(path.join(value.root,'artifacts')),['source.png']);assert.equal(value.store.read(draft.id).coverExports!.length,0);assert.equal(value.store.read(draft.id).title,mode==='cancel'?'Cover':'GUI title')
 }finally{value.close()}}
})


test('Workbench timeline preserves cumulative fractional scene and segment boundaries with caption provenance',()=>{
  const value=fixture();try{
    const draft=sceneDraft(value.store,'Timeline'),first=draft.scenes[0];first.durationSeconds=2.5;first.narration='旧稿';first.audioText='旧稿';first.audioArtifactId='voice.wav';first.audioDurationSeconds=1.5;first.captions=[]
    const second={...newStudioScene('second'),durationSeconds:3.25,narration:'时间关系',captions:[{startSeconds:.25,endSeconds:1.75,text:'独立字幕'}],visualSegments:[{imageArtifactId:'a.png',durationSeconds:1.25,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut' as const,transitionSeconds:0},{imageArtifactId:'b.png',durationSeconds:2,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'fade' as const,transitionSeconds:.2}]}
    draft.scenes.push(second);const model=studioTimeline(draft);assert.equal(model.duration,5.75)
    assert.deepEqual(model.clips.filter(clip=>clip.kind==='visual').map(clip=>[clip.start,clip.end]),[[2.5,3.75],[3.75,5.75]])
    assert.deepEqual(model.clips.filter(clip=>clip.kind==='caption').map(clip=>[clip.sceneIndex,clip.start,clip.end,clip.estimated]),[[1,2.75,4.25,false]])
    assert.deepEqual(model.clips.filter(clip=>clip.kind==='voice').map(clip=>[clip.start,clip.end,clip.stale]),[[.5,2,false]])
    for(const [time,index]of [[0,0],[2.499,0],[2.5,1],[5.75,1]] as const)assert.equal(studioSceneIndex(draft,time),index)
    first.narration='改稿';assert.equal(studioTimeline(draft).clips.find(clip=>clip.kind==='voice')!.stale,true)
  }finally{value.close()}
})
test('Workbench timeline labels estimated captions and admits empty cover-only drafts',()=>{
  const value=fixture();try{const empty=value.store.create('Cover');assert.deepEqual(studioTimeline(empty),{duration:0,clips:[]});assert.equal(studioSceneIndex(empty,0),-1)
    empty.scenes.push({...newStudioScene('scene'),durationSeconds:4,narration:'这是用于检查时间轴的旁白。',audioDurationSeconds:2});const captions=studioTimeline(empty).clips.filter(clip=>clip.kind==='caption');assert.ok(captions.length>0);assert.ok(captions.every(clip=>clip.estimated&&clip.start>=0&&clip.end<=4))
  }finally{value.close()}
})



test('Studio Session ownership hides legacy and foreign drafts and rejects every foreign draft operation',async()=>{
 const value=fixture();try{
  const a=value.store.create('A'),b=new VideoStudioStore(value.root,'other-session').create('B')
  const legacy={...a,id:'legacy'};delete legacy.ownerSessionId;fs.writeFileSync(path.join(value.root,'video-studio','legacy.json'),JSON.stringify(legacy))
  assert.deepEqual(value.store.list().map(draft=>draft.id),[a.id]);assert.deepEqual(new VideoStudioStore(value.root,'other-session').list().map(draft=>draft.id),[b.id])
  assert.throws(()=>value.store.read(b.id),/STUDIO_SESSION_MISMATCH/);assert.throws(()=>value.store.read('legacy'),/STUDIO_SESSION_MISMATCH/)
  assert.throws(()=>value.store.update(a.id,a.revision,{...a,ownerSessionId:'other-session'}),/STUDIO_SESSION_MISMATCH/)
  const service=new VideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{compose:async()=>{throw new Error('Forbidden native call')},narrate:async()=>{throw new Error('Forbidden native call')},processArtifact:async()=>{throw new Error('Forbidden native call')}}}),owner={projectId:'p',sessionId:'other-session'}
  const requests=[{operation:'read',draftId:a.id},{operation:'update',draftId:a.id,expectedRevision:1,draft:a},{operation:'configure',draftId:a.id,expectedRevision:1},{operation:'save-template',draftId:a.id,expectedRevision:1,templateName:'Template'},{operation:'narrate',draftId:a.id,expectedRevision:1,sceneId:'scene'},{operation:'attach',draftId:a.id,expectedRevision:1,sceneId:'scene',artifactId:'shared.png',assetKind:'image'},{operation:'render',draftId:a.id,expectedRevision:1},{operation:'export-captions',draftId:a.id,expectedRevision:1,captionFormat:'srt'},...['delete','check','narrate-pending','export-cover'].map(operation=>({operation,draftId:a.id,expectedRevision:1}))]
  for(const request of requests)await assert.rejects(service.execute(request,undefined,owner),/STUDIO_SESSION_MISMATCH/)
  await assert.rejects(service.execute({operation:'list'}),/STUDIO_SESSION_REQUIRED/)
  await assert.rejects(service.execute({operation:'create',title:'x'},undefined,{...owner,projectId:'foreign'}),/STUDIO_SESSION_REQUIRED/)
  assert.equal(value.store.read(a.id).revision,1)
 }finally{value.close()}
})
test('Studio deletion checks Session and revision and keeps shared materials exports and recoverable records',()=>{
 const value=fixture();try{
  let draft=value.store.create('Delete');const other=value.store.create('Keep')
  fs.writeFileSync(path.join(value.root,'artifacts','final.mp4'),'export');fs.writeFileSync(path.join(value.root,'artifacts','shared.png'),'material')
  draft=value.store.addExport(draft.id,draft.revision,{artifactId:'final.mp4',durationSeconds:2})
  assert.throws(()=>new VideoStudioStore(value.root,'foreign').delete(draft.id,draft.revision),/STUDIO_SESSION_MISMATCH/)
  assert.throws(()=>value.store.delete(draft.id,1),/STUDIO_CONFLICT/)
  assert.deepEqual(value.store.delete(draft.id,draft.revision),{deleted:draft.id});assert.throws(()=>value.store.read(draft.id),/ENOENT/)
  assert.deepEqual(value.store.list().map(draft=>draft.id),[other.id]);assert.equal(value.store.assets(value.root).length,2)
  const deleted=path.join(value.root,'video-studio','deleted'),record=JSON.parse(fs.readFileSync(path.join(deleted,fs.readdirSync(deleted)[0]),'utf8'));assert.deepEqual(record,draft)
 }finally{value.close()}
})
test('Studio bridge forwards authenticated Session ownership instead of accepting a caller-selected owner',async()=>{
 const value=fixture();let bridge:Awaited<ReturnType<typeof import('@bmw-agent/browser-capability/bridge').createBridgeServer>>|undefined
 try{
  const {createBridgeServer}=await import('@bmw-agent/browser-capability/bridge')
  const kernel:StudioKernel={projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>({})}},service=new VideoStudioService(kernel)
  bridge=await createBridgeServer({execute:async(raw,options)=>service.execute((raw as {studioRequest:unknown}).studioRequest,options?.signal,options?.sessionOwner)},{resolveProject:directory=>({id:'p',directory}),activeProjectId:()=> 'p'})
  const request=async(endpoint:string,body:unknown)=>{const response=await fetch(bridge!.url+'/'+endpoint,{method:'POST',headers:{authorization:'Bearer '+bridge!.token,'content-type':'application/json'},body:JSON.stringify(body)});return response.json() as Promise<{binding:string;result:VideoDraft&{drafts:VideoDraft[]};ok:boolean;error:string}>}
  const a={binding:bridge.registerSession('fixture-session',value.root)},b={binding:bridge.registerSession('second-session',value.root)}
  const created=await request('execute',{binding:a.binding,arguments:{action:'video.studio',studioRequest:{operation:'create',title:'Owned'}}});assert.equal(created.result.ownerSessionId,'fixture-session')
  const listed=await request('execute',{binding:b.binding,arguments:{action:'video.studio',studioRequest:{operation:'list'}}});assert.deepEqual(listed.result.drafts,[])
  const changed=await request('execute',{binding:b.binding,sessionOwner:{projectId:'p',sessionId:'fixture-session'},arguments:{action:'video.studio',studioRequest:{operation:'update',draftId:created.result.id,expectedRevision:1,draft:created.result}}});assert.equal(changed.ok,false);assert.match(changed.error,/STUDIO_SESSION_MISMATCH/)
  assert.equal(value.store.read(created.result.id).revision,1)
 }finally{await bridge?.close();value.close()}
})

test('Studio pending narration keeps the admitted owner when caller identity changes during an awaited job',async()=>{
 const value=fixture();try{
  let draft=sceneDraft(value.store,'Queued');draft.tts={provider:'local-matcha',voice:'local-zh-en',ratePercent:0};draft.scenes[0].narration='First';draft.scenes.push({...newStudioScene('second'),narration:'Second'});draft=value.store.update(draft.id,1,draft)
  const owner={projectId:'p',sessionId:'fixture-session'},notices:string[]=[],calls:string[]=[]
  const service=new VideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),videoStudioChanged:scope=>{notices.push(scope!.sessionId)},recordingController:{compose:async()=>({}),processArtifact:async()=>({}),narrate:async raw=>{const text=(raw as {text:string}).text;calls.push(text);await Promise.resolve();owner.sessionId='other-session';return {artifactId:'voice-'+calls.length+'.wav',durationSeconds:2}}}})
  const result=await service.execute({operation:'narrate-pending',draftId:draft.id,expectedRevision:draft.revision},undefined,owner) as {draft:VideoDraft}
  assert.deepEqual(calls,['First','Second']);assert.equal(result.draft.ownerSessionId,'fixture-session');assert.ok(notices.every(id=>id==='fixture-session'));assert.deepEqual(new VideoStudioStore(value.root,'other-session').list(),[])
 }finally{value.close()}
})


test('Completed MP4 reuse survives cover/notes edits but invalidates changed composition, files and forged journals',async()=>{
  const value=fixture();try{
    fs.writeFileSync(path.join(value.root,'artifacts','frame.png'),'source');fs.writeFileSync(path.join(value.root,'artifacts','voice.wav'),'existing audio');let renders=0
    const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),processArtifact:async()=>({type:'image',contentType:'image/png',width:320,height:180,pixels:57600,bytes:6,frames:1}),compose:async()=>{const artifactId='final-'+(++renders)+'.mp4';fs.writeFileSync(path.join(value.root,'artifacts',artifactId),'completed');return {artifactId,durationSeconds:8}}}})
    let draft=sceneDraft(value.store,'Reuse');draft.scenes[0].imageArtifactId='frame.png';draft=value.store.update(draft.id,draft.revision,draft)
    // Journal admission is independently tested; initial render is provided a valid measured fixture.
    fs.writeFileSync(path.join(value.root,'artifacts','first.mp4'),'completed');fs.writeFileSync(path.join(value.root,'artifacts','report.json'),'verified')
    draft=value.store.addExport(draft.id,draft.revision,{artifactId:'first.mp4',durationSeconds:8,verificationArtifactId:'report.json'});const originalRevision=draft.revision
    const result=await service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision}) as {draft:VideoDraft;reused:boolean;export:{artifactId:string}}
    assert.equal(result.reused,true);assert.equal(result.export.artifactId,'first.mp4');assert.equal(result.draft.revision,originalRevision);assert.equal(renders,0)
    draft.cover={...draft.cover!,title:'独立封面'};draft.preparation.notes='Updated notes';draft=value.store.update(draft.id,draft.revision,draft)
    assert.equal(value.store.reusableExport(draft)?.artifactId,'first.mp4')
    const stable=structuredClone(draft)
    for(const change of [(d:VideoDraft)=>{d.scenes[0].focusIntervals=[{startSeconds:1,endSeconds:3,x:.5,y:.5,zoom:2,emphasize:false}]},(d:VideoDraft)=>{d.scenes[0].audioArtifactId='voice.wav';d.scenes[0].audioText='';d.scenes[0].audioDurationSeconds=1},(d:VideoDraft)=>{d.scenes[0].crop={x:0,y:0,width:.5,height:.5}},(d:VideoDraft)=>{d.scenes[0].captions=[{startSeconds:0,endSeconds:1,text:'changed'}]},(d:VideoDraft)=>{d.width=640},(d:VideoDraft)=>{d.scenes[0].durationSeconds=9}]){const changed=structuredClone(stable);change(changed);assert.equal(value.store.reusableExport(changed),undefined)}
    const forged=structuredClone(draft);forged.exports[0].fingerprint='a'.repeat(64);draft=value.store.update(draft.id,draft.revision,forged);assert.notEqual(draft.exports[0].fingerprint,'a'.repeat(64));assert.ok(value.store.reusableExport(draft))
    fs.writeFileSync(path.join(value.root,'artifacts','report.json'),'changed report');assert.equal(value.store.reusableExport(draft),undefined)
    draft=value.store.addExport(draft.id,draft.revision,{artifactId:'first.mp4',durationSeconds:8});assert.ok(value.store.reusableExport(draft))
    fs.writeFileSync(path.join(value.root,'artifacts','frame.png'),'replaced source');assert.equal(value.store.reusableExport(draft),undefined)
    draft=value.store.addExport(draft.id,draft.revision,{artifactId:'first.mp4',durationSeconds:8});assert.ok(value.store.reusableExport(draft))
    fs.rmSync(path.join(value.root,'artifacts','first.mp4'));assert.equal(value.store.reusableExport(draft),undefined)
    assert.throws(()=>assertStudioRequest({operation:'render',forceRender:'yes'}),/boolean/);assert.throws(()=>assertStudioRequest({operation:'read',forceRender:true}),/render/)
    assert.equal(assertStudioRequest({operation:'render',forceRender:true}).forceRender,true)
    await assert.rejects(service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision-1}),/STUDIO_CONFLICT/)
  }finally{value.close()}
})

test('Focus suggestions admit only Project recordings at the owning revision and never overwrite manual focus or speech',async()=>{
 const value=fixture();try{
  let draft=sceneDraft(value.store,'焦点');Object.assign(draft.scenes[0],{videoArtifactId:'record.webm',sourceDurationSeconds:20,narration:'旁白',audioArtifactId:'voice.wav',audioText:'旁白',audioDurationSeconds:2,focusIntervals:[{startSeconds:5,endSeconds:7,x:.5,y:.5,zoom:2,emphasize:false}]});draft=value.store.update(draft.id,1,draft)
  const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>{throw new Error('must not narrate')},compose:async()=>({}),processArtifact:async()=>({})}})
  const request={operation:'suggest-focus',draftId:draft.id,expectedRevision:draft.revision,sceneId:draft.scenes[0].id}
  await assert.rejects(service.execute(request),/自动建议不可用/)
  const record={version:1,artifactId:'record.webm',timeDomain:'recording-seconds',coordinateDomain:'viewport-css-pixels',mapping:'viewport-to-output',clock:{startedEpochMs:100000,width:1600,height:800},durationSeconds:8,sampleIntervalMs:100,pausePolicy:'unsupported',navigationPolicy:'continue',truncated:false,stopReason:'requested',frameClock:[{sourceEpochMs:101020,outputSeconds:1}],frameClockTruncated:false,events:[{pageSeconds:.98,timing:'measured-frame',kind:'click',source:'page-event',seconds:1,x:400,y:200,viewportWidth:800,viewportHeight:400,surfaceWidth:800,surfaceHeight:400,dpr:2,scrollX:0,scrollY:0}]}
  fs.writeFileSync(path.join(value.root,'artifacts','record.webm.events.json'),JSON.stringify(record))
  const result=await service.execute(request) as {focusIntervals:{startSeconds:number}[]};assert.equal(result.focusIntervals.length,1);assert.deepEqual(value.store.read(draft.id),draft)
  const clips=studioTimeline(draft).clips.filter(clip=>clip.kind==='focus');assert.equal(clips[0].start,5);assert.equal(clips[0].end,7)
  draft.scenes[0].focusIntervals![0].zoom=1.2;draft=value.store.update(draft.id,draft.revision,draft);assert.equal(sceneCoverage(draft.scenes[0],draft.tts).audioStale,false)
  await assert.rejects(service.execute(request),/STUDIO_CONFLICT/)
  fs.writeFileSync(path.join(value.root,'artifacts','record.webm.events.json'),JSON.stringify({...record,artifactId:'foreign.webm'}));await assert.rejects(service.execute({...request,expectedRevision:draft.revision}),/another video/)
  fs.rmSync(path.join(value.root,'artifacts','record.webm.events.json'));fs.symlinkSync('/etc/hosts',path.join(value.root,'artifacts','record.webm.events.json'));await assert.rejects(service.execute({...request,expectedRevision:draft.revision}),/自动建议不可用/)
 }finally{value.close()}
})

const speechHash=(data:string|Uint8Array)=>crypto.createHash('sha256').update(data).digest('hex')
function speechFixture(){
 const f=fixture();f.root=fs.realpathSync(f.root);const directory=path.join(f.root,'artifacts');fs.writeFileSync(path.join(directory,'voice.wav'),'original voice');let draft=sceneDraft(f.store,'句锚点');Object.assign(draft.scenes[0],{narration:'第一句。第二句！',audioArtifactId:'voice.wav',audioText:'第一句。第二句！',audioDurationSeconds:3,bullets:['要点']});draft=f.store.update(draft.id,draft.revision,draft,true)
 const kernel:StudioKernel={projectStore:{active:()=>({id:'speech-project',name:'P',directory:f.root})},execute:async()=>({}),recordingController:{narrate:async()=>{throw new Error('No synthesis in contract fixture.')},compose:async()=>({}),processArtifact:async()=>({durationSeconds:3,tracks:[{type:'audio',canDecode:true}]})}}
 const service=new VideoStudioService(kernel),owner={projectId:'speech-project',sessionId:'fixture-session'}
 const request=(operation:string,current=draft)=>({operation,draftId:current.id,expectedRevision:current.revision,sceneId:current.scenes[0].id})
 const anchors=[{id:'first',scriptStart:0,scriptEnd:4,startSeconds:.1,endSeconds:1},{id:'second',scriptStart:4,scriptEnd:8,startSeconds:1.3,endSeconds:2.8}]
 return {...f,directory,kernel,service,owner,draft,request,anchors}
}
function speechFixtureEvidence(directory:string,script:string){
 const token=crypto.randomUUID(),rawArtifactId='speech-'+token+'-raw.json',logArtifactId='speech-'+token+'-log.json',normalizedArtifactId='media-'+crypto.randomUUID()+'-speech.wav'
 for(const id of [rawArtifactId,logArtifactId,normalizedArtifactId])fs.writeFileSync(path.join(directory,id),'new '+id)
 return assertSpeechEvidence({kind:'speech-evidence',provider:'whisper.cpp',engineVersion:'1.9.1',model:'base',modelRevision:LOCAL_ASR_MODEL_REVISION,modelSha256:LOCAL_ASR_MODELS.base.sha256,engineSha256:'a'.repeat(64),sourceArtifactId:'voice.wav',sourceSha256:speechHash(fs.readFileSync(path.join(directory,'voice.wav'))),normalizedArtifactId,normalizedSha256:speechHash(fs.readFileSync(path.join(directory,normalizedArtifactId))),rawArtifactId,rawSha256:speechHash(fs.readFileSync(path.join(directory,rawArtifactId))),logArtifactId,logSha256:speechHash(fs.readFileSync(path.join(directory,logArtifactId))),sampleRate:16000,channels:1,sampleType:'pcm-s16le',downmix:'channel-mean',timeDomain:'audio-file-seconds',durationSeconds:3,elapsedSeconds:1,createdAt:new Date().toISOString(),normalization:{kind:'speech-pcm',sampleRate:16000,channels:1,sampleType:'pcm-s16le',frames:48000,durationSeconds:3,inputSampleRate:48000,inputChannels:1,decodedStartSeconds:0,decodedEndSeconds:3,clippedSamples:0,downmix:'channel-mean'},segments:[{id:'segment-1',text:script,startSeconds:0,endSeconds:3,tokenMeanProbability:.9,usable:true,warnings:[]}],automaticTimingApproved:false,wordTimingAvailable:false})
}
test('Sentence spans reject overlap/forgery/Unicode splits and ASR paragraphs are not divided into invented sentence times',()=>{
 assert.equal(scriptSentences('数字 3.5，先说一句。然后说第二句！').length,2)
 assert.throws(()=>assertSentenceAnchors([{id:'a',scriptStart:0,scriptEnd:1,startSeconds:0,endSeconds:1}],'😀'),/Unicode/)
 assert.throws(()=>assertSentenceAnchors([{id:'a',scriptStart:0,scriptEnd:4,startSeconds:0,endSeconds:2},{id:'b',scriptStart:4,scriptEnd:8,startSeconds:1,endSeconds:3}],'第一句。第二句！'),/anchor start/)
 assert.throws(()=>assertStudioRequest({operation:'correct-speech',draftId:'draft',expectedRevision:1,sceneId:'scene',anchors:[],origin:'user-edited'}),/Unsupported/)
 const f=speechFixture();try{const evidence=speechFixtureEvidence(f.directory,f.draft.scenes[0].narration);assert.deepEqual(sentenceSuggestions(f.draft.scenes[0].narration,evidence),[]);evidence.segments[0].text='第一句。';assert.equal(sentenceSuggestions(f.draft.scenes[0].narration,evidence).length,1);evidence.segments[0].usable=false;assert.deepEqual(sentenceSuggestions(f.draft.scenes[0].narration,evidence),[])}finally{f.close()}
})
test('Host sentence correction binds actual hashes and trusted actor; ordinary draft updates cannot replace it',async()=>{
 const f=speechFixture();try{
  const result=await f.service.execute({...f.request('correct-speech'),anchors:f.anchors},undefined,f.owner,'user') as {draft:VideoDraft};let draft=result.draft,scene=draft.scenes[0];assert.equal(scene.speechAnchors!.origin,'user-edited');assert.equal(scene.speechAnchors!.scriptSha256,speechHash(scene.narration));assert.equal(scene.speechAnchors!.audioSha256,speechHash('original voice'));assert.equal(scene.speechAnchors!.durationSeconds,3)
  const saved=structuredClone(scene.speechAnchors);scene.speechAnchors!.origin='agent-edited';scene.speechAnchors!.anchors[0].startSeconds=.2;draft=f.store.update(draft.id,draft.revision,draft);assert.deepEqual(draft.scenes[0].speechAnchors,saved)
  draft.scenes[0].speechAnchors=undefined;draft=f.store.update(draft.id,draft.revision,draft);assert.deepEqual(draft.scenes[0].speechAnchors,saved)
  const agent=await f.service.execute({...f.request('correct-speech',draft),anchors:f.anchors},undefined,f.owner) as {draft:VideoDraft};assert.equal(agent.draft.scenes[0].speechAnchors!.origin,'agent-edited')
  await assert.rejects(f.service.execute({...f.request('correct-speech',agent.draft),anchors:f.anchors},undefined,{...f.owner,sessionId:'foreign'}),/SESSION_MISMATCH/)
  await assert.rejects(f.service.execute({...f.request('correct-speech',agent.draft),anchors:[{...f.anchors[0],endSeconds:3.01}]},undefined,f.owner),/anchor end/)
 }finally{f.close()}
})
test('Speech evidence success/rerun preserves correction; cancelled or conflicting recognition rolls back only new outputs',async()=>{
 const f=speechFixture();try{
  let draft=(await f.service.execute({...f.request('correct-speech'),anchors:f.anchors},undefined,f.owner,'user') as {draft:VideoDraft}).draft
  let callback:()=>void=()=>{},cancel:AbortController|undefined
  f.kernel.recordingController.processArtifact=async raw=>{const r=raw as {action:string};if(r.action!=='media.speech.align')return {durationSeconds:3,tracks:[{type:'audio',canDecode:true}]};const evidence=speechFixtureEvidence(f.directory,draft.scenes[0].narration);callback();return evidence}
  for(let i=0;i<2;i++){const result=await f.service.execute({...f.request('align-speech',draft),speechModel:'base'},undefined,f.owner) as {draft:VideoDraft;manualEditsPreserved:boolean};assert.equal(result.manualEditsPreserved,true);assert.deepEqual(result.draft.scenes[0].speechAnchors,draft.scenes[0].speechAnchors);draft=result.draft}
  const read=await f.service.execute(f.request('read-speech',draft),undefined,f.owner) as {suggestions:unknown[];stale:boolean};assert.equal(read.stale,false);assert.deepEqual(read.suggestions,[])
  const before=fs.readdirSync(f.directory).sort(),manual=structuredClone(draft.scenes[0].speechAnchors)
  callback=()=>{const d=f.store.read(draft.id);d.title='concurrent';f.store.update(d.id,d.revision,d)}
  await assert.rejects(f.service.execute(f.request('align-speech',draft),undefined,f.owner),/STUDIO_CONFLICT/);assert.deepEqual(fs.readdirSync(f.directory).sort(),before);assert.deepEqual(f.store.read(draft.id).scenes[0].speechAnchors,manual)
  draft=f.store.read(draft.id);cancel=new AbortController();callback=()=>cancel!.abort(new Error('cancel recognition'))
  await assert.rejects(f.service.execute(f.request('align-speech',draft),cancel.signal,f.owner),/cancel recognition/);assert.deepEqual(fs.readdirSync(f.directory).sort(),before);assert.deepEqual(f.store.read(draft.id).scenes[0].speechAnchors,manual)
  callback=()=>{};fs.writeFileSync(path.join(f.directory,'voice.wav'),'replaced voice');assert.equal((await f.service.execute(f.request('read-speech',draft),undefined,f.owner) as {stale:boolean}).stale,true)
 }finally{f.close()}
})
test('Anchored captions share voice offset and cumulative film time; independent edits remain and file/script changes fail closed',async()=>{
 const f=speechFixture();try{
  let draft=(await f.service.execute({...f.request('correct-speech'),anchors:f.anchors},undefined,f.owner,'user') as {draft:VideoDraft}).draft
  const other={...newStudioScene('other'),bullets:['前导'],durationSeconds:2,captions:[{startSeconds:0,endSeconds:1,text:'前导字幕'}]};draft.scenes.unshift(other);draft.scenes[1].speechCaptions=true;draft=f.store.update(draft.id,draft.revision,draft)
  assert.deepEqual(speechCaptionCues(draft.scenes[1]).map(c=>[c.startSeconds,c.endSeconds]),[[.6,1.5],[1.8,3.3]])
  assert.deepEqual(draftComposition(draft).scenes[1].captions,speechCaptionCues(draft.scenes[1]));const timeline=studioTimeline(draft).clips.filter(c=>c.kind==='caption'&&c.sceneIndex===1);assert.equal(timeline[0].start,2.6);assert.equal(timeline[0].estimated,false)
  for(const captionFormat of ['srt','vtt']){const output=await f.service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat},undefined,f.owner) as {artifactId:string;provenanceArtifactId:string;sentenceTiming:string};const text=fs.readFileSync(path.join(f.directory,output.artifactId),'utf8');assert.match(text,captionFormat==='srt'?/00:00:02,600 --> 00:00:03,500/:/00:00:02\.600 --> 00:00:03\.500/);const proof=JSON.parse(fs.readFileSync(path.join(f.directory,output.provenanceArtifactId),'utf8'));assert.equal(proof.scenes[1].origin,'user-edited');assert.equal(proof.scenes[1].filmStartSeconds,2);assert.equal(proof.wordTimingAvailable,false)}
  draft.scenes[1].narration='改写第一句。第二句！';draft=f.store.update(draft.id,draft.revision,draft);assert.equal(draftReadiness(draft).issues.some(i=>i.code==='speech-anchors'),true);await assert.rejects(f.service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat:'srt'},undefined,f.owner),/SPEECH_STALE/)
  draft.scenes[1].captions=[{startSeconds:1,endSeconds:2,text:'独立字幕'}];draft=f.store.update(draft.id,draft.revision,draft);const independent=await f.service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat:'srt'},undefined,f.owner) as {artifactId:string};assert.match(fs.readFileSync(path.join(f.directory,independent.artifactId),'utf8'),/独立字幕/)
  draft.scenes[1].narration='第一句。第二句！';delete draft.scenes[1].captions;draft=f.store.update(draft.id,draft.revision,draft);fs.writeFileSync(path.join(f.directory,'voice.wav'),'mutated');const before=fs.readdirSync(f.directory).sort();await assert.rejects(f.service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat:'vtt'},undefined,f.owner),/旁白文件已变化/);assert.deepEqual(fs.readdirSync(f.directory).sort(),before)
 }finally{f.close()}
})

test('Anchored render rechecks the audio after encode and rolls back only newly created MP4/report on late replacement',async()=>{
 const f=speechFixture();try{
  let draft=(await f.service.execute({...f.request('correct-speech'),anchors:f.anchors},undefined,f.owner) as {draft:VideoDraft}).draft;draft.scenes[0].speechCaptions=true;draft=f.store.update(draft.id,draft.revision,draft)
  fs.writeFileSync(path.join(f.directory,'old.mp4'),'old movie')
  f.kernel.recordingController.processArtifact=async raw=>{const r=raw as {action:string;width:number;height:number;fps:number};if(r.action==='media.encode.check')return {kind:'encoding',width:r.width,height:r.height,fps:r.fps,videoCodec:'avc',audioCodec:'aac',videoSupported:true,audioSupported:true};return {durationSeconds:3,tracks:[{type:'audio',canDecode:true}]}}
  f.kernel.recordingController.compose=async()=>{fs.writeFileSync(path.join(f.directory,'new.mp4'),'new movie');fs.writeFileSync(path.join(f.directory,'new-report.json'),'new report');fs.writeFileSync(path.join(f.directory,'voice.wav'),'replaced during encode');return {artifactId:'new.mp4',verificationArtifactId:'new-report.json',durationSeconds:8}}
  const before=fs.readdirSync(f.directory).sort();await assert.rejects(f.service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision},undefined,f.owner),/旁白文件已变化/);assert.deepEqual(fs.readdirSync(f.directory).sort(),before);assert.equal(fs.readFileSync(path.join(f.directory,'old.mp4'),'utf8'),'old movie');assert.deepEqual(f.store.read(draft.id).scenes[0].speechAnchors,draft.scenes[0].speechAnchors);assert.equal(f.store.read(draft.id).exports.length,0)
 }finally{f.close()}
})

test('Speech links preserve target identity, map trimmed/rated segmented focus, and reject orphan, crop, overlap and boundary changes',async()=>{
 const f=speechFixture();try{
  const draft=(await f.service.execute({...f.request('correct-speech'),anchors:f.anchors},undefined,f.owner,'user') as {draft:VideoDraft}).draft,scene=draft.scenes[0]
  scene.videoArtifactId='recording.mp4';scene.sourceStartSeconds=3;scene.playbackRate=2;scene.sourceDurationSeconds=30
  scene.focusIntervals=[{startSeconds:0,endSeconds:1,x:.5,y:.5,zoom:1.5,emphasize:false}]
  scene.speechLinks={bullets:[],focus:[{anchorId:f.anchors[0].id,visualIndex:0,artifactId:'recording.mp4',x:.6,y:.4,zoom:2,emphasize:true}]}
  const before=structuredClone(scene),resolved=speechScene(scene);assert.deepEqual(scene,before,'Projection never mutates persisted references or independent focus')
  assert.deepEqual(resolved.focusIntervals?.map(v=>[v.startSeconds,v.endSeconds]),[[0,1],[4.2,6]])
  assert.deepEqual(draftComposition(draft).scenes[0].focusIntervals,resolved.focusIntervals);assert.equal(sceneCoverage(scene,draft.tts).audioStale,false)
  const timeline=studioTimeline(draft).clips;assert.ok(Math.abs(timeline.find(c=>c.kind==='focus'&&c.origin==='用户编辑')!.start-.6)<1e-9);assert.equal(timeline.find(c=>c.kind==='voice')?.start,.5)
  scene.videoArtifactId='replacement.mp4';assert.throws(()=>speechScene(scene),/REFERENCE/);scene.videoArtifactId='recording.mp4'
  scene.crop={x:0,y:0,width:.5,height:.5};assert.throws(()=>speechScene(scene),/裁切之外/);delete scene.crop
  scene.focusIntervals=[{startSeconds:4,endSeconds:5,x:.5,y:.5,zoom:1.5,emphasize:false}];assert.throws(()=>speechScene(scene),/STUDIO_SPEECH_FOCUS/);delete scene.focusIntervals
  scene.speechLinks.focus[0].anchorId='removed';assert.throws(()=>speechScene(scene),/句锚点已删除/);scene.speechLinks.focus[0].anchorId=f.anchors[1].id
  delete scene.videoArtifactId;scene.visualSegments=[{durationSeconds:2,imageArtifactId:'first.png',sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.2},{durationSeconds:6,videoArtifactId:'recording.mp4',sourceStartSeconds:4,playbackRate:.5,sourceDurationSeconds:30,zoom:1,transition:'cut',transitionSeconds:.2}]
  scene.speechLinks.focus[0].visualIndex=1;assert.throws(()=>speechScene(scene),/跨越画面边界/)
  scene.speechAnchors!.anchors[1].startSeconds=2;scene.speechAnchors!.anchors[1].endSeconds=3
  assert.deepEqual(speechScene(scene).visualSegments![1].focusIntervals?.map(v=>[v.startSeconds,v.endSeconds]),[[4.25,4.75]])
  scene.speechLinks.focus[0].visualIndex=7;assert.throws(()=>speechScene(scene),/片段已移除/)
  assert.throws(()=>assertStudioSpeechLinks({bullets:[],focus:[{...before.speechLinks!.focus[0],path:'/private/file'}]}),/Unsupported/)
  assert.throws(()=>assertStudioSpeechLinks({bullets:[],focus:[before.speechLinks!.focus[0],before.speechLinks!.focus[0]]}),/duplicate/)
 }finally{f.close()}
})
test('Title-card reveal links preserve static rows and independent captions; changed bullets and forged raw times cannot be adopted',async()=>{
 const f=speechFixture();try{
  const draft=(await f.service.execute({...f.request('correct-speech'),anchors:f.anchors},undefined,f.owner,'user') as {draft:VideoDraft}).draft,scene=draft.scenes[0]
  scene.bullets=['第一步','始终可见','第二步'];scene.captions=[{startSeconds:0,endSeconds:1,text:'独立字幕'}];scene.speechCaptions=true
  scene.speechLinks={focus:[],bullets:[{bulletIndex:0,text:'第一步',anchorId:f.anchors[0].id},{bulletIndex:2,text:'第二步',anchorId:f.anchors[1].id}]}
  const projected=speechScene(scene);assert.deepEqual(projected.bulletRevealSeconds,[.6,0,1.8]);assert.deepEqual(projected.captions,scene.captions);assert.equal(usesStudioSpeech(scene),true)
  assert.deepEqual(draftComposition(draft).scenes[0].bulletRevealSeconds,[.6,0,1.8]);assert.equal(studioTimeline(draft).clips.filter(c=>c.kind==='reveal').length,2)
  scene.bullets[0]='改写第一步';assert.throws(()=>speechScene(scene),/板书条目已修改/);assert.equal(draftReadiness(draft).issues.some(i=>i.code==='speech-anchors'),true);scene.bullets[0]='第一步'
  scene.imageArtifactId='board.png';assert.throws(()=>speechScene(scene),/标题卡/);delete scene.imageArtifactId
  assert.throws(()=>assertVideoDraft({...draft,scenes:[{...scene,bulletRevealSeconds:[0,0,0]}]}),/Unsupported Studio/)
  assert.throws(()=>assertStudioSpeechLinks({bullets:[scene.speechLinks.bullets[0],scene.speechLinks.bullets[0]],focus:[]}),/duplicate/)
 }finally{f.close()}
})
test('Focus-only anchor consumption verifies actual audio hashes and exports truthful receipts; editable links support CAS undo without rewriting host anchors',async()=>{
 const f=speechFixture();try{
  let draft=(await f.service.execute({...f.request('correct-speech'),anchors:f.anchors},undefined,f.owner,'user') as {draft:VideoDraft}).draft
  draft.scenes[0].imageArtifactId='board.png';draft.scenes[0].captions=[{startSeconds:0,endSeconds:1,text:'独立'}]
  const anchor=structuredClone(draft.scenes[0].speechAnchors),snapshot=structuredClone(draft)
  draft.scenes[0].speechLinks={bullets:[],focus:[{anchorId:f.anchors[0].id,visualIndex:0,artifactId:'board.png',x:.5,y:.5,zoom:2,emphasize:true}]};draft=f.store.update(draft.id,draft.revision,draft)
  assert.deepEqual(draft.scenes[0].speechAnchors,anchor);assert.throws(()=>f.store.update(draft.id,draft.revision-1,snapshot),/STUDIO_CONFLICT/)
  const receipt=await f.service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat:'vtt'},undefined,f.owner) as {artifactId:string;provenanceArtifactId:string}
  const proof=JSON.parse(fs.readFileSync(path.join(f.directory,receipt.provenanceArtifactId),'utf8'));assert.equal(proof.scenes[0].origin,'independently-edited');assert.equal(proof.scenes[0].binding.origin,'user-edited');assert.equal(proof.scenes[0].focus[0][0].startSeconds,.6);assert.equal(proof.scenes[0].links.focus[0].artifactId,'board.png')
  const links=structuredClone(draft.scenes[0].speechLinks);snapshot.revision=draft.revision;draft=f.store.update(draft.id,draft.revision,snapshot);assert.equal(draft.scenes[0].speechLinks,undefined);assert.deepEqual(draft.scenes[0].speechAnchors,anchor)
  draft.scenes[0].speechLinks=links;draft=f.store.update(draft.id,draft.revision,draft);fs.writeFileSync(path.join(f.directory,'voice.wav'),'changed audio');const before=fs.readdirSync(f.directory).sort()
  await assert.rejects(f.service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat:'vtt'},undefined,f.owner),/旁白文件已变化/);assert.deepEqual(fs.readdirSync(f.directory).sort(),before)
 }finally{f.close()}
})

test('Studio preserves optional scene numbering and bilingual line breaks through composition and revisions',()=>{
  const value=fixture();try{
    let draft=sceneDraft(value.store,'双语与总结');draft.scenes[0].showSceneNumber=false;draft.scenes[0].keepSourceAudio=true;draft.scenes[0].bullets=['改名是叙事，能力仍需验证。'];draft.scenes[0].captions=[{startSeconds:0,endSeconds:2,text:'AI benefits.\nAI 的积极作用。'}]
    draft=value.store.update(draft.id,draft.revision,draft)
    const composed=draftComposition(draft)
    assert.equal(composed.scenes[0].showSceneNumber,false);assert.equal(composed.scenes[0].keepSourceAudio,true);assert.equal(composed.scenes[0].captions![0].text,'AI benefits.\nAI 的积极作用。');assert.equal(newStudioScene('legacy').showSceneNumber,undefined)
    assert.throws(()=>assertComposition({...composed,scenes:[{...composed.scenes[0],showSceneNumber:'false'}]}),/showSceneNumber must be boolean/)
    assert.throws(()=>value.store.update(draft.id,draft.revision-1,draft),/STUDIO_CONFLICT/)
  }finally{value.close()}
})


test('Unknown footage is pending measurement rather than a false source-range or footage-gap error',()=>{
 const value=fixture();try{const draft=sceneDraft(value.store,'Pending footage');Object.assign(draft.scenes[0],{videoArtifactId:'clip.webm',sourceStartSeconds:5});delete draft.scenes[0].sourceDurationSeconds
  const pending=draftReadiness(draft);assert.equal(sceneCoverage(draft.scenes[0]).measured,false);assert.ok(pending.issues.some(issue=>issue.code==='duration-unmeasured'));assert.ok(!pending.issues.some(issue=>['source-range','footage-gap'].includes(issue.code)))
  draft.scenes[0].sourceDurationSeconds=6;const measured=draftReadiness(draft);assert.equal(measured.scenes[0].measured,true);assert.ok(measured.issues.some(issue=>issue.code==='footage-gap'));assert.equal(measured.scenes[0].gapSeconds,7)
  draft.scenes[0].sourceStartSeconds=6;assert.ok(draftReadiness(draft).issues.some(issue=>issue.code==='source-range'))
 }finally{value.close()}
})

test('Source caption clocks clip trim edges, apply rate and preceding segment offset with zero narration lead',()=>{
 const scene=newStudioScene('source');scene.durationSeconds=7;scene.visualSegments=[{...scene,imageArtifactId:'lead.png',durationSeconds:2,transition:'cut',transitionSeconds:0},{...scene,videoArtifactId:'clip.webm',durationSeconds:5,sourceStartSeconds:10,playbackRate:2,transition:'cut',transitionSeconds:0}]
 const cues=assertSourceCues([{startSeconds:8,endSeconds:12,text:'clip start'},{startSeconds:14,endSeconds:18,text:'middle'},{startSeconds:19,endSeconds:25,text:'clip end'}],30)
 assert.deepEqual(projectSourceCues(scene,1,cues),[{startSeconds:2,endSeconds:3,text:'clip start'},{startSeconds:4,endSeconds:6,text:'middle'},{startSeconds:6.5,endSeconds:7,text:'clip end'}])
 scene.sourceCaptionBinding={sourceArtifactId:'clip.webm',sourceSha256:'a'.repeat(64),segmentIndex:1,clock:sourceCaptionClock(scene,1),origin:'user-edited'};assert.equal(sourceCaptionsStale(scene),false)
 scene.visualSegments[1].playbackRate=1;assert.equal(sourceCaptionsStale(scene),true)
 for(const raw of [[{startSeconds:2,endSeconds:1,text:'bad'}],[{startSeconds:0,endSeconds:2,text:'a'},{startSeconds:1,endSeconds:3,text:'b'}],[{startSeconds:0,endSeconds:1,text:'a',translationText:'not source'}]])assert.throws(()=>assertSourceCues(raw))
})
function sourceFixture(){const f=speechFixture();f.draft.scenes[0]={...newStudioScene('source'),videoArtifactId:'voice.wav',durationSeconds:2,sourceStartSeconds:.5,keepSourceAudio:true,captions:[{startSeconds:0,endSeconds:1,text:'Independent'}]};f.draft=f.store.update(f.draft.id,f.draft.revision,f.draft);f.request=(operation:string,current=f.draft)=>({operation,draftId:current.id,expectedRevision:current.revision,sceneId:current.scenes[0].id});return f}
test('Original-source ASR keeps independent captions; reviewed apply maps actual clock and preserves source evidence',async()=>{
 const f=sourceFixture();try{
  f.kernel.recordingController.processArtifact=async raw=>{const request=raw as {language:string;model:string};assert.equal(request.language,'en');assert.equal(request.model,'base');return speechFixtureEvidence(f.directory,'Original English')}
  const result=await f.service.execute({...f.request('recognize-source'),speechLanguage:'en',speechModel:'base'},undefined,f.owner) as {draft:VideoDraft};let draft=result.draft
  assert.equal(draft.scenes[0].captions![0].text,'Independent');assert.ok(draft.scenes[0].sourceSpeech);assert.equal(draft.scenes[0].speechAnchors,undefined)
  const read=await f.service.execute(f.request('read-source-speech',draft),undefined,f.owner) as {stale:boolean};assert.equal(read.stale,false)
  const applied=await f.service.execute({...f.request('apply-source-captions',draft),sourceCues:[{startSeconds:0,endSeconds:1,text:'English'},{startSeconds:1,endSeconds:3,text:'More'}]},undefined,f.owner,'user') as {draft:VideoDraft};draft=applied.draft
  assert.deepEqual(draft.scenes[0].captions,[{startSeconds:0,endSeconds:.5,text:'English'},{startSeconds:.5,endSeconds:2,text:'More'}]);assert.equal(draft.scenes[0].sourceCaptionBinding!.origin,'user-edited');assert.equal(draft.scenes[0].captionDisplay,'bilingual')
  draft.scenes[0].sourceStartSeconds=1;draft=f.store.update(draft.id,draft.revision,draft);assert.ok(draftReadiness(draft).issues.some(issue=>issue.code==='source-captions-stale'))
  await assert.rejects(f.service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat:'srt'},undefined,f.owner),/STUDIO_SOURCE_SPEECH_STALE/)
  const remapped=await f.service.execute({...f.request('apply-source-captions',draft),sourceCues:[{startSeconds:1,endSeconds:3,text:'More'}]},undefined,f.owner) as {draft:VideoDraft};draft=remapped.draft;assert.equal(draft.scenes[0].captions![0].startSeconds,0)
  fs.writeFileSync(path.join(f.directory,'voice.wav'),'changed source');await assert.rejects(f.service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat:'srt'},undefined,f.owner),/原视频|source/i)
  const detached=await f.service.execute(f.request('detach-source-captions',draft),undefined,f.owner) as {draft:VideoDraft};assert.equal(detached.draft.scenes[0].sourceCaptionBinding,undefined);assert.equal(detached.draft.scenes[0].captions![0].text,'More')
 }finally{f.close()}
})
test('Original-source recognition rolls back only new artifacts on cancellation, CAS conflict and source hash change',async()=>{
 for(const scenario of ['cancel','conflict','hash'] as const){const f=sourceFixture();try{const before=fs.readdirSync(f.directory).sort(),controller=new AbortController();f.kernel.recordingController.processArtifact=async()=>{const evidence=speechFixtureEvidence(f.directory,'Original');if(scenario==='cancel')controller.abort(new Error('cancel source'));if(scenario==='conflict'){const draft=f.store.read(f.draft.id);draft.scenes[0].title='GUI wins';f.store.update(draft.id,draft.revision,draft)}if(scenario==='hash')fs.writeFileSync(path.join(f.directory,'voice.wav'),'changed');return evidence}
  await assert.rejects(f.service.execute(f.request('recognize-source'),controller.signal,f.owner));assert.deepEqual(fs.readdirSync(f.directory).sort(),before);assert.equal(f.store.read(f.draft.id).scenes[0].sourceSpeech,undefined);assert.equal(f.store.read(f.draft.id).scenes[0].captions![0].text,'Independent')
 }finally{f.close()}}
})
test('Bilingual translation preserves original times and user corrections, and fails atomically on stale original or CAS',async()=>{
 const f=sourceFixture();try{let draft=f.draft;draft.scenes[0].captions=[{startSeconds:0,endSeconds:1,text:'Hello',translationText:'人工译文'},{startSeconds:1,endSeconds:2,text:'World'}];draft=f.store.update(draft.id,draft.revision,draft,false,true)
  const original=draft.scenes[0].captions!.map(({translationText,translationOrigin,...cue})=>cue)
  const translated=await f.service.execute({...f.request('set-caption-translations',draft),translations:[{cueIndex:0,originalText:'Hello',translationText:'模型重译'},{cueIndex:1,originalText:'World',translationText:'世界'}]},undefined,f.owner) as {draft:VideoDraft;skippedCueIndices:number[]};draft=translated.draft
  assert.deepEqual(translated.skippedCueIndices,[0]);assert.equal(draft.scenes[0].captions![0].translationText,'人工译文');assert.equal(draft.scenes[0].captions![1].translationOrigin,'agent-edited');assert.deepEqual(draft.scenes[0].captions!.map(({translationText,translationOrigin,...cue})=>cue),original)
  const before=fs.readFileSync(path.join(f.store.directory,draft.id+'.json'),'utf8')
  await assert.rejects(f.service.execute({...f.request('set-caption-translations',draft),translations:[{cueIndex:1,originalText:'Changed',translationText:'bad'}]},undefined,f.owner),/STUDIO_CONFLICT/)
  await assert.rejects(f.service.execute({...f.request('set-caption-translations',draft),expectedRevision:draft.revision-1,translations:[{cueIndex:1,originalText:'World',translationText:'bad'}]},undefined,f.owner),/STUDIO_CONFLICT/);assert.equal(fs.readFileSync(path.join(f.store.directory,draft.id+'.json'),'utf8'),before)
  const hostile=structuredClone(draft);hostile.scenes[0].captions![0].translationText='agent overwrite';assert.throws(()=>f.store.update(hostile.id,hostile.revision,hostile),/STUDIO_TRANSLATION_EDITED/)
  assert.throws(()=>assertStudioRequest({...f.request('set-caption-translations',draft),translations:[{cueIndex:1,originalText:'World',translationText:'a'},{cueIndex:1,originalText:'World',translationText:'b'}]}))
 }finally{f.close()}
})
