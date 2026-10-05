import { fileURLToPath } from 'node:url'
import type { AgentClient } from '@bmw-agent/agent-contract'
export const assistantPagePath = fileURLToPath(new URL('./src/renderer/assistant.html', import.meta.url))
export const assistantPreloadPath = fileURLToPath(new URL('./src/preload/assistant-preload.cjs', import.meta.url))
export const assistantClient: AgentClient = {
  async readSelection(surface, runtimeUrl) {
    if (surface.isDestroyed() || surface.getURL() !== runtimeUrl) return null
    const value = await surface.executeJavaScript('document.documentElement.dataset.sessionId || null')
    return typeof value === 'string' ? value : null
  },
  async selectSession(surface, sessionId) {
    if (!await surface.executeJavaScript('window.bmwSelectSession(' + JSON.stringify(sessionId) + ')')) throw new Error('BMW conversation selection was rejected')
  },
  async applySidebarPolicy() { /* BMW owns its Session list. */ },
  async openSettings(surface) { await surface.executeJavaScript('window.bmwOpenAgentSettings()') }
}
