import {speechCaptionCues,usesSpeechCaptions,speechScene} from './studio-speech-contract.js'
import {visibleFocusIntervals} from '../../media-native/src/focus-contract.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import {estimatedCaptionCues,narrationWindows,narrationSceneTime} from '../../media-native/src/composition-contract.js'
import {sceneCoverage} from './studio-contract.js'
import type {VideoDraft,StudioScene} from './studio-contract.js'
type StudioSceneCues=NonNullable<VideoDraft['scenes'][number]['captions']>
function annotationTime(scene:StudioScene,source:number):number{try{return narrationSceneTime(scene,source)}catch{return Number.NaN}}
export type StudioTimelineKind='scene'|'visual'|'voice'|'caption'|'focus'|'reveal'
export interface StudioTimelineClip {kind:StudioTimelineKind;sceneIndex:number;sceneId:string;itemIndex?:number;voiceSegmentId?:string;visualSegmentId?:string;start:number;end:number;label:string;estimated?:boolean;stale?:boolean;origin?:string}
/** A projection of canonical main clips and explicit voice playback timing. */
export function studioTimeline(draft:VideoDraft):{duration:number;clips:StudioTimelineClip[]}{
  let start=0;const clips:StudioTimelineClip[]=[]
  for(const [sceneIndex,scene] of draft.scenes.entries()){
    const end=start+scene.durationSeconds
    clips.push({kind:'scene',sceneId:scene.id,sceneIndex,start,end,label:scene.title})
    let projected=scene
    try{projected=speechScene(scene)}catch{/* Keep independent content; invalid references have no invented times. */}
    const origin=scene.speechAnchors?.origin==='user-edited'?'用户编辑':scene.speechAnchors?.origin==='agent-edited'?'Agent 编辑':undefined
    for(const [i,time]of (projected.bulletRevealSeconds??[]).entries())if(scene.speechLinks?.bullets.some(b=>b.bulletIndex===i))clips.push({kind:'reveal',sceneId:scene.id,sceneIndex,start:start+time,end,label:scene.bullets[i],origin})
    let segmentStart=start
    for(const [index,segment] of sceneVisuals(projected).entries()){
      const segmentEnd=Math.min(end,segmentStart+segment.durationSeconds)
      if(segment.videoArtifactId||segment.imageArtifactId)clips.push({kind:'visual',sceneId:scene.id,sceneIndex,itemIndex:index,...(scene.visualSegments?.[index]?.id?{visualSegmentId:scene.visualSegments[index].id}:{}),start:segmentStart,end:segmentEnd,label:`${index+1} · ${segment.imageArtifactId??segment.videoArtifactId}${segment.videoArtifactId&&segment.keepSourceAudio===false?' · 原声关闭':''}`})
      for(const item of visibleFocusIntervals(segment,segment.durationSeconds))clips.push({kind:'focus',sceneId:scene.id,sceneIndex,start:segmentStart+item.start,end:segmentStart+item.end,label:`焦点 ×${item.focus.zoom.toFixed(1)}${item.focus.emphasize?' · 强调':''}`,origin:scene.speechLinks?.focus.some(f=>f.visualIndex===index&&f.anchorId&&scene.speechAnchors?.anchors.some(a=>a.id===f.anchorId&&Math.abs(annotationTime(scene,a.startSeconds)-(segmentStart-start+item.start))<.001))?origin:undefined})
      segmentStart=segmentEnd
    }
    if(scene.audioArtifactId){try{const timings=narrationWindows(scene,scene.audioDurationSeconds??Math.max(.01,scene.durationSeconds-1));for(const [index,timing]of timings.entries())clips.push({kind:'voice',sceneId:scene.id,sceneIndex,...(scene.voiceSegments?{voiceSegmentId:scene.voiceSegments[index].id}:{}),start:start+timing.startSeconds,end:start+timing.startSeconds+timing.durationSeconds,label:(scene.voiceSegments?'旁白 '+(index+1):'旁白')+(scene.voiceMuted?' · 静音':''),stale:sceneCoverage(scene,draft.tts).audioStale})}catch{/* Do not invent a clipped interval for invalid audio timing. */}}
    let anchorCues:StudioSceneCues|undefined
    if(usesSpeechCaptions(scene)){try{anchorCues=speechCaptionCues(scene)}catch{anchorCues=[]}}
    try{
    for(const [itemIndex,cue] of (scene.captions??anchorCues??estimatedCaptionCues(scene,draft.width,draft.height,scene.audioDurationSeconds??scene.durationSeconds-1)).entries())clips.push({kind:'caption',sceneId:scene.id,sceneIndex,itemIndex,start:start+cue.startSeconds,end:start+cue.endSeconds,label:cue.text,estimated:scene.captions===undefined&&!anchorCues,...(anchorCues?{origin}:{})})
    }catch{/* Invalid derived timing is a readiness issue, never an invented subtitle interval. */}
    start=end
  }
  return {duration:start,clips}
}
export function studioSceneIndex(draft:VideoDraft,time:number):number{
  if(!draft.scenes.length)return -1
  let end=0;for(const [index,scene]of draft.scenes.entries()){end+=scene.durationSeconds;if(time<end)return index}
  return draft.scenes.length-1
}
