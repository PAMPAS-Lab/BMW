import {sourceState} from '@bmw-agent/media-native/sources'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {assertArtifactId,assertFullMediaDecode,mediaRecord} from '@bmw-agent/media-native/contract'
import {assertImageInspection} from '@bmw-agent/media-native/image'
import type {SourceMediaState,SourceCaptureGuard,VideoIdentity} from '@bmw-agent/media-native/sources'
import {assertSourceRequest,assertSourceCatalog,assertSourceObservation,assertSourceCaptureEvidence,assertSourceDeliveryRange,assertVideoIdentity,sameVideoIdentity} from '@bmw-agent/media-native/sources'
import type {ProjectSourcePort,SourceCitation} from '@bmw-agent/media-native/sources'
import type {BrowserFeatureHost} from '@bmw-agent/browser-capability/host'
/** Accept SABR evidence only for the confirmed YouTube target and both complete encoded tracks. */
export function assertSourcePreservationBasis(proof:Record<string,unknown>,expected:VideoIdentity|undefined,observed:unknown):'HTTP-delivery-bytes'|'YouTube-SABR-encoded-tracks'{
 if(proof.reencoded!==false)throw new Error('Invalid preservation proof.')
 if(proof.basis==='HTTP-delivery-bytes')return proof.basis
 if(proof.basis==='YouTube-SABR-encoded-tracks'&&expected?.platform==='youtube'&&proof.completeVod===true&&proof.completeSeparatedTracks===true&&observed!==undefined&&sameVideoIdentity(expected,assertVideoIdentity(observed)))return proof.basis
 throw new Error('Invalid identity-bound preservation basis.')
}
/** Invoked within the existing Browser FIFO; never recursively executes a tool. */
export class LibrarySources {
 constructor(private readonly kernel:BrowserFeatureHost){}
 port():ProjectSourcePort{
  const port=this.kernel.projectSources?.()
  if(!port||['snapshot','collect','readBody','confirm','recordMedia'].some(key=>typeof port[key as keyof ProjectSourcePort]!=='function'))throw new Error('Project source storage is unavailable.')
  const catalog=sourceState(port);if(catalog.projectId!==this.kernel.projectStore.active().id)throw new Error('Source Project mismatch.');return port
 }
 async execute(raw:unknown,signal?:AbortSignal):Promise<unknown>{
  const request=assertSourceRequest(raw),project=this.kernel.projectStore.active(),port=this.port()
  signal?.throwIfAborted()
  if(request.operation==='list')return {catalog:assertSourceCatalog(port.snapshot()),pages:this.kernel.sourcePages?.()??[]}
  if(request.operation==='read')return port.readBody(request.sourceId,request.acquisitionId,signal)
  if(request.operation==='confirm')return {catalog:port.confirm(request)}
  if(request.operation==='collect'){
   if(sourceState(port).revision!==request.expectedRevision)throw new Error('SOURCE_CONFLICT: Reload sources before collecting.')
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
  if(sourceState(port).revision!==request.expectedRevision)throw new Error('SOURCE_CONFLICT: Reload sources before acquiring.')
  if(!candidate||!body.acquisition.confirmedCandidateIds.includes(candidate.id))throw new Error('Confirm a Project source candidate before acquiring media.')
  if(['capture','auto'].includes(request.method)&&!['video','source'].includes(candidate.kind))throw new Error('Only confirmed video candidates may capture a player.')
  const isVideo=['video','source'].includes(candidate.kind),sourceGuard:SourceCaptureGuard={pageUrl:body.source.url,candidateUrl:candidate.url,scope:body.acquisition.mediaScope,...(candidate.videoIdentity?{videoIdentity:candidate.videoIdentity}:{})}
  if(request.method==='preserve'&&(!['video','source'].includes(candidate.kind)||!/^https?:\/\//i.test(candidate.url)))throw new Error('Preservation requires a confirmed HTTP video or HLS candidate; blob players require capture.')
  if(request.method==='preserve'&&(candidate.durationSeconds??0)>1800)throw new Error('Long delivery storage and decoded acquisition are separate: use media.preserve on the observed candidate URL to archive the complete delivery, then media.segment for bounded local processing. A preview request does not permit decoding the whole long input; this acquisition endpoint must not download and delete a long archive after a decode-limit failure.')
  if(body.acquisition.access==='login-required')return {catalog:await port.recordMedia(body.source.id,body.acquisition.id,candidate.id,{state:'login-required',error:body.acquisition.accessText},request.expectedRevision,signal),state:'login-required'}
  if(request.method==='download'&&!this.kernel.downloadSource||request.method==='capture'&&!this.kernel.captureSource||request.method==='preserve'&&!this.kernel.preserveSource||request.method==='auto'&&!this.kernel.acquireSource)throw new Error('Source media acquisition is unavailable.')
  const directory=await fs.realpath(path.join(project.directory,'artifacts')),identity=await fs.stat(directory);let created:string|undefined;const related:string[]=[]
  const guard=async()=>{signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==project.id)throw new Error('Source Project changed during media acquisition.');const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.dev!==identity.dev||stat.ino!==identity.ino||await fs.realpath(path.join(project.directory,'artifacts'))!==directory)throw new Error('Source artifact directory changed.')}
  const cleanup=async()=>{if(!created)return;const stat=await fs.lstat(directory);if(stat.isDirectory()&&stat.dev===identity.dev&&stat.ino===identity.ino&&await fs.realpath(path.join(project.directory,'artifacts'))===directory)for(const artifactId of [created,...related])await fs.rm(path.join(directory,artifactId),{force:true})}
  try{
   await guard()
   const shared={filename:'source-'+crypto.randomUUID(),...(request.tabId?{tabId:request.tabId}:{}),...(isVideo?{sourceGuard}:{})},captureRequest={...shared,sourceGuard,videoSelector:request.videoSelector!,videoIndex:request.videoIndex,fromStart:request.fromStart,maxDurationMs:request.maxDurationMs}
   const auto=request.method==='auto'?mediaRecord(await this.kernel.acquireSource!(captureRequest,signal)):undefined
   const method=auto?auto.method:request.method
   if(!['download','capture','preserve'].includes(String(method)))throw new Error('Invalid native acquisition method.')
   const raw=mediaRecord(auto?auto.result:method==='capture'?await this.kernel.captureSource!(captureRequest,signal):method==='preserve'?await this.kernel.preserveSource!({...shared,url:candidate.url,pageUrl:body.source.url},signal):await this.kernel.downloadSource!({...shared,url:candidate.url,pageUrl:body.source.url},signal))
   created=assertArtifactId(raw.artifactId)
   if(method==='capture'||method==='preserve')related.push(assertArtifactId(created+'.origin.json'))
   const capture=method==='capture'?assertSourceCaptureEvidence(raw.capture):undefined

   let delivery:Record<string,unknown>|undefined
   if(method==='preserve'){
    const prefix=/^(preserved-[a-f0-9-]{36})-/.exec(created)?.[1],preservation=mediaRecord(raw.preservation)
    if(!prefix||!Array.isArray(raw.ownedArtifactIds)||raw.ownedArtifactIds.length>4016)throw new Error('Invalid owned preservation resources.')
    const owned=raw.ownedArtifactIds.map(assertArtifactId)
    if(!owned.includes(created)||new Set(owned).size!==owned.length||owned.some(id=>!id.startsWith(prefix+'-')))throw new Error('Foreign preservation resource.')
    related.push(...owned.filter(id=>id!==created))
    const basis=assertSourcePreservationBasis(preservation,candidate.videoIdentity,raw.videoIdentity)
    if(!owned.includes(assertArtifactId(preservation.proofArtifactId))||typeof preservation.proofSha256!=='string'||!/^[a-f0-9]{64}$/.test(preservation.proofSha256))throw new Error('Invalid preservation proof.')
    delivery={basis,reencoded:false,proofArtifactId:preservation.proofArtifactId,proofSha256:preservation.proofSha256,originalArtifactId:created,originalSha256:raw.sha256}
   }
   const deliveryRange=request.preview?assertSourceDeliveryRange({...request.preview,kind:'delivery-file-pts',reencoded:true}):undefined
   if(deliveryRange){
    await guard();const converted=mediaRecord(await this.kernel.recordingController.processArtifact({action:'media.convert',artifactId:created,outputFormat:'mp4',trimStartSeconds:deliveryRange.startSeconds,trimEndSeconds:deliveryRange.endSeconds},signal))
    related.push(created);created=assertArtifactId(converted.artifactId);related.push(assertArtifactId(created+'.derivation.json'))
    const range=mediaRecord(converted.requestedSourceRange)
    if(range.startSeconds!==deliveryRange.startSeconds||range.endSeconds!==deliveryRange.endSeconds)throw new Error('Delivery preview conversion range changed.')
   }
   if(method==='capture'&&raw.captureTimeline){const timeline=mediaRecord(raw.captureTimeline);if(timeline.indexArtifactId!==created+'.source.json'||!Array.isArray(timeline.frameArtifactIds)||timeline.frameArtifactIds.length>9||timeline.frameArtifactIds.some(id=>!Array.from({length:9},(_,i)=>created+'.source-'+i+'.png').includes(String(id))))throw new Error('Invalid owned capture sidecars.');related.push(assertArtifactId(timeline.indexArtifactId),...timeline.frameArtifactIds.map(assertArtifactId))}
   await guard();const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:created}),hash=crypto.createHash('sha256')
   try{for(let at=0;at<input.bytes;at+=1024*1024){signal?.throwIfAborted();hash.update(await input.read(at,Math.min(1024*1024,input.bytes-at)))}}finally{await input.close()}
   const contentId=hash.digest('hex');let state:SourceMediaState,proof:unknown,startSeconds:number|undefined,endSeconds:number|undefined
   if(candidate.kind==='image'||candidate.kind==='poster'){proof=assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:created},signal));state='image-decoded'}
   else{const decoded=assertFullMediaDecode(await this.kernel.recordingController.processArtifact({action:'media.decode.check',artifactId:created},signal));if(!decoded.tracks.some(track=>track.type==='video'))throw new Error('The video candidate did not yield a decoded video track.');proof=delivery?{...decoded,delivery}:decoded;startSeconds=0;endSeconds=decoded.durationSeconds
    if(deliveryRange&&Math.abs(decoded.durationSeconds-(deliveryRange.endSeconds-deliveryRange.startSeconds))>.25)throw new Error('Decoded preview duration does not match the delivery range.')
    const expected=candidate.durationSeconds
    // Element duration may itself be a trial; it is not a platform whole-video proof.
    state=deliveryRange||body.acquisition.access==='preview'||capture&&capture.stopReason!=='ended'||expected!==null&&decoded.durationSeconds<expected-.25?'partial-preview':'decoded-file'
   }
   if(isVideo&&this.kernel.verifySourceVideo){const identity=await this.kernel.verifySourceVideo({...sourceGuard,tabId:request.tabId},signal);if(raw.videoIdentity!==undefined&&!sameVideoIdentity(assertVideoIdentity(raw.videoIdentity),identity))throw new Error('VIDEO_IDENTITY_CHANGED: Acquired resource differs from the current target.');proof={...mediaRecord(proof),videoIdentity:identity}}
   if(auto)proof={...mediaRecord(proof),acquisition:auto.acquisition}
   await guard();const catalog=await port.recordMedia(body.source.id,body.acquisition.id,candidate.id,{state,artifactId:created,contentId,proof,...(capture?{capture}:{}),...(deliveryRange?{deliveryRange}:{}),...(startSeconds===undefined?{}:{startSeconds,endSeconds})},request.expectedRevision,signal)
   const saved=catalog.sources.find(source=>source.id===body.source.id)!.acquisitions.find(acquisition=>acquisition.id===body.acquisition.id)!.media.at(-1)!
   if(saved.artifactId!==created&&method!=='preserve'){try{await cleanup()}catch(error){return {catalog,state,artifactId:saved.artifactId,verification:proof,cleanupWarning:'Duplicate download could not be removed; saved evidence is preserved.'}}}
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
