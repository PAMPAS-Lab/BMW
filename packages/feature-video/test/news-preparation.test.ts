import {ProductionDiagnostics} from '../src/production-diagnostics.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {Ajv2020} from 'ajv/dist/2020.js'
import {ProjectSourceStore} from '../../platform/src/project-source-store.js'
import {VideoStudioStore} from '../src/studio-store.js'
import {newStudioScene,assertStudioRequest} from '../src/studio-contract.js'
import {newProductionBrief} from '../src/production-types.js'
import {NewsPreparationService} from '../src/news-preparation.js'
import {NewsPreparationJournal} from '../src/news-preparation-journal.js'
import {assertNewsPreparationRequest,newsPreparationRequestSchema} from '../src/news-preparation-contract.js'
import type {NewsScenePreparation} from '../src/news-preparation-contract.js'
import type {StudioKernel} from '../src/studio-service.js'
import {VideoStudioService} from '../src/studio-service.js'
import {applyVideoEdit} from '../src/video-edit.js'
import {studioAgentResult} from '../src/studio-agent-result.js'
import {saveNativeVideoOrigin,saveMediaDerivation} from '../../media-native/src/media-derivation.js'
import {externalVideoVisual} from '../src/news-visual-source.js'
const hash=(v:string)=>crypto.createHash('sha256').update(v).digest('hex')
async function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-news-prepare-'))),directory=path.join(root,'artifacts');fs.mkdirSync(directory)
 const owner={projectId:'prepare-project',sessionId:'prepare-session'},store=new VideoStudioStore(root,owner.sessionId),sources=new ProjectSourceStore(root,owner.projectId),scope={selector:'body',index:0,excludeSelectors:[],characterUnit:'utf16',extraction:'visible-text-nodes',truncated:false,status:'observed'} as const
 const source=await sources.collect({url:'https://example.org/robot',title:'Robot primary source',author:'Author',publishedAt:'2026-10-21',scope,text:'A verified primary claim.',mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null},0)
 fs.writeFileSync(path.join(directory,'robot.mp4'),'controlled video bytes')
 await saveNativeVideoOrigin(directory,'robot.mp4',{version:1,platform:'page',targetId:'https://example.org/robot',resourceId:'https://example.org/robot.mp4'})
 let draft=store.create('Prepared robot');draft.preparation.production=newProductionBrief('news-brief')
 draft.scenes=['opening','middle','closing'].map(id=>({...newStudioScene(id),label:'资料画面｜发布2026-10-21',durationSeconds:3,narration:'A verified primary claim.',videoArtifactId:'robot.mp4',sourceStartSeconds:0,sourceDurationSeconds:10,keepSourceAudio:true,sources:['https://example.org/robot'],citations:[{sourceId:source.sourceId,acquisitionId:source.acquisitionId,startCharacter:0,endCharacter:25,quote:'A verified primary claim.',kind:'fact' as const,claim:'Reported primary claim',conflict:'pending' as const,eventAt:null}]}))
 const frames=[0,1.5,2.9].map((seconds,i)=>{const artifactId=`frame-${i}.png`,bytes='controlled frame '+i;fs.writeFileSync(path.join(directory,artifactId),bytes);return {artifactId,sha256:hash(bytes),width:640,height:360,requestedSeconds:seconds,seconds}})
 draft.referenceRecords=[{id:'ref',sourceArtifactId:'robot.mp4',sourceSha256:hash('controlled video bytes'),sourceBytes:22,kind:'video',width:640,height:360,durationSeconds:10,createdAt:new Date().toISOString(),revision:1,videoRange:{startSeconds:0,endSeconds:10},frames,analysis:{summary:'Controlled observations; no real-model coverage.',observations:frames.map((_,frameIndex)=>({frameIndex,description:'Observed controlled source frame '+frameIndex,adaptation:'Related object in this scene.'}))},analysisOrigin:'agent'}]
 const references=draft.referenceRecords;draft=store.update(draft.id,draft.revision,draft);draft=store.recordReference(draft.id,draft.revision,references);let beforeInspect=()=>{}
 const kernel:StudioKernel={projectStore:{active:()=>({id:owner.projectId,name:'P',directory:root})},projectSources:()=>sources,execute:async()=>({}),recordingController:{compose:async()=>{throw new Error('No render expected')},narrate:async()=>{throw new Error('No narration expected')},processArtifact:async()=>{beforeInspect();return {durationSeconds:10,tracks:[{id:1,type:'video',codec:'avc',canDecode:true,startSeconds:0,endSeconds:10,width:640,height:360},{id:2,type:'audio',codec:'aac',canDecode:true,startSeconds:0,endSeconds:10}]}}}}
 const service=()=>new NewsPreparationService(kernel,store,owner,store.read(draft.id))
 const record=async()=>{let state=service().journal.read();for(const scene of draft.scenes){const preflight=await service().preflight(),row=preflight.scenes.find(s=>s.sceneId===scene.id)!,plan:NewsScenePreparation={sceneId:scene.id,fingerprint:row.fingerprint,intent:'Show the related evidence.',dateLabel:scene.label!,materials:[{artifactId:'robot.mp4',referenceId:'ref',kind:'real-footage',observation:'Object changes across inspected samples.',relation:'Supports this scene claim.'}],originalSpeech:scene.id==='opening'?{mode:'source',quote:'A verified primary claim.',translation:'已核对的原话。',reason:''}:{mode:'not-used',quote:'',translation:'',reason:'Narrated context follows.'}};await service().execute({operation:'record-scene',expectedChecklistRevision:state.revision,scene:plan},'agent');state=service().journal.read()}}
 return {root,directory,owner,store,draft,kernel,service,record,beforeInspect:(fn:()=>void)=>{beforeInspect=fn},close:()=>fs.rmSync(root,{recursive:true,force:true})}
}
test('News preparation gates narration/render on actual current scene evidence and preserves generic Studio behavior',async()=>{
 const f=await fixture();try{
  const service=new VideoStudioService(f.kernel),preflight=await f.service().preflight();assert.equal(preflight.ready,false);assert.ok(preflight.issues.some(i=>i.code==='checklist-missing'))
  for(const operation of ['narrate-pending','render'] as const)await assert.rejects(service.execute({operation,draftId:f.draft.id,expectedRevision:f.draft.revision},undefined,f.owner),/NEWS_PREPARATION_REQUIRED/)
  const before=fs.readFileSync(path.join(f.store.directory,f.draft.id+'.json'),'utf8');await f.record();const ready=await f.service().preflight();assert.equal(ready.ready,true,JSON.stringify(ready.issues));assert.equal(ready.humanListening,'not-performed');assert.equal(ready.requiresIndependentExportReview,true);assert.equal(fs.readFileSync(path.join(f.store.directory,f.draft.id+'.json'),'utf8'),before)
  const labeled=applyVideoEdit(f.draft,{version:1,commands:[{op:'scene.set',sceneId:'opening',patch:{label:'资料画面｜发布2026-10-21'}}]});assert.equal(labeled.scenes[0].label,'资料画面｜发布2026-10-21')
  const generic=f.store.create('Generic Studio');await new NewsPreparationService(f.kernel,f.store,f.owner,generic).requireReady()
 }finally{f.close()}
})
test('Static MP4, missing source sound, changed PNGs and unrelated source ranges cannot establish preparation',async()=>{
 const f=await fixture();try{
  await f.record();const inspect=f.kernel.recordingController.processArtifact;f.kernel.recordingController.processArtifact=async()=>({durationSeconds:10,tracks:[{type:'video',canDecode:true,startSeconds:0,endSeconds:10}]});assert.equal((await f.service().preflight()).ready,false);await assert.rejects(f.record(),/no enabled decodable source audio/);f.kernel.recordingController.processArtifact=inspect
  let draft=f.store.read(f.draft.id);draft.referenceRecords![0].frames.forEach(frame=>{frame.sha256=hash('same');fs.writeFileSync(path.join(f.directory,frame.artifactId),'same')});draft=f.store.recordReference(draft.id,draft.revision,draft.referenceRecords!)
  const identical=await f.service().preflight();assert.equal(identical.ready,false);assert.ok(identical.issues.some(i=>i.message.includes('identical sampled')))
  fs.writeFileSync(path.join(f.directory,'frame-0.png'),'tampered');assert.ok((await f.service().preflight()).issues.some(i=>i.message.includes('frame changed')))
  draft=f.store.read(f.draft.id);draft.scenes[0].keepSourceAudio=false;f.store.update(draft.id,draft.revision,draft);assert.ok((await f.service().preflight()).issues.some(i=>i.code==='checklist-stale'))
 }finally{f.close()}
})
test('Preparation invalidates script, citation, framing, source bytes and CAS changes without rewriting prior records',async()=>{
 const f=await fixture();try{
  await f.record();const old=f.service().journal.read();let draft=f.store.read(f.draft.id);draft.scenes[0].narration='A changed editorial claim.';f.store.update(draft.id,draft.revision,draft);assert.ok((await f.service().preflight()).issues.some(i=>i.code==='checklist-stale'));assert.deepEqual(f.service().journal.read(),old)
  draft=f.store.read(f.draft.id);draft.scenes[0].citations![0].quote='forged';draft.scenes[0].citations![0].endCharacter=6;f.store.update(draft.id,draft.revision,draft);assert.ok((await f.service().preflight()).issues.some(i=>i.code==='citation-unavailable'))
  f.beforeInspect(()=>{const current=f.store.read(f.draft.id);current.title='GUI changed';f.store.update(current.id,current.revision,current)});await assert.rejects(f.service().preflight(),/NEWS_PREPARATION_STALE/);assert.deepEqual(f.service().journal.read(),old)
 }finally{f.close()}
})
test('Native track-bound inspection does not invalidate observed preparation through derived container duration',async()=>{
 const f=await fixture();try{
  const inspect=f.kernel.recordingController.processArtifact;let containerDuration=10.003
  f.kernel.recordingController.processArtifact=async(raw,signal)=>{
   const r=raw as {action:string;width:number;height:number;fps:number}
   if(r.action==='media.encode.check')return {kind:'encoding',width:r.width,height:r.height,fps:r.fps,videoCodec:'avc',audioCodec:'aac',videoSupported:true,audioSupported:true}
   const value=await inspect(raw,signal) as {durationSeconds:number;tracks:{type:string;endSeconds:number}[]}
   value.durationSeconds=containerDuration;value.tracks.find(t=>t.type==='audio')!.endSeconds=10.003;return value
  }
  let draft=f.store.read(f.draft.id);draft.scenes.forEach(s=>{s.sourceDurationSeconds=10.003});draft.scenes[0].captions=[{startSeconds:0,endSeconds:3,text:'A verified primary claim.',translationText:'已核对的原话。'}];draft=f.store.update(draft.id,draft.revision,draft)
  await f.record();const journal=f.service().journal.read(),standalone=await f.service().preflight();assert.equal(standalone.ready,true)
  const result=await new VideoStudioService(f.kernel).execute({operation:'check',draftId:draft.id,expectedRevision:draft.revision},undefined,f.owner) as {issues:{code:string}[]}
  assert.equal(result.issues.some(i=>i.code==='news-preparation'),false,'check uses the video track end while the archive container has a longer AAC tail')
  assert.deepEqual(f.service().journal.read(),journal,'native inspection does not rewrite observed declarations')
  containerDuration=10.005;assert.equal((await f.service().preflight()).ready,true,'container metadata does not change the fixed video/audio track boundaries')
  draft=f.store.read(draft.id);draft.scenes[0].captions![0].translationOrigin='user-edited';draft=f.store.update(draft.id,draft.revision,draft)
  assert.equal((await f.service().preflight()).ready,true,'translation ownership alone does not change rendered text or observed footage')
  const unchanged=f.store.read(draft.id);draft=structuredClone(unchanged);draft.scenes[0].captions![0].translationText='A different claim.';f.store.update(draft.id,draft.revision,draft)
  assert.ok((await f.service().preflight()).issues.some(i=>i.code==='checklist-stale'),'rendered caption or translation edits still invalidate the observed script')
  const currentRevision=f.store.read(unchanged.id).revision;f.store.update(unchanged.id,currentRevision,{...unchanged,revision:currentRevision})
  draft=f.store.read(draft.id);draft.scenes[0].sourceStartSeconds=.01;f.store.update(draft.id,draft.revision,draft)
  assert.ok((await f.service().preflight()).issues.some(i=>i.code==='checklist-stale'),'an actual trim remains an editorial change')
  fs.writeFileSync(path.join(f.directory,'robot.mp4'),'changed source bytes')
  assert.ok((await f.service().preflight()).issues.length,'changed source bytes are still rejected')
 }finally{f.close()}
})
test('Closed preparation API, separate journal ownership, policy strengthening and bounded model paging stay explicit',async()=>{
 const f=await fixture();try{
  const validate=new Ajv2020({strict:false}).compile(newsPreparationRequestSchema);assert.equal(validate({operation:'preflight'}),true)
  for(const raw of [{operation:'preflight',passed:true},{operation:'enable',expectedChecklistRevision:0,originalSpeechRequired:'yes'},{operation:'record-scene',expectedChecklistRevision:0,scene:{sceneId:'x',fingerprint:'0'.repeat(64),origin:'user'}}])assert.throws(()=>assertNewsPreparationRequest(raw))
  assertStudioRequest({operation:'news-preparation',draftId:f.draft.id,expectedRevision:f.draft.revision,preparationRequest:{operation:'preflight'},pageLimit:20})
  const journal=f.service().journal,state=journal.read();journal.save(0,{...state,enabled:true,originalSpeechRequired:true});assert.throws(()=>journal.save(1,{...journal.read(),originalSpeechRequired:false}),/POLICY/)
  assert.throws(()=>new NewsPreparationJournal(f.root,{...f.owner,sessionId:'foreign',draftId:f.draft.id}).read(),/Foreign/)
  const summary=studioAgentResult({operation:'news-preparation',pageLimit:1,preparationRequest:{operation:'read'}},{scenes:[{sceneId:'a'},{sceneId:'b'}],issues:[]}) as {scenes:unknown[];scenePage:{nextOffset:number}};assert.equal(summary.scenes.length,1);assert.equal(summary.scenePage.nextOffset,1)
  const controller=new AbortController();controller.abort(new Error('cancelled'));await assert.rejects(f.service().preflight(undefined,controller.signal),/cancelled/)
 }finally{f.close()}
})
async function shotFixture(){
 const f=await fixture(),draft=f.store.create('Batch shots'),nativeCalls:string[]=[];let serial=0,failSecond=false
 f.kernel.recordingController.isCaptureActive=()=>false
 f.kernel.recordingController.processArtifact=async raw=>{
  const r=raw as Record<string,unknown>;nativeCalls.push(String(r.action))
  if(r.action==='media.segment'){
   serial++;if(failSecond&&serial===2)throw new Error('controlled segment failure')
   const range=r.segmentRange as {startSeconds:number;endSeconds:number},artifactId='segment-fixture-'+serial+'.mp4',bytes='native segment '+serial,sourceTimeOffsetSeconds=Math.max(0,range.startSeconds-1),proof={kind:'archive-segment',reencoded:false,sourceArtifactId:'robot.mp4',sourceSha256:hash('controlled video bytes'),requestedSourceRange:range,artifactId,sha256:hash(bytes),bytes:bytes.length,sourceTimeOffsetSeconds,durationSeconds:range.endSeconds-sourceTimeOffsetSeconds,proofArtifactId:artifactId+'.json'}
   fs.writeFileSync(path.join(f.directory,artifactId),bytes);fs.writeFileSync(path.join(f.directory,proof.proofArtifactId),JSON.stringify(proof));return proof
  }
  if(r.action==='media.frames.sample')return {type:'frame-set',sourceArtifactId:r.artifactId,frames:(r.timestampsSeconds as number[]).map((time,i)=>{const artifactId=String(r.artifactId)+'-'+i+'.png';fs.writeFileSync(path.join(f.directory,artifactId),'source frame '+time);return {artifactId,outputIndex:i,requestedTimestampSeconds:time,timestampSeconds:time,width:640,height:360,type:'screenshot',contentType:'image/png'}})}
  if(r.action==='media.image.inspect')return {kind:'image',contentType:'image/png',width:640,height:360,pixels:640*360,bytes:10,canDecode:true}
  return {durationSeconds:10,tracks:[{id:1,type:'video',codec:'avc',canDecode:true,startSeconds:0,endSeconds:10,width:640,height:360},{id:2,type:'audio',codec:'aac',canDecode:true,startSeconds:0,endSeconds:10}]}
 }
 const shots=['batch-a','batch-b'].map((sceneId,i)=>({sceneId,title:'Actual scene',narration:'A verified primary claim.',label:'资料画面｜发布2026-10-21',artifactId:'robot.mp4',sha256:hash('controlled video bytes'),startSeconds:2+i*3,endSeconds:5+i*3,keepSourceAudio:i===0,citations:f.draft.scenes[0].citations!}))
 return {...f,batchDraft:draft,shots,nativeCalls,failSecond:()=>{failSecond=true},batch:()=>new NewsPreparationService(f.kernel,f.store,f.owner,f.store.read(draft.id))}
}
test('Shot batch links exact pins to native segments, reference frames and one atomic scene commit without semantic approval',async()=>{
 const f=await shotFixture();try{
  const parsed=assertNewsPreparationRequest({operation:'prepare-shots',shots:f.shots});assert.equal(new Ajv2020({strict:false}).compile(newsPreparationRequestSchema)(parsed),true);if(parsed.operation!=='prepare-shots')throw new Error('Expected shot plan')
  const before=f.store.read(f.batchDraft.id).revision,result=await f.batch().execute(parsed,'agent') as {revision:number;committed:boolean;ready:boolean;checkpointId:string;diagnostics:{stages:{stage:string}[]}}
  const draft=f.store.read(f.batchDraft.id);assert.equal(result.committed,true);assert.equal(result.ready,false);assert.equal(draft.revision,before+1);assert.equal(draft.scenes.length,2);assert.equal(draft.referenceRecords?.length,2);assert.equal(draft.referenceRecords![0].analysis,undefined)
  assert.equal(draft.scenes[0].sourceStartSeconds,1);assert.equal(draft.scenes[0].keepSourceAudio,true);assert.equal(draft.scenes[0].sources[0],'https://example.org/robot');assert.ok(result.diagnostics.stages.some(s=>s.stage==='commit-scenes'))
  assert.equal((await f.batch().preflight()).ready,false,'Prepared native media does not bypass observed news checklist')
  const count=f.nativeCalls.length;await assert.rejects(f.batch().execute({...parsed,resumeId:result.checkpointId},'agent'),/ALREADY_COMMITTED/);assert.equal(f.nativeCalls.length,count)
 }finally{f.close()}
})
test('Shot batches retain reusable completed work after failure, reject changed plans and preserve concurrent GUI edits',async()=>{
 const f=await shotFixture();try{
  f.failSecond();let failure='';try{await f.batch().execute({operation:'prepare-shots',shots:f.shots},'agent')}catch(error){failure=String(error)}
  assert.match(failure,/controlled segment failure/);assert.equal(f.store.read(f.batchDraft.id).scenes.length,0)
  const progress=JSON.parse(failure.split('SHOT_PREPARATION_PROGRESS: ')[1]) as {resumeId:string;preparedShots:number};assert.equal(progress.preparedShots,1)
  await assert.rejects(f.batch().execute({operation:'prepare-shots',shots:[{...f.shots[0],title:'Changed'},f.shots[1]],resumeId:progress.resumeId},'agent'),/CHECKPOINT_STALE/)
  const before=f.nativeCalls.filter(a=>a==='media.segment').length
  await f.batch().execute({operation:'prepare-shots',shots:f.shots,resumeId:progress.resumeId},'agent')
  assert.equal(f.nativeCalls.filter(a=>a==='media.segment').length,before+1,'Completed segment and reference reused after exact explicit resume')
  assert.equal(f.store.read(f.batchDraft.id).scenes.length,2)
 }finally{f.close()}
 const g=await shotFixture();try{
  const native=g.kernel.recordingController.processArtifact;let changed=false
  g.kernel.recordingController.processArtifact=async(r,s)=>{const value=await native(r,s);if(!changed){changed=true;const current=g.store.read(g.batchDraft.id);current.title='GUI edit';g.store.update(current.id,current.revision,current)}return value}
  await assert.rejects(g.batch().execute({operation:'prepare-shots',shots:g.shots},'agent'),/CONFLICT/)
  assert.equal(g.store.read(g.batchDraft.id).title,'GUI edit');assert.equal(g.store.read(g.batchDraft.id).scenes.length,0)
 }finally{g.close()}
})
test('Shot preparation rejects missing pins and cancellation before native work and keeps checkpoints private',async()=>{
 const f=await shotFixture();try{
  const badCitation={...f.shots[0].citations[0],sourceId:'misspelled-source'}
  await assert.rejects(f.batch().execute({operation:'prepare-shots',shots:[{...f.shots[0],citations:[badCitation]}]},'agent'),error=>{const message=String(error);assert.match(message,/SHOT_CITATION_BINDING/);assert.match(message,/"sceneId":"batch-a"/);assert.match(message,/"citationIndex":0/);assert.match(message,/"sourceId":"misspelled-source"/);assert.ok(message.includes(badCitation.acquisitionId));assert.match(message,/committed":false/);const data=JSON.parse(message.split('SHOT_CITATION_BINDING: ')[1].split('; ')[0]);assert.deepEqual(data.bindingHint,{sourceId:f.shots[0].citations[0].sourceId,acquisitionId:badCitation.acquisitionId,requiresExplicitResubmission:true});return true})
  assert.equal(f.nativeCalls.length,0);assert.equal(f.store.read(f.batchDraft.id).scenes.length,0)
  await assert.rejects(f.batch().execute({operation:'prepare-shots',shots:[{...f.shots[0],sha256:'0'.repeat(64)}]},'agent'),/SOURCE_CHANGED/);assert.equal(f.nativeCalls.length,0)
  const controller=new AbortController();controller.abort(new Error('user stopped'))
  await assert.rejects(f.batch().execute({operation:'prepare-shots',shots:f.shots},'agent',controller.signal),/user stopped/);assert.equal(f.nativeCalls.length,0)
  fs.mkdirSync(path.join(f.root,'video-studio','shot-checkpoints'),{recursive:true});const id='00000000-0000-4000-8000-000000000000'
  fs.symlinkSync(path.join(f.directory,'robot.mp4'),path.join(f.root,'video-studio','shot-checkpoints',id+'.json'))
  await assert.rejects(f.batch().execute({operation:'prepare-shots',shots:f.shots,resumeId:id},'agent'));assert.equal(f.store.read(f.batchDraft.id).scenes.length,0);assert.equal(fs.readFileSync(path.join(f.directory,'robot.mp4'),'utf8'),'controlled video bytes')
 }finally{f.close()}
})
test('Shot binding hints stay bounded, reject ambiguous acquisitions and never replace failed or cancelled validation',async()=>{
 const f=await shotFixture();try{
  const port=f.kernel.projectSources!(),search=port.search!.bind(port),citation=f.shots[0].citations[0],wrong={...citation,sourceId:'mistyped-source'},request={operation:'prepare-shots' as const,shots:[{...f.shots[0],citations:[wrong]}]}
  const noHint=async()=>{await assert.rejects(f.batch().execute(request,'agent'),error=>{assert.match(String(error),/SHOT_CITATION_BINDING/);assert.doesNotMatch(String(error),/"bindingHint"/);return true});assert.equal(f.nativeCalls.length,0);assert.equal(f.store.read(f.batchDraft.id).scenes.length,0)}
  port.search=r=>{assert.equal(r.limit,20);const page=search(r),row=page.items[0];return {...page,items:[row,{...row,source:{...row.source,id:'another-source'}}]}}
  await noHint()
  port.search=r=>{const page=search(r),row=page.items[0];return {...page,items:[...Array.from({length:20},(_,i)=>({...row,acquisition:{...row.acquisition,id:'unrelated-'+i}})),row]}}
  await noHint()
  port.search=()=>{throw new Error('index unavailable')};await noHint()
  const controller=new AbortController();port.search=()=>{controller.abort(new Error('cancel hint lookup'));throw new Error('index unavailable')}
  await assert.rejects(f.batch().execute(request,'agent',controller.signal),/cancel hint lookup/);assert.equal(f.nativeCalls.length,0)
  port.search=search
  await assert.rejects(f.batch().execute({...request,shots:[{...f.shots[0],citations:[{...citation,quote:'B verified primary claim.'}]}]},'agent'),error=>{assert.match(String(error),/stored original text/);assert.doesNotMatch(String(error),/"bindingHint"/);return true})
 }finally{f.close()}
})

test('Uncertain shot checkpoints refuse replay without mutating progress; timing logs contain only bounded metadata',async()=>{
 const f=await shotFixture();try{
  f.failSecond();f.kernel.recordingController.isCaptureActive=()=>true
  let failure='';try{await f.batch().execute({operation:'prepare-shots',shots:f.shots},'agent')}catch(error){failure=String(error)}
  const progress=JSON.parse(failure.split('SHOT_PREPARATION_PROGRESS: ')[1]) as {resumeId:string},file=path.join(f.root,'video-studio','shot-checkpoints',progress.resumeId+'.json'),before=fs.readFileSync(file,'utf8'),calls=f.nativeCalls.length
  assert.equal(JSON.parse(before).inFlight,true);await assert.rejects(f.batch().execute({operation:'prepare-shots',shots:f.shots,resumeId:progress.resumeId},'agent'),/UNCERTAIN/);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(f.nativeCalls.length,calls)
 }finally{f.close()}
 const logs:string[]=[],info=console.info;console.info=(line:unknown)=>{logs.push(String(line))}
 try{const trace=new ProductionDiagnostics({projectId:'p',sessionId:'s'},'test');await trace.stage('cached-segment',async()=>1,'scene',true);await assert.rejects(trace.stage('native-failure',async()=>{throw new Error('secret transcript or credentials')}));assert.equal(trace.stages.length,2);assert.equal(trace.stages[1].status,'failed');assert.ok(trace.stages.every(s=>s.elapsedMs>=0));assert.match(logs[0],/operationId/);assert.equal(logs.join('').includes('secret transcript'),false);console.info=()=>{throw new Error('diagnostic sink unavailable')};assert.equal(await trace.stage('logger-failure',async()=>42),42)}finally{console.info=info}
})

async function observedBatch(f:Awaited<ReturnType<typeof fixture>>):Promise<NewsScenePreparation[]>{
 const report=await f.service().preflight()
 return report.scenes.map(row=>({sceneId:row.sceneId,fingerprint:row.fingerprint,intent:'Show inspected related evidence.',dateLabel:'资料画面｜发布2026-10-21',materials:[{artifactId:'robot.mp4',referenceId:'ref',kind:'real-footage',observation:'Controlled distinct samples show the related object.',relation:'Supports this scene claim.'}],originalSpeech:{mode:'source',quote:'A verified primary claim.',translation:'已核对的原话。',reason:''}}))
}
test('Observed scene batches inspect current facts once and commit all declarations by one checklist CAS',async()=>{
 const f=await fixture();try{
  const scenes=await observedBatch(f),request=assertNewsPreparationRequest({operation:'record-scenes',expectedChecklistRevision:0,scenes}),before=f.store.read(f.draft.id);let inspections=0;f.beforeInspect(()=>{inspections++})
  assert.equal(new Ajv2020({strict:false}).compile(newsPreparationRequestSchema)(request),true)
  const result=await f.service().execute(request,'agent') as {checklist:{revision:number};recordedSceneIds:string[]}
  assert.equal(inspections,1,'one shared material is inspected once for the full bounded batch')
  assert.equal(result.checklist.revision,1);assert.deepEqual(result.recordedSceneIds,scenes.map(s=>s.sceneId));assert.deepEqual(f.store.read(f.draft.id),before);assert.equal((await f.service().preflight()).ready,true)
  for(const input of [{...request,scenes:[scenes[0],scenes[0]]},{...request,scenes:Array.from({length:9},(_,i)=>({...scenes[0],sceneId:'scene-'+i}))},{...request,automaticMotionApproved:true}])assert.throws(()=>assertNewsPreparationRequest(input))
 }finally{f.close()}
})
test('Observed scene batches reject the whole batch on stale evidence, user declarations, cancellation and concurrent GUI changes',async()=>{
 const f=await fixture();try{
  const scenes=await observedBatch(f),bad=structuredClone(scenes);bad.at(-1)!.fingerprint='0'.repeat(64)
  await assert.rejects(f.service().execute({operation:'record-scenes',expectedChecklistRevision:0,scenes:bad},'agent'),/STALE/);assert.equal(f.service().journal.read().revision,0)
  await f.service().execute({operation:'record-scene',expectedChecklistRevision:0,scene:scenes[1]},'user');const user=f.service().journal.read()
  await assert.rejects(f.service().execute({operation:'record-scenes',expectedChecklistRevision:user.revision,scenes},'agent'),/USER_EDITED/);assert.deepEqual(f.service().journal.read(),user)
  const controller=new AbortController();f.beforeInspect(()=>controller.abort(new Error('bounded batch cancelled')))
  await assert.rejects(f.service().execute({operation:'record-scenes',expectedChecklistRevision:user.revision,scenes:[scenes[0]]},'agent',controller.signal),/cancelled/);assert.deepEqual(f.service().journal.read(),user)
  let changed=false;f.beforeInspect(()=>{if(changed)return;changed=true;const draft=f.store.read(f.draft.id);draft.title='Concurrent GUI edit';f.store.update(draft.id,draft.revision,draft)})
  await assert.rejects(f.service().execute({operation:'record-scenes',expectedChecklistRevision:user.revision,scenes:[scenes[0]]},'agent'),/STALE/);assert.equal(f.store.read(f.draft.id).title,'Concurrent GUI edit');assert.deepEqual(f.service().journal.read(),user)
 }finally{f.close()}
})


test('Invalid speech projection remains a per-scene preparation gap without admitting stale evidence or breaking read-only diagnostics',async()=>{
 const f=await fixture();try{
  await f.record();const journal=f.service().journal.read(),previous=journal.scenes.find(s=>s.sceneId==='opening')!
  let draft=f.store.read(f.draft.id);draft.scenes[0].speechCaptions=true;draft=f.store.update(draft.id,draft.revision,draft)
  const report=await f.service().preflight(),row=report.scenes.find(s=>s.sceneId==='opening')!
  assert.equal(report.ready,false);assert.equal(row.state,'unverified');assert.equal(row.fingerprint,'')
  assert.ok(row.issues.some(i=>i.code==='render-projection-invalid'&&i.message.includes('STUDIO_SPEECH_STALE')))
  const recovery=row.issues.find(i=>i.code==='render-projection-invalid')!.recovery
  assert.ok(recovery,'Stale sentence captions must expose an exact, explicit recovery request without another help lookup.')
  assert.equal(recovery.automaticRetry,false)
  const request=assertStudioRequest(recovery.request.studioRequest)
  assert.equal(request.operation,'apply-edit');assert.equal(request.expectedRevision,draft.revision)
  const repaired=applyVideoEdit(draft,request.edit!)
  assert.equal(repaired.scenes[0].speechCaptions,false)
  assert.deepEqual(repaired.scenes[0].captions,[])
  assert.deepEqual(repaired.scenes[0].speechAnchors,draft.scenes[0].speechAnchors,'The proposed edit retains original anchor evidence.')
  assert.equal(f.store.read(draft.id).scenes[0].speechCaptions,true,'Read-only recovery does not apply the proposed edit.')
  assert.deepEqual(f.service().journal.read(),journal,'diagnostics never alter existing material observations')
  await assert.rejects(f.service().requireReady(),/NEWS_PREPARATION_REQUIRED/,'unavailable projection never silently becomes prepared')
  await assert.rejects(f.service().execute({operation:'record-scene',expectedChecklistRevision:journal.revision,scene:previous},'agent'),/NEWS_PREPARATION_STALE/)
  assert.deepEqual(f.service().journal.read(),journal,'old declarations cannot be rebound to the invalid fingerprint')
  draft=f.store.read(f.draft.id);draft.scenes[0].speechCaptions=false;f.store.update(draft.id,draft.revision,draft)
  assert.equal((await f.service().preflight()).ready,true,'explicitly correcting the inactive projection restores identical actual prepared content')
 }finally{f.close()}
})

test('Preparation exposes exact reference endpoint gaps in preflight and evidence refusal without weakening source windows',async()=>{
 const f=await fixture();try{
  await f.record();let draft=f.store.read(f.draft.id);draft.scenes[0].durationSeconds=2.5;draft=f.store.update(draft.id,draft.revision,draft)
  const report=await f.service().preflight(),row=report.scenes.find(s=>s.sceneId==='opening')!,gap=row.referenceGaps[0]
  assert.equal(report.ready,false);assert.equal(gap.artifactId,'robot.mp4');assert.equal(gap.startSeconds,0);assert.equal(gap.endExclusive,2.5);assert.deepEqual(gap.actualFrameSeconds,[0,1.5,2.9]);assert.deepEqual(gap.missing,['end']);assert.equal(gap.endWindow.minimum,2.25);assert.equal(gap.endWindow.maximumExclusive,2.5);assert.deepEqual(gap.suggestedTimestampsSeconds,[0,1.25,2.45])
  const before=f.service().journal.read();await assert.rejects(f.record(),error=>{assert.match(String(error),/NEWS_PREPARATION_EVIDENCE/);assert.match(String(error),/referenceGaps/);assert.match(String(error),/endExclusive/);return true});assert.deepEqual(f.service().journal.read(),before)
 }finally{f.close()}
})

test('Incomplete reference analysis names exact missing frame indices and a read-only recovery without changing evidence',async()=>{
 const f=await fixture();try{
  let draft=f.store.read(f.draft.id);const refs=structuredClone(draft.referenceRecords!),original=structuredClone(refs[0].analysis!);refs[0].analysis!.observations.splice(1,1);draft=f.store.recordReference(draft.id,draft.revision,refs)
  const before=f.service().journal.read(),saved=fs.readFileSync(path.join(f.store.directory,draft.id+'.json'),'utf8')
  await assert.rejects(f.record(),error=>{
   assert.ok(error instanceof Error);const outer=JSON.parse(error.message.slice(error.message.indexOf('{'))) as {message:string;committed:boolean};assert.equal(outer.committed,false)
   const issue=JSON.parse(outer.message.slice(outer.message.indexOf('{'))) as {referenceId:string;frameCount:number;observationCount:number;missingFrameIndices:number[];requiredFrameIndices:number[];recovery:{read:unknown;writeOperation:string;applyReferenceNotesRequired:boolean}}
   assert.equal(issue.referenceId,'ref');assert.equal(issue.frameCount,3);assert.equal(issue.observationCount,2);assert.deepEqual(issue.missingFrameIndices,[1]);assert.deepEqual(issue.requiredFrameIndices,[0,1,2]);assert.deepEqual(issue.recovery.read,{action:'video.studio',studioRequest:{operation:'read-reference',draftId:draft.id,expectedRevision:draft.revision,referenceId:'ref'}});assert.equal(issue.recovery.writeOperation,'set-reference-analysis');assert.equal(issue.recovery.applyReferenceNotesRequired,false);return true
  })
  assert.deepEqual(f.service().journal.read(),before);assert.equal(fs.readFileSync(path.join(f.store.directory,draft.id+'.json'),'utf8'),saved)
  refs[0].analysis=original;f.store.recordReference(draft.id,draft.revision,refs);await f.record();assert.equal((await f.service().preflight()).ready,true)
 }finally{f.close()}
})

test('An acquisition ID typo returns a closed exact-source lookup without correcting or executing the failed shot',async()=>{
 const f=await shotFixture();try{
  const citation=f.shots[0].citations[0],badId=citation.acquisitionId.slice(0,-1)+(citation.acquisitionId.endsWith('9')?'8':'9')
  await assert.rejects(f.batch().execute({operation:'prepare-shots',shots:[{...f.shots[0],citations:[{...citation,acquisitionId:badId}]}]},'agent'),error=>{
   const text=String(error),data=JSON.parse(text.split('SHOT_CITATION_BINDING: ')[1].split('; ')[0]) as {acquisitionId:string;bindingHint?:unknown;lookupRecovery:unknown}
   assert.equal(data.acquisitionId,badId);assert.equal(data.bindingHint,undefined);assert.deepEqual(data.lookupRecovery,{action:'library.streams',streamRequest:{operation:'sources',projectId:f.owner.projectId,sourceId:citation.sourceId,limit:20}});return true
  })
  const page=f.kernel.projectSources!().search!({sourceId:citation.sourceId,limit:20});assert.ok(page.items.some(row=>row.source.id===citation.sourceId&&row.acquisition.id===citation.acquisitionId));assert.ok(page.items.every(row=>row.source.id===citation.sourceId));assert.equal(f.nativeCalls.length,0);assert.equal(f.store.read(f.batchDraft.id).scenes.length,0)
 }finally{f.close()}
})

test('Preparation diagnostics identify the exact authored field without echoing text or weakening speech requirements',()=>{
 const scene:NewsScenePreparation={sceneId:'voice',fingerprint:'a'.repeat(64),intent:'Explain observed footage',dateLabel:'资料画面｜发布2026-10-23',materials:[{artifactId:'source.mp4',referenceId:'ref',kind:'real-footage',observation:'Observed speaker moves.',relation:'Supports this quote.'}],originalSpeech:{mode:'source',quote:'Complete original quote.',translation:'完整中译。',reason:''}}
 const request=(value:NewsScenePreparation)=>({operation:'record-scenes',expectedChecklistRevision:0,scenes:[value]})
 assert.doesNotThrow(()=>assertNewsPreparationRequest(request(scene)))
 const cases:[NewsScenePreparation,string,number][]=[
  [{...scene,originalSpeech:{...scene.originalSpeech,translation:''}},'voice.originalSpeech.translation',0],
  [{...scene,originalSpeech:{mode:'not-used' as const,quote:'',translation:'',reason:''}},'voice.originalSpeech.reason',0],
  [{...scene,materials:[{...scene.materials[0],observation:'private-observation-'.repeat(40)}]},'voice.materials[0].observation',800]
 ];for(const [value,field,characters] of cases){assert.throws(()=>assertNewsPreparationRequest(request(value)),error=>{assert.ok(error instanceof TypeError);const detail=JSON.parse(error.message.split('NEWS_PREPARATION_FIELD: ')[1]) as {field:string;actualCharacters:number;emptyAllowed:boolean;executed:boolean};assert.equal(detail.field,field);assert.equal(detail.actualCharacters,characters);assert.equal(detail.emptyAllowed,false);assert.equal(detail.executed,false);assert.equal(error.message.includes('private-observation-'),false);return true})}
})

test('Reusing existing shot IDs rejects before native work or checkpoint writes and directs explicit footage replacement',async()=>{
 const f=await shotFixture();try{
  await f.batch().execute({operation:'prepare-shots',shots:f.shots},'agent')
  const before=fs.readdirSync(f.directory).sort(),draft=JSON.stringify(f.store.read(f.batchDraft.id)),count=f.nativeCalls.length
  await assert.rejects(f.batch().execute({operation:'prepare-shots',shots:f.shots},'agent'),error=>{assert.ok(error instanceof Error);assert.match(error.message,/SHOT_SCENE_EXISTS/);assert.match(error.message,/media.segment/);assert.match(error.message,/video.studio attach/);assert.match(error.message,/sourceStartSeconds/);return true})
  assert.equal(f.nativeCalls.length,count);assert.deepEqual(fs.readdirSync(f.directory).sort(),before);assert.equal(JSON.stringify(f.store.read(f.batchDraft.id)),draft)
 }finally{f.close()}
})

test('AI film exception requires trusted exact-video approval, persistent labeling and unchanged independent evidence gates',async()=>{
 const f=await fixture();try{
  fs.unlinkSync(path.join(f.directory,'robot.mp4.origin.json')) // Locally generated: no external acquisition proof.
  let draft=f.store.read(f.draft.id);draft.scenes.forEach(scene=>{scene.label='AI生成影片片段｜发布2026-10-21'});draft=f.store.update(draft.id,draft.revision,draft)
  const request={operation:'authorize-ai-film' as const,expectedChecklistRevision:0,artifactId:'robot.mp4'}
  await assert.rejects(f.service().execute(request,'agent'),/USER_REQUIRED/);assert.equal(f.service().journal.read().aiFilmApproval,undefined)
  await assert.rejects(f.service().execute({...request,artifactId:'frame-0.png'},'user'),/SCOPE/)
  const record=async()=>{const service=f.service(),report=await service.preflight(),state=service.journal.read();return service.execute({operation:'record-scenes',expectedChecklistRevision:state.revision,scenes:report.scenes.map(row=>({sceneId:row.sceneId,fingerprint:row.fingerprint,intent:'Show the AI film as a labeled generated work.',dateLabel:'发布2026-10-21',materials:[{artifactId:'robot.mp4',referenceId:'ref',kind:'ai-film' as const,observation:'Controlled distinct movie frames.',relation:'This is the reported AI work.'}],originalSpeech:{mode:'source' as const,quote:'A verified primary claim.',translation:'影片合成旁白。',reason:''}}))},'agent')}
  await assert.rejects(record(),/NEWS_EXTERNAL_VIDEO_REQUIRED/)
  await f.service().execute(request,'user');const approved=f.service().journal.read();assert.equal(approved.aiFilmApproval?.sha256,hash('controlled video bytes'));assert.equal(f.store.read(draft.id).revision,draft.revision+1)
  await f.service().execute({...request,expectedChecklistRevision:approved.revision},'user');assert.equal(f.store.read(draft.id).revision,draft.revision+1,'Same approval is idempotent')
  await record();const ready=await f.service().preflight();assert.equal(ready.ready,true,JSON.stringify(ready.issues));assert.equal(ready.requiresIndependentExportReview,true);assert.equal(ready.humanListening,'not-performed')
  draft=f.store.read(draft.id);draft.scenes[0].label='发布2026-10-21';f.store.update(draft.id,draft.revision,draft);await assert.rejects(record(),/AI_FILM_LABEL/)
  fs.writeFileSync(path.join(f.directory,'robot.mp4'),'other movie');assert.ok((await f.service().preflight()).issues.some(issue=>issue.code==='moving-footage-required'))
 }finally{f.close()}
})

test('Externally provided live/CG/AI video is admitted by native source SHA without per-film generation consent',async()=>{
 const f=await fixture();try{
  for(const kind of ['external-video','ai-film','cg-video'] as const){
   let draft=f.store.read(f.draft.id);draft.scenes.forEach(s=>{s.label=(kind==='ai-film'?'AI生成影片片段':kind==='cg-video'?'CG动画片段':'外部视频片段')+'｜发布2026-10-21'});draft=f.store.update(draft.id,draft.revision,draft)
   const service=f.service(),preflight=await service.preflight(),state=service.journal.read()
   await service.execute({operation:'record-scenes',expectedChecklistRevision:state.revision,scenes:preflight.scenes.map(row=>({sceneId:row.sceneId,fingerprint:row.fingerprint,intent:'Quote an external work, not a real-world event assertion.',dateLabel:'发布2026-10-21',materials:[{artifactId:'robot.mp4',referenceId:'ref',kind,observation:'Native source-bound controlled moving samples.',relation:'Quoted external work.'}],originalSpeech:{mode:'source',quote:'A verified primary claim.',translation:'完整中译。',reason:''}}))},'agent')
   assert.equal((await f.service().preflight()).ready,true);assert.equal(service.journal.read().aiFilmApproval,undefined)
  }
  fs.unlinkSync(path.join(f.directory,'robot.mp4.origin.json'));await assert.rejects(f.record(),/NEWS_EXTERNAL_VIDEO_REQUIRED/,'Relabeling a locally generated file as real footage cannot bypass consent')
 }finally{f.close()}
})

test('External provenance follows only hash-verified native derivation, never an arbitrary MP4 or changed parent',async()=>{
 const f=await fixture();try{
  fs.writeFileSync(path.join(f.directory,'cut.mp4'),'native cut');await saveMediaDerivation(f.directory,{version:1,kind:'native-media-conversion',artifactId:'cut.mp4',sha256:hash('native cut'),sourceArtifactId:'robot.mp4',sourceSha256:hash('controlled video bytes'),sourceRange:{startSeconds:0,endSeconds:3}})
  assert.equal(await externalVideoVisual(f.kernel.projectSources!(),f.directory,'cut.mp4'),true)
  fs.writeFileSync(path.join(f.directory,'generated.mp4'),'generated text animation');assert.equal(await externalVideoVisual(f.kernel.projectSources!(),f.directory,'generated.mp4'),false)
  fs.writeFileSync(path.join(f.directory,'robot.mp4'),'changed root bytes');await assert.rejects(externalVideoVisual(f.kernel.projectSources!(),f.directory,'cut.mp4'),/changed/i)
 }finally{f.close()}
})
