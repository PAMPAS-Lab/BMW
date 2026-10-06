import {defineProduct} from './product-definition.js'
import type {ResolvedProductDefinition} from './product-definition.js'
import {activateFeature} from './feature-contract.js'
import type {FeatureRuntime} from './feature-contract.js'
import {assertBrowserFeatureHost} from '@bmw-agent/browser-capability/host'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {AssistantService,loadAssistantStores} from './assistant-service.js'
import type {AgentApplicationAssembly,AssistantStores} from './assistant-service.js'
import {requireCurrentAgentData,acquireAgentDataLock} from './agent-data-format.js'
import {StateLoadError} from './state-load.js'
import {createShellIpcRegistrar} from './shell-ipc.js'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, screen, session, shell, webContents as electronWebContents, WebContentsView } from 'electron'
import type { MenuItemConstructorOptions, IpcMainEvent } from 'electron'
import { BrowserKernel } from '@bmw-agent/browser-capability/kernel'
import { createBridgeServer } from '@bmw-agent/browser-capability/bridge'
import type { AgentProject, AgentProjectContext } from '@bmw-agent/agent-contract'
import { GlobalSettingsStore } from './global-settings-store.js'
import { LayoutStore } from './layout-store.js'
import { isOverlayAtDockCorner } from './layout-docking.js'
import { isApplicationMenuShortcut, isSavePageShortcut, pageSaveType, suggestedPageFilename } from './menu-policy.js'
import {ProjectSourceStore} from './project-source-store.js'
import { MediaController } from '@bmw-agent/media-native'
import { sitePermissionDisposition } from './permission-policy.js'
import { PermissionStore } from './permission-store.js'
import { ProjectStore } from './project-store.js'
import { SessionContinuityManager } from './session-continuity.js'
import { ScheduledTaskManager } from './scheduled-task-manager.js'
import { ScheduledTaskStore } from './scheduled-task-store.js'
import { BrowserCapabilityRegistry } from '@bmw-agent/browser-capability/registry'
import { browserCompatibleUserAgent } from './browser-user-agent.js'
import { restartBlockReason } from './restart-policy.js'

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(sourceDirectory, '../../..')
let PRODUCT_NAME = 'BMW'
const TOP_BAR_HEIGHT = 102
const MIN_AGENT_WIDTH = 360

let agentAssembly: AgentApplicationAssembly
let assistantService: AssistantService | undefined
let assistantPublishTimer: ReturnType<typeof setTimeout> | undefined
let productDefinition: Readonly<ResolvedProductDefinition>

function installApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: PRODUCT_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: `Restart ${PRODUCT_NAME}…`, click: () => { void requestApplicationRestart() } },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { id: 'save-page', label: 'Save Page As…', accelerator: 'CmdOrCtrl+S', enabled: false, click: () => { void saveActiveBrowserPage() } },
        { type: 'separator' },
        ...(process.platform === 'darwin' ? [] : [
          { label: `Restart ${PRODUCT_NAME}…`, click: () => { void requestApplicationRestart() } },
          { type: 'separator' }
        ]),
        { role: process.platform === 'darwin' ? 'close' : 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { label: 'Open Application Menu', accelerator: 'CmdOrCtrl+Shift+M', click: showKeyboardApplicationMenu },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template as MenuItemConstructorOptions[]))
}

let mainWindow
let overlayWindow
let shellView
let agentView
let browserKernel
let bridge
let mediaController
let permissionStore
let sessionContinuity
let projectStore
let layoutStore
let settingsStore
let agentVisible = true
let agentWidth = 460
let projectPanelVisible = false
let layoutSetupVisible = false
let toolbarPanelVisible = false
let settingsPanelVisible = false
let sessionPanelVisible = false
let scheduledTaskPanelVisible = false
let layoutSaveTimer
let overlayDocking = false
let appQuitting = false
let bmwSession
let workspaceMode: 'browser'|'studio'='browser'
let browserAgentVisible=true
let productFeatureRuntime: FeatureRuntime | undefined
let scheduledTaskStore
let scheduledTaskManager
let scheduledExecutionProjectId = null
let releaseAgentDataLock:(()=>void)|undefined
let shutdownPromise: Promise<void> | null = null
let restartInProgress = false

let agentContextState:{state:string;context?:AgentProjectContext;message?:string}={state:'starting'}
function publishAgentContext(value:typeof agentContextState):void{agentContextState=value;sendToShell('agent-context-state',value)}
function agentProject(project): AgentProject {return {id:project.id,name:project.name,directory:project.directory}}
function selectedSession(project): string|null {return assistantService?.selected(project.id)??null}
async function withConversationMutation<T>(operation:()=>Promise<T>):Promise<T>{
 if(assistantService?.host.busy)throw new Error('Stop and drain the Agent before changing conversations')
 if(bridge?.busy)throw new Error('Finish the browser operation before changing conversations')
 publishAgentContext({state:'waiting',message:'Updating the BMW conversation…'})
 try{return await operation()}finally{await publishAssistantSelection()}
}
async function selectedAgentTurnIsRunning():Promise<boolean>{return assistantService?.host.busy===true}

function stopApplicationServices(): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    scheduledTaskManager?.stop()
    if(assistantPublishTimer)clearTimeout(assistantPublishTimer)
    const tasks: Promise<unknown>[] = []
    if(assistantService)tasks.push(assistantService.close())
    if (bridge) tasks.push(Promise.resolve(bridge.close()))
    if (sessionContinuity) tasks.push(Promise.resolve(sessionContinuity.stop()))
    if (productFeatureRuntime?.stop) tasks.push(Promise.resolve(productFeatureRuntime.stop()))
    const results = await Promise.allSettled(tasks)
    const failure = results.find((row): row is PromiseRejectedResult => row.status === 'rejected')
    if(failure)throw failure.reason
    try {
      bmwSession?.flushStorageData()
    } catch (error) {
      console.error('Failed to flush BMW browser storage during shutdown', error)
    }
    releaseAgentDataLock?.();releaseAgentDataLock=undefined
  })().catch(error=>{shutdownPromise=null;throw error})
  return shutdownPromise
}

