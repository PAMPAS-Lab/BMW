import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {assertVideoDraft,newStudioScene,studioDraftContentKey,assertStudioRequest} from '../src/studio-contract.js'
import type {VideoDraft} from '../src/studio-contract.js'
import {videoDocumentFromDraft,videoDraftFromDocument,assertVideoDocument,videoSeconds,videoTime} from '../src/video-document.js'
import {studioCompatibility,requireSimpleVideo,requireSimpleVideoEdit} from '../src/studio-compatibility.js'
import {assertVideoEdit,applyVideoEdit} from '../src/video-edit.js'
import {VideoStudioStore} from '../src/studio-store.js'
import {VideoStudioService} from '../src/studio-service.js'
import type {StudioKernel} from '../src/studio-service.js'
import {addStudioLayer} from '../src/studio-layer-edits.js'
import {planCardTemplate} from '../src/studio-card-templates.js'
import {cardMetricText,cardPaintScene} from '../../media-native/src/card-templates.js'
import {scenePlaybackClock} from '../../media-native/src/scene-playback-window.js'
import {readingCrop} from '../../media-native/src/media/card-details-paint.js'
test('detailed source reading and background phases require 2.2 and survive CAS splits and signed restore without restarting',()=>{
 const f=fixture();try{let d=draft(f.store);const source={artifactId:'source.png',sha256:'a'.repeat(64)},spec={version:2 as const,templateId:'evidence/reading' as const,reading:{mode:'whole-to-detail' as const,targets:[{source,rect:{x:.1,y:.2,width:.3,height:.2},name:'原句'}],returnToWhole:false}}
 d.scenes[0].imageArtifactId='source.png';d.scenes[0].cardSpec=spec;d.scenes[0].bullets=[];d=f.store.update(d.id,d.revision,d)
 const doc=videoDocumentFromDraft(d);assert.equal(doc.schemaVersion,'2.2');same(d,videoDraftFromDocument(doc));for(const schemaVersion of ['2.0','2.1'])assert.throws(()=>videoDraftFromDocument({...doc,schemaVersion}),/2.1|2.2/)
 const before=d.scenes[0],time=2.2,expected=readingCrop(spec.reading,'source.png',{x:0,y:0,width:1,height:1},time,before.durationSeconds)
 d=f.store.splitScene(d.id,d.revision,before.id,1).draft;const right=d.scenes[1],clock=scenePlaybackClock(right,1,d.scenes.length);assert.equal(right.cardSpec?.version,2);assert.deepEqual(readingCrop(spec.reading,'source.png',{x:0,y:0,width:1,height:1},clock.startSeconds+time-1,clock.durationSeconds),expected)
 same(d,videoDraftFromDocument(videoDocumentFromDraft(d)));const conflict=structuredClone(d);assert.throws(()=>f.store.update(d.id,d.revision-1,conflict),/CONFLICT/)
 }finally{f.close()}
})
test('persisted card splits retain original metric and reveal clocks across reorder and codec restoration',()=>{
 const f=fixture();try{
  let d=draft(f.store)
  d.scenes[0].cardSpec={version:1,templateId:'metric/hero',value:100,decimals:0,unit:'%',motion:'count-up'}
  d.scenes[1].cardSpec={version:1,templateId:'points/three',motion:'reveal-items'};d.scenes[1].bullets=['第一项','第二项','第三项']
  d=f.store.update(d.id,d.revision,d)
  d=f.store.splitScene(d.id,d.revision,'one',1).draft
  const continuation=d.scenes[1],spec=continuation.cardSpec
  assert.ok(spec?.templateId==='metric/hero');if(spec?.templateId!=='metric/hero')throw new Error('Metric continuation missing')
  const clock=scenePlaybackClock(continuation,1,d.scenes.length)
  assert.equal(clock.startSeconds,1);assert.equal(cardMetricText(spec,clock.startSeconds), '83%');assert.equal(cardMetricText(spec,clock.startSeconds+.2),'100%')
  d=f.store.splitScene(d.id,d.revision,'two',4).draft
  const points=d.scenes.at(-1)!;assert.equal(points.presentationWindow?.startSeconds,4)
  assert.deepEqual(cardPaintScene(points).bulletRevealSeconds,[0,1.5,3],'Continuation never restarts its reveals')
  d.scenes.reverse();d=f.store.update(d.id,d.revision,d)
  const restored=videoDraftFromDocument(f.store.readDocument(d.id));same(d,restored);requireSimpleVideo(restored)
  assert.equal(restored.scenes.find(s=>s.id===continuation.id)?.presentationWindow?.startSeconds,1)
  assert.equal(restored.scenes.find(s=>s.id===points.id)?.presentationWindow?.startSeconds,4)
  assert.throws(()=>f.store.splitScene(d.id,d.revision-1,points.id,1),/CONFLICT/)
 }finally{f.close()}
})
test('global layout and pacing persist in 2.1 and survive ordinary updates without rewriting old drafts',()=>{
 const f=fixture();try{
  const original=draft(f.store);assert.equal(videoDocumentFromDraft(original).schemaVersion,'2.0')
  const prepared=assertVideoDraft({...original,title:'第一行\n第二行',cover:undefined,cardLayout:'news',narrationPacing:'compact'})
  const next=f.store.update(original.id,original.revision,prepared)
  assert.equal(next.title,'第一行\n第二行');assert.equal(next.cover?.title,'第一行 第二行','Derived cover title is one line without changing the video headline')
  const doc=videoDocumentFromDraft(next);assert.equal(doc.schemaVersion,'2.1');same(next,videoDraftFromDocument(doc));assert.throws(()=>videoDraftFromDocument({...doc,schemaVersion:'2.0'}),/2.1/)
  const {cardLayout:_layout,narrationPacing:_pacing,...partial}=next
  const retained=f.store.update(next.id,next.revision,partial);assert.equal(retained.cardLayout,'news');assert.equal(retained.narrationPacing,'compact')
  assert.notEqual(studioDraftContentKey(original),studioDraftContentKey(next),'Global layout invalidates completed output reuse')
 }finally{f.close()}
})
test('automatic narration receipts keep the new document version independently of optional presentation settings',()=>{
 const f=fixture();try{
  const d=draft(f.store),timing={startSeconds:2/24,sourceStartSeconds:0,durationSeconds:1,playbackRate:1}
  Object.assign(d.scenes[0],{audioArtifactId:'voice.wav',audioText:'',audioDurationSeconds:1,voiceTiming:timing,audioGeneration:{kind:'imported',autoTiming:timing}})
  const parsed=assertVideoDraft(d),doc=videoDocumentFromDraft(parsed)
  assert.equal(doc.schemaVersion,'2.1');same(parsed,videoDraftFromDocument(doc))
  assert.throws(()=>videoDraftFromDocument({...doc,schemaVersion:'2.0'}),/receipts require 2.1/)
  delete parsed.scenes[0].audioGeneration!.autoTiming
  assert.equal(videoDocumentFromDraft(parsed).schemaVersion,'2.0','Legacy manual windows do not trigger migration')
 }finally{f.close()}
})
test('model catalog shares eight categories and lazily returns only the selected closed template',async()=>{
 const f=fixture();try{
  const kernel:StudioKernel={projectStore:{active:()=>({id:owner.projectId,name:'P',directory:f.root})},execute:async()=>({}),recordingController:{processArtifact:async()=>({}),narrate:async()=>({}),compose:async()=>({})}}
  const service=new VideoStudioService(kernel),summary=await service.execute({operation:'describe-schema'},undefined,owner) as {cardTemplates:{id:string;category:string}[];capabilities:{profile:string}}
  assert.equal(summary.capabilities.profile,'simple.cards/3');assert.equal(new Set(summary.cardTemplates.map(t=>t.category)).size,8)
  const detail=await service.execute({operation:'describe-template',cardTemplateId:'metric/hero'},undefined,owner) as {template:{id:string;motions:string[]};cardSpecSchema:{oneOf:{properties:{templateId:{const:string}}}[]}}
  assert.equal(detail.template.id,'metric/hero');assert.deepEqual(detail.template.motions,['none','fade-in','count-up']);assert.equal(detail.cardSpecSchema.oneOf.length,1);assert.equal(detail.cardSpecSchema.oneOf[0].properties.templateId.const,'metric/hero')
  for(const input of [{operation:'describe-template',cardTemplateId:'unknown'},{operation:'describe-template',cardTemplateId:'metric/hero',html:'code'},{operation:'list',cardTemplateId:'title/basic'}])assert.throws(()=>assertStudioRequest(input))
  await assert.rejects(service.execute({operation:'describe-template',cardTemplateId:'title/basic'},undefined,{...owner,projectId:'foreign'}),/SESSION_REQUIRED/)
 }finally{f.close()}
})
test('explicit template conversion preserves text and source files, rejects count loss and reports visual detachment',()=>{
 const scene={...newStudioScene('convert'),title:'一项说明',imageArtifactId:'source.png',bullets:['保留这项'],sources:['https://example.com/source']}
 const before=structuredClone(scene),plan=planCardTemplate(scene,'title/basic')
 assert.deepEqual(scene,before,'Preview never rewrites the original scene')
 assert.equal(plan.scene.imageArtifactId,undefined);assert.deepEqual(plan.scene.bullets,scene.bullets);assert.deepEqual(plan.scene.sources,scene.sources);assert.ok(plan.notices.some(text=>text.includes('原文件')))
 assert.throws(()=>planCardTemplate({...newStudioScene('three'),bullets:['一','二','三']},'comparison/two'),/恰好两项/)
 assert.throws(()=>planCardTemplate({...newStudioScene('two'),bullets:['一','二']},'points/three'),/恰好三项/)
 const metric=planCardTemplate({...newStudioScene('metric'),bullets:['短说明']},'metric/hero',{version:1,templateId:'metric/hero',value:44,decimals:0,unit:'%',motion:'count-up'})
 assert.equal(metric.scene.cardSpec?.templateId,'metric/hero');assert.deepEqual(metric.scene.bullets,['短说明'])
 const diagram=planCardTemplate(scene,'diagram/image',{version:1,templateId:'diagram/image',motion:'slow-push'})
 assert.equal(diagram.scene.imageArtifactId,'source.png');assert.equal(diagram.scene.sceneTemplate,undefined)
})
test('card documents persist their only content authority in 2.1 while old 2.0 stays unchanged',()=>{
 const f=fixture();try{
  const original=draft(f.store);assert.equal(videoDocumentFromDraft(original).schemaVersion,'2.0')
  const metric=assertVideoDraft({...original,scenes:original.scenes.map((s,i)=>i? s:{...s,bullets:[],cardSpec:{version:1,templateId:'metric/hero',value:44,decimals:0,unit:'%',motion:'count-up'}})})
  const doc=videoDocumentFromDraft(metric);assert.equal(doc.schemaVersion,'2.1');same(metric,videoDraftFromDocument(doc))
  assert.throws(()=>videoDraftFromDocument({...doc,schemaVersion:'2.0'}),/requires 2.1/)
  const key=studioDraftContentKey(metric),changed=structuredClone(metric);const card=changed.scenes[0].cardSpec;if(card?.templateId!=='metric/hero')throw new Error('metric expected');card.value=45;assert.notEqual(studioDraftContentKey(changed),key,'Metric edits invalidate export reuse')
 }finally{f.close()}
})
const owner={projectId:'project',sessionId:'schema-session'}
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-schema-'));fs.mkdirSync(path.join(root,'artifacts'));const store=new VideoStudioStore(root,owner.sessionId);return {root,store,close:()=>fs.rmSync(root,{recursive:true,force:true})}}
function draft(store:VideoStudioStore):VideoDraft{const d=store.create('Schema');d.scenes=[newStudioScene('one'),newStudioScene('two')];return assertVideoDraft(d)}
const plain=(v:unknown):unknown=>JSON.parse(JSON.stringify(v))
function same(a:VideoDraft,b:VideoDraft):void{assert.deepEqual(plain(a),plain(b));assert.equal(studioDraftContentKey(a),studioDraftContentKey(b))}
test('Canonical v2 preserves preparation, script, subtitles, source clocks, output settings and journals exactly',()=>{
 const f=fixture();try{const d=draft(f.store);d.preparation={notes:'Brief',outline:'Outline',artifactIds:['asset.png'],sourceIds:['source-id']};Object.assign(d.scenes[0],{durationSeconds:8.123456789,videoArtifactId:'asset.mp4',sourceStartSeconds:1/3,sourceDurationSeconds:20,playbackRate:1.25,zoom:1.1,narration:'脚本。',audioArtifactId:'voice.wav',audioText:'脚本。',audioGeneration:{kind:'imported'},audioDurationSeconds:7.654321987,voiceTiming:{startSeconds:.123456789,durationSeconds:3.23456789,sourceStartSeconds:2/3,playbackRate:1},captions:[{startSeconds:.111111111,endSeconds:1.234567891,text:'保留',translationText:'Keep',translationOrigin:'user-edited'}],sources:['https://example.com/'],voiceMuted:false,showSceneNumber:false,captionDisplay:'bilingual'});d.layers=[];d.scenes[0].audioTracks=[];d.exports=[{artifactId:'final.mp4',revision:1,createdAt:'test',durationSeconds:16}];const parsed=assertVideoDraft(d),doc=assertVideoDocument(videoDocumentFromDraft(parsed));same(parsed,videoDraftFromDocument(doc));assert.equal(doc.content.story.scenes[0].durationSeconds,undefined);assert.equal(doc.content.story.scenes[0].narration,undefined);assert.equal(doc.content.timeline.tracks.find(t=>t.role==='caption')!.clips[0].timing.duration,undefined)}finally{f.close()}
})
test('Shared codec accounts for segmented fallback, empty voice, independent effects and original fade/keyframe clocks',()=>{
 const f=fixture();try{let d=draft(f.store);d.scenes[0].visualSegments=[{id:'same-native',durationSeconds:3,imageArtifactId:'one.png',sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'fade',transitionSeconds:.25},{durationSeconds:5,videoArtifactId:'two.mp4',sourceStartSeconds:.1,sourceDurationSeconds:12,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.2}];d.scenes[0].sourceStartSeconds=.987654321;d.scenes[0].audioArtifactId='voice.wav';d.scenes[0].voiceSegments=[];d=addStudioLayer(d,undefined,'text').draft;d=addStudioLayer(d,'two','audio','music.wav').draft;d.layers![0].id='same-native';d.layers![0].effects={brightness:1.1,contrast:1,saturation:1,blurPixels:0};d.layers![0].fadeWindow={originId:'origin',startSeconds:0,durationSeconds:16};d.layers![0].keyframes=[{timeSeconds:0,x:.1,y:.1,width:.8,height:.15,opacity:1,easing:'linear'},{timeSeconds:8,x:.1,y:.2,width:.8,height:.15,opacity:.7,easing:'ease-in-out',easingRange:[.1,.9]}];const parsed=assertVideoDraft(d),doc=videoDocumentFromDraft(parsed),ids=doc.content.timeline.tracks.flatMap(t=>t.clips.map(c=>c.id));assert.equal(new Set(ids).size,ids.length);same(parsed,videoDraftFromDocument(doc));assert.equal(studioCompatibility(parsed).simpleEditable,false)}finally{f.close()}
})
test('Integer placement with bounded residual preserves legacy JS clocks without rounding trusted source time',()=>{
 for(const seconds of [.0000175,.0000315,1.0000005,17.1234565,179.1234565,1799.9999995])assert.equal(videoSeconds(videoTime(seconds)),seconds)
 for(let i=0;i<1000;i++){const seconds=(i*13.123456789)%180;assert.equal(videoSeconds(videoTime(seconds)),seconds)}
 for(const value of [{ticks:.5},{ticks:0,residualSeconds:1},{ticks:0,residualSeconds:-.0000001},{ticks:NaN},{ticks:1,seconds:0}])assert.throws(()=>videoSeconds(value))
})
test('Timeline owns chronology; invalid versions, unknown fields, duplicate IDs, gaps and unmapped objects fail closed',()=>{
 const f=fixture();try{const d=draft(f.store),doc=videoDocumentFromDraft(d);doc.content.story.scenes.reverse();same(d,videoDraftFromDocument(doc));for(const change of [(v:typeof doc)=>{delete v.content.settings.music},(v:typeof doc)=>{delete v.content.story.scenes[0].script},(v:typeof doc)=>{v.content.timeline.tracks[1].kind='visual'},(v:typeof doc)=>{v.schemaVersion='3.0' as '2.0'},(v:typeof doc)=>{v.content.timeline.regions[1].start.ticks++},(v:typeof doc)=>{v.content.timeline.duration.ticks++},(v:typeof doc)=>{v.content.timeline.tracks[0].clips[0].properties.unknown=1},(v:typeof doc)=>{v.content.timeline.tracks.push(structuredClone(v.content.timeline.tracks[0]))},(v:typeof doc)=>{v.content.timeline.tracks[0].sceneId='foreign'},(v:typeof doc)=>{v.content.timeline.tracks[0].clips[0].timing.clock='timeline'},(v:typeof doc)=>{v.content.timeline.tracks[1].clips.push(structuredClone(v.content.timeline.tracks[0].clips[0]))}]){const changed=structuredClone(doc);change(changed);assert.throws(()=>assertVideoDocument(changed))}}finally{f.close()}
})
test('Simple profile is a reversible subset; hidden/muted advanced objects block until removed, with no persisted mode lock',()=>{
 const f=fixture();try{const d=draft(f.store);requireSimpleVideo(d);let advanced=addStudioLayer(d,undefined,'text').draft;advanced.layers![0].hidden=true;assert.equal(studioCompatibility(advanced).simpleEditable,false);assert.throws(()=>requireSimpleVideoEdit(d,advanced),/ADVANCED_REQUIRED/);assert.throws(()=>requireSimpleVideoEdit(advanced,d),/ADVANCED_REQUIRED/);advanced.layers=[];requireSimpleVideo(advanced);same(advanced,videoDraftFromDocument(videoDocumentFromDraft(advanced)));advanced=addStudioLayer(d,'one','audio','music.wav').draft;advanced.scenes[0].audioTracks![0].muted=true;assert.equal(studioCompatibility(advanced).blockingReasons[0].code,'independent-audio')}finally{f.close()}
})
test('Simple typed edits remain closed and roundtrip across both editors',()=>{
 const f=fixture();try{let d=draft(f.store);for(let i=0;i<40;i++){d=applyVideoEdit(d,{version:1,commands:[{op:'scene.set',sceneId:'one',patch:{title:'Title '+i,script:'Script '+i,captionDisplay:'original',showSceneNumber:i%2===0}},{op:'scene.reorder',sceneIds:i%2===0?['two','one']:['one','two']}]});requireSimpleVideo(d);same(d,videoDraftFromDocument(videoDocumentFromDraft(d)))}assert.throws(()=>assertVideoEdit({version:1,commands:[{op:'scene.set',sceneId:'one',patch:{ownerSessionId:'forged'}}]}));assert.throws(()=>applyVideoEdit(d,{version:1,commands:[{op:'scene.reorder',sceneIds:['one','one']}]}));assert.throws(()=>applyVideoEdit(d,{version:1,commands:[{op:'scene.set',sceneId:'foreign',patch:{title:'Wrong'}}]}))}finally{f.close()}
})
test('Canonical persistence and v1 migration preserve originals, owner, exports and revision; invalid reads do not rewrite',()=>{
 const f=fixture();try{let d=draft(f.store);d.scenes[0].captions=[{startSeconds:.0000175,endSeconds:1.0000005,text:'精确迁移'}];d=f.store.update(d.id,d.revision,d);const file=path.join(f.store.directory,d.id+'.json');assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).schemaVersion,'2.0');const old=JSON.stringify(d,null,2)+'\n';fs.writeFileSync(file,old);same(d,f.store.read(d.id));assert.equal(fs.readFileSync(file,'utf8'),old);assert.throws(()=>f.store.migrateDocument(d.id,1),/CONFLICT/);assert.throws(()=>new VideoStudioStore(f.root,'foreign').migrateDocument(d.id,d.revision),/MISMATCH/);const result=f.store.migrateDocument(d.id,d.revision);assert.equal(result.migrated,true);same(d,result.draft);assert.equal(f.store.migrateDocument(d.id,d.revision).migrated,false);const backup=fs.readdirSync(path.join(f.store.directory,'schema-backups'));assert.equal(backup.length,1);assert.equal(fs.readFileSync(path.join(f.store.directory,'schema-backups',backup[0]),'utf8'),old);fs.writeFileSync(file,old);d.title='Edit';d=f.store.update(d.id,d.revision,d);assert.equal(fs.readdirSync(path.join(f.store.directory,'schema-backups')).length,1);const invalid=JSON.parse(fs.readFileSync(file,'utf8'));invalid.content.timeline.regions[0].start.ticks=100;fs.writeFileSync(file,JSON.stringify(invalid));const before=fs.readFileSync(file,'utf8');assert.throws(()=>f.store.read(d.id));assert.equal(fs.readFileSync(file,'utf8'),before)}finally{f.close()}
})
test('Agent operations enforce trusted scope, current revision, atomic dry runs and actual advanced authorization',async()=>{
 const f=fixture();try{let advanced=false;const kernel:StudioKernel={projectStore:{active:()=>({id:owner.projectId,name:'P',directory:f.root})},videoStudioContext:()=>({view:{mode:advanced?'advanced':'simple'}}),execute:async()=>({}),recordingController:{processArtifact:async()=>({}),narrate:async()=>({}),compose:async()=>({})}};const service=new VideoStudioService(kernel);let d=draft(f.store);d=f.store.update(d.id,d.revision,d);const descriptor=await service.execute({operation:'describe-schema'},undefined,owner) as {schemaVersion:string;commands:string[]};assert.equal(descriptor.schemaVersion,'2.2');assert.ok(descriptor.commands.includes('clip.trim'));const file=path.join(f.store.directory,d.id+'.json'),before=fs.readFileSync(file,'utf8');const edit={version:1,commands:[{op:'scene.set',sceneId:'one',patch:{script:'New script'}}]};const dry=await service.execute({operation:'validate-edit',draftId:d.id,expectedRevision:d.revision,edit},undefined,owner) as {valid:boolean};assert.equal(dry.valid,true);assert.equal(fs.readFileSync(file,'utf8'),before);await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:1,edit},undefined,owner),/CONFLICT/);await assert.rejects(service.execute({operation:'read-document',draftId:d.id,expectedRevision:d.revision},undefined,{...owner,sessionId:'foreign'}),/MISMATCH/);const add={version:1,commands:[{op:'layer.add',kind:'text'}]};await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:add},undefined,owner),/ADVANCED_REQUIRED/);assert.equal(fs.readFileSync(file,'utf8'),before);advanced=true;d=await service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:add},undefined,owner) as VideoDraft;assert.equal(d.layers?.length,1);advanced=false;const current=fs.readFileSync(file,'utf8');const lossy=structuredClone(d);lossy.layers=[];await assert.rejects(service.execute({operation:'update',draftId:d.id,expectedRevision:d.revision,draft:lossy},undefined,owner),/ADVANCED_REQUIRED/);assert.equal(fs.readFileSync(file,'utf8'),current);advanced=true;const clip=f.store.readDocument(d.id).content.timeline.tracks.find(t=>t.role==='overlay')!.clips[0];d=await service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:{version:1,commands:[{op:'layer.remove',clipId:clip.id}]}},undefined,owner) as VideoDraft;requireSimpleVideo(d);advanced=false;await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit,modePolicy:'advanced'},undefined,owner),/Unsupported/);const unchanged=fs.readFileSync(file,'utf8');await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:{version:1,commands:[{op:'scene.set',sceneId:'one',patch:{title:'Must rollback'}},{op:'scene.set',sceneId:'missing',patch:{title:'Fail'}}]}},undefined,owner),/Unknown scene/);assert.equal(fs.readFileSync(file,'utf8'),unchanged)}finally{f.close()}
})

