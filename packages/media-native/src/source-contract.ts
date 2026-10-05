import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'
export const SOURCE_LIMITS=Object.freeze({records:200,acquisitions:1000,candidates:80,attempts:40,textBytes:256*1024,indexBytes:4*1024*1024})
export interface SourceScope {selector:string;index:number;excludeSelectors:string[];characterUnit:'utf16';extraction:'visible-text-nodes';truncated:boolean;status:'observed'|'element-not-found'|'failed'}
export interface SourceCaptureGuard {pageUrl:string;candidateUrl:string;scope:SourceScope}
export interface SourceCaptureEvidence extends SourceCaptureGuard {kind:'video-element';selector:string;index:number;fromStart:boolean;sourceStartSeconds:number;sourceEndSeconds:number;sourceDurationSeconds:number|null;stopReason:'ended'|'maximum-duration'|'requested';startedAt:string;endedAt:string}
export function assertSourceCaptureGuard(raw:unknown):SourceCaptureGuard{const v=mediaRecord(raw);closed(v,['pageUrl','candidateUrl','scope']);const scope=assertSourceScope(v.scope);if(scope.status!=='observed')throw new TypeError('Source video capture requires an observed media range.');return {pageUrl:sourceUrl(v.pageUrl),candidateUrl:sourceUrl(v.candidateUrl,true),scope}}
export function assertSourceCaptureEvidence(raw:unknown):SourceCaptureEvidence{const v=mediaRecord(raw);closed(v,['kind','pageUrl','candidateUrl','scope','selector','index','fromStart','sourceStartSeconds','sourceEndSeconds','sourceDurationSeconds','stopReason','startedAt','endedAt']);if(v.kind!=='video-element'||typeof v.fromStart!=='boolean')throw new TypeError('Invalid source video capture evidence.');const guard=assertSourceCaptureGuard({pageUrl:v.pageUrl,candidateUrl:v.candidateUrl,scope:v.scope}),sourceStartSeconds=finiteNumber(v.sourceStartSeconds,'capture source start',0,86400),sourceEndSeconds=finiteNumber(v.sourceEndSeconds,'capture source end',sourceStartSeconds+.000001,86400),sourceDurationSeconds=v.sourceDurationSeconds===null?null:finiteNumber(v.sourceDurationSeconds,'capture source duration',.001,86400);if(sourceDurationSeconds!==null&&sourceEndSeconds>sourceDurationSeconds+.25)throw new TypeError('Captured source range exceeds its observed duration.');return {...guard,kind:'video-element',selector:sourceText(v.selector,'video selector',500),index:finiteNumber(v.index,'video index',0,10000,true),fromStart:v.fromStart,sourceStartSeconds,sourceEndSeconds,sourceDurationSeconds,stopReason:choice(v.stopReason,['ended','maximum-duration','requested']),startedAt:sourceText(v.startedAt,'capture start date',40),endedAt:sourceText(v.endedAt,'capture end date',40)}}
export interface SourceCandidate {id:string;kind:'image'|'poster'|'video'|'source';url:string;durationSeconds:number|null;role:'body'|'cover'|'video'}
export type SourceResult='observed'|'truncated'|'missing-range'|'login-required'|'failed'|'navigated'
export interface SourceObservation {url:string;title:string;author:string|null;publishedAt:string|null;scope:SourceScope;text:string;mediaScope:SourceScope;mediaTruncated:boolean;candidates:Omit<SourceCandidate,'id'>[];access:'unknown'|'preview'|'login-required';accessText:string;result:SourceResult;error:string|null}
export type SourceMediaState='image-decoded'|'completed-decoded'|'decoded-file'|'partial-preview'|'failed'|'cancelled'|'login-required'
export interface SourceMedia {id:string;candidateId:string;state:SourceMediaState;artifactId:string|null;contentId:string|null;proofArtifactId:string|null;proofContentId?:string|null;capture?:SourceCaptureEvidence|null;bytes:number;startSeconds:number|null;endSeconds:number|null;expectedDurationSeconds:number|null;capturedAt:string;error:string|null}
export type SourceArtifactStatus='verified'|'missing'|'changed'|'invalid'|'not-acquired'|'unrecorded'|'budget-exceeded'
export interface SourceMediaAvailability {mediaId:string;artifactStatus:SourceArtifactStatus;proofStatus:SourceArtifactStatus;available:boolean;checkedAt:string}
export function assertSourceMediaAvailability(raw:unknown):SourceMediaAvailability[]{
 if(!Array.isArray(raw)||raw.length>SOURCE_LIMITS.attempts)throw new TypeError('Invalid source media availability.')
 const ids=new Set<string>();return raw.map(raw=>{const v=mediaRecord(raw);closed(v,['mediaId','artifactStatus','proofStatus','available','checkedAt']);const mediaId=sourceId(v.mediaId);if(ids.has(mediaId))throw new TypeError('Duplicate source availability.');ids.add(mediaId);const artifactStatus=choice(v.artifactStatus,['verified','missing','changed','invalid','not-acquired','unrecorded','budget-exceeded']),proofStatus=choice(v.proofStatus,['verified','missing','changed','invalid','not-acquired','unrecorded','budget-exceeded']);if(v.available!==(artifactStatus==='verified'&&proofStatus==='verified'))throw new TypeError('Invalid current source availability.');return {mediaId,artifactStatus,proofStatus,available:v.available as boolean,checkedAt:sourceText(v.checkedAt,'verification time',40)}})
}
export interface SourceAcquisition {id:string;capturedAt:string;title:string;author:string|null;publishedAt:string|null;eventAt:string|null;eventTimeOrigin:'unknown'|'user-declared';scope:SourceScope;mediaScope:SourceScope;mediaTruncated:boolean;originalTextArtifactId:string|null;contentId:string|null;result:SourceResult;error:string|null;access:'unknown'|'preview'|'login-required';accessText:string;candidates:SourceCandidate[];confirmedCandidateIds:string[];media:SourceMedia[]}
export interface ProjectSource {id:string;url:string;acquisitions:SourceAcquisition[]}
export interface SourceCatalog {version:1;projectId:string;revision:number;sources:ProjectSource[]}
export interface SourceCitation {sourceId:string;acquisitionId:string;startCharacter:number;endCharacter:number;quote:string;kind:'fact'|'opinion';claim:string;conflict:'pending'|'conflicting';eventAt:string|null}
export interface SourceCollection {bodySelector:string;index?:number;excludeSelectors?:string[];mediaSelector?:string;mediaIndex?:number;mediaExcludeSelectors?:string[];authorSelector?:string;publishedSelector?:string;accessSelector?:string;tabId?:string}
export type SourceRequest=
 | {operation:'list'}
 | {operation:'read';sourceId:string;acquisitionId:string}
 | ({operation:'collect';expectedRevision:number}&SourceCollection)
 | {operation:'confirm';expectedRevision:number;sourceId:string;acquisitionId:string;candidateIds:string[];eventAt?:string|null}
 | {operation:'acquire';expectedRevision:number;sourceId:string;acquisitionId:string;candidateId:string;method:'download'|'capture';tabId?:string;videoSelector?:string;videoIndex?:number;maxDurationMs?:number}