async function requestApplicationRestart() {
  if (restartInProgress) return { restarting: true }
  const block = restartBlockReason({
    mediaCaptureActive: mediaController?.isCaptureActive?.() === true,
    scheduledTaskActive: Boolean(scheduledExecutionProjectId)
  })
  if (block) {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: `${PRODUCT_NAME} cannot restart yet`,
      message: block.message,
      detail: 'BMW keeps queued and approval-only work across restarts, but it will not interrupt an operation that is currently producing results.',
      buttons: ['OK']
    })
    return { restarting: false, blocked: true, code: block.code, message: block.message }
  }

  const agentTurnRunning = await selectedAgentTurnIsRunning()
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: `Restart ${PRODUCT_NAME}`,
    message: `Restart ${PRODUCT_NAME} now?`,
    detail: `${PRODUCT_NAME} will reopen the same product Profile, Projects, browser tabs, saved login continuity, Agent Sessions, and layout.${agentTurnRunning ? ' The current Agent response will be interrupted.' : ''}`,
    buttons: [`Restart ${PRODUCT_NAME}`, 'Cancel'],
    defaultId: agentTurnRunning ? 1 : 0,
    cancelId: 1,
    noLink: true
  })
  if (confirmation.response !== 0) return { restarting: false, cancelled: true, message: 'Restart cancelled.' }

  restartInProgress = true
  appQuitting = true
  sendToShell('application-restart-state', { state: 'stopping', productName: PRODUCT_NAME })
  await stopApplicationServices()
  app.relaunch()
  app.exit(0)
  return { restarting: true }
}

async function saveActiveBrowserPage() {
  if (!mainWindow || !browserKernel) return
  if (!browserKernel.isActivePageWebContents(electronWebContents.getFocusedWebContents())) return
  try {
    const page = browserKernel.activePageMetadata()
    console.info(`[BMW] Save page requested for "${page.title}"`)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save BMW Page',
      defaultPath: path.join(app.getPath('downloads'), suggestedPageFilename(page.title, page.url)),
      buttonLabel: 'Save',
      filters: [
        { name: 'Webpage, Complete', extensions: ['html', 'htm'] },
        { name: 'Webpage, Single File', extensions: ['mhtml'] }
      ]
    })
    if (result.canceled || !result.filePath) return
    await browserKernel.saveActivePage(result.filePath, pageSaveType(result.filePath))
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Page save failed',
      message: 'BMW could not save the active browser tab.',
      detail: error.message
    })
  }
}

function updateApplicationMenuContext(focused = electronWebContents.getFocusedWebContents()) {
  const savePage = Menu.getApplicationMenu()?.getMenuItemById('save-page')
  if (savePage) savePage.enabled = browserKernel?.isActivePageWebContents(focused) === true
}

function updateWindowThemeSurfaces() {
  const pageTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const color = pageTheme === 'dark' ? '#0a0d12' : '#f4f7fa'
  mainWindow?.setBackgroundColor(color)
  overlayWindow?.setBackgroundColor(color)
  void browserKernel?.setPageTheme(pageTheme).catch((error) => console.error('Failed to synchronize browser page theme', error))
}

function applyProductTheme(theme) {
  nativeTheme.themeSource = theme
  updateWindowThemeSurfaces()
}

function showKeyboardApplicationMenu() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  console.info('[BMW] Application menu opened from keyboard')
  menu.popup({ window: mainWindow, x: 12, y: TOP_BAR_HEIGHT })
}

app.on('web-contents-created', (_event, webContents) => {
  webContents.on('focus', () => updateApplicationMenuContext(webContents))
  webContents.on('blur', () => setTimeout(() => updateApplicationMenuContext(), 0))
  webContents.on('before-input-event', (event, input) => {
    if (isApplicationMenuShortcut(input)) {
      webContents.setIgnoreMenuShortcuts(false)
      event.preventDefault()
      showKeyboardApplicationMenu()
      return
    }
    const ignorePageSave = isSavePageShortcut(input) && browserKernel?.isActivePageWebContents(webContents) !== true
    webContents.setIgnoreMenuShortcuts(ignorePageSave)
  })
})

nativeTheme.on('updated', updateWindowThemeSurfaces)

function sendToShell(channel, value) {
  if (shellView && !shellView.webContents.isDestroyed()) shellView.webContents.send(channel, value)
}

function sendToAgent(channel, value) {
  if (agentView && !agentView.webContents.isDestroyed()) agentView.webContents.send(channel, value)
}

function raiseProjectPanel() {
  if ((!projectPanelVisible && !layoutSetupVisible && !settingsPanelVisible && !sessionPanelVisible && !scheduledTaskPanelVisible && !toolbarPanelVisible) || !mainWindow || !shellView) return
  const children = mainWindow.contentView.children
  if (children.at(-1) === shellView) {
    if (toolbarPanelVisible) shellView.webContents.focus()
    return
  }
  if (children.includes(shellView)) mainWindow.contentView.removeChildView(shellView)
  mainWindow.contentView.addChildView(shellView)
  if (toolbarPanelVisible) shellView.webContents.focus()
}

function removeAgentView(parent) {
  if (parent?.contentView?.children.includes(agentView)) parent.contentView.removeChildView(agentView)
}

function sizeOverlayAgentView() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !agentView) return
  const [width, height] = overlayWindow.getContentSize()
  agentView.setBounds({ x: 0, y: 0, width, height })
}

function saveOverlayBoundsSoon() {
  if (!overlayWindow || overlayWindow.isDestroyed() || overlayWindow.isFullScreen()) return
  clearTimeout(layoutSaveTimer)
  layoutSaveTimer = setTimeout(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || overlayWindow.isFullScreen()) return
    layoutStore.update({ overlayBounds: overlayWindow.getBounds() })
  }, 250)
  layoutSaveTimer.unref?.()
}

function dockOverlayIfNeeded() {
  if (overlayDocking || !overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible() || overlayWindow.isFullScreen()) return false
  if (!mainWindow || mainWindow.isDestroyed() || !layoutStore || layoutStore.snapshot().mode !== 'overlay' || !agentVisible) return false
  const overlayBounds = overlayWindow.getBounds()
  const displayBounds = screen.getDisplayMatching(overlayBounds).workArea
  const shouldDock = isOverlayAtDockCorner(overlayBounds, mainWindow.getBounds()) || isOverlayAtDockCorner(overlayBounds, displayBounds)
  if (!shouldDock) return false

  overlayDocking = true
  clearTimeout(layoutSaveTimer)
  layoutStore.update({ mode: 'sidebar', visible: true, overlayFullscreen: false })
  layout()
  setTimeout(() => { overlayDocking = false }, 250).unref?.()
  console.info('[BMW] Docked floating Agent to the sidebar')
  return true
}

function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow
  const settings = layoutStore.snapshot()
  overlayWindow = new BrowserWindow({
    ...settings.overlayBounds,
    parent: mainWindow,
    minWidth: 420,
    minHeight: 480,
    title: `${PRODUCT_NAME} — Agent`,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111827' : '#f4f7fa',
    show: false,
    resizable: true,
    fullscreenable: true,
    autoHideMenuBar: true
  })
  overlayWindow.setOpacity(settings.opacity)
  overlayWindow.on('resize', () => {
    sizeOverlayAgentView()
    saveOverlayBoundsSoon()
  })
  overlayWindow.on('move', () => {
    if (!dockOverlayIfNeeded()) saveOverlayBoundsSoon()
  })
  overlayWindow.on('enter-full-screen', () => layoutStore.update({ overlayFullscreen: true }))
  overlayWindow.on('leave-full-screen', () => layoutStore.update({ overlayFullscreen: false }))
  overlayWindow.on('close', (event) => {
    if (appQuitting) return
    event.preventDefault()
    agentVisible = false
    layoutStore.update({ visible: false, overlayFullscreen: false })
    overlayWindow.setFullScreen(false)
    overlayWindow.hide()
    layout()
  })
  overlayWindow.on('closed', () => { overlayWindow = null })
  return overlayWindow
}

