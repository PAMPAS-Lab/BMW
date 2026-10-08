import {assertVisualEffects,hasVisualEffects} from '../../media-native/src/visual-effects.js'
import type {VisualEffects} from '../../media-native/src/visual-effects.js'
import {remapSourceSpeech} from './studio-source-speech-contract.js'
import {assertVideoDraft} from './studio-contract.js'
import type {StudioScene,VideoDraft} from './studio-contract.js'
import {speechCaptionCues,speechScene,usesSpeechCaptions,usesStudioSpeech} from './studio-speech-contract.js'
import {estimatedCaptionCues,narrationWindows,assertNarrationTiming} from '../../media-native/src/composition-contract.js'
import {layerProblems} from '../../media-native/src/composition-layers.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'

export interface StudioMainSelection {sceneId:string;kind:'scene'|'visual'|'voice'|'caption';index?:number;voiceSegmentId?:string;visualSegmentId?:string}
export interface StudioMainResult {draft:VideoDraft;selection:StudioMainSelection}
export function studioMainScene(draft:VideoDraft,ref:StudioMainSelection):StudioScene {
 const scene=draft.scenes.find(scene=>scene.id===ref.sceneId)
 if(!scene)throw new Error('时间轴镜头已删除，请重新选择。')
 if(ref.index!==undefined&&(!Number.isInteger(ref.index)||ref.index<0))throw new Error('时间轴片段身份无效。')
 if(ref.visualSegmentId!==undefined&&(ref.kind!=='visual'||!scene.visualSegments?.some(v=>v.id===ref.visualSegmentId)))throw new Error('画面片段已删除或类型变化，请重新选择。')
 return scene
}
export function studioMainVisualIndex(scene:StudioScene,ref:StudioMainSelection):number{
 const index=ref.visualSegmentId!==undefined?scene.visualSegments?.findIndex(v=>v.id===ref.visualSegmentId)??-1:ref.index??0
 if(index<0)throw new Error('画面片段已删除，请重新选择。')
 return index
}
export function studioMainOffset(draft:VideoDraft,ref:StudioMainSelection):number {
 let start=0;for(const scene of draft.scenes){if(scene.id===ref.sceneId)return start;start+=scene.durationSeconds}
 throw new Error('时间轴镜头已删除。')
}
export function studioMainCues(draft:VideoDraft,scene:StudioScene):NonNullable<StudioScene['captions']> {
 return structuredClone(scene.captions??(usesSpeechCaptions(scene)?speechCaptionCues(scene):undefined)??estimatedCaptionCues(scene,draft.width,draft.height,scene.audioDurationSeconds??scene.durationSeconds-1))
}
export function studioMainVoice(scene:StudioScene,ref:StudioMainSelection):import('../../media-native/src/composition-contract.js').NarrationTiming {
 if(!scene.audioArtifactId||scene.audioDurationSeconds===undefined)throw new Error('先测量有效旁白，再编辑播放区间。')
 const windows=narrationWindows(scene,scene.audioDurationSeconds)
 if(scene.voiceSegments){const selected=scene.voiceSegments.find(t=>t.id===ref.voiceSegmentId);if(!selected)throw new Error('旁白片段已删除或未选择，请重新选择。');return selected}
 if(ref.voiceSegmentId!==undefined)throw new Error('旁白片段已变化，请重新选择。')
 return windows[0]
}
function writeVoice(scene:StudioScene,ref:StudioMainSelection,timing:import('../../media-native/src/composition-contract.js').NarrationTiming):void {
 const parsed=assertNarrationTiming(timing)
 if(scene.voiceSegments){const index=scene.voiceSegments.findIndex(t=>t.id===ref.voiceSegmentId);if(index<0)throw new Error('旁白片段已删除，请重新选择。');scene.voiceSegments[index]={id:scene.voiceSegments[index].id,...parsed};scene.voiceSegments.sort((a,b)=>a.startSeconds-b.startSeconds)}else{if(ref.voiceSegmentId!==undefined)throw new Error('旁白片段已变化，请重新选择。');scene.voiceTiming=parsed}
}
export function studioMainSpan(draft:VideoDraft,ref:StudioMainSelection):{start:number;end:number} {
 const scene=studioMainScene(draft,ref),offset=studioMainOffset(draft,ref)
 if(ref.kind==='voice'){const timing=studioMainVoice(scene,ref);return {start:offset+timing.startSeconds,end:offset+timing.startSeconds+timing.durationSeconds}}
 if(ref.kind==='caption'){const cue=studioMainCues(draft,scene)[ref.index??-1];if(!cue)throw new Error('字幕已变化，请重新选择。');return {start:offset+cue.startSeconds,end:offset+cue.endSeconds}}
 if(ref.kind==='visual'){const visuals=sceneVisuals(scene),index=studioMainVisualIndex(scene,ref),visual=visuals[index];if(!visual)throw new Error('画面片段已变化，请重新选择。');const start=offset+visuals.slice(0,index).reduce((n,v)=>n+v.durationSeconds,0);return {start,end:start+visual.durationSeconds}}
 return {start:offset,end:offset+scene.durationSeconds}
}
function finish(next:VideoDraft,ref:StudioMainSelection):StudioMainResult {
 const draft=assertVideoDraft(next),scene=studioMainScene(draft,ref),total=draft.scenes.reduce((n,s)=>n+s.durationSeconds,0)
 const errors=[...layerProblems(draft,total),...layerProblems(scene,scene.durationSeconds)]
 if(errors.length)throw new Error('时间调整会使对象越界；请先处理受影响对象。'+errors.join('；'))
 if(scene.audioArtifactId&&scene.audioDurationSeconds!==undefined)narrationWindows(scene,scene.audioDurationSeconds)
 if(usesStudioSpeech(scene))speechScene(scene)
 if(ref.kind==='voice'){studioMainSpan(draft,ref);studioMainCues(draft,scene)}
 if(ref.kind==='visual'){const index=studioMainVisualIndex(scene,ref),id=scene.visualSegments?.[index]?.id;ref={...ref,index,...(id?{visualSegmentId:id}:{})}}
 return {draft,selection:ref}
}
export function moveStudioMain(value:VideoDraft,ref:StudioMainSelection,globalSeconds:number):StudioMainResult {
 if(!Number.isFinite(globalSeconds))throw new Error('片段位置必须是有限秒数。')
 const next=structuredClone(value),scene=studioMainScene(next,ref),offset=studioMainOffset(next,ref),span=studioMainSpan(next,ref)
 if(ref.kind==='voice'){const timing=studioMainVoice(scene,ref);writeVoice(scene,ref,{startSeconds:globalSeconds-offset,sourceStartSeconds:timing.sourceStartSeconds,durationSeconds:timing.durationSeconds,playbackRate:timing.playbackRate})}
 else if(ref.kind==='caption'){const cues=studioMainCues(next,scene),cue=cues[ref.index!],duration=cue.endSeconds-cue.startSeconds;cue.startSeconds=globalSeconds-offset;cue.endSeconds=cue.startSeconds+duration;scene.captions=cues}
 else {
  const items:{durationSeconds:number}[]|undefined=ref.kind==='scene'?next.scenes:scene.visualSegments
  if(!items){if(ref.kind==='visual')return moveStudioMain(value,{sceneId:ref.sceneId,kind:'scene'},globalSeconds);throw new Error('没有可调序片段。')}
  if(ref.kind==='visual'&&scene.speechLinks?.focus.length)throw new Error('画面顺序关联了句锚点或原声字幕；请先明确解除或重新绑定。')
  const from=ref.kind==='scene'?next.scenes.indexOf(scene):studioMainVisualIndex(scene,ref),center=globalSeconds+(span.end-span.start)/2-(ref.kind==='visual'?offset:0)
  let end=0,to=items.length-1
  for(const [index,item]of items.entries()){end+=item.durationSeconds;if(center<end){to=index;break}}
  const previous=structuredClone(scene),[item]=items.splice(from,1);items.splice(to,0,item)
  if(ref.kind==='visual')remapSourceSpeech(previous,scene)
  if(ref.kind==='visual')ref={...ref,index:to}
 }
 return finish(next,ref)
}
export function trimStudioMain(value:VideoDraft,ref:StudioMainSelection,edge:'start'|'end',globalSeconds:number):StudioMainResult {
 if(!Number.isFinite(globalSeconds))throw new Error('修剪位置必须是有限秒数。')
 const next=structuredClone(value),scene=studioMainScene(next,ref),offset=studioMainOffset(next,ref),span=studioMainSpan(next,ref)
 if(ref.kind==='voice'){
  const original=studioMainVoice(scene,ref),timing={startSeconds:original.startSeconds,sourceStartSeconds:original.sourceStartSeconds,durationSeconds:original.durationSeconds,playbackRate:original.playbackRate},delta=globalSeconds-span.start
  writeVoice(scene,ref,edge==='start'?{...timing,startSeconds:timing.startSeconds+delta,sourceStartSeconds:timing.sourceStartSeconds+delta*timing.playbackRate,durationSeconds:timing.durationSeconds-delta}:{...timing,durationSeconds:globalSeconds-span.start})
 }else if(ref.kind==='caption'){
  const cues=studioMainCues(next,scene),cue=cues[ref.index!];if(edge==='start')cue.startSeconds=globalSeconds-offset;else cue.endSeconds=globalSeconds-offset
  if(cue.endSeconds-cue.startSeconds<.05)throw new Error('字幕至少保留 0.05 秒。');scene.captions=cues
 }else {
  if(ref.kind==='scene'&&edge==='start')throw new Error('镜头主序列连续；左边缘请选择具体画面，或用镜头调序。')
  const previous=structuredClone(scene),delta=edge==='start'?span.start-globalSeconds:globalSeconds-span.end,visual=ref.kind==='visual'?sceneVisuals(scene)[studioMainVisualIndex(scene,ref)]:undefined
  if(visual){
   if(visual.durationSeconds+delta<.1)throw new Error('画面至少保留 0.1 秒。')
   if(edge==='start'){const elapsed=globalSeconds-span.start;visual.sourceStartSeconds+=elapsed*visual.playbackRate;if('effectWindow' in visual&&visual.effectWindow){visual.effectWindow.startSeconds+=elapsed;if(visual.effectWindow.opacityStartSeconds!==undefined)visual.effectWindow.opacityStartSeconds+=elapsed}}
   visual.durationSeconds+=delta
   if('transitionSeconds' in visual)visual.transitionSeconds=Math.min(visual.transitionSeconds,visual.durationSeconds/2)
  }else if(scene.visualSegments){const last=scene.visualSegments.at(-1)!;last.durationSeconds+=delta;last.transitionSeconds=Math.min(last.transitionSeconds,last.durationSeconds/2)}
  // A single visual is the scene itself; segmented visuals ripple the scene length.
  if(visual!==scene)scene.durationSeconds+=delta
  remapSourceSpeech(previous,scene)
 }
 return finish(next,ref)
}
export function setStudioMainEffects(value:VideoDraft,ref:StudioMainSelection,effects?:VisualEffects):StudioMainResult {
 if(ref.kind!=='visual')throw new Error('先选择画面片段，再调整效果。')
 const next=structuredClone(value),scene=studioMainScene(next,ref),visual=sceneVisuals(scene)[studioMainVisualIndex(scene,ref)]
 if(!visual)throw new Error('画面片段已删除，请重新选择。')
 const parsed=effects===undefined?undefined:assertVisualEffects(effects)
 if(parsed&&hasVisualEffects(parsed))visual.effects=parsed;else delete visual.effects
 return finish(next,ref)
}
export function setStudioMainMuted(value:VideoDraft,ref:StudioMainSelection,muted:boolean):StudioMainResult {
 if(typeof muted!=='boolean')throw new Error('静音状态需要布尔值。')
 const next=structuredClone(value),scene=studioMainScene(next,ref)
 if(ref.kind==='voice'){studioMainVoice(scene,ref);scene.voiceMuted=muted}
 else if(ref.kind==='visual'){const visual=sceneVisuals(scene)[studioMainVisualIndex(scene,ref)];if(!visual?.videoArtifactId)throw new Error('只有视频画面具有原声。');visual.keepSourceAudio=!muted}
 else throw new Error('先选择旁白或视频画面。')
 return finish(next,ref)
}
export function setStudioMainVoice(value:VideoDraft,ref:StudioMainSelection,timing:import('../../media-native/src/composition-contract.js').NarrationTiming):StudioMainResult {
 if(ref.kind!=='voice')throw new Error('先选择旁白片段。')
 const next=structuredClone(value),scene=studioMainScene(next,ref);writeVoice(scene,ref,timing)
 return finish(next,ref)
}
export function splitStudioMainCaption(value:VideoDraft,ref:StudioMainSelection,globalSeconds:number):StudioMainResult {
 if(ref.kind!=='caption')throw new Error('请选择字幕；主画面分割与旁白内容分割仍需使用明确的镜头编辑。')
 const next=structuredClone(value),scene=studioMainScene(next,ref),cues=studioMainCues(next,scene),cue=cues[ref.index!],local=globalSeconds-studioMainOffset(next,ref)
 if(!cue||!Number.isFinite(local)||local-cue.startSeconds<.05||cue.endSeconds-local<.05)throw new Error('播放头需要位于字幕内部，两侧各至少 0.05 秒。')
 cues.splice(ref.index!,1,{...cue,endSeconds:local},{...cue,startSeconds:local});scene.captions=cues
 return finish(next,ref)
}

