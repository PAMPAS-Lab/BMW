import {sourceState,sourceLookup,sourceBindings} from '@bmw-agent/media-native/sources'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {assertArtifactId,mediaRecord} from '@bmw-agent/media-native/contract'
import {MaterialIndexStore} from './material-index-store.js'
import {LibraryStorage} from './library-storage.js'
import {assertLibraryIdentity,libraryKey} from './library-contract.js'
import type {LibraryIdentity} from './library-contract.js'
import type {LibraryService} from './library-service.js'

interface CopyFile {artifactId:string;sha256:string;bytes:number;dev?:number;ino?:number;created:boolean}
interface Transfer {version:1;id:string;state:'preparing'|'committed'|'failed'|'quarantined';origin:LibraryIdentity;targetProjectId:string;files:CopyFile[];source?:{id:string;acquisitionId:string};error?:string}
const tails=new Map<string,Promise<unknown>>()
export async function copyLibraryMaterial(service:LibraryService,identity:LibraryIdentity&{expectedRevision:number},signal?:AbortSignal):Promise<unknown>{
  const target=service.host.active(),previous=tails.get(target.id)??Promise.resolve(),pending=previous.catch(()=>{}).then(()=>copyNow(service,identity,signal));tails.set(target.id,pending)
  try{return await pending}finally{if(tails.get(target.id)===pending)tails.delete(target.id)}
}
async function fingerprint(storage:LibraryStorage,id:string,signal?:AbortSignal):Promise<{sha256:string;bytes:number}>{
 const io=await ArtifactJobIO.open(path.dirname(storage.file('artifacts/'+id)),{action:'media.inspect',artifactId:id})
 try{return {sha256:await io.fingerprint(signal),bytes:io.bytes}}finally{await io.close()}
}
function transferRecord(raw:unknown):Transfer {
 const v=mediaRecord(raw)
 if(v.version!==1||typeof v.id!=='string'||!/^[a-f0-9-]{36}$/.test(v.id)||!['preparing','committed','failed','quarantined'].includes(String(v.state))||!Array.isArray(v.files)||v.files.length>4096)throw new Error('Invalid transfer journal; cleanup is quarantined.')
 assertLibraryIdentity(v.origin)
 if(typeof v.targetProjectId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.targetProjectId)||Object.keys(v).some(k=>!['version','id','state','origin','targetProjectId','files','source','error'].includes(k)))throw new Error('Invalid transfer identity.')
 if(v.source){const s=mediaRecord(v.source);if(typeof s.id!=='string'||typeof s.acquisitionId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(s.id)||!/^[a-zA-Z0-9-]{1,80}$/.test(s.acquisitionId))throw new Error('Invalid transfer source.')}
 for(const rawFile of v.files){const f=mediaRecord(rawFile);assertArtifactId(f.artifactId);if(typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)||typeof f.created!=='boolean'||!Number.isSafeInteger(f.bytes)||Number(f.bytes)<1||Number(f.bytes)>512*1024*1024||f.created&&(!Number.isSafeInteger(f.dev)||!Number.isSafeInteger(f.ino)))throw new Error('Invalid transfer file.')}
 return raw as Transfer
}
export function pendingLibraryArtifacts(storage:LibraryStorage):Set<string>{
 const directory=path.dirname(storage.file('library/transfers/.boundary')),pending=new Set<string>()
 if(fs.existsSync(directory))for(const name of fs.readdirSync(directory).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){const record=transferRecord(storage.readJson('library/transfers/'+name));if(record.state==='preparing'||record.state==='quarantined')for(const file of record.files)if(file.created)pending.add(file.artifactId)}
 return pending
}
/** Snapshot only committed, byte-matching copy ancestry; no foreign content is opened. */
export function committedMaterialOrigins(storage:LibraryStorage,artifactId:string,sha256:string):LibraryIdentity[]{
 const directory=path.dirname(storage.file('library/transfers/.boundary')),result:LibraryIdentity[]=[]
 if(!fs.existsSync(directory))return result
 const names=fs.readdirSync(directory).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));if(names.length>2000)throw new Error('Copy ancestry scan budget exceeded.')
 for(const name of names){const record=transferRecord(storage.readJson('library/transfers/'+name));if(record.state!=='committed'||!record.files.some(f=>f.artifactId===artifactId&&f.sha256===sha256))continue
  result.push({projectId:record.origin.projectId,artifactId});if(record.source)result.push({projectId:record.origin.projectId,sourceId:record.source.id,acquisitionId:record.source.acquisitionId})
 }
 return [...new Map(result.map(r=>[libraryKey(r),r])).values()]
}
/** Never infer delivery or delete historical data after a crash. Only owned inodes roll back. */
export function recoverLibraryTransfers(storage:LibraryStorage,sourcePort:ReturnType<LibraryService['host']['sources']>,explicit=false):void {
 const directory=path.dirname(storage.file('library/transfers/.boundary'))
 if(!fs.existsSync(directory))return
 for(const name of fs.readdirSync(directory).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){
  const relative='library/transfers/'+name,record=transferRecord(storage.readJson(relative));if(record.targetProjectId!==sourceState(sourcePort).projectId)throw new Error('Foreign transfer journal; original preserved.')
  if(record.state==='quarantined'&&!explicit)throw new Error('LIBRARY_QUARANTINED: Explicit transfer cleanup recovery is required.')
  if(record.state!=='preparing'&&record.state!=='quarantined')continue
  const imported=record.source&&sourceLookup(sourcePort,record.source!.id,record.source!.acquisitionId)
  if(imported){storage.writeJson(relative,{...record,state:'committed'});continue}
  try{rollback(storage,record);storage.writeJson(relative,{...record,state:'failed',error:'Interrupted before commit; owned outputs cleaned.'})}catch(error){storage.writeJson(relative,{...record,state:'quarantined',error:String(error)});throw error}
 }
}
function rollback(storage:LibraryStorage,record:Transfer):void {
 for(const file of record.files){
  for(const relative of ['library/transfers/'+record.id+'/'+file.artifactId,...(file.created?['artifacts/'+file.artifactId]:[])]){
   const name=storage.file(relative);let stat:fs.Stats
   try{stat=fs.lstatSync(name)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error}
   if(stat.isSymbolicLink()||!stat.isFile()||stat.dev!==file.dev||stat.ino!==file.ino)throw new Error('Transfer cleanup identity changed; resources quarantined.')
   fs.unlinkSync(name)
  }
 }
}
async function copyNow(service:LibraryService,identity:LibraryIdentity&{expectedRevision:number},signal?:AbortSignal):Promise<unknown>{
 const from=service.project(identity.projectId),target=service.host.active(),source=new LibraryStorage(from.directory),destination=new LibraryStorage(target.directory),sourcePort=service.host.sources(from.id),targetPort=service.host.sources(target.id)
 const guard=()=>{signal?.throwIfAborted();service.host.guard();if(service.host.active().id!==target.id)throw new Error('Copy target Project changed.');source.guard();destination.guard()}
 const sourceOrganization=source.organization(),targetOrganization=destination.organization()
 guard();if(from.id===target.id){await service.read(identity,signal);return {copied:false,identity:assertLibraryIdentity(identity),targetProjectId:target.id}}
 recoverLibraryTransfers(destination,targetPort)
 if(sourceState(targetPort).revision!==identity.expectedRevision)throw new Error('SOURCE_CONFLICT: Reload target Project sources before copying.')
 const catalog=sourceState(sourcePort),binding=identity.artifactId?sourceBindings(sourcePort,identity.artifactId)[0]:(()=>{const found=sourceLookup(sourcePort,identity.sourceId!,identity.acquisitionId!);if(!found)throw new Error('Source acquisition unavailable.');return found})()
 if(binding){const body=await sourcePort.readBody(binding.source.id,binding.acquisition.id,signal);if(body.mediaAvailability.some((a,i)=>Boolean(body.acquisition.media[i].artifactId)&&!a.available))throw new Error('Source evidence is missing or changed; copy refused.')}
 const ids=new Map<string,string|undefined>(),dependencies=(value:unknown):void=>{if(Array.isArray(value)){for(const item of value)dependencies(item);return}if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(key==='decodedArtifactId'&&(value as Record<string,unknown>).contentReused===true)continue;if(/ArtifactIds?$/.test(key)||key==='artifactId'||key==='frameArtifactIds'){for(const id of Array.isArray(item)?item:[item])if(typeof id==='string'){try{ids.set(assertArtifactId(id),undefined)}catch{throw new Error('Invalid transfer dependency.')}}}else dependencies(item)}}
 if(identity.artifactId)ids.set(identity.artifactId,undefined)
 if(binding){const a=binding.acquisition;if(a.originalTextArtifactId)ids.set(a.originalTextArtifactId,a.contentId??undefined);for(const media of a.media){if(media.artifactId)ids.set(media.artifactId,media.contentId??undefined);if(media.proofArtifactId)ids.set(media.proofArtifactId,media.proofContentId??undefined)}}
 const originalIndex=await new MaterialIndexStore(from).snapshot(),record=identity.artifactId?originalIndex.records.find(r=>r.artifactId===identity.artifactId):undefined
 if(record){ids.set(record.artifactId,record.sha256);for(const part of record.parts)ids.set(part.evidenceArtifactId,part.evidenceSha256);for(const thumbnail of record.thumbnails)ids.set(thumbnail.artifactId,thumbnail.sha256)}
 // Follow only host-saved proof references. No URL fetch or caller path is admitted.
 const visited=new Set<string>();let dependencyBytes=0
 for(const [id]of ids){if(ids.size>4096)throw new Error('Transfer dependency budget exceeded.');if(!id.endsWith('.json')||visited.has(id))continue;visited.add(id);const value=source.readJson('artifacts/'+id,4*1024*1024);if(value){dependencyBytes+=Buffer.byteLength(JSON.stringify(value));if(dependencyBytes>16*1024*1024)throw new Error('Transfer proof budget exceeded.');dependencies(value)}}
 const tx:Transfer={version:1,id:crypto.randomUUID(),state:'preparing',origin:assertLibraryIdentity(identity),targetProjectId:target.id,files:[],...(binding?{source:{id:binding.source.id,acquisitionId:binding.acquisition.id}}:{})},relative='library/transfers/'+tx.id+'.json'
 destination.writeJson(relative,tx);let committed=false,total=0
 try{
  for(const [id,expected]of ids){guard();const actual=await fingerprint(source,id,signal);if(expected&&actual.sha256!==expected)throw new Error('Source content changed: '+id);total+=actual.bytes;if(total>512*1024*1024)throw new Error('Transfer exceeds 512 MiB; select a smaller source package.')
   const targetFile=destination.file('artifacts/'+id,true),file:CopyFile={artifactId:id,...actual,created:false}
   if(fs.existsSync(targetFile)){const existing=await fingerprint(destination,id,signal);if(existing.sha256!==actual.sha256)throw new Error('Target filename contains different content; existing file preserved.');tx.files.push(file);destination.writeJson(relative,tx);continue}
   const io=await ArtifactJobIO.open(path.dirname(source.file('artifacts/'+id)),{action:'media.inspect',artifactId:id}),staged=destination.file('library/transfers/'+tx.id+'/'+id,true),output=await fs.promises.open(staged,'wx',0o600)
   try{
    const stat=await output.stat();file.dev=stat.dev;file.ino=stat.ino;file.created=true;tx.files.push(file);destination.writeJson(relative,tx)
    for(let offset=0;offset<io.bytes;offset+=1024*1024){guard();const data=await io.read(offset,Math.min(1024*1024,io.bytes-offset));await output.writeFile(data)}await output.sync()
    if(await io.fingerprint(signal)!==actual.sha256)throw new Error('Source changed while copying.')
   }finally{await io.close();await output.close()}
   guard();const stagedInput=await ArtifactJobIO.open(path.dirname(staged),{action:'media.inspect',artifactId:id});try{if(await stagedInput.fingerprint(signal)!==actual.sha256)throw new Error('Staged transfer checksum mismatch.')}finally{await stagedInput.close()}
   fs.linkSync(staged,targetFile);fs.unlinkSync(staged)
  }
  guard();if(sourceState(sourcePort).revision!==catalog.revision)throw new Error('Source catalog changed while copying.')
  if(binding){if(!targetPort.importAcquisition)throw new Error('Source copy admission unavailable.');await targetPort.importAcquisition({id:binding.source.id,url:binding.source.url,acquisitions:[binding.acquisition]},identity.expectedRevision,signal)}
  committed=true;tx.state='committed';destination.writeJson(relative,tx)
  let indexCopied=false,indexWarning:string|undefined
  if(record){try{const store=new MaterialIndexStore(target),index=await store.snapshot(),existing=index.records.find(r=>r.artifactId===record.artifactId);if(existing&&existing.sha256!==record.sha256)throw new Error('Target material index differs.');if(!existing){index.records.push(structuredClone(record));await store.commit(index,index.revision,guard)}indexCopied=true}catch(error){indexWarning=String(error)}}
  const metadata=sourceOrganization.records[libraryKey(identity)],targetKey=libraryKey({...identity,projectId:target.id})
  let metadataWarning:string|undefined
  if(metadata&&!targetOrganization.records[targetKey])try{destination.setMetadata(targetKey,metadata,targetOrganization.revision)}catch(error){metadataWarning=String(error)}
  return {copied:true,transferId:tx.id,targetProjectId:target.id,identity:{projectId:target.id,...(identity.artifactId?{artifactId:identity.artifactId}:{sourceId:binding!.source.id,acquisitionId:binding!.acquisition.id})},artifactIds:tx.files.slice(0,50).map(f=>f.artifactId),artifactCount:tx.files.length,source:tx.source,indexCopied,...(indexWarning?{indexWarning}:{}),...(metadataWarning?{metadataWarning}:{}),bytes:total}
 }catch(error){
  if(!committed){try{rollback(destination,tx);tx.state='failed';tx.error=String(error);destination.writeJson(relative,tx)}catch(cleanup){tx.state='quarantined';tx.error=String(cleanup);destination.writeJson(relative,tx);throw new Error('LIBRARY_QUARANTINED: '+String(cleanup))}}
  throw error
 }
}