function attachAgentToOverlay(settings) {
  const target = ensureOverlayWindow()
  removeAgentView(mainWindow)
  if (!target.contentView.children.includes(agentView)) target.contentView.addChildView(agentView)
  target.setOpacity(settings.opacity)
  sizeOverlayAgentView()
  if (!target.isVisible()) target.show()
  if (target.isFullScreen() !== settings.overlayFullscreen) target.setFullScreen(settings.overlayFullscreen)
}

function layout() {
  if (!mainWindow || !browserKernel || !agentView) return
  const [width, height] = mainWindow.getContentSize()
  const settings = layoutStore?.snapshot() || { mode: 'sidebar', opacity: 1, sidebarWidth: agentWidth, overlayFullscreen: false }
  agentWidth = settings.sidebarWidth
  shellView.setBounds({ x: 0, y: 0, width, height: projectPanelVisible || layoutSetupVisible || settingsPanelVisible || sessionPanelVisible || scheduledTaskPanelVisible || toolbarPanelVisible ? height : TOP_BAR_HEIGHT })
  const sidebar = agentVisible && (workspaceMode==='studio'||settings.mode === 'sidebar')
  const actualAgentWidth = sidebar ? Math.min(Math.max(agentWidth, MIN_AGENT_WIDTH), Math.floor(width * 0.55)) : 0
  const workspaceBounds={x:0,y:TOP_BAR_HEIGHT,width:width-actualAgentWidth,height:height-TOP_BAR_HEIGHT}
  browserKernel.setBounds(workspaceBounds)
  // The opaque Studio View covers browser pages; keep their compositor live for capture.
  productFeatureRuntime?.layout?.(workspaceBounds,workspaceMode==='studio')
  if (sidebar) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      removeAgentView(overlayWindow)
      overlayWindow.hide()
    }
    if (!mainWindow.contentView.children.includes(agentView)) mainWindow.contentView.addChildView(agentView)
    agentView.setBounds({ x: width - actualAgentWidth, y: TOP_BAR_HEIGHT, width: actualAgentWidth, height: height - TOP_BAR_HEIGHT })
  } else if (agentVisible && settings.mode === 'overlay') {
    if (projectPanelVisible || layoutSetupVisible || settingsPanelVisible || sessionPanelVisible || scheduledTaskPanelVisible || toolbarPanelVisible) {
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
    } else {
      attachAgentToOverlay(settings)
    }
  } else {
    removeAgentView(mainWindow)
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
  }
  raiseProjectPanel()
  shellView.webContents.send('layout-state', { ...settings, agentVisible, agentWidth: actualAgentWidth, setupVisible: layoutSetupVisible,workspaceMode })
}

function projectState() {
  return projectStore?.snapshot() || { activeProjectId: null, projects: [] }
}

function publishAssistantState():void{
 if(!assistantService||appQuitting)return
 if(assistantPublishTimer)return
 assistantPublishTimer=setTimeout(()=>{
  assistantPublishTimer=undefined
  if(!assistantService||!agentView||agentView.webContents.isDestroyed())return
  const state=assistantService.controller.snapshot()
  agentView.webContents.send('bmw-assistant-state',state)
  sendToShell('project-state',projectState())
  const driver=state.drivers.find(row=>row.id===state.driverId)
  sendToShell('agent-status',{state:state.resourcesDisconnected?'error':state.busy?'working':'ready',version:driver?.baseline,label:driver?.label,message:state.resourcesDisconnected?'Recover Agent resource cleanup before continuing.':''})
  if(sessionPanelVisible)void assistantService.sessions.listProjectSessions(agentProject(projectStore.active())).then(value=>sendToShell('agent-session-state',value))
 },40)
}
async function publishAssistantSelection():Promise<void>{
 if(!assistantService)return
 const project=projectStore.active(),sessionId=assistantService.selected(project.id)
 if(sessionId)publishAgentContext({state:'ready',context:await assistantService.sessions.resolveContext(sessionId,projectStore.list().map(agentProject))})
 else publishAgentContext({state:'waiting',message:'Create a BMW conversation to continue.'})
 publishAssistantState()
}
async function selectAgentSession(project,sessionId:string) {
 if(project.id!==projectStore.active().id)throw new Error('Activate the Project before selecting its conversation')
 if(assistantService.host.busy)throw new Error('Stop and drain the Agent before changing conversations')
 const changing=assistantService.selected(project.id)!==sessionId
 if(changing)await productFeatureRuntime?.onSessionWillChange?.()
 await bridge.changeProject(async()=>{assistantService.select(sessionId,project.id)})
 if(changing)await productFeatureRuntime?.onSessionChanged?.()
 await publishAssistantSelection();return sessionId
}
async function openAgentAdvancedSettings() {
 settingsPanelVisible=false;agentVisible=true;layoutStore.update({visible:true});layout()
 agentView.webContents.send('bmw-assistant-open-settings')
 return {opened:true}
}
async function synchronizeAgentProject(project,{activate=false,ensureSession=false}={}) {
 if(!assistantService)return null
 const result=activate||ensureSession?await assistantService.sessions.activateProject(agentProject(project)):null
 if(activate)await publishAssistantSelection()
 return result
}

function assertNoScheduledProjectMutation(): void {
  if(assistantService?.host.busy)throw new Error('Stop and drain the Agent before changing Projects')
  if (bridge?.busy) throw new Error('BMW is completing a browser operation. Project changes resume when it finishes.')
  if (scheduledExecutionProjectId) throw new Error('BMW is completing a scheduled task. Project switching and archival resume when it finishes.')
}

async function activateProject(projectId, { scheduled = false } = {}) {
  if(assistantService?.host.busy)throw new Error('Stop and drain the Agent before changing Projects')
  if (bridge?.busy) throw new Error('BMW is completing a browser operation. Project switching resumes when it finishes.')
  if (scheduledExecutionProjectId && !scheduled && projectStore.active().id !== projectId) assertNoScheduledProjectMutation()
  await productFeatureRuntime?.onSessionWillChange?.()
  return bridge.changeProject(async () => {
    const project = projectStore.switch(projectId)
    await browserKernel.switchProject(project)
    await synchronizeAgentProject(project, { activate: true })
    await productFeatureRuntime?.onProjectActivated?.(project)
    sendToShell('project-state', projectState())
    layout()
    return projectState()
  })
}

