import assert from 'node:assert/strict'
import test from 'node:test'
import { createBridgeServer } from '../src/bridge-server.js'

test('Bridge shutdown cancels the active renderer wait before draining FIFO', { timeout: 5000 }, async () => {
  let entered: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const bridge = await createBridgeServer({ async execute(_input, { signal } = {}) {
    entered()
    return new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } }, { resolveProject: directory => ({ id: 'p', directory }), activeProjectId: () => 'p' })
  const request = async (endpoint: string, body: unknown) => {
    const response = await fetch(`${bridge.url}/${endpoint}`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return await response.json() as { binding?: string; ok?: boolean; error?: string }
  }
  const registration = await request('session/register', { sessionId: 's', directory: '/disposable-project' })
  const pending = request('execute', { binding: registration.binding, arguments: { action: 'media.screenshot' } })
  await started
  await bridge.close()
  const result = await pending
  assert.equal(result.ok, false)
  assert.match(result.error, /bridge shutting down/)
  assert.equal(bridge.busy, false)
})
