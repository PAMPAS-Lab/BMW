import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {assertMediaInspection} from '../../media-native/src/media-port.js'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {exportProjectText} from '../../media-native/src/text-export.js'
import {analysisCoverage,analysisTargets,analysisIntervals,analysisChangeCandidates,SOURCE_ANALYSIS_LIMITS} from './source-analysis-contract.js'
import type {AnalysisRequest,SourceAnalysis,AnalysisFrame} from './source-analysis-contract.js'
import {SourceAnalysisStore} from './source-analysis-store.js'
import type {StudioKernel} from './studio-service.js'

export class SourceAnalysisService {
 constructor(private kernel:StudioKernel,private scope:{projectId:string;sessionId:string;draftId:string;directory:string},private guard:()=>void,private actor:'user'|'agent'){}
 async execute(request:AnalysisRequest,signal?:AbortSignal):Promise<unknown>{
  const check=()=>{signal?.throwIfAborted();this.guard()},store=new SourceAnalysisStore(this.scope),directory=path.join(this.scope.directory,'artifacts');check()
  if(request.operation==='list')return {analyses:(await store.list()).map(job=>({id:job.id,revision:job.revision,sourceArtifactId:job.sourceArtifactId,createdAt:job.createdAt,coverage:analysisCoverage(job),sourceVerification:'required-on-consumption'})),limits:SOURCE_ANALYSIS_LIMITS}
  if(request.operation==='create'){
   const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:request.artifactId});try{const sourceSha256=await io.fingerprint(signal),info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:request.artifactId},signal)),track=info.tracks.find(t=>t.type==='video'&&t.canDecode);if(!track?.width||!track.height||track.hasAlphaData||info.durationSeconds>1800)throw new Error('Analysis requires finite opaque decodable video up to 30 minutes.');const startSeconds=Math.max(0,track.startSeconds??0),endSeconds=track.endSeconds??info.durationSeconds;analysisTargets(startSeconds,endSeconds,[]);if(await io.fingerprint(signal)!==sourceSha256)throw new Error('Analysis source changed during inspection.');const job:SourceAnalysis={version:1,id:crypto.randomUUID(),projectId:this.scope.projectId,sessionId:this.scope.sessionId,draftId:this.scope.draftId,revision:1,createdAt:new Date().toISOString(),sourceArtifactId:request.artifactId,sourceSha256,sourceBytes:io.bytes,startSeconds,endSeconds,intervals:[],frames:[],failures:[]};check();return {analysis:this.summary(await store.commit(job,0,check)),frames:[]}}finally{await io.close()}
  }
  let job=await store.read(request.analysisId);if(!job)throw new Error('Unknown source analysis.');if(job.revision!==request.expectedRevision)throw new Error('SOURCE_ANALYSIS_CONFLICT: Read the current analysis revision.');const source=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:job.sourceArtifactId})
  try{
   if(source.bytes!==job.sourceBytes||await source.fingerprint(signal)!==job.sourceSha256)throw new Error('SOURCE_ANALYSIS_STALE: 来源已变化，请重新创建分析。');check()
   const commit=async()=>{if(await source.fingerprint(signal)!==job.sourceSha256)throw new Error('SOURCE_ANALYSIS_STALE: Source changed before commit.');check();job=await store.commit(job,job.revision,check)}
   const targets=()=>analysisTargets(job.startSeconds,job.endSeconds,job.intervals)
   if(request.operation==='densify'){
    const old=targets(),ranges=analysisIntervals([...job.intervals,...request.intervals]);const next=analysisTargets(job.startSeconds,job.endSeconds,ranges),indices=new Map(next.map((t,i)=>[t.requestedSeconds.toFixed(6),i]));job.frames=job.frames.map(f=>({...f,index:indices.get(old[f.index].requestedSeconds.toFixed(6))!}));job.failures=job.failures.map(f=>({...f,index:indices.get(old[f.index].requestedSeconds.toFixed(6))!}));job.intervals=ranges;await commit();return {analysis:this.summary(job),frames:[]}
   }
   if(request.operation==='retry'){if(request.indices.some(i=>!job.failures.some(f=>f.index===i)))throw new Error('Retry requires recorded failed frame indices.');job.failures=job.failures.filter(f=>!request.indices.includes(f.index));await commit();return {analysis:this.summary(job),frames:[]}}
   if(request.operation==='review'){
    for(const index of request.indices){const f=job.frames.find(f=>f.index===index);if(!f)throw new Error('Review requires an extracted frame.');await this.verifyFrame(directory,f,signal);if(this.actor!=='user'&&f.review?.origin==='user'&&f.review.note!==request.note)throw new Error('Preserve user-corrected analysis.');f.review={origin:f.review?.origin==='user'?'user':this.actor,note:request.note}}
    await commit();return {analysis:this.summary(job),frames:[]}
   }
   if(request.operation==='export'){
    const plan=targets(),frames=new Map(job.frames.map(f=>[f.index,f]));let size=Math.min(200,Math.max(0,plan.length-request.offset))
    const reportFor=(count:number)=>({analysis:this.summary(job),coverage:analysisCoverage(job),sampling:'2fps baseline; selected intervals 8fps, overlapping baseline points reused',intervals:job.intervals,targets:this.targetPage(job,request.offset,count),frames:Array.from({length:count},(_,i)=>frames.get(request.offset+i)).filter((f):f is AnalysisFrame=>Boolean(f)),failures:job.failures.filter(f=>f.index>=request.offset&&f.index<request.offset+count),nextOffset:request.offset+count<plan.length?request.offset+count:null,limitations:['No audio audition','Not all source frames decoded','No exhaustive transition detection','Review is author-supplied; not fact certification']})
    let report=reportFor(size),text=JSON.stringify(report,null,2)
    while(Buffer.byteLength(text,'utf8')>512*1024&&size>1){size=Math.max(1,Math.floor(size/2));report=reportFor(size);text=JSON.stringify(report,null,2)}
    for(const frame of report.frames){check();await this.verifyFrame(directory,frame,signal)}
    if(await source.fingerprint(signal)!==job.sourceSha256)throw new Error('SOURCE_ANALYSIS_STALE: Source changed during report export.')
    const output=await exportProjectText(directory,'json',text,signal,check);return {...output,reportPage:report.nextOffset,analysis:this.summary(job),frames:[]}
   }
   if(request.operation==='read'){
    const page=job.frames.filter(f=>f.index>=request.offset&&f.index<request.offset+8).sort((a,b)=>a.index-b.index);for(const f of page){await this.verifyFrame(directory,f,signal);check()}if(await source.fingerprint(signal)!==job.sourceSha256)throw new Error('SOURCE_ANALYSIS_STALE: Source changed during read.');return {analysis:this.summary(job),frames:page.map(f=>this.image(f,directory)),targets:this.targetPage(job,request.offset,8),nextOffset:request.offset+8<targets().length?request.offset+8:null}
   }
   const extracted=new Set(job.frames.map(f=>f.index)),failed=new Set(job.failures.map(f=>f.index)),pending=targets().map((t,index)=>({...t,index})).filter(t=>!extracted.has(t.index)&&!failed.has(t.index)).slice(0,8)
   if(!pending.length)return {analysis:this.summary(job),frames:[],nextOffset:null}
   // Each step is atomic. Cancellation never records false failures; committed pages survive restart.
   const directoryIdentity=await fs.lstat(directory),before=new Set(await fs.readdir(directory)),owned=new Map<string,{dev:number;ino:number}>();let saved=false
   try{
    const value=mediaRecord(await this.kernel.recordingController.processArtifact({action:'media.frames.sample',artifactId:job.sourceArtifactId,timestampsSeconds:pending.map(t=>t.requestedSeconds),maxWidth:384,maxHeight:384},signal))
    if(!Array.isArray(value.frames))throw new Error('Analysis sampler returned no frames.')
    for(const raw of value.frames){const f=mediaRecord(raw),id=assertArtifactId(f.artifactId),stat=await fs.lstat(path.join(directory,id));if(before.has(id)||stat.isSymbolicLink()||!stat.isFile())throw new Error('Analysis frame is not a newly owned file.');owned.set(id,{dev:stat.dev,ino:stat.ino})}
    if(value.type!=='frame-set'||value.sourceArtifactId!==job.sourceArtifactId||value.frames.length!==pending.length)throw new Error('Analysis sampler receipt does not match source.')
    const added:AnalysisFrame[]=[]
    for(const [i,raw]of value.frames.entries()){const f=mediaRecord(raw),target=pending[i],id=assertArtifactId(f.artifactId);if(f.requestedTimestampSeconds!==target.requestedSeconds||f.outputIndex!==i||f.type!=='screenshot'||f.contentType!=='image/png')throw new Error('Analysis sampler clock mismatch.');const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{added.push({...target,artifactId:id,sha256:await io.fingerprint(signal),bytes:io.bytes,width:finiteNumber(f.width,'analysis width',1,384,true),height:finiteNumber(f.height,'analysis height',1,384,true),seconds:finiteNumber(f.timestampSeconds,'analysis PTS',job.startSeconds,target.requestedSeconds),...(f.lumaSignature===undefined?{}:{lumaSignature:f.lumaSignature as number[]})})}finally{await io.close()}}
    job.frames.push(...added);await commit();saved=true;return {analysis:this.summary(job),frames:added.map(f=>this.image(f,directory)),nextOffset:pending.at(-1)!.index+1}
   }catch(error){if(!signal?.aborted){const message=String(error).slice(0,1000);for(const t of pending)job.failures.push({index:t.index,message});try{await commit()}catch{/* Original error and cleanup take precedence; an uncommitted page stays pending. */}}throw error}
   finally{if(!saved){const currentDirectory=await fs.lstat(directory);if(currentDirectory.isSymbolicLink()||currentDirectory.dev!==directoryIdentity.dev||currentDirectory.ino!==directoryIdentity.ino||await fs.realpath(directory)!==directory)throw new Error('Analysis cleanup directory identity changed.');}if(!saved)for(const [id,identity]of owned){const current=await fs.lstat(path.join(directory,id)).catch(e=>{if(e.code==='ENOENT')return undefined;throw e});if(current?.dev===identity.dev&&current.ino===identity.ino&&!current.isSymbolicLink())await fs.unlink(path.join(directory,id))}}
  }finally{await source.close()}
 }
 private summary(job:SourceAnalysis){const candidates=analysisChangeCandidates(job);return {id:job.id,revision:job.revision,sourceArtifactId:job.sourceArtifactId,sourceSha256:job.sourceSha256,sourceBytes:job.sourceBytes,createdAt:job.createdAt,startSeconds:job.startSeconds,endSeconds:job.endSeconds,intervals:job.intervals.slice(0,20),omittedIntervals:Math.max(0,job.intervals.length-20),coverage:analysisCoverage(job),failedFrames:job.failures.slice(0,8),changeCandidates:candidates.slice(0,20),omittedChangeCandidates:Math.max(0,candidates.length-20),resume:'step extracts next unattempted page; read uses fixed target-index pages (including pending/failed targets); export retains all interval records',automaticRetry:false}}
 private targetPage(job:SourceAnalysis,offset:number,limit:number){const frames=new Map(job.frames.map(f=>[f.index,f])),failures=new Map(job.failures.map(f=>[f.index,f.message]));return analysisTargets(job.startSeconds,job.endSeconds,job.intervals).slice(offset,offset+limit).map((target,i)=>{const index=offset+i,frame=frames.get(index),failure=failures.get(index);return {index,...target,status:frame?(frame.review?'reviewed':'extracted'):failure?'failed':'pending',...(failure?{error:failure}:{})}})}
 private image(frame:AnalysisFrame,directory:string){return {...frame,path:path.join(directory,frame.artifactId),type:'screenshot',contentType:'image/png'}}
 private async verifyFrame(directory:string,frame:AnalysisFrame,signal?:AbortSignal){const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:frame.artifactId});try{if(io.bytes!==frame.bytes||await io.fingerprint(signal)!==frame.sha256)throw new Error('SOURCE_ANALYSIS_STALE: 参考帧已变化。')}finally{await io.close()}}
}