async function executeScheduledTask(task, run) {
  const originalProjectId = projectStore.active().id
  const target = projectStore.get(task.projectId, { includeArchived: false })
  if (!target) throw new Error('The scheduled task Project is archived or unavailable.')
  if(!task.sessionId||!task.driverId)throw new Error('This scheduled task has no explicit BMW Session and driver binding.')
  const owner=assistantService.conversations.get(task.sessionId,target.id)
  if(owner.archivedAt!==null||owner.driverId!==task.driverId)throw new Error('The saved scheduled Session or driver is unavailable. Repair its binding explicitly.')
  const originalSessionId=assistantService.selected(originalProjectId),originalDriverId=assistantService.driverId(originalProjectId)
  scheduledExecutionProjectId = target.id
  try {
    if (projectStore.active().id !== target.id) await activateProject(target.id, { scheduled: true })
    const synchronized = await synchronizeAgentProject(target, { ensureSession: true })
    if (!synchronized?.sessionId) throw new Error('Agent is unavailable for this scheduled task.')
    const sessionId = task.sessionId
    const sessions = await assistantService.sessions.listProjectSessions(agentProject(target))
    if (!sessions.membership.includes(sessionId))throw new Error('The saved scheduled Session is unavailable. Repair its binding explicitly.')
    {await productFeatureRuntime?.onSessionWillChange?.();await bridge.changeProject(async()=>{assistantService.select(sessionId,target.id)});await productFeatureRuntime?.onSessionChanged?.();await publishAssistantSelection()}
    const prompt = `[BMW Scheduled Task · ${task.name}]\n\nThis Project-scoped task is running automatically on its saved daily schedule (${task.schedule.time} ${task.schedule.timeZone}).\n\nTask instructions:\n${task.prompt}\n\nUse only BMW's browser capability. Work in background tabs unless foreground visibility is required to finish the task. Save screenshots, downloaded page media, and recordings as Project-owned artifacts. Do not create, modify, or remove scheduled tasks during this run unless the saved instructions explicitly require it. Do not publish, purchase, delete user data, or expand the task beyond these instructions. Finish with a concise result and list the artifacts you saved.`
    const replies = await assistantService.sessions.promptAndWait(sessionId, prompt, { timeoutMs: 30 * 60_000 })
    return replies
  } finally {
    try{
    const original = projectStore.get(originalProjectId, { includeArchived: false })
    if (original && original.id !== target.id && projectStore.active().id === target.id) {
      await activateProject(original.id, { scheduled: true }).catch((error) => console.error('Failed to restore the Project after a scheduled task', error))
    }
    if(originalSessionId&&original?.id===projectStore.active().id&&!assistantService.host.busy){await productFeatureRuntime?.onSessionWillChange?.();await bridge.changeProject(async()=>assistantService.select(originalSessionId,original.id));await productFeatureRuntime?.onSessionChanged?.();await publishAssistantSelection()}
    if(original&&original.id===target.id&&!assistantService.host.busy)assistantService.preferences.set(original.id,originalDriverId)
    }finally{scheduledExecutionProjectId = null}
  }
}

function notifyScheduledTaskRun(run, task) {
  sendToShell('scheduled-task-state', scheduledTaskManager?.list(projectStore.active().id) || { tasks: [], runs: [] })
  if (!['completed', 'failed'].includes(run.status) || !Notification.isSupported()) return
  const notification = new Notification({
    title: `${PRODUCT_NAME} scheduled task · ${run.status}`,
    body: run.status === 'completed' ? task.name : `${task.name}: ${run.error}`,
    silent: run.status === 'completed'
  })
  notification.on('click', () => {
    void (async () => {
      if (projectStore.active().id !== task.projectId) await activateProject(task.projectId)
      scheduledTaskPanelVisible = true
      sendToShell('scheduled-task-open', { taskId: task.id })
      layout()
      mainWindow.show()
      mainWindow.focus()
    })().catch((error) => console.error('Failed to reveal scheduled task notification', error))
  })
  notification.show()
}

function openProjectManagerFromMenu(mode = 'manage') {
  sendToShell('project-manager-open', { mode })
}

function showProjectMenu() {
  if (projectStore.needsInitialSetup()) {
    openProjectManagerFromMenu('create')
    return { opened: true, projects: 0, activeProjectId: projectStore.active().id }
  }
  const activeProjectId = projectStore.active().id
  const projectItems = projectStore.list().map((project) => ({
    label: project.name,
    type: 'radio',
    checked: project.id === activeProjectId,
    click: () => {
      if (project.id === projectStore.active().id) return
      void activateProject(project.id).catch((error) => {
        void dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'Project switch failed',
          message: `BMW could not switch to “${project.name}”.`,
          detail: error.message
        })
      })
    }
  }))
  const menu = Menu.buildFromTemplate([
    ...projectItems,
    { type: 'separator' },
    { label: 'New Project…', click: () => openProjectManagerFromMenu('create') },
    { label: 'Manage Projects…', click: () => openProjectManagerFromMenu('manage') }
  ])
  menu.popup({ window: mainWindow })
  return { opened: true, projects: projectItems.length, activeProjectId }
}

async function askSitePermission(webContents, permission, callback, details) {
  let origin = 'unknown'
  try {
    origin = new URL(details.requestingUrl || webContents.getURL()).origin
  } catch {}
  const stored = permissionStore.getSitePermission(origin, permission)
  if (typeof stored === 'boolean') {
    callback(stored)
    return
  }
  const decision = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Allow once and remember', 'Deny'],
    defaultId: 0,
    cancelId: 1,
    title: `${PRODUCT_NAME} permission`,
    message: `${origin} requests ${permission}`,
    detail: 'BMW remembers this decision for this site, so it will not ask again.'
  })
  const allowed = decision.response === 0
  permissionStore.setSitePermission(origin, permission, allowed)
  callback(allowed)
}