/** Split only the main visual content; narration, captions and scene identity stay whole. */
export function splitStudioMainVisual(value:VideoDraft,ref:StudioMainSelection,globalSeconds:number):StudioMainResult {
 const next=structuredClone(value),scene=studioMainScene(next,ref),visuals=sceneVisuals(scene),index=studioMainVisualIndex(scene,ref),visual=visuals[index]
 if(ref.kind!=='visual'||!visual)throw new Error('请选择有效画面片段。')
 if(visuals.length>=8)throw new Error('主画面最多八个片段。')
 const start=studioMainOffset(next,ref)+visuals.slice(0,index).reduce((n,v)=>n+v.durationSeconds,0),cut=globalSeconds-start
 if(!Number.isFinite(cut)||cut<.1-.000001||visual.durationSeconds-cut<.1-.000001)throw new Error('播放头需要位于画面内部，两侧各至少 0.1 秒。')
 const old='effectWindow' in visual?visual.effectWindow:undefined,following=visuals[index+1]
 const window=old??{originId:crypto.randomUUID(),startSeconds:0,durationSeconds:visual.durationSeconds,fadeInSeconds:'transition' in visual&&visual.transition==='fade'?visual.transitionSeconds:0,fadeOutSeconds:following&&'effectWindow' in following&&following.effectWindow?following.effectWindow.startSeconds===0?Math.min(following.effectWindow.fadeInSeconds,visual.durationSeconds/2):0:following&&'transition' in following&&following.transition==='fade'?Math.min(following.transitionSeconds,visual.durationSeconds/2):0}
 const pieces=visuals.map(v=>({effects:v.effects,durationSeconds:v.durationSeconds,imageArtifactId:v.imageArtifactId,videoArtifactId:v.videoArtifactId,sourceStartSeconds:v.sourceStartSeconds,playbackRate:v.playbackRate,zoom:v.zoom,crop:v.crop,keepSourceAudio:v.keepSourceAudio,sourceVolume:v.sourceVolume,sourceDurationSeconds:v.sourceDurationSeconds,focusIntervals:v.focusIntervals,id:'id' in v?v.id:undefined,effectWindow:'effectWindow' in v?v.effectWindow:undefined,transition:'transition' in v?v.transition:'cut' as const,transitionSeconds:'transitionSeconds' in v?v.transitionSeconds:Math.min(.3,v.durationSeconds/2)}))
 const original=pieces[index],leftId=original.id??crypto.randomUUID(),rightId=crypto.randomUUID()
 pieces.splice(index,1,{...original,id:leftId,durationSeconds:cut,transitionSeconds:Math.min(original.transitionSeconds,cut/2),effectWindow:{...window}},
  {...original,id:rightId,durationSeconds:visual.durationSeconds-cut,sourceStartSeconds:visual.videoArtifactId?visual.sourceStartSeconds+cut*visual.playbackRate:visual.sourceStartSeconds,transition:'cut',transitionSeconds:Math.min(.3,(visual.durationSeconds-cut)/2),effectWindow:{...window,startSeconds:window.startSeconds+cut,...(window.opacityStartSeconds!==undefined?{opacityStartSeconds:window.opacityStartSeconds+cut}:{})}})
 scene.visualSegments=pieces
 for(const key of ['effects','imageArtifactId','videoArtifactId','sourceDurationSeconds','focusIntervals'] as const)delete scene[key]
 if(scene.speechLinks)scene.speechLinks.focus=scene.speechLinks.focus.flatMap(link=>link.visualIndex===index?[{...link},{...link,visualIndex:index+1}]:[{...link,visualIndex:link.visualIndex>index?link.visualIndex+1:link.visualIndex}])
 return finish(next,{sceneId:scene.id,kind:'visual',index:index+1,visualSegmentId:rightId})
}

