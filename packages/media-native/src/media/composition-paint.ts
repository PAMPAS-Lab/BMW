import {visualEffectFilter} from '../visual-effects.js'
import {paintLoupe} from './loupe-paint.js'
import {scenePlaybackClock} from '../scene-playback-window.js'
import {focusFraming} from '../focus-contract.js'
import {visualAtTime,visualZoom} from '../visual-segments.js'
import {cardMetricText,cardPaintScene} from '../card-templates.js'
import type { CompositionScene, MediaComposition } from '../composition-contract.js'
import { DEFAULT_VIDEO_OPTIONS } from '../video-options.js'
import {captionText,estimatedCaptionCues} from '../composition-contract.js'
import {captionBacking,captionLayout} from './composition-text.js'
import {withCanvasPaintRole} from './canvas-paint-role.js'
export interface CompositionCanvasFrame {canvas:HTMLCanvasElement|OffscreenCanvas}
/** Normalized bounds of text actually painted, for fixed-template GUI editing. */
export interface CompositionTextBox {kind:'title'|'bullet'|'global-title';index:number;x:number;y:number;width:number;height:number}
import {readingCrop,speechReadingCrop,paintHighlights,paintDetailedCard,detailedVisualArea} from './card-details-paint.js'
import {phoneReadingView} from './phone-reading.js'
import type {SourceRect} from '../card-details.js'
export interface CompositionVisualBox {artifactId:string;crop:SourceRect;x:number;y:number;width:number;height:number}
import {fitText,templateBoxes,wrapText} from './composition-text.js'
export {reviewSceneText,assertCompositionText} from './composition-text.js'
const font = '"PingFang SC", "Microsoft YaHei", sans-serif'
const footerCache=new WeakMap<CanvasRenderingContext2D,WeakMap<CompositionScene,{key:string;top:number}>>()
/** Reserve the entire scene's bottom-caption footprint, so the media window
 * cannot pulse when a short caption changes to a three-line bilingual block. */
