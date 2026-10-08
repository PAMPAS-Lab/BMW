import type {AudioLayer,LayerContainer,LayerFrame,VisualLayer} from '../../media-native/src/composition-layers.js'
import {visualLayerBox} from '../../media-native/src/composition-layers.js'
import {assertVideoDraft} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'

export interface StudioLayerSelection {kind:'visual'|'audio';id:string;sceneId?:string}
export function studioLayerContainer(draft:VideoDraft,selection:Pick<StudioLayerSelection,'sceneId'>):LayerContainer {
 if(!selection.sceneId)return draft
 const scene=draft.scenes.find(scene=>scene.id===selection.sceneId)
 if(!scene)throw new Error('对象所属镜头已删除，请重新选择。')
 return scene
}
export function studioLayer(draft:VideoDraft,selection:StudioLayerSelection):VisualLayer|AudioLayer {
 const container=studioLayerContainer(draft,selection),value=(selection.kind==='visual'?container.layers:container.audioTracks)?.find(value=>value.id===selection.id)
 if(!value)throw new Error('图层或音轨已删除，请重新选择。')
 return value
}
export function studioLayerOffset(draft:VideoDraft,selection:StudioLayerSelection):number {
 if(!selection.sceneId)return 0
 let offset=0;for(const scene of draft.scenes){if(scene.id===selection.sceneId)return offset;offset+=scene.durationSeconds}
 throw new Error('对象所属镜头已删除。')
}
export function editStudioLayer(draft:VideoDraft,selection:StudioLayerSelection,change:(value:VisualLayer|AudioLayer)=>void,allowLocked=false):VideoDraft {
 const next=structuredClone(draft),value=studioLayer(next,selection)
 if(value.locked&&!allowLocked)throw new Error('对象已锁定；请先解除锁定。')
 const id=value.id;change(value);if(value.id!==id)throw new Error('不能更改对象身份。')
 return assertVideoDraft(next)
}
export function addStudioLayer(draft:VideoDraft,sceneId:string|undefined,kind:VisualLayer['kind']|'audio',artifactId?:string,sourceDuration?:number):{draft:VideoDraft;selection:StudioLayerSelection} {
 const next=structuredClone(draft),container=studioLayerContainer(next,{sceneId}),span=sceneId?next.scenes.find(s=>s.id===sceneId)!.durationSeconds:next.scenes.reduce((n,s)=>n+s.durationSeconds,0)
 if(!span)throw new Error('先添加镜头，再添加对象。')
 if(['audio','image','video'].includes(kind)&&!artifactId)throw new Error('请先选择当前 Project 的素材。')
 const id=crypto.randomUUID(),durationSeconds=Math.max(.1,Math.min(span,sourceDuration??span)),common={id,title:kind==='audio'?'独立音轨':kind==='text'?'标题文字':kind==='rectangle'?'矩形':kind==='image'?'图片图层':'画中画',startSeconds:0,durationSeconds,fadeInSeconds:0,fadeOutSeconds:0,locked:false}
 if(kind==='audio')container.audioTracks=[...(container.audioTracks??[]),{...common,artifactId:artifactId!,sourceStartSeconds:0,playbackRate:1,volume:1,muted:false,ducking:false}]
 else container.layers=[...(container.layers??[]),{...common,kind,x:.1,y:.1,width:kind==='text'?.8:.3,height:kind==='text'?.15:.3,opacity:1,zIndex:Math.min(31,Math.max(-1,...(container.layers??[]).map(l=>l.zIndex))+1),hidden:false,color:'#ffffff',...(kind==='text'?{text:'新的标题',fontSize:32}:{}),...(artifactId?{artifactId}:{}),...(kind==='video'?{sourceStartSeconds:0,playbackRate:1}:{})}]
 return {draft:assertVideoDraft(next),selection:{kind:kind==='audio'?'audio':'visual',id,...(sceneId?{sceneId}:{})}}
}
function clippedFrames(layer:VisualLayer,from:number,to:number):LayerFrame[]|undefined {
 if(!layer.keyframes)return undefined
 const source=layer.keyframes
 const sample=(time:number):LayerFrame=>({...visualLayerBox({...layer,fadeInSeconds:0,fadeOutSeconds:0},time),timeSeconds:time-from,easing:'linear'})
 const times=[from,...source.filter(f=>f.timeSeconds>from&&f.timeSeconds<to).map(f=>f.timeSeconds),to]
 // A held prefix/suffix needs no synthetic point when its original endpoint
 // remains. This keeps arbitrary cuts within the existing twelve-point budget.
 if(from<source[0].timeSeconds&&source[0].timeSeconds<to)times.shift()
 if(to>source.at(-1)!.timeSeconds&&source.at(-1)!.timeSeconds>from)times.pop()
 const frames=times.map(sample)
 for(let i=1;i<frames.length;i++){
  const start=times[i-1],end=times[i],right=source.findIndex(f=>f.timeSeconds>=end)
  // Regions before/after the original animation remain constant. Every interior
  // pair belongs to one original segment; retain its normalized source domain.
  if(right<1||start<source[right-1].timeSeconds)continue
  const a=source[right-1],b=source[right];frames[i].easing=b.easing
  if(b.easing==='ease-in-out'){
   const [u,v]=b.easingRange??[0,1],span=b.timeSeconds-a.timeSeconds
   const first=Math.max(u,Math.min(v,u+(v-u)*(start-a.timeSeconds)/span)),last=Math.max(u,Math.min(v,u+(v-u)*(end-a.timeSeconds)/span))
   if(first!==0||last!==1)frames[i].easingRange=[first,last]
  }
 }
 if(frames.length>12)throw new Error('修剪后关键帧超过十二个，请先简化动画。')
 return frames
}
/** Adding an explicit point samples and subdivides the same curve; no motion jump. */
export function insertStudioLayerKeyframe(draft:VideoDraft,selection:StudioLayerSelection,local:number):VideoDraft {
 if(selection.kind!=='visual')throw new Error('关键帧仅适用于视觉对象。')
 return editStudioLayer(draft,selection,value=>{
  const layer=value as VisualLayer,frames=layer.keyframes
  if(!frames||!Number.isFinite(local)||local<=0||local>=layer.durationSeconds||frames.some(f=>Math.abs(f.timeSeconds-local)<.001))throw new Error('播放头应在片段内新的时间点。')
  const left=clippedFrames(layer,0,local)!,right=clippedFrames(layer,local,layer.durationSeconds)!
  const point=left.find(f=>f.timeSeconds===local)??{...visualLayerBox({...layer,fadeInSeconds:0,fadeOutSeconds:0},local),timeSeconds:local,easing:'linear' as const}
  layer.keyframes=[...left.filter(f=>f.timeSeconds<local),point,...right.filter(f=>f.timeSeconds>0).map(f=>({...f,timeSeconds:f.timeSeconds+local}))]
  if(layer.keyframes.length>12)throw new Error('动画最多十二个关键帧，请先简化动画。')
 })
}
function cutFadeWindow(layer:VisualLayer|AudioLayer,from:number):NonNullable<VisualLayer['fadeWindow']>{
 const window=layer.fadeWindow??{originId:crypto.randomUUID(),startSeconds:0,durationSeconds:layer.durationSeconds}
 return {...window,startSeconds:window.startSeconds+from}
}
/** Slice a scene-local object without unlocking it or resetting its source/curve. */
export function sliceStudioLayer<T extends VisualLayer|AudioLayer>(layer:T,from:number,to:number,id:string):T {
 if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to>layer.durationSeconds+.000001||to-from<.1-.000001)throw new Error('切点产生了不足 0.1 秒的图层或音轨；请移动播放头。')
 const next=structuredClone(layer);next.id=id;next.fadeWindow=cutFadeWindow(layer,from)
 if('sourceStartSeconds' in next)next.sourceStartSeconds=(next.sourceStartSeconds??0)+from*(next.playbackRate??1)
 if('keyframes' in next)next.keyframes=clippedFrames(next as VisualLayer,from,to)
 next.startSeconds=layer.startSeconds+from;next.durationSeconds=to-from
 return next
}
/** An explicit effect edit resets only the envelope; animation/source clocks stay. */
export function resetStudioLayerFade(draft:VideoDraft,selection:StudioLayerSelection):VideoDraft {
 return editStudioLayer(draft,selection,layer=>{delete layer.fadeWindow;layer.fadeInSeconds=Math.min(layer.fadeInSeconds,layer.durationSeconds/2);layer.fadeOutSeconds=Math.min(layer.fadeOutSeconds,layer.durationSeconds/2)})
}
export function trimStudioLayer(draft:VideoDraft,selection:StudioLayerSelection,edge:'start'|'end',value:number):VideoDraft {
 return editStudioLayer(draft,selection,layer=>{
  const end=layer.startSeconds+layer.durationSeconds,from=edge==='start'?value-layer.startSeconds:0,to=edge==='end'?value-layer.startSeconds:layer.durationSeconds
  if(!Number.isFinite(value)||from<0||to>layer.durationSeconds||to-from<.1)throw new Error('修剪需要保留至少 0.1 秒；扩展请在时间属性中调整。')
  const frames=selection.kind==='visual'?clippedFrames(layer as VisualLayer,from,to):undefined
  layer.fadeWindow=cutFadeWindow(layer,from)
  if('sourceStartSeconds' in layer)layer.sourceStartSeconds=(layer.sourceStartSeconds??0)+from*(layer.playbackRate??1)
  if(frames)(layer as VisualLayer).keyframes=frames
  layer.startSeconds=edge==='start'?value:layer.startSeconds;layer.durationSeconds=edge==='start'?end-value:value-layer.startSeconds
 })
}
export function splitStudioLayer(draft:VideoDraft,selection:StudioLayerSelection,local:number):VideoDraft {
 const layer=studioLayer(draft,selection),cut=local-layer.startSeconds
 if(cut<.1||cut>layer.durationSeconds-.1)throw new Error('播放头需在片段内部，两侧各至少 0.1 秒。')
 const next=editStudioLayer(draft,selection,()=>{}),container=studioLayerContainer(next,selection)
 const left=structuredClone(layer),right=structuredClone(layer);right.id=crypto.randomUUID();right.title=layer.title.slice(0,74)+'（后段）'
 left.fadeWindow=cutFadeWindow(layer,0);right.fadeWindow={...left.fadeWindow,startSeconds:left.fadeWindow.startSeconds+cut}
 left.durationSeconds=cut
 right.startSeconds=layer.startSeconds+cut;right.durationSeconds=layer.durationSeconds-cut
 if('sourceStartSeconds' in right)right.sourceStartSeconds=(right.sourceStartSeconds??0)+cut*(right.playbackRate??1)
 if(selection.kind==='visual'){(left as VisualLayer).keyframes=clippedFrames(layer as VisualLayer,0,cut);(right as VisualLayer).keyframes=clippedFrames(layer as VisualLayer,cut,layer.durationSeconds);container.layers=container.layers!.flatMap(l=>l.id===layer.id?[left as VisualLayer,right as VisualLayer]:[l])}
 else container.audioTracks=container.audioTracks!.flatMap(l=>l.id===layer.id?[left as AudioLayer,right as AudioLayer]:[l])
 return assertVideoDraft(next)
}
export function removeStudioLayer(draft:VideoDraft,selection:StudioLayerSelection):VideoDraft {
 const next=editStudioLayer(draft,selection,()=>{}),container=studioLayerContainer(next,selection)
 if(selection.kind==='visual')container.layers=container.layers!.filter(l=>l.id!==selection.id)
 else container.audioTracks=container.audioTracks!.filter(l=>l.id!==selection.id)
 return assertVideoDraft(next)
}

