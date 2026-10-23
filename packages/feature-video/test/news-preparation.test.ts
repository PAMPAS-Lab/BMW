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
const hash=(v:string)=>crypto.createHash('sha256').update(v).digest('hex')
async function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-news-prepare-'))),directory=path.join(root,'artifacts');fs.mkdirSync(directory)
 const owner={projectId:'prepare-project',sessionId:'prepare-session'},store=new VideoStudioStore(root,owner.sessionId),sources=new ProjectSourceStore(root,owner.projectId),scope={selector:'body',index:0,excludeSelectors:[],characterUnit:'utf16',extraction:'visible-text-nodes',truncated:false,status:'observed'} as const
 const source=await sources.collect({url:'https://example.org/robot',title:'Robot primary source',author:'Author',publishedAt:'2026-10-21',scope,text:'A verified primary claim.',mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null},0)
 fs.writeFileSync(path.join(directory,'robot.mp4'),'controlled video bytes')
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
