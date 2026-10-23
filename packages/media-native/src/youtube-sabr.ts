import crypto from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {Worker} from 'node:worker_threads'
import {UmpReader} from 'googlevideo/ump'
import {VideoPlaybackAbrRequest,MediaHeader,FormatInitializationMetadata,NextRequestPolicy,UMPPartId} from 'googlevideo/protos'
import type {MediaHeader as Header,FormatId} from 'googlevideo/protos'
import {concatenateChunks} from 'googlevideo/utils'
import {assertVideoIdentity,youtubeSabrUrl,YOUTUBE_SABR_REQUEST_BYTES} from '@bmw-agent/agent-contract/video-identity'
import type {VideoIdentity} from '@bmw-agent/agent-contract/video-identity'
import {ARCHIVE_LIMITS} from './archive-limits.js'
import {sabrBytePipe} from './youtube-sabr-pipe.js'

export {youtubeSabrUrl,YOUTUBE_SABR_REQUEST_BYTES} from '@bmw-agent/agent-contract/video-identity'
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
export interface YoutubeSabrFormat {itag:number;lastModified:string;xtags:string;mimeType:string;bitrate:number;approxDurationMs:string;contentLength?:number;audioTrackId?:string;defaultAudio:boolean;width?:number;height?:number;fps?:number;audioQuality?:string;isDrc:boolean}
/** Host-only, short-lived browser witness. Never persist requestBody/config or return them through browser. */
export interface YoutubeSabrWitness {videoIdentity:VideoIdentity;streamUrl:string;requestBody:Uint8Array;ustreamerConfig:unknown;durationSeconds:number;formats:unknown}
export interface YoutubeSabrDelivery {videoIdentity:VideoIdentity;streamUrl:string;requestBody:Uint8Array;ustreamerConfig:string;durationSeconds:number;formats:YoutubeSabrFormat[]}
const formatKey=(f:{itag?:number;lastModified?:string;xtags?:string})=>[f.itag,f.lastModified,f.xtags??''].join(':')
/** Validate both the renderer metadata and the native browser's actual binary POST. */
export function bindYoutubeSabrDelivery(input:YoutubeSabrWitness):YoutubeSabrDelivery {
 const identity=assertVideoIdentity(input.videoIdentity);youtubeSabrUrl(input.streamUrl)
 if(identity.platform!=='youtube'||!/^[A-Za-z0-9_-]{11}$/.test(identity.targetId)||identity.targetId!==identity.resourceId||!Number.isFinite(input.durationSeconds)||input.durationSeconds<=0||input.durationSeconds>ARCHIVE_LIMITS.durationSeconds)throw new Error('YOUTUBE_SABR_IDENTITY: Invalid finite target.')
 if(!(input.requestBody instanceof Uint8Array)||!input.requestBody.length||input.requestBody.length>YOUTUBE_SABR_REQUEST_BYTES||typeof input.ustreamerConfig!=='string'||input.ustreamerConfig.length>128*1024||!Array.isArray(input.formats)||input.formats.length>160)throw new Error('YOUTUBE_SABR_WITNESS: Missing or oversized current player metadata.')
 const decoded=VideoPlaybackAbrRequest.decode(input.requestBody)
 if(!decoded.streamerContext?.clientInfo?.clientName||!decoded.streamerContext.clientInfo.clientVersion||!decoded.videoPlaybackUstreamerConfig?.length||!Buffer.from(input.ustreamerConfig,'base64url').equals(Buffer.from(decoded.videoPlaybackUstreamerConfig)))throw new Error('YOUTUBE_SABR_WITNESS: Browser POST and current player configuration differ.')
 const formats:YoutubeSabrFormat[]=[]
 for(const raw of input.formats){const f=record(raw),audio=record(f.audioTrack),mime=typeof f.mimeType==='string'?f.mimeType:''
  if(!/^(?:audio|video)\/(?:mp4|webm);\s*codecs="[A-Za-z0-9., -]+"$/.test(mime)||!Number.isSafeInteger(f.itag)||Number(f.itag)<1||typeof f.lastModified!=='string'||!/^\d{1,20}$/.test(f.lastModified)||typeof f.bitrate!=='number'||!Number.isFinite(f.bitrate)||f.bitrate<=0)continue
  const duration=Number(f.approxDurationMs)
  if(!Number.isFinite(duration)||duration<=0||Math.abs(duration/1000-input.durationSeconds)>Math.max(.5,input.durationSeconds*.01))continue
  const xtags=typeof f.xtags==='string'?f.xtags:'';if(xtags.length>1024||audio.id!==undefined&&(typeof audio.id!=='string'||audio.id.length>100))continue
  const row:YoutubeSabrFormat={itag:Number(f.itag),lastModified:f.lastModified,xtags,mimeType:mime,bitrate:f.bitrate,approxDurationMs:String(duration),defaultAudio:audio.audioIsDefault===true,isDrc:f.isDrc===true}
  if(typeof f.contentLength==='string'&&/^\d{1,12}$/.test(f.contentLength)&&Number.isSafeInteger(Number(f.contentLength)))row.contentLength=Number(f.contentLength)
  if(typeof audio.id==='string')row.audioTrackId=audio.id
  for(const key of ['width','height','fps'] as const)if(typeof f[key]==='number'&&Number.isFinite(f[key])&&f[key]>0&&f[key]<=16384)row[key]=f[key]
  if(typeof f.audioQuality==='string'&&f.audioQuality.length<100)row.audioQuality=f.audioQuality
  formats.push(row)
 }
 // Bootstrap POSTs legitimately omit preferred tracks. Every supplied format must
 // belong to this response; the native request and every UMP envelope still use
 // exact current-response format versions and the original video identity.
 const allowed=new Set(formats.map(formatKey)),ids=[...decoded.selectedVideoFormatIds,...decoded.selectedAudioFormatIds,...decoded.initializationFormatIds,...decoded.bufferedRanges.flatMap(range=>range.formatId?[range.formatId]:[])]
 if(!formats.length||ids.some(f=>!allowed.has(formatKey(f))))throw new Error('YOUTUBE_SABR_WITNESS: The observed request selects formats outside this player response.')
 return {videoIdentity:identity,streamUrl:input.streamUrl,requestBody:new Uint8Array(input.requestBody),ustreamerConfig:input.ustreamerConfig,durationSeconds:input.durationSeconds,formats}
}
const estimatedBytes=(format:YoutubeSabrFormat)=>format.contentLength??Math.ceil(format.bitrate*Number(format.approxDurationMs)/8000)
export function selectYoutubeSabrFormats(delivery:YoutubeSabrDelivery,maxBytes:number=ARCHIVE_LIMITS.bytes):{video:YoutubeSabrFormat;audio:YoutubeSabrFormat;estimatedBytes:number;maxBytes:number} {
 const videos=delivery.formats.filter(f=>/^video\/mp4;.*avc1/.test(f.mimeType)&&(f.height??Infinity)<=1080).sort((a,b)=>(b.height??0)-(a.height??0)||b.bitrate-a.bitrate)
 const audios=delivery.formats.filter(f=>/^audio\/mp4;.*mp4a/.test(f.mimeType)&&!f.isDrc),defaults=audios.filter(f=>f.defaultAudio),eligible=defaults.length?defaults:audios
 if(!videos.length||!eligible.length||new Set(eligible.map(f=>f.audioTrackId??'default')).size!==1)throw new Error('YOUTUBE_SABR_FORMATS: A compatible AVC track and unique default AAC language are required.')
 let minimum=Infinity
 for(const video of videos)for(const audio of [...eligible].sort((a,b)=>b.bitrate-a.bitrate)){const bytes=estimatedBytes(video)+estimatedBytes(audio);minimum=Math.min(minimum,bytes);if(bytes<=maxBytes)return {video,audio,estimatedBytes:bytes,maxBytes}}
 throw new Error('YOUTUBE_SABR_SPACE: No complete AVC/AAC pair fits the '+Math.floor(maxBytes)+'-byte source budget including reserved remux space; smallest estimated pair is '+Math.ceil(minimum)+' bytes.')
}