function installIpc() {
  const shellHandle = createShellIpcRegistrar(ipcMain, () => shellView?.webContents, pathToFileURL(path.join(sourceDirectory, 'renderer/shell.html')).href)
  shellHandle('workspace-mode',async(event,mode:unknown)=>{
    if(event.sender!==shellView?.webContents||event.senderFrame!==shellView.webContents.mainFrame||!['browser','studio'].includes(String(mode)))throw new Error('Invalid BMW workspace selection.')
    if(!productFeatureRuntime?.setMode)throw new Error('Workspace modes are unavailable.')
    if(mode!=='browser'&&mode!=='studio')throw new TypeError('Unknown workspace mode.')
    await productFeatureRuntime.setMode(mode);return {mode:workspaceMode}
  })
  shellHandle('product-panel-open', (event, id:unknown) => {
    if(event.sender!==shellView?.webContents||event.senderFrame!==shellView.webContents.mainFrame||typeof id!=='string')throw new Error('Only the BMW Shell may open product panels.')
    if(!productFeatureRuntime?.openPanel)throw new Error('This product has no such panel.')
    return productFeatureRuntime.openPanel(id)
  })
  shellHandle('product-info', () => ({
    id: productDefinition.id,
    name: productDefinition.name,
    features: productDefinition.featureIds,
    agent: {label:'BMW Assistant',baseline:'官方 Agent 引擎'}
  }))
  shellHandle('browser-command', async (_event, request) => {
    if(bridge?.changingProject)throw new Error('BMW Project is changing; retry after activation finishes')
    return browserKernel.execute(request, { actor: 'user', sessionOwner:selectedSession(projectStore.active())?{projectId:projectStore.active().id,sessionId:selectedSession(projectStore.active())}:undefined })
  })
  shellHandle('permission-agent-control', async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new TypeError('Agent permission must be a boolean.')
    if (enabled) permissionStore.grantAgentControl()
    else permissionStore.revokeAgentControl()
    browserKernel.emitState()
    return permissionStore.snapshot()
  })
  shellHandle('agent-panel', (_event, value) => {
    agentVisible = typeof value === 'boolean' ? value : !agentVisible
    layoutStore.update({ visible: agentVisible })
    layout()
    return { agentVisible }
  })
  shellHandle('agent-width', (_event, value) => {
    const settings = layoutStore.update({ sidebarWidth: value })
    agentWidth = settings.sidebarWidth
    layout()
    return settings
  })
  shellHandle('layout-settings', () => ({ ...layoutStore.snapshot(), setupVisible: layoutSetupVisible }))
  shellHandle('toolbar-panel', (event, visible: unknown) => {
    if (event.sender !== shellView?.webContents || event.senderFrame !== shellView.webContents.mainFrame) throw new Error('Only the BMW Shell may display toolbar menus')
    if (typeof visible !== 'boolean') throw new Error('Toolbar visibility must be boolean')
    toolbarPanelVisible = visible
    layout()
    if (visible) shellView.webContents.focus()
    return { visible }
  })
  shellHandle('layout-panel', (_event, visible) => {
    layoutSetupVisible = Boolean(visible)
    if (layoutSetupVisible) {
      sessionPanelVisible = false
      scheduledTaskPanelVisible = false
    }
    layout()
    return { ...layoutStore.snapshot(), setupVisible: layoutSetupVisible }
  })
  shellHandle('layout-configure', (_event, input) => {
    const settings = layoutStore.update({ ...(input || {}), configured: true, visible: true })
    agentVisible = true
    agentWidth = settings.sidebarWidth
    layoutSetupVisible = false
    layout()
    return { ...settings, setupVisible: false }
  })
  shellHandle('layout-fullscreen', (_event, value) => {
    const current = layoutStore.snapshot()
    if (current.mode !== 'overlay') throw new Error('Agent full screen is available in floating layout.')
    const settings = layoutStore.update({ overlayFullscreen: Boolean(value), visible: true })
    agentVisible = true
    layout()
    return settings
  })
  shellHandle('global-settings', () => settingsStore.snapshot())
  shellHandle('global-settings-panel', (_event, visible) => {
    settingsPanelVisible = Boolean(visible)
    if (settingsPanelVisible) {
      projectPanelVisible = false
      layoutSetupVisible = false
      sessionPanelVisible = false
      scheduledTaskPanelVisible = false
    }
    layout()
    return { visible: settingsPanelVisible, ...settingsStore.snapshot() }
  })
  shellHandle('global-settings-update', async (_event, input) => {
    const previous = settingsStore.snapshot()
    if(input?.videoPreferences!==undefined&&input.videoPreferencesExpected!==undefined&&JSON.stringify(input.videoPreferencesExpected)!==JSON.stringify(previous.videoPreferences))throw new Error('VIDEO_SETTINGS_CONFLICT: 视频设置已被其他操作更新，请重新打开设置后合并。')
    const settings = settingsStore.update(input || {})
    if (previous.theme !== settings.theme) {
      applyProductTheme(settings.theme)
    }
    if (previous.proxyMode !== settings.proxyMode || previous.proxyRules !== settings.proxyRules || previous.proxyBypassRules !== settings.proxyBypassRules) {
      await settingsStore.applyProxy(bmwSession)
    }
    sendToShell('global-settings-state', settings)
    return settings
  })
  shellHandle('application-restart', () => requestApplicationRestart())
  shellHandle('agent-advanced-settings-open', () => openAgentAdvancedSettings())
  shellHandle('session-panel', async (_event, visible) => {
    sessionPanelVisible = Boolean(visible)
    if (sessionPanelVisible) {
      projectPanelVisible = false
      layoutSetupVisible = false
      settingsPanelVisible = false
      scheduledTaskPanelVisible = false
    }
    layout()
    return sessionPanelVisible ? assistantService.sessions.listProjectSessions(agentProject(projectStore.active())) : { visible: false }
  })
  shellHandle('scheduled-task-panel', (_event, visible) => {
    scheduledTaskPanelVisible = Boolean(visible)
    if (scheduledTaskPanelVisible) {
      projectPanelVisible = false
      layoutSetupVisible = false
      settingsPanelVisible = false
      sessionPanelVisible = false
    }
    layout()
    return scheduledTaskPanelVisible ? scheduledTaskManager.list(projectStore.active().id) : { visible: false }
  })
  shellHandle('scheduled-task-list', () => scheduledTaskManager.list(projectStore.active().id))
  shellHandle('scheduled-task-update', (_event, taskId, input) => scheduledTaskManager.update(projectStore.active().id, String(taskId), input || {}))
  shellHandle('scheduled-task-bind-current', (_event, taskId) => {
    const project=projectStore.active(),task=scheduledTaskStore.getForProject(project.id,String(taskId)),sessionId=selectedSession(project)
    if(!sessionId)throw new Error('Select a BMW Session before binding this scheduled task.')
    const driverId=assistantService.conversations.get(sessionId,project.id).driverId
    return scheduledTaskStore.bindSession(task.id,sessionId,driverId)
  })
  shellHandle('scheduled-task-remove', (_event, taskId) => scheduledTaskManager.remove(projectStore.active().id, String(taskId)))
  shellHandle('scheduled-task-run', (_event, taskId) => scheduledTaskManager.runNow(projectStore.active().id, String(taskId)))
  shellHandle('agent-session-list', (_event, query = '') => assistantService.sessions.listProjectSessions(agentProject(projectStore.active()), query))
  shellHandle('agent-session-create', () => withConversationMutation(async () => {
    const project = projectStore.active()
    await assistantService.controller.invoke({action:'session.create'})
    return assistantService.sessions.listProjectSessions(agentProject(project))
  }))
  shellHandle('agent-session-select', async (_event, sessionId) => {
    const project = projectStore.active()
    await selectAgentSession(project, String(sessionId))
    return assistantService.sessions.listProjectSessions(agentProject(project))
  })
  shellHandle('agent-session-rename', async (_event, sessionId, title) => {
    const project = projectStore.active()
    const snapshot = await assistantService.sessions.listProjectSessions(agentProject(project))
    if (!snapshot.membership.includes(sessionId)) throw new Error('That session does not belong to this Project.')
    await assistantService.sessions.renameSession(sessionId,String(title || ''))
    return assistantService.sessions.listProjectSessions(agentProject(project))
  })
  shellHandle('agent-session-fork', async (_event, sessionId) => {
    const project = projectStore.active()
    const snapshot = await assistantService.sessions.listProjectSessions(agentProject(project))
    if (!snapshot.membership.includes(sessionId)) throw new Error('That session does not belong to this Project.')
    await productFeatureRuntime?.onSessionWillChange?.()
    const forked = await assistantService.sessions.forkSession()
    await selectAgentSession(project, forked.sessionId)
    return assistantService.sessions.listProjectSessions(agentProject(project))
  })
  shellHandle('agent-session-archive', async (_event, sessionId) => {
    const project = projectStore.active()
    const snapshot = await assistantService.sessions.listProjectSessions(agentProject(project))
    if (!snapshot.membership.includes(sessionId)) throw new Error('That session does not belong to this Project.')
    await assistantService.controller.invoke({action:'session.archive',sessionId:String(sessionId)})
    return assistantService.sessions.listProjectSessions(agentProject(project))
  })
  shellHandle('agent-session-move', async (_event, sessionId, direction) => {
    const project = projectStore.active()
    const snapshot = await assistantService.sessions.listProjectSessions(agentProject(project))
    const order = snapshot.membership.filter((id) => snapshot.items.some((item) => item.sessionId === id))
    const index = order.indexOf(sessionId)
    if (index < 0) throw new Error('That session does not belong to this Project.')
    if (direction === 'up' && index > 0) {
      await assistantService.sessions.moveSession(snapshot.projectId,sessionId,order[index - 1])
    } else if (direction === 'down' && index < order.length - 1) {
      const beforeSessionId = order[index + 2]
      await assistantService.sessions.moveSession(snapshot.projectId,sessionId,beforeSessionId)
    }
    return assistantService.sessions.listProjectSessions(agentProject(project))
  })
  productFeatureRuntime?.installIpc?.(ipcMain)
  shellHandle('session-continuity', async (_event, enabled) => {
    const url = browserKernel.activeUrl()
    if (enabled) {
      const origin = new URL(url).origin
      const decision = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Keep signed in', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: `${PRODUCT_NAME} session continuity`,
        message: `Keep ${origin} signed in?`,
        detail: 'BMW will encrypt this site’s cookies with the operating-system keychain and send an occasional background HEAD request. You can turn this off without clearing your current cookies.'
      })
      if (decision.response !== 0) return sessionContinuity.status(url)
    }
    const result = await sessionContinuity.setForUrl(url, enabled, { keepalive: true })
    browserKernel.emitState()
    return result
  })
  shellHandle('project-state', () => projectState())
  shellHandle('agent-context-state', event => {if(event.sender!==shellView?.webContents||event.senderFrame!==shellView.webContents.mainFrame)throw new Error('Only the BMW Shell may read its context');return agentContextState})
  shellHandle('project-menu', () => showProjectMenu())
  shellHandle('project-panel', (_event, visible) => {
    projectPanelVisible = Boolean(visible)
    if (projectPanelVisible) {
      settingsPanelVisible = false
      sessionPanelVisible = false
      scheduledTaskPanelVisible = false
    }
    layout()
    return { visible: projectPanelVisible }
  })
  shellHandle('project-create', async (_event, input) => {
    assertNoScheduledProjectMutation()
    return bridge.changeProject(async () => {
      const project = projectStore.needsInitialSetup()
        ? projectStore.completeInitialSetup(input || {})
        : projectStore.create(input || {})
      await browserKernel.switchProject(project)
      await synchronizeAgentProject(project, { activate: true })
      await productFeatureRuntime?.onProjectActivated?.(project, { snapshot: false })
      return projectState()
    })
  })
  shellHandle('project-update', async (_event, projectId, input) => {
    const project = projectStore.update(projectId, input || {})
    await synchronizeAgentProject(project)
    if (projectId === projectStore.active().id) browserKernel.emitState()
    return projectState()
  })
  shellHandle('project-archive', async (_event, projectId) => {
    assertNoScheduledProjectMutation()
    return bridge.changeProject(async () => {
      await productFeatureRuntime?.onProjectWillArchive?.(projectId)
      scheduledTaskManager.disableProject(projectId)
      await assistantService.sessions.archiveProject(projectId)
      const next=projectStore.archive(projectId)
      await productFeatureRuntime?.onProjectArchived?.(projectId, next)
      await browserKernel.switchProject(next)
      await synchronizeAgentProject(next, { activate: true })
      return projectState()
    })
  })
  shellHandle('project-document-read', (_event, projectId, kind) => projectStore.readDocument(projectId, kind))
  shellHandle('project-document-write', async (_event, projectId, kind, content) => {
    const result = projectStore.writeDocument(projectId, kind, content)
    if (projectId === projectStore.active().id && ['instructions', 'memory'].includes(kind)) {
      await synchronizeAgentProject(projectStore.active(), { activate: true })
    }
    return result
  })
  const ownsCapture=(event:IpcMainEvent)=>mediaController?.ownsCaptureSender(event)
  const captureRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value))
  ipcMain.on('media-chunk',(event,data:unknown)=>{if(ownsCapture(event)&&data instanceof ArrayBuffer&&data.byteLength<=16*1024*1024)mediaController.acceptChunk(data)})
  ipcMain.on('media-state',(event,state:unknown)=>{if(ownsCapture(event)&&captureRecord(state))mediaController.updateState(state)})
  ipcMain.on('media-finished',(event,summary:unknown)=>{if(ownsCapture(event)&&captureRecord(summary))void mediaController.finalize(summary).catch(error=>mediaController.updateState({state:'error',message:error.message}))})
  ipcMain.on('media-comparison',(event,result:unknown)=>{if(ownsCapture(event)&&captureRecord(result))mediaController.acceptComparison(result)})

}

