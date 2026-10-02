import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DshRuntime } from '../packages/harness-dsh/index.js'
import product from '../apps/bmw/product.js'
import { createBridgeServer } from '../packages/browser-capability/src/bridge-server.js'
import { BrowserCapabilityRegistry } from '../packages/browser-capability/src/browser-capability-registry.js'

const root = path.resolve(import.meta.dirname, '..')
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-dsh-compatibility-')))
const products = [{ ...product, ...product.dsh }]
try {
  for (const product of products) {
    const workspace = path.join(temporary, product.id, 'workspace')
    fs.mkdirSync(workspace, { recursive: true })
    const bridge = await createBridgeServer({ async execute() { return {} } }, { toolDefinition: new BrowserCapabilityRegistry(product).toolDefinition(), resolveProject: (directory) => directory === workspace ? { id: 'smoke', directory } : undefined, activeProjectId: () => 'smoke' })
    const runtime = new DshRuntime({ ...product, productId: product.id, presetId: product.id,
      dshHome: path.join(temporary, product.id, 'home'), sourceDshHome: path.join(temporary, 'empty-source-home'),
      workspacePath: workspace, workspaceTitle: 'Compatibility smoke',
      mcpServerPath: path.join(root, 'packages/browser-capability/src/browser-mcp-server.js'),
      bridgeUrl: bridge.url, bridgeToken: bridge.token,
      onLog: ({ text }: { text: string }) => process.stderr.write(text) })
    try {
      const url = await runtime.start()
      assert.ok(new URL(url).searchParams.get('token'))
      const project = { directory: workspace, name: 'Compatibility smoke' }
      const active = await runtime.activateWorkspace(project)
      const sessionId = active.sessionId
      assert.ok(sessionId)
      assert.equal((await runtime.activateWorkspace(project)).sessionId, sessionId)
      await runtime.call('session.rename', { sessionId, title: 'Smoke renamed' })
      const list = await runtime.listProjectSessions(project, 'Smoke')
      assert.equal(list.items[0].title, 'Smoke renamed')
      const history = await runtime.call('session.history', { sessionId })
      assert.ok(Array.isArray(history.events))
      await assert.rejects(runtime.call('session.fork', { sessionId }), /no completed turn/)
      const fork = await runtime.createProjectSession(project)
      assert.ok(fork.sessionId)
      await runtime.call('session.cancel', { sessionId })
      await runtime.call('workspace.archiveSession', { sessionId: fork.sessionId })
      assert.equal((await runtime.listProjectSessions(project)).items.some((item) => item.sessionId === fork.sessionId), false)
      if (product.id === 'bmw-dev') {
        const commands = await runtime.call('commands/list', { args: { agentId: sessionId } })
        assert.ok(commands.items?.some((item) => (item as unknown as { name: string }).name === 'wvl'))
        const html = await (await fetch(runtime.url, { headers: runtime.authHeaders() })).text()
        assert.ok(html.includes('wvl-client'), 'WVL bundle must be in the official ClientModule graph')
      }
      console.log(`PASS ${product.id}: authenticated startup, preset, session reuse/rename/search/history/empty-fork guard/cancel/archive`)
    } finally { runtime.stop(); await bridge.close() }
  }
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
