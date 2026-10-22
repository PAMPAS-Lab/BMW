import {assertArtifactId,finiteNumber,mediaRecord} from '@bmw-agent/media-native/contract'
import {sourceId} from '@bmw-agent/media-native/sources'
import {closed,identity,researchText} from './research-contract.js'
import type {LibraryIdentity} from './library-contract.js'

export const EXPORT_ROLES=['main-video','main-image','source-audio','narration','visual-layer','audio-layer','card-image'] as const
export interface ExportRange {startSeconds:number;endSeconds:number}
export interface ExportSource {sourceId:string;acquisitionId:string;bodySha256:string|null;url:string;captureRange:ExportRange|null}
export interface ExportUse {artifactId:string;sha256:string;bytes:number;role:typeof EXPORT_ROLES[number];sceneIndex:number|null;clipId:string|null;outputRange:ExportRange;sourceRange:ExportRange|null;playbackRate:number;holdFromOutputSeconds:number|null;sources:ExportSource[];origins:LibraryIdentity[]}
export interface WorkExport {version:1;id:string;projectId:string;workId:string;draftId:string|null;sessionId:string|null;draftRevision:number|null;title:string;createdAt:string;rendererVersion:string;compositionSha256:string;artifactId:string;outputSha256:string;durationSeconds:number;uses:ExportUse[]}
export interface ExportSummary {id:string;projectId:string;workId:string;draftId:string|null;sessionId:string|null;draftRevision:number|null;title:string;createdAt:string;artifactId:string;outputSha256:string|null;durationSeconds:number;provenance:'recorded'|'legacy-unknown';useCount:number|null;recovered?:boolean}
export type ExportsRequest=
 |{operation:'works';projectId?:string;includeArchived:boolean;offset:number;limit:number}
 |{operation:'versions';projectId:string;workId?:string;artifactId?:string;offset:number;limit:number}
 |{operation:'uses';projectId:string;exportId:string;offset:number;limit:number}
 |{operation:'adoptions';identity:LibraryIdentity;includeArchived:boolean;offset:number;limit:number}
