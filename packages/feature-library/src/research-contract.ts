import {finiteNumber,mediaRecord} from '@bmw-agent/media-native/contract'
import {sourceId} from '@bmw-agent/media-native/sources'
import {assertLibraryIdentity,assertLibraryMetadata} from './library-contract.js'
import type {LibraryIdentity} from './library-contract.js'
import {MATERIAL_PURPOSES,purpose} from './material-purpose.js'
import type {MaterialPurpose} from './material-purpose.js'
export {MATERIAL_PURPOSES,purpose} from './material-purpose.js'
export type {MaterialPurpose} from './material-purpose.js'

export interface TopicInput {title:string;description:string;tags:string[];status:'open'|'closed'}
export interface ProjectTopic extends TopicInput {id:string;createdAt:string;updatedAt:string}
export interface TopicRef {projectId:string;topicId:string}
export interface DirectionInput {title:string;description:string;tags:string[];collectionProjectId:string;status:'following'|'paused'}
export interface LibraryDirection extends DirectionInput {id:string;topics:TopicRef[];createdAt:string;updatedAt:string}
export interface MaterialAssignment {identity:LibraryIdentity;purpose:MaterialPurpose;topicIds:string[];directionIds:string[]}
export interface MaterialRelation {id:string;from:LibraryIdentity;to:LibraryIdentity;type:'reference'|'planned';note:string;createdAt:string;actor:'user'}
export interface ProjectResearch {version:1;projectId:string;revision:number;topics:ProjectTopic[];assignments:MaterialAssignment[];relations:MaterialRelation[]}
export interface DirectionCatalog {version:1;revision:number;directions:LibraryDirection[]}
export type ResearchRequest=
 |{operation:'topics'|'directions';projectId?:string;includeArchived:boolean;offset:number;limit:number}
 |{operation:'direction-topics';directionId:string;offset:number;limit:number}
 |{operation:'put-topic';id?:string;expectedRevision:number;topic:TopicInput}
 |{operation:'put-direction';id?:string;expectedRevision:number;direction:DirectionInput}
 |{operation:'promote';topicId:string;expectedTopicRevision:number;expectedRevision:number;direction:DirectionInput}
 |{operation:'link-topic';directionId:string;topicProjectId:string;topicId:string;expectedRevision:number;linked:boolean}
 |{operation:'assign';identity:LibraryIdentity;expectedRevision:number;purpose:MaterialPurpose;topicIds:string[];directionIds:string[]}
 |{operation:'relate';from:LibraryIdentity;to:LibraryIdentity;type:'reference'|'planned';note:string;expectedRevision:number}
 |{operation:'remove-relation';id:string;projectId:string;expectedRevision:number}
 |{operation:'links';identity:LibraryIdentity;offset:number;limit:number;includeArchived:boolean}
