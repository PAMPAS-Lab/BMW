import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import product from '../apps/bmw/product.js'
import { BrowserCapabilityRegistry } from '../packages/browser-capability/src/browser-capability-registry.js'
import { createBridgeServer } from '../packages/browser-capability/src/bridge-server.js'
import { WorkbuddyBackend } from '../packages/harness-workbuddy/src/workbuddy-backend.js'
import { WorkbuddyCatalogGate } from '../packages/harness-workbuddy/src/workbuddy-catalog.js'
import { createWorkbuddyAcp } from '../packages/harness-workbuddy/src/workbuddy-acp.js'
import { bundledWorkbuddyCli } from '../packages/harness-workbuddy/src/workbuddy-installation.js'
import { writeWorkbuddyCredentials } from '../packages/harness-workbuddy/src/workbuddy-credentials.js'
import { fixtureEncryption } from '../packages/harness-workbuddy/test/workbuddy-test-support.js'
import type { AgentDriverEvent, AgentRunRequest } from '@bmw-agent/agent-contract'

/** Pinned official runtime + actual authenticated BMW MCP/Bridge. All inference is a local fixture. */
test('WorkBuddy official runtime gates real browser schema, executes browser and resumes the immutable provider Session', { timeout: 120000 }, async t => {
  const cli = bundledWorkbuddyCli(); assert(cli, 'Install the pinned official workspace dependency')
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-native-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace)
  const browser = new BrowserCapabilityRegistry(product).toolDefinition()
  const mcpServerPath = path.resolve('packages/browser-capability/src/browser-mcp-server.js')
  let executions = 0
  const bridge = await createBridgeServer({ async execute(input) { assert.deepEqual(input, { action: 'status' }); executions++; return { ok: true, fixture: 'BMW native browser' } } }, { toolDefinition: browser, resolveProject: directory => directory === workspace ? { id: 'project', directory } : undefined, activeProjectId: () => 'project' })
  t.after(() => bridge.close())
  assert.equal((await fetch(bridge.url + '/tool')).status, 401)
  const mcp = { node: process.execPath, serverPath: mcpServerPath, bridgeUrl: bridge.url, bridgeToken: bridge.token }
  const gate = new WorkbuddyCatalogGate()
  for (const model of ['deepseek-v4.1-flash', 'glm-5.3', 'kimi-k2.8-preview']) {
    const proof = await gate.verify({ node: process.execPath, cli, model, workspace, internetEnvironment: 'internal', browser, mcp, signal: AbortSignal.timeout(25000), watchedFiles: [] }); proof.assertCurrent()
    assert.equal(executions, 0, 'The synthetic catalog turn must never execute browser')
  }
  let modelRequests = 0, issueTool = true
  const gateway = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 8 * 1024 * 1024) { response.writeHead(413); response.end(); return } }
    if (!request.url?.includes('/chat/completions')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"code":0,"data":{"models":[]},"models":[]}'); return }
    const value = JSON.parse(body) as { model: string; tools?: { function: { name: string } }[] }
    if (!value.tools?.length) { response.writeHead(503); response.end(); return }
    modelRequests++
    assert.deepEqual(value.tools.map(tool => tool.function.name), ['mcp__bmw__browser'])
    const delta = issueTool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call-' + modelRequests, type: 'function', function: { name: 'mcp__bmw__browser', arguments: '{"action":"status"}' } }] } : { role: 'assistant', content: 'BMW local fixture complete' }
    const finish = issueTool ? 'tool_calls' : 'stop'; issueTool = false
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: ' + JSON.stringify({ id: 'fixture-' + modelRequests, object: 'chat.completion.chunk', model: value.model, choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ id: 'fixture-' + modelRequests, object: 'chat.completion.chunk', model: value.model, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\ndata: [DONE]\n\n')
  })
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve))
  t.after(() => { gateway.closeAllConnections(); return new Promise<void>(resolve => gateway.close(() => resolve())) })
  const address = gateway.address(); assert(address && typeof address !== 'string')
  const configDirectory = path.join(root, 'profile'), encryption = fixtureEncryption()
  writeWorkbuddyCredentials(configDirectory, { apiKey: 'bmw-fake-local-service-key', internetEnvironment: 'internal' }, encryption)
  let binding = ''
  const backend = new WorkbuddyBackend({ configDirectory, cli, encryption, model: 'deepseek-v4.1-flash', acpFactory: options => createWorkbuddyAcp({ ...options, env: { ...options.env, CODEBUDDY_BASE_URL: 'http://127.0.0.1:' + address.port } }), connection: async request => {
    binding = bridge.registerSession(request.sessionId, workspace)
    return { bridgeUrl: bridge.url, bridgeToken: bridge.token, binding, nodeExecutable: process.execPath, mcpServerPath, definition: browser, attachProviderSession(id) { bridge.attachProviderSession(binding, 'workbuddy', id) } }
  } })
  t.after(() => backend.close())
  let externalSessionId: string | null = null
  for (const turn of [1, 2]) {
    issueTool = true
    const request: AgentRunRequest = { sessionId: 'bmw-session', externalSessionId, runId: 'run-' + turn, messageId: 'message-' + turn, project: { id: 'project', name: 'Project', directory: workspace }, text: 'BMW local fixture turn ' + turn, context: 'Disposable BMW Project context', signal: AbortSignal.timeout(35000) }
    const before = modelRequests
    assert.equal((await backend.prepare(request)).capabilities.browserOnly, true)
    assert.equal(modelRequests, before, 'prepare must not call the live inference endpoint')
    const events: AgentDriverEvent[] = []
    const result = await backend.run(request, async event => { events.push(event) })
    assert.equal(result.outcome, 'success', JSON.stringify(events))
    const bound = events.find(event => event.type === 'session.bound'); assert(bound && bound.type === 'session.bound')
    if (externalSessionId) assert.equal(bound.externalSessionId, externalSessionId)
    externalSessionId = bound.externalSessionId
    assert.ok(events.some(event => event.type === 'input.accepted'))
    assert.ok(events.some(event => event.type === 'tool.started'))
    assert.ok(events.some(event => event.type === 'tool.completed' && event.success))
    assert.equal(events.at(-1)?.type, 'turn.completed')
    assert.equal(executions, turn)
    await bridge.releaseSession(binding)
  }
  assert.equal(modelRequests, 4)
  assert.equal(fs.readdirSync(path.join(configDirectory, 'sessions')).length, 1)
  const scan = (directory: string): void => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) scan(target); else assert.equal(fs.readFileSync(target).includes('bmw-fake-local-service-key'), false, 'Native history or credential cache must not persist the API Key') } }
  scan(configDirectory)
  assert.deepEqual(fs.readdirSync(configDirectory).sort(), ['home', 'sessions', 'task-verification.json', 'workbuddy-credentials.enc'])
  console.log(JSON.stringify({ officialCli: '2.176.0', gatedModels: 3, browserExecutions: executions, nativeResume: true, realKeyUsed: false, paidModelCalls: 0 }))
})
