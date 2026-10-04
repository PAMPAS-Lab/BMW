import fs from 'node:fs'
import path from 'node:path'
import {readStateFile, readStateBytes, stateRecord, StateLoadError} from './state-load.js'

const SNAPSHOT_VERSION = 1
const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000
const MAX_KEEPALIVE_BACKOFF_MS = 30 * 60 * 1000

function normalizedOrigin(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Keep login is only available for HTTP(S) sites.')
  return url.origin
}

function cookieDomain(cookie) {
  return String(cookie.domain || '').replace(/^\./, '').toLowerCase()
}

function cookieMatchesOrigin(cookie, origin) {
  const hostname = new URL(origin).hostname.toLowerCase()
  const domain = cookieDomain(cookie)
  return domain === hostname || hostname.endsWith(`.${domain}`)
}

function cookieIdentity(cookie) {
  return `${cookie.domain || ''}\u0000${cookie.path || '/'}\u0000${cookie.name}`
}

function cookieUrl(cookie, fallbackOrigin) {
  const fallback = new URL(fallbackOrigin)
  const hostname = cookieDomain(cookie) || fallback.hostname
  const protocol = cookie.secure ? 'https:' : fallback.protocol
  const pathname = String(cookie.path || '/').startsWith('/') ? cookie.path || '/' : `/${cookie.path}`
  return `${protocol}//${hostname}${pathname}`
}

function serializableCookie(cookie, origin) {
  return {
    origin,
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    hostOnly: cookie.hostOnly === true,
    path: cookie.path || '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: cookie.sameSite || 'unspecified',
    session: cookie.session === true,
    expirationDate: cookie.expirationDate
  }
}

function savedOrigin(value: unknown): string {
  if (typeof value !== 'string' || normalizedOrigin(value) !== value) throw new Error('Invalid saved login origin.')
  return value
}
function validateConfig(raw: unknown): {sites: Record<string, Record<string, unknown>>} {
  const value = stateRecord(raw), sites = stateRecord(value.sites)
  if (value.version !== undefined && value.version !== 1) throw new Error('Unsupported login configuration version.')
  for (const [origin, rawSite] of Object.entries(sites)) {
    savedOrigin(origin)
    const site = stateRecord(rawSite)
    if (site.keepalive !== undefined && typeof site.keepalive !== 'boolean') throw new Error('Invalid saved keepalive setting.')
    for (const key of ['enabledAt','lastKeepaliveAt','lastKeepaliveMethod']) if (site[key] !== undefined && site[key] !== null && typeof site[key] !== 'string') throw new Error('Invalid saved login metadata.')
    for (const key of ['nextKeepaliveAt','failures']) if (site[key] !== undefined && (typeof site[key] !== 'number' || !Number.isFinite(site[key]) || site[key] < 0)) throw new Error('Invalid saved keepalive number.')
  }
  return {sites: sites as Record<string, Record<string, unknown>>}
}
function validateSnapshot(raw: unknown): {version: number; cookies: Record<string, unknown>[]} {
  const value = stateRecord(raw)
  if (value.version !== SNAPSHOT_VERSION || !Array.isArray(value.cookies)) throw new Error('Unsupported encrypted login snapshot.')
  for (const rawCookie of value.cookies) {
    const cookie = stateRecord(rawCookie)
    savedOrigin(cookie.origin)
    for (const key of ['name','value','domain','path']) if (typeof cookie[key] !== 'string') throw new Error('Invalid saved cookie field: '+key)
    if (!cookie.name || !cookie.domain || !String(cookie.path).startsWith('/')) throw new Error('Invalid saved cookie identity.')
    for (const key of ['hostOnly','secure','httpOnly','session']) if (cookie[key] !== undefined && typeof cookie[key] !== 'boolean') throw new Error('Invalid saved cookie flag.')
    if (cookie.expirationDate !== undefined && (typeof cookie.expirationDate !== 'number' || !Number.isFinite(cookie.expirationDate))) throw new Error('Invalid saved cookie expiration.')
    if (cookie.sameSite !== undefined && !['unspecified','no_restriction','lax','strict'].includes(String(cookie.sameSite))) throw new Error('Invalid saved cookie SameSite.')
  }
  return {version: SNAPSHOT_VERSION, cookies: value.cookies}
}

export class SessionContinuityManager {
  [key: string]: any
  private loaded = false
  private snapshotLoaded = false
  private snapshotRestored = false
  private loadFailure?: StateLoadError

