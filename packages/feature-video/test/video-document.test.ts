import assert from 'node:assert/strict'
import test from 'node:test'
import {Ajv2020} from 'ajv/dist/2020.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {assertVideoDraft,newStudioScene,studioDraftContentKey,assertStudioRequest} from '../src/studio-contract.js'
import type {VideoDraft} from '../src/studio-contract.js'
import {videoDocumentSchema,videoDocumentFromDraft,videoDraftFromDocument,assertVideoDocument,videoSeconds,videoTime} from '../src/video-document.js'
import {studioCompatibility,requireSimpleVideo,requireSimpleVideoEdit} from '../src/studio-compatibility.js'
import {assertVideoEdit,applyVideoEdit,videoEditSchema} from '../src/video-edit.js'
import {VideoStudioStore} from '../src/studio-store.js'
import {VideoStudioService} from '../src/studio-service.js'
import type {StudioKernel} from '../src/studio-service.js'
import {addStudioCardStack,addStudioLayer,sliceStudioLayer,trimStudioLayer,resetStudioLayerFade} from '../src/studio-layer-edits.js'
import {assertLayerPackaging,layerPackagingState} from '../../media-native/src/layer-packaging.js'
import {assertLayerTextTreatment,revealedTextLines} from '../../media-native/src/layer-text-treatment.js'
import {planCardTemplate} from '../src/studio-card-templates.js'
import {cardMetricText,cardPaintScene} from '../../media-native/src/card-templates.js'
import type {CardContentContract} from '../../media-native/src/card-templates.js'
import {studioToolGuide} from '../src/studio-tool-guide.js'
import {videoFeature} from '../index.js'
import {studioAgentResult,studioDraftSummary,studioSceneProjection} from '../src/studio-agent-result.js'
import {studioPage} from '../src/studio-read-contract.js'
import {assertComposition,compositionDuration,COMPOSITION_LIMITS} from '../../media-native/src/composition-contract.js'
import {compositionQualityPlan,assertCompositionQuality} from '../../media-native/src/composition-quality.js'
import {defaultScienceSpec,scienceState} from '../../media-native/src/science-spec.js'
import {splitStudioScene} from '../src/studio-scene-split.js'
import {studioPromptContext} from '../src/studio-context.js'
import {assertVisualLayers} from '../../media-native/src/composition-layers.js'

test('Preparation summaries expose missing citations without certifying video motion; timeline identifies primary objects and edit clock',()=>{
 const f=fixture();try{
  const d=draft(f.store);d.scenes[0].videoArtifactId='static-slide.mp4';delete d.scenes[0].imageArtifactId
  const before=JSON.stringify(d),summary=studioDraftSummary(d),row=summary.scenes[0]
  assert.equal(row.preparationInventory.citationCount,0);assert.equal(row.preparationInventory.primaryVideoSegments,1);assert.equal(row.preparationInventory.motionVerification,'not-performed')
  const advanced=addStudioLayer(d,'two','text').draft
  const timeline=studioSceneProjection(advanced,{operation:'read-scene',expectedRevision:advanced.revision,sceneId:'two',section:'timeline'}) as {editTimeDomain:string;sceneStartSeconds:number;items:{role:string;layerSetAllowed:boolean}[]}
  assert.equal(timeline.editTimeDomain,'film-seconds');assert.equal(timeline.sceneStartSeconds,d.scenes[0].durationSeconds)
  assert.equal(timeline.items.find(c=>c.role==='primary')!.layerSetAllowed,false);assert.equal(timeline.items.find(c=>c.role==='overlay')!.layerSetAllowed,true)
  assert.equal(JSON.stringify(d),before);assert.match(studioToolGuide().guide,/imported compositions do not inherit/)
 }finally{f.close()}
})

test('Edit failures identify rejected fields and recovery operations without accepting aliases or partially changing the draft',()=>{
 const f=fixture();try{
  const d=addStudioLayer(draft(f.store),'one','text').draft,before=JSON.stringify(d),doc=videoDocumentFromDraft(d),primary=doc.content.timeline.tracks.find(t=>t.role==='primary')!.clips[0],overlay=doc.content.timeline.tracks.find(t=>t.role==='overlay')!.clips[0]
  assert.throws(()=>assertVideoEdit({version:1,commands:[{op:'layer.set',clipId:overlay.id,patch:{startSeconds:1}}]}),/VIDEO_EDIT_FIELD:.*"startSeconds".*Allowed fields/)
  assert.throws(()=>applyVideoEdit(d,{version:1,commands:[{op:'layer.set',clipId:primary.id,patch:{opacity:.5}}]}),/layerSetAllowed.*clip\.effects/)
  const layer=d.scenes[0].layers![0]
  assert.throws(()=>assertVisualLayers([{...layer,keyframes:[{timeSeconds:0,x:.1,y:.1,width:.3,height:.3,opacity:1,easing:'linear',offset:0},{timeSeconds:1,x:.1,y:.1,width:.3,height:.3,opacity:1,easing:'linear'}]}]),/Unsupported layer field: "offset".*Allowed fields: timeSeconds/)
  assert.throws(()=>applyVideoEdit(d,{version:1,commands:[{op:'layer.set',clipId:overlay.id,patch:{text:'must roll back'}},{op:'clip.trim',clipId:overlay.id,edge:'end',time:videoTime(30)}]}),/clip\.trim\.time.*全片秒数/)
  assert.equal(JSON.stringify(d),before)
 }finally{f.close()}
})

