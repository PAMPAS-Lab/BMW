import test from 'node:test'
import assert from 'node:assert/strict'
import { workbuddyAdmitsClientRequest, workbuddyAdmitsTool, workbuddyEnvironment, workbuddyMcpServer, workbuddySpawnArgs, workbuddyStopOutcome, workbuddyProtocolVersion } from '../src/workbuddy-policy.js'

test('WorkBuddy isolates launch environment, tool overlay and settings', () => {
  const env = workbuddyEnvironment({ home: '/tmp/home', apiKey: 'fixture-value', internetEnvironment: 'internal', parent: { NODE_OPTIONS: 'unsafe', CODEBUDDY_AUTH_TOKEN: 'desktop', CODEBUDDY_BASE_URL: 'https://foreign', HTTPS_PROXY: 'proxy' } })
  for (const name of ['NODE_OPTIONS', 'CODEBUDDY_AUTH_TOKEN', 'CODEBUDDY_BASE_URL', 'HTTPS_PROXY']) assert.equal(env[name], undefined)
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(env.CODEBUDDY_API_KEY, 'fixture-value')
  assert.deepEqual(workbuddySpawnArgs('model'), ['--acp', '--setting-sources', '', '--model', 'model', '--tools', 'NoDefer(mcp__bmw__browser)', '--strict-mcp-config'])
})
test('WorkBuddy admits only exact BMW tool identities and single permission channel', () => {
  for (const name of ['browser', 'mcp__bmw__browser']) {
    const toolCall = { _meta: { 'codebuddy.ai/toolName': name } }
    assert.equal(workbuddyAdmitsTool(toolCall), true)
    assert.equal(workbuddyAdmitsClientRequest('session/request_permission', { toolCall }), true)
    assert.equal(workbuddyAdmitsClientRequest('terminal/create', { toolCall }), false)
  }
  for (const name of ['Bash', 'Read', 'Write', 'ToolSearch', 'DeferExecuteTool', 'mcp__foreign__browser', 'foreign/browser', 'BMW/browser']) assert.equal(workbuddyAdmitsTool({ name, rawInput: { toolName: 'mcp__bmw__browser' } }), false)
  assert.equal(workbuddyAdmitsTool({ title: 'browser' }), false)
  assert.equal(workbuddyAdmitsTool({ name: 'browser', _meta: { 'codebuddy.ai/toolName': 'Bash' } }), false)
})
test('WorkBuddy catalog MCP declaration has no executable Session binding', () => {
  const server = workbuddyMcpServer({ node: '/node', serverPath: '/server.js', bridgeUrl: 'http://127.0.0.1:1', bridgeToken: 'fixture', catalogOnly: true })
  assert.equal(server.name, 'bmw')
  assert.equal(server.env.some(row => row.name === 'BMW_SESSION_BINDING'), false)
  assert.equal(server.env.find(row => row.name === 'BMW_CATALOG_ONLY')?.value, '1')
  assert.throws(() => workbuddyMcpServer({ node: '/node', serverPath: 'relative', bridgeUrl: 'u', bridgeToken: 't' }))
})
test('WorkBuddy native model failure cannot masquerade as end_turn success', () => {
  assert.equal(workbuddyStopOutcome({ stopReason: 'end_turn', _meta: { 'codebuddy.ai/outcome': 'SUCCESS' } }).outcome, 'success')
  for (const outcome of ['FAILED_MODEL_REQUEST', 'FAILED_AUTH', 'FAILED_UNKNOWN']) assert.equal(workbuddyStopOutcome({ stopReason: 'end_turn', _meta: { 'codebuddy.ai/outcome': outcome } }).outcome, 'failed')
  assert.equal(workbuddyStopOutcome({ stopReason: 'cancelled' }).outcome, 'interrupted')
  assert.throws(() => workbuddyProtocolVersion({ protocolVersion: 2 }))
})
