import type {TextReadBatch,TextReadBatchReceipt,TextReadRow,ProjectSourcePort} from '@bmw-agent/media-native/sources'
import {discoveryPage} from './hotspot-discovery.js'

export const TEXT_READ_RESPONSE_CHARACTERS=3000
// Leave room for the Host-owned contiguous-delivery receipt on every page.
const PAGE_PAYLOAD_CHARACTERS=2700
export interface TextReadPageRequest {section:'rows'|'text'|'links'|'diagnostics'|'details'|'leads';rowIndex?:number;offset:number;limit?:number}
const fits=(value:unknown,budget=PAGE_PAYLOAD_CHARACTERS)=>JSON.stringify(value).length<=budget
export function textReadSummary(batch:TextReadBatch,receipt:TextReadBatchReceipt){
 const rows=batch.rows,statuses=rows.map(row=>({index:row.index,state:row.state}))
 const result={projectId:batch.projectId,...receipt,cleanupState:batch.cleanupState??'unknown',startedAt:batch.startedAt,finishedAt:batch.finishedAt,elapsedMs:Date.parse(batch.finishedAt??new Date().toISOString())-Date.parse(batch.startedAt),requested:rows.length,read:rows.filter(row=>row.state==='read').length,restricted:rows.filter(row=>row.state==='restricted').length,failed:rows.filter(row=>row.state==='failed').length,incomplete:rows.filter(row=>row.state==='incomplete'||row.state==='pending').length,statuses,next:{action:'pages.read-result',...receipt,section:'rows',offset:0,limit:2},note:'Durable Project checkpoint. All input indexes are present; content, links and diagnostics are read in bounded pages without network access.'}
 if(batch.mode==='discovery')Object.assign(result,{mode:'discovery',fullTextRead:false,next:{...result.next,section:'leads',limit:1},note:'Discovery snapshots only: up to five visible post excerpts per account. Read leads projection; diagnostics remain saved for failures/on-demand. This is not complete feed, full article, verified fact or platform trend coverage.'})
 if(!fits(result,TEXT_READ_RESPONSE_CHARACTERS))throw new Error('Text batch summary exceeded its response budget')
 return result
}

/** Delivery progress is scoped to one Host Session and immutable checkpoint.
 * A tail page cannot certify unread middle ranges. A fresh runtime must start
 * at zero again; replaying an already delivered page remains a safe read. */
export class TextReadPageReader {
 private readonly progress=new Map<string,{through:number;total:number}>()
 async read(scope:string,batch:TextReadBatch,receipt:TextReadBatchReceipt,request:TextReadPageRequest,port:Pick<ProjectSourcePort,'readBody'>,signal?:AbortSignal){
  const key=JSON.stringify([scope,batch.projectId,receipt.batchId,receipt.revision,receipt.sha256,request.section,request.rowIndex??null])
  const prior=this.progress.get(key),through=prior?.through??0
  if(request.offset>through)throw new Error('TEXT_READ_PAGE_ORDER: Unread range; next required offset is '+through+'. Requested '+request.offset+'. Read that offset in this same section and row before continuing.')
  const page=await textReadPage(batch,receipt,request,port,signal)
  signal?.throwIfAborted()
  const value=page as Record<string,unknown>
  const fallback=value.complete===false
  const total=typeof value.total==='number'?value.total:request.section==='diagnostics'?JSON.stringify(batch.rows[request.rowIndex??-1]?.diagnostic??null).length:0
  const end=typeof value.text==='string'?request.offset+value.text.length:Array.isArray(value.items)?request.offset+value.items.length:value.diagnostic!==undefined?total:0
  const nextThrough=Math.max(through,end),complete=!fallback&&nextThrough===total
  const result={...page,coverage:{throughOffset:nextThrough,total,complete,nextRequiredOffset:complete?null:nextThrough},note:fallback?'Read the exact details section; this section has not been fully delivered.':'Coverage certifies contiguous returned ranges for this Session, not semantic understanding.'}
  if(JSON.stringify(result).length>(request.section==='leads'?7000:TEXT_READ_RESPONSE_CHARACTERS))throw new Error('Text-read delivery receipt exceeds its response budget')
  if(prior&&prior.total!==total)throw new Error('TEXT_READ_PAGE_INTEGRITY: Immutable section size changed.')
  this.progress.delete(key);this.progress.set(key,{through:nextThrough,total})
  // Eviction forgets progress and therefore requires a restart at zero; it can
  // never turn an unread tail into a completed section.
  while(this.progress.size>512)this.progress.delete(this.progress.keys().next().value!)
  return result
 }
}
function stringPage(base:Record<string,unknown>,value:string,offset:number){
 if(offset>value.length)throw new Error('Text-read offset exceeds this section')
 let end=Math.min(value.length,offset+1200)
 let result={...base,offset,total:value.length,text:value.slice(offset,end),nextOffset:end<value.length?end:null}
 while(!fits(result)&&end>offset){end=offset+Math.floor((end-offset)/2);result={...result,text:value.slice(offset,end),nextOffset:end<value.length?end:null}}
 if(!fits(result))throw new Error('Text-read response metadata exceeds its budget')
 return result
}
function arrayPage<T>(base:Record<string,unknown>,values:T[],offset:number,limit:number){
 if(offset>values.length)throw new Error('Text-read offset exceeds this section')
 const items:T[]=[];let next=offset
 while(next<values.length&&items.length<limit){const candidate={...base,offset,total:values.length,items:[...items,values[next]],nextOffset:next+1<values.length?next+1:null};if(!fits(candidate))break;items.push(values[next++])}
 if(next===offset&&offset<values.length)throw new Error('One text-read item exceeds the bounded response budget')
 return {...base,offset,total:values.length,items,nextOffset:next<values.length?next:null}
}
/** Reads an immutable checkpoint only. Pagination cannot start navigation or
 * overwrite the source; original text still comes from the verified archive. */
