import {videoDraftFromDocument} from '../src/video-document.js'
import {assertStudioReviewProposal,studioReviewValueLabel} from '../src/studio-review.js'
import {videoFeature} from '../index.js'
import {assertVisualLayers,assertAudioLayers} from '../../media-native/src/composition-layers.js'
import {visualAtTime,visualZoom,sceneVisuals,visualPlaybackGroup,fitVisualSegments} from '../../media-native/src/visual-segments.js'
import {focusFraming,focusSourceTime,visibleFocusIntervals} from '../../media-native/src/focus-contract.js'
import {visualLayerBox,layerFadeGain} from '../../media-native/src/composition-layers.js'
import {moveStudioMain,trimStudioMain,setStudioMainVoice,setStudioMainMuted,setStudioMainEffects,splitStudioMainCaption,splitStudioMain,studioMainSpan} from '../src/studio-main-edits.js'
import {narrationWindow,narrationWindows,narrationSceneTime,narrationSceneRanges,estimatedCaptionCues} from '../../media-native/src/composition-contract.js'
import {addStudioLayer,editStudioLayer,insertStudioLayerKeyframe,studioLayer,studioLayerOffset,trimStudioLayer,splitStudioLayer,removeStudioLayer} from '../src/studio-layer-edits.js'
import {assertSourceCues,projectSourceCues,sourceCaptionClock,sourceCaptionsStale} from '../src/studio-source-speech-contract.js'
import crypto from 'node:crypto'
import {assertSentenceAnchors,sentenceSuggestions,scriptSentences,speechCaptionCues,speechScene,assertStudioSpeechLinks,usesStudioSpeech} from '../src/studio-speech-contract.js'
import {assertSpeechEvidence} from '../../media-native/src/speech-contract.js'
import {LOCAL_ASR_MODELS,LOCAL_ASR_MODEL_REVISION} from '../../media-native/src/local-asr-assets.js'
import {studioTimeline,studioSceneIndex} from '../src/studio-timeline.js'
import {studioAssistantRequest,studioAssistantPrompt} from '../src/studio-assistant.js'
import {assertStudioMode,assertStudioSelection,studioPromptContext,assertStudioView,defaultStudioView} from '../src/studio-context.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {VideoStudioStore} from '../src/studio-store.js'
import {VideoStudioService} from '../src/studio-service.js'
import type {VideoDraft} from '../src/studio-contract.js'
import type {StudioKernel} from '../src/studio-service.js'
import {assertStudioRequest,assertVideoDraft,sameStudioDraftContent,narrationSceneDuration,applyNarrationPacing,draftComposition,draftReadiness,sceneCoverage,newStudioScene} from '../src/studio-contract.js'
import {assertComposition,compositionAssets} from '../../media-native/src/composition-contract.js'
function sceneDraft(store:VideoStudioStore,title:string){const draft=store.create(title);draft.scenes.push(newStudioScene('first-scene'));return draft}
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-studio-test-'));fs.mkdirSync(path.join(root,'artifacts'));return {root,store:new VideoStudioStore(root,'fixture-session'),close:()=>fs.rmSync(root,{recursive:true,force:true})}}
test('card image inspection exposes actual pinned identity; changed source before or after encode blocks and rolls back only new exports',async()=>{
 const f=fixture();try{
  const directory=path.join(f.root,'artifacts'),file=path.join(directory,'source.png'),data=Buffer.from('controlled native decode fixture');fs.writeFileSync(file,data);fs.writeFileSync(path.join(directory,'old.mp4'),'old export')
  const kernel:StudioKernel={projectStore:{active:()=>({id:'p',name:'P',directory:f.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),processArtifact:async raw=>{const r=raw as {action:string;width:number;height:number;fps:number};return r.action==='media.image.inspect'?{kind:'image',contentType:'image/png',width:1,height:1,pixels:1,bytes:data.length,canDecode:true}:{kind:'encoding',width:r.width,height:r.height,fps:r.fps,videoCodec:'avc',audioCodec:'aac',videoSupported:true,audioSupported:true}},compose:async()=>{fs.writeFileSync(path.join(directory,'new.mp4'),'new');fs.writeFileSync(path.join(directory,'new-report.json'),'report');fs.writeFileSync(file,'changed during encode');return {artifactId:'new.mp4',verificationArtifactId:'new-report.json',durationSeconds:8}}}}
  const service=new FixtureVideoStudioService(kernel),inspected=await service.execute({operation:'inspect',artifactId:'source.png',assetKind:'image'}) as {source:{artifactId:string;sha256:string}}
  assert.deepEqual(inspected.source,{artifactId:'source.png',sha256:crypto.createHash('sha256').update(data).digest('hex')})
  let d=sceneDraft(f.store,'Pinned source');d.scenes[0].imageArtifactId='source.png';d.scenes[0].cardSpec={version:2,templateId:'evidence/highlight',highlights:[{source:inspected.source,rects:[{x:.1,y:.1,width:.2,height:.2}],style:'invert',name:'重点',startSeconds:0,endSeconds:4}]};d=f.store.update(d.id,d.revision,d)
  const before=fs.readdirSync(directory).sort();await assert.rejects(service.execute({operation:'render',draftId:d.id,expectedRevision:d.revision}),/STALE/);assert.deepEqual(fs.readdirSync(directory).sort(),before);assert.equal(fs.readFileSync(path.join(directory,'old.mp4'),'utf8'),'old export');assert.equal(f.store.read(d.id).exports.length,0)
  const checked=await service.execute({operation:'check',draftId:d.id,expectedRevision:d.revision}) as ReturnType<typeof draftReadiness>;assert.equal(checked.ready,false);assert.ok(checked.issues.some(issue=>issue.code==='card-source-stale'));assert.equal(f.store.read(d.id).revision,d.revision)
 }finally{f.close()}
})
test('compact playback uses measured source time and preserves manual captions, cuts and explicit silence',()=>{
 const scene=newStudioScene('compact'),timing=applyNarrationPacing(scene,2,30,'compact')!
 assert.deepEqual(timing,{startSeconds:2/30,sourceStartSeconds:0,durationSeconds:2,playbackRate:1});assert.equal(scene.durationSeconds,64/30)
 scene.audioGeneration={kind:'imported',autoTiming:timing}
 const next=applyNarrationPacing(scene,3,30,'compact')!;assert.equal(next.durationSeconds,3);assert.equal(scene.durationSeconds,94/30,'A matching automatic window expands with regenerated audio')
 scene.audioGeneration={kind:'imported',autoTiming:next};scene.captions=[{startSeconds:0,endSeconds:5,text:'人工字幕'}]
 applyNarrationPacing(scene,1,30,'compact');assert.equal(scene.durationSeconds,5)
 const cut={...newStudioScene('manual'),voiceTiming:{startSeconds:.4,sourceStartSeconds:.6,durationSeconds:.8,playbackRate:1}},original=structuredClone(cut.voiceTiming)
 assert.equal(applyNarrationPacing(cut,2,30,'compact'),undefined);assert.deepEqual(cut.voiceTiming,original);assert.equal(cut.durationSeconds,8,'Manual card duration is not shortened during audio replacement')
 assert.throws(()=>applyNarrationPacing(cut,.5,30,'compact'),/源区间/);assert.deepEqual(cut.voiceTiming,original)
 const silent={...newStudioScene('silent'),voiceSegments:[]};applyNarrationPacing(silent,2,30,'compact');assert.deepEqual(silent.voiceSegments,[]);assert.equal(silent.voiceTiming,undefined)
 assert.throws(()=>applyNarrationPacing(newStudioScene('short'),.05,30,'compact'),/0.1/)
})
test('host generation and audio import apply compact pacing, protect auto receipts and retain manual playback on replacement',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.root,'artifacts','import.wav'),'temporary fixture')
  let duration=2,serial=0,draft=sceneDraft(f.store,'Compact service');draft.narrationPacing='compact';draft.scenes[0].narration='原始脚本';draft=f.store.update(draft.id,draft.revision,draft)
  const service=new FixtureVideoStudioService({projectStore:{active:()=>({id:'p',name:'P',directory:f.root})},execute:async()=>({}),recordingController:{narrate:async()=>({artifactId:`speech-${++serial}.wav`,durationSeconds:duration}),compose:async()=>({}),processArtifact:async()=>({durationSeconds:duration,tracks:[{type:'audio',canDecode:true}]})}})
  const narrate=async()=>{const result=await service.execute({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:draft.scenes[0].id,provider:'local-matcha'}) as {draft:VideoDraft};draft=result.draft}
  await narrate();assert.equal(draft.scenes[0].voiceTiming?.startSeconds,2/draft.fps);assert.equal(draft.scenes[0].audioDurationSeconds,2)
  duration=3;await narrate();assert.equal(draft.scenes[0].voiceTiming?.durationSeconds,3,'Regeneration must not retain a shorter automatic window')
  const changed=structuredClone(draft);changed.scenes[0].audioGeneration!.autoTiming!.durationSeconds=1
  draft=f.store.update(draft.id,draft.revision,changed);assert.equal(draft.scenes[0].audioGeneration?.autoTiming?.durationSeconds,3,'Untrusted edits cannot relabel a cut as automatic')
  draft.scenes[0].voiceTiming={startSeconds:.3,sourceStartSeconds:.5,durationSeconds:1,playbackRate:1};draft=f.store.update(draft.id,draft.revision,draft)
  const manual=structuredClone(draft.scenes[0].voiceTiming);await narrate();assert.deepEqual(draft.scenes[0].voiceTiming,manual);assert.equal(draft.scenes[0].audioGeneration?.autoTiming,undefined)
  draft=await service.execute({operation:'attach',draftId:draft.id,expectedRevision:draft.revision,sceneId:draft.scenes[0].id,artifactId:'import.wav',assetKind:'audio'}) as VideoDraft;assert.deepEqual(draft.scenes[0].voiceTiming,manual)
  draft.scenes[0].voiceTiming=undefined;draft=f.store.update(draft.id,draft.revision,draft)
  draft=await service.execute({operation:'attach',draftId:draft.id,expectedRevision:draft.revision,sceneId:draft.scenes[0].id,artifactId:'import.wav',assetKind:'audio'}) as VideoDraft
  assert.equal(draft.scenes[0].audioGeneration?.kind,'imported');assert.equal(draft.scenes[0].voiceTiming?.durationSeconds,3);assert.equal(draft.scenes[0].audioGeneration?.autoTiming?.startSeconds,2/draft.fps)
 }finally{f.close()}
})
test('Studio drafts persist per Project and reject conflicting GUI or Agent revisions',()=>{
  const a=fixture(),b=fixture();try{const draft=sceneDraft(a.store,'项目视频');draft.scenes[0].narration='尚未制作的旁白。';const updated=a.store.update(draft.id,1,draft);assert.equal(updated.revision,2);assert.equal(new VideoStudioStore(a.root).read(draft.id).scenes[0].narration,draft.scenes[0].narration);assert.throws(()=>a.store.update(draft.id,1,draft),/STUDIO_CONFLICT/);assert.throws(()=>b.store.read(draft.id),/ENOENT/);assert.throws(()=>a.store.read('../outside'),/identity/);fs.symlinkSync(path.join(a.root,'video-studio',draft.id+'.json'),path.join(a.root,'video-studio','linked.json'));assert.throws(()=>a.store.read('linked'),/Invalid Studio/)}finally{a.close();b.close()}
})
test('Only owned journal revisions retain prepared content; captions, clocks, preparation and output edits require reconciliation',()=>{
  const f=fixture();try{
    const original=sceneDraft(f.store,'Journal updates'),next=structuredClone(original)
    next.revision++;next.updatedAt='Later';next.exports.push({artifactId:'completed.mp4',revision:original.revision,createdAt:'Later',durationSeconds:original.scenes[0].durationSeconds})
    assert.equal(sameStudioDraftContent(original,next),true)
    const reordered=Object.fromEntries(Object.entries(next).reverse()) as unknown as VideoDraft
    assert.equal(sameStudioDraftContent(original,reordered),true)
    for(const change of [(d:VideoDraft)=>{d.ownerSessionId='other-session'},(d:VideoDraft)=>{d.scenes[0].captions=[{startSeconds:0,endSeconds:1,text:'Independent'}]},(d:VideoDraft)=>{d.scenes[0].durationSeconds++},(d:VideoDraft)=>{d.preparation.notes='New brief'},(d:VideoDraft)=>{d.width=1080},(d:VideoDraft)=>{d.scenes[0].imageArtifactId='new-source.png'}]){const changed=structuredClone(next);change(changed);assert.equal(sameStudioDraftContent(original,changed),false)}
  }finally{f.close()}
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
  const deleted=path.join(value.root,'video-studio','deleted'),record=JSON.parse(fs.readFileSync(path.join(deleted,fs.readdirSync(deleted)[0]),'utf8'));assert.deepEqual(videoDraftFromDocument(record),draft)
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
  draft.scenes[0].sourceStartSeconds=1;draft=f.store.update(draft.id,draft.revision,draft);assert.equal(sourceCaptionsStale(draft.scenes[0]),false);assert.deepEqual(draft.scenes[0].captions,[{startSeconds:0,endSeconds:2,text:'More'}]);assert.equal(draft.scenes[0].sourceCaptionBinding!.sourceCues!.length,2)
  const mappedExport=await f.service.execute({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat:'srt'},undefined,f.owner) as {artifactId:string};assert.ok(fs.readFileSync(path.join(f.directory,mappedExport.artifactId),'utf8').includes('More'))
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

test('Studio simple-first view policy stays separate from video data and freezes confirmation context',()=>{
 const value=fixture();try{
  const draft=sceneDraft(value.store,'View policy'),before=JSON.stringify(draft)
  assert.deepEqual(defaultStudioView,{mode:'simple',confirmStages:false})
  assert.throws(()=>assertStudioView({mode:'expert',confirmStages:false}),/view preferences/)
  assert.throws(()=>assertStudioView({mode:'simple',confirmStages:false,tool:'shell'}),/view preferences/)
  assert.throws(()=>assertStudioView({mode:'simple',confirmStages:'yes'}),/view preferences/)
  const selection={draftId:draft.id,stage:4,revision:1,dirty:false}
  const simple=studioPromptContext('studio',selection,draft),guided=studioPromptContext('studio',selection,draft,assertStudioView({mode:'advanced',confirmStages:true}))
  assert.match(simple,/playable first draft/);assert.match(simple,/Reading\/research requests do not authorize rendering/);assert.match(simple,/Preserve unrelated scenes/)
  assert.match(guided,/stop for explicit user confirmation/);assert.match(guided,/optional experimental feedback/)
  assert.match(studioPromptContext('studio',undefined,undefined),/create a Session-owned draft/)
  assert.equal(studioPromptContext('browser',selection,draft),'');assert.equal(JSON.stringify(draft),before)
 }finally{value.close()}
})

test('Studio chat and renderer geometry reject foreign fields and invalid native layout bounds',async()=>{
 const {assertStudioChatView,assertStudioRegion}=await import('../src/studio-context.js')
 assert.deepEqual(assertStudioChatView({open:true,docked:true}),{open:true,docked:true})
 assert.deepEqual(assertStudioRegion({top:.1,bottom:.7,propertyWidth:.2,obscured:false}),{top:.1,bottom:.7,propertyWidth:.2,obscured:false})
 assert.deepEqual(assertStudioRegion({top:.1,bottom:.7,floatBottom:.6,propertyWidth:.2}),{top:.1,bottom:.7,floatBottom:.6,propertyWidth:.2})
 for(const floatBottom of [.1,.05,.8,NaN,Infinity,'0.6'])assert.throws(()=>assertStudioRegion({top:.1,bottom:.7,floatBottom,propertyWidth:.2}))
 for(const raw of [{open:1},{open:true,docked:'no'},{open:true,position:{x:2,y:0}},{open:false,tool:'browser'}])assert.throws(()=>assertStudioChatView(raw))
 for(const raw of [{top:.7,bottom:.1,propertyWidth:.2,obscured:false},{top:0,bottom:1,propertyWidth:1.1,obscured:false},{top:NaN,bottom:.7,propertyWidth:.2,obscured:false},{top:.1,bottom:.7,propertyWidth:.2,obscured:false,path:'injected'}])assert.throws(()=>assertStudioRegion(raw))
})

test('Studio pinned prompt scopes validate whole-film, scene and object data before admission',async()=>{
 const {assertStudioPrompt}=await import('../src/studio-context.js')
 const owner={projectId:'project',sessionId:'session',draftId:'draft'},scene={...owner,kind:'scene',sceneId:'scene-one'}
 assert.deepEqual(assertStudioPrompt({text:'修改这一镜',target:scene}),{text:'修改这一镜',target:scene})
 assert.equal(assertStudioPrompt({text:'字幕',target:{...scene,kind:'object',objectKind:'captions'}}).target.objectKind,'captions')
 assert.equal(assertStudioPrompt({text:'全片',target:{...owner,kind:'film'}}).target.kind,'film')
 for(const target of [{...owner,kind:'object',sceneId:'scene-one'},{...owner,kind:'scene'},{...scene,kind:'film'},{...scene,objectKind:'shell'},{...scene,tool:'browser'}])assert.throws(()=>assertStudioPrompt({text:'change',target}))
 for(const text of ['', ' ',String.fromCharCode(0),'x'.repeat(65537)])assert.throws(()=>assertStudioPrompt({text,target:scene}))
 assert.throws(()=>assertStudioPrompt({text:'change',target:scene,revision:4}))
})

test('Independent Assistant targets bind exact local/global containers and reject deleted or mixed identities',async()=>{
 const {assertStudioPrompt,studioSelectedObject}=await import('../src/studio-context.js')
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Scoped objects');draft.scenes[0].durationSeconds=4;draft.scenes.push({...newStudioScene('second'),durationSeconds:3})
  const title=addStudioLayer(draft,'first-scene','text');draft=title.draft
  const sound=addStudioLayer(draft,undefined,'audio','tone.wav',2);draft=sound.draft
  const owner={projectId:'project',sessionId:'session',draftId:draft.id}
  for(const ref of [title.selection,sound.selection]){
   const target={...owner,kind:'object' as const,...(ref.sceneId?{sceneId:ref.sceneId}:{}),layer:{id:ref.id,kind:ref.kind}}
   assert.deepEqual(assertStudioPrompt({text:'修改指定对象',target}).target,target)
   const selection=assertStudioSelection({draftId:draft.id,...(ref.sceneId?{sceneId:ref.sceneId}:{}),layer:target.layer,stage:4,revision:draft.revision,dirty:false},draft)
   const snapshot=JSON.stringify(draft),object=studioSelectedObject(draft,selection)
   assert.equal(object?.id,ref.id);assert.equal(object?.scope,ref.sceneId?'scene':'film');assert.equal(object?.category,ref.kind)
   assert.match(studioPromptContext('studio',selection,draft),new RegExp(ref.id));assert.equal(JSON.stringify(draft),snapshot,'Context is read-only')
   for(const target of [{...owner,kind:'film',layer:selection.layer},{...owner,kind:'scene',sceneId:'first-scene',layer:selection.layer},{...owner,kind:'object',layer:selection.layer,objectKind:'visual'},{...owner,kind:'object',layer:{...selection.layer,source:'injected'}},{...owner,kind:'object',layer:{id:'../outside',kind:'visual'}},{...owner,kind:'object',layer:{id:ref.id,kind:'shell'}},{...owner,kind:['object'],layer:selection.layer},{...owner,kind:'object',layer:{id:ref.id,kind:['audio']}},{...owner,kind:'object',sceneId:'first-scene',objectKind:['visual']}])assert.throws(()=>assertStudioPrompt({text:'change',target}))
   assert.throws(()=>assertStudioSelection({...selection,layer:{id:ref.id,kind:ref.kind==='visual'?'audio':'visual'}},draft),/已删除/)
   assert.throws(()=>assertStudioSelection({...selection,sceneId:ref.sceneId?'second':'first-scene'},draft),/已删除/)
   assert.throws(()=>assertStudioSelection({...selection,objectKind:'visual'},draft))
   assert.throws(()=>assertStudioSelection({...selection,layer:{id:ref.id,kind:['audio']}},draft),/Invalid Studio layer target/)
   const removed=removeStudioLayer(draft,ref);assert.throws(()=>assertStudioSelection(selection,removed),/已删除/);assert.throws(()=>studioPromptContext('studio',selection,removed),/已删除/)
  }
 }finally{f.close()}
})

test('Studio preserves advanced layer containers during omitted model updates and keeps out-of-range edits recoverable',()=>{
 const value=fixture();try{
 let draft=sceneDraft(value.store,'Layers');draft.scenes[0].imageArtifactId='frame.png';draft.scenes[0].durationSeconds=4
 draft.scenes[0].layers=[{id:'local',title:'Local',kind:'rectangle',startSeconds:0,durationSeconds:3,x:0,y:0,width:.2,height:.2,color:'#ff0000',opacity:1,zIndex:0,hidden:false,locked:false,fadeInSeconds:0,fadeOutSeconds:0}]
 draft.audioTracks=[{id:'global',title:'Global',artifactId:'music.wav',startSeconds:0,durationSeconds:4,sourceStartSeconds:0,playbackRate:1,volume:.2,muted:false,locked:false,fadeInSeconds:0,fadeOutSeconds:0,ducking:true}]
 draft=value.store.update(draft.id,draft.revision,draft)
 const raw=structuredClone(draft);delete raw.audioTracks;delete raw.scenes[0].layers;raw.scenes[0].title='Edited'
 draft=value.store.update(draft.id,draft.revision,raw);assert.equal(draft.audioTracks?.[0].id,'global');assert.equal(draft.scenes[0].layers?.[0].id,'local')
 draft.scenes[0].durationSeconds=2;draft=value.store.update(draft.id,draft.revision,draft)
 assert.equal(draft.scenes[0].layers?.[0].durationSeconds,3);assert.equal(draft.audioTracks?.[0].durationSeconds,4);assert.equal(draftReadiness(draft).issues.filter(issue=>issue.code==='layer-range').length,2);assert.throws(()=>draftComposition(draft),/超过/)
 draft.scenes[0].durationSeconds=4;draft.scenes[0].layers=[];draft.audioTracks=[];draft=value.store.update(draft.id,draft.revision,draft);assert.deepEqual(draft.scenes[0].layers,[]);assert.deepEqual(draft.audioTracks,[])
 }finally{value.close()}
})
test('Studio rejects layer references outside its Project before saving and checks actual overlay source durations',async()=>{
 const value=fixture();try{
 let draft=sceneDraft(value.store,'Ownership');draft.scenes[0].imageArtifactId='base.png';draft=value.store.update(draft.id,draft.revision,draft)
 fs.writeFileSync(path.join(value.root,'artifacts','base.png'),'image');fs.writeFileSync(path.join(value.root,'artifacts','short.mp4'),'video');fs.symlinkSync(path.join(value.root,'video-studio',draft.id+'.json'),path.join(value.root,'artifacts','foreign.mp4'))
 const layer={id:'overlay',title:'Overlay',kind:'video' as const,artifactId:'foreign.mp4',startSeconds:0,durationSeconds:3,sourceStartSeconds:0,playbackRate:1,x:0,y:0,width:.2,height:.2,color:'#ffffff',opacity:1,zIndex:0,hidden:false,locked:false,fadeInSeconds:0,fadeOutSeconds:0}
 const kernel:StudioKernel={videoStudioContext:()=>({view:{mode:'advanced'}}),projectStore:{active:()=>({id:'p',name:'P',directory:value.root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>{throw new Error('Must block before compose')},processArtifact:async raw=>{const request=raw as {action:string};return request.action==='media.image.inspect'?{kind:'image',contentType:'image/png',width:1,height:1,pixels:1,bytes:5,canDecode:true}:{durationSeconds:1,tracks:[{type:'video',canDecode:true}]}}}}
 const service=new FixtureVideoStudioService(kernel);draft.scenes[0].layers=[layer]
 await assert.rejects(service.execute({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}),/symbolic|inside|regular|project|file/i);assert.equal(value.store.read(draft.id).revision,draft.revision)
 layer.artifactId='short.mp4';draft=await service.execute({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}) as VideoDraft
 const report=await service.execute({operation:'check',draftId:draft.id,expectedRevision:draft.revision}) as ReturnType<typeof draftReadiness>
 assert.equal(report.ready,false);assert.ok(report.issues.some(issue=>issue.code==='source-range'&&issue.sceneId===draft.scenes[0].id));await assert.rejects(service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision}),/源区间/)
 }finally{value.close()}
})


test('Independent GUI edits preserve local/global identity, source clocks and lock admission',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Objects');draft.scenes[0].durationSeconds=4;draft.scenes.push({...newStudioScene('second'),durationSeconds:3})
  const added=addStudioLayer(draft,'first-scene','text');draft=added.draft;const ref=added.selection
  const music=addStudioLayer(draft,undefined,'audio','tone.wav',2);draft=music.draft
  draft=editStudioLayer(draft,music.selection,layer=>{layer.startSeconds=1})
  assert.equal(studioLayerOffset(draft,ref),0);draft.scenes.reverse();assert.equal(studioLayerOffset(draft,ref),3);assert.equal(studioLayer(draft,music.selection).startSeconds,1)
  const trimmed=trimStudioLayer(draft,music.selection,'start',1.5),audio=studioLayer(trimmed,music.selection)
  assert.equal(audio.durationSeconds,1.5);assert.equal('sourceStartSeconds' in audio&&audio.sourceStartSeconds,.5)
  const split=splitStudioLayer(trimmed,music.selection,2),tracks=split.audioTracks!
  assert.equal(tracks.length,2);assert.notEqual(tracks[0].id,tracks[1].id);assert.equal(tracks[1].sourceStartSeconds,1);assert.equal(tracks[1].startSeconds,2)
  const locked=editStudioLayer(draft,ref,l=>{l.locked=true});assert.throws(()=>editStudioLayer(locked,ref,l=>{l.startSeconds=1}),/锁定/)
  assert.throws(()=>removeStudioLayer(draft,{...ref,sceneId:'foreign'}),/删除/)
  assert.throws(()=>editStudioLayer(draft,ref,l=>{l.id='different'}),/身份/)
  assert.equal(removeStudioLayer(draft,ref).scenes.find(s=>s.id===ref.sceneId)!.layers!.length,0)
  assert.equal(draft.scenes.find(s=>s.id===ref.sceneId)!.layers!.length,1,'Original snapshot is untouched')
 }finally{f.close()}
})
test('Animated timeline cuts retain linear and restricted easing samples',()=>{
 const f=fixture();try{let draft=sceneDraft(f.store,'Animation');draft.scenes[0].durationSeconds=4
  const added=addStudioLayer(draft,'first-scene','rectangle');draft=added.draft
  draft=editStudioLayer(draft,added.selection,value=>{const layer=value as import('../../media-native/src/composition-layers.js').VisualLayer;layer.keyframes=[{timeSeconds:0,x:.1,y:.1,width:.3,height:.3,opacity:1,easing:'linear'},{timeSeconds:4,x:.5,y:.1,width:.3,height:.3,opacity:1,easing:'linear'}]})
  const split=splitStudioLayer(draft,added.selection,2),layers=split.scenes[0].layers!
  assert.equal(layers.length,2);assert.ok(Math.abs(layers[0].keyframes!.at(-1)!.x-.3)<1e-12);assert.ok(Math.abs(layers[1].keyframes![0].x-.3)<1e-12);assert.equal(layers[1].keyframes!.at(-1)!.timeSeconds,2)
  const eased=editStudioLayer(draft,added.selection,value=>{(value as import('../../media-native/src/composition-layers.js').VisualLayer).keyframes![1].easing='ease-in-out'})
  const parts=splitStudioLayer(eased,added.selection,1.3).scenes[0].layers!
  for(let t=0;t<4;t+=.017){const part=parts.find(p=>t>=p.startSeconds&&t<p.startSeconds+p.durationSeconds)!;const before=visualLayerBox(eased.scenes[0].layers![0],t),after=visualLayerBox(part,t-part.startSeconds);for(const key of ['x','y','width','height','opacity'] as const)assert.ok(Math.abs(before[key]-after[key])<1e-12,'Curve remains identical at '+t)}
  assert.equal(eased.scenes[0].layers![0].durationSeconds,4);assert.deepEqual(parts[0].keyframes!.at(-1)!.easingRange,[0,.325])
 }finally{f.close()}
})

