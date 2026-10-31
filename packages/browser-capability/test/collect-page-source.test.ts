import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import type {WebContents} from 'electron'
import type {SourceScope} from '@bmw-agent/media-native/sources'
import {collectPageSource} from '../src/collect-page-source.js'
const scope={selector:'article',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const}
test('Chinese publication weekday suffix retains the complete witnessed civil date without admitting cropped updates',async()=>{
 for(const date of ['2026-10-26 22:40 星期一','2026年10月26日 周一']){
  const text='科创板最新动态\n'+date+'\n科创板日报记者 李明明',startCharacter=text.indexOf(date)
  const result=await collectPageSource(fixture(async()=>({text,range:scope})).wc,{bodySelector:'article',metadataRanges:{publishedAt:{startCharacter,endCharacter:startCharacter+date.length,quote:date}}},async()=>({items:[],range:scope,truncated:false}))
  assert.equal(result.result,'observed');assert.equal(result.publishedAt,date)
 }
 for(const prefix of ['Updated\n','更新于\n','录制\n','转载\n']){
  const date='2026-10-26 22:40 星期一',text=prefix+date,startCharacter=prefix.length
  const result=await collectPageSource(fixture(async()=>({text,range:scope})).wc,{bodySelector:'article',metadataRanges:{publishedAt:{startCharacter,endCharacter:startCharacter+date.length,quote:date}}},async()=>({items:[],range:scope,truncated:false}))
  assert.equal(result.result,'failed');assert.equal(result.publishedAt,null)
 }
})
test('Published time reads a bounded timezone-bearing TIME datetime while preserving visible date fallback',async()=>{
 let n=0;const f=fixture(async()=>({text:++n===1?'Original':'Oct 18, 2026',range:scope,dateTime:n===2?'2026-10-18T01:00:00Z':null})),result=await collectPageSource(f.wc,{bodySelector:'article',publishedSelector:'time'},async()=>({items:[],range:scope,truncated:false}));assert.equal(result.publishedAt,'2026-10-18T01:00:00Z');assert.equal(result.result,'observed')
 const plain=fixture(async()=>({text:'Oct 18, 2026',range:scope,dateTime:'2026-10-18'})),fallback=await collectPageSource(plain.wc,{bodySelector:'article',publishedSelector:'time'},async()=>({items:[],range:scope,truncated:false}));assert.equal(fallback.publishedAt,'Oct 18, 2026')
})
test('Publication metadata extracts one complete publisher date line beside bylines or document numbers, never ambiguous or truncated dates',async()=>{
 const collect=async(text:string,truncated=false)=>{let n=0;return collectPageSource(fixture(async()=>({text:++n===1?'Original':text,range:{...scope,truncated:n===2&&truncated}})).wc,{bodySelector:'article',publishedSelector:'.published'},async()=>({items:[],range:scope,truncated:false}))}
 for(const [text,date] of [
  ['October 16, 2026\nPooja Rao, Research Scientist, Petar Sirkovic, Software Engineer, and Annalisa Pawlosky, Research Scientist, Google','October 16, 2026'],
  ['【发布单位】安全与管制局\n【发布文号】商务部 科技部2026年第48号\n【发文日期】2026年10月16日','2026年10月16日'],
  ['来源：商务部新闻办公室\n类型：原创\n2026-10-16 16:00','2026-10-16 16:00'],
  ['Published: 2026-10-16T16:00:00+08:00\nBy Example','2026-10-16T16:00:00+08:00'],
  ['DeepSeek-V4.1-Flash-1017 Release 2026/10/17','2026/10/17'],
  ['Original Issue Date: October 16, 2026','October 16, 2026'],
  ['October 16, 2026 5:00 AM','October 16, 2026 5:00 AM'],
  ['Monday, October 16, 2026','Monday, October 16, 2026'],
  ['Published Mon, Oct 16 2026 3:12 PM EDT','Mon, Oct 16 2026 3:12 PM EDT']
 ]){const r=await collect(text);assert.equal(r.publishedAt,date);assert.equal(r.result,'observed')}
 for(const text of ['2026\n10/18\n22:04:56','2026\n10/18','2028\n2/29\n00:00'])assert.equal((await collect(text)).publishedAt,text.startsWith('2028')?'2028-02-29':'2026-10-18')
 for(const text of ['2026\n10/18\n2026\n10/19','Updated\n2026\n10/18','2026\n10/18\n25:04:56','2026\\n10/18\\n22:04:56','2026\n2/29','2026\n13/18','2026\n10/18\nBy Someone'])assert.equal((await collect(text)).publishedAt,text)
 const splitClipped=await collect('2026\n10/18\n22:04:56',true);assert.equal(splitClipped.result,'truncated');assert.notEqual(splitClipped.publishedAt,'2026-10-18')
 const ambiguous='Published: 2026-10-16\nRecorded: 2026-10-12';assert.equal((await collect(ambiguous)).publishedAt,ambiguous)
 for(const raw of ['Updated 7:19 PM GMT+8, October 16, 2026','Updated\nOctober 16, 2026','Recorded\n2026-10-16','Release 2026/10/17\nUpdated 2026/10/18'])assert.equal((await collect(raw)).publishedAt,raw)
 const updatedTime=fixture(async()=>({text:'Updated October 16, 2026',range:scope,dateTime:'2026-10-16T01:00:00Z'}));assert.equal((await collectPageSource(updatedTime.wc,{bodySelector:'article',publishedSelector:'time'},async()=>({items:[],range:scope,truncated:false}))).publishedAt,'Updated October 16, 2026')
 const clipped=await collect('October 16, 2026\n'+'byline '.repeat(20),true);assert.equal(clipped.result,'truncated');assert.notEqual(clipped.publishedAt,'October 16, 2026');assert.match(clipped.error!,/publishedAt/)
})
function fixture(read:(code:string)=>Promise<unknown>){const events=new EventEmitter();Object.assign(events,{getURL:()=> 'https://example.com/article',getTitle:()=> 'Article',isDestroyed:()=>false,mainFrame:{executeJavaScript:read},executeJavaScript:()=>{throw new Error('Fixed source reads must not wait in the whole-WebContents load queue')}});return {events,wc:events as unknown as WebContents}}
test('Visible body witnesses bind UTF16 author and publication metadata without guessing selectors or accepting changed text',async()=>{
 const text='📰 News\nPublished\nOctober 20, 2026\nStory\n作者\nOpenAI',witness=(quote:string)=>({startCharacter:text.indexOf(quote),endCharacter:text.indexOf(quote)+quote.length,quote}),metadataRanges={author:witness('OpenAI'),publishedAt:witness('October 20, 2026')}
 const collect=(body=text,range:SourceScope=scope,request:Record<string,unknown>={})=>collectPageSource(fixture(async()=>({text:body,range})).wc,{bodySelector:'article',metadataRanges,...request},async()=>({items:[],range:scope,truncated:false}))
 const result=await collect();assert.equal(result.result,'observed');assert.equal(result.author,'OpenAI');assert.equal(result.publishedAt,'October 20, 2026');assert.deepEqual(result.metadataRanges,metadataRanges)
 const changed=await collect(text.replace('October 20','October 19'));assert.equal(changed.result,'failed');assert.match(changed.error!,/witness differs/);assert.equal(changed.publishedAt,null);assert.equal(changed.metadataRanges,undefined)
 assert.equal((await collect(text,{...scope,truncated:true})).result,'failed');assert.equal((await collect(text,{...scope,status:'element-not-found'})).result,'failed');assert.equal((await collect(text,scope,{publishedSelector:'time'})).result,'failed')
})
test('Body publication witnesses reject cropped update/recording dates and non-date text instead of laundering them into current news',async()=>{
 for(const text of ['Updated October 20, 2026','Updated\nOctober 20, 2026','Recorded\nOctober 20, 2026','转载\nOctober 20, 2026','Event on October 20, 2026 tomorrow','October 20, 2026 and October 21, 2026','not a date']){
  const quote=text.includes('October')?'October 20, 2026':'not a date',startCharacter=text.indexOf(quote)
  const result=await collectPageSource(fixture(async()=>({text,range:scope})).wc,{bodySelector:'article',metadataRanges:{publishedAt:{startCharacter,endCharacter:startCharacter+quote.length,quote}}},async()=>({items:[],range:scope,truncated:false}));assert.equal(result.result,'failed',text);assert.equal(result.publishedAt,null)
 }
})
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

test('Published TIME preserves an explicit basic ISO offset instead of falling back to a date-only label',async()=>{
 const f=fixture(async()=>({text:'Published Wed, Oct 28 2026',range:scope,dateTime:'2026-10-28T16:13:00-0400'})),result=await collectPageSource(f.wc,{bodySelector:'article',publishedSelector:'time'},async()=>({items:[],range:scope,truncated:false}));assert.equal(result.publishedAt,'2026-10-28T16:13:00-04:00');assert.equal(result.result,'observed')
 for(const value of ['2026-10-28T16:13:00','2026-10-28T16:13:00-CST']){const f=fixture(async()=>({text:'Oct 28, 2026',range:scope,dateTime:value}));assert.equal((await collectPageSource(f.wc,{bodySelector:'article',publishedSelector:'time'},async()=>({items:[],range:scope,truncated:false}))).publishedAt,'Oct 28, 2026')}
})
