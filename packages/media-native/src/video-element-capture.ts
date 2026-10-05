import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {FileHandle} from 'node:fs/promises'
import type {WebContents} from 'electron'
import {MAX_CAPTURE_BYTES,safeCaptureFilename} from './capture-policy.js'
import {mediaRecord,finiteNumber} from './media-contract.js'
import {assertSourceCaptureEvidence,assertSourceCaptureGuard} from './source-contract.js'
import type {SourceCaptureGuard,SourceCaptureEvidence} from './source-contract.js'
interface CaptureRequest {selector?:unknown;index?:unknown;filename?:unknown;fromStart?:unknown;maxDurationMs?:unknown;sourceGuard?:SourceCaptureGuard}
interface Packet {chunks:string[];done:boolean;pending:number;error:string;reason:string;sourceEndSeconds:number}
interface Initialization {ok:boolean;reason?:string;mimeType?:string;duration?:number|null;sourceStartSeconds?:number;videoTracks?:number;audioTracks?:number;muted?:boolean}
interface RendererSession {cancelled?:boolean;stop(reason?:string):boolean;pull():Packet;cancel():Promise<void>;restore():void}
/** Fixed renderer program. It never reads input text, credentials or network state. */
async function initializeRenderer(key:string,request:{selector:string;index:number;fromStart:boolean;maxDurationMs:number;sourceGuard?:SourceCaptureGuard}):Promise<Initialization>{
 const globals=globalThis as unknown as Record<string,RendererSession>
 if(globals[key]?.cancelled)return {ok:false,reason:'Capture cancelled before initialization.'}
 const roots=document.querySelectorAll(request.selector),root=roots[request.index]
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
 if(typeof captureStream!=='function')return {ok:false,reason:'HTMLMediaElement.captureStream is unavailable.'}
 const initial={currentTime:video.currentTime,paused:video.paused,loop:video.loop,playbackRate:video.playbackRate}
 const state={cancelled:false,restored:false,ready:new Map<number,string>(),nextSequence:0,nextPull:0,pending:0,bufferBytes:0,done:false,error:'',reason:'',recorder:undefined as MediaRecorder|undefined,stream:undefined as MediaStream|undefined,timer:0,sourceEndSeconds:0}
 let resolveCancelled:()=>void;const cancelled=new Promise<void>(resolve=>resolveCancelled=resolve)
 let resolveStopped:()=>void;const stopped=new Promise<void>(resolve=>resolveStopped=resolve)
 const stop=(reason='requested')=>{if(state.done||!state.recorder||state.recorder.state==='inactive')return false;state.reason=reason;state.sourceEndSeconds=video.currentTime;state.recorder.stop();return true}
 const restore=()=>{if(state.restored)return;state.restored=true;clearTimeout(state.timer);video.removeEventListener('ended',ended);for(const track of state.stream?.getTracks()??[])track.stop();video.loop=initial.loop;video.playbackRate=initial.playbackRate;try{video.currentTime=initial.currentTime}catch{}if(initial.paused)video.pause();else void video.play().catch(()=>{});if(globals[key]===session)delete globals[key]}
 const ended=()=>stop('ended')
 const session:RendererSession={stop,pull:()=>{if(!state.cancelled)admission();const chunks:string[]=[];while(state.ready.has(state.nextPull)){const value=state.ready.get(state.nextPull)!;state.ready.delete(state.nextPull++);state.bufferBytes-=Math.floor(value.length*3/4);chunks.push(value)}return {chunks,pending:state.pending,done:state.done,error:state.error,reason:state.reason,sourceEndSeconds:state.sourceEndSeconds}},restore,cancel:async()=>{state.cancelled=true;session.cancelled=true;resolveCancelled();stop('cancelled');if(state.recorder?.state==='recording'||!state.done&&state.recorder)await Promise.race([stopped,new Promise<void>(resolve=>setTimeout(resolve,3000))]);restore()}}
 globals[key]=session
 const check=()=>{if(state.cancelled)throw new Error('Capture cancelled during initialization.');admission()}
 const wait=async(event:string,ms:number)=>{
  let listener:()=>void;let timer:ReturnType<typeof setTimeout>;const eventOrTime=new Promise<void>(resolve=>{listener=resolve;video.addEventListener(event,listener,{once:true});timer=setTimeout(resolve,ms)})
  try{await Promise.race([eventOrTime,cancelled]);check()}finally{video.removeEventListener(event,listener!);clearTimeout(timer!)}
 }
 try{
  if(video.readyState<2)await wait('loadeddata',8000)
  check();video.loop=false;video.playbackRate=1
  if(request.fromStart&&Number.isFinite(video.duration)&&video.duration>0&&video.currentTime>.05){video.currentTime=0;await wait('seeked',3000);if(video.currentTime>.1)throw new Error('Video could not seek to its start.')}
  check();state.stream=captureStream.call(video);if(state.stream.getVideoTracks().length!==1)throw new Error('Video capture requires exactly one available video track.')
  const mimeType=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type))??''
  const recorder=new MediaRecorder(state.stream,mimeType?{mimeType,videoBitsPerSecond:4000000}:undefined);state.recorder=recorder
  recorder.ondataavailable=event=>{
   if(state.cancelled||!event.data.size)return
   if(event.data.size>8*1024*1024||state.bufferBytes+event.data.size>16*1024*1024||state.pending>=32){state.error='Capture buffer budget exceeded.';stop('error');return}
   const sequence=state.nextSequence++;state.pending++;state.bufferBytes+=event.data.size
   const reader=new FileReader();reader.onload=()=>{if(!state.cancelled){const value=String(reader.result??''),marker=';base64,',at=value.indexOf(marker);if(at<0)state.error='Invalid captured chunk.';else state.ready.set(sequence,value.slice(at+marker.length))}state.pending--};reader.onerror=()=>{state.error='Failed to read captured chunk.';state.pending--};reader.readAsDataURL(event.data)
  }
  recorder.onerror=()=>{state.error='Browser MediaRecorder failed.';stop('error')};recorder.onstop=()=>{state.done=true;resolveStopped()}
  video.addEventListener('ended',ended,{once:true});state.timer=setTimeout(()=>stop('maximum-duration'),request.maxDurationMs) as unknown as number
  const sourceStartSeconds=video.currentTime;recorder.start(500)
  let playTimer:ReturnType<typeof setTimeout>
  try{await Promise.race([video.play(),cancelled,new Promise<never>((_resolve,reject)=>{playTimer=setTimeout(()=>reject(new Error('Video playback did not start within 8s.')),8000)})]);check()}finally{clearTimeout(playTimer!)}
  return {ok:true,mimeType:recorder.mimeType,duration:Number.isFinite(video.duration)?video.duration:null,sourceStartSeconds,videoTracks:state.stream.getVideoTracks().length,audioTracks:state.stream.getAudioTracks().length,muted:video.muted}
 }catch(error){state.error=error instanceof Error?error.message:String(error);await session.cancel();return {ok:false,reason:state.error}}
}
/** Owns one exclusively-created Project file and drains cancellation before release. */
export class VideoElementCapture {
 readonly id='video-capture-'+crypto.randomUUID();readonly key='__bmwMediaCapture_'+crypto.randomUUID().replaceAll('-','');private requestedStop=false
 readonly filePath:string;private request:{selector:string;index:number;fromStart:boolean;maxDurationMs:number;sourceGuard?:SourceCaptureGuard}
 constructor(readonly webContents:WebContents,private directory:string,raw:CaptureRequest,private tab:{id:string;title:string;url:string},private status?:(value:unknown)=>void){
  const selector=String(raw.selector??'').trim();if(!selector||selector.length>500)throw new TypeError('Video capture requires a bounded selector.')
  const index=finiteNumber(raw.index??0,'capture index',0,10000,true),maxDurationMs=finiteNumber(raw.maxDurationMs??900000,'capture duration',1000,1800000,true)
  const sourceGuard=raw.sourceGuard?assertSourceCaptureGuard(raw.sourceGuard):undefined
  this.request={selector,index,fromStart:raw.fromStart!==false,maxDurationMs,...(sourceGuard?{sourceGuard}:{})};this.filePath=path.join(directory,crypto.randomUUID()+'-'+safeCaptureFilename(raw.filename))
 }
 private phase<T>(name:string,read:()=>Promise<T>,signal?:AbortSignal,timeoutMs=15000):Promise<T>{
  return new Promise<T>((resolve,reject)=>{let done=false;const finish=(error?:unknown,value?:T)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value!)};const abort=()=>finish(signal?.reason??new Error('Video capture cancelled.'));const timer=setTimeout(()=>finish(new Error('Video capture '+name+' timed out.')),timeoutMs);if(signal?.aborted){abort();return}signal?.addEventListener('abort',abort,{once:true});try{Promise.resolve(read()).then(value=>finish(undefined,value),error=>finish(error))}catch(error){finish(error)}})
 }
 async stop(){this.requestedStop=true;if(!this.webContents.isDestroyed())await this.phase('stop',()=>this.webContents.executeJavaScript(`globalThis[${JSON.stringify(this.key)}]?.stop('requested')`,true),undefined,5000).catch(()=>{});return {recordingId:this.id,state:'stopping'}}
 async run(signal?:AbortSignal){
  signal?.throwIfAborted();this.directory=await fs.realpath(this.directory);const identity=await fs.stat(this.directory),controller=new AbortController(),wc=this.webContents
  const abort=()=>controller.abort(signal?.reason??new Error('Video capture cancelled.')),gone=()=>controller.abort(new Error('Video capture page closed or renderer failed.')),navigate=(_event:unknown,_url:string,inPlace:boolean,mainFrame:boolean)=>{if(mainFrame&&!inPlace)controller.abort(new Error('Video capture page navigated.'))}
  const guard=async()=>{controller.signal.throwIfAborted();const stat=await fs.lstat(this.directory);if(!stat.isDirectory()||stat.dev!==identity.dev||stat.ino!==identity.ino||await fs.realpath(path.dirname(this.filePath))!==this.directory)throw new Error('Video capture Project directory changed.')}
  signal?.addEventListener('abort',abort,{once:true});wc.on('destroyed',gone);wc.on('render-process-gone',gone);wc.on('did-start-navigation',navigate)
  const deadline=setTimeout(()=>controller.abort(new Error('Video capture exceeded its host deadline.')),this.request.maxDurationMs+20000),startedAt=new Date().toISOString();let handle:FileHandle|undefined,created=false,completed=false,initializationSettled=false,initializing:Promise<Initialization>|undefined
  try{
   await guard();handle=await fs.open(this.filePath,'wx+',0o600);created=true;this.status?.({active:true,id:this.id,tabId:this.tab.id,state:'starting',kind:'video-element'});await guard()
   initializing=wc.executeJavaScript(`(${initializeRenderer.toString()})(${JSON.stringify(this.key)},${JSON.stringify(this.request)})`,true) as Promise<Initialization>;void initializing.then(()=>{initializationSettled=true},()=>{initializationSettled=true})
   const initial=await this.phase('initialize',()=>initializing!,controller.signal);if(!initial.ok)throw new Error(initial.reason??'Video capture could not start.')
   await guard();this.status?.({active:true,id:this.id,tabId:this.tab.id,state:'recording',kind:'video-element',...initial});if(this.requestedStop)await this.stop()
   let bytes=0,packet:Packet
   while(true){
    await this.phase('poll',()=>new Promise<void>(resolve=>setTimeout(resolve,250)),controller.signal)
    packet=await this.phase('read',()=>wc.executeJavaScript(`globalThis[${JSON.stringify(this.key)}]?.pull()`,true),controller.signal);await guard()
    if(!packet||!Array.isArray(packet.chunks)||packet.chunks.length>64)throw new Error('Video capture state disappeared or exceeded its packet budget.')
    if(packet.error)throw new Error(packet.error)
    for(const encoded of packet.chunks){if(typeof encoded!=='string'||encoded.length>12*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded))throw new Error('Invalid capture packet.');const chunk=Buffer.from(encoded,'base64');bytes+=chunk.length;if(bytes>MAX_CAPTURE_BYTES)throw new Error('Captured video exceeds the 512 MiB limit.');let at=0;while(at<chunk.length){await guard();const result=await handle.write(chunk,at,chunk.length-at);if(!result.bytesWritten)throw new Error('Capture write made no progress.');at+=result.bytesWritten}}
    if(packet.done&&packet.pending===0&&!packet.chunks.length)break
   }
   if(bytes<1024)throw new Error('Video capture produced an empty file.');const header=Buffer.alloc(4);await handle.read(header,0,4,0);if(!header.equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))throw new Error('Video capture did not produce a WebM header.');await handle.sync();await handle.close();handle=undefined;await guard()
   const sourceStartSeconds=finiteNumber(initial.sourceStartSeconds,'capture source start',0,86400),sourceEndSeconds=finiteNumber(packet.sourceEndSeconds,'capture source end',sourceStartSeconds,86400)
   const stopReason=packet.reason;if(!['ended','maximum-duration','requested'].includes(stopReason))throw new Error('Video capture ended without valid completion evidence.')
   const capture:SourceCaptureEvidence|undefined=this.request.sourceGuard?assertSourceCaptureEvidence({kind:'video-element',...this.request.sourceGuard,selector:this.request.selector,index:this.request.index,fromStart:this.request.fromStart,sourceStartSeconds,sourceEndSeconds,sourceDurationSeconds:initial.duration,stopReason,startedAt,endedAt:new Date().toISOString()}):undefined
   completed=true;return {artifactId:path.basename(this.filePath),path:this.filePath,type:'video',contentType:initial.mimeType??'video/webm',bytes,durationMs:Date.now()-Date.parse(startedAt),sourceDurationSeconds:initial.duration,sourceStartSeconds,sourceEndSeconds,videoTracks:initial.videoTracks,audioTracks:initial.audioTracks,complete:stopReason==='ended',stopReason,tab:this.tab,...(capture?{capture}:{})}
  }finally{
   clearTimeout(deadline)
   // A tombstone stops initialization which was queued but has not entered yet.
   if(!wc.isDestroyed())await this.phase('cleanup',()=>wc.executeJavaScript(`(async()=>{const key=${JSON.stringify(this.key)},state=globalThis[key];if(state)await state.cancel();else globalThis[key]={cancelled:true};})()`,true),undefined,5000).catch(()=>{})
   if(initializing)await this.phase('initialization-drain',()=>initializing!,undefined,10000).catch(()=>{})
   if(!wc.isDestroyed())await this.phase('restore',()=>wc.executeJavaScript(`globalThis[${JSON.stringify(this.key)}]?.restore?.();if(${initializationSettled})delete globalThis[${JSON.stringify(this.key)}]`,true),undefined,5000).catch(()=>{})
   await handle?.close();if(controller.signal.aborted)completed=false;if(created&&!completed){try{const stat=await fs.lstat(this.directory);if(stat.dev===identity.dev&&stat.ino===identity.ino&&await fs.realpath(path.dirname(this.filePath))===this.directory)await fs.rm(this.filePath,{force:true})}catch{/* Never follow a replaced Project boundary during rollback. */}}
   signal?.removeEventListener('abort',abort);wc.removeListener('destroyed',gone);wc.removeListener('render-process-gone',gone);wc.removeListener('did-start-navigation',navigate);this.status?.({active:false,id:this.id,tabId:this.tab.id,state:'idle',kind:'video-element'});controller.signal.throwIfAborted()
  }
 }
}
