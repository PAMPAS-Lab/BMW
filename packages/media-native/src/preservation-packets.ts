/** Expected MP4 serialization of an encoded packet. Only container framing is
 * transformed; every NAL (including SPS/PPS, SEI and AUD) and AAC payload remains. */
export interface PreservationPacketConfig {codec:string;description?:AllowSharedBufferSource;sampleRate?:number;numberOfChannels?:number}
export function preservationPacketFormat(codec:string,config:PreservationPacketConfig):'exact'|'annex-b-to-length4'|'adts-to-raw' {
 return !config.description?(codec==='avc'||codec==='hevc'?'annex-b-to-length4':codec==='aac'?'adts-to-raw':'exact'):'exact'
}
export function preservationPacketParts(data:Uint8Array,codec:string,config:PreservationPacketConfig):Uint8Array[]{
 const format=preservationPacketFormat(codec,config)
 if(format==='exact')return [data]
 if(format==='adts-to-raw'){
  const rates=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350],channels=[0,1,2,3,4,5,6,8]
  if(data.length<7||data[0]!==255||(data[1]!&246)!==240)throw new Error('Invalid preserved ADTS header.')
  const size=((data[3]!&3)<<11)|(data[4]!<<3)|(data[5]!>>5),header=(data[1]!&1)?7:9,rate=rates[(data[2]!>>2)&15],channel=channels[((data[2]!&1)<<2)|(data[3]!>>6)],profile=(data[2]!>>6)+1
  if(size!==data.length||size<=header||(data[6]!&3)!==0||!rate||!channel||rate!==config.sampleRate||channel!==config.numberOfChannels||config.codec!=='mp4a.40.'+profile)throw new Error('Preserved ADTS configuration or frame length changed.')
  return [data.subarray(header)]
 }
 const parts:Uint8Array[]=[];let start=-1,at=0
 while(at+2<data.length){let size=0;if(data[at]===0&&data[at+1]===0){if(data[at+2]===1)size=3;else if(at+3<data.length&&data[at+2]===0&&data[at+3]===1)size=4}
  if(!size){if(start<0&&data[at]!==0)throw new Error('Invalid preserved Annex B prefix.');at++;continue}
  if(start>=0){if(at===start)throw new Error('Empty preserved NAL unit.');const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,at-start);parts.push(length,data.subarray(start,at))}
  start=at+size;at=start
 }
 if(start<0||start>=data.length)throw new Error('Invalid preserved Annex B packet.')
 const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,data.length-start);parts.push(length,data.subarray(start));return parts
}
/** Match packet boundaries and PTS, not merely whole-track concatenated hashes. */
export function assertPreservedPacket(source:{data:Uint8Array;timestamp:number;duration:number},actual:{data:Uint8Array;timestamp:number;duration:number},codec:string,config:PreservationPacketConfig,audio:boolean):void {
 if(!Number.isFinite(source.timestamp)||!Number.isFinite(actual.timestamp)||Math.abs(source.timestamp-actual.timestamp)>.001||audio&&Math.abs(source.duration-actual.duration)>.001)throw new Error('MEDIA_PRESERVATION_PACKET_PTS_CHANGED: Remux changed packet PTS or audio duration.')
 const parts=preservationPacketParts(source.data,codec,config);let offset=0
 for(const part of parts){if(offset+part.length>actual.data.length||Buffer.compare(Buffer.from(part.buffer,part.byteOffset,part.byteLength),Buffer.from(actual.data.buffer,actual.data.byteOffset+offset,part.byteLength))!==0)throw new Error('MEDIA_PRESERVATION_PACKET_PAYLOAD_CHANGED: Remux changed encoded packet payload.');offset+=part.length}
 if(offset!==actual.data.length)throw new Error('MEDIA_PRESERVATION_PACKET_PAYLOAD_CHANGED: Remux changed packet boundary.')
}

/** At most two million fixed-size records per track (40 MB), no encoded data.
 * A second source demux is unnecessary; verify output against this bounded index. */
export class PreservationPacketTimeline {
 private chunks:{pts:Float64Array;duration:Float64Array;bytes:Uint32Array}[]=[]
 private count=0
 add(packet:{timestamp:number;duration:number},bytes:number):void {
  if(this.count>=2_000_000||!Number.isFinite(packet.timestamp)||!Number.isFinite(packet.duration)||packet.duration<0||!Number.isInteger(bytes)||bytes<1||bytes>0xffffffff)throw new Error('Invalid or oversized preservation packet index.')
  const group=Math.floor(this.count/4096),index=this.count%4096;if(!this.chunks[group])this.chunks.push({pts:new Float64Array(4096),duration:new Float64Array(4096),bytes:new Uint32Array(4096)})
  const chunk=this.chunks[group]!;chunk.pts[index]=packet.timestamp;chunk.duration[index]=packet.duration;chunk.bytes[index]=bytes;this.count++
 }
 check(index:number,packet:{timestamp:number;duration:number;data:Uint8Array},audio:boolean):void {
  if(!Number.isSafeInteger(index)||index<0||index>=this.count)throw new Error('Remux added delivery packets.')
  const group=this.chunks[Math.floor(index/4096)]!,i=index%4096
  if(!Number.isFinite(packet.duration)||packet.duration<0||!Number.isFinite(packet.timestamp)||Math.abs(group.pts[i]!-packet.timestamp)>.001||audio&&(!Number.isFinite(packet.duration)||Math.abs(group.duration[i]!-packet.duration)>.001))throw new Error('MEDIA_PRESERVATION_PACKET_PTS_CHANGED: Remux changed packet PTS or audio duration.')
  if(group.bytes[i]!==packet.data.length)throw new Error('MEDIA_PRESERVATION_PACKET_PAYLOAD_CHANGED: Remux changed packet boundary.')
 }
}
/** Length-delimited digest prevents shifting bytes between packet boundaries. */
export function hashPreservationPacket(hash:{update(data:Uint8Array):unknown},parts:readonly Uint8Array[]):number {
 const bytes=parts.reduce((total,p)=>total+p.length,0);if(bytes<1||bytes>0xffffffff)throw new Error('Invalid preserved packet length.')
 const size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,bytes);hash.update(size);for(const part of parts)hash.update(part);return bytes
}