/** Split a playback piece, retaining source bytes, sentence identities and the left clip ID. */
export function splitStudioMain(value:VideoDraft,ref:StudioMainSelection,globalSeconds:number):StudioMainResult {
 if(ref.kind==='caption')return splitStudioMainCaption(value,ref,globalSeconds)
 if(ref.kind==='visual')return splitStudioMainVisual(value,ref,globalSeconds)
 if(ref.kind!=='voice')throw new Error('请选择画面、旁白或字幕片段。')
 const next=structuredClone(value),scene=studioMainScene(next,ref),timing=studioMainVoice(scene,ref),local=globalSeconds-studioMainOffset(next,ref),cut=local-timing.startSeconds
 if(!Number.isFinite(local)||cut<.1-.000001||timing.durationSeconds-cut<.1-.000001)throw new Error('播放头需要位于旁白内部，两侧各至少 0.1 秒。')
 if((scene.voiceSegments?.length??1)>=8)throw new Error('旁白最多八个播放片段。')
 const leftId=ref.voiceSegmentId??crypto.randomUUID(),rightId=crypto.randomUUID()
 const left={id:leftId,startSeconds:timing.startSeconds,sourceStartSeconds:timing.sourceStartSeconds,durationSeconds:cut,playbackRate:timing.playbackRate},right={id:rightId,startSeconds:local,sourceStartSeconds:timing.sourceStartSeconds+cut*timing.playbackRate,durationSeconds:timing.durationSeconds-cut,playbackRate:timing.playbackRate}
 const index=scene.voiceSegments?scene.voiceSegments.findIndex(t=>t.id===ref.voiceSegmentId):0
 const pieces=scene.voiceSegments??[];pieces.splice(index,scene.voiceSegments?1:0,left,right);scene.voiceSegments=pieces;delete scene.voiceTiming
 return finish(next,{sceneId:ref.sceneId,kind:'voice',voiceSegmentId:rightId})
}
