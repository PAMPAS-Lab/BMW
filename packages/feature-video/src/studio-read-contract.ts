import {finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
export const SCENE_SECTIONS=['content','card','captions','speech','visuals','reviews','timeline','sources'] as const
export interface StudioAssetQuery {kind?:'image'|'video'|'audio'|'text';query?:string;includeReviewArtifacts?:boolean;offset:number;limit:number}
export function assertAssetQuery(raw:unknown):StudioAssetQuery {
 const v=mediaRecord(raw??{});if(Object.keys(v).some(k=>!['kind','query','includeReviewArtifacts','offset','limit'].includes(k)))throw new TypeError('Unsupported asset query.')
 if(v.kind!==undefined&&!['image','video','audio','text'].includes(String(v.kind)))throw new TypeError('Invalid asset kind filter.')
 if(v.query!==undefined&&(typeof v.query!=='string'||v.query.length>120||v.query.includes('\0')))throw new TypeError('Invalid asset name query.')
 if(v.includeReviewArtifacts!==undefined&&typeof v.includeReviewArtifacts!=='boolean')throw new TypeError('Invalid review artifact filter.')
 return {...(v.kind===undefined?{}:{kind:v.kind as StudioAssetQuery['kind']}),...(v.query===undefined?{}:{query:v.query as string}),...(v.includeReviewArtifacts===undefined?{}:{includeReviewArtifacts:v.includeReviewArtifacts as boolean}),offset:finiteNumber(v.offset??0,'asset offset',0,100000,true),limit:finiteNumber(v.limit??20,'asset limit',1,50,true)}
}
export const assetQuerySchema={type:'object',additionalProperties:false,properties:{kind:{enum:['image','video','audio','text']},query:{type:'string',maxLength:120},includeReviewArtifacts:{type:'boolean',description:'Default false: omit names matching native review-frame and video report patterns; this is filename grouping, not semantic provenance.'},offset:{type:'integer',minimum:0,maximum:100000},limit:{type:'integer',minimum:1,maximum:50}}}
/** Return whole records, never cut serialized JSON or a record's identifiers. */
export function studioPage<T>(items:readonly T[],offset=0,limit=20,budget=10000):{items:T[];total:number;offset:number;nextOffset:number|null} {
 const page:T[]=[];let bytes=0
 for(const item of items.slice(offset,offset+limit)){const size=Buffer.byteLength(JSON.stringify(item));if(page.length&&bytes+size>budget)break;if(size>budget)throw new Error('STUDIO_RESULT_BUDGET: Choose a narrower scene section or source text range.');page.push(item);bytes+=size}
 const next=offset+page.length;return {items:page,total:items.length,offset,nextOffset:next<items.length?next:null}
}
