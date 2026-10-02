import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, screen, session, webContents as electronWebContents, WebContentsView } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { BrowserKernel } from '@bmw-agent/browser-capability/kernel'
import { createBridgeServer } from '@bmw-agent/browser-capability/bridge'
import { DshHarnessPort, DshRuntime, resolveDshHome } from '@bmw-agent/harness-dsh'
import { GlobalSettingsStore } from './global-settings-store.js'
import { LayoutStore } from './layout-store.js'
import { isOverlayAtDockCorner } from './layout-docking.js'
import { isApplicationMenuShortcut, isSavePageShortcut, pageSaveType, suggestedPageFilename } from './menu-policy.js'
import { MediaController } from '@bmw-agent/media-native'
import { sitePermissionDisposition } from './permission-policy.js'
import { PermissionStore } from './permission-store.js'
import { ProjectStore } from './project-store.js'
import { ProductProfileImporter } from './product-profile-importer.js'
import { SessionContinuityManager } from './session-continuity.js'
import { ScheduledTaskManager } from './scheduled-task-manager.js'
import { ScheduledTaskStore } from './scheduled-task-store.js'
import { BrowserCapabilityRegistry } from '@bmw-agent/browser-capability/registry'
import { browserCompatibleUserAgent } from './browser-user-agent.js'
import { restartBlockReason } from './restart-policy.js'

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(sourceDirectory, '../../..')
let PRODUCT_NAME = 'BMW'
const TOP_BAR_HEIGHT = 76
const MIN_AGENT_WIDTH = 360

let productDefinition

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
let harnessPort
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
let settingsPanelVisible = false
let sessionPanelVisible = false
let scheduledTaskPanelVisible = false
let layoutSaveTimer
let overlayDocking = false
let appQuitting = false
let bmwSession
let productFeatureRuntime
let profileImporter
let scheduledTaskStore
let scheduledTaskManager
let scheduledExecutionProjectId = null
let shutdownPromise: Promise<void> | null = null
let restartInProgress = false

function activeValidationExecution(): boolean {
  try {
    const validation = productFeatureRuntime?.webValidation
    if (validation?.recording || validation?.running || validation?.experimentRun) return true
    const runs = productFeatureRuntime?.activeSnapshot?.()?.items || []
    return runs.some((run) => run.status === 'preparing' || run.status === 'running')
  } catch {
    return false
  }
}

async function selectedDshTurnIsRunning(): Promise<boolean> {
  if (!harnessPort?.child || !projectStore) return false
  try {
    const project = projectStore.active()
    const sessions = await Promise.race([
      harnessPort.listProjectSessions(project),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 1_500)
        timer.unref?.()
      })
    ])
    if (!sessions) return false
    return sessions.items?.some((item) => item.sessionId === sessions.selectedSessionId && item.running === true) === true
  } catch {
    return false
  }
}

function stopApplicationServices(): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    scheduledTaskManager?.stop()
    harnessPort?.stop()
    const tasks: Promise<unknown>[] = []
    if (bridge) tasks.push(Promise.resolve(bridge.close()))
    if (sessionContinuity) tasks.push(Promise.resolve(sessionContinuity.stop()))
    if (productFeatureRuntime?.stop) tasks.push(Promise.resolve(productFeatureRuntime.stop()))
    await Promise.allSettled(tasks)
    try {
      bmwSession?.flushStorageData()
    } catch (error) {
      console.error('Failed to flush BMW browser storage during shutdown', error)
    }
  })()
  return shutdownPromise
}

