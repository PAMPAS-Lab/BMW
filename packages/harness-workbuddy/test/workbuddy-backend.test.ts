import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentDriverEvent, AgentRunRequest } from '@bmw-agent/agent-contract'
import { WorkbuddyBackend } from '../src/workbuddy-backend.js'
import type { WorkbuddyAcp, WorkbuddyAcpOptions } from '../src/workbuddy-acp.js'
import { writeWorkbuddyCredentials } from '../src/workbuddy-credentials.js'
import { WorkbuddyCleanupFailure } from '../src/workbuddy-catalog.js'
import type { WorkbuddyCatalogOptions } from '../src/workbuddy-catalog.js'
import { fixtureEncryption } from './workbuddy-test-support.js'

const definition = { name: 'browser' as const, description: 'fixture browser', inputSchema: { type: 'object', additionalProperties: false, properties: { action: { type: 'string' } } } }
interface Controls {
  prompt?(notify: (update: Record<string, unknown>, sessionId?: string) => void, input: unknown): Promise<unknown> | unknown
  gate?(options: WorkbuddyCatalogOptions): Promise<{ assertCurrent(): void }>
  close?(): Promise<void>
}
function setup(t: TestContext, controls: Controls = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-contract-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const config = path.join(root, 'profile'), project = path.join(root, 'project'); fs.mkdirSync(project)
  const encryption = fixtureEncryption(); writeWorkbuddyCredentials(config, { apiKey: 'fixture-secret-api-key', internetEnvironment: 'internal' }, encryption)
  const calls: string[] = [], prompts: unknown[] = [], notifications = new Set<(method: string, params: unknown) => void>()
  let requestHandler: ((method: string, params: unknown) => Promise<unknown>) | null = null, options: WorkbuddyAcpOptions | undefined
  const notify = (update: Record<string, unknown>, sessionId = 'native-session-1') => { for (const listener of notifications) listener('session/update', { sessionId, update }) }
  const factory = (input: WorkbuddyAcpOptions): WorkbuddyAcp => {
    options = input
    return {
      async call(method, params) {
        calls.push(method)
        if (method === 'initialize') return { protocolVersion: 1 }
        if (method === 'session/new' || method === 'session/load') return { sessionId: 'native-session-1', models: { currentModelId: 'deepseek-v4.1-flash', availableModels: [{ modelId: 'deepseek-v4.1-flash' }] } }
        if (method === 'session/prompt') {
          prompts.push(params)
          const result = controls.prompt ? await controls.prompt(notify, params) : { stopReason: 'end_turn', userMessageId: 'native-receipt-1', _meta: { 'codebuddy.ai/outcome': 'SUCCESS' } }
          const native = path.join(input.env.HOME, '.codebuddy', 'projects', '-fixture', 'native-session-1.jsonl'); fs.mkdirSync(path.dirname(native), { recursive: true }); fs.appendFileSync(native, '{"fixture":true}\n')
          return result
        }
        return {}
      },
      notify() {}, onRequest(handler) { requestHandler = handler }, onNotification(listener) { notifications.add(listener); return () => { notifications.delete(listener) } }, onFailure() {}, async close() { await controls.close?.() },
    }
  }
  let model: string | null = 'deepseek-v4.1-flash'
  const backend = new WorkbuddyBackend({ configDirectory: config, encryption, cli: path.join(import.meta.dirname, 'workbuddy-fixture.js'), model, cancellationTimeoutMs: 5, getModel: () => model, setModel: value => { model = value }, acpFactory: factory, catalogGate: { async verify(input) { calls.push('catalog'); return controls.gate ? controls.gate(input) : { assertCurrent() {} } } }, connection: async () => ({ bridgeUrl: 'http://127.0.0.1:1', bridgeToken: 'fixture', binding: 'b'.repeat(64), nodeExecutable: process.execPath, mcpServerPath: '/fixture/browser.js', definition }) })
  const request = (overrides: Partial<AgentRunRequest> = {}): AgentRunRequest => ({ sessionId: 'bmw-session', externalSessionId: null, runId: 'run-1', messageId: 'message-1', project: { id: 'project', name: 'Project', directory: project }, text: 'user input', context: 'host project context', signal: new AbortController().signal, ...overrides })
  return { root, config, backend, calls, prompts, notify, request, options: () => options!, clientRequest: (method: string, raw: unknown) => requestHandler!(method, raw) }
}
const completed = { stopReason: 'end_turn', userMessageId: 'native-receipt-1', _meta: { 'codebuddy.ai/outcome': 'SUCCESS' } }
test('WorkBuddy gates before input and cleans its ephemeral credential Home', async t => {
  const fixture = setup(t), request = fixture.request()
  assert.equal((await fixture.backend.prepare(request)).capabilities.browserOnly, true)
  assert.deepEqual(fixture.calls, ['catalog', 'initialize', 'session/new'])
  assert.equal(fixture.prompts.length, 0)
  const events: AgentDriverEvent[] = []
  assert.equal((await fixture.backend.run(request, async event => { events.push(event) })).outcome, 'success')
  assert.equal(fs.existsSync(fixture.options().env.HOME), false)
  assert.equal(events.find(event => event.type === 'input.accepted')?.receiptId, 'native-receipt-1')
  assert.match(JSON.stringify(fixture.prompts), /host project context/)
  await fixture.backend.close()
})
test('WorkBuddy rejects a failed catalog before releasing user input', async t => {
  const fixture = setup(t, { gate: async () => { throw new Error('foreign catalog') } })
  await assert.rejects(fixture.backend.prepare(fixture.request()), /foreign catalog/)
  assert.deepEqual(fixture.calls, ['catalog']); assert.equal(fixture.prompts.length, 0)
  await fixture.backend.close()
})
test('WorkBuddy serializes slow host events before terminal completion', async t => {
  const fixture = setup(t, { prompt(notify) { for (const text of ['A', 'B', 'C']) notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }); return completed } })
  const request = fixture.request(); await fixture.backend.prepare(request)
  const seen: string[] = []
  const result = await fixture.backend.run(request, async event => { if (event.type === 'message.delta') { await new Promise(resolve => setTimeout(resolve, event.text === 'A' ? 20 : 1)); seen.push(event.text) } else seen.push(event.type) })
  assert.equal(result.outcome, 'success'); assert.deepEqual(seen, ['session.bound', 'A', 'B', 'C', 'input.accepted', 'message.completed', 'turn.completed'])
})
test('WorkBuddy fails closed on foreign tools and never fabricates a receipt', async t => {
  const fixture = setup(t, { prompt(notify) { notify({ sessionUpdate: 'tool_call', toolCallId: 'call-1', name: 'Bash', status: 'in_progress' }); return completed } })
  const request = fixture.request(); await fixture.backend.prepare(request)
  const events: AgentDriverEvent[] = []
  assert.equal((await fixture.backend.run(request, async event => { events.push(event) })).outcome, 'failed')
  assert.equal(events.some(event => event.type === 'tool.started' || event.type === 'input.accepted'), false)
  assert.equal(events.at(-1)?.type, 'turn.disconnected')
})
test('WorkBuddy emits paired browser events and rejects reused tool ids', async t => {
  const fixture = setup(t, { prompt(notify) { notify({ sessionUpdate: 'tool_call', toolCallId: 'call-1', name: 'mcp__bmw__browser', status: 'in_progress' }); notify({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' }); return completed } })
  const request = fixture.request(); await fixture.backend.prepare(request)
  const events: AgentDriverEvent[] = []
  assert.equal((await fixture.backend.run(request, async event => { events.push(event) })).outcome, 'success')
  assert.deepEqual(events.filter(event => event.type.startsWith('tool.')).map(event => event.type), ['tool.started', 'tool.completed'])
})
test('WorkBuddy reports native model failures as failed and keeps Key configured', async t => {
  const fixture = setup(t, { prompt: () => ({ ...completed, _meta: { 'codebuddy.ai/outcome': 'FAILED_MODEL_REQUEST' } }) })
  const request = fixture.request(); await fixture.backend.prepare(request)
  assert.equal((await fixture.backend.run(request, async () => {})).outcome, 'failed')
  const state = await fixture.backend.settings({ action: 'refresh' }, { signal: new AbortController().signal, openExternal: async () => {} })
  assert.equal(state.authentication.state, 'configured'); assert.match(state.authentication.label, /实际任务/)
})
test('WorkBuddy retains failed cleanup ownership until explicit drain succeeds', async t => {
  let blocked = true
  const fixture = setup(t, { close: async () => { if (blocked) throw new Error('cleanup blocked') } })
  const request = fixture.request(); await fixture.backend.prepare(request)
  await assert.rejects(fixture.backend.run(request, async () => {}), /cleanup blocked/)
  assert.equal(fs.existsSync(fixture.options().env.HOME), true)
  await assert.rejects(fixture.backend.prepare(fixture.request({ runId: 'next' })), /quarantined/)
  await assert.rejects(fixture.backend.drain(request.sessionId, request.runId), /cleanup blocked/)
  blocked = false; await fixture.backend.drain(request.sessionId, request.runId)
  assert.equal(fs.existsSync(fixture.options().env.HOME), false)
})
test('WorkBuddy quarantines a failed preflight cleanup without automatic recovery', async t => {
  let recovered = 0
  const fixture = setup(t, { gate: async () => { throw new WorkbuddyCleanupFailure(async () => { recovered++ }) } })
  const request = fixture.request(); await assert.rejects(fixture.backend.prepare(request), /清理/)
  assert.equal(recovered, 0)
  await assert.rejects(fixture.backend.prepare(fixture.request({ runId: 'next' })), /quarantined/)
  await fixture.backend.drain(request.sessionId, request.runId); assert.equal(recovered, 1)
})
test('WorkBuddy keeps stable native resume binding and rejects another BMW owner', async t => {
  const fixture = setup(t), first = fixture.request()
  await fixture.backend.prepare(first); await fixture.backend.run(first, async () => {})
  const second = fixture.request({ runId: 'run-2', externalSessionId: 'native-session-1' })
  await fixture.backend.prepare(second); assert.equal(fixture.calls.at(-1), 'session/load')
  await fixture.backend.drain(second.sessionId, second.runId)
  await assert.rejects(fixture.backend.prepare(fixture.request({ runId: 'run-3', sessionId: 'foreign', externalSessionId: 'native-session-1' })), /another BMW/)
})
test('WorkBuddy rejects foreign session permissions before granting browser access', async t => {
  let fixture: ReturnType<typeof setup>
  fixture = setup(t, { async prompt() {
    await assert.rejects(fixture.clientRequest('session/request_permission', { sessionId: 'foreign', toolCall: { name: 'browser' }, options: [{ optionId: 'allow', kind: 'allow_once' }] }), /another native/)
    return completed
  } })
  const request = fixture.request(); await fixture.backend.prepare(request)
  assert.equal((await fixture.backend.run(request, async () => {})).outcome, 'failed')
})
test('WorkBuddy owns preparation before waiting on the catalog gate', async t => {
  let unblock!: () => void
  const fixture = setup(t, { gate: async options => { await new Promise<void>(resolve => { unblock = resolve }); options.signal.throwIfAborted(); return { assertCurrent() {} } } })
  const request = fixture.request(), pending = fixture.backend.prepare(request)
  const rejection = assert.rejects(pending)
  while (!unblock) await new Promise(resolve => setTimeout(resolve, 5))
  await assert.rejects(fixture.backend.prepare(fixture.request({ runId: 'next' })), /quarantined/)
  await fixture.backend.interrupt(request.sessionId, request.runId); unblock(); await rejection
  assert.equal(fixture.prompts.length, 0)
  await fixture.backend.close()
})

test('WorkBuddy cancellation cleanup failure is not retried by outer finalization', async t => {
  let closes = 0, blocked = true, promptStarted!: () => void, rejectPrompt!: (error: Error) => void
  const started = new Promise<void>(resolve => { promptStarted = resolve })
  const fixture = setup(t, { prompt: async () => { promptStarted(); return new Promise((_, reject) => { rejectPrompt = reject }) }, close: async () => { closes++; rejectPrompt(new Error('transport closed')); if (blocked) throw new Error('cancel cleanup failed') } })
  const request = fixture.request(); await fixture.backend.prepare(request)
  const running = fixture.backend.run(request, async () => {}), rejection = assert.rejects(running, /cancel cleanup failed/)
  await started
  await fixture.backend.interrupt(request.sessionId, request.runId)
  await rejection
  assert.equal(closes, 1, 'Outer finalization must retain the first failed cleanup without retry')
  const attempts = closes
  await assert.rejects(fixture.backend.prepare(fixture.request({ runId: 'next' })), /quarantined/)
  assert.equal(closes, attempts)
  blocked = false; await fixture.backend.drain(request.sessionId, request.runId)
})
