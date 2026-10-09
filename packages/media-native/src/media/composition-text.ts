import {detailedTextFits} from './card-details-paint.js'
import {captionText,estimatedCaptionCues} from '../composition-contract.js'
import type {CompositionScene,MediaComposition} from '../composition-contract.js'
import {sceneVisuals} from '../visual-segments.js'
import {cardPaintScene,cardMetricText} from '../card-templates.js'
export const COMPOSITION_FONT='"PingFang SC", "Microsoft YaHei", sans-serif'
export interface TextMeasure {font:string;measureText(text:string):{width:number}}
export interface TextReviewIssue {code:'text-overflow'|'caption-density'|'text-reading-time'|'text-overlap'|'template-content'|'font-reduced'|'translation-missing';severity:'error'|'warning';message:string;seconds:number}
export function wrapText(context:TextMeasure,text:string,width:number):string[]{const result:string[]=[];let line='';for(const c of text){if(c==='\r')continue;if(c==='\n'){result.push(line);line='';continue}if(context.measureText(line+c).width>width&&line){const at=line.lastIndexOf(' ');if(at>0&&/[a-zA-Z]/.test(c)&&/[a-zA-Z]$/.test(line)){result.push(line.slice(0,at));line=line.slice(at+1)}else if(/[。，、！？；：,.!?;:%]/.test(c)&&line.length>1){const tail=line.match(/[0-9]+(?:[.,][0-9]+)?$/)?.[0]??line.slice(-1);result.push(line.slice(0,-tail.length));line=tail}else{result.push(line);line=''}}line+=c}if(line)result.push(line);return result}
export function fitText(context:TextMeasure,text:string,width:number,maximumLines:number,size:number,maximumHeight=Infinity):{lines:string[];size:number;overflow:boolean}{
 const original=context.font;try{let rows:string[]=[];for(let current=size;current>=12;current-=1){context.font=`600 ${current}px ${COMPOSITION_FONT}`;rows=wrapText(context,text,width);if(rows.length<=maximumLines&&rows.length*current*1.3<=maximumHeight&&rows.every(line=>context.measureText(line).width<=width))return {lines:rows,size:current,overflow:false}}return {lines:rows,size:12,overflow:true}}finally{context.font=original}
}
export function templateBoxes(scene:CompositionScene,W:number,layout?:MediaComposition['cardLayout']):{x:number;y:number;width:number;height:number}[]{
 const margin=W<600?24:48,width=W-margin*2,kind=scene.sceneTemplate?.kind
 if(layout==='news'){
  if(kind==='comparison')return W>=600?[{x:margin,y:250,width:(width-24)/2,height:314},{x:margin+(width+24)/2,y:250,width:(width-24)/2,height:314}]:[{x:margin,y:250,width,height:145},{x:margin,y:417,width,height:145}]
  if(kind==='summary')return [0,1,2].map(i=>({x:margin,y:250+i*104,width,height:88}))
  if(kind==='screenshot')return [{x:margin,y:530,width,height:76}]
 }
 if(kind==='comparison')return W>=600?[{x:margin,y:185,width:(width-24)/2,height:350},{x:margin+(width+24)/2,y:185,width:(width-24)/2,height:350}]:[{x:margin,y:185,width,height:150},{x:margin,y:355,width,height:150}]
 if(kind==='summary')return [0,1,2].map(i=>({x:margin,y:185+i*112,width,height:94}))
 if(kind==='screenshot')return [{x:margin,y:535,width,height:78}]
 return []
}
export function reviewSceneText(context:TextMeasure,scene:CompositionScene,width:number,height:number,narrationDuration=scene.durationSeconds-1,layout?:MediaComposition['cardLayout']):TextReviewIssue[]{
 const original=scene;scene=cardPaintScene(scene)
 const W=720*width/height,margin=W<600?24:48,issues:TextReviewIssue[]=[],kind=scene.sceneTemplate?.kind,hasVisual=sceneVisuals(scene).length>0
 const issue=(code:TextReviewIssue['code'],message:string,severity:TextReviewIssue['severity']='warning',seconds=0)=>issues.push({code,severity,message,seconds})
 if(original.cardSpec?.version===2&&!detailedTextFits(context,original.cardSpec,W))issue('text-overflow','专用内容槽放不下，请节选、分卡或换固定位置。','error')
 if(layout==='news'&&fitText(context,scene.title,W-margin*2,2,W<600?22:30,78).overflow)issue('text-overflow','卡片标题放不下，请缩短文字。','error')
 if(original.cardSpec&&['title/basic','title/emphasis','metric/hero','metric/backdrop'].includes(original.cardSpec.templateId)){
  const card=original.cardSpec,texts=card.templateId==='metric/hero'||card.templateId==='metric/backdrop'?[{text:cardMetricText(card as Extract<typeof card,{templateId:'metric/hero'|'metric/backdrop'}>,1.2),rows:1,size:W<600?68:110},{text:original.bullets[0]??'',rows:2,size:W<600?24:34}]:[{text:original.title,rows:2,size:W<600?38:64},{text:original.bullets[0]??'',rows:2,size:W<600?24:34}]
  for(const item of texts){const fit=fitText(context,item.text,W-margin*2,item.rows,item.size);if(fit.overflow)issue('text-overflow','卡片文字放不下，请缩短文字或更换版式。','error');else if(fit.size<item.size)issue('font-reduced',`卡片文字已适配为 ${fit.size} 字号。`)}
 }
 if(kind==='summary'&&(hasVisual||scene.bullets.length!==3))issue('template-content','三点总结需要三项要点和无画面素材的标题卡。','error')
 if(kind==='comparison'&&(hasVisual||scene.bullets.length!==2))issue('template-content','观点对比需要两项观点和无画面素材的标题卡。','error')
 if(kind==='screenshot'&&(!hasVisual||scene.bullets.length!==1))issue('template-content','截图解读需要画面素材和一项说明。','error')
 const boxes=templateBoxes(scene,W,layout)
 if(!hasVisual||kind==='screenshot')for(const [index,text]of scene.bullets.entries()){
  const box=boxes[index],maxLines=box?Math.max(1,Math.floor((box.height-24)/24)):2,size=W<600?24:34,fit=fitText(context,text,box?box.width-28:W-margin*2,maxLines,size,box?box.height-24:Infinity)
  if(fit.overflow)issue('text-overflow',`第 ${index+1} 项画面文字放不下，请缩短内容或更换版式。`,'error')
  else if(fit.size<size)issue('font-reduced',`第 ${index+1} 项已适配为 ${fit.size} 字号，请检查可读性。`)
 }
 const visible=scene.captions??estimatedCaptionCues(scene,width,height,narrationDuration)
 for(const [index,cue]of visible.entries()){
  const text=captionText(cue,scene.captionDisplay),size=scene.captionStyle?.fontSize??(W<600?22:28),fit=fitText(context,text,W-margin*2,scene.captionStyle||cue.translationText?3:2,size)
  if(fit.overflow)issue('text-overflow',`字幕 ${index+1} 超出显示行数，请拆分或缩短字幕。`,'error',cue.startSeconds)
  else if(fit.size<size)issue('font-reduced',`字幕 ${index+1} 已适配为 ${fit.size} 字号。`,'warning',cue.startSeconds)
  const units=Array.from(text.replace(/\s/g,'')).reduce((sum,c)=>sum+(/[\u3000-\u9fff]/.test(c)?1:.5),0)
  if(units/(cue.endSeconds-cue.startSeconds)>9)issue('caption-density',`字幕 ${index+1} 阅读时间偏短，请核对节奏。`,'warning',cue.startSeconds)
  if(scene.captionDisplay==='translation'&&!cue.translationText?.trim())issue('translation-missing',`字幕 ${index+1} 尚无译文。`,'warning',cue.startSeconds)
  if(scene.captionStyle?.position==='top'||scene.captionStyle?.position==='center')issue('text-overlap',`字幕 ${index+1} 位于标题或画面区域，请检查遮挡。`,'warning',cue.startSeconds)
 }
 if(!hasVisual&&scene.bullets.join('').length/scene.durationSeconds>9)issue('text-reading-time','标题卡信息较多，建议增加停留时间。')
 return issues
}
export function assertCompositionText(context:TextMeasure,composition:MediaComposition,durations?:number[]):void{
 const W=720*composition.width/composition.height,margin=W<600?24:48
 if(composition.cardLayout==='news'&&fitText(context,composition.title,W-margin*2,3,W<600?28:40,108).overflow)throw new Error('STUDIO_TEXT_LAYOUT: 全片标题放不下，请缩短标题。')
 for(const [index,scene]of composition.scenes.entries()){const errors=reviewSceneText(context,scene,composition.width,composition.height,durations?.[index],composition.cardLayout).filter(issue=>issue.severity==='error');if(errors.length)throw new Error('STUDIO_TEXT_LAYOUT: '+scene.title+'：'+errors.map(issue=>issue.message).join('；'))}
}