async function loadStartupStores(): Promise<{settings:GlobalSettingsStore;projects:ProjectStore;tasks:ScheduledTaskStore;permissions:PermissionStore;layout:LayoutStore;continuity:SessionContinuityManager;assistant:AssistantStores}|undefined> {
  while (!appQuitting) {
    try {
      releaseAgentDataLock??=acquireAgentDataLock(app.getPath('userData'))
      requireCurrentAgentData(app.getPath('userData'))
      const settings = new GlobalSettingsStore({filePath:path.join(app.getPath('userData'),'global-settings.json'),onState:state=>{sendToShell('global-settings-state',state);browserKernel?.videoStudioChanged?.()}})
      const projects = new ProjectStore({filePath:path.join(app.getPath('userData'),'projects.json'),projectsDirectory:path.join(app.getPath('userData'),'projects'),initialWorkspacePath:path.join(app.getPath('userData'),'agent-workspace'),onState:state=>sendToShell('project-state',state)})
      const tasks = new ScheduledTaskStore({filePath:path.join(app.getPath('userData'),'scheduled-tasks.json'),onState:()=>{if(scheduledTaskManager&&projectStore)sendToShell('scheduled-task-state',scheduledTaskManager.list(projectStore.active().id))}})
      const permissions = new PermissionStore(path.join(app.getPath('userData'), 'permissions.json'))
      const layout = new LayoutStore({filePath:path.join(app.getPath('userData'),'layout-settings.json'),onState:state=>sendToShell('layout-state',{...state,agentVisible,setupVisible:layoutSetupVisible})})
      const continuity = new SessionContinuityManager({session:bmwSession,safeStorage,configPath:path.join(app.getPath('userData'),'session-continuity.json'),snapshotPath:path.join(app.getPath('userData'),'session-cookies.enc'),onState:()=>browserKernel?.emitState()})
      continuity.load()
      const assistant=loadAssistantStores(app.getPath('userData'),agentAssembly.defaultDriverId,publishAssistantState)
      return {settings,projects,tasks,permissions,layout,continuity,assistant}
    } catch (error:unknown) {
      releaseAgentDataLock?.();releaseAgentDataLock=undefined
      if (!(error instanceof StateLoadError)) throw error
      const result = await dialog.showMessageBox({type:'error',title:'BMW 无法读取保存的数据',message:'保存的数据暂时不可读，或格式不受支持。原文件已保留。',detail:error.message,buttons:['重试','退出'],defaultId:0,cancelId:1,noLink:true})
      if (result.response !== 0) {app.quit();return undefined}
    }
  }
}

