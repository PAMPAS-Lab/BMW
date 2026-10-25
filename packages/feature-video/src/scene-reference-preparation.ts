import fs from 'node:fs/promises'
import path from 'node:path'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import {mediaRecord} from '../../media-native/src/media-contract.js'
import {assertReferenceCapacity,assertReferenceRecords} from './studio-reference-contract.js'
import type {StudioReferenceRecord} from './studio-reference-contract.js'
import {referenceOperation} from './studio-reference.js'
import {referenceCoverageGap,referenceCandidatePlan} from './reference-coverage.js'
import type {SelectedReferenceInterval} from './reference-coverage.js'
import type {StudioKernel} from './studio-service.js'
import type {VideoStudioStore} from './studio-store.js'
import type {VideoDraft} from './studio-contract.js'
import {ProductionDiagnostics} from './production-diagnostics.js'

/** The Agent explicitly selects existing scenes. Host derives exact source clocks;
 * no authored scenes, observed-frame statements or semantic approval are generated. */
export async function prepareSceneReferences(kernel:StudioKernel,store:VideoStudioStore,owner:{projectId:string;sessionId:string},draft:VideoDraft,sceneIds:string[],actor:'user'|'agent',signal?:AbortSignal){
 const project=kernel.projectStore.active(),directory=path.join(project.directory,'artifacts'),root=await fs.realpath(directory),identity=await fs.lstat(root),diagnostics=new ProductionDiagnostics({...owner,draftId:draft.id},'prepare-scene-references'),ranges:SelectedReferenceInterval[]=[],records=draft.referenceRecords??[],fresh:StudioReferenceRecord[]=[],selected:{reference?:StudioReferenceRecord;intervals:SelectedReferenceInterval[];reused:boolean}[]=[],owned=new Map<string,{dev:number;ino:number}>();let committed=false,bytes=0
 const guard=()=>{signal?.throwIfAborted();if(kernel.projectStore.active().id!==owner.projectId||kernel.projectStore.active().directory!==project.directory||store.read(draft.id).revision!==draft.revision)throw new Error('STUDIO_CONFLICT: Scene reference Project or draft changed.')}
 const pins=new Map<string,string>(),hash=async(id:string)=>{const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{return await io.fingerprint(signal)}finally{await io.close()}}
 const fail=(code:string,detail:unknown)=>new Error(code+': '+JSON.stringify({draftId:draft.id,revision:draft.revision,committed:false,automaticRetry:false,detail}))
 guard()
 for(const sceneId of sceneIds){const scene=draft.scenes.find(s=>s.id===sceneId);if(!scene)throw fail('SCENE_REFERENCE_PLAN','Unknown selected scene: '+sceneId);const visuals=sceneVisuals(scene);if(!visuals.length||visuals.some(v=>!v.videoArtifactId))throw fail('SCENE_REFERENCE_PLAN','Selected scene requires explicit primary video intervals: '+sceneId);for(const [visualIndex,v]of visuals.entries())ranges.push({sceneId,visualIndex,artifactId:v.videoArtifactId!,startSeconds:v.sourceStartSeconds,endExclusive:v.sourceStartSeconds+v.durationSeconds*v.playbackRate})}
 if(!ranges.length||ranges.length>8)throw fail('SCENE_REFERENCE_BUDGET','Select at most eight actual primary video intervals; narrow sceneIds explicitly.')
 const groups=new Map<string,SelectedReferenceInterval[]>();for(const range of ranges)groups.set(range.artifactId,[...(groups.get(range.artifactId)??[]),range])
 try{
  await diagnostics.stage('plan-and-reuse',async()=>{
   for(const [artifactId,intervals]of groups){guard();const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId});let sha:string;try{bytes+=io.bytes;if(bytes>256*1024*1024)throw fail('SCENE_REFERENCE_BUDGET','Selected source files exceed the unchanged 256 MiB native reference budget.');sha=await io.fingerprint(signal)}finally{await io.close()}pins.set(artifactId,sha)
    const reuse=[...records].reverse().find(r=>r.sourceArtifactId===artifactId&&r.sourceSha256===sha&&r.kind==='video'&&r.frames.length>=3&&intervals.every(range=>r.videoRange&&range.startSeconds>=r.videoRange.startSeconds-.001&&range.endExclusive<=r.videoRange.endSeconds+.001&&!referenceCoverageGap(range,r.frames,r.id)))
    if(reuse){for(const frame of reuse.frames)if(await hash(frame.artifactId)!==frame.sha256)throw fail('STUDIO_REFERENCE_STALE','Reusable reference frame changed: '+frame.artifactId);selected.push({reference:reuse,intervals,reused:true})}
    else{const plan=referenceCandidatePlan(intervals);if(plan.boundaryCandidates.length>8)throw fail('SCENE_REFERENCE_BUDGET',{artifactId,intervals,boundaryCandidates:plan.boundaryCandidates,message:'Source requires more than eight distinct boundary candidates. Select fewer intervals, or explicitly split an authored scene into smaller scenes before preparing them separately; no endpoints were dropped.'});selected.push({intervals,reused:false})}
   }
   assertReferenceCapacity(records,[...pins].map(([sourceArtifactId,sourceSha256])=>({sourceArtifactId,sourceSha256})),selected.filter(s=>!s.reused).length)
  })
  for(const row of selected){guard();if(row.reused)continue;const artifactId=row.intervals[0].artifactId,times=referenceCandidatePlan(row.intervals).timestampsSeconds
   const result=mediaRecord(await diagnostics.stage('reference-frames',()=>referenceOperation(kernel,store,{...draft,referenceRecords:[...records,...fresh]},{operation:'prepare-reference',artifactId,assetKind:'video',timestampsSeconds:times},directory,guard,actor,signal,false),row.intervals[0].sceneId)),reference=assertReferenceRecords([result.reference])[0]
   for(const frame of reference.frames){const file=path.join(root,frame.artifactId),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw fail('SCENE_REFERENCE_OUTPUT','Native frame identity unavailable.');owned.set(file,{dev:stat.dev,ino:stat.ino})}
   fresh.push(reference);row.reference=reference
   if(reference.sourceSha256!==pins.get(artifactId))throw fail('STUDIO_REFERENCE_STALE','Source changed during native preparation.')
   const gaps=row.intervals.flatMap(range=>{const gap=referenceCoverageGap(range,reference.frames,reference.id);return gap?[gap]:[]})
   if(gaps.length)throw fail('SCENE_REFERENCE_COVERAGE',gaps)
   if(row.intervals.some(range=>!reference.videoRange||range.startSeconds<reference.videoRange.startSeconds-.001||range.endExclusive>reference.videoRange.endSeconds+.001))throw fail('SCENE_REFERENCE_RANGE',{artifactId,intervals:row.intervals,actualVideoRange:reference.videoRange})
  }
  const complete=selected.map(row=>{if(!row.reference)throw fail('SCENE_REFERENCE_OUTPUT','Unprepared selected source.');return {...row,reference:row.reference}})
  await diagnostics.stage('revalidate',async()=>{for(const [id,sha]of pins)if(await hash(id)!==sha)throw fail('STUDIO_REFERENCE_STALE','Source changed before reference commit.');for(const row of complete)for(const frame of row.reference.frames)if(await hash(frame.artifactId)!==frame.sha256)throw fail('STUDIO_REFERENCE_STALE','Reference frame changed before commit.')})
  guard();const updated=fresh.length?await diagnostics.stage('commit-references',async()=>store.recordReference(draft.id,draft.revision,[...records,...fresh])):draft;committed=true
  return {draftId:draft.id,revision:updated.revision,committed:fresh.length>0,reused:selected.filter(s=>s.reused).length,prepared:fresh.length,references:complete.map(s=>({referenceId:s.reference.id,artifactId:s.reference.sourceArtifactId,sha256:s.reference.sourceSha256,reused:s.reused,intervals:s.intervals,...(!s.reused?{sampling:referenceCandidatePlan(s.intervals)}:{}),actualFrameSeconds:s.reference.frames.map(f=>f.seconds),analysis:s.reference.analysis?'existing-author-supplied':'pending'})),frames:complete[0].reference.frames.slice(0,3).map(f=>({...f,path:path.join(directory,f.artifactId),type:'screenshot',contentType:'image/png'})),remainingReferenceIds:complete.map(s=>s.reference.id),diagnostics:diagnostics.snapshot(),ready:false,automaticRetry:false,next:'Read all actual reference frames and supply concrete observations. Sampling preserves all interval boundary candidates first; omittedMidpointCandidates explicitly lists interior candidates that did not fit the unchanged eight-frame budget. Actual PTS and visual inspection remain required. Existing user analyses and every old reference remain unchanged. Preparation declarations and independent exported-film review are still required.'}
 }finally{if(!committed){const current=await fs.lstat(root);if(current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino||await fs.realpath(directory)!==root)throw new Error('Scene reference cleanup directory identity changed.');for(const [file,before]of owned){const stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(stat?.dev===before.dev&&stat.ino===before.ino&&!stat.isSymbolicLink())await fs.unlink(file)}}}
}
