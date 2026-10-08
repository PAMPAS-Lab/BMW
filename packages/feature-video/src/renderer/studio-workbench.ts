import {studioTimeline} from '../studio-timeline.js'
import type {StudioTimelineClip} from '../studio-timeline.js'
import type {VideoDraft} from '../studio-contract.js'
export type InspectorMode='visual'|'voice'|'captions'|'cover'|'delivery'|'layer'|'film'
const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
const names:Record<InspectorMode,string>={visual:'画面',voice:'旁白',captions:'字幕',cover:'全片封面',delivery:'全片交付',layer:'独立对象',film:'全片设置'}
export class StudioWorkbench {
  mode:InspectorMode='visual'
  private duration=0
  private optionsHome?:Comment
  private optionsGrouped=false
  private filmProperties(enabled:boolean):void{
    const panel=node('studio-output-panel'),dialog=node<HTMLDialogElement>('settings-dialog')
    if(!this.optionsHome){this.optionsHome=document.createComment('studio-output-home');panel.parentNode!.insertBefore(this.optionsHome,panel)}
    if(!this.optionsGrouped){
      const form=node('studio-output-options')
      for(const [label,keys]of [['声音',['tts-voice','tts-rate','music']],['品牌与水印',['watermark-enabled','watermark-text','watermark-position','watermark-size','watermark-opacity']]] as const){
        const details=document.createElement('details'),heading=document.createElement('summary'),grid=document.createElement('div');heading.textContent=label;grid.className='video-options-grid';details.append(heading,grid);form.append(details)
        for(const key of keys)grid.append(node('studio-output-'+key).closest('label')!)
        if(label==='声音')for(const note of form.querySelectorAll<HTMLParagraphElement>('.video-options-grid>p'))grid.append(note)
      }
      const templates=document.createElement('details'),heading=document.createElement('summary');heading.textContent='视频模板';templates.append(heading);panel.append(templates)
      templates.append(node('studio-output-template').closest('label')!,node('studio-output-template-name').closest('label')!,node('studio-output-template-save'))
      this.optionsGrouped=true
    }
    const target=enabled&&!dialog.open?node('film-properties'):this.optionsHome.parentNode!
    if(panel.parentNode!==target){if(target===this.optionsHome.parentNode)target.insertBefore(panel,this.optionsHome.nextSibling);else target.append(panel)}
    node('film-properties').hidden=!enabled
  }
  private timelineOwner=''
  private timelineActive=false
  private timelineDisabled=false
  private timelineRatios=new Map<string,number>()
  private timelineGesture?:{pointerId:number;startY:number;startHeight:number}
  private timelineBounds():{min:number;max:number;available:number}{
    const available=Math.max(1,node('timeline-dock').getBoundingClientRect().bottom-node('studio-workspace').getBoundingClientRect().top)
    const max=Math.max(1,Math.min(available*.45,available-220)),min=Math.min(170,max)
    return {min,max,available}
  }
  private sizeTimeline(height:number):void{
    if(!this.timelineActive)return
    const bounds=this.timelineBounds(),value=Math.min(bounds.max,Math.max(bounds.min,height)),handle=node('timeline-resizer')
    node('timeline-dock').style.height=value+'px'
    handle.setAttribute('aria-valuemin',String(Math.round(bounds.min)));handle.setAttribute('aria-valuemax',String(Math.round(bounds.max)));handle.setAttribute('aria-valuenow',String(Math.round(value)));handle.setAttribute('aria-valuetext',`时间轴高度 ${Math.round(value)} 像素`)
    window.dispatchEvent(new Event('studio-layout-resized'))
  }
  private rememberTimeline():void{
    const ratio=node('timeline-dock').getBoundingClientRect().height/this.timelineBounds().available
    this.timelineRatios.delete(this.timelineOwner);this.timelineRatios.set(this.timelineOwner,ratio)
    while(this.timelineRatios.size>16)this.timelineRatios.delete(this.timelineRatios.keys().next().value!)
  }
  private finishTimeline(cancel:boolean):void{
    const gesture=this.timelineGesture;if(!gesture)return
    this.timelineGesture=undefined
    const handle=node('timeline-resizer');if(handle.hasPointerCapture(gesture.pointerId))handle.releasePointerCapture(gesture.pointerId)
    document.body.classList.remove('studio-timeline-resizing')
    if(cancel)this.sizeTimeline(gesture.startHeight);else this.rememberTimeline()
  }
  layoutTimeline(owner:string,active:boolean,disabled:boolean):void{
    if(this.timelineGesture&&(owner!==this.timelineOwner||!active||disabled))this.finishTimeline(true)
    this.timelineOwner=owner;this.timelineActive=active;this.timelineDisabled=disabled
    const handle=node('timeline-resizer');handle.hidden=!active;handle.setAttribute('aria-disabled',String(disabled));handle.tabIndex=active&&!disabled?0:-1
    if(active){if(!this.timelineGesture)this.sizeTimeline((this.timelineRatios.get(owner)??.34)*this.timelineBounds().available)}else node('timeline-dock').style.removeProperty('height')
  }
  private chromeReady=false
  private chromeAdvanced=false
  constructor(){
    const handle=node('timeline-resizer')
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0||!this.timelineActive||this.timelineDisabled)return
      event.preventDefault();handle.focus();this.finishTimeline(true)
      this.timelineGesture={pointerId:event.pointerId,startY:event.clientY,startHeight:node('timeline-dock').getBoundingClientRect().height}
      handle.setPointerCapture(event.pointerId);document.body.classList.add('studio-timeline-resizing')
    })
    handle.addEventListener('pointermove',event=>{const g=this.timelineGesture;if(g&&event.pointerId===g.pointerId)this.sizeTimeline(g.startHeight+g.startY-event.clientY)})
    handle.addEventListener('pointerup',event=>{if(event.pointerId===this.timelineGesture?.pointerId)this.finishTimeline(false)})
    handle.addEventListener('pointercancel',()=>this.finishTimeline(true));handle.addEventListener('lostpointercapture',()=>this.finishTimeline(true))
    handle.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&this.timelineGesture){event.preventDefault();this.finishTimeline(true);return}
      if(this.timelineGesture||this.timelineDisabled||!this.timelineActive||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return
      event.preventDefault();const bounds=this.timelineBounds(),height=node('timeline-dock').getBoundingClientRect().height
      this.sizeTimeline(event.key==='Home'?bounds.min:event.key==='End'?bounds.max:height+(event.key==='ArrowUp'?1:-1)*(event.shiftKey?48:24));this.rememberTimeline()
    })
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.timelineGesture){event.preventDefault();this.finishTimeline(true)}})
    window.addEventListener('blur',()=>this.finishTimeline(true))
    window.addEventListener('resize',()=>{this.finishTimeline(true);if(this.timelineActive)this.sizeTimeline((this.timelineRatios.get(this.timelineOwner)??.34)*this.timelineBounds().available)})
    document.addEventListener('click',event=>{const menu=node<HTMLDetailsElement>('studio-more');if(menu.open&&!menu.contains(event.target as Node))menu.open=false})
    document.addEventListener('keydown',event=>{if(event.key==='Escape')node<HTMLDetailsElement>('studio-more').open=false})
  }
  private chrome(advanced:boolean):void{
    const menu=node('studio-menu-items'),header=document.querySelector('header')!
    node('studio-more').hidden=false
    if(!this.chromeReady){
      for(const value of [node('draft-select').closest('label')!,...['new-draft','delete-draft','settings-open','reload','save','leave'].map(id=>node(id))])menu.append(value)
      for(const id of ['undo','redo'])header.insertBefore(node(id),node('view-toggle'))
      header.insertBefore(node('cards-materials'),node('view-toggle'))
      this.chromeReady=true
    }
    if(advanced!==this.chromeAdvanced)node<HTMLDetailsElement>('studio-more').open=false
    this.chromeAdvanced=advanced
  }
  render(draft:VideoDraft|undefined,index:number,stage:number,disabled:boolean,previewDirty:boolean,advanced=false):void{
    this.chrome(advanced)
    node<HTMLButtonElement>('cards-materials').disabled=disabled||!draft
    this.filmProperties(advanced&&stage===4&&this.mode==='film'&&Boolean(draft))
    const editing=stage===4,hasScene=Boolean(draft?.scenes.length),mode=editing?this.mode:'visual'
    node('studio-workspace').dataset.workbench=String(editing);node('studio-workspace').dataset.inspector=String(stage>=3&&Boolean(draft))
    node('inspector').hidden=stage<3||!draft;node('inspector-tabs').hidden=!editing||mode==='film'
    for(const [id,target,highlight] of [['studio-cover-open','cover','active'],['delivery-open','delivery','active']] as const){const active=editing&&Boolean(draft)&&mode===target;node(id).classList.toggle(highlight,active);node(id).setAttribute('aria-pressed',String(active))}
    for(const tab of (document.querySelectorAll('[data-inspector]') as HTMLButtonElement[])){
      const active=tab.dataset.inspector===mode;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.disabled=disabled||!draft||(!hasScene&&['visual','voice','captions'].includes(tab.dataset.inspector!))
    }
    node('inspector-context').textContent=mode==='cover'||mode==='delivery'||mode==='film'?names[mode]:hasScene?`分镜 ${index+1} / ${draft!.scenes.length} · ${draft!.scenes[index].title}`:'尚未创建分镜'
    node('scene-properties').hidden=stage<3||!hasScene||!['visual','voice'].includes(mode)
    for(const group of (document.querySelectorAll('[data-property]') as HTMLElement[]))group.hidden=group.dataset.property!=='common'&&group.dataset.property!==mode
    for(const details of (document.querySelectorAll('#scene-properties details') as HTMLDetailsElement[]))details.hidden=mode!=='visual'
    node('caption-panel').hidden=!editing||!hasScene||mode!=='captions';node<HTMLDetailsElement>('caption-panel').open=true
    node('cover-panel').hidden=!editing||mode!=='cover';node<HTMLDetailsElement>('cover-panel').open=true
    node('delivery-panel').hidden=!editing||mode!=='delivery'
    const audioPanel=(document.querySelector('.script-audio-panel') as HTMLElement),scriptEditor=(document.querySelector('.script-editor') as HTMLElement)
    const parent=editing?node('voice-actions'):scriptEditor;if(audioPanel.parentElement!==parent)parent.append(audioPanel)
    const speechPanel=node('studio-speech-editor');if(speechPanel.parentElement!==parent)parent.append(speechPanel)
    node('voice-actions').hidden=!editing||!hasScene||mode!=='voice'
    node('studio-speech-links').hidden=stage<3||!hasScene||!['visual','voice'].includes(mode)
    node('match-controls').hidden=stage<3||!hasScene||mode!=='visual';node('visual-segments').hidden=stage<3||!hasScene||mode!=='visual'
    node('canvas-workspace').hidden=!editing||!draft
    node('preview').parentElement!.hidden=!hasScene||mode==='cover';node('transport').hidden=!hasScene||mode==='cover'
    node('cover-canvas').hidden=mode!=='cover';node('cover-preview-empty').hidden=!node('cover-preview').hidden
    node('canvas-context').textContent=mode==='cover'?'全片 · 独立封面 PNG':hasScene?`分镜 ${index+1} / ${draft!.scenes.length} · ${draft!.scenes[index].title}`:'请创建分镜或制作封面'
    node('preview-status').textContent=mode==='cover'?draft?`${draft.width} × ${draft.height}`:'':previewDirty?'预览待更新':'预览已更新'
    node<HTMLButtonElement>('preview-refresh').hidden=mode==='cover'||!hasScene;node<HTMLButtonElement>('preview-refresh').disabled=disabled
    node('timeline-dock').hidden=!editing||!hasScene||mode==='cover';node('workbench-assets').hidden=!editing||!draft
    if(draft)this.timeline(draft,index)
  }
  private timeline(draft:VideoDraft,index:number):void{
    const model=studioTimeline(draft);this.duration=model.duration;node('timeline-summary').textContent=`${draft.scenes.length} 个分镜 · ${model.duration.toFixed(1)} 秒`
    node('timeline-body').style.minWidth=`${Math.max(640,model.duration*28)}px`
    const ruler=node('timeline-ticks');ruler.replaceChildren();const position=node<HTMLInputElement>('timeline-position');position.max=String(model.duration);position.step=String(1/draft.fps)
    for(let i=0;i<=6;i++){const mark=document.createElement('span');mark.style.left=`${i/6*100}%`;mark.textContent=(model.duration*i/6).toFixed(1)+'s';ruler.append(mark)}
    for(const [kind,id,label]of [['scene','timeline','分镜'],['visual','timeline-visuals','画面'],['focus','timeline-focus','重点'],['reveal','timeline-reveals','板书'],['voice','timeline-voice','旁白'],['caption','timeline-captions','字幕']] as const){
      const row=node(id);row.hidden=kind!=='scene'&&!model.clips.some(c=>c.kind===kind);row.replaceChildren();const name=document.createElement('span');name.className='track-label';name.textContent=label
      const lane=document.createElement('div');lane.className='track-lane';row.append(name,lane)
      for(const clip of model.clips.filter(clip=>clip.kind===kind))lane.append(this.clip(clip,index,model.duration))
      if(!lane.childElementCount){const empty=document.createElement('span');empty.className='track-empty';empty.textContent='未设置';lane.append(empty)}
    }
  }
  private clip(clip:StudioTimelineClip,index:number,duration:number):HTMLButtonElement{
    const button=document.createElement('button');button.className='timeline-clip';button.classList.toggle('selected',clip.sceneIndex===index);button.classList.toggle('stale',Boolean(clip.stale))
    if(clip.visualSegmentId)button.dataset.visualSegmentId=clip.visualSegmentId;if(clip.voiceSegmentId)button.dataset.voiceSegmentId=clip.voiceSegmentId;button.dataset.sceneId=clip.sceneId;button.dataset.itemIndex=String(clip.itemIndex??0);button.dataset.endSeconds=String(clip.end);
    if(['scene','visual','voice','caption'].includes(clip.kind))button.dataset.mainKind=clip.kind
    button.dataset.sceneIndex=String(clip.sceneIndex);button.dataset.seconds=String(clip.start);button.dataset.kind=clip.kind
    button.style.left=`${clip.start/duration*100}%`;button.style.width=`${(clip.end-clip.start)/duration*100}%`
    button.textContent=clip.label;const description=`${clip.label} · ${clip.start.toFixed(2)}–${clip.end.toFixed(2)} 秒${clip.estimated?' · 估算字幕':''}${clip.origin?' · '+clip.origin:''}${clip.stale?' · 绑定需修复':''}`;button.title=description;button.setAttribute('aria-label',description);button.setAttribute('aria-pressed',String(clip.sceneIndex===index));if(['scene','visual','voice','caption'].includes(clip.kind)){for(const edge of clip.kind==='scene'?['end']:['start','end']){const handle=document.createElement('span');handle.className='main-trim main-trim-'+edge;handle.dataset.mainEdge=edge;handle.setAttribute('aria-hidden','true');button.append(handle)}}return button
  }
  time(seconds:number):void{const ratio=this.duration?Math.min(1,Math.max(0,seconds/this.duration)):0;node<HTMLInputElement>('timeline-position').value=String(seconds);node('timeline-playhead').style.left=`calc(${92*(1-ratio)}px + ${100*ratio}%)`}
}
