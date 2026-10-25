import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {mediaRecord} from '../../media-native/src/media-contract.js'
import {assertCompositionQuality} from '../../media-native/src/composition-quality.js'
import type {CompositionQuality} from '../../media-native/src/composition-quality.js'
import {compositionAssets} from '../../media-native/src/composition-contract.js'
import {draftComposition} from './studio-contract.js'
import type {VideoDraft,StudioRequest} from './studio-contract.js'
import {STUDIO_EXPORT_RENDERER_VERSION} from './studio-store.js'
import type {VideoStudioStore} from './studio-store.js'
import {ExportReviewJournal} from './export-review-journal.js'
import type {ExportReviewSnapshot} from './export-review-journal.js'
import {VIDEO_VISUAL_REVIEW_POLICY,sparseClosingScenes} from './video-review-policy.js'
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v
function snapshot(draft:VideoDraft,output:VideoDraft['exports'][number],quality:CompositionQuality,directory:string):ExportReviewSnapshot {
 const composition=draftComposition(draft),{scenes,...settings}=composition;let startSeconds=0
 return {fingerprint:output.fingerprint!,artifactId:output.artifactId,createdAt:output.createdAt,scenes:scenes.map((scene,index)=>{
  const assets=compositionAssets({...composition,scenes:[scene]}).sort().map(id=>{const stat=fs.lstatSync(path.join(directory,id),{bigint:true});if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Review material unavailable.');return [id,String(stat.size),String(stat.mtimeNs),String(stat.ctimeNs),String(stat.ino)]}),signature=crypto.createHash('sha256').update(JSON.stringify(canonical({renderer:STUDIO_EXPORT_RENDERER_VERSION,settings,scene,startSeconds,assets}))).digest('hex');startSeconds+=scene.durationSeconds
  return {sceneId:draft.scenes[index].id,signature,totalSamples:quality.samples.filter(s=>s.sceneIndex===index).length,frames:[]}
 })}
}
export async function currentExportReview(store:VideoStudioStore,draft:VideoDraft,directory:string,guard:()=>void,signal?:AbortSignal){
 const check=()=>{signal?.throwIfAborted();guard()},output=store.reusableExport(draft)
 check();if(!output?.verificationArtifactId)throw new Error('STUDIO_REVIEW_EXPORT_REQUIRED: 请先制作当前版本的视频。')
 const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:output.verificationArtifactId});let quality:CompositionQuality,technicalStatus:'passed'|'unrecorded',technicalSummary:Record<string,unknown>={}
 try{if(input.bytes>512*1024)throw new Error('Quality report exceeds its byte budget.');const report=mediaRecord(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await input.read(0,input.bytes))));if(report.artifactId!==output.artifactId||report.width!==draft.width||report.height!==draft.height)throw new Error('Quality report does not match current export.');if(!report.quality)throw new Error('STUDIO_REVIEW_REPORT_REQUIRED: 旧成片没有画面检查记录，请明确重新制作。');quality=assertCompositionQuality(report.quality);technicalStatus=report.status==='passed'?'passed':'unrecorded';technicalSummary={width:draft.width,height:draft.height,...(typeof report.actualDurationSeconds==='number'&&Number.isFinite(report.actualDurationSeconds)?{actualDurationSeconds:report.actualDurationSeconds}:{}),tracks:(Array.isArray(report.tracks)?report.tracks.slice(0,16):[]).map(mediaRecord).filter(t=>['video','audio'].includes(String(t.type))&&t.canDecode===true&&typeof t.startSeconds==='number'&&Number.isFinite(t.startSeconds)&&typeof t.endSeconds==='number'&&Number.isFinite(t.endSeconds)&&t.endSeconds>t.startSeconds).map(t=>({type:t.type,startSeconds:t.startSeconds,endSeconds:t.endSeconds,codec:typeof t.codec==='string'?t.codec.slice(0,40):null}))}}finally{await input.close()}
 check();if(store.reusableExport(draft)?.fingerprint!==output.fingerprint)throw new Error('STUDIO_CONFLICT: 成片或来源已变化，请重新审片。')
 return {output,quality,technicalStatus,technicalSummary,snapshot:snapshot(draft,output,quality,directory),journal:new ExportReviewJournal(store.directory,draft.id,store.ownerSessionId!)}
}
async function validFrames(context:Awaited<ReturnType<typeof currentExportReview>>,directory:string,signal?:AbortSignal){
 const valid=new Map<string,Set<number>>(),current=context.journal.current(context.snapshot)
 for(const [sceneIndex,scene]of current.scenes.entries()){
  const indices=new Set<number>(),samples=context.quality.samples.filter(s=>s.sceneIndex===sceneIndex);valid.set(scene.sceneId,indices)
  for(const f of scene.frames){signal?.throwIfAborted();if(samples[f.index]?.seconds!==f.seconds)continue
   let input:ArtifactJobIO|undefined
   try{input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:f.artifactId});if(await input.fingerprint(signal)===f.sha256)indices.add(f.index)}catch{signal?.throwIfAborted()}finally{await input?.close()}
  }
 }
 return valid
}
export async function exportReviewState(store:VideoStudioStore,draft:VideoDraft,request:StudioRequest,directory:string,guard:()=>void,actor:'agent'|'user',signal?:AbortSignal,runId?:string){
 const context=await currentExportReview(store,draft,directory,guard,signal),valid=await validFrames(context,directory,signal)
 signal?.throwIfAborted();guard();if(store.reusableExport(draft)?.fingerprint!==context.output.fingerprint)throw new Error('STUDIO_CONFLICT: 成片或来源已变化，请重新审片。')
 const sparse=sparseClosingScenes(draft)
 if(request.operation==='record-export-review'){
  if(actor==='agent'&&request.exportReview?.status==='passed'&&(request.exportReview.scope==='film'?sparse.length>0:sparse.includes(request.sceneId!)))throw new Error('STUDIO_REVIEW_VISUAL_SUPPORT: 结尾长文字卡缺少素材或图解支撑，请记录需修改并重做，不能仅因文字未溢出判通过。')
  if(request.exportReviewBatch){
   const b=request.exportReviewBatch
   if(actor==='agent'&&(b.film.status==='passed'&&sparse.length>0||b.scenes.some(s=>s.status==='passed'&&sparse.includes(s.sceneId))))throw new Error('STUDIO_REVIEW_VISUAL_SUPPORT: Batch cannot approve unsupported visual scenes.')
   context.journal.recordBatch(context.snapshot,b,actor,valid,runId)
   const state=context.journal.status(context.snapshot,valid)
   return {draftId:draft.id,revision:draft.revision,exportFingerprint:context.snapshot.fingerprint,sourceArtifactId:context.output.artifactId,committed:true,technical:{status:context.technicalStatus},agent:state.agent,user:state.user,scenes:state.scenes.map(s=>({sceneId:s.sceneId,frameGenerationComplete:s.frameGenerationComplete,agent:s.agent,user:s.user})),humanListening:'separate-user-declaration',next:null}
  }
  context.journal.recordVerdict(context.snapshot,request.exportReview!,request.sceneId,actor,valid,runId)
 }
 return {draftId:draft.id,revision:draft.revision,visualSupport:{status:sparse.length?'needs-fix':'requires-visual-review',sparseClosingSceneIds:sparse,method:'structural-risk-screen; not pixel or semantic certification',policy:VIDEO_VISUAL_REVIEW_POLICY},technical:{status:context.technicalStatus,reportArtifactId:context.output.verificationArtifactId},layout:{status:context.quality.issues.length||context.quality.omittedIssues?'issues-present':'no-issues-in-samples',issueCount:context.quality.issues.length,omittedIssues:context.quality.omittedIssues,omittedCandidates:context.quality.omittedCandidates,coverage:context.quality.coverage,semanticVerification:context.quality.semanticVerification},...context.journal.status(context.snapshot,valid)}
}
