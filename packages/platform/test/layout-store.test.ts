// @ts-nocheck -- BMW TypeScript migration baseline for legacy test doubles.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LayoutStore } from '../src/layout-store.js'

function createStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-layout-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return new LayoutStore({ filePath: path.join(root, 'layout.json') })
}

test('layout setup is required once and defaults to the sidebar', (t) => {
  const store = createStore(t)
  assert.deepEqual(store.snapshot(), {
    version: 1,
    configured: false,
    mode: 'sidebar',
    visible: true,
    sidebarWidth: 460,
    opacity: 1,
    overlayBounds: { width: 640, height: 760 },
    overlayFullscreen: false
  })
})

test('floating DSH settings persist with bounded size and supported opacity', (t) => {
  const store = createStore(t)
  store.update({
    configured: true,
    mode: 'overlay',
    opacity: 0.5,
    overlayBounds: { x: 80, y: 90, width: 3000, height: 200 }
  })

  const reloaded = new LayoutStore({ filePath: store.filePath }).snapshot()
  assert.equal(reloaded.mode, 'overlay')
  assert.equal(reloaded.opacity, 0.88)
  assert.deepEqual(reloaded.overlayBounds, { x: 80, y: 90, width: 1600, height: 480 })
})
