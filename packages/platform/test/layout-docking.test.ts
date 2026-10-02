import assert from 'node:assert/strict'
import test from 'node:test'
import { isOverlayAtDockCorner } from '../src/layout-docking.js'

const target = { x: 0, y: 25, width: 1440, height: 875 }

test('floating DSH docks when its upper-right corner reaches the target corner', () => {
  assert.equal(isOverlayAtDockCorner({ x: 800, y: 25, width: 640, height: 760 }, target), true)
  assert.equal(isOverlayAtDockCorner({ x: 775, y: 60, width: 640, height: 760 }, target), true)
})

test('floating DSH does not dock near only one target edge', () => {
  assert.equal(isOverlayAtDockCorner({ x: 800, y: 300, width: 640, height: 760 }, target), false)
  assert.equal(isOverlayAtDockCorner({ x: 500, y: 25, width: 640, height: 760 }, target), false)
})

test('dock detection rejects invalid window bounds', () => {
  assert.equal(isOverlayAtDockCorner({ x: 800, width: 640, height: 760 }, target), false)
  assert.equal(isOverlayAtDockCorner(null, target), false)
})