test('Canvas transforms preserve animation shape, identity and timing while bounding every frame',async()=>{
 const {transformStudioLayer}=await import('../src/studio-layer-edits.js')
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Canvas');draft.scenes[0].durationSeconds=4
  const added=addStudioLayer(draft,'first-scene','rectangle');draft=added.draft
  draft=editStudioLayer(draft,added.selection,value=>{const layer=value as import('../../media-native/src/composition-layers.js').VisualLayer;layer.keyframes=[{timeSeconds:0,x:.1,y:.1,width:.3,height:.3,opacity:.5,easing:'linear'},{timeSeconds:4,x:.5,y:.2,width:.3,height:.3,opacity:1,easing:'ease-in-out'}]})
  const moved=transformStudioLayer(draft,added.selection,.4,.1),layer=moved.scenes[0].layers![0]
  assert.ok(Math.abs(layer.x-.3)<1e-12);assert.ok(Math.abs(layer.keyframes![1].x-.7)<1e-12)
  assert.equal(layer.id,added.selection.id);assert.equal(layer.startSeconds,0);assert.equal(layer.durationSeconds,4);assert.equal(layer.keyframes![1].easing,'ease-in-out');assert.equal(layer.keyframes![0].opacity,.5)
  const scaled=transformStudioLayer(moved,added.selection,0,0,2,2).scenes[0].layers![0]
  assert.ok(scaled.keyframes!.every(frame=>frame.x+frame.width<=1.000001&&frame.y+frame.height<=1.000001))
  assert.equal(draft.scenes[0].layers![0].x,.1);assert.equal(draft.scenes[0].layers![0].keyframes![1].x,.5)
  assert.throws(()=>transformStudioLayer(draft,added.selection,NaN,0),/Invalid/)
  const locked=editStudioLayer(draft,added.selection,value=>{value.locked=true});assert.throws(()=>transformStudioLayer(locked,added.selection,.1,0),/锁定/)
 }finally{f.close()}
})

test('Main voice timing preserves measured source and maps preview, captions and manual audio anchors',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Main timing');const scene=draft.scenes[0]
  Object.assign(scene,{durationSeconds:4,imageArtifactId:'source.png',narration:'原始脚本。',audioText:'原始脚本。',audioArtifactId:'voice.wav',audioDurationSeconds:2,audioGeneration:{kind:'imported'}})
  const ref={sceneId:scene.id,kind:'voice' as const};draft=moveStudioMain(draft,ref,1).draft
  assert.deepEqual(studioMainSpan(draft,ref),{start:1,end:3})
  draft=trimStudioMain(draft,ref,'start',1.5).draft;draft=trimStudioMain(draft,ref,'end',2.5).draft
  assert.deepEqual(draft.scenes[0].voiceTiming,{startSeconds:1.5,sourceStartSeconds:.5,durationSeconds:1,playbackRate:1})
  assert.equal(draft.scenes[0].audioDurationSeconds,2);assert.equal(draft.scenes[0].audioArtifactId,'voice.wav');assert.equal(scene.voiceTiming,undefined)
  draft=setStudioMainVoice(draft,ref,{startSeconds:1.5,sourceStartSeconds:.5,durationSeconds:.75,playbackRate:2}).draft
  const current=draft.scenes[0];current.speechCaptions=true;current.speechAnchors={scriptText:current.narration,scriptSha256:'a'.repeat(64),audioArtifactId:'voice.wav',audioSha256:'b'.repeat(64),durationSeconds:2,createdAt:new Date().toISOString(),capturedRevision:1,timeDomain:'audio-file-seconds',origin:'user-edited',anchors:[{id:'sentence-one',scriptStart:0,scriptEnd:current.narration.length,startSeconds:.6,endSeconds:1.2}]}
  const cue=speechCaptionCues(current)[0];assert.ok(Math.abs(cue.startSeconds-1.55)<1e-9&&Math.abs(cue.endSeconds-1.85)<1e-9)
  assert.throws(()=>trimStudioMain(draft,ref,'start',1.75),/句锚点/);assert.equal(current.speechAnchors.anchors[0].startSeconds,.6)
  assert.throws(()=>setStudioMainVoice(draft,ref,{startSeconds:1,sourceStartSeconds:1,durationSeconds:1,playbackRate:2}),/实测原音频/)
  assert.throws(()=>assertVideoDraft({...draft,scenes:[{...current,voiceTiming:{...current.voiceTiming,code:'exec'}}]}),/Unsupported/)
  assert.throws(()=>narrationSceneTime(current,.25),/区间外/)
  const projected=studioTimeline(draft).clips.find(c=>c.kind==='voice')!;assert.equal(projected.sceneId,current.id);assert.equal(projected.start,1.5);assert.equal(projected.end,2.25)
  const estimated=estimatedCaptionCues(current,1280,720,2);assert.ok(estimated.length&&estimated.every(c=>c.startSeconds>=1.5&&c.endSeconds<=2.25))
  assert.deepEqual(draftComposition(draft).scenes[0].voiceTiming,current.voiceTiming)
 }finally{f.close()}
})
test('Main sequence reorder and ripple edits keep local ownership and absolute global tracks',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Sequence');Object.assign(draft.scenes[0],{durationSeconds:3,imageArtifactId:'first.png'});draft.scenes.push({...newStudioScene('second-scene'),durationSeconds:2,imageArtifactId:'second.png'})
  const local=addStudioLayer(draft,'first-scene','text');draft=editStudioLayer(local.draft,local.selection,v=>{v.durationSeconds=.5})
  const global=addStudioLayer(draft,undefined,'text');draft=editStudioLayer(global.draft,global.selection,v=>{v.startSeconds=2;v.durationSeconds=1})
  const globalBefore=structuredClone(draft.layers),localBefore=structuredClone(draft.scenes[0].layers)
  draft=moveStudioMain(draft,{sceneId:'first-scene',kind:'visual',index:0},4).draft
  assert.deepEqual(draft.scenes.map(s=>s.id),['second-scene','first-scene']);assert.deepEqual(draft.layers,globalBefore);assert.deepEqual(draft.scenes[1].layers,localBefore)
  draft=trimStudioMain(draft,{sceneId:'first-scene',kind:'scene'},'end',4).draft;assert.equal(draft.scenes[1].durationSeconds,2);assert.equal(draft.scenes.reduce((n,s)=>n+s.durationSeconds,0),4);assert.deepEqual(draft.layers,globalBefore)
  const invalid=editStudioLayer(draft,local.selection,v=>{v.startSeconds=1.5;v.durationSeconds=.5});assert.throws(()=>trimStudioMain(invalid,{sceneId:'first-scene',kind:'scene'},'end',3),/越界/)
  let segments=sceneDraft(f.store,'Segments');Object.assign(segments.scenes[0],{durationSeconds:3,visualSegments:[{imageArtifactId:'one.png',durationSeconds:1,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.2},{imageArtifactId:'two.png',durationSeconds:2,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.2}]})
  segments=trimStudioMain(segments,{sceneId:'first-scene',kind:'visual',index:1},'end',2.25).draft
  assert.equal(segments.scenes[0].durationSeconds,2.25);assert.equal(segments.scenes[0].visualSegments![1].durationSeconds,1.25)
 }finally{f.close()}
})
test('Main subtitle move, trim and split materialize one canonical ordered bilingual cue list',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Captions');Object.assign(draft.scenes[0],{durationSeconds:4,imageArtifactId:'source.png',captions:[{startSeconds:.5,endSeconds:1.5,text:'原文',translationText:'Translation',translationOrigin:'user-edited'},{startSeconds:2.5,endSeconds:3.5,text:'后文'}]})
  const ref={sceneId:'first-scene',kind:'caption' as const,index:0};draft=moveStudioMain(draft,ref,1).draft;draft=trimStudioMain(draft,ref,'end',2.25).draft
  draft=splitStudioMainCaption(draft,ref,1.5).draft;assert.equal(draft.scenes[0].captions!.length,3);assert.deepEqual(draft.scenes[0].captions!.slice(0,2).map(c=>[c.startSeconds,c.endSeconds,c.translationText]),[[1,1.5,'Translation'],[1.5,2.25,'Translation']])
  const before=JSON.stringify(draft);assert.throws(()=>moveStudioMain(draft,ref,2),/ordered|nonoverlapping/);assert.equal(JSON.stringify(draft),before)
  assert.equal(studioTimeline(draft).clips.filter(c=>c.kind==='caption')[1].itemIndex,1)
 }finally{f.close()}
})

test('Invalid voice source windows remain readiness issues without invented timeline captions',()=>{
 const f=fixture();try{
  const draft=sceneDraft(f.store,'Invalid window');Object.assign(draft.scenes[0],{durationSeconds:4,imageArtifactId:'source.png',audioArtifactId:'voice.wav',audioDurationSeconds:1,narration:'真实音频较短。',audioText:'真实音频较短。',audioGeneration:{kind:'imported'},voiceTiming:{startSeconds:.5,sourceStartSeconds:.5,durationSeconds:2,playbackRate:1}})
  assert.ok(draftReadiness(draft).issues.some(issue=>issue.code==='audio-duration'));assert.doesNotThrow(()=>studioTimeline(draft));assert.equal(studioTimeline(draft).clips.some(clip=>clip.kind==='voice'||clip.kind==='caption'),false)
 }finally{f.close()}
})

test('Studio live chat requests pin an immutable owner and validate actual panel/selection bounds',async()=>{
 const {assertStudioChatView,assertStudioRegion}=await import('../src/studio-context.js')
 assert.deepEqual(assertStudioChatView({open:true,docked:false,position:{x:.2,y:.3},owner:{projectId:'project-one',sessionId:'session-one'}}).owner,{projectId:'project-one',sessionId:'session-one'})
 assert.throws(()=>assertStudioChatView({open:true,owner:{projectId:['project-one'],sessionId:'session-one'}}))
 assert.throws(()=>assertStudioChatView({open:true,owner:{projectId:'project-one',sessionId:'session-one',extra:true}}))
 const region=assertStudioRegion({top:.1,bottom:.8,propertyWidth:.9,resourceWidth:0,avoid:{x:.2,y:.2,width:.4,height:.3}})
 assert.equal(region.propertyWidth,.9);assert.equal(region.avoid!.width,.4)
 assert.throws(()=>assertStudioRegion({...region,avoid:{x:.9,y:.2,width:.4,height:.3}}))
 assert.throws(()=>assertStudioRegion({...region,resourceWidth:Infinity}))
})

