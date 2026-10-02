import assert from 'node:assert/strict'
import test from 'node:test'
import { isApplicationMenuShortcut, isSavePageShortcut, pageSaveType, suggestedPageFilename } from '../src/menu-policy.js'

test('builds safe webpage filenames and selects complete or single-file saves', () => {
  assert.equal(suggestedPageFilename('Three.js: Scene / Study?', 'https://example.com'), 'Three.js- Scene - Study-.html')
  assert.equal(suggestedPageFilename('', 'https://example.com/path'), 'example.com.html')
  assert.equal(pageSaveType('/tmp/research.mhtml'), 'MHTML')
  assert.equal(pageSaveType('/tmp/research.html'), 'HTMLComplete')
})

test('recognizes keyboard menu activation without stealing modified page shortcuts', () => {
  assert.equal(isApplicationMenuShortcut({ type: 'keyDown', key: 'F10' }, 'darwin'), true)
  assert.equal(isApplicationMenuShortcut({ type: 'keyDown', key: 'F2', control: true }, 'darwin'), true)
  assert.equal(isApplicationMenuShortcut({ type: 'keyDown', key: 'm', meta: true, shift: true }, 'darwin'), true)
  assert.equal(isApplicationMenuShortcut({ type: 'keyDown', key: 'Alt' }, 'win32'), true)
  assert.equal(isApplicationMenuShortcut({ type: 'keyDown', key: 'F10', shift: true }, 'linux'), false)
  assert.equal(isApplicationMenuShortcut({ type: 'keyDown', key: 's', meta: true }, 'darwin'), false)
  assert.equal(isApplicationMenuShortcut({ type: 'keyUp', key: 'F10' }, 'darwin'), false)
})

test('recognizes only the platform save-page accelerator', () => {
  assert.equal(isSavePageShortcut({ type: 'keyDown', key: 's', meta: true }, 'darwin'), true)
  assert.equal(isSavePageShortcut({ type: 'keyDown', key: 's', control: true }, 'win32'), true)
  assert.equal(isSavePageShortcut({ type: 'keyDown', key: 's', meta: true, shift: true }, 'darwin'), false)
  assert.equal(isSavePageShortcut({ type: 'keyDown', key: 's', meta: true }, 'linux'), false)
})