async function createApp() {
  const applicationFeature = productDefinition.features.find((feature) => typeof feature.main?.activate === 'function')
  const browserCapabilities = new BrowserCapabilityRegistry(productDefinition)
  installApplicationMenu()
  const persistentSession = session.fromPartition(productDefinition.sessionPartition)
  persistentSession.setUserAgent(app.userAgentFallback)
  bmwSession = persistentSession
  const stores = await loadStartupStores()
  if (!stores || appQuitting) return
  settingsStore = stores.settings
  projectStore = stores.projects
  scheduledTaskStore = stores.tasks
  applyProductTheme(settingsStore.snapshot().theme)
  await settingsStore.applyProxy(persistentSession)
  permissionStore = stores.permissions
  layoutStore = stores.layout
  const initialLayout = layoutStore.snapshot()
  agentVisible = initialLayout.visible
  agentWidth = initialLayout.sidebarWidth
  /* startup stores are loaded together before application services */
  if (applicationFeature) {
    productFeatureRuntime = await activateFeature(applicationFeature.main, {
      session: persistentSession,
      projectStore
    })
  }
  projectPanelVisible = projectStore.needsInitialSetup()
  layoutSetupVisible = !initialLayout.configured && !projectPanelVisible
  sessionContinuity = stores.continuity
  await sessionContinuity.initialize()
  if (appQuitting) return

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: `${PRODUCT_NAME} — Browser is the boundary`,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0d12' : '#f4f7fa',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  })

  shellView = new WebContentsView({
    webPreferences: {
      preload: path.join(sourceDirectory, 'preload/shell-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The fixed Shell must observe native panel resizes while covered or backgrounded.
      backgroundThrottling: false
    }
  })
  shellView.webContents.on('will-navigate', event => event.preventDefault())
  shellView.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
  shellView.setBackgroundColor('#00000000')
  mainWindow.contentView.addChildView(shellView)

  agentView = new WebContentsView({
    webPreferences: {
      session: persistentSession,
      preload: agentAssembly.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  agentView.webContents.on('will-navigate',event=>event.preventDefault())
  agentView.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  agentView.webContents.on('did-finish-load', () => {
    void productFeatureRuntime?.onAgentLoaded?.()
    publishAssistantState()
  })

  browserKernel = new BrowserKernel({
    window: mainWindow,
    session: persistentSession,
    permissionStore,
    sessionContinuity,
    projectStore,
    settingsStore,
    capabilityRegistry: browserCapabilities,
    getCurrentSessionId: () => selectedSession(projectStore.active()),
    getSessionDriver: sessionId => assistantService.conversations.get(sessionId,projectStore.active().id).driverId,
    allowedActions: browserCapabilities.allowedActions,
    artifactsDirectory: path.join(app.getPath('userData'), 'artifacts'),
    pageTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    onState: (state) => {
      sendToShell('browser-state', state)
      layout()
      raiseProjectPanel()
    }
  })

  mediaController = new MediaController({
    session: persistentSession,
    preloadPath: path.join(projectDirectory, 'packages/media-native/src/preload/media-preload.cjs'),
    pagePath: path.join(projectDirectory, 'packages/media-native/src/media/media.html'),
    artifactsDirectory: path.join(app.getPath('userData'), 'artifacts'),
    resolveArtifactsDirectory: () => path.join(projectStore.active().directory, 'artifacts'),
    onStatus: (state) => {sendToShell('media-status', state);productFeatureRuntime?.onMediaStatus?.(state)}
  })
  mediaController.configureDisplayMedia()
  browserKernel.setRecordingController(mediaController)
  browserKernel.projectSources=()=>{const project=projectStore.active();return new ProjectSourceStore(project.directory,project.id)}
  scheduledTaskManager = new ScheduledTaskManager({
    store: scheduledTaskStore,
    execute: executeScheduledTask,
    onRun: notifyScheduledTaskRun
  })
  browserKernel.setScheduledTaskManager(scheduledTaskManager)
  productFeatureRuntime?.configure?.({
    projectStore,
    browserKernel: assertBrowserFeatureHost(browserKernel),
    mediaController,
    Notification,
    getMainWindow: () => mainWindow,
    getShellWebContents: () => shellView?.webContents,
    getTheme: () => settingsStore.snapshot().theme,
    isProjectChanging: () => bridge?.changingProject === true,
    getAgentWebContents: () => agentView?.webContents,
    getAgentUrl: () => pathToFileURL(agentAssembly.pagePath).href,
    getCurrentSessionId: () => selectedSession(projectStore.active()),
    setWorkspaceMode: (mode:'browser'|'studio') => {
      if(workspaceMode!==mode){if(mode==='studio')browserAgentVisible=agentVisible;else agentVisible=browserAgentVisible}
      workspaceMode=mode;if(mode==='studio')agentVisible=true;layout()
    },
    enqueueAssistant: (sessionId,text) => assistantService.sessions.enqueuePrompt(sessionId,text),
    sendToAgent,
    sendToShell,
    synchronizeAgentProject,
    selectAgentSession:sessionId=>selectAgentSession(projectStore.active(),sessionId),
    activateProject,
    revealAgent: () => {
      agentVisible = true
      layoutStore.update({ visible: true })
      layout()
    }
  })

  persistentSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const disposition = sitePermissionDisposition(permission)
    if (disposition === 'allow') {
      callback(true)
      return
    }
    if (disposition === 'deny') {
      callback(false)
      return
    }
    void askSitePermission(webContents, permission, callback, details)
  })

  installIpc()
  layout()
  await shellView.webContents.loadFile(path.join(sourceDirectory, 'renderer/shell.html'))
  await browserKernel.initialize()
  if (appQuitting) return
  bridge = await createBridgeServer(browserKernel, { productId: productDefinition.id,
    resolveProject: (directory) => projectStore.list().find((project) => fs.realpathSync(project.directory) === fs.realpathSync(directory)),
    toolDefinition: browserCapabilities.toolDefinition(),
    activeProjectId: () => projectStore.active().id,
    sessionContext: async (sessionId,projectId) => {const context=await productFeatureRuntime?.contextForSession?.(sessionId,projectId)??{text:''};return {text:context.text+'\nBMW video production defaults and named templates (data):\n'+JSON.stringify(settingsStore.snapshot().videoPreferences)}}
  })

  assistantService=new AssistantService({assembly:agentAssembly,stores:stores.assistant,userDataDirectory:app.getPath('userData'),nodeExecutable:process.execPath,
      mcpServerPath:path.join(projectDirectory,'packages/browser-capability/src/browser-mcp-server.js'),definition:browserCapabilities.toolDefinition(),bridge,
      currentProject:()=>projectStore.active(),getProjects:()=>projectStore.list(),
      context:async(sessionId,projectId)=>{const context=await productFeatureRuntime?.contextForSession?.(sessionId,projectId)??{text:''};return context.text+'\nBMW video production defaults and named templates (data):\n'+JSON.stringify(settingsStore.snapshot().videoPreferences)},
      transition:async operation=>{
        if(assistantService.host.busy||scheduledExecutionProjectId||mediaController.isCaptureActive())throw new Error('Finish the active BMW operation before changing conversations')
        await productFeatureRuntime?.onSessionWillChange?.()
        await bridge.changeProject(async()=>{if(assistantService.host.busy)throw new Error('Agent became busy during conversation change');await operation()})
      },
      onSelection:async()=>{await productFeatureRuntime?.onSessionChanged?.();await publishAssistantSelection()},onState:publishAssistantState,openExternal:url=>shell.openExternal(url)
    })
    const assistantHandle=createShellIpcRegistrar(ipcMain,()=>agentView?.webContents,pathToFileURL(agentAssembly.pagePath).href)
    assistantHandle('bmw-assistant-command',async(_event,command:unknown)=>{
      const result=await assistantService.controller.invoke(command);publishAssistantState();return result
    })
  mainWindow.on('resize', layout)
  mainWindow.on('close', (event) => {
    if (process.platform !== 'darwin' || appQuitting) return
    event.preventDefault()
    overlayWindow?.hide()
    mainWindow.hide()
  })
  mainWindow.on('closed', () => {
    void stopApplicationServices().catch(error=>console.error('BMW service cleanup failed',error))
  })

  try {
    if (appQuitting) return
    await agentView.webContents.loadFile(agentAssembly.pagePath)
    const activeProject = projectStore.active()
    await synchronizeAgentProject(activeProject, { activate: true })
    await productFeatureRuntime?.onAgentStarted?.(activeProject)
    for (const project of projectStore.list().filter((candidate) => candidate.id !== activeProject.id)) {
      await synchronizeAgentProject(project).catch((error) => console.error(`Failed to synchronize Agent workspace for ${project.name}`, error))
    }
    await publishAssistantSelection()
    scheduledTaskManager.start()
    layout()
    if(process.env.BMW_OPEN_STUDIO==='1')await productFeatureRuntime?.openPanel?.('video-studio')
  } catch (error) {
    if (appQuitting) return
    sendToShell('agent-status', { state: 'error', message: error.message })
    const escape=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]))
    await agentView.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>body{font:14px system-ui;background:#111827;color:#e5e7eb;padding:24px}</style><h2>'+escape('BMW Assistant')+' did not start</h2><p>'+escape(error.message)+'</p><p>'+escape(PRODUCT_NAME)+' browser mode remains available.</p>'))
  }
}

