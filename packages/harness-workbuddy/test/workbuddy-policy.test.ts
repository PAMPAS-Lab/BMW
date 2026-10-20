import test from 'node:test'
import assert from 'node:assert/strict'
import {
  workbuddyAdmitsClientRequest, workbuddyAdmitsTool, workbuddyArgumentsComplete, workbuddyEnvironment, workbuddyInitializeParams,
  workbuddyIsDiscoveryTool, workbuddyMcpServer, workbuddyProbeSessionParams, workbuddySessionParams, workbuddySpawnArgs, workbuddyStopOutcome,
} from '../src/workbuddy-policy.js'

test('WorkBuddy environment never inherits agent-context variables', () => {
  const env = workbuddyEnvironment({
    home: '/tmp/bmw-workbuddy/home',
    apiKey: 'sk-test',
    internetEnvironment: 'internal',
    parent: {
      PATH: '/usr/bin:/bin',
      CODEBUDDY_ARTIFACTS: '/tmp/codebuddy-artifacts',
      CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS: '/tmp/broker.sock',
      CODEBUDDY_SERVICE_PROXY_URL: 'http://127.0.0.1:63533',
      HTTPS_PROXY: 'http://127.0.0.1:63559',
      NODE_OPTIONS: '--require shim',
    },
  })
  assert.equal(env.HOME, '/tmp/bmw-workbuddy/home')
  assert.equal(env.CODEBUDDY_API_KEY, 'sk-test')
  assert.equal(env.CODEBUDDY_INTERNET_ENVIRONMENT, 'internal')
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1')
  for (const key of ['CODEBUDDY_ARTIFACTS', 'CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS', 'CODEBUDDY_SERVICE_PROXY_URL', 'HTTPS_PROXY', 'NODE_OPTIONS']) {
    assert.equal(env[key], undefined, key + ' must not reach the pinned CLI')
  }
})

test('WorkBuddy omits the credential when no key is stored', () => {
  const env = workbuddyEnvironment({ home: '/tmp/home', apiKey: null, parent: { PATH: '/usr/bin' } })
  assert.equal(Object.hasOwn(env, 'CODEBUDDY_API_KEY'), false)
  assert.equal(Object.hasOwn(env, 'CODEBUDDY_INTERNET_ENVIRONMENT'), false)
})

test('WorkBuddy keeps the CLI catalogue and drops project settings', () => {
  const args = workbuddySpawnArgs('deepseek-v4.1-flash')
  assert.equal(args[0], '--acp')
  // `--tools` filters forwarded MCP tools too, so it must never be passed.
  assert.equal(args.includes('--tools'), false)
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'user')
  assert.equal(args[args.indexOf('--model') + 1], 'deepseek-v4.1-flash')
})

test('WorkBuddy declares no filesystem or terminal capability', () => {
  const params = workbuddyInitializeParams() as { protocolVersion: number; clientCapabilities: Record<string, unknown> }
  assert.equal(params.protocolVersion, 1)
  assert.deepEqual(params.clientCapabilities.fs, { readTextFile: false, writeTextFile: false })
  assert.equal(params.clientCapabilities.terminal, false)
})

/** Mirrors the permission prompt the pinned CLI sends for BMW's browser tool. */
function permission(toolName: unknown, rawInput?: unknown): unknown {
  return { toolCall: { toolCallId: 'call-1', _meta: { 'codebuddy.ai/toolName': toolName }, rawInput }, options: [{ optionId: 'a', kind: 'allow_once' }] }
}

test('WorkBuddy admits the browser permission prompt and nothing else', () => {
  assert.equal(workbuddyAdmitsClientRequest('session/request_permission', permission('mcp__bmw__browser', { action: 'open' })), true)
  assert.equal(workbuddyAdmitsClientRequest('session/request_permission', permission('browser', { action: 'open' })), true)
  for (const method of ['fs/read_text_file', 'fs/write_text_file', 'terminal/create', 'terminal/output', 'mcp/message', 'elicitation/create']) {
    assert.equal(workbuddyAdmitsClientRequest(method, permission('browser', {})), false, method)
  }
})

test('WorkBuddy rejects a permission prompt for any built-in tool', () => {
  for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'WebFetch']) {
    assert.equal(workbuddyAdmitsClientRequest('session/request_permission', permission(tool, { command: 'ls' })), false, tool)
  }
})

test('WorkBuddy follows the forwarder to the inner tool', () => {
  const forward = (toolName: unknown, params?: unknown) => permission('DeferExecuteTool', { toolName, params })
  assert.equal(workbuddyAdmitsClientRequest('session/request_permission', forward('mcp__bmw__browser', { action: 'open' })), true)
  assert.equal(workbuddyAdmitsClientRequest('session/request_permission', forward('Bash', { command: 'rm -rf /' })), false)
  assert.equal(workbuddyAdmitsClientRequest('session/request_permission', permission('DeferExecuteTool')), false)
})

