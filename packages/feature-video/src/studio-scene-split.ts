import {captureStudioSpeechOrigin,studioSpeechOriginClock} from './studio-speech-origin.js'
import {partitionSourceSpeech} from './studio-source-speech-contract.js'
import {speechScene,usesSpeechCaptions,usesStudioSpeech} from './studio-speech-contract.js'
import {assertVideoDraft} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'
import type {StudioMainResult} from './studio-main-edits.js'
import {studioMainCues} from './studio-main-edits.js'
import {sliceStudioLayer} from './studio-layer-edits.js'
import {narrationWindows} from '../../media-native/src/composition-contract.js'
import {scenePlaybackClock} from '../../media-native/src/composition-contract.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import type {VisualSegment} from '../../media-native/src/visual-segments.js'
import {layerProblems} from '../../media-native/src/composition-layers.js'
import type {AudioLayer,VisualLayer} from '../../media-native/src/composition-layers.js'

const epsilon=.000001
/** Host transaction only. No source file, narration text or global clock is rewritten. */
export function splitStudioScene(value:VideoDraft,sceneId:string,cut:number):StudioMainResult {
 const next=structuredClone(value),index=next.scenes.findIndex(s=>s.id===sceneId),scene=next.scenes[index]
 if(!scene)throw new Error('镜头已删除，请重新选择。')
 if(!Number.isFinite(cut)||cut<1||scene.durationSeconds-cut<1)throw new Error('整镜头分割需要两侧各保留至少 1 秒。')
 if(next.scenes.length>=24)throw new Error('视频最多二十四个镜头。')
 if(usesStudioSpeech(scene))speechScene(scene)
 if(scene.audioArtifactId&&scene.audioDurationSeconds===undefined)throw new Error('请先检查并测量旁白，再分割整镜头。')
 const bounds=[...layerProblems(scene,scene.durationSeconds),...layerProblems(next,next.scenes.reduce((sum,s)=>sum+s.durationSeconds,0))]
 if(bounds.length)throw new Error('STUDIO_SPLIT_BOUNDS: 请先处理越界对象，再分割镜头。'+bounds.join('；'))
 const originalDuration=scene.durationSeconds,cues=studioMainCues(next,scene),visuals=sceneVisuals(scene)
 // Freeze every original chapter, including following title cards and music.
 for(const [i,s]of next.scenes.entries())if(!s.presentationWindow)s.presentationWindow={...scenePlaybackClock(s,i,next.scenes.length),originId:crypto.randomUUID()}
 const speechOrigin=scene.audioArtifactId&&(scene.speechAnchors||scene.speechCandidate||scene.speechPlaybackOrigin)?captureStudioSpeechOrigin(scene):undefined
 const left=structuredClone(scene),right=structuredClone(scene);right.id=crypto.randomUUID()
 left.durationSeconds=cut;right.durationSeconds=originalDuration-cut
 right.presentationWindow={...scene.presentationWindow!,startSeconds:scene.presentationWindow!.startSeconds+cut}
 const targets=[{scene:left,from:0,to:cut,visualIndices:[] as number[]},{scene:right,from:cut,to:originalDuration,visualIndices:[] as number[]}]
 const rootVisuals=visuals.map((visual,i)=>{
  const following=visuals[i+1],old='effectWindow' in visual?visual.effectWindow:undefined
  const nextWindow=following&&'effectWindow' in following?following.effectWindow:undefined
  const outgoing=nextWindow?(nextWindow.opacityStartSeconds??nextWindow.startSeconds)===0?nextWindow.fadeInSeconds:0:following&&'transition' in following&&following.transition==='fade'?following.transitionSeconds:0
  const effectWindow=old??{originId:crypto.randomUUID(),startSeconds:0,durationSeconds:visual.durationSeconds,fadeInSeconds:'transition' in visual&&visual.transition==='fade'?visual.transitionSeconds:0,fadeOutSeconds:Math.min(outgoing,visual.durationSeconds/2)}
  return {visual,id:scene.visualSegments&&'id' in visual&&visual.id?visual.id:crypto.randomUUID(),effectWindow}
 })
 const voice=scene.audioArtifactId?narrationWindows(scene,scene.audioDurationSeconds!).map((timing,i)=>({...timing,id:scene.voiceSegments?.[i]?.id??crypto.randomUUID()})):[]
 // A crossing object gets one root envelope; both pieces derive from it.
 const roots=<T extends VisualLayer|AudioLayer>(layers:T[]|undefined):T[]|undefined=>layers?.map(l=>({...l,fadeWindow:l.fadeWindow??{originId:crypto.randomUUID(),startSeconds:0,durationSeconds:l.durationSeconds}}))
 const layers=roots(scene.layers),audioTracks=roots(scene.audioTracks)
 for(const target of targets){
  const {from,to}=target,child=target.scene
  const fragments:VisualSegment[]=[];let visualStart=0
  for(const [originalIndex,{visual,id,effectWindow}]of rootVisuals.entries()){
   const a=Math.max(from,visualStart),b=Math.min(to,visualStart+visual.durationSeconds),elapsed=a-visualStart
   if(b-a>epsilon){
    if(b-a<.1-epsilon)throw new Error('切点产生了不足 0.1 秒的画面；请移动播放头。')
    if(visual.videoArtifactId&&visual.sourceDurationSeconds!==undefined&&visual.sourceStartSeconds+elapsed*visual.playbackRate>=visual.sourceDurationSeconds)throw new Error('STUDIO_SPLIT_HOLD: 切点位于素材末帧停留区间，暂不支持整镜头分割；请先调整画面。')
    target.visualIndices.push(originalIndex)
    fragments.push({effects:visual.effects,id:elapsed>epsilon?crypto.randomUUID():id,durationSeconds:b-a,imageArtifactId:visual.imageArtifactId,videoArtifactId:visual.videoArtifactId,sourceStartSeconds:visual.sourceStartSeconds+(visual.videoArtifactId?elapsed*visual.playbackRate:0),playbackRate:visual.playbackRate,zoom:visual.zoom,crop:visual.crop,keepSourceAudio:visual.keepSourceAudio,sourceVolume:visual.sourceVolume,sourceDurationSeconds:visual.sourceDurationSeconds,focusIntervals:visual.focusIntervals,transition:'transition' in visual?visual.transition:'cut',transitionSeconds:Math.min('transitionSeconds' in visual?visual.transitionSeconds:.3,(b-a)/2),effectWindow:{...effectWindow,startSeconds:effectWindow.startSeconds+elapsed,...(effectWindow.opacityStartSeconds!==undefined?{opacityStartSeconds:effectWindow.opacityStartSeconds+elapsed}:{})}})
   }
   visualStart+=visual.durationSeconds
  }
  if(fragments.length){child.visualSegments=fragments;for(const key of ['effects','imageArtifactId','videoArtifactId','sourceDurationSeconds','focusIntervals'] as const)delete child[key]}
  if(child.cardSpec?.version===2&&('reading'in child.cardSpec||'highlights'in child.cardSpec)){
   const ids=new Set(fragments.flatMap(v=>v.imageArtifactId?[v.imageArtifactId]:[])),spec=child.cardSpec
   if(spec.reading){spec.reading.targets=spec.reading.targets.filter(t=>ids.has(t.source.artifactId));if(!spec.reading.targets.length)delete spec.reading}
   if(spec.highlights)spec.highlights=spec.highlights.filter(h=>ids.has(h.source.artifactId))
   if(spec.templateId==='evidence/reading'&&!spec.reading||spec.templateId==='evidence/highlight'&&!spec.highlights?.length)child.cardSpec={version:1,templateId:'evidence/screenshot'}
  }
  child.captions=cues.flatMap(cue=>{const a=Math.max(from,cue.startSeconds),b=Math.min(to,cue.endSeconds);return b>a+epsilon?[{...cue,startSeconds:a-from,endSeconds:b-from}]:[]})
  if(usesSpeechCaptions(scene))delete child.captions
  if(child.speechLinks)child.speechLinks.focus=child.speechLinks.focus.flatMap(link=>{const visualIndex=target.visualIndices.indexOf(link.visualIndex);return visualIndex<0?[]:[{...link,visualIndex}]})
  delete child.voiceTiming
  if(scene.audioArtifactId)child.voiceSegments=voice.flatMap(t=>{
   const a=Math.max(from,t.startSeconds),b=Math.min(to,t.startSeconds+t.durationSeconds)
   if(b<=a+epsilon)return []
   if(b-a<.1-epsilon)throw new Error('切点产生了不足 0.1 秒的旁白；请移动播放头。')
   return [{...t,id:a>t.startSeconds+epsilon?crypto.randomUUID():t.id,startSeconds:a-from,sourceStartSeconds:t.sourceStartSeconds+(a-t.startSeconds)*t.playbackRate,durationSeconds:b-a}]
  })
  if(speechOrigin)child.speechPlaybackOrigin={voiceSegments:structuredClone(speechOrigin.voiceSegments),clock:studioSpeechOriginClock(child)}
  const partition=<T extends VisualLayer|AudioLayer>(items:T[]|undefined):T[]|undefined=>items?.flatMap(item=>{
   const a=Math.max(from,item.startSeconds),b=Math.min(to,item.startSeconds+item.durationSeconds)
   if(b<=a+epsilon)return []
   const piece=sliceStudioLayer(item,a-item.startSeconds,b-item.startSeconds,a>item.startSeconds+epsilon?crypto.randomUUID():item.id);piece.startSeconds=a-from;return [piece]
  })
  child.layers=partition(layers);child.audioTracks=partition(audioTracks)
 }
 partitionSourceSpeech(scene,targets)
 for(const child of [left,right])if(usesStudioSpeech(child))speechScene(child)
 next.scenes.splice(index,1,left,right)
 return {draft:assertVideoDraft(next),selection:{sceneId:right.id,kind:'scene'}}
}
