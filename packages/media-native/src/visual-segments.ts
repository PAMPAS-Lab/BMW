import {focusIntervalsSchema} from './focus-contract.js'
import type {FocusInterval} from './focus-contract.js'
import {assertComposition} from './composition-contract.js'
import type {CompositionScene} from './composition-contract.js'
import {finiteNumber,mediaRecord} from './media-contract.js'
export interface VisualSegment {
  focusIntervals?:FocusInterval[]
  durationSeconds:number;imageArtifactId?:string;videoArtifactId?:string;sourceStartSeconds:number;playbackRate:number;zoom:number
  crop?:CompositionScene['crop'];keepSourceAudio?:boolean;sourceVolume?:number;sourceDurationSeconds?:number
  transition:'cut'|'fade';transitionSeconds:number
}
export const visualSegmentsSchema={type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['durationSeconds'],properties:{focusIntervals:focusIntervalsSchema,durationSeconds:{type:'number',minimum:.1,maximum:60},imageArtifactId:{type:'string'},videoArtifactId:{type:'string'},sourceStartSeconds:{type:'number',minimum:0,maximum:1800},sourceDurationSeconds:{type:'number',minimum:.01,maximum:1800},playbackRate:{type:'number',minimum:.25,maximum:2},zoom:{type:'number',minimum:1,maximum:1.5},keepSourceAudio:{type:'boolean'},sourceVolume:{type:'number',minimum:0,maximum:2},crop:{type:'object',additionalProperties:false,required:['x','y','width','height'],properties:{x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'}}},transition:{type:'string',enum:['cut','fade']},transitionSeconds:{type:'number',minimum:.05,maximum:1}}}}
export function assertVisualSegments(raw:unknown,duration:number):VisualSegment[] {
  if(!Array.isArray(raw)||!raw.length||raw.length>8)throw new Error('A scene supports 1 to 8 visual segments.')
  const segments=raw.map(item=>{
    const value=mediaRecord(item),keys=['durationSeconds','imageArtifactId','videoArtifactId','sourceStartSeconds','sourceDurationSeconds','playbackRate','zoom','crop','keepSourceAudio','sourceVolume','transition','transitionSeconds','focusIntervals']
    if(Object.keys(value).some(key=>!keys.includes(key))||Boolean(value.imageArtifactId)===Boolean(value.videoArtifactId))throw new Error('Each segment needs exactly one Project image or video.')
    const durationSeconds=finiteNumber(value.durationSeconds,'segment duration',.1,60)
    const shared={...value};for(const key of ['sourceDurationSeconds','transition','transitionSeconds'])delete shared[key]
    // Reuse the closed crop/rate/audio contract; subsecond segments are admitted here.
    const scene=assertComposition({title:'Segment',music:false,scenes:[{...shared,title:'Segment',durationSeconds:Math.max(1,durationSeconds)}]}).scenes[0]
    if(value.transition!==undefined&&!['cut','fade'].includes(String(value.transition)))throw new Error('Invalid segment transition.')
    const transitionSeconds=finiteNumber(value.transitionSeconds??Math.min(.3,durationSeconds/2),'transition duration',.05,Math.min(1,durationSeconds/2))
    return {...(scene.focusIntervals?{focusIntervals:scene.focusIntervals}:{}),durationSeconds,imageArtifactId:scene.imageArtifactId,videoArtifactId:scene.videoArtifactId,sourceStartSeconds:scene.sourceStartSeconds,playbackRate:scene.playbackRate,zoom:scene.zoom,crop:scene.crop,keepSourceAudio:scene.keepSourceAudio,sourceVolume:scene.sourceVolume,transition:value.transition==='fade'?'fade' as const:'cut' as const,transitionSeconds,...(value.sourceDurationSeconds!==undefined?{sourceDurationSeconds:finiteNumber(value.sourceDurationSeconds,'source duration',.01,1800)}:{})}
  })
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
      const fadeOut=next&&'transition' in next&&next.transition==='fade'?Math.min(1,(segment.durationSeconds-localSeconds)/Math.min(next.transitionSeconds,segment.durationSeconds/2)):1
      return {segment,index,localSeconds,opacity:Math.max(0,Math.min(fadeIn,fadeOut))}
    }start+=segment.durationSeconds
  }
}
/** Preserve each segment's relative allocation after measured narration changes. */
export function fitVisualSegments(segments:VisualSegment[],duration:number):void {
  const total=segments.reduce((sum,item)=>sum+item.durationSeconds,0)
  let used=0
  for(const [index,segment] of segments.entries()){
    segment.durationSeconds=index===segments.length-1?duration-used:segment.durationSeconds/total*duration;used+=segment.durationSeconds
    if(segment.durationSeconds<.1)throw new Error('Scene is too short for this many visual segments.')
    segment.transitionSeconds=Math.min(segment.transitionSeconds,segment.durationSeconds/2)
  }
}
