import assert from 'node:assert/strict'
import test from 'node:test'
import { agentTabsToClose, MAX_AGENT_TABS_PER_PROJECT, reusableTab, normalizeProjectTabState, projectTabsToRestore } from '../src/tab-policy.js'

function tab(id, { projectId = 'project-1', source = 'agent', url = `https://example.com/${id}`, lastUsedAt = 1 } = {}) {
  return { id, projectId, source, url, lastUsedAt, createdAt: lastUsedAt }
}

test('Agent tab reuse prefers an exact URL without navigating', () => {
  const exact = tab('exact', { source: 'user', url: 'https://example.com/page', lastUsedAt: 3 })
  const result = reusableTab([tab('other'), exact], {
    projectId: 'project-1', targetUrl: 'https://example.com/page'
  })

  assert.equal(result.tab.id, 'exact')
  assert.equal(result.navigate, false)
  assert.equal(result.reason, 'exact-url')
})

test('Agent tab reuse navigates the most recent same-origin Agent tab but not a user tab', () => {
  const result = reusableTab([
    tab('user', { source: 'user', url: 'https://example.com/user', lastUsedAt: 10 }),
    tab('old-agent', { url: 'https://example.com/old', lastUsedAt: 2 }),
    tab('recent-agent', { url: 'https://example.com/recent', lastUsedAt: 8 })
  ], { projectId: 'project-1', targetUrl: 'https://example.com/new' })

  assert.equal(result.tab.id, 'recent-agent')
  assert.equal(result.navigate, true)
  assert.equal(reusableTab([tab('agent')], { projectId: 'project-1', targetUrl: 'https://other.test/', reuse: false }), null)
})

test('Agent tab cap closes only least-recent background Agent tabs', () => {
  const tabs = [
    tab('user', { source: 'user', lastUsedAt: 0 }),
    ...Array.from({ length: MAX_AGENT_TABS_PER_PROJECT + 2 }, (_, index) => tab(`agent-${index}`, { lastUsedAt: index + 1 }))
  ]
  const close = agentTabsToClose(tabs, {
    projectId: 'project-1', activeTabId: 'agent-0', keepTabId: `agent-${MAX_AGENT_TABS_PER_PROJECT + 1}`
  })

  assert.deepEqual(close.map(({ id }) => id), ['agent-1', 'agent-2'])
  assert.equal(close.some(({ id }) => id === 'user'), false)
  assert.equal(close.some(({ id }) => id === 'agent-0'), false)
})

test('Saved research ownership survives restore, bounds Agent pages and preserves the visible page',()=>{
 const tabs=Array.from({length:9},(_,n)=>({url:`https://example.org/${n}`,source:'agent' as const})),state=normalizeProjectTabState({urls:tabs.map(t=>t.url),tabs,activeUrl:tabs[0].url}),restored=projectTabsToRestore(state)
 assert.equal(restored.tabs.length,MAX_AGENT_TABS_PER_PROJECT);assert.ok(restored.tabs.some(t=>t.url===tabs[0].url));assert.ok(restored.tabs.every(t=>t.source==='agent'))
 const legacy=projectTabsToRestore({urls:['https://example.org/old'],activeUrl:'https://example.org/old'});assert.equal(legacy.tabs[0].source,'user')
 const many=Array.from({length:25},(_,n)=>({url:`https://example.org/user/${n}`,source:'user' as const})),bounded=normalizeProjectTabState({urls:many.map(t=>t.url),tabs:many,activeUrl:many[24].url});assert.equal(bounded.urls.length,20);assert.ok(bounded.urls.includes(many[24].url))
 assert.throws(()=>normalizeProjectTabState({urls:[],tabs:[{url:'https://example.org',source:'guessed'}]}),/ownership/)
})
