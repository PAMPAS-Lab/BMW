import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
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
    env: { ...process.env, BMW_BRIDGE_URL: bridge.url, BMW_BRIDGE_TOKEN: bridge.token, BMW_SESSION_BINDING:'', BMW_CATALOG_ONLY:'1' }, stdio: ['pipe','pipe','pipe']
  })
  t.after(() => { child.kill() })
  // MCP messages are newline-delimited, not aligned to stdout chunks. The
  // effective catalog can cross pipe buffers and UTF-8 characters can be split.
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  t.after(() => lines.close())
  function response<T>(): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('MCP response deadline exceeded')), 10000)
      const closed = () => finish(new Error('MCP exited before a complete response'))
      const failed = (error: Error) => finish(error)
      const received = (line: string) => {
        try { finish(undefined, JSON.parse(line) as T) } catch (error) { finish(error as Error) }
      }
      function finish(error?: Error, result?: T) {
        clearTimeout(timeout)
        lines.off('line', received)
        lines.off('close', closed)
        child.off('error', failed)
        if (error) reject(error)
        else resolve(result as T)
      }
      lines.once('line', received)
      lines.once('close', closed)
      child.once('error', failed)
    })
  }
  const discovery = response<{ jsonrpc: string; id: number; result: { tools: unknown[] } }>()
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n')
  const result = await discovery
  assert.equal(result.jsonrpc, '2.0')
  assert.equal(result.id, 1)
  assert.deepEqual(result.result.tools, [definition])
  const denied = response<{ jsonrpc: string; id: number; error: { message: string } }>()
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'browser',arguments:{action:'status'}}})+'\n')
  const denial = await denied
  assert.equal(denial.jsonrpc, '2.0')
  assert.equal(denial.id, 2)
  assert.match(denial.error.message,/catalog-only connection cannot execute/)
  lines.close()
  assert.equal(registry.allowedActions.some((action) => action.startsWith('connector.')), false)
  assert.equal(product.featureIds.includes('feature-video'), true)
  assert.equal(registry.allowedActions.includes('experiment.plan.propose'), false)
  for(const name of ['media.image.inspect','media.image.annotate','media.image.draw'])assert.ok(registry.allowedActions.includes(name))
  const shapes=definition.inputSchema.properties.shapes
  assert.equal(shapes.maxItems,128)
  assert.equal(Object.hasOwn(definition.inputSchema.properties,'svg'),false)
  assert.match(definition.description,/media\.image\.annotate/)
})


test('MCP catalog admission rejects extra tools and malformed action boundaries', () => {
  const tool = new BrowserCapabilityRegistry(product).toolDefinition()
  assert.deepEqual(browserToolCatalog(tool), tool)
  assert.throws(() => browserToolCatalog({ ...tool, name: 'shell' }), /exactly browser/)
  assert.throws(() => browserToolCatalog({ ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: true } }), /input schema/)
  assert.throws(() => browserToolCatalog({ ...tool, inputSchema: { ...tool.inputSchema, properties: { action: { type: 'string', enum: [7] } } } }), /action enum/)
})
