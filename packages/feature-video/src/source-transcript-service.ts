import crypto from 'node:crypto'
import path from 'node:path'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {assertArchiveMediaInspection} from '../../media-native/src/media-port.js'
import {SOURCE_TRANSCRIPT_LIMITS} from '@bmw-agent/feature-library/material-index-contract'
import type {SourceTranscriptBatch,SourceTranscriptUnit} from '@bmw-agent/feature-library/material-index-contract'
import type {MaterialIndexRequest} from './material-index-contract.js'
import {MaterialIndexStore} from './material-index-store.js'
import {pendingMaterialRanges} from './material-index-service.js'
import {readSpeechEvidence} from './studio-speech.js'
import type {StudioKernel} from './studio-service.js'
type IndexRequest=Extract<MaterialIndexRequest,{operation:'index'}>
type BatchRequest=Extract<MaterialIndexRequest,{operation:'transcribe-source'|'source-batch-status'|'recover-source-batch'}>
/** Deterministic native work scheduling only; no Agent/model loop or automatic retry. */
export class SourceTranscriptService {
 constructor(private kernel:StudioKernel,private owner:{projectId:string;sessionId:string},private index:(request:IndexRequest,signal?:AbortSignal)=>Promise<unknown>){}
 async execute(request:BatchRequest,signal?:AbortSignal){
  const project=this.kernel.projectStore.active(),directory=path.join(project.directory,'artifacts'),store=new MaterialIndexStore(project),guard=()=>{signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==this.owner.projectId||this.kernel.projectStore.active().directory!==project.directory)throw new Error('Source transcript Project changed.')};guard()
  let catalog=await store.snapshot()
  if(request.operation==='source-batch-status'){const batches=(catalog.sourceBatches??[]).filter(b=>b.ownerSessionId===this.owner.sessionId&&(!request.batchId||b.id===request.batchId));if(request.batchId&&!batches.length)throw new Error('Unknown or foreign source transcript batch.');return {indexRevision:catalog.revision,batches:batches.map(batch=>sourceTranscriptStatus(batch,catalog.records)),automaticRetry:false}}
  if(catalog.revision!==request.expectedRevision)throw new Error('MATERIAL_INDEX_CONFLICT: Reload before starting/resuming source transcription.')
  let batch=(catalog.sourceBatches??[]).find(b=>b.id===request.batchId||!request.batchId&&request.operation==='transcribe-source'&&b.ownerSessionId===this.owner.sessionId&&b.sourceArtifactId===request.artifactId&&b.model===request.model&&b.language===request.language)
  if(request.batchId&&(!batch||batch.ownerSessionId!==this.owner.sessionId))throw new Error('Unknown or foreign source transcript batch.')
  const save=async(next:SourceTranscriptBatch)=>{guard();const current=await store.snapshot(),old=current.sourceBatches?.find(b=>b.id===next.id);if(old&&old.revision!==batch?.revision)throw new Error('SOURCE_TRANSCRIPT_CONFLICT: Batch changed.');const updated={...next,revision:(old?.revision??0)+1};catalog=await store.commit({...current,sourceBatches:[...(current.sourceBatches??[]).filter(b=>b.id!==next.id),updated]},current.revision,guard);batch=catalog.sourceBatches!.find(b=>b.id===next.id)!}
  if(request.operation==='recover-source-batch'){
   if(this.kernel.recordingController.isCaptureActive?.()!==false)throw new Error('SOURCE_TRANSCRIPT_CLEANUP_REQUIRED: Finish actual native cleanup/recovery before clearing an in-flight checkpoint.')
   await save({...batch!,state:'interrupted',inFlight:undefined,lastError:'Explicit checkpoint recovery; unknown uncommitted outputs preserved. No work replayed.'});return {indexRevision:catalog.revision,batch:sourceTranscriptStatus(batch!,catalog.records),automaticRetry:false}
  }
  const source=await ArtifactJobIO.openArchive(directory,request.artifactId)
  try{
   const sha=await source.fingerprint(signal);guard()
   if(batch&&(batch.inFlight||batch.sourceArtifactId!==request.artifactId||batch.sourceSha256!==sha||batch.model!==request.model||batch.language!==request.language))throw new Error(batch.inFlight?'SOURCE_TRANSCRIPT_UNCERTAIN: In-flight checkpoint requires explicit recovery after actual cleanup; do not replay.':'SOURCE_TRANSCRIPT_SOURCE_CHANGED: Preserve the old batch; do not bind changed source/model/language.')
   if(!batch){
    if((catalog.sourceBatches?.length??0)>=SOURCE_TRANSCRIPT_LIMITS.batches)throw new Error('Source transcript batch budget reached.')
    const info=assertArchiveMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:request.artifactId},signal))
    if(info.tracks.filter(t=>t.type==='video').length!==1||info.tracks.filter(t=>t.type==='audio').length!==1)throw new Error('Source transcription requires an archived video with one audio track; local audio-only materials use index.')
    await save({id:crypto.randomUUID(),ownerSessionId:this.owner.sessionId,revision:1,sourceArtifactId:request.artifactId,sourceSha256:sha,durationSeconds:info.durationSeconds,model:request.model,language:request.language,units:[],state:'pending'})
   }
   for(const unit of batch!.units){await verifyTranscriptUnit(directory,batch!,unit,signal);if(unit.complete)await verifyIndexedUnit(directory,batch!,unit,(await store.snapshot()).records,signal)}
   const budget=AbortSignal.timeout(SOURCE_TRANSCRIPT_LIMITS.jobMs),jobSignal=signal?AbortSignal.any([signal,budget]):budget,deadline=Date.now()+SOURCE_TRANSCRIPT_LIMITS.jobMs;let completed=0
   try{
    while(completed<request.maxSegments&&Date.now()<deadline-60000){
     guard();let unit=batch!.units.find(u=>!u.complete)
     if(!unit){
      const start=batch!.units.at(-1)?.requestedEndSeconds??0;if(start>=batch!.durationSeconds-.000001)break
      if(batch!.units.length>=SOURCE_TRANSCRIPT_LIMITS.units)throw new Error('Source transcript work-unit budget exceeded.')
      const end=Math.min(batch!.durationSeconds,start+SOURCE_TRANSCRIPT_LIMITS.segmentSeconds)
      await save({...batch!,inFlight:'segment',state:'pending',lastError:undefined})
      const native=mediaRecord(await this.kernel.recordingController.processArtifact({action:'media.segment',artifactId:request.artifactId,segmentRange:{startSeconds:start,endSeconds:end}},jobSignal))
      if(native.kind!=='archive-segment'||native.sourceArtifactId!==request.artifactId||native.sourceSha256!==sha||native.reencoded!==false)throw new Error('Source segment receipt does not match archived original.')
      unit={artifactId:assertArtifactId(native.artifactId),sha256:String(native.sha256),proofArtifactId:assertArtifactId(native.proofArtifactId),sourceTimeOffsetSeconds:finiteNumber(native.sourceTimeOffsetSeconds,'segment source offset',Math.max(0,start-30),start),requestedStartSeconds:start,requestedEndSeconds:end,durationSeconds:finiteNumber(native.durationSeconds,'segment duration',.1,1800),complete:false}
      await verifyTranscriptUnit(directory,batch!,unit,jobSignal);await save({...batch!,inFlight:undefined,units:[...batch!.units,unit]})
     }
     await verifyTranscriptUnit(directory,batch!,unit,jobSignal)
     await save({...batch!,inFlight:'index',state:'pending',lastError:undefined})
     const current=await store.snapshot();await this.index({operation:'index',artifactId:unit.artifactId,expectedRevision:current.revision,model:batch!.model,language:batch!.language,maxChunks:10},jobSignal)
     catalog=await store.snapshot();const indexed=catalog.records.find(r=>r.artifactId===unit!.artifactId)
     if(!indexed||indexed.sha256!==unit.sha256||!indexed.parts.length||indexed.parts.some(p=>p.model!==batch!.model||p.language!==batch!.language))throw new Error('Source transcript unit lacks matching actual ASR evidence.')
     const complete=pendingMaterialRanges(indexed).length===0
     await verifyIndexedUnit(directory,batch!,unit,catalog.records,jobSignal)
     await save({...batch!,inFlight:undefined,units:batch!.units.map(u=>u.artifactId===unit!.artifactId?{...u,complete}:u)});completed++
     if(!complete)break
    }
    catalog=await store.snapshot();const status=sourceTranscriptStatus(batch!,catalog.records)
    if(!status.uncoveredRanges.length&&batch!.units.every(u=>u.complete)&&Math.abs((batch!.units.at(-1)?.requestedEndSeconds??0)-batch!.durationSeconds)<.000001)await save({...batch!,inFlight:undefined,state:'complete'})
   }catch(error){
    // Native/index operations settle only after their own worker/file cleanup.
    // Cancellation preserves committed units and ASR chunks; never retry here.
    const latest=await store.snapshot(),saved=latest.sourceBatches?.find(b=>b.id===batch!.id);if(saved&&saved.revision===batch!.revision){const aborted=signal?.aborted;await saveAfterAbort({...batch!,state:'interrupted',inFlight:this.kernel.recordingController.isCaptureActive?.()===false?undefined:batch!.inFlight,lastError:(error instanceof Error?error.message:String(error)).slice(0,1000)},store,project.id,this.owner.sessionId,project.directory,()=>this.kernel.projectStore.active(),saved.revision);batch=(await store.snapshot()).sourceBatches!.find(b=>b.id===batch!.id)!;if(aborted)signal!.throwIfAborted()}
    if(!budget.aborted)throw new Error((error instanceof Error?error.message:String(error))+'; SOURCE_TRANSCRIPT_PROGRESS: '+JSON.stringify({batchId:batch!.id,requiresFreshRead:true,automaticRetry:false}),{cause:error})
   }
   guard();if(await source.fingerprint(signal)!==sha)throw new Error('SOURCE_TRANSCRIPT_SOURCE_CHANGED: Archive changed during work.')
   catalog=await store.snapshot();return {indexRevision:catalog.revision,batch:sourceTranscriptStatus(batch!,catalog.records),automaticRetry:false,completionMeaning:'Full source processing coverage and preserved raw ASR, not verbatim accuracy, continuous viewing or human listening.'}
  }finally{await source.close()}
 }
}
async function verifyIndexedUnit(directory:string,batch:SourceTranscriptBatch,unit:SourceTranscriptUnit,records:Awaited<ReturnType<MaterialIndexStore['snapshot']>>['records'],signal?:AbortSignal){
 const record=records.find(r=>r.artifactId===unit.artifactId&&r.sha256===unit.sha256);if(!record||!record.parts.length||unit.complete&&pendingMaterialRanges(record).length)throw new Error('Source transcript evidence missing or coverage changed.')
 for(const part of record.parts){const evidence=await readSpeechEvidence(directory,part.evidenceArtifactId,part.evidenceSha256,signal);if(evidence.sourceArtifactId!==unit.artifactId||evidence.sourceSha256!==unit.sha256||evidence.model!==batch.model||evidence.language!==batch.language||evidence.segments.length!==part.segmentCount||JSON.stringify(evidence.normalization.sourceRange)!==JSON.stringify(part.sourceRange))throw new Error('Source transcript raw evidence or range changed.')}
}
async function saveAfterAbort(batch:SourceTranscriptBatch,store:MaterialIndexStore,projectId:string,sessionId:string,directory:string,active:()=>{id:string;directory:string},expected:number){
 const guard=()=>{const p=active();if(p.id!==projectId||p.directory!==directory)throw new Error('Source transcript cleanup checkpoint Project changed.')},current=await store.snapshot(),old=current.sourceBatches?.find(b=>b.id===batch.id);guard();if(!old||old.ownerSessionId!==sessionId||old.revision!==expected)throw new Error('SOURCE_TRANSCRIPT_CONFLICT: Preserve newer checkpoint after cancellation.');await store.commit({...current,sourceBatches:current.sourceBatches!.map(b=>b.id===batch.id?{...batch,revision:expected+1}:b)},current.revision,guard)
}
export async function verifyTranscriptUnit(directory:string,batch:SourceTranscriptBatch,unit:SourceTranscriptUnit,signal?:AbortSignal){
 const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:unit.artifactId});try{if(await input.fingerprint(signal)!==unit.sha256)throw new Error('Source work unit changed.')}finally{await input.close()}
 const proof=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:unit.proofArtifactId});try{if(proof.bytes>32768)throw new Error('Segment proof exceeds budget.');const p=mediaRecord(JSON.parse(new TextDecoder().decode(await proof.read(0,proof.bytes))));if(p.kind!=='archive-segment'||p.reencoded!==false||p.sourceArtifactId!==batch.sourceArtifactId||p.sourceSha256!==batch.sourceSha256||p.artifactId!==unit.artifactId||p.sha256!==unit.sha256||p.sourceTimeOffsetSeconds!==unit.sourceTimeOffsetSeconds||p.durationSeconds!==unit.durationSeconds||mediaRecord(p.requestedSourceRange).startSeconds!==unit.requestedStartSeconds||mediaRecord(p.requestedSourceRange).endSeconds!==unit.requestedEndSeconds)throw new Error('Segment proof/source time mapping changed.')}finally{await proof.close()}
}
export function sourceTranscriptStatus(batch:SourceTranscriptBatch,records:Awaited<ReturnType<MaterialIndexStore['snapshot']>>['records']){
 const ranges=batch.units.flatMap(unit=>{const record=records.find(r=>r.artifactId===unit.artifactId&&r.sha256===unit.sha256);return (record?.parts??[]).map(p=>({startSeconds:Math.max(0,unit.sourceTimeOffsetSeconds+p.sourceRange.startSeconds),endSeconds:Math.min(batch.durationSeconds,unit.sourceTimeOffsetSeconds+p.sourceRange.endSeconds),segmentCount:p.segmentCount,evidenceArtifactId:p.evidenceArtifactId}))}).sort((a,b)=>a.startSeconds-b.startSeconds),uncoveredRanges:{startSeconds:number;endSeconds:number}[]=[];let end=0
 for(const r of ranges){if(r.startSeconds>end+.000001)uncoveredRanges.push({startSeconds:end,endSeconds:r.startSeconds});end=Math.max(end,r.endSeconds)}if(end<batch.durationSeconds-.000001)uncoveredRanges.push({startSeconds:end,endSeconds:batch.durationSeconds})
 return {...batch,state:batch.inFlight?'uncertain':batch.state,indexedPartCount:ranges.length,processedSourceRanges:ranges,uncoveredRanges,unrecognizedRanges:ranges.filter(r=>r.segmentCount===0),authority:'Stored native processing ranges; status alone does not rehash evidence. Empty ASR is not certified silence.',next:batch.inFlight?'Explicit recover-source-batch after actual cleanup':batch.state==='complete'?'Read/search indexed transcript; do not download or reprocess':'Explicit transcribe-source with current index revision and this batchId; no automatic retry'}
}
