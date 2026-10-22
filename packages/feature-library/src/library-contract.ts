import {assertArtifactId, finiteNumber, mediaRecord} from '../../media-native/src/media-contract.js'
import {sourceId} from '../../media-native/src/source-contract.js'
import type {MaterialPurpose} from './material-purpose.js'
import {purpose as assertPurpose} from './material-purpose.js'

export type LibraryKind = 'source' | 'video' | 'image' | 'audio' | 'text'
export interface LibraryIdentity {projectId: string; artifactId?: string; sourceId?: string; acquisitionId?: string}
export interface LibraryMetadata {title: string; description: string; tags: string[]; favorite: boolean}
export interface LibraryEntry extends LibraryIdentity, LibraryMetadata {
  key: string; projectName: string; kind: LibraryKind; bytes: number; modifiedAt: string
  publishedAt?: string | null; url?: string; author?: string | null; archived: boolean
  availability: 'saved' | 'missing' | 'unverified'; role: string;metadataRevision?:number
  purpose?:MaterialPurpose;topicIds?:string[];directionIds?:string[];exportWorkId?:string;exportVersionId?:string;exportCreatedAt?:string;workVersionCount?:number
}
export interface LibraryQuery {query: string; projectId?: string; kind?: LibraryKind; favorites: boolean; includeArchived: boolean; offset: number; limit: number; sort: 'newest' | 'oldest' | 'title'; fromDate?:string;toDate?:string;dateBasis?:'saved'|'published';includeSupportFiles?:boolean;availability?:'saved'|'missing'|'unverified';purpose?:MaterialPurpose;topicId?:string;directionId?:string;groupWorks?:boolean}
export type LibraryRequest =
  | {operation:'recover-copies'}
  | ({operation: 'search'} & LibraryQuery)
  | ({operation: 'read'} & LibraryIdentity)
  | ({operation: 'set-metadata'; expectedRevision: number; metadata: LibraryMetadata} & LibraryIdentity)
  | ({operation: 'copy'; expectedRevision: number} & LibraryIdentity)
