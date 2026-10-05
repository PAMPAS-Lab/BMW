import test from 'node:test'
import assert from 'node:assert/strict'
import { assertBrowserRequest, BROWSER_ACTIONS, targetTabId } from '../src/browser-schema.js'

test('accepts every declared browser action', () => {
  for (const action of BROWSER_ACTIONS) assert.equal(assertBrowserRequest({ action }).action, action)
  assert.ok(BROWSER_ACTIONS.includes('media.video.capture'))
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
