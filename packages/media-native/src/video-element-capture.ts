import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {FileHandle} from 'node:fs/promises'
import type {WebContents} from 'electron'
import {MAX_CAPTURE_BYTES,safeCaptureFilename} from './capture-policy.js'
import {finiteNumber} from './media-contract.js'
import {assertSourceCaptureEvidence,assertSourceCaptureGuard} from './source-contract.js'
import type {SourceCaptureGuard,SourceCaptureEvidence} from './source-contract.js'
import {saveMappedCaptureIndex} from './capture-source-index.js'
import {CaptureMux,verifyCaptureMux} from './capture-mux.js'
import type {CaptureEncodedPacket} from './capture-mux.js'
import {assertPlaybackPlan} from './capture-timeline.js'
import type {CapturePlaybackStep} from './capture-timeline.js'
import type {CaptureFrameMapping,CapturePlaybackEvent} from './capture-timeline.js'
interface CaptureRequest {selector?:unknown;index?:unknown;filename?:unknown;fromStart?:unknown;maxDurationMs?:unknown;playbackPlan?:unknown;sourceGuard?:SourceCaptureGuard}
interface Packet {chunks:string[];videoPackets:CaptureEncodedPacket[];done:boolean;pending:number;error:string;reason:string;sourceEndSeconds:number;sourceDurationSeconds:number|null;playbackEvents:CapturePlaybackEvent[]}
interface Initialization {ok:boolean;reason?:string;mimeType?:string;duration?:number|null;sourceStartSeconds?:number;videoTracks?:number;audioTracks?:number;muted?:boolean;width?:number;height?:number;codec?:string}
interface PendingFrame {sourceTimestampSeconds:number;presentedFrames:number;playbackRate:number;fileTimestampSeconds:number;frame:VideoFrame;sourceWidth:number;sourceHeight:number}
interface RendererSession {cancelled?:boolean;stop(reason?:string):boolean;pull():Packet;cancel():Promise<void>;restore():void}
/** Fixed renderer program. It never reads input text, credentials or network state. */
async function initializeRenderer(key:string,request:{selector:string;index:number;fromStart:boolean;maxDurationMs:number;playbackPlan:CapturePlaybackStep[];sourceGuard?:SourceCaptureGuard}):Promise<Initialization>{
 const globals=globalThis as unknown as Record<string,RendererSession>
 if(globals[key]?.cancelled)return {ok:false,reason:'Capture cancelled before initialization.'}
 const root=document.querySelectorAll(request.selector)[request.index]
 if(!root)return {ok:false,reason:'No element matched the capture selector and index.'}
 const video=root instanceof HTMLVideoElement?root:root.querySelector('video')
 if(!video)return {ok:false,reason:'The selected element does not contain a video.'}
 const normalized=(value:string)=>{const url=new URL(value,location.href);url.hash='';return url.href}
 const admission=()=>{
  if(!request.sourceGuard)return
  const guard=request.sourceGuard,scope=document.querySelectorAll(guard.scope.selector)[guard.scope.index]
  if(normalized(location.href)!==guard.pageUrl||!scope||!scope.contains(video)||normalized(video.currentSrc||video.src)!==guard.candidateUrl)throw new Error('Confirmed source page, range or video changed.')
  for(const selector of [...guard.scope.excludeSelectors,'[contenteditable]:not([contenteditable="false"])'])if(video.closest(selector))throw new Error('Selected video is excluded from the confirmed source range.')
 }
 admission()
 const captureStream=(video as HTMLVideoElement&{captureStream?:()=>MediaStream}).captureStream
 if(typeof captureStream!=='function'||typeof VideoEncoder!=='function'||typeof video.requestVideoFrameCallback!=='function')return {ok:false,reason:'Native capture requires captureStream, requestVideoFrameCallback and WebCodecs VideoEncoder.'}
 const initial={currentTime:video.currentTime,loop:video.loop,playbackRate:video.playbackRate}
 const state={cancelled:false,restored:false,audioReady:new Map<number,string>(),videoReady:new Map<number,CaptureEncodedPacket>(),nextAudio:0,pullAudio:0,nextVideo:0,pullVideo:0,pending:0,bufferBytes:0,done:false,error:'',reason:'',recorder:undefined as MediaRecorder|undefined,encoder:undefined as VideoEncoder|undefined,stream:undefined as MediaStream|undefined,timer:0,frameRequest:0,sourceStartSeconds:0,sourceEndSeconds:0,lastSourceSeconds:0,started:false,sourceDurationSeconds:null as number|null,startedAt:0,held:undefined as PendingFrame,encoded:new Map<number,CaptureFrameMapping>(),events:[] as CapturePlaybackEvent[],width:0,height:0,frames:0,lastKeySeconds:-10,planIndex:0,resumeTimer:0,readers:new Set<FileReader>()}
 let resolveCancelled:()=>void;const cancelled=new Promise<void>(resolve=>resolveCancelled=resolve)
 let resolveStopped:()=>void;const stopped=new Promise<void>(resolve=>resolveStopped=resolve)
 let audioStopped:Promise<void>=Promise.resolve(),resolveAudio:()=>void=()=>{}
 const fileTime=()=>Math.max(0,Math.round(performance.now()-state.startedAt)/1000)
 const observeTime=()=>{if(state.started&&!state.reason&&Number.isFinite(video.currentTime))state.lastSourceSeconds=Math.max(state.lastSourceSeconds,video.currentTime)}
 const playback=(event:Event)=>{if(!state.started||state.reason)return;if(state.events.length>=512){state.error='Capture playback event budget exceeded.';stop('error');return}state.events.push({kind:event.type as CapturePlaybackEvent['kind'],sourceSeconds:video.currentTime,fileSeconds:fileTime(),rate:video.playbackRate})}
 const enqueue=(blob:Blob,ready:(data:string)=>void)=>{
  if(blob.size>8*1024*1024||state.bufferBytes+blob.size>16*1024*1024||state.pending>=32){state.error='Capture buffer budget exceeded.';stop('error');return}
  state.pending++;state.bufferBytes+=blob.size;const reader=new FileReader();state.readers.add(reader)
  const settled=()=>{if(state.readers.delete(reader))state.pending--}
  reader.onload=()=>{if(!state.cancelled){const value=String(reader.result??''),at=value.indexOf(';base64,');if(at<0)state.error='Invalid capture packet.';else ready(value.slice(at+8))}settled()}
  reader.onerror=()=>{state.error='Failed to serialize capture packet.';settled()};reader.onabort=settled;reader.readAsDataURL(blob)
 }
 const encode=(row:PendingFrame,until:number,sourceEnd:number)=>{
  try{
   const queueLimit=Math.max(1,Math.min(8,Math.floor(64*1024*1024/(state.width*state.height*4))-3))
   if(state.encoder!.encodeQueueSize>=queueLimit||state.encoded.size>=16||++state.frames>120000)throw new Error('Capture encoder frame budget exceeded.')
   const duration=Math.max(.001,until-row.fileTimestampSeconds),timestamp=Math.round(row.fileTimestampSeconds*1e6)
   const frame=new VideoFrame(row.frame,{timestamp,duration:Math.round(duration*1e6)})
   state.encoded.set(timestamp,{sourceTimestampSeconds:row.sourceTimestampSeconds,endSourceSeconds:sourceEnd,fileTimestampSeconds:row.fileTimestampSeconds,fileDurationSeconds:duration,presentedFrames:row.presentedFrames,playbackRate:row.playbackRate,sourceWidth:row.sourceWidth,sourceHeight:row.sourceHeight})
   const keyFrame=row.fileTimestampSeconds-state.lastKeySeconds>=2;if(keyFrame)state.lastKeySeconds=row.fileTimestampSeconds
   try{state.encoder!.encode(frame,{keyFrame})}finally{frame.close()}
  }finally{row.frame.close()}
 }
 const stop=(reason='requested',endSeconds?:number)=>{
  if(state.done||state.reason||!state.started)return false
  observeTime();state.reason=reason;state.sourceEndSeconds=endSeconds??state.lastSourceSeconds;state.sourceDurationSeconds=Number.isFinite(video.duration)?video.duration:null
  if(state.frameRequest)video.cancelVideoFrameCallback(state.frameRequest)
  if(state.recorder?.state!=='inactive')state.recorder?.stop()
  void(async()=>{try{
   if(state.held){const row=state.held;state.held=undefined;encode(row,Math.max(fileTime(),row.fileTimestampSeconds+.001),state.sourceEndSeconds)}
   await state.encoder!.flush();await audioStopped;if(state.encoded.size)throw new Error('Capture encoder dropped a source frame.')
  }catch(error){state.error=error instanceof Error?error.message:String(error)}finally{state.done=true;resolveStopped()}})()
  return true
 }
 const ended=(event:Event)=>{if(!event.isTrusted)return;observeTime();const duration=video.duration
  if(!Number.isFinite(duration)||duration<=0||state.lastSourceSeconds<duration-.5){state.error='Video ended without observed progress to its finite endpoint.';stop('error');return}stop('ended',duration)}
 const seeking=()=>{if(state.started&&!state.reason){state.error='Video playback position changed during capture.';stop('error')}}
 let resized:OffscreenCanvas|undefined
 const frame=(_now:number,metadata:VideoFrameCallbackMetadata)=>{
  if(state.restored||state.reason)return
  // A paused player can present a cached pre-seek frame before its first new
  // frame. It cannot belong to this admitted source interval.
  try{if(state.started&&Number.isFinite(metadata.mediaTime)&&metadata.mediaTime>=state.sourceStartSeconds){
   state.lastSourceSeconds=Math.max(state.lastSourceSeconds,metadata.mediaTime)
   const time=Math.round(metadata.mediaTime*1e6)/1e6
   const sourceWidth=video.videoWidth,sourceHeight=video.videoHeight
   if(!sourceWidth||!sourceHeight||sourceWidth*sourceHeight>16777216)throw new Error('Adaptive source frame exceeds the capture pixel budget.')
   if(!state.held||time>state.held.sourceTimestampSeconds){
    const fileTimestampSeconds=Math.max(fileTime(),(state.held?.fileTimestampSeconds??-.001)+.001)
    let source:HTMLVideoElement|OffscreenCanvas=video
    if(sourceWidth!==state.width||sourceHeight!==state.height){
     resized??=new OffscreenCanvas(state.width,state.height);const context=resized.getContext('2d')!;context.fillStyle='#000000';context.fillRect(0,0,state.width,state.height)
     const scale=Math.min(state.width/sourceWidth,state.height/sourceHeight),w=sourceWidth*scale,h=sourceHeight*scale
     context.drawImage(video,(state.width-w)/2,(state.height-h)/2,w,h);source=resized
    }
    const native=new VideoFrame(source,{timestamp:Math.round(time*1e6)})
    const prior=state.held;state.held={sourceTimestampSeconds:time,presentedFrames:metadata.presentedFrames,playbackRate:video.playbackRate,fileTimestampSeconds,frame:native,sourceWidth,sourceHeight}
    if(prior)encode(prior,fileTimestampSeconds,time)
   }
  }}catch(error){state.error=error instanceof Error?error.message:String(error);stop('error')}
  while(!state.reason&&state.planIndex<request.playbackPlan.length&&metadata.mediaTime>=request.playbackPlan[state.planIndex]!.sourceSeconds){
   const step=request.playbackPlan[state.planIndex++]!
   if(step.rate!==undefined)video.playbackRate=step.rate
   if(step.pauseMs!==undefined){video.pause();state.resumeTimer=setTimeout(()=>{if(!state.reason&&!state.cancelled)void video.play().catch(error=>{state.error=String(error);stop('error')})},step.pauseMs) as unknown as number;break}
  }
  if(!state.reason)state.frameRequest=video.requestVideoFrameCallback(frame)
 }
 const restore=()=>{if(state.restored)return;state.restored=true;clearTimeout(state.timer);clearTimeout(state.resumeTimer);if(state.frameRequest)video.cancelVideoFrameCallback(state.frameRequest);state.held?.frame.close();state.held=undefined;if(state.encoder?.state!=='closed')state.encoder?.close();video.removeEventListener('ended',ended,true);video.removeEventListener('timeupdate',observeTime,true);video.removeEventListener('seeking',seeking,true);for(const kind of ['play','pause','ratechange'])video.removeEventListener(kind,playback,true);for(const track of state.stream?.getTracks()??[])track.stop();video.loop=initial.loop;video.playbackRate=initial.playbackRate;try{video.currentTime=initial.currentTime}catch{}video.pause();if(globals[key]===session)delete globals[key]}
 const session:RendererSession={stop,pull:()=>{
  if(!state.cancelled)admission()
  const chunks:string[]=[],videoPackets:CaptureEncodedPacket[]=[]
  while(state.audioReady.has(state.pullAudio)){const data=state.audioReady.get(state.pullAudio)!;state.audioReady.delete(state.pullAudio++);state.bufferBytes-=Math.floor(data.length*3/4);chunks.push(data)}
  while(state.videoReady.has(state.pullVideo)){const packet=state.videoReady.get(state.pullVideo)!;state.videoReady.delete(state.pullVideo++);state.bufferBytes-=Math.floor(packet.data.length*3/4);videoPackets.push(packet)}
  return {chunks,videoPackets,pending:state.pending,done:state.done,error:state.error,reason:state.reason,sourceEndSeconds:state.sourceEndSeconds,sourceDurationSeconds:state.sourceDurationSeconds,playbackEvents:state.events}
 },restore,cancel:async()=>{state.cancelled=true;session.cancelled=true;resolveCancelled();stop('cancelled');if(state.started&&!state.done)await stopped;for(const reader of state.readers)reader.abort();restore()}}
 globals[key]=session
 const check=()=>{if(state.cancelled)throw new Error('Capture cancelled during initialization.');admission()}
 const wait=async(event:string,ms:number)=>{let listener:()=>void,timer:ReturnType<typeof setTimeout>;const eventOrTime=new Promise<void>(resolve=>{listener=resolve;video.addEventListener(event,listener,{once:true});timer=setTimeout(resolve,ms)});try{await Promise.race([eventOrTime,cancelled]);check()}finally{video.removeEventListener(event,listener!);clearTimeout(timer!)}}
 try{
  if(video.readyState<2)await wait('loadeddata',8000)
  if(video.seeking){await wait('seeked',3000);if(video.seeking)throw new Error('Video seek did not settle before capture.')}
  check();video.pause();video.loop=false;video.playbackRate=1
  if(request.fromStart&&Number.isFinite(video.duration)&&video.duration>0&&(video.currentTime>0||video.ended)){video.currentTime=0;await wait('seeked',3000);if(video.seeking||video.currentTime>.001)throw new Error('Video could not seek to its start.')}
  check();state.stream=captureStream.call(video);if(state.stream.getVideoTracks().length!==1||state.stream.getAudioTracks().length>1)throw new Error('Video capture requires one video and at most one audio track.')
  state.width=video.videoWidth;state.height=video.videoHeight
  if(!state.width||!state.height||state.width*state.height*4*4>64*1024*1024)throw new Error('Source frame exceeds the 64 MiB mapped capture cache budget.')
  const config:VideoEncoderConfig={codec:'vp09.00.10.08',width:state.width,height:state.height,bitrate:4000000,latencyMode:'realtime'}
  if(!(await VideoEncoder.isConfigSupported(config)).supported)throw new Error('Mapped capture VP9 encoder unavailable.');check()
  state.encoder=new VideoEncoder({error:error=>{state.error=error.message;stop('error')},output:chunk=>{
   const row=state.encoded.get(chunk.timestamp);state.encoded.delete(chunk.timestamp)
   if(!row){state.error='Capture encoder returned an unbound frame timestamp.';stop('error');return}
   const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);const sequence=state.nextVideo++
   enqueue(new Blob([bytes]),data=>state.videoReady.set(sequence,{...row,type:chunk.type,data}))
  }});state.encoder.configure(config)
  const audioTracks=state.stream.getAudioTracks()
  if(audioTracks.length){
   if(!MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))throw new Error('Native Opus audio recorder unavailable.')
   const recorder=new MediaRecorder(new MediaStream(audioTracks),{mimeType:'audio/webm;codecs=opus'});state.recorder=recorder
   audioStopped=new Promise<void>(resolve=>resolveAudio=resolve)
   recorder.ondataavailable=event=>{if(state.cancelled||!event.data.size)return;const sequence=state.nextAudio++;enqueue(event.data,data=>state.audioReady.set(sequence,data))}
   recorder.onerror=()=>{state.error='Browser audio MediaRecorder failed.';stop('error')};recorder.onstop=()=>resolveAudio()
  }
  video.addEventListener('ended',ended,true);video.addEventListener('timeupdate',observeTime,true);video.addEventListener('seeking',seeking,true);for(const kind of ['play','pause','ratechange'])video.addEventListener(kind,playback,true)
  const sourceStartSeconds=video.currentTime;state.sourceStartSeconds=sourceStartSeconds;state.lastSourceSeconds=sourceStartSeconds;state.startedAt=performance.now();state.started=true;state.recorder?.start(500)
  state.timer=setTimeout(()=>stop('maximum-duration'),request.maxDurationMs) as unknown as number
  state.frameRequest=video.requestVideoFrameCallback(frame)
  let playTimer:ReturnType<typeof setTimeout>;try{await Promise.race([video.play(),cancelled,new Promise<never>((_resolve,reject)=>{playTimer=setTimeout(()=>reject(new Error('Video playback did not start within 8s.')),8000)})]);check()}finally{clearTimeout(playTimer!)}
  return {ok:true,mimeType:'video/webm',duration:Number.isFinite(video.duration)?video.duration:null,sourceStartSeconds,videoTracks:1,audioTracks:audioTracks.length,muted:video.muted,width:state.width,height:state.height,codec:config.codec}
 }catch(error){state.error=error instanceof Error?error.message:String(error);await session.cancel();return {ok:false,reason:state.error}}
}
export const videoElementCaptureInternals={initializeRenderer}
/** Owns one exclusively-created Project file and drains cancellation before release. */
export class VideoElementCapture {
 cleanupFailed=false
 readonly id='video-capture-'+crypto.randomUUID();readonly key='__bmwMediaCapture_'+crypto.randomUUID().replaceAll('-','');private requestedStop=false
 readonly filePath:string;private request:{selector:string;index:number;fromStart:boolean;maxDurationMs:number;playbackPlan:CapturePlaybackStep[];sourceGuard?:SourceCaptureGuard}
 constructor(readonly webContents:WebContents,private directory:string,raw:CaptureRequest,private tab:{id:string;title:string;url:string},private status?:(value:unknown)=>void){
  const selector=String(raw.selector??'').trim();if(!selector||selector.length>500)throw new TypeError('Video capture requires a bounded selector.')
  const index=finiteNumber(raw.index??0,'capture index',0,10000,true),maxDurationMs=finiteNumber(raw.maxDurationMs??900000,'capture duration',1000,1800000,true)
  const sourceGuard=raw.sourceGuard?assertSourceCaptureGuard(raw.sourceGuard):undefined
  this.request={selector,index,fromStart:raw.fromStart!==false,maxDurationMs,playbackPlan:assertPlaybackPlan(raw.playbackPlan),...(sourceGuard?{sourceGuard}:{})};this.filePath=path.join(directory,crypto.randomUUID()+'-'+safeCaptureFilename(raw.filename))
 }
 private phase<T>(name:string,read:()=>Promise<T>,signal?:AbortSignal,timeoutMs=15000):Promise<T>{
  return new Promise<T>((resolve,reject)=>{let done=false;const finish=(error?:unknown,value?:T)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value!)};const abort=()=>finish(signal?.reason??new Error('Video capture cancelled.'));const timer=setTimeout(()=>finish(new Error('Video capture '+name+' timed out.')),timeoutMs);if(signal?.aborted){abort();return}signal?.addEventListener('abort',abort,{once:true});try{Promise.resolve(read()).then(value=>finish(undefined,value),error=>finish(error))}catch(error){finish(error)}})
 }
 async retryCleanup(){
  if(!this.cleanupFailed)return {state:'idle'}
  if(!this.webContents.isDestroyed())await this.phase('cleanup-recovery',()=>this.webContents.executeJavaScript(`(async()=>{const state=globalThis[${JSON.stringify(this.key)}];await state?.cancel?.();state?.restore?.();delete globalThis[${JSON.stringify(this.key)}]})()`,true),undefined,10000)
  this.cleanupFailed=false;return {state:'idle',cleanupRecovered:true}
 }
 async stop(){this.requestedStop=true;if(!this.webContents.isDestroyed())await this.phase('stop',()=>this.webContents.executeJavaScript(`globalThis[${JSON.stringify(this.key)}]?.stop('requested')`,true),undefined,5000).catch(()=>{});return {recordingId:this.id,state:'stopping'}}
 async run(signal?:AbortSignal){
  signal?.throwIfAborted();this.directory=await fs.realpath(this.directory);const identity=await fs.stat(this.directory),controller=new AbortController(),wc=this.webContents
  const abort=()=>controller.abort(signal?.reason??new Error('Video capture cancelled.')),gone=()=>controller.abort(new Error('Video capture page closed or renderer failed.')),navigate=(_event:unknown,_url:string,inPlace:boolean,mainFrame:boolean)=>{if(mainFrame&&!inPlace)controller.abort(new Error('Video capture page navigated.'))}
  const guard=async()=>{controller.signal.throwIfAborted();const stat=await fs.lstat(this.directory);if(!stat.isDirectory()||stat.dev!==identity.dev||stat.ino!==identity.ino||await fs.realpath(path.dirname(this.filePath))!==this.directory)throw new Error('Video capture Project directory changed.')}
  signal?.addEventListener('abort',abort,{once:true});wc.on('destroyed',gone);wc.on('render-process-gone',gone);wc.on('did-start-navigation',navigate)
  const deadline=setTimeout(()=>controller.abort(new Error('Video capture exceeded its host deadline.')),this.request.maxDurationMs+20000),startedAt=new Date().toISOString(),sidecars:string[]=[];let handle:FileHandle|undefined,spool:FileHandle|undefined,created=false,completed=false,initializationSettled=false,initializing:Promise<Initialization>|undefined
  try{
   await guard();handle=await fs.open(this.filePath+'.audio.webm','wx+',0o600);sidecars.push(this.filePath+'.audio.webm');spool=await fs.open(this.filePath+'.packets','wx+',0o600);sidecars.push(this.filePath+'.packets');const mux=new CaptureMux(spool);this.status?.({active:true,id:this.id,tabId:this.tab.id,state:'starting',kind:'video-element'});await guard()
   initializing=wc.executeJavaScript(`(${initializeRenderer.toString()})(${JSON.stringify(this.key)},${JSON.stringify(this.request)})`,true) as Promise<Initialization>;void initializing.then(()=>{initializationSettled=true},()=>{initializationSettled=true})
   const initial=await this.phase('initialize',()=>initializing!,controller.signal);if(!initial.ok)throw new Error(initial.reason??'Video capture could not start.')
   await guard();this.status?.({active:true,id:this.id,tabId:this.tab.id,state:'recording',kind:'video-element',...initial});if(this.requestedStop)await this.stop()
   let audioBytes=0,packet:Packet
   while(true){
    await this.phase('poll',()=>new Promise<void>(resolve=>setTimeout(resolve,250)),controller.signal)
    packet=await this.phase('read',()=>wc.executeJavaScript(`globalThis[${JSON.stringify(this.key)}]?.pull()`,true),controller.signal);await guard()
    if(!packet||!Array.isArray(packet.chunks)||packet.chunks.length>64||!Array.isArray(packet.videoPackets)||packet.videoPackets.length>128)throw new Error('Video capture state disappeared or exceeded its packet budget.')
    if(packet.error)throw new Error(packet.error)
    for(const encoded of packet.chunks){if(typeof encoded!=='string'||encoded.length>12*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded))throw new Error('Invalid capture packet.');const chunk=Buffer.from(encoded,'base64');audioBytes+=chunk.length;if(audioBytes>MAX_CAPTURE_BYTES)throw new Error('Captured video exceeds the 512 MiB limit.');let at=0;while(at<chunk.length){await guard();const result=await handle.write(chunk,at,chunk.length-at);if(!result.bytesWritten)throw new Error('Capture write made no progress.');at+=result.bytesWritten}}
    for(const encoded of packet.videoPackets)await mux.add(encoded,guard)
    if(packet.done&&packet.pending===0&&!packet.chunks.length&&!packet.videoPackets.length)break
   }
   await handle.sync();await handle.close();handle=undefined;await guard()
   handle=await fs.open(this.filePath,'wx+',0o600);created=true
   const muxed=await mux.finish(this.directory,initial.audioTracks?path.basename(this.filePath)+'.audio.webm':undefined,handle,{width:initial.width!,height:initial.height!,codec:initial.codec!,audioTracks:initial.audioTracks!},guard)
   await handle.close();handle=undefined;await guard();const videoSha256=await verifyCaptureMux(this.directory,path.basename(this.filePath),muxed.frames,guard)
   const sourceStartSeconds=finiteNumber(initial.sourceStartSeconds,'capture source start',0,86400),sourceEndSeconds=finiteNumber(packet.sourceEndSeconds,'capture source end',sourceStartSeconds,86400)
   const stopReason=packet.reason;if(!['ended','maximum-duration','requested'].includes(stopReason))throw new Error('Video capture ended without valid completion evidence.')
   const sourceDurationSeconds=packet.sourceDurationSeconds??initial.duration??null
   const capture:SourceCaptureEvidence|undefined=this.request.sourceGuard?assertSourceCaptureEvidence({kind:'video-element',...this.request.sourceGuard,selector:this.request.selector,index:this.request.index,fromStart:this.request.fromStart,sourceStartSeconds,sourceEndSeconds,sourceDurationSeconds,stopReason,startedAt,endedAt:new Date().toISOString()}):undefined
   const captureTimeline=await saveMappedCaptureIndex(this.directory,{version:2,sourceArtifactId:path.basename(this.filePath),videoSha256,basis:'native-source-frame+encoded-packet+demuxed-PTS',fileTimestampMapping:'verified',sourceStartSeconds,sourceEndSeconds,durationAtStartSeconds:initial.duration??null,sourceDurationSeconds,status:'indexed',reason:null,frames:muxed.frames,playbackEvents:packet.playbackEvents},sidecars,guard)
   await spool.close();spool=undefined;for(const file of sidecars.filter(file=>!file.endsWith('.source.json')))await fs.rm(file,{force:true})
   completed=true;return {artifactId:path.basename(this.filePath),path:this.filePath,type:'video',contentType:initial.mimeType??'video/webm',bytes:muxed.bytes,durationMs:Date.now()-Date.parse(startedAt),durationAtStartSeconds:initial.duration,sourceDurationSeconds,sourceStartSeconds,sourceEndSeconds,videoTracks:initial.videoTracks,audioTracks:initial.audioTracks,complete:stopReason==='ended',stopReason,captureTimeline,tab:this.tab,...(capture?{capture}:{})}
  }finally{
   clearTimeout(deadline)
   let cleanupError:unknown
   try{
    if(!wc.isDestroyed())await this.phase('cleanup',()=>wc.executeJavaScript(`(async()=>{const key=${JSON.stringify(this.key)},state=globalThis[key];if(state)await state.cancel();else globalThis[key]={cancelled:true};})()`,true),undefined,5000)
    if(initializing)await this.phase('initialization-drain',()=>initializing!,undefined,10000).catch(error=>{if(!initializationSettled)throw error})
    if(!wc.isDestroyed())await this.phase('restore',()=>wc.executeJavaScript(`globalThis[${JSON.stringify(this.key)}]?.restore?.();if(${initializationSettled})delete globalThis[${JSON.stringify(this.key)}]`,true),undefined,5000)
   }catch(error){if(!wc.isDestroyed()){cleanupError=error;this.cleanupFailed=true;completed=false}}
   await handle?.close();await spool?.close();if(controller.signal.aborted)completed=false;if(!completed){try{const stat=await fs.lstat(this.directory);if(stat.dev===identity.dev&&stat.ino===identity.ino&&await fs.realpath(path.dirname(this.filePath))===this.directory)for(const file of [...(created?[this.filePath]:[]),...sidecars])await fs.rm(file,{force:true})}catch{/* Never follow a replaced Project boundary during rollback. */}}
   signal?.removeEventListener('abort',abort);wc.removeListener('destroyed',gone);wc.removeListener('render-process-gone',gone);wc.removeListener('did-start-navigation',navigate);this.status?.({active:false,id:this.id,tabId:this.tab.id,state:this.cleanupFailed?'cleanup-failed':'idle',kind:'video-element'});if(cleanupError)throw new Error('Capture cleanup failed; this media admission remains quarantined. Use media.record.stop to retry cleanup. '+String(cleanupError));controller.signal.throwIfAborted()
  }
 }
}
