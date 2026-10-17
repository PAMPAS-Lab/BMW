import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {ArtifactJobIO} from './artifact-job-io.js'
import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'
import {assertMappedIndex,CAPTURE_INDEX_BYTES} from './capture-timeline.js'
import type {CaptureMappedIndex} from './capture-timeline.js'

export interface CaptureSourceFrame {sourceTimestampSeconds:number;endSourceSeconds:number;presentedFrames:number;width:number;height:number;artifactId:string;sha256:string}
export interface CaptureSourceIndex {
 version:1;sourceArtifactId:string;videoSha256:string;basis:'requestVideoFrameCallback.mediaTime';fileTimestampMapping:'unavailable';
 sourceStartSeconds:number;sourceEndSeconds:number;durationAtStartSeconds:number|null;sourceDurationSeconds:number|null;
 status:'indexed'|'unavailable';reason:string|null;frames:CaptureSourceFrame[]
}
export const captureIndexId=(artifactId:string)=>assertArtifactId(artifactId+'.source.json')
export function assertCaptureSourceIndex(raw:unknown,artifactId:string):CaptureSourceIndex {
 const value=mediaRecord(raw)
 if(value.version!==1||value.sourceArtifactId!==artifactId||!/^([a-f0-9]{64})$/.test(String(value.videoSha256))||value.basis!=='requestVideoFrameCallback.mediaTime'||value.fileTimestampMapping!=='unavailable'||!['indexed','unavailable'].includes(String(value.status))||!(value.reason===null||typeof value.reason==='string'&&value.reason.length<=500)||!Array.isArray(value.frames)||value.frames.length>9)throw new TypeError('Invalid capture source index.')
 const start=finiteNumber(value.sourceStartSeconds,'source start',0,86400),end=finiteNumber(value.sourceEndSeconds,'source end',start,86400)
 for(const key of ['durationAtStartSeconds','sourceDurationSeconds'])if(value[key]!==null)finiteNumber(value[key],key,.001,86400)
 let previous=-1
 const frames=value.frames.map(raw=>{const f=mediaRecord(raw),time=finiteNumber(f.sourceTimestampSeconds,'source frame PTS',start,end),until=finiteNumber(f.endSourceSeconds,'source frame interval',time,end)
  if(time<=previous||!/^([a-f0-9]{64})$/.test(String(f.sha256)))throw new TypeError('Invalid source frame order or hash.');previous=time
  return {sourceTimestampSeconds:time,endSourceSeconds:until,presentedFrames:finiteNumber(f.presentedFrames,'presented frame counter',0,Number.MAX_SAFE_INTEGER,true),width:finiteNumber(f.width,'source PNG width',1,1280,true),height:finiteNumber(f.height,'source PNG height',1,720,true),artifactId:assertArtifactId(f.artifactId),sha256:String(f.sha256)}
 })
 if(value.status==='indexed'&&!frames.length||value.status==='unavailable'&&frames.length)throw new TypeError('Capture index status contradicts native frames.')
 return {...value,frames} as unknown as CaptureSourceIndex
}
export function captureIndexSummary(index:CaptureSourceIndex|CaptureMappedIndex){
 if(index.version===2){const changes=index.frames.filter((f,i,rows)=>f.sourceWidth!==undefined&&(!i||f.sourceWidth!==rows[i-1]!.sourceWidth||f.sourceHeight!==rows[i-1]!.sourceHeight));return {status:index.status,reason:null,basis:index.basis,mapping:'source-to-recording-file-PTS',fileTimestampMapping:'verified',selection:'preceding-captured-source-frame',durationAtStartSeconds:index.durationAtStartSeconds,sourceDurationSeconds:index.sourceDurationSeconds,sourceStartSeconds:index.sourceStartSeconds,sourceEndSeconds:index.sourceEndSeconds,indexArtifactId:captureIndexId(index.sourceArtifactId),frameArtifactIds:[],indexedSourceRanges:[{startSeconds:index.frames[0]!.sourceTimestampSeconds,endSeconds:index.sourceEndSeconds}],frameCount:index.frames.length,resolutionPolicy:index.frames[0]!.sourceWidth===undefined?'legacy fixed dimensions; adaptive changes were rejected':'contain-in-initial-output-canvas; capture is reencoded',resolutionChangeCount:changes.length,sourceResolutionChangesTruncated:changes.length>64,sourceResolutionChanges:changes.slice(0,64).map(f=>({sourceSeconds:f.sourceTimestampSeconds,width:f.sourceWidth,height:f.sourceHeight})),fileStartSeconds:index.frames[0]!.fileTimestampSeconds,fileEndSeconds:index.frames.at(-1)!.fileTimestampSeconds+index.frames.at(-1)!.fileDurationSeconds,playbackEvents:index.playbackEvents,next:{action:'media.capture.frames.sample',artifactId:index.sourceArtifactId,sourceTimestampsSeconds:[(index.frames[0]!.sourceTimestampSeconds+index.sourceEndSeconds)/2,Math.max(index.frames[0]!.sourceTimestampSeconds,index.sourceEndSeconds-.1)]}}}
return {status:index.status,reason:index.reason,basis:index.basis,mapping:'source-to-saved-native-PNG',fileTimestampMapping:index.fileTimestampMapping,durationAtStartSeconds:index.durationAtStartSeconds,sourceDurationSeconds:index.sourceDurationSeconds,sourceStartSeconds:index.sourceStartSeconds,sourceEndSeconds:index.sourceEndSeconds,indexArtifactId:captureIndexId(index.sourceArtifactId),frameArtifactIds:index.frames.map(f=>f.artifactId),indexedSourceRanges:index.frames.map(f=>({startSeconds:f.sourceTimestampSeconds,endSeconds:f.endSourceSeconds})),frameCount:index.frames.length,next:{action:'media.capture.frames.sample',artifactId:index.sourceArtifactId,sourceTimestampsSeconds:index.frames.slice(-3).map(f=>f.sourceTimestampSeconds)}}}
export async function readCaptureIndex(directory:string,artifactId:string,signal?:AbortSignal):Promise<CaptureSourceIndex|CaptureMappedIndex|undefined>{
 let io:ArtifactJobIO
 try{io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:captureIndexId(artifactId)})}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
 try{
  if(io.bytes>CAPTURE_INDEX_BYTES)throw new Error('Capture source index exceeds its budget.')
  const hash=await io.fingerprint(signal),bytes=Buffer.alloc(io.bytes)
  for(let offset=0;offset<io.bytes;offset+=1024*1024){signal?.throwIfAborted();bytes.set(await io.read(offset,Math.min(1024*1024,io.bytes-offset)),offset)}
  const value=JSON.parse(bytes.toString('utf8')),index=value.version===2?assertMappedIndex(value,artifactId):assertCaptureSourceIndex(value,artifactId)
  const video=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId})
  try{if(await video.fingerprint(signal)!==index.videoSha256)throw new Error('CAPTURE_SOURCE_CHANGED: Video no longer matches its source index.')}finally{await video.close()}
  if(await io.fingerprint(signal)!==hash)throw new Error('Capture source index changed during read.')
  return index
 }finally{await io.close()}
}
interface DecodedCaptureFrame {outputIndex:number;timestampSeconds:number;durationSeconds:number;artifactId:string;path:string;bytes:number;width:number;height:number;type:string;contentType:string}
export type CaptureFrameDecoder=(request:{action:'media.frames.sample';artifactId:string;timestampsSeconds:number[];maxWidth:number;maxHeight:number},signal?:AbortSignal)=>Promise<{frames:DecodedCaptureFrame[]}>
export async function sampleCaptureSourceFrames(directory:string,raw:unknown,signal?:AbortSignal,decode?:CaptureFrameDecoder){
 const value=mediaRecord(raw)
 if(value.action!=='media.capture.frames.sample'||Object.keys(value).some(k=>!['action','artifactId','sourceTimestampsSeconds','tabId'].includes(k))||!Array.isArray(value.sourceTimestampsSeconds)||!value.sourceTimestampsSeconds.length||value.sourceTimestampsSeconds.length>8)throw new TypeError('Source frame sampling requires artifactId and 1 to 8 sourceTimestampsSeconds.')
 const artifactId=assertArtifactId(value.artifactId),times=value.sourceTimestampsSeconds.map(t=>finiteNumber(t,'source timestamp',0,86400)),index=await readCaptureIndex(directory,artifactId,signal)
 if(!index||index.status!=='indexed')throw new Error(JSON.stringify({code:'CAPTURE_SOURCE_INDEX_UNAVAILABLE',message:index?.reason??'This legacy artifact has no native source frame index; capture it again. No source time was inferred from file duration.'}))
 if(index.version===2){
  if(!decode)throw new Error('Source-to-file frame decoder is unavailable.')
  const selected=times.map(time=>{
   // Binary search exact saved source PTS. Never interpolate across pause/rate changes.
   let lo=0,hi=index.frames.length
   while(lo<hi){const mid=(lo+hi)>>>1;if(index.frames[mid]!.sourceTimestampSeconds<=time)lo=mid+1;else hi=mid}
   const f=index.frames[lo-1]
   if(!f||time>=f.endSourceSeconds&&time!==f.sourceTimestampSeconds)throw new Error(JSON.stringify({code:'CAPTURE_SOURCE_TIME_UNINDEXED',requestedSourceSeconds:time,availableSourceRanges:captureIndexSummary(index).indexedSourceRanges,message:'Requested source time lies outside this capture.'}))
   return f
  })
  let decoded:{frames:DecodedCaptureFrame[]}|undefined
  try{
   decoded=await decode({action:'media.frames.sample',artifactId,timestampsSeconds:selected.map(f=>f.fileTimestampSeconds),maxWidth:1280,maxHeight:720},signal)
   if(decoded.frames.length!==times.length)throw new Error('Mapped decoder returned the wrong frame count.')
   const current=await readCaptureIndex(directory,artifactId,signal)
   if(!current||current.version!==2||JSON.stringify(current)!==JSON.stringify(index))throw new Error('CAPTURE_SOURCE_CHANGED: Video or timeline changed during decoding.')
   const frames=[]
   for(const [i,frame]of decoded.frames.entries()){
    const f=selected[i]!
    if(Math.abs(frame.timestampSeconds-f.fileTimestampSeconds)>.000001)throw new Error('CAPTURE_SOURCE_CHANGED: Decoded frame PTS does not match its source mapping.')
    const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:frame.artifactId})
    try{const sha256=await io.fingerprint(signal);frames.push({...frame,requestedSourceSeconds:times[i],sourceTimestampSeconds:f.sourceTimestampSeconds,endSourceSeconds:f.endSourceSeconds,sourceDistanceSeconds:times[i]!-f.sourceTimestampSeconds,sourcePresentedFrames:f.presentedFrames,...(f.sourceWidth===undefined?{}:{sourceWidth:f.sourceWidth,sourceHeight:f.sourceHeight}),fileTimestampSeconds:frame.timestampSeconds,fileDurationSeconds:f.fileDurationSeconds,playbackRate:f.playbackRate,sha256})}finally{await io.close()}
   }
   return {type:'frame-set',engine:'mediabunny-webcodecs-source-map',sourceArtifactId:artifactId,videoSha256:index.videoSha256,basis:index.basis,timebase:'source',selection:'preceding-captured-source-frame',fileTimestampMapping:'verified',frames}
  }catch(error){
   for(const frame of decoded?.frames??[]){if(path.basename(frame.artifactId)===frame.artifactId&&frame.path===path.join(directory,frame.artifactId))await fs.rm(frame.path,{force:true})}
   throw error
  }
 }
 const frames=[]
 for(const [outputIndex,time]of times.entries()){
  signal?.throwIfAborted()
  const f=[...index.frames].reverse().find(f=>f.sourceTimestampSeconds<=time&&(time<f.endSourceSeconds||time===f.sourceTimestampSeconds))
  if(!f)throw new Error(JSON.stringify({code:'CAPTURE_SOURCE_TIME_UNINDEXED',requestedSourceSeconds:time,availableSourceRanges:captureIndexSummary(index).indexedSourceRanges,recovery:{action:'media.inspect',artifactId},message:'No indexed native frame covers this source time. No interpolation or file-clock substitution was performed.'}))
  const image=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:f.artifactId})
  try{
   const header=Buffer.from(await image.read(0,Math.min(24,image.bytes)))
   if(image.bytes>20*1024*1024||header.length<24||!header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||header.readUInt32BE(16)!==f.width||header.readUInt32BE(20)!==f.height||await image.fingerprint(signal)!==f.sha256)throw new Error('CAPTURE_SOURCE_CHANGED: Native source PNG no longer matches its index.')
   frames.push({outputIndex,requestedSourceSeconds:time,sourceTimestampSeconds:f.sourceTimestampSeconds,endSourceSeconds:f.endSourceSeconds,sourceDistanceSeconds:time-f.sourceTimestampSeconds,sourcePresentedFrames:f.presentedFrames,fileTimestampSeconds:null,artifactId:f.artifactId,path:path.join(image.root,f.artifactId),bytes:image.bytes,width:f.width,height:f.height,type:'screenshot',contentType:'image/png',sha256:f.sha256})
  }finally{await image.close()}
 }
 return {type:'frame-set',engine:'native-source-frame-index',sourceArtifactId:artifactId,videoSha256:index.videoSha256,basis:index.basis,timebase:'source',selection:'preceding-indexed-native-frame',fileTimestampMapping:'unavailable',frames}
}
/** Outputs are exclusive, bounded, and owned by the capture's rollback guard. */
export async function saveCaptureIndex(directory:string,index:Omit<CaptureSourceIndex,'frames'|'status'|'reason'>,frames:{sourceTimestampSeconds:number;endSourceSeconds:number;presentedFrames:number;width:number;height:number;data:string}[],reason:string|null,created:string[],guard:()=>Promise<void>){
 const saved:CaptureSourceFrame[]=[];let total=0
 for(const [i,frame]of frames.entries()){
  await guard()
  if(frame.data.length>28*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(frame.data))throw new Error('Invalid native source PNG packet.')
  const bytes=Buffer.from(frame.data,'base64');total+=bytes.length
  if(total>20*1024*1024||bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)!==frame.width||bytes.readUInt32BE(20)!==frame.height)throw new Error('Native source PNG exceeds bounds or has invalid dimensions.')
  const artifactId=assertArtifactId(index.sourceArtifactId+'.source-'+i+'.png'),file=path.join(directory,artifactId),handle=await fs.open(file,'wx',0o600);created.push(file)
  try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
  const {data:_data,...metadata}=frame;saved.push({...metadata,artifactId,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})
 }
 const result=assertCaptureSourceIndex({...index,status:saved.length?'indexed':'unavailable',reason:saved.length?null:reason??'No native source frames were observed.',frames:saved},index.sourceArtifactId)
 await guard();const file=path.join(directory,captureIndexId(index.sourceArtifactId)),handle=await fs.open(file,'wx',0o600);created.push(file)
 try{await handle.writeFile(JSON.stringify(result)+'\n');await handle.sync()}finally{await handle.close()}
 await guard();return captureIndexSummary(result)
}

/** Finalized, demux-verified mapping. No whole-video PNG cache is retained. */
export async function saveMappedCaptureIndex(directory:string,raw:CaptureMappedIndex,created:string[],guard:()=>Promise<void>){
 const index=assertMappedIndex(raw,raw.sourceArtifactId),bytes=Buffer.from(JSON.stringify(index)+'\n')
 if(bytes.length>CAPTURE_INDEX_BYTES)throw new Error('Capture source mapping exceeds 32 MiB.')
 await guard();const file=path.join(directory,captureIndexId(index.sourceArtifactId)),handle=await fs.open(file,'wx',0o600);created.push(file)
 try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
 await guard();return captureIndexSummary(index)
}
