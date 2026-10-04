import { normalizeVideoPreferences } from '../../media-native/src/video-options.js'
import {readStateFile,stateRecord} from './state-load.js'
import fs from 'node:fs'
import path from 'node:path'

const SEARCH_ENGINES = Object.freeze({
  google: {
    label: 'Google',
    home: 'https://www.google.com/',
    query: 'https://www.google.com/search?q={query}'
  },
  bing: {
    label: 'Bing',
    home: 'https://www.bing.com/',
    query: 'https://www.bing.com/search?q={query}'
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    home: 'https://duckduckgo.com/',
    query: 'https://duckduckgo.com/?q={query}'
  },
  baidu: {
    label: 'Baidu',
    home: 'https://www.baidu.com/',
    query: 'https://www.baidu.com/s?wd={query}'
  }
})

const DEFAULTS = Object.freeze({
  version: 1,
  proxyMode: 'system',
  proxyRules: '',
  proxyBypassRules: '<local>',
  searchEngine: 'google',
  customSearchUrl: '',
  newTabPage: 'search',
  theme: 'dark',
  agentSidebarVisible: false,
  edgeNarrationEnabled: true
})

function cleanSingleLine(value, maximum = 2_000) {
  const text = String(value ?? '').trim()
  if (text.length > maximum) throw new Error(`Setting must be ${maximum} characters or fewer.`)
  if (/\r|\n/.test(text)) throw new Error('Setting must be entered on one line.')
  return text
}

function normalizeCustomSearchUrl(value) {
  const template = cleanSingleLine(value)
  if (!template) return ''
  if (!template.includes('{query}')) throw new Error('Custom search URL must include {query}.')
  const probe = new URL(template.replace('{query}', 'bmw'))
  if (!['http:', 'https:'].includes(probe.protocol)) throw new Error('Custom search URL must use HTTP(S).')
  return template
}

function normalize(input: Record<string, any> = {}) {
  const proxyMode = ['system', 'direct', 'manual'].includes(input.proxyMode) ? input.proxyMode : DEFAULTS.proxyMode
  const searchEngine = input.searchEngine === 'custom' || Object.hasOwn(SEARCH_ENGINES, input.searchEngine)
    ? input.searchEngine
    : DEFAULTS.searchEngine
  const proxyRules = cleanSingleLine(input.proxyRules)
  if (proxyMode === 'manual' && !proxyRules) throw new Error('Manual proxy mode requires a proxy server or proxy rules.')
  const customSearchUrl = normalizeCustomSearchUrl(input.customSearchUrl)
  if (searchEngine === 'custom' && !customSearchUrl) throw new Error('Choose a custom search URL containing {query}.')
  return {
    version: 1,
    videoPreferences: normalizeVideoPreferences(input.videoPreferences ?? {}),
    proxyMode,
    proxyRules,
    proxyBypassRules: cleanSingleLine(input.proxyBypassRules ?? DEFAULTS.proxyBypassRules),
    searchEngine,
    customSearchUrl,
    newTabPage: input.newTabPage === 'blank' ? 'blank' : 'search',
    theme: ['dark', 'light', 'system'].includes(input.theme) ? input.theme : DEFAULTS.theme,
    agentSidebarVisible: input.agentSidebarVisible === true,
    edgeNarrationEnabled: input.edgeNarrationEnabled === undefined ? DEFAULTS.edgeNarrationEnabled : input.edgeNarrationEnabled === true
  }
}

function writeAtomically(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

export class GlobalSettingsStore {
  [key: string]: any

  constructor({ filePath, onState, migrateSettings = (settings: Record<string, unknown>) => settings }) {
    this.migrateSettings = migrateSettings
    this.filePath = filePath
    this.onState = onState
    this.state = normalize(DEFAULTS)
    this.load()
  }

  load() {
    const loaded = readStateFile(this.filePath, raw => {
      const saved = stateRecord(raw)
      // Pre-version settings are an existing supported compatibility format.
      if (saved.version !== undefined && saved.version !== 1) throw new Error('Unsupported settings version.')
      for(const key of ['edgeNarrationEnabled','agentSidebarVisible'])if(saved[key]!==undefined&&typeof saved[key]!=='boolean')throw new Error('Invalid saved boolean setting: '+key)
      for(const key of ['proxyRules','proxyBypassRules','customSearchUrl'])if(saved[key]!==undefined&&typeof saved[key]!=='string')throw new Error('Invalid saved text setting: '+key)
      for(const [key,allowed] of Object.entries({proxyMode:['system','direct','manual'],theme:['dark','light','system'],searchEngine:['google','bing','duckduckgo','baidu','custom'],newTabPage:['search','blank']}))if(saved[key]!==undefined&&!allowed.includes(String(saved[key])))throw new Error('Invalid saved setting: '+key)
      return { saved, state: normalize({ ...DEFAULTS, ...this.migrateSettings(saved) }) }
    })
    if (!loaded) { writeAtomically(this.filePath, this.state); return }
    this.state = loaded.state
    if (JSON.stringify(loaded.saved) !== JSON.stringify(this.state)) writeAtomically(this.filePath, this.state)
  }

  snapshot() {
    return structuredClone(this.state)
  }

  update(input: Record<string, any> = {}) {
    this.state = normalize({ ...this.state, ...input })
    writeAtomically(this.filePath, this.state)
    this.onState?.(this.snapshot())
    return this.snapshot()
  }

  async applyProxy(session) {
    const settings = this.state
    const config = settings.proxyMode === 'manual'
      ? { mode: 'fixed_servers', proxyRules: settings.proxyRules, proxyBypassRules: settings.proxyBypassRules }
      : { mode: settings.proxyMode }
    await session.setProxy(config)
    await session.closeAllConnections()
  }

  searchUrl(query) {
    const settings = this.state
    const engine = settings.searchEngine === 'custom'
      ? { home: settings.customSearchUrl.replace('{query}', ''), query: settings.customSearchUrl }
      : SEARCH_ENGINES[settings.searchEngine]
    const text = String(query ?? '').trim()
    return text ? engine.query.replace('{query}', encodeURIComponent(text)) : engine.home
  }

  newTabUrl() {
    return this.state.newTabPage === 'blank' ? 'about:blank' : this.searchUrl('')
  }
}

export const globalSettingsInternals = { DEFAULTS, SEARCH_ENGINES, normalize }