function captionFooterTop(context:CanvasRenderingContext2D,identity:CompositionScene,scene:CompositionScene,W:number,cues:NonNullable<CompositionScene['captions']>):number{
 const key=JSON.stringify([W,scene.captionDisplay,scene.captionStyle,cues]),entries=footerCache.get(context)??new WeakMap<CompositionScene,{key:string;top:number}>();footerCache.set(context,entries)
 const saved=entries.get(identity);if(saved?.key===key)return saved.top
 let top=Infinity
 if(!scene.captionStyle?.position||scene.captionStyle.position==='bottom')for(const cue of cues){const box=captionLayout(context,captionText(cue,scene.captionDisplay),W,scene.captionStyle,Boolean(cue.translationText)).box;if(box&&box.y>=432)top=Math.min(top,box.y)}
 entries.set(identity,{key,top});return top
}
/** A single responsive painter is used by Studio preview and MP4 export. */
export function paintScene(context:CanvasRenderingContext2D,scene:CompositionScene,frame:CompositionCanvasFrame|null,time:number,_duration:number,index:number,total:number,narrationDuration:number,output?:Pick<MediaComposition,'width'|'height'|'style'|'watermark'>&Partial<Pick<MediaComposition,'title'|'cardLayout'>>,onText?:(box:CompositionTextBox)=>void,cardAssets?:ReadonlyMap<string,{image?:HTMLCanvasElement}>,onVisual?:(box:CompositionVisualBox)=>void):void {
  const height=output?.height??720,width=output?.width??1280,W=720*width/height,H=720,margin=W<600?24:48
  const card=scene.cardSpec,originalScene=scene
  scene=cardPaintScene(scene)
  const news=output?.cardLayout==='news'
  if(news)scene={...scene,label:'',showSceneNumber:false}
  const style=output?.style??'bmw-dark',light=style==='clean-light',minimal=style==='minimal'
  const ink=scene.sceneTemplate?.textColor??(light?'#172536':'#ffffff'),muted=light?'#65758b':'#7e90a9',accent=scene.sceneTemplate?.accentColor??(light?'#2369db':minimal?'#ffffff':'#a2f4d0')
  context.save();context.scale(height/720,height/720)
  const watermark=output?.watermark??DEFAULT_VIDEO_OPTIONS.watermark,headerOffset=!news&&watermark.enabled&&watermark.position.startsWith('top')?24:0
  const clock=scenePlaybackClock(scene,index,total),presentationTime=clock.startSeconds+time
  const ease=card&&card.motion!=='fade-in'?1:1-Math.pow(1-Math.min(1,presentationTime/.8),3)
  let headerBottom=0
  const textBox=(kind:CompositionTextBox['kind'],index:number,text:string,x:number,y:number,size:number,offset=0)=>{
    if(kind==='title'&&text)headerBottom=Math.max(headerBottom,y+Math.max(size*.3,context.measureText(text).actualBoundingBoxDescent??0)+18)
    if(!onText||!text||(ease<=0&&(kind==='title'||!scene.sceneTemplate)))return;const measured=context.measureText(text);onText({kind,index,x:x/W,y:(y-size+offset)/H,width:Math.max(1,measured.width)/W,height:size*1.3/H})
  }
  if(light||minimal){context.fillStyle=light?'#f8fafc':'#111111'}else{const gradient=context.createLinearGradient(0,0,W,H);gradient.addColorStop(0,'#101827');gradient.addColorStop(1,'#181b36');context.fillStyle=gradient}
  if(scene.sceneTemplate?.backgroundColor)context.fillStyle=scene.sceneTemplate.backgroundColor
  if(news)context.fillStyle=light?'#f8fafc':'#232323'
  context.fillRect(0,0,W,H)
  if(news){
    context.fillStyle=ink
    const headline=fitText(context,output?.title??'',W-margin*2,3,W<600?28:40,108)
    if(headline.overflow)throw new Error('STUDIO_TEXT_LAYOUT: 全片标题放不下。')
    context.font=`700 ${headline.size}px ${font}`
    headline.lines.forEach((line,row)=>{const x=(W-context.measureText(line).width)/2,y=60+row*headline.size*1.3;context.fillText(line,x,y);textBox('global-title',0,line,x,y,headline.size)})
  }
  context.fillStyle=accent;context.font=`600 16px ${font}`;context.fillText(scene.label.toUpperCase(),margin,37+headerOffset)
  context.save();context.globalAlpha=ease;context.translate(0,18*(1-ease));context.fillStyle=ink
  const titleBase=news?(W<600?22:30):(W<600?28:42);context.font=`700 ${titleBase}px ${font}`
  if(news){
    const fitted=fitText(context,scene.title,W-margin*2,2,titleBase,78)
    if(fitted.overflow)throw new Error('STUDIO_TEXT_LAYOUT: 卡片标题放不下。')
    context.font=`700 ${fitted.size}px ${font}`
    fitted.lines.forEach((line,row)=>{const y=178+row*fitted.size*1.3;context.fillText(line,margin,y);textBox('title',0,line,margin,y,fitted.size,18*(1-ease))})
  }else if(W<600||scene.title.includes('\n')){
    const titleLines=wrapText(context,scene.title,W-margin*2)
    const displayed=titleLines.length>2?[titleLines[0],titleLines.slice(1).join('')]:titleLines
    displayed.forEach((line,row)=>{const measured=context.measureText(line).width,size=Math.min(W<600?titleBase:28,titleBase*(W-margin*2)/Math.max(1,measured)),y=(displayed.length>1?(W<600?77:61)+row*30:91)+headerOffset;context.font=`700 ${size}px ${font}`;context.fillText(line,margin,y);textBox('title',0,line,margin,y,size,18*(1-ease));context.font=`700 ${titleBase}px ${font}`})
  }else{const titleSize=Math.min(titleBase,titleBase*(W-margin*2)/Math.max(1,context.measureText(scene.title).width));context.font=`700 ${titleSize}px ${font}`;context.fillText(scene.title,margin,91+headerOffset);textBox('title',0,scene.title,margin,91+headerOffset,titleSize,18*(1-ease))}
  context.restore()
  const cues=scene.captions??estimatedCaptionCues(scene,width,height,narrationDuration)
  const visual=visualAtTime(scene,time),framing=visual?.segment??scene
  if(frame){
    const baseArea=news?{x:margin,y:236,width:W-margin*2,height:scene.sceneTemplate?.kind==='screenshot'?280:362}:scene.layout==='fullscreen'?{x:0,y:110+headerOffset,width:W,height:510-headerOffset}:{x:margin,y:122+headerOffset,width:W-margin*2,height:(scene.sceneTemplate?.kind==='screenshot'?390:484)-headerOffset}
    if(!news&&!card&&W<600&&scene.layout==='fullscreen'){
      const bottom=Math.min(baseArea.y+baseArea.height,captionFooterTop(context,originalScene,scene,W,cues)-12),top=Math.max(baseArea.y,headerBottom+12)
      if(bottom-top<120)throw new Error('STUDIO_TEXT_LAYOUT: Portrait title and captions leave too little visual space.')
      baseArea.y=top;baseArea.height=bottom-top
    }
    let area=detailedVisualArea(card?.version===2?card:undefined,baseArea)
    const focused=focusFraming(framing,visual?.localSeconds??time),reading=card?.version===2&&'reading'in card?card.reading:undefined
    const phone=phoneReadingView(reading,framing.imageArtifactId,focused.crop,frame.canvas.width,frame.canvas.height,area,presentationTime,clock.durationSeconds,W,scene.cardCues)
    if(phone)area=phone.area
    const crop=phone?.crop??(scene.cardCues?.some(c=>c.kind==='reading')&&reading?speechReadingCrop(reading,framing.imageArtifactId,focused.crop,presentationTime,scene.cardCues):readingCrop(reading,framing.imageArtifactId,focused.crop,'effectWindow'in framing&&framing.effectWindow?(framing.effectWindow.startSeconds+(visual?.localSeconds??time)):scene.visualSegments?(visual?.localSeconds??time):presentationTime,'effectWindow'in framing&&framing.effectWindow?framing.effectWindow.durationSeconds:scene.visualSegments?framing.durationSeconds:clock.durationSeconds)),sourceWidth=frame.canvas.width*crop.width,sourceHeight=frame.canvas.height*crop.height
    context.save();context.beginPath();context.roundRect(area.x,area.y,area.width,area.height,minimal?0:16);context.clip()
    context.fillStyle=light?'#e7edf5':'#232323';context.fillRect(area.x,area.y,area.width,area.height)
    context.globalAlpha=visual?.opacity??1
    const push=card?.motion==='slow-push'?1+.06*Math.min(1,presentationTime/clock.durationSeconds):1
    const scale=Math.min(area.width/sourceWidth,area.height/sourceHeight)*(phone?.phase?1:visualZoom(framing,visual?.localSeconds??time)*push),drawWidth=sourceWidth*scale,drawHeight=sourceHeight*scale
    context.save();context.filter=visualEffectFilter(framing.effects)
    context.drawImage(frame.canvas,frame.canvas.width*crop.x,frame.canvas.height*crop.y,sourceWidth,sourceHeight,area.x+(area.width-drawWidth)/2,area.y+(area.height-drawHeight)/2,drawWidth,drawHeight)
    context.restore()
    const drawn={x:area.x+(area.width-drawWidth)/2,y:area.y+(area.height-drawHeight)/2,width:drawWidth,height:drawHeight}
    if(phone?.highlight){
      const r=phone.highlight,x=drawn.x+(r.x-crop.x)/crop.width*drawn.width,y=drawn.y+(r.y-crop.y)/crop.height*drawn.height,w=r.width/crop.width*drawn.width,h=r.height/crop.height*drawn.height
      context.save();context.fillStyle='#10182766';context.fillRect(drawn.x,drawn.y,drawn.width,Math.max(0,y-drawn.y));context.fillRect(drawn.x,y+h,drawn.width,Math.max(0,drawn.y+drawn.height-y-h));context.fillRect(drawn.x,y,Math.max(0,x-drawn.x),h);context.fillRect(x+w,y,Math.max(0,drawn.x+drawn.width-x-w),h);context.strokeStyle=accent;context.lineWidth=3;context.strokeRect(x,y,w,h);context.restore()
    }
    if(card?.version===2&&'highlights'in card){context.save();context.beginPath();context.rect(drawn.x,drawn.y,drawn.width,drawn.height);context.clip();paintHighlights(context,card.highlights,framing.imageArtifactId,presentationTime,crop,drawn,scene.cardCues);context.restore()}
    if(framing.imageArtifactId)onVisual?.({artifactId:framing.imageArtifactId,crop,x:drawn.x/W,y:drawn.y/H,width:drawn.width/W,height:drawn.height/H})
    if(focused.focus?.mode==='loupe'){context.save();context.filter=visualEffectFilter(framing.effects);paintLoupe(context,frame.canvas,focused.focus,crop,area,drawn,focused.strength);context.restore()}
    if(focused.focus?.emphasize&&focused.strength>0){
      const x=area.x+(area.width-drawWidth)/2+(focused.focus.x-crop.x)/crop.width*drawWidth,y=area.y+(area.height-drawHeight)/2+(focused.focus.y-crop.y)/crop.height*drawHeight
      context.globalAlpha=(visual?.opacity??1)*focused.strength;context.strokeStyle='#ffcc33';context.lineWidth=3;context.beginPath();context.arc(x,y,14,0,Math.PI*2);context.stroke()
    }
    context.restore()
    if(!minimal){context.strokeStyle=light?'#2369db44':'#a2f4d044';context.lineWidth=2;context.beginPath();context.roundRect(area.x,area.y,area.width,area.height,16);context.stroke()}
    if(phone){const phase=phone.phase?({context:'原文全貌',locate:'定位原句',zoom:'放大原句',detail:'原句细节',return:'返回全貌'} as const)[phone.phase]:undefined;context.fillStyle=accent;context.font=`500 14px ${font}`;context.fillText(phone.name+(phase?' · '+phase:phone.pan?' · 原图横向阅读':''),area.x,area.y+area.height+24);if(!phase){context.fillStyle=light?'#2369db44':'#a2f4d044';context.fillRect(area.x,area.y+area.height+34,area.width,3);context.fillStyle=accent;context.fillRect(area.x,area.y+area.height+34,area.width*phone.progress,3)}}
  }else{
    context.save();context.globalAlpha=ease;context.fillStyle=accent;context.font=`800 ${W<600?80:110}px ${font}`;if(!scene.sceneTemplate&&scene.showSceneNumber!==false)context.fillText(String(clock.sceneNumber).padStart(2,'0'),margin,265)
    context.fillStyle=ink
    let y=news?280:scene.showSceneNumber===false?240:340
    if(!scene.sceneTemplate)for(const [bulletIndex,bullet] of scene.bullets.entries()){const fit=fitText(context,bullet,W-margin*2,2,W<600?24:34);if(fit.overflow)throw new Error('STUDIO_TEXT_LAYOUT: 画面文字放不下。');context.font=`600 ${fit.size}px ${font}`;for(const line of fit.lines){if(presentationTime>=(scene.bulletRevealSeconds?.[bulletIndex]??0)){context.fillText(line,margin,y);textBox('bullet',bulletIndex,line,margin,y,fit.size)}y+=W<600?32:42}y+=12}
    context.restore()
  }
  if(scene.sceneTemplate){for(const [index,box]of templateBoxes(scene,W,output?.cardLayout).entries()){
    const text=scene.bullets[index];if(!text||presentationTime<(scene.bulletRevealSeconds?.[index]??0))continue
    const fit=fitText(context,text,box.width-28,Math.max(1,Math.floor((box.height-24)/24)),W<600?24:34,box.height-24);if(fit.overflow)throw new Error('STUDIO_TEXT_LAYOUT: 模板文字放不下。')
    context.save();if(card?.motion==='fade-in')context.globalAlpha=ease;context.fillStyle=light?'#e7edf5':'#232b39';context.beginPath();context.roundRect(box.x,box.y,box.width,box.height,10);context.fill();context.fillStyle=accent;context.fillRect(box.x,box.y,4,box.height);context.fillStyle=scene.sceneTemplate.emphasisIndex===index?accent:ink;context.font=`600 ${fit.size}px ${font}`;fit.lines.forEach((line,row)=>{const y=box.y+12+fit.size+row*fit.size*1.3;context.fillText(line,box.x+14,y);textBox('bullet',index,line,box.x+14,y,fit.size)});context.restore()
  }}
  if(card&&['title/basic','title/emphasis','metric/hero','metric/backdrop'].includes(card.templateId)){
    const cue=scene.cardCues?.find(c=>c.kind===(card.templateId==='metric/backdrop'?'metric':'keyword')),visible=!cue||presentationTime>=cue.startSeconds&&(card.templateId!=='metric/backdrop'||presentationTime<cue.endSeconds),cardTime=cue?presentationTime-cue.startSeconds:presentationTime
    context.save();context.globalAlpha=visible?ease:0;context.fillStyle=ink
    const draw=(text:string,y:number,size:number,kind:CompositionTextBox['kind']|null,maximumLines=2)=>{
      const fitted=fitText(context,text,W-margin*2,maximumLines,size)
      if(fitted.overflow)throw new Error('STUDIO_TEXT_LAYOUT: 卡片文字放不下。')
      context.font=`700 ${fitted.size}px ${font}`
      fitted.lines.forEach((line,row)=>{const x=(W-context.measureText(line).width)/2,baseline=y+row*fitted.size*1.3;context.fillText(line,x,baseline);if(kind)textBox(kind,0,line,x,baseline,fitted.size)})
    }
    if(card.templateId==='title/basic'||card.templateId==='title/emphasis'){
      if(frame&&card.templateId==='title/emphasis'){context.fillStyle='#000000b3';context.fillRect(0,news?236:170,W,news?362:390);context.fillStyle=ink}
      if(card.templateId==='title/emphasis'&&card.motion==='wipe'){context.beginPath();context.rect(0,0,W*Math.min(1,presentationTime/.8),H);context.clip()}
      draw(originalScene.title,news?330:280,W<600?38:64,'title')
      if(originalScene.bullets[0])draw(originalScene.bullets[0],news?510:460,W<600?24:34,'bullet')
    }else if(card.templateId==='metric/hero'||card.templateId==='metric/backdrop'){
      if(card.templateId==='metric/backdrop'&&card.phase==='to-evidence')context.globalAlpha*=Math.max(0,1-(cardTime-card.holdSeconds)/.6)
      if(frame){context.fillStyle='#000000a6';context.fillRect(0,news?236:170,W,news?362:390);context.fillStyle=ink}
      draw(cardMetricText(card,Math.max(0,cardTime)),news?380:365,W<600?68:110,null,1)
      if(originalScene.bullets[0])draw(originalScene.bullets[0],news?550:520,W<600?24:34,'bullet')
    }
    context.restore()
  }
  if(card?.version===2&&'quote'in card&&originalScene.bullets[0]){context.fillStyle=ink;const fit=fitText(context,originalScene.bullets[0],W-margin*2,1,16);if(fit.overflow)throw new Error('STUDIO_TEXT_LAYOUT: 引述说明过长。');context.font=`600 ${fit.size}px ${font}`;context.fillText(fit.lines[0]??'',margin,228)}
  if(card?.version===2)paintDetailedCard(context,card,W,presentationTime,clock.durationSeconds,cardAssets,{ink,muted:light?'#65758b':'#c4cbd7',accent,panel:light?'#e7edf5':'#354152',connection:light?'#2369db':'#8ebaff',mark:light?'#946200':'#ffcc33',rangeFill:light?'#207a6a':'#62b5a6'},undefined,scene.cardCues)
  // Estimated sentence captions follow measured audio; no word-alignment claim.
  const cue=cues.find(cue=>time>=cue.startSeconds&&time<cue.endSeconds),caption=cue?captionText(cue,scene.captionDisplay):''
  const look=scene.captionStyle,layout=captionLayout(context,caption,W,look,Boolean(cue?.translationText)),backing=captionBacking(look?.color??ink)
  if(layout.overflow)throw new Error('STUDIO_TEXT_LAYOUT: 字幕超出显示行数。')
  context.fillStyle=look?.color??ink;context.font=`500 ${layout.size}px ${font}`
  if(look?.background==='box'&&layout.box)withCanvasPaintRole(context,'caption-background',()=>{const b=layout.box!;context.save();context.fillStyle=backing.box;context.fillRect(b.x,b.y,b.width,b.height);context.restore()})
  withCanvasPaintRole(context,'caption',()=>{for(const {text,x,y}of layout.lines){
    if(look?.background==='outline'){context.save();context.strokeStyle=backing.outline;context.lineJoin='round';context.lineWidth=Math.max(2,layout.size*.12);context.strokeText(text,x,y);context.restore()}
    context.fillText(text,x,y)
  }})
  context.fillStyle=muted;context.font=`14px ${font}`
  const rightWatermark=watermark.enabled&&watermark.position==='bottom-right'
  const counter=`${String(clock.sceneNumber).padStart(2,'0')} / ${String(clock.sceneCount).padStart(2,'0')}`
  if(scene.showSceneNumber!==false)withCanvasPaintRole(context,'counter',()=>context.fillText(counter,rightWatermark?margin:W-margin-context.measureText(counter).width,704))
  if(watermark.enabled){context.save();context.globalAlpha=watermark.opacity;context.fillStyle=muted;context.font=`${watermark.size}px ${font}`
    const maxWidth=W-margin*2,measured=context.measureText(watermark.text).width
    if(measured>maxWidth)context.font=`${watermark.size*maxWidth/measured}px ${font}`
    const x=watermark.position.endsWith('right')?W-margin-context.measureText(watermark.text).width:margin
    withCanvasPaintRole(context,'watermark',()=>context.fillText(watermark.text,x,news?Math.max(18,watermark.size+4):watermark.position.startsWith('top')?Math.max(18,watermark.size+4):704));context.restore()
  }
  if(!minimal&&!news){context.fillStyle=accent;context.fillRect(0,716,W*(clock.sceneNumber-1+Math.min(1,presentationTime/clock.durationSeconds))/clock.sceneCount,4)}
  context.restore()
}