interface Segment {header:Header;bytes:number;hash:ReturnType<typeof crypto.createHash>}
export interface YoutubeSabrProof {transport:'YouTube-SABR/UMP';formats:{type:'video'|'audio';itag:number;lastModified:string;segments:number;initializations:number;startMs:number;endMs:number;expectedEndMs:number}[];responses:{bytes:number;sha256:string}[];serverBackoffMs:number;selection?:{policy:string;estimatedBytes:number;sourceByteBudget:number;video:{itag:number;width?:number;height?:number;bitrate:number};audio:{itag:number;bitrate:number;languageGroup:string}}}
/** Strict media-envelope validation in front of the library's protocol state machine. */
export class YoutubeUmpValidator {
 private readonly headers=new Map<number,Segment>()
 private readonly completed=new Map<string,string>()
 private readonly ranges=new Map<number,{start:number;end:number;sequence:number}[]>()
 private readonly expected=new Map<number,number>()
 readonly proof:YoutubeSabrProof
 readonly reader:UmpReader
 constructor(identity:VideoIdentity,selected:{video:YoutubeSabrFormat;audio:YoutubeSabrFormat}){
  this.proof={transport:'YouTube-SABR/UMP',formats:([['video',selected.video],['audio',selected.audio]] as const).map(([type,f])=>({type,itag:f.itag,lastModified:f.lastModified,segments:0,initializations:0,startMs:Infinity,endMs:0,expectedEndMs:Number(f.approxDurationMs)})),responses:[],serverBackoffMs:0}
  for(const f of [selected.video,selected.audio])this.expected.set(f.itag,Number(f.approxDurationMs))
  const format=(id:FormatId|undefined)=>{if(!id||![selected.video,selected.audio].some(f=>formatKey(f)===formatKey(id)))throw new Error('YOUTUBE_SABR_FOREIGN_TRACK: Response format differs from the requested target tracks.')}
  this.reader=new UmpReader({onPartialPart(_type,_data,_offset,total){if(total>16*1024*1024)throw new Error('YOUTUBE_SABR_BUDGET: Oversized UMP part.');return false},onPart:async(type,data)=>{
   if(type===UMPPartId.NEXT_REQUEST_POLICY){const policy=NextRequestPolicy.decode(concatenateChunks(data.chunks));this.proof.serverBackoffMs+=Math.max(0,Number(policy.backoffTimeMs)||0)}
   else if(type===UMPPartId.FORMAT_INITIALIZATION_METADATA){const f=FormatInitializationMetadata.decode(concatenateChunks(data.chunks));if(f.videoId!==identity.targetId)throw new Error('YOUTUBE_SABR_FOREIGN_VIDEO: Wrong video initialization.');format(f.formatId)}
   else if(type===UMPPartId.MEDIA_HEADER){
    const h=MediaHeader.decode(concatenateChunks(data.chunks));h.headerId??=0;h.segmentNum??=0;h.formatId={itag:h.formatId?.itag??h.itag,lastModified:h.formatId?.lastModified??h.lmt,xtags:h.formatId?.xtags??h.xtags};if(h.videoId!==identity.targetId)throw new Error('YOUTUBE_SABR_FOREIGN_VIDEO: Wrong video media header.');format(h.formatId)
    if(h.itag!==undefined&&h.itag!==h.formatId.itag||h.lmt!==undefined&&h.lmt!==h.formatId.lastModified||h.xtags!==undefined&&h.xtags!==(h.formatId.xtags??''))throw new Error('YOUTUBE_SABR_VERSION_CHANGED: Conflicting media header identity.')
    if(!Number.isSafeInteger(h.headerId)||h.headerId!<0||h.headerId!>127||this.headers.has(h.headerId!)||!Number.isSafeInteger(Number(h.segmentLengthBytes))||Number(h.segmentLengthBytes)<1||Number(h.segmentLengthBytes)>64*1024*1024||h.compressionType)throw new Error('YOUTUBE_SABR_HEADER: Unsupported or overlapping media segment.')
    this.headers.set(h.headerId!,{header:h,bytes:0,hash:crypto.createHash('sha256')})
   }else if(type===UMPPartId.MEDIA){const bytes=concatenateChunks(data.chunks),h=this.headers.get(bytes[0]!);if(!h||bytes.length<2)throw new Error('YOUTUBE_SABR_HEADER: Unbound media bytes.');h.bytes+=bytes.length-1;if(h.bytes>Number(h.header.segmentLengthBytes))throw new Error('YOUTUBE_SABR_PARTIAL: Media segment exceeded its declared length.');h.hash.update(bytes.subarray(1))}
   else if(type===UMPPartId.MEDIA_END){const bytes=concatenateChunks(data.chunks),segment=this.headers.get(bytes[0]!);if(bytes.length!==1||!segment||segment.bytes!==Number(segment.header.segmentLengthBytes))throw new Error('YOUTUBE_SABR_PARTIAL: Missing or incomplete segment.');this.headers.delete(bytes[0]!);const h=segment.header,key=formatKey(h.formatId)+':'+(h.isInitializationSegment?'init':h.segmentNum),digest=segment.hash.digest('hex'),old=this.completed.get(key);if(old&&old!==digest)throw new Error('YOUTUBE_SABR_VERSION_CHANGED: A repeated segment changed.');if(old)return;this.completed.set(key,digest);if(this.completed.size>ARCHIVE_LIMITS.segments)throw new Error('YOUTUBE_SABR_BUDGET: Segment budget exceeded.');const row=this.proof.formats.find(f=>f.itag===h.formatId!.itag)!;if(h.isInitializationSegment)row.initializations++;else {const scale=Number(h.timeRange?.timescale),start=h.startMs!==undefined?Number(h.startMs):h.timeRange?.startTicks!==undefined?Number(h.timeRange.startTicks)/scale*1000:0,duration=h.durationMs!==undefined?Number(h.durationMs):Number(h.timeRange?.durationTicks)/scale*1000;if(!Number.isFinite(start)||!Number.isFinite(duration)||start<0||duration<=0||!Number.isSafeInteger(h.segmentNum))throw new Error('YOUTUBE_SABR_RANGE: Invalid encoded segment range.');row.segments++;row.startMs=Math.min(row.startMs,start);row.endMs=Math.max(row.endMs,start+duration);const ranges=this.ranges.get(row.itag)??[];ranges.push({start,end:start+duration,sequence:h.segmentNum!});this.ranges.set(row.itag,ranges)}}
  }})
 }
 finish(duration:number){if(this.headers.size||this.proof.formats.some(f=>!f.initializations||!f.segments||f.startMs>100||Math.abs(f.endMs-this.expected.get(f.itag)!)>350||Math.abs(f.endMs-duration*1000)>Math.max(1000,duration*10)))throw new Error('YOUTUBE_SABR_PARTIAL: Both complete tracks must cover the declared video.');for(const row of this.proof.formats){const ranges=[...this.ranges.get(row.itag)!].sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)if(Math.abs(ranges[i]!.start-ranges[i-1]!.end)>100||ranges[i]!.sequence!==ranges[i-1]!.sequence+1)throw new Error('YOUTUBE_SABR_GAP: Missing, overlapping or out-of-order middle segment.')}return this.proof}
 dispose(){this.headers.clear();this.completed.clear();this.ranges.clear();this.reader.dispose()}
}
export interface YoutubeSabrTransfer {video:ReadableStream<ArrayBufferView<ArrayBufferLike>>;audio:ReadableStream<ArrayBufferView<ArrayBufferLike>>;formats:{video:YoutubeSabrFormat;audio:YoutubeSabrFormat};proof:()=>Promise<YoutubeSabrProof>;close:()=>Promise<void>}
export function openYoutubeSabrTransfer(delivery:YoutubeSabrDelivery,fetchImpl:(url:string,init?:RequestInit)=>Promise<Response>,signal:AbortSignal,guard:()=>Promise<void>,maxBytes:number=ARCHIVE_LIMITS.bytes,refreshWitness?:(signal:AbortSignal)=>Promise<YoutubeSabrWitness>):YoutubeSabrTransfer {
 const selected=selectYoutubeSabrFormats(delivery,maxBytes),validator=new YoutubeUmpValidator(delivery.videoIdentity,selected),controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]),jobs=new Set<Promise<void>>(),requests=new Map<number,AbortController>(),acks=new Map<number,()=>void>()
 validator.proof.selection={policy:'Highest compatible AVC up to 1080p and default-language AAC within archive/free-space budget; complete range, never capture fallback.',estimatedBytes:selected.estimatedBytes,sourceByteBudget:selected.maxBytes,video:{itag:selected.video.itag,width:selected.video.width,height:selected.video.height,bitrate:selected.video.bitrate},audio:{itag:selected.audio.itag,bitrate:selected.audio.bitrate,languageGroup:selected.audio.audioTrackId??'default'}}
 const worker=new Worker(new URL('./youtube-sabr-worker.js',import.meta.url),{workerData:{delivery,video:selected.video,audio:selected.audio,refreshAttestation:!!refreshWitness},resourceLimits:{maxOldGenerationSizeMb:96}})
 let failure:unknown,closing:Promise<void>|undefined,bytes=0,requestCount=0,finished=false,refreshes=0,lastToken=VideoPlaybackAbrRequest.decode(delivery.requestBody).streamerContext?.poToken,resolveFinished!:()=>void,rejectFinished!:(error:unknown)=>void
 const completion=new Promise<void>((resolve,reject)=>{resolveFinished=resolve;rejectFinished=reject});void completion.catch(()=>{})
 const outputs={video:sabrBytePipe(()=>worker.postMessage({type:'output-ack',track:'video'}),()=>close()),audio:sabrBytePipe(()=>worker.postMessage({type:'output-ack',track:'audio'}),()=>close())}
 const fail=(error:unknown)=>{failure??=error;controller.abort(error);outputs.video.fail(error);outputs.audio.fail(error);rejectFinished(error);for(const resolve of acks.values())resolve();acks.clear()}
 async function close(){if(closing)return closing;closing=(async()=>{controller.abort();outputs.video.fail(new Error('YouTube protocol transfer closed.'));outputs.audio.fail(new Error('YouTube protocol transfer closed.'));for(const resolve of acks.values())resolve();acks.clear();for(const request of requests.values())request.abort();await worker.terminate();await Promise.all([...jobs]);combined.removeEventListener('abort',abort);validator.dispose()})().catch(error=>{closing=undefined;throw error});return closing}
 const abort=()=>fail(combined.reason??new Error('YouTube transfer cancelled.'));combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort()
 worker.on('error',fail);worker.on('exit',code=>{if(!closing&&!finished)fail(new Error('YOUTUBE_SABR_WORKER: Protocol worker exited before completion ('+code+').'))})
 const post=(value:unknown)=>{if(!closing)worker.postMessage(value)}
 const fetchRequest=async(event:Record<string,unknown>)=>{
  const id=Number(event.id),request=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
  try{
   combined.throwIfAborted();await guard();const target=youtubeSabrUrl(String(event.url));if(!Number.isSafeInteger(id)||id<1||requests.has(id)||++requestCount>2000||!(event.body instanceof Uint8Array)||!event.body.length||event.body.byteLength>YOUTUBE_SABR_REQUEST_BYTES||target.searchParams.get('id')!==youtubeSabrUrl(delivery.streamUrl).searchParams.get('id'))throw new Error('YOUTUBE_SABR_REQUEST: Unbound or oversized protocol request.')
   requests.set(id,request)
   const response=await fetchImpl(target.href,{method:'POST',body:event.body as BodyInit,headers:{'content-type':'application/x-protobuf',accept:'application/vnd.yt-ump','accept-encoding':'identity'},credentials:'include',redirect:'error',signal:AbortSignal.any([combined,request.signal])})
   if(response.status!==200||!response.body||response.headers.get('content-type')?.split(';')[0]!=='application/vnd.yt-ump'){await response.body?.cancel();throw new Error('YOUTUBE_SABR_HTTP: Expected HTTP 200 UMP response; got '+response.status+'.')}
   post({type:'response',id,status:200,headers:[...response.headers]});reader=response.body.getReader();const hash=crypto.createHash('sha256');let length=0
   while(true){combined.throwIfAborted();request.signal.throwIfAborted();await guard();const item=await reader.read();if(item.done)break;length+=item.value.length;bytes+=item.value.length;if(bytes>ARCHIVE_LIMITS.bytes)throw new Error('YOUTUBE_SABR_BUDGET: Archive byte budget exceeded.');hash.update(item.value);await validator.reader.feed(item.value);const data=new Uint8Array(item.value);await new Promise<void>(resolve=>{acks.set(id,resolve);post({type:'response-data',id,data})})}
   validator.proof.responses.push({bytes:length,sha256:hash.digest('hex')});post({type:'response-end',id})
  }catch(error){post({type:'response-error',id,error:error instanceof Error?error.message.slice(0,700):'YouTube native transport failed.'});if(!request.signal.aborted&&!combined.aborted)fail(error)}
  finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();requests.delete(id);acks.delete(id)}
 }
 const refreshRequest=async(event:Record<string,unknown>)=>{
  const id=Number(event.id),request=new AbortController(),expiresAt=Date.now()+15000
  try{
   if(!refreshWitness||!Number.isSafeInteger(id)||id<1||requests.has(id)||++refreshes>3)throw new Error('YOUTUBE_SABR_ATTESTATION: Same-player browser attestation refresh is unavailable or exhausted.')
   requests.set(id,request);const active=AbortSignal.any([combined,request.signal,AbortSignal.timeout(15000)]),until=expiresAt
   while(Date.now()<until){active.throwIfAborted();await guard();active.throwIfAborted();const fresh=bindYoutubeSabrDelivery(await refreshWitness(active)),original=VideoPlaybackAbrRequest.decode(delivery.requestBody),next=VideoPlaybackAbrRequest.decode(fresh.requestBody)
    if(fresh.videoIdentity.targetId!==delivery.videoIdentity.targetId||youtubeSabrUrl(fresh.streamUrl).searchParams.get('cpn')!==youtubeSabrUrl(delivery.streamUrl).searchParams.get('cpn')||fresh.ustreamerConfig!==delivery.ustreamerConfig||youtubeSabrUrl(fresh.streamUrl).searchParams.get('id')!==youtubeSabrUrl(delivery.streamUrl).searchParams.get('id')||JSON.stringify(next.streamerContext?.clientInfo)!==JSON.stringify(original.streamerContext?.clientInfo)||![selected.video,selected.audio].every(format=>fresh.formats.some(candidate=>formatKey(candidate)===formatKey(format))))throw new Error('VIDEO_IDENTITY_CHANGED: Browser attestation refresh changed the target, client or selected formats.')
    active.throwIfAborted();const token=next.streamerContext?.poToken
    if(token?.length&&token.length<=16384&&(!lastToken||!Buffer.from(token).equals(Buffer.from(lastToken)))){lastToken=new Uint8Array(token);post({type:'attestation',id,data:lastToken});return}
    await delay(250,undefined,{signal:active})
   }
   throw new Error('YOUTUBE_SABR_ATTESTATION: The website rejected streaming verification and no updated same-player browser request was observed; no complete video was retained.')
  }catch(error){if(!finished&&!closing&&!combined.aborted){post({type:'attestation-error',id});fail(Date.now()>=expiresAt?new Error('YOUTUBE_SABR_ATTESTATION: No updated same-player browser verification was observed before the bounded refresh deadline.'):error)}}finally{requests.delete(id)}
 }
 worker.on('message',(raw:unknown)=>{try{const event=record(raw),type=event.type
  if(type==='refresh-attestation'){const job=refreshRequest(event);jobs.add(job);void job.finally(()=>jobs.delete(job)).catch(fail)}
  else if(type==='fetch'){const job=fetchRequest(event);jobs.add(job);void job.finally(()=>jobs.delete(job)).catch(fail)}
  else if(type==='fetch-abort'){const id=Number(event.id);requests.get(id)?.abort();acks.get(id)?.();acks.delete(id)}
  else if(type==='response-ack'){const id=Number(event.id);acks.get(id)?.();acks.delete(id)}
  else if(type==='output'&&(event.track==='video'||event.track==='audio')&&event.data instanceof Uint8Array)outputs[event.track].push(event.data)
  else if(type==='output-end'&&(event.track==='video'||event.track==='audio'))outputs[event.track].end()
  else if(type==='finished'){finished=true;for(const request of requests.values())request.abort();resolveFinished()}
  else if(type==='error')fail(new Error('YOUTUBE_SABR_PROTOCOL: '+String(event.message).slice(0,700)))
  else fail(new Error('YOUTUBE_SABR_WORKER: Malformed protocol message.'))
 }catch(error){fail(error)}})
 return {video:outputs.video.stream,audio:outputs.audio.stream,formats:selected,proof:async()=>{await completion;await Promise.all([...jobs]);if(failure)throw failure;combined.throwIfAborted();return validator.finish(delivery.durationSeconds)},close}
}
