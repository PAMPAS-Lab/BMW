import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {assertArtifactId,assertFullMediaDecode,mediaRecord} from '@bmw-agent/media-native/contract'
import {assertImageInspection} from '@bmw-agent/media-native/image'
import type {SourceMediaState} from '@bmw-agent/media-native/sources'
import {assertSourceRequest,assertSourceCatalog,assertSourceObservation,assertSourceCaptureEvidence} from '@bmw-agent/media-native/sources'
import type {ProjectSourcePort,SourceCitation} from '@bmw-agent/media-native/sources'
import type {BrowserFeatureHost} from '@bmw-agent/browser-capability/host'
/** Invoked within the existing Browser FIFO; never recursively executes a tool. */
export class StudioSources {
 constructor(private readonly kernel:BrowserFeatureHost){}
 port():ProjectSourcePort{
  const port=this.kernel.projectSources?.()
  if(!port||['snapshot','collect','readBody','confirm','recordMedia'].some(key=>typeof port[key as keyof ProjectSourcePort]!=='function'))throw new Error('Project source storage is unavailable.')
  const catalog=assertSourceCatalog(port.snapshot());if(catalog.projectId!==this.kernel.projectStore.active().id)throw new Error('Source Project mismatch.');return port
 }
 async execute(raw:unknown,signal?:AbortSignal):Promise<unknown>{
  const request=assertSourceRequest(raw),project=this.kernel.projectStore.active(),port=this.port()
  signal?.throwIfAborted()
  if(request.operation==='list')return {catalog:assertSourceCatalog(port.snapshot()),pages:this.kernel.sourcePages?.()??[]}
  if(request.operation==='read')return port.readBody(request.sourceId,request.acquisitionId,signal)
  if(request.operation==='confirm')return {catalog:port.confirm(request)}
  if(request.operation==='collect'){
   if(port.snapshot().revision!==request.expectedRevision)throw new Error('SOURCE_CONFLICT: Reload sources before collecting.')
   if(!this.kernel.collectSource)throw new Error('Bounded source collection is unavailable.')
   const {operation,expectedRevision,...collection}=request
   const observed=assertSourceObservation(await this.kernel.collectSource(collection,signal))
   signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==project.id)throw new Error('Source Project changed during collection.')
   return port.collect(observed,expectedRevision,signal)
  }
  return this.acquire(request,port,signal)
 }
 private async acquire(request:Extract<import('@bmw-agent/media-native/sources').SourceRequest,{operation:'acquire'}>,port:ProjectSourcePort,signal?:AbortSignal){
  const project=this.kernel.projectStore.active(),body=await port.readBody(request.sourceId,request.acquisitionId,signal),candidate=body.acquisition.candidates.find(candidate=>candidate.id===request.candidateId)
  if(port.snapshot().revision!==request.expectedRevision)throw new Error('SOURCE_CONFLICT: Reload sources before acquiring.')
  if(!candidate||!body.acquisition.confirmedCandidateIds.includes(candidate.id))throw new Error('Confirm a Project source candidate before acquiring media.')
  if(request.method==='capture'&&!['video','source'].includes(candidate.kind))throw new Error('Only confirmed video candidates may capture a player.')
  if(body.acquisition.access==='login-required')return {catalog:await port.recordMedia(body.source.id,body.acquisition.id,candidate.id,{state:'login-required',error:body.acquisition.accessText},request.expectedRevision,signal),state:'login-required'}
  if(request.method==='download'&&!this.kernel.downloadSource||request.method==='capture'&&!this.kernel.captureSource)throw new Error('Source media acquisition is unavailable.')
  const directory=await fs.realpath(path.join(project.directory,'artifacts')),identity=await fs.stat(directory);let created:string|undefined
  const guard=async()=>{signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==project.id)throw new Error('Source Project changed during media acquisition.');const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.dev!==identity.dev||stat.ino!==identity.ino||await fs.realpath(path.join(project.directory,'artifacts'))!==directory)throw new Error('Source artifact directory changed.')}
  const cleanup=async()=>{if(!created)return;const stat=await fs.lstat(directory);if(stat.isDirectory()&&stat.dev===identity.dev&&stat.ino===identity.ino&&await fs.realpath(path.join(project.directory,'artifacts'))===directory)await fs.rm(path.join(directory,created),{force:true})}
  try{
   await guard();const shared={filename:'source-'+crypto.randomUUID(),...(request.tabId?{tabId:request.tabId}:{})},raw=mediaRecord(request.method==='capture'?await this.kernel.captureSource!({...shared,sourceGuard:{pageUrl:body.source.url,candidateUrl:candidate.url,scope:body.acquisition.mediaScope},videoSelector:request.videoSelector!,videoIndex:request.videoIndex,maxDurationMs:request.maxDurationMs},signal):await this.kernel.downloadSource!({...shared,url:candidate.url,pageUrl:body.source.url},signal));created=assertArtifactId(raw.artifactId);const capture=request.method==='capture'?assertSourceCaptureEvidence(raw.capture):undefined
   await guard();const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:created}),hash=crypto.createHash('sha256')
   try{for(let at=0;at<input.bytes;at+=1024*1024){signal?.throwIfAborted();hash.update(await input.read(at,Math.min(1024*1024,input.bytes-at)))}}finally{await input.close()}
   const contentId=hash.digest('hex');let state:SourceMediaState,proof:unknown,startSeconds:number|undefined,endSeconds:number|undefined
   if(candidate.kind==='image'||candidate.kind==='poster'){proof=assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:created},signal));state='image-decoded'}
   else{const decoded=assertFullMediaDecode(await this.kernel.recordingController.processArtifact({action:'media.decode.check',artifactId:created},signal));if(!decoded.tracks.some(track=>track.type==='video'))throw new Error('The video candidate did not yield a decoded video track.');proof=decoded;startSeconds=0;endSeconds=decoded.durationSeconds
    const expected=candidate.durationSeconds
    // Element duration may itself be a trial; it is not a platform whole-video proof.
    state=body.acquisition.access==='preview'||capture&&capture.stopReason!=='ended'||expected!==null&&decoded.durationSeconds<expected-.25?'partial-preview':'decoded-file'
   }
   await guard();const catalog=await port.recordMedia(body.source.id,body.acquisition.id,candidate.id,{state,artifactId:created,contentId,proof,...(capture?{capture}:{}),...(startSeconds===undefined?{}:{startSeconds,endSeconds})},request.expectedRevision,signal)
   const saved=catalog.sources.find(source=>source.id===body.source.id)!.acquisitions.find(acquisition=>acquisition.id===body.acquisition.id)!.media.at(-1)!
   if(saved.artifactId!==created){try{await cleanup()}catch(error){return {catalog,state,artifactId:saved.artifactId,verification:proof,cleanupWarning:'Duplicate download could not be removed; saved evidence is preserved.'}}}
   return {catalog,state,artifactId:saved.artifactId,verification:proof}
  }catch(error){await cleanup();signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==project.id)throw error;const message=(error instanceof Error?error.message:String(error)).slice(0,2000)
   // The old original, confirmation and earlier successful media remain immutable.
   return {catalog:await port.recordMedia(body.source.id,body.acquisition.id,candidate.id,{state:'failed',error:message},request.expectedRevision,signal),state:'failed',error:message}
  }
 }
 async citation(citation:SourceCitation,signal?:AbortSignal){
  const body=await this.port().readBody(citation.sourceId,citation.acquisitionId,signal);signal?.throwIfAborted()
  if(body.text.slice(citation.startCharacter,citation.endCharacter)!==citation.quote)throw new Error('Citation does not match the stored original text range.')
  return {citation,url:body.source.url,title:body.acquisition.title,author:body.acquisition.author,publishedAt:body.acquisition.publishedAt,capturedAt:body.acquisition.capturedAt,eventAt:body.acquisition.eventAt,eventTimeOrigin:body.acquisition.eventTimeOrigin,scope:body.acquisition.scope,originalTextArtifactId:body.acquisition.originalTextArtifactId,contentId:body.acquisition.contentId,result:body.acquisition.result,access:body.acquisition.access,media:body.acquisition.media,mediaAvailability:body.mediaAvailability,factChecking:'pending' as const}
 }
}
