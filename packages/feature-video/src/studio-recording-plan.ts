import {finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {assertVideoDraft} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'
export interface EditedRecordingSegment {startSeconds:number;endSeconds:number;kind:'operation'|'wait-candidate'|'result-candidate'|'unclassified';rate:1|2;mute:boolean}
export function assertEditedRecordingPlan(raw:unknown):EditedRecordingSegment[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>8)throw new TypeError('Recording edits accept one to eight source segments.')
 return raw.map(raw=>{const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['startSeconds','endSeconds','kind','rate','mute'].includes(k))||!['operation','wait-candidate','result-candidate','unclassified'].includes(String(v.kind))||typeof v.rate!=='number'||![1,2].includes(v.rate)||typeof v.mute!=='boolean')throw new TypeError('Unsupported recording plan segment.');const startSeconds=finiteNumber(v.startSeconds,'recording segment start',0,1800),endSeconds=finiteNumber(v.endSeconds,'recording segment end',startSeconds+.1,1800);return {startSeconds,endSeconds,kind:v.kind as EditedRecordingSegment['kind'],rate:v.rate as 1|2,mute:v.mute}})
}
/** Compression is an explicit source-only edit before narration/captions. It
 * cannot silently retime authored speech, overlays or cross-scene objects. */
export function recordingPlanDraft(value:VideoDraft,sceneId:string,segments:EditedRecordingSegment[]):VideoDraft {
 segments=assertEditedRecordingPlan(segments)
 const next=structuredClone(value),scene=next.scenes.find(s=>s.id===sceneId)
 if(!scene?.videoArtifactId||scene.visualSegments||scene.presentationWindow||scene.audioArtifactId||scene.focusIntervals?.length||scene.narration.trim()||scene.captions?.length||scene.sourceCaptionBinding||scene.speechLinks||scene.layers?.length||scene.audioTracks?.length||next.layers?.length||next.audioTracks?.length)throw new Error('请在添加旁白、字幕和独立对象前整理未分割的录屏；已有编辑必须先明确处理。')
 const start=scene.sourceStartSeconds,end=start+scene.durationSeconds*scene.playbackRate
 if(Math.abs(segments[0].startSeconds-start)>.000001||Math.abs(segments.at(-1)!.endSeconds-end)>.000001||segments.some((s,i)=>i>0&&Math.abs(s.startSeconds-segments[i-1].endSeconds)>.000001))throw new Error('录屏分段必须连续覆盖当前原素材区间，不能丢掉操作或结果。')
 if(scene.sourceDurationSeconds!==undefined&&end>scene.sourceDurationSeconds)throw new Error('请先移除末帧停留区间，再整理录屏。')
 const original=scene.videoArtifactId;scene.visualSegments=segments.map(s=>({id:crypto.randomUUID(),videoArtifactId:original,sourceStartSeconds:s.startSeconds,sourceDurationSeconds:scene.sourceDurationSeconds,durationSeconds:(s.endSeconds-s.startSeconds)/s.rate,playbackRate:s.rate,zoom:scene.zoom,crop:scene.crop,effects:scene.effects,focusIntervals:scene.focusIntervals,transition:'cut',transitionSeconds:.1,keepSourceAudio:!s.mute&&(scene.keepSourceAudio??false),sourceVolume:scene.sourceVolume??1}));scene.durationSeconds=scene.visualSegments.reduce((n,s)=>n+s.durationSeconds,0)
 for(const key of ['videoArtifactId','sourceDurationSeconds','effects','focusIntervals'] as const)delete scene[key]
 return assertVideoDraft(next)
}
export const editedRecordingPlanSchema={type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['startSeconds','endSeconds','kind','rate','mute'],properties:{startSeconds:{type:'number',minimum:0,maximum:1800},endSeconds:{type:'number',minimum:.1,maximum:1800},kind:{enum:['operation','wait-candidate','result-candidate','unclassified']},rate:{enum:[1,2]},mute:{type:'boolean'}}}}