test('Agent context, discovery and published schema advertise the same supported document versions',async()=>{
 const f=fixture();try{
  const d=draft(f.store),kernel:StudioKernel={projectStore:{active:()=>({id:owner.projectId,name:'P',directory:f.root})},execute:async()=>({}),recordingController:{processArtifact:async()=>({}),narrate:async()=>({}),compose:async()=>({})}}
  const service=new VideoStudioService(kernel),prompt=studioPromptContext('studio',undefined,d)
  type Versions={schemaVersion:string;supportedDocumentVersions:string[]}
  const context=JSON.parse(prompt.split('\n')[1]) as Versions
  const described=await service.execute({operation:'describe-schema'},undefined,owner) as Versions
  const listed=await service.execute({operation:'list'},undefined,owner) as Versions
  const published=(videoDocumentSchema.properties as {schemaVersion:{enum:string[]}}).schemaVersion.enum
  assert.equal(described.schemaVersion,'2.10');assert.equal(context.schemaVersion,described.schemaVersion);assert.equal(listed.schemaVersion,described.schemaVersion)
  assert.deepEqual(context.supportedDocumentVersions,published);assert.deepEqual(described.supportedDocumentVersions,published);assert.deepEqual(listed.supportedDocumentVersions,published)
  assert.ok(prompt.includes('canonical Video Document '+published.join('/')))
 }finally{f.close()}
})

test('Version 2.9 scientific data survives editable commands, saved documents and original-clock scene/object cuts',()=>{
 const f=fixture();try{
  let d=applyVideoEdit(draft(f.store),{version:1,commands:[{op:'layer.add',kind:'diagram',sceneId:'one'}]})
  const document=videoDocumentFromDraft(d),validate=new Ajv2020({strict:false}).compile(videoDocumentSchema),clip=document.content.timeline.tracks.find(t=>t.role==='overlay')!.clips[0]
  assert.equal(document.schemaVersion,'2.9');assert.equal(validate(document),true,JSON.stringify(validate.errors));same(d,videoDraftFromDocument(document))
  for(const schemaVersion of ['2.0','2.1','2.2','2.3','2.4','2.5','2.6','2.7','2.8']){assert.equal(validate({...document,schemaVersion}),false);assert.throws(()=>videoDraftFromDocument({...document,schemaVersion}),/2.9/)}
  const spec=defaultScienceSpec('array');d=applyVideoEdit(d,{version:1,commands:[{op:'layer.set',clipId:clip.id,patch:{science:spec}}]});assert.equal(d.scenes[0].layers![0].science?.kind,'array')
  const layer=d.scenes[0].layers![0],piece=sliceStudioLayer(sliceStudioLayer(layer,.13,4,'piece'),.24,3,'again')
  for(const local of [0,.25,1,2.5])assert.deepEqual(scienceState(piece.science!,local),scienceState(spec,local+.37))
  const split=splitStudioScene(d,'one',2).draft,right=split.scenes[1].layers![0];assert.equal(right.science!.offsetSeconds,2);assert.deepEqual(scienceState(right.science!,0),scienceState(spec,2))
  d=resetStudioLayerFade(trimStudioLayer(d,{kind:'visual',id:layer.id,sceneId:'one'},'start',.5),{kind:'visual',id:layer.id,sceneId:'one'});assert.equal(d.scenes[0].layers![0].science!.offsetSeconds,.5)
  assert.throws(()=>applyVideoEdit(d,{version:1,commands:[{op:'layer.set',clipId:clip.id,patch:{science:null}}]}));const corrupt=structuredClone(document),properties=corrupt.content.timeline.tracks.find(t=>t.role==='overlay')!.clips[0].properties;delete properties.science;assert.equal(validate(corrupt),false);assert.throws(()=>videoDraftFromDocument(corrupt))
  const saved=f.store.update(d.id,d.revision,d);same(saved,new VideoStudioStore(f.root,owner.sessionId).read(d.id))
 }finally{f.close()}
})

test('Version 2.8 entry packaging and six editable staggered cards use bounded Agent transactions and retained clocks',()=>{
 const f=fixture();try{
  const original=draft(f.store),d=applyVideoEdit(original,{version:1,commands:[{op:'layer.add',kind:'card-stack',sceneId:'one'}]}),layers=d.scenes[0].layers!
  assert.equal(layers.length,6);assert.deepEqual(layers.filter(l=>l.kind==='rectangle').map(l=>l.startSeconds),[0,.25,.5]);assert.equal(new Set(layers.map(l=>l.id)).size,6)
  const document=videoDocumentFromDraft(d),validate=new Ajv2020({strict:false}).compile(videoDocumentSchema)
  assert.equal(document.schemaVersion,'2.8');assert.equal(validate(document),true,JSON.stringify(validate.errors));same(d,videoDraftFromDocument(document))
  for(const schemaVersion of ['2.0','2.1','2.2','2.3','2.4','2.5','2.6','2.7']){assert.equal(validate({...document,schemaVersion}),false);assert.throws(()=>videoDraftFromDocument({...document,schemaVersion}),/2.8/)}
  const layer=layers[0],piece=sliceStudioLayer(layer,.13,1.2,'piece'),style=assertLayerPackaging(layer.packaging)
  for(const t of [.13,.15,.26,.399,.5])assert.deepEqual(layerPackagingState(piece.packaging!,t-.13),layerPackagingState(style,t))
  const ref={kind:'visual' as const,id:layer.id,sceneId:'one'},trimmed=resetStudioLayerFade(trimStudioLayer(d,ref,'start',.13),ref);assert.equal(trimmed.scenes[0].layers![0].packaging?.offsetSeconds,.13)
  assert.throws(()=>addStudioCardStack(d,'one'),/六个/);assert.throws(()=>assertVideoEdit({version:1,commands:[{op:'layer.add',kind:'card-stack',artifactId:'unrelated.png'}]}),/source artifact/)
  const mediaLayer=addStudioLayer(original,undefined,'video','source.mp4').draft;mediaLayer.layers![0].sourceCrop={x:.278,y:.563,width:.44,height:.142};const cropped=videoDocumentFromDraft(mediaLayer);assert.equal(cropped.schemaVersion,'2.8');assert.equal(validate(cropped),true);same(mediaLayer,videoDraftFromDocument(cropped));assert.equal(validate({...cropped,schemaVersion:'2.7'}),false);assert.throws(()=>videoDraftFromDocument({...cropped,schemaVersion:'2.7'}),/2.8/);
  const croppedClip=cropped.content.timeline.tracks.find(t=>t.role==='overlay')!.clips[0],cleared=applyVideoEdit(mediaLayer,{version:1,commands:[{op:'layer.set',clipId:croppedClip.id,patch:{sourceCrop:null}}]});assert.equal(cleared.layers![0].sourceCrop,undefined);assert.equal(videoDocumentFromDraft(cleared).schemaVersion,'2.0');
  assert.equal(original.scenes[0].layers,undefined);const saved=f.store.update(d.id,d.revision,d);same(saved,new VideoStudioStore(f.root,owner.sessionId).read(d.id))
 }finally{f.close()}
})

