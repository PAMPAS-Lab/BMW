import {SourceTranscriptService} from './source-transcript-service.js'
import {sourceBindings} from '@bmw-agent/media-native/sources'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {assertMediaInspection} from '../../media-native/src/media-port.js'
import {assertImageInspection} from '../../media-native/src/image-contract.js'
import {assertSpeechEvidence,speechSourceSegments} from '../../media-native/src/speech-contract.js'
import {exportProjectText} from '../../media-native/src/text-export.js'
import {MaterialIndexStore} from './material-index-store.js'
import {assertMaterialIndexRequest,MATERIAL_INDEX_LIMITS} from './material-index-contract.js'
import type {MaterialIndex,MaterialIndexRecord,MaterialIndexPart,MaterialIndexRequest} from './material-index-contract.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import {VideoStudioStore} from './studio-store.js'
import {readSpeechEvidence} from './studio-speech.js'
import type {StudioKernel} from './studio-service.js'
import type {BrowserSessionOwner} from '../../browser-capability/src/browser-host.js'

export function pendingMaterialRanges(record:MaterialIndexRecord):{startSeconds:number;endSeconds:number}[]{
 if(record.kind==='image')return []
 const result:{startSeconds:number;endSeconds:number}[]=[];let start=0
 for(const part of [...record.parts].sort((a,b)=>a.sourceRange.startSeconds-b.sourceRange.startSeconds)){while(start<part.sourceRange.startSeconds-.000001){const end=Math.min(part.sourceRange.startSeconds,start+180);result.push({startSeconds:start,endSeconds:end});start=end}start=Math.max(start,part.sourceRange.endSeconds)}
 while(start<(record.audioEndSeconds??record.durationSeconds)-.000001){const end=Math.min(record.audioEndSeconds??record.durationSeconds,start+180);result.push({startSeconds:start,endSeconds:end});start=end}
 return result
}
/** Native media work only. No provider calls, model loop, paths, shell or
 * implicit retry. Each actual completed chunk commits independently by CAS. */