async function requestApplicationRestart() {
  if (restartInProgress) return { restarting: true }
  const block = restartBlockReason({
    mediaCaptureActive: mediaController?.isCaptureActive?.() === true,
    scheduledTaskActive: Boolean(scheduledExecutionProjectId),
    validationRunActive: activeValidationExecution()
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

  const dshTurnRunning = await selectedDshTurnIsRunning()
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: `Restart ${PRODUCT_NAME}`,
    message: `Restart ${PRODUCT_NAME} now?`,
    detail: `${PRODUCT_NAME} will reopen the same product Profile, Projects, browser tabs, saved login continuity, DSH Sessions, and layout.${dshTurnRunning ? ' The current DSH response will be interrupted.' : ''}`,
    buttons: [`Restart ${PRODUCT_NAME}`, 'Cancel'],
    defaultId: dshTurnRunning ? 1 : 0,
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
  if ((!projectPanelVisible && !layoutSetupVisible && !settingsPanelVisible && !sessionPanelVisible && !scheduledTaskPanelVisible) || !mainWindow || !shellView) return
  const children = mainWindow.contentView.children
  if (children.at(-1) === shellView) return
  if (children.includes(shellView)) mainWindow.contentView.removeChildView(shellView)
  mainWindow.contentView.addChildView(shellView)
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
  console.info('[BMW] Docked floating DSH to the sidebar')
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
    title: `${PRODUCT_NAME} — DSH`,
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
  shellView.setBounds({ x: 0, y: 0, width, height: projectPanelVisible || layoutSetupVisible || settingsPanelVisible || sessionPanelVisible || scheduledTaskPanelVisible ? height : TOP_BAR_HEIGHT })
  const sidebar = agentVisible && settings.mode === 'sidebar'
  const actualAgentWidth = sidebar ? Math.min(Math.max(agentWidth, MIN_AGENT_WIDTH), Math.floor(width * 0.55)) : 0
  browserKernel.setBounds({ x: 0, y: TOP_BAR_HEIGHT, width: width - actualAgentWidth, height: height - TOP_BAR_HEIGHT })
  if (sidebar) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      removeAgentView(overlayWindow)
      overlayWindow.hide()
    }
    if (!mainWindow.contentView.children.includes(agentView)) mainWindow.contentView.addChildView(agentView)
    agentView.setBounds({ x: width - actualAgentWidth, y: TOP_BAR_HEIGHT, width: actualAgentWidth, height: height - TOP_BAR_HEIGHT })
  } else if (agentVisible && settings.mode === 'overlay') {
    if (projectPanelVisible || layoutSetupVisible || settingsPanelVisible || sessionPanelVisible || scheduledTaskPanelVisible) {
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
    } else {
      attachAgentToOverlay(settings)
    }
  } else {
    removeAgentView(mainWindow)
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
  }
  raiseProjectPanel()
  shellView.webContents.send('layout-state', { ...settings, agentVisible, agentWidth: actualAgentWidth, setupVisible: layoutSetupVisible })
}

function projectState() {
  return projectStore?.snapshot() || { activeProjectId: null, projects: [] }
}

async function selectDshSession(project, sessionId, { reload = true } = {}) {
  const snapshot = await harnessPort.listProjectSessions(project)
  if (!snapshot.membership.includes(sessionId)) throw new Error('That DSH session does not belong to this BMW Project.')
  projectStore.setDshWorkspaceId(project.id, snapshot.workspaceId)
  projectStore.setDshSessionId(project.id, sessionId)
  if (agentView && !agentView.webContents.isDestroyed()) {
    await agentView.webContents.executeJavaScript(`(() => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: ${JSON.stringify(sessionId)} }))
      ${reload ? 'location.reload()' : ''}
    })()`)
  }
  sendToShell('project-state', projectState())
  return sessionId
}

async function applyDshSidebarPolicy() {
  if (!agentView || agentView.webContents.isDestroyed()) return
  const visible = settingsStore?.snapshot().dshSidebarVisible === true
  await agentView.webContents.executeJavaScript(`(() => {
    const visible = ${JSON.stringify(visible)}
    const styleId = 'bmw-dsh-sidebar-policy'
    let style = document.getElementById(styleId)
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }
    style.textContent = '[data-bmw-sidebar-hidden] > :first-child{visibility:hidden!important;pointer-events:none!important;border-right:0!important}[data-bmw-sidebar-hidden] > [data-side="sidebar"]{display:none!important}[data-bmw-sidebar-hidden]{grid-template-columns:0px minmax(0,1fr) var(--bmw-dsh-details-width,0px)!important}'
    const apply = () => {
      const overlay = document.querySelector('[data-shell-overlay]')
      const frame = overlay?.parentElement
      if (!frame) return
      const match = /([0-9.]+)px\\s*$/.exec(frame.style.gridTemplateColumns || '')
      if (match) frame.style.setProperty('--bmw-dsh-details-width', match[1] + 'px')
      frame.toggleAttribute('data-bmw-sidebar-hidden', !visible)
    }
    window.__bmwApplySidebarPolicy = apply
    apply()
    window.__bmwSidebarObserver?.disconnect?.()
    window.__bmwSidebarObserver = new MutationObserver(apply)
    window.__bmwWatchSidebarPolicy = () => window.__bmwSidebarObserver.observe(document.documentElement, { childList: true, subtree: true })
    window.__bmwWatchSidebarPolicy()
    return { visible, applied: Boolean(document.querySelector('[data-shell-overlay]')?.parentElement) }
  })()`)
}

