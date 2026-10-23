import type {SourceCollection,SourceObservation} from '@bmw-agent/media-native/sources'
import {assertPageScope,pageRangeExpression} from './page-scope.js'

/** Host-private inputs. No caller JavaScript, credentials or shared user tab IDs. */
export type CollectionPageSource=Pick<SourceCollection,'bodySelector'|'index'|'excludeSelectors'|'authorSelector'|'publishedSelector'>
export interface CollectionPageRequest {url:string;source:CollectionPageSource;sourceKey?:string}
export interface CollectionPageLink {url:string;text:string}
export interface CollectionPageResult {observation:SourceObservation;links:CollectionPageLink[];linksTruncated:boolean;restricted?:boolean}
export interface CollectionPagePoolOptions {concurrency:2|3;maxPages:number;guard:()=>void}
export type CollectionPageVisit=(request:CollectionPageRequest)=>Promise<CollectionPageResult>
export interface CollectionPageLane {visit(request:CollectionPageRequest,signal:AbortSignal):Promise<CollectionPageResult>;close():Promise<void>}
export class CollectionPageCleanupError extends Error {readonly code='BMW_COLLECTION_PAGE_CLEANUP_FAILED'}

/** Fixed DOM observer over the same explicit body, including offscreen rendered
 * links but excluding hidden/promotion ranges selected by the source adapter. */
export function collectionPageLinksExpression(source:CollectionPageSource):string {
 const scope=assertPageScope({selector:source.bodySelector,index:source.index,excludeSelectors:source.excludeSelectors,maxCharacters:50000})
 return `(()=>{const observed=${pageRangeExpression(scope)};const links=[],seen=new Set();let linksTruncated=false,visited=0;
 if(observed.root){const anchors=[...(observed.root instanceof Element&&observed.root.matches('a[href]')?[observed.root]:[]),...observed.root.querySelectorAll('a[href]')];
 for(const anchor of anchors){if(++visited>2000){linksTruncated=true;break}if(anchor.closest(observed.exclude)||!anchor.getClientRects().length)continue;
 let visible=true,depth=0;for(let parent=anchor;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(++depth>100||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0||style.contentVisibility==='hidden'){visible=false;break}}if(!visible)continue;
 try{const url=new URL(anchor.getAttribute('href'),location.href);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>4096)continue;url.hash='';if(seen.has(url.href))continue;if(links.length>=100){linksTruncated=true;break}seen.add(url.href);links.push({url:url.href,text:String(anchor.innerText??'').trim().slice(0,320)})}catch{}}
 }return {url:location.href,text:observed.text,links,linksTruncated}})()`
}

export function collectionPageUrl(raw:unknown):string{if(typeof raw!=='string'||!raw.trim()||raw.length>4096)throw new Error('Sources require a bounded public page URL');const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Sources require a public HTTP(S) page URL');url.hash='';return url.href}

/** YouTube may replace the same navigation with its own theme refresh. This
 * admits only that query normalization, never a different video/path/origin. */
export function sameCollectionNavigation(requested:string,actual:string):boolean{try{const clean=(raw:string)=>{const url=new URL(collectionPageUrl(raw));url.searchParams.delete('themeRefresh');url.searchParams.sort();return url.href};return clean(requested)===clean(actual)}catch{return false}}

function request(input:CollectionPageRequest):CollectionPageRequest {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['url','source','sourceKey'].includes(key)))throw new Error('Invalid collection page input')
 if(!input.source||typeof input.source!=='object'||Array.isArray(input.source)||Object.hasOwn(input.source,'tabId'))throw new Error('Collection pages cannot target existing tabs')
 if(Object.keys(input.source).some(key=>!['bodySelector','index','excludeSelectors','authorSelector','publishedSelector'].includes(key)))throw new Error('Unexpected collection source field')
 if(typeof input.source.bodySelector!=='string')throw new Error('Collection page requires an explicit bounded body selector')
 const range=assertPageScope({selector:input.source.bodySelector,index:input.source.index,excludeSelectors:input.source.excludeSelectors})
 for(const selector of [input.source.authorSelector,input.source.publishedSelector])if(selector!==undefined)assertPageScope({selector})
 if(input.sourceKey!==undefined&&(typeof input.sourceKey!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(input.sourceKey)))throw new Error('Invalid collection source scope')
 const source:CollectionPageSource={bodySelector:input.source.bodySelector,index:range.index,excludeSelectors:range.excludeSelectors,...(input.source.authorSelector?{authorSelector:input.source.authorSelector}:{}),...(input.source.publishedSelector?{publishedSelector:input.source.publishedSelector}:{})}
 return {url:collectionPageUrl(input.url),source,...(input.sourceKey?{sourceKey:input.sourceKey}:{})}
}

