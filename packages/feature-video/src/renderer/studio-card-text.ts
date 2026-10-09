import {cardDetailsForm} from './studio-card-details.js'
import type {DetailedCardSpec} from '../../../media-native/src/card-details.js'
import type {CompositionVisualBox} from '../../../media-native/src/media/composition-paint.js'
import {StudioPreview} from './studio-preview.js'
import {CARD_TEMPLATES,assertCardSpec,cardTemplate} from '../../../media-native/src/card-templates.js'
import type {CardSpec,CardMotion} from '../../../media-native/src/card-templates.js'
import {cardTemplateScene,planCardTemplate,currentCardTemplate,cardTemplateName,cardShowsBullets,cardBulletLimit} from '../studio-card-templates.js'
import type {CardTemplateChoice} from '../studio-card-templates.js'
export {cardTemplateScene} from '../studio-card-templates.js'
import {speechScene} from '../studio-speech-contract.js'
import {reviewSceneText} from '../../../media-native/src/media/composition-paint.js'
import type {CompositionTextBox} from '../../../media-native/src/media/composition-paint.js'
import type {VideoDraft,StudioScene} from '../studio-contract.js'

export interface CardTextOwner {projectId:string;sessionId:string|null;draftId:string;revision:number;sceneId:string}
export interface CardTextField {kind:'title'|'bullet';index:number}
interface Context {projectId:string;sessionId:string|null;draft:VideoDraft;scene:StudioScene;active:boolean;disabled:boolean;previewReady:boolean}
interface Options {
 state():Context|undefined
 images():{artifactId:string;name:string}[]
 painted():{sceneId:string;boxes:CompositionTextBox[];visual?:CompositionVisualBox}|undefined
 flush():Promise<void>
 select(sceneId:string):Promise<void>
 commit(owner:CardTextOwner,field:CardTextField,text:string,append?:boolean):Promise<void>
 remove(owner:CardTextOwner,index:number):Promise<void>
 bytes(id:string):Promise<Uint8Array>
 template(owner:CardTextOwner,kind:TemplateKind,spec?:CardSpec):Promise<void>
 refresh():Promise<void>
 pause():void
 notify(message:string):void
 globalTitle():Promise<void>
}
type TemplateKind=CardTemplateChoice
const legacyTemplates:readonly {kind:TemplateKind;name:string}[]=[{kind:'',name:'要点列表'},{kind:'summary',name:'三点总结'},{kind:'comparison',name:'两项对比'},{kind:'screenshot',name:'画面解读'}]
const templates:readonly {kind:TemplateKind;name:string}[]=[...CARD_TEMPLATES.filter(item=>item.id!=='points/list').map(item=>({kind:item.id,name:item.name})),{kind:'points/list',name:'普通列表'},...legacyTemplates]
export function changeCardBullet(scene:StudioScene,change:{operation:'add';text:string}|{operation:'remove';index:number}):StudioScene {
 const next=structuredClone(scene)
 if(next.sceneTemplate){const name=cardTemplateName(next.sceneTemplate.kind);throw new Error(name+'需要固定数量的要点，请先点“更换”选择“要点列表”，再增删要点。')}
 if(next.cardSpec&&['points/three','comparison/two'].includes(next.cardSpec.templateId))throw new Error('此模板需要固定数量，请先更换为普通列表。')
 if(!cardShowsBullets(next))throw new Error('当前画面不显示要点，请先选择适合的卡片画面。')
 if(change.operation==='add'){
  if(next.bullets.length>=cardBulletLimit(next))throw new Error('此卡片最多 '+cardBulletLimit(next)+' 条说明或要点。')
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
const key=(field:{kind:string;index:number})=>field.kind+':'+field.index
const value=(scene:StudioScene,field:CardTextField)=>field.kind==='title'?scene.title:scene.bullets[field.index]??''
const owner=(s:Context,sceneId=s.scene.id):CardTextOwner=>({projectId:s.projectId,sessionId:s.sessionId,draftId:s.draft.id,revision:s.draft.revision,sceneId})
/** Fixed-template text only: one local input, canonical CAS save and signed undo. */
export class StudioCardTextEditor {
 private panel=document.createElement('section')
 private overlay=document.createElement('div')
 private pending?:Pending
 private settings?:{owner:CardTextOwner;values:{value:string;decimals:string;unit:string;motion:CardMotion}}
 private detailPending?:{owner:CardTextOwner;spec:CardSpec}
 private picking?:{owner:CardTextOwner;kind:'reading'|'highlight';line?:number}
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
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.options.state()?.active&&(this.pending||this.settings||this.detailPending||this.picking||this.selected||this.gallery)){event.preventDefault();event.stopImmediatePropagation();this.cancel()}},true)
  document.addEventListener('pointerdown',event=>{const target=event.target as HTMLElement;if(this.pending&&!this.panel.contains(target)&&!this.overlay.contains(target)&&!target.closest('button,input,textarea,select'))this.run(()=>this.flush())})
 }
 discard():void{void this.closeTemplates().catch(error=>this.options.notify(String(error)));this.pending=undefined;this.settings=undefined;this.detailPending=undefined;this.picking=undefined;this.selected=undefined;this.expanded=undefined;this.error='';this.canvasSignature='';this.panel.replaceChildren();this.overlay.replaceChildren()}
 hasPending():boolean{return Boolean(this.pending||this.settings||this.detailPending||this.picking||this.applying)}
 time():void{this.renderCanvas()}
 private run(fn:()=>Promise<void>):void{void fn().catch(error=>{this.error=error instanceof Error?error.message:String(error);this.options.notify(this.error);this.renderError()})}
 private valid(o:CardTextOwner):Context {const s=this.options.state();if(!s||!s.active||s.disabled||s.projectId!==o.projectId||s.sessionId!==o.sessionId||s.draft.id!==o.draftId||s.draft.revision!==o.revision||!s.draft.scenes.some(scene=>scene.id===o.sceneId))throw new Error('STUDIO_CONFLICT: 文字所属草稿或版本已变化，输入已保留；请取消或重新加载后处理。');return s}
 async openCard():Promise<void>{await this.options.flush();const s=this.options.state();if(!s?.active||s.disabled)return;this.options.pause();this.expanded=this.expanded===s.scene.id?undefined:s.scene.id;this.render();if(this.expanded)this.panel.querySelector<HTMLTextAreaElement>('textarea')?.focus()}
 async flush():Promise<void>{
  if(this.applying)return this.applying
  await this.closeTemplates()
  if(this.detailPending){const pending=this.detailPending;this.valid(pending.owner);const spec=assertCardSpec(pending.spec),operation=this.options.template(pending.owner,spec.templateId,spec);this.applying=operation;try{await operation;this.detailPending=undefined;this.error='';await this.options.refresh()}finally{this.applying=undefined;this.panel.replaceChildren();this.render()}return}
  if(this.settings){const pending=this.settings;this.valid(pending.owner);const spec=this.settingsSpec(pending.values);const operation=this.options.template(pending.owner,spec.templateId,spec);this.applying=operation;try{await operation;this.settings=undefined;this.error='';await this.options.refresh()}finally{this.applying=undefined;this.render()}return}
  const pending=this.pending;if(!pending)return
  if(pending.text===pending.original){this.pending=undefined;this.render();return}
  const operation=(async()=>{this.valid(pending.owner);await this.options.commit(pending.owner,pending.field,pending.text,pending.append);if(this.pending===pending){this.pending=undefined;if(pending.append)this.panel.replaceChildren()};this.error='';this.render();await this.options.refresh()})()
  this.applying=operation
  try{await operation}finally{this.applying=undefined;this.render()}
 }
 private cancel():void{if(this.applying)return;if(this.gallery){this.run(async()=>{await this.closeTemplates();this.render()});return;}const pending=this.pending;if(pending)for(const input of this.panel.querySelectorAll<HTMLTextAreaElement>('[data-card-text-field]'))if(input.dataset.cardTextField===key(pending.field))input.value=pending.original;this.pending=undefined;this.settings=undefined;this.selected=undefined;this.error='';this.canvasSignature='';this.panel.replaceChildren();this.render();this.options.notify('已取消本次文字输入，草稿内容保留。')}
 render():void{
  const s=this.options.state(),card=document.querySelector('.studio-card.selected') as HTMLElement|null
  if(this.gallery&&(!s?.active||s.scene.id!==this.gallery.owner.sceneId||s.draft.id!==this.gallery.owner.draftId||s.draft.revision!==this.gallery.owner.revision||s.projectId!==this.gallery.owner.projectId||s.sessionId!==this.gallery.owner.sessionId)){void this.closeTemplates().catch(error=>this.options.notify(String(error)))}
  if(!s?.active||!card){this.panel.hidden=true;this.overlay.hidden=true;this.canvasSignature='';return}
  this.panel.hidden=this.expanded!==s.scene.id
  if(!this.panel.hidden){card.append(this.panel);if(!this.pending&&!this.settings&&!this.detailPending&&!this.applying&&!this.gallery){if(this.panel.dataset.owner!==JSON.stringify(owner(s))||!this.panel.contains(document.activeElement)||this.panel.querySelectorAll('[data-card-text-field]').length!==1+(cardShowsBullets(s.scene)?s.scene.bullets.length:0))this.renderPanel(s);else for(const input of this.panel.querySelectorAll<HTMLTextAreaElement>('[data-card-text-field]')){const [kind,index]=input.dataset.cardTextField!.split(':');input.value=value(s.scene,{kind:kind==='title'?'title':'bullet',index:Number(index)})}};for(const field of this.panel.querySelectorAll<HTMLTextAreaElement|HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('textarea,button,input,select'))field.disabled=s.disabled||Boolean(this.applying)||field.dataset.templateUnavailable==='true'||(field.id==='card-bullet-add'&&s.scene.bullets.length>=cardBulletLimit(s.scene))||(field.id==='card-template-apply'&&!this.gallery?.ready)}
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
  this.panel.replaceChildren();this.panel.dataset.owner=JSON.stringify(owner(s));const header=document.createElement('div');header.className='card-template-header';const title=document.createElement('strong');title.textContent='编辑卡片';const layout=document.createElement('span');layout.textContent='当前版式 · '+cardTemplateName(currentCardTemplate(s.scene));const change=document.createElement('button');change.id='card-template-change';change.textContent='更换';change.onclick=()=>this.run(()=>this.openTemplates());header.append(title,layout,change);this.panel.append(header)
  const fields:CardTextField[]=[{kind:'title',index:0}]
  if(cardShowsBullets(s.scene))for(let i=0;i<s.scene.bullets.length;i++)fields.push({kind:'bullet',index:i})
  for(const field of fields){const row=document.createElement('div');row.className='card-bullet-row';const label=document.createElement('label');label.textContent=field.kind==='title'?'画面标题':'要点 '+(field.index+1);label.append(this.input(field,value(s.scene,field),false));row.append(label)
   if(field.kind==='bullet'){const remove=document.createElement('button');remove.textContent='删除';remove.dataset.cardBulletRemove=String(field.index);remove.setAttribute('aria-label','删除要点 '+(field.index+1));remove.onclick=()=>this.run(()=>this.removeBullet(owner(s),field.index));row.append(remove)}this.panel.append(row)
  }
  if(cardShowsBullets(s.scene)){const add=document.createElement('button');add.id='card-bullet-add';add.textContent='＋ 添加要点';add.disabled=s.scene.bullets.length>=cardBulletLimit(s.scene);add.onclick=()=>this.run(()=>this.addBullet(owner(s)));this.panel.append(add);if(s.scene.bullets.length>=cardBulletLimit(s.scene)){const limit=document.createElement('small');limit.textContent='此卡片最多 '+cardBulletLimit(s.scene)+' 条说明或要点。';this.panel.append(limit)}}
  if(s.scene.cardSpec?.version===2)this.panel.append(cardDetailsForm(s.scene.cardSpec,{images:this.options.images(),change:spec=>{this.detailPending={owner:owner(s),spec};this.error=''},pick:(kind,line)=>this.run(()=>this.pickTarget(kind,line)),save:()=>this.run(()=>this.flush())}));else if(s.scene.cardSpec)this.renderSettings(s)
  const note=document.createElement('small');note.textContent='修改当前卡片，可撤销；旁白与字幕保留。支持换行；点空白处完成，Esc 取消。';this.panel.append(note);this.renderError()
 }
 private settingsSpec(values:{value:string;decimals:string;unit:string;motion:CardMotion}):CardSpec {
  const spec=this.options.state()?.scene.cardSpec;if(!spec)throw new Error('模板已变化，请重新打开卡片。')
  if(spec.templateId!=='metric/hero')return assertCardSpec({...spec,motion:values.motion})
  if(!values.value.trim()||!values.decimals.trim())throw new Error('请填写数值和小数位；空白不会转换为零。')
  return assertCardSpec({...spec,value:Number(values.value),decimals:Number(values.decimals),unit:values.unit,motion:values.motion})
 }
 private renderSettings(s:Context):void {
  const spec=s.scene.cardSpec!,inputs=document.createElement('div');inputs.className='card-template-inputs'
  const controls=new Map<string,HTMLInputElement|HTMLSelectElement>()
  if(spec.templateId==='metric/hero')for(const [name,labelText,content]of [['value','数值',String(spec.value)],['decimals','小数位',String(spec.decimals)],['unit','单位',spec.unit]]){
   const label=document.createElement('label');label.textContent=labelText;const input=document.createElement('input');input.id='card-template-'+name;input.value=content;input.type=name==='unit'?'text':'number'
   if(name==='value'){input.min='0';input.max='999999999.99';input.step='.01'}else if(name==='decimals'){input.min='0';input.max='2';input.step='1'}else input.maxLength=8
   label.append(input);inputs.append(label);controls.set(name,input)
  }
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='表现方式';details.append(summary)
  const motion=document.createElement('select');motion.id='card-template-motion';motion.setAttribute('aria-label','卡片动效')
  const names:Record<CardMotion,string>={none:'静态','fade-in':'淡入','reveal-items':'逐条出现','count-up':'数字递增',focus:'局部聚焦','slow-push':'缓慢推近',wipe:'整句擦入'}
  for(const id of cardTemplate(spec.templateId).motions){const option=document.createElement('option');option.value=id;option.textContent=names[id];motion.append(option)}motion.value=spec.motion??'none';details.append(motion);controls.set('motion',motion)
  const store=()=>{if(!this.settings)this.settings={owner:owner(s),values:{value:'',decimals:'',unit:'',motion:'none'}};this.settings.values={value:controls.get('value')?.value??'',decimals:controls.get('decimals')?.value??'',unit:controls.get('unit')?.value??'',motion:motion.value as CardMotion}}
  for(const control of controls.values()){control.addEventListener('input',store);control.addEventListener('change',()=>{store();this.run(()=>this.flush())});control.addEventListener('keydown',event=>{if((event as KeyboardEvent).key==='Enter'){event.preventDefault();store();this.run(()=>this.flush())}})}
  this.panel.append(inputs,details)
  if(spec.templateId==='diagram/image'){const reading=document.createElement('button');reading.textContent='启用图解阅读配方';reading.onclick=()=>this.run(async()=>{await this.options.flush();const current=this.options.state();if(!current)return;const upgraded:CardSpec={version:2,templateId:'diagram/image'};await this.options.template(owner(current),'diagram/image',upgraded);await this.options.refresh()});this.panel.append(reading)}
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
  this.options.pause();this.gallery={owner:owner(s),kind:currentCardTemplate(s.scene),ready:false}
  this.panel.replaceChildren();const title=document.createElement('strong');title.textContent='选择版式 · 仅当前镜头';this.panel.append(title)
  const choices=document.createElement('div');choices.className='card-template-choices';this.panel.append(choices)
  const compatibility=document.createElement('details'),summary=document.createElement('summary');summary.textContent='普通列表与兼容版式';compatibility.append(summary);const older=document.createElement('div');older.className='card-template-choices';compatibility.append(older);this.panel.append(compatibility)
  const variantGroups=new Map<string,HTMLElement>();for(const definition of CARD_TEMPLATES.filter(t=>t.version===1&&t.id!=='points/list'&&CARD_TEMPLATES.some(v=>v.version===2&&v.category===t.category))){const fold=document.createElement('details'),summary=document.createElement('summary');summary.textContent=definition.name+' · 更多表达';fold.append(summary);const group=document.createElement('div');group.className='card-template-choices';fold.append(group);choices.append(fold);variantGroups.set(definition.category,group)}
  const context=document.createElement('canvas').getContext('2d')!
  for(const item of templates){
   let errors:{message:string}[]=[];try{errors=reviewSceneText(context,speechScene(cardTemplateScene(s.scene,item.kind)),s.draft.width,s.draft.height,undefined,s.draft.cardLayout).filter(issue=>issue.severity==='error')}catch(error){errors=[{message:error instanceof Error?error.message:String(error)}]}
   const button=document.createElement('button');button.dataset.cardTemplate=item.kind;button.dataset.templateUnavailable=String(Boolean(errors.length));button.disabled=Boolean(errors.length);button.textContent=item.name;button.title=errors.map(issue=>issue.message).join('；');button.onclick=()=>this.run(()=>this.previewTemplate(item.kind));const destination=item.kind.includes('/')&&cardTemplate(item.kind as CardSpec['templateId']).version===2?variantGroups.get(cardTemplate(item.kind as CardSpec['templateId']).category)!:item.kind.includes('/')&&item.kind!=='points/list'?choices:older;if(destination===choices)choices.insertBefore(button,choices.querySelector('details'));else destination.append(button)
   const hint=document.createElement('small');hint.className='card-template-reason';hint.textContent=errors.length?button.title:item.kind.includes('/')?cardTemplate(item.kind as CardSpec['templateId']).purpose:'保留已有兼容版式';button.append(hint)
  }
  const canvas=document.createElement('canvas');canvas.id='card-template-preview';canvas.setAttribute('aria-label','当前内容的版式预览');this.panel.append(canvas)
  const status=document.createElement('p');status.id='card-template-status';status.setAttribute('role','status');this.panel.append(status)
  const apply=document.createElement('button');apply.id='card-template-apply';apply.textContent='应用到当前镜头';apply.disabled=true;apply.onclick=()=>this.run(async()=>{
   const choice=this.gallery;if(!choice?.ready)return;this.valid(choice.owner);await this.closeTemplates();this.applying=(async()=>{await this.options.template(choice.owner,choice.kind);await this.options.refresh()})()
   try{await this.applying}finally{this.applying=undefined;this.render()}
  })
  const cancel=document.createElement('button');cancel.id='card-template-cancel';cancel.textContent='取消';cancel.onclick=()=>this.run(async()=>{await this.closeTemplates();this.render()});this.panel.append(apply,cancel)
  const note=document.createElement('small');note.textContent='预览使用现有内容。应用仅更换当前镜头的版式，可撤销；文字、旁白与字幕保留；素材转换影响见预览提示。';this.panel.append(note)
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
   this.valid(choice.owner);choice.ready=ready;apply.disabled=!ready;status.textContent=ready?'预览已就绪，确认后应用。'+planCardTemplate(s.scene,kind).notices.join(' '):'预览已取消。'
  }catch(error){if(generation===this.templateGeneration&&this.gallery===choice)status.textContent=error instanceof Error?error.message:String(error)}})()
  await this.templateWork;this.renderCanvas()
 }
 private async pickTarget(kind:'reading'|'highlight',line?:number):Promise<void>{
  await this.options.flush();const s=this.options.state(),painted=this.options.painted()
  if(!s?.active||s.disabled||!s.previewReady||painted?.sceneId!==s.scene.id||!painted.visual)throw new Error('请先更新当前图片预览，再框选重点。')
  const visual=structuredClone(painted.visual),o=owner(s);this.options.pause();this.picking={owner:o,kind,line};this.selected=undefined;this.overlay.hidden=false;this.overlay.replaceChildren()
  const r=this.canvasRect(),picker=document.createElement('div');picker.className='card-source-picker';picker.setAttribute('aria-label','在源图框选重点');Object.assign(picker.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});this.overlay.append(picker)
  const hint=document.createElement('span');hint.textContent='拖动框选 · Esc 取消';picker.append(hint)
  let start:{x:number;y:number}|undefined,ghost:HTMLDivElement|undefined
  const point=(event:PointerEvent)=>{const box=picker.getBoundingClientRect();return {x:(event.clientX-box.left)/box.width,y:(event.clientY-box.top)/box.height}}
  const source=(p:{x:number;y:number})=>({x:Math.max(0,Math.min(1,visual.crop.x+(p.x-visual.x)/visual.width*visual.crop.width)),y:Math.max(0,Math.min(1,visual.crop.y+(p.y-visual.y)/visual.height*visual.crop.height))})
  picker.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();this.valid(o);start=point(event);picker.setPointerCapture(event.pointerId);ghost=document.createElement('div');ghost.className='card-source-selection';picker.append(ghost)}
  picker.onpointermove=event=>{if(!start||!ghost)return;const p=point(event);Object.assign(ghost.style,{left:Math.min(p.x,start.x)*100+'%',top:Math.min(p.y,start.y)*100+'%',width:Math.abs(p.x-start.x)*100+'%',height:Math.abs(p.y-start.y)*100+'%'})}
  picker.onpointercancel=()=>{start=undefined;this.picking=undefined;this.overlay.replaceChildren();this.canvasSignature='';this.renderCanvas()}
  picker.onpointerup=event=>{if(!start)return;const a=source(start),b=source(point(event));start=undefined;if(picker.hasPointerCapture(event.pointerId))picker.releasePointerCapture(event.pointerId);this.picking=undefined;this.overlay.replaceChildren();this.canvasSignature='';this.run(async()=>{
   this.valid(o);const rect={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};if(rect.width<.005||rect.height<.005)throw new Error('框选范围太小，请在实际源图内拖动。')
   const data=await this.options.bytes(visual.artifactId);this.valid(o);const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data as Uint8Array<ArrayBuffer>)),byte=>byte.toString(16).padStart(2,'0')).join('');this.valid(o)
   const current=s.scene.cardSpec;if(!current||current.version!==2||!['evidence/reading','evidence/highlight','evidence/translation','evidence/person-quote','diagram/image'].includes(current.templateId))throw new Error('请先选择证据阅读、重点、译文、人物引述或图解阅读。')
   const spec=structuredClone(current) as DetailedCardSpec&{reading?:import('../../../media-native/src/card-details.js').CardReading;highlights?:import('../../../media-native/src/card-details.js').CardHighlight[]},pin={artifactId:visual.artifactId,sha256}
   if(kind==='reading'){const targets=[...(spec.reading?.targets??[]),{source:pin,rect,name:'阅读目标 '+((spec.reading?.targets.length??0)+1)}];spec.reading={mode:targets.length>1?'sequence':spec.reading?.mode??'whole-to-detail',targets,returnToWhole:spec.reading?.returnToWhole??false}}
   else{spec.highlights??=[];if(line!==undefined){const highlight=spec.highlights[line];if(!highlight||highlight.source.artifactId!==pin.artifactId||highlight.source.sha256!==pin.sha256)throw new Error('新行必须属于同一个原始源图。');highlight.rects.push(rect)}else{const duration=s.scene.presentationWindow?.durationSeconds??s.scene.durationSeconds,startSeconds=spec.highlights.at(-1)?.endSeconds??0;if(duration-startSeconds<.1)throw new Error('重点时段已用完，请先调整已有重点结束时间。');spec.highlights.push({source:pin,rects:[rect],name:'重点 '+(spec.highlights.length+1),style:'outline',startSeconds,endSeconds:duration})}}
   this.detailPending={owner:o,spec};await this.flush();this.renderCanvas()
  })}
 }
 private canvasRect():{left:number;top:number;width:number;height:number}{const rect=this.canvas.getBoundingClientRect(),parent=this.canvas.parentElement!.getBoundingClientRect(),scale=Math.min(rect.width/this.canvas.width,rect.height/this.canvas.height),width=this.canvas.width*scale,height=this.canvas.height*scale;return {left:rect.left-parent.left+(rect.width-width)/2,width,height,top:rect.top-parent.top+(rect.height-height)/2}}
 private position(node:HTMLElement,box:CompositionTextBox):void{const r=this.canvasRect();Object.assign(node.style,{left:r.left+box.x*r.width+'px',top:r.top+box.y*r.height+'px',width:Math.max(24,Math.min(box.width*r.width,r.width*(1-box.x)))+'px',height:Math.max(24,box.height*r.height)+'px'})}
 private boxes(raw:CompositionTextBox[]):CompositionTextBox[]{const groups=new Map<string,CompositionTextBox>();for(const box of raw){const id=key(box),previous=groups.get(id);if(!previous)groups.set(id,{...box});else{const right=Math.max(previous.x+previous.width,box.x+box.width),bottom=Math.max(previous.y+previous.height,box.y+box.height);previous.x=Math.min(previous.x,box.x);previous.y=Math.min(previous.y,box.y);previous.width=right-previous.x;previous.height=bottom-previous.y}}return [...groups.values()]}
 private renderCanvas():void{
  const s=this.options.state(),painted=this.options.painted();this.overlay.hidden=Boolean(this.gallery)||!s?.active||s.disabled||!s.previewReady||!painted
  if(this.picking)return
  if(this.overlay.hidden){this.canvasSignature='';return}
  if(this.pending?.canvas||this.settings||this.detailPending||this.applying){const input=this.overlay.querySelector<HTMLTextAreaElement>('textarea'),box=this.pending&&this.boxes(painted!.boxes).find(box=>key(box)===key(this.pending!.field));if(input&&box)this.position(input,box);return}
  const current=s!,rendered=painted!,signature=JSON.stringify([current.projectId,current.sessionId,current.draft.id,current.draft.revision,rendered])
  if(signature===this.canvasSignature){for(const node of this.overlay.querySelectorAll<HTMLElement>('[data-card-text-target]')){const box=this.boxes(rendered.boxes).find(box=>key(box)===node.dataset.cardTextTarget);if(box)this.position(node,box)}this.selectionStyle();return}
  this.canvasSignature=signature;this.overlay.replaceChildren()
  for(const box of this.boxes(rendered.boxes)){
   if(box.kind==='global-title'){
    const button=document.createElement('button');button.className='canvas-card-text-target';button.dataset.cardTextTarget=key(box);button.setAttribute('aria-label','编辑全片标题');this.position(button,box);button.onclick=()=>this.run(()=>this.options.globalTitle());this.overlay.append(button);continue
   }
   const field:CardTextField={kind:box.kind,index:box.index}
   const selected=this.selected?.sceneId===rendered.sceneId&&key(this.selected.field)===key(box),button=document.createElement('button');button.className='canvas-card-text-target';button.dataset.cardTextTarget=key(box);button.dataset.sceneId=rendered.sceneId;button.setAttribute('aria-label','选择'+(box.kind==='title'?'画面标题':'画面要点 '+(box.index+1)));button.setAttribute('aria-pressed',String(selected));this.position(button,box)
   button.onclick=event=>{if(event.detail>1)return;this.run(async()=>{await this.select(owner(current,rendered.sceneId),field);if(button.isConnected)button.focus()})}
   button.ondblclick=()=>this.run(()=>this.edit(owner(current,rendered.sceneId),box))
   button.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();this.run(()=>this.edit(owner(current,rendered.sceneId),box))}}
   this.overlay.append(button)
  }
  this.selectionStyle();this.renderError()
 }
 private selectionStyle():void{
  const s=this.options.state(),painted=this.options.painted();this.overlay.querySelector('.canvas-card-text-edit')?.remove()
  for(const button of this.overlay.querySelectorAll<HTMLButtonElement>('[data-card-text-target]'))button.setAttribute('aria-pressed',String(Boolean(this.selected&&button.dataset.sceneId===this.selected.sceneId&&button.dataset.cardTextTarget===key(this.selected.field))))
  const box=painted&&this.selected?.sceneId===painted.sceneId?this.boxes(painted.boxes).find(box=>key(box)===key(this.selected!.field)):undefined
  if(!box||!s)return
  const edit=document.createElement('button');edit.className='canvas-card-text-edit';edit.textContent='编辑文字';edit.setAttribute('aria-label','编辑选中的画面文字');const r=this.canvasRect();edit.style.left=Math.max(0,Math.min(r.left+box.x*r.width,r.left+r.width-96))+'px';edit.style.top=Math.max(0,r.top+box.y*r.height-32)+'px';edit.onclick=()=>this.run(()=>this.edit(owner(s,painted!.sceneId),box));this.overlay.append(edit)
 }
 private async select(o:CardTextOwner,field:CardTextField):Promise<CardTextOwner>{this.valid(o);await this.options.flush();const s=this.options.state();if(!s||s.projectId!==o.projectId||s.sessionId!==o.sessionId||s.draft.id!==o.draftId)throw new Error('STUDIO_CONFLICT: 文字所属草稿已变化。');const admitted=owner(s,o.sceneId);this.valid(admitted);await this.options.refresh();this.valid(admitted);this.options.pause();await this.options.select(o.sceneId);this.valid(admitted);this.selected={sceneId:o.sceneId,field};this.render();return admitted}
 private async edit(o:CardTextOwner,box:CompositionTextBox):Promise<void>{if(box.kind==='global-title'){await this.options.globalTitle();return}const field:CardTextField={kind:box.kind,index:box.index};o=await this.select(o,field);const s=this.valid(o),scene=s.draft.scenes.find(scene=>scene.id===o.sceneId)!,text=value(scene,field);this.pending={owner:o,field,original:text,text,canvas:true};this.canvasSignature='';const input=this.input(field,text,true);input.className='canvas-card-text-input';this.position(input,box);input.style.fontSize=Math.max(14,Math.min(32,box.height*this.canvasRect().height/1.3))+'px';this.overlay.replaceChildren(input);input.focus();input.select()}
}