export function exportSha(raw:unknown):string{if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))throw new TypeError('Invalid export fingerprint.');return raw}
export function exportDate(raw:unknown):string{const value=researchText(raw,40,true);if(!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new TypeError('Invalid export date.');return value}
export function exportRange(raw:unknown,max=86400):ExportRange{const v=mediaRecord(raw);closed(v,['startSeconds','endSeconds']);const startSeconds=finiteNumber(v.startSeconds,'range start',0,max),endSeconds=finiteNumber(v.endSeconds,'range end',0,max);if(endSeconds<=startSeconds)throw new TypeError('Empty export interval.');return {startSeconds,endSeconds}}
export function assertWorkExport(raw:unknown,projectId:string):WorkExport{
 const v=mediaRecord(raw);closed(v,['version','id','projectId','workId','draftId','sessionId','draftRevision','title','createdAt','rendererVersion','compositionSha256','artifactId','outputSha256','durationSeconds','uses'])
 if(v.version!==1||v.projectId!==projectId||!Array.isArray(v.uses)||v.uses.length>4096)throw new Error('Invalid work export; original preserved.')
 const durationSeconds=finiteNumber(v.durationSeconds,'export duration',.001,721),draftId=v.draftId===null?null:sourceId(v.draftId),sessionId=v.sessionId===null?null:sourceId(v.sessionId),draftRevision=v.draftRevision===null?null:finiteNumber(v.draftRevision,'draft revision',1,1000000,true)
 if(Boolean(draftId)!==Boolean(draftRevision)||draftId&&!sessionId)throw new TypeError('Incomplete export owner.')
 const uses:ExportUse[]=v.uses.map(raw=>{const u=mediaRecord(raw);closed(u,['artifactId','sha256','bytes','role','sceneIndex','clipId','outputRange','sourceRange','playbackRate','holdFromOutputSeconds','sources','origins']);if(!EXPORT_ROLES.includes(u.role as ExportUse['role'])||!Array.isArray(u.sources)||u.sources.length>80||!Array.isArray(u.origins)||u.origins.length>100)throw new TypeError('Invalid export use.')
  const outputRange=exportRange(u.outputRange,721),sourceRange=u.sourceRange===null?null:exportRange(u.sourceRange),hold=u.holdFromOutputSeconds===null?null:finiteNumber(u.holdFromOutputSeconds,'held frame start',outputRange.startSeconds,outputRange.endSeconds);if(outputRange.endSeconds>durationSeconds+.05)throw new TypeError('Adoption exceeds exported timeline.')
  return {artifactId:assertArtifactId(u.artifactId),sha256:exportSha(u.sha256),bytes:finiteNumber(u.bytes,'material bytes',1,1024*1024*1024,true),role:u.role as ExportUse['role'],sceneIndex:u.sceneIndex===null?null:finiteNumber(u.sceneIndex,'scene index',0,95,true),clipId:u.clipId===null?null:researchText(u.clipId,80,true),outputRange,sourceRange,playbackRate:finiteNumber(u.playbackRate,'playback rate',.25,2),holdFromOutputSeconds:hold,sources:u.sources.map(raw=>{const s=mediaRecord(raw);closed(s,['sourceId','acquisitionId','bodySha256','url','captureRange']);const url=researchText(s.url,4000,true);if(!/^https?:\/\//i.test(url))throw new TypeError('Invalid export source URL.');return {sourceId:sourceId(s.sourceId),acquisitionId:sourceId(s.acquisitionId),bodySha256:s.bodySha256===null?null:exportSha(s.bodySha256),url,captureRange:s.captureRange===null?null:exportRange(s.captureRange)}}),origins:u.origins.map(identity)}
 })
 return {version:1,id:exportSha(v.id),projectId,workId:sourceId(v.workId),draftId,sessionId,draftRevision,title:researchText(v.title,120,true),createdAt:exportDate(v.createdAt),rendererVersion:researchText(v.rendererVersion,120,true),compositionSha256:exportSha(v.compositionSha256),artifactId:assertArtifactId(v.artifactId),outputSha256:exportSha(v.outputSha256),durationSeconds,uses}
}
export function exportSummary(r:WorkExport,recovered=false):ExportSummary{return {id:r.id,projectId:r.projectId,workId:r.workId,draftId:r.draftId,sessionId:r.sessionId,draftRevision:r.draftRevision,title:r.title,createdAt:r.createdAt,artifactId:r.artifactId,outputSha256:r.outputSha256,durationSeconds:r.durationSeconds,provenance:'recorded',useCount:r.uses.length,...(recovered?{recovered:true}:{})}}
export function assertExportsRequest(raw:unknown):ExportsRequest{
 const v=mediaRecord(raw),operation=v.operation,offset=finiteNumber(v.offset??0,'export offset',0,1000000,true),limit=finiteNumber(v.limit??20,'export page size',1,20,true)
 if(operation==='works'){closed(v,['operation','projectId','includeArchived','offset','limit']);if(v.includeArchived!==undefined&&typeof v.includeArchived!=='boolean')throw new TypeError('Invalid archive filter.');return {operation,...(v.projectId===undefined?{}:{projectId:sourceId(v.projectId)}),includeArchived:v.includeArchived===true,offset,limit}}
 if(operation==='versions'){closed(v,['operation','projectId','workId','artifactId','offset','limit']);if(Boolean(v.workId)===Boolean(v.artifactId))throw new TypeError('Choose work or artifact identity.');return {operation,projectId:sourceId(v.projectId),...(v.workId===undefined?{artifactId:assertArtifactId(v.artifactId)}:{workId:sourceId(v.workId)}),offset,limit}}
 if(operation==='uses'){closed(v,['operation','projectId','exportId','offset','limit']);return {operation,projectId:sourceId(v.projectId),exportId:exportSha(v.exportId),offset,limit}}
 if(operation==='adoptions'){closed(v,['operation','identity','includeArchived','offset','limit']);if(v.includeArchived!==undefined&&typeof v.includeArchived!=='boolean')throw new TypeError('Invalid archive filter.');return {operation,identity:identity(v.identity),includeArchived:v.includeArchived===true,offset,limit}}
 throw new TypeError('Unknown export query. Only read queries are admitted.')
}
const id={type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},artifact={type:'string',maxLength:180},page={offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:20}},identitySchema={type:'object',additionalProperties:false,required:['projectId'],properties:{projectId:id,artifactId:artifact,sourceId:id,acquisitionId:id},oneOf:[{required:['artifactId'],not:{anyOf:[{required:['sourceId']},{required:['acquisitionId']}]}},{required:['sourceId','acquisitionId'],not:{required:['artifactId']}}]}
export const exportsRequestSchema={oneOf:[
 {type:'object',additionalProperties:false,required:['operation'],properties:{operation:{const:'works'},projectId:id,includeArchived:{type:'boolean'},...page}},
 {type:'object',additionalProperties:false,required:['operation','projectId'],properties:{operation:{const:'versions'},projectId:id,workId:id,artifactId:artifact,...page},oneOf:[{required:['workId'],not:{required:['artifactId']}},{required:['artifactId'],not:{required:['workId']}}]},
 {type:'object',additionalProperties:false,required:['operation','projectId','exportId'],properties:{operation:{const:'uses'},projectId:id,exportId:{type:'string',pattern:'^[a-f0-9]{64}$'},...page}},
 {type:'object',additionalProperties:false,required:['operation','identity'],properties:{operation:{const:'adoptions'},identity:identitySchema,includeArchived:{type:'boolean'},...page}}
]}