export function closed(raw:Record<string,unknown>,keys:readonly string[]):void{if(Object.keys(raw).some(k=>!keys.includes(k)))throw new TypeError('Unexpected research field.')}
export function researchText(raw:unknown,max:number,required=false):string{if(typeof raw!=='string'||raw.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(raw)||required&&!raw.trim())throw new TypeError('Invalid research text.');return raw}
export function ids(raw:unknown,max=100):string[]{if(!Array.isArray(raw)||raw.length>max)throw new TypeError('Research identity budget exceeded.');const result=raw.map(sourceId);if(new Set(result).size!==result.length)throw new TypeError('Duplicate research identity.');return result}
export function identity(raw:unknown):LibraryIdentity{const v=mediaRecord(raw);closed(v,['projectId','artifactId','sourceId','acquisitionId']);return assertLibraryIdentity(v)}
export function topicInput(raw:unknown):TopicInput{const v=mediaRecord(raw);closed(v,['title','description','tags','status']);const metadata=assertLibraryMetadata({title:v.title,description:v.description,tags:v.tags,favorite:false});if(!metadata.title.trim()||!['open','closed'].includes(String(v.status)))throw new TypeError('Invalid topic.');return {title:metadata.title,description:metadata.description,tags:metadata.tags,status:v.status as TopicInput['status']}}
export function directionInput(raw:unknown):DirectionInput{const v=mediaRecord(raw);closed(v,['title','description','tags','collectionProjectId','status']);const topic=topicInput({title:v.title,description:v.description,tags:v.tags,status:'open'});if(!['following','paused'].includes(String(v.status)))throw new TypeError('Invalid direction status.');return {title:topic.title,description:topic.description,tags:topic.tags,collectionProjectId:sourceId(v.collectionProjectId),status:v.status as DirectionInput['status']}}
const revision=(raw:unknown)=>finiteNumber(raw,'research revision',0,1000000,true)
export function assertResearchRequest(raw:unknown):ResearchRequest{
 const v=mediaRecord(raw),operation=v.operation
 if(operation==='direction-topics'){closed(v,['operation','directionId','offset','limit']);return {operation,directionId:sourceId(v.directionId),offset:finiteNumber(v.offset??0,'offset',0,1000000,true),limit:finiteNumber(v.limit??20,'limit',1,50,true)}}
 if(operation==='topics'||operation==='directions'){closed(v,['operation','projectId','includeArchived','offset','limit']);if(v.includeArchived!==undefined&&typeof v.includeArchived!=='boolean')throw new TypeError('Invalid archive filter.');return {operation,...(v.projectId===undefined?{}:{projectId:sourceId(v.projectId)}),includeArchived:v.includeArchived===true,offset:finiteNumber(v.offset??0,'offset',0,1000000,true),limit:finiteNumber(v.limit??30,'limit',1,50,true)}}
 if(operation==='put-topic'){closed(v,['operation','id','expectedRevision','topic']);return {operation,...(v.id===undefined?{}:{id:sourceId(v.id)}),expectedRevision:revision(v.expectedRevision),topic:topicInput(v.topic)}}
 if(operation==='put-direction'){closed(v,['operation','id','expectedRevision','direction']);return {operation,...(v.id===undefined?{}:{id:sourceId(v.id)}),expectedRevision:revision(v.expectedRevision),direction:directionInput(v.direction)}}
 if(operation==='promote'){closed(v,['operation','topicId','expectedTopicRevision','expectedRevision','direction']);return {operation,topicId:sourceId(v.topicId),expectedTopicRevision:revision(v.expectedTopicRevision),expectedRevision:revision(v.expectedRevision),direction:directionInput(v.direction)}}
 if(operation==='link-topic'){closed(v,['operation','directionId','topicProjectId','topicId','expectedRevision','linked']);if(typeof v.linked!=='boolean')throw new TypeError('Invalid topic link.');return {operation,directionId:sourceId(v.directionId),topicProjectId:sourceId(v.topicProjectId),topicId:sourceId(v.topicId),expectedRevision:revision(v.expectedRevision),linked:v.linked}}
 if(operation==='assign'){closed(v,['operation','identity','expectedRevision','purpose','topicIds','directionIds']);return {operation,identity:identity(v.identity),expectedRevision:revision(v.expectedRevision),purpose:purpose(v.purpose),topicIds:ids(v.topicIds),directionIds:ids(v.directionIds)}}
 if(operation==='relate'){closed(v,['operation','from','to','type','note','expectedRevision']);if(!['reference','planned'].includes(String(v.type)))throw new TypeError('Only reference/planned relations can be registered here.');return {operation,from:identity(v.from),to:identity(v.to),type:v.type as 'reference'|'planned',note:researchText(v.note??'',1000),expectedRevision:revision(v.expectedRevision)}}
 if(operation==='remove-relation'){closed(v,['operation','id','projectId','expectedRevision']);return {operation,id:sourceId(v.id),projectId:sourceId(v.projectId),expectedRevision:revision(v.expectedRevision)}}
 if(operation==='links'){closed(v,['operation','identity','offset','limit','includeArchived']);if(v.includeArchived!==undefined&&typeof v.includeArchived!=='boolean')throw new TypeError('Invalid archive filter.');return {operation,identity:identity(v.identity),includeArchived:v.includeArchived===true,offset:finiteNumber(v.offset??0,'offset',0,1000000,true),limit:finiteNumber(v.limit??20,'limit',1,50,true)}}
 throw new TypeError('Unknown research operation.')
}
const idSchema={type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},revisionSchema={type:'integer',minimum:0,maximum:1000000},tags={type:'array',maxItems:20,uniqueItems:true,items:{type:'string',maxLength:32}},idsSchema={type:'array',maxItems:100,uniqueItems:true,items:idSchema}
const identitySchema={oneOf:[{type:'object',additionalProperties:false,required:['projectId','artifactId'],properties:{projectId:idSchema,artifactId:{type:'string',maxLength:180}}},{type:'object',additionalProperties:false,required:['projectId','sourceId','acquisitionId'],properties:{projectId:idSchema,sourceId:idSchema,acquisitionId:idSchema}}]}
const fields={title:{type:'string',minLength:1,maxLength:120},description:{type:'string',maxLength:1000},tags}
const topicSchema={type:'object',additionalProperties:false,required:['title','description','tags','status'],properties:{...fields,status:{enum:['open','closed']}}}
const directionSchema={type:'object',additionalProperties:false,required:['title','description','tags','status','collectionProjectId'],properties:{...fields,status:{enum:['following','paused']},collectionProjectId:idSchema}}
const variant=(operation:string[],properties:Record<string,unknown>,required:string[]=[])=>({type:'object',additionalProperties:false,required:['operation',...required],properties:{operation:{enum:operation},...properties}})
export const researchRequestSchema={oneOf:[
 variant(['direction-topics'],{directionId:idSchema,offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:50}},['directionId']),
 variant(['topics','directions'],{projectId:idSchema,offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:50},includeArchived:{type:'boolean'}}),
 variant(['put-topic'],{id:idSchema,expectedRevision:revisionSchema,topic:topicSchema},['expectedRevision','topic']),
 variant(['put-direction'],{id:idSchema,expectedRevision:revisionSchema,direction:directionSchema},['expectedRevision','direction']),
 variant(['promote'],{topicId:idSchema,expectedTopicRevision:revisionSchema,expectedRevision:revisionSchema,direction:directionSchema},['topicId','expectedTopicRevision','expectedRevision','direction']),
 variant(['link-topic'],{topicId:idSchema,topicProjectId:idSchema,directionId:idSchema,expectedRevision:revisionSchema,linked:{type:'boolean'}},['topicId','topicProjectId','directionId','expectedRevision','linked']),
 variant(['assign'],{identity:identitySchema,expectedRevision:revisionSchema,purpose:{enum:MATERIAL_PURPOSES},topicIds:idsSchema,directionIds:idsSchema},['identity','expectedRevision','purpose','topicIds','directionIds']),
 variant(['relate'],{from:identitySchema,to:identitySchema,type:{enum:['reference','planned']},note:{type:'string',maxLength:1000},expectedRevision:revisionSchema},['from','to','type','expectedRevision']),
 variant(['remove-relation'],{id:idSchema,projectId:idSchema,expectedRevision:revisionSchema},['id','projectId','expectedRevision']),
 variant(['links'],{identity:identitySchema,offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:50},includeArchived:{type:'boolean'}},['identity'])
]}
