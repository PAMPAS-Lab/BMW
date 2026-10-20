import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WorkbuddySettings, markWorkbuddyVerified } from '../src/workbuddy-settings.js'
import { clearWorkbuddyCredentials, readWorkbuddyCredentials, writeWorkbuddyCredentials } from '../src/workbuddy-credentials.js'
import { fixtureEncryption } from './workbuddy-test-support.js'
import { parseAgentDriverSettings } from '@bmw-agent/agent-contract'

test('WorkBuddy encrypts keys, isolates permissions and preserves unreadable credentials', t => {
  const config = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-credentials-')))
  t.after(() => fs.rmSync(config, { recursive: true, force: true }))
  const port = fixtureEncryption(), credentials = { apiKey: 'fixture-sensitive-value', internetEnvironment: 'internal' as const }
  writeWorkbuddyCredentials(config, credentials, port)
  const file = path.join(config, 'workbuddy-credentials.enc'), bytes = fs.readFileSync(file)
  assert.equal(bytes.includes(credentials.apiKey), false)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(readWorkbuddyCredentials(config, port), credentials)
  assert.throws(() => readWorkbuddyCredentials(config, fixtureEncryption()), /解密/)
  assert.throws(() => writeWorkbuddyCredentials(config, credentials, fixtureEncryption()), /解密/)
  assert.deepEqual(fs.readFileSync(file), bytes)
  fs.writeFileSync(path.join(config, 'workbuddy-credentials.json'), '{"legacy":true}')
  assert.throws(() => readWorkbuddyCredentials(config, port), /明文/)
  assert.equal(clearWorkbuddyCredentials(config), true)
  assert.equal(readWorkbuddyCredentials(config, port), null)
  assert.throws(() => writeWorkbuddyCredentials(config, credentials), /加密/)
  assert.throws(() => writeWorkbuddyCredentials(config, credentials, { ...port, getSelectedStorageBackend: () => 'basic_text' }), /加密/)
})
test('WorkBuddy settings distinguish configured from real task verification without inference', async t => {
  const config = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-settings-')))
  t.after(() => fs.rmSync(config, { recursive: true, force: true }))
  const encryption = fixtureEncryption(), context = { signal: new AbortController().signal, openExternal: async () => assert.fail('No external authentication') }
  let model: string | null = null
  const settings = new WorkbuddySettings({ configDirectory: config, encryption, model: () => model, setModel: value => { model = value } })
  assert.equal((await settings.execute({ action: 'refresh' }, context)).authentication.state, 'required')
  const state = await settings.execute({ action: 'auth.login', methodId: 'apiKey', values: { apiKey: 'fixture-sensitive-value', environment: 'internal' } }, context)
  assert.equal(state.authentication.state, 'configured'); assert.ok(state.models.every(row => row.availability === 'unverified'))
  assert.equal(JSON.stringify(state).includes('fixture-sensitive-value'), false)
  assert.equal(parseAgentDriverSettings(state).authentication.state, 'configured')
  await settings.execute({ action: 'model.select', modelId: 'deepseek-v4.1-flash' }, context)
  assert.equal(model, 'deepseek-v4.1-flash')
  markWorkbuddyVerified(config, readWorkbuddyCredentials(config, encryption)!, model!)
  assert.equal((await settings.execute({ action: 'refresh' }, context)).authentication.state, 'ready')
  assert.equal((await settings.execute({ action: 'model.select', modelId: 'glm-5.3' }, context)).authentication.state, 'configured')
  await settings.execute({ action: 'auth.logout' }, context)
  assert.equal(readWorkbuddyCredentials(config, encryption), null)
  assert.deepEqual(fs.readdirSync(config), [])
  const abort = new AbortController(); abort.abort()
  await assert.rejects(settings.execute({ action: 'auth.login', methodId: 'apiKey', values: { apiKey: 'fixture-value' } }, { ...context, signal: abort.signal }))
  assert.equal(readWorkbuddyCredentials(config, encryption), null)
})