test('Typed independent edits convert global time to owning scene and preserve original fade clocks on trim/split',()=>{
 const f=fixture();try{let d=draft(f.store);d=addStudioLayer(d,'two','audio','music.wav').draft;const clip=videoDocumentFromDraft(d).content.timeline.tracks.find(t=>t.role==='audio')!.clips[0];d=applyVideoEdit(d,{version:1,commands:[{op:'clip.trim',clipId:clip.id,edge:'start',time:videoTime(9)}]});assert.equal(d.scenes[1].audioTracks![0].startSeconds,1);assert.equal(d.scenes[1].audioTracks![0].sourceStartSeconds,1);assert.equal(d.scenes[1].audioTracks![0].fadeWindow!.startSeconds,1);const next=videoDocumentFromDraft(d).content.timeline.tracks.find(t=>t.role==='audio')!.clips[0];d=applyVideoEdit(d,{version:1,commands:[{op:'clip.split',clipId:next.id,time:videoTime(12)}]});assert.equal(d.scenes[1].audioTracks!.length,2);assert.equal(d.scenes[1].audioTracks![1].startSeconds,4);assert.equal(d.scenes[1].audioTracks![1].fadeWindow!.startSeconds,4);same(d,videoDraftFromDocument(videoDocumentFromDraft(d)))}finally{f.close()}
})