export interface ProjectSourcePort {
 snapshot():SourceCatalog
 collect(observation:unknown,expectedRevision:number,signal?:AbortSignal):Promise<{catalog:SourceCatalog;sourceId:string;acquisitionId:string}>
 readBody(sourceId:string,acquisitionId:string,signal?:AbortSignal):Promise<{source:ProjectSource;acquisition:SourceAcquisition;text:string;mediaAvailability:SourceMediaAvailability[]}>
 confirm(request:Extract<SourceRequest,{operation:'confirm'}>):SourceCatalog
 recordMedia(sourceId:string,acquisitionId:string,candidateId:string,receipt:{state:SourceMediaState;artifactId?:string;contentId?:string;startSeconds?:number;endSeconds?:number;proof?:unknown;capture?:SourceCaptureEvidence;error?:string},expectedRevision:number,signal?:AbortSignal):Promise<SourceCatalog>
}
function closed(v:Record<string,unknown>,keys:readonly string[]):void{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('Unsupported source field.')}
export function sourceText(v:unknown,name:string,max:number):string{if(typeof v!=='string'||v.length>max||v.includes('\0'))throw new TypeError('Invalid source '+name);return v}
export function sourceId(v:unknown):string{const id=sourceText(v,'ID',80);if(!/^[a-zA-Z0-9-]+$/.test(id))throw new TypeError('Invalid source ID.');return id}
function nullable(v:unknown,name:string,max:number):string|null{return v===null?null:sourceText(v,name,max)}
function choice<T extends string>(v:unknown,values:readonly T[]):T{if(!values.includes(v as T))throw new TypeError('Invalid source enum.');return v as T}
export function sourceUrl(v:unknown,media=false):string{const u=new URL(sourceText(v,'URL',4096));if(u.username||u.password||!(media?['http:','https:','blob:']:['http:','https:']).includes(u.protocol))throw new TypeError('Sources require a public page/media URL.');u.hash='';return u.href}
export function assertSourceScope(raw:unknown):SourceScope {
 const v=mediaRecord(raw);closed(v,['selector','index','excludeSelectors','characterUnit','extraction','truncated','status'])
 const selector=sourceText(v.selector,'selector',500);if(!selector.trim())throw new TypeError('Choose a source body selector.')
 if(!Array.isArray(v.excludeSelectors)||v.excludeSelectors.length>16)throw new TypeError('Source exclusion budget exceeded.')
 const excludes=v.excludeSelectors.map(e=>{const text=sourceText(e,'exclusion',500);if(!text.trim())throw new TypeError('Empty source exclusion.');return text})
 if(v.characterUnit!=='utf16'||v.extraction!=='visible-text-nodes'||typeof v.truncated!=='boolean')throw new TypeError('Invalid source extraction domain.')
 return {selector,index:finiteNumber(v.index,'source index',0,10000,true),excludeSelectors:excludes,characterUnit:'utf16',extraction:'visible-text-nodes',truncated:v.truncated,status:choice(v.status,['observed','element-not-found','failed'])}
}
export function assertSourceCandidate(raw:unknown,withId=true):SourceCandidate {
 const v=mediaRecord(raw);closed(v,withId?['id','kind','url','durationSeconds','role']:['kind','url','durationSeconds','role'])
 return {id:withId?sourceId(v.id):'',kind:choice(v.kind,['image','poster','video','source']),url:sourceUrl(v.url,true),durationSeconds:v.durationSeconds===null?null:finiteNumber(v.durationSeconds,'candidate duration',.001,86400),role:choice(v.role,['body','cover','video'])}
}
export function assertSourceObservation(raw:unknown):SourceObservation{
 const v=mediaRecord(raw);closed(v,['url','title','author','publishedAt','scope','text','mediaScope','mediaTruncated','candidates','access','accessText','result','error'])
 if(!Array.isArray(v.candidates)||v.candidates.length>SOURCE_LIMITS.candidates||typeof v.mediaTruncated!=='boolean')throw new TypeError('Source candidate budget exceeded.')
 return {url:sourceUrl(v.url),title:sourceText(v.title,'title',500),author:nullable(v.author,'author',280),publishedAt:nullable(v.publishedAt,'publication date',80),scope:assertSourceScope(v.scope),text:sourceText(v.text,'body',50000),mediaScope:assertSourceScope(v.mediaScope),mediaTruncated:v.mediaTruncated,candidates:v.candidates.map(c=>{const {id,...candidate}=assertSourceCandidate(c,false);return candidate}),access:choice(v.access,['unknown','preview','login-required']),accessText:sourceText(v.accessText,'access evidence',500),result:choice(v.result,['observed','truncated','missing-range','login-required','failed','navigated']),error:nullable(v.error,'error',2000)}
}
export function assertSourceRequest(raw:unknown):SourceRequest {
 const v=mediaRecord(raw),operation=choice(v.operation,['list','read','collect','confirm','acquire'])
 const allowed={list:['operation'],read:['operation','sourceId','acquisitionId'],collect:['operation','expectedRevision','tabId','bodySelector','index','excludeSelectors','mediaSelector','mediaIndex','mediaExcludeSelectors','authorSelector','publishedSelector','accessSelector'],confirm:['operation','expectedRevision','sourceId','acquisitionId','candidateIds','eventAt'],acquire:['operation','expectedRevision','sourceId','acquisitionId','candidateId','method','tabId','videoSelector','videoIndex','maxDurationMs']}[operation];closed(v,allowed)
 const r={operation} as Record<string,unknown>
 if(operation==='list')return r as unknown as SourceRequest
 if(operation!=='read')r.expectedRevision=finiteNumber(v.expectedRevision,'source revision',0,1000000,true)
 if(operation!=='collect'){r.sourceId=sourceId(v.sourceId);r.acquisitionId=sourceId(v.acquisitionId)}
 for(const k of ['bodySelector','mediaSelector','authorSelector','publishedSelector','accessSelector','videoSelector'] as const)if(v[k]!==undefined){r[k]=sourceText(v[k],k,500);if(!(r[k] as string).trim())throw new TypeError('Empty source selector.')}
 for(const k of ['index','mediaIndex','videoIndex'] as const)if(v[k]!==undefined)r[k]=finiteNumber(v[k],k,0,10000,true)
 for(const k of ['excludeSelectors','mediaExcludeSelectors'] as const)if(v[k]!==undefined){if(!Array.isArray(v[k])||v[k].length>16)throw new TypeError('Source exclusions budget exceeded.');r[k]=v[k].map(e=>sourceText(e,'exclusion',500))}
 if(v.tabId!==undefined)r.tabId=sourceId(v.tabId)
 if(operation==='collect'&&!r.bodySelector)throw new TypeError('Source collection requires an explicit body selector.')
 if(operation==='confirm'){if(!Array.isArray(v.candidateIds)||v.candidateIds.length>80)throw new TypeError('Choose bounded source candidates.');r.candidateIds=[...new Set(v.candidateIds.map(sourceId))];if(v.eventAt!==undefined)r.eventAt=nullable(v.eventAt,'event date',80)}
 if(operation==='acquire'){r.candidateId=sourceId(v.candidateId);r.method=choice(v.method,['download','capture']);if(r.method==='download'&&['videoSelector','videoIndex','maxDurationMs'].some(key=>v[key]!==undefined))throw new TypeError('Capture options require method capture.');if(v.maxDurationMs!==undefined)r.maxDurationMs=finiteNumber(v.maxDurationMs,'capture duration',1000,1800000,true);if(r.method==='capture'&&!r.videoSelector)throw new TypeError('Capture needs a confirmed video element selector.')}
 return r as unknown as SourceRequest
}
export function assertSourceCitation(raw:unknown):SourceCitation {
 const v=mediaRecord(raw);closed(v,['sourceId','acquisitionId','startCharacter','endCharacter','quote','kind','claim','conflict','eventAt'])
 const startCharacter=finiteNumber(v.startCharacter,'quote start',0,50000,true),endCharacter=finiteNumber(v.endCharacter,'quote end',startCharacter+1,50000,true),quote=sourceText(v.quote,'quote',4000)
 if(!quote||quote.length!==endCharacter-startCharacter)throw new TypeError('Quote does not match its UTF16 range.')
 return {sourceId:sourceId(v.sourceId),acquisitionId:sourceId(v.acquisitionId),startCharacter,endCharacter,quote,kind:choice(v.kind,['fact','opinion']),claim:sourceText(v.claim,'claim',2000),conflict:choice(v.conflict,['pending','conflicting']),eventAt:nullable(v.eventAt,'event time',80)}
}
export function assertSourceCatalog(raw:unknown):SourceCatalog {
 const v=mediaRecord(raw);closed(v,['version','projectId','revision','sources'])
 if(v.version!==1||!Array.isArray(v.sources)||v.sources.length>SOURCE_LIMITS.records)throw new TypeError('Invalid Project source catalog.')
 let count=0;const identities=new Set<string>(),acquisitionIds=new Set<string>()
 const sources=v.sources.map(raw=>{const s=mediaRecord(raw);closed(s,['id','url','acquisitions']);const id=sourceId(s.id);if(identities.has(id)||!Array.isArray(s.acquisitions))throw new TypeError('Duplicate/invalid source.');identities.add(id)
  const acquisitions=s.acquisitions.map(raw=>{const a=mediaRecord(raw);closed(a,['id','capturedAt','title','author','publishedAt','eventAt','eventTimeOrigin','scope','mediaScope','mediaTruncated','originalTextArtifactId','contentId','result','error','access','accessText','candidates','confirmedCandidateIds','media'])
   const aid=sourceId(a.id);if(acquisitionIds.has(aid)||++count>SOURCE_LIMITS.acquisitions)throw new TypeError('Source acquisition budget/identity exceeded.');acquisitionIds.add(aid)
   const observed=assertSourceObservation({url:s.url,title:a.title,author:a.author,publishedAt:a.publishedAt,scope:a.scope,text:'',mediaScope:a.mediaScope,mediaTruncated:a.mediaTruncated,candidates:[],access:a.access,accessText:a.accessText,result:a.result,error:a.error})
   if(!Array.isArray(a.candidates)||a.candidates.length>80||!Array.isArray(a.confirmedCandidateIds)||!Array.isArray(a.media)||a.media.length>SOURCE_LIMITS.attempts)throw new TypeError('Source candidate/media budget exceeded.')
   const candidates=a.candidates.map(c=>assertSourceCandidate(c)),ids=new Set(candidates.map(c=>c.id));if(ids.size!==candidates.length)throw new TypeError('Duplicate source candidate.')
   const confirmedCandidateIds=a.confirmedCandidateIds.map(sourceId);if(confirmedCandidateIds.some(id=>!ids.has(id)))throw new TypeError('Foreign confirmed source candidate.')
   const mediaIds=new Set<string>();const media=a.media.map(raw=>{const m=mediaRecord(raw);closed(m,['id','candidateId','state','artifactId','contentId','proofArtifactId','proofContentId','capture','bytes','startSeconds','endSeconds','expectedDurationSeconds','capturedAt','error']);const candidateId=sourceId(m.candidateId);if(!ids.has(candidateId))throw new TypeError('Foreign source media.');const state=choice(m.state,['image-decoded','completed-decoded','decoded-file','partial-preview','failed','cancelled','login-required']);const artifactId=m.artifactId===null?null:assertArtifactId(m.artifactId),contentId=m.contentId===null?null:sourceText(m.contentId,'content hash',64),proofArtifactId=m.proofArtifactId===null?null:assertArtifactId(m.proofArtifactId)
    const proofContentId=m.proofContentId==null?null:sourceText(m.proofContentId,'proof hash',64);if(proofContentId&&(!proofArtifactId||!/^[a-f0-9]{64}$/.test(proofContentId)))throw new TypeError('Invalid media proof hash.');
    if(contentId&&!/^[a-f0-9]{64}$/.test(contentId))throw new TypeError('Invalid media content hash.');
    if(['image-decoded','completed-decoded','decoded-file','partial-preview'].includes(state)&&(!artifactId||!contentId||!proofArtifactId||!confirmedCandidateIds.includes(candidateId)))throw new TypeError('Source media lacks acquisition/decode evidence.')
    const startSeconds=m.startSeconds===null?null:finiteNumber(m.startSeconds,'media range start',0,1800),endSeconds=m.endSeconds===null?null:finiteNumber(m.endSeconds,'media range end',startSeconds??0,1800)
    const mediaId=sourceId(m.id);if(mediaIds.has(mediaId))throw new TypeError('Duplicate source media ID.');mediaIds.add(mediaId);const capture=m.capture==null?null:assertSourceCaptureEvidence(m.capture);if(capture&&(capture.pageUrl!==sourceUrl(s.url)||capture.candidateUrl!==candidates.find(candidate=>candidate.id===candidateId)!.url||JSON.stringify(capture.scope)!==JSON.stringify(observed.mediaScope)||!['decoded-file','partial-preview'].includes(state)||capture.stopReason!=='ended'&&state!=='partial-preview'))throw new TypeError('Stored capture evidence contradicts its source acquisition.');return {id:mediaId,candidateId,state,artifactId,contentId,proofArtifactId,proofContentId,capture,bytes:finiteNumber(m.bytes,'source bytes',0,512*1024*1024,true),startSeconds,endSeconds,expectedDurationSeconds:m.expectedDurationSeconds===null?null:finiteNumber(m.expectedDurationSeconds,'expected duration',.001,86400),capturedAt:sourceText(m.capturedAt,'acquisition date',40),error:nullable(m.error,'media error',2000)}
   })
   const originalTextArtifactId=a.originalTextArtifactId===null?null:assertArtifactId(a.originalTextArtifactId),contentId=a.contentId===null?null:sourceText(a.contentId,'body hash',64)
   if(Boolean(originalTextArtifactId)!==Boolean(contentId)||contentId&&!/^[a-f0-9]{64}$/.test(contentId))throw new TypeError('Invalid source text identity.')
   return {id:aid,capturedAt:sourceText(a.capturedAt,'capture date',40),title:observed.title,author:observed.author,publishedAt:observed.publishedAt,eventAt:nullable(a.eventAt,'event date',80),eventTimeOrigin:choice(a.eventTimeOrigin,['unknown','user-declared']),scope:observed.scope,mediaScope:observed.mediaScope,mediaTruncated:observed.mediaTruncated,originalTextArtifactId,contentId,result:observed.result,error:observed.error,access:observed.access,accessText:observed.accessText,candidates,confirmedCandidateIds,media} as SourceAcquisition
  });return {id,url:sourceUrl(s.url),acquisitions}
 })
 return {version:1,projectId:sourceId(v.projectId),revision:finiteNumber(v.revision,'source revision',0,1000000,true),sources}
}

