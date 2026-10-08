import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import type { AgentBackend, AgentRunRequest, AgentRunResult } from '@bmw-agent/agent-contract'
import { AgentHost } from '../src/agent-host.js'
import { AgentHistoryStore } from '../src/agent-history-store.js'
import { ConversationStore } from '../src/conversation-store.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
const success: AgentRunResult = { outcome: 'success', message: '' }
function fixture(t: TestContext, run: AgentBackend['run'], drain: (request: AgentRunRequest) => Promise<void> = async () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-agent-host-'))
  const conversations = new ConversationStore(path.join(root, 'sessions.json')), history = new AgentHistoryStore(path.join(root, 'history'),sessionId=>conversations.get(sessionId))
  const backend: AgentBackend = {
    description: { id: 'fixture', label: 'Isolated test', baseline: 'fixture', capabilities: { streaming: true, images: false, interrupt: true, steer: false, fork: false, approvals: true, nativeOpen: false, browserOnly: true } },
    prepare: async () => backend.description, run, interrupt: async () => {}, respond: async () => {}, close: async () => {}
  }
  let project = { id: 'p', name: 'Test', directory: root }
  const host = new AgentHost({ conversations, history, backends: [backend], currentProject: () => project, context: async () => 'Project context', drain })
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }) })
  return { host, conversations, history, backend, setProject: (id: string) => { project = { ...project, id } } }
}
test('Agent input and BMW Session appear before connection; failed catalog preflight never releases the prompt', async t => {
  let called = false
  const f = fixture(t, async () => { called = true; return success })
  f.backend.prepare = async () => ({ ...f.backend.description, capabilities: { ...f.backend.description.capabilities, browserOnly: false } })
  const session = f.host.create('fixture'), submission = f.host.enqueue(session.sessionId, 'Visible before connection')
  assert.equal(f.history.snapshot(session.sessionId).messages[0].text, 'Visible before connection')
  assert.equal(f.conversations.get(session.sessionId).status, 'queued')
  assert.equal((await f.host.wait(submission.runId)).outcome, 'failed')
  assert.equal(called, false)
  assert.equal(f.history.snapshot(session.sessionId).receipts[0].providerReceiptId, null)
})
test('provider terminal notification does not finish the receipt or release FIFO before browser drain', async t => {
  const inDrain = deferred<void>(), release = deferred<void>(), calls: string[] = []
  const f = fixture(t, async (request, emit) => {
    calls.push(request.text)
    await emit({ type: 'session.bound', externalSessionId: 'provider-' + request.sessionId })
    await emit({ type: 'input.accepted', receiptId: request.runId })
    await emit({ type: 'turn.completed', ...success })
    return success
  }, async request => { if (request.text === 'first') { inDrain.resolve(); await release.promise } })
  const session = f.host.create('fixture'), first = f.host.enqueue(session.sessionId, 'first'), second = f.host.enqueue(session.sessionId, 'second')
  await inDrain.promise
  assert.deepEqual(calls, ['first'])
  assert.equal(f.history.snapshot(session.sessionId).receipts[0].state, 'accepted')
  assert.equal(f.host.busy, true)
  release.resolve()
  await f.host.wait(first.runId); await f.host.wait(second.runId)
  assert.deepEqual(calls, ['first', 'second'])
  assert.equal(f.history.snapshot(session.sessionId).receipts.every(row => row.state === 'finished'), true)
  assert.equal(f.host.busy, false)
})
test('cancel waits for the active browser tool to drain and cancels queued input without sending it', async t => {
  const active = deferred<void>(), release = deferred<void>(), calls: string[] = []
  const f = fixture(t, async (request, emit) => {
    calls.push(request.text)
    await emit({ type: 'tool.started', callId: 'browser-call', name: 'browser', action: 'wait' })
    active.resolve(); await release.promise
    assert.equal(request.signal.aborted, true)
    await emit({ type: 'tool.completed', callId: 'browser-call', success: false, message: 'Cancelled and drained' })
    return { outcome: 'interrupted', message: '' }
  })
  const session = f.host.create('fixture'), first = f.host.enqueue(session.sessionId, 'active'), queued = f.host.enqueue(session.sessionId, 'queued')
  await active.promise
  let stopped = false
  const cancel = f.host.cancel(session.sessionId).then(() => { stopped = true })
  await Promise.resolve()
  assert.equal(stopped, false)
  assert.equal((await f.host.wait(queued.runId)).outcome, 'interrupted')
  assert.equal(f.host.busy, true)
  release.resolve(); await cancel
  assert.equal((await f.host.wait(first.runId)).outcome, 'interrupted')
  assert.deepEqual(calls, ['active'])
  assert.equal(f.host.busy, false)
})
test('cancelling another queued Session returns while the active Session keeps its browser resource', async t => {
  const active = deferred<void>(), release = deferred<void>()
  const f = fixture(t, async () => { active.resolve(); await release.promise; return success })
  const a = f.host.create('fixture'), b = f.host.create('fixture')
  const first = f.host.enqueue(a.sessionId, 'active'), queued = f.host.enqueue(b.sessionId, 'queued')
  await active.promise; await f.host.cancel(b.sessionId)
  assert.equal((await f.host.wait(queued.runId)).outcome, 'interrupted')
  assert.equal(f.host.activeRunId, first.runId)
  release.resolve(); await f.host.wait(first.runId)
})
test('failed drain quarantines resources; recovery cleans up without replaying uncertain input', async t => {
  let drainBroken = true, calls = 0
  const f = fixture(t, async (_request, emit) => { calls++; await emit({ type: 'input.accepted', receiptId: 'accepted' }); return success }, async request => {
    if (request.text === 'first' && drainBroken) throw new Error('Worker did not drain')
  })
  const session = f.host.create('fixture'), first = f.host.enqueue(session.sessionId, 'first'), second = f.host.enqueue(session.sessionId, 'queued')
  await assert.rejects(f.host.wait(first.runId), /did not drain/)
  assert.equal((await f.host.wait(second.runId)).outcome, 'failed')
  assert.equal(calls, 1)
  assert.equal(f.host.busy, true)
  assert.throws(() => f.host.enqueue(session.sessionId, 'blocked'), /disconnected/)
  assert.equal(f.history.snapshot(session.sessionId).receipts[0].state, 'unknown')
  assert.equal(f.history.snapshot(session.sessionId).receipts[0].outcome, null)
  drainBroken = false; await f.host.recover()
  assert.equal(f.host.busy, false); assert.equal(calls, 1)
})
test('transport failure after acceptance keeps the delivery uncertain without inventing success or replay', async t => {
  let calls = 0
  const f = fixture(t, async (_request, emit) => { calls++; await emit({ type: 'input.accepted', receiptId: 'receipt' }); throw new Error('Connection lost') })
  const session = f.host.create('fixture'), first = f.host.enqueue(session.sessionId, 'one message')
  await assert.rejects(f.host.wait(first.runId), /Connection lost/)
  assert.equal(f.conversations.get(session.sessionId).status, 'disconnected')
  assert.equal(f.history.snapshot(session.sessionId).receipts[0].state, 'unknown')
  assert.equal(f.history.snapshot(session.sessionId).events.some(row => row.event.type === 'turn.completed'), false)
  assert.equal(calls, 1); assert.equal(f.host.busy, false)
})
test('late or duplicate tool callbacks fail the run rather than moving admission forward', async t => {
  const f = fixture(t, async (_request, emit) => {
    await emit({ type: 'tool.started', callId: 'call', name: 'browser', action: 'inspect' })
    await emit({ type: 'tool.completed', callId: 'call', success: true, message: '' })
    await emit({ type: 'tool.completed', callId: 'call', success: true, message: '' })
    return success
  })
  const session = f.host.create('fixture'), submission = f.host.enqueue(session.sessionId, 'inspect')
  await assert.rejects(f.host.wait(submission.runId), /was not running/)
  assert.equal(f.history.snapshot(session.sessionId).receipts[0].state, 'unknown')
  assert.equal(f.host.busy, false)
})
test('a queued Session cannot execute in a different Project after selection changes', async t => {
  const active = deferred<void>(), release = deferred<void>(), calls: string[] = []
  const f = fixture(t, async request => { calls.push(request.text); active.resolve(); await release.promise; return success })
  const session = f.host.create('fixture'), first = f.host.enqueue(session.sessionId, 'first'), second = f.host.enqueue(session.sessionId, 'second')
  await active.promise; f.setProject('foreign'); release.resolve()
  await f.host.wait(first.runId)
  assert.equal((await f.host.wait(second.runId)).outcome, 'failed')
  assert.deepEqual(calls, ['first'])
  assert.throws(() => f.host.enqueue(session.sessionId, 'foreign'), /does not belong/)
})
test('approval response requires the current Project, active run and an offered choice', async t => {
  const question = deferred<void>(), answer = deferred<void>()
  let replies = 0
  const f = fixture(t, async (_request, emit) => {
    await emit({ type: 'interaction.requested', interaction: { id: 'permission', kind: 'approval', message: 'Allow browser action?', choices: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }] } })
    question.resolve(); await answer.promise
    await emit({ type: 'interaction.resolved', interactionId: 'permission' }); return success
  })
  f.backend.respond = async () => { replies++; answer.resolve() }
  const session = f.host.create('fixture'), submission = f.host.enqueue(session.sessionId, 'work')
  await question.promise
  await assert.rejects(f.host.respond(session.sessionId, 'stale', 'permission', 'allow'), /no longer active/)
  await assert.rejects(f.host.respond(session.sessionId, submission.runId, 'permission', 'invented'), /Invalid Agent approval/)
  f.setProject('foreign')
  await assert.rejects(f.host.respond(session.sessionId, submission.runId, 'permission', 'allow'), /does not belong/)
  assert.equal(replies, 0); f.setProject('p')
  await f.host.respond(session.sessionId, submission.runId, 'permission', 'allow')
  await f.host.wait(submission.runId); assert.equal(replies, 1)
})
test('provisional completion followed by provider failure never persists a finished receipt', async t => {
  const f = fixture(t, async (_request, emit) => { await emit({ type: 'turn.completed', ...success }); throw new Error('Transport teardown failed') })
  const session = f.host.create('fixture'), submission = f.host.enqueue(session.sessionId, 'work')
  await assert.rejects(f.host.wait(submission.runId), /teardown/)
  assert.equal(f.history.snapshot(session.sessionId).receipts[0].state, 'unknown')
  assert.equal(f.history.snapshot(session.sessionId).events.some(row => row.event.type === 'turn.completed'), false)
  assert.equal(f.history.snapshot(session.sessionId).events.at(-1)?.event.type, 'turn.disconnected')
})
test('failed native cleanup holds admission even after browser drain and recovery never replays input',async t=>{
  let fail=true,calls=0,drains=0
  const f=fixture(t,async()=>{calls++;return success})
  f.backend.drain=async()=>{drains++;if(fail)throw new Error('Native worker still owns a process')}
  const session=f.host.create('fixture'),submission=f.host.enqueue(session.sessionId,'work')
  await assert.rejects(f.host.wait(submission.runId),/still owns/)
  assert.equal(f.host.resourcesDisconnected,true);assert.equal(f.host.busy,true)
  assert.equal(f.history.snapshot(session.sessionId).receipts[0].state,'unknown')
  fail=false;await f.host.recover()
  assert.equal(f.host.busy,false);assert.equal(f.host.resourcesDisconnected,false);assert.equal(calls,1);assert.equal(drains,2)
})
test('late callbacks cannot resurrect an uncertain submission after its native transport settled',async t=>{
  let callback:((event:import('@bmw-agent/agent-contract').AgentDriverEvent)=>Promise<void>)|undefined
  const f=fixture(t,async(_request,emit)=>{callback=emit;throw new Error('Native transport failed')})
  const session=f.host.create('fixture'),submission=f.host.enqueue(session.sessionId,'work')
  await assert.rejects(f.host.wait(submission.runId),/transport failed/)
  const before=f.history.snapshot(session.sessionId)
  await assert.rejects(callback!({type:'input.accepted',receiptId:'late'}),/after the native run settled/)
  assert.deepEqual(f.history.snapshot(session.sessionId),before)
})

