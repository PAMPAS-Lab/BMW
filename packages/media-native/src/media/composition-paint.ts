import {sceneVisuals,visualAtTime} from '../visual-segments.js'
import type { CompositionScene, MediaComposition } from '../composition-contract.js'
import { DEFAULT_VIDEO_OPTIONS } from '../video-options.js'
import {estimatedCaptionCues} from '../composition-contract.js'
export interface CompositionCanvasFrame {canvas:HTMLCanvasElement|OffscreenCanvas}
const font = '"PingFang SC", "Microsoft YaHei", sans-serif'
function lines(context:CanvasRenderingContext2D,text:string,width:number):string[]{const result:string[]=[];let line='';for(const character of text){if(context.measureText(line+character).width>width&&line){result.push(line);line=''}line+=character}if(line)result.push(line);return result}
/** A single responsive painter is used by Studio preview and MP4 export. */
export function paintScene(context:CanvasRenderingContext2D,scene:CompositionScene,frame:CompositionCanvasFrame|null,time:number,duration:number,index:number,total:number,narrationDuration:number,output?:Pick<MediaComposition,'width'|'height'|'style'|'watermark'>):void {
  const height=output?.height??720,width=output?.width??1280,W=720*width/height,H=720,margin=W<600?24:48
  const style=output?.style??'bmw-dark',light=style==='clean-light',minimal=style==='minimal'
  const ink=light?'#172536':'#ffffff',muted=light?'#65758b':'#7e90a9',accent=light?'#2369db':minimal?'#ffffff':'#a2f4d0'
  context.save();context.scale(height/720,height/720)
  const watermark=output?.watermark??DEFAULT_VIDEO_OPTIONS.watermark,headerOffset=watermark.enabled&&watermark.position.startsWith('top')?24:0
  const ease=1-Math.pow(1-Math.min(1,time/.8),3)
  if(light||minimal){context.fillStyle=light?'#f8fafc':'#111111'}else{const gradient=context.createLinearGradient(0,0,W,H);gradient.addColorStop(0,'#101827');gradient.addColorStop(1,'#181b36');context.fillStyle=gradient}
  context.fillRect(0,0,W,H)
  context.fillStyle=accent;context.font=`600 16px ${font}`;context.fillText(scene.label.toUpperCase(),margin,37+headerOffset)
  context.save();context.globalAlpha=ease;context.translate(0,18*(1-ease));context.fillStyle=ink
  const titleBase=W<600?28:42;context.font=`700 ${titleBase}px ${font}`
  if(W<600){
    const titleLines=lines(context,scene.title,W-margin*2)
    const displayed=titleLines.length>2?[titleLines[0],titleLines.slice(1).join('')]:titleLines
    displayed.forEach((line,row)=>{const measured=context.measureText(line).width;context.font=`700 ${Math.min(titleBase,titleBase*(W-margin*2)/Math.max(1,measured))}px ${font}`;context.fillText(line,margin,(displayed.length>1?77+row*30:91)+headerOffset);context.font=`700 ${titleBase}px ${font}`})
  }else{const titleSize=Math.min(titleBase,titleBase*(W-margin*2)/Math.max(1,context.measureText(scene.title).width));context.font=`700 ${titleSize}px ${font}`;context.fillText(scene.title,margin,91+headerOffset)}
  context.restore()
  const visual=visualAtTime(scene,time),framing=visual?.segment??scene
  if(frame){
    const area=scene.layout==='fullscreen'?{x:0,y:110+headerOffset,width:W,height:510-headerOffset}:{x:margin,y:122+headerOffset,width:W-margin*2,height:484-headerOffset}
    context.save();context.beginPath();context.roundRect(area.x,area.y,area.width,area.height,minimal?0:16);context.clip()
    context.fillStyle=light?'#e7edf5':'#232323';context.fillRect(area.x,area.y,area.width,area.height)
    context.globalAlpha=visual?.opacity??1
    const crop=framing.crop??{x:0,y:0,width:1,height:1},sourceWidth=frame.canvas.width*crop.width,sourceHeight=frame.canvas.height*crop.height
    const scale=Math.min(area.width/sourceWidth,area.height/sourceHeight)*(1+(framing.zoom-1)*Math.min(1,(visual?.localSeconds??time)/framing.durationSeconds)),drawWidth=sourceWidth*scale,drawHeight=sourceHeight*scale
    context.drawImage(frame.canvas,frame.canvas.width*crop.x,frame.canvas.height*crop.y,sourceWidth,sourceHeight,area.x+(area.width-drawWidth)/2,area.y+(area.height-drawHeight)/2,drawWidth,drawHeight)
    context.restore()
    if(!minimal){context.strokeStyle=light?'#2369db44':'#a2f4d044';context.lineWidth=2;context.beginPath();context.roundRect(area.x,area.y,area.width,area.height,16);context.stroke()}
  }else{
    context.save();context.globalAlpha=ease;context.fillStyle=accent;context.font=`800 ${W<600?80:110}px ${font}`;context.fillText(String(index+1).padStart(2,'0'),margin,265)
    context.fillStyle=ink
    let y=340
    for(const bullet of scene.bullets){context.font=`600 ${W<600?24:34}px ${font}`;for(const line of lines(context,bullet,W-margin*2).slice(0,2)){context.fillText(line,margin,y);y+=W<600?32:42}y+=12}
    context.restore()
  }
  // Estimated sentence captions follow measured audio; no word-alignment claim.
  const captionSize=scene.captionStyle?.fontSize??(W<600?22:28)
  const cues=scene.captions??estimatedCaptionCues(scene,width,height,narrationDuration)
  const caption=cues.find(cue=>time>=cue.startSeconds&&time<cue.endSeconds)?.text??''
  context.fillStyle=scene.captionStyle?.color??ink;context.font=`500 ${captionSize}px ${font}`
  const captionLines=lines(context,caption,W-margin*2).slice(0,scene.captionStyle?3:2),look=scene.captionStyle,lineHeight=look?captionSize*1.3:35
  const anchor=look?.position==='top'?80:look?.position==='center'?360-(captionLines.length-1)*lineHeight/2:644
  const baseline=Math.max(captionSize+8,Math.min(686-(captionLines.length-1)*lineHeight,anchor+(look?.offsetPercent??0)*7.2))
  captionLines.forEach((line,row)=>{
    const measured=context.measureText(line).width,x=look?.align==='left'?margin:look?.align==='right'?W-margin-measured:(W-measured)/2,y=baseline+row*lineHeight
    if(look?.background==='box'){context.save();context.fillStyle='#000000b3';context.fillRect(x-8,y-captionSize-4,measured+16,lineHeight+8);context.restore()}
    if(look?.background==='outline'){context.save();context.strokeStyle='#000000';context.lineJoin='round';context.lineWidth=Math.max(2,captionSize*.12);context.strokeText(line,x,y);context.restore()}
    context.fillText(line,x,y)
  })
  context.fillStyle=muted;context.font=`14px ${font}`
  const rightWatermark=watermark.enabled&&watermark.position==='bottom-right'
  const counter=`${String(index+1).padStart(2,'0')} / ${String(total).padStart(2,'0')}`
  context.fillText(counter,rightWatermark?margin:W-margin-context.measureText(counter).width,704)
  if(watermark.enabled){context.save();context.globalAlpha=watermark.opacity;context.fillStyle=muted;context.font=`${watermark.size}px ${font}`
    const maxWidth=W-margin*2,measured=context.measureText(watermark.text).width
    if(measured>maxWidth)context.font=`${watermark.size*maxWidth/measured}px ${font}`
    const x=watermark.position.endsWith('right')?W-margin-context.measureText(watermark.text).width:margin
    context.fillText(watermark.text,x,watermark.position.startsWith('top')?Math.max(18,watermark.size+4):704);context.restore()
  }
  if(!minimal){context.fillStyle=accent;context.fillRect(0,716,W*(index+Math.min(1,time/duration))/total,4)}
  context.restore()
}
