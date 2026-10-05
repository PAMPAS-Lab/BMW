import { VideoOptionsForm } from '../../../media-native/src/video-options-form.js'
import { normalizeVideoPreferences, saveVideoTemplate } from '../../../media-native/src/video-options.js'
import type { VideoPreferences } from '../../../media-native/src/video-options.js'
import { parseAgentContextState } from '../../../agent-contract/index.js'
import type { AgentContextState } from '../../../agent-contract/index.js'
const api = window.bmw
const productBrand = document.querySelector('#product-brand')
const address = document.querySelector('#address')
const tabStrip = document.querySelector('#tabs-list')
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
let videoPreferencesDraft:VideoPreferences=normalizeVideoPreferences(),videoPreferencesExpected:VideoPreferences=normalizeVideoPreferences(),videoPreferencesDirty=false
const videoOptionsForm=new VideoOptionsForm(document.querySelector('#settings-video-options') as HTMLElement,'settings-video',()=>{videoPreferencesDirty=true})
const videoTemplateSelect=document.querySelector('#settings-video-template') as HTMLSelectElement
const videoTemplateName=document.querySelector('#settings-video-template-name') as HTMLInputElement
const videoTemplateNote=document.querySelector('#settings-video-template-note') as HTMLElement
function renderVideoTemplates():void{const selected=videoTemplateSelect.value;videoTemplateSelect.replaceChildren(new Option('选择模板…',''),...videoPreferencesDraft.templates.map(item=>new Option(item.name,item.name)));videoTemplateSelect.value=selected}
const settingsEdgeNarration = document.querySelector('#settings-edge-narration') as HTMLInputElement
const settingsAgentSidebar = document.querySelector('#settings-agent-sidebar')
const settingsRestart = document.querySelector('#settings-restart')
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