async function openDshAdvancedSettings() {
  settingsPanelVisible = false
  agentVisible = true
  layoutStore.update({ visible: true })
  layout()
  await applyDshSidebarPolicy()
  const opened = await agentView.webContents.executeJavaScript(`(() => {
    window.__bmwSidebarObserver?.disconnect?.()
    document.querySelector('[data-shell-overlay]')?.parentElement?.removeAttribute('data-bmw-sidebar-hidden')
    const buttons = [...document.querySelectorAll('button')]
    const trigger = buttons.find((button) => ['Settings', '设置'].includes((button.getAttribute('aria-label') || button.textContent || '').trim()))
    if (!trigger) {
      window.__bmwApplySidebarPolicy?.()
      window.__bmwWatchSidebarPolicy?.()
      return false
    }
    trigger.click()
    let sawSettings = document.querySelector('[aria-modal="true"]') !== null
    const timer = window.setInterval(() => {
      const settingsOpen = document.querySelector('[aria-modal="true"]') !== null
      sawSettings ||= settingsOpen
      if (!sawSettings || settingsOpen) return
      window.clearInterval(timer)
      window.__bmwApplySidebarPolicy?.()
      window.__bmwWatchSidebarPolicy?.()
    }, 200)
    return true
  })()`)
  if (!opened) throw new Error('DSH advanced settings are not available yet.')
  return { opened: true }
}

async function synchronizeDshProject(project, { activate = false, ensureSession = false } = {}) {
  if (!harnessPort?.child) return null
  const result = activate || ensureSession ? await harnessPort.activateWorkspace(project) : { workspace: await harnessPort.ensureWorkspace(project) }
  projectStore.setDshWorkspaceId(project.id, result.workspace.workspaceId)
  if (result.sessionId) projectStore.setDshSessionId(project.id, result.sessionId)
  if (activate && agentView && !agentView.webContents.isDestroyed()) {
    await agentView.webContents.executeJavaScript(`(() => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: ${JSON.stringify(result.sessionId)} }))
      location.reload()
    })()`)
    console.info(`[BMW] Activated DSH project "${project.name}" (${result.sessionId})`)
  }
  return result
}

function assertNoScheduledProjectMutation(): void {
  if (bridge?.busy) throw new Error('BMW is completing a browser operation. Project changes resume when it finishes.')
  if (scheduledExecutionProjectId) throw new Error('BMW is completing a scheduled task. Project switching and archival resume when it finishes.')
}

