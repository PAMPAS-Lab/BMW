import {sceneVisuals} from '../../../media-native/src/visual-segments.js'
import {speechScene,speechBindingStale,assertStudioSpeechLinks} from '../studio-speech-contract.js'
import type {StudioSpeechLinks,SpeechFocusLink} from '../studio-speech-contract.js'
import type {StudioScene,VideoDraft} from '../studio-contract.js'
import {sceneCoverage} from '../studio-contract.js'
type Context={projectId:string;draft:VideoDraft;scene:StudioScene;disabled:boolean}
/** Bounded references, not a second timeline. Pending fields flush before selection or export. */
export class StudioSpeechLinksEditor {
 private flushing=false;private pending?:StudioSpeechLinks;private scope?:{projectId:string;draftId:string;sceneId:string};private details?:HTMLDetailsElement
 constructor(private root:HTMLElement,private context:()=>Context|undefined,private edit:(fn:(scene:StudioScene)=>void)=>Promise<void>,private message:(text:string)=>void,private field:(id:string|undefined)=>void){}
 private run(fn:()=>Promise<void>|void):void{void Promise.resolve().then(fn).catch(error=>this.message(error instanceof Error?error.message:String(error)))}
 async flush():Promise<void>{if(this.flushing||!this.pending)return;const pending=assertStudioSpeechLinks(this.pending),scope=this.scope,context=this.context()
  if(!scope||!context||scope.projectId!==context.projectId||scope.draftId!==context.draft.id||scope.sceneId!==context.scene.id)throw new Error('句锚点引用所属分镜已切换，请重新加载。')
  this.flushing=true;this.field(undefined)
  try{await this.edit(scene=>{scene.speechLinks=pending});this.pending=undefined;this.render()}catch(error){this.field(this.root.id);throw error}finally{this.flushing=false}
 }
 private modify(id:string,fn:(links:StudioSpeechLinks)=>void):void{const c=this.context();if(!c||c.disabled)return;this.pending??=structuredClone(c.scene.speechLinks??{bullets:[],focus:[]});this.scope={projectId:c.projectId,draftId:c.draft.id,sceneId:c.scene.id};fn(this.pending);this.field(id)}
 private button(text:string,fn:()=>Promise<void>|void,disabled=false):HTMLButtonElement{const b=document.createElement('button');b.textContent=text;b.disabled=disabled;b.onclick=()=>this.run(fn);return b}
 private anchors(scene:StudioScene,value:string,id:string,disabled:boolean,change:(id:string)=>void):HTMLSelectElement{const select=document.createElement('select');select.id=id;select.disabled=disabled;select.append(new Option('不引用句锚点',''))
  for(const anchor of scene.speechAnchors?.anchors??[])select.append(new Option(`${scene.narration.slice(anchor.scriptStart,anchor.scriptEnd)} · ${(.5+anchor.startSeconds).toFixed(2)}–${(.5+anchor.endSeconds).toFixed(2)}s`,anchor.id))
  if(value&&![...select.options].some(o=>o.value===value))select.append(new Option('已失效 · '+value,value));select.value=value;select.onchange=()=>{change(select.value);this.run(()=>this.flush())};return select
 }
 render():void{const context=this.context();if(this.pending){for(const n of this.root.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button'))n.disabled=context?.disabled??true;return}const open=this.details?.open??false;this.root.replaceChildren();if(!context)return
  const {scene,draft,disabled}=context,links=scene.speechLinks??{bullets:[],focus:[]},visuals=sceneVisuals(scene)
  this.details=document.createElement('details');this.details.open=open;this.details.className='speech-links advanced';const summary=document.createElement('summary');summary.textContent='按句同步 · 画面强调与板书揭示';this.details.append(summary);this.root.append(this.details)
  const note=document.createElement('p');note.className='muted';const binding=scene.speechAnchors,stale=speechBindingStale(scene,binding)||sceneCoverage(scene,draft.tts).audioStale
  note.textContent=binding?`${stale?'句锚点已过期':'句锚点来源：'+(binding.origin==='user-edited'?'用户编辑':'Agent 编辑')}。选项时间为分镜时间，包含旁白 .5s 起点；画面速度只影响源视频映射。`:'先在旁白面板试听并保存句锚点，再绑定画面强调或板书。';this.details.append(note)
  try{speechScene(scene)}catch(error){const issue=document.createElement('p');issue.className='production-issue';issue.dataset.severity='error';issue.textContent=error instanceof Error?error.message:String(error);this.details.append(issue)}
  const heading=document.createElement('h4');heading.textContent='标题卡板书 · 随句开始揭示';this.details.append(heading)
  if(visuals.length){const p=document.createElement('p');p.className='muted';p.textContent='板书揭示用于无画面素材的标题卡。已有失效引用可解除；画面素材使用下方强调。';this.details.append(p)}
  for(const [index,text]of scene.bullets.entries()){
   const row=document.createElement('label');row.className='speech-link-row';row.textContent=text;const old=links.bullets.find(b=>b.bulletIndex===index),id='speech-bullet-'+index
   const choice=this.anchors(scene,old?.anchorId??'',id,disabled,anchorId=>this.modify(id,value=>{value.bullets=value.bullets.filter(b=>b.bulletIndex!==index);if(anchorId)value.bullets.push({anchorId,bulletIndex:index,text})}));choice.setAttribute('aria-label','板书揭示 '+text);row.append(choice)
   if(old&&old.text!==text){const warning=document.createElement('span');warning.textContent='条目已变化，请重新选择以确认';row.append(warning)}this.details.append(row)
  }
  for(const old of links.bullets.filter(b=>b.bulletIndex>=scene.bullets.length)){const row=document.createElement('p');row.textContent='已移除板书条目：'+old.text;row.append(this.button('解除此板书引用',async()=>{await this.flush();await this.edit(s=>{s.speechLinks!.bullets=s.speechLinks!.bullets.filter(b=>b.bulletIndex!==old.bulletIndex)})},disabled));this.details.append(row)}
  const focusTitle=document.createElement('h4');focusTitle.textContent='画面强调 · 使用整句区间';this.details.append(focusTitle)
  for(const [index,link]of links.focus.entries()){
   const row=document.createElement('section');row.className='speech-link-focus';row.dataset.speechFocus=String(index)
   const set=(key:keyof SpeechFocusLink,value:string|number|boolean,id:string)=>this.modify(id,l=>{l.focus[index]={...l.focus[index],[key]:value}})
   const anchorId='speech-focus-anchor-'+index,anchor=this.anchors(scene,link.anchorId,anchorId,disabled,value=>{if(value)set('anchorId',value,anchorId);else this.modify(anchorId,l=>{l.focus.splice(index,1)})});anchor.setAttribute('aria-label','强调句 '+(index+1));row.append(anchor)
   const target=document.createElement('select');target.id='speech-focus-visual-'+index;target.disabled=disabled;target.setAttribute('aria-label','强调画面 '+(index+1))
   for(const [i,v]of visuals.entries())target.append(new Option(`${i+1} · ${v.imageArtifactId??v.videoArtifactId}`,JSON.stringify({visualIndex:i,artifactId:v.imageArtifactId??v.videoArtifactId})))
   const selected=JSON.stringify({visualIndex:link.visualIndex,artifactId:link.artifactId});if(![...target.options].some(o=>o.value===selected))target.append(new Option('已失效画面 · '+link.artifactId,selected));target.value=selected
   target.onchange=()=>{const v=JSON.parse(target.value) as {visualIndex:number;artifactId:string};this.modify(target.id,l=>{l.focus[index]={...l.focus[index],...v}});this.run(()=>this.flush())};row.append(target)
   for(const [key,label]of [['x','目标横坐标'],['y','目标纵坐标'],['zoom','缩放']] as const){const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('input');input.id='speech-focus-'+key+'-'+index;input.type='number';input.min=key==='zoom'?'1':'0';input.max=key==='zoom'?'4':'1';input.step='.05';input.value=String(link[key]);input.disabled=disabled;input.setAttribute('aria-label',label+' '+(index+1));input.oninput=()=>set(key,Number(input.value),input.id);input.onchange=()=>this.run(()=>this.flush());wrapper.append(input);row.append(wrapper)}
   const label=document.createElement('label');label.className='checkbox';const emphasis=document.createElement('input');emphasis.id='speech-focus-emphasize-'+index;emphasis.type='checkbox';emphasis.checked=link.emphasize;emphasis.disabled=disabled;emphasis.onchange=()=>{set('emphasize',emphasis.checked,emphasis.id);this.run(()=>this.flush())};label.append(emphasis,'显示强调圈');row.append(label,this.button('移除此强调',async()=>{await this.flush();await this.edit(s=>{s.speechLinks!.focus.splice(index,1)})},disabled));this.details.append(row)
  }
  this.details.append(this.button('添加按句强调',async()=>{await this.flush();await this.edit(s=>{const v=sceneVisuals(s)[0],anchor=s.speechAnchors?.anchors.find(a=>!s.speechLinks?.focus.some(f=>f.visualIndex===0&&f.anchorId===a.id));if(!anchor||!v)throw new Error('先保存句锚点并匹配画面。');const crop=v.crop??{x:0,y:0,width:1,height:1};s.speechLinks??={bullets:[],focus:[]};s.speechLinks.focus.push({anchorId:anchor.id,visualIndex:0,artifactId:(v.imageArtifactId??v.videoArtifactId)!,x:crop.x+crop.width/2,y:crop.y+crop.height/2,zoom:2,emphasize:true})})},disabled||stale||!binding?.anchors.length||!visuals.length||links.focus.length>=24))
  if(links.bullets.length||links.focus.length)this.details.append(this.button('解除全部句锚点引用',async()=>{await this.flush();await this.edit(s=>{delete s.speechLinks})},disabled))
 }
}