  constructor({ session, safeStorage, configPath, snapshotPath, onState, now = () => Date.now() }) {
    this.session = session
    this.safeStorage = safeStorage
    this.configPath = configPath
    this.snapshotPath = snapshotPath
    this.onState = onState
    this.now = now
    this.config = { sites: {} }
    this.snapshot = { version: SNAPSHOT_VERSION, cookies: [] }
    this.keepaliveTimer = null
    this.snapshotTimer = null
    this.keepaliveRunning = false
    this.cookieListener = () => this.scheduleSnapshot()
  }

  async initialize() {
    this.assertLoaded()
    await this.restoreCookies()
    this.session.cookies.on('changed', this.cookieListener)
    this.keepaliveTimer = setInterval(() => void this.runKeepalives().catch(error => console.error('Failed to maintain saved login state', error)), 60_000)
    this.keepaliveTimer.unref?.()
    this.emitState()
  }

  /** Startup preflight is synchronous and installs no timers or cookie listeners. */
  load(): void {
    this.loaded = false
    try {this.loadConfig();this.loadSnapshot();this.loaded = true;this.loadFailure = undefined}
    catch (error) {throw error}
  }
  private assertLoaded(): void {
    if (this.loadFailure) throw this.loadFailure
    if (!this.loaded) this.load()
    if (!this.snapshotLoaded && this.safeStorage.isEncryptionAvailable()) this.loadSnapshot()
  }
  loadConfig(): void {
    try {this.config = readStateFile(this.configPath, validateConfig) ?? {sites: {}}}
    catch (error) {this.loadFailure = error;throw error}
  }
  loadSnapshot(): void {
    this.snapshotLoaded = false
    this.snapshotRestored = false
    if (!this.safeStorage.isEncryptionAvailable()) return
    try {
      const encrypted = readStateBytes(this.snapshotPath)
      this.snapshot = encrypted === undefined ? {version: SNAPSHOT_VERSION, cookies: []} : validateSnapshot(JSON.parse(this.safeStorage.decryptString(encrypted)))
      this.snapshotLoaded = true
    } catch (error) {
      const failure = error instanceof StateLoadError ? error : new StateLoadError(this.snapshotPath, error)
      this.loadFailure = failure;throw failure
    }
  }

