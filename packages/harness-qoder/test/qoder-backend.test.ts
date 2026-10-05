import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentDriverEvent, AgentRunRequest } from '@bmw-agent/agent-contract'
import { QoderBackend } from '../src/qoder-backend.js'
function request(root: string): AgentRunRequest { return { sessionId: 'bmw-session', externalSessionId: null, runId: 'run', messageId: 'submission', project: { id: 'p', name: 'Disposable', directory: root }, text: 'hello', context: 'Project context', signal: new AbortController().signal } }
test('Qoder releases UUID-stamped user input only after the effective catalog and binds provider resume identity', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-qoder-backend-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let inputs = 0, closed = 0, resumed: string | undefined
  const backend = new QoderBackend({ configDirectory: root, connection: async () => ({ bridgeUrl: 'http://127.0.0.1:1', bridgeToken: 'fixture', binding: 'a'.repeat(64), nodeExecutable: process.execPath, mcpServerPath: '/disposable/mcp.js' }), queryFactory: input => {
    resumed = input.options.resume
    assert.deepEqual(input.options.tools, []); assert.deepEqual(input.options.settingSources, [])
    assert.equal(input.options.strictMcpConfig, true)
    return { interrupt: async () => {}, close: async () => { closed++ }, async *[Symbol.asyncIterator]() {
      yield { type: 'system', subtype: 'init', session_id: 'provider', qodercli_version: '1.1.64', tools: ['browser'], mcp_servers: [{ name: 'bmw', status: 'connected' }], skills: [], plugins: [] }
      const message = await input.prompt[Symbol.asyncIterator]().next()
      inputs++; assert.equal(message.value!.uuid, 'submission'); assert.equal(message.value!.message.content, 'hello')
      yield { type: 'assistant', session_id: 'provider', uuid: 'reply', message: { id: 'shared', content: [{ type: 'text', text: 'answer' }] } }
      yield { type: 'result', session_id: 'provider', subtype: 'success', is_error: false }
    } }
  } })
  t.after(() => backend.close())
  const run = request(root); run.externalSessionId = 'provider'
  assert.equal((await backend.prepare(run)).capabilities.browserOnly, true)
  assert.equal(inputs, 0); assert.equal(resumed, 'provider')
  const events: AgentDriverEvent[] = []
  assert.equal((await backend.run(run, async event => { events.push(event) })).outcome, 'success')
  assert.equal(inputs, 1); assert.ok(closed > 0)
  assert.equal(events[0].type, 'session.bound')
  assert.ok(events.some(event => event.type === 'message.completed' && event.text === 'answer'))
})
test('Qoder preflight failure closes its worker without consuming input or falling back to a new Session', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-qoder-backend-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let inputs = 0, closed = 0
  const backend = new QoderBackend({ configDirectory: root, connection: async () => ({ bridgeUrl: 'http://127.0.0.1:1', bridgeToken: 'fixture', binding: 'a'.repeat(64), nodeExecutable: process.execPath, mcpServerPath: '/disposable/mcp.js' }), queryFactory: () => ({ interrupt: async () => {}, close: async () => { closed++ }, async *[Symbol.asyncIterator]() {
    yield { type: 'system', subtype: 'init', session_id: 'wrong-provider', qodercli_version: '1.1.64', tools: ['browser', 'Bash'], mcp_servers: [{ name: 'bmw', status: 'connected' }], skills: [], plugins: [] }
    inputs++
  } }) })
  t.after(() => backend.close())
  await assert.rejects(backend.prepare(request(root)), /exactly BMW browser/)
  assert.equal(inputs, 0); assert.ok(closed > 0)
})
test('Qoder cancellation retains failed native cleanup ownership and recovery never resubmits input', { timeout: 5000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-qoder-backend-'))
  let releaseStopped!: () => void, releaseCleanup!: () => void, toolStarted!: () => void
  const stopped = new Promise<void>(resolve => { releaseStopped = resolve })
  const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve })
  const active = new Promise<void>(resolve => { toolStarted = resolve })
  let inputs = 0, interrupts = 0, closeAttempts = 0, physicallyClosed = 0, failClose = true
  const backend = new QoderBackend({ configDirectory: root, connection: async () => ({ bridgeUrl: 'http://127.0.0.1:1', bridgeToken: 'fixture', binding: 'a'.repeat(64), nodeExecutable: process.execPath, mcpServerPath: '/disposable/mcp.js' }), queryFactory: input => ({
    async interrupt() { interrupts++; releaseStopped() },
    async close() { closeAttempts++; if (failClose) throw new Error('Fixture worker has not closed'); await cleanup; physicallyClosed++ },
    async *[Symbol.asyncIterator]() {
      yield { type: 'system', subtype: 'init', session_id: 'provider', qodercli_version: '1.1.64', tools: ['browser'], mcp_servers: [{ name: 'bmw', status: 'connected' }], skills: [], plugins: [] }
      const message = await input.prompt[Symbol.asyncIterator]().next()
      assert.equal(message.value?.uuid, 'submission'); inputs++
      yield { type: 'assistant', session_id: 'provider', uuid: 'tool-message', message: { id: 'model-message', content: [{ type: 'tool_use', id: 'call', name: 'browser', input: { action: 'wait' } }] } }
      await stopped
    }
  }) })
  t.after(async () => { failClose = false; releaseStopped(); releaseCleanup(); await backend.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const run = request(root), events: AgentDriverEvent[] = []
  await backend.prepare(run)
  const running = backend.run(run, async event => { events.push(event); if (event.type === 'tool.started') toolStarted() })
  await active
  await assert.rejects(backend.interrupt('foreign-session', run.runId), /does not belong/)
  await backend.interrupt(run.sessionId, run.runId)
  assert.equal((await running).outcome, 'interrupted')
  assert.equal(physicallyClosed, 0); assert.equal(interrupts, 1)
  assert.ok(events.some(event => event.type === 'tool.completed' && !event.success))
  await assert.rejects(backend.prepare({ ...run, runId: 'other-run' }), /active worker/)
  await assert.rejects(backend.drain('foreign-session', run.runId), /does not belong/)
  await assert.rejects(backend.drain(run.sessionId, run.runId), /has not closed/)
  failClose = false
  let drained = false
  const draining = backend.drain(run.sessionId, run.runId).then(() => { drained = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(drained, false); assert.equal(physicallyClosed, 0)
  await assert.rejects(backend.prepare({ ...run, runId: 'other-run' }), /active worker/)
  releaseCleanup(); await draining
  assert.equal(drained, true); assert.equal(physicallyClosed, 1)
  assert.equal(inputs, 1); assert.equal(interrupts, 1); assert.equal(closeAttempts, 3)
})
