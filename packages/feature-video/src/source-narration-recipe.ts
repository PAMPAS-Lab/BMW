import {finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {estimatedCaptionCues,narrationWindows} from '../../media-native/src/composition-contract.js'
import {assertVideoDraft,sceneCoverage} from './studio-contract.js'
import {speechCaptionCues} from './studio-speech-contract.js'
import type {VideoDraft} from './studio-contract.js'
export interface SourceNarrationRecipe {leadSeconds:number;sourceVolume:number;voiceVolume:number;fitToVoice:boolean;allowEndHold:boolean;captions:'preserve'|'original-then-voice';voiceCaptionTiming:'anchors'|'estimated'}
export function assertSourceNarrationRecipe(raw:unknown):SourceNarrationRecipe {
 const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['leadSeconds','sourceVolume','voiceVolume','fitToVoice','allowEndHold','captions','voiceCaptionTiming'].includes(k))||typeof v.fitToVoice!=='boolean'||typeof v.allowEndHold!=='boolean'||!['preserve','original-then-voice'].includes(String(v.captions))||!['anchors','estimated'].includes(String(v.voiceCaptionTiming)))throw new TypeError('Unsupported original-to-narration recipe.')
 return {leadSeconds:finiteNumber(v.leadSeconds,'original audio lead',.1,20),sourceVolume:finiteNumber(v.sourceVolume,'original audio volume',0,2),voiceVolume:finiteNumber(v.voiceVolume,'narration volume',0,2),fitToVoice:v.fitToVoice,allowEndHold:v.allowEndHold,captions:v.captions as SourceNarrationRecipe['captions'],voiceCaptionTiming:v.voiceCaptionTiming as SourceNarrationRecipe['voiceCaptionTiming']}
}
/** A bounded macro over existing scene/visual/voice/caption fields. No source
 * bytes or voice generation are rewritten, and no hidden timing authority exists. */
