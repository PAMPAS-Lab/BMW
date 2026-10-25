import {mediaRecord,finiteNumber} from './media-contract.js'

export const TEXT_READ_LIMITS=Object.freeze({rows:60,links:100,diagnosticBytes:12000,batchBytes:2*1024*1024})
export type TextReadState='pending'|'read'|'restricted'|'incomplete'|'failed'
export interface TextReadLink {url:string;text:string}
export interface TextReadNavigation {phase:'stop'|'complete';reason:'dom-ready'|'load'|'deadline'|'cancelled'|'snapshot'|'failure';elapsedMs:number;at:number}
export interface TextReadNetwork {type:'response'|'failed';url:string;resourceType:string;status?:number;errorText?:string;canceled?:boolean;blockedReason?:string;requestId?:string;at:number}
export interface TextReadDiagnostic {
 documentTransfer?:{url:string;status:number;receivedBytes:number;lastDataAt:number;completed:boolean;failed:boolean};
 truncated?:boolean;rendererFailure?:{code:string;message:string};at:string;url:string;title:string;documentReadyState:'loading'|'interactive'|'complete'|'unknown';bodyTextCharacters:number;visiblePosts:number;matchingPostLinks:number;contentState:'posts'|'loading'|'error'|'restricted'|'empty'|'unknown'|'missing-account'|'empty-account'|'header-only';mainDocumentStatus:number|null;navigation:TextReadNavigation[];network:TextReadNetwork[];pending:{url:string;resourceType:string}[]
}
import {assertDiscoveryLeads} from '../../agent-contract/src/discovery-contract.js'
import type {DiscoveryLead} from '../../agent-contract/src/discovery-contract.js'
export {assertDiscoveryLeads}
export type {DiscoveryLead}
export interface TextReadRow {index:number;url:string;state:TextReadState;reason?:string;startedAt?:string;readFinishedAt?:string;finishedAt?:string;observedUrl?:string;sourceId?:string;acquisitionId?:string;title?:string;publishedAt?:string|null;links?:TextReadLink[];diagnostic?:TextReadDiagnostic;error?:string;leads?:DiscoveryLead[]}
export interface TextReadBatch {version:1;id:string;projectId:string;revision:number;startedAt:string;finishedAt:string|null;rows:TextReadRow[];cleanupState?:'pending'|'complete'|'quarantined';mode?:'discovery'}
export interface TextReadBatchReceipt {batchId:string;revision:number;sha256:string}
const closed=(v:Record<string,unknown>,keys:readonly string[])=>{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('Unsupported text-read field.')}
const text=(raw:unknown,name:string,max:number,empty=false)=>{if(typeof raw!=='string'||raw.length>max||!empty&&!raw.trim())throw new TypeError('Invalid text-read '+name+'.');return raw}
const choice=<T extends string>(raw:unknown,values:readonly T[]):T=>{if(typeof raw!=='string'||!values.includes(raw as T))throw new TypeError('Invalid text-read enum.');return raw as T}
export const textReadId=(raw:unknown):string=>{const v=text(raw,'identity',80);if(!/^[a-zA-Z0-9-]{1,80}$/.test(v))throw new TypeError('Invalid text-read identity.');return v}
export const textReadRevision=(raw:unknown):number=>finiteNumber(raw,'text-read revision',0,1000000,true)
export const textReadHash=(raw:unknown):string=>{if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))throw new TypeError('Invalid text-read fingerprint.');return raw}

