// @ts-nocheck -- BMW TypeScript migration baseline for legacy test doubles.
import assert from 'node:assert/strict'
import test from 'node:test'
import { DshRuntime } from '../src/dsh-runtime.js'

test('DSH calls use the harness RPC envelope and validate the response', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) }
    return {
      ok: true,
      async json() {
        return {
          rpcId: request.body.rpcId,
          result: { ok: true, value: { items: [] } }
        }
      }
    }
  }

  const runtime = new DshRuntime({})
  runtime.url = 'http://127.0.0.1:9876'
  runtime.child = {}
  runtime.authCookie = 'dsh-auth=test'
  const value = await runtime.call('session.list', {})

  assert.equal(request.url, 'http://127.0.0.1:9876/api/session/list')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.body.type, 'client-request')
  assert.equal(request.body.method, 'session/list')
  assert.deepEqual(request.body.payload, { args: { _request: {} } })
  assert.deepEqual(value, { items: [] })
})

test('DSH project activation creates a project-scoped BMW session', async () => {
  const calls = []
  const runtime = new DshRuntime({})
  runtime.call = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'workspace.list') return { items: [] }
    if (method === 'workspace.create') return { workspace: { workspaceId: 'workspace-1', path: payload.path, title: 'Untitled' } }
    if (method === 'workspace.rename') return { workspace: { workspaceId: payload.workspaceId, path: '/project', title: payload.title } }
    if (method === 'session.list') return { items: [] }
    if (method === 'session.create') return { sessionId: 'session-1' }
    throw new Error(`Unexpected method: ${method}`)
  }

  const result = await runtime.activateWorkspace({
    id: 'project-1',
    name: 'Research',
    directory: '/project',
    workspaceId: null,
    sessionId: null
  })

  assert.equal(result.workspace.title, 'Research')
  assert.equal(result.sessionId, 'session-1')
  assert.deepEqual(calls.at(-1), {
    method: 'session.create',
    payload: { workspaceId: 'workspace-1', agentPreset: 'bmw' }
  })
})

test('DSH project activation reuses its persistent project session', async () => {
  const calls = []
  const runtime = new DshRuntime({})
  runtime.call = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'workspace.list') return { items: [{ workspaceId: 'workspace-1', path: '/project', title: 'Research', sessionIds: ['session-kept'] }] }
    if (method === 'session.list') return { items: [{ sessionId: 'session-kept', cwd: '/project', updatedAt: 2, running: false, blank: false }] }
    throw new Error(`Unexpected method: ${method}`)
  }

  const result = await runtime.activateWorkspace({
    id: 'project-1', name: 'Research', directory: '/project', workspaceId: 'workspace-1', sessionId: 'session-kept'
  })

  assert.equal(result.sessionId, 'session-kept')
  assert.equal(calls.some(({ method }) => method === 'session.create'), false)
})

test('BMW Session Center lists only active sessions in its Project and searches content', async () => {
  const runtime = new DshRuntime({})
  runtime.ensureWorkspace = async () => ({ workspaceId: 'workspace-1', path: '/project', title: 'Research', sessionIds: ['session-a', 'session-b', 'session-archived', 'subagent'] })
  runtime.call = async (method, payload) => {
    if (method === 'session.list') return { items: [
      { sessionId: 'session-a', cwd: '/project', updatedAt: 2, running: true, blank: false, projections: { values: { title: 'Browser audit' } } },
      { sessionId: 'session-b', cwd: '/project', updatedAt: 1, running: false, blank: true },
      { sessionId: 'session-archived', cwd: '/project', updatedAt: 1, running: false, blank: false },
      { sessionId: 'subagent', cwd: '/project', updatedAt: 3, running: true, blank: false, origin: 'subagent' }
    ] }
    if (method === 'workspace.list') return { items: [{ workspaceId: 'workspace-1', sessionIds: ['session-a', 'session-b', 'session-archived', 'subagent'] }], archivedSessionIds: ['session-archived'] }
    if (method === 'session.search') {
      assert.deepEqual(payload, { query: 'evidence' })
      return { items: [{ sessionId: 'session-a', snippet: 'browser evidence' }], hasMore: false }
    }
    throw new Error(`Unexpected method: ${method}`)
  }
  const project = { directory: '/project', workspaceId: 'workspace-1', sessionId: 'session-a' }
  const listed = await runtime.listProjectSessions(project, 'evidence')
  assert.deepEqual(listed.items.map(({ sessionId }) => sessionId), ['session-a'])
  assert.equal(listed.items[0].title, 'Browser audit')
  assert.equal(listed.items[0].running, true)
})

test('BMW creates new DSH sessions with the browser-only preset', async () => {
  const runtime = new DshRuntime({})
  runtime.ensureWorkspace = async () => ({ workspaceId: 'workspace-1' })
  runtime.call = async (method, payload) => {
    assert.equal(method, 'session.create')
    assert.deepEqual(payload, { workspaceId: 'workspace-1', agentPreset: 'bmw' })
    return { sessionId: 'session-new' }
  }
  assert.deepEqual(await runtime.createProjectSession({}), { sessionId: 'session-new' })
})

test('DSH prompt submission preserves exact input and returns every Assistant output in order', async () => {
  const runtime = new DshRuntime({})
  let promptPayload
  runtime.callWithReceipt = async (method, payload) => {
    assert.equal(method, 'session.prompt')
    promptPayload = payload
    return { rpcId: 'rpc-fixture', value: { accepted: true } }
  }
  runtime.call = async (method) => {
    assert.equal(method, 'session.history')
    return {
      events: [
        { event: { type: 'user/message', data: { source: { rpcId: 'rpc-fixture' }, content: [{ type: 'text', text: 'hello' }] } } },
        { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'First output' }] } } } },
        { event: { type: 'tool/call', data: { name: 'browser' } } },
        { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Second' }, { type: 'text', text: ' output' }] } } } },
        { event: { type: 'turn/end', data: {} } }
      ]
    }
  }

  const replies = await runtime.waitForPromptReplies('session-1', await runtime.enqueuePrompt('session-1', 'hello'), { timeoutMs: 100 })

  assert.deepEqual(promptPayload.content, [{ type: 'text', text: 'hello' }])
  assert.deepEqual(replies, ['First output', 'Second output'])
  assert.equal(await runtime.waitForPromptReply('session-1', 'rpc-fixture', { timeoutMs: 100 }), 'First output\n\nSecond output')
})
