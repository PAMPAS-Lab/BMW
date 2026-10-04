import crypto from 'node:crypto'
import { readRendererPhase } from './renderer-read.js'
import { readScreenshotPhase } from './screenshot-read.js'
import { SessionOperations } from './session-operations.js'
import fs from 'node:fs'
import path from 'node:path'
import { nativeImage, WebContentsView } from 'electron'
import { assertBrowserRequest, BROWSER_ACTIONS, targetTabId } from './browser-schema.js'
import { agentTabsToClose, reusableTab } from './tab-policy.js'
import { downloadMediaArtifact } from './media-artifact.js'

const PROJECT_BLANK_URL = 'about:blank'
const SEMANTIC_CLASS_STATES = Object.freeze([
  'unread',
  'read',
  'selected',
  'active',
  'disabled',
  'checked',
  'flagged'
])
const SEMANTIC_ARIA_STATES = Object.freeze([
  'aria-checked',
  'aria-selected',
  'aria-expanded',
  'aria-current',
  'aria-disabled'
])

function normalizeUrl(input, settingsStore) {
  const value = String(input ?? '').trim()
  if (!value) return settingsStore?.newTabUrl() || 'https://www.google.com/'
  try {
    return new URL(value).toString()
  } catch {
    if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(value)) return `https://${value}`
    return settingsStore?.searchUrl(value) || `https://www.google.com/search?q=${encodeURIComponent(value)}`
  }
}

function safeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
}

function projectStartUrl(project) {
  return project?.tabState?.activeUrl || project?.homeUrl || PROJECT_BLANK_URL
}

export class BrowserKernel {
  [key: string]: any

  constructor({ window, session, permissionStore, sessionContinuity, projectStore, settingsStore, capabilityRegistry, allowedActions, artifactsDirectory, pageTheme = 'dark', onState, getCurrentSessionId = () => null }) {
    this.getCurrentSessionId = getCurrentSessionId
    this.window = window
    this.session = session
    this.permissionStore = permissionStore
    this.sessionContinuity = sessionContinuity
    this.projectStore = projectStore
    this.settingsStore = settingsStore
    this.capabilityRegistry = capabilityRegistry || null
    this.allowedActions = capabilityRegistry?.allowedActions || allowedActions || BROWSER_ACTIONS
    this.artifactsDirectory = artifactsDirectory
    this.pageTheme = pageTheme
    this.onState = onState
    this.tabs = new Map()
    this.activeTabId = null
    this.browserBounds = { x: 0, y: 64, width: 900, height: 700 }
    this.recordingController = null
    this.scheduledTaskManager = null
    this.tabStateTimer = null
    this.diagnostics = new Map()
  }

  setRecordingController(controller) {
    this.recordingController = controller
  }

  setScheduledTaskManager(manager) {
    this.scheduledTaskManager = manager
  }

  async initialize() {
    const project = this.projectStore?.active()
    if (project) return this.restoreProjectTabs(project)
    return this.openTab({ url: this.settingsStore?.newTabUrl(), foreground: true, source: 'user' })
  }

  private restoringTabState = false

  private async restoreProjectTabs(project: { id: string; homeUrl?: string; tabState?: { urls?: string[]; activeUrl?: string | null } }) {
    // Snapshot before loading: browser events must not persist a partially restored set.
    const urls = [...new Set(project.tabState?.urls || [])]
    const activeUrl = projectStartUrl(project)
    if (!urls.length || !urls.includes(activeUrl)) urls.push(activeUrl)
    const failures: string[] = []
    clearTimeout(this.tabStateTimer)
    this.restoringTabState = true
    try {
      for (const url of urls) {
        try {
          await this.openTab({ url, foreground: false, source: 'user', reuse: false })
        } catch (error) {
          // Retain the requested URL even when an offline page cannot load.
          const tab = [...this.tabs.values()].filter(value => value.projectId === project.id).at(-1)
          if (!tab) throw error
          tab.url = url
          const message = error instanceof Error ? error.message : String(error)
          failures.push(message)
          console.warn(`[BMW] Restored page failed to load without blocking Project activation: ${message}`)
        }
      }
      const owned = [...this.tabs.values()].filter(tab => tab.projectId === project.id)
      const active = owned.find(tab => tab.url === activeUrl) || owned.at(-1)
      this.showTab(active.id)
      return { ...this.serializeTab(active), ...(failures.length ? { loadError: failures.join('; ') } : {}) }
    } finally {
      this.restoringTabState = false
      this.emitState()
    }
  }

  setBounds(bounds) {
    this.browserBounds = bounds
    for (const tab of this.tabs.values()) tab.view.setBounds(bounds)
  }

