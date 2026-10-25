import crypto from 'node:crypto'
import {ShotCheckpointStore} from './shot-checkpoint-store.js'
import path from 'node:path'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {exportProjectText} from '../../media-native/src/text-export.js'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {productionHash} from './production-impact.js'
import {referenceOperation} from './studio-reference.js'
import {assertReferenceRecords,REFERENCE_LIMITS,referenceSourceCount} from './studio-reference-contract.js'
import type {StudioReferenceRecord} from './studio-reference-contract.js'
import {newStudioScene} from './studio-contract.js'
import type {VideoDraft,StudioScene} from './studio-contract.js'
import type {VideoStudioStore} from './studio-store.js'
import type {StudioKernel} from './studio-service.js'
import {StudioSources} from './studio-sources.js'
import type {PreparationShot} from './shot-preparation-contract.js'
import {ProductionDiagnostics} from './production-diagnostics.js'
interface PreparedShot {scene:StudioScene;reference:StudioReferenceRecord;proofArtifactId:string}
/** A bounded deterministic native batch. The official Agent chooses every shot and
 * observes its returned frames. This never chooses topics, retries or approves news. */
export async function prepareShots(kernel:StudioKernel,store:VideoStudioStore,owner:{projectId:string;sessionId:string},draft:VideoDraft,shots:PreparationShot[],actor:'user'|'agent',signal?:AbortSignal,resumeId?:string){
 const project=kernel.projectStore.active(),directory=path.join(project.directory,'artifacts'),diagnostics=new ProductionDiagnostics({...owner,draftId:draft.id},'prepare-shots'),planHash=productionHash({owner,draftId:draft.id,shots}),prepared:PreparedShot[]=[],sources=new StudioSources(kernel)
 const checkpoints=new ShotCheckpointStore(project.directory,{...owner,draftId:draft.id}),checkpointId=resumeId??crypto.randomUUID()
 let checkpointRevision=0,checkpointWritable=false,inFlight=false,checkpointArtifactId:string|undefined,committed=false
 const guard=()=>{signal?.throwIfAborted();if(kernel.projectStore.active().id!==owner.projectId||kernel.projectStore.active().directory!==project.directory||store.read(draft.id).revision!==draft.revision)throw new Error('STUDIO_CONFLICT: Shot preparation Project or draft changed.')}
 const hash=async(id:string,archive=false)=>{const io=archive?await ArtifactJobIO.openArchive(directory,id):await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{return await io.fingerprint(signal)}finally{await io.close()}}
 const read=async(id:string)=>{const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{if(io.bytes>256*1024)throw new Error('Shot checkpoint exceeds budget.');return mediaRecord(JSON.parse(new TextDecoder().decode(await io.read(0,io.bytes))))}finally{await io.close()}}
 const checkpoint=async()=>{const record={version:1,kind:'shot-preparation',...owner,draftId:draft.id,planHash,prepared,committed,inFlight,diagnostics:diagnostics.snapshot()};checkpoints.save(checkpointId,checkpointRevision,record);checkpointRevision++;checkpointWritable=true;const text=JSON.stringify(record);if(Buffer.byteLength(text)>256*1024)throw new Error('Shot checkpoint exceeds budget.');const result=await exportProjectText(directory,'json',text,undefined,()=>{if(kernel.projectStore.active().id!==owner.projectId||kernel.projectStore.active().directory!==project.directory)throw new Error('Checkpoint Project changed.')});checkpointArtifactId=result.artifactId}
 guard()
 const existingSceneIds=shots.filter(shot=>draft.scenes.some(scene=>scene.id===shot.sceneId)).map(shot=>shot.sceneId)
 if(!resumeId&&existingSceneIds.length)throw new Error('SHOT_SCENE_EXISTS: '+JSON.stringify({existingSceneIds,committed:false,nativeWorkStarted:false,automaticRetry:false,recovery:'prepare-shots appends NEW scenes; it does not replace existing footage. For these existing scene IDs use media.segment on the owned source range, video.studio attach with assetKind=video, then apply-edit scene.set for the actual local sourceStartSeconds, crop and keepSourceAudio. Preserve measured narration and scene duration; prepare-scene-references refreshes evidence after the edit. No checkpoint, native segment, scene or declaration was written.'}))
 try{
  if(resumeId){const saved=checkpoints.read(resumeId);checkpointRevision=Number(saved.checkpointRevision);if(saved.inFlight===true)throw new Error('SHOT_CHECKPOINT_UNCERTAIN: Inspect native cleanup before starting new work; no automatic replay.');if(saved.version!==1||saved.kind!=='shot-preparation'||saved.projectId!==owner.projectId||saved.sessionId!==owner.sessionId||saved.draftId!==draft.id||saved.planHash!==planHash||!Array.isArray(saved.prepared)||saved.prepared.length>shots.length)throw new Error('SHOT_CHECKPOINT_STALE: Exact owner and unchanged explicit shot plan required.')
   // Never accept supplied observations or scene content from a saved text artifact.
   for(const raw of saved.prepared){const row=mediaRecord(raw),reference=assertReferenceRecords([row.reference])[0];if(reference.analysis!==undefined)throw new Error('Checkpoint cannot supply semantic approval.');prepared.push({scene:mediaRecord(row.scene) as unknown as StudioScene,reference,proofArtifactId:assertArtifactId(row.proofArtifactId)})}
   if(saved.committed===true)throw new Error('SHOT_ALREADY_COMMITTED: Read the current draft; do not replay this batch.')
   checkpointWritable=true
  }
  if(!resumeId)await checkpoint()
  if(draft.scenes.length+shots.length>96||draft.scenes.reduce((n,s)=>n+s.durationSeconds,0)+shots.reduce((n,s)=>n+s.endSeconds-s.startSeconds,0)>720||shots.some(s=>draft.scenes.some(old=>old.id===s.sceneId))||(draft.referenceRecords?.length??0)+shots.length>REFERENCE_LIMITS.records||referenceSourceCount(draft.referenceRecords??[])+shots.length>REFERENCE_LIMITS.sources)throw new Error('SHOT_PLAN_CONFLICT: Use new scene IDs and remain within 32 reference records / eight source groups.')
  const pins=new Map<string,string>(),urls=new Map<string,string[]>()
  await diagnostics.stage('validate-inputs',async()=>{for(const shot of shots){guard();let pin=pins.get(shot.artifactId);if(!pin){pin=await hash(shot.artifactId,true);pins.set(shot.artifactId,pin)}if(pin!==shot.sha256)throw new Error('SHOT_SOURCE_CHANGED: Use current indexed artifact SHA.');const links:string[]=[]
   for(const [citationIndex,citation]of shot.citations.entries()){
    try{links.push((await sources.citation(citation,signal)).url)}catch(error){
     signal?.throwIfAborted();guard()
     const reason=error instanceof Error?error.message:String(error)
     let bindingHint:{sourceId:string;acquisitionId:string;requiresExplicitResubmission:true}|undefined
     if(reason.includes('Source acquisition not found'))try{
      const page=sources.port().search?.({limit:20}),matches=page?.items.slice(0,20).filter(row=>row.acquisition.id===citation.acquisitionId)
      if(matches?.length===1&&matches[0].source.id!==citation.sourceId)bindingHint={sourceId:matches[0].source.id,acquisitionId:matches[0].acquisition.id,requiresExplicitResubmission:true}
     }catch{/* Optional index evidence cannot replace or hide the original rejection. */}
     signal?.throwIfAborted();guard()
     throw new Error('SHOT_CITATION_BINDING: '+JSON.stringify({sceneId:shot.sceneId,citationIndex,sourceId:citation.sourceId,acquisitionId:citation.acquisitionId,startCharacter:citation.startCharacter,endCharacter:citation.endCharacter,...(bindingHint?{bindingHint}:{}),...(reason.includes('Source acquisition not found')?{lookupRecovery:{action:'library.streams',streamRequest:{operation:'sources',projectId:owner.projectId,sourceId:citation.sourceId,limit:20}}}:{})})+'; '+reason+' Compare the exact submitted IDs and saved quote range before retrying; no binding was corrected or accepted. Hints only match the same acquisition ID within at most twenty current-Project index rows. lookupRecovery is an explicit read-only exact-source filter; use its nextCursor when present. Text query is not an identifier lookup. Correcting a binding changes the plan: read current draft and cleanup state, then submit a fresh request without the failed plan resumeId.',{cause:error})
    }
   }
   urls.set(shot.sceneId,[...new Set(links)])}})
  for(const [index,shot]of shots.entries()){
   guard();let row=prepared[index]
   if(row){await diagnostics.stage('reuse-segment-and-frames',async()=>{
    const proof=await read(row.proofArtifactId),requested=mediaRecord(proof.requestedSourceRange)
    if(proof.kind!=='archive-segment'||proof.reencoded!==false||proof.sourceArtifactId!==shot.artifactId||proof.sourceSha256!==shot.sha256||requested.startSeconds!==shot.startSeconds||requested.endSeconds!==shot.endSeconds||proof.artifactId!==row.reference.sourceArtifactId||proof.sha256!==row.reference.sourceSha256||await hash(row.reference.sourceArtifactId)!==row.reference.sourceSha256)throw new Error('SHOT_CHECKPOINT_STALE: Completed native segment changed.')
    for(const frame of row.reference.frames)if(await hash(frame.artifactId)!==frame.sha256)throw new Error('SHOT_CHECKPOINT_STALE: Completed native reference changed.')
    // Rebuild authored fields from the current validated request, never from JSON.
    row.scene=makeScene(shot,row.reference.sourceArtifactId,finiteNumber(proof.sourceTimeOffsetSeconds,'source offset',Math.max(0,shot.startSeconds-30),shot.startSeconds),row.reference.durationSeconds)
   },shot.sceneId,true)}else{
    inFlight=true;await checkpoint()
    const native=mediaRecord(await diagnostics.stage('segment',()=>kernel.recordingController.processArtifact({action:'media.segment',artifactId:shot.artifactId,segmentRange:{startSeconds:shot.startSeconds,endSeconds:shot.endSeconds}},signal),shot.sceneId));guard()
    if(native.kind!=='archive-segment'||native.reencoded!==false||native.sourceArtifactId!==shot.artifactId||native.sourceSha256!==shot.sha256)throw new Error('SHOT_SEGMENT_INVALID: Native source identity changed.')
    finiteNumber(native.bytes,'reference bytes',1,256*1024*1024);const artifactId=assertArtifactId(native.artifactId),offset=finiteNumber(native.sourceTimeOffsetSeconds,'source offset',Math.max(0,shot.startSeconds-30),shot.startSeconds),duration=finiteNumber(native.durationSeconds,'segment duration',1,1800),start=shot.startSeconds-offset,end=shot.endSeconds-offset
    if(end>duration+.001)throw new Error('SHOT_SEGMENT_INVALID: Incomplete requested coverage.')
    const result=mediaRecord(await diagnostics.stage('reference-frames',()=>referenceOperation(kernel,store,{...draft,referenceRecords:[...(draft.referenceRecords??[]),...prepared.map(p=>p.reference)]},{operation:'prepare-reference',artifactId,assetKind:'video',timestampsSeconds:[start,(start+end)/2,end-.05]},directory,guard,actor,signal,false),shot.sceneId)),reference=assertReferenceRecords([result.reference])[0]
    row={scene:makeScene(shot,artifactId,offset,duration),reference,proofArtifactId:assertArtifactId(native.proofArtifactId)};prepared.push(row);inFlight=false;await checkpoint()
   }
  }
  // Revalidate all input pins immediately before the single draft CAS commit.
  await diagnostics.stage('revalidate-inputs',async()=>{for(const [id,pin]of pins)if(await hash(id,true)!==pin)throw new Error('SHOT_SOURCE_CHANGED: Source changed during batch.');for(const row of prepared){if(await hash(row.reference.sourceArtifactId)!==row.reference.sourceSha256)throw new Error('SHOT_SOURCE_CHANGED: Segment changed during batch.');for(const frame of row.reference.frames)if(await hash(frame.artifactId)!==frame.sha256)throw new Error('SHOT_SOURCE_CHANGED: Frame changed during batch.')}})
  for(const row of prepared)row.scene.sources=urls.get(row.scene.id)??[]
  guard();const updated=await diagnostics.stage('commit-scenes',async()=>store.recordPreparedShots(draft.id,draft.revision,prepared.map(p=>p.scene),prepared.map(p=>p.reference)));committed=true;await checkpoint()
  return {draftId:draft.id,revision:updated.revision,committed:true,checkpointId,checkpointArtifactId,scenes:prepared.map(p=>({sceneId:p.scene.id,artifactId:p.reference.sourceArtifactId,referenceId:p.reference.id,sourceStartSeconds:p.scene.sourceStartSeconds,durationSeconds:p.scene.durationSeconds,proofArtifactId:p.proofArtifactId})),frames:prepared[0].reference.frames.map(f=>({...f,path:path.join(directory,f.artifactId),type:'screenshot',contentType:'image/png'})),remainingReferenceIds:prepared.slice(1).map(p=>p.reference.id),diagnostics:diagnostics.snapshot(),ready:false,next:'Inspect returned frames and read-reference for remainingReferenceIds. Set actual reference analysis, then news-preparation preflight/record-scene. Original-speech translation/captions, narration and independent export review remain required.',semanticAuthority:'No automatic motion/relevance/truth approval',automaticRetry:false}
 }catch(error){
  // Actual native calls have settled; preserve finished clips/frames as reusable evidence.
  if(kernel.recordingController.isCaptureActive?.()===false)inFlight=false
  try{if(checkpointWritable)await checkpoint()}catch{/* Never mask the actual cancellation, source/CAS or cleanup error. */}
  throw new Error((error instanceof Error?error.message:String(error))+'; SHOT_PREPARATION_PROGRESS: '+JSON.stringify({committed,resumeId:checkpointId,checkpointArtifactId,preparedShots:prepared.length,diagnostics:diagnostics.snapshot(),automaticRetry:false,requiresFreshRead:true}),{cause:error})
 }
}
function makeScene(shot:PreparationShot,artifactId:string,offset:number,duration:number):StudioScene {return {...newStudioScene(shot.sceneId,shot.title),narration:shot.narration,label:shot.label,durationSeconds:shot.endSeconds-shot.startSeconds,videoArtifactId:artifactId,sourceStartSeconds:shot.startSeconds-offset,sourceDurationSeconds:duration,keepSourceAudio:shot.keepSourceAudio,layout:'fullscreen',sources:[],citations:shot.citations}}