export class MaterialIndexService {
 constructor(private kernel:StudioKernel,private owner:BrowserSessionOwner,private actor:'user'|'agent',private previewOnly=false){}
 async execute(raw:unknown,signal?:AbortSignal):Promise<unknown>{
  const request=assertMaterialIndexRequest(raw),project=this.kernel.projectStore.active(),directory=path.join(project.directory,'artifacts'),store=new MaterialIndexStore(project),check=()=>{signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==this.owner.projectId)throw new Error('Material index Project changed.')};check()
  if(request.operation==='transcribe-source'||request.operation==='source-batch-status'||request.operation==='recover-source-batch'){
   if(this.previewOnly&&request.operation!=='source-batch-status')throw new Error('NEWS_RESEARCH_PREVIEW_ONLY: Long-source processing starts only after topic selection or explicit production context.')
   if(request.operation==='transcribe-source'||request.operation==='source-batch-status'||request.operation==='recover-source-batch')return new SourceTranscriptService(this.kernel,this.owner,(next,nextSignal)=>this.execute(next,nextSignal)).execute(request,signal)
  }
  const index=await store.snapshot()
  if(request.operation==='list')return {index,records:index.records.map(r=>({...r,pendingRanges:pendingMaterialRanges(r)}))}
  if(request.expectedRevision!==undefined&&request.expectedRevision!==index.revision)throw new Error('MATERIAL_INDEX_CONFLICT: 请读取最新素材索引。')
  if(request.operation==='search')return this.search(request,index,directory,check,signal)
  if(request.operation==='set-metadata'){const record=index.records.find(r=>r.artifactId===request.artifactId);if(!record)throw new Error('Index this material before editing its metadata.');Object.assign(record,{title:request.title,description:request.description,tags:request.tags,metadataOrigin:this.actor,updatedAt:new Date().toISOString()});return {index:await store.commit(index,index.revision,check)}}
  if(this.previewOnly&&request.maxChunks>1)throw new Error('NEWS_RESEARCH_PREVIEW_ONLY: At most one local transcript chunk before topic selection.')
  return this.index(request,index,store,directory,check,signal)
 }
 private async index(request:Extract<MaterialIndexRequest,{operation:'index'}>,initial:MaterialIndex,store:MaterialIndexStore,directory:string,check:()=>void,signal?:AbortSignal):Promise<unknown>{
  const project=this.kernel.projectStore.active(),assets=new VideoStudioStore(project.directory,this.owner.sessionId).assets(project.directory),asset=assets.find(a=>a.artifactId===request.artifactId&&a.kind!=='text');if(!asset)throw new Error('Choose a Project image, audio or video material.')
  const identity=await fs.lstat(directory),root=await fs.realpath(directory),before=new Set(await fs.readdir(directory)),source=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:request.artifactId}),owned=new Map<string,{dev:number;ino:number}>();let index=initial,record=index.records.find(r=>r.artifactId===request.artifactId),chunks=0
  const claim=async(id:string)=>{const stat=await fs.lstat(path.join(root,id));if(before.has(id)||!stat.isFile()||stat.isSymbolicLink())throw new Error('Material index output is not newly owned.');owned.set(id,{dev:stat.dev,ino:stat.ino})}
  const cleanup=async()=>{const stat=await fs.lstat(directory);if(stat.dev!==identity.dev||stat.ino!==identity.ino||stat.isSymbolicLink()||await fs.realpath(directory)!==root)throw new Error('Material index cleanup Project changed.');for(const [id,previous]of owned){const stat=await fs.lstat(path.join(root,id)).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(stat?.dev===previous.dev&&stat.ino===previous.ino&&!stat.isSymbolicLink())await fs.unlink(path.join(root,id))}owned.clear()}
  const save=async()=>{check();if(await source.fingerprint(signal)!==record!.sha256)throw new Error('MATERIAL_SOURCE_CHANGED: 原素材已变化，索引不能认领新内容。');record!.updatedAt=new Date().toISOString();index=await store.commit(index,index.revision,check);record=index.records.find(r=>r.artifactId===request.artifactId)!;owned.clear()}
  try{
   const sha256=await source.fingerprint(signal);check();if(record&&record.sha256!==sha256)throw new Error('MATERIAL_SOURCE_CHANGED: 已索引原文件被修改，请保留旧证据并导入新的素材。')
   if(this.previewOnly&&record&&record.durationSeconds>30)throw new Error('NEWS_RESEARCH_PREVIEW_ONLY: Choose an actual preview no longer than thirty seconds.')
   let hasAudio=false
   if(!record){
    if(index.records.length>=MATERIAL_INDEX_LIMITS.records)throw new Error('Material index is limited to two hundred files.')
    if(asset.kind==='image'){const info=assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:asset.artifactId},signal));record={artifactId:asset.artifactId,sha256,kind:'image',durationSeconds:0,width:info.width,height:info.height,title:asset.artifactId.slice(0,120),description:'',tags:[],metadataOrigin:this.actor,updatedAt:new Date().toISOString(),parts:[],thumbnails:[]}}
    else{
     const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:asset.artifactId},signal)),video=info.tracks.find(t=>t.type==='video'&&t.canDecode),audio=info.tracks.find(t=>t.type==='audio'&&t.canDecode);hasAudio=Boolean(audio)
     if(!video&&!audio||info.durationSeconds<=0||info.durationSeconds>1800)throw new Error('Material index requires decodable finite media up to thirty minutes.')
     if(this.previewOnly&&info.durationSeconds>30)throw new Error('NEWS_RESEARCH_PREVIEW_ONLY: Choose an actual preview no longer than thirty seconds.')
     record={artifactId:asset.artifactId,sha256,kind:video?'video':'audio',durationSeconds:info.durationSeconds,audioEndSeconds:audio?audio.endSeconds??info.durationSeconds:0,...(video?{width:video.width,height:video.height}:{}),title:asset.artifactId.slice(0,120),description:'',tags:[],metadataOrigin:this.actor,updatedAt:new Date().toISOString(),parts:[],thumbnails:[]}
     if(video){const first=Math.max(0,video.startSeconds??0),end=video.endSeconds??info.durationSeconds,times=[first,first+(end-first)*.5,first+(end-first)*.9],sampled=mediaRecord(await this.kernel.recordingController.processArtifact({action:'media.frames.sample',artifactId:asset.artifactId,timestampsSeconds:times,maxWidth:640,maxHeight:360},signal));if(!Array.isArray(sampled.frames)||sampled.frames.length!==3)throw new Error('Invalid material thumbnail collection.');for(const raw of sampled.frames)await claim(assertArtifactId(mediaRecord(raw).artifactId));if(sampled.sourceArtifactId!==asset.artifactId||sampled.type!=='frame-set')throw new Error('Material thumbnails belong to another source.');for(const [i,raw]of sampled.frames.entries()){const frame=mediaRecord(raw);if(frame.requestedTimestampSeconds!==times[i])throw new Error('Material thumbnail clock mismatch.');const id=assertArtifactId(frame.artifactId),io=await ArtifactJobIO.open(root,{action:'media.inspect',artifactId:id});try{record.thumbnails.push({artifactId:id,sha256:await io.fingerprint(signal),seconds:finiteNumber(frame.timestampSeconds,'material thumbnail time',first,times[i]),width:finiteNumber(frame.width,'material thumbnail width',1,640,true),height:finiteNumber(frame.height,'material thumbnail height',1,360,true)})}finally{await io.close()}}}
    }
    index.records.push(record);await save()
   }else if(record.kind!=='image'){const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:record.artifactId},signal));if(this.previewOnly&&info.durationSeconds>30)throw new Error('NEWS_RESEARCH_PREVIEW_ONLY: Choose an actual preview no longer than thirty seconds.');hasAudio=info.tracks.some(t=>t.type==='audio'&&t.canDecode)}
   if(record.kind==='image'||!hasAudio)return {index,record,pendingRanges:[],transcriptStatus:record.kind==='image'?'not-audio':'no-decodable-audio',chunksCompleted:0}
   const deadline=Date.now()+MATERIAL_INDEX_LIMITS.jobMs,jobSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(MATERIAL_INDEX_LIMITS.jobMs)]):AbortSignal.timeout(MATERIAL_INDEX_LIMITS.jobMs)
   for(;chunks<request.maxChunks;chunks++){
    check();if(Date.now()>deadline-60000)break
    const range=request.sourceRange??pendingMaterialRanges(record)[0];if(!range)break
    if(range.endSeconds>(record.audioEndSeconds??record.durationSeconds))throw new Error('Material range exceeds its measured source.')
    const exact=record.parts.find(p=>p.sourceRange.startSeconds===range.startSeconds&&p.sourceRange.endSeconds===range.endSeconds&&p.model===request.model&&p.language===request.language)
    if(exact){await this.partEvidence(record,exact,directory,signal);break}
    if(record.parts.some(p=>range.startSeconds<p.sourceRange.endSeconds&&range.endSeconds>p.sourceRange.startSeconds))throw new Error('Indexed transcript ranges overlap; select an unindexed interval.')
    if(record.parts.length>=10)throw new Error('Material transcript is limited to ten source intervals.')
    const evidence=assertSpeechEvidence(await this.kernel.recordingController.processArtifact({action:'media.speech.align',artifactId:record.artifactId,model:request.model,language:request.language,sourceRange:range},jobSignal))
    for(const id of [evidence.normalizedArtifactId,evidence.rawArtifactId,evidence.logArtifactId])await claim(id)
    if(evidence.sourceArtifactId!==record.artifactId||evidence.sourceSha256!==record.sha256||evidence.timeDomain!=='normalized-interval-seconds'||JSON.stringify(evidence.normalization.sourceRange)!==JSON.stringify(range))throw new Error('Indexed speech does not match its source interval.')
    for(const [id,sha]of [[evidence.normalizedArtifactId,evidence.normalizedSha256],[evidence.rawArtifactId,evidence.rawSha256],[evidence.logArtifactId,evidence.logSha256]]){const io=await ArtifactJobIO.open(root,{action:'media.inspect',artifactId:id});try{if(await io.fingerprint(jobSignal)!==sha)throw new Error('Indexed speech evidence changed.')}finally{await io.close()}}
    const text=JSON.stringify(evidence,null,2)+'\n',output=await exportProjectText(root,'json',text,jobSignal,check);await claim(output.artifactId)
    record.parts.push({sourceRange:range,evidenceArtifactId:output.artifactId,evidenceSha256:crypto.createHash('sha256').update(text).digest('hex'),segmentCount:evidence.segments.length,model:request.model,language:request.language});record.parts.sort((a,b)=>a.sourceRange.startSeconds-b.sourceRange.startSeconds);await save()
    if(request.sourceRange){chunks++;break}
   }
   return {index,record,pendingRanges:pendingMaterialRanges(record),chunksCompleted:chunks,transcriptStatus:record.parts.some(part=>part.segmentCount>0)?'raw-candidates':record.parts.length?'no-speech-detected':'not-indexed',unrecognizedRanges:record.parts.filter(part=>part.segmentCount===0).map(part=>({sourceRange:part.sourceRange,evidenceArtifactId:part.evidenceArtifactId,evidenceSha256:part.evidenceSha256,meaning:'ASR returned no speech segments; this does not certify silence or absence of speech.'})),automaticTimingApproved:false,wordTimingAvailable:false,automaticRetry:false}
  }catch(error){await cleanup();throw new Error((error instanceof Error?error.message:String(error))+'; MATERIAL_INDEX_PROGRESS: '+JSON.stringify({artifactId:request.artifactId,indexRevision:index.revision,chunksCompleted:chunks,requiresFreshRead:true,automaticRetry:false}),{cause:error})}finally{await source.close()}
 }
 private async partEvidence(record:MaterialIndexRecord,part:MaterialIndexPart,directory:string,signal?:AbortSignal){const evidence=await readSpeechEvidence(directory,part.evidenceArtifactId,part.evidenceSha256,signal);if(evidence.sourceArtifactId!==record.artifactId||evidence.sourceSha256!==record.sha256||evidence.model!==part.model||evidence.language!==part.language||evidence.segments.length!==part.segmentCount||JSON.stringify(evidence.normalization.sourceRange)!==JSON.stringify(part.sourceRange))throw new Error('Indexed transcript evidence disagrees with its source.');return evidence}
 private async search(request:Extract<MaterialIndexRequest,{operation:'search'}>,index:MaterialIndex,directory:string,check:()=>void,signal?:AbortSignal):Promise<unknown>{
  const results:Record<string,unknown>[]=[],unavailable:{artifactId:string;reason:string}[]=[],query=request.query.trim().toLocaleLowerCase(),project=this.kernel.projectStore.active(),drafts=new VideoStudioStore(project.directory,this.owner.sessionId).list(),sourcePort=this.kernel.projectSources?.()
  let position=0,evidenceBytes=0,sourceBytes=0,nextOffset:number|null=null
  const matches=(text:string)=>!query||text.toLocaleLowerCase().includes(query)
  for(const record of index.records){
   check();const count=1+record.parts.reduce((n,p)=>n+p.segmentCount,0);if(position+count<=request.offset){position+=count;continue}
   let available=false;const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:record.artifactId}).catch(error=>{unavailable.push({artifactId:record.artifactId,reason:String(error)});return undefined})
   if(io){try{if(sourceBytes+io.bytes>MATERIAL_INDEX_LIMITS.searchSourceBytes){nextOffset=position;break}sourceBytes+=io.bytes;available=await io.fingerprint(signal)===record.sha256;if(!available)unavailable.push({artifactId:record.artifactId,reason:'source-changed'})}finally{await io.close()}}
   const sources=(sourcePort?sourceBindings(sourcePort,record.artifactId):[]).flatMap(({source:s,acquisition:a})=>a.media.filter(m=>m.artifactId===record.artifactId).map(m=>({sourceId:s.id,acquisitionId:a.id,url:s.url,title:a.title,state:m.state,sourceStartSeconds:m.capture?.sourceStartSeconds,sourceEndSeconds:m.capture?.sourceEndSeconds,verification:'recorded-link'}))),usage=drafts.flatMap(d=>d.scenes.flatMap(scene=>sceneVisuals(scene).flatMap((v,i)=>v.imageArtifactId===record.artifactId||v.videoArtifactId===record.artifactId?[{draftId:d.id,sceneId:scene.id,segmentIndex:i,startSeconds:v.sourceStartSeconds,endSeconds:v.sourceStartSeconds+v.durationSeconds*v.playbackRate,label:d.title+' · '+scene.title}]:[])))
   const base={artifactId:record.artifactId,title:record.title,kind:record.kind,availability:available?'verified':'unavailable',sources,usage,thumbnails:record.thumbnails,metadataOrigin:record.metadataOrigin}
   if(position>=request.offset&&matches([record.title,record.description,...record.tags,...sources.map(s=>s.title+' '+s.url)].join(' ')))results.push({...base,match:'metadata'});position++
   if(results.length>=request.limit){nextOffset=position;break}
   for(const part of record.parts){if(position+part.segmentCount<=request.offset){position+=part.segmentCount;continue}if(!available){position+=part.segmentCount;continue}
    const stat=await fs.lstat(path.join(directory,part.evidenceArtifactId)).catch(()=>undefined);if(!stat||!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024){unavailable.push({artifactId:record.artifactId,reason:'evidence-missing-or-invalid'});position+=part.segmentCount;continue}if(evidenceBytes+stat.size>MATERIAL_INDEX_LIMITS.searchEvidenceBytes){nextOffset=position;break}evidenceBytes+=stat.size
    try{const evidence=await this.partEvidence(record,part,directory,signal);for(const segment of speechSourceSegments(evidence)){check();if(position>=request.offset&&matches(segment.text))results.push({...base,match:'transcript',text:segment.text,startSeconds:segment.startSeconds,endSeconds:segment.endSeconds,timeDomain:'source-file-seconds',warnings:segment.warnings,usable:segment.usable,evidenceArtifactId:part.evidenceArtifactId,evidenceSha256:part.evidenceSha256,automaticTimingApproved:false});position++;if(results.length>=request.limit){nextOffset=position;break}}}catch(error){signal?.throwIfAborted();unavailable.push({artifactId:record.artifactId,reason:String(error)});position+=part.segmentCount}
    if(nextOffset!==null)break
   }
   if(nextOffset!==null)break
  }
  check();return {indexRevision:index.revision,results,unavailable,nextOffset,coverage:'indexed-metadata-and-raw-transcript',visualSemanticSearch:false,sourceLinksVerified:false,searchEvidenceBytes:evidenceBytes,searchSourceBytes:sourceBytes}
 }
}
