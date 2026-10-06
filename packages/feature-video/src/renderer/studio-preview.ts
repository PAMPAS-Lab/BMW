import {sourceCaptionsStale} from '../studio-source-speech-contract.js'
import {sceneVisuals,visualAtTime} from '../../../media-native/src/visual-segments.js'
import {decodeProjectImage} from '../../../media-native/src/media/image-decoder.js'
import {ImageDecodeBudget,DECODE_BUDGET} from '../../../media-native/src/image-contract.js'
import {Input,BlobSource,ALL_FORMATS} from 'mediabunny'
import {LinearFrameReader,normalizeBrowserVideoColor} from '../../../media-native/src/media/linear-frames.js'
import {assertCompositionText,paintScene} from '../../../media-native/src/media/composition-paint.js'
import {mixCompositionAudio} from '../../../media-native/src/media/composition-audio.js'
import {compositionDuration,sceneAtTime} from '../../../media-native/src/composition-contract.js'
import type {MediaComposition} from '../../../media-native/src/composition-contract.js'
import {speechScene,usesStudioSpeech} from '../studio-speech-contract.js'
import {sceneCoverage} from '../studio-contract.js'
import type {VideoDraft} from '../studio-contract.js'

export interface StudioBridge {
  state():Promise<unknown>;command(projectId:string,request:unknown):Promise<unknown>
  read(projectId:string,artifactId:string,offset:number,length:number):Promise<Uint8Array>
  importAsset(projectId:string):Promise<unknown>;cancel():Promise<unknown>;assistant(request?:unknown):Promise<unknown>
  selection(value:unknown):Promise<unknown>;leave():Promise<unknown>
  onChange(listener:(value:unknown)=>void):void;onProgress(listener:(value:unknown)=>void):void
}
declare global{interface Window{bmwStudio:StudioBridge;bmwStudioFlush?:()=>Promise<void>}}
type Asset={data:Uint8Array;input?:Input;image?:HTMLCanvasElement}
/** One serialized decoder; audio time is the preview clock, matching the export mix. */
export class StudioPreview {
  private assets=new Map<string,Asset>();private composition?:MediaComposition
  private audio?:AudioContext;private mixed?:AudioBuffer;private voiceDurations:number[]=[]
  private source?:AudioBufferSourceNode;private startedAt=0;private position=0
  private reader?:LinearFrameReader;private readerScene=-1;private readerTime=-1
  private queue:Promise<void>=Promise.resolve();private playing=false;private generation=0
  private tickTimer?:ReturnType<typeof setTimeout>;private playbackGeneration=0
  constructor(private canvas:HTMLCanvasElement,private load:(id:string)=>Promise<Uint8Array>,private onTime:(time:number,playing:boolean)=>void){}
  async prepare(draft:VideoDraft,position=0):Promise<void>{
    await this.dispose();const generation=++this.generation
    this.composition={title:draft.title,width:draft.width,height:draft.height,fps:draft.fps,music:draft.music,style:draft.style,watermark:draft.watermark,scenes:draft.scenes.map(scene=>({...speechScene(scene),audioArtifactId:!sceneCoverage(scene,draft.tts).audioStale?scene.audioArtifactId:undefined}))}
    let bytes=0;const imageBudget=new ImageDecodeBudget()
    try{
      const ids=new Set(this.composition.scenes.flatMap(scene=>[...sceneVisuals(scene).flatMap(segment=>[segment.videoArtifactId,segment.imageArtifactId]),scene.audioArtifactId].filter((id):id is string=>Boolean(id))))
      for(const id of ids){const data=await this.load(id);bytes+=data.length;if(bytes>DECODE_BUDGET.assetBytes)throw new Error('Preview assets exceed 256 MiB.');if(generation!==this.generation)return
        const asset:Asset={data};if(this.composition.scenes.some(scene=>sceneVisuals(scene).some(segment=>segment.imageArtifactId===id))){
          asset.image=(await decodeProjectImage(data,imageBudget)).image
        }else asset.input=new Input({source:new BlobSource(new Blob([data as Uint8Array<ArrayBuffer>])),formats:ALL_FORMATS})
        if(generation!==this.generation){asset.input?.dispose();if(asset.image){asset.image.width=0;asset.image.height=0}return}
        this.assets.set(id,asset)
      }
      for(const scene of draft.scenes)if(scene.sourceCaptionBinding){const binding=scene.sourceCaptionBinding,data=this.assets.get(binding.sourceArtifactId)?.data;if(sourceCaptionsStale(scene)||!data)throw new Error('STUDIO_SOURCE_SPEECH_STALE: 原声字幕需要重新应用。');const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data as Uint8Array<ArrayBuffer>)),byte=>byte.toString(16).padStart(2,'0')).join('');if(sha!==binding.sourceSha256)throw new Error('STUDIO_SOURCE_SPEECH_STALE: 原视频文件已变化。')}
      const hashes=new Map<string,string>()
      for(const scene of draft.scenes)if(usesStudioSpeech(scene)){
        const binding=scene.speechAnchors!,data=this.assets.get(binding.audioArtifactId)?.data;if(!data||sceneCoverage(scene,draft.tts).audioStale)throw new Error('STUDIO_SPEECH_STALE: 锚点旁白已过期。')
        let actual=hashes.get(binding.audioArtifactId);if(!actual){actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data as Uint8Array<ArrayBuffer>)),byte=>byte.toString(16).padStart(2,'0')).join('');hashes.set(binding.audioArtifactId,actual)}
        if(actual!==binding.audioSha256)throw new Error('STUDIO_SPEECH_STALE: 旁白文件已变化，请重新校正。')
      }
      if(generation!==this.generation)return
      this.audio=new AudioContext({sampleRate:48000});const mix=await mixCompositionAudio(this.composition,this.assets,this.audio)
      this.mixed=mix.mixed;this.voiceDurations=mix.narrationDurations;this.canvas.width=draft.width;this.canvas.height=draft.height
      assertCompositionText(this.canvas.getContext('2d')!,this.composition,this.voiceDurations)
      await this.seek(position)
    }catch(error){await this.dispose();throw error}
  }
  async seek(time:number):Promise<void>{this.pause();this.position=Math.max(0,Math.min(time,this.duration-.001));const position=this.position,generation=this.generation;await this.draw(position);if(generation===this.generation&&position===this.position&&!this.playing)this.onTime(position,false)}
  get duration():number{return this.composition?compositionDuration(this.composition):0}
  pause():void{
    clearTimeout(this.tickTimer);this.tickTimer=undefined;this.playbackGeneration++
    if(this.playing&&this.audio)this.position=Math.min(this.duration,this.audio.currentTime-this.startedAt)
    this.playing=false;this.source?.stop();this.source=undefined;this.onTime(this.position,false)
  }
  async play():Promise<void>{
    if(!this.audio||!this.mixed)return
    if(this.playing){this.pause();return}
    if(this.position>=this.duration-.02)this.position=0
    const audio=this.audio,playback=++this.playbackGeneration,generation=this.generation
    await audio.resume()
    if(playback!==this.playbackGeneration||generation!==this.generation||audio!==this.audio)return
    this.source=audio.createBufferSource();this.source.buffer=this.mixed;this.source.connect(audio.destination)
    this.source.start(0,this.position);this.startedAt=audio.currentTime-this.position;this.playing=true
    const current=()=>this.playing&&generation===this.generation&&playback===this.playbackGeneration
    const failed=(error:unknown)=>{if(current())this.pause();console.error(error)}
    const tick=async()=>{
      if(!current())return
      this.position=Math.min(this.duration,audio.currentTime-this.startedAt)
      await this.draw(this.position)
      if(!current())return
      this.onTime(this.position,true)
      if(this.position>=this.duration-.005){this.pause();return}
      // Covered native Views can stop compositor frames while audio keeps running.
      // The bounded frame-rate timer samples the audio clock and is cancelled on pause.
      this.tickTimer=setTimeout(()=>{this.tickTimer=undefined;void tick().catch(failed)},1000/Math.min(this.composition!.fps,60))
    }
    void tick().catch(failed)
  }
  private draw(time:number):Promise<void>{const generation=this.generation;this.queue=this.queue.catch(()=>{}).then(async()=>{
    if(!this.composition||generation!==this.generation)return
    const timing=sceneAtTime(this.composition,time),scene=this.composition.scenes[timing.index],visual=visualAtTime(scene,timing.localSeconds),segment=visual?.segment??scene,visualKey=timing.index*8+(visual?.index??0),target=segment.sourceStartSeconds+(visual?.localSeconds??timing.localSeconds)*segment.playbackRate
    if(this.readerScene!==visualKey||target<this.readerTime){await this.reader?.close();this.reader=undefined;this.readerScene=visualKey;this.readerTime=-1}
    if(segment.videoArtifactId&&!this.reader){const track=await this.assets.get(segment.videoArtifactId)?.input?.getPrimaryVideoTrack();if(!track||!await track.canDecode())throw new Error('Footage cannot be decoded.');if(await track.getDisplayWidth()*await track.getDisplayHeight()>16_777_216)throw new Error('Video exceeds decode limit.');await normalizeBrowserVideoColor(track);this.reader=new LinearFrameReader(track,{width:1600})}
    const frame=segment.imageArtifactId?{canvas:this.assets.get(segment.imageArtifactId)!.image!}:this.reader?await this.reader.get(target):null;this.readerTime=target
    if(generation!==this.generation)return
    const context=this.canvas.getContext('2d',{alpha:false})!;context.save();paintScene(context,scene,frame,timing.localSeconds,scene.durationSeconds,timing.index,this.composition.scenes.length,this.voiceDurations[timing.index]??0,this.composition);context.restore()
  });return this.queue}
  async dispose():Promise<void>{this.generation++;this.pause();await this.queue.catch(()=>{});await this.reader?.close();this.reader=undefined;this.readerScene=-1;this.readerTime=-1;this.assets.forEach(asset=>{asset.input?.dispose();if(asset.image){asset.image.width=0;asset.image.height=0}});this.assets.clear();await this.audio?.close();this.audio=undefined;this.composition=undefined;this.mixed=undefined;this.position=0}
}