export function createBmwApplication(definition: ResolvedProductDefinition, assembly: AgentApplicationAssembly) {
  if(!assembly?.createBackends||!assembly.pagePath||!assembly.preloadPath)throw new Error('The owned BMW Assistant assembly is required.')
  if (productDefinition) throw new Error('BMW product application is already configured.')
  agentAssembly=assembly
  productDefinition = defineProduct(definition)
  PRODUCT_NAME = definition.name
  if (process.env.BMW_USER_DATA_DIR) {
    const isolatedUserData = path.resolve(process.env.BMW_USER_DATA_DIR)
    fs.mkdirSync(isolatedUserData, { recursive: true, mode: 0o700 })
    app.setPath('userData', isolatedUserData)

  }
  app.setName(PRODUCT_NAME)
  app.userAgentFallback = browserCompatibleUserAgent(app.userAgentFallback)
  app.whenReady().then(createApp).catch((error:unknown)=>{if(appQuitting)return;console.error('BMW startup failed',error);dialog.showErrorBox('BMW 启动失败',error instanceof Error?error.message:String(error));app.quit()})
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show()
    layout()
  })
  let cleanupFinished=false,quitCleanup:Promise<void>|undefined
  app.on('before-quit', event => {
    if(cleanupFinished)return
    event.preventDefault()
    if(quitCleanup)return
    appQuitting=true
    quitCleanup=(async()=>{
      for(;;){
        try{await stopApplicationServices();cleanupFinished=true;app.quit();return}
        catch(error:unknown){
          const choice=await dialog.showMessageBox({type:'error',title:'BMW 尚未完成资源清理',message:'退出前未能确认 Agent 和浏览器任务已停止。',detail:error instanceof Error?error.message:'资源清理失败',buttons:['重试清理','强制退出'],defaultId:0,cancelId:0,noLink:true})
          if(choice.response===1){app.exit(1);return}
        }
      }
    })()
  })
}
