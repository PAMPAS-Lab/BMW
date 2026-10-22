import type {LibraryEntry,LibraryIdentity} from '../library-contract.js'
import type {LibraryDirection,ProjectTopic,MaterialAssignment,MaterialRelation,MaterialPurpose} from '../research-contract.js'

interface Project {id:string;name:string;archived:boolean}
interface TopicRow extends ProjectTopic {projectId:string;projectName:string;archived:boolean;revision:number}
interface DirectionRow extends LibraryDirection {collectionState:string;topicCount:number}
interface Page<T> {items:T[];total:number;nextOffset:number|null;revision?:number;projectRevision:number;issues:{projectId:string;message:string}[]}
interface Port {research(request:unknown):Promise<unknown>}
interface Context {project:{id:string;name:string};projects:Project[]}
export interface ResearchFilter {projectId?:string;topicId?:string;directionId?:string;label?:string}
const purposeLabels:Record<MaterialPurpose,string>={unclassified:'未分类',source:'来源素材',derived:'加工素材',preview:'预览 / 中间版本',work:'成品',support:'辅助记录'}
const make=(tag:string,value:string)=>{const e=document.createElement(tag);e.textContent=value;return e}
export class ResearchPanel {
 private category:'topics'|'directions'='topics'
 private offset=0
 private generation=0
 private target?:{identity:LibraryIdentity;title:string}
 constructor(private root:HTMLElement,private api:Port,private context:()=>Context,private run:(operation:()=>Promise<unknown>)=>void,private say:(text:string)=>void,private browse:(filter:ResearchFilter)=>Promise<void>,private navigate:(category:'topics'|'directions')=>void,private reloadMaterial:(entry:LibraryEntry)=>Promise<void>){}
 isEditing():boolean{return Boolean(this.root.querySelector('[data-research-editor]'))}
 reset():void{this.generation++;this.target=undefined;this.offset=0;this.root.replaceChildren()}
 private button(label:string,operation:()=>Promise<unknown>):HTMLButtonElement{const e=document.createElement('button');e.textContent=label;e.onclick=()=>this.run(operation);return e}
 private field(root:HTMLElement,label:string,value:string,multiline=false):HTMLInputElement|HTMLTextAreaElement{const e=multiline?document.createElement('textarea'):document.createElement('input');e.value=value;e.maxLength=multiline?1000:120;const l=document.createElement('label');l.textContent=label;l.append(e);root.append(l);return e}
 private tags(value:string):string[]{return [...new Set(value.split(/[,，]/).map(t=>t.trim()).filter(Boolean))]}
 async load(category=this.category,offset=this.offset):Promise<void>{
  this.category=category;this.navigate(category);this.offset=offset;const generation=++this.generation,context=this.context(),page=await this.api.research({operation:category,offset,limit:30,includeArchived:true,...(category==='topics'?{projectId:context.project.id}:{})}) as Page<TopicRow|DirectionRow>
  if(generation!==this.generation)return
  this.root.replaceChildren(make('h2',category==='topics'?'项目专题':'全局关注方向'),make('p',category==='topics'?`专题保存在「${context.project.name}」，同一项目的会话共享研究资料。`:'方向可以关联多个项目的专题与素材。可在来源订阅中手动巡检，创建方向不会启动采集。'))
  this.root.append(this.button(category==='topics'?'新建项目专题':'新建关注方向',async()=>this.editor(category,undefined,page)))
  if(page.issues.length)this.root.append(make('p',page.issues.map(i=>i.message).join('\n')))
  const list=document.createElement('div');this.root.append(list)
  for(const item of page.items){const card=document.createElement('article');card.className='news-card';card.append(make('h3',item.title),make('p',item.description||'尚未填写研究范围。'),make('p',item.tags.join(' · ')))
   if(category==='topics'){const topic=item as TopicRow;card.append(make('p',topic.status==='open'?'进行中':'已结束'),this.button('查看关联资料与成品',()=>this.browse({projectId:topic.projectId,topicId:topic.id,label:topic.title})))
    if(!topic.archived)card.append(this.button('编辑专题',async()=>this.editor('topics',topic,page)),this.button('设为长期关注方向',async()=>this.promote(topic)))
    card.append(this.button('关联已有方向',async()=>this.linkTopic(topic)))
   }else{const direction=item as DirectionRow,project=context.projects.find(p=>p.id===direction.collectionProjectId);card.append(make('p',`采集归属：${project?.name??'项目不可用'} · ${direction.status==='paused'?'已暂停关注':'长期关注'} · ${direction.topicCount} 个专题`),make('p',direction.collectionState==='missing'||direction.collectionState==='archived'?'保存项目不可用，需要修复绑定。':'自动采集尚未启用。'),this.button('查看关联资料与成品',()=>this.browse({directionId:direction.id,label:direction.title})),this.button('编辑方向',async()=>this.editor('directions',direction,page)),this.button('查看关联专题',async()=>this.directionTopics(direction)))
   }list.append(card)
  }
  if(!page.items.length)list.append(make('p',category==='topics'?'可以从一个研究问题开始建立专题。':'尚无长期方向，可直接创建或从项目专题提升。'))
  const footer=document.createElement('div');footer.className='pagination';if(offset)footer.append(this.button('上一页',()=>this.load(category,Math.max(0,offset-30))));footer.append(make('span',`共 ${page.total} 项`));if(page.nextOffset!==null)footer.append(this.button('下一页',()=>this.load(category,page.nextOffset!)));this.root.append(footer)
 }
 private async editor(category:'topics'|'directions',item:TopicRow|DirectionRow|undefined,page:Page<TopicRow|DirectionRow>):Promise<void>{
  const context=this.context(),form=document.createElement('section');form.className='research-controls';form.dataset.researchEditor='true';form.append(make('h3',item?'编辑':'新建'));const title=this.field(form,'名称',item?.title??''),description=this.field(form,'研究问题与范围',item?.description??'',true),tags=this.field(form,'标签（逗号分隔）',item?.tags.join(', ')??''),status=document.createElement('select');status.append(...(category==='topics'?[new Option('进行中','open'),new Option('已结束','closed')]:[new Option('长期关注（手动巡检）','following'),new Option('暂停关注','paused')]));status.value=item?.status??(category==='topics'?'open':'following');form.append(status)
  const project=document.createElement('select');if(category==='directions'){project.append(...context.projects.map(p=>new Option(p.name+(p.archived?'（归档）':''),p.id)));project.value=(item as DirectionRow)?.collectionProjectId??context.project.id;const label=make('label','采集资料保存到');label.append(project);form.append(label)}
  const save=this.button('保存',async()=>{const input={title:title.value,description:description.value,tags:this.tags(tags.value),status:status.value};await this.api.research(category==='topics'?{operation:'put-topic',...(item?{id:item.id}:{}),expectedRevision:item?(item as TopicRow).revision:page.projectRevision,topic:input}:{operation:'put-direction',...(item?{id:item.id}:{}),expectedRevision:page.revision,direction:{...input,collectionProjectId:project.value}});this.say('已保存；原始资料与已有新闻制作流程保留。');await this.load()});form.append(save,this.button('取消',()=>this.load()));this.root.prepend(form);title.focus()
 }
 private async promote(topic:TopicRow):Promise<void>{
  const generation=this.generation,page=await this.api.research({operation:'directions',limit:1}) as Page<DirectionRow>;if(generation!==this.generation)return
  const context=this.context(),form=document.createElement('section');form.className='research-controls';form.dataset.researchEditor='true';form.append(make('h3','设为全局长期方向'),make('p','将保留原专题和资料，只新增全局关联。不会启动定时任务。'))
  const title=this.field(form,'方向名称',topic.title),description=this.field(form,'长期研究范围',topic.description,true),project=document.createElement('select');project.append(...context.projects.filter(p=>!p.archived).map(p=>new Option(p.name,p.id)));project.value=context.project.id;const label=make('label','后续采集资料保存到');label.append(project);form.append(label,this.button('创建长期方向',async()=>{await this.api.research({operation:'promote',topicId:topic.id,expectedTopicRevision:topic.revision,expectedRevision:page.revision,direction:{title:title.value,description:description.value,tags:topic.tags,status:'following',collectionProjectId:project.value}});this.say('已建立全局方向关联，原资料没有移动。');await this.load('directions',0)}),this.button('取消',()=>this.load()));this.root.prepend(form)
 }
 private async linkTopic(topic:TopicRow,offset=0):Promise<void>{
  const generation=this.generation,page=await this.api.research({operation:'directions',offset,limit:30}) as Page<DirectionRow>;if(generation!==this.generation)return
  const form=document.createElement('section');form.className='research-controls';form.dataset.researchEditor='true';form.append(make('h3','选择已有关注方向'))
  for(const d of page.items)form.append(this.button(d.title,async()=>{await this.api.research({operation:'link-topic',directionId:d.id,topicProjectId:topic.projectId,topicId:topic.id,expectedRevision:page.revision,linked:true});this.say('专题已关联到方向。');await this.load()}));if(page.nextOffset!==null)form.append(this.button('下一页方向',()=>this.linkTopic(topic,page.nextOffset!)));form.append(this.button('返回',()=>this.load()));this.root.prepend(form)
 }
 private async directionTopics(direction:DirectionRow,offset=0):Promise<void>{
  const generation=this.generation,page=await this.api.research({operation:'direction-topics',directionId:direction.id,offset,limit:20}) as {revision:number;items:{projectId:string;topicId:string;title:string;projectName:string;unavailable?:boolean}[];total:number;nextOffset:number|null;issues:{message:string}[]};if(generation!==this.generation)return
  this.root.querySelector('[data-direction-topics]')?.remove();const form=document.createElement('section');form.dataset.directionTopics='true';form.className='research-controls';form.dataset.researchEditor='true';form.append(make('h3',direction.title+' · 关联专题'))
  for(const ref of page.items){form.append(make('p',ref.projectName+' · '+ref.title));if(!ref.unavailable)form.append(this.button('查看此专题资料',()=>this.browse({projectId:ref.projectId,topicId:ref.topicId,label:ref.title})),this.button('解除此关联',async()=>{await this.api.research({operation:'link-topic',directionId:direction.id,topicProjectId:ref.projectId,topicId:ref.topicId,expectedRevision:page.revision,linked:false});await this.load()}))}for(const issue of page.issues)form.append(make('p',issue.message));form.append(make('p',`共 ${page.total} 个关联专题`));if(offset)form.append(this.button('上一页专题',()=>this.directionTopics(direction,Math.max(0,offset-20))));if(page.nextOffset!==null)form.append(this.button('下一页专题',()=>this.directionTopics(direction,page.nextOffset!)));form.append(this.button('返回',()=>this.load()));this.root.prepend(form)
 }
 async material(entry:LibraryEntry,root:HTMLElement,current:()=>boolean):Promise<void>{
  const id:LibraryIdentity=entry.artifactId?{projectId:entry.projectId,artifactId:entry.artifactId}:{projectId:entry.projectId,sourceId:entry.sourceId!,acquisitionId:entry.acquisitionId!}
  const links=await this.api.research({operation:'links',identity:id,includeArchived:true,limit:20}) as {revision:number;assignment:MaterialAssignment;directions:{id:string;title:string}[];items:MaterialRelation[];total:number;nextOffset:number|null;issues:{message:string}[]};if(!current())return
  const section=document.createElement('section');section.className='material-research';section.append(make('h3','用途与专题关联'));const purposes=document.createElement('select');for(const [key,label]of Object.entries(purposeLabels))purposes.append(new Option(label,key));purposes.value=links.assignment.purpose;section.append(purposes,make('p',links.directions.map(d=>d.title).join(' · ')||'尚未关联关注方向'))
  const topicIds=new Set(links.assignment.topicIds),directionIds=new Set(links.assignment.directionIds),choices=document.createElement('div');section.append(choices)
  const loadChoices=async(kind:'topics'|'directions',offset=0)=>{const page=await this.api.research({operation:kind,...(kind==='topics'?{projectId:entry.projectId}:{}),includeArchived:true,offset,limit:30}) as Page<TopicRow|DirectionRow>;if(!current())return;const group=document.createElement('fieldset');group.append(make('legend',kind==='topics'?'所属项目专题':'直接关联方向'));for(const item of page.items){const set=kind==='topics'?topicIds:directionIds,label=make('label',item.title),input=document.createElement('input');input.type='checkbox';input.checked=set.has(item.id);input.disabled=entry.archived;input.onchange=()=>input.checked?set.add(item.id):set.delete(item.id);label.prepend(input);group.append(label)}if(page.nextOffset!==null)group.append(this.button('加载更多',()=>loadChoices(kind,page.nextOffset!)));choices.append(group)}
  const save=this.button('保存用途与关联',async()=>{await this.api.research({operation:'assign',identity:id,expectedRevision:links.revision,purpose:purposes.value,topicIds:[...topicIds],directionIds:[...directionIds]});this.say('用途与关联已保存，成品分类不代表人工验收。');await this.reloadMaterial(entry)});save.disabled=entry.archived;section.append(save,this.button('选择专题与方向',async()=>{choices.replaceChildren();await loadChoices('topics');await loadChoices('directions')}))
  section.append(make('h3','参考与计划使用'),make('p','参考和计划使用不代表已进入实际成品。'),this.button('将此项设为关联目标',async()=>{this.target={identity:id,title:entry.title};this.say('已选择关联目标：'+entry.title+'。再打开一份素材登记参考或计划使用。')}))
  if(this.target&&JSON.stringify(this.target.identity)!==JSON.stringify(id)){const target=this.target;section.append(make('p','关联目标：'+target.title));for(const [type,label]of [['reference','登记为参考'],['planned','登记为计划使用']] as const){const b=this.button(label,async()=>{await this.api.research({operation:'relate',from:id,to:target.identity,type,note:entry.title+' → '+target.title,expectedRevision:links.revision});this.say('关联已保存。重新打开素材可查看。')});b.disabled=entry.archived;section.append(b)}}
  const relationList=document.createElement('div');section.append(relationList)
  const showRelations=(page:{revision:number;items:MaterialRelation[];total:number;nextOffset?:number|null})=>{relationList.replaceChildren();for(const relation of page.items){relationList.append(make('p',(relation.type==='reference'?'参考：':'计划使用：')+(relation.note||'已关联资料')));if(relation.from.projectId===entry.projectId&&!entry.archived)relationList.append(this.button('移除此关系',async()=>{await this.api.research({operation:'remove-relation',projectId:entry.projectId,id:relation.id,expectedRevision:page.revision});this.say('已移除关系，原始资料保留。');relationList.replaceChildren(make('p','关系已更新，重新打开素材查看。'))}))}relationList.append(make('p',`共 ${page.total} 条关系`));if(page.nextOffset!==null&&page.nextOffset!==undefined)relationList.append(this.button('下一页关系',async()=>{const next=await this.api.research({operation:'links',identity:id,includeArchived:true,limit:20,offset:page.nextOffset});if(current())showRelations(next as typeof page)}))}
  showRelations(links);for(const issue of links.issues)section.append(make('p',issue.message));root.append(section)
 }
}
