import assert from 'node:assert/strict'
import test from 'node:test'
import { browserDeadlineMs } from '../src/browser-deadline.js'

test('browser requests are finite while media jobs retain their long budget', () => {
  for(const action of ['media.image.inspect','media.image.annotate','media.image.draw'])assert.equal(browserDeadlineMs({action}),300_000)
  for (const action of ['status', 'tabs.list', 'media.screenshot', 'navigate']) assert.equal(browserDeadlineMs({ action }), 60_000)
  for (const action of ['media.video.capture', 'media.convert', 'video.compose', 'video.narrate', 'video.studio']) assert.equal(browserDeadlineMs({ action }), 1_800_000)
})
