import {assertNarrationSegments,narrationWindows,narrationSegmentsSchema} from '../../media-native/src/composition-contract.js'
import type {NarrationSegment} from '../../media-native/src/composition-contract.js'
import {mediaRecord} from '../../media-native/src/media-contract.js'
import type {StudioScene} from './studio-contract.js'
/** Host-derived original playback only, never a new acoustic timing approval. */
export interface StudioSpeechPlaybackOrigin {voiceSegments:NarrationSegment[];clock:string}
export function studioSpeechOriginClock(scene:StudioScene):string {
 if(!scene.audioArtifactId||scene.audioDurationSeconds===undefined)throw new Error('STUDIO_SPEECH_ORIGIN: 原始旁白播放需要实测音频。')
 const windows=narrationWindows(scene,scene.audioDurationSeconds),merged:typeof windows=[]
 for(const value of windows){const previous=merged.at(-1);if(previous&&previous.playbackRate===value.playbackRate&&Math.abs(previous.startSeconds+previous.durationSeconds-value.startSeconds)<.000001&&Math.abs(previous.sourceStartSeconds+previous.durationSeconds*previous.playbackRate-value.sourceStartSeconds)<.000001)previous.durationSeconds+=value.durationSeconds;else merged.push({...value})}
 const round=(value:number)=>Math.round(value*1e6)/1e6
 return JSON.stringify({audio:scene.audioArtifactId,duration:round(scene.audioDurationSeconds),windows:merged.map(v=>[v.startSeconds,v.sourceStartSeconds,v.durationSeconds,v.playbackRate].map(round))})
}
export function assertStudioSpeechOrigin(raw:unknown,scene:StudioScene):StudioSpeechPlaybackOrigin {
 const value=mediaRecord(raw)
 if(Object.keys(value).some(k=>!['voiceSegments','clock'].includes(k))||typeof value.clock!=='string'||value.clock.length>2000||!scene.presentationWindow)throw new TypeError('Invalid Studio speech playback origin.')
 const voiceSegments=assertNarrationSegments(value.voiceSegments,scene.presentationWindow.durationSeconds)
 if(scene.audioDurationSeconds===undefined||!scene.audioArtifactId)throw new TypeError('Speech playback origin requires measured original audio.')
 narrationWindows({durationSeconds:scene.presentationWindow.durationSeconds,voiceSegments},scene.audioDurationSeconds)
 return {voiceSegments,clock:value.clock}
}
export function checkStudioSpeechOrigin(scene:StudioScene):void {
 if(scene.speechPlaybackOrigin&&studioSpeechOriginClock(scene)!==scene.speechPlaybackOrigin.clock)throw new Error('STUDIO_SPEECH_ORIGIN: 原旁白播放区间已变化，请先明确重新绑定或解除句引用；原输入保留。')
}
export function captureStudioSpeechOrigin(scene:StudioScene):StudioSpeechPlaybackOrigin {
 if(scene.speechPlaybackOrigin){checkStudioSpeechOrigin(scene);return structuredClone(scene.speechPlaybackOrigin)}
 if(!scene.presentationWindow)throw new Error('STUDIO_SPEECH_ORIGIN: 缺少原镜头时钟。')
 const clock=studioSpeechOriginClock(scene),start=scene.presentationWindow.startSeconds
 return assertStudioSpeechOrigin({clock,voiceSegments:narrationWindows(scene,scene.audioDurationSeconds!).map((v,i)=>({...v,id:scene.voiceSegments?.[i]?.id??crypto.randomUUID(),startSeconds:v.startSeconds+start}))},scene)
}
export const studioSpeechOriginSchema={type:'object',additionalProperties:false,required:['voiceSegments','clock'],properties:{voiceSegments:narrationSegmentsSchema,clock:{type:'string',maxLength:2000}}}
