import assert from 'node:assert/strict'
import test from 'node:test'
import { restartBlockReason } from '../src/restart-policy.js'

test('allows restart when BMW has no active non-durable work', () => {
  assert.equal(restartBlockReason({}), null)
})

test('blocks restart while media, scheduled tasks, or WVL execution is active', () => {
  assert.equal(restartBlockReason({ mediaCaptureActive: true })?.code, 'media-capture-active')
  assert.equal(restartBlockReason({ scheduledTaskActive: true })?.code, 'scheduled-task-active')
  assert.equal(restartBlockReason({ validationRunActive: true })?.code, 'validation-run-active')
})
