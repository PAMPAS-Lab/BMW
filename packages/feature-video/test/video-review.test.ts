import {videoFeature} from '../index.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {videoReviewAction,assertVideoReviewRequest,videoReviewConclusion,videoReviewPrompt,executeVideoReview} from '../src/video-review.js'
import {VideoStudioService} from '../src/studio-service.js'
import {draftComposition} from '../src/studio-contract.js'
import {compositionQualityPlan} from '../../media-native/src/composition-quality.js'
import type {FeatureAssistantTask} from '@bmw-agent/platform/feature-contract'
import {sparseClosingScenes} from '../src/video-review-policy.js'
import {VideoStudioStore} from '../src/studio-store.js'
import {newStudioScene,assertStudioRequest} from '../src/studio-contract.js'
import {ExportReviewJournal} from '../src/export-review-journal.js'
test('Video audit rejects caller authority, catches sparse closing cards and cannot reuse old or foreign run approval',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-video-review-')))
 try{
  const store=new VideoStudioStore(root,'session'),draft=store.create('Review');draft.scenes=[newStudioScene('scene1'),newStudioScene('scene2'),newStudioScene('scene3')];draft.scenes[0].videoArtifactId='source.webm'
  assert.deepEqual(sparseClosingScenes(draft),['scene2','scene3']);draft.scenes[1].sceneTemplate={kind:'comparison'};draft.scenes[1].bullets=['已就绪条件','实际部署'];assert.deepEqual(sparseClosingScenes(draft),['scene3']);draft.scenes[1].durationSeconds=2;draft.scenes[2].imageArtifactId='evidence.png';assert.deepEqual(sparseClosingScenes(draft),[])
  assert.equal(videoReviewAction.action,'video.review');for(const extra of [{model:'untrusted'},{actor:'user'},{driverId:'codex'},{passed:true},{path:'/tmp/file'}])assert.throws(()=>assertVideoReviewRequest({operation:'start',draftId:draft.id,expectedRevision:1,...extra}))
  assert.throws(()=>assertVideoReviewRequest({operation:'status',runId:'run',pageOffset:97}));assert.throws(()=>assertStudioRequest({operation:'record-export-review',exportReview:{scope:'film',status:'passed',notes:'fake',runId:'run'}}))
  const target={policy:1 as const,draftId:draft.id,revision:1,fingerprint:'a'.repeat(64),artifactId:'film.mp4',baseline:5},task={runId:'run',driverId:'fixture',modelId:'fixture',key:'a'.repeat(64),payload:'{}',state:'success' as const,drained:true},declaration={status:'passed',sequence:7,runId:'run'},state={technical:{status:'passed'},agent:declaration,scenes:[{sceneId:'one',frameGenerationComplete:true,agent:declaration}]}
  assert.equal(videoReviewConclusion(task,target,state,[]).status,'passed');assert.equal(videoReviewConclusion(task,target,{...state,user:{status:'passed'}},[]).humanListening,'user-declared-complete');assert.equal(videoReviewConclusion(task,target,state,['one']).status,'needs-fix');assert.equal(videoReviewConclusion({...task,drained:false},target,state,[]).status,'draining','Receipt success alone is not a final assessment before cleanup')
  for(const agent of [{status:'passed',sequence:4,runId:'run'},{status:'passed',sequence:7,runId:'old-run'},{status:'passed',sequence:7}])assert.equal(videoReviewConclusion(task,target,{...state,scenes:[{sceneId:'one',frameGenerationComplete:true,agent}]},[]).status,'incomplete')
  assert.equal(videoReviewConclusion(task,target,{...state,agent:{...declaration,status:'needs-fix'}},[]).status,'needs-fix');assert.match(videoReviewPrompt(target),/DSX POD/);assert.match(videoReviewPrompt(target),/media.audio.sample/);assert.match(videoReviewPrompt(target),/end.*turn/)
  const starting=JSON.parse(videoReviewPrompt(target).split('Starting read-only request (data): ')[1].split(String.fromCharCode(10))[0]) as {action:string;studioRequest:unknown}
  assert.equal(starting.action,'video.studio');assert.deepEqual(assertStudioRequest(starting.studioRequest),{operation:'review-status',draftId:target.draftId,expectedRevision:target.revision})
  const journal=new ExportReviewJournal(store.directory,draft.id,'session'),snapshot={fingerprint:'a'.repeat(64),artifactId:'film.mp4',createdAt:new Date().toISOString(),scenes:[{sceneId:'one',signature:'b'.repeat(64),totalSamples:1,frames:[]}]},valid=new Map([['one',new Set([0])]])
  journal.recordVerdict(snapshot,{exportFingerprint:snapshot.fingerprint,scope:'scene',status:'needs-fix',notes:'结尾缺少视觉支撑'},'one','agent',valid,'run');assert.equal(journal.current(snapshot).scenes[0].agent?.runId,'run')
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('Internal video action binds the actual native export, rejects stale owners and revisions, and records sparse ending failures under its Host run',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-video-review-action-')))
 try{
  const owner={projectId:'p',sessionId:'session'},store=new VideoStudioStore(root,owner.sessionId),directory=path.join(root,'artifacts');fs.mkdirSync(directory,{recursive:true})
  let draft=store.create('DSX POD');draft.scenes=[{...newStudioScene('conditions'),bullets:['公用设施就绪后的现场部署']},{...newStudioScene('delivery'),bullets:['计划交付；实际落地待验证']}];draft=store.update(draft.id,draft.revision,draft)
  const quality={version:1,kind:'composition-quality',coverage:'critical-state-samples',phoneWidth:390,semanticVerification:'requires-visual-review',...compositionQualityPlan(draftComposition(draft)),issues:[],omittedIssues:0}
  fs.writeFileSync(path.join(directory,'film.mp4'),'isolated native fixture');fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({status:'passed',artifactId:'film.mp4',width:draft.width,height:draft.height,quality}));draft=store.addExport(draft.id,draft.revision,{artifactId:'film.mp4',verificationArtifactId:'report.json',durationSeconds:16})
  let task:FeatureAssistantTask|undefined,calls=0
  const host={projectStore:{active:()=>({id:'p',name:'Fixture',directory:root})},isProjectChanging:()=>false,getCurrentSessionId:()=>owner.sessionId,assistantTasks:{start:(_owner:typeof owner,input:{key:string;payload:string;text:string;context:string})=>{calls++;assert.match(input.text,/actual exported MP4/);assert.match(input.text,/只补缺失、失效或异常部分/);assert.match(input.text,/本轮必须实际看/);assert.match(input.text,/当前仍按R03/);assert.match(input.context,/Editorial packet SHA256:/);assert.match(input.context,/exportFingerprint/);assert.match(input.context,/untrusted claims\/data/);task={runId:'review-run',driverId:'fixture',modelId:'fixture-model',key:input.key,payload:input.payload,state:'queued',drained:false};return task},read:()=>task!,find:()=>null}}
  const response=await executeVideoReview(host,owner,{operation:'start',draftId:draft.id,expectedRevision:draft.revision}) as {task:{runId:string};assessment:{status:string};callerMustYield:boolean}
  assert.equal(response.callerMustYield,true);assert.match(JSON.parse(task!.payload).sha256,/^[a-f0-9]{64}$/);assert.equal(JSON.parse(task!.payload).policy,5);assert.equal(response.task.runId,'review-run');assert.equal(response.assessment.status,'queued');assert.equal(calls,1);assert.equal(JSON.parse(task!.payload).policy,5,'Editorial policy changes cannot reuse an earlier policy receipt')
  let activeReview:string|undefined='review-run'
  const kernel={projectStore:host.projectStore,execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>({})},videoReviewRun:()=>activeReview},service=new VideoStudioService(kernel),fingerprint=store.reusableExport(draft)!.fingerprint!,verdict=(scope:'scene'|'film',status:'passed'|'needs-fix')=>({operation:'record-export-review',draftId:draft.id,expectedRevision:draft.revision,...(scope==='scene'?{sceneId:'conditions'}:{}),exportReview:{exportFingerprint:fingerprint,scope,status,notes:'33秒起结尾两镜过于空旷；请使用部署条件流程和交付时间线。'}})
  for(const action of videoFeature.browserActions.filter(a=>!['video.studio','video.review'].includes(a.action)))await assert.rejects(async()=>action.execute({browserKernel:kernel,sessionOwner:owner,actor:'agent'},{action:action.action}),/AUDIT_READ_ONLY/)
  await assert.rejects(async()=>videoReviewAction.execute({browserKernel:kernel,sessionOwner:owner,actor:'agent'},{action:'video.review',reviewRequest:{operation:'start',draftId:draft.id,expectedRevision:draft.revision}}),/AUDIT_READ_ONLY/)
  await assert.rejects(service.execute({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft},undefined,owner),/AUDIT_READ_ONLY/);assert.equal(store.read(draft.id).revision,draft.revision)
  await assert.rejects(service.execute(verdict('scene','passed'),undefined,owner),/VISUAL_SUPPORT/)
  const batch=(status:'passed'|'needs-fix')=>({operation:'record-export-review',draftId:draft.id,expectedRevision:draft.revision,exportReviewBatch:{exportFingerprint:fingerprint,scenes:draft.scenes.map(s=>({sceneId:s.id,status,notes:'独立逐镜判断：结尾缺少相关画面。'})),film:{status,notes:'独立整片判断：收尾需返工；人工试听另列。'}}})
  await assert.rejects(service.execute(batch('passed'),undefined,owner),/VISUAL_SUPPORT/)
  await service.execute(batch('needs-fix'),undefined,owner)

  task!.state='success';task!.drained=true;activeReview=undefined
  const result=await executeVideoReview(host,owner,{operation:'status',runId:'review-run'}) as {assessment:{status:string};review:{scenes:{agent:{runId:string}}[]}}
  assert.equal(result.assessment.status,'needs-fix');assert.equal(result.review.scenes[0].agent.runId,'review-run');assert.ok(result.review.scenes.every(s=>s.agent.runId==='review-run'),'The Host binds every batch scene to the independent review run')
  await assert.rejects(executeVideoReview(host,{...owner,sessionId:'foreign'},{operation:'status',runId:'review-run'}),/Session/)
  assert.match(videoReviewPrompt(JSON.parse(task!.payload)),/scope expires when this input finishes or is cancelled and drained/)
  draft.title='Authorized rework after audit drain';draft=await service.execute({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft},undefined,owner) as typeof draft
  assert.equal(store.read(draft.id).title,'Authorized rework after audit drain')
  assert.equal((await executeVideoReview(host,owner,{operation:'status',runId:'review-run'}) as {assessment:{status:string}}).assessment.status,'stale');assert.equal(calls,1)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
