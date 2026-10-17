import {paintScience} from './science-paint.js'
import {LayerPackagingPainter} from './layer-packaging-paint.js'
import {revealedTextLines} from '../layer-text-treatment.js'
import {visualEffectFilter} from '../visual-effects.js'
import {EncodedPacketSink} from 'mediabunny'
import type {Input} from 'mediabunny'
import {activeVisualLayers,visualLayerBox} from '../composition-layers.js'
import type {LayerContainer,VisualLayer} from '../composition-layers.js'
import {MEDIA_LIMITS} from '../media-contract.js'
import {LinearFrameReader,normalizeBrowserVideoColor,indexedFrameStart} from './linear-frames.js'
import {COMPOSITION_FONT,fitText} from './composition-text.js'

export interface LayerAsset {data:Uint8Array;input?:Input;image?:HTMLCanvasElement}
type Reader={reader:LinearFrameReader;time:number;artifactId:string}
/** Bounded deterministic overlays, shared by Studio playback and native export. */
export class CompositionLayerPainter {
 private packaging=new LayerPackagingPainter()
 private readers=new Map<string,Reader>()
 private verified=new Set<string>()
 constructor(private assets:Map<string,LayerAsset>){}
 private async video(layer:VisualLayer,time:number):Promise<HTMLCanvasElement|OffscreenCanvas>{
  const artifactId=layer.artifactId!,target=(layer.sourceStartSeconds??0)+time*(layer.playbackRate??1)
  let current=this.readers.get(layer.id)
  if(current&&(target<current.time||current.artifactId!==artifactId)){await current.reader.close();this.readers.delete(layer.id);current=undefined}
  if(!current){
   const track=await this.assets.get(artifactId)?.input?.getPrimaryVideoTrack()
   if(!track||!await track.canDecode())throw new Error(`图层 ${layer.title} 没有可解码的视频。`)
   const width=await track.getDisplayWidth(),height=await track.getDisplayHeight()
   if(width*height>MEDIA_LIMITS.sourcePixels)throw new Error(`图层 ${layer.title} 超过视频解码尺寸限制。`)
   const end=await track.computeDuration(),first=await track.getFirstTimestamp(),sourceStart=layer.sourceStartSeconds??0
   if(!Number.isFinite(end)||end<=0||end>MEDIA_LIMITS.durationSeconds||sourceStart<first||sourceStart+layer.durationSeconds*(layer.playbackRate??1)>end+.001)throw new Error(`图层 ${layer.title} 的源区间超过实际视频范围。`)
   if(!this.verified.has(artifactId)){
    if(await track.canBeTransparent())for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true}))if((packet.sideData.alphaByteLength??0)>0)throw new Error('Transparent overlay footage is not supported.')
    await normalizeBrowserVideoColor(track);this.verified.add(artifactId)
   }
   current={reader:new LinearFrameReader(track,{width:Math.min(width,1600)},await indexedFrameStart(this.assets.get(artifactId)!.input!,target)),time:-1,artifactId};this.readers.set(layer.id,current)
  }
  const frame=await current.reader.get(target);current.time=target
  if(!frame)throw new Error(`图层 ${layer.title} 的视频帧不可用。`)
  return frame.canvas
 }
 async paint(context:CanvasRenderingContext2D,global:LayerContainer,scene:LayerContainer,time:number,local:number):Promise<void>{
  const active=activeVisualLayers(global,scene,time,local),ids=new Set(active.filter(item=>item.layer.kind==='video').map(item=>item.layer.id))
  for(const [id,current]of this.readers)if(!ids.has(id)){await current.reader.close();this.readers.delete(id)}
  for(const item of active){
   const layer=item.layer,box=visualLayerBox(layer,item.local),W=context.canvas.width,H=context.canvas.height,x=box.x*W,y=box.y*H,w=box.width*W,h=box.height*H
   // Keep decoding a faded video on its clock so later frames do not replay from zero.
   const media=layer.kind==='video'?await this.video(layer,item.local):layer.kind==='image'?this.assets.get(layer.artifactId!)?.image:undefined
   if((layer.kind==='image'||layer.kind==='video')&&!media)throw new Error(`图层 ${layer.title} 的媒体不可用。`)
   const draw=(context:CanvasRenderingContext2D,x:number,y:number,opacity=box.opacity)=>{context.save()
   try{
    context.filter=visualEffectFilter(layer.effects);context.globalAlpha=opacity;context.fillStyle=layer.color
    if(layer.kind==='rectangle')context.fillRect(x,y,w,h)
    else if(layer.kind==='diagram')paintScience(context,layer.science!,item.local,{x,y,width:w,height:h},W,H)
    else if(layer.kind==='text'){
     const scale=H/720,size=layer.fontSize??32
     context.scale(scale,scale)
     const stroke=layer.textTreatment?.strokeWidth??0,inset=stroke/2
     const fit=fitText(context,layer.text??'',w/scale-stroke,Math.max(1,Math.floor((h/scale-stroke)/(12*1.3))),size,h/scale-stroke)
     if(fit.overflow)throw new Error(`STUDIO_TEXT_LAYOUT: 图层 ${layer.title} 的文字放不下，请调整内容或大小。`)
     context.font=`600 ${fit.size}px ${COMPOSITION_FONT}`;context.textBaseline='top';context.textAlign='left'
     context.lineJoin='round';context.lineWidth=stroke;context.strokeStyle=layer.textTreatment?.strokeColor??'#000000'
     revealedTextLines(fit.lines,layer.textTreatment,item.local).forEach((text,index)=>{const tx=x/scale+inset,ty=y/scale+inset+index*fit.size*1.3;if(stroke)context.strokeText(text,tx,ty);context.fillText(text,tx,ty)})
    }else if(media){
     const crop=layer.sourceCrop??{x:0,y:0,width:1,height:1},sourceWidth=media.width*crop.width,sourceHeight=media.height*crop.height,ratio=Math.min(w/sourceWidth,h/sourceHeight)
     context.drawImage(media,media.width*crop.x,media.height*crop.y,sourceWidth,sourceHeight,x+(w-sourceWidth*ratio)/2,y+(h-sourceHeight*ratio)/2,sourceWidth*ratio,sourceHeight*ratio)
    }
   }finally{context.restore()}}
   if(!this.packaging.paint(context,{x,y,width:w,height:h,opacity:box.opacity},layer.packaging,item.local,(out,px,py)=>draw(out,px,py,1)))draw(context,x,y)
  }
 }
 async dispose():Promise<void>{this.packaging.dispose();const readers=[...this.readers.values()];this.readers.clear();this.verified.clear();await Promise.all(readers.map(value=>value.reader.close()))}
}
