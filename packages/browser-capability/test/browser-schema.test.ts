import test from 'node:test'
import assert from 'node:assert/strict'
import { assertBrowserRequest, BROWSER_ACTIONS, BROWSER_CORE_ACTION_DEFINITIONS, targetTabId } from '../src/browser-schema.js'

test('accepts every declared browser action', () => {
  for (const action of BROWSER_ACTIONS) assert.equal(assertBrowserRequest({ action,...(action==='page.text.find'?{selector:'p',text:'quoted text'}:{}),...(action==='media.speech.align'?{artifactId:'clip.mp4',language:'en',sourceRange:{startSeconds:0,endSeconds:1}}:{}),...(['pages.read','pages.discover'].includes(action)?{urls:['https://example.com']}: {}) },BROWSER_ACTIONS,[]).action, action)
  assert.ok(BROWSER_ACTIONS.includes('media.video.capture'))
})

test('Browser validation returns recoverable catalog contracts and rejects ignored cross-action fields before execution',()=>{
  const error=(input:unknown)=>{try{assertBrowserRequest(input);assert.fail('Invalid request was admitted')}catch(error){assert.ok(error instanceof TypeError);return JSON.parse(error.message)}}
  const unknown=error({action:'page.read'})
  assert.equal(unknown.code,'BMW_BROWSER_ACTION_UNSUPPORTED');assert.equal(unknown.executed,false);assert.ok(unknown.supportedActions.includes('observe'));assert.deepEqual(unknown.recovery,{action:'help'})
  const extra=error({action:'media.video.capture',selector:'video',sourceEndSeconds:60})
  assert.equal(extra.code,'BMW_BROWSER_ARGUMENTS_INVALID');assert.deepEqual(extra.fields,['sourceEndSeconds']);assert.deepEqual(extra.recovery,{action:'help',forAction:'media.video.capture'});assert.ok(!extra.acceptedFields.includes('sourceEndSeconds'))
  assert.deepEqual(error({action:'media.video.capture'}).fields,['selector'])
  assert.deepEqual(error({action:'media.video.capture',selector:42}).fields,['selector'])
  assert.deepEqual(error({action:'help',forAction:'x'.repeat(201)}).fields,['forAction'])
  assert.equal(assertBrowserRequest({action:'help',forAction:'media.video.capture'}).forAction,'media.video.capture')
  assert.equal(BROWSER_CORE_ACTION_DEFINITIONS.find(row=>row.action==='media.video.capture')!.inputSchema.required[0],'selector')
})

test('rejects unsupported and malformed requests', () => {
  assert.throws(() => assertBrowserRequest(null), /must be an object/)
  assert.throws(() => assertBrowserRequest({ action: 'shell' }), /Unsupported browser action/)
})

test('returns only string tab ids', () => {
  assert.equal(targetTabId({ tabId: 'tab-1' }), 'tab-1')
  assert.equal(targetTabId({ tabId: 1 }), undefined)
})

test('Text page batches admit bounded explicit URL lists and never caller scripts, tab targets or deadline overrides',()=>{
 assert.equal(assertBrowserRequest({action:'pages.read',urls:['https://example.com/one']}).action,'pages.read')
 for(const fields of [{urls:[]},{urls:Array.from({length:61},(_,i)=>'https://example.com/'+i)},{urls:['https://example.com','https://example.com']},{urls:['https://example.com'],tabId:'other'},{urls:['https://example.com'],script:'fetch(secret)'},{urls:['https://example.com'],timeoutMs:999999}])assert.throws(()=>assertBrowserRequest({action:'pages.read',...fields}))
})


test('body ranges bound selectors and exclusions and reject malformed scope rather than broadening it',()=>{
  assert.equal(assertBrowserRequest({action:'observe',selector:'article',index:1,excludeSelectors:['.avatar','.recommended']}).selector,'article')
  for(const action of ['observe','page.media.list'])for(const options of [{selector:''},{selector:42},{index:-1},{index:1.1},{excludeSelectors:['']},{excludeSelectors:Array(17).fill('aside')},{maxCharacters:Infinity}])assert.throws(()=>assertBrowserRequest({action,...options}),/selector|index|budget/)
})

test('Discovery admits only closed bounded account requests, and an explicit leads projection',()=>{
 assert.equal(assertBrowserRequest({action:'pages.discover',urls:['https://x.com/Kimi_Moonshot']}).action,'pages.discover')
 for(const extra of [{tabId:'user'},{script:'caller code'},{timeoutMs:100},{maxCharacters:50000}])assert.throws(()=>assertBrowserRequest({action:'pages.discover',urls:['https://x.com/fixture'],...extra}))
 assert.equal(assertBrowserRequest({action:'pages.read-result',batchId:'fixed',revision:0,sha256:'a'.repeat(64),section:'leads',offset:0}).section,'leads')
})

test('Export speech windows use the same browser catalog and fixed local interval contract',()=>{
 const request={action:'media.speech.align',artifactId:'current-export.mp4',language:'en',model:'small',sourceRange:{startSeconds:10.773,endSeconds:21.893}}
 assert.equal(assertBrowserRequest(request).action,'media.speech.align')
 for(const patch of [{artifactId:'../outside.wav'},{language:'fr'},{model:'remote'},{sourceRange:{startSeconds:0,endSeconds:181}},{sourceRange:{startSeconds:10,endSeconds:2}},{sourceRange:{startSeconds:0,endSeconds:1,path:'/tmp/file'}},{sourceRange:undefined},{language:undefined},{command:'whisper-cli'}])assert.throws(()=>assertBrowserRequest({...request,...patch}))
})

test('Visible text finding requires an explicit closed scope and bounded query without caller scripts or source authority',()=>{
 assert.equal(assertBrowserRequest({action:'page.text.find',selector:'p',text:'Share your new behavior',findOffset:0,excludeSelectors:['aside']}).selector,'p')
 for(const fields of [{selector:'',text:'x'},{selector:'p',text:' '},{selector:'p',text:'x'.repeat(201)},{selector:'p',text:'x',findOffset:-1},{selector:'p',text:'x',index:1},{selector:'p',text:'x',script:'document.cookie'},{selector:'p',text:'x',sourceId:'pretend-proof'}])assert.throws(()=>assertBrowserRequest({action:'page.text.find',...fields}))
})

test('Batch tab close is bounded, explicit and disjoint from the active-tab fallback',()=>{
 assert.deepEqual(assertBrowserRequest({action:'tabs.close',tabIds:['one','two']}).tabIds,['one','two'])
 for(const tabIds of [[],['one','one'],Array.from({length:13},(_,i)=>String(i)),[42],['']])assert.throws(()=>assertBrowserRequest({action:'tabs.close',tabIds}))
 assert.throws(()=>assertBrowserRequest({action:'tabs.close',tabId:'user',tabIds:['agent']}))
})
