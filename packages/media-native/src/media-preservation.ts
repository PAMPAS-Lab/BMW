import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {Input,CustomSource,MP4,WEBM,MPEG_TS,EncodedPacketSink,Output,AppendOnlyStreamTarget,Mp4OutputFormat,EncodedVideoPacketSource,EncodedAudioPacketSource} from 'mediabunny'
import {ArtifactJobIO} from './artifact-job-io.js'
import {MEDIA_LIMITS} from './media-contract.js'
import {ARCHIVE_LIMITS} from './archive-limits.js'
import {assertVideoIdentity,sameVideoIdentity} from '@bmw-agent/agent-contract/video-identity'
import type {VideoIdentity} from '@bmw-agent/agent-contract/video-identity'
import {openYoutubeSabrTransfer,bindYoutubeSabrDelivery} from './youtube-sabr.js'
import type {YoutubeSabrWitness,YoutubeSabrTransfer} from './youtube-sabr.js'
export {bindYoutubeSabrDelivery,youtubeSabrUrl,YOUTUBE_SABR_REQUEST_BYTES} from './youtube-sabr.js'
export type {YoutubeSabrWitness} from './youtube-sabr.js'

const sha=(data:Uint8Array)=>crypto.createHash('sha256').update(data).digest('hex')
const http=(value:string,base?:string)=>{if(value.length>8192)throw new Error('Media URL exceeds its budget.');const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Preservation accepts HTTP(S) media only.');return u.href}
export interface HlsPlaylist {variants:{url:string;bandwidth:number;audioGroup?:string}[];audio:{url:string;group:string;default:boolean}[];segments:{url:string;duration:number}[];initialization?:string;duration:number}
function attributes(line:string):Record<string,string>{
 const result:Record<string,string>={};let consumed=0
 const text=line.slice(line.indexOf(':')+1),pattern=/([A-Z0-9-]+)=("[^"]*"|[^,]*)(?:,|$)/g
 for(const match of text.matchAll(pattern)){if(match.index!==consumed)throw new Error('Malformed HLS attributes.');consumed=match.index+match[0].length;result[match[1]!]=match[2]!.replace(/^"|"$/g,'')}
 if(consumed!==text.length)throw new Error('Malformed HLS attributes.');return result
}
/** Deliberately bounded VOD subset. Encryption, live and byte ranges fail closed. */
export function parsePreservationPlaylist(text:string,url:string):HlsPlaylist{
 if(Buffer.byteLength(text)>1024*1024||!text.startsWith('#EXTM3U'))throw new Error('Invalid or oversized HLS manifest.')
 if(/#EXT-X-(?:KEY|SESSION-KEY|BYTERANGE|DISCONTINUITY|GAP|SKIP|PART|PRELOAD-HINT)(?::|\r?$)/m.test(text))throw new Error('Encrypted, ranged, discontinuous or incomplete HLS is unsupported; no complete preservation was published.')
 const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),result:HlsPlaylist={variants:[],audio:[],segments:[],duration:0};let variant:Record<string,string>|undefined,duration:number|undefined
 for(const line of lines){
  if(line.startsWith('#EXT-X-STREAM-INF:')){if(variant||duration!==undefined)throw new Error('Incomplete HLS entry.');variant=attributes(line)}
  else if(line.startsWith('#EXT-X-MEDIA:')){const a=attributes(line);if(a.TYPE==='AUDIO'&&a.URI)result.audio.push({url:http(a.URI,url),group:a['GROUP-ID']??'',default:a.DEFAULT==='YES'});else if(a.TYPE!=='AUDIO')throw new Error('HLS subtitle/alternate tracks are unsupported; no tracks silently discarded.')}
  else if(line.startsWith('#EXT-X-MAP:')){const a=attributes(line);if(!a.URI||a.BYTERANGE||result.initialization&&result.initialization!==http(a.URI,url))throw new Error('Unsupported HLS initialization layout.');result.initialization=http(a.URI,url)}
  else if(line.startsWith('#EXTINF:')){if(duration!==undefined)throw new Error('Missing HLS segment URI.');duration=Number(line.slice(8).split(',')[0]);if(!Number.isFinite(duration)||duration<=0||duration>1800)throw new Error('Invalid HLS segment duration.')}
  else if(!line.startsWith('#')){
   if(variant){const bandwidth=Number(variant.BANDWIDTH);if(!Number.isFinite(bandwidth)||bandwidth<=0)throw new Error('Invalid HLS bandwidth.');result.variants.push({url:http(line,url),bandwidth,...(variant.AUDIO?{audioGroup:variant.AUDIO}:{})});variant=undefined}
   else if(duration!==undefined){result.segments.push({url:http(line,url),duration});result.duration+=duration;duration=undefined}
   else throw new Error('Unbound HLS URI.')
  }
 }
 if(variant||duration!==undefined||result.variants.length>32||result.audio.length>32||result.segments.length>ARCHIVE_LIMITS.segments||result.duration>ARCHIVE_LIMITS.durationSeconds||result.variants.length&&result.segments.length)throw new Error('HLS playlist exceeds its finite archive contract.')
 if(!result.variants.length&&(!result.segments.length||!lines.includes('#EXT-X-ENDLIST')))throw new Error('HLS preservation requires a complete ENDLIST VOD playlist.')
 return result
}
interface OriginalResource {artifactId:string;url:string;sha256:string;bytes:number;role:'manifest'|'initialization'|'segment'|'file';durationSeconds?:number;track?:string}
export interface SeparatedVideoDelivery {audioUrl:string;videoDurationSeconds:number;audioDurationSeconds:number;videoIdentity:VideoIdentity}
export interface PreservationInput {directory:string;url:string;pageUrl:string;fetchImpl:((url:string,init?:RequestInit)=>Promise<Response>)&{waitForIdle?:()=>Promise<void>};signal?:AbortSignal;guard?:(force?:boolean)=>Promise<void>;videoIdentity?:VideoIdentity;separated?:SeparatedVideoDelivery;youtubeSabr?:YoutubeSabrWitness;refreshYoutubeSabr?:(signal:AbortSignal)=>Promise<YoutubeSabrWitness>}
/** Native recovery stays private to the controller; paths never become tool input. */
export class PreservationCleanupError extends Error {constructor(readonly recover:()=>Promise<void>,cause:unknown){super('MEDIA_PRESERVATION_CLEANUP_FAILED: Resources are quarantined; use media.record.stop for explicit cleanup recovery.',{cause})}}
/** Byte-preserving browser transport, pinned Project outputs and packet-copy remux. No model headers or paths. */
export async function preserveMedia(input:PreservationInput){
 const videoIdentity=input.videoIdentity?assertVideoIdentity(input.videoIdentity):undefined
 if(input.youtubeSabr&&(!videoIdentity||!sameVideoIdentity(videoIdentity,input.youtubeSabr.videoIdentity)||input.separated))throw new Error('Invalid identity-bound YouTube SABR delivery.')
 if(input.separated){const pair=input.separated;assertVideoIdentity(pair.videoIdentity);if(pair.videoIdentity.platform!=='youtube'||!videoIdentity||!sameVideoIdentity(pair.videoIdentity,videoIdentity)||pair.audioUrl===input.url||![pair.videoDurationSeconds,pair.audioDurationSeconds].every(s=>Number.isFinite(s)&&s>0&&s<=ARCHIVE_LIMITS.durationSeconds)||Math.abs(pair.videoDurationSeconds-pair.audioDurationSeconds)>.35)throw new Error('Invalid identity-bound YouTube separated delivery.');http(pair.audioUrl)}
 const root=await fs.realpath(input.directory);if((await fs.lstat(input.directory)).isSymbolicLink())throw new Error('Preservation directory must not be a symbolic link.');const identity=await fs.stat(root),prefix='preserved-'+crypto.randomUUID(),created:string[]=[],resources:OriginalResource[]=[]
 const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(ARCHIVE_LIMITS.transferTimeoutMs),...(input.signal?[input.signal]:[])]);let total=0,sequence=0,success=false,sabr:YoutubeSabrTransfer|undefined;const sabrWrites:Promise<unknown>[]=[]
 const guard=async(force=false)=>{signal.throwIfAborted();await input.guard?.(force);const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.dev!==identity.dev||stat.ino!==identity.ino)throw new Error('Preservation Project changed.')}
 const save=async(data:Uint8Array,suffix:string)=>{await guard();const artifactId=prefix+'-'+sequence+++'-'+suffix,file=path.join(root,artifactId),handle=await fs.open(file,'wx',0o600);created.push(file);try{await handle.writeFile(data);await handle.sync();await guard()}finally{await handle.close()}return {artifactId,path:file,sha256:sha(data),bytes:data.length}}
 const fetchBytes=async(url:string,maximum:number)=>{
  await guard();const response=await input.fetchImpl(http(url),{signal,credentials:'include',redirect:'follow',referrer:input.pageUrl,headers:{accept:'video/*,audio/*,application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.5'}})
  const chunks:Uint8Array[]=[];let length=0
  try{if(response.status!==200||!response.body)throw new Error('Preservation requires a full HTTP 200 media response, got '+response.status+'.');if(Number(response.headers.get('content-length')??0)>maximum)throw new Error('Preserved response exceeds its byte budget.')
   const reader=response.body.getReader();try{while(true){await guard();const item=await reader.read();if(item.done)break;length+=item.value.length;total+=item.value.length;if(length>maximum||total>ARCHIVE_LIMITS.bytes)throw new Error('Preservation exceeds its finite archive byte budget.');chunks.push(item.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
   if(!length)throw new Error('Empty preserved response.');const advertised=response.headers.get('content-length');if(advertised!==null&&!response.headers.get('content-encoding')&&Number(advertised)!==length)throw new Error('Incomplete preserved response.');return {data:Buffer.concat(chunks),url:http(response.url||url),mime:response.headers.get('content-type')??''}
  }finally{await response.body?.cancel().catch(()=>{})}
 }
 // Long files are streamed to exclusive Project files, never concatenated in RAM.
 const fetchFile=async(url:string,label:string)=>{
  await guard();const response=await input.fetchImpl(http(url),{signal,credentials:'include',redirect:'follow',referrer:input.pageUrl,headers:{accept:'video/*,audio/*,application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.5'}})
  let handle:Awaited<ReturnType<typeof fs.open>>|undefined
  try{
   if(response.status!==200||!response.body)throw new Error('Preservation requires a full HTTP 200 media response, got '+response.status+'.')
   await guard();const advertised=response.headers.get('content-length');if(advertised!==null&&(!Number.isSafeInteger(Number(advertised))||Number(advertised)<1||Number(advertised)>ARCHIVE_LIMITS.bytes-total))throw new Error('Preserved response exceeds its archive byte budget.')
   const mime=response.headers.get('content-type')??'',extension=/webm/i.test(mime)?'webm':/mp4/i.test(mime)?'mp4':/mpegurl/i.test(mime)?'m3u8':'bin',artifactId=prefix+'-'+sequence+++'-'+label+'.'+extension,file=path.join(root,artifactId)
   handle=await fs.open(file,'wx',0o600);created.push(file);const hash=crypto.createHash('sha256'),header=Buffer.alloc(7);let length=0,headerBytes=0
   const reader=response.body.getReader();try{while(true){await guard();const item=await reader.read();if(item.done)break;length+=item.value.length;total+=item.value.length;if(total>ARCHIVE_LIMITS.bytes)throw new Error('Preservation exceeds its archive byte budget.');if(headerBytes<7){const n=Math.min(7-headerBytes,item.value.length);header.set(item.value.subarray(0,n),headerBytes);headerBytes+=n}hash.update(item.value);await handle.writeFile(item.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
   if(!length)throw new Error('Empty preserved response.');if(advertised!==null&&!response.headers.get('content-encoding')&&Number(advertised)!==length)throw new Error('Incomplete preserved response.')
   await handle.sync();await guard();return {artifactId,path:file,bytes:length,sha256:hash.digest('hex'),header,url:http(response.url||url),mime}
  }finally{await handle?.close();await response.body?.cancel().catch(()=>{})}
 }
 const fetchPlaylist=async(url:string)=>{const r=await fetchBytes(url,1024*1024),saved=await save(r.data,'manifest.m3u8');resources.push({...saved,url:r.url,role:'manifest'});return parsePreservationPlaylist(r.data.toString('utf8'),r.url)}
 const sources:string[]=[],playlistDurations:{track:string;durationSeconds:number}[]=[]
 const verifyOriginals=async()=>{for(const resource of resources){await guard();const io=await ArtifactJobIO.openArchive(root,resource.artifactId);try{if(await io.fingerprint(signal)!==resource.sha256)throw new Error('Original delivery resource changed during preservation.')}finally{await io.close()}}}
 try{
  if(input.youtubeSabr){
   const disk=await fs.statfs(root),sourceBudget=Math.max(0,Math.min(ARCHIVE_LIMITS.bytes,Math.floor((disk.bavail*disk.bsize-512*1024*1024)/2.2)))
   sabr=openYoutubeSabrTransfer(bindYoutubeSabrDelivery(input.youtubeSabr),input.fetchImpl,signal,guard,sourceBudget,input.refreshYoutubeSabr)
   const capture=async(track:'video'|'audio',stream:ReadableStream<ArrayBufferView<ArrayBufferLike>>)=>{
    const artifactId=prefix+'-original-'+track+'.mp4',file=path.join(root,artifactId),handle=await fs.open(file,'wx',0o600);created.push(file)
    const hash=crypto.createHash('sha256');let bytes=0
    try{for await(const chunk of stream){await guard();const data=new Uint8Array(chunk.buffer,chunk.byteOffset,chunk.byteLength);total+=data.byteLength;bytes+=data.byteLength;if(total>sourceBudget)throw new Error('YouTube encoded tracks exceed the archive/free-space byte budget.');hash.update(data);await handle.writeFile(data)}if(!bytes)throw new Error('Empty YouTube encoded track.');await handle.sync();await guard();const saved={artifactId,path:file,bytes,sha256:hash.digest('hex')};resources.push({...saved,url:input.url,role:'file',track});return saved}finally{await handle.close()}
   }
   const jobs=[capture('video',sabr.video),capture('audio',sabr.audio)]
   sabrWrites.push(...jobs)
   let files:Awaited<ReturnType<typeof capture>>[]
   try{files=await Promise.all(jobs)}catch(error){controller.abort(error);await sabr.close();await Promise.allSettled(jobs);throw error}
   const transport=await sabr.proof();await sabr.close()
   const remux=await remuxPreserved(root,files.map(f=>f.artifactId),prefix+'-delivery.mp4',guard,created,true)
   for(const track of remux.tracks){const expected=Number(sabr.formats[track.type].approxDurationMs)/1000;if(Math.abs(track.startSeconds)>.35||Math.abs(track.endSeconds-expected)>.35)throw new Error('YouTube SABR track does not cover its complete advertised range.')}
   if(Math.abs(remux.tracks[0]!.endSeconds-remux.tracks[1]!.endSeconds)>.35)throw new Error('YouTube SABR audio/video coverage differs.')
   await verifyOriginals();const proof={version:1,basis:'YouTube-SABR-encoded-tracks',uploadedOriginal:'unknown',pageUrl:input.pageUrl,videoIdentity,resources,transport,remux:{...remux,kind:'packet-copy',reencoded:false},capturedAt:new Date().toISOString()},evidence=await save(Buffer.from(JSON.stringify(proof,null,2)+'\n'),'preservation.json');await guard(true);success=true
   return {...remux,ownedArtifactIds:created.map(file=>path.basename(file)),type:'video',contentType:'video/mp4',videoIdentity,preservation:{basis:proof.basis,uploadedOriginal:'unknown',reencoded:false,completeVod:true,completeSeparatedTracks:true,selectedFormats:transport.selection,resources,proofArtifactId:evidence.artifactId,proofSha256:evidence.sha256},timebase:'delivery-file-PTS; SABR encoded tracks with validated UMP target and format identity'}
  }
  const first=await fetchFile(input.url,'original'),isHls=first.header.toString()==='#EXTM3U'
  if(input.separated){
   if(isHls||!/^video\//i.test(first.mime))throw new Error('Separated video delivery requires a complete video file.')
   const video=first;resources.push({artifactId:video.artifactId,url:first.url,sha256:video.sha256,bytes:video.bytes,role:'file',track:'video'})
   const audio=await fetchFile(input.separated.audioUrl,'original-audio')
   if(!/^audio\//i.test(audio.mime))throw new Error('Separated audio delivery requires a complete audio file.')
   const audioFile=audio;resources.push({artifactId:audio.artifactId,url:audio.url,sha256:audio.sha256,bytes:audio.bytes,role:'file',track:'audio'})
   const remux=await remuxPreserved(root,[video.artifactId,audioFile.artifactId],prefix+'-delivery.mp4',guard,created,true)
   for(const track of remux.tracks){const expected=track.type==='video'?input.separated.videoDurationSeconds:input.separated.audioDurationSeconds;if(Math.abs(track.startSeconds)>.35||Math.abs(track.endSeconds-expected)>.35)throw new Error('Separated track does not match its complete advertised range.')}
   const videoTrack=remux.tracks.find(t=>t.type==='video')!,audioTrack=remux.tracks.find(t=>t.type==='audio')!
   if(Math.abs(videoTrack.startSeconds-audioTrack.startSeconds)>.35||Math.abs(videoTrack.endSeconds-audioTrack.endSeconds)>.35)throw new Error('Separated audio/video coverage differs; no incomplete delivery published.')
   await verifyOriginals();const proof={version:1,basis:'HTTP-delivery-bytes',kind:'separated-tracks',uploadedOriginal:'unknown',pageUrl:input.pageUrl,videoIdentity,resources,remux:{...remux,kind:'packet-copy',reencoded:false},capturedAt:new Date().toISOString()},evidence=await save(Buffer.from(JSON.stringify(proof,null,2)+'\n'),'preservation.json');await guard(true);success=true
   return {...remux,ownedArtifactIds:created.map(file=>path.basename(file)),type:'video',contentType:'video/mp4',videoIdentity,preservation:{basis:proof.basis,uploadedOriginal:'unknown',reencoded:false,completeVod:false,completeSeparatedTracks:true,resources,proofArtifactId:evidence.artifactId,proofSha256:evidence.sha256},timebase:'delivery-file-PTS; separate encoded tracks, no inferred player source clock'}
  }
  if(isHls){
   if(first.bytes>1024*1024)throw new Error('HLS manifest exceeds 1 MiB.');resources.push({artifactId:first.artifactId,url:first.url,sha256:first.sha256,bytes:first.bytes,role:'manifest'});let playlist=parsePreservationPlaylist(await fs.readFile(first.path,'utf8'),first.url),audio:HlsPlaylist|undefined,selectedVariant:{url:string;bandwidth:number;audioGroup?:string}|undefined
   if(playlist.variants.length){selectedVariant=[...playlist.variants].sort((a,b)=>b.bandwidth-a.bandwidth)[0]!;const audios=playlist.audio.filter(a=>a.group===selectedVariant!.audioGroup);if(selectedVariant.audioGroup&&!audios.length)throw new Error('Selected HLS audio group is unavailable.');if(audios.length>1)throw new Error('Multiple alternate HLS audio tracks require explicit selection; no track silently discarded.');if(audios[0])audio=await fetchPlaylist(audios[0].url);playlist=await fetchPlaylist(selectedVariant.url);if(playlist.variants.length||audio?.variants.length)throw new Error('Nested HLS masters are unsupported.')}
   for(const [track,p]of [['video',playlist],...(audio?[['audio',audio] as const]:[])] as const){
    const artifactId=prefix+'-'+track+(p.initialization?'.mp4':'.ts'),file=path.join(root,artifactId),handle=await fs.open(file,'wx',0o600);created.push(file)
    try{
     for(const item of [...(p.initialization?[{url:p.initialization,duration:undefined}]:[]),...p.segments]){const r=await fetchBytes(item.url,32*1024*1024),saved=await save(r.data,item.duration===undefined?'init.bin':'segment.bin');resources.push({...saved,url:r.url,role:item.duration===undefined?'initialization':'segment',track,...(item.duration===undefined?{}:{durationSeconds:item.duration})});await guard();await handle.writeFile(r.data)}
     await handle.sync();await guard();sources.push(artifactId);playlistDurations.push({track,durationSeconds:p.duration})
    }finally{await handle.close()}
   }
   const remux=await remuxPreserved(root,sources,prefix+'-delivery.mp4',guard,created)
   for(const expected of playlistDurations){const tracks=remux.tracks.filter(t=>playlistDurations.length===1||t.type===expected.track);if(!tracks.length||tracks.some(t=>Math.abs(t.endSeconds-t.startSeconds-expected.durationSeconds)>.35))throw new Error('Delivered track range does not match the complete HLS VOD manifest.')}
   await verifyOriginals()
   const proof={version:1,basis:'HTTP-delivery-bytes',uploadedOriginal:'unknown',pageUrl:input.pageUrl,videoIdentity,requestedUrl:input.url,selectedVariant,resources,assembledTrackArtifactIds:sources,playlistDurations,remux:{...remux,kind:'packet-copy',reencoded:false},capturedAt:new Date().toISOString()}
   const proofData=Buffer.from(JSON.stringify(proof,null,2)+'\n');if(proofData.length>1024*1024)throw new Error('Preservation evidence exceeds 1 MiB.');const evidence=await save(proofData,'preservation.json');await guard(true);success=true
   return {...remux,ownedArtifactIds:created.map(file=>path.basename(file)),type:'video',contentType:'video/mp4',videoIdentity,preservation:{basis:proof.basis,uploadedOriginal:'unknown',reencoded:false,completeVod:true,resources,assembledTrackArtifactIds:sources,selectedVariant,playlistDurations,proofArtifactId:evidence.artifactId,proofSha256:evidence.sha256},timebase:'delivery-file-PTS; not inferred player source time'}
  }
  if(!/^(video|audio)\//.test(first.mime))throw new Error('Direct preservation requires a video/audio response or complete HLS VOD.')
  const saved={artifactId:first.artifactId,path:first.path,bytes:first.bytes,sha256:first.sha256};resources.push({...saved,url:first.url,role:'file'})
  await verifyOriginals()
  const proof={version:1,basis:'HTTP-delivery-bytes',uploadedOriginal:'unknown',pageUrl:input.pageUrl,videoIdentity,resources,capturedAt:new Date().toISOString()},evidence=await save(Buffer.from(JSON.stringify(proof,null,2)+'\n'),'preservation.json');await guard(true);success=true
  return {...saved,ownedArtifactIds:created.map(file=>path.basename(file)),type:first.mime.startsWith('audio/')?'audio':'video',contentType:first.mime,videoIdentity,preservation:{basis:proof.basis,uploadedOriginal:'unknown',reencoded:false,completeVod:false,completeHttpResponse:true,resources,proofArtifactId:evidence.artifactId,proofSha256:evidence.sha256},timebase:'delivery-file-PTS; full media range requires decode verification'}
 }finally{
  controller.abort()
  const cleanup=async()=>{await sabr?.close();await Promise.allSettled(sabrWrites);await input.fetchImpl.waitForIdle?.();if(!success&&created.length){const stat=await fs.lstat(root);if(stat.dev!==identity.dev||stat.ino!==identity.ino||stat.isSymbolicLink())throw new Error('Preservation cleanup directory changed.');for(const file of created)await fs.rm(file,{force:true})}}
  try{await cleanup()}catch(error){success=false;throw new PreservationCleanupError(cleanup,error)}
 }
}
async function remuxPreserved(directory:string,ids:string[],artifactId:string,guard:()=>Promise<void>,created:string[],separated=false){
 const inputs:{input:Input;io:ArtifactJobIO}[]=[],file=path.join(directory,artifactId),output=await fs.open(file,'wx+',0o600);created.push(file);let bytes=0
 const mux=new Output({format:new Mp4OutputFormat({fastStart:'fragmented'}),target:new AppendOnlyStreamTarget(new WritableStream<Uint8Array>({async write(data){await guard();if(bytes+data.length>ARCHIVE_LIMITS.bytes)throw new Error('Preserved remux exceeds archive output budget.');let offset=0;while(offset<data.length){const r=await output.write(data,offset,data.length-offset,bytes+offset);if(!r.bytesWritten)throw new Error('Preservation write made no progress.');offset+=r.bytesWritten}bytes+=data.length}}))})
 try{
  const producers:(()=>Promise<void>)[]=[],tracks:{type:'video'|'audio';codec:string;packets:number;startSeconds:number;endSeconds:number;packetSha256:string}[]=[]
  for(const id of ids){const io=await ArtifactJobIO.openArchive(directory,id),input=new Input({formats:[MP4,WEBM,MPEG_TS],source:new CustomSource({getSize:()=>io.bytes,maxCacheSize:8*1024*1024,read:(start,end)=>new ReadableStream<Uint8Array>({async start(controller){try{for(let at=start;at<end;at+=MEDIA_LIMITS.chunkBytes){await guard();controller.enqueue(await io.read(at,Math.min(end-at,MEDIA_LIMITS.chunkBytes)))}controller.close()}catch(error){controller.error(error)}}})})});inputs.push({input,io})
   const inputTracks=await input.getTracks()
   if(separated&&(inputTracks.length!==1||!(id===ids[0]?inputTracks[0]!.isVideoTrack():inputTracks[0]!.isAudioTrack())))throw new Error('Separated input must contain exactly its declared video or audio track.')
   for(const track of inputTracks){
    const codec=await track.getCodec();if(!track.isVideoTrack()&&!track.isAudioTrack()||!codec)throw new Error('Unsupported original delivery track; no tracks discarded.')
    const decoder=await track.getDecoderConfig();if(!decoder)throw new Error('Missing delivered decoder configuration.')
    let add:(packet:import('mediabunny').EncodedPacket)=>Promise<void>,close:()=>void
    if(track.isVideoTrack()){
     const videoCodec=await track.getCodec(),config=await track.getDecoderConfig();if(!videoCodec||!config)throw new Error('Missing delivered video config.')
     const source=new EncodedVideoPacketSource(videoCodec);mux.addVideoTrack(source,{rotation:await track.getRotation()});add=p=>source.add(p,{decoderConfig:config});close=()=>source.close()
    }else if(track.isAudioTrack()){
     const audioCodec=await track.getCodec(),config=await track.getDecoderConfig();if(!audioCodec||!config)throw new Error('Missing delivered audio config.')
     const source=new EncodedAudioPacketSource(audioCodec);mux.addAudioTrack(source);add=p=>source.add(p,{decoderConfig:config});close=()=>source.close()
    }else throw new Error('Unsupported delivered track.')
    const row={type:track.type as 'video'|'audio',codec,packets:0,startSeconds:Infinity,endSeconds:-Infinity,packetSha256:''};tracks.push(row)
    producers.push(async()=>{const hash=crypto.createHash('sha256');for await(const packet of new EncodedPacketSink(track).packets()){await guard();if(++row.packets>ARCHIVE_LIMITS.packetsPerTrack||packet.timestamp+packet.duration>ARCHIVE_LIMITS.durationSeconds)throw new Error('Preservation packet/duration archive budget exceeded.');hash.update(packet.data);row.startSeconds=Math.min(row.startSeconds,packet.timestamp);row.endSeconds=Math.max(row.endSeconds,packet.timestamp+packet.duration);await add(packet)}row.packetSha256=hash.digest('hex');if(!row.packets)throw new Error('Empty delivery track.');close()})
   }
  }
  if(tracks.filter(t=>t.type==='video').length!==1||tracks.filter(t=>t.type==='audio').length>1)throw new Error('Preservation requires one video and at most one audio track.')
  await mux.start();const jobs=producers.map(p=>p());try{await Promise.all(jobs)}catch(error){await mux.cancel().catch(()=>{});await Promise.allSettled(jobs);throw error}await mux.finalize();await output.sync();await guard()
  // Independently demux the finalized file and compare encoded payloads and ranges.
  const io=await ArtifactJobIO.openArchive(directory,artifactId),input=new Input({formats:[MP4],source:new CustomSource({getSize:()=>io.bytes,maxCacheSize:8*1024*1024,read:(start,end)=>new ReadableStream<Uint8Array>({async start(c){try{for(let at=start;at<end;at+=MEDIA_LIMITS.chunkBytes){await guard();c.enqueue(await io.read(at,Math.min(end-at,MEDIA_LIMITS.chunkBytes)))}c.close()}catch(e){c.error(e)}}})})});inputs.push({io,input})
  const actual=await input.getTracks();if(actual.length!==tracks.length)throw new Error('Remux discarded delivery tracks.')
  for(const [index,track]of actual.entries()){const row=tracks[index]!,hash=crypto.createHash('sha256');let count=0,start=Infinity,end=-Infinity;for await(const p of new EncodedPacketSink(track).packets()){await guard();hash.update(p.data);count++;start=Math.min(start,p.timestamp);end=Math.max(end,p.timestamp+p.duration)}if(count!==row.packets||hash.digest('hex')!==row.packetSha256||Math.abs(start-row.startSeconds)>.001||Math.abs(end-row.endSeconds)>.03)throw new Error('Remux changed encoded media payload or PTS.')}
  return {artifactId,path:file,bytes,sha256:await io.fingerprint(),tracks}
 }catch(error){await mux.cancel().catch(()=>{});throw error}finally{for(const x of inputs){x.input.dispose();await x.io.close()}await output.close()}
}