  #wireTab(tab) {
    const wc = tab.view.webContents
    this.diagnostics.set(tab.id, { console: [], network: [], media: [], loadFailures: [] })
    const emit = () => {
      tab.title = wc.getTitle() || 'New tab'
      tab.url = wc.getURL() || tab.url
      tab.loading = wc.isLoading()
      this.emitState()
    }
    wc.on('page-title-updated', emit)
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)
    wc.on('did-navigate', emit)
    wc.on('did-navigate-in-page', emit)
    wc.on('did-navigate', () => { void this.#applyPageTheme(tab) })
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.#addDiagnostic(tab.id, 'loadFailures', { errorCode, errorDescription, url: validatedURL, isMainFrame, at: Date.now() })
    })
    wc.on('console-message', (details) => {
      const message = String(details?.message || '')
      this.#addDiagnostic(tab.id, 'console', {
        level: details?.level || 'info',
        message: message.slice(0, 2000),
        source: details?.sourceId || '',
        line: details?.lineNumber || 0,
        at: Date.now()
      })
    })
    wc.setWindowOpenHandler(({ url }) => {
      void this.openTab({ url, foreground: true, source: 'page' })
      return { action: 'deny' }
    })
  }

  async openTab({ url, foreground = false, source = 'agent', reuse = true }: { url?: unknown; foreground?: boolean; source?: string; reuse?: boolean } = {}) {
    const projectId = this.projectStore?.active().id || null
    const targetUrl = normalizeUrl(url, this.settingsStore)
    if (source === 'agent') {
      const reusable = reusableTab([...this.tabs.values()], { projectId, targetUrl, reuse })
      if (reusable) {
        reusable.tab.lastUsedAt = Date.now()
        if (reusable.navigate) await reusable.tab.view.webContents.loadURL(targetUrl)
        if (foreground) this.showTab(reusable.tab.id)
        else this.emitState()
        this.enforceAgentTabLimit(projectId, reusable.tab.id)
        return { ...this.serializeTab(reusable.tab), reused: true, reuseReason: reusable.reason }
      }
    }
    const id = crypto.randomUUID()
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })
    view.setBounds(this.browserBounds)
    const tab = {
      id,
      view,
      projectId,
      title: 'New tab',
      url: targetUrl,
      loading: true,
      source,
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    }
    this.tabs.set(id, tab)
    this.#wireTab(tab)
    view.setBackgroundColor(this.pageTheme === 'dark' ? '#0a0d12' : '#ffffff')
    if (foreground || !this.activeTabId) this.showTab(id)
    else this.emitState()
    await view.webContents.loadURL(targetUrl)
    if (source === 'agent') this.enforceAgentTabLimit(projectId, id)
    return { ...this.serializeTab(tab), reused: false }
  }

  async #applyPageTheme(tab) {
    const wc = tab?.view?.webContents
    if (!wc || wc.isDestroyed()) return
    const dark = this.pageTheme === 'dark'
    try {
      tab.view.setBackgroundColor(dark ? '#0a0d12' : '#ffffff')
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      if (!tab.debuggerWired) {
        tab.debuggerWired = true
        wc.debugger.on('message', (_event, method, params) => {
          if (method === 'Network.loadingFailed') this.#addDiagnostic(tab.id, 'network', { type: 'failed', url: params?.url || '', errorText: params?.errorText || '', at: Date.now() })
          if (method === 'Network.responseReceived' && Number(params?.response?.status) >= 400) {
            this.#addDiagnostic(tab.id, 'network', { type: 'response', url: params.response.url, status: params.response.status, statusText: params.response.statusText, at: Date.now() })
          }
          if (method === 'Network.responseReceived') {
            const resourceType = String(params?.type || '')
            const mimeType = String(params?.response?.mimeType || '')
            if (['Image', 'Media'].includes(resourceType) || /^(?:image|video|audio)\//i.test(mimeType)) {
              this.#addDiagnostic(tab.id, 'media', {
                url: params?.response?.url || '',
                mimeType,
                resourceType,
                status: params?.response?.status || 0,
                at: Date.now()
              })
            }
          }
        })
        await wc.debugger.sendCommand('Network.enable').catch(() => {})
      }
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
        media: '',
        features: [{ name: 'prefers-color-scheme', value: this.pageTheme }]
      })
      await wc.debugger.sendCommand('Emulation.setDefaultBackgroundColorOverride', {
        color: dark ? { r: 10, g: 13, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
      })
      await wc.debugger.sendCommand('Emulation.setAutoDarkModeOverride', { enabled: dark }).catch(() => {})
    } catch (error) {
      console.error(`Failed to apply BMW page theme to ${tab.url || 'new tab'}`, error)
    }
  }

  async setPageTheme(theme) {
    this.pageTheme = theme === 'light' ? 'light' : 'dark'
    await Promise.all([...this.tabs.values()].map((tab) => this.#applyPageTheme(tab)))
    return { theme: this.pageTheme, tabs: this.tabs.size }
  }

  enforceAgentTabLimit(projectId, keepTabId) {
    const stale = agentTabsToClose([...this.tabs.values()], {
      projectId,
      activeTabId: this.activeTabId,
      keepTabId
    })
    for (const tab of stale) this.closeTab(tab.id)
  }

  showTab(tabId) {
    const tab = this.requireTab(tabId)
    const previous = this.tabs.get(this.activeTabId)
    if (previous && previous.id !== tab.id) this.window.contentView.removeChildView(previous.view)
    if (!this.window.contentView.children.includes(tab.view)) this.window.contentView.addChildView(tab.view)
    tab.view.setBounds(this.browserBounds)
    tab.view.setVisible(true)
    this.activeTabId = tab.id
    tab.lastUsedAt = Date.now()
    this.emitState()
    return this.serializeTab(tab)
  }

  closeTab(tabId) {
    const tab = this.requireTab(tabId)
    const wasActive = this.activeTabId === tabId
    this.window.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    this.tabs.delete(tabId)
    this.diagnostics.delete(tabId)
    if (wasActive) {
      this.activeTabId = null
      const projectId = this.projectStore?.active().id
      const next = [...this.tabs.values()]
        .filter((candidate) => !projectId || candidate.projectId === projectId)
        .sort((left, right) => Number(right.lastUsedAt || right.createdAt || 0) - Number(left.lastUsedAt || left.createdAt || 0))[0]
      if (next) this.showTab(next.id)
      else void this.openTab({ url: projectStartUrl(this.projectStore?.active()), foreground: true, source: 'user' })
    }
    this.emitState()
    this.scheduleTabStateSave()
    return { closed: tabId }
  }

  requireTab(tabId) {
    const resolved = tabId || this.activeTabId
    const tab = this.tabs.get(resolved)
    if (!tab) throw new Error(`Unknown tab: ${String(resolved)}`)
    const activeProjectId = this.projectStore?.active().id
    if (activeProjectId && tab.projectId !== activeProjectId) throw new Error('The requested tab belongs to another BMW project.')
    return tab
  }

  serializeTab(tab) {
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      loading: tab.loading,
      active: tab.id === this.activeTabId,
      source: tab.source,
      projectId: tab.projectId
    }
  }

  state() {
    const active = this.tabs.get(this.activeTabId)
    const activeProject = this.projectStore?.active()
    return {
      activeTabId: this.activeTabId,
      tabs: [...this.tabs.values()]
        .filter((tab) => !activeProject || tab.projectId === activeProject.id)
        .map((tab) => this.serializeTab(tab)),
      agentControlGranted: this.permissionStore.hasAgentControl(),
      sessionContinuity: this.sessionContinuity?.status(active?.url) || null,
      activeProject: activeProject ? { id: activeProject.id, name: activeProject.name } : null
    }
  }

  activeUrl() {
    return this.tabs.get(this.activeTabId)?.url || ''
  }

  activePageMetadata() {
    const tab = this.requireTab(this.activeTabId)
    return { id: tab.id, title: tab.title, url: tab.url }
  }

  isActivePageWebContents(webContents) {
    return Boolean(webContents) && this.tabs.get(this.activeTabId)?.view.webContents === webContents
  }

  async saveActivePage(fullPath, saveType) {
    const tab = this.requireTab(this.activeTabId)
    await tab.view.webContents.savePage(fullPath, saveType)
    return { ...this.serializeTab(tab), fullPath, saveType }
  }

  emitState() {
    this.onState?.(this.state())
    this.scheduleTabStateSave()
  }

  scheduleTabStateSave() {
    if (!this.projectStore || this.restoringTabState) return
    clearTimeout(this.tabStateTimer)
    this.tabStateTimer = setTimeout(() => {
      const project = this.projectStore.active()
      this.saveTabState(project.id)
    }, 500)
    this.tabStateTimer.unref?.()
  }

  saveTabState(projectId) {
    if (!this.projectStore || !projectId) return
    const tabs = [...this.tabs.values()].filter((tab) => tab.projectId === projectId)
    const active = this.tabs.get(this.activeTabId)
    this.projectStore.updateTabState(projectId, {
      urls: tabs.map((tab) => tab.url),
      activeUrl: active?.projectId === projectId ? active.url : null
    })
  }

  async switchProject(project) {
    const previous = this.tabs.get(this.activeTabId)
    if (previous) this.saveTabState(previous.projectId)
    if (previous) this.window.contentView.removeChildView(previous.view)
    this.activeTabId = null
    const owned = [...this.tabs.values()].filter((tab) => tab.projectId === project.id)
    const existing = owned.find(tab=>tab.url===project.tabState?.activeUrl) || owned.at(-1)
    if (existing) return this.showTab(existing.id)
    return this.restoreProjectTabs(project)
  }

  private readonly operations = new SessionOperations()
  get busy():boolean { return this.operations.busy }

  async execute(rawRequest, { actor = 'agent', signal, sessionOwner }: { actor?: string; signal?: AbortSignal; sessionOwner?:import('./browser-host.js').BrowserSessionOwner } = {}) {
    const owner=sessionOwner?{projectId:sessionOwner.projectId,sessionId:sessionOwner.sessionId}:undefined
    return this.operations.run(() => { signal?.throwIfAborted() }, () => this.executeAction(rawRequest, { actor, signal, sessionOwner:owner }))
  }

  private async executeAction(rawRequest, { actor = 'agent', signal, sessionOwner }: { actor?: string; signal?: AbortSignal; sessionOwner?:import('./browser-host.js').BrowserSessionOwner } = {}) {
    const request = assertBrowserRequest(rawRequest, this.allowedActions)
    if (!this.permissionStore.hasAgentControl() && request.action !== 'status') {
      const error = new Error('BMW agent control has not been granted. Ask the user to click “Enable agent control” once in the product toolbar.')
      ;(error as Error & { code?: string }).code = 'PERMISSION_REQUIRED'
      throw error
    }

    if (request.action === 'status') return this.state()
    if (request.action === 'tabs.list') return this.state()
    const contributed = await this.capabilityRegistry?.execute(request.action, { browserKernel: this, actor, signal, sessionOwner }, request)
    if (contributed?.handled) return contributed.value
    if (request.action === 'project.context') {
      const project = this.projectStore.active()
      return {
        project: { id: project.id, name: project.name, homeUrl: project.homeUrl },
        instructions: this.projectStore.readDocument(project.id, 'instructions').content.slice(0, 20_000),
        memory: this.projectStore.readDocument(project.id, 'memory').content.slice(0, 20_000),
        tasks: this.projectStore.readDocument(project.id, 'tasks').content.slice(0, 12_000)
      }
    }
    if (request.action === 'project.memory.append' || request.action === 'project.tasks.append') {
      if (typeof request.content !== 'string' || !request.content.trim()) throw new Error(`${request.action} requires non-empty content.`)
      const project = this.projectStore.active()
      const kind = request.action === 'project.memory.append' ? 'memory' : 'tasks'
      const result = this.projectStore.appendDocument(project.id, kind, request.content)
      return { projectId: project.id, kind, bytes: Buffer.byteLength(result.content, 'utf8') }
    }
    if (request.action.startsWith('schedule.')) {
      if (!this.scheduledTaskManager) throw new Error('BMW scheduled tasks are unavailable.')
      const project = this.projectStore.active()
      if (request.action === 'schedule.list') return this.scheduledTaskManager.list(project.id)
      if (request.action === 'schedule.create') {
        return this.scheduledTaskManager.create({id:project.id,sessionId:this.getCurrentSessionId()}, {
          name: request.scheduleName,
          prompt: request.schedulePrompt,
          time: request.scheduleTime,
          timeZone: request.scheduleTimeZone,
          enabled: request.scheduleEnabled
        })
      }
      const taskId = typeof request.scheduledTaskId === 'string' ? request.scheduledTaskId : ''
      if (!taskId) throw new Error(`${request.action} requires scheduledTaskId.`)
      if (request.action === 'schedule.update') {
        return this.scheduledTaskManager.update(project.id, taskId, {
          ...(request.scheduleName !== undefined ? { name: request.scheduleName } : {}),
          ...(request.schedulePrompt !== undefined ? { prompt: request.schedulePrompt } : {}),
          ...(request.scheduleTime !== undefined ? { time: request.scheduleTime } : {}),
          ...(request.scheduleTimeZone !== undefined ? { timeZone: request.scheduleTimeZone } : {}),
          ...(request.scheduleEnabled !== undefined ? { enabled: request.scheduleEnabled } : {})
        })
      }
      if (request.action === 'schedule.remove') return this.scheduledTaskManager.remove(project.id, taskId)
      if (request.action === 'schedule.run') return this.scheduledTaskManager.runNow(project.id, taskId)
    }
    if (request.action === 'tabs.open') {
      return this.openTab({
        url: request.url,
        foreground: request.foreground === true,
        source: actor === 'user' ? 'user' : 'agent',
        reuse: actor === 'agent' ? request.reuse !== false : false
      })
    }
    if (request.action === 'tabs.show') return this.showTab(targetTabId(request))
    if (request.action === 'tabs.close') return this.closeTab(targetTabId(request))

    if (['media.inspect', 'media.frames.sample', 'media.convert','media.image.inspect','media.image.annotate','media.image.draw'].includes(request.action)) {
      if (!this.projectStore.active()?.directory) throw new Error('Media processing requires an active BMW Project.')
      return this.recordingController.processArtifact(request, signal)
    }

    const tab = this.requireTab(targetTabId(request))
    tab.lastUsedAt = Date.now()
    const wc = tab.view.webContents
    if (request.action === 'navigate') {
      await wc.loadURL(normalizeUrl(request.url, this.settingsStore))
      return this.serializeTab(tab)
    }
    if (request.action === 'back') {
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
      return this.serializeTab(tab)
    }
    if (request.action === 'forward') {
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
      return this.serializeTab(tab)
    }
    if (request.action === 'reload') {
      wc.reload()
      return this.serializeTab(tab)
    }
    if (request.action === 'wait') {
      const milliseconds = Math.min(Math.max(Number(request.milliseconds) || 500, 50), 10_000)
      await new Promise((resolve) => setTimeout(resolve, milliseconds))
      return { waited: milliseconds, tab: this.serializeTab(tab) }
    }
    if (request.action === 'key') return this.key(tab, request)
    if (request.action === 'hover') return this.hover(tab, request)
    if (request.action === 'observe') return this.observe(tab, request, signal)
    if (request.action === 'page.diagnostics') return this.pageDiagnostics(tab, request, signal)
    if (request.action === 'page.media.list') return this.listMedia(tab, request, signal)
    if (request.action === 'page.viewport.set') return this.setViewport(tab, request)
    if (request.action === 'click') return this.click(tab, request)
    if (request.action === 'type') return this.type(tab, request)
    if (request.action === 'media.screenshot') return this.screenshot(tab, request, signal)
    if (request.action === 'media.download') return this.downloadMedia(tab, request, signal)
    if (request.action === 'media.video.capture') return this.recordingController.captureVideo(tab, request)
    if (request.action === 'media.record.start') return this.recordingController.start(tab, request)
    if (request.action === 'media.record.stop') return this.recordingController.stop()
    throw new Error(`Unimplemented browser action: ${request.action}`)
  }

  async observe(tab, request, signal?:AbortSignal) {
    const maxCharacters = Math.min(Math.max(Number(request.maxCharacters) || 12_000, 1_000), 50_000)
    const result = await readRendererPhase<{title:string;url:string;text:string;interactive:unknown[];semantic:unknown[]}>(tab.view.webContents, 'observe', 'dom', () => tab.view.webContents.executeJavaScript(`(() => {
      const isVisible = (element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      }
      const classStates = ${JSON.stringify(SEMANTIC_CLASS_STATES)}
      const ariaStates = ${JSON.stringify(SEMANTIC_ARIA_STATES)}
      const interactive = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')]
        .filter(isVisible)
        .slice(0, 160)
        .map((element, index) => ({
          index,
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute('type'),
          text: (element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 240),
          ariaLabel: element.getAttribute('aria-label'),
          href: element.href || null
        }))
      const semantic = [...document.querySelectorAll([
        'li',
        'tr',
        '[role]',
        '[aria-checked]',
        '[aria-selected]',
        '[aria-expanded]',
        '[aria-current]',
        '[aria-disabled]',
        '[data-state]',
        '[data-read]',
        '[data-unread]',
        ...classStates.map((state) => '.' + state)
      ].join(','))]
        .filter(isVisible)
        .slice(0, 240)
        .map((element, index) => {
          const states = classStates.filter((state) => element.classList.contains(state))
          for (const property of ['checked', 'disabled', 'selected']) {
            if (element[property] === true && !states.includes(property)) states.push(property)
          }
          for (const attribute of ariaStates) {
            if (element.hasAttribute(attribute)) states.push(attribute + ':' + element.getAttribute(attribute))
          }
          for (const attribute of ['data-state', 'data-read', 'data-unread']) {
            if (element.hasAttribute(attribute)) states.push(attribute + ':' + element.getAttribute(attribute))
          }
          return {
            index,
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role'),
            text: (element.innerText || element.getAttribute('aria-label') || '')
              .trim()
              .replace(/\\s+/g, ' ')
              .slice(0, 500),
            states
          }
        })
      return {
        title: document.title,
        url: location.href,
        text: (document.body?.innerText || '').slice(0, ${maxCharacters}),
        interactive,
        semantic
      }
    })()`, true), signal)
    return { tab: this.serializeTab(tab), ...result }
  }

  async click(tab, request) {
    const selector = typeof request.selector === 'string' ? request.selector : null
    const text = typeof request.text === 'string' ? request.text : null
    if (!selector && !text) throw new Error('click requires selector or text')
    const result = await tab.view.webContents.executeJavaScript(`(() => {
      const selector = ${JSON.stringify(selector)}
      const text = ${JSON.stringify(text)}
      const candidates = [...document.querySelectorAll('a,button,input,[role="button"],[role="link"],summary,label')]
      const element = selector ? document.querySelector(selector) : candidates.find((candidate) =>
        (candidate.innerText || candidate.value || candidate.getAttribute('aria-label') || '').trim().includes(text)
      )
      if (!element) return { ok: false, reason: 'element-not-found' }
      element.scrollIntoView({ block: 'center', inline: 'center' })
      element.click()
      return { ok: true, tag: element.tagName.toLowerCase(), text: (element.innerText || element.value || '').trim().slice(0, 200) }
    })()`, true)
    if (!result.ok) throw new Error(result.reason)
    return result
  }

  async type(tab, request) {
    if (typeof request.selector !== 'string' || typeof request.value !== 'string') {
      throw new Error('type requires selector and value')
    }
    const result = await tab.view.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(request.selector)})
      if (!element) return { ok: false, reason: 'element-not-found' }
      element.focus()
      const value = ${JSON.stringify(request.value)}
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      if (descriptor?.set) descriptor.set.call(element, value)
      else element.value = value
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, valueLength: value.length }
    })()`, true)
    if (!result.ok) throw new Error(result.reason)
    return result
  }

  #addDiagnostic(tabId, kind, value) {
    const state = this.diagnostics.get(tabId)
    if (!state || !Array.isArray(state[kind])) return
    state[kind].push(value)
    state[kind] = state[kind].slice(-200)
  }

  resetDiagnostics(tabId) {
    this.requireTab(tabId)
    this.diagnostics.set(tabId, { console: [], network: [], media: [], loadFailures: [] })
  }

  diagnosticsFor(tabId) {
    return structuredClone(this.diagnostics.get(tabId) || { console: [], network: [], media: [], loadFailures: [] })
  }

  async listMedia(tab, request, signal?:AbortSignal) {
    const selector = typeof request.selector === 'string' && request.selector.trim() ? request.selector.trim() : null
    const index = Math.min(Math.max(Math.floor(Number(request.index) || 0), 0), 10_000)
    const maxItems = Math.min(Math.max(Math.floor(Number(request.maxItems) || 80), 1), 240)
    const result = await readRendererPhase<{ok:boolean;reason?:string;items:Record<string,unknown>[];matches:number;selectedIndex:number;text:string}>(tab.view.webContents, 'page.media.list', 'dom', () => tab.view.webContents.executeJavaScript(`(async () => {
      const selector = ${JSON.stringify(selector)}
      const index = ${index}
      const roots = selector ? [...document.querySelectorAll(selector)] : [document]
      const root = roots[index]
      if (!root) return { ok: false, reason: 'element-not-found', matches: roots.length }
      const absolute = (value) => {
        if (!value || /^blob:|^data:/i.test(value)) return value || ''
        try { return new URL(value, location.href).toString() } catch { return value }
      }
      const descendants = (tag) => [
        ...(root instanceof Element && root.matches(tag) ? [root] : []),
        ...root.querySelectorAll(tag)
      ]
      const bestSrcset = (image) => {
        const candidates = String(image.srcset || '').split(',').map((part) => {
          const fields = part.trim().split(' ').filter(Boolean)
          const score = Number.parseFloat(fields[1] || '1')
          return fields[0] ? { url: absolute(fields[0]), score: Number.isFinite(score) ? score : 1 } : null
        }).filter(Boolean).sort((left, right) => right.score - left.score)
        return candidates[0]?.url || absolute(image.currentSrc || image.src)
      }
      const images = descendants('img').map((image) => ({
        kind: 'image',
        url: bestSrcset(image),
        displayedUrl: absolute(image.currentSrc || image.src),
        alt: image.alt || '',
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0
      }))
      const videos = descendants('video').map((video) => ({
        kind: 'video',
        url: absolute(video.currentSrc || video.src),
        poster: absolute(video.poster),
        duration: Number.isFinite(video.duration) ? video.duration : null,
        paused: video.paused
      }))
      const sources = descendants('source').map((source) => ({
        kind: 'source', url: absolute(source.src), mediaType: source.type || ''
      }))
      const performanceMedia = performance.getEntriesByType('resource').map((entry) => ({
        kind: 'resource',
        url: entry.name,
        initiatorType: entry.initiatorType || '',
        durationMs: Math.round(entry.duration || 0)
      })).filter((entry) => {
        if (/^(?:img|video|audio)$/i.test(entry.initiatorType)) return true
        try {
          const pathname = new URL(entry.url, location.href).pathname.toLowerCase()
          return ['.avif', '.gif', '.jpg', '.jpeg', '.png', '.webp', '.m3u8', '.mp4', '.mov', '.webm', '.m4a', '.mp3']
            .some((extension) => pathname.endsWith(extension))
        } catch { return false }
      })
      return {
        ok: true,
        matches: roots.length,
        selectedIndex: index,
        pageUrl: location.href,
        text: (root.innerText || '').trim().split(' ').filter(Boolean).join(' ').slice(0, 5000),
        items: [...images, ...videos, ...sources, ...performanceMedia]
      }
    })()`, true), signal)
    if (!result.ok) throw new Error(result.reason)
    const observed = this.diagnosticsFor(tab.id).media.map((item) => ({ kind: 'network', ...item }))
    const unique = new Map()
    for (const item of [...result.items, ...observed]) {
      const url = String(item.url || '')
      const poster = String(item.poster || '')
      if (url) unique.set(`${item.kind}:${url}`, { ...item, downloadable: /^https?:/i.test(url) })
      if (poster) unique.set(`poster:${poster}`, { kind: 'poster', url: poster, downloadable: /^https?:/i.test(poster) })
    }
    return {
      tab: this.serializeTab(tab),
      selector,
      matches: result.matches,
      selectedIndex: result.selectedIndex,
      text: result.text,
      items: [...unique.values()].slice(0, maxItems)
    }
  }

  async downloadMedia(tab, request, signal?:AbortSignal) {
    if (typeof request.url !== 'string' || !request.url.trim()) throw new Error('media.download requires a media URL.')
    const project = this.projectStore?.active()
    if (!project?.directory) throw new Error('media.download requires an active BMW Project.')
    const artifact = await downloadMediaArtifact({
      fetchImpl: this.session.fetch.bind(this.session),
      projectDirectory: project.directory,
      url: request.url,
      filename: typeof request.filename === 'string' ? request.filename : undefined,
      signal,
      referrer: tab.url
    })
    return { ...artifact, tab: this.serializeTab(tab) }
  }

  async pageDiagnostics(tab, request: Readonly<Record<string, unknown>> & { maxCharacters?: number } = {}, signal?:AbortSignal) {
    const observation = await this.observe(tab, { maxCharacters: request.maxCharacters || 6000 }, signal)
    const performance = await readRendererPhase(tab.view.webContents, 'page.diagnostics', 'performance', () => tab.view.webContents.executeJavaScript(`(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      return {
        domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
        loadMs: navigation ? Math.round(navigation.loadEventEnd) : null,
        resourceCount: performance.getEntriesByType('resource').length,
        longTaskCount: performance.getEntriesByType('longtask').length
      }
    })()`, true), signal)
    let accessibility = []
    try {
      if (!tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.attach('1.3')
      const tree = await readRendererPhase<{nodes?:{ignored?:boolean;role?:{value?:string};name?:{value?:string};description?:{value?:string};properties?:{name:string;value?:{value?:boolean}}[]}[]}>(tab.view.webContents,'page.diagnostics','accessibility',()=>tab.view.webContents.debugger.sendCommand('Accessibility.getFullAXTree',{depth:5}),signal)
      accessibility = (tree.nodes || []).filter((node) => !node.ignored).slice(0, 240).map((node) => ({
        role: node.role?.value || '', name: node.name?.value || '', description: node.description?.value || '',
        disabled: node.properties?.find((property) => property.name === 'disabled')?.value?.value === true
      }))
    } catch (error:unknown) {
      if(signal?.aborted || (error instanceof Error && 'code' in error && String(error.code).startsWith('BMW_BROWSER_')))throw error
    }
    const screenshot=await this.screenshot(tab,{},signal)
    return { ...observation, screenshot, diagnostics: this.diagnosticsFor(tab.id), performance, accessibility }
  }

  async assertPage(tab, request) {
    const assertion = request.assertion || request
    const type = String(assertion.type || '')
    let result
    if (type === 'console.noErrors') {
      const errors = this.diagnosticsFor(tab.id).console.filter((entry) => entry.level === 'error')
      result = { pass: errors.length === 0, actual: errors }
    } else if (type === 'network.noFailures') {
      const failures = this.diagnosticsFor(tab.id).network
      result = { pass: failures.length === 0, actual: failures }
    } else {
      result = await tab.view.webContents.executeJavaScript(`(() => {
        const assertion = ${JSON.stringify(assertion)}
        const element = assertion.selector ? document.querySelector(assertion.selector) : null
        const visible = (node) => {
          if (!node) return false
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        }
        if (assertion.type === 'url') return { pass: location.href.includes(assertion.value), actual: location.href }
        if (assertion.type === 'title') return { pass: document.title.includes(assertion.value), actual: document.title }
        if (assertion.type === 'exists') return { pass: Boolean(element), actual: Boolean(element) }
        if (assertion.type === 'visible') return { pass: visible(element), actual: visible(element) }
        if (assertion.type === 'text') {
          const actual = (element ? element.textContent : document.body?.innerText || '').trim()
          return { pass: actual.includes(assertion.value), actual: actual.slice(0, 2000) }
        }
        if (assertion.type === 'count') {
          const actual = document.querySelectorAll(assertion.selector).length
          return { pass: actual === Number(assertion.value), actual }
        }
        return { pass: false, actual: null, reason: 'unsupported-assertion' }
      })()`, true)
    }
    if (!result.pass) throw Object.assign(new Error(`Assertion ${type} failed${result.reason ? `: ${result.reason}` : ''}.`), { assertion, actual: result.actual })
    return { ok: true, assertion, actual: result.actual }
  }

  async setViewport(tab, request) {
    const width = Math.min(Math.max(Number(request.width) || 1280, 320), 3840)
    const height = Math.min(Math.max(Number(request.height) || 720, 320), 2160)
    const deviceScaleFactor = Math.min(Math.max(Number(request.deviceScaleFactor) || 1, 0.5), 4)
    if (!tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.attach('1.3')
    await tab.view.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor, mobile: request.mobile === true,
      // Emulate page layout for capture without resizing the native render view
      // beyond the workspace into Assistant or Shell surfaces.
      screenWidth: width, screenHeight: height, dontSetVisibleSize: true
    })
    return { width, height, deviceScaleFactor, mobile: request.mobile === true }
  }

  async clearViewport(tab) {
    if (!tab.view.webContents.debugger.isAttached()) return { cleared: false }
    await tab.view.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
    return { cleared: true }
  }

  async key(tab, request) {
    const keyCode = String(request.key || '')
    if (!keyCode) throw new Error('key requires a key value.')
    const modifiers = Array.isArray(request.modifiers) ? request.modifiers : []
    tab.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    tab.view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    return { ok: true, key: keyCode, modifiers }
  }

  async hover(tab, request) {
    if (typeof request.selector !== 'string') throw new Error('hover requires selector.')
    const result = await tab.view.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(request.selector)})
      if (!element) return { ok: false, reason: 'element-not-found' }
      element.scrollIntoView({ block: 'center', inline: 'center' })
      for (const type of ['pointerover', 'mouseover', 'mouseenter']) element.dispatchEvent(new MouseEvent(type, { bubbles: true }))
      return { ok: true }
    })()`, true)
    if (!result.ok) throw new Error(result.reason)
    return result
  }

  async screenshot(tab, request, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const artifactsDirectory = this.projectStore ? path.join(this.projectStore.active().directory, 'artifacts') : this.artifactsDirectory
    fs.mkdirSync(artifactsDirectory, { recursive: true })
    let image
    if (typeof request.selector === 'string' && request.selector.trim()) {
      const selector = request.selector.trim()
      const index = Math.min(Math.max(Math.floor(Number(request.index) || 0), 0), 10_000)
      const clip = await readScreenshotPhase<{ ok: boolean; matches: number; x: number; y: number; width: number; height: number }>(tab.view.webContents, 'selector-layout', () => tab.view.webContents.executeJavaScript(`(() => {
        const matches = [...document.querySelectorAll(${JSON.stringify(selector)})]
        const element = matches[${index}]
        if (!element) return { ok: false, matches: matches.length }
        // Read document coordinates without scrolling. CDP captures beyond the viewport.
        // Detached background views may never get rAF; this read forces layout directly.
        const rect = element.getBoundingClientRect()
        return {
          ok: rect.width > 0 && rect.height > 0,
          matches: matches.length,
          x: Math.max(0, rect.left + scrollX),
          y: Math.max(0, rect.top + scrollY),
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height)
        }
      })()`, true), signal)
      if (!clip.ok) throw new Error(`Screenshot selector did not resolve to a visible element (${clip.matches || 0} matches).`)
      const wc = tab.view.webContents
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      const captured = await readScreenshotPhase<{ data: string }>(wc, 'capture-png', () => wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
      }), signal)
      image = nativeImage.createFromBuffer(Buffer.from(captured.data, 'base64'))
    } else if (request.mode === 'fullpage') {
      const wc = tab.view.webContents
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      const captured = await readScreenshotPhase<{ data: string }>(wc, 'capture-png', () => wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true }), signal)
      image = nativeImage.createFromBuffer(Buffer.from(captured.data, 'base64'))
    } else {
      // Studio can hide the native View; capture the browser viewport without
      // depending on a visible compositor surface or changing page scroll.
      const wc = tab.view.webContents
      const clip = await readScreenshotPhase<{x:number;y:number;width:number;height:number}>(wc, 'viewport-layout', () => wc.executeJavaScript('({x:Math.max(0,scrollX),y:Math.max(0,scrollY),width:innerWidth,height:innerHeight})'), signal)
      if(![clip.x,clip.y,clip.width,clip.height].every(Number.isFinite)||clip.width<=0||clip.height<=0||clip.width>16384||clip.height>16384)throw new Error('Invalid screenshot viewport')
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      const captured = await readScreenshotPhase<{data:string}>(wc, 'capture-viewport', () => wc.debugger.sendCommand('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,fromSurface:true,clip:{...clip,scale:1}}), signal)
      image = nativeImage.createFromBuffer(Buffer.from(captured.data, 'base64'))
    }
    signal?.throwIfAborted()
    if (image.isEmpty()) throw new Error('BMW_BROWSER_EMPTY_IMAGE: media.screenshot returned an empty PNG')
    const requestedName = typeof request.filename === 'string' ? safeFilename(request.filename) : ''
    const filename = `${Date.now()}-${requestedName || safeFilename(tab.title || 'page')}${(requestedName || '').toLowerCase().endsWith('.png') ? '' : '.png'}`
    const filePath = path.join(artifactsDirectory, filename)
    fs.writeFileSync(filePath, image.toPNG())
    return {
      artifactId: filename,
      type: 'screenshot',
      path: filePath,
      width: image.getSize().width,
      height: image.getSize().height,
      tab: this.serializeTab(tab),
      requestedMode: request.mode || 'viewport',
      selector: typeof request.selector === 'string' ? request.selector : null,
      index: typeof request.selector === 'string' ? Math.max(0, Math.floor(Number(request.index) || 0)) : null
    }
  }
}