test('Version 2.7 text treatment survives Agent edits, persistence and cuts; old document versions reject it',()=>{
 const f=fixture();try{
  let d=addStudioLayer(draft(f.store),undefined,'text').draft
  const initial=videoDocumentFromDraft(d),clip=initial.content.timeline.tracks.find(t=>t.role==='overlay')!.clips[0]
  d=applyVideoEdit(d,{version:1,commands:[{op:'layer.set',clipId:clip.id,patch:{text:'第一行\nTranslation 👩🏽‍🔬',textTreatment:{reveal:'grapheme',revealSeconds:4,lineStaggerSeconds:.4,strokeWidth:3}}}]})
  const document=videoDocumentFromDraft(d),validate=new Ajv2020({strict:false}).compile(videoDocumentSchema)
  assert.equal(document.schemaVersion,'2.7');assert.equal(validate(document),true,JSON.stringify(validate.errors));same(d,videoDraftFromDocument(document))
  for(const schemaVersion of ['2.0','2.1','2.2','2.3','2.4','2.5','2.6']){assert.equal(validate({...document,schemaVersion}),false);assert.throws(()=>videoDraftFromDocument({...document,schemaVersion}),/2.7/)}
  const layer=d.layers![0],piece=sliceStudioLayer(layer,1.3,3.9,'piece'),style=assertLayerTextTreatment(layer.textTreatment),lines=['第一行','Translation 👩🏽‍🔬']
  for(const t of [0,.2,1.1,2.5])assert.deepEqual(revealedTextLines(lines,piece.textTreatment,t),revealedTextLines(lines,style,t+1.3))
  const ref={kind:'visual' as const,id:layer.id};d=trimStudioLayer(d,ref,'start',1.3);assert.equal(d.layers![0].textTreatment?.offsetSeconds,1.3)
  d=resetStudioLayerFade(d,ref);assert.equal(d.layers![0].textTreatment?.offsetSeconds,1.3)
  const saved=f.store.update(d.id,d.revision,d);same(saved,new VideoStudioStore(f.root,owner.sessionId).read(d.id))
 }finally{f.close()}
})

test('Version 2.6 admits bounded twelve-minute films and 96 scenes while legacy documents retain their original budgets',()=>{
 const f=fixture();try{
  let d=draft(f.store);d.scenes=Array.from({length:96},(_,i)=>({...newStudioScene('part-'+i,'Part '+i),durationSeconds:7.5,bullets:['Verified fixture'],captions:[{startSeconds:0,endSeconds:1,text:'Part '+i}]}))
  for(let i=0;i<64;i++)d=addStudioLayer(d,i<8?undefined:d.scenes[Math.floor((i-8)/8)].id,'rectangle').draft
  const parsed=assertVideoDraft(d),document=videoDocumentFromDraft(parsed),validate=new Ajv2020({strict:false}).compile(videoDocumentSchema)
  assert.equal(document.schemaVersion,'2.6');assert.equal(document.content.timeline.tracks.length,352);assert.equal(videoSeconds(document.content.timeline.duration),720);assert.equal(validate(document),true,JSON.stringify(validate.errors));same(parsed,videoDraftFromDocument(document))
  for(const schemaVersion of ['2.0','2.1','2.2','2.3','2.4','2.5']){assert.equal(validate({...document,schemaVersion}),false);assert.throws(()=>videoDraftFromDocument({...document,schemaVersion}),/2.6/)}
  const saved=f.store.update(d.id,d.revision,d);same(saved,new VideoStudioStore(f.root,owner.sessionId).read(d.id))
  const found:string[]=[];let offset=0
  do{const page=studioAgentResult({operation:'read',draftId:d.id,pageOffset:offset},saved) as {scenes:{id:string}[];scenePage:{nextOffset:number|null;total:number}};assert.ok(page.scenes.length<=20);assert.equal(page.scenePage.total,96);found.push(...page.scenes.map(s=>s.id));if(page.scenePage.nextOffset===null)break;offset=page.scenePage.nextOffset}while(true)
  assert.deepEqual(found,d.scenes.map(s=>s.id))
  const verbose={...saved,scenes:saved.scenes.map((s,i)=>({...s,id:'p'.repeat(70)+i,title:'长'.repeat(44),narration:'待生成。',videoArtifactId:'v'.repeat(110)+'.mp4'}))},listed=studioAgentResult({operation:'list'},{drafts:[verbose]}) as {drafts:{pendingNarrationCount:number;pendingNarrationSceneIds:string[];scenePage:{total:number}}[]}
  assert.equal(listed.drafts.length,1);assert.ok(Buffer.byteLength(JSON.stringify(listed))<18000);assert.equal(listed.drafts[0].pendingNarrationCount,96);assert.equal(listed.drafts[0].pendingNarrationSceneIds.length,20);assert.equal(listed.drafts[0].scenePage.total,96)
  assert.throws(()=>assertVideoDraft({...d,scenes:[...d.scenes,{...newStudioScene('overflow'),durationSeconds:1}]}),/ninety-six/)
  assert.throws(()=>assertVideoDraft({...d,scenes:d.scenes.map((s,i)=>i? s:{...s,durationSeconds:7.6})}),/twelve minutes/)
  assert.throws(()=>assertVideoDraft({...d,scenes:[{...newStudioScene('too-long'),durationSeconds:61}]}),/scene duration/)
  assert.throws(()=>assertVideoDraft({...draft(f.store),scenes:[{...newStudioScene('voice-budget'),audioDurationSeconds:181}]}),/audio duration/)
  assert.equal(new Ajv2020({strict:false}).compile(videoEditSchema)({version:1,commands:[{op:'scene.reorder',sceneIds:d.scenes.map(s=>s.id)}]}),true)
  const film=assertComposition({title:d.title,width:d.width,height:d.height,fps:d.fps,music:false,scenes:d.scenes.map(s=>({title:s.title,durationSeconds:s.durationSeconds,bullets:s.bullets,captions:s.captions}))}),plan=compositionQualityPlan(film)
  assert.equal(compositionDuration(film),COMPOSITION_LIMITS.seconds);assert.ok(plan.samples.length<=576);assert.equal(new Set(plan.samples.map(s=>s.sceneIndex)).size,96);assert.ok(plan.omittedCandidates>0)
  assertCompositionQuality({version:1,kind:'composition-quality',coverage:'critical-state-samples',phoneWidth:390,semanticVerification:'requires-visual-review',...plan,issues:[],omittedIssues:0})
 }finally{f.close()}
})

