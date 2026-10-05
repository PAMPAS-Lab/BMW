import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAssistantCommand } from '../index.js'
test('Assistant IPC admits only named bounded commands with explicit Session/run identities', () => {
  assert.deepEqual(parseAssistantCommand({ action: 'message.send', sessionId: 'session', text: 'hello' }), { action: 'message.send', sessionId: 'session', text: 'hello' })
  for (const value of [{ action: 'execute', arguments: { action: 'status' } }, { action: 'snapshot', bridgeToken: 'injected' }, { action: 'session.create', driverId: 'injected' }, { action: 'message.send', sessionId: '', text: 'hello' }, { action: 'message.send', sessionId: 's', text: 'x'.repeat(65537) }, { action: 'interaction.respond', sessionId: 's', interactionId: 'q', response: 'yes' }]) assert.throws(() => parseAssistantCommand(value))
})
