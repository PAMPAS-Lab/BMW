import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAgentConversation, parseAgentCapabilities, parseAgentDriverEvent, parseAgentEvent } from '../index.js'
const conversation = { sessionId: 'bmw-a', projectId: 'project-a', driverId: 'qoder-cn', externalSessionId: null, title: '新会话', createdAt: 10, updatedAt: 10, archivedAt: null, parentSessionId: null, status: 'idle' }
test('BMW conversations admit a visible blank Session without a provider identity', () => {
  assert.equal(parseAgentConversation(conversation).externalSessionId, null)
  for (const value of [{ ...conversation, driverId: '../qoder' }, { ...conversation, status: 'completed-by-guess' }, { ...conversation, updatedAt: 9 }, { ...conversation, sessionId: 'wrong\nidentity' }, { ...conversation, parentSessionId: 'bmw-a' }, { ...conversation, token: 'not-a-model-field' }]) assert.throws(() => parseAgentConversation(value))
})
test('driver capability declarations fail closed instead of enabling missing features', () => {
  const capabilities = { streaming: true, images: true, interrupt: true, steer: false, fork: false, approvals: true, nativeOpen: false, browserOnly: false }
  assert.deepEqual(parseAgentCapabilities(capabilities), capabilities)
  assert.throws(() => parseAgentCapabilities({ ...capabilities, fork: undefined }))
  assert.throws(() => parseAgentCapabilities({ ...capabilities, shell: true }))
})
test('driver events reject extra execution tools and malformed interaction decisions', () => {
  assert.throws(() => parseAgentDriverEvent({ type: 'tool.started', callId: 't', name: 'shell', action: 'exec' }), /only the browser/)
  assert.throws(() => parseAgentDriverEvent({ type: 'tool.started', callId: 't', name: 'browser', action: 'page.observe', credential: 'secret' }), /Unknown Agent field/)
  assert.throws(() => parseAgentDriverEvent({ type: 'interaction.requested', interaction: { id: 'i', kind: 'approval', message: 'Approve?', choices: [{ id: 'allow', label: '允许' }, { id: 'allow', label: '重复' }] } }), /Duplicate/)
  assert.deepEqual(parseAgentDriverEvent({ type: 'interaction.requested', interaction: { id: 'i', kind: 'approval', message: 'Approve?', choices: [{ id: 'allow', label: '允许' }, { id: 'deny', label: '拒绝' }] } }).type, 'interaction.requested')
})
test('event envelopes require explicit Session/run identity and a positive replay sequence', () => {
  const event = { sessionId: 's', runId: 'r', sequence: 1, createdAt: 10, event: { type: 'turn.completed', outcome: 'interrupted', message: '' } }
  assert.deepEqual(parseAgentEvent(event), event)
  assert.throws(() => parseAgentEvent({ ...event, sequence: 0 }))
  assert.throws(() => parseAgentEvent({ ...event, runId: undefined }))
  assert.throws(() => parseAgentEvent({ ...event, event: { ...event.event, outcome: 'still-running' } }))
})
