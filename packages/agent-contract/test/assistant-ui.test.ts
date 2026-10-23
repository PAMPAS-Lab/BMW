import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAssistantCommand } from '../index.js'
test('Assistant IPC admits only named bounded commands with explicit Session/run identities', () => {
  assert.deepEqual(parseAssistantCommand({ action: 'message.send', sessionId: 'session', text: 'hello' }), { action: 'message.send', sessionId: 'session', text: 'hello' })
  for (const value of [{ action: 'execute', arguments: { action: 'status' } }, { action: 'snapshot', bridgeToken: 'injected' }, { action: 'session.create', driverId: 'injected' }, { action: 'message.send', sessionId: '', text: 'hello' }, { action: 'message.send', sessionId: 's', text: 'x'.repeat(65537) }, { action: 'interaction.respond', sessionId: 's', interactionId: 'q', response: 'yes' }]) assert.throws(() => parseAssistantCommand(value))
})
test('unknown input disposition requires exact owner/run and explicit no-replay acknowledgement',()=>{
  const command={action:'input.end-cancelled-unknown',sessionId:'session',runId:'old',acknowledgement:'cancel-without-replay'}
  assert.deepEqual(parseAssistantCommand(command),command)
  for(const value of [{...command,acknowledgement:undefined},{...command,acknowledgement:'retry'},{...command,runId:''},{...command,force:true}])assert.throws(()=>parseAssistantCommand(value))
})
