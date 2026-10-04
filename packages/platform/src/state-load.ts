import fs from 'node:fs'

/** A failed existing-state read must never become a first-run write. */
export class StateLoadError extends Error {
  readonly code = 'BMW_STATE_LOAD_FAILED'
  constructor(readonly filePath: string, cause: unknown) {
    super(`Cannot load saved BMW state: ${filePath}. The original file has been preserved. ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'StateLoadError'
  }
}

export function stateRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved state must be an object.')
  return value as Record<string, unknown>
}

export function readStateFile<T>(filePath: string, validate: (raw: unknown) => T): T | undefined {
  let text: string
  try { text = fs.readFileSync(filePath, 'utf8') }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try { fs.lstatSync(filePath) }
      catch (missing:unknown) { if((missing as NodeJS.ErrnoException).code==='ENOENT')return undefined }
    }
    throw new StateLoadError(filePath, error)
  }
  try { return validate(JSON.parse(text)) }
  catch (error: unknown) { throw new StateLoadError(filePath, error) }
}

/** Encrypted state follows the same missing-file rule, before decryption/validation. */
export function readStateBytes(filePath: string): Buffer | undefined {
  try {return fs.readFileSync(filePath)}
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try {fs.lstatSync(filePath)}
      catch (missing: unknown) {if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return undefined}
    }
    throw new StateLoadError(filePath, error)
  }
}
