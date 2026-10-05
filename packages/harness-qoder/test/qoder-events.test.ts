import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentDriverEvent } from '@bmw-agent/agent-contract'
import { QoderEvents, qoderBrowserCatalog } from '../src/qoder-events.js'
const init = { type: 'system', subtype: 'init', session_id: 'provider-session', qodercli_version: '1.1.64', tools: ['browser'], mcp_servers: [{ name: 'bmw', status: 'connected' }], skills: [], plugins: [] }
test('Qoder effective initialization rejects builtins, foreign MCP, inherited plugins and unsupported runtime', () => {
  assert.deepEqual(qoderBrowserCatalog(init), { sessionId: 'provider-session', runtimeVersion: '1.1.64' })
  for (const patch of [{ tools: ['browser', 'Bash'] }, { tools: [] }, { mcp_servers: [{ name: 'bmw', status: 'failed' }] }, { mcp_servers: [...init.mcp_servers, { name: 'other', status: 'connected' }] }, { plugins: [{ name: 'extra' }] }, { skills: ['shell-skill'] }, { qodercli_version: 'unknown' }]) assert.throws(() => qoderBrowserCatalog({ ...init, ...patch }))
})
test('Qoder content blocks sharing a model message ID retain distinct tool/text identities and stream one reply', async () => {
  const decoder = new QoderEvents('run', 'submission'), events: AgentDriverEvent[] = []
  const emit = async (event: AgentDriverEvent) => { events.push(event) }
  const receive = (message: unknown) => decoder.receive(message, emit)
  await receive({ type: 'stream_event', event: { type: 'message_start', message: { id: 'shared' } } })
  await receive({ type: 'assistant', uuid: 'thinking', message: { id: 'shared', content: [{ type: 'thinking', thinking: 'Private reasoning' }] } })
  await receive({ type: 'assistant', uuid: 'tool', message: { id: 'shared', content: [{ type: 'tool_use', id: 'call', name: 'browser', input: { action: 'media.screenshot' } }] } })
  await receive({ type: 'user', uuid: 'tool-result', message: { content: [{ type: 'tool_result', tool_use_id: 'call', content: [{ type: 'text', text: 'Project image' }, { type: 'image', data: 'pixels-must-not-enter-display' }] }] } })
  await receive({ type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } } })
  await receive({ type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Hello' } } })
  await receive({ type: 'assistant', uuid: 'reply', message: { id: 'shared', content: [{ type: 'text', text: 'Hello BMW' }] } })
  assert.deepEqual(await receive({ type: 'result', subtype: 'success', is_error: false }), { outcome: 'success', message: '' })
  assert.deepEqual(events.map(row => row.type), ['input.accepted', 'tool.started', 'tool.completed', 'message.delta', 'message.completed'])
  assert.equal(events[3].type === 'message.delta' && events[4].type === 'message.completed' && events[3].messageId === events[4].messageId, true)
  assert.equal(JSON.stringify(events).includes('Private reasoning'), false)
  assert.equal(JSON.stringify(events).includes('pixels-must-not-enter-display'), false)
})
test('Qoder unexpected tools, unfinished calls and mismatched streaming prefixes fail closed', async () => {
  const emit = async () => {}
  const decoder = new QoderEvents('run', 'submission')
  await assert.rejects(decoder.receive({ type: 'assistant', uuid: 'shell', message: { id: 'x', content: [{ type: 'tool_use', id: 'call', name: 'Bash', input: {} }] } }, emit), /outside BMW/)
  const running = new QoderEvents('run', 'submission')
  await running.receive({ type: 'assistant', uuid: 'browser', message: { id: 'x', content: [{ type: 'tool_use', id: 'call', name: 'browser', input: { action: 'wait' } }] } }, emit)
  await assert.rejects(running.receive({ type: 'result', subtype: 'success' }, emit), /before its browser/)
  const streaming = new QoderEvents('run', 'submission')
  await streaming.receive({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm' } } }, emit)
  await streaming.receive({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }, emit)
  await streaming.receive({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'BMW' } } }, emit)
  await assert.rejects(streaming.receive({ type: 'assistant', uuid: 'reply', message: { id: 'm', content: [{ type: 'text', text: 'different' }] } }, emit), /disagrees/)
})
test('Qoder split MCP image result stays in the native context and cannot complete a foreign call twice', async () => {
  const decoder = new QoderEvents('run', 'submission'), events: AgentDriverEvent[] = []
  const emit = async (event: AgentDriverEvent) => { events.push(event) }
  await decoder.receive({ type: 'assistant', uuid: 'tool', message: { content: [{ type: 'tool_use', id: 'screenshot', name: 'browser', input: { action: 'media.screenshot' } }] } }, emit)
  await decoder.receive({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'screenshot', content: 'Project PNG metadata' }] } }, emit)
  await decoder.receive({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'screenshot', content: [{ type: 'image', source: { data: 'native-pixels' } }] }] } }, emit)
  await decoder.receive({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'screenshot', content: [{ type: 'text', text: 'Project PNG metadata' }, { type: 'image', source: { data: 'native-pixels' } }] }] } }, emit)
  assert.equal(events.filter(row => row.type === 'tool.completed').length, 1)
  assert.equal(JSON.stringify(events).includes('native-pixels'), false)
  await assert.rejects(decoder.receive({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'foreign', content: [{ type: 'image' }] }] } }, emit), /does not belong/)
  await assert.rejects(decoder.receive({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'screenshot', content: 'duplicate text' }] } }, emit), /does not belong/)
  await assert.rejects(decoder.receive({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'screenshot', content: [{ type: 'text', text: 'Changed result' }, { type: 'image' }] }] } }, emit), /does not belong/)
  assert.equal((await decoder.receive({ type: 'result', subtype: 'success' }, emit))?.outcome, 'success')
})
