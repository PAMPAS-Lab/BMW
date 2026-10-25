import fs from 'node:fs/promises'
import path from 'node:path'
import {ArtifactJobIO} from './artifact-job-io.js'
import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'
import {assertVideoIdentity} from '@bmw-agent/agent-contract/video-identity'
import type {VideoIdentity} from '@bmw-agent/agent-contract/video-identity'
import {readCaptureIndex} from './capture-source-index.js'

/** Host-written conversion receipt. A filename or model declaration is not lineage. */
export interface MediaDerivation {
 version:1;kind:'native-media-conversion';artifactId:string;sha256:string;
 sourceArtifactId:string;sourceSha256:string;sourceRange:{startSeconds:number;endSeconds:number}
}
export interface NativeVideoOrigin {version:1;kind:'native-video-origin';artifactId:string;sha256:string;videoIdentity:VideoIdentity}
/** Legacy capture indexes already bind unchanged encoded bytes to native capture clocks. */
export async function verifiedCaptureHash(directory:string,artifactId:string,signal?:AbortSignal):Promise<string|undefined>{return (await readCaptureIndex(directory,artifactId,signal))?.videoSha256}
export function assertNativeVideoOrigin(raw:unknown):NativeVideoOrigin{
 const r=mediaRecord(raw)
 if(Object.keys(r).some(k=>!['version','kind','artifactId','sha256','videoIdentity'].includes(k))||r.version!==1||r.kind!=='native-video-origin'||!/^([a-f0-9]{64})$/.test(String(r.sha256)))throw new TypeError('Invalid native video origin.')
 return {version:1,kind:'native-video-origin',artifactId:assertArtifactId(r.artifactId),sha256:String(r.sha256),videoIdentity:assertVideoIdentity(r.videoIdentity)}
}
export async function saveNativeVideoOrigin(directory:string,artifactId:string,identity:VideoIdentity,signal?:AbortSignal):Promise<void>{
 const io=await ArtifactJobIO.openArchive(directory,artifactId)
 try{
  const receipt=assertNativeVideoOrigin({version:1,kind:'native-video-origin',artifactId,sha256:await io.fingerprint(signal),videoIdentity:identity}),rootIdentity=await fs.stat(io.root),file=path.join(io.root,assertArtifactId(artifactId+'.origin.json')),handle=await fs.open(file,'wx',0o600),owned=await handle.stat()
  try{await handle.writeFile(JSON.stringify(receipt)+'\n');await handle.sync();if(await io.fingerprint(signal)!==receipt.sha256)throw new Error('Native origin bytes changed.')}catch(error){await removeReceipt(file,io.root,rootIdentity,owned);throw error}finally{await handle.close()}
 }finally{await io.close()}
}
export async function readNativeVideoOrigin(directory:string,artifactId:string,signal?:AbortSignal):Promise<NativeVideoOrigin|undefined>{
 let io:ArtifactJobIO
 try{io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:assertArtifactId(artifactId+'.origin.json')})}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
 try{
  if(io.bytes>12288)throw new Error('Native origin exceeds its byte budget.')
  const hash=await io.fingerprint(signal),r=assertNativeVideoOrigin(JSON.parse(new TextDecoder().decode(await io.read(0,io.bytes))))
  if(r.artifactId!==artifactId||await mediaArtifactHash(directory,artifactId,signal)!==r.sha256||await io.fingerprint(signal)!==hash)throw new Error('Native origin bytes changed.')
  return r
 }finally{await io.close()}
}
const receiptId=(id:string)=>assertArtifactId(id+'.derivation.json')
async function removeReceipt(file:string,root:string,identity:{dev:number;ino:number},owned:{dev:number;ino:number}):Promise<void>{
 try{const directory=await fs.lstat(root),current=await fs.lstat(file);if(!directory.isSymbolicLink()&&directory.dev===identity.dev&&directory.ino===identity.ino&&await fs.realpath(root)===root&&!current.isSymbolicLink()&&current.dev===owned.dev&&current.ino===owned.ino)await fs.unlink(file)}catch{/* Never follow a replaced Project boundary or delete a replacement file. */}
}
export function assertMediaDerivation(raw:unknown):MediaDerivation{
 const r=mediaRecord(raw),range=mediaRecord(r.sourceRange)
 if(Object.keys(r).some(k=>!['version','kind','artifactId','sha256','sourceArtifactId','sourceSha256','sourceRange'].includes(k))||r.version!==1||r.kind!=='native-media-conversion'||Object.keys(range).some(k=>!['startSeconds','endSeconds'].includes(k))||!/^([a-f0-9]{64})$/.test(String(r.sha256))||!/^([a-f0-9]{64})$/.test(String(r.sourceSha256)))throw new TypeError('Invalid native media derivation.')
 const startSeconds=finiteNumber(range.startSeconds,'source start',0,86400),endSeconds=finiteNumber(range.endSeconds,'source end',startSeconds+.000001,86400)
 return {version:1,kind:'native-media-conversion',artifactId:assertArtifactId(r.artifactId),sha256:String(r.sha256),sourceArtifactId:assertArtifactId(r.sourceArtifactId),sourceSha256:String(r.sourceSha256),sourceRange:{startSeconds,endSeconds}}
}
export async function mediaArtifactHash(directory:string,artifactId:string,signal?:AbortSignal):Promise<string>{
 const io=await ArtifactJobIO.openArchive(directory,artifactId)
 try{return await io.fingerprint(signal)}finally{await io.close()}
}
export async function saveMediaDerivation(directory:string,raw:MediaDerivation,signal?:AbortSignal):Promise<void>{
 const receipt=assertMediaDerivation(raw),root=await fs.realpath(directory),identity=await fs.stat(root)
 const guard=async()=>{signal?.throwIfAborted();const current=await fs.lstat(root);if(current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino||await fs.realpath(directory)!==root)throw new Error('Media derivation Project changed.');if(await mediaArtifactHash(root,receipt.artifactId,signal)!==receipt.sha256||await mediaArtifactHash(root,receipt.sourceArtifactId,signal)!==receipt.sourceSha256)throw new Error('Media derivation bytes changed.')}
 await guard();const file=path.join(root,receiptId(receipt.artifactId)),handle=await fs.open(file,'wx',0o600),owned=await handle.stat()
 try{await handle.writeFile(JSON.stringify(receipt)+'\n');await handle.sync();await guard()}catch(error){await removeReceipt(file,root,identity,owned);throw error}finally{await handle.close()}
}
export async function readMediaDerivation(directory:string,artifactId:string,signal?:AbortSignal):Promise<MediaDerivation|undefined>{
 let io:ArtifactJobIO
 try{io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:receiptId(artifactId)})}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
 try{
  if(io.bytes>4096)throw new Error('Media derivation exceeds its byte budget.')
  const hash=await io.fingerprint(signal),receipt=assertMediaDerivation(JSON.parse(new TextDecoder().decode(await io.read(0,io.bytes))))
  if(receipt.artifactId!==artifactId||await mediaArtifactHash(directory,artifactId,signal)!==receipt.sha256||await mediaArtifactHash(directory,receipt.sourceArtifactId,signal)!==receipt.sourceSha256||await io.fingerprint(signal)!==hash)throw new Error('Media derivation bytes changed.')
  return receipt
 }finally{await io.close()}
}
