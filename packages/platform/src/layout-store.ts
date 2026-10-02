import fs from 'node:fs'
import path from 'node:path'

const DEFAULTS = Object.freeze({
  version: 1,
  configured: false,
  mode: 'sidebar',
  visible: true,
  sidebarWidth: 460,
  opacity: 1,
  overlayBounds: { width: 640, height: 760 },
  overlayFullscreen: false
})

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(Math.max(Math.round(number), minimum), maximum) : fallback
}

function normalize(input: Record<string, any> = {}) {
  const bounds = input.overlayBounds || {}
  const normalizedBounds: { width: number; height: number; x?: number; y?: number } = {
    width: clamp(bounds.width, 420, 1600, DEFAULTS.overlayBounds.width),
    height: clamp(bounds.height, 480, 1200, DEFAULTS.overlayBounds.height)
  }
  if (Number.isFinite(Number(bounds.x))) normalizedBounds.x = Math.round(Number(bounds.x))
  if (Number.isFinite(Number(bounds.y))) normalizedBounds.y = Math.round(Number(bounds.y))
  return {
    version: 1,
    configured: input.configured === true,
    mode: input.mode === 'overlay' ? 'overlay' : 'sidebar',
    visible: input.visible !== false,
    sidebarWidth: clamp(input.sidebarWidth, 360, 900, DEFAULTS.sidebarWidth),
    opacity: Number(input.opacity) < 1 ? 0.88 : 1,
    overlayBounds: normalizedBounds,
    overlayFullscreen: input.overlayFullscreen === true
  }
}

function writeAtomically(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

export class LayoutStore {
  [key: string]: any

  constructor({ filePath, onState }) {
    this.filePath = filePath
    this.onState = onState
    this.state = normalize()
    this.load()
  }

  load() {
    try {
      this.state = normalize(JSON.parse(fs.readFileSync(this.filePath, 'utf8')))
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Failed to load BMW layout settings', error)
    }
  }

  snapshot() {
    return structuredClone(this.state)
  }

  update(input: Record<string, any> = {}) {
    this.state = normalize({
      ...this.state,
      ...input,
      overlayBounds: input.overlayBounds ? { ...this.state.overlayBounds, ...input.overlayBounds } : this.state.overlayBounds
    })
    writeAtomically(this.filePath, this.state)
    this.onState?.(this.snapshot())
    return this.snapshot()
  }
}

export const layoutStoreInternals = { DEFAULTS, normalize }