test('Short films with expanded fade or original presentation clocks also require 2.6 and stay reversible',()=>{
 const f=fixture();try{
  let d=addStudioLayer(draft(f.store),undefined,'rectangle').draft;d.layers![0].fadeWindow={originId:'long-envelope',startSeconds:0,durationSeconds:600}
  const validate=new Ajv2020({strict:false}).compile(videoDocumentSchema),document=videoDocumentFromDraft(d);assert.equal(document.schemaVersion,'2.6');assert.equal(validate(document),true,JSON.stringify(validate.errors));same(d,videoDraftFromDocument(document));assert.equal(validate({...document,schemaVersion:'2.5'}),false);assert.throws(()=>videoDraftFromDocument({...document,schemaVersion:'2.5'}),/2.6/)
  delete d.layers;d.scenes[0].presentationWindow={originId:'numbered',startSeconds:0,durationSeconds:8,musicIndex:96,sceneNumber:96,sceneCount:96};const numbered=videoDocumentFromDraft(d);assert.equal(numbered.schemaVersion,'2.6');assert.equal(validate(numbered),true,JSON.stringify(validate.errors));assert.equal(validate({...numbered,schemaVersion:'2.5'}),false);same(d,videoDraftFromDocument(numbered))
 }finally{f.close()}
})