test('Repeated easing trims, splits and inserted keyframes preserve the full source curve and persisted ranges',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Eased curve');draft.scenes[0].durationSeconds=4
  const added=addStudioLayer(draft,'first-scene','rectangle'),ref=added.selection
  draft=editStudioLayer(added.draft,ref,value=>{(value as import('../../media-native/src/composition-layers.js').VisualLayer).keyframes=[
   {timeSeconds:.4,x:.05,y:.1,width:.2,height:.2,opacity:.2,easing:'linear'},
   {timeSeconds:2.3,x:.5,y:.5,width:.3,height:.3,opacity:.9,easing:'ease-in-out'},
   {timeSeconds:3.7,x:.2,y:.2,width:.4,height:.4,opacity:.4,easing:'ease-in-out'}]})
  const original=draft.scenes[0].layers![0]
  const same=(layers:typeof draft.scenes[0]['layers'],from:number,to:number)=>{for(let t=from;t<to;t+=.019){const layer=layers!.find(layer=>t>=layer.startSeconds&&t<layer.startSeconds+layer.durationSeconds)!;const expected=visualLayerBox(original,t),actual=visualLayerBox(layer,t-layer.startSeconds);for(const key of ['x','y','width','height','opacity'] as const)assert.ok(Math.abs(expected[key]-actual[key])<1e-10,'Source motion changed at '+t+' '+key)}}
  for(const cut of [.13,.75,1.3333,2.8,3.8])same(splitStudioLayer(draft,ref,cut).scenes[0].layers,0,4)
  for(const point of [.13,.75,1.3333,2.8,3.83])same(insertStudioLayerKeyframe(draft,ref,point).scenes[0].layers,0,4)
  const full=editStudioLayer(draft,ref,value=>{(value as import('../../media-native/src/composition-layers.js').VisualLayer).keyframes=Array.from({length:12},(_,i)=>({timeSeconds:.2+i*3.6/11,x:.1+i*.03,y:.1,width:.2,height:.2,opacity:.5,easing:'ease-in-out'}))});for(const cut of [.11,.55,1.37,3.85])assert.ok(splitStudioLayer(full,ref,cut).scenes[0].layers!.every(layer=>layer.keyframes!.length<=12),'Cuts of full-budget animations remain admissible')
  let next=trimStudioLayer(draft,ref,'start',.73);next=trimStudioLayer(next,ref,'end',3.43)
  next=insertStudioLayerKeyframe(next,ref,1.13);next=trimStudioLayer(next,ref,'start',.83)
  next=splitStudioLayer(next,ref,2.17);same(next.scenes[0].layers,.83,3.43)
  const saved=f.store.update(next.id,next.revision,next),read=f.store.read(saved.id);assert.deepEqual(read.scenes[0].layers,next.scenes[0].layers);same(read.scenes[0].layers,.83,3.43)
  assert.throws(()=>f.store.update(next.id,next.revision,next),/STUDIO_CONFLICT/)
  assert.equal(draft.scenes[0].layers!.length,1);assert.deepEqual(original.keyframes!.map(frame=>frame.timeSeconds),[.4,2.3,3.7])
  assert.throws(()=>insertStudioLayerKeyframe(draft,ref,.4),/新的时间点/)
 }finally{f.close()}
})

test('Narration splitting preserves source identity, continuous sentence captions and focus before independent piece edits',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Split narration');const scene=draft.scenes[0]
  Object.assign(scene,{durationSeconds:4,imageArtifactId:'source.png',narration:'原始脚本。',audioText:'原始脚本。',audioArtifactId:'voice.wav',audioDurationSeconds:2,audioGeneration:{kind:'imported'},speechCaptions:true})
  scene.speechAnchors={scriptText:scene.narration,scriptSha256:'a'.repeat(64),audioArtifactId:'voice.wav',audioSha256:'b'.repeat(64),durationSeconds:2,createdAt:new Date().toISOString(),capturedRevision:1,timeDomain:'audio-file-seconds',origin:'user-edited',anchors:[{id:'whole-sentence',scriptStart:0,scriptEnd:scene.narration.length,startSeconds:.2,endSeconds:1.8}]}
  scene.speechLinks={bullets:[],focus:[{anchorId:'whole-sentence',visualIndex:0,artifactId:'source.png',x:.5,y:.5,zoom:1.5,emphasize:true}]}
  const before=JSON.stringify(scene),cues=speechCaptionCues(scene),focus=speechScene(scene).focusIntervals,estimated=estimatedCaptionCues(scene,1280,720,2)
  let result=splitStudioMain(draft,{sceneId:scene.id,kind:'voice'},1.5);draft=result.draft
  const split=draft.scenes[0],ids=split.voiceSegments!.map(t=>t.id)
  assert.equal(JSON.stringify(scene),before);assert.equal(split.voiceTiming,undefined);assert.equal(split.audioDurationSeconds,2);assert.equal(split.audioArtifactId,'voice.wav');assert.deepEqual(split.speechAnchors,scene.speechAnchors)
  assert.deepEqual(speechCaptionCues(split),cues);assert.deepEqual(speechScene(split).focusIntervals,focus);assert.deepEqual(estimatedCaptionCues(split,1280,720,2),estimated)
  assert.equal(split.voiceSegments![1].sourceStartSeconds,1);assert.equal(result.selection.voiceSegmentId,ids[1]);assert.deepEqual(studioTimeline(draft).clips.filter(c=>c.kind==='voice').map(c=>c.voiceSegmentId),ids)
  assert.throws(()=>studioMainSpan(draft,{sceneId:scene.id,kind:'voice'}),/未选择|重新选择/)
  assert.throws(()=>moveStudioMain(draft,result.selection,1),/重叠/)
  assert.throws(()=>splitStudioMain(draft,result.selection,Infinity),/播放头/)
  draft=moveStudioMain(draft,result.selection,2.8).draft
  const moved=speechCaptionCues(draft.scenes[0]);assert.equal(moved.length,2);assert.equal(moved[0].text,scene.narration);assert.equal(moved[1].text,scene.narration);assert.ok(Math.abs(moved[1].startSeconds-2.8)<1e-9)
  assert.equal(speechScene(draft.scenes[0]).focusIntervals!.length,2)
  draft=trimStudioMain(draft,result.selection,'start',3).draft;assert.ok(Math.abs(draft.scenes[0].voiceSegments![1].sourceStartSeconds-1.2)<1e-9)
  draft=setStudioMainVoice(draft,result.selection,{startSeconds:3,sourceStartSeconds:1.2,durationSeconds:.3,playbackRate:2}).draft
  assert.equal(draft.scenes[0].voiceSegments![1].id,ids[1]);assert.ok(Math.abs(speechCaptionCues(draft.scenes[0])[1].endSeconds-3.3)<1e-9)
  assert.deepEqual(draftComposition(draft).scenes[0].voiceSegments,draft.scenes[0].voiceSegments)
  const left={sceneId:scene.id,kind:'voice' as const,voiceSegmentId:ids[0]};result=splitStudioMain(draft,left,1);assert.equal(result.draft.scenes[0].voiceSegments![0].id,ids[0]);assert.equal(result.draft.scenes[0].voiceSegments!.length,3)
  assert.throws(()=>moveStudioMain(result.draft,{...left,voiceSegmentId:'missing-piece'},1),/已删除/)
 }finally{f.close()}
})

test('Narration piece schemas and clocks reject ambiguity, coercion, source overflow and excess pieces',()=>{
 const segment={id:'voice-left',startSeconds:.5,sourceStartSeconds:0,durationSeconds:1,playbackRate:1},base={title:'Clock',durationSeconds:4,narration:'一句话',audioArtifactId:'voice.wav',voiceSegments:[segment]}
 assert.deepEqual(assertComposition({title:'Clock',music:false,scenes:[base]}).scenes[0].voiceSegments,[segment])
 for(const voiceSegments of [Array(9).fill(segment),[segment,{...segment}],[{...segment,id:['voice-left']}],[{...segment,startSeconds:'0.5'}],[{...segment,playbackRate:NaN}],[{...segment,shell:'exec'}],[segment,{...segment,id:'voice-right',startSeconds:1}]])assert.throws(()=>assertComposition({title:'Clock',scenes:[{...base,voiceSegments}]}))
 assert.throws(()=>assertComposition({title:'Clock',scenes:[{...base,audioArtifactId:undefined}]}),/audio artifact/)
 assert.throws(()=>assertComposition({title:'Clock',scenes:[{...base,voiceTiming:{startSeconds:0,sourceStartSeconds:0,durationSeconds:1,playbackRate:1}}]}),/not both/)
 assert.throws(()=>narrationWindows({...base,voiceSegments:[{...segment,sourceStartSeconds:1.5}]},2),/实测原音频/)
 const repeated={voiceSegments:[segment,{...segment,id:'repeat',startSeconds:2}]}
 assert.throws(()=>narrationSceneTime(repeated,.5),/多个播放/)
 assert.deepEqual(narrationSceneRanges(repeated,.2,.8).map(r=>[r.start,r.end]),[[.7,1.3],[2.2,2.8]])
 assert.deepEqual(narrationSceneRanges(repeated,1.5,1.8),[])
 assert.throws(()=>narrationWindow({...base,voiceSegments:repeated.voiceSegments},2),/具体旁白/)
})

test('Stored narration pieces survive omitted model fields, preserve independent captions and enforce captured revision',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Voice persistence');Object.assign(draft.scenes[0],{durationSeconds:4,imageArtifactId:'source.png',narration:'原文',audioText:'原文',audioArtifactId:'voice.wav',audioDurationSeconds:2,audioGeneration:{kind:'imported'},captions:[{startSeconds:0,endSeconds:1,text:'人工校正',translationText:'Manual',translationOrigin:'user-edited'}]})
  draft=f.store.update(draft.id,draft.revision,draft,true,true);const ref={sceneId:draft.scenes[0].id,kind:'voice' as const},split=splitStudioMain(draft,ref,1.5),captions=structuredClone(draft.scenes[0].captions)
  draft=f.store.update(draft.id,draft.revision,split.draft,true,true);const windows=structuredClone(draft.scenes[0].voiceSegments)
  const omitted=structuredClone(draft);delete omitted.scenes[0].voiceSegments;delete omitted.scenes[0].audioArtifactId;delete omitted.scenes[0].audioDurationSeconds;omitted.scenes[0].visualBrief='新画面'
  const saved=f.store.update(draft.id,draft.revision,omitted);assert.deepEqual(saved.scenes[0].voiceSegments,windows);assert.deepEqual(saved.scenes[0].captions,captions);assert.equal(saved.scenes[0].audioArtifactId,'voice.wav')
  assert.throws(()=>f.store.update(draft.id,draft.revision,split.draft),/STUDIO_CONFLICT/)
  const undo={...saved,scenes:[{...saved.scenes[0],voiceSegments:undefined,voiceTiming:undefined}]};const restored=f.store.update(saved.id,saved.revision,undo,true,true);assert.equal(restored.scenes[0].voiceSegments,undefined)
  assert.deepEqual(restored.scenes[0].captions,captions)
 }finally{f.close()}
})

test('Exact narration piece Assistant targets reject deleted, foreign-container and mixed scopes',async()=>{
 const {assertStudioPrompt,studioSelectedObject}=await import('../src/studio-context.js'),f=fixture();try{
  let draft=sceneDraft(f.store,'Exact voice scope');Object.assign(draft.scenes[0],{durationSeconds:4,narration:'原文',audioText:'原文',audioArtifactId:'voice.wav',audioDurationSeconds:2,audioGeneration:{kind:'imported'},imageArtifactId:'source.png'})
  const result=splitStudioMain(draft,{sceneId:'first-scene',kind:'voice'},1.5);draft=result.draft
  const voiceSegmentId=result.selection.voiceSegmentId!,selection={draftId:draft.id,sceneId:'first-scene',objectKind:'voice',voiceSegmentId,stage:4,revision:draft.revision,dirty:false}
  const selected=assertStudioSelection(selection,draft),target={projectId:'project-one',sessionId:'session-one',draftId:draft.id,kind:'object',sceneId:'first-scene',objectKind:'voice',voiceSegmentId}
  assert.deepEqual(assertStudioPrompt({text:'仅改右半段',target}).target,target);assert.equal(studioSelectedObject(draft,selected)!.id,voiceSegmentId)
  assert.ok(studioPromptContext('studio',selected,draft).includes(voiceSegmentId))
  for(const kind of ['film','scene'])assert.throws(()=>assertStudioPrompt({text:'修改',target:{...target,kind}}))
  assert.throws(()=>assertStudioPrompt({text:'修改',target:{...target,voiceSegmentId:[voiceSegmentId]}}))
  assert.throws(()=>assertStudioSelection({...selection,objectKind:'captions'},draft))
  const foreign=structuredClone(draft);foreign.scenes.push({...newStudioScene('foreign-scene'),imageArtifactId:'source.png'});assert.throws(()=>assertStudioSelection({...selection,sceneId:'foreign-scene'},foreign),/deleted/)
  draft.scenes[0].voiceSegments!.pop();assert.throws(()=>assertStudioSelection(selection,draft),/deleted/)
 }finally{f.close()}
})


test('Main visual cuts preserve image/video framing, zoom and fade envelopes at arbitrary and repeated cut points',()=>{
 const f=fixture();try{
  for(const video of [false,true]){
   const draft=sceneDraft(f.store,'Visual continuity');draft.scenes[0].durationSeconds=8
   draft.scenes[0].visualSegments=assertComposition({title:'Visuals',scenes:[{title:'One',durationSeconds:8,visualSegments:[
    {imageArtifactId:'before.png',durationSeconds:1},
    {durationSeconds:6,...(video?{videoArtifactId:'source.webm',sourceStartSeconds:2,playbackRate:1.5,keepSourceAudio:true,sourceVolume:.7}:{imageArtifactId:'source.png'}),zoom:1.5,crop:{x:.1,y:.1,width:.8,height:.8},transition:'fade',transitionSeconds:.8,focusIntervals:[{startSeconds:video?2.1:.1,endSeconds:video?10.85:5.9,x:.7,y:.3,zoom:2,emphasize:true}]},
    {imageArtifactId:'after.png',durationSeconds:1,transition:'fade',transitionSeconds:.4}
   ]}]}).scenes[0].visualSegments
   const compare=(next:VideoDraft)=>{for(let t=.003;t<8;t+=.017){const a=visualAtTime(draft.scenes[0],t)!,b=visualAtTime(next.scenes[0],t)!;assert.equal(a.segment.imageArtifactId??a.segment.videoArtifactId,b.segment.imageArtifactId??b.segment.videoArtifactId);assert.ok(Math.abs(a.opacity-b.opacity)<1e-9,'Fade changed at '+t);assert.ok(Math.abs(visualZoom(a.segment,a.localSeconds)-visualZoom(b.segment,b.localSeconds))<1e-9,'Zoom changed at '+t);assert.deepEqual(focusFraming(a.segment,a.localSeconds).focus,focusFraming(b.segment,b.localSeconds).focus);const ca=focusFraming(a.segment,a.localSeconds).crop,cb=focusFraming(b.segment,b.localSeconds).crop;for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(ca[key]-cb[key])<1e-9,'Framing changed at '+t);if(video&&a.segment.videoArtifactId)assert.ok(Math.abs(focusSourceTime(a.segment,a.localSeconds)-focusSourceTime(b.segment,b.localSeconds))<1e-9)}}
   for(const cut of [1.11,1.4,2.1333,6.85]){const split=splitStudioMain(draft,{sceneId:'first-scene',kind:'visual',index:1},cut);compare(split.draft);assert.equal(split.draft.scenes[0].id,draft.scenes[0].id);assert.equal(split.draft.scenes[0].durationSeconds,8);assert.equal(split.selection.index,2);assert.equal(visualPlaybackGroup(split.draft.scenes[0],2).durationSeconds,6)}
   let next=splitStudioMain(draft,{sceneId:'first-scene',kind:'visual',index:1},1.4).draft
   next=splitStudioMain(next,{sceneId:'first-scene',kind:'visual',index:2},2.1333).draft
   next=splitStudioMain(next,{sceneId:'first-scene',kind:'visual',index:3},6.85).draft;compare(next)
   assert.equal(new Set(next.scenes[0].visualSegments!.flatMap(v=>v.id?[v.id]:[])).size,4)
   const saved=f.store.update(next.id,next.revision,next);compare(f.store.read(saved.id));assert.throws(()=>f.store.update(next.id,next.revision,next),/STUDIO_CONFLICT/)
   const markers=sceneVisuals(next.scenes[0]).flatMap((v,i)=>visibleFocusIntervals(v,v.durationSeconds).map(r=>({...r,i})));assert.ok(markers.length>=3)
   assert.throws(()=>splitStudioMain(next,{sceneId:'first-scene',kind:'visual',index:1},Infinity),/播放头/)
  }
 }finally{f.close()}
})

test('Visual splits preserve sentence focus links and trusted source subtitles, including later segment reindex and undo',async()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Linked visuals');Object.assign(draft.scenes[0],{durationSeconds:8,narration:'完整的一句。',audioArtifactId:'voice.wav',audioText:'完整的一句。',audioDurationSeconds:2,voiceTiming:{startSeconds:1,sourceStartSeconds:0,durationSeconds:2,playbackRate:1},captions:[{startSeconds:1.2,endSeconds:2.8,text:'人工字幕',translationText:'Manual subtitle',translationOrigin:'user-edited'}]})
  draft.scenes[0].visualSegments=assertComposition({title:'Linked',scenes:[{title:'One',durationSeconds:8,visualSegments:[{imageArtifactId:'before.png',durationSeconds:1},{videoArtifactId:'source.webm',durationSeconds:6,sourceStartSeconds:2,playbackRate:1.5,keepSourceAudio:true},{videoArtifactId:'later.webm',durationSeconds:1,sourceStartSeconds:3}]}]}).scenes[0].visualSegments
  draft=f.store.update(draft.id,draft.revision,draft,true,true)
  draft=f.store.setSpeech(draft.id,draft.revision,'first-scene','anchors',{scriptText:'完整的一句。',scriptSha256:'a'.repeat(64),audioArtifactId:'voice.wav',audioSha256:'b'.repeat(64),durationSeconds:2,createdAt:new Date().toISOString(),capturedRevision:draft.revision,timeDomain:'audio-file-seconds',origin:'user-edited',anchors:[{id:'sentence',scriptStart:0,scriptEnd:'完整的一句。'.length,startSeconds:.2,endSeconds:1.8}]})
  draft=f.store.setSourceSpeech(draft.id,draft.revision,'first-scene',s=>{s.sourceSpeech={sourceArtifactId:'source.webm',sourceSha256:'c'.repeat(64),evidenceArtifactId:'asr.json',evidenceSha256:'d'.repeat(64),durationSeconds:20,segmentIndex:1,createdAt:new Date().toISOString()};s.sourceCaptionBinding={sourceArtifactId:'source.webm',sourceSha256:'c'.repeat(64),segmentIndex:1,clock:sourceCaptionClock(s,1),origin:'user-edited'}})
  draft.scenes[0].speechLinks={bullets:[],focus:[{anchorId:'sentence',visualIndex:1,artifactId:'source.webm',x:.7,y:.4,zoom:2,emphasize:true}]};draft=f.store.update(draft.id,draft.revision,draft,true,true)
  const owner={projectId:'linked-project',sessionId:'fixture-session'},service=new VideoStudioService({projectStore:{active:()=>({id:owner.projectId,name:'Linked',directory:f.root})}} as unknown as StudioKernel),approved=await service.execute({operation:'list'},undefined,owner) as {snapshotProofs:Record<string,string>}
  const original=structuredClone(draft),result=splitStudioMain(draft,{sceneId:'first-scene',kind:'visual',index:1},1.3333)
  draft=f.store.update(draft.id,draft.revision,result.draft,true,true)
  assert.equal(sourceCaptionsStale(draft.scenes[0]),false);assert.deepEqual(draft.scenes[0].captions,original.scenes[0].captions);assert.deepEqual(draft.scenes[0].speechAnchors,original.scenes[0].speechAnchors);assert.equal(draft.scenes[0].speechLinks!.focus.length,2)
  const a=speechScene(original.scenes[0]),b=speechScene(draft.scenes[0]);for(let t=1;t<3;t+=.017){const av=visualAtTime(a,t)!,bv=visualAtTime(b,t)!;assert.ok(Math.abs(focusFraming(av.segment,av.localSeconds).strength-focusFraming(bv.segment,bv.localSeconds).strength)<1e-9)}
  const cues=[{startSeconds:2.1,endSeconds:10.8,text:'整个源区间'}];assert.deepEqual(projectSourceCues(draft.scenes[0],1,cues),projectSourceCues(original.scenes[0],1,cues));assert.deepEqual(projectSourceCues(draft.scenes[0],2,cues),projectSourceCues(original.scenes[0],1,cues))
  const restored=await service.execute({operation:'restore',draftId:draft.id,expectedRevision:draft.revision,draft:original,snapshotProof:approved.snapshotProofs[draft.id]},undefined,owner,'user') as VideoDraft;assert.equal(sourceCaptionsStale(restored.scenes[0]),false)
  let later=f.store.setSourceSpeech(restored.id,restored.revision,'first-scene',s=>{s.sourceSpeech={...s.sourceSpeech!,sourceArtifactId:'later.webm',segmentIndex:2};s.sourceCaptionBinding={...s.sourceCaptionBinding!,sourceArtifactId:'later.webm',segmentIndex:2,clock:sourceCaptionClock(s,2)}})
  const cut=splitStudioMain(later,{sceneId:'first-scene',kind:'visual',index:1},1.4);later=f.store.update(later.id,later.revision,cut.draft,true,true)
  assert.equal(later.scenes[0].sourceCaptionBinding!.segmentIndex,3);assert.equal(later.scenes[0].sourceSpeech!.segmentIndex,3);assert.equal(sourceCaptionsStale(later.scenes[0]),false)
  const undo=f.store.update(later.id,later.revision,{...later,scenes:restored.scenes},true,true);assert.equal(undo.scenes[0].sourceCaptionBinding!.segmentIndex,2)
 }finally{f.close()}
})


