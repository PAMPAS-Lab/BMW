import assert from 'node:assert/strict'
import test from 'node:test'
import { browserCompatibleUserAgent } from '../src/browser-user-agent.js'

test('page user agent exposes Chromium without Electron or BMW shell tokens', () => {
  const electron = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) BMW/0.1.0 Chrome/142.0.7444.265 Electron/39.8.10 Safari/537.36'
  assert.equal(
    browserCompatibleUserAgent(electron),
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.265 Safari/537.36'
  )
})

test('page user agent strips every BMW product brand and preserves standard Chrome', () => {
  assert.equal(browserCompatibleUserAgent('Mozilla/5.0 BMWVideo/0.1.0 Chrome/142.0 Safari/537.36'), 'Mozilla/5.0 Chrome/142.0 Safari/537.36')
  assert.equal(browserCompatibleUserAgent('Mozilla/5.0 BMWDev/0.1.0 Chrome/142.0 Safari/537.36'), 'Mozilla/5.0 Chrome/142.0 Safari/537.36')
  assert.equal(browserCompatibleUserAgent('Mozilla/5.0 Chrome/142.0 Safari/537.36'), 'Mozilla/5.0 Chrome/142.0 Safari/537.36')
})
