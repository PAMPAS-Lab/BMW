import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, webContents } from 'electron'
import type { WebContents } from 'electron'
import bmw from '../apps/bmw/product.js'
import { createBmwApplication } from '../packages/platform/src/main.js'
import { ProjectStore } from '../packages/platform/src/project-store.js'
import { LayoutStore } from '../packages/platform/src/layout-store.js'

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-base-desktop-smoke-')))
const userData = path.join(temporary, 'user-data')
fs.mkdirSync(userData)
process.env.BMW_USER_DATA_DIR = userData
process.env.BMW_IMPORT_SOURCE_DIR = path.join(temporary, 'empty-import-source')
process.env.DSH_HOME = path.join(temporary, 'empty-source-home')
fs.mkdirSync(process.env.DSH_HOME)
const store = new ProjectStore({ filePath: path.join(userData, 'projects.json'), projectsDirectory: path.join(userData, 'projects'), legacyWorkspacePath: path.join(userData, 'legacy-workspace'), onState: undefined })
store.completeInitialSetup({ name: 'Isolated Base smoke', homeUrl: '' })
const layout = new LayoutStore({ filePath: path.join(userData, 'layout-settings.json'), onState: undefined })
layout.update({ configured: true, mode: 'sidebar' })
const errors: string[] = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, level, message) => {
    if (level >= 3 && /shell|TypeError|ReferenceError/.test(message)) errors.push(message)
  })
})
createBmwApplication(bmw)

async function waitFor<T>(operation: () => Promise<T | null>, deadline = Date.now() + 60_000): Promise<T> {
  while (Date.now() < deadline) {
    const result = await operation()
    if (result !== null) return result
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Base desktop smoke timed out.')
}

async function run(): Promise<void> {
let shell: WebContents
try {
  console.log('Base desktop smoke: Electron ready; waiting for Shell')
  shell = await waitFor(async () => webContents.getAllWebContents().find((contents) => contents.getURL().endsWith('/renderer/shell.html') && !contents.isLoading()) || null)
  const result = await shell.executeJavaScript(`(async () => {
    const api = window.bmw
    const product = await api.productInfo()
    const removed = ['feishuPanel', 'feishuStatus', 'startFeishuOAuth', 'feishuMessages', 'onFeishuState', 'onFeishuOAuthStatus']
    let denied = false
    try { await api.browser({ action: 'connector.feishu.status' }) } catch { denied = true }
    return { product, removed: removed.every((key) => !(key in api)), denied,
      chatUi: document.querySelector('[id*="feishu"]') !== null,
      projects: await api.projectState() }
  })()`)
  assert.equal(result.product.id, 'bmw')
  assert.deepEqual(result.product.features, ['feature-video'])
  assert.equal(result.removed, true)
  assert.equal(result.denied, true)
  assert.equal(result.chatUi, false)
  assert.deepEqual(result.projects.projects[0].connectors, {})
  await waitFor(async () => {
    try {
      const list = await shell.executeJavaScript('window.bmw.listDshSessions()')
      return list.items?.length ? list : null
    } catch { return null }
  })
  const before = await shell.executeJavaScript('window.bmw.projectState()')
  const created = await shell.executeJavaScript("window.bmw.createProject({ name: 'Second isolated Project', homeUrl: '' })")
  assert.equal(created.projects.length, 2)
  assert.notEqual(created.activeProjectId, before.activeProjectId)
  assert.equal(fs.existsSync(path.join(userData, 'feishu-connector.json')), false)
  assert.deepEqual(errors, [])
  console.log('PASS Base desktop: real shell, isolated DSH session, no chat UI/preload/actions/default bindings')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  app.once('will-quit', () => {
    fs.rmSync(temporary, { recursive: true, force: true })
    app.exit(Number(process.exitCode || 0))
  })
  app.quit()
}

}
app.whenReady().then(run).catch((error: unknown) => { console.error(error); app.exit(1) })
