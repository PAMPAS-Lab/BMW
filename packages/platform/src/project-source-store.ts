import {assertSourceCatalog,assertSourceObservation,assertSourceCaptureEvidence,SOURCE_LIMITS,sourceId} from '@bmw-agent/media-native/sources'
import type {ProjectSourcePort,SourceCatalog,SourceMedia,SourceMediaState,SourceRequest,SourceMediaAvailability,SourceArtifactStatus,SourceCaptureEvidence} from '@bmw-agent/media-native/sources'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {assertImageInspection} from '@bmw-agent/media-native/image'
import {assertFullMediaDecode,assertArtifactId} from '@bmw-agent/media-native/contract'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
/** Shared Project evidence, independent of Session-owned editable drafts. */
export class ProjectSourceStore implements ProjectSourcePort {
 private readonly root:string;private readonly directory:string;private readonly artifacts:string;private readonly file:string;private readonly identities=new Map<string,{dev:number;ino:number}>()
 constructor(directory:string,private readonly projectId:string){
  this.root=fs.realpathSync(directory);sourceId(projectId)
  this.directory=path.join(this.root,'sources');this.artifacts=path.join(this.root,'artifacts');this.file=path.join(this.directory,'catalog.json')
  for(const dir of [this.directory,this.artifacts]){fs.mkdirSync(dir,{recursive:true,mode:0o700});if(fs.realpathSync(dir)!==dir||fs.lstatSync(dir).isSymbolicLink())throw new Error('Source state/artifacts must stay inside their Project.')}
  for(const dir of [this.root,this.directory,this.artifacts]){const stat=fs.statSync(dir);this.identities.set(dir,{dev:stat.dev,ino:stat.ino})}
 }
 private guard():void{for(const dir of [this.root,this.directory,this.artifacts]){const stat=fs.lstatSync(dir),identity=this.identities.get(dir);if(fs.realpathSync(dir)!==dir||!stat.isDirectory()||stat.dev!==identity?.dev||stat.ino!==identity.ino)throw new Error('Source Project boundary changed.')}}
 private removeNew(file:string):void{try{this.guard();if(fs.lstatSync(file).isFile())fs.rmSync(file)}catch{/* Never follow a replaced Project directory during rollback. */}}
 snapshot():SourceCatalog {
  this.guard();let stat:fs.Stats
  try{stat=fs.lstatSync(this.file)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,projectId:this.projectId,revision:0,sources:[]};throw error}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>SOURCE_LIMITS.indexBytes)throw new Error('Invalid source catalog; original preserved.')
  const descriptor=fs.openSync(this.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let text:string
  try{const pinned=fs.fstatSync(descriptor);if(pinned.dev!==stat.dev||pinned.ino!==stat.ino||!pinned.isFile()||pinned.size>SOURCE_LIMITS.indexBytes)throw new Error('Source catalog changed during read.');text=fs.readFileSync(descriptor,'utf8')}finally{fs.closeSync(descriptor)}
  this.guard();const catalog=assertSourceCatalog(JSON.parse(text));
  for(const source of catalog.sources)if(source.id!==crypto.createHash('sha256').update(source.url).digest('hex'))throw new Error('Source URL identity mismatch.');if(catalog.projectId!==this.projectId)throw new Error('Foreign Project source catalog.');return catalog
 }
 private current(revision:number):SourceCatalog{const value=this.snapshot();if(value.revision!==revision)throw new Error('SOURCE_CONFLICT: Source catalog changed; reload before editing.');return value}
 private commit(catalog:SourceCatalog,revision:number):SourceCatalog {
  this.current(revision);const parsed=assertSourceCatalog({...catalog,revision:revision+1}),text=JSON.stringify(parsed,null,2)+'\n'
  if(Buffer.byteLength(text)>SOURCE_LIMITS.indexBytes)throw new Error('Project source metadata budget exceeded.')
  const temp=path.join(this.directory,crypto.randomUUID()+'.tmp')
  try{fs.writeFileSync(temp,text,{flag:'wx',mode:0o600});this.guard();this.current(revision);fs.renameSync(temp,this.file)}finally{this.removeNew(temp)}
  return parsed
 }
 private locate(catalog:SourceCatalog,sid:string,aid:string){const source=catalog.sources.find(s=>s.id===sourceId(sid)),acquisition=source?.acquisitions.find(a=>a.id===sourceId(aid));if(!source||!acquisition)throw new Error('Source acquisition not found in this Project.');return {source,acquisition}}
 private async writeArtifact(extension:'txt'|'json',text:string):Promise<string>{
  this.guard();const artifactId='source-'+crypto.randomUUID()+'.'+extension,file=path.join(this.artifacts,artifactId),bytes=Buffer.from(text)
  if(!bytes.length||bytes.length>SOURCE_LIMITS.textBytes)throw new Error('Source text/proof budget exceeded.')
  let complete=false;const handle=await fs.promises.open(file,'wx',0o600)
  try{this.guard();await handle.writeFile(bytes);await handle.sync();this.guard();complete=true;return artifactId}finally{await handle.close();if(!complete)this.removeNew(file)}
 }
 async collect(raw:unknown,revision:number,signal?:AbortSignal){
  signal?.throwIfAborted();const observation=assertSourceObservation(raw),catalog=this.current(revision),id=crypto.createHash('sha256').update(observation.url).digest('hex'),existing=catalog.sources.find(s=>s.id===id)
  const contentId=observation.text?crypto.createHash('sha256').update(observation.text).digest('hex'):null,acquisitionId=crypto.randomUUID();let created:string|undefined
  try{
   const same=catalog.sources.flatMap(s=>s.acquisitions).find(a=>a.contentId===contentId&&contentId&&a.originalTextArtifactId)
   let originalTextArtifactId:string|null=null
   if(observation.text){if(same){try{const body=await this.readBody(catalog.sources.find(s=>s.acquisitions.includes(same))!.id,same.id);if(body.text===observation.text)originalTextArtifactId=same.originalTextArtifactId}catch{/* A fresh acquisition can preserve new evidence without repairing the old original. */}}if(!originalTextArtifactId){created=await this.writeArtifact('txt',observation.text);originalTextArtifactId=created}}
   const {text,url,candidates,...observed}=observation
   const acquisition={...observed,id:acquisitionId,capturedAt:new Date().toISOString(),eventAt:null,eventTimeOrigin:'unknown' as const,originalTextArtifactId,contentId,candidates:candidates.map(candidate=>({...candidate,id:crypto.randomUUID()})),confirmedCandidateIds:[],media:[]}
   if(existing)existing.acquisitions.push(acquisition);else catalog.sources.push({id,url,acquisitions:[acquisition]})
   signal?.throwIfAborted();const saved=this.commit(catalog,revision);return {catalog:saved,sourceId:id,acquisitionId}
  }catch(error){if(created)this.removeNew(path.join(this.artifacts,created));throw error}
 }
 private async mediaAvailability(media:SourceMedia[],signal?:AbortSignal):Promise<SourceMediaAvailability[]> {
  const checkedAt=new Date().toISOString(),cache=new Map<string,SourceArtifactStatus>();let remaining=512*1024*1024
  const verify=async(artifactId:string|null,contentId:string|null|undefined,proof:boolean):Promise<SourceArtifactStatus>=>{
   signal?.throwIfAborted();this.guard();if(!artifactId)return 'not-acquired';if(!contentId)return 'unrecorded'
   const key=(proof?'proof:':'media:')+artifactId+':'+contentId;const previous=cache.get(key);if(previous)return previous
   let input:ArtifactJobIO|undefined,status:SourceArtifactStatus='invalid'
   try{
    const file=path.join(this.artifacts,artifactId),before=await fs.promises.lstat(file);input=await ArtifactJobIO.open(this.artifacts,{action:'media.inspect',artifactId});if(proof&&input.bytes>SOURCE_LIMITS.textBytes)throw new Error('Source proof exceeds its budget.')
    if(input.bytes>remaining)status='budget-exceeded'
    else{remaining-=input.bytes;const hash=crypto.createHash('sha256');for(let at=0;at<input.bytes;at+=1024*1024){signal?.throwIfAborted();this.guard();hash.update(await input.read(at,Math.min(1024*1024,input.bytes-at)))}const after=await fs.promises.lstat(file);status=after.size===input.bytes&&before.dev===after.dev&&before.ino===after.ino&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&hash.digest('hex')===contentId?'verified':'changed'}
   }catch(error){signal?.throwIfAborted();this.guard();status=(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'invalid'}finally{await input?.close()}
   this.guard();cache.set(key,status);return status
  }
  const result:SourceMediaAvailability[]=[]
  for(const item of media){const artifactStatus=await verify(item.artifactId,item.contentId,false),proofStatus=await verify(item.proofArtifactId,item.proofContentId,true);result.push({mediaId:item.id,artifactStatus,proofStatus,available:artifactStatus==='verified'&&proofStatus==='verified',checkedAt})}
  return result
 }
 async readBody(sid:string,aid:string,signal?:AbortSignal){
  signal?.throwIfAborted();const {source,acquisition}=this.locate(this.snapshot(),sid,aid);let text=''
  if(acquisition.originalTextArtifactId){const input=await ArtifactJobIO.open(this.artifacts,{action:'media.inspect',artifactId:acquisition.originalTextArtifactId})
   try{if(input.bytes>SOURCE_LIMITS.textBytes)throw new Error('Source text budget exceeded.');const bytes=await input.read(0,input.bytes);if(crypto.createHash('sha256').update(bytes).digest('hex')!==acquisition.contentId)throw new Error('Source original text was changed; citation evidence is unavailable.');text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}finally{await input.close()}
  }
  const mediaAvailability=await this.mediaAvailability(acquisition.media,signal);signal?.throwIfAborted();this.guard();return {source,acquisition,text,mediaAvailability}
 }
 confirm(request:Extract<SourceRequest,{operation:'confirm'}>):SourceCatalog{
  const catalog=this.current(request.expectedRevision),{acquisition}=this.locate(catalog,request.sourceId,request.acquisitionId)
  if(request.candidateIds.some(id=>!acquisition.candidates.some(c=>c.id===id)))throw new Error('Foreign source candidate.');acquisition.confirmedCandidateIds=[...new Set(request.candidateIds)]
  // Keep media evidence after deselection; confirmation is preparation, not deletion.
  for(const media of acquisition.media)if(media.artifactId&&!acquisition.confirmedCandidateIds.includes(media.candidateId))acquisition.confirmedCandidateIds.push(media.candidateId)
  if(request.eventAt!==undefined){acquisition.eventAt=request.eventAt;acquisition.eventTimeOrigin=request.eventAt===null?'unknown':'user-declared'}
  return this.commit(catalog,request.expectedRevision)
 }
 async recordMedia(sid:string,aid:string,cid:string,receipt:{state:SourceMediaState;artifactId?:string;contentId?:string;startSeconds?:number;endSeconds?:number;proof?:unknown;capture?:SourceCaptureEvidence;error?:string},revision:number,signal?:AbortSignal):Promise<SourceCatalog>{
  signal?.throwIfAborted();const catalog=this.current(revision),{acquisition}=this.locate(catalog,sid,aid),candidate=acquisition.candidates.find(c=>c.id===cid)
  if(!candidate||!acquisition.confirmedCandidateIds.includes(cid))throw new Error('Confirm the candidate before acquiring media.')
  const capture=receipt.capture?assertSourceCaptureEvidence(receipt.capture):undefined;if(capture&&(capture.pageUrl!==catalog.sources.find(source=>source.id===sid)!.url||capture.candidateUrl!==candidate.url||JSON.stringify(capture.scope)!==JSON.stringify(acquisition.mediaScope)))throw new Error('Capture evidence does not match the confirmed source range.');
  const successful=['image-decoded','completed-decoded','decoded-file','partial-preview'].includes(receipt.state)
  if(capture&&(!['decoded-file','partial-preview'].includes(receipt.state)||capture.stopReason!=='ended'&&receipt.state!=='partial-preview'))throw new Error('Captured media cannot claim whole-platform completion.');
  if(successful){if(!receipt.artifactId||!receipt.contentId||!receipt.proof)throw new Error('Source media needs actual decode and file evidence.');if(receipt.state==='image-decoded')assertImageInspection(receipt.proof);else{const decoded=assertFullMediaDecode(receipt.proof);if(!decoded.tracks.some(track=>track.type==='video')||receipt.startSeconds!==0||receipt.endSeconds!==decoded.durationSeconds)throw new Error('Source media range does not match full-file video decoding.');if(receipt.state==='completed-decoded'&&(acquisition.access!=='unknown'||candidate.durationSeconds===null||Math.abs(candidate.durationSeconds-decoded.durationSeconds)>.25))throw new Error('Source media lacks complete video duration evidence.')}}
  else if(receipt.artifactId)throw new Error('Failed acquisition cannot admit an unverified media artifact.')
  let artifactId:string|null=null,contentId:string|null=null,bytes=0,proofArtifactId:string|undefined,proofContentId:string|null=null
  try{
   if(receipt.artifactId){artifactId=assertArtifactId(receipt.artifactId);const input=await ArtifactJobIO.open(this.artifacts,{action:'media.inspect',artifactId});const hash=crypto.createHash('sha256')
    try{bytes=input.bytes;for(let at=0;at<input.bytes;at+=1024*1024){signal?.throwIfAborted();hash.update(await input.read(at,Math.min(1024*1024,input.bytes-at)))}}finally{await input.close()};contentId=hash.digest('hex');if(contentId!==receipt.contentId)throw new Error('Acquired source file changed after decoding.')
    const duplicate=catalog.sources.flatMap(source=>source.acquisitions.flatMap(acquisition=>acquisition.media)).find(media=>media.contentId===contentId&&media.artifactId&&media.artifactId!==artifactId)
    if(duplicate){let prior:ArtifactJobIO|undefined;try{prior=await ArtifactJobIO.open(this.artifacts,{action:'media.inspect',artifactId:duplicate.artifactId!});const priorHash=crypto.createHash('sha256');for(let at=0;at<prior.bytes;at+=1024*1024){signal?.throwIfAborted();priorHash.update(await prior.read(at,Math.min(1024*1024,prior.bytes-at)))}if(priorHash.digest('hex')===contentId)artifactId=duplicate.artifactId}catch{signal?.throwIfAborted()}finally{await prior?.close()}}
    const proofText=JSON.stringify({version:1,sourceId:sid,acquisitionId:aid,candidateId:cid,url:candidate.url,artifactId,decodedArtifactId:receipt.artifactId,contentReused:artifactId!==receipt.artifactId,contentId,verification:receipt.proof,...(capture?{capture}:{})},null,2)+'\n';proofArtifactId=await this.writeArtifact('json',proofText);proofContentId=crypto.createHash('sha256').update(proofText).digest('hex')
   }
   const media:SourceMedia={id:crypto.randomUUID(),candidateId:cid,state:receipt.state,artifactId,contentId,proofArtifactId:proofArtifactId??null,proofContentId,capture:capture??null,bytes,startSeconds:receipt.startSeconds??null,endSeconds:receipt.endSeconds??null,expectedDurationSeconds:candidate.durationSeconds,capturedAt:new Date().toISOString(),error:receipt.error??null}
   acquisition.media.push(media);signal?.throwIfAborted();return this.commit(catalog,revision)
  }catch(error){if(proofArtifactId)this.removeNew(path.join(this.artifacts,proofArtifactId));throw error}
 }
}