test('An explicit local transition keeps the original motion clock, and later cuts preserve both clocks',()=>{
 const f=fixture();try{
  const draft=sceneDraft(f.store,'Separate effect clocks');Object.assign(draft.scenes[0],{durationSeconds:4,imageArtifactId:'source.png',zoom:1.5,focusIntervals:[{startSeconds:.2,endSeconds:3.8,x:.5,y:.5,zoom:2,emphasize:true}]})
  const first=splitStudioMain(draft,{sceneId:'first-scene',kind:'visual',index:0},1).draft,segment=first.scenes[0].visualSegments![1]
  Object.assign(segment.effectWindow!,{fadeInSeconds:.3,fadeOutSeconds:0,opacityStartSeconds:0,opacityDurationSeconds:3})
  for(const t of [0,.2,.8,2.7])assert.ok(Math.abs(visualZoom(segment,t)-visualZoom(draft.scenes[0],1+t))<1e-9)
  const second=splitStudioMain(first,{sceneId:'first-scene',kind:'visual',index:1},1.2).draft
  for(let t=1;t<4;t+=.017){const a=visualAtTime(first.scenes[0],t)!,b=visualAtTime(second.scenes[0],t)!;assert.ok(Math.abs(a.opacity-b.opacity)<1e-9);assert.ok(Math.abs(visualZoom(a.segment,a.localSeconds)-visualZoom(b.segment,b.localSeconds))<1e-9)}
 }finally{f.close()}
})

test('Exact visual piece scope survives reordering and rejects deleted, foreign and mixed targets',async()=>{
 const {assertStudioPrompt,studioSelectedObject}=await import('../src/studio-context.js'),f=fixture();try{
  let draft=sceneDraft(f.store,'Exact visual scope');Object.assign(draft.scenes[0],{durationSeconds:2,imageArtifactId:'source.png'})
  draft=splitStudioMain(draft,{sceneId:'first-scene',kind:'visual',index:0},1).draft
  const id=draft.scenes[0].visualSegments![1].id!,selection={draftId:draft.id,sceneId:'first-scene',objectKind:'visual' as const,visualSegmentId:id,stage:4,revision:draft.revision,dirty:false},target={projectId:'project-one',sessionId:'session-one',draftId:draft.id,kind:'object',sceneId:'first-scene',objectKind:'visual',visualSegmentId:id}
  assert.deepEqual(assertStudioPrompt({text:'仅改右画面',target}).target,target)
  assert.equal(studioSelectedObject(draft,assertStudioSelection(selection,draft))!.id,id)
  assert.equal(studioSelectedObject(draft,selection)!.startSeconds,1)
  draft.scenes[0].visualSegments!.reverse()
  assert.equal(studioSelectedObject(draft,assertStudioSelection(selection,draft))!.startSeconds,0)
  assert.equal(studioMainSpan(draft,{sceneId:'first-scene',kind:'visual',index:1,visualSegmentId:id}).start,0,'Stable identity wins over stale index')
  const trimmed=trimStudioMain(draft,{sceneId:'first-scene',kind:'visual',index:1,visualSegmentId:id},'end',.8)
  assert.equal(trimmed.selection.index,0);assert.equal(trimmed.draft.scenes[0].visualSegments![0].durationSeconds,.8);assert.equal(trimmed.draft.scenes[0].visualSegments![1].durationSeconds,1)
  const cut=splitStudioMain(draft,{sceneId:'first-scene',kind:'visual',index:1,visualSegmentId:id},.5)
  assert.equal(cut.draft.scenes[0].visualSegments![0].id,id);assert.equal(cut.selection.visualSegmentId,cut.draft.scenes[0].visualSegments![1].id)
  for(const kind of ['film','scene'])assert.throws(()=>assertStudioPrompt({text:'修改',target:{...target,kind}}))
  for(const patch of [{objectKind:'voice'},{objectKind:'captions'},{voiceSegmentId:'voice-one'},{layer:{id:'layer-one',kind:'visual'}},{visualSegmentId:[id]},{visualSegmentId:'../../bad'}]){assert.throws(()=>assertStudioPrompt({text:'修改',target:{...target,...patch}}));assert.throws(()=>assertStudioSelection({...selection,...patch},draft))}
  const foreign=structuredClone(draft);foreign.scenes.push({...newStudioScene('foreign-scene'),durationSeconds:2,imageArtifactId:'source.png'});assert.throws(()=>assertStudioSelection({...selection,sceneId:'foreign-scene'},foreign),/deleted/)
  draft.scenes[0].visualSegments!.shift();draft.scenes[0].durationSeconds=1
  assert.throws(()=>assertStudioSelection(selection,draft),/deleted/);assert.throws(()=>studioPromptContext('studio',selection,draft),/deleted/);assert.throws(()=>studioMainSpan(draft,{sceneId:'first-scene',kind:'visual',index:0,visualSegmentId:id}),/已删除/)
  const underscored={...target,visualSegmentId:'piece_one'};assert.deepEqual(assertStudioPrompt({text:'修改',target:underscored}).target,underscored)
 }finally{f.close()}
})

test('Independent cuts preserve full fade and keyframe samples in scene and film clocks',async()=>{
 const {resetStudioLayerFade}=await import('../src/studio-layer-edits.js')
 const f=fixture();try{for(const sceneId of ['first-scene',undefined]){
  let original=sceneDraft(f.store,'Original fades');original.scenes[0].durationSeconds=4
  const visual=addStudioLayer(original,sceneId,'rectangle');original=visual.draft
  const audio=addStudioLayer(original,sceneId,'audio','tone.wav',4);original=audio.draft
  original=editStudioLayer(original,visual.selection,value=>{const l=value as import('../../media-native/src/composition-layers.js').VisualLayer;l.fadeInSeconds=1.2;l.fadeOutSeconds=.7;l.keyframes=[{timeSeconds:0,x:.1,y:.1,width:.3,height:.3,opacity:.4,easing:'linear'},{timeSeconds:4,x:.5,y:.2,width:.3,height:.3,opacity:.9,easing:'ease-in-out'}]})
  original=editStudioLayer(original,audio.selection,value=>{value.fadeInSeconds=1.2;value.fadeOutSeconds=.7;if('playbackRate' in value)value.playbackRate=.5})
  for(const ref of [visual.selection,audio.selection]){
   let split=splitStudioLayer(original,ref,.15)
   const container=(draft:typeof split)=>sceneId?draft.scenes[0]:draft
   for(const cut of [.47,2.55,3.85]){const candidates=ref.kind==='visual'?container(split).layers!:container(split).audioTracks!,piece=candidates.find(p=>cut>p.startSeconds&&cut<p.startSeconds+p.durationSeconds)!;split=splitStudioLayer(split,{...ref,id:piece.id},cut)}
   const pieces=ref.kind==='visual'?container(split).layers!:container(split).audioTracks!,source=studioLayer(original,ref)
   assert.equal(pieces[0].id,ref.id);assert.equal(pieces.length,5);assert.equal(new Set(pieces.map(p=>p.id)).size,5);assert.equal(new Set(pieces.map(p=>p.fadeWindow!.originId)).size,1)
   for(let t=0;t<4;t+=.013){const piece=pieces.find(p=>t>=p.startSeconds&&t<p.startSeconds+p.durationSeconds)!;assert.ok(Math.abs(layerFadeGain(source,t)-layerFadeGain(piece,t-piece.startSeconds))<1e-12)
    if(ref.kind==='visual'){const before=visualLayerBox(source as import('../../media-native/src/composition-layers.js').VisualLayer,t),after=visualLayerBox(piece as import('../../media-native/src/composition-layers.js').VisualLayer,t-piece.startSeconds);for(const key of ['x','y','width','height','opacity'] as const)assert.ok(Math.abs(before[key]-after[key])<1e-12,'Preserved '+key+' at '+t)}
   }
   if(ref.kind==='audio')assert.deepEqual((pieces as import('../../media-native/src/composition-layers.js').AudioLayer[]).map(p=>p.sourceStartSeconds),[0,.075,.235,1.275,1.925])
   const kept=pieces[1],trimmed=trimStudioLayer(split,{...ref,id:kept.id},'start',.2),again=trimStudioLayer(trimmed,{...ref,id:kept.id},'end',.4),piece=studioLayer(again,{...ref,id:kept.id})
   for(let t=.2;t<.4;t+=.009)assert.ok(Math.abs(layerFadeGain(source,t)-layerFadeGain(piece,t-.2))<1e-12)
   const reset=resetStudioLayerFade(again,{...ref,id:kept.id}),fresh=studioLayer(reset,{...ref,id:kept.id});assert.equal(fresh.fadeWindow,undefined);assert.equal(fresh.fadeInSeconds,.1);assert.equal(layerFadeGain(fresh,0),0);assert.equal(fresh.id,kept.id)
   assert.throws(()=>editStudioLayer(again,{...ref,id:kept.id},l=>{l.durationSeconds=5}),/超过保留/)
  }
  assert.equal(studioLayer(original,visual.selection).fadeWindow,undefined);assert.equal(studioLayer(original,audio.selection).durationSeconds,4)
 }}finally{f.close()}
})

test('Reviewed source subtitles rebind trim, speed, offset, reorder and undo with original cues and manual translations',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Source clocks');Object.assign(draft.scenes[0],{durationSeconds:6,visualSegments:[{id:'before',imageArtifactId:'before.png',durationSeconds:2,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.05},{id:'source',videoArtifactId:'source.webm',durationSeconds:4,sourceStartSeconds:2,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.05}],captions:[{startSeconds:2,endSeconds:4,text:'First',translationText:'人工第一句',translationOrigin:'user-edited'},{startSeconds:4,endSeconds:6,text:'Second',translationText:'人工第二句',translationOrigin:'user-edited'}]})
  draft=f.store.update(draft.id,draft.revision,draft,false,true)
  draft=f.store.setSourceSpeech(draft.id,draft.revision,'first-scene',s=>{s.sourceCaptionBinding={sourceArtifactId:'source.webm',sourceSha256:'a'.repeat(64),segmentIndex:1,clock:sourceCaptionClock(s,1),origin:'user-edited',sourceRange:{startSeconds:0,endSeconds:20},sourceCues:[{startSeconds:0,endSeconds:2,text:'Earlier'},{startSeconds:2,endSeconds:4,text:'First',translationText:'人工第一句',translationOrigin:'user-edited'},{startSeconds:4,endSeconds:8,text:'Second',translationText:'人工第二句',translationOrigin:'user-edited'}]}})
  const original=structuredClone(draft),ref={sceneId:'first-scene',kind:'visual' as const,index:1,visualSegmentId:'source'}
  let trimmed=trimStudioMain(draft,ref,'start',3).draft
  assert.deepEqual(trimmed.scenes[0].captions!.map(c=>[c.startSeconds,c.endSeconds]),[[2,3],[3,5]])
  draft=f.store.update(draft.id,draft.revision,trimmed,false,true);assert.equal(sourceCaptionsStale(draft.scenes[0]),false);assert.equal(draft.scenes[0].sourceCaptionBinding!.sourceCues![2].endSeconds,8)
  let changed=structuredClone(draft);changed.scenes[0].visualSegments![1].playbackRate=2;draft=f.store.update(draft.id,draft.revision,changed,false,true)
  assert.deepEqual(draft.scenes[0].captions!.map(c=>[c.startSeconds,c.endSeconds]),[[2,2.5],[2.5,4.5]]);assert.deepEqual(draft.scenes[0].captions!.map(c=>c.translationText),['人工第一句','人工第二句'])
  const moved=moveStudioMain(draft,ref,0);draft=f.store.update(draft.id,draft.revision,moved.draft,false,true)
  assert.equal(draft.scenes[0].sourceCaptionBinding!.segmentIndex,0);assert.deepEqual(draft.scenes[0].captions!.map(c=>[c.startSeconds,c.endSeconds]),[[0,.5],[.5,2.5]])
  draft=f.store.update(draft.id,draft.revision,{...draft,scenes:original.scenes},false,true)
  assert.deepEqual(draft.scenes[0].captions,original.scenes[0].captions);assert.equal(sourceCaptionsStale(draft.scenes[0]),false)
  changed=structuredClone(draft);changed.scenes[0].visualSegments![1].sourceStartSeconds=0;draft=f.store.update(draft.id,draft.revision,changed,false,true)
  assert.deepEqual(draft.scenes[0].captions!.map(c=>c.text),['Earlier','First']);assert.equal(draft.scenes[0].captions![1].translationOrigin,'user-edited')
  const previous=structuredClone(draft);changed=structuredClone(draft);changed.scenes[0].visualSegments![1].playbackRate=1.5;changed.scenes[0].captions![0].text='Unrelated simultaneous change'
  assert.throws(()=>f.store.update(draft.id,draft.revision,changed,false,true),/STUDIO_SOURCE_REBIND_CONFLICT/);assert.deepEqual(f.store.read(draft.id),previous)
  changed=structuredClone(draft);changed.scenes[0].visualSegments![1].videoArtifactId='other.webm';changed.scenes[0].sourceCaptionBinding!.sourceSha256='f'.repeat(64);draft=f.store.update(draft.id,draft.revision,changed,false,true)
  assert.equal(draft.scenes[0].sourceCaptionBinding!.sourceSha256,'a'.repeat(64));assert.equal(sourceCaptionsStale(draft.scenes[0]),true)
 }finally{f.close()}
})
test('Legacy source subtitle bindings admit only reviewed visible range and reject forged roots or unreviewed extension',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Legacy source');Object.assign(draft.scenes[0],{durationSeconds:3,videoArtifactId:'source.webm',sourceStartSeconds:2,captions:[{startSeconds:0,endSeconds:3,text:'Legacy',translationText:'人工原文',translationOrigin:'user-edited'}]});draft=f.store.update(draft.id,draft.revision,draft,false,true)
  draft=f.store.setSourceSpeech(draft.id,draft.revision,'first-scene',s=>{s.sourceCaptionBinding={sourceArtifactId:'source.webm',sourceSha256:'a'.repeat(64),segmentIndex:0,clock:sourceCaptionClock(s,0),origin:'user-edited'}})
  let next=structuredClone(draft);next.scenes[0].sourceStartSeconds=1;assert.throws(()=>f.store.update(draft.id,draft.revision,next,false,true),/STUDIO_SOURCE_CUES_REQUIRED/);assert.deepEqual(f.store.read(draft.id),draft)
  next=structuredClone(draft);next.scenes[0].sourceStartSeconds=2.5;next.scenes[0].durationSeconds=2.5;next.scenes[0].captions![0].endSeconds=2.5
  const direct=trimStudioMain(draft,{sceneId:'first-scene',kind:'visual',index:0},'start',.5).draft;draft=f.store.update(draft.id,draft.revision,direct,false,true)
  assert.equal(draft.scenes[0].captions![0].endSeconds,2.5);assert.deepEqual(draft.scenes[0].sourceCaptionBinding!.sourceRange,{startSeconds:2,endSeconds:5})
  next=structuredClone(draft);next.scenes[0].sourceCaptionBinding!.sourceCues![0].text='Forged source text';next.scenes[0].sourceCaptionBinding!.sourceRange!.endSeconds=180;draft=f.store.update(draft.id,draft.revision,next,false,true)
  assert.equal(draft.scenes[0].sourceCaptionBinding!.sourceCues![0].text,'Legacy');assert.equal(draft.scenes[0].sourceCaptionBinding!.sourceRange!.endSeconds,5)
  for(const invalid of [{sourceCues:[],sourceRange:undefined},{sourceRange:{startSeconds:0,endSeconds:180},sourceCues:undefined},{sourceCues:[{startSeconds:0,endSeconds:1,text:'x',shell:'unsafe'}],sourceRange:{startSeconds:0,endSeconds:2}},{sourceCues:[],sourceRange:{startSeconds:2,endSeconds:1}}])assert.throws(()=>assertVideoDraft({...draft,scenes:[{...draft.scenes[0],sourceCaptionBinding:{...draft.scenes[0].sourceCaptionBinding,...invalid}}]}))
 }finally{f.close()}
})

test('Source subtitle identity never adopts a deleted stable clip and host translation edits survive later reprojection',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Exact source');Object.assign(draft.scenes[0],{durationSeconds:3,visualSegments:[{id:'source-id',videoArtifactId:'source.webm',durationSeconds:3,sourceStartSeconds:1,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.05}],captions:[{startSeconds:0,endSeconds:3,text:'Original'}]});draft=f.store.update(draft.id,draft.revision,draft)
  draft=f.store.setSourceSpeech(draft.id,draft.revision,'first-scene',s=>{s.sourceCaptionBinding={sourceArtifactId:'source.webm',sourceSha256:'a'.repeat(64),segmentIndex:0,visualSegmentId:'source-id',clock:sourceCaptionClock(s,0),origin:'user-edited',sourceRange:{startSeconds:0,endSeconds:10},sourceCues:[{startSeconds:0,endSeconds:5,text:'Original'}]}})
  draft=f.store.setSourceSpeech(draft.id,draft.revision,'first-scene',s=>{s.captions![0].translationText='人工修改';s.captions![0].translationOrigin='user-edited'})
  assert.equal(draft.scenes[0].sourceCaptionBinding!.sourceCues![0].translationText,'人工修改')
  const next=structuredClone(draft);next.scenes[0].visualSegments![0].playbackRate=2;draft=f.store.update(draft.id,draft.revision,next,false,true);assert.equal(draft.scenes[0].captions![0].endSeconds,2);assert.equal(draft.scenes[0].captions![0].translationOrigin,'user-edited')
  const replacement=structuredClone(draft);replacement.scenes[0].visualSegments![0].id='replacement-id';replacement.scenes[0].sourceCaptionBinding!.visualSegmentId='replacement-id';replacement.scenes[0].sourceCaptionBinding!.sourceSha256='b'.repeat(64)
  draft=f.store.update(draft.id,draft.revision,replacement,false,true);assert.equal(draft.scenes[0].sourceCaptionBinding!.visualSegmentId,'source-id');assert.equal(draft.scenes[0].sourceCaptionBinding!.sourceSha256,'a'.repeat(64));assert.equal(sourceCaptionsStale(draft.scenes[0]),true)
 }finally{f.close()}
})

