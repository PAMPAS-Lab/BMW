import {ALL_FORMATS,BufferSource,Input} from 'mediabunny'
import {addStudioLayer,editStudioLayer,insertStudioLayerKeyframe,resetStudioLayerFade,removeStudioLayer,splitStudioLayer,studioLayer,studioLayerOffset,trimStudioLayer,transformStudioLayer} from '../studio-layer-edits.js'
import type {StudioLayerSelection} from '../studio-layer-edits.js'
import {DEFAULT_VISUAL_EFFECTS,hasVisualEffects} from '../../../media-native/src/visual-effects.js'
import type {VisualEffects} from '../../../media-native/src/visual-effects.js'
import {activeVisualLayers,visualLayerBox} from '../../../media-native/src/composition-layers.js'
import type {AudioLayer,LayerFrame,VisualLayer} from '../../../media-native/src/composition-layers.js'
import type {StudioAsset,VideoDraft} from '../studio-contract.js'

interface LayerEditorState {projectId:string;draft:VideoDraft;sceneId?:string;advanced:boolean;disabled:boolean;previewReady:boolean;time:number;assets:StudioAsset[]}
interface LayerEditorOptions {
 state:()=>LayerEditorState|undefined
 commit:(owner:{projectId:string;draftId:string;revision:number},change:(draft:VideoDraft)=>VideoDraft)=>Promise<void>
 select:(selection:StudioLayerSelection)=>Promise<void>
 openScene:(sceneId:string)=>Promise<void>
 notify:(text:string)=>void
 refreshPreview:()=>Promise<void>
 previewGeometry:(draft?:VideoDraft,ref?:StudioLayerSelection)=>Promise<void>
 pausePreview:()=>void
 openFilm:()=>Promise<void>
 ask:(selection:StudioLayerSelection)=>Promise<void>
 splitMain:()=>Promise<void>
 bytes:(artifactId:string)=>Promise<Uint8Array>
}
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T
const clone=<T>(v:T):T=>structuredClone(v)
/** Owns GUI-only selection and pending input; the canonical draft owns every object. */
export class StudioLayerEditor {
 selection:StudioLayerSelection|undefined
 private trackMenu=document.createElement('div')
 private trackContext?:{owner:{projectId:string;draftId:string;revision:number};sessionId:string;ref:StudioLayerSelection;trigger:HTMLElement}
 private closeTrackMenu(focus=false):void{
  const trigger=this.trackContext?.trigger;this.trackContext=undefined;this.trackMenu.hidden=true;this.trackMenu.replaceChildren()
  if(trigger?.isConnected){trigger.setAttribute('aria-expanded','false');if(focus&&trigger.checkVisibility())trigger.focus()}
 }
 private async openTrackMenu(ref:StudioLayerSelection,trigger:HTMLElement,x?:number,y?:number):Promise<void>{
  await this.flush();const s=this.options.state();if(!s?.advanced||s.disabled)return
  const layer=studioLayer(s.draft,ref);this.closeTrackMenu()
  const context={owner:{projectId:s.projectId,draftId:s.draft.id,revision:s.draft.revision},sessionId:s.draft.ownerSessionId,ref:clone(ref),trigger};this.trackContext=context
  const title=document.createElement('p');title.textContent=layer.title;this.trackMenu.append(title)
  const add=(id:string,label:string,change?:'lock'|'visibility')=>{
   const button=document.createElement('button');button.type='button';button.dataset.trackAction=id;button.setAttribute('role','menuitem');button.textContent=label
   button.onclick=()=>this.run(async()=>{
    if(this.trackContext!==context)throw new Error('对象菜单已过期，请重新打开。')
    this.closeTrackMenu();await this.flush();const current=this.options.state()
    if(!current?.advanced||current.disabled||current.projectId!==context.owner.projectId||current.draft.id!==context.owner.draftId||current.draft.ownerSessionId!==context.sessionId||current.draft.revision!==context.owner.revision)throw new Error('STUDIO_CONFLICT: 对象或草稿版本已变化，请重新打开菜单。')
    if(change){await this.options.commit(context.owner,draft=>editStudioLayer(draft,ref,value=>{if(change==='lock')value.locked=!layer.locked;else if(ref.kind==='visual')(value as VisualLayer).hidden=!(layer as VisualLayer).hidden;else (value as AudioLayer).muted=!(layer as AudioLayer).muted},true));this.selection=clone(ref);await this.options.select(ref);this.render();await this.options.refreshPreview()}
    else await this.choose(ref)
   });this.trackMenu.append(button)
  }
  add('properties','编辑属性');add('lock',layer.locked?'解除锁定':'锁定对象','lock');add('visibility',ref.kind==='visual'?((layer as VisualLayer).hidden?'显示画面':'隐藏画面'):((layer as AudioLayer).muted?'取消静音':'静音音轨'),'visibility')
  this.trackMenu.hidden=false;trigger.setAttribute('aria-expanded','true')
  const rect=trigger.getBoundingClientRect(),menu=this.trackMenu.getBoundingClientRect();this.trackMenu.style.left=Math.max(8,Math.min(innerWidth-menu.width-8,x??rect.left))+'px';this.trackMenu.style.top=Math.max(8,Math.min(innerHeight-menu.height-8,y??rect.bottom+4))+'px'
  this.trackMenu.querySelector<HTMLButtonElement>('button')!.focus()
 }
 selectionLocked():boolean{const s=this.options.state();if(!s||!this.selection)return false;try{return studioLayer(s.draft,this.selection).locked}catch{return false}}
 private canvasBox=document.createElement('div')
 private owner=''
 private propertyKey=''
 private pending:{projectId:string;draftId:string;revision:number}|undefined
 private applying:Promise<void>|undefined
 private category:'assets'|'script'|'elements'|'audio'='assets'
 private zoom=1
 private snap=true
 private cancelGesture:(()=>void)|undefined
 constructor(private options:LayerEditorOptions){
  this.trackMenu.id='studio-track-menu';this.trackMenu.className='studio-track-menu';this.trackMenu.hidden=true;this.trackMenu.setAttribute('role','menu');this.trackMenu.setAttribute('aria-label','图层与音轨操作');document.body.append(this.trackMenu)
  document.addEventListener('pointerdown',event=>{if(this.trackContext&&!this.trackMenu.contains(event.target as Node)&&!this.trackContext.trigger.contains(event.target as Node))this.closeTrackMenu()})
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.trackContext){event.preventDefault();this.closeTrackMenu(true)}})
  this.trackMenu.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const buttons=Array.from(this.trackMenu.querySelectorAll<HTMLButtonElement>('button')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()})
  window.addEventListener('resize',()=>this.closeTrackMenu());element('timeline-scroll').addEventListener('scroll',()=>this.closeTrackMenu())
  this.canvasBox.className='canvas-layer-selection';this.canvasBox.hidden=true
  for(const resize of [false,true]){const button=document.createElement('button');button.className=resize?'canvas-layer-resize':'canvas-layer-move';button.setAttribute('aria-label',resize?'拖动缩放选中对象':'拖动移动选中对象');button.dataset.canvasResize=String(resize);button.addEventListener('pointerdown',event=>this.canvasTransform(event,resize));this.canvasBox.append(button)}
  element('preview').parentElement!.append(this.canvasBox)
  new ResizeObserver(()=>this.time()).observe(element('preview'))
  const properties=element('layer-properties')
  properties.addEventListener('input',event=>{if(!(event.target as HTMLElement).dataset.layerField)return;const s=options.state();if(s&&!this.pending)this.pending={projectId:s.projectId,draftId:s.draft.id,revision:s.draft.revision}})
  properties.addEventListener('change',()=>{void this.flush().catch(error=>this.error(error))})
  element<HTMLInputElement>('timeline-zoom').addEventListener('input',()=>{this.zoom=Number(element<HTMLInputElement>('timeline-zoom').value);this.resizeTimeline()})
  element<HTMLInputElement>('timeline-snap').addEventListener('change',()=>{this.snap=element<HTMLInputElement>('timeline-snap').checked})
  element('timeline-split').onclick=()=>this.run(async()=>{await this.flush();const s=this.options.state(),ref=this.selection;if(!s)throw new Error('先选择视频。');if(!ref){await this.options.splitMain();return}await this.apply(draft=>splitStudioLayer(draft,ref,s.time-studioLayerOffset(draft,ref)))})
  element('layer-resource-tabs').addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-resource]');if(!button)return;this.run(async()=>{await this.flush();this.category=button.dataset.resource as typeof this.category;this.renderResources()})})
  element('timeline-independent').addEventListener('pointerdown',event=>this.pointer(event))
  element('preview').addEventListener('pointerdown',event=>this.canvasPointer(event))
  window.addEventListener('blur',()=>this.cancelGesture?.())
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.cancelGesture){event.preventDefault();this.cancelGesture()}})
 }
 private error(error:unknown):void{this.options.notify(error instanceof Error?error.message:String(error))}
 private run(fn:()=>Promise<void>):void{void fn().catch(error=>this.error(error))}
 private async apply(change:(draft:VideoDraft)=>VideoDraft):Promise<void>{
  const s=this.options.state();if(!s||s.disabled)throw new Error('正在处理，请等待。')
  await this.options.commit({projectId:s.projectId,draftId:s.draft.id,revision:s.draft.revision},change)
  this.render();await this.options.refreshPreview()
 }
 async flush():Promise<void>{
  if(this.cancelGesture){this.cancelGesture();await this.options.previewGeometry()}
  if(this.applying)return this.applying
  if(!this.pending||!this.selection)return
  const owner=this.pending,ref=clone(this.selection),fields=Array.from(element('layer-properties').querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('[data-layer-field]')).map(field=>({key:field.dataset.layerField!,value:field instanceof HTMLInputElement&&field.type==='checkbox'?field.checked:field instanceof HTMLInputElement&&field.type==='number'?Number(field.value):field.value}))
  const operation=this.options.commit(owner,draft=>editStudioLayer(draft,ref,value=>{
   const previous=clone(value),record=value as unknown as Record<string,unknown>
   for(const field of fields)if(!field.key.startsWith('effect-'))record[field.key]=field.value
   if(ref.kind==='visual'){const effects={...DEFAULT_VISUAL_EFFECTS};for(const field of fields)if(field.key.startsWith('effect-'))effects[field.key.slice(7) as keyof VisualEffects]=field.value as number;if(hasVisualEffects(effects))(value as VisualLayer).effects=effects;else delete (value as VisualLayer).effects}
   if(previous.locked){const allowed=ref.kind==='visual'?['locked','hidden']:['locked','muted'];for(const field of fields)if(!allowed.includes(field.key)&&JSON.stringify(field.key.startsWith('effect-')?((previous as VisualLayer).effects??DEFAULT_VISUAL_EFFECTS)[field.key.slice(7) as keyof VisualEffects]:(previous as unknown as Record<string,unknown>)[field.key])!==JSON.stringify(field.value))throw new Error('对象已锁定；请先解除锁定。')}
  },true))
  this.applying=operation
  try{await operation;this.pending=undefined;this.propertyKey='';this.render();await this.options.refreshPreview()}finally{if(this.applying===operation)this.applying=undefined;this.render()}
 }
 hasPending():boolean{return Boolean(this.pending||this.applying||this.cancelGesture)}
 clear():void{if(this.applying)throw new Error('正在保存对象，请等待。');this.cancelGesture?.();this.pending=undefined;this.selection=undefined;this.propertyKey='';this.owner=''}
 async choose(ref:StudioLayerSelection):Promise<void>{await this.flush();const s=this.options.state();if(!s)throw new Error('请先选择视频。');studioLayer(s.draft,ref);this.selection=clone(ref);await this.options.select(ref);this.render()}
 render():void{
  const s=this.options.state(),key=s?`${s.projectId}/${s.draft.id}`:''
  if(this.trackContext&&(!s?.advanced||s.disabled||s.projectId!==this.trackContext.owner.projectId||s.draft.id!==this.trackContext.owner.draftId||s.draft.revision!==this.trackContext.owner.revision||s.draft.ownerSessionId!==this.trackContext.sessionId))this.closeTrackMenu()
  if(key!==this.owner){if(this.pending)return;this.selection=undefined;this.propertyKey='';this.owner=key}
  if(this.selection&&s)try{studioLayer(s.draft,this.selection)}catch{if(!this.pending)this.selection=undefined}
  const panel=element('layer-properties');panel.hidden=!s?.advanced||!this.selection
  if(this.selection&&s){
   const value=studioLayer(s.draft,this.selection),key=JSON.stringify([this.owner,this.selection,value])
   if(!this.pending&&key!==this.propertyKey){this.propertyKey=key;this.properties(value,this.selection)}
   for(const field of panel.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,textarea,select,button'))field.disabled=s.disabled||Boolean(this.applying)||Boolean(value.locked&&!['locked','hidden','muted'].includes(field.dataset.layerField??'')&&field.id!=='layer-ask')
   element('inspector-tabs').hidden=true
   element('inspector-context').textContent=value.title+' · '+(this.selection.sceneId?'镜头局部时间':'全片时间')
   for(const id of ['scene-properties','voice-actions','studio-speech-links','match-controls','visual-segments','caption-panel','cover-panel'])element(id).hidden=true
  }
  this.renderResources();if(!this.cancelGesture)this.tracks();this.resizeTimeline();this.time()
 }
 private field(parent:HTMLElement,key:string,label:string,value:string|number|boolean,limits?:{min:number;max:number;step?:number}):HTMLInputElement|HTMLTextAreaElement {
  const row=document.createElement('label');row.textContent=label
  const input=key==='text'?document.createElement('textarea'):document.createElement('input')
  input.id='layer-'+key;input.dataset.layerField=key
  if(input instanceof HTMLInputElement){input.type=typeof value==='boolean'?'checkbox':typeof value==='number'?'number':key==='color'?'color':'text';if(typeof value==='boolean')input.checked=value;else input.value=String(value);if(limits){input.min=String(limits.min);input.max=String(limits.max);input.step=String(limits.step??.01)}}else{input.value=String(value);input.rows=3;input.maxLength=200}
  row.append(input);parent.append(row);return input
 }
 private action(parent:HTMLElement,label:string,fn:()=>Promise<void>):HTMLButtonElement {const button=document.createElement('button');button.textContent=label;button.onclick=()=>this.run(fn);parent.append(button);return button}
 private properties(value:VisualLayer|AudioLayer,ref:StudioLayerSelection):void{
  const panel=element('layer-properties'),effectsKey=JSON.stringify([this.owner,ref]),oldEffects=panel.querySelector<HTMLDetailsElement>('#layer-effects'),effectsOpen=Boolean(oldEffects?.dataset.effectsOwner===effectsKey&&oldEffects.open);panel.replaceChildren()
  const scope=document.createElement('p');scope.className='muted';scope.textContent=(ref.sceneId?'时间相对所属镜头；镜头调序时一起移动。':'时间相对整片；镜头调序时保持原位置。')+(value.locked?' 对象已锁定，解除后可修改内容和时间；仍可隐藏或静音。':'');panel.append(scope)
  this.field(panel,'title','名称',value.title)
  if(ref.kind==='visual'&&(value as VisualLayer).kind==='text'){this.field(panel,'text','文字',(value as VisualLayer).text??'');this.field(panel,'fontSize','字号（相对 720 高度）',(value as VisualLayer).fontSize??32,{min:12,max:96,step:1})}
  const timing=document.createElement('div');timing.className='grid';panel.append(timing)
  this.field(timing,'startSeconds','开始（秒）',value.startSeconds,{min:0,max:180});this.field(timing,'durationSeconds','时长（秒）',value.durationSeconds,{min:.1,max:180})
  if(ref.kind==='visual'){
   const layer=value as VisualLayer,geometry=document.createElement('div');geometry.className='grid';panel.append(geometry)
   for(const [key,label]of [['x','X'],['y','Y'],['width','宽'],['height','高']] as const)this.field(geometry,key,label+'（0–1）',layer[key],{min:key==='width'||key==='height'?.02:0,max:1})
   this.field(panel,'opacity','不透明度（0–1）',layer.opacity,{min:0,max:1})
   this.field(panel,'zIndex','层次',layer.zIndex,{min:0,max:31,step:1});this.field(panel,'hidden','隐藏画面',layer.hidden)
   if(layer.kind==='text'||layer.kind==='rectangle')this.field(panel,'color','颜色',layer.color)
   const effects=document.createElement('details'),effectsTitle=document.createElement('summary');effects.id='layer-effects';effects.dataset.effectsOwner=effectsKey;effects.open=effectsOpen;effectsTitle.textContent='颜色与模糊';effects.append(effectsTitle);panel.append(effects);for(const [key,label,min,max]of [['brightness','亮度',.25,2],['contrast','对比度',0,2],['saturation','饱和度',0,2],['blurPixels','模糊',0,12]] as const)this.field(effects,'effect-'+key,label,(layer.effects??DEFAULT_VISUAL_EFFECTS)[key],{min,max,step:key==='blurPixels'?1:.05});const clear=this.action(effects,'清除对象效果',async()=>{if(!clear.isConnected)throw new Error('效果控件已变化，请重新选择对象。');const s=this.options.state()!;const owner={projectId:s.projectId,draftId:s.draft.id,revision:s.draft.revision};await this.flush();await this.options.commit(owner,draft=>editStudioLayer(draft,ref,value=>{delete (value as VisualLayer).effects}));this.render();await this.options.refreshPreview()});clear.id='layer-effects-clear'
   const animation=document.createElement('details'),title=document.createElement('summary');title.textContent='动画与关键帧';animation.append(title);panel.append(animation)
   const preset=document.createElement('select');preset.id='layer-motion';preset.setAttribute('aria-label','动画预设');preset.append(new Option('选择动画预设',''),new Option('淡入淡出','fade'),new Option('从下方进入','rise'),new Option('清除动画','clear'));animation.append(preset)
   preset.onchange=()=>this.run(async()=>{await this.flush();const mode=preset.value;await this.apply(draft=>editStudioLayer(draft,ref,value=>{const layer=value as VisualLayer;if(mode==='clear'){delete layer.keyframes;delete layer.fadeWindow;layer.fadeInSeconds=0;layer.fadeOutSeconds=0}else if(mode==='fade'){delete layer.fadeWindow;layer.fadeInSeconds=Math.min(.5,layer.durationSeconds/2);layer.fadeOutSeconds=layer.fadeInSeconds}else if(mode==='rise'){layer.keyframes=[{...this.frame(layer,0),y:Math.min(1-layer.height,layer.y+.1)},{...this.frame(layer,Math.min(.5,layer.durationSeconds)),easing:'ease-in-out'}]}}))})
   this.action(animation,layer.keyframes?'添加播放头关键帧':'启用关键帧',async()=>{await this.flush();const s=this.options.state()!;await this.apply(draft=>{const layer=studioLayer(draft,ref) as VisualLayer;return layer.keyframes?insertStudioLayerKeyframe(draft,ref,s.time-studioLayerOffset(draft,ref)-layer.startSeconds):editStudioLayer(draft,ref,value=>{const layer=value as VisualLayer;layer.keyframes=[this.frame(layer,0),this.frame(layer,layer.durationSeconds)]})})}).id='layer-keyframe-add'
   for(const [index,frame]of (layer.keyframes??[]).entries()){
    const row=document.createElement('details'),heading=document.createElement('summary');heading.textContent=`关键帧 ${index+1} · ${frame.timeSeconds.toFixed(2)}s`;row.append(heading);animation.append(row)
    for(const [key,label]of [['timeSeconds','时间'],['x','X'],['y','Y'],['width','宽'],['height','高'],['opacity','不透明度']] as const){const field=document.createElement('input'),labelNode=document.createElement('label');field.type='number';field.step='.01';field.value=String(frame[key]);field.dataset.frame=String(index);field.dataset.frameField=key;labelNode.textContent=label;labelNode.append(field);row.append(labelNode);field.onchange=()=>this.run(async()=>{await this.flush();await this.apply(draft=>editStudioLayer(draft,ref,value=>{(value as VisualLayer).keyframes![index][key]=Number(field.value)}))})}
    const easing=document.createElement('select');easing.setAttribute('aria-label','关键帧插值');easing.append(new Option('线性','linear'),new Option(frame.easingRange?'缓入缓出 · 保留原曲线':'缓入缓出','ease-in-out'));easing.value=frame.easing;row.append(easing);easing.onchange=()=>this.run(async()=>{await this.flush();await this.apply(draft=>editStudioLayer(draft,ref,value=>{const frame=(value as VisualLayer).keyframes![index];frame.easing=easing.value as LayerFrame['easing'];delete frame.easingRange}))})
    this.action(row,'删除这个关键帧',async()=>{await this.flush();await this.apply(draft=>editStudioLayer(draft,ref,value=>{const layer=value as VisualLayer;if(layer.keyframes!.length<=2)throw new Error('动画至少保留两个关键帧；可用清除动画恢复静态。');layer.keyframes!.splice(index,1)}))})
   }
  }else{const audio=value as AudioLayer;this.field(panel,'volume','音量（0–2）',audio.volume,{min:0,max:2});this.field(panel,'muted','静音',audio.muted);this.field(panel,'ducking','旁白期间降低音量',audio.ducking)}
  if('sourceStartSeconds' in value){this.field(panel,'sourceStartSeconds','源素材起点（秒）',value.sourceStartSeconds??0,{min:0,max:1800});this.field(panel,'playbackRate','速度',value.playbackRate??1,{min:.25,max:2})}
  const fades=document.createElement('details'),heading=document.createElement('summary');heading.textContent='淡入淡出';fades.append(heading);panel.append(fades)
  for(const [key,label]of [['fadeInSeconds','淡入秒数'],['fadeOutSeconds','淡出秒数']] as const){const field=this.field(fades,key,label,value[key],{min:0,max:Math.min(2,(value.fadeWindow?.durationSeconds??value.durationSeconds)/2)});field.readOnly=Boolean(value.fadeWindow)}
  if(value.fadeWindow){const note=document.createElement('p');note.className='muted';note.id='layer-fade-preserved';note.textContent='保留原淡入淡出曲线，切口不会重启效果。需要新效果时，明确按当前片段重设。';fades.append(note);this.action(fades,'按当前片段重设淡入淡出',async()=>{await this.flush();await this.apply(draft=>resetStudioLayerFade(draft,ref))}).id='layer-fade-reset'}
  this.field(panel,'locked','锁定对象',value.locked)
  this.action(panel,'让助手调整此对象…',async()=>{await this.choose(ref);await this.options.ask(ref)}).id='layer-ask'
  this.action(panel,'删除此对象',async()=>{await this.flush();await this.apply(draft=>removeStudioLayer(draft,ref));this.selection=undefined;this.render()}).id='layer-remove'
 }
 private frame(layer:VisualLayer,timeSeconds:number):LayerFrame{return {timeSeconds,x:layer.x,y:layer.y,width:layer.width,height:layer.height,opacity:layer.opacity,easing:'linear'}}
 private renderResources():void{
  const s=this.options.state(),panel=element('layer-resource-content');panel.replaceChildren()
  for(const button of element('layer-resource-tabs').querySelectorAll<HTMLButtonElement>('button')){button.setAttribute('aria-pressed',String(button.dataset.resource===this.category));button.disabled=Boolean(s?.disabled)}
  element('workbench-asset-list').hidden=this.category!=='assets'
  element('studio-materials-resource').hidden=this.category!=='assets'
  if(!s?.advanced)return
  const scope=document.createElement('select');scope.id='layer-add-scope';scope.setAttribute('aria-label','新对象时间范围');if(s.sceneId)scope.append(new Option('当前镜头','scene'));scope.append(new Option('全片时间','film'));panel.append(scope)
  const add=async(kind:VisualLayer['kind']|'audio',artifactId?:string)=>{
   await this.flush();const admitted=this.options.state();if(!admitted||admitted.disabled)throw new Error('正在处理，请等待。');let measured:number|undefined,sourceStart=0
   if(artifactId&&(kind==='audio'||kind==='video')){const media=new Input({formats:ALL_FORMATS,source:new BufferSource(await this.options.bytes(artifactId))});try{const track=kind==='audio'?await media.getPrimaryAudioTrack():await media.getPrimaryVideoTrack();if(!track||!await track.canDecode())throw new Error('素材没有可解码的对应音轨/画面。');sourceStart=await track.getFirstTimestamp();measured=await track.computeDuration()-sourceStart;if(!Number.isFinite(sourceStart)||sourceStart<0||!Number.isFinite(measured)||measured<.1)throw new Error('素材实际时长不足 0.1 秒。')}finally{media.dispose()}}
   const current=this.options.state();if(!current||current.projectId!==admitted.projectId||current.draft.id!==admitted.draft.id||current.draft.revision!==admitted.draft.revision)throw new Error('STUDIO_CONFLICT: 素材读取期间草稿变化，请重新添加。')
   let ref:StudioLayerSelection|undefined;await this.apply(draft=>{if(artifactId&&!current.assets.some(a=>a.artifactId===artifactId))throw new Error('素材已失效。');const result=addStudioLayer(draft,scope.value==='scene'?s.sceneId:undefined,kind,artifactId,measured);ref=result.selection;return sourceStart?editStudioLayer(result.draft,ref,layer=>{if('sourceStartSeconds'in layer)layer.sourceStartSeconds=sourceStart}):result.draft});if(ref)await this.choose(ref)
  }
  if(this.category==='elements'){this.action(panel,'添加文字',()=>add('text')).id='layer-add-text';this.action(panel,'添加矩形',()=>add('rectangle')).id='layer-add-rectangle'}
  if(this.category==='audio'||this.category==='assets')for(const asset of s.assets.filter(asset=>this.category==='audio'?asset.kind==='audio':asset.kind==='image'||asset.kind==='video')){
   const row=document.createElement('div');row.className='layer-resource-row';const title=document.createElement('small');title.textContent=asset.artifactId;row.append(title);panel.append(row)
   const button=this.action(row,this.category==='audio'?'添加独立音轨':asset.kind==='image'?'添加图片图层':'添加画中画',()=>add(asset.kind as 'audio'|'image'|'video',asset.artifactId));button.dataset.layerAsset=asset.artifactId
  }
  if(this.category==='script')for(const [index,scene]of s.draft.scenes.entries()){const row=document.createElement('article'),text=document.createElement('p');text.textContent=scene.narration||'尚未编写脚本';row.append(text);this.action(row,`${index+1} · ${scene.title} · 编辑`,()=>this.options.openScene(scene.id));panel.append(row)}
  for(const button of panel.querySelectorAll<HTMLButtonElement>('button'))button.disabled=s.disabled
 }
 private refs(draft:VideoDraft):StudioLayerSelection[]{return [...(draft.layers??[]).map(layer=>({kind:'visual' as const,id:layer.id})),...(draft.audioTracks??[]).map(layer=>({kind:'audio' as const,id:layer.id})),...draft.scenes.flatMap(scene=>[...(scene.layers??[]).map(layer=>({kind:'visual' as const,id:layer.id,sceneId:scene.id})),...(scene.audioTracks??[]).map(layer=>({kind:'audio' as const,id:layer.id,sceneId:scene.id}))])]}
 private tracks():void{
  const root=element('timeline-independent');root.replaceChildren();const s=this.options.state();if(!s)return
  const duration=s.draft.scenes.reduce((sum,scene)=>sum+scene.durationSeconds,0);if(!duration)return
  for(const ref of this.refs(s.draft)){
   const layer=studioLayer(s.draft,ref),start=studioLayerOffset(s.draft,ref)+layer.startSeconds,row=document.createElement('div'),label=document.createElement('span'),lane=document.createElement('div'),clip=document.createElement('button');row.className='timeline-track independent-track';row.dataset.trackKind=ref.kind;label.className='track-label';label.textContent=(ref.sceneId?'镜头':'全片')+' · '+(ref.kind==='audio'?'音轨':'图层');lane.className='track-lane';clip.className='timeline-clip layer-clip';clip.dataset.layerId=ref.id;clip.dataset.layerKind=ref.kind;if(ref.sceneId)clip.dataset.layerScene=ref.sceneId;clip.dataset.locked=String(layer.locked);clip.textContent=layer.title+(layer.locked?' · 锁定':'')+('hidden'in layer&&layer.hidden||'muted'in layer&&layer.muted?' · 已关闭':'');clip.style.left=`${start/duration*100}%`;clip.style.width=`${layer.durationSeconds/duration*100}%`;clip.classList.toggle('selected',this.selection?.id===ref.id);clip.title=`${layer.title} · ${start.toFixed(2)}–${(start+layer.durationSeconds).toFixed(2)}s · ${ref.sceneId?'镜头局部时间':'全片时间'}`;clip.setAttribute('aria-label',clip.title);clip.disabled=s.disabled
   for(const edge of ['start','end']){const handle=document.createElement('span');handle.dataset.trim=edge;handle.className='layer-trim';clip.append(handle)}
   const menu=document.createElement('button');menu.type='button';menu.className='track-menu-trigger';menu.textContent='⋯';menu.dataset.trackMenu=ref.id;menu.setAttribute('aria-label',layer.title+' · 图层或音轨操作');menu.setAttribute('aria-haspopup','menu');menu.setAttribute('aria-expanded','false');menu.disabled=s.disabled;menu.onclick=()=>this.run(()=>this.openTrackMenu(ref,menu));label.append(menu)
   clip.addEventListener('contextmenu',event=>{event.preventDefault();this.run(()=>this.openTrackMenu(ref,menu,event.clientX,event.clientY))})
   clip.addEventListener('keydown',event=>{if(event.key==='F10'&&event.shiftKey){event.preventDefault();this.run(()=>this.openTrackMenu(ref,menu))}})
   clip.onclick=event=>{event.stopPropagation();this.run(()=>this.choose(ref))};lane.append(clip);row.append(label,lane);root.append(row)
  }
 }
 private resizeTimeline():void{const s=this.options.state();if(s)element('timeline-body').style.minWidth=`${Math.max(640,s.draft.scenes.reduce((n,v)=>n+v.durationSeconds,0)*28*this.zoom)}px`}
 private pointer(event:PointerEvent):void{
  const clip=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-layer-id]');if(!clip||event.button!==0)return
  const ref:StudioLayerSelection={kind:clip.dataset.layerKind as 'visual'|'audio',id:clip.dataset.layerId!,...(clip.dataset.layerScene?{sceneId:clip.dataset.layerScene}:{})},s=this.options.state();if(!s||s.disabled||this.pending)return
  const layer=studioLayer(s.draft,ref);if(layer.locked)return
  event.preventDefault();const lane=clip.parentElement!,rect=lane.getBoundingClientRect(),duration=s.draft.scenes.reduce((n,v)=>n+v.durationSeconds,0),x=event.clientX,edge=(event.target as HTMLElement).dataset.trim as 'start'|'end'|undefined,owner={projectId:s.projectId,draftId:s.draft.id,revision:s.draft.revision};let delta=0,moved=false
  clip.setPointerCapture(event.pointerId)
  const move=(value:PointerEvent)=>{delta=(value.clientX-x)/rect.width*duration;if(this.snap)delta=Math.round(delta*10)/10;if(Math.abs(value.clientX-x)<3)return;moved=true;const offset=studioLayerOffset(s.draft,ref),start=layer.startSeconds+(edge==='end'?0:delta),end=layer.startSeconds+layer.durationSeconds+(edge==='start'?0:delta);clip.style.left=`${(offset+start)/duration*100}%`;clip.style.width=`${Math.max(.1,end-start)/duration*100}%`}
  const cleanup=()=>{clip.removeEventListener('pointermove',move);clip.removeEventListener('pointerup',up);clip.removeEventListener('pointercancel',cancel);this.cancelGesture=undefined}
  const cancel=()=>{cleanup();this.tracks()};const up=()=>{cleanup();if(!moved){this.run(()=>this.choose(ref));return}this.run(async()=>{try{await this.options.commit(owner,draft=>edge?trimStudioLayer(draft,ref,edge,layer.startSeconds+(edge==='end'?layer.durationSeconds:0)+delta):editStudioLayer(draft,ref,value=>{value.startSeconds=Math.max(0,layer.startSeconds+delta)}));this.selection=ref;await this.options.select(ref);this.render();await this.options.refreshPreview()}finally{this.tracks()}})}
  this.cancelGesture=cancel;clip.addEventListener('pointermove',move);clip.addEventListener('pointerup',up);clip.addEventListener('pointercancel',cancel)
 }
 /** Selection chrome uses the actual letterboxed canvas bounds, never export pixels. */
 time():void{
  if(this.cancelGesture)return
  const s=this.options.state(),ref=this.selection;this.canvasBox.hidden=true
  if(!s?.advanced||ref?.kind!=='visual')return
  let layer:VisualLayer;try{layer=studioLayer(s.draft,ref) as VisualLayer}catch{return}
  const local=s.time-studioLayerOffset(s.draft,ref)-layer.startSeconds
  if(layer.hidden||local<0||local>=layer.durationSeconds)return
  this.positionCanvasBox(visualLayerBox(layer,local));this.canvasBox.hidden=false
  for(const button of this.canvasBox.querySelectorAll<HTMLButtonElement>('button'))button.disabled=s.disabled||!s.previewReady||layer.locked||Boolean(this.pending||this.applying)
 }
 private canvasFrame():{left:number;top:number;width:number;height:number}{
  const canvas=element<HTMLCanvasElement>('preview'),rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width/canvas.width,rect.height/canvas.height),width=canvas.width*scale,height=canvas.height*scale
  return {left:rect.left+(rect.width-width)/2,top:rect.top+(rect.height-height)/2,width,height}
 }
 private positionCanvasBox(box:Pick<VisualLayer,'x'|'y'|'width'|'height'>):void{
  const canvas=this.canvasFrame(),parent=element('preview').parentElement!.getBoundingClientRect()
  Object.assign(this.canvasBox.style,{left:`${canvas.left-parent.left+box.x*canvas.width}px`,top:`${canvas.top-parent.top+box.y*canvas.height}px`,width:`${box.width*canvas.width}px`,height:`${box.height*canvas.height}px`})
 }
 private canvasTransform(event:PointerEvent,resize:boolean):void{
  let s=this.options.state();const ref=this.selection,button=event.currentTarget as HTMLButtonElement
  if(!s?.advanced||s.disabled||!s.previewReady||ref?.kind!=='visual'||this.pending||this.applying||this.cancelGesture||event.button!==0)return
  this.options.pausePreview();s=this.options.state()!
  const layer=studioLayer(s.draft,ref) as VisualLayer;if(layer.locked)return
  event.preventDefault();event.stopPropagation()
  const rect=this.canvasFrame(),local=s.time-studioLayerOffset(s.draft,ref)-layer.startSeconds,base=visualLayerBox(layer,local),x=event.clientX,y=event.clientY,owner={projectId:s.projectId,draftId:s.draft.id,revision:s.draft.revision}
  let moved=false,candidate=s.draft,transform={dx:0,dy:0,sx:1,sy:1};button.setPointerCapture(event.pointerId)
  const move=(value:PointerEvent)=>{if(Math.hypot(value.clientX-x,value.clientY-y)<3)return;const dx=(value.clientX-x)/rect.width,dy=(value.clientY-y)/rect.height;transform={dx:resize?0:dx,dy:resize?0:dy,sx:resize?Math.max(.001,(base.width+dx)/base.width):1,sy:resize?Math.max(.001,(base.height+dy)/base.height):1};candidate=transformStudioLayer(s.draft,ref,transform.dx,transform.dy,transform.sx,transform.sy);moved=true;this.positionCanvasBox(visualLayerBox(studioLayer(candidate,ref) as VisualLayer,local));void this.options.previewGeometry(candidate,ref).catch(error=>{if(this.cancelGesture===cancel){cancel();this.error(error)}})}
  const cleanup=()=>{button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',up);button.removeEventListener('pointercancel',cancel);this.cancelGesture=undefined}
  const cancel=()=>{cleanup();this.run(()=>this.options.previewGeometry());this.time()}
  const up=()=>{cleanup();if(!moved){this.time();return}this.run(async()=>{try{await this.options.commit(owner,draft=>transformStudioLayer(draft,ref,transform.dx,transform.dy,transform.sx,transform.sy));await this.options.select(ref);this.render();await this.options.refreshPreview()}finally{await this.options.previewGeometry();this.time()}})}
  this.cancelGesture=cancel;button.addEventListener('pointermove',move);button.addEventListener('pointerup',up);button.addEventListener('pointercancel',cancel)
 }
 private canvasPointer(event:PointerEvent):void{
  const s=this.options.state();if(!s?.advanced||s.disabled||event.button!==0||this.pending)return
  const rect=this.canvasFrame(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;let offset=0,current=s.draft.scenes[0]
  for(const scene of s.draft.scenes){current=scene;if(s.time<offset+scene.durationSeconds)break;offset+=scene.durationSeconds}
  if(!current)return
  const active=activeVisualLayers(s.draft,current,s.time,s.time-offset).reverse(),hit=active.find(item=>{const box=visualLayerBox(item.layer,item.local);return x>=box.x&&x<=box.x+box.width&&y>=box.y&&y<=box.y+box.height})
  if(!hit){this.run(async()=>{await this.flush();this.selection=undefined;this.propertyKey='';await this.options.openFilm();this.render()});return}
  if(hit){const ref:StudioLayerSelection={kind:'visual',id:hit.layer.id,...((current.layers??[]).some(l=>l.id===hit.layer.id)?{sceneId:current.id}:{})};this.run(()=>this.choose(ref))}
 }
}
