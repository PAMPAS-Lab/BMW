import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
if (process.argv.includes('--version')) console.log('2.176.0')
else if (process.env.BMW_WORKBUDDY_GRANDCHILD === '1') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000) }
else if (process.env.BMW_WORKBUDDY_TRANSPORT_FIXTURE === '1') {
  const lines = createInterface({ input: process.stdin })
  lines.on('line', line => {
    const value = JSON.parse(line) as { id: number; method: string }
    if (value.method === 'malformed') { console.log('fixture-secret-api-key invalid transport JSON') }
    else if (value.method === 'descendant') {
      const child = spawn(process.execPath, [process.argv[1]], { env: { BMW_WORKBUDDY_GRANDCHILD: '1' }, stdio: 'ignore' })
      setTimeout(() => console.log(JSON.stringify({ jsonrpc: '2.0', id: value.id, result: { pid: child.pid } })), 100)
    } else if (value.method === 'reject') console.log(JSON.stringify({ jsonrpc: '2.0', id: value.id, error: { code: -32001, message: 'secret-api-key' } }))
    else if (value.method === 'hang') return
    else console.log(JSON.stringify({ jsonrpc: '2.0', id: value.id, result: { ok: true } }))
  })
}
else if (process.argv.includes('--acp')) {
  const lines = createInterface({ input: process.stdin })
  lines.on('line', text => {
    const value = JSON.parse(text) as { id?: number; method: string; params: { mcpServers?: { env: { name: string; value: string }[] }[] } }
    if (value.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: value.id, result: { protocolVersion: 1 } }))
    if (value.method === 'session/new') {
      const server = value.params.mcpServers?.[0], environment = Object.fromEntries((server?.env ?? []).map(row => [row.name, row.value]))
      bridge = { url: environment.BMW_BRIDGE_URL, token: environment.BMW_BRIDGE_TOKEN }
      console.log(JSON.stringify({ jsonrpc: '2.0', id: value.id, result: { sessionId: 'fixture-session' } }))
    }
    if (value.method === 'session/prompt') void drive().then(() => console.log(JSON.stringify({ jsonrpc: '2.0', id: value.id, result: { stopReason: 'end_turn' } })))
  })
  let bridge: { url: string; token: string }
  const model = process.argv[process.argv.indexOf('--model') + 1]
  async function drive(): Promise<void> {
    const definition = await (await fetch(bridge.url + '/tool', { headers: { authorization: 'Bearer ' + bridge.token } })).json() as { description: string; inputSchema: Record<string, unknown> }
    const tool: { type: string; function: { name: string; description: string; parameters: Record<string, unknown> } } = { type: 'function', function: { name: model === 'foreign' ? 'mcp__evil__browser' : 'mcp__bmw__browser', description: definition.description, parameters: { ...definition.inputSchema, additionalProperties: true } } }
    if (model === 'schema') tool.function.parameters = { type: 'object' }
    const tools = model === 'empty' ? [] : model === 'extra' ? [tool, { type: 'function', function: { name: 'Bash' } }] : [tool]
    const target = process.env.CODEBUDDY_BASE_URL + (model === 'endpoint' ? '/foreign' : '/v1/chat/completions')
    if (model === 'auxiliary') await fetch(target, { method: 'POST', body: JSON.stringify({ model, tools: [] }) })
    await fetch(target, { method: 'POST', body: JSON.stringify({ model: model === 'wrong-model' ? 'other' : model, tools }) })
  }
}