test('Host-approved history restores deleted scene speech/source records and preserves the current export journal',async()=>{
 const f=fixture();try{
  const project={id:'snapshot-project',directory:f.root,name:'Snapshot'},owner={projectId:project.id,sessionId:'fixture-session'},kernel={projectStore:{active:()=>project}} as unknown as StudioKernel,service=new VideoStudioService(kernel)
  let d=sceneDraft(f.store,'已核对历史');Object.assign(d.scenes[0],{narration:'人工核对的一句。',audioArtifactId:'voice.wav',audioText:'人工核对的一句。',audioDurationSeconds:2,videoArtifactId:'source.webm',sourceDurationSeconds:8,captions:[{startSeconds:0,endSeconds:2,text:'原声',translationText:'人工译文',translationOrigin:'user-edited'}]})
  d=f.store.update(d.id,d.revision,d,true,true)
  d=f.store.setSpeech(d.id,d.revision,'first-scene','anchors',{scriptText:d.scenes[0].narration,scriptSha256:'a'.repeat(64),audioArtifactId:'voice.wav',audioSha256:'b'.repeat(64),durationSeconds:2,createdAt:new Date().toISOString(),capturedRevision:d.revision,timeDomain:'audio-file-seconds',origin:'user-edited',anchors:[{id:'sentence',scriptStart:0,scriptEnd:d.scenes[0].narration.length,startSeconds:.1,endSeconds:1.9}]})
  d=f.store.setSourceSpeech(d.id,d.revision,'first-scene',s=>{s.sourceSpeech={sourceArtifactId:'source.webm',sourceSha256:'c'.repeat(64),evidenceArtifactId:'source-evidence.json',evidenceSha256:'d'.repeat(64),durationSeconds:8,segmentIndex:0,createdAt:new Date().toISOString()};s.sourceCaptionBinding={sourceArtifactId:'source.webm',sourceSha256:'c'.repeat(64),segmentIndex:0,clock:sourceCaptionClock(s,0),origin:'user-edited',sourceRange:{startSeconds:0,endSeconds:8},sourceCues:structuredClone(s.captions!)}})
  const original=structuredClone(d),approved=await service.execute({operation:'list'},undefined,owner) as {snapshotProofs:Record<string,string>};assert.match(approved.snapshotProofs[d.id],/^[a-f0-9]{64}$/)
  d=f.store.update(d.id,d.revision,{...d,scenes:[]});d=f.store.addExport(d.id,d.revision,{artifactId:'later.mp4',durationSeconds:8});const journal=structuredClone(d.exports)
  const changed=structuredClone(original);changed.revision=d.revision;changed.updatedAt=new Date().toISOString();changed.exports=[]
  const restored=await service.execute({operation:'restore',draftId:d.id,expectedRevision:d.revision,draft:changed,snapshotProof:approved.snapshotProofs[d.id]},undefined,owner,'user') as VideoDraft
  assert.deepEqual(restored.scenes,original.scenes);assert.deepEqual(restored.exports,journal);assert.equal(restored.revision,d.revision+1);assert.equal(restored.scenes[0].speechAnchors!.origin,'user-edited');assert.equal(restored.scenes[0].captions![0].translationOrigin,'user-edited')
  assert.equal(sourceCaptionsStale(restored.scenes[0]),false)
  const list=await service.execute({operation:'list'},undefined,owner) as {snapshotProofs:Record<string,string>};assert.equal(list.snapshotProofs[restored.id],approved.snapshotProofs[restored.id],'Journal/revision changes do not manufacture new content')
 }finally{f.close()}
})
test('Snapshot approval cannot authorize modified content, foreign owners, another host, cancellation or stale revisions',async()=>{
 const f=fixture();try{
  let project={id:'snapshot-project',directory:f.root,name:'Snapshot'};const owner={projectId:project.id,sessionId:'fixture-session'},kernel={projectStore:{active:()=>project}} as unknown as StudioKernel,service=new VideoStudioService(kernel)
  let d=sceneDraft(f.store,'原始历史');d.scenes[0].imageArtifactId='frame.png';d=f.store.update(d.id,d.revision,d)
  const state=await service.execute({operation:'list'},undefined,owner) as {snapshotProofs:Record<string,string>},proof=state.snapshotProofs[d.id],request={operation:'restore',draftId:d.id,expectedRevision:d.revision,draft:d,snapshotProof:proof},record=()=>fs.readFileSync(path.join(f.root,'video-studio',d.id+'.json'),'utf8'),before=record()
  for(const mutate of [(v:VideoDraft)=>{v.title='伪造编辑'},(v:VideoDraft)=>{v.scenes[0].imageArtifactId='other.png'},(v:VideoDraft)=>{v.scenes[0].captions=[{startSeconds:0,endSeconds:1,text:'新增审核',translationText:'fake',translationOrigin:'user-edited'}]},(v:VideoDraft)=>{v.scenes[0].speechAnchors={scriptText:'伪造审核',scriptSha256:'a'.repeat(64),audioArtifactId:'fake.wav',audioSha256:'b'.repeat(64),durationSeconds:1,createdAt:new Date().toISOString(),capturedRevision:1,timeDomain:'audio-file-seconds',origin:'user-edited',anchors:[]}}]){
   const fake=structuredClone(d);mutate(fake);await assert.rejects(service.execute({...request,draft:fake},undefined,owner),/STUDIO_SNAPSHOT_INVALID/);assert.equal(record(),before)
  }
  await assert.rejects(service.execute({...request,expectedRevision:d.revision+1},undefined,owner),/STUDIO_CONFLICT/)
  await assert.rejects(service.execute(request,undefined,{...owner,sessionId:'foreign-session'}),/STUDIO_SESSION_MISMATCH/)
  project={...project,id:'another-project'};await assert.rejects(service.execute(request,undefined,{...owner,projectId:project.id}),/STUDIO_SNAPSHOT_INVALID/);project={...project,id:owner.projectId}
  await assert.rejects(new VideoStudioService(kernel).execute(request,undefined,owner),/STUDIO_SNAPSHOT_INVALID/)
  const aborted=new AbortController();aborted.abort(new Error('Cancel restore'));await assert.rejects(service.execute(request,aborted.signal,owner),/Cancel restore/)
  assert.throws(()=>assertStudioRequest({...request,sceneId:'injected'}),/Unsupported Studio/);assert.throws(()=>assertStudioRequest({...request,operation:'update'}),/snapshotProof requires restore/)
  assert.equal(record(),before)
 }finally{f.close()}
})

test('Unsegmented source bindings never adopt scene IDs and anonymous replacement needs approved history',async()=>{
 const f=fixture();try{
  const owner={projectId:'identity-project',sessionId:'fixture-session'},service=new VideoStudioService({projectStore:{active:()=>({id:owner.projectId,name:'Identity',directory:f.root})}} as unknown as StudioKernel)
  let d=sceneDraft(f.store,'原单画面');Object.assign(d.scenes[0],{videoArtifactId:'source.webm',sourceDurationSeconds:8,captions:[{startSeconds:0,endSeconds:5,text:'原字幕',translationText:'人工译文'}]});d=f.store.update(d.id,d.revision,d,false,true)
  d=f.store.setSourceSpeech(d.id,d.revision,'first-scene',s=>{s.sourceCaptionBinding={sourceArtifactId:'source.webm',sourceSha256:'a'.repeat(64),segmentIndex:0,clock:sourceCaptionClock(s,0),origin:'user-edited',sourceRange:{startSeconds:0,endSeconds:8},sourceCues:structuredClone(s.captions!)}})
  const binding=structuredClone(d.scenes[0].sourceCaptionBinding);d.scenes[0].title='无关改名';d=f.store.update(d.id,d.revision,d);assert.deepEqual(d.scenes[0].sourceCaptionBinding,binding);assert.equal(d.scenes[0].sourceCaptionBinding!.visualSegmentId,undefined)
  const original=structuredClone(d),approved=await service.execute({operation:'list'},undefined,owner) as {snapshotProofs:Record<string,string>}
  const split=splitStudioMain(d,{sceneId:'first-scene',kind:'visual',index:0},1.37);d=f.store.update(d.id,d.revision,split.draft);assert.ok(d.scenes[0].sourceCaptionBinding!.visualSegmentId)
  const replaced=f.store.update(d.id,d.revision,{...d,scenes:original.scenes},false,true);assert.equal(sourceCaptionsStale(replaced.scenes[0]),true,'Deleting a real clip identity cannot adopt anonymous same-file footage')
  const restored=await service.execute({operation:'restore',draftId:d.id,expectedRevision:replaced.revision,draft:original,snapshotProof:approved.snapshotProofs[d.id]},undefined,owner,'user') as VideoDraft;assert.equal(sourceCaptionsStale(restored.scenes[0]),false);assert.deepEqual(restored.scenes,original.scenes)
 }finally{f.close()}
})

test('Explicit silent narration pieces retain source binding and manual captions without implicit replay',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Silent cut'),scene=draft.scenes[0]
  Object.assign(scene,{durationSeconds:3,imageArtifactId:'frame.png',narration:'原始旁白。',audioText:'原始旁白。',audioArtifactId:'voice.wav',audioDurationSeconds:2,audioGeneration:{kind:'imported'},voiceSegments:[],captions:[{startSeconds:0,endSeconds:1,text:'独立字幕',translationText:'Manual',translationOrigin:'user-edited'}]})
  draft=f.store.update(draft.id,draft.revision,draft,true,true);scene=draft.scenes[0]
  assert.deepEqual(narrationWindows(scene,2),[]);assert.deepEqual(narrationSceneRanges(scene,0,2),[])
  assert.deepEqual(estimatedCaptionCues(scene,640,360,2),[])
  assert.throws(()=>narrationWindow(scene,2),/具体旁白/)
  assert.equal(narrationSceneDuration(scene,2,24),1);assert.deepEqual(draftComposition(draft).scenes[0].voiceSegments,[])
  const edited=structuredClone(draft);delete edited.scenes[0].voiceSegments;edited.scenes[0].visualBrief='新画面'
  draft=f.store.update(draft.id,draft.revision,edited);assert.deepEqual(draft.scenes[0].voiceSegments,[]);assert.equal(draft.scenes[0].audioArtifactId,'voice.wav');assert.equal(draft.scenes[0].captions![0].translationOrigin,'user-edited')
 }finally{f.close()}
})

test('Raw Studio updates cannot mint or reset a host presentation origin',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'Clock boundary');const clock={originId:'origin',startSeconds:0,durationSeconds:8,musicIndex:1,sceneNumber:1,sceneCount:1}
  draft.scenes[0].presentationWindow=clock;draft=f.store.update(draft.id,draft.revision,draft);assert.equal(draft.scenes[0].presentationWindow,undefined)
  const approved=structuredClone(draft);approved.scenes[0].presentationWindow=clock;draft=f.store.restoreSnapshot(draft.id,draft.revision,approved)
  const edited=structuredClone(draft);edited.scenes[0].presentationWindow={...clock,startSeconds:7,durationSeconds:15};edited.scenes[0].title='合法改名'
  draft=f.store.update(draft.id,draft.revision,edited);assert.deepEqual(draft.scenes[0].presentationWindow,clock);assert.equal(draft.scenes[0].title,'合法改名')
  const before=f.store.read(draft.id);edited.scenes[0].durationSeconds=9;edited.revision=draft.revision;assert.throws(()=>f.store.update(draft.id,draft.revision,edited),/original presentation clock/);assert.deepEqual(f.store.read(draft.id),before)
 }finally{f.close()}
})

test('Whole-scene split partitions eight visuals directly, freezes original chapters and preserves complete bilingual text',()=>{
 const f=fixture();try{
  let d=sceneDraft(f.store,'Whole cut');d.scenes[0].durationSeconds=8;d.scenes[0].endPolicy='hold';d.scenes[0].narration='Full original script';d.scenes[0].visualSegments=Array.from({length:8},(_,i)=>({id:'visual-'+i,imageArtifactId:'frame.png',durationSeconds:1,sourceStartSeconds:0,playbackRate:1,zoom:1.3,transition:'fade',transitionSeconds:.2}));d.scenes[0].captions=[{startSeconds:2,endSeconds:6,text:'Full original caption',translationText:'完整人工译文',translationOrigin:'user-edited'}];d.scenes.push({...newStudioScene('following'),durationSeconds:2});d=f.store.update(d.id,d.revision,d,false,true)
  const result=f.store.splitScene(d.id,d.revision,d.scenes[0].id,3.4),[a,b,c]=result.draft.scenes
  assert.equal(a.visualSegments!.length,4);assert.equal(b.visualSegments!.length,5);assert.equal(a.visualSegments![3].id,'visual-3');assert.notEqual(b.visualSegments![0].id,'visual-3');assert.equal(b.visualSegments![1].id,'visual-4');assert.equal(b.visualSegments![0].effectWindow!.originId,a.visualSegments![3].effectWindow!.originId);assert.ok(Math.abs(b.visualSegments![0].effectWindow!.startSeconds-.4)<1e-6)
  assert.deepEqual(result.selection,{sceneId:b.id,kind:'scene'});assert.equal(a.narration,b.narration);assert.equal(a.captions![0].text,b.captions![0].text);assert.equal(b.captions![0].translationOrigin,'user-edited');assert.equal(b.captions![0].startSeconds,0);assert.equal(c.presentationWindow!.sceneNumber,2);assert.equal(c.presentationWindow!.sceneCount,2);assert.equal(b.presentationWindow!.startSeconds,3.4)
  for(const time of [.1,2.5,3.39,3.4,3.8,4.2,7.9]){const before=visualAtTime(d.scenes[0],time)!,after=visualAtTime(time<3.4?a:b,time<3.4?time:time-3.4)!;assert.ok(Math.abs(before.opacity-after.opacity)<1e-6);assert.ok(Math.abs(visualZoom(before.segment,before.localSeconds)-visualZoom(after.segment,after.localSeconds))<1e-6)}
  assert.equal(result.draft.revision,d.revision+1);assert.throws(()=>f.store.splitScene(d.id,d.revision,a.id,1),/STUDIO_CONFLICT/)
 }finally{f.close()}
})
test('Whole-scene split preserves silent prefixes, exact voice source intervals and original audio receipts through repeated cuts',()=>{
 const f=fixture();try{
  let d=sceneDraft(f.store,'Voice cut');Object.assign(d.scenes[0],{durationSeconds:6,imageArtifactId:'frame.png',narration:'Complete text',audioText:'Complete text',audioArtifactId:'voice.wav',audioDurationSeconds:3,audioGeneration:{kind:'imported'},voiceTiming:{startSeconds:2,sourceStartSeconds:0,durationSeconds:3,playbackRate:1},endPolicy:'hold'});d=f.store.update(d.id,d.revision,d)
  let result=f.store.splitScene(d.id,d.revision,d.scenes[0].id,1.3);assert.deepEqual(result.draft.scenes[0].voiceSegments,[]);assert.equal(result.draft.scenes[1].voiceSegments![0].startSeconds,.7)
  result=f.store.splitScene(d.id,result.draft.revision,result.selection.sceneId,2.2);const [silent,a,b]=result.draft.scenes
  assert.equal(silent.audioDurationSeconds,3);assert.ok(Math.abs(a.voiceSegments![0].durationSeconds-1.5)<1e-6);assert.ok(Math.abs(b.voiceSegments![0].sourceStartSeconds-1.5)<1e-6);assert.ok(Math.abs(b.presentationWindow!.startSeconds-3.5)<1e-6);assert.equal(b.presentationWindow!.originId,a.presentationWindow!.originId);assert.equal(sceneCoverage(b).audioStale,false);assert.equal(draftComposition(result.draft).scenes.length,3)
  const edited=structuredClone(result.draft);edited.scenes[2].audioArtifactId='new.wav';edited.scenes[2].audioDurationSeconds=5;edited.scenes[2].durationSeconds=6;fitVisualSegments(edited.scenes[2].visualSegments!,6);delete edited.scenes[2].voiceSegments;const newVoice=f.store.update(d.id,edited.revision,edited,true);assert.equal(newVoice.scenes[2].presentationWindow!.startSeconds,0);assert.equal(newVoice.scenes[2].presentationWindow!.durationSeconds,6);assert.notEqual(newVoice.scenes[2].presentationWindow!.originId,b.presentationWindow!.originId)
 }finally{f.close()}
})
test('Whole-scene local layer split retains locked easing, fades and audio source clocks while global tracks stay exact',()=>{
 const f=fixture();try{
  let d=sceneDraft(f.store,'Objects');d.scenes[0].durationSeconds=6;const visual=assertVisualLayers([{id:'local',title:'Locked animation',kind:'rectangle',startSeconds:1,durationSeconds:4,x:.1,y:.1,width:.2,height:.2,color:'#33bb66',locked:true,fadeInSeconds:1,fadeOutSeconds:1,keyframes:[{timeSeconds:0,x:.1,y:.1,width:.2,height:.2,opacity:.4,easing:'linear'},{timeSeconds:4,x:.6,y:.4,width:.2,height:.2,opacity:1,easing:'ease-in-out'}]}])[0];d.scenes[0].layers=[visual];d.scenes[0].audioTracks=assertAudioLayers([{id:'local-audio',title:'Audio',artifactId:'tone.wav',startSeconds:1,durationSeconds:4,sourceStartSeconds:2,playbackRate:.5,volume:.3,fadeInSeconds:1,fadeOutSeconds:1,locked:true}]);d.audioTracks=assertAudioLayers([{id:'global',title:'Global',artifactId:'tone.wav',startSeconds:.3,durationSeconds:5,volume:.2}]);d=f.store.update(d.id,d.revision,d)
  const result=f.store.splitScene(d.id,d.revision,d.scenes[0].id,2.37),[a,b]=result.draft.scenes
  assert.deepEqual(result.draft.audioTracks,d.audioTracks);assert.equal(a.layers![0].locked,true);assert.equal(b.layers![0].locked,true);assert.equal(b.layers![0].startSeconds,0);assert.ok(Math.abs(b.audioTracks![0].sourceStartSeconds-2.685)<1e-6);assert.notEqual(a.layers![0].id,b.layers![0].id)
  for(const t of [.05,1,1.36,1.37,1.6,2.8,3.95]){const piece=t<1.37?a.layers![0]:b.layers![0],old=visualLayerBox(visual,t),next=visualLayerBox(piece,t<1.37?t:t-1.37);for(const k of ['x','y','width','height','opacity'] as const)assert.ok(Math.abs(old[k]-next[k])<1e-6,k+' '+t)}
 }finally{f.close()}
})
test('Whole-scene admission rejects spoofed payloads, unmeasured/bound speech and tiny fragments without changing saved bytes',()=>{
 const base={operation:'split-scene',draftId:'draft',expectedRevision:2,sceneId:'scene',splitSeconds:1.7};assert.equal(assertStudioRequest(base).splitSeconds,1.7)
 for(const extra of [{draft:{}},{snapshotProof:'f'.repeat(64)},{splitSeconds:NaN},{splitSeconds:Infinity},{splitSeconds:0},{splitSeconds:60},{sourceCues:[]}])assert.throws(()=>assertStudioRequest({...base,...extra}));assert.throws(()=>assertStudioRequest({operation:'read',draftId:'draft',splitSeconds:1}))
 const f=fixture();try{
  let d=sceneDraft(f.store,'Atomic reject');d=f.store.update(d.id,d.revision,d);const before=fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8');for(const cut of [NaN,Infinity,.9,7.1])assert.throws(()=>f.store.splitScene(d.id,d.revision,d.scenes[0].id,cut));assert.throws(()=>new VideoStudioStore(f.root,'foreign').splitScene(d.id,d.revision,d.scenes[0].id,2),/STUDIO_SESSION_MISMATCH/);assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),before)
  d.scenes[0].audioArtifactId='voice.wav';d=f.store.update(d.id,d.revision,d);assert.throws(()=>f.store.splitScene(d.id,d.revision,d.scenes[0].id,2),/测量/)
  d.scenes[0].audioDurationSeconds=1;d.scenes[0].speechCaptions=true;d=f.store.update(d.id,d.revision,d);const bound=fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8');assert.throws(()=>f.store.splitScene(d.id,d.revision,d.scenes[0].id,2),/STUDIO_SPEECH_STALE/);assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),bound)
 }finally{f.close()}
})
test('Whole-scene host operation shares owner/CAS/cancellation and sends one notification only after the atomic write',async()=>{
 const f=fixture();try{
  let d=sceneDraft(f.store,'Host split');d=f.store.update(d.id,d.revision,d);let changed=0
  const service=new VideoStudioService({projectStore:{active:()=>({id:'p',name:'Project',directory:f.root})},execute:async()=>({}),videoStudioChanged:()=>{changed++;assert.equal(f.store.read(d.id).scenes.length,2)},recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>({})}}),owner={projectId:'p',sessionId:'fixture-session'},request={operation:'split-scene',draftId:d.id,expectedRevision:d.revision,sceneId:d.scenes[0].id,splitSeconds:2},abort=new AbortController();abort.abort(new Error('Stop'))
  await assert.rejects(service.execute(request,abort.signal,owner),/Stop/);assert.equal(changed,0);await assert.rejects(service.execute(request,undefined,{...owner,sessionId:'foreign'}),/STUDIO_SESSION_MISMATCH/);assert.equal(changed,0)
  const result=await service.execute(request,undefined,owner) as {draft:VideoDraft};assert.equal(result.draft.scenes.length,2);assert.equal(changed,1);await assert.rejects(service.execute(request,undefined,owner),/STUDIO_CONFLICT/);assert.equal(changed,1)
 }finally{f.close()}
})