export async function textReadPage(batch:TextReadBatch,receipt:TextReadBatchReceipt,request:TextReadPageRequest,port:Pick<ProjectSourcePort,'readBody'>,signal?:AbortSignal){
 const {section,offset}=request
 if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid text-read offset')
 if(section==='leads')return discoveryPage(batch,receipt,offset)
 const base={projectId:batch.projectId,...receipt,section}
 if(section==='rows'){
  const rows=batch.rows.map(({links,diagnostic,leads,url,observedUrl,title,error,...row})=>({...row,urlPreview:url.slice(0,200),...(url.length<=200?{url}:{}),...(observedUrl?{observedUrlPreview:observedUrl.slice(0,200)}:{}),...(title?{titlePreview:title.slice(0,200)}:{}),...(error?{errorPreview:error.slice(0,200)}:{}),fullDetailsSection:'details'}))
  return arrayPage(base,rows,offset,Math.min(request.limit??2,2))
 }
 const row:TextReadRow|undefined=batch.rows[request.rowIndex??-1]
 if(!row)throw new Error('Text-read section requires a current row index')
 const rowBase={...base,rowIndex:row.index,state:row.state,...(row.sourceId?{sourceId:row.sourceId,acquisitionId:row.acquisitionId}:{})}
 if(section==='details')return stringPage({...rowBase,encoding:'json-fragment'},JSON.stringify(row),offset)
 if(section==='links'){
  try{return arrayPage(rowBase,row.links??[],offset,Math.min(request.limit??2,2))}
  catch(error){if(offset>(row.links??[]).length)throw error;return {...rowBase,offset,total:row.links?.length??0,items:[],complete:false,nextOffset:null,readMore:{action:'pages.read-result',...receipt,section:'details',rowIndex:row.index,offset:0},note:'A link exceeds this response budget; read the exact saved row as paginated JSON details.'}}
 }
 if(section==='diagnostics'){
  if(!row.diagnostic)return {...rowBase,offset:0,total:0,diagnostic:null,nextOffset:null}
  const result={...rowBase,diagnostic:row.diagnostic,nextOffset:null}
  if(offset===0&&fits(result))return result
  return stringPage({...rowBase,encoding:'json-fragment'},JSON.stringify(row.diagnostic),offset)
 }
 if(section!=='text')throw new Error('Unsupported text-read section')
 if(!row.sourceId||!row.acquisitionId)return {...rowBase,offset:0,total:0,text:'',nextOffset:null,note:'No source original was acquired for this row.'}
 const saved=await port.readBody(row.sourceId,row.acquisitionId,signal)
 signal?.throwIfAborted()
 return stringPage({...rowBase,originalComplete:!saved.acquisition.scope.truncated},saved.text,offset)
}
