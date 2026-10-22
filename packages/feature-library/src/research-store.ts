import crypto from 'node:crypto'
import {finiteNumber,mediaRecord} from '@bmw-agent/media-native/contract'
import {sourceId} from '@bmw-agent/media-native/sources'
import {LibraryStorage} from './library-storage.js'
import {libraryKey} from './library-contract.js'
import {closed,topicInput,directionInput,ids,purpose,identity,researchText} from './research-contract.js'
import type {ProjectResearch,DirectionCatalog,MaterialAssignment,MaterialRelation,ProjectTopic,LibraryDirection} from './research-contract.js'

function date(raw:unknown):string{const text=researchText(raw,40,true);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(text)||!Number.isFinite(Date.parse(text))||new Date(text).toISOString()!==text)throw new TypeError('Invalid research timestamp.');return text}
function unique(values:string[]):void{if(new Set(values).size!==values.length)throw new TypeError('Duplicate research record.')}
export function assertProjectResearch(raw:unknown,projectId:string):ProjectResearch{
 const v=mediaRecord(raw);closed(v,['version','projectId','revision','topics','assignments','relations'])
 if(v.version!==1||v.projectId!==projectId||!Array.isArray(v.topics)||v.topics.length>500||!Array.isArray(v.assignments)||v.assignments.length>5000||!Array.isArray(v.relations)||v.relations.length>5000)throw new TypeError('Invalid Project research; original preserved.')
 const topics:ProjectTopic[]=v.topics.map(raw=>{const t=mediaRecord(raw);closed(t,['id','title','description','tags','status','createdAt','updatedAt']);return {...topicInput({title:t.title,description:t.description,tags:t.tags,status:t.status}),id:sourceId(t.id),createdAt:date(t.createdAt),updatedAt:date(t.updatedAt)}})
 const assignments:MaterialAssignment[]=v.assignments.map(raw=>{const a=mediaRecord(raw);closed(a,['identity','purpose','topicIds','directionIds']);const id=identity(a.identity),topicIds=ids(a.topicIds);if(id.projectId!==projectId||topicIds.some(id=>!topics.some(t=>t.id===id)))throw new Error('Foreign research assignment.');return {identity:id,purpose:purpose(a.purpose),topicIds,directionIds:ids(a.directionIds)}})
 const relations:MaterialRelation[]=v.relations.map(raw=>{const r=mediaRecord(raw);closed(r,['id','from','to','type','note','createdAt','actor']);const from=identity(r.from),to=identity(r.to);if(from.projectId!==projectId||r.actor!=='user'||!['reference','planned'].includes(String(r.type))||libraryKey(from)===libraryKey(to))throw new Error('Invalid material relation.');return {id:sourceId(r.id),from,to,type:r.type as MaterialRelation['type'],note:researchText(r.note,1000),createdAt:date(r.createdAt),actor:'user'}})
 unique(topics.map(t=>t.id));unique(assignments.map(a=>libraryKey(a.identity)));unique(relations.map(r=>r.id));unique(relations.map(r=>r.type+':'+libraryKey(r.from)+':'+libraryKey(r.to)))
 return {version:1,projectId,revision:finiteNumber(v.revision,'research revision',0,1000000,true),topics,assignments,relations}
}
export function assertDirectionCatalog(raw:unknown):DirectionCatalog{
 const v=mediaRecord(raw);closed(v,['version','revision','directions']);if(v.version!==1||!Array.isArray(v.directions)||v.directions.length>500)throw new Error('Invalid directions; original preserved.')
 const directions:LibraryDirection[]=v.directions.map(raw=>{const d=mediaRecord(raw);closed(d,['id','title','description','tags','status','collectionProjectId','topics','createdAt','updatedAt']);if(!Array.isArray(d.topics)||d.topics.length>500)throw new TypeError('Direction topic budget exceeded.');const topics=d.topics.map(raw=>{const r=mediaRecord(raw);closed(r,['projectId','topicId']);return {projectId:sourceId(r.projectId),topicId:sourceId(r.topicId)}});unique(topics.map(t=>t.projectId+':'+t.topicId));return {...directionInput({title:d.title,description:d.description,tags:d.tags,status:d.status,collectionProjectId:d.collectionProjectId}),id:sourceId(d.id),topics,createdAt:date(d.createdAt),updatedAt:date(d.updatedAt)}})
 unique(directions.map(d=>d.id));return {version:1,revision:finiteNumber(v.revision,'direction revision',0,1000000,true),directions}
}
/** Uses the same pinned directory/atomic file rules as existing library metadata. */
export class ProjectResearchStore {
 private storage:LibraryStorage
 constructor(directory:string,private projectId:string){sourceId(projectId);this.storage=new LibraryStorage(directory)}
 read():ProjectResearch{const raw=this.storage.readJson('library/research.json');return raw===undefined?{version:1,projectId:this.projectId,revision:0,topics:[],assignments:[],relations:[]}:assertProjectResearch(raw,this.projectId)}
 write(revision:number,next:ProjectResearch):ProjectResearch{if(this.read().revision!==revision)throw new Error('LIBRARY_RESEARCH_CONFLICT: Reload project topics and material associations.');const checked=assertProjectResearch({...next,revision:revision+1},this.projectId);this.storage.writeJson('library/research.json',checked);return checked}
}
export class DirectionStore {
 private storage:LibraryStorage
 constructor(directory:string){this.storage=new LibraryStorage(directory)}
 read():DirectionCatalog{const raw=this.storage.readJson('library/directions.json');return raw===undefined?{version:1,revision:0,directions:[]}:assertDirectionCatalog(raw)}
 write(revision:number,next:DirectionCatalog):DirectionCatalog{if(this.read().revision!==revision)throw new Error('LIBRARY_DIRECTION_CONFLICT: Reload global directions.');const checked=assertDirectionCatalog({...next,revision:revision+1});this.storage.writeJson('library/directions.json',checked);return checked}
}
export const newResearchId=()=>crypto.randomUUID()
