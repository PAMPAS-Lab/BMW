import {finiteNumber,mediaRecord} from './media-contract.js'

/** An explicit empty segment array is silence; omission retains legacy playback. */
/** Playback pieces retain the original audio clock and immutable local identity. */
export interface NarrationTiming {startSeconds:number;sourceStartSeconds:number;durationSeconds:number;playbackRate:number}
export interface NarrationSegment extends NarrationTiming {id:string}
export interface NarrationClock {voiceTiming?:NarrationTiming;voiceSegments?:NarrationSegment[]}
export interface NarrationRange {start:number;end:number;sourceStart:number;sourceEnd:number}
const timingFields=['startSeconds','sourceStartSeconds','durationSeconds','playbackRate']
export const narrationTimingSchema={type:'object',additionalProperties:false,required:timingFields,properties:{startSeconds:{type:'number',minimum:0,maximum:60},sourceStartSeconds:{type:'number',minimum:0,maximum:180},durationSeconds:{type:'number',minimum:.1,maximum:60},playbackRate:{type:'number',minimum:.25,maximum:2}}}
export const narrationSegmentsSchema={type:'array',minItems:0,maxItems:8,items:{...narrationTimingSchema,required:['id',...timingFields],properties:{...narrationTimingSchema.properties,id:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'}}}}
function closed(value:Record<string,unknown>,fields:string[]):void{if(Object.keys(value).some(key=>!fields.includes(key)))throw new TypeError('Unsupported narration playback property.')}
export function assertNarrationTiming(raw:unknown):NarrationTiming {
 const value=mediaRecord(raw);closed(value,timingFields)
 return {startSeconds:finiteNumber(value.startSeconds,'voice start',0,60),sourceStartSeconds:finiteNumber(value.sourceStartSeconds,'voice source start',0,180),durationSeconds:finiteNumber(value.durationSeconds,'voice playback duration',.1,60),playbackRate:finiteNumber(value.playbackRate,'voice playback rate',.25,2)}
}
export function assertNarrationSegments(raw:unknown,sceneDuration=60):NarrationSegment[]{
 if(!Array.isArray(raw)||raw.length>8)throw new TypeError('旁白支持零至八个播放片段；空数组明确表示此镜头不播放旁白。')
 const ids=new Set<string>();let end=0
 return raw.map(raw=>{const v=mediaRecord(raw);closed(v,['id',...timingFields]);if(typeof v.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.id)||ids.has(v.id))throw new TypeError('Invalid or duplicate narration segment identity.');ids.add(v.id)
  const {id,...timing}=v,parsed=assertNarrationTiming(timing)
  if(parsed.startSeconds<end-.000001)throw new TypeError('旁白片段须按播放时间排序且不得重叠。')
  end=parsed.startSeconds+parsed.durationSeconds;if(end>sceneDuration+.000001)throw new TypeError('Voice playback must fit the scene.')
  return {id:id as string,...parsed}
 })
}
export function narrationWindows(scene:NarrationClock&{durationSeconds:number},sourceDuration:number):NarrationTiming[]{
 if(!Number.isFinite(sourceDuration)||sourceDuration<=0)throw new Error('旁白需要实测源音频时长。')
 if(scene.voiceTiming!==undefined&&scene.voiceSegments!==undefined)throw new TypeError('Choose voice timing or narration segments, not both.')
 const timings=scene.voiceSegments?assertNarrationSegments(scene.voiceSegments,scene.durationSeconds):[scene.voiceTiming?assertNarrationTiming(scene.voiceTiming):{startSeconds:.5,sourceStartSeconds:0,durationSeconds:sourceDuration,playbackRate:1}]
 for(const timing of timings){
  if(timing.startSeconds+timing.durationSeconds>scene.durationSeconds+.000001||(!scene.voiceTiming&&!scene.voiceSegments&&sourceDuration>scene.durationSeconds-1+.000001))throw new Error('旁白实测音频的播放区间超过镜头；请延长镜头或明确修剪旁白。')
  if(timing.sourceStartSeconds+timing.durationSeconds*timing.playbackRate>sourceDuration+.001)throw new Error('旁白源区间超过实测原音频；原值保留。')
 }
 return timings
}
/** Legacy single-window consumers must never silently flatten a split voice. */
export function narrationWindow(scene:NarrationClock&{durationSeconds:number},sourceDuration:number):NarrationTiming {
 const timings=narrationWindows(scene,sourceDuration);if(timings.length!==1)throw new Error('请选择具体旁白片段。');return timings[0]
}
export function narrationSceneTime(scene:NarrationClock,sourceSeconds:number):number {
 if(!Number.isFinite(sourceSeconds))throw new TypeError('Invalid original narration timestamp.')
 if(!scene.voiceTiming&&!scene.voiceSegments)return .5+sourceSeconds
 const timings=scene.voiceSegments?assertNarrationSegments(scene.voiceSegments):[assertNarrationTiming(scene.voiceTiming)]
 const times=timings.filter(t=>sourceSeconds>=t.sourceStartSeconds-.000001&&sourceSeconds<=t.sourceStartSeconds+t.durationSeconds*t.playbackRate+.000001).map(t=>t.startSeconds+(sourceSeconds-t.sourceStartSeconds)/t.playbackRate)
 if(!times.length)throw new Error('STUDIO_SPEECH_RANGE: 句锚点位于旁白修剪区间外；请先明确调整锚点或字幕关联。')
 if(times.some(t=>Math.abs(t-times[0])>.000001))throw new Error('STUDIO_SPEECH_RANGE: 原句在多个播放片段中出现，请使用区间投影。')
 return times[0]
}
/** A sentence keeps its original text; projection never invents word timestamps. */
export function narrationSceneRanges(scene:NarrationClock,sourceStart:number,sourceEnd:number):NarrationRange[]{
 if(!Number.isFinite(sourceStart)||!Number.isFinite(sourceEnd)||sourceStart<0||sourceEnd<=sourceStart)throw new TypeError('Invalid original narration range.')
 if(!scene.voiceSegments)return [{start:narrationSceneTime(scene,sourceStart),end:narrationSceneTime(scene,sourceEnd),sourceStart,sourceEnd}]
 const ranges=assertNarrationSegments(scene.voiceSegments).flatMap(t=>{const a=Math.max(sourceStart,t.sourceStartSeconds),b=Math.min(sourceEnd,t.sourceStartSeconds+t.durationSeconds*t.playbackRate);return b>a+.0000001?[{start:t.startSeconds+(a-t.sourceStartSeconds)/t.playbackRate,end:t.startSeconds+(b-t.sourceStartSeconds)/t.playbackRate,sourceStart:a,sourceEnd:b}]:[]})
 const merged:NarrationRange[]=[]
 for(const range of ranges){const previous=merged.at(-1);if(previous&&Math.abs(previous.end-range.start)<.000001&&Math.abs(previous.sourceEnd-range.sourceStart)<.000001){previous.end=range.end;previous.sourceEnd=range.sourceEnd}else merged.push({...range})}
 return merged
}

/** Native receipts report the measured full source, never the clipped playback duration. */
export function assertNarrationReceipt(scenes:(NarrationClock&{durationSeconds:number;audioArtifactId?:string})[],raw:unknown):number[]{
 if(!Array.isArray(raw)||raw.length!==scenes.length)throw new TypeError('Missing narration timing receipt.')
 return raw.map((value,index)=>{const duration=finiteNumber(value,'narration duration',0,180),scene=scenes[index];if(scene.audioArtifactId)narrationWindows(scene,duration);else if(duration!==0)throw new TypeError('A scene without narration cannot report source audio.');return duration})
}
