// @ts-nocheck -- BMW TypeScript migration baseline for legacy test doubles.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { GlobalSettingsStore, globalSettingsInternals } from '../src/global-settings-store.js'

test('global settings default to system proxy and Google search', () => {
  const settings = globalSettingsInternals.normalize(globalSettingsInternals.DEFAULTS)
  assert.equal(settings.proxyMode, 'system')
  assert.equal(settings.searchEngine, 'google')
  assert.equal(settings.newTabPage, 'search')
  assert.equal(settings.theme, 'dark')
  assert.equal(settings.agentSidebarVisible, false)
})

test('global settings persist manual proxy and generate selected search URLs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-settings-'))
  const filePath = path.join(directory, 'global-settings.json')
  const store = new GlobalSettingsStore({ filePath })
  store.update({
    proxyMode: 'manual',
    proxyRules: 'http://127.0.0.1:7890',
    proxyBypassRules: '<local>,localhost',
    searchEngine: 'bing',
    newTabPage: 'blank',
    theme: 'light'
  })

  const restored = new GlobalSettingsStore({ filePath })
  assert.equal(restored.snapshot().proxyRules, 'http://127.0.0.1:7890')
  assert.equal(restored.searchUrl('BMW browser'), 'https://www.bing.com/search?q=BMW%20browser')
  assert.equal(restored.newTabUrl(), 'about:blank')
  assert.equal(restored.snapshot().theme, 'light')
})

test('global appearance accepts one shared dark, light or system theme', () => {
  assert.equal(globalSettingsInternals.normalize({ theme: 'system' }).theme, 'system')
  assert.equal(globalSettingsInternals.normalize({ theme: 'light' }).theme, 'light')
  assert.equal(globalSettingsInternals.normalize({ theme: 'untrusted' }).theme, 'dark')
})

test('Agent sidebar is an explicit global compatibility fallback', () => {
  assert.equal(globalSettingsInternals.normalize({ agentSidebarVisible: true }).agentSidebarVisible, true)
  assert.equal(globalSettingsInternals.normalize({ agentSidebarVisible: 'true' }).agentSidebarVisible, false)
})

test('custom search templates require HTTP(S) and a query placeholder', () => {
  assert.throws(() => globalSettingsInternals.normalize({ searchEngine: 'custom', customSearchUrl: 'https://example.com/search' }), /\{query\}/)
  assert.throws(() => globalSettingsInternals.normalize({ searchEngine: 'custom', customSearchUrl: 'file:///tmp/{query}' }), /HTTP/)
})

test('proxy settings apply to the persistent BMW browser session', async () => {
  const calls = []
  const store = new GlobalSettingsStore({ filePath: path.join(os.tmpdir(), `bmw-settings-${Date.now()}.json`) })
  store.update({ proxyMode: 'manual', proxyRules: 'socks5://127.0.0.1:1080', proxyBypassRules: '<local>' })
  await store.applyProxy({
    setProxy: async (config) => calls.push(['setProxy', config]),
    closeAllConnections: async () => calls.push(['closeAllConnections'])
  })
  assert.deepEqual(calls, [
    ['setProxy', { mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:1080', proxyBypassRules: '<local>' }],
    ['closeAllConnections']
  ])
})


test('online narration defaults enabled and retains explicit boolean opt-out', () => {
  assert.equal(globalSettingsInternals.normalize({}).edgeNarrationEnabled, true)
  assert.equal(globalSettingsInternals.normalize({edgeNarrationEnabled: 'true'}).edgeNarrationEnabled, false)
  assert.equal(globalSettingsInternals.normalize({edgeNarrationEnabled: true}).edgeNarrationEnabled, true)
  assert.equal(globalSettingsInternals.normalize({edgeNarrationEnabled: false}).edgeNarrationEnabled, false)
})