function date(raw:unknown):string {const v=text(raw,'timestamp',40);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)throw new TypeError('Invalid text-read timestamp.');return v}
function url(raw:unknown,diagnostic=false):string {const v=text(raw,'URL',4096,diagnostic);if(diagnostic&&(v===''||v==='about:blank'))return v;let u:URL;try{u=new URL(v)}catch{throw new TypeError('Invalid text-read public URL.')}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new TypeError('Invalid text-read public URL.');if(diagnostic&&(v.includes('?')||v.includes('#')))throw new TypeError('Diagnostic URL must omit query and fragment.');return u.href}
const epoch=(raw:unknown)=>finiteNumber(raw,'diagnostic epoch',0,8640000000000000,true)
const bytes=(raw:unknown)=>new TextEncoder().encode(JSON.stringify(raw)).byteLength
function array(raw:unknown,max:number,name:string):unknown[]{if(!Array.isArray(raw)||raw.length>max)throw new TypeError('Invalid text-read '+name+'.');return raw}
export function assertTextReadDiagnostic(raw:unknown):TextReadDiagnostic {
 const v=mediaRecord(raw);closed(v,['at','url','title','documentReadyState','bodyTextCharacters','visiblePosts','matchingPostLinks','contentState','mainDocumentStatus','navigation','network','pending','truncated','rendererFailure','documentTransfer'])
 if(v.truncated!==undefined&&typeof v.truncated!=='boolean')throw new TypeError('Invalid text-read diagnostic truncation marker.')
 const navigation=array(v.navigation,8,'navigation').map(raw=>{const n=mediaRecord(raw);closed(n,['phase','reason','elapsedMs','at']);return {phase:choice(n.phase,['stop','complete']),reason:choice(n.reason,['dom-ready','load','deadline','cancelled','snapshot','failure']),elapsedMs:finiteNumber(n.elapsedMs,'navigation elapsed',0,86400000),at:epoch(n.at)}})
 const network=array(v.network,30,'network').map(raw=>{const n=mediaRecord(raw);closed(n,['type','url','resourceType','status','errorText','canceled','blockedReason','requestId','at']);if(n.canceled!==undefined&&typeof n.canceled!=='boolean')throw new TypeError('Invalid text-read cancellation flag.');return {type:choice(n.type,['response','failed']),url:url(n.url,true),resourceType:text(n.resourceType,'resource type',80,true),...(n.status===undefined?{}:{status:finiteNumber(n.status,'HTTP status',100,599,true)}),...(n.errorText===undefined?{}:{errorText:text(n.errorText,'network error',500,true)}),...(n.canceled===undefined?{}:{canceled:n.canceled as boolean}),...(n.blockedReason===undefined?{}:{blockedReason:text(n.blockedReason,'blocked reason',100,true)}),...(n.requestId===undefined?{}:{requestId:text(n.requestId,'request identity',100,true)}),at:epoch(n.at)}})
 const pending=array(v.pending,30,'pending requests').map(raw=>{const n=mediaRecord(raw);closed(n,['url','resourceType']);return {url:url(n.url,true),resourceType:text(n.resourceType,'resource type',80,true)}})
 const result:TextReadDiagnostic={at:date(v.at),url:url(v.url,true),title:text(v.title,'diagnostic title',500,true),documentReadyState:choice(v.documentReadyState,['loading','interactive','complete','unknown']),bodyTextCharacters:finiteNumber(v.bodyTextCharacters,'body characters',0,50000,true),visiblePosts:finiteNumber(v.visiblePosts,'visible posts',0,10000,true),matchingPostLinks:finiteNumber(v.matchingPostLinks,'matching post links',0,2000,true),contentState:choice(v.contentState,['posts','loading','error','restricted','empty','unknown','missing-account','empty-account','header-only']),mainDocumentStatus:v.mainDocumentStatus===null?null:finiteNumber(v.mainDocumentStatus,'main HTTP status',100,599,true),navigation,network,pending,...(v.truncated===undefined?{}:{truncated:v.truncated as boolean})}
 if(v.rendererFailure!==undefined){const failure=mediaRecord(v.rendererFailure);closed(failure,['code','message']);result.rendererFailure={code:text(failure.code,'renderer failure code',100),message:text(failure.message,'renderer failure message',500,true)}}
 if(v.documentTransfer!==undefined){const t=mediaRecord(v.documentTransfer);closed(t,['url','status','receivedBytes','lastDataAt','completed','failed']);if(typeof t.completed!=='boolean'||typeof t.failed!=='boolean')throw new TypeError('Invalid document transfer state.');result.documentTransfer={url:url(t.url,true),status:finiteNumber(t.status,'document HTTP status',0,599,true),receivedBytes:finiteNumber(t.receivedBytes,'document bytes',0,50000000,true),lastDataAt:epoch(t.lastDataAt),completed:t.completed,failed:t.failed}}
 if(result.contentState==='posts'&&(result.visiblePosts<1||result.matchingPostLinks<1||result.bodyTextCharacters<1))throw new TypeError('Qualified posts require visible post and link evidence.');
 if(bytes(result)>TEXT_READ_LIMITS.diagnosticBytes)throw new TypeError('Text-read diagnostic exceeds its byte budget.');return result
}
export function assertTextReadRow(raw:unknown):TextReadRow {
 const v=mediaRecord(raw);closed(v,['index','url','state','reason','startedAt','readFinishedAt','finishedAt','observedUrl','sourceId','acquisitionId','title','publishedAt','links','diagnostic','error','leads'])
 const state=choice(v.state,['pending','read','restricted','incomplete','failed']),hasSource=v.sourceId!==undefined,hasAcquisition=v.acquisitionId!==undefined
 if(hasSource!==hasAcquisition||state==='read'&&!hasSource)throw new TypeError('Text-read source/acquisition identities must be paired; read rows require evidence.')
 const links=v.links===undefined?undefined:array(v.links,TEXT_READ_LIMITS.links,'links').map(raw=>{const l=mediaRecord(raw);closed(l,['url','text']);return {url:url(l.url),text:text(l.text,'link text',320,true)}})
 if(links&&new Set(links.map(l=>l.url)).size!==links.length)throw new TypeError('Duplicate text-read link.')
 const result:TextReadRow={index:finiteNumber(v.index,'row index',0,TEXT_READ_LIMITS.rows-1,true),url:url(v.url),state,...(v.reason===undefined?{}:{reason:text(v.reason,'reason',100)}),...(v.startedAt===undefined?{}:{startedAt:date(v.startedAt)}),...(v.readFinishedAt===undefined?{}:{readFinishedAt:date(v.readFinishedAt)}),...(v.finishedAt===undefined?{}:{finishedAt:date(v.finishedAt)}),...(v.observedUrl===undefined?{}:{observedUrl:url(v.observedUrl)}),...(hasSource?{sourceId:textReadId(v.sourceId),acquisitionId:textReadId(v.acquisitionId)}:{}),...(v.title===undefined?{}:{title:text(v.title,'title',500,true)}),...(v.publishedAt===undefined?{}:{publishedAt:v.publishedAt===null?null:text(v.publishedAt,'publication label',200,true)}),...(links?{links}:{}),...(v.diagnostic===undefined?{}:{diagnostic:assertTextReadDiagnostic(v.diagnostic)}),...(v.error===undefined?{}:{error:text(v.error,'error',1000,true)})}
 if(result.state==='read'&&['x.com','twitter.com'].includes(new URL(result.url).hostname)&&result.diagnostic?.contentState!=='posts')throw new TypeError('Social read rows require qualified post diagnostics.');
 if(v.leads!==undefined){result.leads=assertDiscoveryLeads(v.leads,result.url);if(state==='read'&&!result.leads.length)throw new TypeError('Discovery coverage requires actual post excerpts.')}
 if(result.startedAt&&result.readFinishedAt&&result.readFinishedAt<result.startedAt||result.startedAt&&result.finishedAt&&result.finishedAt<result.startedAt||result.readFinishedAt&&result.finishedAt&&result.finishedAt<result.readFinishedAt)throw new TypeError('Text-read row timestamps are out of order.')
 return result
}
export function assertTextReadBatch(raw:unknown):TextReadBatch {
 const v=mediaRecord(raw);closed(v,['version','id','projectId','revision','startedAt','finishedAt','rows','cleanupState','mode']);if(v.version!==1)throw new TypeError('Invalid text-read version.')
 const rows=array(v.rows,TEXT_READ_LIMITS.rows,'rows').map(assertTextReadRow);if(!rows.length||rows.some((r,i)=>r.index!==i)||new Set(rows.map(r=>r.url)).size!==rows.length)throw new TypeError('Text-read rows require unique ordered identities.')
 const result:TextReadBatch={version:1,id:textReadId(v.id),projectId:textReadId(v.projectId),revision:textReadRevision(v.revision),startedAt:date(v.startedAt),finishedAt:v.finishedAt===null?null:date(v.finishedAt),rows,...(v.cleanupState===undefined?{}:{cleanupState:choice(v.cleanupState,['pending','complete','quarantined'])})}
 if(v.mode!==undefined){result.mode=choice(v.mode,['discovery']);if(rows.some(row=>row.state==='read'&&!row.leads?.length))throw new TypeError('Discovery rows require saved leads.')}
 else if(rows.some(row=>row.leads!==undefined))throw new TypeError('Post excerpts require explicit discovery mode.')
 if(result.finishedAt!==null&&result.finishedAt<result.startedAt)throw new TypeError('Text-read batch timestamps are out of order.')
 for(const r of rows)for(const t of [r.startedAt,r.readFinishedAt,r.finishedAt])if(t&&(t<result.startedAt||result.finishedAt!==null&&t>result.finishedAt))throw new TypeError('Text-read row timestamp is outside the batch.')
 if(bytes(result)>TEXT_READ_LIMITS.batchBytes)throw new TypeError('Text-read batch exceeds its byte budget.');return result
}
