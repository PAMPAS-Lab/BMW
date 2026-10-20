import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createWorkbuddyAcp } from '../src/workbuddy-acp.js'

test('WorkBuddy ACP redacts provider errors, rejects pending calls and awaits child close', async () => {
  const acp = createWorkbuddyAcp({ node: process.execPath, cli: path.join(import.meta.dirname, 'workbuddy-fixture.js'), args: [], cwd: import.meta.dirname, env: { BMW_WORKBUDDY_TRANSPORT_FIXTURE: '1' } })
  assert.deepEqual(await acp.call('initialize', {}), { ok: true })
  await assert.rejects(acp.call('reject', {}), error => { assert.match(String(error), /code -32001/); assert.doesNotMatch(String(error), /secret-api-key/); return true })
  const pending = assert.rejects(acp.call('hang', {}), /closed/)
  await acp.close(); await pending; await acp.close()
  await assert.rejects(acp.call('after-close', {}), /closed/)
})

test('WorkBuddy cleanup waits for its owned MCP child process group', { skip: process.platform === 'win32' }, async () => {
  const acp = createWorkbuddyAcp({ node: process.execPath, cli: path.join(import.meta.dirname, 'workbuddy-fixture.js'), args: [], cwd: import.meta.dirname, env: { BMW_WORKBUDDY_TRANSPORT_FIXTURE: '1' } })
  const result = await acp.call('descendant', {}) as { pid: number }
  assert.equal(typeof result.pid, 'number')
  await acp.close()
  assert.throws(() => process.kill(result.pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH')
})

test('WorkBuddy malformed transport output never echoes raw credential-bearing text', async () => {
  const acp = createWorkbuddyAcp({ node: process.execPath, cli: path.join(import.meta.dirname, 'workbuddy-fixture.js'), args: [], cwd: import.meta.dirname, env: { BMW_WORKBUDDY_TRANSPORT_FIXTURE: '1' } })
  try { await assert.rejects(acp.call('malformed', {}), error => { assert.match(String(error), /Invalid WorkBuddy transport/); assert.doesNotMatch(String(error), /fixture-secret-api-key/); return true }) }
  finally { await acp.close() }
})
