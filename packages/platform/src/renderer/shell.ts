const api = window.bmw
const productBrand = document.querySelector('#product-brand')
const address = document.querySelector('#address')
const tabStrip = document.querySelector('#tab-strip')
const permissionBanner = document.querySelector('#permission-banner')
const recordingIndicator = document.querySelector('#recording-indicator')
const status = document.querySelector('#status')
const recordButton = document.querySelector('#record')
const agentToggle = document.querySelector('#agent-toggle')
const layoutButton = document.querySelector('#layout-button')
const layoutOverlay = document.querySelector('#layout-overlay')
const layoutWidth = document.querySelector('#layout-width')
const layoutWidthOutput = document.querySelector('#layout-width-output')
const layoutFullscreen = document.querySelector('#layout-fullscreen')
const layoutHint = document.querySelector('#layout-hint')
const layoutMessage = document.querySelector('#layout-message')
const keepLoginButton = document.querySelector('#keep-login')
const projectSwitcher = document.querySelector('#project-switcher')
const projectOverlay = document.querySelector('#project-overlay')
const projectList = document.querySelector('#project-list')
const projectName = document.querySelector('#project-name')
const projectHome = document.querySelector('#project-home')
const projectDocument = document.querySelector('#project-document')
const projectMessage = document.querySelector('#project-message')
const projectImport = document.querySelector('#project-import')
const importOverlay = document.querySelector('#import-overlay')
const importProject = document.querySelector('#import-project')
const importArtifacts = document.querySelector('#import-artifacts')
const importOrigins = document.querySelector('#import-origins')
const importMessage = document.querySelector('#import-message')
const settingsButton = document.querySelector('#settings-button')
const settingsOverlay = document.querySelector('#settings-overlay')
const settingsProxyMode = document.querySelector('#settings-proxy-mode')
const settingsProxyManual = document.querySelector('#settings-proxy-manual')
const settingsProxyRules = document.querySelector('#settings-proxy-rules')
const settingsProxyBypass = document.querySelector('#settings-proxy-bypass')
const settingsSearchEngine = document.querySelector('#settings-search-engine')
const settingsCustomSearchRow = document.querySelector('#settings-custom-search-row')
const settingsCustomSearch = document.querySelector('#settings-custom-search')
const settingsNewTab = document.querySelector('#settings-new-tab')
const settingsMessage = document.querySelector('#settings-message')
const settingsTheme = document.querySelector('#settings-theme')
const settingsDshSidebar = document.querySelector('#settings-dsh-sidebar')
const settingsRestart = document.querySelector('#settings-restart')
const settingsWebRuntime = document.querySelector('#settings-web-runtime')
const settingsWebContainerModule = document.querySelector('#settings-webcontainer-module')
const settingsWebContainerKey = document.querySelector('#settings-webcontainer-key')
const settingsWebRuntimeStatus = document.querySelector('#settings-web-runtime-status')
const sessionButton = document.querySelector('#session-button')
const sessionOverlay = document.querySelector('#session-overlay')
const sessionTitle = document.querySelector('#session-title')
const sessionSearch = document.querySelector('#session-search')
const sessionList = document.querySelector('#session-list')
const sessionMessage = document.querySelector('#session-message')
const scheduledTaskButton = document.querySelector('#scheduled-task-button')
const scheduledTaskOverlay = document.querySelector('#scheduled-task-overlay')
const scheduledTaskTitle = document.querySelector('#scheduled-task-title')
const scheduledTaskList = document.querySelector('#scheduled-task-list')
const scheduledTaskMessage = document.querySelector('#scheduled-task-message')

let browserState: Record<string, any> = { tabs: [], activeTabId: null, agentControlGranted: false }
let recording = false
let agentVisible = true
let layoutState: Record<string, any> = { configured: false, mode: 'sidebar', sidebarWidth: 460, opacity: 1, overlayFullscreen: false, setupVisible: false }
let dshStatusState: Record<string, any> = { state: 'starting' }
let editingLayoutMode = 'sidebar'
let editingOpacity = 1
let projectsState: Record<string, any> = { activeProjectId: null, projects: [] }
let editingProjectId = null
let documentKind = 'instructions'
let creatingProject = false
let initialProjectSetup = false
let globalSettings: Record<string, any> = { proxyMode: 'system', proxyRules: '', proxyBypassRules: '<local>', searchEngine: 'google', customSearchUrl: '', newTabPage: 'search', theme: 'dark', dshSidebarVisible: false }
let dshSessions: Record<string, any> = { selectedSessionId: null, items: [] }
let sessionSearchTimer
let productInfo = { id: 'bmw', name: 'BMW', canImportFromBase: false }
let importPreview: Record<string, any> = { projects: [], cookieOrigins: [] }
let webRuntimeSettings: Record<string, any> = { enabled: false, moduleUrl: '', apiKeyConfigured: false, capabilities: null }
let scheduledTaskState: Record<string, any> = { tasks: [], runs: [] }

