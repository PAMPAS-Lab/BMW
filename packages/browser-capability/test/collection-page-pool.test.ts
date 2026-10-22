import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import type {SourceObservation} from '@bmw-agent/media-native/sources'
import {withCollectionPagePool,collectionPageLinksExpression,CollectionPageCleanupError,sameCollectionNavigation} from '../src/collection-page-pool.js'
import type {CollectionPageResult,CollectionPageLane} from '../src/collection-page-pool.js'

const page=(id:string)=>({url:'https://example.com/'+id,source:{bodySelector:'article'}})
function result(url:string):CollectionPageResult {
 const scope={selector:'article',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const}
 const observation:SourceObservation={url,title:'Original',author:null,publishedAt:null,scope,text:'Original',mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null}
 return {observation,links:[],linksTruncated:false}
}
function deferred<T>(){let resolve:(value:T)=>void,reject:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve:resolve!,reject:reject!}}

test('Collection page pool runs exactly 2–3 isolated lanes with bounded admission and closes every lane',async()=>{
 for(const concurrency of [2,3] as const){let active=0,peak=0,created=0,closed=0
  const values=await withCollectionPagePool({concurrency,maxPages:9,guard:()=>{}},()=>{created++;return {visit:async request=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return result(request.url)},close:async()=>{closed++}}},visit=>Promise.all(Array.from({length:9},(_,i)=>visit(page(String(i))))))
  assert.equal(values.length,9);assert.equal(peak,concurrency);assert.equal(created,concurrency);assert.equal(closed,concurrency)
 }
})

test('Collection page pool cancels queued pages and waits for every active lane cleanup before releasing admission',async()=>{
 const controller=new AbortController(),entered=deferred<void>(),cleanup=deferred<void>();let started=0,closing=0,finished=false
 const work=withCollectionPagePool({concurrency:2,maxPages:9,guard:()=>{}},():CollectionPageLane=>({visit:async(_request,signal)=>{if(++started===2)entered.resolve();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))},close:async()=>{closing++;await cleanup.promise}}),async visit=>{await Promise.allSettled([visit(page('a')),visit(page('b')),visit(page('queued'))])},controller.signal)
 const rejected=assert.rejects(work,/user priority/);void work.finally(()=>{finished=true}).catch(()=>{})
 await entered.promise;controller.abort(new Error('user priority'));await new Promise(resolve=>setImmediate(resolve))
 assert.equal(started,2);assert.equal(closing,2);assert.equal(finished,false)
 cleanup.resolve();await rejected;assert.equal(finished,true)
})

test('Collection page pool rejects changed ownership after reads, source tab targets, over-budget work and invalid bounds',async()=>{
 let live=true,closed=0
 const work=withCollectionPagePool({concurrency:2,maxPages:1,guard:()=>{if(!live)throw new Error('lease changed')}},()=>({visit:async request=>{live=false;return result(request.url)},close:async()=>{closed++}}),async visit=>visit(page('a')))
 await assert.rejects(work,/lease changed/);assert.equal(closed,1)
 let reads=0
 await withCollectionPagePool({concurrency:2,maxPages:1,guard:()=>{}},()=>({visit:async request=>{reads++;return result(request.url)},close:async()=>{}}),async visit=>{
  await assert.rejects(visit({url:'file:///private',source:{bodySelector:'article'}}),/Sources require/)
  await assert.rejects(visit({url:'https://example.com',source:{bodySelector:'article',tabId:'user'} as {bodySelector:string}}),/existing tabs/)
  await assert.rejects(visit({url:'https://example.com',source:{bodySelector:'article',operation:'acquire'} as {bodySelector:string}}),/Unexpected collection source field/)
  await visit(page('a'));await assert.rejects(visit(page('b')),/budget exceeded/)
 });assert.equal(reads,1)
 for(const options of [{concurrency:1,maxPages:1},{concurrency:4,maxPages:1},{concurrency:2,maxPages:61}])await assert.rejects(withCollectionPagePool({...options,guard:()=>{}} as {concurrency:2;maxPages:number;guard:()=>void},()=>{throw new Error('must not create')},async()=>{}),/2–3 lanes/)
})

test('Collection page pool isolates ordinary source errors but aborts on cleanup failure and reports explicit recovery',async()=>{
 let closed=0
 const values=await withCollectionPagePool({concurrency:2,maxPages:3,guard:()=>{}},()=>({visit:async request=>{if(request.url.endsWith('/blocked'))throw new Error('source restricted');return result(request.url)},close:async()=>{closed++}}),visit=>Promise.allSettled([visit(page('blocked')),visit(page('ok')),visit(page('later'))]))
 assert.deepEqual(values.map(value=>value.status),['rejected','fulfilled','fulfilled']);assert.equal(closed,2)
 let cleanupCalls=0
 await assert.rejects(withCollectionPagePool({concurrency:2,maxPages:1,guard:()=>{}},()=>({visit:async request=>result(request.url),close:async()=>{cleanupCalls++;throw new Error('renderer still live')}}),async visit=>visit(page('a'))),error=>error instanceof CollectionPageCleanupError&&error.code==='BMW_COLLECTION_PAGE_CLEANUP_FAILED')
 assert.equal(cleanupCalls,1)
})

