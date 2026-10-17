import {Input,CustomSource,WEBM,EncodedPacketSink,Output,AppendOnlyStreamTarget,WebMOutputFormat,EncodedVideoPacketSource,EncodedAudioPacketSource,EncodedPacket} from 'mediabunny'
import type {FileHandle} from 'node:fs/promises'
import {ArtifactJobIO} from './artifact-job-io.js'
import {assertFrameMapping,CAPTURE_FRAME_LIMIT} from './capture-timeline.js'
import type {CaptureFrameMapping} from './capture-timeline.js'
import {finiteNumber,mediaRecord} from './media-contract.js'
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
  let audioIO:ArtifactJobIO|undefined,input:Input|undefined,position=0
  const mux=new Output({format:new WebMOutputFormat({appendOnly:true}),target:new AppendOnlyStreamTarget(new WritableStream<Uint8Array>({write:async bytes=>{await guard();if(position+bytes.length>512*1024*1024)throw new Error('Capture output exceeds 512 MiB.');let offset=0;while(offset<bytes.length){const result=await output.write(bytes,offset,bytes.length-offset,position+offset);if(!result.bytesWritten)throw new Error('Capture mux write made no progress.');offset+=result.bytesWritten}position+=bytes.length}}))})
  try{
   const video=new EncodedVideoPacketSource('vp9');// WebM uses millisecond timecodes. A 1ms default duration preserves the
   // chosen integer-ms PTS without snapping VFR frames to a nominal 60Hz grid.
   mux.addVideoTrack(video,{frameRate:1000})
   const audios:{source:EncodedAudioPacketSource;sink:EncodedPacketSink;config:AudioDecoderConfig}[]=[]
   if(audioArtifactId){
    audioIO=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:audioArtifactId});const pinned=audioIO
    input=captureInput(pinned,guard)
    const tracks=await input.getAudioTracks();if(tracks.length!==config.audioTracks|| (await input.getVideoTracks()).length)throw new Error('Capture audio recorder changed its track layout.')
    for(const track of tracks){if(await track.getCodec()!=='opus')throw new Error('Unexpected captured audio codec.');const decoder=await track.getDecoderConfig();if(!decoder)throw new Error('Captured audio config is missing.');const source=new EncodedAudioPacketSource('opus');mux.addAudioTrack(source);audios.push({source,sink:new EncodedPacketSink(track),config:decoder})}
   }else if(config.audioTracks)throw new Error('Capture lost its audio track.')
   await mux.start()
   // Streams are independent. Concurrent producer promises respect mux backpressure.
   const producers=[
    (async()=>{for(const row of this.rows){await guard();const bytes=Buffer.alloc(row.bytes);const result=await this.spool.read(bytes,0,bytes.length,row.offset);if(result.bytesRead!==bytes.length)throw new Error('Encoded capture spool was truncated.');await video.add(new EncodedPacket(bytes,row.type,row.fileTimestampSeconds,row.fileDurationSeconds),{decoderConfig:{codec:config.codec,codedWidth:width,codedHeight:height}})}video.close()})(),
    ...audios.map(async item=>{for await(const packet of item.sink.packets()){await guard();await item.source.add(packet,{decoderConfig:item.config})}item.source.close()})
   ]
   try{await Promise.all(producers)}catch(error){await mux.cancel().catch(()=>{});await Promise.allSettled(producers);throw error}
   await mux.finalize();await output.sync();return {bytes:position,frames:this.rows.map(({offset:_offset,bytes:_bytes,type:_type,...timing})=>timing)}
  }catch(error){await mux.cancel().catch(()=>{});throw error}finally{input?.dispose();await audioIO?.close()}
 }
}
/** Verify actual container PTS, frame count and durations before publishing a mapping. */
export async function verifyCaptureMux(directory:string,artifactId:string,frames:CaptureFrameMapping[],guard:()=>Promise<void>){
 const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId})
 const input=captureInput(io,guard)
 try{const track=await input.getPrimaryVideoTrack();if(!track)throw new Error('Muxed capture has no video.');let count=0
  for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true})){await guard();const row=frames[count++];if(!row||Math.abs(packet.timestamp-row.fileTimestampSeconds)>.000001)throw new Error('Muxed packet PTS does not match its captured source frame: '+JSON.stringify({count,actual:packet.timestamp,expected:row?.fileTimestampSeconds}))}
  const end=await track.computeDuration();frames.at(-1)!.fileDurationSeconds=end-frames.at(-1)!.fileTimestampSeconds
  if(count!==frames.length)throw new Error('Muxed capture frame count mismatch.')
  return await io.fingerprint()
 }finally{input.dispose();await io.close()}
}
