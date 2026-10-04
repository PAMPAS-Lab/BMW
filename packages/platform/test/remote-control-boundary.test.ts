import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import bmw from '../../../apps/bmw/product.js'
import { BrowserCapabilityRegistry } from '../../browser-capability/src/browser-capability-registry.js'
import { assertBrowserRequest } from '../../browser-capability/src/browser-schema.js'

test('default products reject chat connector actions and retain one browser tool', () => {
  for (const product of [bmw]) {
    const registry = new BrowserCapabilityRegistry(product)
    assert.equal(registry.allowedActions.some((action) => action.startsWith('connector.')), false)
    assert.equal(registry.toolDefinition().name, 'browser')
    for (const action of ['connector.external.status', 'connector.external.messages.list', 'connector.external.messages.send', 'connector.external.media.send']) {
      assert.throws(() => assertBrowserRequest({ action }, registry.allowedActions), /Unsupported browser action/)
    }
  }
})

test('default desktop exposes no chat connector UI, IPC or automatic relay startup', () => {
  for (const file of ['packages/platform/src/main.ts', 'packages/platform/src/preload/shell-preload.cts', 'packages/platform/src/renderer/shell.ts', 'packages/platform/src/renderer/shell.html', 'packages/browser-capability/src/browser-kernel.ts']) {
    assert.doesNotMatch(fs.readFileSync(path.resolve(file), 'utf8'), /connector[-.]|chat\.messages|relay[-.]/i, file)
  }
})
