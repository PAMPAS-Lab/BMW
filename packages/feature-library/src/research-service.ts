import {sourceLookup,sourceBindings} from '@bmw-agent/media-native/sources'
import fs from 'node:fs'
import {WorkExportStore} from './export-store.js'
import {LibraryStorage} from './library-storage.js'
import {libraryKey} from './library-contract.js'
import type {LibraryIdentity} from './library-contract.js'
import type {LibraryService,LibraryProject} from './library-service.js'
import {assertResearchRequest} from './research-contract.js'
import type {MaterialAssignment,MaterialRelation,ProjectTopic,ResearchRequest} from './research-contract.js'
import {ProjectResearchStore,DirectionStore,newResearchId} from './research-store.js'

export class ResearchService {
 constructor(private library:LibraryService,private directions?:DirectionStore){}
 private store(project:LibraryProject){return new ProjectResearchStore(project.directory,project.id)}
 private globals(){if(!this.directions)throw new Error('Global library direction storage unavailable.');return this.directions}
 private writable(projectId:string,actor:'user'|'agent'){if(actor!=='user')throw new Error('LIBRARY_RESEARCH_USER_REQUIRED: Organizing topics and directions requires the trusted BMW user.');const project=this.library.project(projectId);if(project.archivedAt)throw new Error('Archived Project research is read-only.');return project}
 private material(id:LibraryIdentity):void{const p=this.library.project(id.projectId);if(id.artifactId){const file=new LibraryStorage(p.directory).file('artifacts/'+id.artifactId),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Invalid research material.')}else if(!sourceLookup(this.library.host.sources(p.id),id.sourceId!,id.acquisitionId!))throw new Error('Unknown research source acquisition.')}
 async execute(raw:unknown,actor:'user'|'agent',signal?:AbortSignal):Promise<unknown>{
  const r=assertResearchRequest(raw);this.library.host.guard();signal?.throwIfAborted()
  if(r.operation==='topics'||r.operation==='directions')return this.list(r)
  if(r.operation==='direction-topics'){
   const state=this.globals().read(),direction=state.directions.find(d=>d.id===r.directionId);if(!direction)throw new Error('Unknown direction.')
   const issues:{projectId:string;message:string}[]=[],items=direction.topics.slice(r.offset,r.offset+r.limit).map(ref=>{try{const project=this.library.project(ref.projectId),topic=this.store(project).read().topics.find(t=>t.id===ref.topicId);if(!topic)throw new Error('Topic unavailable.');return {...ref,title:topic.title,projectName:project.name,archived:Boolean(project.archivedAt)}}catch(error){issues.push({projectId:ref.projectId,message:String(error)});return {...ref,title:'专题暂不可用',projectName:ref.projectId,unavailable:true}}})
   return {revision:state.revision,items,total:direction.topics.length,nextOffset:r.offset+r.limit<direction.topics.length?r.offset+r.limit:null,issues}
  }
  if(r.operation==='links')return this.links(r)
  if(actor!=='user')throw new Error('LIBRARY_RESEARCH_USER_REQUIRED: Only the trusted BMW user may organize topics, directions and material relations.')
  const now=new Date().toISOString(),active=this.library.host.active()
  if(r.operation==='put-topic'){
   const project=this.writable(active.id,actor),store=this.store(project),state=store.read(),previous=r.id?state.topics.find(t=>t.id===r.id):undefined
   if(r.id&&!previous)throw new Error('Unknown project topic.')
   const topic={...r.topic,id:previous?.id??newResearchId(),createdAt:previous?.createdAt??now,updatedAt:now}
   const next=store.write(r.expectedRevision,{...state,topics:previous?state.topics.map(t=>t.id===topic.id?topic:t):[...state.topics,topic]});return {topic,revision:next.revision}
  }
  if(r.operation==='put-direction'||r.operation==='promote'){
   const target=this.library.project(r.direction.collectionProjectId);if(target.archivedAt&&r.direction.status==='following')throw new Error('Choose an active collection Project or pause this direction.')
   const store=this.globals(),state=store.read(),previous=r.operation==='put-direction'&&r.id?state.directions.find(d=>d.id===r.id):undefined
   if(r.operation==='put-direction'&&r.id&&!previous)throw new Error('Unknown direction.')
   const topics=previous?.topics??[]
   if(r.operation==='promote'){
    const project=this.writable(active.id,actor),research=this.store(project).read();if(research.revision!==r.expectedTopicRevision)throw new Error('LIBRARY_RESEARCH_CONFLICT: Reload the topic before promotion.');if(!research.topics.some(t=>t.id===r.topicId))throw new Error('Unknown project topic.')
    if(state.directions.some(d=>d.topics.some(t=>t.projectId===active.id&&t.topicId===r.topicId)))throw new Error('TOPIC_ALREADY_PROMOTED: Link this topic to another existing direction explicitly.')
    topics.push({projectId:active.id,topicId:r.topicId})
   }
   const direction={...r.direction,id:previous?.id??newResearchId(),topics,createdAt:previous?.createdAt??now,updatedAt:now},next=store.write(r.expectedRevision,{...state,directions:previous?state.directions.map(d=>d.id===direction.id?direction:d):[...state.directions,direction]})
   return {direction,revision:next.revision,collectionState:target.archivedAt?'archived':'manual-only'}
  }
  if(r.operation==='link-topic'){
   const project=this.library.project(r.topicProjectId),topic=this.store(project).read().topics.find(t=>t.id===r.topicId);if(!topic)throw new Error('Unknown project topic.')
   const store=this.globals(),state=store.read(),direction=state.directions.find(d=>d.id===r.directionId);if(!direction)throw new Error('Unknown direction.')
   const topics=direction.topics.filter(t=>t.projectId!==project.id||t.topicId!==topic.id);if(r.linked)topics.push({projectId:project.id,topicId:topic.id})
   const next=store.write(r.expectedRevision,{...state,directions:state.directions.map(d=>d.id===direction.id?{...d,topics,updatedAt:now}:d)});return {revision:next.revision}
  }
  if(r.operation==='assign'){
   const project=this.writable(r.identity.projectId,actor);this.material(r.identity);const store=this.store(project),state=store.read()
   if(r.topicIds.some(id=>!state.topics.some(t=>t.id===id)))throw new Error('Unknown or foreign project topic.')
   if(r.directionIds.length&&r.directionIds.some(id=>!this.globals().read().directions.some(d=>d.id===id)))throw new Error('Unknown global direction.')
   const assignment:MaterialAssignment={identity:r.identity,purpose:r.purpose,topicIds:r.topicIds,directionIds:r.directionIds},key=libraryKey(r.identity),next=store.write(r.expectedRevision,{...state,assignments:[...state.assignments.filter(a=>libraryKey(a.identity)!==key),assignment]})
   return {assignment,revision:next.revision}
  }
  if(r.operation==='relate'){
   const project=this.writable(r.from.projectId,actor);this.material(r.from);this.material(r.to);if(libraryKey(r.from)===libraryKey(r.to))throw new Error('A material cannot refer to itself.')
   const store=this.store(project),state=store.read(),existing=state.relations.find(x=>x.type===r.type&&libraryKey(x.from)===libraryKey(r.from)&&libraryKey(x.to)===libraryKey(r.to)),relation:MaterialRelation={id:existing?.id??newResearchId(),from:r.from,to:r.to,type:r.type,note:r.note,createdAt:existing?.createdAt??now,actor:'user'}
   const next=store.write(r.expectedRevision,{...state,relations:[...state.relations.filter(x=>x.id!==relation.id),relation]});return {relation,revision:next.revision}
  }
  if(r.operation==='remove-relation'){
   const project=this.writable(r.projectId,actor),store=this.store(project),state=store.read();if(!state.relations.some(x=>x.id===r.id))throw new Error('Unknown material relation.');const next=store.write(r.expectedRevision,{...state,relations:state.relations.filter(x=>x.id!==r.id)});return {revision:next.revision}
  }
  throw new Error('Unknown research request.')
 }
 private list(r:Extract<ResearchRequest,{operation:'topics'|'directions'}>){
  const active=this.library.host.active(),issues:{projectId:string;message:string}[]=[],projectRevision=this.store(active).read().revision
  if(r.projectId)this.library.project(r.projectId)
  if(r.operation==='directions'){
   const state=this.globals().read(),projects=this.library.host.projects(true),items=state.directions.filter(d=>!r.projectId||d.collectionProjectId===r.projectId||d.topics.some(t=>t.projectId===r.projectId)).map(d=>{const target=projects.find(p=>p.id===d.collectionProjectId);return {...d,topics:d.topics.slice(0,20),topicCount:d.topics.length,collectionState:!target?'missing':target.archivedAt?'archived':d.status==='paused'?'paused':'manual-only'}})
   return {revision:state.revision,projectRevision,items:items.slice(r.offset,r.offset+r.limit),total:items.length,nextOffset:r.offset+r.limit<items.length?r.offset+r.limit:null,issues}
  }
  const items:(ProjectTopic&{projectId:string;projectName:string;archived:boolean;revision:number})[]=[]
  for(const p of this.library.host.projects(r.includeArchived)){if(r.projectId&&p.id!==r.projectId)continue;try{const state=this.store(p).read();for(const topic of state.topics)items.push({...topic,projectId:p.id,projectName:p.name,archived:Boolean(p.archivedAt),revision:state.revision})}catch(error){issues.push({projectId:p.id,message:String(error)})}}
  items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));return {projectRevision,items:items.slice(r.offset,r.offset+r.limit),total:items.length,nextOffset:r.offset+r.limit<items.length?r.offset+r.limit:null,issues}
 }
 private links(r:Extract<ResearchRequest,{operation:'links'}>){
  const project=this.library.project(r.identity.projectId),state=this.store(project).read(),key=libraryKey(r.identity)
  let inherited:MaterialAssignment|undefined
  if(r.identity.artifactId){for(const {source,acquisition}of sourceBindings(this.library.host.sources(project.id),r.identity.artifactId)){inherited=state.assignments.find(a=>libraryKey(a.identity)===libraryKey({projectId:project.id,sourceId:source.id,acquisitionId:acquisition.id}));if(inherited)break}}
  const assignment:MaterialAssignment=state.assignments.find(a=>libraryKey(a.identity)===key)??{identity:r.identity,purpose:r.identity.artifactId?(new WorkExportStore(project.directory,project.id).scan().summaries.some(s=>s.artifactId===r.identity.artifactId)?'work':'unclassified'):'source',topicIds:inherited?.topicIds??[],directionIds:inherited?.directionIds??[]},directions=this.directions?.read().directions??[],linked=directions.filter(d=>assignment.directionIds.includes(d.id)||d.topics.some(t=>t.projectId===project.id&&assignment.topicIds.includes(t.topicId))),items:MaterialRelation[]=[],issues:{projectId:string;message:string}[]=[]
  for(const p of this.library.host.projects(r.includeArchived)){try{for(const relation of this.store(p).read().relations)if(libraryKey(relation.from)===key||libraryKey(relation.to)===key)items.push(relation)}catch(error){issues.push({projectId:p.id,message:String(error)})}}
  return {revision:state.revision,assignment,topics:state.topics.filter(t=>assignment.topicIds.includes(t.id)).slice(0,20),directions:linked.map(d=>({id:d.id,title:d.title,status:d.status})).slice(0,20),items:items.slice(r.offset,r.offset+r.limit),total:items.length,nextOffset:r.offset+r.limit<items.length?r.offset+r.limit:null,issues}
 }
}
