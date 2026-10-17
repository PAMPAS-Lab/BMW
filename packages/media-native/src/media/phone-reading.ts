import type {CardReading,SourceRect} from '../card-details.js'
import {CONTEXT_READING} from '../card-details.js'
import type {CardCue} from '../card-cues.js'
import type {CardArea} from './card-details-paint.js'
export interface PhoneReadingView {crop:SourceRect;area:CardArea;name:string;pan:boolean;progress:number;estimatedLinePixels:number;phase?:'context'|'locate'|'zoom'|'detail'|'return';highlight?:SourceRect}
const smooth=(v:number):number=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t)}
const blend=(a:SourceRect,b:SourceRect,t:number):SourceRect=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,width:a.width+(b.width-a.width)*t,height:a.height+(b.height-a.height)*t})
/** Whole → boxed evidence → stationary close-up. Every intermediate crop
 * contains the complete target; no lateral scan or screenshot text reflow. */
function contextReadingView(reading:CardReading,artifactId:string|undefined,base:SourceRect,sourceWidth:number,sourceHeight:number,area:CardArea,seconds:number,duration:number,canvasWidth:number,cues?:CardCue[]):PhoneReadingView|null{
 const target=reading.targets[0];if(!target?.lineCount||target.source.artifactId!==artifactId)return null
 const r=target.rect
 if(r.x<base.x-1e-9||r.y<base.y-1e-9||r.x+r.width>base.x+base.width+1e-9||r.y+r.height>base.y+base.height+1e-9)throw new Error('CARD_READING_CROP: 手机阅读目标不在当前完整裁切内。')
 const window=cues?.find(c=>c.kind==='reading'&&c.index===0),start=window?.startSeconds??0,end=window?.endSeconds??duration,span=Math.max(.001,end-start),t=Math.max(0,Math.min(1,(seconds-start)/span))
 const panel={...area,height:Math.min(area.height,240)},padX=r.width*.06,padY=r.height*.16
 const detail={x:Math.max(base.x,r.x-padX),y:Math.max(base.y,r.y-padY),width:0,height:0}
 detail.width=Math.min(base.x+base.width,r.x+r.width+padX)-detail.x;detail.height=Math.min(base.y+base.height,r.y+r.height+padY)-detail.y
 let crop:SourceRect=base,phase:NonNullable<PhoneReadingView['phase']>='context',highlight:SourceRect|undefined
 // Fractions reserve an actual reading hold even for a short sentence.
 if(t>=CONTEXT_READING.locate&&t<CONTEXT_READING.zoom){phase='locate';highlight=r}
 else if(t>=CONTEXT_READING.zoom&&t<CONTEXT_READING.detail){phase='zoom';highlight=r;crop=blend(base,detail,smooth((t-CONTEXT_READING.zoom)/(CONTEXT_READING.detail-CONTEXT_READING.zoom)))}
 else if(t>=CONTEXT_READING.detail){phase='detail';crop=detail;if(reading.returnToWhole&&t>=CONTEXT_READING.return){phase='return';crop=blend(detail,base,smooth((t-CONTEXT_READING.return)/(1-CONTEXT_READING.return)))}}
 if(seconds<start){phase='context';crop=base;highlight=undefined}
 if(seconds>=end&&reading.returnToWhole){phase='context';crop=base;highlight=undefined}
 const sourceLine=sourceHeight*r.height/target.lineCount*.8,scale=Math.min(panel.width/(sourceWidth*crop.width),panel.height/(sourceHeight*crop.height))
 return {crop,area:panel,name:target.name,pan:false,progress:t,phase,highlight,estimatedLinePixels:sourceLine*scale*390/canvasWidth}
}
/** Author-counted lines are a layout hint, never OCR or semantic evidence.
 * Pan across the complete pinned rectangle instead of squeezing a long line
 * into the phone width. Source pixels and the original presentation clock stay intact. */
export function phoneReadingView(reading:CardReading|undefined,artifactId:string|undefined,base:SourceRect,sourceWidth:number,sourceHeight:number,area:CardArea,seconds:number,duration:number,canvasWidth:number,cues?:CardCue[]):PhoneReadingView|null {
 if(!reading)return null
 if(reading.mode==='whole-to-detail')return contextReadingView(reading,artifactId,base,sourceWidth,sourceHeight,area,seconds,duration,canvasWidth,cues)
 const windows=cues?.filter(c=>c.kind==='reading')??[]
 let index=-1,start=0,end=duration
 if(windows.length){const active=windows.find(c=>seconds>=c.startSeconds&&seconds<c.endSeconds);if(active){index=active.index;start=active.startSeconds;end=active.endSeconds}else if(!reading.returnToWhole&&reading.mode!=='detail-to-whole'){const last=windows.filter(c=>c.endSeconds<=seconds).sort((a,b)=>b.endSeconds-a.endSeconds)[0];if(last){index=last.index;start=last.startSeconds;end=last.endSeconds}}}
 else {const whole=reading.mode==='detail-to-whole'?0:1,count=reading.targets.length+whole+(reading.returnToWhole||reading.mode==='detail-to-whole'?1:0),dwell=duration/count,stage=Math.min(count-1,Math.floor(Math.max(0,seconds)/dwell));index=stage-whole;start=stage*dwell;end=start+dwell}
 const target=reading.targets[index]
 if(!target?.lineCount||target.source.artifactId!==artifactId)return null
 const r=target.rect
 if(r.x<base.x-1e-9||r.y<base.y-1e-9||r.x+r.width>base.x+base.width+1e-9||r.y+r.height>base.y+base.height+1e-9)throw new Error('CARD_READING_CROP: 手机阅读目标不在当前完整裁切内。')
 const estimatedSourceLine=sourceHeight*r.height/target.lineCount*.8,desiredLine=18*canvasWidth/390
 const scale=desiredLine/Math.max(1,estimatedSourceLine),viewportWidth=Math.min(r.width,area.width/(sourceWidth*scale)),pan=viewportWidth<r.width-1e-9
 const available=Math.max(.001,end-start),hold=Math.min(.7,available/4),progress=Math.max(0,Math.min(1,(seconds-start-hold)/Math.max(.001,available-2*hold))),smooth=progress*progress*(3-2*progress)
 const crop={x:r.x+(r.width-viewportWidth)*smooth,y:r.y,width:viewportWidth,height:r.height}
 const drawScale=Math.min(area.width/(sourceWidth*crop.width),Math.min(area.height,240)/(sourceHeight*crop.height))
 const height=Math.min(area.height,Math.max(76,sourceHeight*crop.height*drawScale+24))
 return {crop,area:{...area,height},name:target.name,pan,progress,estimatedLinePixels:estimatedSourceLine*drawScale*390/canvasWidth}
}