test('Whole-scene rejects tiny visual cuts, invalid local objects, held-source cuts and global object overflow atomically',()=>{
 const f=fixture();try{
  let d=sceneDraft(f.store,'Bounds');d.scenes[0].durationSeconds=4;d.scenes[0].visualSegments=Array.from({length:4},(_,i)=>({id:'tiny-'+i,imageArtifactId:'frame.png',durationSeconds:1,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.2}));d=f.store.update(d.id,d.revision,d);let before=fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8');assert.throws(()=>f.store.splitScene(d.id,d.revision,d.scenes[0].id,2.05),/0.1/);assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),before)
  d.scenes[0].audioTracks=assertAudioLayers([{id:'outside',title:'Outside',artifactId:'tone.wav',startSeconds:3,durationSeconds:2}]);d=f.store.update(d.id,d.revision,d);before=fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8');assert.throws(()=>f.store.splitScene(d.id,d.revision,d.scenes[0].id,2),/STUDIO_SPLIT_BOUNDS/);assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),before)
  d.scenes[0].audioTracks=[];delete d.scenes[0].visualSegments;Object.assign(d.scenes[0],{videoArtifactId:'short.mp4',sourceDurationSeconds:1,endPolicy:'hold'});d=f.store.update(d.id,d.revision,d);before=fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8');assert.throws(()=>f.store.splitScene(d.id,d.revision,d.scenes[0].id,2),/STUDIO_SPLIT_HOLD/);assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),before)
  delete d.scenes[0].videoArtifactId;delete d.scenes[0].sourceDurationSeconds;d.scenes=Array.from({length:8},(_,i)=>({...newStudioScene('budget-scene-'+i),durationSeconds:4,audioTracks:assertAudioLayers(Array.from({length:8},(_,j)=>({id:'budget-'+i+'-'+j,title:'Bounded audio',artifactId:'tone.wav',startSeconds:0,durationSeconds:4})))}));d=f.store.update(d.id,d.revision,d);before=fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8');assert.throws(()=>f.store.splitScene(d.id,d.revision,d.scenes[0].id,2),/sixty-four/);assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),before)
 }finally{f.close()}
})

function boundVoiceFixture(f:ReturnType<typeof fixture>,image=true):VideoDraft {
 let d=sceneDraft(f.store,'Bound whole cut');const scene=d.scenes[0];Object.assign(scene,{durationSeconds:6,narration:'完整的一句。',audioText:'完整的一句。',audioArtifactId:'voice.wav',audioDurationSeconds:3,voiceTiming:{startSeconds:1.5,sourceStartSeconds:0,durationSeconds:3,playbackRate:1},endPolicy:'hold',speechCaptions:true});if(image)scene.imageArtifactId='frame.png';else scene.bullets=['第一条','第二条']
 d=f.store.update(d.id,d.revision,d);return f.store.setSpeech(d.id,d.revision,scene.id,'anchors',{scriptText:scene.narration,scriptSha256:'a'.repeat(64),audioArtifactId:'voice.wav',audioSha256:'b'.repeat(64),durationSeconds:3,createdAt:new Date().toISOString(),capturedRevision:d.revision,timeDomain:'audio-file-seconds',origin:'user-edited',anchors:[{id:'whole-anchor',scriptStart:0,scriptEnd:scene.narration.length,startSeconds:.3,endSeconds:2.7}]})
}
test('Bound whole-scene split retains original sentence/focus clocks, silent pieces and exact reviewed anchors across repeated cuts',()=>{
 const f=fixture();try{
  let d=boundVoiceFixture(f);d.scenes[0].speechLinks={bullets:[],focus:[{anchorId:'whole-anchor',visualIndex:0,artifactId:'frame.png',x:.6,y:.4,zoom:2,emphasize:true}]};d=f.store.update(d.id,d.revision,d);const original=structuredClone(d),originalFocus=speechScene(d.scenes[0]).focusIntervals!
  let result=f.store.splitScene(d.id,d.revision,d.scenes[0].id,1.2);assert.deepEqual(result.draft.scenes[0].voiceSegments,[]);assert.deepEqual(speechCaptionCues(result.draft.scenes[0]),[]);assert.equal(result.draft.scenes[0].captions,undefined)
  result=f.store.splitScene(d.id,result.draft.revision,result.selection.sceneId,2.1)
  let offset=0;for(const child of result.draft.scenes){assert.deepEqual(child.speechAnchors,original.scenes[0].speechAnchors);assert.equal(child.speechPlaybackOrigin!.voiceSegments[0].startSeconds,1.5);const projected=speechScene(child),focus=projected.visualSegments![0].focusIntervals??[];if(offset<4.2&&offset+child.durationSeconds>1.8)assert.deepEqual(focus,originalFocus);for(const cue of speechCaptionCues(child)){assert.equal(cue.text,original.scenes[0].narration);assert.ok(cue.startSeconds>=0&&cue.endSeconds<=child.durationSeconds)}offset+=child.durationSeconds}
  assert.equal(draftComposition(result.draft).scenes.length,3)
  const changed=structuredClone(result.draft);changed.scenes[1].voiceSegments![0].startSeconds+=.1;changed.scenes[1].voiceSegments![0].durationSeconds-=.1;assert.throws(()=>speechScene(changed.scenes[1]),/STUDIO_SPEECH_ORIGIN/)
  const normal=structuredClone(result.draft);normal.scenes[1].speechPlaybackOrigin!.clock='forged';normal.scenes[1].title='Title edit';const saved=f.store.update(d.id,result.draft.revision,normal);assert.deepEqual(saved.scenes[1].speechPlaybackOrigin,result.draft.scenes[1].speechPlaybackOrigin)
 }finally{f.close()}
})
test('Bound title-card cuts retain original bullet reveal times even in silent prefix and following suffix',()=>{
 const f=fixture();try{
  let d=boundVoiceFixture(f,false);d.scenes[0].speechLinks={focus:[],bullets:[{anchorId:'whole-anchor',bulletIndex:1,text:'第二条'}]};d=f.store.update(d.id,d.revision,d);const reveal=speechScene(d.scenes[0]).bulletRevealSeconds
  let result=f.store.splitScene(d.id,d.revision,d.scenes[0].id,1.2);result=f.store.splitScene(d.id,result.draft.revision,result.selection.sceneId,3.5)
  for(const scene of result.draft.scenes){assert.deepEqual(speechScene(scene).bulletRevealSeconds,reveal);assert.deepEqual(scene.speechAnchors,d.scenes[0].speechAnchors)}
 }finally{f.close()}
})
test('Bound source captions partition trusted roots, hidden reviewed cues, edited translation and independent out-of-group cues',()=>{
 const f=fixture();try{
  let d=sceneDraft(f.store,'Source whole cut');d.scenes[0].durationSeconds=6;d.scenes[0].visualSegments=[{id:'prefix',imageArtifactId:'frame.png',durationSeconds:1,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.2},{id:'reviewed',videoArtifactId:'source.mp4',durationSeconds:4,sourceStartSeconds:2,playbackRate:1,zoom:1,sourceDurationSeconds:8,keepSourceAudio:true,transition:'cut',transitionSeconds:.2},{id:'suffix',imageArtifactId:'frame.png',durationSeconds:1,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.2}];d=f.store.update(d.id,d.revision,d)
  d=f.store.setSourceSpeech(d.id,d.revision,d.scenes[0].id,scene=>{scene.sourceSpeech={sourceArtifactId:'source.mp4',sourceSha256:'a'.repeat(64),evidenceArtifactId:'source.json',evidenceSha256:'b'.repeat(64),durationSeconds:8,segmentIndex:1,createdAt:new Date().toISOString()};scene.sourceCaptionBinding={sourceArtifactId:'source.mp4',sourceSha256:'a'.repeat(64),segmentIndex:1,visualSegmentId:'reviewed',clock:sourceCaptionClock(scene,1),origin:'user-edited',sourceRange:{startSeconds:0,endSeconds:8},sourceCues:[{startSeconds:.2,endSeconds:1,text:'Hidden before'},{startSeconds:2.2,endSeconds:5.8,text:'Whole source sentence',translationText:'完整人工译文',translationOrigin:'user-edited'},{startSeconds:6.2,endSeconds:7,text:'Hidden after'}]};scene.captions=[{startSeconds:.1,endSeconds:.8,text:'Independent prefix'},{startSeconds:1.2,endSeconds:4.8,text:'Whole source sentence',translationText:'完整人工译文',translationOrigin:'user-edited'},{startSeconds:5.2,endSeconds:5.8,text:'Independent suffix'}]})
  const original=structuredClone(d);let result=f.store.splitScene(d.id,d.revision,d.scenes[0].id,3.3)
  for(const scene of result.draft.scenes){assert.equal(sourceCaptionsStale(scene),false);assert.deepEqual(scene.sourceCaptionBinding!.sourceRange,original.scenes[0].sourceCaptionBinding!.sourceRange);assert.deepEqual(scene.sourceCaptionBinding!.sourceCues,original.scenes[0].sourceCaptionBinding!.sourceCues);assert.equal(scene.sourceSpeech!.evidenceSha256,'b'.repeat(64));assert.equal(scene.captions!.find(c=>c.text==='Whole source sentence')!.translationOrigin,'user-edited')}
  result=f.store.splitScene(d.id,result.draft.revision,result.selection.sceneId,1.7)
  const suffix=result.draft.scenes[2];assert.equal(suffix.sourceCaptionBinding,undefined);assert.equal(suffix.sourceSpeech,undefined);assert.equal(suffix.captions!.length,1);assert.equal(suffix.captions![0].text,'Independent suffix');assert.ok(Math.abs(suffix.captions![0].startSeconds-.2)<1e-6);assert.ok(Math.abs(suffix.captions![0].endSeconds-.8)<1e-6);assert.equal(sourceCaptionsStale(result.draft.scenes[1]),false)
 }finally{f.close()}
})
test('Whole-scene source binding rejects ambiguous crossing captions or stale identities before writing',()=>{
 const f=fixture();try{
  let d=sceneDraft(f.store,'Reject source');d.scenes[0].durationSeconds=4;d.scenes[0].visualSegments=[{id:'prefix',imageArtifactId:'frame.png',durationSeconds:1,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.2},{id:'source',videoArtifactId:'source.mp4',durationSeconds:3,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.2}];d=f.store.update(d.id,d.revision,d);d=f.store.setSourceSpeech(d.id,d.revision,d.scenes[0].id,scene=>{scene.sourceCaptionBinding={sourceArtifactId:'source.mp4',sourceSha256:'a'.repeat(64),segmentIndex:1,visualSegmentId:'source',clock:sourceCaptionClock(scene,1),origin:'user-edited'};scene.captions=[{startSeconds:.5,endSeconds:2,text:'Ambiguous cross-boundary'}]});const before=fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8');assert.throws(()=>f.store.splitScene(d.id,d.revision,d.scenes[0].id,2),/STUDIO_SOURCE_REBIND_CONFLICT/);assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),before)
  d=f.store.setSourceSpeech(d.id,d.revision,d.scenes[0].id,scene=>{scene.sourceCaptionBinding!.clock='stale';scene.captions=[]});const stale=fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8');assert.throws(()=>f.store.splitScene(d.id,d.revision,d.scenes[0].id,2),/STUDIO_SOURCE_SPEECH_STALE/);assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),stale)
 }finally{f.close()}
})

test('Bound split consumption rechecks actual source/voice hashes and preserves cancellation and CAS after asynchronous reads',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.root,'artifacts','voice.wav'),'guard-byte-fixture');let d=boundVoiceFixture(f),record=structuredClone(d.scenes[0].speechAnchors!),sha=(v:Buffer|string)=>crypto.createHash('sha256').update(v).digest('hex');record.scriptSha256=sha(d.scenes[0].narration);record.audioSha256=sha(fs.readFileSync(path.join(f.root,'artifacts','voice.wav')));d=f.store.setSpeech(d.id,d.revision,d.scenes[0].id,'anchors',record)
  let notified=0;const service=new VideoStudioService({projectStore:{active:()=>({id:'p',name:'Project',directory:fs.realpathSync(f.root)})},execute:async()=>({}),videoStudioChanged:()=>{notified++},recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>({})}}),owner={projectId:'p',sessionId:'fixture-session'},request=()=>({operation:'split-scene',draftId:d.id,expectedRevision:d.revision,sceneId:d.scenes[0].id,splitSeconds:2.7}),raw=()=>fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8')
  let before=raw();fs.writeFileSync(path.join(f.root,'artifacts','voice.wav'),'replaced');await assert.rejects(service.execute(request(),undefined,owner),/STUDIO_SPEECH_STALE/);assert.equal(raw(),before);assert.equal(notified,0);fs.writeFileSync(path.join(f.root,'artifacts','voice.wav'),'guard-byte-fixture')
  const cancel=new AbortController(),cancelled=service.execute(request(),cancel.signal,owner);cancel.abort(new Error('Stop during hash read'));await assert.rejects(cancelled,/Stop during hash read/);assert.equal(raw(),before);assert.equal(notified,0)
  const pending=service.execute(request(),undefined,owner);const newer=structuredClone(d);newer.scenes[0].title='Concurrent edit';d=f.store.update(d.id,d.revision,newer);before=raw();await assert.rejects(pending,/STUDIO_CONFLICT/);assert.equal(raw(),before);assert.equal(notified,0)
  const result=await service.execute(request(),undefined,owner) as {draft:VideoDraft};assert.equal(result.draft.scenes.length,2);assert.equal(notified,1)
  d=result.draft;fs.writeFileSync(path.join(f.root,'artifacts','guard-source.mp4'),'source-byte-fixture');const visual=d.scenes[0].visualSegments![0];delete visual.imageArtifactId;visual.videoArtifactId='guard-source.mp4';visual.sourceDurationSeconds=10;d=f.store.update(d.id,d.revision,d);d=f.store.setSourceSpeech(d.id,d.revision,d.scenes[0].id,scene=>{scene.sourceCaptionBinding={sourceArtifactId:'guard-source.mp4',sourceSha256:sha('source-byte-fixture'),segmentIndex:0,visualSegmentId:scene.visualSegments![0].id,clock:sourceCaptionClock(scene,0),origin:'user-edited',sourceRange:{startSeconds:0,endSeconds:2.7},sourceCues:[]};scene.captions=[]});before=raw();fs.writeFileSync(path.join(f.root,'artifacts','guard-source.mp4'),'source-replaced');await assert.rejects(service.execute(request(),undefined,owner),/STUDIO_SOURCE_SPEECH_STALE/);assert.equal(raw(),before);assert.equal(notified,1)
 }finally{f.close()}
})
test('Explicit host sentence correction rebases changed playback origin; raw edits cannot mint/reset it and new audio clears it',async()=>{
 const f=fixture();try{
  let d=boundVoiceFixture(f);const split=f.store.splitScene(d.id,d.revision,d.scenes[0].id,2.7);d=split.draft;const originalOrigin=structuredClone(d.scenes[1].speechPlaybackOrigin!),changed=structuredClone(d);changed.scenes[1].voiceSegments![0].startSeconds=.1;changed.scenes[1].voiceSegments![0].durationSeconds-=.1;d=f.store.update(d.id,d.revision,changed);assert.throws(()=>speechCaptionCues(d.scenes[1]),/STUDIO_SPEECH_ORIGIN/)
  fs.writeFileSync(path.join(f.root,'artifacts','voice.wav'),'corrected-byte-fixture');const service=new VideoStudioService({projectStore:{active:()=>({id:'p',name:'Project',directory:fs.realpathSync(f.root)})},execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>({durationSeconds:3,tracks:[{type:'audio',canDecode:true}]})}});const corrected=await service.execute({operation:'correct-speech',draftId:d.id,expectedRevision:d.revision,sceneId:d.scenes[1].id,anchors:d.scenes[1].speechAnchors!.anchors},undefined,{projectId:'p',sessionId:'fixture-session'},'user') as {draft:VideoDraft};d=corrected.draft;assert.notEqual(d.scenes[1].speechPlaybackOrigin!.clock,originalOrigin.clock);assert.doesNotThrow(()=>speechCaptionCues(d.scenes[1]));const captured=structuredClone(d.scenes[1].speechPlaybackOrigin)
  const omitted=structuredClone(d);delete omitted.scenes[1].audioArtifactId;delete omitted.scenes[1].speechPlaybackOrigin;d=f.store.update(d.id,d.revision,omitted);assert.deepEqual(d.scenes[1].speechPlaybackOrigin,captured)
  const next=structuredClone(d);next.scenes[1].audioArtifactId='new.wav';next.scenes[1].audioText=next.scenes[1].narration;next.scenes[1].audioDurationSeconds=2;delete next.scenes[1].voiceSegments;d=f.store.update(d.id,d.revision,next,true);assert.equal(d.scenes[1].speechPlaybackOrigin,undefined)
  const fresh=sceneDraft(f.store,'Cannot mint');fresh.scenes[0].audioArtifactId='voice.wav';fresh.scenes[0].audioDurationSeconds=3;fresh.scenes[0].presentationWindow={originId:'forged',startSeconds:0,durationSeconds:8,musicIndex:1,sceneNumber:1,sceneCount:1};fresh.scenes[0].speechPlaybackOrigin={clock:'forged',voiceSegments:[]};const saved=f.store.update(fresh.id,fresh.revision,fresh);assert.equal(saved.scenes[0].speechPlaybackOrigin,undefined);assert.equal(saved.scenes[0].presentationWindow,undefined)
 }finally{f.close()}
})

