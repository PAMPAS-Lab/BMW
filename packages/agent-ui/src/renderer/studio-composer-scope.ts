import type {AssistantState,AssistantStudioTarget} from '../../../agent-contract/index.js'
const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
type LabeledTarget={target:AssistantStudioTarget;label:string}
/** One composer keeps its unsent text and explicit target with the owning conversation. */
export class StudioComposerScope {
 private live?:LabeledTarget
 private pinned?:LabeledTarget
 private owner=''
 private drafts=new Map<string,{text:string;pinned?:LabeledTarget}>()
 constructor(private input:HTMLTextAreaElement,private state:()=>AssistantState|null){
  input.addEventListener('input',()=>{if(input.value.trim()&&!this.pinned&&this.live)this.pinned=structuredClone(this.live);if(!input.value.trim())this.pinned=undefined;this.render()})
  node('studio-scope').onclick=()=>{this.renderChoices();node<HTMLDialogElement>('studio-scope-dialog').showModal()}
  node('studio-scope-close').onclick=()=>node<HTMLDialogElement>('studio-scope-dialog').close()
 }
 ownerChanged(state:AssistantState):void{
  const next=state.project.id+':'+(state.selectedSessionId??'');if(next===this.owner)return
  if(this.owner)this.drafts.set(this.owner,{text:this.input.value,pinned:this.pinned})
  this.owner=next;const saved=this.drafts.get(next);this.input.value=saved?.text??'';this.pinned=saved?.pinned;this.live=undefined;this.render()
 }
 context(raw:unknown):void{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return
  const value=raw as Record<string,unknown>,selection=value.selection as Record<string,unknown>|undefined,state=this.state()
  if(!state||value.projectId!==state.project.id||value.sessionId!==state.selectedSessionId)return
  if(value.mode!=='studio'||!selection||typeof selection.draftId!=='string'){this.live=undefined;this.render();return}
  const target:AssistantStudioTarget={projectId:state.project.id,sessionId:state.selectedSessionId!,draftId:selection.draftId,kind:typeof selection.sceneId==='string'?'scene':'film'}
  if(typeof selection.sceneId==='string')target.sceneId=selection.sceneId
  if(['visual','voice','captions'].includes(String(selection.objectKind)))target.objectKind=selection.objectKind as AssistantStudioTarget['objectKind']
  if(target.objectKind==='voice'&&target.sceneId&&typeof selection.voiceSegmentId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(selection.voiceSegmentId)){target.kind='object';target.voiceSegmentId=selection.voiceSegmentId}
  if(target.objectKind==='visual'&&target.sceneId&&typeof selection.visualSegmentId==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(selection.visualSegmentId)){target.kind='object';target.visualSegmentId=selection.visualSegmentId}
  const layer=selection.layer&&typeof selection.layer==='object'&&!Array.isArray(selection.layer)?selection.layer as Record<string,unknown>:undefined
  if(layer&&Object.keys(layer).every(key=>['id','kind'].includes(key))&&typeof layer.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(layer.id)&&['visual','audio'].includes(String(layer.kind))){target.kind='object';target.layer={id:layer.id,kind:layer.kind as 'visual'|'audio'};delete target.objectKind}
  const object=value.object&&typeof value.object==='object'?value.object as Record<string,unknown>:undefined
  this.live={target,label:(target.layer||target.voiceSegmentId||target.visualSegmentId)?String(object?.title??'当前对象'):target.sceneId?String(value.sceneTitle??'当前镜头'):String(value.draftTitle??'整支视频')};this.render()
 }
 prefill(raw:unknown):boolean{
  if(this.input.value.trim()||!raw||typeof raw!=='object'||Array.isArray(raw))return false
  const value=raw as Record<string,unknown>,target=value.target as AssistantStudioTarget|undefined,state=this.state()
  if(target&&state&&target.projectId===state.project.id&&target.sessionId===state.selectedSessionId&&typeof target.draftId==='string')this.pinned={target:structuredClone(target),label:typeof value.targetLabel==='string'?value.targetLabel:'指定视频范围'}
  else if(!this.pinned&&this.live)this.pinned=structuredClone(this.live)
  this.render();return true
 }
 target():AssistantStudioTarget|undefined{return this.pinned?.target??this.live?.target}
 sent():void{this.pinned=undefined;this.drafts.delete(this.owner);this.render()}
 private render():void{
  const target=this.pinned??this.live,b=node<HTMLButtonElement>('studio-scope');b.hidden=!target
  const kind=target?.target.kind==='film'?'整支视频':target?.target.kind==='object'?(target.target.layer?(target.target.layer.kind==='audio'?'音轨':'图层'):({visual:'画面',voice:'旁白',captions:'字幕'}[target.target.objectKind??'visual'])):'镜头'
  b.textContent=target?`${kind} · ${target.label}${this.pinned?' · 已固定':''} · 更改`:''
 }
 private renderChoices():void{
  const list=node('studio-scope-choices');list.replaceChildren();const current=this.live??this.pinned;if(!current)return
  const choices:{kind:AssistantStudioTarget['kind'];label:string}[]=[{kind:'film',label:'整支视频'}]
  if(current.target.sceneId)choices.push({kind:'scene',label:'当前镜头'})
  if(current.target.layer||current.target.sceneId)choices.push({kind:'object',label:current.target.layer?'当前对象 · '+current.label:'当前编辑对象 · '+({visual:'画面',voice:'旁白',captions:'字幕'}[current.target.objectKind??'visual'])})
  for(const choice of choices){const button=document.createElement('button');button.type='button';button.textContent=choice.label;button.onclick=()=>{const target={...current.target,kind:choice.kind};if(choice.kind==='film'){delete target.sceneId;delete target.objectKind;delete target.layer;delete target.voiceSegmentId;delete target.visualSegmentId}else if(choice.kind==='scene'){delete target.layer;delete target.objectKind;delete target.voiceSegmentId;delete target.visualSegmentId}else if(choice.kind==='object'&&!target.layer)target.objectKind??='visual';this.pinned={target,label:choice.kind==='film'?'当前视频':current.label};this.render();node<HTMLDialogElement>('studio-scope-dialog').close();this.input.focus()};list.append(button)}
 }
}
