import fs from 'node:fs/promises'
import path from 'node:path'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {currentExportReview} from './studio-export-review-state.js'
import type {StudioKernel} from './studio-service.js'
import type {VideoStudioStore} from './studio-store.js'
import type {VideoDraft,StudioRequest} from './studio-contract.js'

/** Review only a fingerprint-valid export of the owned current draft. Sampling
 * never edits the draft or grants semantic approval, and rolls back on a race. */
export async function reviewStudioExport(kernel:StudioKernel,store:VideoStudioStore,draft:VideoDraft,request:StudioRequest,directory:string,guard:()=>void,signal?:AbortSignal):Promise<unknown>{
 const check=()=>{signal?.throwIfAborted();guard()}
 const context=await currentExportReview(store,draft,directory,guard,signal),{output,quality}=context
 const sceneIndex=draft.scenes.findIndex(s=>s.id===request.sceneId);if(sceneIndex<0)throw new Error('Unknown review scene.')
 check();const samples=quality.samples.filter(s=>s.sceneIndex===sceneIndex),offset=request.reviewOffset??0,selected=samples.slice(offset,offset+8)
 if(!selected.length)throw new Error('No review samples in this page.')
 const before=new Set(await fs.readdir(directory)),root=await fs.realpath(directory),identity=await fs.lstat(directory),owned=new Map<string,{dev:number;ino:number}>();let complete=false
 try{
  const result=mediaRecord(await kernel.recordingController.processArtifact({action:'media.frames.sample',artifactId:output.artifactId,timestampsSeconds:selected.map(s=>s.seconds),maxWidth:390,maxHeight:720},signal))
  if(!Array.isArray(result.frames)||result.frames.length>8)throw new Error('Invalid export review frame collection.')
  for(const raw of result.frames){const f=mediaRecord(raw),id=assertArtifactId(f.artifactId),stat=await fs.lstat(path.join(root,id));if(before.has(id)||!stat.isFile()||stat.isSymbolicLink())throw new Error('Export review frame is not newly owned.');owned.set(id,{dev:stat.dev,ino:stat.ino})}
  if(result.type!=='frame-set'||result.sourceArtifactId!==output.artifactId||result.frames.length!==selected.length)throw new Error('Invalid export review sampling receipt.')
  const frames=[]
  for(const [i,raw]of result.frames.entries()){
   const f=mediaRecord(raw);if(f.outputIndex!==i||f.requestedTimestampSeconds!==selected[i].seconds||f.type!=='screenshot'||f.contentType!=='image/png')throw new Error('Export review sampled the wrong state.')
   const id=assertArtifactId(f.artifactId),input=await ArtifactJobIO.open(root,{action:'media.inspect',artifactId:id});let sha256:string
   try{sha256=await input.fingerprint(signal)}finally{await input.close()}
   frames.push({...selected[i],artifactId:id,path:path.join(root,id),sha256,bytes:input.bytes,type:'screenshot',contentType:'image/png',width:finiteNumber(f.width,'review frame width',1,390,true),height:finiteNumber(f.height,'review frame height',1,720,true),actualSeconds:finiteNumber(f.timestampSeconds,'decoded frame time',0,selected[i].seconds)})
  }
  check();const current=store.reusableExport(draft);if(current?.artifactId!==output.artifactId||current.fingerprint!==output.fingerprint)throw new Error('STUDIO_CONFLICT: 成片或来源已变化，请重新审片。')
  const sceneIssues=quality.issues.filter(i=>i.sceneIndex===sceneIndex),shownIssues=sceneIssues.slice(0,12)
  context.journal.recordFrames(context.snapshot,request.sceneId!,frames.map((f,i)=>({index:offset+i,artifactId:f.artifactId,sha256:f.sha256,seconds:f.seconds})))
  complete=true;return {type:'frame-set',draftId:draft.id,revision:draft.revision,sourceArtifactId:output.artifactId,exportFingerprint:output.fingerprint,sceneId:request.sceneId,totalSceneSamples:samples.length,nextOffset:offset+selected.length<samples.length?offset+selected.length:null,frames,quality:{...quality,samples:selected,issues:shownIssues,omittedIssues:quality.omittedIssues+sceneIssues.length-shownIssues.length},qualityScope:'scene-page',qualitySummary:{filmSamples:quality.samples.length,filmIssues:quality.issues.length,sceneIssues:sceneIssues.length,reportArtifactId:output.verificationArtifactId},coverage:'actual-export-critical-state-samples',semanticVerification:'requires-visual-review'}
 }finally{if(!complete){const current=await fs.lstat(directory);if(current.dev!==identity.dev||current.ino!==identity.ino||current.isSymbolicLink()||await fs.realpath(directory)!==root)throw new Error('Export review cleanup Project changed.');for(const [id,stat]of owned){const current=await fs.lstat(path.join(root,id)).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(current?.dev===stat.dev&&current.ino===stat.ino&&!current.isSymbolicLink())await fs.unlink(path.join(root,id))}}}
}