test('Browser model reads and mutations use bounded projections while GUI retains complete drafts and all Host records',async()=>{
 const f=fixture();try{
  const kernel:StudioKernel={projectStore:{active:()=>({id:owner.projectId,name:'Fixture',directory:fs.realpathSync(f.root)})},execute:async()=>({}),recordingController:{processArtifact:async()=>({}),compose:async()=>({}),narrate:async()=>({})}},action=videoFeature.browserActions.find(a=>a.action==='video.studio')!,validate=new Ajv2020({strict:false}).compile(action.inputSchema)
  const call=async(request:unknown,actor:'agent'|'user'='agent')=>{assert.equal(validate({studioRequest:request}),true,JSON.stringify(validate.errors));return action.execute({browserKernel:kernel,actor,sessionOwner:owner},{action:'video.studio',studioRequest:request}) as Promise<Record<string,unknown>>}
  const created=await call({operation:'create',title:'Bounded authoring'});assert.equal(created.projection,'summary');const id=String(created.id)
  const edit={version:1,commands:[{op:'brief.set',patch:{notes:'素材笔记'.repeat(3000),outline:'已核对大纲'}},{op:'scene.add',scene:{id:'opening',title:'开场',script:'第一句。第二句。',bullets:[],durationSeconds:8}},{op:'scene.add',scene:{id:'closing',title:'结语',script:'最后一句。'}},{op:'card.set',sceneId:'opening',cardSpec:{version:2,templateId:'diagram/sequence',shape:'steps',nodes:[{label:'第一步'},{label:'第二步'}],footnote:'编辑图解',motion:'reveal-items'}}]}
  assert.equal(new Ajv2020({strict:false}).compile(videoEditSchema)(edit),true)
  const saved=await call({operation:'apply-edit',draftId:id,expectedRevision:1,edit});assert.equal(saved.sceneCount,2);assert.equal(saved.revision,2);assert.ok(JSON.stringify(saved).length<5000)
  const gui=await call({operation:'read',draftId:id},'user') as unknown as VideoDraft;assert.equal(gui.preparation.notes.length,12000);assert.equal(gui.scenes[0].narration,'第一句。第二句。');assert.equal(gui.ownerSessionId,owner.sessionId)
  const content=await call({operation:'read-scene',draftId:id,expectedRevision:2,sceneId:'opening'});assert.equal((content.content as {narration:string}).narration,gui.scenes[0].narration);assert.equal(JSON.stringify(content).includes('scriptSha256'),false)
  const card=await call({operation:'read-scene',draftId:id,expectedRevision:2,sceneId:'opening',section:'card'});assert.equal((card.targets as unknown[]).length,2);assert.equal(JSON.stringify(card).includes('"target":'),false)
  const note=await call({operation:'read-preparation',draftId:id,expectedRevision:2,briefSection:'notes'});assert.equal(String(note.text).length,4000);assert.equal(note.nextOffset,4000)
  const note2=await call({operation:'read-preparation',draftId:id,expectedRevision:2,briefSection:'notes',pageOffset:4000});assert.equal(note2.offset,4000)
  const descriptor=await call({operation:'describe-schema'});assert.equal(descriptor.documentSchema,undefined);assert.equal(descriptor.editSchema,undefined)
  const command=await call({operation:'describe-edit',editOperation:'card.set'});assert.ok(JSON.stringify(command).length<5000);assert.ok(JSON.stringify(command).includes('describe-template'))
  await assert.rejects(call({operation:'read-scene',draftId:id,expectedRevision:1,sceneId:'opening'}),/STUDIO_CONFLICT/)
  const before=JSON.stringify(f.store.read(id));await assert.rejects(call({operation:'apply-edit',draftId:id,expectedRevision:2,edit:{version:1,commands:[{op:'scene.add',scene:{id:'new',title:'不得部分保存'}},{op:'scene.add',scene:{id:'opening',title:'重复'}}]}}),/Duplicate/);assert.equal(JSON.stringify(f.store.read(id)),before)
  assert.throws(()=>assertVideoEdit({version:1,commands:[{op:'scene.add',scene:{id:'fake',title:'伪造',audioDurationSeconds:10}}]}),/FIELD/)
  for(const request of [{operation:'read-scene',draftId:id,expectedRevision:2,sceneId:'opening',section:'all'},{operation:'read',draftId:id,pageLimit:21},{operation:'assets',assetQuery:{limit:51}},{operation:'create',briefSection:'notes'}])assert.throws(()=>assertStudioRequest(request))
 }finally{f.close()}
})
test('Filtered Project asset pagination discovers materials after thousands of review outputs and rejects links',async()=>{
 const f=fixture();try{
  const directory=path.join(f.root,'artifacts');for(let i=0;i<1005;i++)fs.writeFileSync(path.join(directory,`media-${String(i).padStart(8,'0')}-aaaa-bbbb-cccc-dddddddddddd-frame-1.png`),'frame')
  for(const name of ['z-original-a.png','z-original-b.png','z-material.txt'])fs.writeFileSync(path.join(directory,name),'actual material')
  fs.symlinkSync(path.join(directory,'z-original-a.png'),path.join(directory,'z-linked.png'))
  const kernel:StudioKernel={projectStore:{active:()=>({id:owner.projectId,name:'Fixture',directory:fs.realpathSync(f.root)})},execute:async()=>({}),recordingController:{processArtifact:async()=>({}),compose:async()=>({}),narrate:async()=>({})}},action=videoFeature.browserActions.find(a=>a.action==='video.studio')!
  const call=async(studioRequest:unknown)=>action.execute({browserKernel:kernel,actor:'agent',sessionOwner:owner},{action:'video.studio',studioRequest}) as Promise<{assets:{artifactId:string}[];total:number;nextOffset:number}>
  const first=await call({operation:'assets',assetQuery:{kind:'image',limit:1}});assert.equal(first.total,2);assert.deepEqual(first.assets.map(a=>a.artifactId),['z-original-a.png']);assert.equal(first.nextOffset,1)
  const last=await call({operation:'assets',assetQuery:{kind:'image',offset:first.nextOffset,limit:1}});assert.deepEqual(last.assets.map(a=>a.artifactId),['z-original-b.png']);assert.equal(last.nextOffset,null)
  const review=await call({operation:'assets',assetQuery:{kind:'image',query:'frame-1',includeReviewArtifacts:true,limit:50}});assert.equal(review.total,1005);assert.equal(review.assets.length,50)
  for(const name of ['z-final.mp4','video-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json'])fs.writeFileSync(path.join(directory,name),'saved export')
  const gui=await action.execute({browserKernel:kernel,actor:'user',sessionOwner:owner},{action:'video.studio',studioRequest:{operation:'assets'}}) as {assets:{artifactId:string;bytes:number}[]}
  for(const name of ['z-final.mp4','video-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json','z-original-a.png'])assert.equal(gui.assets.find(asset=>asset.artifactId===name)?.bytes,fs.statSync(path.join(directory,name)).size,'GUI must resolve final video, report and originals beyond 1000 review artifacts')
  assert.equal(gui.assets.some(asset=>asset.artifactId==='z-linked.png'),false)
  const bounded=await call({operation:'assets'});assert.equal(bounded.assets.length,4,'Default Agent discovery still excludes reviews and stays bounded')
  const read=await new VideoStudioService(kernel).execute({operation:'read-material',artifactId:'z-material.txt'},undefined,owner) as {text:string};assert.equal(read.text,'actual material','Material lookup is not limited to the first 1000 names')
 }finally{f.close()}
})
test('Compact model results retain export identity, source text offsets and speech evidence without repeated full records',()=>{
 const f=fixture();try{
  const d=draft(f.store),raw={draft:d,export:{artifactId:'actual.mp4',verificationArtifactId:'report.json',path:'/project/artifacts/actual.mp4',type:'video',durationSeconds:16,composition:{huge:'x'.repeat(200000)},quality:{coverage:'critical-state-samples',semanticVerification:'requires-visual-review',samples:Array(576).fill({}),issues:Array(400).fill({}),omittedIssues:0}}},result=studioAgentResult({operation:'render'},raw) as {draft:{projection:string};export:{artifactId:string;quality:{issueCount:number}}}
  assert.ok(JSON.stringify(result).length<6000);assert.equal(result.export.artifactId,'actual.mp4');assert.equal(result.export.quality.issueCount,400);assert.equal(result.draft.projection,'summary');assert.equal(raw.export.composition.huge.length,200000)
  const text='原文'.repeat(4000),source=studioAgentResult({operation:'source',sourceRequest:{operation:'read',sourceId:'source',acquisitionId:'acquisition'},pageOffset:4000},{source:{id:'source',url:'https://example.com/'},acquisition:{id:'acquisition',title:'原文'},text}) as {text:string;offset:number;nextOffset:number;untrustedSourceText:boolean};assert.equal(source.text,text.slice(4000));assert.equal(source.offset,4000);assert.equal(source.nextOffset,null);assert.equal(source.untrustedSourceText,true)
  const unicode='x'.repeat(159)+'🧪'+('A\u00a0B\n实验。'.repeat(1000)),quotes=studioAgentResult({operation:'source',sourceRequest:{operation:'read',sourceId:'source',acquisitionId:'acquisition'}},{source:{id:'source'},acquisition:{id:'acquisition'},text:unicode}) as {quoteSpans:{startCharacter:number;endCharacter:number;quote:string}[]};assert.ok(quotes.quoteSpans.length<=32);assert.equal(quotes.quoteSpans[0].endCharacter,159);for(const q of quotes.quoteSpans){assert.equal(q.quote,unicode.slice(q.startCharacter,q.endCharacter));assert.equal(q.quote.length,q.endCharacter-q.startCharacter);assert.ok(q.quote.length<=160);assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(q.quote),false)}
  const boundary='x'.repeat(3999)+'🧪next',first=studioAgentResult({operation:'source',sourceRequest:{operation:'read',sourceId:'source',acquisitionId:'acquisition'}},{source:{id:'source'},acquisition:{id:'acquisition'},text:boundary}) as {text:string;nextOffset:number};assert.equal(first.nextOffset,3999);const second=studioAgentResult({operation:'source',sourceRequest:{operation:'read',sourceId:'source',acquisitionId:'acquisition'},pageOffset:first.nextOffset},{source:{id:'source'},acquisition:{id:'acquisition'},text:boundary}) as {text:string};assert.equal(first.text+second.text,boundary)
  const speech=studioAgentResult({operation:'read-speech'},{segments:[{startSeconds:0,endSeconds:1,text:'真实语音'}],suggestions:[],candidate:{evidenceArtifactId:'speech.json'},evidence:{huge:'x'.repeat(100000)},cardTargets:[{kind:'diagram',index:0,label:'节点',target:'x'.repeat(2000)}]}) as {segments:{items:unknown[]};evidence?:unknown};assert.equal(speech.segments.items.length,1);assert.equal(speech.evidence,undefined);assert.ok(JSON.stringify(speech).length<3000)
  const page=studioPage([{id:'a',text:'a'.repeat(6000)},{id:'b',text:'b'.repeat(6000)}],0,20);assert.equal(page.items.length,1);assert.equal(page.nextOffset,1);assert.equal(page.items[0].text.length,6000,'Record text is never silently cut to fit JSON')
  const assessment={status:'passed',notes:'审片意见'.repeat(150),authority:'agent-declared'},state={agent:assessment,user:{status:'pending'},scenes:Array.from({length:24},(_,i)=>({sceneId:'scene-'+i,agent:assessment,user:assessment})),plan:{requiresFullFilmReview:true,reuseOldFrames:false}},review=studioAgentResult({operation:'review-status'},state) as {scenes:{agent:{notesPreview:string;notesCharacters:number}}[];scenePage:{total:number;nextOffset:number}}
  assert.equal(review.scenePage.total,24);assert.ok(review.scenePage.nextOffset>0);assert.ok(review.scenePage.nextOffset<24);assert.ok(JSON.stringify(review).length<12000);assert.equal(review.scenes[0].agent.notesCharacters,600);assert.equal(review.scenes[0].agent.notesPreview.length,160)
  const diagnostic=studioAgentResult({operation:'diagnose-timing',timingSection:'sentences',pageOffset:10,pageLimit:20},{draftId:'draft',revision:1,sceneId:'scene',sentences:Array.from({length:100},(_,i)=>({id:'sentence-'+i,textPreview:'完整句子'.repeat(20),targets:[{kind:'diagram',index:0,label:'当前论点'}]})),issues:[],sentenceCount:100}) as {items:{id:string}[];offset:number;nextOffset:number};assert.equal(diagnostic.offset,10);assert.equal(diagnostic.items[0].id,'sentence-10');assert.ok(diagnostic.nextOffset>10&&diagnostic.nextOffset<100);assert.ok(JSON.stringify(diagnostic).length<10000)
 }finally{f.close()}
})

