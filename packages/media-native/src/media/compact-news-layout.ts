import type {CompositionScene,MediaComposition} from '../composition-contract.js'
import {estimatedCaptionCues} from '../composition-contract.js'
import {focusFraming} from '../focus-contract.js'
import {visualAtTime,visualZoom} from '../visual-segments.js'
import {visualEffectFilter} from '../visual-effects.js'
import {withCanvasPaintRole} from './canvas-paint-role.js'
export const COMPACT_NEWS_FONT='"PingFang SC", "Microsoft YaHei", sans-serif'
export interface CompactMeasure {font:string;measureText(text:string):{width:number}}
export interface CompactBlock {lines:string[];size:number;overflow:boolean}
const measuredBlocks=new WeakMap<CompactMeasure,Map<string,CompactBlock>>()
/** Fixed font, bounded rows, intact Latin tokens; never truncate or shrink to hide overflow. */
export function compactText(context:CompactMeasure,text:string,size:number,rows:number,width=640):CompactBlock {
 const old=context.font;context.font=`500 ${size}px ${COMPACT_NEWS_FONT}`
 try{
  const cache=measuredBlocks.get(context)??new Map<string,CompactBlock>();measuredBlocks.set(context,cache)
  const key=JSON.stringify([size,rows,width,text,context.measureText('BMW中文').width]),saved=cache.get(key)
  if(saved)return {...saved,lines:[...saved.lines]}
  const result:string[]=[]
  for(const paragraph of text.split(/\r?\n/)){
   const tokens=paragraph.match(/[A-Za-z][A-Za-z0-9'’.-]*|\d+(?:[.,]\d+)*|[\s\S]/gu)??[];let line=''
   for(const token of tokens){if(line&&context.measureText(line+token).width>width){if(/^[，。！？；：、）】》”’]$/.test(token)){const chars=Array.from(line),tail=chars.pop()!;result.push(chars.join('').trim());line=tail+token}else{result.push(line.trim());line=token.trimStart()}}else line+=token}
   if(line.trim())result.push(line.trim())
  }
  // Balance a two-line cue, preferring a clause boundary and avoiding an orphan.
  if(result.length===2&&!text.includes('\n')){
   const tokens=text.match(/[A-Za-z][A-Za-z0-9'’.-]*|\d+(?:[.,]\d+)*|[\s\S]/gu)??[];let best=Infinity
   for(let at=1;at<tokens.length;at++){const a=tokens.slice(0,at).join('').trim(),b=tokens.slice(at).join('').trim(),aw=context.measureText(a).width,bw=context.measureText(b).width;if(!a||!b||aw>width||bw>width||/^[，。！？；：、）】》”’]/.test(b)||/[（【《“‘]$/.test(a))continue;const score=Math.abs(aw-bw)+(Array.from(b).length<4?width:0)-(/[，。！？；：,;!?]$/.test(a)?width*.25:0);if(score<best){best=score;result[0]=a;result[1]=b}}
  }
  const block={lines:result,size,overflow:result.length>rows||result.some(line=>context.measureText(line).width>width)}
  if(cache.size>=512)cache.clear();cache.set(key,block);return {...block,lines:[...block.lines]}
 }finally{context.font=old}
}
export function compactGeometry(aspect=16/9){
 if(!Number.isFinite(aspect)||aspect<1)throw new Error('STUDIO_COMPACT_MEDIA: 紧凑新闻需要横屏视频；竖屏素材请选择对应版式。')
 const width=Math.min(640,480*aspect),height=width/aspect,media={x:(720-width)/2,y:332,width,height},captionY=media.y+height+24,englishY=captionY+112+20,footerY=englishY+84+22
 return {media,captionY,englishY,footerY,gap:24,safeBottom:1152}
}
export function compactCue(context:CompactMeasure,cue:NonNullable<CompositionScene['captions']>[number],display:CompositionScene['captionDisplay']){
 const translated=Boolean(cue.translationText?.trim()),chinese=display==='original'?cue.text:translated?cue.translationText!:display==='translation'?'':cue.text,english=translated&&display!=='translation'&&display!=='original'?cue.text:''
 return {chinese:compactText(context,chinese,42,2),english:compactText(context,english,30,2)}
}
/** Native diagrams occupy only the same picture slot; no caption/title overlays. */
export function compactDiagramScene(scene:CompositionScene):boolean {
 if(scene.videoArtifactId||scene.imageArtifactId||scene.visualSegments?.length||!scene.label.includes('机制图解'))return false
 const layers=(scene.layers??[]).filter(l=>!l.hidden&&l.opacity>0),diagrams=layers.filter(l=>l.kind==='diagram'&&l.science&&l.startSeconds===0&&l.durationSeconds>=scene.durationSeconds&&l.width*l.height>=.2),box=compactGeometry().media
 if(diagrams.length!==1||layers.some(l=>!['diagram','rectangle','text'].includes(l.kind)))return false
 return layers.every(l=>[l,...(l.keyframes??[])].every(k=>{const x='x'in k?k.x:l.x,y='y'in k?k.y:l.y,width='width'in k?k.width:l.width,height='height'in k?k.height:l.height;return x*720>=box.x-1&&y*1280>=box.y-1&&(x+width)*720<=box.x+box.width+1&&(y+height)*1280<=box.y+box.height+1}))
}
export function compactSceneIssues(context:CompactMeasure,scene:CompositionScene,title:string,narrationDuration:number):string[]{
 const issues:string[]=[],label=scene.label.split(/[｜|\n]/),head=label.shift()??'',footer=label.join(' · ')
 if(compactText(context,title,48,2).overflow)issues.push('标题最多2行/48px，请缩短标题。')
 if(compactText(context,head,30,1).overflow||compactText(context,footer,30,2).overflow)issues.push('来源标识或日期超出固定区域；用 label 的｜分隔标识与来源日期。')
 const nativeDiagram=compactDiagramScene(scene)
 if(scene.cardSpec||scene.sceneTemplate||scene.bullets.length||!nativeDiagram&&scene.layers?.some(l=>!l.hidden&&l.opacity>0))issues.push('紧凑模板自带标题/来源/字幕区；请移除手工卡片和可见叠层，避免覆盖保留区域。')
 if(!nativeDiagram&&!scene.videoArtifactId&&(!scene.visualSegments?.length||scene.visualSegments.some(v=>!v.videoArtifactId)))issues.push('紧凑新闻需要实际横屏主视频，或符合原生图解约束的末镜。图解所有可见对象/关键帧须在720×1280画布x40–680、y332–692区域内，至少一个diagram覆盖20%画布；字幕/来源区不可叠层。')
 for(const [index,cue]of(scene.captions??estimatedCaptionCues(scene,720,1280,narrationDuration)).entries()){
  const blocks=compactCue(context,cue,scene.captionDisplay)
  if(blocks.chinese.overflow||blocks.english.overflow)issues.push(`字幕${index+1}需按语义和真实句界拆cue：中文42px最多2行，英文30px最多2行，宽640px；保留完整文字，不缩字或隐藏。`)
 }
 return issues
}
/** Preview and export share this exact primary-picture/caption geometry. */
export function paintCompactNews(context:CanvasRenderingContext2D,scene:CompositionScene,frame:{canvas:HTMLCanvasElement|OffscreenCanvas}|null,time:number,narrationDuration:number,output:Pick<MediaComposition,'width'|'height'|'title'|'style'|'watermark'>,onTitle?:(text:string,x:number,y:number,width:number,height:number)=>void):void{
 const nativeDiagram=compactDiagramScene(scene)
 if(!frame&&!nativeDiagram)throw new Error('STUDIO_COMPACT_MEDIA: 缺少可解码横屏视频。')
 const visual=visualAtTime(scene,time),framing=visual?.segment??scene,crop=focusFraming(framing,visual?.localSeconds??time).crop,zoom=visualZoom(framing,visual?.localSeconds??time),sourceWidth=frame?frame.canvas.width*crop.width/zoom:640,sourceHeight=frame?frame.canvas.height*crop.height/zoom:360,layout=compactGeometry(sourceWidth/sourceHeight)
 const problems=compactSceneIssues(context,scene,output.title,narrationDuration);if(problems.length)throw new Error('STUDIO_TEXT_LAYOUT: '+problems.join('；'))
 const light=output.style==='clean-light',paper=light?'#f7f8fa':'#19212b',ink=light?'#172536':'#edf2f7',muted=light?'#586a7e':'#b4c0cf',label=scene.label.split(/[｜|\n]/),meta=label.shift()??'',footer=label.join(' · ')
 context.save();try{
  context.scale(output.width/720,output.height/1280);context.fillStyle=paper;context.fillRect(0,0,720,1280);context.textBaseline='top'
  const draw=(text:string,x:number,y:number,size:number,color:string)=>{context.font=`500 ${size}px ${COMPACT_NEWS_FONT}`;context.fillStyle=color;context.fillText(text,x,y)}
  if(output.watermark?.enabled){context.save();context.globalAlpha=output.watermark.opacity;draw(output.watermark.text,40,82,30,muted);context.restore()}
  for(const [index,line]of compactText(context,output.title,48,2).lines.entries()){draw(line,40,146+index*58,48,ink);onTitle?.(line,40/720,(146+index*58)/1280,640/720,58/1280)}
  draw(meta,40,278,30,muted)
  const m=layout.media;context.save();context.filter=visualEffectFilter(framing.effects);context.globalAlpha=visual?.opacity??1;if(frame)context.drawImage(frame.canvas,frame.canvas.width*crop.x+(frame.canvas.width*crop.width-sourceWidth)/2,frame.canvas.height*crop.y+(frame.canvas.height*crop.height-sourceHeight)/2,sourceWidth,sourceHeight,m.x,m.y,m.width,m.height);context.restore()
  const cue=(scene.captions??estimatedCaptionCues(scene,output.width,output.height,narrationDuration)).find(c=>time>=c.startSeconds&&time<c.endSeconds)
  if(cue){const blocks=compactCue(context,cue,scene.captionDisplay);withCanvasPaintRole(context,'caption',()=>{blocks.chinese.lines.forEach((line,i)=>draw(line,40,layout.captionY+i*54,42,ink));blocks.english.lines.forEach((line,i)=>draw(line,40,layout.englishY+i*40,30,muted))})}
  compactText(context,footer,30,2).lines.forEach((line,i)=>draw(line,40,layout.footerY+i*34,30,muted))
 }finally{context.restore()}
}