async function activateProject(projectId, { scheduled = false } = {}) {
  if (bridge?.busy) throw new Error('BMW is completing a browser operation. Project switching resumes when it finishes.')
  if (scheduledExecutionProjectId && !scheduled && projectStore.active().id !== projectId) assertNoScheduledProjectMutation()
  return bridge.changeProject(async () => {
    const project = projectStore.switch(projectId)
    await browserKernel.switchProject(project)
    await synchronizeDshProject(project, { activate: true })
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
  scheduledExecutionProjectId = target.id
  try {
    if (projectStore.active().id !== target.id) await activateProject(target.id, { scheduled: true })
    const synchronized = await synchronizeDshProject(target, { ensureSession: true })
    if (!synchronized?.sessionId) throw new Error('DSH is unavailable for this scheduled task.')
    let sessionId = task.sessionId
    const sessions = await harnessPort.listProjectSessions(target)
    if (!sessionId || !sessions.membership.includes(sessionId)) {
      sessionId = synchronized.sessionId
      scheduledTaskStore.bindSession(task.id, sessionId)
    }
    const prompt = `[BMW Scheduled Task · ${task.name}]\n\nThis Project-scoped task is running automatically on its saved daily schedule (${task.schedule.time} ${task.schedule.timeZone}).\n\nTask instructions:\n${task.prompt}\n\nUse only BMW's browser capability. Work in background tabs unless foreground visibility is required to finish the task. Save screenshots, downloaded page media, and recordings as Project-owned artifacts. Do not create, modify, or remove scheduled tasks during this run unless the saved instructions explicitly require it. Do not publish, purchase, delete user data, or expand the task beyond these instructions. Finish with a concise result and list the artifacts you saved.`
    const replies = await harnessPort.promptAndWait(sessionId, prompt, { timeoutMs: 30 * 60_000 })
    return replies
  } finally {
    const original = projectStore.get(originalProjectId, { includeArchived: false })
    if (original && original.id !== target.id && projectStore.active().id === target.id) {
      await activateProject(original.id, { scheduled: true }).catch((error) => console.error('Failed to restore the Project after a scheduled task', error))
    }
    scheduledExecutionProjectId = null
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
  ipcMain.handle('product-info', () => ({
    id: productDefinition.id,
    name: productDefinition.name,
    features: productDefinition.featureIds,
    canImportFromBase: productDefinition.id !== 'bmw'
  }))
  ipcMain.handle('product-import-preview', () => profileImporter.preview())
  ipcMain.handle('product-import-project', async (_event, input) => {
    assertNoScheduledProjectMutation()
    return bridge.changeProject(async () => {
      const result = await profileImporter.importProject(input || {})
      await browserKernel.switchProject(result.project)
      await synchronizeDshProject(result.project, { activate: true })
      sendToShell('project-state', projectState())
      return { ...result, state: projectState() }
    })
  })
  ipcMain.handle('web-runtime-settings', async () => productFeatureRuntime?.runtimeSettings?.(settingsStore) || ({ enabled: false, moduleUrl: '', apiKeyConfigured: false, capabilities: null }))
  ipcMain.handle('web-runtime-settings-update', async (_event, input = {}) => {
    if (!productFeatureRuntime?.updateRuntimeSettings) throw new Error('Web Runtime settings are unavailable in this product.')
    return productFeatureRuntime.updateRuntimeSettings(settingsStore, input)
  })
  ipcMain.handle('browser-command', async (_event, request) => browserKernel.execute(request, { actor: 'user' }))
  ipcMain.handle('permission-agent-control', async (_event, enabled) => {
    if (enabled) permissionStore.grantAgentControl()
    else permissionStore.revokeAgentControl()
    browserKernel.emitState()
    return permissionStore.snapshot()
  })
  ipcMain.handle('agent-panel', (_event, value) => {
    agentVisible = typeof value === 'boolean' ? value : !agentVisible
    layoutStore.update({ visible: agentVisible })
    layout()
    return { agentVisible }
  })
  ipcMain.handle('agent-width', (_event, value) => {
    const settings = layoutStore.update({ sidebarWidth: value })
    agentWidth = settings.sidebarWidth
    layout()
    return settings
  })
  ipcMain.handle('layout-settings', () => ({ ...layoutStore.snapshot(), setupVisible: layoutSetupVisible }))
  ipcMain.handle('layout-panel', (_event, visible) => {
    layoutSetupVisible = Boolean(visible)
    if (layoutSetupVisible) {
      sessionPanelVisible = false
      scheduledTaskPanelVisible = false
    }
    layout()
    return { ...layoutStore.snapshot(), setupVisible: layoutSetupVisible }
  })
  ipcMain.handle('layout-configure', (_event, input) => {
    const settings = layoutStore.update({ ...(input || {}), configured: true, visible: true })
    agentVisible = true
    agentWidth = settings.sidebarWidth
    layoutSetupVisible = false
    layout()
    return { ...settings, setupVisible: false }
  })
  ipcMain.handle('layout-fullscreen', (_event, value) => {
    const current = layoutStore.snapshot()
    if (current.mode !== 'overlay') throw new Error('DSH full screen is available in floating layout.')
    const settings = layoutStore.update({ overlayFullscreen: Boolean(value), visible: true })
    agentVisible = true
    layout()
    return settings
  })
  ipcMain.handle('global-settings', () => settingsStore.snapshot())
  ipcMain.handle('global-settings-panel', (_event, visible) => {
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
  ipcMain.handle('global-settings-update', async (_event, input) => {
    const previous = settingsStore.snapshot()
    const settings = settingsStore.update(input || {})
    if (previous.theme !== settings.theme) {
      applyProductTheme(settings.theme)
    }
    if (previous.proxyMode !== settings.proxyMode || previous.proxyRules !== settings.proxyRules || previous.proxyBypassRules !== settings.proxyBypassRules) {
      await settingsStore.applyProxy(bmwSession)
    }
    if (previous.dshSidebarVisible !== settings.dshSidebarVisible) await applyDshSidebarPolicy()
    sendToShell('global-settings-state', settings)
    return settings
  })
  ipcMain.handle('application-restart', () => requestApplicationRestart())
  ipcMain.handle('dsh-advanced-settings-open', () => openDshAdvancedSettings())
  ipcMain.handle('session-panel', async (_event, visible) => {
    sessionPanelVisible = Boolean(visible)
    if (sessionPanelVisible) {
      projectPanelVisible = false
      layoutSetupVisible = false
      settingsPanelVisible = false
      scheduledTaskPanelVisible = false
    }
    layout()
    return sessionPanelVisible ? harnessPort.listProjectSessions(projectStore.active()) : { visible: false }
  })
  ipcMain.handle('scheduled-task-panel', (_event, visible) => {
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
  ipcMain.handle('scheduled-task-list', () => scheduledTaskManager.list(projectStore.active().id))
  ipcMain.handle('scheduled-task-update', (_event, taskId, input) => scheduledTaskManager.update(projectStore.active().id, String(taskId), input || {}))
  ipcMain.handle('scheduled-task-remove', (_event, taskId) => scheduledTaskManager.remove(projectStore.active().id, String(taskId)))
  ipcMain.handle('scheduled-task-run', (_event, taskId) => scheduledTaskManager.runNow(projectStore.active().id, String(taskId)))
  ipcMain.handle('dsh-session-list', (_event, query = '') => harnessPort.listProjectSessions(projectStore.active(), query))
  ipcMain.handle('dsh-session-create', async () => {
    const project = projectStore.active()
    const created = await harnessPort.createProjectSession(project)
    await selectDshSession(project, created.sessionId)
    return harnessPort.listProjectSessions(project)
  })
  ipcMain.handle('dsh-session-select', async (_event, sessionId) => {
    const project = projectStore.active()
    await selectDshSession(project, String(sessionId))
    return harnessPort.listProjectSessions(project)
  })
  ipcMain.handle('dsh-session-rename', async (_event, sessionId, title) => {
    const project = projectStore.active()
    const snapshot = await harnessPort.listProjectSessions(project)
    if (!snapshot.membership.includes(sessionId)) throw new Error('That session does not belong to this Project.')
    await harnessPort.call('session.rename', { sessionId, title: String(title || '') })
    return harnessPort.listProjectSessions(project)
  })
  ipcMain.handle('dsh-session-fork', async (_event, sessionId) => {
    const project = projectStore.active()
    const snapshot = await harnessPort.listProjectSessions(project)
    if (!snapshot.membership.includes(sessionId)) throw new Error('That session does not belong to this Project.')
    const forked = await harnessPort.call('session.fork', { sessionId })
    await selectDshSession(project, forked.sessionId)
    return harnessPort.listProjectSessions(project)
  })
  ipcMain.handle('dsh-session-archive', async (_event, sessionId) => {
    const project = projectStore.active()
    const snapshot = await harnessPort.listProjectSessions(project)
    if (!snapshot.membership.includes(sessionId)) throw new Error('That session does not belong to this Project.')
    await harnessPort.call('workspace.archiveSession', { sessionId })
    if (project.dshSessionId === sessionId) {
      const remaining = await harnessPort.listProjectSessions(project)
      let nextId = remaining.items[0]?.sessionId
      if (!nextId) nextId = (await harnessPort.createProjectSession(project)).sessionId
      await selectDshSession(project, nextId)
    }
    return harnessPort.listProjectSessions(project)
  })
  ipcMain.handle('dsh-session-move', async (_event, sessionId, direction) => {
    const project = projectStore.active()
    const snapshot = await harnessPort.listProjectSessions(project)
    const order = snapshot.membership.filter((id) => snapshot.items.some((item) => item.sessionId === id))
    const index = order.indexOf(sessionId)
    if (index < 0) throw new Error('That session does not belong to this Project.')
    if (direction === 'up' && index > 0) {
      await harnessPort.call('workspace.insertSessionBefore', { workspaceId: snapshot.workspaceId, sessionId, beforeSessionId: order[index - 1] })
    } else if (direction === 'down' && index < order.length - 1) {
      const beforeSessionId = order[index + 2]
      await harnessPort.call('workspace.insertSessionBefore', { workspaceId: snapshot.workspaceId, sessionId, ...(beforeSessionId ? { beforeSessionId } : {}) })
    }
    return harnessPort.listProjectSessions(project)
  })
  productFeatureRuntime?.installIpc?.(ipcMain)
  ipcMain.handle('session-continuity', async (_event, enabled) => {
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
  ipcMain.handle('project-state', () => projectState())
  ipcMain.handle('project-menu', () => showProjectMenu())
  ipcMain.handle('project-panel', (_event, visible) => {
    projectPanelVisible = Boolean(visible)
    if (projectPanelVisible) {
      settingsPanelVisible = false
      sessionPanelVisible = false
      scheduledTaskPanelVisible = false
    }
    layout()
    return { visible: projectPanelVisible }
  })
  ipcMain.handle('project-create', async (_event, input) => {
    assertNoScheduledProjectMutation()
    return bridge.changeProject(async () => {
      const project = projectStore.needsInitialSetup()
        ? projectStore.completeInitialSetup(input || {})
        : projectStore.create(input || {})
      await browserKernel.switchProject(project)
      await synchronizeDshProject(project, { activate: true })
      await productFeatureRuntime?.onProjectActivated?.(project, { snapshot: false })
      return projectState()
    })
  })
  ipcMain.handle('project-update', async (_event, projectId, input) => {
    const project = projectStore.update(projectId, input || {})
    await synchronizeDshProject(project)
    if (projectId === projectStore.active().id) browserKernel.emitState()
    return projectState()
  })
  ipcMain.handle('project-archive', async (_event, projectId) => {
    assertNoScheduledProjectMutation()
    return bridge.changeProject(async () => {
      const archived = projectStore.get(projectId, { includeArchived: false })
      await productFeatureRuntime?.onProjectWillArchive?.(projectId)
      scheduledTaskManager.disableProject(projectId)
      const next = projectStore.archive(projectId)
      if (archived?.dshWorkspaceId && harnessPort?.child) {
        await harnessPort.call('workspace.delete', { workspaceId: archived.dshWorkspaceId }).catch((error) => {
          console.error('Failed to unregister archived DSH workspace', error)
        })
      }
      await productFeatureRuntime?.onProjectArchived?.(projectId, next)
      await browserKernel.switchProject(next)
      await synchronizeDshProject(next, { activate: true })
      return projectState()
    })
  })
  ipcMain.handle('project-document-read', (_event, projectId, kind) => projectStore.readDocument(projectId, kind))
  ipcMain.handle('project-document-write', async (_event, projectId, kind, content) => {
    const result = projectStore.writeDocument(projectId, kind, content)
    if (projectId === projectStore.active().id && ['instructions', 'memory'].includes(kind)) {
      await synchronizeDshProject(projectStore.active(), { activate: true })
    }
    return result
  })
  ipcMain.on('media-chunk', (_event, arrayBuffer) => mediaController.acceptChunk(arrayBuffer))
  ipcMain.on('media-state', (_event, state) => mediaController.updateState(state))
  ipcMain.on('media-finished', (_event, summary) => mediaController.finalize(summary))
  ipcMain.on('media-comparison', (_event, result) => mediaController.acceptComparison(result))
}

async function createApp() {
  const applicationFeature = productDefinition.features.find((feature) => typeof feature.main?.activate === 'function')
  const browserCapabilities = new BrowserCapabilityRegistry(productDefinition)
  const { presetSourcePath, patchPath } = productDefinition.dsh
  installApplicationMenu()
  const persistentSession = session.fromPartition(productDefinition.sessionPartition)
  persistentSession.setUserAgent(app.userAgentFallback)
  bmwSession = persistentSession
  settingsStore = new GlobalSettingsStore({
    filePath: path.join(app.getPath('userData'), 'global-settings.json'),
    onState: (state) => sendToShell('global-settings-state', state)
  })
  applyProductTheme(settingsStore.snapshot().theme)
  await settingsStore.applyProxy(persistentSession)
  permissionStore = new PermissionStore(path.join(app.getPath('userData'), 'permissions.json'))
  layoutStore = new LayoutStore({
    filePath: path.join(app.getPath('userData'), 'layout-settings.json'),
    onState: (state) => sendToShell('layout-state', { ...state, agentVisible, setupVisible: layoutSetupVisible })
  })
  const initialLayout = layoutStore.snapshot()
  agentVisible = initialLayout.visible
  agentWidth = initialLayout.sidebarWidth
  projectStore = new ProjectStore({
    filePath: path.join(app.getPath('userData'), 'projects.json'),
    projectsDirectory: path.join(app.getPath('userData'), 'projects'),
    legacyWorkspacePath: path.join(app.getPath('userData'), 'agent-workspace'),
    onState: (state) => sendToShell('project-state', state)
  })
  scheduledTaskStore = new ScheduledTaskStore({
    filePath: path.join(app.getPath('userData'), 'scheduled-tasks.json'),
    onState: () => {
      if (scheduledTaskManager && projectStore) sendToShell('scheduled-task-state', scheduledTaskManager.list(projectStore.active().id))
    }
  })
  if (applicationFeature) {
    productFeatureRuntime = await applicationFeature.main.activate({
      session: persistentSession,
      moduleUrl: process.env.BMW_WEBCONTAINER_MODULE_URL || settingsStore.snapshot().webContainerModuleUrl,
      provisionedApiKey: process.env.BMW_WEBCONTAINER_API_KEY || '',
      secretPath: path.join(app.getPath('userData'), 'web-runtime-secret.json'),
      safeStorage,
      projectStore,
      onRuntimeEvent: (event) => sendToShell('web-runtime-state', event)
    })
  }
  projectPanelVisible = projectStore.needsInitialSetup()
  layoutSetupVisible = !initialLayout.configured && !projectPanelVisible
  sessionContinuity = new SessionContinuityManager({
    session: persistentSession,
    safeStorage,
    configPath: path.join(app.getPath('userData'), 'session-continuity.json'),
    snapshotPath: path.join(app.getPath('userData'), 'session-cookies.enc'),
    onState: () => browserKernel?.emitState()
  })
  await sessionContinuity.initialize()
  profileImporter = new ProductProfileImporter({
    sourceRoot: process.env.BMW_IMPORT_SOURCE_DIR || path.join(app.getPath('appData'), 'BMW'),
    targetProductId: productDefinition.id,
    projectStore,
    webRuntime: productFeatureRuntime?.webRuntime,
    session: persistentSession,
    sessionContinuity,
    safeStorage
  })

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
      nodeIntegration: false
    }
  })
  mainWindow.contentView.addChildView(shellView)

  agentView = new WebContentsView({
    webPreferences: {
      session: persistentSession,
      preload: productDefinition.dsh.preloadPath || path.join(sourceDirectory, 'preload/dsh-base-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  agentView.webContents.on('did-finish-load', () => {
    void applyDshSidebarPolicy().catch((error) => console.error('Failed to apply DSH sidebar policy', error))
    void productFeatureRuntime?.onAgentLoaded?.()
  })

  browserKernel = new BrowserKernel({
    window: mainWindow,
    session: persistentSession,
    permissionStore,
    sessionContinuity,
    projectStore,
    settingsStore,
    capabilityRegistry: browserCapabilities,
    allowedActions: browserCapabilities.allowedActions,
    artifactsDirectory: path.join(app.getPath('userData'), 'artifacts'),
    pageTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    onState: (state) => {
      sendToShell('browser-state', state)
      raiseProjectPanel()
    }
  })

  mediaController = new MediaController({
    session: persistentSession,
    preloadPath: path.join(projectDirectory, 'packages/media-native/src/preload/media-preload.cjs'),
    pagePath: path.join(projectDirectory, 'packages/media-native/src/media/media.html'),
    artifactsDirectory: path.join(app.getPath('userData'), 'artifacts'),
    resolveArtifactsDirectory: () => path.join(projectStore.active().directory, 'artifacts'),
    onStatus: (state) => sendToShell('media-status', state)
  })
  mediaController.configureDisplayMedia()
  browserKernel.setRecordingController(mediaController)
  scheduledTaskManager = new ScheduledTaskManager({
    store: scheduledTaskStore,
    execute: executeScheduledTask,
    onRun: notifyScheduledTaskRun
  })
  browserKernel.setScheduledTaskManager(scheduledTaskManager)
  if (productFeatureRuntime?.webValidation) browserKernel.setValidationManager(productFeatureRuntime.webValidation)
  productFeatureRuntime?.configure?.({
    projectStore,
    browserKernel,
    mediaController,
    Notification,
    getAgentWebContents: () => agentView?.webContents,
    getHarnessPort: () => harnessPort,
    sendToAgent,
    sendToShell,
    synchronizeDshProject,
    selectDshSession,
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
  bridge = await createBridgeServer(browserKernel, { productId: productDefinition.id,
    resolveProject: (directory) => projectStore.list().find((project) => fs.realpathSync(project.directory) === fs.realpathSync(directory)),
    toolDefinition: browserCapabilities.toolDefinition(),
    activeProjectId: () => projectStore.active().id
  })

  harnessPort = new DshHarnessPort(new DshRuntime({
    productId: productDefinition.id,
    presetId: productDefinition.dshPresetId,
    patchPath,
    presetSourcePath,
    dshHome: path.join(app.getPath('userData'), 'dsh-home'),
    sourceDshHome: resolveDshHome(),
    workspacePath: projectStore.active().directory,
    workspaceTitle: projectStore.active().name,
    mcpServerPath: path.join(projectDirectory, 'packages/browser-capability/src/browser-mcp-server.js'),
    clientPluginPath: productDefinition.dsh.clientPluginPath,
    clientPluginId: productDefinition.dsh.clientPluginId,
    wvlClientPluginPath: productDefinition.dsh.clientPluginPath,
    bridgeUrl: bridge.url,
    bridgeToken: bridge.token,
    onLog: (entry) => sendToShell('dsh-log', entry),
    onStatus: (status) => sendToShell('dsh-status', status)
  }))

  mainWindow.on('resize', layout)
  mainWindow.on('close', (event) => {
    if (process.platform !== 'darwin' || appQuitting) return
    event.preventDefault()
    overlayWindow?.hide()
    mainWindow.hide()
  })
  mainWindow.on('closed', () => {
    void stopApplicationServices()
  })

  try {
    const dshUrl = await harnessPort.start()
    await agentView.webContents.loadURL(dshUrl)
    await applyDshSidebarPolicy()
    const activeProject = projectStore.active()
    await synchronizeDshProject(activeProject, { activate: true })
    await productFeatureRuntime?.onHarnessStarted?.(activeProject)
    for (const project of projectStore.list().filter((candidate) => candidate.id !== activeProject.id)) {
      await synchronizeDshProject(project).catch((error) => console.error(`Failed to synchronize DSH workspace for ${project.name}`, error))
    }
    scheduledTaskManager.start()
    layout()
  } catch (error) {
    sendToShell('dsh-status', { state: 'error', message: error.message })
    const patchLabel = path.relative(projectDirectory, patchPath)
    await agentView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>body{font:14px system-ui;background:#111827;color:#e5e7eb;padding:24px}code{color:#7dd3fc}</style><h2>DSH did not start</h2><p>${error.message}</p><p>${PRODUCT_NAME} browser mode remains available.</p><code>dsh web --patch ${patchLabel}</code>`)}`)
  }
}

export function createBmwApplication(definition) {
  if (productDefinition) throw new Error('BMW product application is already configured.')
  productDefinition = definition
  PRODUCT_NAME = definition.name
  if (process.env.BMW_USER_DATA_DIR) {
    const isolatedUserData = path.resolve(process.env.BMW_USER_DATA_DIR)
    fs.mkdirSync(isolatedUserData, { recursive: true, mode: 0o700 })
    app.setPath('userData', isolatedUserData)
  } else if (definition.id !== 'bmw') {
    app.setPath('userData', path.join(app.getPath('appData'), definition.userDataName))
  }
  app.setName(PRODUCT_NAME)
  app.userAgentFallback = browserCompatibleUserAgent(app.userAgentFallback)
  app.whenReady().then(createApp)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show()
    layout()
  })
  app.on('before-quit', () => {
    appQuitting = true
    void stopApplicationServices()
  })
}