test('Phone line hints and editable ordered diagrams require 2.4 while previous documents remain supported',()=>{
 const f=fixture();try{const d=draft(f.store);d.scenes[0].cardSpec={version:2,templateId:'diagram/sequence',shape:'funnel',nodes:[{label:'一'},{label:'二'},{label:'三'},{label:'四'}],footnote:'非比例示意'};delete d.scenes[0].imageArtifactId;delete d.scenes[0].videoArtifactId;d.scenes[0].bullets=[]
 const validate=new Ajv2020({strict:false}).compile(videoDocumentSchema),document=videoDocumentFromDraft(d);assert.equal(document.schemaVersion,'2.4');assert.equal(validate(document),true,JSON.stringify(validate.errors));same(assertVideoDraft(d),videoDraftFromDocument(document));for(const version of ['2.0','2.1','2.2','2.3']){assert.equal(validate({...document,schemaVersion:version}),false);assert.throws(()=>videoDraftFromDocument({...document,schemaVersion:version}),/require 2.4/)}
 const e=draft(f.store);e.scenes[0].imageArtifactId='source.png';e.scenes[0].cardSpec={version:2,templateId:'evidence/reading',reading:{mode:'sequence',returnToWhole:false,targets:[{name:'原句',source:{artifactId:'source.png',sha256:'a'.repeat(64)},rect:{x:0,y:0,width:1,height:.1},lineCount:2}]}};const phone=videoDocumentFromDraft(e);assert.equal(phone.schemaVersion,'2.4');assert.equal(validate(phone),true,JSON.stringify(validate.errors));assert.equal(validate({...phone,schemaVersion:'2.3'}),false);same(assertVideoDraft(e),videoDraftFromDocument(phone));assert.throws(()=>videoDraftFromDocument({...phone,schemaVersion:'2.3'}),/require 2.4/)
 }finally{f.close()}
})
test('Speech timing provenance requires canonical 2.5, roundtrips without loss and cannot be relabeled as a legacy document',()=>{
 const f=fixture();try{
  const d=draft(f.store),s=d.scenes[0];s.narration=s.audioText='第一句。';s.audioArtifactId='voice.wav';s.audioDurationSeconds=2;s.speechAnchors={scriptText:s.narration,scriptSha256:'a'.repeat(64),audioArtifactId:'voice.wav',audioSha256:'b'.repeat(64),durationSeconds:2,createdAt:new Date().toISOString(),capturedRevision:1,timeDomain:'audio-file-seconds',origin:'agent-edited',anchors:[{id:'first',scriptStart:0,scriptEnd:4,startSeconds:0,endSeconds:2}],timingProvenance:{basis:'editorial-estimate'}}
  const doc=videoDocumentFromDraft(d),validate=new Ajv2020({strict:false}).compile(videoDocumentSchema);assert.equal(doc.schemaVersion,'2.5');assert.equal(validate(doc),true,JSON.stringify(validate.errors));same(d,videoDraftFromDocument(doc))
  for(const version of ['2.0','2.1','2.2','2.3','2.4']){assert.equal(validate({...doc,schemaVersion:version}),false);assert.throws(()=>videoDraftFromDocument({...doc,schemaVersion:version}),/requires 2.5/)}
  s.speechAnchors.timingProvenance={basis:'asr-reference',evidenceArtifactId:'speech.json',evidenceSha256:'c'.repeat(64)};same(d,videoDraftFromDocument(videoDocumentFromDraft(d)))
  delete s.speechAnchors.timingProvenance;assert.equal(videoDocumentFromDraft(d).schemaVersion,'2.0','Old records keep their actual version and unknown method')
 }finally{f.close()}
})
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
  const evidence=await service.execute({operation:'describe-template',cardTemplateId:'evidence/reading'},undefined,owner) as {contentContracts:CardContentContract[]}
  const recommendation=evidence.contentContracts.find(c=>c.version===2)!.reading!.recommended,recipe=studioToolGuide().recipes.evidenceReading.cardSpec.reading
  assert.equal(recipe.mode,recommendation.mode);assert.equal(recipe.returnToWhole,recommendation.returnToWhole);assert.equal(recommendation.requiresAuthorLineCount,true)
  assert.match(studioToolGuide().guide,/long-static-hold/);assert.match(studioToolGuide().guide,/Do not loop zooms/)
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
 const f=fixture();try{let advanced=false;const kernel:StudioKernel={projectStore:{active:()=>({id:owner.projectId,name:'P',directory:f.root})},videoStudioContext:()=>({view:{mode:advanced?'advanced':'simple'}}),execute:async()=>({}),recordingController:{processArtifact:async()=>({}),narrate:async()=>({}),compose:async()=>({})}};const service=new VideoStudioService(kernel);let d=draft(f.store);d=f.store.update(d.id,d.revision,d);const descriptor=await service.execute({operation:'describe-schema'},undefined,owner) as {schemaVersion:string;commands:string[]};assert.equal(descriptor.schemaVersion,'2.10');assert.ok(descriptor.commands.includes('clip.trim'));const file=path.join(f.store.directory,d.id+'.json'),before=fs.readFileSync(file,'utf8');const edit={version:1,commands:[{op:'scene.set',sceneId:'one',patch:{script:'New script'}}]};const dry=await service.execute({operation:'validate-edit',draftId:d.id,expectedRevision:d.revision,edit},undefined,owner) as {valid:boolean};assert.equal(dry.valid,true);assert.equal(fs.readFileSync(file,'utf8'),before);await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:1,edit},undefined,owner),/CONFLICT/);await assert.rejects(service.execute({operation:'read-document',draftId:d.id,expectedRevision:d.revision},undefined,{...owner,sessionId:'foreign'}),/MISMATCH/);const add={version:1,commands:[{op:'layer.add',kind:'text'}]};await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:add},undefined,owner),/ADVANCED_REQUIRED/);assert.equal(fs.readFileSync(file,'utf8'),before);advanced=true;d=await service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:add},undefined,owner) as VideoDraft;assert.equal(d.layers?.length,1);advanced=false;const current=fs.readFileSync(file,'utf8');const lossy=structuredClone(d);lossy.layers=[];await assert.rejects(service.execute({operation:'update',draftId:d.id,expectedRevision:d.revision,draft:lossy},undefined,owner),/ADVANCED_REQUIRED/);assert.equal(fs.readFileSync(file,'utf8'),current);advanced=true;const clip=f.store.readDocument(d.id).content.timeline.tracks.find(t=>t.role==='overlay')!.clips[0];d=await service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:{version:1,commands:[{op:'layer.remove',clipId:clip.id}]}},undefined,owner) as VideoDraft;requireSimpleVideo(d);advanced=false;await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit,modePolicy:'advanced'},undefined,owner),/Unsupported/);const unchanged=fs.readFileSync(file,'utf8');await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:{version:1,commands:[{op:'scene.set',sceneId:'one',patch:{title:'Must rollback'}},{op:'scene.set',sceneId:'missing',patch:{title:'Fail'}}]}},undefined,owner),/Unknown scene/);assert.equal(fs.readFileSync(file,'utf8'),unchanged)}finally{f.close()}
})

