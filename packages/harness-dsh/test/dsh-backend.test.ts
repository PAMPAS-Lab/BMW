import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { AgentRunRequest } from '@bmw-agent/agent-contract'
import { DshBackend } from '../src/dsh-backend.js'
import { DshEvents } from '../src/dsh-events.js'
import { DshRuntime } from '../src/dsh-runtime.js'

function request(root: string): AgentRunRequest {
  return {
    sessionId: 'bmw-session',
    externalSessionId: null,
    runId: 'run',
    messageId: 'message',
    project: { id: 'project', name: 'Disposable', directory: root },
    text: 'Must not reach the model',
    context: '',
    signal: new AbortController().signal
  }
}
test('DSH preparation failures retain cleanup ownership and permit retry only after actual native drain', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-dsh-backend-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let starts = 0,
    closes = 0
  const runtime = {
    async start() {
      starts++
      throw new Error('Fixture native startup failed')
    },
    async stopAndWait() {
      closes++
      if (closes === 1) throw new Error('Fixture native cleanup failed')
    }
  } as unknown as DshRuntime
  const backend = new DshBackend({
    userDataDirectory: root,
    sourceDshHome: root,
    project: () => ({ id: 'project', name: 'Disposable', directory: root }),
    connection: async () => ({
      bridgeUrl: 'http://127.0.0.1:1',
      bridgeToken: 'fixture',
      mcpServerPath: '/disposable/mcp.js',
      binding: 'a'.repeat(64),
      attachProviderSession() {
        assert.fail('No provider may be attached before preflight succeeds')
      }
    }),
    runtimeFactory: () => runtime
  })
  t.after(() => backend.close())
  const run = request(root)
  await assert.rejects(backend.prepare(run), /native cleanup failed/)
  await assert.rejects(backend.prepare({ ...run, runId: 'other' }), /owns another turn/)
  await assert.rejects(backend.drain(run.sessionId, 'other'), /does not belong/)
  assert.equal(starts, 1)
  assert.equal(closes, 1)
  await backend.drain(run.sessionId, run.runId)
  assert.equal(closes, 2)
  await assert.rejects(backend.prepare({ ...run, runId: 'retry' }), /native startup failed/)
  assert.equal(starts, 2)
  assert.equal(closes, 3)
  await backend.drain(run.sessionId, 'retry')
})
test('DSH rejects malformed native membership before creating a Session or submitting input', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-dsh-backend-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let closes = 0
  const runtime = {
    async start() {
      return 'http://127.0.0.1:1'
    },
    async listProjectSessions() {
      return { items: [], membership: 'foreign' }
    },
    async createProjectSession() {
      assert.fail('Malformed membership must not create a native Session')
    },
    async enqueuePrompt() {
      assert.fail('No input may be submitted')
    },
    async stopAndWait() {
      closes++
    }
  } as unknown as DshRuntime
  const backend = new DshBackend({
    userDataDirectory: root,
    sourceDshHome: root,
    project: () => ({ id: 'project', name: 'Disposable', directory: root }),
    connection: async () => ({
      bridgeUrl: 'http://127.0.0.1:1',
      bridgeToken: 'fixture',
      mcpServerPath: '/disposable/mcp.js',
      binding: 'a'.repeat(64),
      attachProviderSession() {
        assert.fail('No provider may be attached')
      }
    }),
    runtimeFactory: () => runtime
  })
  t.after(() => backend.close())
  const run = request(root)
  await assert.rejects(backend.prepare(run), /Invalid DSH Session list/)
  assert.equal(closes, 0)
  await backend.drain(run.sessionId, run.runId)
  assert.equal(closes, 1)
})
test('DSH stop retains the native process until an actual exit event, including legacy lifecycle callers', async () => {
  const signals: (NodeJS.Signals | undefined)[] = []
  const fixture = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill(signal?: NodeJS.Signals) {
      signals.push(signal)
      return true
    }
  })
  const runtime = new DshRuntime({})
  runtime.child = fixture as unknown as ChildProcess
  runtime.stop()
  assert.deepEqual(signals, ['SIGTERM'])
  let drained = false
  const drain = runtime.stopAndWait().then(() => {
    drained = true
  })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(drained, false)
  await assert.rejects(runtime.start(), /still stopping/)
  fixture.signalCode = 'SIGTERM'
  fixture.emit('exit', null, 'SIGTERM')
  await drain
  assert.equal(drained, true)
  assert.equal(fixture.listenerCount('exit'), 0)
})
test('DSH child errors cannot masquerade as physical cleanup and a later exit permits recovery', async () => {
  const fixture = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill() {
      return true
    }
  })
  const runtime = new DshRuntime({})
  runtime.child = fixture as unknown as ChildProcess
  runtime.stop = () => {
    runtime.child = null
    fixture.emit('error', new Error('Fixture cleanup transport error'))
  }
  await assert.rejects(runtime.stopAndWait(), /cleanup transport error/)
  await assert.rejects(runtime.start(), /still stopping/)
  assert.equal(fixture.listenerCount('exit'), 0)
  assert.equal(fixture.listenerCount('error'), 0)
  runtime.stop = () => {}
  const drain = runtime.stopAndWait()
  fixture.signalCode = 'SIGTERM'
  fixture.emit('exit', null, 'SIGTERM')
  await drain
})
test('DshEvents skips late tool calls observed after cancellation and settles cleanly on aborted turn/end', async () => {
  const decoder = new DshEvents('run-cancel')
  const emitted: string[] = []
  await decoder.receive(
    {
      seq: 1,
      type: 'tool/call',
      data: { name: 'browser', callId: 'call-1', arguments: JSON.stringify({ action: 'tabs.list' }) }
    },
    async event => {
      emitted.push(event.type)
    },
    true
  )
  await decoder.receive(
    {
      seq: 2,
      type: 'tool/result',
      data: {
        message: {
          toolCallId: 'call-1',
          isError: true,
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'text', text: 'cancelled' }]
        }
      }
    },
    async event => {
      emitted.push(event.type)
    },
    true
  )
  const result = await decoder.receive(
    {
      seq: 3,
      type: 'turn/end',
      data: { reason: { kind: 'aborted' } }
    },
    async event => {
      emitted.push(event.type)
    },
    true
  )
  assert.deepEqual(emitted, [])
  assert.deepEqual(result, { outcome: 'interrupted', message: 'DSH turn cancelled' })
})
