// @ts-nocheck -- BMW TypeScript migration baseline for legacy test doubles.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SessionContinuityManager, sessionContinuityInternals } from '../src/session-continuity.js'

class MockCookies extends EventEmitter {
  constructor(cookies = []) {
    super()
    this.values = cookies
    this.setCalls = []
  }

  async get() {
    return structuredClone(this.values)
  }

  async set(details) {
    this.setCalls.push(structuredClone(details))
    const domain = details.domain || new URL(details.url).hostname
    const cookie = {
      name: details.name,
      value: details.value,
      domain,
      hostOnly: !details.domain,
      path: details.path || '/',
      secure: details.secure === true,
      httpOnly: details.httpOnly === true,
      sameSite: details.sameSite || 'unspecified',
      session: !details.expirationDate,
      expirationDate: details.expirationDate
    }
    this.values = this.values.filter((value) => !(
      value.name === cookie.name && value.domain === cookie.domain && value.path === cookie.path
    ))
    this.values.push(cookie)
    this.emit('changed', {}, cookie, 'explicit', false)
  }
}

function mockSession(cookies = [], responses = [{ status: 204 }]) {
  const jar = new MockCookies(cookies)
  const fetchCalls = []
  let responseIndex = 0
  return {
    cookies: jar,
    fetchCalls,
    flushStorageData() {},
    async fetch(url, options) {
      fetchCalls.push({ url, options })
      return responses[Math.min(responseIndex++, responses.length - 1)]
    }
  }
}

const mockSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8')
}

function managerPaths(directory) {
  return {
    configPath: path.join(directory, 'session-continuity.json'),
    snapshotPath: path.join(directory, 'session-cookies.enc')
  }
}

test('encrypts and restores session cookies only for explicitly enabled origins', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-session-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const source = mockSession([
    {
      name: 'sid', value: 'secret-session', domain: 'mail.example.test', hostOnly: true,
      path: '/mail', secure: true, httpOnly: true, sameSite: 'lax', session: true
    },
    {
      name: 'other', value: 'not-in-snapshot', domain: 'unrelated.test', hostOnly: true,
      path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true
    }
  ])
  const first = new SessionContinuityManager({
    session: source,
    safeStorage: mockSafeStorage,
    ...managerPaths(directory)
  })
  await first.initialize()
  await first.setForUrl('https://mail.example.test/inbox', true)
  await first.stop()

  const restored = mockSession()
  const second = new SessionContinuityManager({
    session: restored,
    safeStorage: mockSafeStorage,
    ...managerPaths(directory)
  })
  await second.initialize()

  assert.equal(second.status('https://mail.example.test/').enabled, true)
  assert.equal(restored.cookies.setCalls.length, 1)
  assert.deepEqual(restored.cookies.setCalls[0], {
    url: 'https://mail.example.test/mail',
    name: 'sid',
    value: 'secret-session',
    path: '/mail',
    secure: true,
    httpOnly: true,
    sameSite: 'lax'
  })
  await second.stop()
})

test('disabling continuity removes the encrypted snapshot without clearing live cookies', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-session-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const current = mockSession([{
    name: 'sid', value: 'still-live', domain: 'mail.example.test', hostOnly: true,
    path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true
  }])
  const manager = new SessionContinuityManager({
    session: current,
    safeStorage: mockSafeStorage,
    ...managerPaths(directory)
  })
  await manager.initialize()
  await manager.setForUrl('https://mail.example.test/', true)
  await manager.setForUrl('https://mail.example.test/', false)

  assert.equal(manager.status('https://mail.example.test/').enabled, false)
  assert.equal(current.cookies.values[0].value, 'still-live')
  const snapshot = JSON.parse(fs.readFileSync(manager.snapshotPath, 'utf8'))
  assert.deepEqual(snapshot.cookies, [])
  await manager.stop()
})

test('background keepalive uses HEAD first for an enabled origin', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-session-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let now = 1_000_000
  const current = mockSession()
  const manager = new SessionContinuityManager({
    session: current,
    safeStorage: mockSafeStorage,
    ...managerPaths(directory),
    now: () => now
  })
  await manager.initialize()
  await manager.setForUrl('https://mail.example.test/inbox?secret=ignored', true)
  now += 6 * 60 * 1000
  await manager.runKeepalives()

  assert.equal(current.fetchCalls.length, 1)
  assert.equal(current.fetchCalls[0].url, 'https://mail.example.test/')
  assert.equal(current.fetchCalls[0].options.method, 'HEAD')
  assert.equal(current.fetchCalls[0].options.credentials, 'include')
  assert.equal(manager.status('https://mail.example.test/').lastKeepaliveStatus, 204)
  assert.equal(manager.status('https://mail.example.test/').lastKeepaliveMethod, 'HEAD')
  await manager.stop()
})

test('background keepalive falls back to a bounded GET when a site rejects HEAD', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-session-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let now = 2_000_000
  let cancelled = 0
  const response = (status) => ({ status, body: { cancel: async () => { cancelled += 1 } } })
  const current = mockSession([], [response(403), response(200)])
  const manager = new SessionContinuityManager({
    session: current,
    safeStorage: mockSafeStorage,
    ...managerPaths(directory),
    now: () => now
  })
  await manager.initialize()
  await manager.setForUrl('https://social.example.test/profile', true)
  now += 6 * 60 * 1000
  await manager.runKeepalives()

  assert.equal(current.fetchCalls.length, 2)
  assert.equal(current.fetchCalls[0].options.method, 'HEAD')
  assert.equal(current.fetchCalls[1].options.method, 'GET')
  assert.equal(current.fetchCalls[1].options.headers.range, 'bytes=0-0')
  assert.equal(current.fetchCalls[1].options.credentials, 'include')
  assert.equal(cancelled, 2)
  assert.equal(manager.status('https://social.example.test/').lastKeepaliveStatus, 200)
  assert.equal(manager.status('https://social.example.test/').lastKeepaliveMethod, 'GET')
  await manager.stop()
})

test('cookie matching includes parent-domain cookies but excludes unrelated sites', () => {
  assert.equal(sessionContinuityInternals.cookieMatchesOrigin({ domain: '.example.test' }, 'https://mail.example.test'), true)
  assert.equal(sessionContinuityInternals.cookieMatchesOrigin({ domain: 'other.test' }, 'https://mail.example.test'), false)
})