test('Bounded captions and card edits preserve Host speech records and atomically bind current targets under CAS',async()=>{
 const f=fixture();try{
  const sha=(value:string|Buffer)=>crypto.createHash('sha256').update(value).digest('hex'),bytes=Buffer.from('controlled voice hash fixture');fs.writeFileSync(path.join(f.root,'artifacts/voice.wav'),bytes)
  let d=draft(f.store);const scene=d.scenes[0];Object.assign(scene,{narration:'一句。二句。',audioArtifactId:'voice.wav',audioText:'一句。二句。',audioDurationSeconds:4,audioGeneration:{kind:'imported'},cardSpec:{version:2,templateId:'diagram/sequence',nodes:[{label:'一'},{label:'二'}],shape:'steps',footnote:'旧脚注'}});d=f.store.update(d.id,d.revision,d,true)
  d=f.store.setSpeech(d.id,d.revision,'one','anchors',{scriptText:'一句。二句。',scriptSha256:sha('一句。二句。'),audioArtifactId:'voice.wav',audioSha256:sha(bytes),durationSeconds:4,createdAt:new Date().toISOString(),capturedRevision:d.revision,timeDomain:'audio-file-seconds',origin:'agent-edited',anchors:[{id:'a',scriptStart:0,scriptEnd:3,startSeconds:0,endSeconds:2},{id:'b',scriptStart:3,scriptEnd:6,startSeconds:2,endSeconds:4}]})
  const original=structuredClone(d.scenes[0]),kernel:StudioKernel={projectStore:{active:()=>({id:owner.projectId,name:'P',directory:fs.realpathSync(f.root)})},execute:async()=>({}),recordingController:{processArtifact:async()=>({}),narrate:async()=>({}),compose:async()=>({})}},service=new VideoStudioService(kernel)
  const edit={version:1,commands:[{op:'captions.set',sceneId:'one',mode:'manual',cues:[{startSeconds:.5,endSeconds:2.5,text:'一句。'},{startSeconds:2.5,endSeconds:4.5,text:'二句。'}]},{op:'card.set',sceneId:'one',cardSpec:{version:2,templateId:'diagram/sequence',nodes:[{label:'第一句'},{label:'第二句'}],shape:'steps',footnote:'新脚注'},links:[{kind:'diagram',index:0,anchorId:'a'},{kind:'diagram',index:1,anchorId:'b'}]}]}
  const validate=new Ajv2020({strict:false}).compile(videoEditSchema);assert.equal(validate(edit),true,JSON.stringify(validate.errors))
  d=await service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit},undefined,owner) as VideoDraft
  assert.deepEqual(d.scenes[0].speechAnchors,original.speechAnchors);assert.equal(d.scenes[0].audioArtifactId,original.audioArtifactId);assert.deepEqual(d.scenes[0].audioGeneration,original.audioGeneration);assert.equal(d.scenes[0].speechCaptions,false);assert.equal(d.scenes[0].captions!.length,2);assert.equal(d.scenes[0].speechLinks!.cards![1].anchorId,'b');assert.match(d.scenes[0].speechLinks!.cards![0].target,/新脚注/)
  const before=fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8')
  await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:{version:1,commands:[{op:'captions.set',sceneId:'one',mode:'off'},{op:'card.bind',sceneId:'one',links:[{kind:'diagram',index:0,anchorId:'unknown'}]}]}},undefined,owner),/REFERENCE/)
  assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),before)
  await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision-1,edit},undefined,owner),/CONFLICT/)
  assert.throws(()=>assertVideoEdit({version:1,commands:[{op:'card.bind',sceneId:'one',links:[],speechAnchors:{}}]}),/FIELD/)
  const protectedDraft=structuredClone(d);protectedDraft.scenes[0].captions=[{startSeconds:.5,endSeconds:2.5,text:'一句。',translationText:'Human translation',translationOrigin:'user-edited'}]
  const disable={version:1 as const,commands:[{op:'captions.set' as const,sceneId:'one',mode:'off' as const}]}
  assert.throws(()=>applyVideoEdit(protectedDraft,disable),/TRANSLATION_EDITED/);assert.doesNotThrow(()=>applyVideoEdit(protectedDraft,disable,true))
  assert.throws(()=>assertVideoEdit({version:1,commands:[{op:'captions.set',sceneId:'one',mode:'manual',cues:[{startSeconds:2,endSeconds:1,text:'Invalid'}]}]}),/follow start/)
  fs.writeFileSync(path.join(f.root,'artifacts/voice.wav'),'changed')
  await assert.rejects(service.execute({operation:'apply-edit',draftId:d.id,expectedRevision:d.revision,edit:{version:1,commands:[{op:'captions.set',sceneId:'one',mode:'sentences'}]}},undefined,owner),/STALE/)
  assert.equal(fs.readFileSync(path.join(f.store.directory,d.id+'.json'),'utf8'),before)
 }finally{f.close()}
})

