import {assertVisualEffects,visualEffectsSchema} from './visual-effects.js'
import type {VisualEffects} from './visual-effects.js'
import {focusIntervalsSchema,visualEffectWindowSchema,assertVisualEffectWindow} from './focus-contract.js'
import type {FocusInterval,VisualEffectWindow} from './focus-contract.js'
import {assertComposition} from './composition-contract.js'
import type {CompositionScene} from './composition-contract.js'
import {finiteNumber,mediaRecord} from './media-contract.js'
export interface VisualSegment {
  effects?:VisualEffects
  id?:string;effectWindow?:VisualEffectWindow
  focusIntervals?:FocusInterval[]
  durationSeconds:number;imageArtifactId?:string;videoArtifactId?:string;sourceStartSeconds:number;playbackRate:number;zoom:number
  crop?:CompositionScene['crop'];keepSourceAudio?:boolean;sourceVolume?:number;sourceDurationSeconds?:number
  transition:'cut'|'fade';transitionSeconds:number
}
export const visualSegmentsSchema={type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['durationSeconds'],properties:{effects:visualEffectsSchema,id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},effectWindow:visualEffectWindowSchema,focusIntervals:focusIntervalsSchema,durationSeconds:{type:'number',minimum:.1,maximum:60},imageArtifactId:{type:'string'},videoArtifactId:{type:'string'},sourceStartSeconds:{type:'number',minimum:0,maximum:1800},sourceDurationSeconds:{type:'number',minimum:.01,maximum:1800},playbackRate:{type:'number',minimum:.25,maximum:2},zoom:{type:'number',minimum:1,maximum:1.5},keepSourceAudio:{type:'boolean'},sourceVolume:{type:'number',minimum:0,maximum:2},crop:{type:'object',additionalProperties:false,required:['x','y','width','height'],properties:{x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'}}},transition:{type:'string',enum:['cut','fade']},transitionSeconds:{type:'number',minimum:.05,maximum:1}}}}
export function assertVisualSegments(raw:unknown,duration:number):VisualSegment[] {
  if(!Array.isArray(raw)||!raw.length||raw.length>8)throw new Error('A scene supports 1 to 8 visual segments.')
  const segments=raw.map(item=>{
    const value=mediaRecord(item),keys=['id','effects','effectWindow','durationSeconds','imageArtifactId','videoArtifactId','sourceStartSeconds','sourceDurationSeconds','playbackRate','zoom','crop','keepSourceAudio','sourceVolume','transition','transitionSeconds','focusIntervals']
    if(Object.keys(value).some(key=>!keys.includes(key))||Boolean(value.imageArtifactId)===Boolean(value.videoArtifactId))throw new Error('Each segment needs exactly one Project image or video.')
    const durationSeconds=finiteNumber(value.durationSeconds,'segment duration',.1,60)
    const shared={...value};for(const key of ['id','effectWindow','sourceDurationSeconds','transition','transitionSeconds'])delete shared[key]
    // Reuse the closed crop/rate/audio contract; subsecond segments are admitted here.
    const scene=assertComposition({title:'Segment',music:false,scenes:[{...shared,title:'Segment',durationSeconds:Math.max(1,durationSeconds)}]}).scenes[0]
    if(value.transition!==undefined&&!['cut','fade'].includes(String(value.transition)))throw new Error('Invalid segment transition.')
    const transitionSeconds=finiteNumber(value.transitionSeconds??Math.min(.3,durationSeconds/2),'transition duration',.05,Math.min(1,durationSeconds/2))
    if(value.id!==undefined&&(typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)))throw new Error('Invalid visual segment identity.')
    const effectWindow=value.effectWindow===undefined?undefined:assertVisualEffectWindow(value.effectWindow)
    if(effectWindow&&(effectWindow.startSeconds+durationSeconds>effectWindow.durationSeconds+.000001||effectWindow.opacityStartSeconds!==undefined&&effectWindow.opacityStartSeconds+durationSeconds>effectWindow.opacityDurationSeconds!+.000001))throw new Error('Visual playback exceeds its original effect window.')
    return {...(value.effects!==undefined?{effects:assertVisualEffects(value.effects)}:{}),...(value.id!==undefined?{id:value.id as string}:{}),...(effectWindow?{effectWindow}:{}),...(scene.focusIntervals?{focusIntervals:scene.focusIntervals}:{}),durationSeconds,imageArtifactId:scene.imageArtifactId,videoArtifactId:scene.videoArtifactId,sourceStartSeconds:scene.sourceStartSeconds,playbackRate:scene.playbackRate,zoom:scene.zoom,crop:scene.crop,keepSourceAudio:scene.keepSourceAudio,sourceVolume:scene.sourceVolume,transition:value.transition==='fade'?'fade' as const:'cut' as const,transitionSeconds,...(value.sourceDurationSeconds!==undefined?{sourceDurationSeconds:finiteNumber(value.sourceDurationSeconds,'source duration',.01,1800)}:{})}
  })
  const ids=segments.flatMap(v=>v.id?[v.id]:[]);if(new Set(ids).size!==ids.length)throw new Error('Duplicate visual segment identity.')
  if(Math.abs(segments.reduce((sum,item)=>sum+item.durationSeconds,0)-duration)>.00001)throw new Error('Visual segment durations must equal the scene duration.')
  return segments
}
export function sceneVisuals(scene:CompositionScene):(VisualSegment|CompositionScene&{sourceDurationSeconds?:number})[]{return scene.visualSegments??(scene.imageArtifactId||scene.videoArtifactId?[scene]:[])}
export function visualAtTime(scene:CompositionScene,time:number):{segment:ReturnType<typeof sceneVisuals>[number];index:number;localSeconds:number;opacity:number}|undefined {
  const visuals=sceneVisuals(scene);let start=0
  for(const [index,segment] of visuals.entries()){
    if(time<start+segment.durationSeconds||index===visuals.length-1){
      const localSeconds=Math.max(0,time-start),next=visuals[index+1]
      const fadeIn='transition' in segment&&segment.transition==='fade'?Math.min(1,localSeconds/segment.transitionSeconds):1
      const nextWindow=next&&'effectWindow' in next?next.effectWindow:undefined
      const outgoing=nextWindow?((nextWindow.opacityStartSeconds??nextWindow.startSeconds)===0?nextWindow.fadeInSeconds:0):next&&'transition' in next&&next.transition==='fade'?next.transitionSeconds:0
      const fadeOut=outgoing?Math.min(1,(segment.durationSeconds-localSeconds)/Math.min(outgoing,segment.durationSeconds/2)):1
      const window='effectWindow' in segment?segment.effectWindow:undefined,t=(window?.opacityStartSeconds??window?.startSeconds??0)+localSeconds
      const preservedIn=window?.fadeInSeconds?Math.min(1,t/window.fadeInSeconds):1,preservedOut=window?.fadeOutSeconds?Math.min(1,((window.opacityDurationSeconds??window.durationSeconds)-t)/window.fadeOutSeconds):1
      return {segment,index,localSeconds,opacity:Math.max(0,window?Math.min(preservedIn,preservedOut):Math.min(fadeIn,fadeOut))}
    }start+=segment.durationSeconds
  }
}
/** The original zoom ramp must not restart at a content cut. */
export function visualZoom(visual:ReturnType<typeof sceneVisuals>[number],localSeconds:number):number {
 const window='effectWindow' in visual?visual.effectWindow:undefined
 return 1+(visual.zoom-1)*Math.max(0,Math.min(1,((window?.startSeconds??0)+localSeconds)/(window?.durationSeconds??visual.durationSeconds)))
}
/** Maximal contiguous pieces of the same split source. Explicit trim/move/rate changes
 * break the group; unrelated equal filenames never create an association. */
export function visualPlaybackGroup(scene:CompositionScene,index:number):{index:number;endIndex:number;offset:number;sourceStartSeconds:number;durationSeconds:number;playbackRate:number;videoArtifactId?:string} {
 const visuals=sceneVisuals(scene),selected=visuals[index];if(!selected)throw new Error('Unknown visual segment.')
 const window='effectWindow' in selected?selected.effectWindow:undefined
 const contiguous=(a:typeof selected,b:typeof selected)=>{
  const wa='effectWindow' in a?a.effectWindow:undefined,wb='effectWindow' in b?b.effectWindow:undefined
  return Boolean(wa&&wb&&wa.originId===wb.originId&&wa.durationSeconds===wb.durationSeconds&&a.videoArtifactId===b.videoArtifactId&&a.imageArtifactId===b.imageArtifactId&&a.playbackRate===b.playbackRate&&Math.abs(wa.startSeconds+a.durationSeconds-wb.startSeconds)<.000001&&(!a.videoArtifactId||Math.abs(a.sourceStartSeconds+a.durationSeconds*a.playbackRate-b.sourceStartSeconds)<.000001))
 }
 let first=index,last=index;if(window){while(first>0&&contiguous(visuals[first-1],visuals[first]))first--;while(last+1<visuals.length&&contiguous(visuals[last],visuals[last+1]))last++;}
 const v=visuals[first]
 return {index:first,endIndex:last,offset:visuals.slice(0,first).reduce((n,v)=>n+v.durationSeconds,0),sourceStartSeconds:v.sourceStartSeconds,durationSeconds:visuals.slice(first,last+1).reduce((n,v)=>n+v.durationSeconds,0),playbackRate:v.playbackRate,videoArtifactId:v.videoArtifactId}
}
/** Preserve each segment's relative allocation after measured narration changes. */
export function fitVisualSegments(segments:VisualSegment[],duration:number):void {
  const total=segments.reduce((sum,item)=>sum+item.durationSeconds,0)
  const ratio=duration/total
  let used=0
  for(const [index,segment] of segments.entries()){
    segment.durationSeconds=index===segments.length-1?duration-used:segment.durationSeconds/total*duration;used+=segment.durationSeconds
    if(segment.durationSeconds<.1)throw new Error('Scene is too short for this many visual segments.')
    segment.transitionSeconds=Math.min(segment.transitionSeconds,segment.durationSeconds/2)
    if(segment.effectWindow){if(segment.effectWindow.opacityStartSeconds!==undefined){segment.effectWindow.opacityStartSeconds*=ratio;segment.effectWindow.opacityDurationSeconds!*=ratio;}segment.effectWindow.startSeconds*=ratio;segment.effectWindow.durationSeconds*=ratio;segment.effectWindow.fadeInSeconds=Math.min(1,segment.effectWindow.fadeInSeconds*ratio);segment.effectWindow.fadeOutSeconds=Math.min(1,segment.effectWindow.fadeOutSeconds*ratio);if(!segment.videoArtifactId)segment.focusIntervals=segment.focusIntervals?.map(f=>({...f,startSeconds:f.startSeconds*ratio,endSeconds:f.endSeconds*ratio}))}
  }
}