/** Bounded deterministic I/O pool, not an Agent loop. The callback may discover
 * detail URLs from saved entries; all views drain and close before this returns. */
export async function withCollectionPagePool<T>(options:CollectionPagePoolOptions,create:(index:number)=>CollectionPageLane,work:(visit:CollectionPageVisit)=>Promise<T>,signal?:AbortSignal):Promise<T> {
 if(![2,3].includes(options.concurrency)||!Number.isInteger(options.maxPages)||options.maxPages<1||options.maxPages>60||typeof options.guard!=='function')throw new Error('Collection page pool requires 2–3 lanes and 1–60 pages')
 interface Job {input:CollectionPageRequest;resolve:(result:CollectionPageResult)=>void;reject:(error:unknown)=>void}
 interface Slot {lane:CollectionPageLane;busy:boolean}
 const controller=new AbortController(),queue:Job[]=[],slots:Slot[]=[],tasks=new Set<Promise<void>>()
 const restricted=new Set<string>()
 let accepting=true,admitted=0
 const stop=(reason:unknown)=>{controller.abort(reason);for(const job of queue.splice(0))job.reject(controller.signal.reason)}
 const check=()=>{signal?.throwIfAborted();controller.signal.throwIfAborted();try{options.guard()}catch(error){stop(error);throw error}}
 const cancel=()=>stop(signal?.reason??new Error('Collection page batch cancelled'))
 const pump=()=>{
  while(queue.length&&!controller.signal.aborted){
   let slot=slots.find(value=>!value.busy)
   if(!slot&&slots.length<options.concurrency){try{check();slot={lane:create(slots.length),busy:false};slots.push(slot)}catch(error){stop(error);return}}
   if(!slot)return
   const job=queue.shift()!,selected=slot;selected.busy=true
   const task=(async()=>{try{check();if(job.input.sourceKey&&restricted.has(job.input.sourceKey))throw Object.assign(new Error('BMW_COLLECTION_SOURCE_RESTRICTED: Confirmed access wall in this batch; retain queued URL as pending.'),{code:'BMW_COLLECTION_SOURCE_RESTRICTED'});const result=await selected.lane.visit(job.input,controller.signal);check();if(result.restricted&&job.input.sourceKey)restricted.add(job.input.sourceKey);job.resolve(result)}catch(error){job.reject(error);if(error instanceof CollectionPageCleanupError)stop(error)}finally{selected.busy=false}})()
   tasks.add(task);void task.finally(()=>{tasks.delete(task);pump()})
  }
 }
 const visit:CollectionPageVisit=input=>{
  try{check();if(!accepting)throw new Error('Collection page batch ended');const parsed=request(input);if(admitted>=options.maxPages)throw new Error('Collection page budget exceeded');admitted++
   const result=new Promise<CollectionPageResult>((resolve,reject)=>queue.push({input:parsed,resolve,reject}));void result.catch(()=>{});pump();return result
  }catch(error){return Promise.reject(error)}
 }
 signal?.addEventListener('abort',cancel,{once:true})
 let value:T,error:unknown,failed=false
 try{check();value=await work(visit);check()}catch(failure){error=failure;failed=true}
 finally{
  accepting=false
  if(!controller.signal.aborted)controller.abort(new Error('Collection page callback ended'))
  for(const job of queue.splice(0))job.reject(controller.signal.reason)
  await Promise.allSettled([...tasks])
  const cleanup=await Promise.allSettled(slots.map(slot=>slot.lane.close()))
  signal?.removeEventListener('abort',cancel)
  const errors=cleanup.flatMap(result=>result.status==='rejected'?[result.reason]:[])
  if(errors.length){const cleanupError=new CollectionPageCleanupError('Collection page cleanup failed; explicit recovery required');Object.assign(cleanupError,{cause:new AggregateError(errors)});error=cleanupError;failed=true}
 }
 if(failed)throw error
 return value!
}