  saveConfig() {
    this.assertLoaded()
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true })
    const temporary = `${this.configPath}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(this.config, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, this.configPath)
  }

  saveSnapshot() {
    this.assertLoaded()
    if (!this.snapshotLoaded) this.loadSnapshot()
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS-protected encryption is unavailable; BMW will not persist session cookies.')
    fs.mkdirSync(path.dirname(this.snapshotPath), { recursive: true })
    const encrypted = this.safeStorage.encryptString(JSON.stringify(this.snapshot))
    const temporary = `${this.snapshotPath}.tmp`
    fs.writeFileSync(temporary, encrypted, { mode: 0o600 })
    fs.renameSync(temporary, this.snapshotPath)
  }

  async restoreCookies() {
    this.assertLoaded()
    const enabledOrigins = new Set(Object.keys(this.config.sites))
    for (const cookie of this.snapshot.cookies) {
      if (!enabledOrigins.has(cookie.origin)) continue
      if (cookie.expirationDate && cookie.expirationDate <= this.now() / 1000) continue
      const details: Record<string, any> = {
        url: cookieUrl(cookie, cookie.origin),
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: cookie.secure === true,
        httpOnly: cookie.httpOnly === true,
        sameSite: cookie.sameSite || 'unspecified'
      }
      if (!cookie.hostOnly && cookie.domain) details.domain = cookie.domain
      if (!cookie.session && cookie.expirationDate) details.expirationDate = cookie.expirationDate
      try {
        await this.session.cookies.set(details)
      } catch (error) {
        console.error(`Failed to restore a session cookie for ${cookie.origin}`, error)
      }
    }
    this.snapshotRestored = this.snapshotLoaded
    this.session.flushStorageData()
  }

  status(url) {
    let origin = null
    try {
      origin = normalizedOrigin(url)
    } catch {}
    const site = origin ? this.config.sites[origin] : null
    return {
      available: this.safeStorage.isEncryptionAvailable(),
      origin,
      enabled: Boolean(site),
      keepalive: Boolean(site?.keepalive),
      lastKeepaliveAt: site?.lastKeepaliveAt || null,
      lastKeepaliveStatus: site?.lastKeepaliveStatus || null,
      lastKeepaliveMethod: site?.lastKeepaliveMethod || null
    }
  }

  async setForUrl(url, enabled, { keepalive = true } = {}) {
    this.assertLoaded()
    const origin = normalizedOrigin(url)
    if (enabled && !this.safeStorage.isEncryptionAvailable()) {
      throw new Error('OS-protected encryption is unavailable; BMW cannot safely keep this login.')
    }
    if (enabled) {
      this.config.sites[origin] = {
        keepalive: keepalive === true,
        enabledAt: this.config.sites[origin]?.enabledAt || new Date(this.now()).toISOString(),
        nextKeepaliveAt: this.now() + KEEPALIVE_INTERVAL_MS,
        failures: 0
      }
    } else {
      delete this.config.sites[origin]
      this.snapshot.cookies = this.snapshot.cookies.filter((cookie) => cookie.origin !== origin)
    }
    this.saveConfig()
    await this.captureSnapshot()
    this.emitState(url)
    return this.status(url)
  }

  scheduleSnapshot() {
    if (!this.safeStorage.isEncryptionAvailable()) return
    clearTimeout(this.snapshotTimer)
    this.snapshotTimer = setTimeout(() => void this.captureSnapshot().catch((error) => {
      console.error('Failed to update encrypted session snapshot', error)
    }), 250)
    this.snapshotTimer.unref?.()
  }

  async captureSnapshot() {
    this.assertLoaded()
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS-protected encryption is unavailable; BMW will not persist session cookies.')
    if (!this.snapshotLoaded) this.loadSnapshot()
    if (!this.snapshotRestored) await this.restoreCookies()
    const origins = Object.keys(this.config.sites)
    const allCookies = await this.session.cookies.get({})
    const cookies = new Map()
    for (const origin of origins) {
      for (const cookie of allCookies) {
        if (!cookieMatchesOrigin(cookie, origin)) continue
        const serialized = serializableCookie(cookie, origin)
        cookies.set(`${origin}\u0000${cookieIdentity(cookie)}`, serialized)
      }
    }
    this.snapshot = { version: SNAPSHOT_VERSION, cookies: [...cookies.values()] }
    this.saveSnapshot()
  }

  async runKeepalives() {
    this.assertLoaded()
    if (!this.safeStorage.isEncryptionAvailable()) return
    if (this.keepaliveRunning) return
    this.keepaliveRunning = true
    try {
      for (const [origin, site] of Object.entries(this.config.sites) as Array<[string, Record<string, any>]>) {
        if (!site.keepalive || (site.nextKeepaliveAt || 0) > this.now()) continue
        try {
          let method = 'HEAD'
          let response = await this.session.fetch(`${origin}/`, {
            method: 'HEAD',
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow'
          })
          if ([401, 403, 405].includes(response.status)) {
            await Promise.resolve(response.body?.cancel?.()).catch(() => {})
            method = 'GET'
            response = await this.session.fetch(`${origin}/`, {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store',
              redirect: 'follow',
              headers: {
                accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
                range: 'bytes=0-0'
              }
            })
          }
          await Promise.resolve(response.body?.cancel?.()).catch(() => {})
          const succeeded = response.status >= 200 && response.status < 400
          site.failures = succeeded ? 0 : Math.min((site.failures || 0) + 1, 6)
          site.lastKeepaliveStatus = response.status
          site.lastKeepaliveMethod = method
          site.lastKeepaliveAt = new Date(this.now()).toISOString()
          site.nextKeepaliveAt = this.now() + (succeeded
            ? KEEPALIVE_INTERVAL_MS
            : Math.min(KEEPALIVE_INTERVAL_MS * (2 ** site.failures), MAX_KEEPALIVE_BACKOFF_MS))
        } catch {
          site.failures = Math.min((site.failures || 0) + 1, 6)
          site.lastKeepaliveStatus = 'network-error'
          site.lastKeepaliveMethod = null
          site.lastKeepaliveAt = new Date(this.now()).toISOString()
          site.nextKeepaliveAt = this.now() + Math.min(KEEPALIVE_INTERVAL_MS * (2 ** site.failures), MAX_KEEPALIVE_BACKOFF_MS)
        }
      }
      this.saveConfig()
      await this.captureSnapshot()
      this.emitState()
    } finally {
      this.keepaliveRunning = false
    }
  }

  emitState(url?: string) {
    this.onState?.(url ? this.status(url) : null)
  }

  async stop() {
    clearInterval(this.keepaliveTimer)
    clearTimeout(this.snapshotTimer)
    this.session.cookies.off('changed', this.cookieListener)
    if (Object.keys(this.config.sites).length && this.safeStorage.isEncryptionAvailable()) await this.captureSnapshot()
    this.session.flushStorageData()
  }
}

export const sessionContinuityInternals = {
  cookieMatchesOrigin,
  cookieUrl,
  normalizedOrigin
}
