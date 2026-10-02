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
  dshSidebarVisible: false,
  webContainerModuleUrl: ''
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

function normalizeOptionalHttpUrl(value) {
  const input = cleanSingleLine(value)
  if (!input) return ''
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('WebContainer module URL must use HTTP(S).')
  return url.toString()
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
    proxyMode,
    proxyRules,
    proxyBypassRules: cleanSingleLine(input.proxyBypassRules ?? DEFAULTS.proxyBypassRules),
    searchEngine,
    customSearchUrl,
    newTabPage: input.newTabPage === 'blank' ? 'blank' : 'search',
    theme: ['dark', 'light', 'system'].includes(input.theme) ? input.theme : DEFAULTS.theme,
    dshSidebarVisible: input.dshSidebarVisible === true,
    webContainerModuleUrl: normalizeOptionalHttpUrl(input.webContainerModuleUrl)
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

  constructor({ filePath, onState }) {
    this.filePath = filePath
    this.onState = onState
    this.state = normalize(DEFAULTS)
    this.load()
  }

  load() {
    try {
      this.state = normalize({ ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.filePath, 'utf8')) })
    } catch (error) {
      if (error.code === 'ENOENT') writeAtomically(this.filePath, this.state)
      else console.error('Failed to load BMW global settings', error)
    }
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
