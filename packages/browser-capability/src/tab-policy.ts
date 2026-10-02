export const MAX_AGENT_TABS_PER_PROJECT = 6

function mostRecent(left, right) {
  return Number(right.lastUsedAt || right.createdAt || 0) - Number(left.lastUsedAt || left.createdAt || 0)
}

function comparableOrigin(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : ''
  } catch {
    return ''
  }
}

export function reusableTab(tabs, { projectId, targetUrl, reuse = true }) {
  if (reuse === false) return null
  const candidates = tabs.filter((tab) => tab.projectId === projectId)
  const exact = candidates.filter((tab) => tab.url === targetUrl).sort(mostRecent)[0]
  if (exact) return { tab: exact, navigate: false, reason: 'exact-url' }

  const origin = comparableOrigin(targetUrl)
  if (!origin) return null
  const sameOriginAgent = candidates
    .filter((tab) => tab.source === 'agent' && comparableOrigin(tab.url) === origin)
    .sort(mostRecent)[0]
  return sameOriginAgent ? { tab: sameOriginAgent, navigate: true, reason: 'same-origin-agent' } : null
}

export function agentTabsToClose(tabs, { projectId, activeTabId, keepTabId, limit = MAX_AGENT_TABS_PER_PROJECT }) {
  const agentTabs = tabs.filter((tab) => tab.projectId === projectId && tab.source === 'agent')
  const overflow = Math.max(0, agentTabs.length - limit)
  if (!overflow) return []
  return agentTabs
    .filter((tab) => tab.id !== activeTabId && tab.id !== keepTabId)
    .sort((left, right) => Number(left.lastUsedAt || left.createdAt || 0) - Number(right.lastUsedAt || right.createdAt || 0))
    .slice(0, overflow)
}
