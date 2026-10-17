import test from 'node:test'
import assert from 'node:assert/strict'
import { assertBrowserRequest, BROWSER_ACTIONS, BROWSER_CORE_ACTION_DEFINITIONS, targetTabId } from '../src/browser-schema.js'

test('accepts every declared browser action', () => {
  for (const action of BROWSER_ACTIONS) assert.equal(assertBrowserRequest({ action },BROWSER_ACTIONS,[]).action, action)
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


test('body ranges bound selectors and exclusions and reject malformed scope rather than broadening it',()=>{
  assert.equal(assertBrowserRequest({action:'observe',selector:'article',index:1,excludeSelectors:['.avatar','.recommended']}).selector,'article')
  for(const action of ['observe','page.media.list'])for(const options of [{selector:''},{selector:42},{index:-1},{index:1.1},{excludeSelectors:['']},{excludeSelectors:Array(17).fill('aside')},{maxCharacters:Infinity}])assert.throws(()=>assertBrowserRequest({action,...options}),/selector|index|budget/)
})
