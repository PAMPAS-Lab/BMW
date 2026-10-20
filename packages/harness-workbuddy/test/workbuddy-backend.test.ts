import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentDriverEvent, AgentRunRequest, AgentRunResult } from '@bmw-agent/agent-contract'
import { WorkbuddyBackend } from '../src/workbuddy-backend.js'
import type { WorkbuddyAcp } from '../src/workbuddy-acp.js'
import { writeWorkbuddyCredentials } from '../src/workbuddy-credentials.js'

function fakeCli(root: string): string {
  const file = path.join(root, 'fake-cli.mjs')
  fs.writeFileSync(file, "console.log('2.169.0')\n")
  return file
}

interface FakeOptions {
  onPrompt?(emit: (method: string, params: unknown) => void): { stopReason: string } | Promise<{ stopReason: string }>
}

function fakeAcp(options: FakeOptions = {}): { factory: (input: unknown) => WorkbuddyAcp; calls: string[] } {
  const calls: string[] = []
  const factory = (): WorkbuddyAcp => {
    const listeners = new Set<(method: string, params: unknown) => void>()
    const notify = (method: string, params: unknown) => { for (const listener of listeners) listener(method, params) }
    return {
      call(method) {
        calls.push(method)
        if (method === 'initialize') return Promise.resolve({ protocolVersion: 1, authMethods: [] })
        if (method === 'session/new') return Promise.resolve({ sessionId: 'provider-session-1' })
        if (method === 'session/load') return Promise.resolve({})
        if (method === 'session/prompt') return Promise.resolve(options.onPrompt ? options.onPrompt(notify) : { stopReason: 'end_turn' })
        return Promise.resolve({})
      },
      notify,
      onRequest() {},
      onNotification(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
      onFailure() {},
      close() { return Promise.resolve() },
    }
  }
  return { factory, calls }
}

function request(root: string, overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    sessionId: 'bmw-session',
    externalSessionId: null,
    runId: 'run-1',
    messageId: 'message-1',
    project: { id: 'project', name: 'Project', directory: root },
    text: 'hello',
    context: '',
    signal: new AbortController().signal,
    ...overrides,
  }
}

function setup(onPrompt?: FakeOptions['onPrompt']) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-')))
  const configDirectory = path.join(root, 'profile')
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 })
  writeWorkbuddyCredentials(configDirectory, { apiKey: 'sk-test-value', internetEnvironment: 'internal' })
  const serverPath = path.join(root, 'browser-server.js')
  fs.writeFileSync(serverPath, '// bmw browser mcp\n')
  const acp = fakeAcp({ onPrompt })
  const backend = new WorkbuddyBackend({
    configDirectory,
    cli: fakeCli(root),
    node: process.execPath,
    model: 'deepseek-v4.1-flash',
    connection: async () => ({ bridgeUrl: 'http://127.0.0.1:1/bridge', bridgeToken: 'token', binding: 'binding', nodeExecutable: process.execPath, mcpServerPath: serverPath }),
    acpFactory: acp.factory as never,
  })
  return { root, backend, acp }
}

test('WorkBuddy prepares a browser-only session over ACP', async () => {
  const { backend, acp } = setup()
  const description = await backend.prepare(request('/tmp'))
  assert.equal(description.capabilities.browserOnly, true)
  assert.equal(description.id, 'workbuddy')
  assert.deepEqual(acp.calls, ['initialize', 'session/new'])
  await backend.close()
})

test('WorkBuddy streams assistant text and completes the turn', async () => {
  const { backend } = setup(notify => {
    notify('session/update', { sessionId: 'provider-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'DSH' } } })
    notify('session/update', { sessionId: 'provider-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' 已连通' } } })
    return { stopReason: 'end_turn' }
  })
  const run = request('/tmp')
  await backend.prepare(run)
  const events: AgentDriverEvent[] = []
  const result: AgentRunResult = await backend.run(run, async event => { events.push(event) })
  assert.equal(result.outcome, 'success')
  assert.equal(events[0].type, 'session.bound')
  assert.equal(events[1].type, 'input.accepted')
  const deltas = events.filter(event => event.type === 'message.delta')
  assert.equal(deltas.length, 2)
  const completed = events.find(event => event.type === 'message.completed') as { text: string }
  assert.equal(completed.text, 'DSH 已连通')
  assert.equal(events.at(-1)?.type, 'turn.completed')
  await backend.close()
})

test('WorkBuddy terminates the turn on a tool outside browser admission', async () => {
  const { backend } = setup(notify => {
    notify('session/update', { sessionId: 'provider-session-1', update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', name: 'bash', status: 'pending' } })
    return { stopReason: 'end_turn' }
  })
  const run = request('/tmp')
  await backend.prepare(run)
  const events: AgentDriverEvent[] = []
  const result = await backend.run(run, async event => { events.push(event) })
  assert.notEqual(result.outcome, 'success')
  assert.ok(events.some(event => event.type === 'turn.disconnected'))
  assert.equal(events.some(event => event.type === 'tool.started'), false)
  await backend.close()
})

test('WorkBuddy refuses to run without a stored API Key', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-bare-')))
  const configDirectory = path.join(root, 'profile')
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 })
  const backend = new WorkbuddyBackend({
    configDirectory,
    cli: fakeCli(root),
    node: process.execPath,
    model: 'deepseek-v4.1-flash',
    connection: async () => ({ bridgeUrl: 'u', bridgeToken: 't', binding: 'b', nodeExecutable: process.execPath, mcpServerPath: path.join(root, 'server.js') }),
    acpFactory: fakeAcp().factory as never,
  })
  await assert.rejects(backend.prepare(request('/tmp')), /API Key/u)
  await backend.close()
})

test('WorkBuddy rejects a model outside the admission list', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-model-')))
  const configDirectory = path.join(root, 'profile')
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 })
  writeWorkbuddyCredentials(configDirectory, { apiKey: 'sk-test-value', internetEnvironment: 'internal' })
  const backend = new WorkbuddyBackend({
    configDirectory,
    cli: fakeCli(root),
    node: process.execPath,
    model: 'not-a-verified-model',
    connection: async () => ({ bridgeUrl: 'u', bridgeToken: 't', binding: 'b', nodeExecutable: process.execPath, mcpServerPath: path.join(root, 'server.js') }),
    acpFactory: fakeAcp().factory as never,
  })
  await assert.rejects(backend.prepare(request('/tmp')), /准入名单/u)
  await backend.close()
})
