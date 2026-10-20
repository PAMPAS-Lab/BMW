import {Input,CustomSource,WEBM,EncodedPacketSink} from 'mediabunny'
import type {FileHandle} from 'node:fs/promises'
import {ArtifactJobIO} from './artifact-job-io.js'
import {assertFrameMapping,CAPTURE_FRAME_LIMIT} from './capture-timeline.js'
import type {CaptureFrameMapping} from './capture-timeline.js'
import {finiteNumber,mediaRecord} from './media-contract.js'
import {CaptureWebm} from './capture-webm.js'
function captureInput(io:ArtifactJobIO,guard:()=>Promise<void>){
 return new Input({formats:[WEBM],source:new CustomSource({
  getSize:()=>io.bytes,maxCacheSize:8*1024*1024,prefetchProfile:'none',
  read:(start,end)=>{
   let offset=start
   return new ReadableStream<Uint8Array>({async pull(controller){
    try{await guard();if(offset>=end){controller.close();return}const data=await io.read(offset,Math.min(end-offset,1024*1024));offset+=data.length;controller.enqueue(data)}catch(error){controller.error(error)}
   }})
  }
 })})
}
export interface CaptureEncodedPacket extends CaptureFrameMapping {data:string;type:'key'|'delta'}
interface SpoolRow extends CaptureFrameMapping {offset:number;bytes:number;type:'key'|'delta'}
/** No model input, codecs or arbitrary paths: one capture's exclusively-owned files. */
export class CaptureMux {
 private rows:SpoolRow[]=[];private bytes=0
 constructor(private spool:FileHandle){}
 async add(raw:unknown,guard:()=>Promise<void>){
  const value=mediaRecord(raw),{data,type,...timing}=value,frame=assertFrameMapping(timing)
  if(type!=='key'&&type!=='delta'||typeof data!=='string'||data.length>12*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(data))throw new TypeError('Invalid encoded capture packet.')
  const bytes=Buffer.from(data,'base64');if(!bytes.length||this.rows.length>=CAPTURE_FRAME_LIMIT||this.bytes+bytes.length>512*1024*1024)throw new Error('Encoded capture budget exceeded.')
  const prior=this.rows.at(-1);if(prior&&(frame.fileTimestampSeconds<=prior.fileTimestampSeconds||frame.sourceTimestampSeconds<=prior.sourceTimestampSeconds))throw new Error('Capture encoder reordered or duplicated frame evidence.')
  await guard();await this.spool.writeFile(bytes);this.rows.push({...frame,type,offset:this.bytes,bytes:bytes.length});this.bytes+=bytes.length
 }
 async finish(directory:string,audioArtifactId:string|undefined,output:FileHandle,config:{width:number;height:number;codec:string;audioTracks:number},guard:()=>Promise<void>){
  if(!this.rows.length)throw new Error('Capture encoder emitted no video frames.')
  const width=finiteNumber(config.width,'encoded width',1,8192,true),height=finiteNumber(config.height,'encoded height',1,8192,true)
  if(config.codec!=='vp09.00.10.08')throw new Error('Unexpected capture codec.')
  let audioIO:ArtifactJobIO|undefined,input:Input|undefined
  try{
   let audioConfig:AudioDecoderConfig|undefined,audioPackets:AsyncIterator<import('mediabunny').EncodedPacket>|undefined,audioEnd=0
   if(audioArtifactId){
    audioIO=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:audioArtifactId});input=captureInput(audioIO,guard)
    const tracks=await input.getAudioTracks();if(tracks.length!==1||tracks.length!==config.audioTracks||(await input.getVideoTracks()).length)throw new Error('Capture audio recorder changed its track layout.')
    const track=tracks[0]!;if(await track.getCodec()!=='opus')throw new Error('Unexpected captured audio codec.')
    audioConfig=await track.getDecoderConfig()??undefined;if(!audioConfig)throw new Error('Captured audio config is missing.');audioEnd=await track.computeDuration()
    audioPackets=new EncodedPacketSink(track).packets()[Symbol.asyncIterator]()
   }else if(config.audioTracks)throw new Error('Capture lost its audio track.')
   const mux=new CaptureWebm(output,guard),last=this.rows.at(-1)!
   await mux.start(width,height,audioConfig,Math.max(audioEnd,last.fileTimestampSeconds+last.fileDurationSeconds))
   let audio=await audioPackets?.next()
   for(const row of this.rows){
    while(audio&&!audio.done&&audio.value.timestamp<=row.fileTimestampSeconds){const p=audio.value;await mux.add({track:2,timestamp:p.timestamp,duration:p.duration,type:p.type,data:p.data});audio=await audioPackets!.next()}
    await guard();const bytes=Buffer.alloc(row.bytes),result=await this.spool.read(bytes,0,bytes.length,row.offset);if(result.bytesRead!==bytes.length)throw new Error('Encoded capture spool was truncated.')
    await mux.add({track:1,timestamp:row.fileTimestampSeconds,duration:row.fileDurationSeconds,type:row.type,data:bytes})
   }
   while(audio&&!audio.done){const p=audio.value;await mux.add({track:2,timestamp:p.timestamp,duration:p.duration,type:p.type,data:p.data});audio=await audioPackets!.next()}
   await output.sync();return {bytes:mux.bytes,frames:this.rows.map(({offset:_offset,bytes:_bytes,type:_type,...timing})=>timing)}
  }finally{input?.dispose();await audioIO?.close()}
 }
}
/** Verify actual container PTS, frame count and durations before publishing a mapping. */
export async function verifyCaptureMux(directory:string,artifactId:string,frames:CaptureFrameMapping[],guard:()=>Promise<void>){
 const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId})
 const input=captureInput(io,guard)
 try{const track=await input.getPrimaryVideoTrack();if(!track)throw new Error('Muxed capture has no video.');let count=0
  for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true})){await guard();const row=frames[count++];if(!row||Math.abs(packet.timestamp-row.fileTimestampSeconds)>.000001)throw new Error('Muxed packet PTS does not match its captured source frame: '+JSON.stringify({count,actual:packet.timestamp,expected:row?.fileTimestampSeconds}))}
  const last=frames.at(-1)!,end=await track.computeDuration();if(Math.abs(end-(last.fileTimestampSeconds+last.fileDurationSeconds))>.0011)throw new Error('Muxed capture lost its terminal frame duration.')
  if(count!==frames.length)throw new Error('Muxed capture frame count mismatch.')
  return await io.fingerprint()
 }finally{input.dispose();await io.close()}
}