export function sourceNarrationDraft(value:VideoDraft,sceneId:string,recipe:SourceNarrationRecipe,measurements:{sourceStartSeconds:number;sourceEndSeconds:number;audioDurationSeconds:number}):{draft:VideoDraft;sourceCaptionSnapshot:unknown;captionTiming:string} {
 recipe=assertSourceNarrationRecipe(recipe)
 const next=structuredClone(value),scene=next.scenes.find(s=>s.id===sceneId);if(!scene)throw new Error('Unknown source narration scene.')
 if(!scene.videoArtifactId||scene.visualSegments||scene.presentationWindow||scene.speechPlaybackOrigin)throw new Error('原声转解说配方需要尚未分割的单段视频；已有布局可使用主轨编辑或撤销后重新应用。')
 if(!scene.audioArtifactId||!scene.narration.trim()||sceneCoverage(scene,next.tts).audioStale)throw new Error('请先为当前中文脚本绑定有效旁白。')
 if(scene.sourceStartSeconds<measurements.sourceStartSeconds||scene.sourceStartSeconds>=measurements.sourceEndSeconds)throw new Error('原声配方起点不在实际视频范围内。')
 if(recipe.fitToVoice&&(scene.layers?.length||scene.audioTracks?.length||next.layers?.length||next.audioTracks?.length))throw new Error('请先确认独立对象时间，再使用固定镜头长度配方；自动调长不会改写独立轨道。')
 const voices=narrationWindows(scene,measurements.audioDurationSeconds);if(voices.length!==1)throw new Error('原声配方使用一段连续旁白；请先确认旁白播放区间。')
 const voice={...voices[0],startSeconds:recipe.leadSeconds},required=voice.startSeconds+voice.durationSeconds,duration=recipe.fitToVoice?Math.ceil((required+2/next.fps)*next.fps)/next.fps:scene.durationSeconds
 if(duration>60||duration<required||duration-recipe.leadSeconds<.1)throw new Error('请给原声和旁白保留完整播放时间；每镜最多60秒。')
 if(scene.sourceStartSeconds+recipe.leadSeconds*scene.playbackRate>measurements.sourceEndSeconds||!recipe.allowEndHold&&scene.sourceStartSeconds+duration*scene.playbackRate>measurements.sourceEndSeconds)throw new Error('原视频不足以覆盖配方，请缩短旁白、换素材或明确允许末帧停留。')
 const base={videoArtifactId:scene.videoArtifactId,sourceStartSeconds:scene.sourceStartSeconds,sourceDurationSeconds:measurements.sourceEndSeconds,playbackRate:scene.playbackRate,zoom:scene.zoom,crop:scene.crop,effects:scene.effects,focusIntervals:scene.focusIntervals,transition:'cut' as const,transitionSeconds:.1},originId=crypto.randomUUID(),leftId=crypto.randomUUID(),rightId=crypto.randomUUID()
 scene.visualSegments=[{...base,id:leftId,durationSeconds:recipe.leadSeconds,keepSourceAudio:true,sourceVolume:recipe.sourceVolume,effectWindow:{originId,startSeconds:0,durationSeconds:duration,fadeInSeconds:0,fadeOutSeconds:0}},{...base,id:rightId,durationSeconds:duration-recipe.leadSeconds,sourceStartSeconds:base.sourceStartSeconds+recipe.leadSeconds*base.playbackRate,keepSourceAudio:false,sourceVolume:recipe.sourceVolume,effectWindow:{originId,startSeconds:recipe.leadSeconds,durationSeconds:duration,fadeInSeconds:0,fadeOutSeconds:0}}]
 const sourceCaptionSnapshot=scene.sourceCaptionBinding?structuredClone(scene.sourceCaptionBinding):null
 scene.durationSeconds=duration;scene.audioDurationSeconds=measurements.audioDurationSeconds;scene.voiceTiming=voice;delete scene.voiceSegments;scene.voiceMuted=false;scene.voiceVolume=recipe.voiceVolume;scene.endPolicy=recipe.allowEndHold?'hold':'require-footage'
 for(const key of ['videoArtifactId','sourceDurationSeconds','effects','focusIntervals'] as const)delete scene[key]
 if(scene.speechLinks?.focus.length)throw new Error('请先解除按句聚焦，再应用原声配方；已有手工焦点和源素材保留。')
 let captionTiming='independently-edited'
 if(recipe.captions==='original-then-voice'){
  const original=scene.sourceCaptionBinding?(scene.captions??[]).filter(c=>c.startSeconds<recipe.leadSeconds).map(c=>({...c,endSeconds:Math.min(c.endSeconds,recipe.leadSeconds)})):[]
  const narration=recipe.voiceCaptionTiming==='anchors'?speechCaptionCues({...scene,captions:undefined}):estimatedCaptionCues(scene,next.width,next.height,measurements.audioDurationSeconds)
  scene.captions=[...original,...narration].sort((a,b)=>a.startSeconds-b.startSeconds);if(scene.captions.length>100)throw new Error('配方字幕超过100段，请减少或独立编辑。');scene.captionDisplay='bilingual';scene.speechCaptions=false;delete scene.sourceCaptionBinding;captionTiming=recipe.voiceCaptionTiming==='anchors'?'edited-audio-anchors':'estimated-sentence-timing'
 }else if(scene.sourceCaptionBinding)throw new Error('保留原声关联字幕时，请先明确解除关联；合并模式会保存原始关联到来源回执。')
 return {draft:assertVideoDraft(next),sourceCaptionSnapshot,captionTiming}
}
export const sourceNarrationRecipeSchema={type:'object',additionalProperties:false,required:['leadSeconds','sourceVolume','voiceVolume','fitToVoice','allowEndHold','captions','voiceCaptionTiming'],properties:{leadSeconds:{type:'number',minimum:.1,maximum:20},sourceVolume:{type:'number',minimum:0,maximum:2},voiceVolume:{type:'number',minimum:0,maximum:2},fitToVoice:{type:'boolean'},allowEndHold:{type:'boolean'},captions:{enum:['preserve','original-then-voice']},voiceCaptionTiming:{enum:['anchors','estimated']}}}
