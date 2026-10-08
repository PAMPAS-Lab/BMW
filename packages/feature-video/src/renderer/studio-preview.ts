import {studioLayer} from '../studio-layer-edits.js'
import type {StudioLayerSelection} from '../studio-layer-edits.js'
import type {VisualLayer} from '../../../media-native/src/composition-layers.js'
import {CompositionLayerPainter} from '../../../media-native/src/media/composition-layers-paint.js'
import {assertLayerComposition} from '../../../media-native/src/composition-layers.js'
import {sourceCaptionsStale} from '../studio-source-speech-contract.js'
import {visualAtTime} from '../../../media-native/src/visual-segments.js'
import {decodeProjectImage} from '../../../media-native/src/media/image-decoder.js'
import {ImageDecodeBudget,DECODE_BUDGET} from '../../../media-native/src/image-contract.js'
import {Input,BlobSource,ALL_FORMATS} from 'mediabunny'
import {LinearFrameReader,normalizeBrowserVideoColor} from '../../../media-native/src/media/linear-frames.js'
import {assertCompositionText,paintScene} from '../../../media-native/src/media/composition-paint.js'
import type {CompositionTextBox} from '../../../media-native/src/media/composition-paint.js'
import {mixCompositionAudio} from '../../../media-native/src/media/composition-audio.js'
import {compositionDuration,sceneAtTime,compositionAssets,compositionImageIds} from '../../../media-native/src/composition-contract.js'
import type {MediaComposition} from '../../../media-native/src/composition-contract.js'
import {speechScene,usesStudioSpeech} from '../studio-speech-contract.js'
import {sceneCoverage,sameStudioDraftContent} from '../studio-contract.js'
import type {VideoDraft,StudioAsset} from '../studio-contract.js'