type ToolbarPopup = 'more' | 'site' | null
const moreButton = (document.querySelector('#more-button') as HTMLButtonElement)
const siteSettingsButton = (document.querySelector('#site-settings-button') as HTMLButtonElement)
let toolbarPopup: ToolbarPopup = null
let popupUpdates: Promise<void> = Promise.resolve()
let returnToSettings = false
function setToolbarPopup(next: ToolbarPopup): Promise<void> {
  toolbarPopup = next
  document.querySelector('#more-menu')!.classList.toggle('hidden', next !== 'more')
  document.querySelector('#site-settings-menu')!.classList.toggle('hidden', next !== 'site')
  document.querySelector('#toolbar-dismiss')!.classList.toggle('hidden', next === null)
  document.body.classList.toggle('toolbar-popup-open', next !== null)
  moreButton.setAttribute('aria-expanded', String(next === 'more'))
  siteSettingsButton.setAttribute('aria-expanded', String(next === 'site'))
  if (next === 'site') {
    const bounds = siteSettingsButton.getBoundingClientRect()
    const popup = (document.querySelector('#site-settings-menu') as HTMLElement)
    popup.style.left = Math.max(8, Math.min(bounds.left, window.innerWidth - 328)) + 'px'
  }
  popupUpdates = popupUpdates.catch(() => {}).then(async () => {
    await api.toolbarPanel(next !== null)
  })
  return popupUpdates
}
function chooseSettingsCategory(category: string): void {
  ;(document.querySelectorAll('[data-settings-section]') as HTMLElement[]).forEach(section => {
    section.classList.toggle('hidden', section.dataset.settingsSection !== category)
  })
  ;(document.querySelectorAll('[data-settings-category]') as HTMLButtonElement[]).forEach(button => {
    const active = button.dataset.settingsCategory === category
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
}
async function restoreSettingsAfterLayout(): Promise<void> {
  if (!returnToSettings) return
  returnToSettings = false
  await api.globalSettingsPanel(true)
  settingsOverlay.classList.remove('hidden')
}

let browserState: Record<string, any> = { tabs: [], activeTabId: null, agentControlGranted: false }
let recording = false
let agentVisible = true
let layoutState: Record<string, any> = { configured: false, mode: 'sidebar', sidebarWidth: 460, opacity: 1, overlayFullscreen: false, setupVisible: false }
let agentStatusState: Record<string, any> = { state: 'starting' }
let editingLayoutMode = 'sidebar'
let editingOpacity = 1
let projectsState: Record<string, any> = { activeProjectId: null, projects: [] }
let editingProjectId = null
let projectListSignature = ''
let projectDocumentRequest = 0
let projectDocumentLoading = false
let projectDocumentLoaded = false
let projectSavePending = false
let documentKind = 'instructions'
let creatingProject = false
let initialProjectSetup = false
let globalSettings: Record<string, any> = { proxyMode: 'system', proxyRules: '', proxyBypassRules: '<local>', searchEngine: 'google', customSearchUrl: '', newTabPage: 'search', theme: 'dark', agentSidebarVisible: false }
let agentSessions: Record<string, any> = { selectedSessionId: null, items: [] }
let sessionSearchTimer
let productInfo = { id: 'bmw', name: 'BMW', agent: {id:'',label:'Agent',baseline:''} }
let scheduledTaskState: Record<string, any> = { tasks: [], runs: [] }


let contextState:AgentContextState={state:'starting'}
function renderContext():void{
 const context=contextState.context,project=activeProject()
 const name=project?.name||'No project'
 const linked=Boolean(context&&project&&context.projectId===project.id)
 document.querySelector('#context-project').textContent='Project: '+name
 const workspace=document.querySelector('#context-workspace')
 workspace.textContent='↔ Workspace: '+(linked?context.workspaceTitle:project?.agentBindings?.[productInfo.agent.id]?.workspaceId?name:'Connecting…')
 workspace.title=linked?context.directory:'Each BMW Project has one Agent Workspace'
 const selected=document.querySelector('#context-session')
 selected.textContent='Conversation: '+(contextState.state==='empty'?'None selected':linked?context.sessionTitle:'Connecting…')+' ▾'
 selected.title=linked?`Selected conversation · ${context.sessionCount} sessions in this Workspace`:'Choose a conversation in this Project'
 document.querySelector('#context-pages').textContent=`${browserState.tabs.length} pages · shared across conversations`
 const message=document.querySelector('#context-message')
 message.textContent=contextState.message||''
 message.classList.toggle('hidden',!contextState.message)
 document.querySelector('#context-strip').classList.toggle('context-error',contextState.state==='error')
 document.querySelector('#session-workspace').textContent=`Project: ${name} ↔ Workspace: ${linked?context.workspaceTitle:name} · ${agentSessions.items.length} sessions · shared Project pages`
}
function receiveAgentContext(value:unknown):void{
 try{const next=parseAgentContextState(value);contextState={...next,context:next.context||contextState.context};renderContext();if(!sessionOverlay.classList.contains('hidden'))void refreshAgentSessions()}
 catch(error:unknown){contextState={...contextState,state:'error',message:error instanceof Error?error.message:String(error)};renderContext()}
}

function activeTab() {
  return browserState.tabs.find((tab) => tab.id === browserState.activeTabId)
}

function renderAgentStatus() {
  const labels = {
    starting: 'Starting Agent…',
    ready: 'Agent ready',
    stopped: 'Agent stopped',
    error: `Agent error: ${agentStatusState.message || 'Unknown error'}`
  }
  const base = labels[agentStatusState.state] || `Agent ${agentStatusState.state}`
  status.textContent = base.replace('Agent', 'Assistant')
  status.title = agentStatusState.message || 'Assistant runtime status'
  agentToggle.setAttribute('aria-pressed', String(agentVisible))
  agentToggle.title = agentVisible ? 'Hide assistant panel. Running tasks continue.' : 'Show assistant panel. Browser permission is unchanged.'

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
    ? 'Move and resize the BMW-owned Agent window with its native title bar and edges. Escape exits full screen.'
    : 'Choose the Agent panel width; the browser automatically receives the remaining space.'
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
  await restoreSettingsAfterLayout()
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
    empty.textContent = 'No scheduled tasks. Describe one directly to Agent in natural language.'
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
    schedule.textContent = `Daily ${task.schedule.time} · ${task.schedule.timeZone} · next ${scheduledTaskTime(task.nextRunAt)} · ${task.driverId || '未绑定驱动'} · ${task.sessionId || '未绑定会话'}`
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
        scheduledTaskMessage.textContent = `Queued “${task.name}”. Agent will run it in the background.`
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
    const bind=document.createElement('button');bind.textContent='绑定当前会话';bind.disabled=Boolean(activeRun)
    bind.addEventListener('click',async()=>{try{await api.bindScheduledTask(task.id);await refreshScheduledTasks()}catch(error){scheduledTaskMessage.textContent=error.message}})
    actions.append(enabledLabel, runNow, bind, remove)
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
  if(!videoPreferencesDirty){videoPreferencesDraft=normalizeVideoPreferences(globalSettings.videoPreferences??{});videoPreferencesExpected=structuredClone(videoPreferencesDraft);videoOptionsForm.fill(videoPreferencesDraft.defaults);renderVideoTemplates()}
  settingsTheme.value = globalSettings.theme || 'dark'
  settingsProxyMode.value = globalSettings.proxyMode
  settingsProxyRules.value = globalSettings.proxyRules || ''
  settingsProxyBypass.value = globalSettings.proxyBypassRules || ''
  settingsSearchEngine.value = globalSettings.searchEngine
  settingsCustomSearch.value = globalSettings.customSearchUrl || ''
  settingsNewTab.value = globalSettings.newTabPage
  settingsAgentSidebar.checked = globalSettings.agentSidebarVisible === true
  settingsEdgeNarration.checked = globalSettings.edgeNarrationEnabled === true
  settingsProxyManual.classList.toggle('hidden', settingsProxyMode.value !== 'manual')
  settingsCustomSearchRow.classList.toggle('hidden', settingsSearchEngine.value !== 'custom')

}

function sessionTime(value) {
  const date = new Date(Number(value))
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

function setSessionMessage(message, error = false) {
  sessionMessage.textContent = message
  sessionMessage.style.color = error ? '#ff8793' : ''
}

function renderAgentSessions() {
  renderContext()
  const project = activeProject()
  sessionTitle.textContent = `${project?.name || 'Project'} · Conversations`
  if (!agentSessions.items?.length) {
    const empty = document.createElement('div')
    empty.className = 'session-empty'
    empty.textContent = sessionSearch.value.trim() ? 'No matching sessions in this Project.' : 'No visible session yet. Create one to start.'
    sessionList.replaceChildren(empty)
    return
  }
  sessionList.replaceChildren(...agentSessions.items.map((item, index) => {
    const row = document.createElement('article')
    row.className = `session-row${item.sessionId === agentSessions.selectedSessionId ? ' selected' : ''}`
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
    badge.textContent = item.running ? 'Running' : item.sessionId === agentSessions.selectedSessionId ? 'Current' : item.blank ? 'New' : 'Idle'
    titleRow.append(title, badge)
    const meta = document.createElement('small')
    meta.textContent = [item.snippet, sessionTime(item.updatedAt), item.parentSessionId ? 'Fork' : '', item.agentPreset || 'bmw'].filter(Boolean).join(' · ')
    main.append(titleRow, meta)
    const select = async () => {
      if (item.sessionId === agentSessions.selectedSessionId) return
      try {
        setSessionMessage('Switching Agent session…')
        agentSessions = await api.selectAgentSession(item.sessionId)
        renderAgentSessions()
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
      try { agentSessions = await api.moveAgentSession(item.sessionId, direction); renderAgentSessions() } catch (error) { setSessionMessage(error.message, true) }
    }
    const up = action('↑', () => move('up'))
    up.disabled = index === 0
    const down = action('↓', () => move('down'))
    down.disabled = index === agentSessions.items.length - 1
    const rename = action('Rename', async () => {
      const next = window.prompt('Session name', item.title)
      if (next === null || !next.trim()) return
      try { agentSessions = await api.renameAgentSession(item.sessionId, next); renderAgentSessions() } catch (error) { setSessionMessage(error.message, true) }
    })
    const fork = action('Fork', async () => {
      try { setSessionMessage('Forking session…'); agentSessions = await api.forkAgentSession(item.sessionId); renderAgentSessions(); setSessionMessage('Fork created and selected.') } catch (error) { setSessionMessage(error.message, true) }
    })
    fork.disabled=item.canFork===false||item.running
    if(item.canFork===false)fork.title='This driver has not enabled verified conversation branching'
    const archive = action('Archive', async () => {
      if (!window.confirm(`Archive “${item.title}”? Its Agent log is retained.`)) return
      try { agentSessions = await api.archiveAgentSession(item.sessionId); renderAgentSessions(); setSessionMessage('Session archived; its log remains on disk.') } catch (error) { setSessionMessage(error.message, true) }
    }, 'danger')
    actions.append(up, down, rename, fork, archive)
    row.append(main, actions)
    return row
  }))
}

async function refreshAgentSessions() {
  try {
    agentSessions = await api.listAgentSessions(sessionSearch.value)
    renderAgentSessions()
    setSessionMessage('The selected session receives BMW input for this Project.')
  } catch (error) { setSessionMessage(error.message, true) }
}

async function openSessionCenter() {
  try {
    agentSessions = await api.sessionPanel(true)
    sessionOverlay.classList.remove('hidden')
    renderAgentSessions()
    sessionSearch.focus()
  } catch (error) { status.textContent = error.message }
}

async function closeSessionCenter() {
  sessionOverlay.classList.add('hidden')
  await api.sessionPanel(false)
}

async function openGlobalSettings() {
  try {
    videoPreferencesDirty=false
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
  videoPreferencesDirty=false
  await api.globalSettingsPanel(false)
}

function render() {
  const active = activeTab()
  if (document.activeElement !== address) address.value = active?.url || ''
  permissionBanner.classList.toggle('hidden', browserState.agentControlGranted)
  const continuity = browserState.sessionContinuity
  document.querySelector('#site-settings-origin').textContent = continuity?.origin || 'No HTTP(S) website selected'
  document.querySelector('#site-settings-note').textContent = !continuity?.origin ? 'Open a website to configure saved login.' : !continuity.available ? 'OS-protected encryption is unavailable.' : continuity.enabled ? 'Saved login is enabled for this website.' : 'Saved login is off. Enabling it requires confirmation.'
  siteSettingsButton.classList.toggle('enabled', continuity?.enabled === true)
  siteSettingsButton.title = 'Site settings: ' + (continuity?.origin || 'current page')
  keepLoginButton.setAttribute('aria-pressed', String(continuity?.enabled === true))
  keepLoginButton.disabled = !continuity?.available || !continuity?.origin
  keepLoginButton.classList.toggle('enabled', continuity?.enabled === true)
  keepLoginButton.textContent = continuity?.enabled ? '✓ Keep signed in' : 'Keep signed in'
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
  const request = ++projectDocumentRequest
  const projectId = editingProjectId
  const kind = documentKind
  projectDocument.value = ''
  projectDocumentLoaded = false
  projectDocumentLoading = !creatingProject && Boolean(projectId)
  renderProjectEditor({ preserveDraft: true })
  if (!projectDocumentLoading) return
  const current = () => request === projectDocumentRequest && projectId === editingProjectId && kind === documentKind && !creatingProject && !projectOverlay.classList.contains('hidden')
  try {
    const result = await api.readProjectDocument(projectId, kind)
    if (current()) { projectDocument.value = result.content; projectDocumentLoaded = true }
  } catch (error) {
    if (current()) setProjectMessage(error.message, true)
  } finally {
    if (current()) {
      projectDocumentLoading = false
      renderProjectEditor({ preserveDraft: true })
    }
  }
}

function renderProjects({ preserveDraft = false } = {}) {
  const active = activeProject()
  projectSwitcher.textContent = `${active?.name || 'Projects'} ▾`
  // Tab-state broadcasts must not replace a button between native mouse down/up.
  const signature = JSON.stringify(projectsState.projects.map(project => [project.id, project.name, project.homeUrl]))
  if (signature !== projectListSignature) {
    projectListSignature = signature
    projectList.replaceChildren(...projectsState.projects.map((project) => {
      const button = document.createElement('button')
      button.dataset.projectId = project.id
      const title = document.createElement('strong')
      title.textContent = project.name
      const url = document.createElement('small')
      url.textContent = project.homeUrl || 'Blank page'
      button.append(title, url)
      button.addEventListener('click', async () => {
        if (projectSavePending || (!creatingProject && editingProjectId === project.id)) return
        creatingProject = false
        editingProjectId = project.id
        setProjectMessage('')
        renderProjects()
        await loadProjectDocument()
      })
      return button
    }))
  }
  ;(projectList.querySelectorAll('button') as HTMLButtonElement[]).forEach(button => {
    const selected = !creatingProject && button.dataset.projectId === editingProjectId
    button.classList.toggle('active', selected)
    button.classList.toggle('current', button.dataset.projectId === projectsState.activeProjectId)
    button.setAttribute('aria-pressed', String(selected))
    button.disabled = projectSavePending
  })
  renderProjectEditor({ preserveDraft })
  renderContext()
}

function renderProjectEditor({ preserveDraft = false } = {}) {
  const project = editingProject()
  if (!preserveDraft) {
    projectName.value = creatingProject ? '' : project?.name || ''
    projectHome.value = creatingProject ? '' : project?.homeUrl || ''
  }
  const binding=document.querySelector('#project-binding')
  binding.textContent=creatingProject?'Each Project links one Workspace; its sessions share pages and media.':`Project: ${project?.name||''} ↔ Workspace: ${project?.agentBindings?.[productInfo.agent.id]?.workspaceId?project.name:'Connecting…'}. ${project?.id===projectsState.activeProjectId&&contextState.context?.projectId===project.id?'Selected session: '+contextState.context.sessionTitle:'Select this Project to see its conversations.'} Sessions share this Project’s pages and media.`
  projectDocument.disabled = creatingProject || projectDocumentLoading || projectSavePending
  projectName.disabled = projectSavePending
  projectHome.disabled = projectSavePending
  document.querySelector('#project-new').disabled = projectSavePending
  document.querySelector('#project-close').disabled = projectSavePending
  document.querySelectorAll('#project-doc-tabs button').forEach((button) => {
    button.disabled = creatingProject || projectSavePending
    button.classList.toggle('active', button.dataset.kind === documentKind)
  })
  document.querySelector('#project-save').textContent = creatingProject ? 'Create project' : 'Save'
  document.querySelector('#project-save').disabled = projectDocumentLoading || projectSavePending || (!creatingProject && !projectDocumentLoaded)
  document.querySelector('#project-archive').disabled = creatingProject || projectSavePending || !project || projectsState.projects.length === 1
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
    ? 'Name the work this browser and its Agent session will belong to'
    : 'Workspace, browser state, instructions and durable memory'
  projectOverlay.classList.remove('hidden')
  await api.projectPanel(true)
  renderProjects()
  await loadProjectDocument()
  if (create) {
    setProjectMessage(initialProjectSetup
      ? 'Your first Project becomes the browser and Agent default. Home URL is optional and defaults to a blank page.'
      : 'Create a product-owned project with isolated browser state and memory. Home URL is optional.')
    projectName.focus()
  }
}

async function closeProjectManager() {
  if (initialProjectSetup) return
  if (projectSavePending) return
  projectOverlay.classList.add('hidden')
  projectDocumentRequest++
  projectDocumentLoading = false
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
  renderAgentStatus()
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
layoutButton.addEventListener('click', async () => {
  returnToSettings = true
  settingsOverlay.classList.add('hidden')
  await api.globalSettingsPanel(false)
  await openLayoutEditor()
  if (layoutOverlay.classList.contains('hidden')) await restoreSettingsAfterLayout()
})
document.querySelector('#video-studio-button')!.addEventListener('click',async()=>{
  try {await setToolbarPopup(null);await api.openProductPanel('video-studio')}catch(error:unknown){status.textContent=String(error)}
})
moreButton.addEventListener('click', async () => {
  try { await setToolbarPopup(toolbarPopup === 'more' ? null : 'more'); if (toolbarPopup === 'more') scheduledTaskButton.focus() }
  catch (error: unknown) { status.textContent = String(error); void setToolbarPopup(null) }
})
siteSettingsButton.addEventListener('click', async () => {
  try { await setToolbarPopup(toolbarPopup === 'site' ? null : 'site'); if (toolbarPopup === 'site') keepLoginButton.focus() }
  catch (error: unknown) { status.textContent = String(error); void setToolbarPopup(null) }
})
document.querySelector('#toolbar-dismiss').addEventListener('click', () => void setToolbarPopup(null))
document.querySelector('.chrome').addEventListener('pointerdown', (event: PointerEvent) => {
  if (toolbarPopup && event.target instanceof Element && !event.target.closest('#more-button, #site-settings-button')) void setToolbarPopup(null)
})
let toolbarViewportWidth = window.innerWidth
window.addEventListener('resize', () => {
  if (toolbarViewportWidth !== window.innerWidth && toolbarPopup) void setToolbarPopup(null)
  toolbarViewportWidth = window.innerWidth
})
document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && toolbarPopup) {
    const previous = toolbarPopup
    void setToolbarPopup(null).then(() => (previous === 'more' ? moreButton : siteSettingsButton).focus())
    event.preventDefault()
  }
  if (toolbarPopup === 'more' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    ;(document.activeElement === scheduledTaskButton ? settingsButton : scheduledTaskButton).focus()
    event.preventDefault()
  }
})
;(document.querySelectorAll('[data-settings-category]') as HTMLButtonElement[]).forEach(button => button.addEventListener('click', () => chooseSettingsCategory(button.dataset.settingsCategory!)))
scheduledTaskButton.addEventListener('click', async () => { await setToolbarPopup(null); await openScheduledTasks() })
settingsButton.addEventListener('click', async () => { await setToolbarPopup(null); await openGlobalSettings(); chooseSettingsCategory('browser') })
document.querySelector('#settings-close').addEventListener('click', closeGlobalSettings)
document.querySelector('#settings-agent-advanced').addEventListener('click', async () => {
  try {
    settingsOverlay.classList.add('hidden')
    await api.openAgentAdvancedSettings()
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
videoTemplateSelect.addEventListener('change',()=>{const preset=videoPreferencesDraft.templates.find(item=>item.name===videoTemplateSelect.value);if(preset){videoOptionsForm.fill(preset.options);videoTemplateName.value=preset.name;videoPreferencesDirty=true;videoTemplateNote.textContent='已载入模板。保存设置后，这些参数成为新视频的默认值。'}})
document.querySelector('#settings-video-template-save')!.addEventListener('click',()=>{try{videoPreferencesDraft=saveVideoTemplate(videoPreferencesDraft,videoTemplateName.value,videoOptionsForm.read());videoPreferencesDirty=true;renderVideoTemplates();videoTemplateSelect.value=videoTemplateName.value.trim();videoTemplateNote.textContent='模板已加入待保存设置，请点击底部保存。'}catch(error){videoTemplateNote.textContent=error instanceof Error?error.message:String(error)}})
document.querySelector('#settings-video-template-delete')!.addEventListener('click',()=>{const index=videoPreferencesDraft.templates.findIndex(item=>item.name===videoTemplateSelect.value);if(index<0){videoTemplateNote.textContent='请先选择要删除的模板。';return}videoPreferencesDraft.templates.splice(index,1);videoPreferencesDirty=true;videoTemplateSelect.value='';renderVideoTemplates();videoTemplateNote.textContent='模板已从待保存设置移除，请点击底部保存。'})
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
      agentSidebarVisible: settingsAgentSidebar.checked,
      edgeNarrationEnabled: settingsEdgeNarration.checked,
      ...(videoPreferencesDirty?{videoPreferences:{...videoPreferencesDraft,defaults:videoOptionsForm.read()},videoPreferencesExpected}:{})
    })

    videoPreferencesDirty=false
    renderGlobalSettings()
    settingsMessage.textContent = 'Saved. BMW Shell, Agent, compatible pages, searches and network connections use these settings.'
  } catch (error) {
    settingsMessage.textContent = error.message
    settingsMessage.classList.add('error')
  }
})
document.querySelector('#session-close').addEventListener('click', closeSessionCenter)
document.querySelector('#scheduled-task-close').addEventListener('click', closeScheduledTasks)
document.querySelector('#scheduled-task-refresh').addEventListener('click', refreshScheduledTasks)
document.querySelector('#session-refresh').addEventListener('click', refreshAgentSessions)
document.querySelector('#session-new').addEventListener('click', async () => {
  try {
    setSessionMessage('Creating a BMW browser-only session…')
    agentSessions = await api.createAgentSession()
    sessionSearch.value = ''
    renderAgentSessions()
    setSessionMessage('New session created and selected.')
  } catch (error) { setSessionMessage(error.message, true) }
})
sessionSearch.addEventListener('input', () => {
  clearTimeout(sessionSearchTimer)
  sessionSearchTimer = setTimeout(refreshAgentSessions, 250)
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
    await restoreSettingsAfterLayout()
  } catch (error) {
    layoutMessage.textContent = error.message
  }
})
document.querySelector('#project-close').addEventListener('click', closeProjectManager)
document.querySelector('#project-new').addEventListener('click', () => {
  creatingProject = true
  editingProjectId = null
  setProjectMessage('Create a product-owned project with isolated browser state and memory. Home URL is optional.')
  renderProjects()
  void loadProjectDocument()
  projectName.focus()
})
document.querySelectorAll('#project-doc-tabs button').forEach((button) => {
  button.addEventListener('click', async () => {
    documentKind = button.dataset.kind
    renderProjectEditor({ preserveDraft: true })
    await loadProjectDocument()
  })
})
document.querySelector('#project-save').addEventListener('click', async () => {
  if (projectDocumentLoading || projectSavePending || (!creatingProject && !projectDocumentLoaded)) return
  const projectId = editingProjectId
  const kind = documentKind
  const content = projectDocument.value
  const input = { name: projectName.value, homeUrl: projectHome.value }
  projectSavePending = true
  renderProjects({ preserveDraft: true })
  setProjectMessage('Saving…')
  try {
    if (creatingProject) {
      const wasInitialSetup = initialProjectSetup
      projectsState = await api.createProject(input)
      creatingProject = false
      initialProjectSetup = false
      editingProjectId = projectsState.activeProjectId
      renderProjects()
      await loadProjectDocument()
      if (wasInitialSetup) {
        projectOverlay.classList.remove('initial-setup')
        projectSavePending = false
        await closeProjectManager()
        if (!layoutState.configured) await openLayoutEditor()
        return
      }
      setProjectMessage('Project created and connected to Agent.')
      return
    }
    projectsState = await api.updateProject(projectId, input)
    await api.writeProjectDocument(projectId, kind, content)
    renderProjects()
    setProjectMessage('Saved. AGENTS.md and MEMORY.md apply to the next fresh project session.')
  } catch (error) {
    setProjectMessage(error.message, true)
  }
  finally {
    projectSavePending = false
    renderProjects({ preserveDraft: true })
  }
})
document.querySelector('#project-archive').addEventListener('click', async () => {
  const project = editingProject()
  if (!project || !window.confirm(`Archive “${project.name}”? Files and Agent session logs are retained.`)) return
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

document.querySelector('#context-session').addEventListener('click',openSessionCenter)
api.onAgentContext(receiveAgentContext)
api.agentContext().then(receiveAgentContext).catch(()=>{})
api.onBrowserState((value) => { browserState = value; render();renderContext() })
api.onAgentStatus((value) => {
  agentStatusState = value
  renderAgentStatus()
})
api.onAgentLog((entry) => {
  if (entry.stream === 'stderr' && /error/i.test(entry.text)) status.textContent = entry.text.trim().slice(0, 180)
})
api.onMediaStatus((value) => {
  const processing = value.kind === 'processing' && value.active === true
  if (value.kind !== 'processing') recording = value.active === true
  recordingIndicator.classList.toggle('hidden', !recording && !processing)
  recordingIndicator.textContent = processing ? `● Processing media ${Math.round((Number(value.progress) || 0) * 100)}%` : '● Recording this BMW tab'
  recordButton.disabled = processing
  recordButton.textContent = processing ? 'Processing…' : recording ? '■ Stop' : '● Record'
})
api.onLayout((value) => {
  layoutState = { ...layoutState, ...value }
  receiveWorkspace({mode:value.workspaceMode})
  agentVisible = value.agentVisible
  agentToggle.classList.toggle('off', !agentVisible)
  renderAgentStatus()
  if (value.setupVisible && layoutOverlay.classList.contains('hidden')) showLayoutEditor(value)
})
api.onProjectState((value) => {
  const activeChanged = projectsState.activeProjectId !== value.activeProjectId
  projectsState = value
  const selectedRemoved = !creatingProject && !value.projects.some(project => project.id === editingProjectId)
  if (selectedRemoved) editingProjectId = value.activeProjectId
  renderProjects({ preserveDraft: !selectedRemoved })
  if (selectedRemoved && !projectOverlay.classList.contains('hidden')) void loadProjectDocument()
  if (activeChanged && !scheduledTaskOverlay.classList.contains('hidden')) void refreshScheduledTasks()
})
api.onProjectManagerOpen((value) => {
  void openProjectManager({ create: value?.mode === 'create', initial: value?.initial === true }).catch((error) => { status.textContent = error.message })
})
api.productInfo().then((product) => {
  productInfo = product
  productBrand.textContent = product.name
  document.querySelector('#settings-agent-driver').textContent = product.agent.label+' runtime · '+product.agent.baseline
  document.querySelector('#settings-agent-advanced').textContent = product.agent.ownedUI?'打开当前 Agent 的登录与模型设置':'Open '+product.agent.label+' models, input behavior, permissions & plugins'
  settingsRestart.textContent = `Restart ${product.name}…`
  document.title = product.name
  renderGlobalSettings()
}).catch(() => {})
api.browser({ action: 'status' }).then((value) => { browserState = value; render() })
Promise.all([api.projectState(), api.layoutSettings()]).then(async ([projectValue, layoutValue]) => {
  projectsState = projectValue
  editingProjectId = projectValue.activeProjectId
  layoutState = { ...layoutState, ...layoutValue }
  renderAgentStatus()
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

function receiveWorkspace(value:unknown):void {
 const state=value as {mode?:unknown};const studio=state?.mode==='studio'
 document.body.classList.toggle('video-workspace',studio)
 document.querySelector('#browser-workspace').setAttribute('aria-pressed',String(!studio))
 document.querySelector('#studio-workspace').setAttribute('aria-pressed',String(studio))
}
for(const [id,mode] of [['browser-workspace','browser'],['studio-workspace','studio']] as const)document.querySelector('#'+id).addEventListener('click',()=>{void api.setWorkspaceMode(mode).catch(error=>status.textContent=String(error))})
api.onWorkspace(receiveWorkspace)
