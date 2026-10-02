import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bmwProduct } from '@bmw-agent/product-bmw'
import { BrowserCapabilityRegistry } from '../src/browser-capability-registry.js'
import { createBridgeServer } from '../src/bridge-server.js'
import { SessionOperations } from '../src/session-operations.js'

test('Session operations serialize, recheck admission and recover after failure', async () => {
  const operations = new SessionOperations()
  const order: string[] = []
  let release: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let live = true
  const first = operations.run(() => {}, async () => { order.push('start'); await gate; order.push('end') })
  const second = operations.run(() => { if (!live) throw new Error('released') }, async () => { order.push('wrong') })
  const rejected = assert.rejects(second, /released/)
  const third = operations.run(() => {}, async () => { order.push('next') })
  await Promise.resolve()
  assert.deepEqual(order, ['start'])
  assert.equal(operations.busy, true)
  live = false
  release()
  await Promise.all([first, rejected, third])
  await operations.drain()
  assert.deepEqual(order, ['start', 'end', 'next'])
  assert.equal(operations.busy, false)
})

test('Browser bridge pins Project identity, revokes queued Sessions and returns only owned PNG images', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmw-session-test-'))
  const artifacts = path.join(directory, 'artifacts')
  await fs.mkdir(artifacts)
  const file = path.join(artifacts, 'capture.png')
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=', 'base64')
  await fs.writeFile(file, bytes)
  let active = 'p'
  let imagePath = file
  let calls = 0
  let release: () => void
  let started: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const began = new Promise<void>((resolve) => { started = resolve })
  const bridge = await createBridgeServer({ async execute(input) {
    calls++
    if ((input as { action: string }).action === 'wait') { started(); await gate; return {} }
    return { type: 'screenshot', path: imagePath }
  } }, { toolDefinition: new BrowserCapabilityRegistry(bmwProduct).toolDefinition(), resolveProject: (cwd) => cwd === directory ? { id: 'p', directory } : undefined, activeProjectId: () => active })
  t.after(async () => { await bridge.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const request = async (endpoint: string, body: unknown) => {
    const response = await fetch(`${bridge.url}/${endpoint}`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, value: await response.json() as { binding?: string; images?: { data: string }[]; error?: string } }
  }
  assert.equal((await request('session/register', { sessionId: 's', directory: '/' })).status, 400)
  const { value: { binding } } = await request('session/register', { sessionId: 's', directory })
  assert.equal((await request('execute', { action: 'status' })).status, 400)
  active = 'other'
  assert.equal((await request('execute', { binding, arguments: { action: 'media.screenshot' } })).status, 400)
  assert.equal(calls, 0)
  active = 'p'
  await bridge.changeProject(async () => {
    assert.equal(bridge.busy, true)
    assert.equal((await request('execute', { binding, arguments: { action: 'status' } })).status, 400)
  })
  assert.equal(bridge.busy, false)
  const image = await request('execute', { binding, arguments: { action: 'media.screenshot' } })
  assert.equal(image.value.images?.[0].data, bytes.toString('base64'))
  const child = spawn(process.execPath, [path.resolve('packages/browser-capability/src/browser-mcp-server.js')], {
    env: { ...process.env, BMW_PRODUCT_ID: 'bmw', BMW_BRIDGE_URL: bridge.url, BMW_BRIDGE_TOKEN: bridge.token }, stdio: ['pipe', 'pipe', 'pipe']
  })
  t.after(() => { child.kill() })
  const lines = readline.createInterface({ input: child.stdout })
  const received = new Promise<{ result: { content: { type: string; data?: string }[]; structuredContent: { path: string } } }>((resolve, reject) => {
    lines.once('line', (line) => { try { resolve(JSON.parse(line)) } catch (error) { reject(error) } })
    child.once('error', reject)
  })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser', arguments: { action: 'media.screenshot', __bmwSession: binding } } })}\n`)
  const wire = await received
  assert.deepEqual(wire.result.content.map((block) => block.type), ['text', 'image'])
  assert.equal(wire.result.content[1].data, bytes.toString('base64'))
  assert.equal(wire.result.structuredContent.path, file)
  child.kill()

  const outside = path.join(directory, 'outside.png')
  await fs.writeFile(outside, bytes)
  imagePath = outside
  assert.match((await request('execute', { binding, arguments: { action: 'media.screenshot' } })).value.error || '', /outside/)
  const running = request('execute', { binding, arguments: { action: 'wait' } })
  await began
  const queued = request('execute', { binding, arguments: { action: 'wait' } })
  await request('session/release', { binding })
  release()
  assert.equal((await running).status, 200)
  assert.equal((await queued).status, 400)
  assert.equal((await request('execute', { binding, arguments: { action: 'status' } })).status, 400)
})