test('WorkBuddy keeps the catalogue lookup out of the admitted set', () => {
  assert.equal(workbuddyIsDiscoveryTool({ title: 'ToolSearch', rawInput: { tool_names: ['mcp__bmw__browser'] } }), true)
  assert.equal(workbuddyIsDiscoveryTool({ _meta: { 'codebuddy.ai/toolName': 'ToolSearch' } }), true)
  assert.equal(workbuddyIsDiscoveryTool({ title: 'DeferExecuteTool' }), false)
})

test('WorkBuddy refuses to admit an empty tool name', () => {
  assert.equal(workbuddyAdmitsTool({ rawInput: { action: 'open' } }), false)
  assert.equal(workbuddyAdmitsClientRequest('session/request_permission', { toolCall: {}, options: [] }), false)
  assert.equal(workbuddyAdmitsClientRequest('session/request_permission', null), false)
})

test('WorkBuddy session carries exactly one stdio MCP server', () => {
  const server = workbuddyMcpServer({
    node: '/Applications/BMW.app/Contents/MacOS/BMW',
    serverPath: '/opt/bmw/mcp/browser-server.js',
    bridgeUrl: 'http://127.0.0.1:1234/bridge',
    bridgeToken: 'token',
    binding: 'binding',
  })
  const params = workbuddySessionParams('/tmp/project', server) as { cwd: string; mcpServers: unknown[] }
  assert.equal(params.cwd, '/tmp/project')
  assert.equal(params.mcpServers.length, 1)
  const declared = params.mcpServers[0] as { type: string; name: string; command: string; args: string[]; env: { name: string; value: string }[] }
  assert.equal(declared.type, 'stdio')
  assert.equal(declared.name, 'bmw')
  assert.deepEqual(declared.args, ['/opt/bmw/mcp/browser-server.js'])
  assert.deepEqual(declared.env.map(row => row.name).sort(), ['BMW_BRIDGE_TOKEN', 'BMW_BRIDGE_URL', 'BMW_SESSION_BINDING', 'ELECTRON_RUN_AS_NODE'])
})

test('WorkBuddy rejects a relative bridge server path', () => {
  assert.throws(() => workbuddyMcpServer({ node: '/node', serverPath: 'mcp/server.js', bridgeUrl: 'u', bridgeToken: 't', binding: 'b' }))
})

test('WorkBuddy credential probe sends an empty mcpServers list, never omits it', () => {
  const params = workbuddyProbeSessionParams('/tmp/settings') as { cwd: string; mcpServers: unknown[] }
  assert.equal(params.cwd, '/tmp/settings')
  assert.deepEqual(params.mcpServers, [])
  assert.equal(Object.hasOwn(params, 'mcpServers'), true)
})

test('WorkBuddy maps official stop reasons', () => {
  assert.deepEqual(workbuddyStopOutcome({ stopReason: 'end_turn' }), { outcome: 'success', message: '' })
  assert.equal(workbuddyStopOutcome({ stopReason: 'cancelled' }).outcome, 'interrupted')
  for (const reason of ['max_tokens', 'max_turn_requests', 'refusal']) assert.equal(workbuddyStopOutcome({ stopReason: reason }).outcome, 'failed')
  assert.throws(() => workbuddyStopOutcome({ stopReason: 'unknown' }))
})

test('WorkBuddy waits out a streamed forwarder name instead of rejecting its prefix', () => {
  const forward = (toolName: string) => ({
    sessionUpdate: 'tool_call_update', toolCallId: 'call-1',
    _meta: { 'codebuddy.ai/toolName': 'DeferExecuteTool' },
    rawInput: { toolName, params: { action: 'wait' } },
  })
  // The CLI streams `mcp__bmw__browser` one fragment at a time. Judging `mcp`
  // as a settled name made BMW reject a legal browser call and end the turn.
  for (const prefix of ['', 'm', 'mcp', 'mcp__', 'mcp__bmw', 'mcp__bmw__']) {
    assert.equal(workbuddyArgumentsComplete(forward(prefix)), false, JSON.stringify(prefix))
  }
  assert.equal(workbuddyArgumentsComplete(forward('mcp__bmw__browser')), true)
  assert.equal(workbuddyAdmitsTool(forward('mcp__bmw__browser')), true)
  // A settled non-browser name is still outside admission.
  assert.equal(workbuddyArgumentsComplete(forward('bash')), true)
  assert.equal(workbuddyAdmitsTool(forward('bash')), false)
  // A `tool_call` names its tool outright and needs no argument fragment.
  const call = { sessionUpdate: 'tool_call', toolCallId: 'call-2', name: 'bash', status: 'pending' }
  assert.equal(workbuddyArgumentsComplete(call), true)
  assert.equal(workbuddyAdmitsTool(call), false)
  assert.equal(workbuddyArgumentsComplete({ ...call, name: 'browser' }), true)
  assert.equal(workbuddyAdmitsTool({ ...call, name: 'browser' }), true)
})
