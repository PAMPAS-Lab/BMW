import {finiteNumber,mediaRecord} from './media-contract.js'
/** Source-frame normalized centers; intervals use original video seconds, before trim/rate.
 * Images use elapsed visual seconds. No arbitrary keyframes or additional tracks. */
export interface FocusInterval {startSeconds:number;endSeconds:number;x:number;y:number;zoom:number;emphasize:boolean}
export const focusIntervalsSchema={type:'array',maxItems:24,items:{type:'object',additionalProperties:false,required:['startSeconds','endSeconds','x','y','zoom','emphasize'],properties:{startSeconds:{type:'number',minimum:0,maximum:1800},endSeconds:{type:'number',minimum:0,maximum:1800},x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1},zoom:{type:'number',minimum:1,maximum:4},emphasize:{type:'boolean'}}}}
export function assertFocusIntervals(raw:unknown):FocusInterval[]{
  if(!Array.isArray(raw)||raw.length>24)throw new TypeError('At most 24 focus intervals per visual.')
  return raw.map((item,index)=>{const value=mediaRecord(item)
    if(Object.keys(value).some(key=>!['startSeconds','endSeconds','x','y','zoom','emphasize'].includes(key))||typeof value.emphasize!=='boolean')throw new TypeError('Invalid focus interval.')
    const result={startSeconds:finiteNumber(value.startSeconds,'focus start',0,1800),endSeconds:finiteNumber(value.endSeconds,'focus end',0,1800),x:finiteNumber(value.x,'focus center x',0,1),y:finiteNumber(value.y,'focus center y',0,1),zoom:finiteNumber(value.zoom,'focus zoom',1,4),emphasize:value.emphasize}
    if(result.endSeconds-result.startSeconds<.1||index>0&&result.startSeconds<(raw[index-1] as FocusInterval).endSeconds)throw new TypeError('Focus intervals must be ordered, nonoverlapping and at least 100ms long.')
    return result
  })
}
/** Original elapsed effect clock retained by a content split; no expressions. */
export interface VisualEffectWindow {opacityStartSeconds?:number;opacityDurationSeconds?:number;originId:string;startSeconds:number;durationSeconds:number;fadeInSeconds:number;fadeOutSeconds:number}
export const visualEffectWindowSchema={type:'object',additionalProperties:false,required:['originId','startSeconds','durationSeconds','fadeInSeconds','fadeOutSeconds'],properties:{opacityStartSeconds:{type:'number',minimum:0,maximum:60},opacityDurationSeconds:{type:'number',minimum:.1,maximum:60},originId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},startSeconds:{type:'number',minimum:0,maximum:60},durationSeconds:{type:'number',minimum:.1,maximum:60},fadeInSeconds:{type:'number',minimum:0,maximum:1},fadeOutSeconds:{type:'number',minimum:0,maximum:1}}}
export function assertVisualEffectWindow(raw:unknown):VisualEffectWindow {
 const v=mediaRecord(raw)
 if(Object.keys(v).some(k=>!['originId','startSeconds','durationSeconds','fadeInSeconds','fadeOutSeconds','opacityStartSeconds','opacityDurationSeconds'].includes(k))||typeof v.originId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(v.originId))throw new Error('Invalid visual effect window.')
 const startSeconds=finiteNumber(v.startSeconds,'effect offset',0,60),durationSeconds=finiteNumber(v.durationSeconds,'effect duration',.1,60)
 if(startSeconds>=durationSeconds)throw new Error('Effect offset must be inside its original duration.')
 const hasOpacity=v.opacityStartSeconds!==undefined||v.opacityDurationSeconds!==undefined,opacityStartSeconds=hasOpacity?finiteNumber(v.opacityStartSeconds,'opacity offset',0,60):undefined,opacityDurationSeconds=hasOpacity?finiteNumber(v.opacityDurationSeconds,'opacity duration',.1,60):undefined
 if(hasOpacity&&opacityStartSeconds!>=opacityDurationSeconds!)throw new Error('Opacity offset must be inside its original duration.')
 return {...(hasOpacity?{opacityStartSeconds,opacityDurationSeconds}:{}),originId:v.originId,startSeconds,durationSeconds,fadeInSeconds:finiteNumber(v.fadeInSeconds,'effect fade in',0,Math.min(1,durationSeconds/2)),fadeOutSeconds:finiteNumber(v.fadeOutSeconds,'effect fade out',0,Math.min(1,durationSeconds/2))}
}
export interface FocusVisual {effectWindow?:VisualEffectWindow;focusIntervals?:FocusInterval[];sourceStartSeconds:number;playbackRate:number;videoArtifactId?:string;crop?:{x:number;y:number;width:number;height:number}}
export function focusSourceTime(visual:FocusVisual,localSeconds:number):number{return visual.videoArtifactId?visual.sourceStartSeconds+Math.max(0,localSeconds)*visual.playbackRate:(visual.effectWindow?.startSeconds??0)+Math.max(0,localSeconds)}
/** Shared by preview/export: smooth entry/exit over <=300ms of source time;
 * clamped inside the original crop. Markers use that same source-to-output transform. */
export function focusFraming(visual:FocusVisual,localSeconds:number):{crop:NonNullable<FocusVisual['crop']>;focus?:FocusInterval;strength:number}{
  const base=visual.crop??{x:0,y:0,width:1,height:1},time=focusSourceTime(visual,localSeconds),focus=visual.focusIntervals?.find(item=>time>=item.startSeconds&&time<item.endSeconds)
  if(!focus)return {crop:base,strength:0}
  const ramp=Math.min(.3,(focus.endSeconds-focus.startSeconds)/3),linear=Math.max(0,Math.min(1,(time-focus.startSeconds)/ramp,(focus.endSeconds-time)/ramp)),strength=linear*linear*(3-2*linear),zoom=1+(focus.zoom-1)*strength
  const width=base.width/zoom,height=base.height/zoom,centerX=base.x+base.width/2+(focus.x-base.x-base.width/2)*strength,centerY=base.y+base.height/2+(focus.y-base.y-base.height/2)*strength
  return {crop:{x:Math.max(base.x,Math.min(base.x+base.width-width,centerX-width/2)),y:Math.max(base.y,Math.min(base.y+base.height-height,centerY-height/2)),width,height},focus,strength}
}
export function visibleFocusIntervals(visual:FocusVisual,duration:number):{start:number;end:number;focus:FocusInterval}[]{
  const rate=visual.videoArtifactId?visual.playbackRate:1,start=visual.videoArtifactId?visual.sourceStartSeconds:(visual.effectWindow?.startSeconds??0)
  return (visual.focusIntervals??[]).map(focus=>({focus,start:Math.max(0,(focus.startSeconds-start)/rate),end:Math.min(duration,(focus.endSeconds-start)/rate)})).filter(item=>item.end>item.start)
}