function reviewFixture(){const f=fixture();let notifications=0;const owner={projectId:'review-project',sessionId:'fixture-session'},service=new VideoStudioService({projectStore:{active:()=>({id:owner.projectId,name:'Review',directory:f.root})},videoStudioChanged:()=>notifications++} as unknown as StudioKernel);let draft=sceneDraft(f.store,'Review');draft.scenes[0].title='原始标题';draft.scenes[0].narration='原始旁白';draft=f.store.update(draft.id,draft.revision,draft);return {...f,draft,owner,service,notifications:()=>notifications,execute:(raw:unknown,actor:'user'|'agent'='agent',signal?:AbortSignal)=>service.execute(raw,signal,owner,actor) as Promise<VideoDraft>}}
function reviewRequest(draft:VideoDraft,field:'title'|'narration'|'visualBrief'='title',after='改进标题'){return {operation:'propose-review',draftId:draft.id,expectedRevision:draft.revision,reviewProposal:{sceneId:draft.scenes[0].id,field,before:draft.scenes[0][field],after,reason:'依据当前脚本提出的建议；事实仍需核对。',seconds:.5}}}
test('Experimental review persists bounded proposals as host-owned journals without editing film or accepting raw journal forgery',async()=>{
 const f=reviewFixture();try{const before=structuredClone(f.draft),proposed=await f.execute(reviewRequest(before));assert.equal(proposed.revision,before.revision+1);assert.equal(f.notifications(),1);assert.equal(sameStudioDraftContent(before,proposed),true);assert.deepEqual(proposed.scenes,before.scenes);assert.deepEqual(new VideoStudioStore(f.root,'fixture-session').read(before.id),proposed);assert.equal(proposed.reviewItems[0].origin,'agent');assert.equal(proposed.reviewItems[0].status,'pending');const raw=structuredClone(proposed);raw.reviewItems=[];raw.scenes[0].visualBrief='独立人工修改';const updated=f.store.update(raw.id,raw.revision,raw);assert.deepEqual(updated.reviewItems,proposed.reviewItems);const restored=f.store.restoreSnapshot(updated.id,updated.revision,before);assert.deepEqual(restored.reviewItems,proposed.reviewItems);assert.equal(restored.scenes[0].visualBrief,before.scenes[0].visualBrief)}finally{f.close()}
})
test('Review adoption and selective undo retain unrelated edits, generated voice, bilingual captions and export journals',async()=>{
 const f=reviewFixture();try{let draft=f.store.update(f.draft.id,f.draft.revision,{...f.draft,scenes:f.draft.scenes.map(s=>({...s,audioArtifactId:'speech.wav',audioText:s.narration,audioDurationSeconds:1,captions:[{startSeconds:0,endSeconds:1,text:'人工原文',translationText:'Human translation',translationOrigin:'user-edited'}]}))},true,true);draft=await f.execute(reviewRequest(draft,'narration','改进旁白'));const item=draft.reviewItems[0];const voice=structuredClone(draft.scenes[0]),before=draft;draft=await f.execute({operation:'adopt-review',draftId:draft.id,expectedRevision:draft.revision,reviewId:item.id},'user');assert.equal(draft.scenes[0].narration,item.after);assert.equal(sceneCoverage(draft.scenes[0],draft.tts).audioStale,true);assert.equal(draft.scenes[0].audioArtifactId,voice.audioArtifactId);assert.equal(draft.scenes[0].audioText,voice.audioText);assert.deepEqual(draft.scenes[0].captions,voice.captions);draft.scenes[0].title='期间修改标题';draft=f.store.update(draft.id,draft.revision,draft);const reversed=await f.execute({operation:'undo-review',draftId:draft.id,expectedRevision:draft.revision,reviewId:item.id},'user');assert.equal(reversed.scenes[0].narration,voice.narration);assert.equal(reversed.scenes[0].title,'期间修改标题');assert.deepEqual(reversed.scenes[0].captions,voice.captions);assert.deepEqual(reversed.exports,before.exports);assert.equal(reversed.reviewItems[0].status,'undone');assert.equal(sceneCoverage(reversed.scenes[0],reversed.tts).audioStale,false)}finally{f.close()}
})
test('Review blocks stale field/scene/CAS, unauthorized Agent adoption and cancellation atomically with no notifications',async()=>{
 const f=reviewFixture();try{let draft=await f.execute(reviewRequest(f.draft)),item=draft.reviewItems[0];const command={operation:'adopt-review',draftId:draft.id,expectedRevision:draft.revision,reviewId:item.id};let saved=fs.readFileSync(path.join(f.root,'video-studio',draft.id+'.json'));await assert.rejects(f.execute(command),/STUDIO_REVIEW_USER_REQUIRED/);await assert.rejects(f.execute({...command,expectedRevision:draft.revision-1},'user'),/STUDIO_CONFLICT/);const cancel=new AbortController();cancel.abort(new Error('cancelled-review'));await assert.rejects(f.execute(command,'user',cancel.signal),/cancelled-review/);await assert.rejects(f.service.execute(command,undefined,{...f.owner,sessionId:'foreign-session'},'user'),/STUDIO_SESSION_MISMATCH/);assert.deepEqual(fs.readFileSync(path.join(f.root,'video-studio',draft.id+'.json')),saved);assert.equal(f.notifications(),1);draft.scenes[0].title='用户后来写的标题';draft=f.store.update(draft.id,draft.revision,draft);saved=fs.readFileSync(path.join(f.root,'video-studio',draft.id+'.json'));await assert.rejects(f.execute({...command,expectedRevision:draft.revision},'user'),/STUDIO_REVIEW_STALE/);assert.deepEqual(fs.readFileSync(path.join(f.root,'video-studio',draft.id+'.json')),saved);await assert.rejects(f.execute({...reviewRequest(draft),reviewProposal:{...reviewRequest(draft).reviewProposal,sceneId:'deleted-scene'}}),/STUDIO_REVIEW_STALE/);assert.equal(f.notifications(),1);const ignored=await f.execute({...command,operation:'dismiss-review',expectedRevision:draft.revision},'user');assert.equal(ignored.scenes[0].title,'用户后来写的标题');assert.equal(ignored.reviewItems[0].status,'dismissed')}finally{f.close()}
})
test('Review undo refuses later field edits and deletion; forty-record budget and closed request validation fail without partial writes',async()=>{
 const f=reviewFixture();try{let draft=await f.execute(reviewRequest(f.draft));const item=draft.reviewItems[0];draft=await f.execute({operation:'adopt-review',draftId:draft.id,expectedRevision:draft.revision,reviewId:item.id},'user');draft.scenes[0].title='采纳后的新标题';draft=f.store.update(draft.id,draft.revision,draft);const undo={operation:'undo-review',draftId:draft.id,expectedRevision:draft.revision,reviewId:item.id};await assert.rejects(f.execute(undo,'user'),/STUDIO_REVIEW_STALE/);draft.scenes=[];draft=f.store.update(draft.id,draft.revision,draft);await assert.rejects(f.execute({...undo,expectedRevision:draft.revision},'user'),/STUDIO_REVIEW_STALE/);draft=f.store.restoreSnapshot(draft.id,draft.revision,f.draft);for(let i=1;i<40;i++)draft=await f.execute(reviewRequest(draft,'visualBrief','建议 '+i));const saved=fs.readFileSync(path.join(f.root,'video-studio',draft.id+'.json'));await assert.rejects(f.execute(reviewRequest(draft)),/STUDIO_REVIEW_BUDGET/);assert.deepEqual(fs.readFileSync(path.join(f.root,'video-studio',draft.id+'.json')),saved);for(const proposal of [{...reviewRequest(draft).reviewProposal,field:'audioArtifactId'},{...reviewRequest(draft).reviewProposal,after:'x'.repeat(45)},{...reviewRequest(draft).reviewProposal,html:'<script>'},{...reviewRequest(draft).reviewProposal,seconds:Infinity}])assert.throws(()=>assertStudioRequest({...reviewRequest(draft),reviewProposal:proposal}));assert.throws(()=>assertStudioRequest({...undo,reviewProposal:reviewRequest(draft).reviewProposal}));assert.throws(()=>assertStudioRequest({operation:'read',draftId:draft.id,reviewId:item.id}));assert.throws(()=>assertVideoDraft({...draft,reviewItems:[item,item]}),/Duplicate review/)}finally{f.close()}
})
test('Review Assistant uses the same owned full-film request and only proposes concrete individual suggestions',()=>{const f=reviewFixture();try{assert.equal(studioAssistantRequest({projectId:f.owner.projectId,draftId:f.draft.id,expectedRevision:f.draft.revision,intent:'review'}).intent,'review');const prompt=studioAssistantPrompt(f.draft,'review');assert.match(prompt,/propose-review/);assert.match(prompt,/不得 update 或自行采纳/);assert.match(prompt,/唯一 browser/);assert.match(prompt,/最多提出5条/);assert.throws(()=>studioAssistantRequest({projectId:f.owner.projectId,draftId:f.draft.id,expectedRevision:0,intent:'review'}),/intent or revision/)}finally{f.close()}})