/** Transform the entire object/animation without manufacturing new keyframes. */
export function transformStudioLayer(draft:VideoDraft,ref:StudioLayerSelection,dx:number,dy:number,scaleX=1,scaleY=1):VideoDraft {
 if(ref.kind!=='visual'||![dx,dy,scaleX,scaleY].every(Number.isFinite)||scaleX<=0||scaleY<=0)throw new Error('Invalid canvas transform.')
 return editStudioLayer(draft,ref,value=>{
  const layer=value as VisualLayer,boxes=[layer,...(layer.keyframes??[])]
  const boundedX=Math.max(-Math.min(...boxes.map(b=>b.x)),Math.min(dx,Math.min(...boxes.map(b=>1-b.x-b.width))))
  const boundedY=Math.max(-Math.min(...boxes.map(b=>b.y)),Math.min(dy,Math.min(...boxes.map(b=>1-b.y-b.height))))
  const sx=Math.max(Math.max(...boxes.map(b=>.02/b.width)),Math.min(scaleX,Math.min(...boxes.map(b=>(1-b.x-boundedX)/b.width))))
  const sy=Math.max(Math.max(...boxes.map(b=>.02/b.height)),Math.min(scaleY,Math.min(...boxes.map(b=>(1-b.y-boundedY)/b.height))))
  for(const box of boxes){box.x+=boundedX;box.y+=boundedY;box.width*=sx;box.height*=sy}
 })
}