function activeTab() {
  return browserState.tabs.find((tab) => tab.id === browserState.activeTabId)
}

function renderDshStatus() {
  const labels = {
    starting: 'Starting DSH…',
    ready: 'DSH ready',
    stopped: 'DSH stopped',
    error: `DSH error: ${dshStatusState.message || 'Unknown error'}`
  }
  const base = labels[dshStatusState.state] || `DSH ${dshStatusState.state}`
  const floating = layoutState.mode === 'overlay'
  const layoutLabel = floating ? 'Floating' : 'Sidebar'
  const actionLabel = floating ? 'click to dock' : 'click to float'
  status.textContent = `${base} · ${layoutLabel} (${actionLabel})`
  status.title = floating ? 'DSH is floating above the browser. Click to dock it in the sidebar.' : 'DSH is docked in the sidebar. Click to float it above the browser.'
  status.setAttribute('aria-label', status.title)
  status.classList.toggle('actionable', layoutState.configured === true && agentVisible)
}

function renderLayoutEditor() {
  document.querySelectorAll('[data-layout-mode]').forEach((button) => button.classList.toggle('active', button.dataset.layoutMode === editingLayoutMode))
  document.querySelectorAll('[data-opacity]').forEach((button) => button.classList.toggle('active', Number(button.dataset.opacity) === editingOpacity))
  layoutWidth.value = String(layoutState.sidebarWidth || 460)
  layoutWidthOutput.value = `${layoutWidth.value} px`
  layoutWidth.disabled = editingLayoutMode !== 'sidebar'
  document.querySelectorAll('[data-opacity]').forEach((button) => { button.disabled = editingLayoutMode !== 'overlay' })
  layoutFullscreen.disabled = editingLayoutMode !== 'overlay'
  layoutFullscreen.checked = editingLayoutMode === 'overlay' && layoutState.overlayFullscreen === true
  layoutHint.textContent = editingLayoutMode === 'overlay'
    ? 'Move and resize the BMW-owned DSH window with its native title bar and edges. Escape exits full screen.'
    : 'Choose the DSH panel width; the browser automatically receives the remaining space.'
  document.querySelector('#layout-close').disabled = layoutState.configured !== true
}

function showLayoutEditor(state) {
  layoutState = { ...layoutState, ...state }
  editingLayoutMode = layoutState.mode
  editingOpacity = layoutState.opacity
  layoutMessage.textContent = ''
  layoutOverlay.classList.remove('hidden')
  renderLayoutEditor()
}

async function openLayoutEditor() {
  try {
    showLayoutEditor(await api.layoutPanel(true))
  } catch (error) {
    status.textContent = error.message
  }
}

async function closeLayoutEditor() {
  if (!layoutState.configured) return
  layoutOverlay.classList.add('hidden')
  layoutState = { ...layoutState, ...(await api.layoutPanel(false)), setupVisible: false }
}