const sourceIdentitySchema={type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'}
const selectorSchema={type:'string',minLength:1,maxLength:500}
const exclusionSchema={type:'array',maxItems:16,items:selectorSchema}
export const sourceRequestSchema={type:'object',additionalProperties:false,required:['operation'],properties:{
 operation:{type:'string',enum:['list','read','collect','confirm','acquire']},expectedRevision:{type:'integer',minimum:0,maximum:1000000},sourceId:sourceIdentitySchema,acquisitionId:sourceIdentitySchema,tabId:sourceIdentitySchema,
 bodySelector:selectorSchema,index:{type:'integer',minimum:0,maximum:10000},excludeSelectors:exclusionSchema,mediaSelector:selectorSchema,mediaIndex:{type:'integer',minimum:0,maximum:10000},mediaExcludeSelectors:exclusionSchema,authorSelector:selectorSchema,publishedSelector:selectorSchema,accessSelector:selectorSchema,candidateId:sourceIdentitySchema,method:{type:'string',enum:['download','capture']},videoSelector:selectorSchema,videoIndex:{type:'integer',minimum:0,maximum:10000},maxDurationMs:{type:'integer',minimum:1000,maximum:1800000},candidateIds:{type:'array',maxItems:80,uniqueItems:true,items:sourceIdentitySchema},eventAt:{type:['string','null'],maxLength:80}
}}
export const sourceCitationSchema={type:'object',additionalProperties:false,required:['sourceId','acquisitionId','startCharacter','endCharacter','quote','kind','claim','conflict','eventAt'],properties:{sourceId:sourceIdentitySchema,acquisitionId:sourceIdentitySchema,startCharacter:{type:'integer',minimum:0,maximum:50000},endCharacter:{type:'integer',minimum:1,maximum:50000},quote:{type:'string',minLength:1,maxLength:4000},kind:{type:'string',enum:['fact','opinion']},claim:{type:'string',maxLength:2000},conflict:{type:'string',enum:['pending','conflicting']},eventAt:{type:['string','null'],maxLength:80}}}
