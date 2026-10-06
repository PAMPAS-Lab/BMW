import assert from 'node:assert/strict'
import test from 'node:test'
import { WebSocketServer } from 'ws'
import type { AddressInfo } from 'node:net'
import { launchUrl, remoteRequest, remoteSnapshot, remoteValue } from '../src/dsh-transport.js'
import { browserRegistry } from '../dsh/plugins/browser-mcp/registry.js'

test('DSH launch authentication accepts only the owned origin and token', () => {
  const origin = 'http://127.0.0.1:9000'
  assert.equal(launchUrl(`dsh web: ${origin}/?token=secret`, origin), `${origin}/?token=secret`)
  for (const url of ['http://evil.test/?token=x', `${origin}/api/?token=x`, `${origin}/?token=x&token=y`, `${origin}/`]) {
    assert.equal(launchUrl(`dsh web: ${url}`, origin), null)
  }
})

test('DSH requests preserve named arguments and correlate prompt admission', () => {
  assert.deepEqual(remoteRequest('session.prompt', { sessionId: 's', requestId: 'untrusted' }, 'rpc-1'), {
    endpoint: 'session/prompt', payload: { args: { request: { sessionId: 's', requestId: 'rpc-1' } } }
  })
  assert.deepEqual(remoteRequest('commands/list', { args: { agentId: 's' } }, 'id').payload, { args: { agentId: 's' } })
  assert.throws(() => remoteRequest('../secret', {}, 'id'), /Invalid DSH method/)
  assert.throws(() => remoteValue({ items: [{ sessionId: 1 }] }), /identity|sessionId/)
  assert.throws(() => remoteValue({ archivedSessionIds: [1] }), /archive/)
})

test('DSH WebSocket snapshots authenticate, cancel streams and reject mismatched frames', async (t) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  t.after(() => { for (const socket of server.clients) socket.terminate(); server.close() })
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  let cancelled: () => void
  const cancellation = new Promise<void>((resolve) => { cancelled = resolve })
  server.on('connection', (socket, request) => {
    assert.equal(request.url, '/api/remote.mux')
    assert.equal(request.headers.cookie, 'dsh-auth=test')
    socket.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString()) as { type: string; streamId: string; endpoint: string; payload: unknown }
      if (message.type === 'cancel') { cancelled(); return }
      assert.deepEqual(message.payload, { args: {} })
      socket.send(JSON.stringify({ type: 'item', streamId: message.endpoint === 'broken/follow' ? 'wrong' : message.streamId, value: { type: 'baseline', value: { items: [] } } }))
    })
  })
  assert.deepEqual(await remoteSnapshot(origin, 'dsh-auth=test', 'workspace/follow', {}, 1000), { type: 'baseline', value: { items: [] } })
  await cancellation
  await assert.rejects(remoteSnapshot(origin, 'dsh-auth=test', 'broken/follow', {}, 1000), /Mismatched DSH stream/)
})

test('BMW keeps exactly browser while delegating MCP execution and cleanup to DSH', () => {
  const dispose = () => {}
  let registered: { name: string; execute?: unknown }
  const registry = browserRegistry({ register(definition) { registered = definition; return dispose } })
  const execute = () => 'upstream'
  assert.equal(registry.register({ name: 'mcp__browser__browser', execute }), dispose)
  assert.equal(registered.name, 'browser')
  assert.equal(registered.execute, execute)
  assert.throws(() => registry.register({ name: 'mcp__browser__shell' }), /only the browser/)
})

test('DSH command discovery normalizes the official array response and sends authentication', async (t) => {
  const { DshRuntime } = await import('../src/dsh-runtime.js')
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'http://127.0.0.1:9000/api/commands/list')
    assert.equal((options.headers as Record<string, string>).cookie, 'auth=private')
    const request = JSON.parse(String(options.body)) as { rpcId: string; payload: unknown }
    assert.deepEqual(request.payload, { args: { agentId: 'session' } })
    return Response.json({ rpcId: request.rpcId, result: { ok: true, value: [{ name: 'sessions' }] } })
  })
  const runtime = new DshRuntime({})
  runtime.url = 'http://127.0.0.1:9000'
  runtime.child = {}
  runtime.authCookie = 'auth=private'
  assert.deepEqual(await runtime.call('commands/list', { args: { agentId: 'session' } }), { items: [{ name: 'sessions' }] })
})


test('BMW scoped registry checks execution identity without changing model arguments or native execution context', async () => {
  let registered: { name: string; execute?: unknown }
  const execution = { agent: { session: { header: { id: 'real', cwd: '/project' } } } }
  const registry = browserRegistry({ register(definition) { registered = definition; return () => {} } }, async (args, exec) => { assert.equal(exec,execution); if(Object.hasOwn(args as object,'__bmwSession'))throw new Error('Model cannot set scope');return args })
  registry.register({ name: 'mcp__browser__browser', execute: (args: unknown, exec: unknown) => {
    assert.equal(exec, execution)
    return args
  } })
  const invoke = registered.execute as (args: unknown, execution: unknown) => Promise<unknown>
  const args={action:'status'};assert.equal(await invoke(args,execution),args)
  await assert.rejects(invoke({action:'status',__bmwSession:'forged'},execution),/cannot set scope/)
})