test('Typed independent edits convert global time to owning scene and preserve original fade clocks on trim/split',()=>{
 const f=fixture();try{let d=draft(f.store);d=addStudioLayer(d,'two','audio','music.wav').draft;const clip=videoDocumentFromDraft(d).content.timeline.tracks.find(t=>t.role==='audio')!.clips[0];d=applyVideoEdit(d,{version:1,commands:[{op:'clip.trim',clipId:clip.id,edge:'start',time:videoTime(9)}]});assert.equal(d.scenes[1].audioTracks![0].startSeconds,1);assert.equal(d.scenes[1].audioTracks![0].sourceStartSeconds,1);assert.equal(d.scenes[1].audioTracks![0].fadeWindow!.startSeconds,1);const next=videoDocumentFromDraft(d).content.timeline.tracks.find(t=>t.role==='audio')!.clips[0];d=applyVideoEdit(d,{version:1,commands:[{op:'clip.split',clipId:next.id,time:videoTime(12)}]});assert.equal(d.scenes[1].audioTracks!.length,2);assert.equal(d.scenes[1].audioTracks![1].startSeconds,4);assert.equal(d.scenes[1].audioTracks![1].fadeWindow!.startSeconds,4);same(d,videoDraftFromDocument(videoDocumentFromDraft(d)))}finally{f.close()}
})

test('loupe mode roundtrips in 2.3 and cannot be disguised as a previous document version',()=>{const f=fixture();try{const d=draft(f.store);d.scenes[0].imageArtifactId='source.png';d.scenes[0].focusIntervals=[{startSeconds:0,endSeconds:2,x:.5,y:.5,zoom:2,emphasize:false,mode:'loupe',loupeCorner:'top-right'}];const document=videoDocumentFromDraft(d);assert.equal(document.schemaVersion,'2.3');same(assertVideoDraft(d),videoDraftFromDocument(document));assert.throws(()=>videoDraftFromDocument({...document,schemaVersion:'2.2'}),/requires 2.3/)}finally{f.close()}})
