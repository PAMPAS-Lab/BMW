import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ConversationStore } from '../src/conversation-store.js'
import { StateLoadError } from '../src/state-load.js'
function fixture(t: { after: (callback: () => void) => void }): { file: string; store: ConversationStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-conversations-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'conversations.json')
  return { file, store: new ConversationStore(file) }
}
test('blank BMW Sessions are durable and visible before either external Agent starts', t => {
  const { file, store } = fixture(t)
  const qoder = store.create('p', 'qoder-cn'), codex = store.create('p', 'codex')
  assert.notEqual(qoder.sessionId, codex.sessionId)
  assert.equal(qoder.externalSessionId, null)
  assert.deepEqual(new ConversationStore(file).list('p').map(row => row.sessionId), [qoder.sessionId, codex.sessionId])
  assert.equal(store.selected('p', 'qoder-cn'), qoder.sessionId)
  assert.equal(store.selected('p', 'codex'), codex.sessionId)
  assert.deepEqual(store.list('foreign-project'), [])
})
test('provider identities cannot silently rebind or cross Project ownership', t => {
  const { store } = fixture(t)
  const a = store.create('p', 'qoder-cn'), b = store.create('other', 'qoder-cn'), c = store.create('p', 'codex')
  store.bind(a.sessionId, 'provider-id'); store.bind(a.sessionId, 'provider-id')
  assert.throws(() => store.bind(a.sessionId, 'replacement'), /cannot change/)
  assert.throws(() => store.bind(b.sessionId, 'provider-id'), /multiple BMW/)
  assert.equal(store.get(b.sessionId).externalSessionId, null)
  store.bind(c.sessionId, 'provider-id')
  assert.throws(() => store.select(a.sessionId, 'other'), /does not belong/)
  assert.throws(() => store.create('p', 'codex', 'Branch', a.sessionId), /keep its driver/)
})
test('restart marks incomplete executions disconnected without replaying or losing their resume anchor', t => {
  const { file, store } = fixture(t)
  const session = store.create('p', 'qoder-cn')
  store.bind(session.sessionId, 'qoder-history'); store.setStatus(session.sessionId, 'running')
  const recovered = new ConversationStore(file)
  assert.equal(recovered.get(session.sessionId).status, 'disconnected')
  assert.equal(recovered.get(session.sessionId).externalSessionId, 'qoder-history')
  assert.equal(recovered.selected('p', 'qoder-cn'), session.sessionId)
})
test('foreign, running and archived Sessions cannot be selected or reordered across their boundaries', t => {
  const { store } = fixture(t)
  const a = store.create('p', 'qoder-cn'), b = store.create('p', 'qoder-cn'), c = store.create('p', 'codex')
  store.setStatus(a.sessionId, 'running')
  assert.throws(() => store.archive(a.sessionId, 'p'), /Stop and drain/)
  store.setStatus(a.sessionId, 'interrupted'); store.archive(a.sessionId, 'p')
  assert.throws(() => store.select(a.sessionId, 'p'), /Archived/)
  assert.throws(() => store.move(b.sessionId, 'p', c.sessionId), /across drivers/)
  assert.equal(store.list('p', { driverId: 'qoder-cn' }).length, 1)
  assert.equal(store.list('p', { includeArchived: true }).length, 3)
})
test('unreadable saved indexes and a second stale writer never overwrite existing state', t => {
  const { file, store } = fixture(t)
  store.create('p', 'qoder-cn')
  const second = new ConversationStore(file)
  store.create('p', 'codex')
  const before = fs.readFileSync(file, 'utf8')
  assert.throws(() => second.create('p', 'dsh'), /another writer/)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  fs.writeFileSync(file, '{corrupt')
  assert.throws(() => new ConversationStore(file), StateLoadError)
  assert.equal(fs.readFileSync(file, 'utf8'), '{corrupt')
})
