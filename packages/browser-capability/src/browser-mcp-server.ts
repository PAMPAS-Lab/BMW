#!/usr/bin/env node
import readline from 'node:readline'
import { browserToolCatalog } from './tool-catalog.js'
const bridgeUrl = process.env.BMW_BRIDGE_URL
const bridgeToken = process.env.BMW_BRIDGE_TOKEN

if (!bridgeUrl || !bridgeToken) {
  process.stderr.write('BMW MCP bridge environment is missing.\n')
  process.exit(1)
}

const catalogResponse = await fetch(`${bridgeUrl}/tool`, { headers: { authorization: `Bearer ${bridgeToken}` }, signal: AbortSignal.timeout(10000) })
if (!catalogResponse.ok) throw new Error('BMW browser catalog is unavailable')
const browserTool = browserToolCatalog(await catalogResponse.json())

async function executeBrowser(argumentsValue, signal: AbortSignal) {
  const response = await fetch(`${bridgeUrl}/execute`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bridgeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ binding: argumentsValue?.__bmwSession, arguments: Object.fromEntries(Object.entries(argumentsValue || {}).filter(([key]) => key !== '__bmwSession')) }),
    signal
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.error || `Browser bridge returned ${response.status}`)
  return result
}

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

const calls = new Map<string | number, AbortController>()
async function handle(message) {
  if (message?.method === 'notifications/cancelled') { calls.get(message.params?.requestId)?.abort(); return }
  if (!message || message.jsonrpc !== '2.0' || !Object.hasOwn(message, 'id')) return
  try {
    let result
    if (message.method === 'initialize') {
      result = {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'bmw-browser', version: '0.1.0' }
      }
    } else if (message.method === 'ping') {
      result = {}
    } else if (message.method === 'tools/list') {
      result = { tools: [browserTool] }
    } else if (message.method === 'tools/call') {
      if (message.params?.name !== 'browser') throw new Error(`Unknown tool: ${message.params?.name}`)
      const controller = new AbortController()
      calls.set(message.id, controller)
      const browserResult = await executeBrowser(message.params.arguments, controller.signal).finally(() => calls.delete(message.id))
      result = {
        content: [{ type: 'text', text: JSON.stringify(browserResult.result) }, ...(browserResult.images || [])],
        structuredContent: browserResult.result
      }
    } else {
      throw Object.assign(new Error(`Method not found: ${message.method}`), { rpcCode: -32601 })
    }
    send({ jsonrpc: '2.0', id: message.id, result })
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: error.rpcCode || -32000, message: error.message } })
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  try {
    void handle(JSON.parse(line))
  } catch (error) {
    process.stderr.write(`Invalid MCP message: ${error.message}\n`)
  }
})
