import test from 'node:test'
import assert from 'node:assert/strict'
import { sitePermissionDisposition } from '../src/permission-policy.js'

test('denies noisy ambient site permissions without prompting', () => {
  assert.equal(sitePermissionDisposition('geolocation'), 'deny')
  assert.equal(sitePermissionDisposition('notifications'), 'deny')
  assert.equal(sitePermissionDisposition('unknown-capability'), 'deny')
})

test('prompts once only for sensitive browser capabilities', () => {
  assert.equal(sitePermissionDisposition('media'), 'prompt-once')
  assert.equal(sitePermissionDisposition('clipboard-read'), 'prompt-once')
  assert.equal(sitePermissionDisposition('serial'), 'prompt-once')
})

test('allows harmless presentation capabilities silently', () => {
  assert.equal(sitePermissionDisposition('fullscreen'), 'allow')
  assert.equal(sitePermissionDisposition('clipboard-sanitized-write'), 'allow')
})
