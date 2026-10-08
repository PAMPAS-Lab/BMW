import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {assertImageInspection} from '../../media-native/src/image-contract.js'
import {assertMediaInspection} from '../../media-native/src/media-port.js'
import {assertCoverOptions,assertCoverReceipt} from '../../media-native/src/media/processing.cover-contract.js'
import {assertReferenceRecords,referenceNotes} from './studio-reference-contract.js'
import type {StudioReferenceRecord,StudioReferenceFrame} from './studio-reference-contract.js'
import type {StudioKernel} from './studio-service.js'
import type {VideoStudioStore} from './studio-store.js'
import type {VideoDraft,StudioRequest} from './studio-contract.js'
async function fingerprint(directory:string,id:string,signal?:AbortSignal):Promise<string>{const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{if(io.bytes>256*1024*1024)throw new Error('Reference exceeds 256 MiB.');return await io.fingerprint(signal)}finally{await io.close()}}
function reply(record:StudioReferenceRecord,directory:string){return {reference:record,frames:record.frames.map(f=>({...f,path:path.join(directory,f.artifactId),type:'screenshot' as const,contentType:'image/png' as const}))}}
export async function referenceOperation(kernel:StudioKernel,store:VideoStudioStore,draft:VideoDraft,request:StudioRequest,directory:string,guard:()=>void,actor:'user'|'agent',signal?:AbortSignal):Promise<unknown>{
 const check=()=>{signal?.throwIfAborted();guard()}
 const records=structuredClone(draft.referenceRecords??[])
 if(request.operation==='remove-reference'){
  if(actor!=='user')throw new Error('STUDIO_REFERENCE_USER_REQUIRED: 请由用户移除参考记录。')
  const index=records.findIndex(r=>r.id===request.referenceId);if(index<0)throw new Error('Unknown prepared reference.')
  records.splice(index,1);check();return {draft:store.recordReference(draft.id,draft.revision,records),removedReferenceId:request.referenceId}
 }
 if(request.operation==='prepare-reference'){
  if(records.length>=8)throw new Error('STUDIO_REFERENCE_BUDGET: 此草稿已保存八份参考取帧记录。')
  const id=request.artifactId!,kind=request.assetKind!;if(!store.assets(path.dirname(directory)).some(a=>a.artifactId===id&&a.kind===kind))throw new Error('Choose a current Project image or video reference.')
  check();const sourceSha256=await fingerprint(directory,id,signal),sourceStat=await fs.lstat(path.join(directory,id)),before=new Set(await fs.readdir(directory)),root=await fs.realpath(directory),identity=await fs.lstat(root),owned=new Map<string,{dev:number;ino:number}>();let committed=false
  const claim=async(raw:unknown)=>{const id=assertArtifactId(mediaRecord(raw).artifactId),stat=await fs.lstat(path.join(root,id));if(before.has(id)||!stat.isFile()||stat.isSymbolicLink())throw new Error('Reference frame is not a newly owned Project artifact.');owned.set(id,{dev:stat.dev,ino:stat.ino});return id}
  try{
   let width:number,height:number,durationSeconds=0,videoRange:StudioReferenceRecord['videoRange'],frames:StudioReferenceFrame[]=[]
   if(kind==='image'){
    const info=assertImageInspection(await kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:id},signal));width=info.width;height=info.height;check()
    const native=mediaRecord(await kernel.recordingController.processArtifact({action:'video.cover',width:640,height:360,sourceKind:'image',options:assertCoverOptions({title:'',subtitle:'',sourceArtifactId:id,fit:'contain',timestampSeconds:0})},signal)),frameId=await claim(native);check();assertCoverReceipt(native,640,360)
    frames=[{artifactId:frameId,sha256:await fingerprint(root,frameId,signal),width:640,height:360,requestedSeconds:0,seconds:0}]
   }else{
    const raw=await kernel.recordingController.processArtifact({action:'media.inspect',artifactId:id},signal),info=assertMediaInspection(raw),track=info.tracks.find(t=>t.type==='video'&&t.canDecode)
    if(!track?.width||!track.height||track.hasAlphaData)throw new Error('Reference requires a decodable opaque video track.');width=track.width;height=track.height;durationSeconds=info.durationSeconds;check()
    const first=finiteNumber(Math.max(0,track.startSeconds??Number(mediaRecord(raw).firstTimestampSeconds??0)),'first video time',0,durationSeconds),end=finiteNumber(track.endSeconds??durationSeconds,'video endpoint',first,durationSeconds),span=end-first;videoRange={startSeconds:first,endSeconds:end};if(span<=0)throw new Error('Reference has no playable video interval.')
    const times=request.timestampsSeconds??[first,first+span*.5,first+span*.9];if(times.some(t=>t<first||t>=end)||new Set(times).size!==times.length)throw new Error('Reference sample times must be distinct and within the source.')
    const native=mediaRecord(await kernel.recordingController.processArtifact({action:'media.frames.sample',artifactId:id,timestampsSeconds:times,maxWidth:640,maxHeight:360},signal))
    if(!Array.isArray(native.frames)||native.frames.length>8)throw new Error('Invalid reference native frame collection.')
    const frameIds:string[]=[];for(const raw of native.frames)frameIds.push(await claim(raw))
    check();if(native.type!=='frame-set'||native.sourceArtifactId!==id||native.frames.length!==times.length)throw new Error('Invalid reference native receipt.')
    for(const [index,raw]of native.frames.entries()){
     const f=mediaRecord(raw);if(f.outputIndex!==index||f.requestedTimestampSeconds!==times[index]||f.type!=='screenshot'||f.contentType!=='image/png')throw new Error('Reference frame identity does not match requested time.')
     const seconds=finiteNumber(f.timestampSeconds,'sampled source time',first,times[index]),image=assertImageInspection(await kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:frameIds[index]},signal));check()
     if(f.width!==image.width||f.height!==image.height||image.contentType!=='image/png'||image.width>640||image.height>360)throw new Error('Reference PNG does not match native dimensions.')
     frames.push({artifactId:frameIds[index],sha256:await fingerprint(root,frameIds[index],signal),width:image.width,height:image.height,requestedSeconds:times[index],seconds})
    }
   }
   if(await fingerprint(root,id,signal)!==sourceSha256)throw new Error('STUDIO_REFERENCE_STALE: 参考源文件已变化，请重新取帧。');check()
   const record:StudioReferenceRecord={id:crypto.randomUUID(),sourceArtifactId:id,sourceSha256,sourceBytes:sourceStat.size,kind:kind as 'image'|'video',width,height,durationSeconds,createdAt:new Date().toISOString(),revision:draft.revision,...(videoRange?{videoRange}:{}),frames}
   records.push(record);assertReferenceRecords(records);check();const updated=store.recordReference(draft.id,draft.revision,records);committed=true;return {draft:updated,...reply(record,root),coverage:kind==='image'?'static-image':'sampled-frames',semanticAnalysis:'pending'}
  }finally{if(!committed){const current=await fs.lstat(root);if(current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino||await fs.realpath(directory)!==root)throw new Error('Reference cleanup directory identity changed.');for(const [id,stat]of owned){const current=await fs.lstat(path.join(root,id)).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(current?.dev===stat.dev&&current.ino===stat.ino&&!current.isSymbolicLink())await fs.unlink(path.join(root,id))}}}
 }
 const record=records.find(r=>r.id===request.referenceId);if(!record)throw new Error('Unknown prepared reference.')
 if(await fingerprint(directory,record.sourceArtifactId,signal)!==record.sourceSha256)throw new Error('STUDIO_REFERENCE_STALE: 参考源文件已变化，请重新取帧。');check()
 for(const frame of record.frames){if(await fingerprint(directory,frame.artifactId,signal)!==frame.sha256)throw new Error('STUDIO_REFERENCE_STALE: 参考帧已变化，请重新取帧。');check()}
 if(await fingerprint(directory,record.sourceArtifactId,signal)!==record.sourceSha256)throw new Error('STUDIO_REFERENCE_STALE: 参考源在读取期间发生变化。');check()
 if(request.operation==='read-reference')return {...reply(record,directory),coverage:record.kind==='image'?'static-image':'sampled-frames',semanticAnalysis:record.analysis?'author-supplied':'pending'}
 if(request.operation==='set-reference-analysis'){
  const analysis=request.referenceAnalysis!;if(analysis.observations.some(o=>o.frameIndex>=record.frames.length))throw new Error('Reference observation targets an unsampled frame.')
  const same=JSON.stringify(analysis)===JSON.stringify(record.analysis);if(actor!=='user'&&record.analysisOrigin==='user'&&!same)throw new Error('STUDIO_REFERENCE_EDITED: 保留用户校正的参考分析。')
  record.analysis=analysis;record.analysisOrigin=same?record.analysisOrigin:actor;assertReferenceRecords(records);check();return {draft:store.recordReference(draft.id,draft.revision,records),reference:record}
 }
 if(request.operation==='apply-reference-notes'){
  if(actor!=='user')throw new Error('STUDIO_REFERENCE_USER_REQUIRED: 请由用户确认将参考分析加入制作背景。')
  if(request.beforeNotes!==draft.preparation.notes)throw new Error('STUDIO_CONFLICT: 制作背景已变化，请重新查看后合并。')
  const block=referenceNotes(record);draft.preparation.notes=[draft.preparation.notes,block].filter(Boolean).join('\n\n');check();return {draft:store.update(draft.id,draft.revision,draft),reference:record}
 }
 throw new Error('Unknown reference operation.')
}
