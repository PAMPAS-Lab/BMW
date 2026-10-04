import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { readScreenshotPhase } from '../src/screenshot-read.js'
import { SessionOperations } from '../src/session-operations.js'

function renderer() { return Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as WebContents }

test('screenshot cancellation releases FIFO and ignores a late renderer result', async () => {
  const wc = renderer(), queue = new SessionOperations(), controller = new AbortController()
  let complete: (value: string) => void
  let artifactWrites = 0
  const read = new Promise<string>(resolve => { complete = resolve })
  const pending = queue.run(() => {}, async () => { await readScreenshotPhase(wc, 'selector-layout', () => read, controller.signal); artifactWrites++ })
  const rejection = assert.rejects(pending, /cancelled/)
  const next = queue.run(() => {}, async () => 'status available')
  await Promise.resolve()
  controller.abort(new Error('cancelled'))
  await rejection
  assert.equal(await next, 'status available')
  complete('late')
  await queue.drain()
  assert.equal(artifactWrites, 0)
  assert.equal(wc.listenerCount('destroyed'), 0)
})

test('screenshot deadline identifies phase and renderer loss removes observers', async () => {
  const wc = renderer()
  await assert.rejects(readScreenshotPhase(wc, 'capture-png', () => new Promise(() => {}), undefined, 10), /BMW_BROWSER_TIMEOUT.*capture-png/)
  const pending = readScreenshotPhase(wc, 'selector-layout', () => new Promise(() => {}))
  const rejected = assert.rejects(pending, /BMW_BROWSER_RENDERER_GONE.*selector-layout/)
  wc.emit('render-process-gone', {}, {})
  await rejected
  assert.equal(wc.listenerCount('did-start-navigation'), 0)
})

test('screenshot rejects main navigation and never starts already cancelled reads', async () => {
  const wc = renderer()
  const pending = readScreenshotPhase(wc, 'capture-png', () => new Promise(() => {}))
  const rejected = assert.rejects(pending, /BMW_BROWSER_PAGE_CHANGED/)
  wc.emit('did-start-navigation', {}, 'https://example.test/', false, true)
  await rejected
  let started = false
  await assert.rejects(readScreenshotPhase(wc, 'capture-png', async () => { started = true }, AbortSignal.abort(new Error('cancelled'))), /cancelled/)
  assert.equal(started, false)
})