export interface StudioBridge {
  state():Promise<unknown>;command(projectId:string,request:unknown):Promise<unknown>
  read(projectId:string,artifactId:string,offset:number,length:number):Promise<Uint8Array>
  importAsset(projectId:string):Promise<unknown>;cancel():Promise<unknown>;assistant(request?:unknown):Promise<unknown>
  geometry(value:unknown):Promise<unknown>;onChat(listener:(value:unknown)=>void):void
  chat(value:unknown):Promise<unknown>;view(value:unknown):Promise<unknown>;prefill(text:string):Promise<unknown>;cancelTask():Promise<unknown>
  onTask(listener:(value:unknown)=>void):void
  selection(value:unknown):Promise<unknown>;leave():Promise<unknown>
  onChange(listener:(value:unknown)=>void):void;onProgress(listener:(value:unknown)=>void):void
}
declare global{interface Window{bmwStudio:StudioBridge;bmwStudioFlush?:()=>Promise<void>}}
type Asset={data:Uint8Array;input?:Input;image?:HTMLCanvasElement}
/** One serialized decoder; audio time is the preview clock, matching the export mix. */
export class StudioPreview {
  private paintedText?:{draftId:string;revision:number;sceneId:string;boxes:CompositionTextBox[]}
  /** Only the currently rendered revision can admit an on-canvas text edit. */
  text(draft:VideoDraft):{sceneId:string;boxes:CompositionTextBox[]}|undefined {const painted=this.paintedText;return painted&&painted.draftId===draft.id&&painted.revision===draft.revision?{sceneId:painted.sceneId,boxes:painted.boxes}:undefined}
  private layers?:CompositionLayerPainter
  private preparedOwner?:{draftId:string;revision:number;sceneIds:string[]}
  private visualOverride?:{sceneIndex:number;id:string;layer:VisualLayer}
  private visualRequest=0
  private visualRender?:Promise<void>
  private assets=new Map<string,Asset>();private composition?:MediaComposition
  private audio?:AudioContext;private mixed?:AudioBuffer;private voiceDurations:number[]=[]
  private source?:AudioBufferSourceNode;private startedAt=0;private position=0
  private reader?:LinearFrameReader;private readerScene=-1;private readerTime=-1
  private queue:Promise<void>=Promise.resolve();private playing=false;private generation=0
  private lifecycle:Promise<void>=Promise.resolve()
  private tickTimer?:ReturnType<typeof setTimeout>;private playbackGeneration=0
  constructor(private canvas:HTMLCanvasElement,private load:(id:string)=>Promise<Uint8Array>,private onTime:(time:number,playing:boolean)=>void){}
  prepare(draft:VideoDraft,position=0):Promise<boolean>{
    const generation=this.invalidate()
    const operation=this.lifecycle.catch(()=>{}).then(async()=>{
      await this.release()
      if(generation!==this.generation)return false
      return this.prepareCurrent(draft,position,generation)
    })
    this.lifecycle=operation.then(()=>{},()=>{})
    return operation
  }
  /** Advance only a journal revision of the exact prepared content and assets.
   * Pending input/gestures are excluded by the controller before calling this. */
  advanceRevision(previous:VideoDraft,next:VideoDraft,oldAssets:StudioAsset[],newAssets:StudioAsset[]):boolean {
    const owner=this.preparedOwner
    if(!owner||!this.composition||owner.draftId!==previous.id||owner.revision!==previous.revision||this.visualOverride||this.visualRender||!sameStudioDraftContent(previous,next))return false
    for(const id of this.assets.keys()){
      const before=oldAssets.find(a=>a.artifactId===id),after=newAssets.find(a=>a.artifactId===id)
      if(!before||!after||before.bytes!==after.bytes||before.modifiedAt!==after.modifiedAt)return false
    }
    owner.revision=next.revision
    if(this.paintedText)this.paintedText.revision=next.revision
    return true
  }
  private async prepareCurrent(draft:VideoDraft,position:number,generation:number):Promise<boolean>{
    this.preparedOwner={draftId:draft.id,revision:draft.revision,sceneIds:draft.scenes.map(scene=>scene.id)}
    this.composition={title:draft.title,width:draft.width,height:draft.height,fps:draft.fps,music:draft.music,style:draft.style,watermark:draft.watermark,layers:draft.layers,audioTracks:draft.audioTracks,scenes:draft.scenes.map(scene=>({...speechScene(scene),audioArtifactId:!sceneCoverage(scene,draft.tts).audioStale?scene.audioArtifactId:undefined}))}
    const composition=this.composition
    let bytes=0;const imageBudget=new ImageDecodeBudget(),imageIds=compositionImageIds(composition)
    try{
      assertLayerComposition(composition)
      const ids=compositionAssets(composition)
      for(const id of ids){const data=await this.load(id);bytes+=data.length;if(bytes>DECODE_BUDGET.assetBytes)throw new Error('Preview assets exceed 256 MiB.');if(generation!==this.generation)return false
        const asset:Asset={data};if(imageIds.has(id)){
          asset.image=(await decodeProjectImage(data,imageBudget)).image
        }else asset.input=new Input({source:new BlobSource(new Blob([data as Uint8Array<ArrayBuffer>])),formats:ALL_FORMATS})
        if(generation!==this.generation){asset.input?.dispose();if(asset.image){asset.image.width=0;asset.image.height=0}return false}
        this.assets.set(id,asset)
      }
      for(const scene of draft.scenes)if(scene.sourceCaptionBinding){const binding=scene.sourceCaptionBinding,data=this.assets.get(binding.sourceArtifactId)?.data;if(sourceCaptionsStale(scene)||!data)throw new Error('STUDIO_SOURCE_SPEECH_STALE: 原声字幕需要重新应用。');const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data as Uint8Array<ArrayBuffer>)),byte=>byte.toString(16).padStart(2,'0')).join('');if(sha!==binding.sourceSha256)throw new Error('STUDIO_SOURCE_SPEECH_STALE: 原视频文件已变化。')}
      const hashes=new Map<string,string>()
      for(const scene of draft.scenes)if(usesStudioSpeech(scene)){
        const binding=scene.speechAnchors!,data=this.assets.get(binding.audioArtifactId)?.data;if(!data||sceneCoverage(scene,draft.tts).audioStale)throw new Error('STUDIO_SPEECH_STALE: 锚点旁白已过期。')
        let actual=hashes.get(binding.audioArtifactId);if(!actual){actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data as Uint8Array<ArrayBuffer>)),byte=>byte.toString(16).padStart(2,'0')).join('');hashes.set(binding.audioArtifactId,actual)}
        if(actual!==binding.audioSha256)throw new Error('STUDIO_SPEECH_STALE: 旁白文件已变化，请重新校正。')
      }
      if(generation!==this.generation)return false
      this.layers=new CompositionLayerPainter(this.assets)
      this.audio=new AudioContext({sampleRate:48000});const mix=await mixCompositionAudio(composition,this.assets,this.audio)
      if(generation!==this.generation)return false
      this.mixed=mix.mixed;this.voiceDurations=mix.narrationDurations;this.canvas.width=draft.width;this.canvas.height=draft.height
      assertCompositionText(this.canvas.getContext('2d')!,composition,this.voiceDurations)
      await this.seek(position)
      return generation===this.generation
    }catch(error){await this.release();if(generation!==this.generation)return false;throw error}
  }
  /** GUI-only transform preview. Reuses decoded assets/audio and the export painter. */
  async visualEdit(draft?:VideoDraft,ref?:StudioLayerSelection):Promise<void>{
    if(draft){
      const owner=this.preparedOwner,composition=this.composition
      if(!owner||!composition||owner.draftId!==draft.id||owner.revision!==draft.revision||ref?.kind!=='visual'||this.playing)throw new Error('预览已变化，请更新预览后再拖动。')
      const sceneIndex=ref.sceneId?owner.sceneIds.indexOf(ref.sceneId):-1
      if(ref.sceneId&&sceneIndex<0)throw new Error('预览中的镜头已变化。')
      const previous=(sceneIndex<0?composition.layers:composition.scenes[sceneIndex].layers)?.find(layer=>layer.id===ref.id),next=studioLayer(draft,ref) as VisualLayer
      if(!previous)throw new Error('预览中的对象已变化。')
      // Only geometry may differ. A transient edit cannot replace sources, timing,
      // opacity, keyframe clocks or text without rebuilding the prepared draft.
      const identity=(layer:VisualLayer)=>{const {x,y,width,height,keyframes,...rest}=layer;return {...rest,keyframes:keyframes?.map(({x,y,width,height,...frame})=>frame)}}
      if(JSON.stringify(identity(previous))!==JSON.stringify(identity(next)))throw new Error('拖动预览只能改变对象位置和尺寸。')
      const override={sceneIndex,id:ref.id,layer:structuredClone(next)}
      assertLayerComposition(this.withVisualOverride(composition,override));this.visualOverride=override
    }else this.visualOverride=undefined
    this.visualRequest++
    if(!this.composition)return
    // Keep one in-flight draw and one latest state, rather than queueing every
    // pointer event behind media decoding. Cancellation clears that latest state.
    if(!this.visualRender){
      const operation=(async()=>{let rendered=-1;while(rendered!==this.visualRequest&&this.composition){rendered=this.visualRequest;await this.draw(this.position)}})()
      this.visualRender=operation
      void operation.finally(()=>{if(this.visualRender===operation)this.visualRender=undefined}).catch(()=>{})
    }
    await this.visualRender
  }
  private withVisualOverride(composition:MediaComposition,override=this.visualOverride):MediaComposition{
    if(!override)return composition
    const replace=(layers:VisualLayer[]|undefined)=>layers?.map(layer=>layer.id===override.id?override.layer:layer)
    return override.sceneIndex<0?{...composition,layers:replace(composition.layers)}:{...composition,scenes:composition.scenes.map((scene,index)=>index===override.sceneIndex?{...scene,layers:replace(scene.layers)}:scene)}
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
    this.paintedText=undefined
    const boxes:CompositionTextBox[]=[],context=this.canvas.getContext('2d',{alpha:false})!;context.save();paintScene(context,scene,frame,timing.localSeconds,scene.durationSeconds,timing.index,this.composition.scenes.length,this.voiceDurations[timing.index]??0,this.composition,box=>boxes.push(box));context.restore()
    const visible=this.withVisualOverride(this.composition);await this.layers?.paint(context,visible,visible.scenes[timing.index],time,timing.localSeconds)
    const owner=this.preparedOwner;if(generation===this.generation&&owner)this.paintedText={draftId:owner.draftId,revision:owner.revision,sceneId:owner.sceneIds[timing.index],boxes}
  });return this.queue}
  private clearSurface():void{this.canvas.getContext('2d')?.clearRect(0,0,this.canvas.width,this.canvas.height)}
  private invalidate():number{
    const generation=++this.generation
    this.preparedOwner=undefined;this.paintedText=undefined;this.visualOverride=undefined;this.visualRequest++
    this.pause();this.composition=undefined;this.position=0;this.clearSurface();this.onTime(0,false)
    return generation
  }
  dispose():Promise<void>{
    this.invalidate()
    const operation=this.lifecycle.catch(()=>{}).then(()=>this.release())
    this.lifecycle=operation.catch(()=>{})
    return operation
  }
  private async release():Promise<void>{
    await this.queue.catch(()=>{});await this.visualRender?.catch(()=>{})
    await this.reader?.close();this.reader=undefined;this.readerScene=-1;this.readerTime=-1
    await this.layers?.dispose();this.layers=undefined
    this.assets.forEach(asset=>{asset.input?.dispose();if(asset.image){asset.image.width=0;asset.image.height=0}});this.assets.clear()
    await this.audio?.close();this.audio=undefined;this.composition=undefined;this.mixed=undefined;this.position=0;this.voiceDurations=[]
    this.clearSurface()
  }
}
