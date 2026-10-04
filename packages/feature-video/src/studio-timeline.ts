import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import {estimatedCaptionCues} from '../../media-native/src/composition-contract.js'
import {sceneCoverage} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'
export type StudioTimelineKind='scene'|'visual'|'voice'|'caption'
export interface StudioTimelineClip {kind:StudioTimelineKind;sceneIndex:number;start:number;end:number;label:string;estimated?:boolean;stale?:boolean}
/** A projection of existing sequential content; no additional tracks are persisted. */
export function studioTimeline(draft:VideoDraft):{duration:number;clips:StudioTimelineClip[]}{
  let start=0;const clips:StudioTimelineClip[]=[]
  for(const [sceneIndex,scene] of draft.scenes.entries()){
    const end=start+scene.durationSeconds
    clips.push({kind:'scene',sceneIndex,start,end,label:scene.title})
    let segmentStart=start
    for(const [index,segment] of sceneVisuals(scene).entries()){
      const segmentEnd=Math.min(end,segmentStart+segment.durationSeconds)
      if(segment.videoArtifactId||segment.imageArtifactId)clips.push({kind:'visual',sceneIndex,start:segmentStart,end:segmentEnd,label:`${index+1} · ${segment.imageArtifactId??segment.videoArtifactId}`})
      segmentStart=segmentEnd
    }
    if(scene.audioArtifactId)clips.push({kind:'voice',sceneIndex,start,end:Math.min(end,start+(scene.audioDurationSeconds??scene.durationSeconds)),label:'旁白',stale:sceneCoverage(scene,draft.tts).audioStale})
    for(const cue of scene.captions??estimatedCaptionCues(scene,draft.width,draft.height,scene.audioDurationSeconds??scene.durationSeconds-1))clips.push({kind:'caption',sceneIndex,start:start+cue.startSeconds,end:start+cue.endSeconds,label:cue.text,estimated:scene.captions===undefined})
    start=end
  }
  return {duration:start,clips}
}
export function studioSceneIndex(draft:VideoDraft,time:number):number{
  if(!draft.scenes.length)return -1
  let end=0;for(const [index,scene]of draft.scenes.entries()){end+=scene.durationSeconds;if(time<end)return index}
  return draft.scenes.length-1
}
