import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentBackend } from '@bmw-agent/agent-contract'
import { AgentHost } from '../src/agent-host.js'
import { AgentHistoryStore } from '../src/agent-history-store.js'
import { ConversationStore } from '../src/conversation-store.js'
import { AssistantController } from '../src/assistant-controller.js'
import { AgentPreferenceStore } from '../src/agent-preference-store.js'
test('Assistant controls persist per-Project driver selection, reject foreign Sessions and exclude transitions during a turn', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-assistant-controller-'))
  const conversations = new ConversationStore(path.join(root, 'sessions.json')), history = new AgentHistoryStore(path.join(root, 'history'))
  const preferences = new AgentPreferenceStore(path.join(root, 'preferences.json'), 'a')
  let finish!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve }), began = new Promise<void>(resolve => { started = resolve })
  function backend(id: string): AgentBackend {
    const value: AgentBackend = { description: { id, label: id, baseline: 'isolated fixture', capabilities: { streaming: false, images: false, interrupt: true, steer: false, fork: false, approvals: false, nativeOpen: false, browserOnly: true } }, prepare: async () => value.description, run: async () => { started(); await gate; return { outcome: 'success', message: '' } }, interrupt: async () => { finish() }, respond: async () => {}, close: async () => { finish() } }
    return value
  }
  const host = new AgentHost({ conversations, history, backends: [backend('a'), backend('b')], currentProject: () => ({ id: 'p', name: 'Disposable', directory: root }), context: async () => '', drain: async () => {} })
  t.after(async () => { finish(); await host.close(); fs.rmSync(root, { recursive: true, force: true }) })
  let transitions = 0
  const controller = new AssistantController({ host, history, conversations, currentProject: () => ({ id: 'p', name: 'Disposable' }), getDriver: id => preferences.get(id), setDriver: (id, driver) => preferences.set(id, driver), transition: async operation => { transitions++; await operation() }, onSelection: async () => {} })
  const foreign = conversations.create('other', 'a')
  await assert.rejects(controller.invoke({ action: 'session.select', sessionId: foreign.sessionId }), /does not belong/)
  await assert.rejects(controller.invoke({ action: 'driver.select', driverId: 'missing' }), /not installed/)
  assert.equal(transitions, 0)
  const switched=await controller.invoke({ action: 'driver.select', driverId: 'b' })
  assert.ok(switched.selectedSessionId)
  assert.equal(switched.sessions.length,1)
  assert.equal(switched.sessions[0].externalSessionId,null)
  assert.equal(switched.sessions[0].driverId,'b')
  assert.equal(new AgentPreferenceStore(path.join(root, 'preferences.json'), 'a').get('p'), 'b')
  assert.equal(preferences.get('other'), 'a')
  const created = await controller.invoke({ action: 'session.create', title: 'Blank before startup' })
  assert.equal(created.messages.length, 0)
  assert.equal(created.sessions.length,2)
  assert.equal(created.sessions.at(-1)?.externalSessionId, null)
  assert.equal(created.sessions.at(-1)?.driverId, 'b')
  const selected = created.selectedSessionId!
  await controller.invoke({ action: 'message.send', sessionId: selected, text: 'Execute' })
  await began
  await assert.rejects(controller.invoke({ action: 'driver.select', driverId: 'a' }), /Stop and drain/)
  await assert.rejects(controller.invoke({ action: 'session.archive', sessionId: selected }), /Stop and drain/)
  await assert.rejects(controller.invoke({ action: 'message.send', sessionId: foreign.sessionId, text: 'Foreign' }), /does not belong/)
  await controller.invoke({ action: 'message.cancel', sessionId: selected })
  const archived = await controller.invoke({ action: 'session.archive', sessionId: selected })
  assert.equal(archived.selectedSessionId, null)
  assert.equal(archived.sessions.length, 1)
  assert.equal(conversations.get(selected).driverId, 'b')
  const firstB=switched.selectedSessionId!
  const switchedA=await controller.invoke({action:'driver.select',driverId:'a'})
  assert.notEqual(switchedA.selectedSessionId,firstB)
  assert.equal(switchedA.messages.length,0)
  const restoredB=await controller.invoke({action:'driver.select',driverId:'b'})
  assert.equal(restoredB.selectedSessionId,firstB,'The remaining active conversation is reused; the archived conversation stays archived')
  assert.equal(restoredB.sessions.filter(row=>row.driverId==='b').length,1)
  const restoredA=await controller.invoke({action:'driver.select',driverId:'a'})
  assert.equal(restoredA.selectedSessionId,switchedA.selectedSessionId)
})
