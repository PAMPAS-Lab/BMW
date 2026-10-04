import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserFailureGuard } from '../dsh/plugins/browser-mcp/failure-guard.js'
import { browserRegistry, type Definition } from '../dsh/plugins/browser-mcp/registry.js'

test('repeated infrastructure failures stop only their official Session until next turn', async () => {
  const guard = new BrowserFailureGuard(), session = {}, other = {}
  let definition: Definition
  const registry = browserRegistry({ register(value) { definition = value; return () => {} } }, undefined, (_execution, error) => guard.observe(session, error))
  registry.register({ name: 'mcp__browser__browser', execute: async () => { throw new Error('BMW_BROWSER_TIMEOUT: media.screenshot/capture-png') } })
  const execute = definition.execute as () => Promise<unknown>
  for (let i = 0; i < 3; i++) await assert.rejects(execute(), /TIMEOUT/)
  assert.throws(() => guard.assertAvailable(session), /UNAVAILABLE.*3 consecutive/)
  guard.assertAvailable(other)
  guard.reset(session)
  guard.assertAvailable(session)
})

test('selector errors, success and user cancellation do not trip infrastructure guard', () => {
  const guard = new BrowserFailureGuard(), session = {}
  guard.observe(session, new Error('fetch failed'))
  guard.observe(session, new Error('fetch failed'))
  guard.observe(session, new Error('selector did not resolve'))
  guard.observe(session, new Error('fetch failed'))
  guard.observe(session, new Error('fetch failed'), true)
  guard.assertAvailable(session)
  guard.observe(session)
  guard.assertAvailable(session)
})
