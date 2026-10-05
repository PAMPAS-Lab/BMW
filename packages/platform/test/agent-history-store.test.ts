import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AgentHistoryStore } from '../src/agent-history-store.js'
test('display history survives restart, keeps bounded ordered streaming and cannot replace submission receipts', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-agent-history-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new AgentHistoryStore(directory)
  store.prepare('session', 'run', 'user', 'hello')
  store.append({ sessionId: 'session', runId: 'run', sequence: 1, createdAt: 1, event: { type: 'input.accepted', receiptId: 'provider' } })
  assert.throws(() => store.append({ sessionId: 'session', runId: 'run', sequence: 2, createdAt: 2, event: { type: 'input.accepted', receiptId: 'replacement' } }), /cannot be replaced/)
  store.append({ sessionId: 'session', runId: 'run', sequence: 2, createdAt: 2, event: { type: 'message.delta', messageId: 'reply', text: 'Hel' } })
  store.append({ sessionId: 'session', runId: 'run', sequence: 3, createdAt: 3, event: { type: 'message.completed', messageId: 'reply', text: 'Hello' } })
  assert.throws(() => store.append({ sessionId: 'session', runId: 'run', sequence: 4, createdAt: 4, event: { type: 'message.delta', messageId: 'reply', text: 'again' } }), /already completed/)
  store.markUncertain('session', 'run', 'Native transport disconnected after input acceptance')
  assert.deepEqual(new AgentHistoryStore(directory).snapshot('session'), store.snapshot('session'))
  assert.equal(store.snapshot('session').messages[1].text, 'Hello')
  assert.equal(store.snapshot('session').receipts[0].state, 'unknown')
  assert.equal(store.snapshot('session').receipts[0].outcome, null)
  assert.equal(store.snapshot('session').events.at(-1)?.event.type, 'turn.disconnected')
  assert.throws(() => store.prepare('session', 'run', 'another', 'replay'), /already been used/)
})
test('history never admits foreign, out-of-order or terminal-late events and preserves corrupt saved files', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-agent-history-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new AgentHistoryStore(directory)
  store.prepare('../session', 'run', 'user', 'hello')
  assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.json')).length, 1)
  assert.throws(() => store.append({ sessionId: 'foreign', runId: 'run', sequence: 1, createdAt: 1, event: { type: 'turn.completed', outcome: 'success', message: '' } }), /inactive submission/)
  assert.throws(() => store.append({ sessionId: '../session', runId: 'run', sequence: 2, createdAt: 1, event: { type: 'turn.completed', outcome: 'success', message: '' } }), /out of order/)
  store.append({ sessionId: '../session', runId: 'run', sequence: 1, createdAt: 1, event: { type: 'turn.completed', outcome: 'success', message: '' } })
  assert.throws(() => store.append({ sessionId: '../session', runId: 'run', sequence: 2, createdAt: 1, event: { type: 'message.completed', messageId: 'late', text: 'late' } }), /inactive submission/)
  const file = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json'))!)
  fs.writeFileSync(file, '{broken')
  assert.throws(() => new AgentHistoryStore(directory).snapshot('../session'), /Cannot load/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
})
