// @ts-nocheck -- BMW TypeScript migration baseline for legacy test doubles.
import assert from 'node:assert/strict'
import test from 'node:test'
import { BMW_DSH_BASELINE, DshHarnessPort } from '../src/harness-port.js'

test('HarnessPort delegates runtime operations through a stable BMW interface', async () => {
  const calls = []
  const runtime = {
    child: {}, url: 'http://127.0.0.1:1234',
    async start() { calls.push('start'); return this.url },
    stop() { calls.push('stop') },
    async enqueuePrompt(sessionId, text) { calls.push({ sessionId, text }); return 'rpc-1' }
  }
  const port = new DshHarnessPort(runtime)
  assert.equal(await port.start(), runtime.url)
  assert.equal(await port.enqueuePrompt('session-1', 'hello'), 'rpc-1')
  port.stop()
  assert.deepEqual(calls, ['start', { sessionId: 'session-1', text: 'hello' }, 'stop'])
})

test('HarnessPort detects WVL commands and client bundle without making them mandatory', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => ({ text: async () => '<script>./plugins/wvl-client</script>' })
  const runtime = {
    child: {}, url: 'http://127.0.0.1:1234',
    async call(method, payload) {
      assert.equal(method, 'commands/list')
      assert.deepEqual(payload, { args: { agentId: 'session-1' } })
      return { items: [{ name: 'wvl' }, { name: 'runs' }] }
    }
  }
  const capabilities = await new DshHarnessPort(runtime).capabilities('session-1')
  assert.equal(capabilities.baseline, BMW_DSH_BASELINE)
  assert.equal(capabilities.commands, true)
  assert.equal(capabilities.wvlHostCommand, true)
  assert.equal(capabilities.wvlClient, true)
  assert.equal(capabilities.commandUi, false)
  assert.equal(capabilities.conversationInputDock, false)
  assert.equal(capabilities.warning, null)
})

test('HarnessPort owns health, cancellation and runtime event subscriptions', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => ({ ok: true, status: 200 })
  let listener
  const calls = []
  const runtime = {
    child: {},
    url: 'http://127.0.0.1:1234',
    async call(method, payload) { calls.push({ method, payload }); return { cancelled: true } },
    subscribe(next) { listener = next; return () => { listener = null } }
  }
  const port = new DshHarnessPort(runtime)
  const events = []
  const unsubscribe = port.subscribe((event) => events.push(event))
  listener({ type: 'status', value: { state: 'ready' } })
  assert.equal((await port.health()).ready, true)
  assert.deepEqual(await port.cancelSession('session-1'), { cancelled: true })
  assert.deepEqual(calls, [{ method: 'session.cancel', payload: { sessionId: 'session-1' } }])
  assert.deepEqual(events, [{ type: 'status', value: { state: 'ready' } }])
  unsubscribe()
  assert.equal(listener, null)
})
