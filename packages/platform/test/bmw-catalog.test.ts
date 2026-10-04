import assert from 'node:assert/strict'
import test from 'node:test'
import { bmwProduct as bmw } from '@bmw-agent/product-bmw'
import { BrowserCapabilityRegistry } from '../../browser-capability/src/browser-capability-registry.js'

test('BMW exposes research/media actions and the Video extension boundary', () => {
  assert.ok(bmw.featureIds.includes('feature-video'))
  const actions = new BrowserCapabilityRegistry(bmw).allowedActions
  assert.ok(actions.includes('observe'))
  assert.ok(actions.includes('media.screenshot'))
  assert.ok(actions.includes('page.media.list'))
  assert.ok(actions.includes('media.download'))
  assert.ok(actions.includes('media.video.capture'))
  assert.ok(actions.includes('media.record.start'))
  for (const action of ['media.inspect', 'media.frames.sample', 'media.convert','media.image.inspect','media.image.annotate','media.image.draw']) assert.ok(actions.includes(action))
  const tool = new BrowserCapabilityRegistry(bmw).toolDefinition()
  assert.match(tool.description, /media\.frames\.sample/)
  assert.equal(Object.hasOwn(tool.inputSchema.properties, 'path'), false)
  assert.equal(actions.some((action) => action.startsWith('connector.')), false)
  assert.equal(actions.some((action) => /^(dev|test|experiment)\./.test(action)), false)
  assert.ok(actions.includes('video.compose'))
  assert.equal(Object.hasOwn(bmw, 'dsh'), false)
})
