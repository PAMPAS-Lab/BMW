import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import type {WebContents} from 'electron'
import {collectPageSource} from '../src/collect-page-source.js'
const scope={selector:'article',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const}
function fixture(read:(code:string)=>Promise<unknown>){const events=new EventEmitter();Object.assign(events,{getURL:()=> 'https://example.com/article',getTitle:()=> 'Article',isDestroyed:()=>false,executeJavaScript:read});return {events,wc:events as unknown as WebContents}}
test('Source collection retains scoped originals, unknown dates and candidate-only roles with no global resource admission',async()=>{const f=fixture(async()=>({text:'Original',range:scope}));const result=await collectPageSource(f.wc,{bodySelector:'article',excludeSelectors:['.ad','.avatar']},async request=>{assert.equal(request.selector,'article');assert.deepEqual(request.excludeSelectors,['.ad','.avatar']);return {items:[{kind:'image',url:'https://example.com/body.png'},{kind:'network',url:'https://example.com/avatar.png'},{kind:'poster',url:'https://example.com/cover.png'},{kind:'video',url:'blob:https://example.com/v',duration:30}],range:scope,truncated:false}})
 assert.equal(result.author,null);assert.equal(result.publishedAt,null);assert.equal(result.result,'observed');assert.deepEqual(result.candidates.map(candidate=>candidate.role),['body','cover','video']);assert.equal(f.events.eventNames().length,0)
})
test('Missing source range never invokes media fallback; truncation, visible trial evidence and missing explicit media range remain explicit',async()=>{
 const missing=fixture(async()=>({text:'',range:{...scope,status:'element-not-found'}}));let discovered=false
 const result=await collectPageSource(missing.wc,{bodySelector:'#missing'},async()=>{discovered=true;throw new Error('fallback')});assert.equal(result.result,'missing-range');assert.equal(discovered,false);assert.deepEqual(result.candidates,[])
 const f=fixture(async code=>({text:code.includes('player')?'试看30秒':'bounded original',range:{...scope,truncated:true}}));const preview=await collectPageSource(f.wc,{bodySelector:'article',accessSelector:'.player'},async()=>({items:[],range:scope,truncated:false}));assert.equal(preview.access,'preview');assert.equal(preview.result,'truncated')
 const absent=await collectPageSource(f.wc,{bodySelector:'article',mediaSelector:'#absent'},async()=>{throw new Error('element-not-found')});assert.equal(absent.result,'missing-range');assert.equal(absent.mediaScope.status,'element-not-found')
})
test('Navigation across collection phases yields navigated evidence; cancellation leaves no late candidate admission or listeners',async()=>{
 const f=fixture(async()=>({text:'original',range:scope}));const result=await collectPageSource(f.wc,{bodySelector:'article'},async()=>{f.events.emit('did-start-navigation',{},'https://other.example',false,true);throw new Error('navigated')});assert.equal(result.result,'navigated');assert.deepEqual(result.candidates,[]);assert.equal(f.events.eventNames().length,0)
 let entered:()=>void,complete:(value:unknown)=>void;const started=new Promise<void>(resolve=>entered=resolve),pending=new Promise<unknown>(resolve=>complete=resolve),blocked=fixture(async()=>{entered();return pending}),controller=new AbortController()
 const operation=collectPageSource(blocked.wc,{bodySelector:'article'},async()=>({items:[],range:scope,truncated:false}),controller.signal),rejected=assert.rejects(operation,/cancel source/);await started;controller.abort(new Error('cancel source'));await rejected;complete({text:'late',range:scope});await new Promise(resolve=>setImmediate(resolve));assert.equal(blocked.events.eventNames().length,0)
})

test('Clipped metadata remains explicitly truncated rather than silently admitted as complete author/date evidence',async()=>{
 let count=0;const f=fixture(async()=>{count++;return {text:count===1?'Original':count===2?'a'.repeat(281):'date'.repeat(21),range:scope}})
 const result=await collectPageSource(f.wc,{bodySelector:'article',authorSelector:'.author',publishedSelector:'.date'},async()=>({items:[],range:scope,truncated:false}))
 assert.equal(result.author?.length,280);assert.equal(result.publishedAt?.length,80);assert.equal(result.result,'truncated');assert.match(result.error!,/author, publishedAt/);assert.equal(result.scope.truncated,false)
})