function referenceFixture(){const f=reviewFixture(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=','base64');fs.writeFileSync(path.join(f.root,'artifacts','reference.png'),png);fs.writeFileSync(path.join(f.root,'artifacts','reference.mp4'),Buffer.from('mock-native-video-source'));let index=0,calls=0;const native=async(raw:unknown)=>{calls++;const r=raw as {action:string;artifactId:string;timestampsSeconds:number[]};if(r.action==='media.image.inspect')return {kind:'image',canDecode:true,contentType:'image/png',width:1,height:1,pixels:1,bytes:png.length};if(r.action==='media.inspect')return {durationSeconds:4,firstTimestampSeconds:0,tracks:[{type:'video',canDecode:true,width:1,height:1}]};const create=()=>{const artifactId='reference-fixture-'+(++index)+'.png';fs.writeFileSync(path.join(f.root,'artifacts',artifactId),png);return artifactId};if(r.action==='video.cover')return {artifactId:create(),type:'screenshot',contentType:'image/png',width:640,height:360};if(r.action==='media.frames.sample')return {sourceArtifactId:r.artifactId,type:'frame-set',frames:r.timestampsSeconds.map((t,i)=>({artifactId:create(),outputIndex:i,requestedTimestampSeconds:t,timestampSeconds:t,type:'screenshot',contentType:'image/png',width:1,height:1}))};throw new Error('Unexpected mocked native action')};f.service.kernel.recordingController={processArtifact:native} as StudioKernel['recordingController'];return {...f,png,native,calls:()=>calls,prepare:(draft:VideoDraft=f.store.read(f.draft.id),kind:'image'|'video'='image')=>({operation:'prepare-reference',draftId:draft.id,expectedRevision:draft.revision,artifactId:'reference.'+(kind==='image'?'png':'mp4'),assetKind:kind})}}
function referenceAnalysis(){return {summary:'根据真实返回帧的有限观察，不推断未观察内容。',observations:[{frameIndex:0,description:'样本中的画面观察',adaptation:'为当前视频保留清晰的信息层级'}]}}
test('Reference preparation saves source and frame fingerprints as immutable journals without editing canonical scenes or letting update/restore forge records',async()=>{const f=referenceFixture();try{const before=structuredClone(f.draft),result=await f.service.execute(f.prepare(),undefined,f.owner) as {draft:VideoDraft;reference:import('../src/studio-reference-contract.js').StudioReferenceRecord};assert.equal(sameStudioDraftContent(before,result.draft),true);assert.deepEqual(result.draft.scenes,before.scenes);assert.equal(result.reference.sourceSha256,crypto.createHash('sha256').update(f.png).digest('hex'));assert.equal(result.reference.frames[0].sha256,crypto.createHash('sha256').update(f.png).digest('hex'));assert.equal(result.reference.frames[0].seconds,0);assert.equal(f.notifications(),1);const raw=structuredClone(result.draft);raw.referenceRecords=[];const updated=f.store.update(raw.id,raw.revision,raw);assert.deepEqual(updated.referenceRecords,result.draft.referenceRecords);const restored=f.store.restoreSnapshot(updated.id,updated.revision,before);assert.deepEqual(restored.referenceRecords,result.draft.referenceRecords);assert.deepEqual(new VideoStudioStore(f.root,'fixture-session').read(before.id),restored)}finally{f.close()}})
test('Native reference receipt mismatch and changed source roll back only newly claimed frames and retain old files/draft',async()=>{const f=referenceFixture();try{let result=await f.service.execute(f.prepare(undefined,'video'),undefined,f.owner) as {draft:VideoDraft;reference:import('../src/studio-reference-contract.js').StudioReferenceRecord};assert.deepEqual(result.reference.frames.map(f=>f.requestedSeconds),[0,2,3.6]);const oldFiles=fs.readdirSync(path.join(f.root,'artifacts')).sort(),oldDraft=fs.readFileSync(path.join(f.root,'video-studio',f.draft.id+'.json'));f.service.kernel.recordingController.processArtifact=async raw=>{const result=await f.native(raw);if((raw as {action:string}).action==='media.frames.sample')(result as {frames:{width:number}[]}).frames[0].width=2;return result};await assert.rejects(f.service.execute(f.prepare(result.draft,'video'),undefined,f.owner),/dimensions/);assert.deepEqual(fs.readdirSync(path.join(f.root,'artifacts')).sort(),oldFiles);assert.deepEqual(fs.readFileSync(path.join(f.root,'video-studio',f.draft.id+'.json')),oldDraft);f.service.kernel.recordingController.processArtifact=async raw=>{const result=await f.native(raw);if((raw as {action:string}).action==='media.frames.sample')fs.writeFileSync(path.join(f.root,'artifacts','reference.mp4'),'changed-video');return result};await assert.rejects(f.service.execute(f.prepare(result.draft,'video'),undefined,f.owner),/STUDIO_REFERENCE_STALE/);assert.deepEqual(fs.readdirSync(path.join(f.root,'artifacts')).sort(),oldFiles);assert.equal(fs.readFileSync(path.join(f.root,'artifacts','reference.mp4'),'utf8'),'changed-video');assert.deepEqual(fs.readFileSync(path.join(f.root,'video-studio',f.draft.id+'.json')),oldDraft);assert.equal(f.notifications(),1)}finally{f.close()}})
test('Reference analysis targets actual sampled frames, protects user corrections and requires explicit exact notes adoption while keeping scripts and captions',async()=>{const f=referenceFixture();try{let value=await f.service.execute(f.prepare(),undefined,f.owner) as {draft:VideoDraft;reference:{id:string}},draft=value.draft;const id=value.reference.id,request=()=>({operation:'set-reference-analysis',draftId:draft.id,expectedRevision:draft.revision,referenceId:id,referenceAnalysis:referenceAnalysis()});await assert.rejects(f.service.execute({...request(),referenceAnalysis:{...referenceAnalysis(),observations:[{...referenceAnalysis().observations[0],frameIndex:1}]}},undefined,f.owner),/unsampled frame/);value=await f.service.execute(request(),undefined,f.owner,'user') as typeof value;draft=value.draft;assert.equal(draft.referenceRecords[0].analysisOrigin,'user');await assert.rejects(f.service.execute({...request(),referenceAnalysis:{...referenceAnalysis(),summary:'Agent 覆盖用户文字'}},undefined,f.owner),/STUDIO_REFERENCE_EDITED/);value=await f.service.execute(request(),undefined,f.owner) as typeof value;draft=value.draft;assert.equal(draft.referenceRecords[0].analysisOrigin,'user');draft.preparation.notes='用户制作目标';draft=f.store.update(draft.id,draft.revision,draft);const apply={operation:'apply-reference-notes',draftId:draft.id,expectedRevision:draft.revision,referenceId:id,beforeNotes:draft.preparation.notes};await assert.rejects(f.service.execute(apply,undefined,f.owner),/STUDIO_REFERENCE_USER_REQUIRED/);await assert.rejects(f.service.execute({...apply,beforeNotes:'旧目标'},undefined,f.owner,'user'),/STUDIO_CONFLICT/);value=await f.service.execute(apply,undefined,f.owner,'user') as typeof value;assert.ok(value.draft.preparation.notes.startsWith('用户制作目标'));assert.match(value.draft.preparation.notes,/参考分析（抽样/);assert.deepEqual(value.draft.scenes,draft.scenes);assert.deepEqual(value.draft.exports,draft.exports);fs.appendFileSync(path.join(f.root,'artifacts',value.draft.referenceRecords[0].frames[0].artifactId),'changed');await assert.rejects(f.service.execute({operation:'read-reference',draftId:draft.id,expectedRevision:value.draft.revision,referenceId:id},undefined,f.owner),/STUDIO_REFERENCE_STALE/)}finally{f.close()}})
test('Reference cancellation and concurrent GUI CAS after native completion wait for rollback without orphan frames or overwriting user changes',async()=>{for(const mode of ['cancel','cas'] as const){const f=referenceFixture();try{let began:()=>void,release:()=>void;const started=new Promise<void>(r=>began=r),gate=new Promise<void>(r=>release=r);f.service.kernel.recordingController.processArtifact=async raw=>{const value=await f.native(raw);if((raw as {action:string}).action==='video.cover'){began();await gate}return value};const old=fs.readdirSync(path.join(f.root,'artifacts')).sort(),cancel=new AbortController(),pending=f.service.execute(f.prepare(),cancel.signal,f.owner);await started;if(mode==='cancel')cancel.abort(new Error('reference-cancelled'));else{const next=f.store.read(f.draft.id);next.scenes[0].title='并发用户修改';f.store.update(next.id,next.revision,next)}release();await assert.rejects(pending,mode==='cancel'?/reference-cancelled/:/STUDIO_CONFLICT/);assert.deepEqual(fs.readdirSync(path.join(f.root,'artifacts')).sort(),old);assert.equal(f.store.read(f.draft.id).scenes[0].title,mode==='cancel'?f.draft.scenes[0].title:'并发用户修改');assert.equal(f.notifications(),0)}finally{f.close()}}})
test('Reference Bridge admits real bound PNG bytes and rejects post-service tampering, while closed requests, foreign owners and budgets stay bounded',async()=>{const f=referenceFixture();let bridge:Awaited<ReturnType<typeof import('@bmw-agent/browser-capability/bridge').createBridgeServer>>|undefined;try{const {createBridgeServer}=await import('@bmw-agent/browser-capability/bridge');let tamper=false;bridge=await createBridgeServer({execute:async(raw,options)=>{const value=await f.service.execute((raw as {studioRequest:unknown}).studioRequest,options?.signal,options?.sessionOwner);if(tamper)fs.appendFileSync((value as {frames:{path:string}[]}).frames[0].path,'tampered-after-service');return value}},{resolveProject:directory=>({id:f.owner.projectId,directory}),activeProjectId:()=>f.owner.projectId});const binding=bridge.registerSession(f.owner.sessionId,f.root),invoke=async(studioRequest:unknown)=>{const response=await fetch(bridge.url+'/execute',{method:'POST',headers:{authorization:'Bearer '+bridge.token,'content-type':'application/json'},body:JSON.stringify({binding,arguments:{action:'video.studio',studioRequest}})});return response.json() as Promise<{ok:boolean;images:{data:string}[];result:{draft:VideoDraft;reference:{id:string}};error:string}>};const result=await invoke(f.prepare());assert.equal(result.ok,true);assert.equal(result.images.length,1);assert.deepEqual(Buffer.from(result.images[0].data,'base64'),f.png);let draft=result.result.draft;await assert.rejects(f.service.execute({operation:'read-reference',draftId:draft.id,expectedRevision:draft.revision,referenceId:result.result.reference.id},undefined,{...f.owner,sessionId:'foreign-session'}),/STUDIO_SESSION_MISMATCH/);tamper=true;const rejected=await invoke({operation:'read-reference',draftId:draft.id,expectedRevision:draft.revision,referenceId:result.result.reference.id});assert.equal(rejected.ok,false);assert.match(rejected.error,/Reference PNG changed/);tamper=false;for(let i=1;i<8;i++)draft=((await f.service.execute(f.prepare(draft),undefined,f.owner)) as {draft:VideoDraft}).draft;const before=f.calls();await assert.rejects(f.service.execute(f.prepare(draft),undefined,f.owner),/STUDIO_REFERENCE_BUDGET/);assert.equal(f.calls(),before);for(const raw of [{...f.prepare(draft),timestampsSeconds:[0]},{...f.prepare(draft,'video'),timestampsSeconds:[Infinity]},{...f.prepare(draft),path:'/tmp/outside'},{operation:'read',draftId:draft.id,referenceId:'injected'},{operation:'set-reference-analysis',draftId:draft.id,expectedRevision:draft.revision,referenceId:'x',referenceAnalysis:{...referenceAnalysis(),observations:[{...referenceAnalysis().observations[0],html:'x'}]}}])assert.throws(()=>assertStudioRequest(raw))}finally{await bridge?.close();f.close()}})
test('Reference Assistant pins its prepared identity in the original request and refuses pretending sampled frames are full-video review',()=>{const f=referenceFixture();try{const raw={projectId:f.owner.projectId,draftId:f.draft.id,expectedRevision:f.draft.revision,intent:'reference',referenceId:'prepared-reference'};assert.equal(studioAssistantRequest(raw).referenceId,'prepared-reference');assert.throws(()=>studioAssistantRequest({...raw,referenceId:undefined}),/prepared reference identity/);assert.throws(()=>studioAssistantRequest({...raw,intent:'script'}),/prepared reference identity/);assert.throws(()=>studioAssistantPrompt(f.draft,'reference',undefined,'prepared-reference'),/Unknown prepared reference/)}finally{f.close()}})

test('User reference management releases the eight-record budget without reading changed media or deleting PNGs, preserves notes/content/history and prevents Agent removal',async()=>{
 const f=referenceFixture();try{
  let draft=f.draft;for(let i=0;i<8;i++)draft=((await f.service.execute(f.prepare(draft),undefined,f.owner)) as {draft:VideoDraft}).draft
  draft.preparation.notes='人工背景与已采用的参考建议';draft=f.store.update(draft.id,draft.revision,draft)
  const before=structuredClone(draft),record=draft.referenceRecords[0],request={operation:'remove-reference',draftId:draft.id,expectedRevision:draft.revision,referenceId:record.id},files=fs.readdirSync(path.join(f.root,'artifacts')).sort(),calls=f.calls(),notifications=f.notifications()
  await assert.rejects(f.service.execute(request,undefined,f.owner),/STUDIO_REFERENCE_USER_REQUIRED/)
  await assert.rejects(f.service.execute(request,undefined,{...f.owner,sessionId:'foreign-session'},'user'),/STUDIO_SESSION_MISMATCH/)
  await assert.rejects(f.service.execute({...request,expectedRevision:draft.revision-1},undefined,f.owner,'user'),/STUDIO_CONFLICT/)
  const cancel=new AbortController();cancel.abort(new Error('management-cancelled'));await assert.rejects(f.service.execute(request,cancel.signal,f.owner,'user'),/management-cancelled/)
  assert.deepEqual(f.store.read(draft.id),before);assert.equal(f.notifications(),notifications)
  fs.appendFileSync(path.join(f.root,'artifacts',record.frames[0].artifactId),'changed frame');fs.unlinkSync(path.join(f.root,'artifacts','reference.png'))
  const retainedFiles=fs.readdirSync(path.join(f.root,'artifacts')).sort(),result=await f.service.execute(request,undefined,f.owner,'user') as {draft:VideoDraft;removedReferenceId:string};draft=result.draft
  assert.equal(result.removedReferenceId,record.id);assert.equal(draft.referenceRecords.length,7);assert.equal(draft.referenceRecords.some(r=>r.id===record.id),false);assert.equal(sameStudioDraftContent(before,draft),true);assert.deepEqual(draft.scenes,before.scenes);assert.deepEqual(draft.exports,before.exports);assert.equal(draft.preparation.notes,before.preparation.notes);assert.equal(f.calls(),calls);assert.equal(f.notifications(),notifications+1);assert.deepEqual(fs.readdirSync(path.join(f.root,'artifacts')).sort(),retainedFiles);assert.equal(retainedFiles.length,files.length-1)
  const restored=f.store.restoreSnapshot(draft.id,draft.revision,before);assert.equal(restored.referenceRecords.length,7);assert.equal(restored.referenceRecords.some(r=>r.id===record.id),false)
  fs.writeFileSync(path.join(f.root,'artifacts','reference.png'),f.png);draft=((await f.service.execute(f.prepare(restored),undefined,f.owner)) as {draft:VideoDraft}).draft;assert.equal(draft.referenceRecords.length,8);await assert.rejects(f.service.execute(f.prepare(draft),undefined,f.owner),/STUDIO_REFERENCE_BUDGET/)
  await assert.rejects(f.service.execute({...request,expectedRevision:draft.revision},undefined,f.owner,'user'),/Unknown prepared reference/)
 }finally{f.close()}
})
test('Reference removal accepts only an owned record identity and revision, never paths, bulk lists or analysis payloads',()=>{
 const action=videoFeature.browserActions.find(a=>a.action==='video.studio')!;const schema=action.inputSchema as unknown as {properties:{studioRequest:{properties:{operation:{enum:string[]}}}}};assert.ok(schema.properties.studioRequest.properties.operation.enum.includes('remove-reference'));assert.match(action.description,/Agent removal is denied/);
 const request={operation:'remove-reference',draftId:'draft-id',expectedRevision:2,referenceId:'record-id'};assert.deepEqual(assertStudioRequest(request),request)
 for(const raw of [{...request,referenceId:undefined},{...request,expectedRevision:undefined},{...request,referenceId:'../outside'},{...request,path:'/tmp/asset'},{...request,artifactId:'source.png'},{...request,referenceAnalysis:referenceAnalysis()},{...request,timestampsSeconds:[0]},{...request,beforeNotes:'text'},{...request,referenceIds:['record-id']}])assert.throws(()=>assertStudioRequest(raw))
})

test('Scene narration mute retains gain, measured audio, timing and captions through omission, explicit unmute and CAS',()=>{
 const f=fixture();try{
  let draft=sceneDraft(f.store,'声音控制');Object.assign(draft.scenes[0],{imageArtifactId:'source.png',audioArtifactId:'voice.wav',audioDurationSeconds:2,audioText:'',voiceVolume:.4,voiceTiming:{startSeconds:.5,sourceStartSeconds:0,durationSeconds:2,playbackRate:1},captions:[{startSeconds:.5,endSeconds:1.5,text:'Manual'}]});draft=f.store.update(draft.id,1,draft,true)
  const original=structuredClone(draft.scenes[0]),ref={kind:'voice' as const,sceneId:original.id},muted=setStudioMainMuted(draft,ref,true).draft;draft=f.store.update(draft.id,draft.revision,muted)
  assert.equal(draftComposition(draft).scenes[0].voiceMuted,true);assert.equal(sameStudioDraftContent(muted,{...muted,scenes:[{...muted.scenes[0],voiceMuted:false}]}),false)
  const partial=structuredClone(draft);delete partial.scenes[0].voiceMuted;partial.scenes[0].title='Visual edit';draft=f.store.update(draft.id,draft.revision,partial);assert.equal(draft.scenes[0].voiceMuted,true)
  const stale=structuredClone(draft);draft=f.store.update(draft.id,draft.revision,setStudioMainMuted(draft,ref,false).draft);assert.equal(draft.scenes[0].voiceMuted,false);assert.throws(()=>f.store.update(stale.id,stale.revision,stale),/STUDIO_CONFLICT/)
  for(const key of ['voiceVolume','audioArtifactId','audioDurationSeconds','audioText','voiceTiming','captions'] as const)assert.deepEqual(draft.scenes[0][key],original[key])
  for(const invalid of [0,'true',null])assert.throws(()=>assertVideoDraft({...draft,scenes:[{...draft.scenes[0],voiceMuted:invalid}]}),/boolean/)
  const clear=structuredClone(draft);clear.scenes[0].voiceMuted=undefined;draft=f.store.update(draft.id,draft.revision,clear);assert.equal(draft.scenes[0].voiceMuted,undefined)
 }finally{f.close()}
})
test('Main footage mute resolves stable segment identity without changing source clock, gain or captions',()=>{
 const f=fixture();try{const draft=sceneDraft(f.store,'片段原声');draft.scenes[0].visualSegments=[{id:'source-a',videoArtifactId:'first.mp4',durationSeconds:4,sourceStartSeconds:.5,playbackRate:1,zoom:1,keepSourceAudio:true,sourceVolume:.3,transition:'cut',transitionSeconds:.1},{id:'source-b',imageArtifactId:'still.png',durationSeconds:4,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.1}];draft.scenes[0].captions=[{startSeconds:1,endSeconds:2,text:'Manual'}]
 const ref={kind:'visual' as const,sceneId:draft.scenes[0].id,index:1,visualSegmentId:'source-a'},before=sourceCaptionClock(draft.scenes[0],0),result=setStudioMainMuted(draft,ref,true).draft
 assert.equal(result.scenes[0].visualSegments![0].keepSourceAudio,false);assert.equal(result.scenes[0].visualSegments![0].sourceVolume,.3);assert.equal(sourceCaptionClock(result.scenes[0],0),before);assert.deepEqual(result.scenes[0].captions,draft.scenes[0].captions);assert.equal(draft.scenes[0].visualSegments![0].keepSourceAudio,true)
 assert.equal(setStudioMainMuted(result,ref,false).draft.scenes[0].visualSegments![0].keepSourceAudio,true);assert.throws(()=>setStudioMainMuted(draft,{...ref,visualSegmentId:'source-b'},true),/原声/);assert.throws(()=>setStudioMainMuted(draft,{...ref,visualSegmentId:'deleted'},true),/删除/)
 }finally{f.close()}
})

test('Visual effect edits preserve source/narration clocks, captions and stable targets through trim, split and clearing',()=>{
 const f=fixture();try{
  const draft=sceneDraft(f.store,'画面效果');draft.scenes[0].visualSegments=[{id:'effects-first',videoArtifactId:'source.mp4',durationSeconds:4,sourceStartSeconds:.5,playbackRate:1,zoom:1,sourceVolume:.4,keepSourceAudio:true,transition:'cut',transitionSeconds:.1},{id:'effects-second',imageArtifactId:'source.png',durationSeconds:4,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.1}];draft.scenes[0].captions=[{startSeconds:1,endSeconds:2,text:'Manual'}];Object.assign(draft.scenes[0],{audioArtifactId:'voice.wav',audioDurationSeconds:2,voiceTiming:{startSeconds:.5,sourceStartSeconds:0,durationSeconds:2,playbackRate:1}})
  const ref={sceneId:draft.scenes[0].id,kind:'visual' as const,index:1,visualSegmentId:'effects-first'},effects={brightness:.8,contrast:1.1,saturation:0,blurPixels:5},clock=sourceCaptionClock(draft.scenes[0],0),changed=setStudioMainEffects(draft,ref,effects).draft
  assert.deepEqual(changed.scenes[0].visualSegments![0].effects,effects);assert.equal(changed.scenes[0].visualSegments![1].effects,undefined);assert.equal(sourceCaptionClock(changed.scenes[0],0),clock);assert.deepEqual(changed.scenes[0].captions,draft.scenes[0].captions);assert.deepEqual(changed.scenes[0].voiceTiming,draft.scenes[0].voiceTiming);assert.equal(draft.scenes[0].visualSegments![0].effects,undefined)
  const trimmed=trimStudioMain(changed,ref,'end',3).draft;assert.deepEqual(trimmed.scenes[0].visualSegments![0].effects,effects);const split=splitStudioMain(changed,ref,2).draft;assert.deepEqual(split.scenes[0].visualSegments!.slice(0,2).map(v=>v.effects),[effects,effects]);assert.equal(setStudioMainEffects(changed,ref).draft.scenes[0].visualSegments![0].effects,undefined);assert.throws(()=>setStudioMainEffects(changed,{...ref,visualSegmentId:'deleted'},effects),/删除/)
  const layers=addStudioLayer(draft,undefined,'rectangle'),withEffects=editStudioLayer(layers.draft,layers.selection,layer=>{if('kind' in layer)layer.effects=effects}),parts=splitStudioLayer(withEffects,layers.selection,2);assert.deepEqual(parts.layers!.map(l=>l.effects),[effects,effects]);parts.layers![0].locked=true;assert.throws(()=>editStudioLayer(parts,layers.selection,l=>{if('kind' in l)l.effects=undefined}),/锁定/)
 }finally{f.close()}
})

test('Whole-scene splitting moves main footage effects onto derived visual segments without applying them to captions',()=>{
 const f=fixture();try{let draft=sceneDraft(f.store,'整镜头效果');const effects={brightness:.8,contrast:1.2,saturation:0,blurPixels:4};Object.assign(draft.scenes[0],{imageArtifactId:'source.png',effects,captions:[{startSeconds:1,endSeconds:5,text:'Manual'}]});draft=f.store.update(draft.id,draft.revision,draft);const result=f.store.splitScene(draft.id,draft.revision,draft.scenes[0].id,3)
 assert.deepEqual(result.draft.scenes.map(s=>s.visualSegments![0].effects),[effects,effects]);assert.ok(result.draft.scenes.every(s=>s.effects===undefined));assert.equal(result.draft.scenes[0].captions![0].text,'Manual');assert.equal(result.draft.scenes[1].captions![0].text,'Manual');assertVideoDraft(result.draft)
 }finally{f.close()}
})

test('Material preparation allows zero-scene film scope and preserves real-artifact and stage boundaries',()=>{
 const draft={id:'material-draft',revision:1,preparation:{notes:'保留用户背景',outline:'现有大纲',artifactIds:['existing.png']},scenes:[]} as VideoDraft
 const raw={projectId:'project',draftId:draft.id,expectedRevision:1,intent:'materials'}
 assert.equal(studioAssistantRequest(raw).intent,'materials')
 for(const invalid of [{...raw,sceneId:'scene'},{...raw,referenceId:'reference'},{...raw,expectedRevision:0},{...raw,provider:'arbitrary'}])assert.throws(()=>studioAssistantRequest(invalid))
 assert.throws(()=>studioAssistantPrompt(draft,'materials','scene'),/whole draft/)
 const before=JSON.stringify(draft),prompt=studioAssistantPrompt(draft,'materials')
 for(const phrase of ['preparation.artifactIds','确实存在','保留已选素材','不要创建分镜','不自动制作或导出','不能声称已生成','唯一 browser'])assert.ok(prompt.includes(phrase),phrase)
 assert.ok(prompt.includes('保留用户背景')&&prompt.includes('existing.png'));assert.equal(JSON.stringify(draft),before)
})


test('Subtitle review validates finite structured values and readable labels without accepting styles or field coercion',()=>{
 const style={fontSize:32,color:'#00ff00',background:'box',position:'top',align:'left',offsetPercent:5} as const
 const base={sceneId:'first-scene',field:'captionStyle',before:null,after:style,reason:'字幕遮挡主体，建议放到顶部。',seconds:.5}
 const item=assertStudioReviewProposal(base);assert.match(studioReviewValueLabel(item,'after'),/32px.*顶部/);assert.equal(studioReviewValueLabel(item,'before'),'使用默认字幕样式')
 for(const proposal of [{...base,after:'font-size:32px'},{...base,after:{...style,fontSize:65}},{...base,after:{...style,filter:'url(unsafe)'}},{...base,before:style},{...base,field:'captionDisplay',after:'hidden'},{...base,field:'captionDisplay',after:undefined},{...base,field:['title']},{...base,field:'captions',after:[]}])assert.throws(()=>assertStudioReviewProposal(proposal))
 const display=assertStudioReviewProposal({...base,field:'captionDisplay',after:'translation'});assert.equal(studioReviewValueLabel(display,'after'),'只显示译文')
 assertStudioRequest({operation:'propose-review',draftId:'draft',expectedRevision:1,reviewProposal:base})
})
test('Subtitle review adoption and selective undo retain exact voice, captions, source clock and unrelated edits; unset fields restore unset',async()=>{
 const f=reviewFixture();try{
 let d=f.store.update(f.draft.id,f.draft.revision,{...f.draft,scenes:f.draft.scenes.map(s=>({...s,audioArtifactId:'speech.wav',audioText:s.narration,audioDurationSeconds:1,captions:[{startSeconds:0,endSeconds:1,text:'原文',translationText:'Translation',translationOrigin:'user-edited'}]}))},true,true)
 const original=structuredClone(d.scenes[0]),style={fontSize:32,color:'#00ff00',background:'box',position:'top',align:'center',offsetPercent:0} as const
 for(const field of ['captionStyle','captionDisplay'] as const){
 const after=field==='captionStyle'?style:'translation',before=structuredClone(d)
 d=await f.execute({operation:'propose-review',draftId:d.id,expectedRevision:d.revision,reviewProposal:{sceneId:d.scenes[0].id,field,before:null,after,reason:'逐项调整字幕显示。',seconds:.5}})
 assert.equal(sameStudioDraftContent(before,d),true);const item=d.reviewItems.at(-1)!,command={operation:'adopt-review',draftId:d.id,expectedRevision:d.revision,reviewId:item.id}
 await assert.rejects(f.execute(command),/STUDIO_REVIEW_USER_REQUIRED/);await assert.rejects(f.execute({...command,expectedRevision:d.revision-1},'user'),/STUDIO_CONFLICT/)
 d=await f.execute(command,'user');assert.deepEqual(d.scenes[0][field],after);assert.deepEqual(d.scenes[0].captions,original.captions);assert.equal(d.scenes[0].audioText,original.audioText);assert.equal(d.scenes[0].audioArtifactId,original.audioArtifactId);assert.equal(sceneCoverage(d.scenes[0],d.tts).audioStale,false)
 d.scenes[0].visualBrief='期间人工画面说明';d=f.store.update(d.id,d.revision,d)
 d=await f.execute({...command,operation:'undo-review',expectedRevision:d.revision},'user');assert.equal(Object.hasOwn(d.scenes[0],field),false);assert.equal(d.scenes[0].visualBrief,'期间人工画面说明');assert.deepEqual(d.scenes[0].captions,original.captions)
 }
 d=await f.execute({operation:'propose-review',draftId:d.id,expectedRevision:d.revision,reviewProposal:{sceneId:d.scenes[0].id,field:'captionDisplay',before:null,after:'original',reason:'原文显示',seconds:2}})
 const item=d.reviewItems.at(-1)!;d.scenes[0].durationSeconds=1.5;d=f.store.update(d.id,d.revision,d);const bytes=fs.readFileSync(path.join(f.root,'video-studio',d.id+'.json'))
 await assert.rejects(f.execute({operation:'adopt-review',draftId:d.id,expectedRevision:d.revision,reviewId:item.id},'user'),/STUDIO_REVIEW_STALE/);assert.deepEqual(fs.readFileSync(path.join(f.root,'video-studio',d.id+'.json')),bytes)
 assertVideoDraft(new VideoStudioStore(f.root,'fixture-session').read(d.id))
 }finally{f.close()}
})