class ElementFixture {
 parentElement:ElementFixture|null=null
 innerText=''
 excluded=false
 style={display:'block',visibility:'visible',opacity:'1',contentVisibility:'visible'}
 constructor(readonly href='',readonly anchors:ElementFixture[]=[]){this.innerText=href}
 matches(){return Boolean(this.href)}
 querySelectorAll(){return this.anchors}
 getClientRects(){return [{}]}
 closest(){return this.excluded?this:null}
 getAttribute(){return this.href}
}
function links(anchors:ElementFixture[]){const root=new ElementFixture('',anchors);for(const anchor of anchors)anchor.parentElement=root
 const nodes=[{textContent:'Original',parentElement:root}]
 const document={querySelector:()=>null,querySelectorAll:()=>[root],createTreeWalker:()=>{let index=-1;return {nextNode:()=>++index<nodes.length,get currentNode(){return nodes[index]}}}}
 return vm.runInNewContext(collectionPageLinksExpression({bodySelector:'article',excludeSelectors:['.ad']}),{document,Element:ElementFixture,NodeFilter:{SHOW_TEXT:4},getComputedStyle:(element:ElementFixture)=>element.style,location:{href:'https://example.com/entry'},URL},{timeout:1000}) as {links:{url:string;text:string}[];linksTruncated:boolean;text:string}
}
test('Collection link discovery uses only visible scoped HTTP links, normalizes fragments and reports its bounded range',()=>{
 const hidden=new ElementFixture('/hidden');hidden.style.opacity='0'
 const promotion=new ElementFixture('/ad');promotion.excluded=true
 const found=links([new ElementFixture('/story#one'),new ElementFixture('/story#two'),new ElementFixture('javascript:alert(1)'),new ElementFixture('https://user:password@example.com/private'),hidden,promotion,new ElementFixture('https://other.example/news')])
 assert.deepEqual(Array.from(found.links,link=>link.url),['https://example.com/story','https://other.example/news']);assert.equal(found.text,'Original');assert.equal(found.linksTruncated,false)
 const bounded=links(Array.from({length:101},(_,i)=>new ElementFixture('/story/'+i)));assert.equal(bounded.links.length,100);assert.equal(bounded.linksTruncated,true)
 const nodeBounded=links(Array.from({length:2001},()=>new ElementFixture('javascript:ignored')));assert.equal(nodeBounded.links.length,0);assert.equal(nodeBounded.linksTruncated,true)
})

test('Collection navigation equivalence permits theme refresh and query serialization while preserving video, origin and remaining query identity',()=>{
 const watch='https://www.youtube.com/watch?v=originalVideo&list=originalList'
 for(const actual of [watch,watch+'&themeRefresh=1','https://www.youtube.com/watch?themeRefresh=99&list=originalList&v=originalVideo'])assert.equal(sameCollectionNavigation(watch,actual),true,actual)
 assert.equal(sameCollectionNavigation(watch+'&themeRefresh=old',watch),true)
 assert.equal(sameCollectionNavigation('https://www.youtube.com/results?search_query=artificial%20intelligence','https://www.youtube.com/results?themeRefresh=1&search_query=artificial+intelligence'),true)
 for(const actual of [
  'https://www.youtube.com/watch?v=differentVideo&list=originalList&themeRefresh=1',
  'https://www.youtube.com/watch?v=originalVideo&list=differentList',
  'https://www.youtube.com/watch?v=originalVideo&list=originalList&feature=share',
  'https://www.youtube.com/watch/?v=originalVideo&list=originalList',
  'https://m.youtube.com/watch?v=originalVideo&list=originalList',
  'https://example.org/watch?v=originalVideo&list=originalList',
  'http://www.youtube.com/watch?v=originalVideo&list=originalList',
  'https://www.youtube.com/watch?v=originalVideo&list=originalList&ThemeRefresh=1',
  'https://user:secret@www.youtube.com/watch?v=originalVideo&list=originalList',
  'file:///tmp/watch?v=originalVideo&list=originalList','not a URL'
 ])assert.equal(sameCollectionNavigation(watch,actual),false,actual)
 assert.equal(sameCollectionNavigation('https://www.youtube.com/results?search_query=AI%2Bnews','https://www.youtube.com/results?search_query=AI+news'),false,'Literal plus and query spaces must remain distinct')
})
