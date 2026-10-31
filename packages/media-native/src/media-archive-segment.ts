import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {Input,CustomSource,MP4,WEBM,MATROSKA,MPEG_TS,Output,StreamTarget,Mp4OutputFormat,Conversion,EncodedPacketSink} from 'mediabunny'
import {ArtifactJobIO} from './artifact-job-io.js'
import {ARCHIVE_LIMITS} from './archive-limits.js'
import {MEDIA_LIMITS,assertArtifactId,finiteNumber,mediaRecord,assertPreservedMediaTracks} from './media-contract.js'
import {PreservationCleanupError} from './media-preservation.js'
import {saveMediaDerivation} from './media-derivation.js'

export function assertArchiveSegment(raw:unknown){
 const v=mediaRecord(raw)
 if(v.action!=='media.segment'||Object.keys(v).some(k=>!['action','artifactId','segmentRange','tabId'].includes(k))||v.tabId!==undefined&&typeof v.tabId!=='string')throw new TypeError('Invalid archive segment request.')
 const range=mediaRecord(v.segmentRange);if(Object.keys(range).some(k=>!['startSeconds','endSeconds'].includes(k)))throw new TypeError('Invalid archive segment range.')
 const startSeconds=finiteNumber(range.startSeconds,'segment start',0,ARCHIVE_LIMITS.durationSeconds),endSeconds=finiteNumber(range.endSeconds,'segment end',startSeconds+.1,Math.min(ARCHIVE_LIMITS.durationSeconds,startSeconds+1740))
 return {artifactId:assertArtifactId(v.artifactId),startSeconds,endSeconds}
}
/** Encoded-packet copy only. Storage may be long; each decoded work unit stays bounded. */
export async function segmentArchivedMedia(directory:string,raw:unknown,signal?:AbortSignal){
 const request=assertArchiveSegment(raw),io=await ArtifactJobIO.openArchive(directory,request.artifactId),root=io.root,identity=await fs.stat(root),artifactId='segment-'+crypto.randomUUID()+'.mp4',file=path.join(root,artifactId),proofId=artifactId+'.json',created:string[]=[]
 const abort=AbortSignal.any([AbortSignal.timeout(ARCHIVE_LIMITS.timeoutMs),...(signal?[signal]:[])])
 const guard=async()=>{abort.throwIfAborted();const s=await fs.lstat(root);if(s.isSymbolicLink()||s.dev!==identity.dev||s.ino!==identity.ino)throw new Error('Archive segment Project changed.')}
 const source=(reader:ArtifactJobIO)=>new CustomSource({getSize:()=>reader.bytes,maxCacheSize:8*MEDIA_LIMITS.chunkBytes,prefetchProfile:'none',read:(start,end)=>new ReadableStream<Uint8Array>({async start(c){try{for(let at=start;at<end;at+=MEDIA_LIMITS.chunkBytes){await guard();c.enqueue(await reader.read(at,Math.min(end-at,MEDIA_LIMITS.chunkBytes)))}c.close()}catch(e){c.error(e)}}})})
 const input=new Input({formats:[MP4,WEBM,MATROSKA,MPEG_TS],source:source(io)});let output:Output|undefined,conversion:Conversion|undefined,handle:Awaited<ReturnType<typeof fs.open>>|undefined,success=false
 try{
  const sourceSha256=await io.fingerprint(abort),duration=await input.computeDuration(),tracks=await input.getTracks(),video=await input.getPrimaryVideoTrack()
  if(!video||tracks.some(t=>!t.isVideoTrack()&&!t.isAudioTrack())||tracks.filter(t=>t.isVideoTrack()).length!==1||tracks.filter(t=>t.isAudioTrack()).length>15||!Number.isFinite(duration)||duration>ARCHIVE_LIMITS.durationSeconds||request.endSeconds>duration)throw new Error('Segment requires a finite archive with one video and at most fifteen preserved audio tracks; requested range must exist.')
  const key=await new EncodedPacketSink(video).getKeyPacket(request.startSeconds,{metadataOnly:true}),base=Math.max(0,key?.timestamp??request.startSeconds)
  if(request.startSeconds-base>30)throw new Error('Archive key-frame expansion exceeds thirty seconds; no incomplete segment published.')
  await guard();handle=await fs.open(file,'wx+',0o600);created.push(file);let bytes=0
  output=new Output({format:new Mp4OutputFormat({fastStart:'fragmented'}),target:new StreamTarget(new WritableStream({async write(chunk:{position:number;data:Uint8Array}){await guard();if(chunk.position+chunk.data.length>MEDIA_LIMITS.outputBytes)throw new Error('Segment exceeds 512 MiB; request a shorter range.');let at=0;while(at<chunk.data.length){const n=await handle!.write(chunk.data,at,chunk.data.length-at,chunk.position+at);if(!n.bytesWritten)throw new Error('Segment write made no progress.');at+=n.bytesWritten}bytes=Math.max(bytes,chunk.position+chunk.data.length)}}),{chunked:true,chunkSize:MEDIA_LIMITS.chunkBytes})})
  conversion=await Conversion.init({input,output,tracks:'all',copy:{mode:'forced',shiftTolerance:0,boundaryPolicy:'expand',boundaryTolerance:30},trim:{start:base,end:request.endSeconds},showWarnings:false})
  assertPreservedMediaTracks(tracks.map(t=>t.id),conversion.utilizedTracks.map(t=>t.id),conversion.discardedTracks.map(t=>t.reason),conversion.isValid)
  const cancel=()=>{void conversion?.cancel().catch(()=>{})};abort.addEventListener('abort',cancel,{once:true});try{await conversion.execute()}finally{abort.removeEventListener('abort',cancel)}
  await guard();await handle.sync();await handle.close();handle=undefined
  const outputIO=await ArtifactJobIO.open(root,{action:'media.inspect',artifactId}),check=new Input({formats:[MP4],source:source(outputIO)})
  try{
   const actual=await check.getTracks(),first=await check.getFirstTimestamp(),end=await check.computeDuration()
   if(actual.length!==tracks.length||!Number.isFinite(first)||!Number.isFinite(end)||end-first>MEDIA_LIMITS.durationSeconds||first>0.05||base+end<request.endSeconds-.1)throw new Error('Copied segment does not cover the requested archive interval within the processing budget.')
   for(const [index,track]of actual.entries())if(track.type!==tracks[index]!.type||await track.getCodec()!==await tracks[index]!.getCodec())throw new Error('Segment changed or discarded a source track.')
   const sha256=await outputIO.fingerprint(abort);if(await io.fingerprint(abort)!==sourceSha256)throw new Error('Archive changed during segmentation.')
   const proof={version:1,kind:'archive-segment',reencoded:false,sourceArtifactId:request.artifactId,sourceSha256,sourceDurationSeconds:duration,requestedSourceRange:{startSeconds:request.startSeconds,endSeconds:request.endSeconds},sourceTimeOffsetSeconds:base,actualSourceRange:{startSeconds:base+first,endSeconds:base+end},artifactId,sha256,bytes,durationSeconds:end,firstTimestampSeconds:first,tracks:await Promise.all(actual.map(async t=>({id:t.id,type:t.type,codec:await t.getCodec()})))}
   await guard();const proofHandle=await fs.open(path.join(root,proofId),'wx',0o600);created.push(path.join(root,proofId));try{await proofHandle.writeFile(JSON.stringify(proof,null,2)+'\n');await proofHandle.sync()}finally{await proofHandle.close()}
   await saveMediaDerivation(root,{version:1,kind:'native-media-conversion',artifactId,sha256,sourceArtifactId:request.artifactId,sourceSha256,sourceRange:proof.actualSourceRange},abort)
   created.push(path.join(root,artifactId+'.derivation.json'))
   await guard();success=true;return {...proof,path:file,proofArtifactId:proofId,type:'video',contentType:'video/mp4',engine:'mediabunny-packet-copy',decodeVerification:'not-performed; process this bounded segment separately'}
  }finally{check.dispose();await outputIO.close()}
 }finally{
  await conversion?.cancel().catch(()=>{});input.dispose();await handle?.close();await io.close()
  if(!success&&created.length){const cleanup=async()=>{const s=await fs.lstat(root);if(s.isSymbolicLink()||s.dev!==identity.dev||s.ino!==identity.ino)throw new Error('Archive segment cleanup Project changed.');for(const f of created)await fs.rm(f,{force:true})};try{await cleanup()}catch(e){throw new PreservationCleanupError(cleanup,e)}}
 }
}
