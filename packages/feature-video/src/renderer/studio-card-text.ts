import {StudioPreview} from './studio-preview.js'
import {speechScene} from '../studio-speech-contract.js'
import {reviewSceneText} from '../../../media-native/src/media/composition-paint.js'
import {sceneVisuals} from '../../../media-native/src/visual-segments.js'
import type {CompositionTextBox} from '../../../media-native/src/media/composition-paint.js'
import type {VideoDraft,StudioScene} from '../studio-contract.js'

export interface CardTextOwner {projectId:string;sessionId:string|null;draftId:string;revision:number;sceneId:string}
export interface CardTextField {kind:'title'|'bullet';index:number}
interface Context {projectId:string;sessionId:string|null;draft:VideoDraft;scene:StudioScene;active:boolean;disabled:boolean;previewReady:boolean}
interface Options {
 state():Context|undefined
 painted():{sceneId:string;boxes:CompositionTextBox[]}|undefined
 flush():Promise<void>
 select(sceneId:string):Promise<void>
 commit(owner:CardTextOwner,field:CardTextField,text:string,append?:boolean):Promise<void>
 remove(owner:CardTextOwner,index:number):Promise<void>
 bytes(id:string):Promise<Uint8Array>
 template(owner:CardTextOwner,kind:TemplateKind):Promise<void>
 refresh():Promise<void>
 pause():void
 notify(message:string):void
}
type TemplateKind=NonNullable<StudioScene['sceneTemplate']>['kind']|''
const templates:readonly {kind:TemplateKind;name:string}[]=[{kind:'',name:'要点列表'},{kind:'summary',name:'三点总结'},{kind:'comparison',name:'两项对比'},{kind:'screenshot',name:'画面解读'}]
export function cardTemplateScene(scene:StudioScene,kind:TemplateKind):StudioScene {const next=structuredClone(scene);if(kind)next.sceneTemplate={...scene.sceneTemplate,kind};else delete next.sceneTemplate;return next}
export function changeCardBullet(scene:StudioScene,change:{operation:'add';text:string}|{operation:'remove';index:number}):StudioScene {
 const next=structuredClone(scene)
 if(next.sceneTemplate){const name=templates.find(item=>item.kind===next.sceneTemplate!.kind)!.name;throw new Error(name+'需要固定数量的要点，请先点“更换”选择“要点列表”，再增删要点。')}
 if(sceneVisuals(next).length)throw new Error('当前画面不显示要点，请先选择适合的卡片画面。')
 if(change.operation==='add'){
  if(next.bullets.length>=3)throw new Error('每张卡片最多 3 条要点。')
  if(!change.text.trim())throw new Error('请填写新要点，或按 Esc 取消。')
  next.bullets.push(change.text);next.bulletRevealSeconds?.push(0)
 }else{
  const index=change.index;if(!Number.isInteger(index)||index<0||index>=next.bullets.length)throw new Error('要点已变化，请重新打开编辑卡片。')
  next.bullets.splice(index,1);next.bulletRevealSeconds?.splice(index,1)
  if(next.speechLinks)next.speechLinks.bullets=next.speechLinks.bullets.filter(link=>link.bulletIndex!==index).map(link=>({...link,bulletIndex:link.bulletIndex>index?link.bulletIndex-1:link.bulletIndex}))
 }
 return next
}
interface Pending {owner:CardTextOwner;field:CardTextField;original:string;text:string;canvas:boolean;append?:boolean}
const key=(field:CardTextField)=>field.kind+':'+field.index
const value=(scene:StudioScene,field:CardTextField)=>field.kind==='title'?scene.title:scene.bullets[field.index]??''
const owner=(s:Context,sceneId=s.scene.id):CardTextOwner=>({projectId:s.projectId,sessionId:s.sessionId,draftId:s.draft.id,revision:s.draft.revision,sceneId})
/** Fixed-template text only: one local input, canonical CAS save and signed undo. */
export class StudioCardTextEditor {
 private panel=document.createElement('section')
 private overlay=document.createElement('div')
 private pending?:Pending
 private selected?:{sceneId:string;field:CardTextField}
 private expanded?:string
 private applying?:Promise<void>
 private gallery?:{owner:CardTextOwner;kind:TemplateKind;ready:boolean}
 private templatePreview?:StudioPreview
 private templateWork:Promise<void>=Promise.resolve()
 private templateGeneration=0
 private error=''
 private canvasSignature=''
 private canvas=document.getElementById('preview') as HTMLCanvasElement
 constructor(private options:Options){
  this.panel.id='card-text-panel';this.panel.className='studio-card-text';this.panel.setAttribute('aria-label','编辑卡片')
  this.overlay.id='canvas-card-text';this.overlay.className='canvas-card-text';this.canvas.parentElement!.append(this.overlay)
  window.addEventListener('resize',()=>this.renderCanvas())
  new ResizeObserver(()=>this.renderCanvas()).observe(this.canvas)
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.options.state()?.active&&(this.pending||this.selected||this.gallery)){event.preventDefault();event.stopImmediatePropagation();this.cancel()}},true)
  document.addEventListener('pointerdown',event=>{const target=event.target as HTMLElement;if(this.pending&&!this.panel.contains(target)&&!this.overlay.contains(target)&&!target.closest('button,input,textarea,select'))this.run(()=>this.flush())})
 }
 discard():void{void this.closeTemplates().catch(error=>this.options.notify(String(error)));this.pending=undefined;this.selected=undefined;this.expanded=undefined;this.error='';this.canvasSignature='';this.panel.replaceChildren();this.overlay.replaceChildren()}
 hasPending():boolean{return Boolean(this.pending||this.applying)}
 time():void{this.renderCanvas()}
 private run(fn:()=>Promise<void>):void{void fn().catch(error=>{this.error=error instanceof Error?error.message:String(error);this.options.notify(this.error);this.renderError()})}
 private valid(o:CardTextOwner):Context {const s=this.options.state();if(!s||!s.active||s.disabled||s.projectId!==o.projectId||s.sessionId!==o.sessionId||s.draft.id!==o.draftId||s.draft.revision!==o.revision||!s.draft.scenes.some(scene=>scene.id===o.sceneId))throw new Error('STUDIO_CONFLICT: 文字所属草稿或版本已变化，输入已保留；请取消或重新加载后处理。');return s}
 async openCard():Promise<void>{await this.options.flush();const s=this.options.state();if(!s?.active||s.disabled)return;this.options.pause();this.expanded=this.expanded===s.scene.id?undefined:s.scene.id;this.render();if(this.expanded)this.panel.querySelector<HTMLTextAreaElement>('textarea')?.focus()}
 async flush():Promise<void>{
  if(this.applying)return this.applying
  await this.closeTemplates()
  const pending=this.pending;if(!pending)return
  if(pending.text===pending.original){this.pending=undefined;this.render();return}
  const operation=(async()=>{this.valid(pending.owner);await this.options.commit(pending.owner,pending.field,pending.text,pending.append);if(this.pending===pending){this.pending=undefined;if(pending.append)this.panel.replaceChildren()};this.error='';this.render();await this.options.refresh()})()
  this.applying=operation
  try{await operation}finally{this.applying=undefined;this.render()}
 }
 private cancel():void{if(this.applying)return;if(this.gallery){this.run(async()=>{await this.closeTemplates();this.render()});return;}const pending=this.pending;if(pending)for(const input of this.panel.querySelectorAll<HTMLTextAreaElement>('[data-card-text-field]'))if(input.dataset.cardTextField===key(pending.field))input.value=pending.original;this.pending=undefined;this.selected=undefined;this.error='';this.canvasSignature='';this.render();this.options.notify('已取消本次文字输入，草稿内容保留。')}
 render():void{
  const s=this.options.state(),card=document.querySelector('.studio-card.selected') as HTMLElement|null
  if(this.gallery&&(!s?.active||s.scene.id!==this.gallery.owner.sceneId||s.draft.id!==this.gallery.owner.draftId||s.draft.revision!==this.gallery.owner.revision||s.projectId!==this.gallery.owner.projectId||s.sessionId!==this.gallery.owner.sessionId)){void this.closeTemplates().catch(error=>this.options.notify(String(error)))}
  if(!s?.active||!card){this.panel.hidden=true;this.overlay.hidden=true;this.canvasSignature='';return}
  this.panel.hidden=this.expanded!==s.scene.id
  if(!this.panel.hidden){card.append(this.panel);if(!this.pending&&!this.applying&&!this.gallery){if(!this.panel.contains(document.activeElement)||this.panel.querySelectorAll('[data-card-text-field]').length!==1+(!sceneVisuals(s.scene).length||s.scene.sceneTemplate?s.scene.bullets.length:0))this.renderPanel(s);else for(const input of this.panel.querySelectorAll<HTMLTextAreaElement>('[data-card-text-field]')){const [kind,index]=input.dataset.cardTextField!.split(':');input.value=value(s.scene,{kind:kind==='title'?'title':'bullet',index:Number(index)})}};for(const field of this.panel.querySelectorAll<HTMLTextAreaElement|HTMLButtonElement>('textarea,button'))field.disabled=s.disabled||Boolean(this.applying)||field.dataset.templateUnavailable==='true'||(field.id==='card-bullet-add'&&s.scene.bullets.length>=3)||(field.id==='card-template-apply'&&!this.gallery?.ready)}
  this.renderCanvas()
 }
 private renderError():void{for(const root of [this.panel,this.overlay]){let notice=root.querySelector<HTMLElement>('.card-text-error');if(!notice){notice=document.createElement('p');notice.className='card-text-error';notice.setAttribute('role','alert');root.append(notice)}notice.textContent=this.error;notice.hidden=!this.error}}
 private input(field:CardTextField,text:string,canvas:boolean):HTMLTextAreaElement{
  const input=document.createElement('textarea');input.value=text;input.rows=field.kind==='title'?2:2;input.maxLength=field.kind==='title'?44:64;input.dataset.cardTextField=key(field);input.setAttribute('aria-label',field.kind==='title'?'画面标题':'画面要点 '+(field.index+1))
  input.addEventListener('focus',()=>{this.options.pause();const s=this.options.state();if(s)this.selected={sceneId:s.scene.id,field}})
  input.addEventListener('input',()=>{
   const s=this.options.state();if(!s?.active||s.disabled)return
   if(!this.pending){this.pending={owner:owner(s),field,original:value(s.scene,field),text:input.value,canvas};this.error=''}
   if(key(this.pending.field)!==key(field))return
   this.pending.text=input.value
   for(const root of [this.panel,this.overlay])for(const other of root.querySelectorAll<HTMLTextAreaElement>('[data-card-text-field]'))if(other!==input&&other.dataset.cardTextField===key(field))other.value=input.value
  })
  input.addEventListener('change',()=>{if(!this.pending?.append)this.run(()=>this.flush())})
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();this.run(()=>this.flush())}})
  return input
 }
 private renderPanel(s:Context):void{
  this.panel.replaceChildren();const header=document.createElement('div');header.className='card-template-header';const title=document.createElement('strong');title.textContent='编辑卡片';const layout=document.createElement('span');layout.textContent='当前版式 · '+templates.find(item=>item.kind===(s.scene.sceneTemplate?.kind??''))!.name;const change=document.createElement('button');change.id='card-template-change';change.textContent='更换';change.onclick=()=>this.run(()=>this.openTemplates());header.append(title,layout,change);this.panel.append(header)
  const fields:CardTextField[]=[{kind:'title',index:0}]
  if(!sceneVisuals(s.scene).length||s.scene.sceneTemplate)for(let i=0;i<s.scene.bullets.length;i++)fields.push({kind:'bullet',index:i})
  for(const field of fields){const row=document.createElement('div');row.className='card-bullet-row';const label=document.createElement('label');label.textContent=field.kind==='title'?'画面标题':'要点 '+(field.index+1);label.append(this.input(field,value(s.scene,field),false));row.append(label)
   if(field.kind==='bullet'){const remove=document.createElement('button');remove.textContent='删除';remove.dataset.cardBulletRemove=String(field.index);remove.setAttribute('aria-label','删除要点 '+(field.index+1));remove.onclick=()=>this.run(()=>this.removeBullet(owner(s),field.index));row.append(remove)}this.panel.append(row)
  }
  if(!sceneVisuals(s.scene).length||s.scene.sceneTemplate){const add=document.createElement('button');add.id='card-bullet-add';add.textContent='＋ 添加要点';add.disabled=s.scene.bullets.length>=3;add.onclick=()=>this.run(()=>this.addBullet(owner(s)));this.panel.append(add);if(s.scene.bullets.length>=3){const limit=document.createElement('small');limit.textContent='每张卡片最多 3 条要点。';this.panel.append(limit)}}
  const note=document.createElement('small');note.textContent='仅修改画面文字，旁白与字幕保留。支持换行；点空白处完成，Esc 取消。';this.panel.append(note);this.renderError()
 }
 private async bulletOwner(o:CardTextOwner):Promise<Context>{
  this.valid(o);await this.options.flush();const s=this.options.state();if(!s||s.projectId!==o.projectId||s.sessionId!==o.sessionId||s.draft.id!==o.draftId||s.scene.id!==o.sceneId)throw new Error('STUDIO_CONFLICT: 要点所属镜头已变化。');this.valid(owner(s));this.options.pause();return s
 }
 private async addBullet(o:CardTextOwner):Promise<void>{
  const s=await this.bulletOwner(o);changeCardBullet(s.scene,{operation:'add',text:'校验'})
  const field:CardTextField={kind:'bullet',index:s.scene.bullets.length};this.pending={owner:owner(s),field,original:'',text:'',canvas:false,append:true};this.error='';this.selected=undefined;this.renderPanel(s)
  const row=document.createElement('div');row.className='card-bullet-row';row.id='card-bullet-new';const label=document.createElement('label');label.textContent='新要点';const input=this.input(field,'',false);input.placeholder='填写要点';label.append(input);row.append(label)
  const add=document.createElement('button');add.id='card-bullet-confirm';add.textContent='添加';add.onclick=()=>this.run(()=>this.flush());const cancel=document.createElement('button');cancel.id='card-bullet-cancel';cancel.textContent='取消';cancel.onclick=()=>this.cancel();row.append(add,cancel);this.panel.querySelector('#card-bullet-add')!.before(row);this.panel.querySelector('#card-bullet-add')!.remove();input.focus();this.renderCanvas()
 }
 private async removeBullet(o:CardTextOwner,index:number):Promise<void>{
  const s=await this.bulletOwner(o);changeCardBullet(s.scene,{operation:'remove',index});this.selected=undefined;this.error=''
  const operation=(async()=>{await this.options.remove(owner(s),index);await this.options.refresh()})();this.applying=operation
  try{await operation}finally{this.applying=undefined;this.render()}
 }
 private async closeTemplates():Promise<void>{
  this.templateGeneration++;if(this.gallery)this.panel.replaceChildren();this.gallery=undefined
  const preview=this.templatePreview;this.templatePreview=undefined
  if(preview)await preview.dispose()
  await this.templateWork
 }
 private async openTemplates():Promise<void>{
  await this.options.flush();const s=this.options.state();if(!s?.active||s.disabled)return
  this.options.pause();this.gallery={owner:owner(s),kind:s.scene.sceneTemplate?.kind??'',ready:false}
  this.panel.replaceChildren();const title=document.createElement('strong');title.textContent='选择版式 · 仅当前镜头';this.panel.append(title)
  const choices=document.createElement('div');choices.className='card-template-choices';this.panel.append(choices)
  const context=document.createElement('canvas').getContext('2d')!
  for(const item of templates){
   const errors=reviewSceneText(context,speechScene(cardTemplateScene(s.scene,item.kind)),s.draft.width,s.draft.height).filter(issue=>issue.severity==='error')
   const button=document.createElement('button');button.dataset.cardTemplate=item.kind;button.dataset.templateUnavailable=String(Boolean(errors.length));button.disabled=Boolean(errors.length);button.textContent=item.name;button.title=errors.map(issue=>issue.message).join('；');button.onclick=()=>this.run(()=>this.previewTemplate(item.kind));choices.append(button)
   if(errors.length){const reason=document.createElement('small');reason.textContent=item.name+'：'+button.title;reason.className='card-template-reason';this.panel.append(reason)}
  }
  const canvas=document.createElement('canvas');canvas.id='card-template-preview';canvas.setAttribute('aria-label','当前内容的版式预览');this.panel.append(canvas)
  const status=document.createElement('p');status.id='card-template-status';status.setAttribute('role','status');this.panel.append(status)
  const apply=document.createElement('button');apply.id='card-template-apply';apply.textContent='应用到当前镜头';apply.disabled=true;apply.onclick=()=>this.run(async()=>{
   const choice=this.gallery;if(!choice?.ready)return;this.valid(choice.owner);await this.closeTemplates();this.applying=(async()=>{await this.options.template(choice.owner,choice.kind);await this.options.refresh()})()
   try{await this.applying}finally{this.applying=undefined;this.render()}
  })
  const cancel=document.createElement('button');cancel.id='card-template-cancel';cancel.textContent='取消';cancel.onclick=()=>this.run(async()=>{await this.closeTemplates();this.render()});this.panel.append(apply,cancel)
  const note=document.createElement('small');note.textContent='预览使用现有内容。应用仅更换当前镜头的版式，可撤销；文字、旁白、字幕与素材保留。';this.panel.append(note)
  this.renderCanvas();await this.previewTemplate(this.gallery.kind)
 }
 private async previewTemplate(kind:TemplateKind):Promise<void>{
  const choice=this.gallery;if(!choice)return;const s=this.valid(choice.owner),generation=++this.templateGeneration
  choice.kind=kind;choice.ready=false;const apply=this.panel.querySelector<HTMLButtonElement>('#card-template-apply')!;apply.disabled=true
  for(const button of this.panel.querySelectorAll<HTMLButtonElement>('[data-card-template]'))button.setAttribute('aria-pressed',String(button.dataset.cardTemplate===kind))
  const status=this.panel.querySelector<HTMLElement>('#card-template-status')!;status.textContent='正在准备当前内容预览…'
  const previous=this.templatePreview;this.templatePreview=undefined;if(previous)await previous.dispose()
  await this.templateWork;if(generation!==this.templateGeneration||this.gallery!==choice)return
  const candidate=structuredClone(s.draft);candidate.scenes=[cardTemplateScene(s.scene,kind)]
  const preview=new StudioPreview(this.panel.querySelector<HTMLCanvasElement>('#card-template-preview')!,this.options.bytes,()=>{});this.templatePreview=preview
  this.templateWork=(async()=>{try{
   const ready=await preview.prepare(candidate,Math.min(.9,candidate.scenes[0].durationSeconds/2))
   if(generation!==this.templateGeneration||this.gallery!==choice)return
   this.valid(choice.owner);choice.ready=ready;apply.disabled=!ready;status.textContent=ready?'预览已就绪，确认后应用。':'预览已取消。'
  }catch(error){if(generation===this.templateGeneration&&this.gallery===choice)status.textContent=error instanceof Error?error.message:String(error)}})()
  await this.templateWork;this.renderCanvas()
 }
 private canvasRect():{left:number;top:number;width:number;height:number}{const rect=this.canvas.getBoundingClientRect(),parent=this.canvas.parentElement!.getBoundingClientRect(),scale=Math.min(rect.width/this.canvas.width,rect.height/this.canvas.height),width=this.canvas.width*scale,height=this.canvas.height*scale;return {left:rect.left-parent.left+(rect.width-width)/2,top:rect.top-parent.top+(rect.height-height)/2,width,height}}
 private position(node:HTMLElement,box:CompositionTextBox):void{const r=this.canvasRect();Object.assign(node.style,{left:r.left+box.x*r.width+'px',top:r.top+box.y*r.height+'px',width:Math.max(24,Math.min(box.width*r.width,r.width*(1-box.x)))+'px',height:Math.max(24,box.height*r.height)+'px'})}
 private boxes(raw:CompositionTextBox[]):CompositionTextBox[]{const groups=new Map<string,CompositionTextBox>();for(const box of raw){const id=key(box),previous=groups.get(id);if(!previous)groups.set(id,{...box});else{const right=Math.max(previous.x+previous.width,box.x+box.width),bottom=Math.max(previous.y+previous.height,box.y+box.height);previous.x=Math.min(previous.x,box.x);previous.y=Math.min(previous.y,box.y);previous.width=right-previous.x;previous.height=bottom-previous.y}}return [...groups.values()]}
 private renderCanvas():void{
  const s=this.options.state(),painted=this.options.painted();this.overlay.hidden=Boolean(this.gallery)||!s?.active||s.disabled||!s.previewReady||!painted
  if(this.overlay.hidden){this.canvasSignature='';return}
  if(this.pending?.canvas||this.applying){const input=this.overlay.querySelector<HTMLTextAreaElement>('textarea'),box=this.pending&&this.boxes(painted!.boxes).find(box=>key(box)===key(this.pending!.field));if(input&&box)this.position(input,box);return}
  const current=s!,rendered=painted!,signature=JSON.stringify([current.projectId,current.sessionId,current.draft.id,current.draft.revision,rendered])
  if(signature===this.canvasSignature){for(const node of this.overlay.querySelectorAll<HTMLElement>('[data-card-text-target]')){const box=this.boxes(rendered.boxes).find(box=>key(box)===node.dataset.cardTextTarget);if(box)this.position(node,box)}this.selectionStyle();return}
  this.canvasSignature=signature;this.overlay.replaceChildren()
  for(const box of this.boxes(rendered.boxes)){
   const selected=this.selected?.sceneId===rendered.sceneId&&key(this.selected.field)===key(box),button=document.createElement('button');button.className='canvas-card-text-target';button.dataset.cardTextTarget=key(box);button.dataset.sceneId=rendered.sceneId;button.setAttribute('aria-label','选择'+(box.kind==='title'?'画面标题':'画面要点 '+(box.index+1)));button.setAttribute('aria-pressed',String(selected));this.position(button,box)
   button.onclick=event=>{if(event.detail>1)return;this.run(async()=>{await this.select(owner(current,rendered.sceneId),box);if(button.isConnected)button.focus()})}
   button.ondblclick=()=>this.run(()=>this.edit(owner(current,rendered.sceneId),box))
   button.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();this.run(()=>this.edit(owner(current,rendered.sceneId),box))}}
   this.overlay.append(button)
  }
  this.selectionStyle();this.renderError()
 }
 private selectionStyle():void{
  const s=this.options.state(),painted=this.options.painted();this.overlay.querySelector('.canvas-card-text-edit')?.remove()
  for(const button of this.overlay.querySelectorAll<HTMLButtonElement>('[data-card-text-target]'))button.setAttribute('aria-pressed',String(button.dataset.sceneId===this.selected?.sceneId&&button.dataset.cardTextTarget===key(this.selected.field)))
  const box=painted&&this.selected?.sceneId===painted.sceneId?this.boxes(painted.boxes).find(box=>key(box)===key(this.selected!.field)):undefined
  if(!box||!s)return
  const edit=document.createElement('button');edit.className='canvas-card-text-edit';edit.textContent='编辑文字';edit.setAttribute('aria-label','编辑选中的画面文字');const r=this.canvasRect();edit.style.left=Math.max(0,Math.min(r.left+box.x*r.width,r.left+r.width-96))+'px';edit.style.top=Math.max(0,r.top+box.y*r.height-32)+'px';edit.onclick=()=>this.run(()=>this.edit(owner(s,painted!.sceneId),box));this.overlay.append(edit)
 }
 private async select(o:CardTextOwner,field:CardTextField):Promise<CardTextOwner>{this.valid(o);await this.options.flush();const s=this.options.state();if(!s||s.projectId!==o.projectId||s.sessionId!==o.sessionId||s.draft.id!==o.draftId)throw new Error('STUDIO_CONFLICT: 文字所属草稿已变化。');const admitted=owner(s,o.sceneId);this.valid(admitted);await this.options.refresh();this.valid(admitted);this.options.pause();await this.options.select(o.sceneId);this.valid(admitted);this.selected={sceneId:o.sceneId,field};this.render();return admitted}
 private async edit(o:CardTextOwner,box:CompositionTextBox):Promise<void>{o=await this.select(o,box);const s=this.valid(o),scene=s.draft.scenes.find(scene=>scene.id===o.sceneId)!,text=value(scene,box);this.pending={owner:o,field:box,original:text,text,canvas:true};this.canvasSignature='';const input=this.input(box,text,true);input.className='canvas-card-text-input';this.position(input,box);input.style.fontSize=Math.max(14,Math.min(32,box.height*this.canvasRect().height/1.3))+'px';this.overlay.replaceChildren(input);input.focus();input.select()}
}