function scheduledTaskTime(value) {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

function renderScheduledTasks() {
  const project = activeProject()
  scheduledTaskTitle.textContent = `${project?.name || 'Project'} · Scheduled tasks`
  if (!scheduledTaskState.tasks?.length) {
    const empty = document.createElement('div')
    empty.className = 'scheduled-task-empty'
    empty.textContent = 'No scheduled tasks. Describe one directly to DSH in natural language.'
    scheduledTaskList.replaceChildren(empty)
    return
  }
  scheduledTaskList.replaceChildren(...scheduledTaskState.tasks.map((task) => {
    const latestRun = scheduledTaskState.runs?.find((run) => run.taskId === task.id)
    const activeRun = scheduledTaskState.runs?.find((run) => run.taskId === task.id && ['queued', 'running'].includes(run.status))
    const row = document.createElement('article')
    row.className = 'scheduled-task-row'
    const main = document.createElement('div')
    main.className = 'scheduled-task-main'
    const heading = document.createElement('div')
    heading.className = 'scheduled-task-name'
    const name = document.createElement('strong')
    name.textContent = task.name
    const badge = document.createElement('span')
    badge.className = `scheduled-task-badge ${activeRun?.status || task.lastRunStatus || ''}`
    badge.textContent = activeRun?.status || (task.enabled ? 'enabled' : 'paused')
    heading.append(name, badge)
    const schedule = document.createElement('span')
    schedule.className = 'scheduled-task-schedule'
    schedule.textContent = `Daily ${task.schedule.time} · ${task.schedule.timeZone} · next ${scheduledTaskTime(task.nextRunAt)}`
    const prompt = document.createElement('div')
    prompt.className = 'scheduled-task-prompt'
    prompt.textContent = task.prompt
    const run = document.createElement('span')
    run.className = 'scheduled-task-run'
    run.textContent = latestRun
      ? `Last run: ${latestRun.status} · ${scheduledTaskTime(latestRun.finishedAt || latestRun.startedAt || latestRun.queuedAt)}${latestRun.error ? ` · ${latestRun.error}` : ''}`
      : 'Not run yet'
    main.append(heading, schedule, prompt, run)
    const actions = document.createElement('div')
    actions.className = 'scheduled-task-actions'
    const enabledLabel = document.createElement('label')
    const enabled = document.createElement('input')
    enabled.type = 'checkbox'
    enabled.checked = task.enabled === true
    enabled.disabled = Boolean(activeRun)
    enabled.addEventListener('change', async () => {
      try {
        await api.updateScheduledTask(task.id, { enabled: enabled.checked })
        await refreshScheduledTasks()
      } catch (error) {
        scheduledTaskMessage.textContent = error.message
        enabled.checked = !enabled.checked
      }
    })
    enabledLabel.append(enabled, document.createTextNode('Enabled'))
    const runNow = document.createElement('button')
    runNow.textContent = activeRun ? activeRun.status : 'Run now'
    runNow.disabled = Boolean(activeRun)
    runNow.addEventListener('click', async () => {
      try {
        await api.runScheduledTask(task.id)
        scheduledTaskMessage.textContent = `Queued “${task.name}”. DSH will run it in the background.`
        await refreshScheduledTasks()
      } catch (error) { scheduledTaskMessage.textContent = error.message }
    })
    const remove = document.createElement('button')
    remove.className = 'danger'
    remove.textContent = 'Delete'
    remove.disabled = Boolean(activeRun)
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Delete scheduled task “${task.name}”? Its existing Project artifacts remain.`)) return
      try {
        await api.removeScheduledTask(task.id)
        await refreshScheduledTasks()
      } catch (error) { scheduledTaskMessage.textContent = error.message }
    })
    actions.append(enabledLabel, runNow, remove)
    row.append(main, actions)
    return row
  }))
}

async function refreshScheduledTasks() {
  try {
    scheduledTaskState = await api.scheduledTasks()
    renderScheduledTasks()
  } catch (error) {
    scheduledTaskMessage.textContent = error.message
  }
}

async function openScheduledTasks() {
  try {
    scheduledTaskState = await api.scheduledTaskPanel(true)
    scheduledTaskOverlay.classList.remove('hidden')
    renderScheduledTasks()
  } catch (error) { status.textContent = error.message }
}

async function closeScheduledTasks() {
  scheduledTaskOverlay.classList.add('hidden')
  await api.scheduledTaskPanel(false)
}

function renderGlobalSettings() {
  settingsTheme.value = globalSettings.theme || 'dark'
  settingsProxyMode.value = globalSettings.proxyMode
  settingsProxyRules.value = globalSettings.proxyRules || ''
  settingsProxyBypass.value = globalSettings.proxyBypassRules || ''
  settingsSearchEngine.value = globalSettings.searchEngine
  settingsCustomSearch.value = globalSettings.customSearchUrl || ''
  settingsNewTab.value = globalSettings.newTabPage
  settingsDshSidebar.checked = globalSettings.dshSidebarVisible === true
  settingsProxyManual.classList.toggle('hidden', settingsProxyMode.value !== 'manual')
  settingsCustomSearchRow.classList.toggle('hidden', settingsSearchEngine.value !== 'custom')
  settingsWebRuntime.classList.toggle('hidden', productInfo.id !== 'bmw-dev')
  settingsWebContainerModule.value = webRuntimeSettings.moduleUrl || globalSettings.webContainerModuleUrl || ''
  const capabilities = webRuntimeSettings.capabilities
  settingsWebRuntimeStatus.textContent = capabilities
    ? `Static OPFS: ready · Cross-origin isolated: ${capabilities.crossOriginIsolated ? 'yes' : 'no'} · WebContainers: ${capabilities.webcontainer ? 'ready' : 'not configured'} · API key: ${webRuntimeSettings.apiKeyConfigured ? 'encrypted' : 'not set'}`
    : 'Static OPFS is the automatic fallback. Configure WebContainers only when needed.'
}

function sessionTime(value) {
  const date = new Date(Number(value))
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

function setSessionMessage(message, error = false) {
  sessionMessage.textContent = message
  sessionMessage.style.color = error ? '#ff8793' : ''
}

function renderDshSessions() {
  const project = activeProject()
  sessionTitle.textContent = `${project?.name || 'Project'} · Sessions`
  if (!dshSessions.items?.length) {
    const empty = document.createElement('div')
    empty.className = 'session-empty'
    empty.textContent = sessionSearch.value.trim() ? 'No matching sessions in this Project.' : 'No visible session yet. Create one to start.'
    sessionList.replaceChildren(empty)
    return
  }
  sessionList.replaceChildren(...dshSessions.items.map((item, index) => {
    const row = document.createElement('article')
    row.className = `session-row${item.sessionId === dshSessions.selectedSessionId ? ' selected' : ''}`
    const main = document.createElement('div')
    main.className = 'session-row-main'
    main.tabIndex = 0
    main.setAttribute('role', 'button')
    main.setAttribute('aria-label', `Open ${item.title}`)
    const titleRow = document.createElement('div')
    titleRow.className = 'session-row-title'
    const title = document.createElement('strong')
    title.textContent = item.title
    const badge = document.createElement('span')
    badge.className = `session-badge${item.running ? ' running' : ''}`
    badge.textContent = item.running ? 'Running' : item.sessionId === dshSessions.selectedSessionId ? 'Current' : item.blank ? 'New' : 'Idle'
    titleRow.append(title, badge)
    const meta = document.createElement('small')
    meta.textContent = [item.snippet, sessionTime(item.updatedAt), item.parentSessionId ? 'Fork' : '', item.agentPreset || 'bmw'].filter(Boolean).join(' · ')
    main.append(titleRow, meta)
    const select = async () => {
      if (item.sessionId === dshSessions.selectedSessionId) return
      try {
        setSessionMessage('Switching DSH session…')
        dshSessions = await api.selectDshSession(item.sessionId)
        renderDshSessions()
        setSessionMessage('Selected session receives BMW input for this Project.')
      } catch (error) { setSessionMessage(error.message, true) }
    }
    main.addEventListener('click', select)
    main.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void select() } })
    const actions = document.createElement('div')
    actions.className = 'session-actions'
    const action = (label, handler, className = '') => {
      const button = document.createElement('button')
      button.textContent = label
      button.className = className
      button.addEventListener('click', handler)
      return button
    }
    const move = async (direction) => {
      try { dshSessions = await api.moveDshSession(item.sessionId, direction); renderDshSessions() } catch (error) { setSessionMessage(error.message, true) }
    }
    const up = action('↑', () => move('up'))
    up.disabled = index === 0
    const down = action('↓', () => move('down'))
    down.disabled = index === dshSessions.items.length - 1
    const rename = action('Rename', async () => {
      const next = window.prompt('Session name', item.title)
      if (next === null || !next.trim()) return
      try { dshSessions = await api.renameDshSession(item.sessionId, next); renderDshSessions() } catch (error) { setSessionMessage(error.message, true) }
    })
    const fork = action('Fork', async () => {
      try { setSessionMessage('Forking session…'); dshSessions = await api.forkDshSession(item.sessionId); renderDshSessions(); setSessionMessage('Fork created and selected.') } catch (error) { setSessionMessage(error.message, true) }
    })
    const archive = action('Archive', async () => {
      if (!window.confirm(`Archive “${item.title}”? Its DSH log is retained.`)) return
      try { dshSessions = await api.archiveDshSession(item.sessionId); renderDshSessions(); setSessionMessage('Session archived; its log remains on disk.') } catch (error) { setSessionMessage(error.message, true) }
    }, 'danger')
    actions.append(up, down, rename, fork, archive)
    row.append(main, actions)
    return row
  }))
}

async function refreshDshSessions() {
  try {
    dshSessions = await api.listDshSessions(sessionSearch.value)
    renderDshSessions()
    setSessionMessage('The selected session receives BMW input for this Project.')
  } catch (error) { setSessionMessage(error.message, true) }
}

async function openSessionCenter() {
  try {
    dshSessions = await api.sessionPanel(true)
    sessionOverlay.classList.remove('hidden')
    renderDshSessions()
    sessionSearch.focus()
  } catch (error) { status.textContent = error.message }
}

async function closeSessionCenter() {
  sessionOverlay.classList.add('hidden')
  await api.sessionPanel(false)
}

async function openGlobalSettings() {
  try {
    globalSettings = await api.globalSettingsPanel(true)
    settingsMessage.textContent = ''
    settingsMessage.classList.remove('error')
    settingsOverlay.classList.remove('hidden')
    renderGlobalSettings()
  } catch (error) {
    status.textContent = error.message
  }
}

async function closeGlobalSettings() {
  settingsOverlay.classList.add('hidden')
  await api.globalSettingsPanel(false)
}

function render() {
  const active = activeTab()
  if (document.activeElement !== address) address.value = active?.url || ''
  permissionBanner.classList.toggle('hidden', browserState.agentControlGranted)
  const continuity = browserState.sessionContinuity
  keepLoginButton.disabled = !continuity?.available || !continuity?.origin
  keepLoginButton.classList.toggle('enabled', continuity?.enabled === true)
  keepLoginButton.textContent = continuity?.enabled ? '✓ Keep login' : 'Keep login'
  keepLoginButton.title = continuity?.enabled
    ? `Encrypted session continuity and background keepalive are enabled for ${continuity.origin}`
    : 'Keep this site signed in using OS-protected encrypted cookies'
  tabStrip.replaceChildren(...browserState.tabs.map((tab) => {
    const button = document.createElement('button')
    button.className = `tab${tab.active ? ' active' : ''}`
    button.title = tab.url
    const source = tab.source === 'agent' ? '<span class="tab-agent">AGENT</span>' : ''
    button.innerHTML = `${source}<span class="tab-title"></span><span class="tab-close">×</span>`
    button.querySelector('.tab-title').textContent = tab.loading ? `◌ ${tab.title}` : tab.title
    button.addEventListener('click', () => api.browser({ action: 'tabs.show', tabId: tab.id }))
    button.querySelector('.tab-close').addEventListener('click', (event) => {
      event.stopPropagation()
      api.browser({ action: 'tabs.close', tabId: tab.id })
    })
    return button
  }))
}

function activeProject() {
  return projectsState.projects.find((project) => project.id === projectsState.activeProjectId)
}

function editingProject() {
  return projectsState.projects.find((project) => project.id === editingProjectId)
}

function setProjectMessage(message, error = false) {
  projectMessage.textContent = message
  projectMessage.classList.toggle('error', error)
}

async function loadProjectDocument() {
  if (creatingProject || !editingProjectId) {
    projectDocument.value = ''
    return
  }
  try {
    const result = await api.readProjectDocument(editingProjectId, documentKind)
    projectDocument.value = result.content
  } catch (error) {
    setProjectMessage(error.message, true)
  }
}

function renderProjects() {
  const active = activeProject()
  projectSwitcher.textContent = `${active?.name || 'Projects'} ▾`
  projectList.replaceChildren(...projectsState.projects.map((project) => {
    const button = document.createElement('button')
    button.className = `${project.id === editingProjectId ? 'active' : ''} ${project.id === projectsState.activeProjectId ? 'current' : ''}`
    const title = document.createElement('strong')
    title.textContent = project.name
    const url = document.createElement('small')
    url.textContent = project.homeUrl || 'Blank page'
    button.append(title, url)
    button.addEventListener('click', async () => {
      creatingProject = false
      editingProjectId = project.id
      renderProjectEditor()
      await loadProjectDocument()
    })
    return button
  }))
  renderProjectEditor()
}

function renderProjectEditor() {
  const project = editingProject()
  projectName.value = creatingProject ? '' : project?.name || ''
  projectHome.value = creatingProject ? '' : project?.homeUrl || ''
  projectDocument.disabled = creatingProject
  document.querySelectorAll('#project-doc-tabs button').forEach((button) => {
    button.disabled = creatingProject
    button.classList.toggle('active', button.dataset.kind === documentKind)
  })
  document.querySelector('#project-save').textContent = creatingProject ? 'Create project' : 'Save'
  document.querySelector('#project-archive').disabled = creatingProject || !project || projectsState.projects.length === 1
}

function checkboxList(container, items, emptyLabel, labelFor) {
  if (!items.length) {
    const empty = document.createElement('small')
    empty.textContent = emptyLabel
    container.replaceChildren(empty)
    return
  }
  container.replaceChildren(...items.map((item) => {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = typeof item === 'string' ? item : item.id
    const text = document.createElement('span')
    text.textContent = labelFor(item)
    label.append(input, text)
    return label
  }))
}

function renderImportProject() {
  const selected = importPreview.projects.find((project) => project.id === importProject.value) || importPreview.projects[0]
  checkboxList(importArtifacts, selected?.artifacts || [], 'No project artifacts available.', (item) => `${item.id} · ${Math.ceil(item.bytes / 1024)} KB`)
  document.querySelector('#import-source-row').classList.toggle('hidden', productInfo.id !== 'bmw-dev' || !selected?.canImportSource)
  document.querySelector('#import-evidence-row').classList.toggle('hidden', productInfo.id !== 'bmw-dev' || !selected?.hasLegacyEvidence)
}

async function openImportWizard() {
  try {
    importPreview = await api.productImportPreview()
    if (!importPreview.available) {
      setProjectMessage(importPreview.reason || 'No BMW Projects are available to import.', true)
      return
    }
    importProject.replaceChildren(...importPreview.projects.map((project) => {
      const option = document.createElement('option')
      option.value = project.id
      option.textContent = project.name
      return option
    }))
    checkboxList(importOrigins, importPreview.cookieOrigins || [], 'No kept-login origins available.', (origin) => origin)
    importMessage.textContent = ''
    renderImportProject()
    importOverlay.classList.remove('hidden')
  } catch (error) { setProjectMessage(error.message, true) }
}

async function openProjectManager({ create = false, initial = false } = {}) {
  projectsState = await api.projectState()
  initialProjectSetup = initial || projectsState.initialSetupPending === true
  create = create || initialProjectSetup
  editingProjectId = create ? null : projectsState.activeProjectId
  creatingProject = create
  projectOverlay.classList.toggle('initial-setup', initialProjectSetup)
  document.querySelector('#project-manager-title').textContent = initialProjectSetup ? 'Set up your first BMW Project' : 'BMW Projects'
  document.querySelector('#project-manager-subtitle').textContent = initialProjectSetup
    ? 'Name the work this browser and its DSH session will belong to'
    : 'Workspace, browser state, instructions and durable memory'
  projectOverlay.classList.remove('hidden')
  await api.projectPanel(true)
  renderProjects()
  await loadProjectDocument()
  if (create) {
    setProjectMessage(initialProjectSetup
      ? 'Your first Project becomes the browser and DSH default. Home URL is optional and defaults to a blank page.'
      : 'Create a product-owned project with isolated browser state and memory. Home URL is optional.')
    projectName.focus()
  }
}

async function closeProjectManager() {
  if (initialProjectSetup) return
  projectOverlay.classList.add('hidden')
  await api.projectPanel(false)
}

document.querySelector('#address-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  await api.browser({ action: 'navigate', tabId: browserState.activeTabId, url: address.value })
})
document.querySelector('#back').addEventListener('click', () => api.browser({ action: 'back', tabId: browserState.activeTabId }))
document.querySelector('#forward').addEventListener('click', () => api.browser({ action: 'forward', tabId: browserState.activeTabId }))
document.querySelector('#reload').addEventListener('click', () => api.browser({ action: 'reload', tabId: browserState.activeTabId }))
document.querySelector('#new-tab').addEventListener('click', () => api.browser({ action: 'tabs.open', foreground: true }))
document.querySelector('#enable-agent').addEventListener('click', () => api.setAgentControl(true))
agentToggle.addEventListener('click', async () => {
  agentVisible = !agentVisible
  await api.toggleAgent(agentVisible)
  agentToggle.classList.toggle('off', !agentVisible)
})
status.addEventListener('click', async () => {
  if (!layoutState.configured || !agentVisible) return
  try {
    layoutState = { ...layoutState, ...(await api.configureLayout({
      mode: layoutState.mode === 'overlay' ? 'sidebar' : 'overlay',
      overlayFullscreen: false
    })) }
    renderDshStatus()
  } catch (error) {
    status.textContent = error.message
  }
})
recordButton.addEventListener('click', async () => {
  const action = recording ? 'media.record.stop' : 'media.record.start'
  try {
    await api.browser({ action, tabId: browserState.activeTabId })
  } catch (error) {
    status.textContent = error.message
  }
})
keepLoginButton.addEventListener('click', async () => {
  const enabled = browserState.sessionContinuity?.enabled !== true
  try {
    await api.setSessionContinuity(enabled)
  } catch (error) {
    status.textContent = error.message
  }
})
projectSwitcher.addEventListener('click', async () => {
  try {
    await api.projectMenu()
  } catch (error) {
    status.textContent = error.message
  }
})
layoutButton.addEventListener('click', openLayoutEditor)
sessionButton.addEventListener('click', openSessionCenter)
scheduledTaskButton.addEventListener('click', openScheduledTasks)
settingsButton.addEventListener('click', openGlobalSettings)
document.querySelector('#settings-close').addEventListener('click', closeGlobalSettings)
document.querySelector('#settings-dsh-advanced').addEventListener('click', async () => {
  try {
    settingsOverlay.classList.add('hidden')
    await api.openDshAdvancedSettings()
  } catch (error) {
    settingsOverlay.classList.remove('hidden')
    settingsMessage.textContent = error.message
    settingsMessage.classList.add('error')
  }
})
settingsRestart.textContent = `Restart ${productInfo.name}…`
settingsRestart.addEventListener('click', async () => {
  settingsMessage.textContent = 'Checking whether BMW can restart safely…'
  settingsMessage.classList.remove('error')
  settingsRestart.disabled = true
  try {
    const result = await api.restartApplication()
    if (!result?.restarting) settingsMessage.textContent = result?.message || 'Restart cancelled.'
  } catch (error) {
    settingsMessage.textContent = error.message
    settingsMessage.classList.add('error')
  } finally {
    settingsRestart.disabled = false
  }
})
settingsProxyMode.addEventListener('change', () => settingsProxyManual.classList.toggle('hidden', settingsProxyMode.value !== 'manual'))
settingsSearchEngine.addEventListener('change', () => settingsCustomSearchRow.classList.toggle('hidden', settingsSearchEngine.value !== 'custom'))
document.querySelector('#settings-save').addEventListener('click', async () => {
  settingsMessage.textContent = 'Applying…'
  settingsMessage.classList.remove('error')
  try {
    globalSettings = await api.updateGlobalSettings({
      theme: settingsTheme.value,
      proxyMode: settingsProxyMode.value,
      proxyRules: settingsProxyRules.value,
      proxyBypassRules: settingsProxyBypass.value,
      searchEngine: settingsSearchEngine.value,
      customSearchUrl: settingsCustomSearch.value,
      newTabPage: settingsNewTab.value,
      dshSidebarVisible: settingsDshSidebar.checked
    })
    if (productInfo.id === 'bmw-dev') {
      webRuntimeSettings = await api.updateWebRuntimeSettings({
        moduleUrl: settingsWebContainerModule.value,
        apiKey: settingsWebContainerKey.value
      })
      settingsWebContainerKey.value = ''
    }
    renderGlobalSettings()
    settingsMessage.textContent = 'Saved. BMW Shell, DSH, compatible pages, searches and network connections use these settings.'
  } catch (error) {
    settingsMessage.textContent = error.message
    settingsMessage.classList.add('error')
  }
})
document.querySelector('#session-close').addEventListener('click', closeSessionCenter)
document.querySelector('#scheduled-task-close').addEventListener('click', closeScheduledTasks)
document.querySelector('#scheduled-task-refresh').addEventListener('click', refreshScheduledTasks)
document.querySelector('#session-refresh').addEventListener('click', refreshDshSessions)
document.querySelector('#session-new').addEventListener('click', async () => {
  try {
    setSessionMessage('Creating a BMW browser-only session…')
    dshSessions = await api.createDshSession()
    sessionSearch.value = ''
    renderDshSessions()
    setSessionMessage('New session created and selected.')
  } catch (error) { setSessionMessage(error.message, true) }
})
sessionSearch.addEventListener('input', () => {
  clearTimeout(sessionSearchTimer)
  sessionSearchTimer = setTimeout(refreshDshSessions, 250)
})
document.querySelector('#layout-close').addEventListener('click', closeLayoutEditor)
document.querySelectorAll('[data-layout-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    editingLayoutMode = button.dataset.layoutMode
    renderLayoutEditor()
  })
})
document.querySelectorAll('[data-opacity]').forEach((button) => {
  button.addEventListener('click', () => {
    editingOpacity = Number(button.dataset.opacity)
    renderLayoutEditor()
  })
})
layoutWidth.addEventListener('input', () => { layoutWidthOutput.value = `${layoutWidth.value} px` })
document.querySelector('#layout-apply').addEventListener('click', async () => {
  layoutMessage.textContent = ''
  try {
    layoutState = await api.configureLayout({
      mode: editingLayoutMode,
      sidebarWidth: Number(layoutWidth.value),
      opacity: editingOpacity,
      overlayFullscreen: editingLayoutMode === 'overlay' && layoutFullscreen.checked
    })
    layoutOverlay.classList.add('hidden')
  } catch (error) {
    layoutMessage.textContent = error.message
  }
})
document.querySelector('#project-close').addEventListener('click', closeProjectManager)
projectImport.addEventListener('click', openImportWizard)
importProject.addEventListener('change', renderImportProject)
document.querySelector('#import-close').addEventListener('click', () => importOverlay.classList.add('hidden'))
document.querySelector('#import-confirm').addEventListener('click', async () => {
  importMessage.textContent = 'Importing selected data…'
  try {
    const result = await api.productImportProject({
      projectId: importProject.value,
      includeDocuments: document.querySelector('#import-documents').checked,
      includeHomeUrl: document.querySelector('#import-home').checked,
      includeTabs: document.querySelector('#import-tabs').checked,
      includeSource: document.querySelector('#import-source').checked,
      includeLegacyEvidence: document.querySelector('#import-evidence').checked,
      artifactIds: [...importArtifacts.querySelectorAll('input:checked')].map((input) => input.value),
      cookieOrigins: [...importOrigins.querySelectorAll('input:checked')].map((input) => input.value)
    })
    projectsState = result.state
    editingProjectId = result.project.id
    creatingProject = false
    initialProjectSetup = false
    importOverlay.classList.add('hidden')
    projectOverlay.classList.add('hidden')
    await api.projectPanel(false)
    renderProjects()
    if (!layoutState.configured) await openLayoutEditor()
  } catch (error) {
    importMessage.textContent = error.message
    importMessage.classList.add('error')
  }
})
document.querySelector('#project-new').addEventListener('click', () => {
  creatingProject = true
  editingProjectId = null
  setProjectMessage('Create a product-owned project with isolated browser state and memory. Home URL is optional.')
  renderProjectEditor()
  projectName.focus()
})
document.querySelectorAll('#project-doc-tabs button').forEach((button) => {
  button.addEventListener('click', async () => {
    documentKind = button.dataset.kind
    renderProjectEditor()
    await loadProjectDocument()
  })
})
document.querySelector('#project-save').addEventListener('click', async () => {
  setProjectMessage('Saving…')
  try {
    if (creatingProject) {
      const wasInitialSetup = initialProjectSetup
      projectsState = await api.createProject({ name: projectName.value, homeUrl: projectHome.value })
      creatingProject = false
      initialProjectSetup = false
      editingProjectId = projectsState.activeProjectId
      renderProjects()
      await loadProjectDocument()
      if (wasInitialSetup) {
        projectOverlay.classList.remove('initial-setup')
        await closeProjectManager()
        if (!layoutState.configured) await openLayoutEditor()
        return
      }
      setProjectMessage('Project created and connected to DSH.')
      return
    }
    projectsState = await api.updateProject(editingProjectId, { name: projectName.value, homeUrl: projectHome.value })
    await api.writeProjectDocument(editingProjectId, documentKind, projectDocument.value)
    renderProjects()
    setProjectMessage('Saved. AGENTS.md and MEMORY.md apply to the next fresh project session.')
  } catch (error) {
    setProjectMessage(error.message, true)
  }
})
document.querySelector('#project-archive').addEventListener('click', async () => {
  const project = editingProject()
  if (!project || !window.confirm(`Archive “${project.name}”? Files and DSH session logs are retained.`)) return
  try {
    projectsState = await api.archiveProject(project.id)
    editingProjectId = projectsState.activeProjectId
    renderProjects()
    await loadProjectDocument()
    setProjectMessage('Project archived; its files and session logs were retained.')
  } catch (error) {
    setProjectMessage(error.message, true)
  }
})

api.onBrowserState((value) => { browserState = value; render() })
api.onDshStatus((value) => {
  dshStatusState = value
  renderDshStatus()
})
api.onDshLog((entry) => {
  if (entry.stream === 'stderr' && /error/i.test(entry.text)) status.textContent = entry.text.trim().slice(0, 180)
})
api.onMediaStatus((value) => {
  recording = value.active === true
  recordingIndicator.classList.toggle('hidden', !recording)
  recordButton.textContent = recording ? '■ Stop' : '● Record'
})
api.onLayout((value) => {
  layoutState = { ...layoutState, ...value }
  agentVisible = value.agentVisible
  agentToggle.classList.toggle('off', !agentVisible)
  renderDshStatus()
  if (value.setupVisible && layoutOverlay.classList.contains('hidden')) showLayoutEditor(value)
})
api.onProjectState((value) => {
  const activeChanged = projectsState.activeProjectId !== value.activeProjectId
  projectsState = value
  if (!editingProjectId) editingProjectId = value.activeProjectId
  renderProjects()
  if (activeChanged && !scheduledTaskOverlay.classList.contains('hidden')) void refreshScheduledTasks()
})
api.onProjectManagerOpen((value) => {
  void openProjectManager({ create: value?.mode === 'create', initial: value?.initial === true }).catch((error) => { status.textContent = error.message })
})
api.productInfo().then((product) => {
  productInfo = product
  productBrand.textContent = product.name
  settingsRestart.textContent = `Restart ${product.name}…`
  document.title = product.name
  projectImport.classList.toggle('hidden', !product.canImportFromBase)
  if (product.id === 'bmw-dev') api.webRuntimeSettings().then((value) => { webRuntimeSettings = value; renderGlobalSettings() }).catch(() => {})
  renderGlobalSettings()
}).catch(() => {})
api.browser({ action: 'status' }).then((value) => { browserState = value; render() })
Promise.all([api.projectState(), api.layoutSettings()]).then(async ([projectValue, layoutValue]) => {
  projectsState = projectValue
  editingProjectId = projectValue.activeProjectId
  layoutState = { ...layoutState, ...layoutValue }
  renderDshStatus()
  renderProjects()
  if (projectValue.initialSetupPending) {
    await openProjectManager({ create: true, initial: true })
  } else if (!layoutValue.configured || layoutValue.setupVisible) {
    showLayoutEditor(layoutValue)
  }
}).catch((error) => { status.textContent = error.message })
api.globalSettings().then((value) => { globalSettings = value; renderGlobalSettings() })
api.onGlobalSettings((value) => { globalSettings = value; renderGlobalSettings() })
api.onScheduledTaskState((value) => {
  scheduledTaskState = value
  if (!scheduledTaskOverlay.classList.contains('hidden')) renderScheduledTasks()
})
api.onScheduledTaskOpen(() => {
  scheduledTaskOverlay.classList.remove('hidden')
  void refreshScheduledTasks()
})
