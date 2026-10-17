import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {videoElementCaptureInternals} from '../src/video-element-capture.js'

type Listener={callback:(event:{isTrusted:boolean})=>void;capture:boolean;once:boolean}
class Video {
  position=.03;duration:number;paused=false;loop=true;playbackRate=.75;readyState=4;seeking=false;ended=false;muted=false;stopped=false;videoWidth=640;videoHeight=360
  listeners=new Map<string,Listener[]>();frames=new Map<number,unknown>();nextFrame=0
  constructor(duration:number){this.duration=duration}
  get currentTime(){return this.position}
  set currentTime(value:number){this.position=value;this.emit('seeking');queueMicrotask(()=>this.emit('seeked'))}
  addEventListener(type:string,callback:Listener['callback'],options?:boolean|{once?:boolean;capture?:boolean}){this.listeners.set(type,[...(this.listeners.get(type)??[]),{callback,capture:options===true||typeof options==='object'&&options.capture===true,once:typeof options==='object'&&options.once===true}])}
  removeEventListener(type:string,callback:Listener['callback']){this.listeners.set(type,(this.listeners.get(type)??[]).filter(row=>row.callback!==callback))}
  emit(type:string,isTrusted=true){for(const row of [...(this.listeners.get(type)??[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){if(row.once)this.removeEventListener(type,row.callback);row.callback({isTrusted})}}
  pause(){this.paused=true}
  async play(){this.paused=false}
  advance(seconds:number){this.position=seconds;this.emit('timeupdate')}
  requestVideoFrameCallback(callback:unknown){this.frames.set(++this.nextFrame,callback);return this.nextFrame}
  cancelVideoFrameCallback(id:number){this.frames.delete(id)}
  captureStream(){return {getVideoTracks:()=>[{}],getAudioTracks:()=>[{}],getTracks:()=>[{stop:()=>{this.stopped=true}}]}}
}
class Recorder {
  static isTypeSupported(){return true}
  state='inactive';mimeType='video/webm';onstop?:()=>void
  start(){this.state='recording'}
  stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.())}
}
class NativeFrame {
 static instances:NativeFrame[]=[];closed=false;displayWidth=640;displayHeight=360;timestamp:number
 constructor(_source:unknown,options:{timestamp:number}){this.timestamp=options.timestamp;NativeFrame.instances.push(this)}
 clone(){return new NativeFrame(this,{timestamp:this.timestamp})}
 close(){this.closed=true}
}
class Encoder {
 static async isConfigSupported(){return {supported:true}}
 state='configured';encodeQueueSize=0
 constructor(private callbacks:{output:(chunk:{timestamp:number;type:string;byteLength:number;copyTo:(bytes:Uint8Array)=>void})=>void}){}
 configure(){}
 encode(frame:NativeFrame){this.callbacks.output({timestamp:frame.timestamp,type:'key',byteLength:4,copyTo:bytes=>bytes.set([1,2,3,4])})}
 async flush(){}
 close(){this.state='closed'}
}
class Reader {result='data:video/vp9;base64,AQIDBA==';onload?:()=>void;readAsDataURL(){this.onload?.()}}
interface RendererState {pull():{sourceEndSeconds:number;reason:string;done:boolean;error:string};cancel():Promise<void>}
async function initialize(video:Video,maxDurationMs=10000){
  const context=vm.createContext({document:{querySelectorAll:()=>[video]},HTMLVideoElement:Video,MediaRecorder:Recorder,VideoFrame:NativeFrame,VideoEncoder:Encoder,FileReader:Reader,Blob,MediaStream:class {},performance:{now:()=>video.position*1000},URL,location:{href:'https://example.com'},setTimeout,clearTimeout})
  const result=await vm.runInContext('('+videoElementCaptureInternals.initializeRenderer.toString()+')("fixture",'+JSON.stringify({selector:'video',index:0,fromStart:true,maxDurationMs,playbackPlan:[]})+')',context) as {ok:boolean;sourceStartSeconds:number}
  const state=context.fixture as RendererState
  assert.equal(result.ok,true);assert.equal(result.sourceStartSeconds,0);assert.equal(video.paused,false)
  return {state,result,context}
}

test('Video EOF evidence survives prior page replay handlers at 8, 15, 30 and 60 second endpoints and restores playback',async()=>{
  for(const duration of [8,15,30,60.046801]){
    const video=new Video(duration)
    video.addEventListener('ended',()=>{video.currentTime=0;void video.play()})
    const {state,context}=await initialize(video)
    video.advance(duration-.033);video.ended=true;video.emit('ended');await new Promise(resolve=>setTimeout(resolve,0))
    assert.equal(video.currentTime,0,'The page really reset its playback position')
    assert.deepEqual(JSON.parse(JSON.stringify(state.pull())),{chunks:[],videoPackets:[],pending:0,done:true,error:'',reason:'ended',sourceEndSeconds:duration,sourceDurationSeconds:duration,playbackEvents:[]})
    await state.cancel();assert.equal(context.fixture,undefined);assert.equal(video.currentTime,.03);assert.equal(video.paused,false);assert.equal(video.loop,true);assert.equal(video.playbackRate,.75);assert.equal(video.stopped,true);assert.equal(video.frames.size,0)
    assert.equal(video.listeners.get('ended')!.length,1);assert.equal(video.listeners.get('timeupdate')!.length,0);assert.equal(video.listeners.get('seeking')!.length,0)
  }
})

test('Synthetic EOF and premature trusted EOF cannot claim completion; limited captures retain measured progress',async()=>{
  const video=new Video(8),{state}=await initialize(video,20)
  video.advance(.7);video.emit('ended',false);assert.equal(state.pull().reason,'')
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(state.pull().reason,'maximum-duration');assert.equal(state.pull().sourceEndSeconds,.7);await state.cancel()
  const early=new Video(8),initialized=await initialize(early)
  early.advance(.7);early.ended=true;early.emit('ended');await new Promise(resolve=>setTimeout(resolve,0));assert.match(initialized.state.pull().error,/without observed progress/);assert.equal(initialized.state.pull().reason,'error');await initialized.state.cancel()
})

test('Seeking during capture fails instead of claiming continuous whole-video coverage',async()=>{
  const video=new Video(8),{state}=await initialize(video)
  video.advance(1);video.currentTime=7;await new Promise(resolve=>setTimeout(resolve,0));assert.match(state.pull().error,/position changed/);assert.equal(state.pull().reason,'error');await state.cancel()
})

test('Native source frames bind encoded file PTS, freeze updated duration and close every frame',async()=>{
 NativeFrame.instances=[]
 const video=new Video(8),{state}=await initialize(video)
 const tick=(time:number,counter:number)=>{const [id,callback]=[...video.frames][0]!;video.frames.delete(id);video.position=time;(callback as (now:number,metadata:{mediaTime:number;presentedFrames:number})=>void)(100000+counter*700,{mediaTime:time,presentedFrames:counter})}
 tick(0,1)
 for(let i=0;i<12;i++)tick(7.7+i*.025,i+2)
 const packets=(state.pull() as unknown as {videoPackets:{sourceTimestampSeconds:number;fileTimestampSeconds:number}[]}).videoPackets;assert.equal(packets.length,12);assert.equal(packets[0]!.sourceTimestampSeconds,0);assert.ok(packets.every(row=>Number.isFinite(row.fileTimestampSeconds)))
 assert.ok(NativeFrame.instances.filter(f=>!f.closed).length<=1)
 video.duration=8.046801;video.advance(video.duration);video.emit('ended');await new Promise(resolve=>setTimeout(resolve,0))
 assert.equal((state.pull() as unknown as {sourceDurationSeconds:number}).sourceDurationSeconds,8.046801)
 assert.equal(state.pull().sourceEndSeconds,8.046801)
 await state.cancel();assert.ok(NativeFrame.instances.every(f=>f.closed));assert.equal(video.frames.size,0)
})

test('Pre-initialization scope rejection drains without quarantining an inactive capture or retaining temporary files',async t=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{EventEmitter}=await import('node:events'),{VideoElementCapture}=await import('../src/video-element-capture.js')
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-capture-rejection-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 class Page extends EventEmitter {calls=0;isDestroyed(){return false}async executeJavaScript(){if(!this.calls++)throw new Error('Confirmed source range changed.');return undefined}}
 const page=new Page(),capture=new VideoElementCapture(page as unknown as ConstructorParameters<typeof VideoElementCapture>[0],root,{selector:'video'},{id:'fixture',title:'fixture',url:'https://example.com'})
 await assert.rejects(capture.run(),/Confirmed source range changed/)
 assert.equal(capture.cleanupFailed,false);assert.deepEqual(await fs.readdir(root),[])
})
