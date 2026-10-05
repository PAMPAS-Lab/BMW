import {studioTimeline} from '../studio-timeline.js'
import type {StudioTimelineClip} from '../studio-timeline.js'
import type {VideoDraft} from '../studio-contract.js'
export type InspectorMode='visual'|'voice'|'captions'|'cover'|'delivery'
const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
const names:Record<InspectorMode,string>={visual:'画面',voice:'旁白',captions:'字幕',cover:'全片封面',delivery:'全片交付'}
export class StudioWorkbench {
  mode:InspectorMode='visual'
  private duration=0
  render(draft:VideoDraft|undefined,index:number,stage:number,disabled:boolean,previewDirty:boolean):void{
    const editing=stage===4,hasScene=Boolean(draft?.scenes.length),mode=editing?this.mode:'visual'
    node('studio-workspace').dataset.workbench=String(editing);node('studio-workspace').dataset.inspector=String(stage>=3&&Boolean(draft))
    node('inspector').hidden=stage<3||!draft;node('inspector-tabs').hidden=!editing
    for(const [id,target,highlight] of [['studio-cover-open','cover','active'],['delivery-open','delivery','primary']] as const){const active=editing&&Boolean(draft)&&mode===target;node(id).classList.toggle(highlight,active);node(id).setAttribute('aria-pressed',String(active))}
    for(const tab of (document.querySelectorAll('[data-inspector]') as HTMLButtonElement[])){
      const active=tab.dataset.inspector===mode;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.disabled=disabled||!draft||(!hasScene&&['visual','voice','captions'].includes(tab.dataset.inspector!))
    }
    node('inspector-context').textContent=mode==='cover'||mode==='delivery'?names[mode]:hasScene?`分镜 ${index+1} / ${draft!.scenes.length} · ${draft!.scenes[index].title}`:'尚未创建分镜'
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
    const ruler=node('timeline-ruler');ruler.replaceChildren()
    for(let i=0;i<=6;i++){const mark=document.createElement('span');mark.style.left=`${i/6*100}%`;mark.textContent=(model.duration*i/6).toFixed(1)+'s';ruler.append(mark)}
    for(const [kind,id,label]of [['scene','timeline','分镜'],['visual','timeline-visuals','画面'],['focus','timeline-focus','重点'],['reveal','timeline-reveals','板书'],['voice','timeline-voice','旁白'],['caption','timeline-captions','字幕']] as const){
      const row=node(id);if(kind==='reveal')row.hidden=!model.clips.some(c=>c.kind==='reveal');row.replaceChildren();const name=document.createElement('span');name.className='track-label';name.textContent=label
      const lane=document.createElement('div');lane.className='track-lane';row.append(name,lane)
      for(const clip of model.clips.filter(clip=>clip.kind===kind))lane.append(this.clip(clip,index,model.duration))
      if(!lane.childElementCount){const empty=document.createElement('span');empty.className='track-empty';empty.textContent='未设置';lane.append(empty)}
    }
  }
  private clip(clip:StudioTimelineClip,index:number,duration:number):HTMLButtonElement{
    const button=document.createElement('button');button.className='timeline-clip';button.classList.toggle('selected',clip.sceneIndex===index);button.classList.toggle('stale',Boolean(clip.stale))
    button.dataset.sceneIndex=String(clip.sceneIndex);button.dataset.seconds=String(clip.start);button.dataset.kind=clip.kind
    button.style.left=`${clip.start/duration*100}%`;button.style.width=`${(clip.end-clip.start)/duration*100}%`
    button.textContent=clip.label;const description=`${clip.label} · ${clip.start.toFixed(2)}–${clip.end.toFixed(2)} 秒${clip.estimated?' · 估算字幕':''}${clip.origin?' · '+clip.origin:''}${clip.stale?' · 绑定需修复':''}`;button.title=description;button.setAttribute('aria-label',description);button.setAttribute('aria-pressed',String(clip.sceneIndex===index));return button
  }
  time(seconds:number):void{const ratio=this.duration?Math.min(1,Math.max(0,seconds/this.duration)):0;node('timeline-playhead').style.left=`calc(${48*(1-ratio)}px + ${100*ratio}%)`}
}