test('queued Studio requests freeze their explicit context and expose it only to the active owner',async t=>{
 const started=deferred<void>(),release=deferred<void>(),contexts:string[]=[]
 const f=fixture(t,async request=>{contexts.push(request.context);if(request.text==='first'){started.resolve();await release.promise}return success})
 const session=f.host.create('fixture'),first=f.host.enqueue(session.sessionId,'first','Pinned scene one')
 await started.promise
 assert.equal(f.host.activeContext(session.sessionId,'p'),'Pinned scene one')
 assert.equal(f.host.activeContext(session.sessionId,'foreign'),null)
 assert.equal(f.host.activeContext('foreign','p'),null)
 const second=f.host.enqueue(session.sessionId,'second','Pinned scene two')
 assert.equal(f.host.activeContext(session.sessionId,'p'),'Pinned scene one','Queued context never replaces the active request')
 release.resolve();await f.host.wait(first.runId);await f.host.wait(second.runId)
 assert.deepEqual(contexts,['Pinned scene one','Pinned scene two'])
 assert.equal(f.host.activeContext(session.sessionId,'p'),null)
 assert.throws(()=>f.host.enqueue(session.sessionId,'invalid','x'.repeat(16385)))
 assert.equal(f.history.snapshot(session.sessionId).receipts.length,2,'Invalid context cannot persist a receipt')
})