export interface LibraryPage {complete?:boolean;sourceContinuations?:{projectId:string;action:'library.streams';streamRequest:{operation:'sources';projectId:string}}[];items: LibraryEntry[]; total: number; nextOffset: number | null; projects: {id: string; name: string; archived: boolean}[]; issues: {projectId: string; message: string}[]}
export interface LibraryPort {execute(request: unknown, actor: 'agent' | 'user', signal?: AbortSignal): Promise<unknown>}
const text = (raw: unknown, maximum: number): string => {if(typeof raw !== 'string' || raw.length > maximum || raw.includes('\0')) throw new TypeError('Invalid library text.'); return raw}
export function libraryKey(identity: LibraryIdentity): string {return identity.projectId + ':' + (identity.artifactId ? 'artifact:' + identity.artifactId : 'source:' + identity.sourceId + ':' + identity.acquisitionId)}
export function assertLibraryIdentity(raw: unknown): LibraryIdentity {
  const v = mediaRecord(raw), projectId = sourceId(v.projectId)
  if (v.artifactId !== undefined) {if(v.sourceId !== undefined || v.acquisitionId !== undefined) throw new TypeError('Choose one library identity.'); return {projectId, artifactId: assertArtifactId(v.artifactId)}}
  return {projectId, sourceId: sourceId(v.sourceId), acquisitionId: sourceId(v.acquisitionId)}
}
export function assertLibraryMetadata(raw: unknown): LibraryMetadata {
  const v = mediaRecord(raw)
  if(Object.keys(v).some(k => !['title','description','tags','favorite'].includes(k)) || !Array.isArray(v.tags) || v.tags.length > 20 || typeof v.favorite !== 'boolean') throw new TypeError('Invalid library metadata.')
  return {title: text(v.title, 120), description: text(v.description, 1000), tags: [...new Set(v.tags.map(t => text(t,32)))], favorite: v.favorite}
}
export function assertLibraryRequest(raw: unknown): LibraryRequest {
  const v = mediaRecord(raw), operation = v.operation
  if(operation==='recover-copies'){if(Object.keys(v).length!==1)throw new TypeError('Unexpected recovery property.');return {operation}}
  const allowed = operation === 'search' ? ['operation','query','projectId','kind','favorites','includeArchived','offset','limit','sort','fromDate','toDate','dateBasis','availability','includeSupportFiles','purpose','topicId','directionId','groupWorks'] : ['operation','projectId','artifactId','sourceId','acquisitionId',...(operation === 'set-metadata' ? ['expectedRevision','metadata'] : operation === 'copy' ? ['expectedRevision'] : [])]
  if(Object.keys(v).some(k => !allowed.includes(k))) throw new TypeError('Unsupported library property.')
  if(operation === 'search') {
    if(v.kind !== undefined && !['source','video','image','audio','text'].includes(String(v.kind)) || v.sort !== undefined && !['newest','oldest','title'].includes(String(v.sort))) throw new TypeError('Invalid library filter.')
    for(const k of ['favorites','includeArchived','includeSupportFiles','groupWorks']) if(v[k] !== undefined && typeof v[k] !== 'boolean') throw new TypeError('Invalid library filter.')
    for(const k of ['fromDate','toDate'])if(v[k]!==undefined&&(typeof v[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v[k] as string)||!Number.isFinite(Date.parse(v[k] as string))||new Date(v[k] as string).toISOString().slice(0,10)!==v[k]))throw new TypeError('Invalid library date.')
    if(v.dateBasis!==undefined&&!['saved','published'].includes(String(v.dateBasis))||v.availability!==undefined&&!['saved','missing','unverified'].includes(String(v.availability))||typeof v.fromDate==='string'&&typeof v.toDate==='string'&&v.fromDate>v.toDate)throw new TypeError('Invalid library filter range.')
    return {operation,...(v.groupWorks===undefined?{}:{groupWorks:v.groupWorks as boolean}),...(v.purpose===undefined?{}:{purpose:assertPurpose(v.purpose)}),...(v.topicId===undefined?{}:{topicId:sourceId(v.topicId)}),...(v.directionId===undefined?{}:{directionId:sourceId(v.directionId)}),includeSupportFiles:v.includeSupportFiles===true,...(v.fromDate?{fromDate:v.fromDate as string}:{}),...(v.toDate?{toDate:v.toDate as string}:{}),...(v.dateBasis?{dateBasis:v.dateBasis as 'saved'|'published'}:{}),...(v.availability?{availability:v.availability as 'saved'|'missing'|'unverified'}:{}), query: text(v.query ?? '',200), ...(v.projectId === undefined ? {} : {projectId: sourceId(v.projectId)}), ...(v.kind === undefined ? {} : {kind: v.kind as LibraryKind}), favorites: v.favorites === true, includeArchived: v.includeArchived === true, offset: finiteNumber(v.offset ?? 0,'library offset',0,1000000,true), limit: finiteNumber(v.limit ?? 30,'library page size',1,50,true), sort: (v.sort ?? 'newest') as LibraryQuery['sort']}
  }
  const identity = assertLibraryIdentity(v)
  if(operation === 'read') return {operation, ...identity}
  if(operation === 'copy') return {operation, ...identity, expectedRevision: finiteNumber(v.expectedRevision,'target source revision',0,1000000,true)}
  if(operation === 'set-metadata') return {operation, ...identity, expectedRevision: finiteNumber(v.expectedRevision,'library revision',0,1000000,true), metadata: assertLibraryMetadata(v.metadata)}
  throw new TypeError('Unknown library operation.')
}
export const libraryRequestSchema = {type:'object', additionalProperties:false, required:['operation'], properties:{groupWorks:{type:'boolean'},purpose:{enum:['unclassified','source','derived','preview','work','support']},topicId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},directionId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},includeSupportFiles:{type:'boolean'},fromDate:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},toDate:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},dateBasis:{enum:['saved','published']},availability:{enum:['saved','missing','unverified']},operation:{enum:['search','read','set-metadata','copy','recover-copies']}, query:{type:'string',maxLength:200}, projectId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'}, artifactId:{type:'string',maxLength:180},sourceId:{type:'string',maxLength:80},acquisitionId:{type:'string',maxLength:80},kind:{enum:['source','video','image','audio','text']},favorites:{type:'boolean'},includeArchived:{type:'boolean'},offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:50},sort:{enum:['newest','oldest','title']},expectedRevision:{type:'integer',minimum:0,maximum:1000000},metadata:{type:'object',additionalProperties:false,required:['title','description','tags','favorite'],properties:{title:{type:'string',maxLength:120},description:{type:'string',maxLength:1000},tags:{type:'array',maxItems:20,items:{type:'string',maxLength:32}},favorite:{type:'boolean'}}}}}
