import assert from 'node:assert/strict'
import test from 'node:test'
import { agentTabsToClose, MAX_AGENT_TABS_PER_PROJECT, reusableTab } from '../src/tab-policy.js'

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
