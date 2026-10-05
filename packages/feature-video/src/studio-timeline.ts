import {speechCaptionCues,usesSpeechCaptions,speechScene} from './studio-speech-contract.js'
import {visibleFocusIntervals} from '../../media-native/src/focus-contract.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import {estimatedCaptionCues} from '../../media-native/src/composition-contract.js'
import {sceneCoverage} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'
type StudioSceneCues=NonNullable<VideoDraft['scenes'][number]['captions']>
export type StudioTimelineKind='scene'|'visual'|'voice'|'caption'|'focus'|'reveal'
export interface StudioTimelineClip {kind:StudioTimelineKind;sceneIndex:number;start:number;end:number;label:string;estimated?:boolean;stale?:boolean;origin?:string}
/** A projection of existing sequential content; no additional tracks are persisted. */
export function studioTimeline(draft:VideoDraft):{duration:number;clips:StudioTimelineClip[]}{
  let start=0;const clips:StudioTimelineClip[]=[]
  for(const [sceneIndex,scene] of draft.scenes.entries()){
    const end=start+scene.durationSeconds
    clips.push({kind:'scene',sceneIndex,start,end,label:scene.title})
    let projected=scene
    try{projected=speechScene(scene)}catch{/* Keep independent content; invalid references have no invented times. */}
    const origin=scene.speechAnchors?.origin==='user-edited'?'用户编辑':scene.speechAnchors?.origin==='agent-edited'?'Agent 编辑':undefined
    for(const [i,time]of (projected.bulletRevealSeconds??[]).entries())if(scene.speechLinks?.bullets.some(b=>b.bulletIndex===i))clips.push({kind:'reveal',sceneIndex,start:start+time,end,label:scene.bullets[i],origin})
    let segmentStart=start
    for(const [index,segment] of sceneVisuals(projected).entries()){
      const segmentEnd=Math.min(end,segmentStart+segment.durationSeconds)
      if(segment.videoArtifactId||segment.imageArtifactId)clips.push({kind:'visual',sceneIndex,start:segmentStart,end:segmentEnd,label:`${index+1} · ${segment.imageArtifactId??segment.videoArtifactId}`})
      for(const item of visibleFocusIntervals(segment,segment.durationSeconds))clips.push({kind:'focus',sceneIndex,start:segmentStart+item.start,end:segmentStart+item.end,label:`焦点 ×${item.focus.zoom.toFixed(1)}${item.focus.emphasize?' · 强调':''}`,origin:scene.speechLinks?.focus.some(f=>f.visualIndex===index&&f.anchorId&&scene.speechAnchors?.anchors.some(a=>a.id===f.anchorId&&Math.abs(.5+a.startSeconds-(segmentStart-start+item.start))<.001))?origin:undefined})
      segmentStart=segmentEnd
    }
    if(scene.audioArtifactId)clips.push({kind:'voice',sceneIndex,start:start+.5,end:Math.min(end,start+.5+(scene.audioDurationSeconds??scene.durationSeconds-.5)),label:'旁白',stale:sceneCoverage(scene,draft.tts).audioStale})
    let anchorCues:StudioSceneCues|undefined
    if(usesSpeechCaptions(scene)){try{anchorCues=speechCaptionCues(scene)}catch{anchorCues=[]}}
    for(const cue of scene.captions??anchorCues??estimatedCaptionCues(scene,draft.width,draft.height,scene.audioDurationSeconds??scene.durationSeconds-1))clips.push({kind:'caption',sceneIndex,start:start+cue.startSeconds,end:start+cue.endSeconds,label:cue.text,estimated:scene.captions===undefined&&!anchorCues,...(anchorCues?{origin}:{})})
    start=end
  }
  return {duration:start,clips}
}
export function studioSceneIndex(draft:VideoDraft,time:number):number{
  if(!draft.scenes.length)return -1
  let end=0;for(const [index,scene]of draft.scenes.entries()){end+=scene.durationSeconds;if(time<end)return index}
  return draft.scenes.length-1
}
