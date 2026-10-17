import {StudioTypeReviewEditor} from './studio-type-review-editor.js'
import {productionProfiles,productionRecipes,productionReview} from '../production-types.js'
import {mediaRecord} from '../../../media-native/src/media-contract.js'
import type {VideoDraft} from '../studio-contract.js'
import type {ProductionBrief,ProductionType} from '../production-contract.js'
export class StudioProductionEditor {
 private review:StudioTypeReviewEditor
 private root=document.getElementById('production-panel')!
 private pending:{draftId:string;revision:number;save:()=>Promise<void>}|undefined
 hasPending():boolean{return Boolean(this.pending)||this.review.hasPending()}
 discard():void{this.pending=undefined;this.review.discard();delete this.root.dataset.key}
 async flush():Promise<void>{const p=this.pending;if(!p)return;const d=this.state().draft;if(!d||d.id!==p.draftId||d.revision!==p.revision)throw new Error('工作表已被其他编辑更新；当前输入已保留，请核对后明确重新加载。');this.pending=undefined;try{await p.save()}catch(error){this.pending=p;throw error}}
 private recipeSelection:{draftId:string;recipeId:string;sceneId:string}|undefined
 private selection:{draftId:string;typeId:ProductionType}|undefined
 private proposal:{draftId:string;revision:number;productionType:ProductionType;baseFingerprint:string;recipeId?:string;sceneId?:string;summary:string}|undefined
 constructor(private state:()=>{draft?:VideoDraft;disabled:boolean},private command:(r:unknown)=>Promise<unknown>,private edit:(fn:(p:ProductionBrief)=>void)=>Promise<void>,private notify:(s:string)=>void){this.review=new StudioTypeReviewEditor(state,command,notify,()=>{delete this.root.dataset.key;this.render()})}
 render():void{
  const {draft,disabled}=this.state();this.root.hidden=!draft;if(!draft)return
  if(this.pending){for(const control of this.root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement|HTMLSelectElement>('input,textarea,select,button'))control.disabled=disabled;return}
  // Preserve unsaved controls across unrelated canvas/UI renders.
  if(this.root.dataset.key===draft.id+':'+draft.revision+':'+disabled)return
  const opened=this.root.querySelector('details')?.open??false;this.root.dataset.key=draft.id+':'+draft.revision+':'+disabled;this.root.replaceChildren()
  const details=document.createElement('details'),summary=document.createElement('summary');details.open=opened;summary.textContent='视频类型与分段工作表';details.append(summary);this.root.append(details)
  const run=(fn:()=>Promise<void>)=>()=>{void fn().catch(e=>this.notify(e instanceof Error?e.message:String(e)))},button=(name:string,fn:()=>Promise<void>)=>{const b=document.createElement('button');b.textContent=name;b.disabled=disabled;b.onclick=run(fn);details.append(b);return b},p=draft.preparation.production
  const types=document.createElement('select');types.id='production-type';productionProfiles.forEach(t=>types.append(new Option(t.name+' · '+t.duration.join('–')+'秒',t.id)));types.value=this.selection?.draftId===draft.id?this.selection.typeId:p?.profileId??'news-brief';types.onchange=()=>{this.selection={draftId:draft.id,typeId:types.value as ProductionType};delete this.root.dataset.key;this.render()};types.disabled=disabled;details.append(types)
  const recipes=document.createElement('select'),scenes=document.createElement('select');recipes.id='production-recipe';scenes.id='production-recipe-scene';recipes.append(new Option('仅采用类型工作表',''));const profile=productionProfiles.find(t=>t.id===types.value)!;for(const id of profile.recipes)recipes.append(new Option(productionRecipes.find(r=>r.id===id)?.name??id,id));for(const scene of draft.scenes)scenes.append(new Option(scene.title,scene.id));const chosen=this.recipeSelection?.draftId===draft.id?this.recipeSelection:undefined;if(chosen){recipes.value=(profile.recipes as readonly string[]).includes(chosen.recipeId)?chosen.recipeId:'';scenes.value=chosen.sceneId}recipes.disabled=scenes.disabled=disabled;const selectRecipe=()=>{this.recipeSelection={draftId:draft.id,recipeId:recipes.value,sceneId:scenes.value}};recipes.onchange=selectRecipe;scenes.onchange=selectRecipe;details.append(recipes,scenes)
  const preview=document.createElement('p');preview.id='production-proposal';if(this.proposal?.draftId===draft.id&&this.proposal.revision===draft.revision)preview.textContent=this.proposal.summary;details.append(preview)
  button('预览类型方案',async()=>{const productionType=types.value as ProductionType,recipeId=recipes.value||undefined,sceneId=recipeId?scenes.value:undefined,result=mediaRecord(await this.command({operation:'propose-type',draftId:draft.id,expectedRevision:draft.revision,productionType,...(recipeId?{recipeId,sceneId}:{})})),replace=Array.isArray(result.replace)?result.replace.map(v=>mediaRecord(v)):[];this.proposal={draftId:draft.id,revision:draft.revision,productionType,baseFingerprint:String(result.baseFingerprint),recipeId,sceneId,summary:'保留已有镜头、文案、音频、字幕与时间。'+(replace.length?replace.map(r=>String(r.sceneId)+'：'+String(r.field)+' 从空槽填为 '+String(r.after)).join('；'):'仅新增或保留类型工作表。')+' 请点击采用。'};delete this.root.dataset.key;this.render()})
  button('采用已预览方案',async()=>{if(!this.proposal||this.proposal.draftId!==draft.id||this.proposal.revision!==draft.revision||this.proposal.productionType!==types.value||this.proposal.recipeId!==(recipes.value||undefined)||this.proposal.sceneId!==(recipes.value?scenes.value:undefined))throw new Error('请先预览当前版本的类型方案。');await this.command({operation:'adopt-type',draftId:draft.id,expectedRevision:draft.revision,productionType:types.value,baseFingerprint:this.proposal.baseFingerprint,...(this.proposal.recipeId?{recipeId:this.proposal.recipeId,sceneId:this.proposal.sceneId}:{})});this.proposal=undefined;this.notify('已采用类型工作表；现有编辑已保留。')})

  if(!p)return
  const field=(label:string,value:string,max:number,save:(value:string)=>Promise<void>)=>{const row=document.createElement('label'),control=document.createElement('textarea');row.textContent=label;control.value=value;control.maxLength=max;control.rows=2;control.disabled=disabled;control.oninput=()=>{const value=control.value;this.pending={draftId:draft.id,revision:draft.revision,save:()=>save(value)}};control.onchange=run(()=>this.flush());row.append(control);details.append(row)}
  field('受众',p.audience,500,v=>this.edit(p=>{p.audience=v}));field('主问题',p.question,500,v=>this.edit(p=>{p.question=v}))
  const duration=document.createElement('input');duration.type='number';duration.min='1';duration.max='720';duration.value=String(p.targetDurationSeconds);duration.setAttribute('aria-label','目标时长（意图）');duration.disabled=disabled;duration.oninput=()=>{const value=Number(duration.value);this.pending={draftId:draft.id,revision:draft.revision,save:()=>this.edit(p=>{p.targetDurationSeconds=value})}};duration.onchange=run(()=>this.flush());details.append(duration)
  for(const section of p.sections){const title=document.createElement('h4');title.textContent=section.role;details.append(title);field('这段要让观众理解什么',section.objective,500,v=>this.edit(p=>{p.sections.find(s=>s.id===section.id)!.objective=v}));field('观众看哪里 / 观察时间',section.observation,500,v=>this.edit(p=>{p.sections.find(s=>s.id===section.id)!.observation=v}));field('镜头ID（每行一个）',section.sceneIds.join('\n'),8000,v=>this.edit(p=>{p.sections.find(s=>s.id===section.id)!.sceneIds=v.split('\n').map(s=>s.trim()).filter(Boolean)}));field('材料角色（每行一个）',section.materialRoles.join('\n'),650,v=>this.edit(p=>{p.sections.find(s=>s.id===section.id)!.materialRoles=v.split('\n').map(s=>s.trim()).filter(Boolean)}))}
  const review=productionReview(draft),status=document.createElement('p');status.id='production-review';status.textContent=review.state+' · '+review.issues.length+' 项待补；内容、试听和观众复述需另行评审。';details.append(status)
  for(const issue of review.issues.slice(0,20)){const item=document.createElement('p');item.textContent=issue.message;details.append(item)}
  for(const check of review.checklist??[]){const item=document.createElement('p');item.textContent='待审：'+check.check;details.append(item)}
  this.review.render(details)
 }
}
