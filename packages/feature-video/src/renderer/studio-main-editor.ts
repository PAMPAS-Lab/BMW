import {moveStudioMain,trimStudioMain,setStudioMainVoice,setStudioMainMuted,setStudioMainEffects,splitStudioMain,studioMainScene,studioMainSpan} from '../studio-main-edits.js'
import type {StudioMainSelection,StudioMainResult} from '../studio-main-edits.js'
import {DEFAULT_VISUAL_EFFECTS} from '../../../media-native/src/visual-effects.js'
import {sceneVisuals} from '../../../media-native/src/visual-segments.js'
import type {VideoDraft} from '../studio-contract.js'
type Owner={projectId:string;draftId:string;revision:number}
interface MainState {projectId:string;draft:VideoDraft;sceneId?:string;advanced:boolean;disabled:boolean;blocked:boolean;mode:string;time:number}
interface MainOptions {
 state:()=>MainState|undefined
 commit:(owner:Owner,change:(draft:VideoDraft)=>VideoDraft)=>Promise<void>
 splitScene:(owner:Owner,sceneId:string,splitSeconds:number)=>Promise<StudioMainResult>
 select:(selection:StudioMainSelection,seconds?:number)=>Promise<void>
 refreshPreview:()=>Promise<void>
 changed:()=>void
 pause:()=>void
 notify:(message:string)=>void
}
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T
/** Main gestures capture a revision and selection; indices are never replayed on another revision. */
export class StudioMainEditor {
 selection:StudioMainSelection|undefined
 private panel=document.createElement('section')
 private pending:{owner:Owner;selection:StudioMainSelection}|undefined
 private applying:Promise<void>|undefined
 private cancelGesture:(()=>void)|undefined
 private ownerKey=''
 private selectionGeneration=0
 constructor(private options:MainOptions){
  this.panel.id='main-clip-properties';this.panel.hidden=true;this.panel.className='main-clip-properties';element('inspector-context').after(this.panel)
  this.panel.addEventListener('input',event=>{if(!(event.target as HTMLElement).hasAttribute('data-main-field'))return;const s=options.state();if(s&&this.selection&&!this.pending)this.pending={owner:this.owner(s),selection:structuredClone(this.selection)};const mute=this.panel.querySelector<HTMLInputElement>('[data-main-muted]');if(mute)mute.disabled=true;const clear=this.panel.querySelector<HTMLButtonElement>('#main-effects-clear');if(clear)clear.disabled=true})
  this.panel.addEventListener('change',event=>{if((event.target as HTMLElement).hasAttribute('data-main-field'))this.run(()=>this.flush())})
  element('timeline-dock').addEventListener('pointerdown',event=>this.pointer(event))
  element('timeline-dock').addEventListener('click',event=>{if(event.detail!==0)return;const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-main-kind]');if(button)this.run(()=>this.choose(this.ref(button)))})
  window.addEventListener('blur',()=>this.cancelGesture?.())
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.cancelGesture){event.preventDefault();this.cancelGesture()}})
 }
 private owner(s:MainState):Owner{return {projectId:s.projectId,draftId:s.draft.id,revision:s.draft.revision}}
 private run(fn:()=>Promise<void>):void{void fn().catch(error=>this.options.notify(error instanceof Error?error.message:String(error)))}
 private ref(button:HTMLButtonElement):StudioMainSelection{return {sceneId:button.dataset.sceneId!,kind:button.dataset.mainKind as StudioMainSelection['kind'],...(['caption','visual'].includes(button.dataset.mainKind!)?{index:Number(button.dataset.itemIndex)}:{}),...(button.dataset.voiceSegmentId?{voiceSegmentId:button.dataset.voiceSegmentId}:{}),...(button.dataset.visualSegmentId?{visualSegmentId:button.dataset.visualSegmentId}:{})}}
 clearSelection():void{this.selectionGeneration++;if(this.pending||this.applying)throw new Error('请先保存当前时间轴属性。');this.cancelGesture?.();this.selection=undefined;this.panel.hidden=true}
 discard():void{this.selectionGeneration++;if(this.applying)throw new Error('正在保存，请等待。');this.cancelGesture?.();this.pending=undefined;this.selection=undefined;this.panel.hidden=true}
 isApplying():boolean{return Boolean(this.applying)}
 private async transaction(action:()=>Promise<void>):Promise<void>{
  if(this.applying)throw new Error('正在处理时间轴，请稍候。')
  // Defer execution until the full save/select/preview transaction owns admission.
  const operation=Promise.resolve().then(action);this.applying=operation;this.options.changed();this.render()
  try{await operation}finally{if(this.applying===operation)this.applying=undefined;this.options.changed();this.render()}
 }
 hasPending():boolean{return Boolean(this.pending||this.applying||this.cancelGesture)}
 async flush():Promise<void>{
  this.cancelGesture?.();if(this.applying)return this.applying
  if(!this.pending)return
  const pending=this.pending,fields=new Map(Array.from(this.panel.querySelectorAll<HTMLInputElement>('input[data-main-field]')).map(input=>[input.dataset.mainField!,Number(input.value)]))
  await this.transaction(async()=>{await this.options.commit(pending.owner,draft=>{
   const ref=pending.selection;studioMainScene(draft,ref)
   if(ref.kind==='voice')return setStudioMainVoice(draft,ref,{startSeconds:fields.get('voice-start')!,sourceStartSeconds:fields.get('voice-source')!,durationSeconds:fields.get('voice-duration')!,playbackRate:fields.get('voice-rate')!}).draft
   const old=studioMainSpan(draft,ref),start=fields.get('start')!,end=fields.get('end')!
   if(ref.kind==='caption'){
    let next=draft;if(start!==old.start)next=moveStudioMain(next,ref,start).draft
    return trimStudioMain(next,ref,'end',end).draft
   }
   let next=end===old.end?draft:trimStudioMain(draft,ref,'end',end).draft
   if(ref.kind==='visual'&&fields.has('effect-brightness'))next=setStudioMainEffects(next,ref,{brightness:fields.get('effect-brightness')!,contrast:fields.get('effect-contrast')!,saturation:fields.get('effect-saturation')!,blurPixels:fields.get('effect-blurPixels')!}).draft
   return next
  })
  this.pending=undefined;this.render();await this.options.refreshPreview()})
 }
 async choose(ref:StudioMainSelection):Promise<void>{const generation=++this.selectionGeneration;this.options.pause();await this.flush();if(generation!==this.selectionGeneration)return;const s=this.options.state();if(!s||s.disabled)throw new Error('正在处理，请等待。');studioMainSpan(s.draft,ref);this.selection=structuredClone(ref);await this.options.select(ref);if(generation!==this.selectionGeneration)return;this.render();await this.options.refreshPreview()}
 async split():Promise<void>{
  this.options.pause();await this.flush();const s=this.options.state(),ref=this.selection
  if(!s||!ref)throw new Error('先选择镜头、画面、旁白、图层、音轨或字幕片段。')
  if(ref.kind!=='scene'){await this.change(this.owner(s),draft=>splitStudioMain(draft,ref,s.time));return}
  const span=studioMainSpan(s.draft,ref),owner=this.owner(s),cut=s.time-span.start
  await this.transaction(async()=>{const result=await this.options.splitScene(owner,ref.sceneId,cut);this.selection=result.selection;await this.options.select(this.selection,s.time);this.render();await this.options.refreshPreview()})
 }
 private async change(owner:Owner,change:(draft:VideoDraft)=>StudioMainResult):Promise<void>{
  await this.transaction(async()=>{
   let result:StudioMainResult|undefined
   await this.options.commit(owner,draft=>{result=change(draft);return result.draft})
   this.selection=result!.selection;await this.options.select(this.selection);this.render();await this.options.refreshPreview()
  })
 }
 render():void{
  const s=this.options.state(),key=s?`${s.projectId}/${s.draft.id}`:''
  if(key!==this.ownerKey){this.cancelGesture?.();this.selection=undefined;this.pending=undefined;this.ownerKey=key}
  if(!this.pending&&this.selection&&!s?.draft.scenes.some(scene=>scene.id===this.selection!.sceneId))this.selection=undefined
  // GUI selection follows the canonical undo/update snapshot. Composer pins remain independent.
  if(!this.pending&&this.selection?.voiceSegmentId&&!s?.draft.scenes.find(scene=>scene.id===this.selection!.sceneId)?.voiceSegments?.some(piece=>piece.id===this.selection!.voiceSegmentId))this.selection=undefined
  if(!this.pending&&this.selection?.kind==='visual'){const scene=s?.draft.scenes.find(scene=>scene.id===this.selection!.sceneId),count=scene?.visualSegments?.length??(scene?.imageArtifactId||scene?.videoArtifactId?1:0);if(this.selection.visualSegmentId){const index=scene?.visualSegments?.findIndex(v=>v.id===this.selection!.visualSegmentId)??-1;if(index<0)this.selection=undefined;else this.selection.index=index}else if((this.selection.index??0)>=count)this.selection=undefined}
  if(!this.pending&&s?.mode==='voice'){const scene=s.draft.scenes.find(scene=>scene.id===s.sceneId);if(scene?.audioArtifactId&&scene.audioDurationSeconds!==undefined&&scene.voiceSegments?.length!==0&&(!this.selection||this.selection.kind!=='voice'||this.selection.sceneId!==scene.id))this.selection={kind:'voice',sceneId:scene.id,...(scene.voiceSegments?.length?{voiceSegmentId:scene.voiceSegments[0].id}:{})};else if((!scene?.audioArtifactId||scene.voiceSegments?.length===0)&&this.selection?.kind==='voice')this.selection=undefined}
  const ref=this.selection,active=ref&&(ref.kind==='voice'?'voice':ref.kind==='caption'?'captions':'visual')===s?.mode
  this.panel.hidden=!s?.advanced||!active
  if(this.panel.hidden)return
  if(this.pending){for(const input of this.panel.querySelectorAll<HTMLInputElement>('input'))input.disabled=s.disabled||this.isApplying()||input.hasAttribute('data-main-muted');return}
  const effectsKey=JSON.stringify([key,ref!.sceneId,ref!.visualSegmentId??ref!.index??0]),oldEffects=this.panel.querySelector<HTMLDetailsElement>('#main-effects'),effectsOpen=Boolean(oldEffects?.dataset.effectsOwner===effectsKey&&oldEffects.open)
  this.panel.replaceChildren();let span:ReturnType<typeof studioMainSpan>
  try{span=studioMainSpan(s.draft,ref!)}catch(error){this.options.notify(error instanceof Error?error.message:String(error));if(ref!.kind!=='voice')return;span={start:0,end:0}}
  const scene=studioMainScene(s.draft,ref!),heading=document.createElement('strong');heading.textContent=ref!.kind==='voice'?(scene.voiceSegments?'旁白片段 '+(scene.voiceSegments.findIndex(t=>t.id===ref!.voiceSegmentId)+1):'旁白播放区间'):ref!.kind==='caption'?`字幕片段 ${(ref!.index??0)+1}`:ref!.kind==='visual'?`画面片段 ${(ref!.index??0)+1}`:'主镜头时序';this.panel.append(heading)
  const grid=document.createElement('div');grid.className='main-clip-grid';this.panel.append(grid)
  const number=(key:string,label:string,value:number,readonly=false,parent:HTMLElement=grid)=>{const wrap=document.createElement('label'),input=document.createElement('input');wrap.textContent=label;input.id='main-'+key;input.dataset.mainField=key;input.type='number';input.step='.01';input.value=String(value);input.readOnly=readonly;input.disabled=s.disabled||this.isApplying();wrap.append(input);parent.append(wrap);return input}
  if(ref!.kind==='voice'){const timing=scene.voiceSegments?scene.voiceSegments.find(t=>t.id===ref!.voiceSegmentId):scene.voiceTiming??{startSeconds:.5,sourceStartSeconds:0,durationSeconds:scene.audioDurationSeconds!,playbackRate:1};if(!timing){this.panel.append(document.createTextNode('旁白片段已删除，请重新选择。'));return}number('voice-start','镜头内开始（秒）',timing.startSeconds);number('voice-source','音频源起点（秒）',timing.sourceStartSeconds);number('voice-duration','播放长度（秒）',timing.durationSeconds);number('voice-rate','播放速度',timing.playbackRate)}
  else{number('start','整片开始（秒）',span.start,ref!.kind!=='caption');number('end','整片结束（秒）',span.end)}
  if(ref!.kind==='visual'){const visual=sceneVisuals(scene)[ref!.index??0];if(visual?.videoArtifactId){const label=document.createElement('label'),input=document.createElement('input'),owner=this.owner(s),selection=structuredClone(ref!);label.className='checkbox';label.textContent='静音此画面片段原声';input.type='checkbox';input.id='main-source-muted';input.dataset.mainMuted='source';input.checked=!visual.keepSourceAudio;input.disabled=s.disabled||this.isApplying();label.prepend(input);this.panel.append(label);input.addEventListener('change',()=>{const muted=input.checked;this.options.pause();this.run(()=>this.change(owner,draft=>setStudioMainMuted(draft,selection,muted)))})}}
  if(ref!.kind==='visual'){const visual=sceneVisuals(scene)[ref!.index??0];if(visual){const group=document.createElement('details'),title=document.createElement('summary'),effects=visual.effects??DEFAULT_VISUAL_EFFECTS;group.id='main-effects';group.dataset.effectsOwner=effectsKey;group.open=effectsOpen;title.textContent='颜色与模糊';group.append(title);this.panel.append(group);const owner=this.owner(s),selection=structuredClone(ref!);for(const [key,label,min,max]of [['brightness','亮度',.25,2],['contrast','对比度',0,2],['saturation','饱和度',0,2],['blurPixels','模糊',0,12]] as const){const input=number('effect-'+key,label,effects[key],false,group);input.min=String(min);input.max=String(max)}const reset=document.createElement('button');reset.id='main-effects-clear';reset.textContent='清除画面效果';reset.disabled=s.disabled||this.isApplying();reset.onclick=()=>this.run(async()=>{await this.flush();await this.change(owner,draft=>setStudioMainEffects(draft,selection))});group.append(reset)}}
  const note=document.createElement('p');note.className='muted';note.textContent=ref!.kind==='voice'?`原音频实测 ${scene.audioDurationSeconds!.toFixed(2)} 秒；移动与修剪不改写原音频。`:ref!.kind==='caption'?'独立修改这条字幕的时间；旁白内容保持。':'主序列连续；改时长会顺移后续镜头，越界对象需先处理。';if(scene.sourceCaptionBinding&&(ref!.kind==='visual'||ref!.kind==='scene'))note.textContent+=' 原声字幕保留人工文字和译文，时间随同一素材重新映射；超出核对范围时请先重新应用字幕。';this.panel.append(note)
  for(const button of document.querySelectorAll('[data-main-kind]') as HTMLButtonElement[])button.classList.toggle('main-selected',button.dataset.sceneId===ref!.sceneId&&button.dataset.mainKind===ref!.kind&&(ref!.kind!=='voice'||button.dataset.voiceSegmentId===ref!.voiceSegmentId)&&(ref!.visualSegmentId?button.dataset.visualSegmentId===ref!.visualSegmentId:ref!.index===undefined||Number(button.dataset.itemIndex)===ref!.index))
 }
 private pointer(event:PointerEvent):void{
  const clip=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-main-kind]'),s=this.options.state();if(!clip||event.button!==0||!s?.advanced||s.disabled||this.isApplying())return
  if(s.blocked||this.pending){this.options.notify('先保存当前输入，再拖动时间轴。');return}
  const ref=this.ref(clip),span=studioMainSpan(s.draft,ref),edge=(event.target as HTMLElement).dataset.mainEdge as 'start'|'end'|undefined,lane=clip.parentElement!,rect=lane.getBoundingClientRect(),duration=s.draft.scenes.reduce((n,v)=>n+v.durationSeconds,0),x=event.clientX,owner=this.owner(s),style={left:clip.style.left,width:clip.style.width};let delta=0,moved=false
  event.preventDefault();this.options.pause();clip.setPointerCapture(event.pointerId)
  const move=(next:PointerEvent)=>{delta=(next.clientX-x)/rect.width*duration;if(element<HTMLInputElement>('timeline-snap').checked)delta=Math.round(delta*s.draft.fps)/s.draft.fps;if(Math.abs(next.clientX-x)<3)return;moved=true;const start=span.start+(edge==='end'?0:delta),end=span.end+(edge==='start'?0:delta);clip.style.left=`${start/duration*100}%`;clip.style.width=`${Math.max(.05,end-start)/duration*100}%`}
  const cleanup=()=>{clip.removeEventListener('pointermove',move);clip.removeEventListener('pointerup',up);clip.removeEventListener('pointercancel',cancel);this.cancelGesture=undefined}
  const restore=()=>{clip.style.left=style.left;clip.style.width=style.width}
  const cancel=()=>{cleanup();restore()}
  const up=()=>{cleanup();restore();if(!moved){this.run(()=>this.choose(ref));return}this.run(()=>this.change(owner,draft=>edge?trimStudioMain(draft,ref,edge,(edge==='start'?span.start:span.end)+delta):moveStudioMain(draft,ref,span.start+delta)))}
  this.cancelGesture=cancel;clip.addEventListener('pointermove',move);clip.addEventListener('pointerup',up);clip.addEventListener('pointercancel',cancel)
 }
}
