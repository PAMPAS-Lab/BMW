import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import product from '../../../apps/bmw/product.js'
import { BrowserCapabilityRegistry } from '../src/browser-capability-registry.js'
import { browserToolCatalog } from '../src/tool-catalog.js'
import { createBridgeServer } from '../src/bridge-server.js'

test('BMW MCP discovers exactly browser from the authenticated product catalog', async (t) => {
  const registry = new BrowserCapabilityRegistry(product)
  const definition = registry.toolDefinition()
  const bridge = await createBridgeServer({ async execute() { throw new Error('Catalog test cannot execute actions') } }, { toolDefinition: definition })
  t.after(() => bridge.close())
  assert.equal((await fetch(`${bridge.url}/tool`)).status, 401)
  const child = spawn(process.execPath, [path.resolve('packages/browser-capability/src/browser-mcp-server.js')], {
    env: { ...process.env, BMW_BRIDGE_URL: bridge.url, BMW_BRIDGE_TOKEN: bridge.token }, stdio: ['pipe','pipe','pipe']
  })
  t.after(() => { child.kill() })
  const result = await new Promise<{ result: { tools: unknown[] } }>((resolve, reject) => {
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const line = output.split('\n').find(Boolean)
      if (!line) return
      try { resolve(JSON.parse(line)) } catch (error) { reject(error) }
    })
    child.once('error', reject)
    child.once('exit', () => { if (!output) reject(new Error('MCP exited before catalog discovery')) })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`)
  })
  assert.deepEqual(result.result.tools, [definition])
  assert.equal(registry.allowedActions.some((action) => action.startsWith('connector.')), false)
  assert.equal(product.featureIds.includes('feature-video'), true)
  assert.equal(registry.allowedActions.includes('experiment.plan.propose'), false)
})


test('MCP catalog admission rejects extra tools and malformed action boundaries', () => {
  const tool = new BrowserCapabilityRegistry(product).toolDefinition()
  assert.deepEqual(browserToolCatalog(tool), tool)
  assert.throws(() => browserToolCatalog({ ...tool, name: 'shell' }), /exactly browser/)
  assert.throws(() => browserToolCatalog({ ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: true } }), /input schema/)
  assert.throws(() => browserToolCatalog({ ...tool, inputSchema: { ...tool.inputSchema, properties: { action: { type: 'string', enum: [7] } } } }), /action enum/)
})
