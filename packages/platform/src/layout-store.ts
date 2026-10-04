import fs from 'node:fs'
import path from 'node:path'
import {readStateFile, stateRecord, StateLoadError} from './state-load.js'

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

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(Math.max(Math.round(number), minimum), maximum) : fallback
}

function normalize(input: Record<string, unknown> = {}) {
  const bounds = input.overlayBounds ? stateRecord(input.overlayBounds) : {}
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

function writeAtomically(filePath: string, state: LayoutState) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

export type LayoutState = ReturnType<typeof normalize>
function validate(raw: unknown): LayoutState {
  const value = stateRecord(raw)
  if (value.version !== undefined && value.version !== 1) throw new Error('Unsupported layout state version.')
  if (typeof value.configured !== 'boolean' || !['sidebar','overlay'].includes(String(value.mode))) throw new Error('Invalid saved layout identity.')
  for (const key of ['configured','visible','overlayFullscreen']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('Invalid saved layout flag: '+key)
  if (value.mode !== undefined && !['sidebar','overlay'].includes(String(value.mode))) throw new Error('Invalid saved layout mode.')
  for (const key of ['sidebarWidth','opacity']) if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) throw new Error('Invalid saved layout number: '+key)
  if (value.overlayBounds !== undefined) {
    const bounds = stateRecord(value.overlayBounds)
    for (const key of ['x','y','width','height']) if (bounds[key] !== undefined && (typeof bounds[key] !== 'number' || !Number.isFinite(bounds[key]))) throw new Error('Invalid saved layout bounds.')
  }
  return normalize(value)
}
export class LayoutStore {
  readonly filePath: string
  readonly onState?: (state: LayoutState) => void
  private state: LayoutState = normalize()
  private loadFailure?: StateLoadError
  constructor({filePath, onState}: {filePath: string; onState?: (state: LayoutState) => void}) {
    this.filePath = filePath;this.onState = onState;this.load()
  }
  load(): void {
    try {this.state = readStateFile(this.filePath, validate) ?? normalize();this.loadFailure = undefined}
    catch (error) {this.loadFailure = error;throw error}
  }
  snapshot(): LayoutState {return structuredClone(this.state)}
  update(input: Record<string, unknown> = {}): LayoutState {
    if (this.loadFailure) throw this.loadFailure
    const next = normalize({...this.state, ...input, overlayBounds: input.overlayBounds ? {...this.state.overlayBounds, ...stateRecord(input.overlayBounds)} : this.state.overlayBounds})
    writeAtomically(this.filePath, next)
    this.state = next;this.onState?.(this.snapshot())
    return this.snapshot()
  }
}

export const layoutStoreInternals = { DEFAULTS, normalize }
