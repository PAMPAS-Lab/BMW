import {mediaRecord} from '../../../media-native/src/media-contract.js'
import {assertAssessmentRecord} from '../production-assessment-contract.js'
import type {ProductionAssessment} from '../production-assessment-contract.js'
import type {VideoDraft} from '../studio-contract.js'
interface ReviewView {draftId:string;revision:number;fingerprint:string|null;assessmentRevision:number;state:string;checks:{id:string;label:string}[];form:ProductionAssessment;dirty:boolean}
export class StudioTypeReviewEditor {
 private view:ReviewView|undefined
 constructor(private current:()=>{draft?:VideoDraft;disabled:boolean},private command:(r:unknown)=>Promise<unknown>,private notify:(s:string)=>void,private repaint:()=>void){}
 hasPending():boolean{return Boolean(this.view?.dirty)}
 discard():void{this.view=undefined}
 private adopt(raw:unknown,draft:VideoDraft):void{
  const v=mediaRecord(raw);if(v.fingerprint!==null&&(typeof v.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.fingerprint))||!Number.isInteger(v.assessmentRevision)||!Array.isArray(v.checks)||v.checks.length!==5)throw new Error('Invalid current type review.')
  const checks=v.checks.map(raw=>{const c=mediaRecord(raw);if(typeof c.id!=='string'||!/^check-[1-5]$/.test(c.id)||typeof c.check!=='string')throw new Error('Invalid type checklist.');return {id:c.id,label:c.check}}),user=mediaRecord(v.assessments).user,record=user?assertAssessmentRecord(user):undefined,previous=this.view?.draftId===draft.id&&this.view.dirty?this.view:undefined
  let form:ProductionAssessment=record?{checks:record.checks,listening:record.listening,retellingAnswer:record.retellingAnswer,predictionAnswer:record.predictionAnswer,notes:record.notes}:{checks:checks.map(c=>({id:c.id,status:'needs-fix',notes:''})),listening:'not-performed',retellingAnswer:'',predictionAnswer:'',notes:''}
  if(previous)form=previous.fingerprint===v.fingerprint?previous.form:{...form,retellingAnswer:previous.form.retellingAnswer,predictionAnswer:previous.form.predictionAnswer,notes:previous.form.notes,checks:checks.map(c=>({id:c.id,status:'needs-fix',notes:''})),listening:'not-performed'}
  this.view={draftId:draft.id,revision:draft.revision,fingerprint:v.fingerprint as string|null,assessmentRevision:Number(v.assessmentRevision),state:String(v.state),checks,form,dirty:Boolean(previous)};this.repaint()
 }
 render(parent:HTMLElement):void{
  const {draft,disabled}=this.current();if(!draft?.preparation.production)return
  const heading=document.createElement('h4');heading.textContent='当前成片的人工验收';parent.append(heading)
  const run=(fn:()=>Promise<void>)=>()=>{void fn().catch(e=>this.notify(e instanceof Error?e.message:String(e)))},button=(text:string,fn:()=>Promise<void>)=>{const b=document.createElement('button');b.textContent=text;b.disabled=disabled;b.onclick=run(fn);parent.append(b);return b}
  button('读取当前类型审阅',async()=>{const r=await this.command({operation:'production-review',draftId:draft.id,expectedRevision:draft.revision});if(this.current().draft?.id!==draft.id||this.current().draft?.revision!==draft.revision)throw new Error('草稿已变化，请重新读取；输入已保留。');this.adopt(r,draft)})
  const v=this.view;if(!v||v.draftId!==draft.id)return
  const status=document.createElement('p');status.textContent=v.state+' · 人工声明绑定当前内容、源文件和 MP4。请实际播放试听并让观众回答后再记录。';parent.append(status)
  if(!v.fingerprint){const p=document.createElement('p');p.textContent='先制作与当前草稿一致的成片，再记录验收。';parent.append(p);return}
  if(v.revision!==draft.revision){const p=document.createElement('p');p.textContent='草稿版本已变化，输入已保留。重新读取将重置通过勾选和试听状态，保留文字回答。';parent.append(p)}
  const row=(label:string)=>{const node=document.createElement('label');node.textContent=label;parent.append(node);return node}
  for(const check of v.checks){const item=v.form.checks.find(c=>c.id===check.id)!,label=row(check.label),box=document.createElement('input');box.type='checkbox';box.checked=item.status==='passed';box.disabled=disabled;box.onchange=()=>{item.status=box.checked?'passed':'needs-fix';v.dirty=true};label.prepend(box)}
  const listening=document.createElement('select');listening.id='production-listening';for(const [id,name]of [['not-performed','尚未实际试听'],['passed','已试听，通过'],['needs-fix','已试听，需要修正']])listening.append(new Option(name,id));listening.value=v.form.listening;listening.disabled=disabled;listening.onchange=()=>{v.form.listening=listening.value as ProductionAssessment['listening'];v.dirty=true};row('试听结果').append(listening)
  const field=(key:'retellingAnswer'|'predictionAnswer'|'notes',label:string)=>{const input=document.createElement('textarea');input.rows=2;input.maxLength=1000;input.value=v.form[key];input.disabled=disabled;input.dataset.productionReview=key;input.oninput=()=>{v.form[key]=input.value;v.dirty=true};row(label).append(input)}
  field('retellingAnswer','观众怎样复述核心问题与结论？');if(draft.preparation.production.profileId!=='news-brief')field('predictionAnswer','改变一个条件，观众预测会发生什么？');field('notes','本轮验收说明')
  const save=button('记录本轮人工验收',async()=>{if(v.revision!==this.current().draft?.revision||v.draftId!==this.current().draft?.id)throw new Error('先重新读取当前类型审阅；输入已保留。');const reply=await this.command({operation:'record-production-review',draftId:draft.id,expectedRevision:draft.revision,baseFingerprint:v.fingerprint,expectedAssessmentRevision:v.assessmentRevision,assessment:structuredClone(v.form)});v.dirty=false;this.adopt(reply,draft);this.notify('人工验收声明已保存；内容或文件变化后会失效。')});save.disabled=save.disabled||v.revision!==draft.revision
 }
}
