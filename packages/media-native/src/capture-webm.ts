import type {FileHandle} from 'node:fs/promises'

const uint=(value:number)=>{let n=BigInt(value),size=1;while(n>>BigInt(size*8))size++;const b=Buffer.alloc(size);for(let i=size-1;i>=0;i--){b[i]=Number(n&255n);n>>=8n}return b}
const size=(length:number)=>{let width=1;while(BigInt(length)>=(1n<<BigInt(7*width))-1n)width++;const bytes=Buffer.alloc(width);let n=BigInt(length)|(1n<<BigInt(7*width));for(let i=width-1;i>=0;i--){bytes[i]=Number(n&255n);n>>=8n}return bytes}
const element=(id:number,data:Uint8Array)=>Buffer.concat([uint(id),size(data.length),data])
const number=(id:number,value:number)=>element(id,uint(value))
const text=(id:number,value:string)=>element(id,Buffer.from(value))
const master=(id:number,children:Uint8Array[])=>element(id,Buffer.concat(children))
const float=(id:number,value:number)=>{const b=Buffer.alloc(8);b.writeDoubleBE(value);return element(id,b)}
const open=(id:number)=>Buffer.concat([uint(id),Buffer.from([1,255,255,255,255,255,255,255])])
export interface CaptureWebmPacket {track:number;timestamp:number;duration:number;type:'key'|'delta';data:Uint8Array}
/** Capture-only WebM packet writer. Explicit BlockDuration preserves the final
 * held VFR frame, including a longer audio tail. No decoding, seeking or invented
 * source samples; every block is an already encoded native packet. */
export class CaptureWebm {
 private position=0;private cluster=-1;private previous=new Map<number,number>()
 constructor(private output:FileHandle,private guard:()=>Promise<void>){}
 get bytes(){return this.position}
 private async write(bytes:Uint8Array){await this.guard();if(this.position+bytes.length>512*1024*1024)throw new Error('Capture output exceeds 512 MiB.');let at=0;while(at<bytes.length){const r=await this.output.write(bytes,at,bytes.length-at,this.position+at);if(!r.bytesWritten)throw new Error('Capture mux write made no progress.');at+=r.bytesWritten}this.position+=bytes.length}
 async start(width:number,height:number,audio:AudioDecoderConfig|undefined,duration:number){
  await this.write(master(0x1a45dfa3,[number(0x4286,1),number(0x42f7,1),number(0x42f2,4),number(0x42f3,8),text(0x4282,'webm'),number(0x4287,4),number(0x4285,2)]))
  await this.write(open(0x18538067))
  await this.write(master(0x1549a966,[number(0x2ad7b1,1000000),text(0x4d80,'BMW native capture'),text(0x5741,'BMW native capture'),float(0x4489,duration*1000)]))
  const tracks=[master(0xae,[number(0xd7,1),number(0x73c5,1),number(0x83,1),number(0x9c,0),text(0x86,'V_VP9'),master(0xe0,[number(0xb0,width),number(0xba,height)])])]
  if(audio){
   if(audio.codec!=='opus'||!audio.description)throw new Error('Captured Opus decoder header is missing.')
   const d=audio.description,header=Buffer.from(ArrayBuffer.isView(d)?new Uint8Array(d.buffer,d.byteOffset,d.byteLength):new Uint8Array(d))
   if(header.length<19||header.subarray(0,8).toString()!=='OpusHead')throw new Error('Invalid captured Opus header.')
   tracks.push(master(0xae,[number(0xd7,2),number(0x73c5,2),number(0x83,2),number(0x9c,0),text(0x86,'A_OPUS'),element(0x63a2,header),number(0x56bb,80000000),master(0xe1,[float(0xb5,audio.sampleRate),number(0x9f,audio.numberOfChannels)])]))
  }
  await this.write(master(0x1654ae6b,tracks))
 }
 async add(packet:CaptureWebmPacket){
  if(![1,2].includes(packet.track)||!Number.isFinite(packet.timestamp)||packet.timestamp<0||!Number.isFinite(packet.duration)||packet.duration<0||packet.track===1&&packet.duration===0||packet.data.byteLength>8*1024*1024)throw new Error('Invalid native capture packet bounds: '+JSON.stringify({track:packet.track,timestamp:packet.timestamp,duration:packet.duration,bytes:packet.data.byteLength}))
  const timestamp=Math.round(packet.timestamp*1000),duration=packet.duration>0?Math.max(1,Math.round(packet.duration*1000)):0
  if(this.cluster<0||timestamp-this.cluster>30000){this.cluster=timestamp;await this.write(open(0x1f43b675));await this.write(number(0xe7,timestamp))}
  const relative=timestamp-this.cluster;if(relative<0||relative>32767)throw new Error('Capture packet order exceeds cluster bounds.')
  const prefix=Buffer.alloc(4);prefix[0]=0x80|packet.track;prefix.writeInt16BE(relative,1)
  const children=[element(0xa1,Buffer.concat([prefix,packet.data]))]
  // MediaRecorder can leave the final Opus duration unknown (zero). Preserve
  // that state and its codec packet; do not invent a 1ms audio duration.
  if(duration)children.push(number(0x9b,duration))
  if(packet.type==='delta'){
   const previous=this.previous.get(packet.track);if(previous===undefined)throw new Error('Capture starts with an unbound delta packet.')
   const reference=Buffer.alloc(8);reference.writeBigInt64BE(BigInt(previous-timestamp));children.push(element(0xfb,reference))
  }
  await this.write(master(0xa0,children));this.previous.set(packet.track,timestamp)
 }
}
