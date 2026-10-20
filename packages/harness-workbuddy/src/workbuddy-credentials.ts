import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface WorkbuddyCredentials {
  apiKey: string
  internetEnvironment: string
}

interface StoredCredentials extends WorkbuddyCredentials { version: 1 }

/** BMW owns this file; the CLI never sees it except through the spawned environment. */
function credentialsPath(configDirectory: string): string {
  if (!path.isAbsolute(configDirectory)) throw new Error('WorkBuddy profile directory must be absolute')
  return path.join(configDirectory, 'workbuddy-credentials.json')
}

export function readWorkbuddyCredentials(configDirectory: string): WorkbuddyCredentials | null {
  const file = credentialsPath(configDirectory)
  let stat: fs.Stats
  try { stat = fs.lstatSync(file) } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (!stat.isFile() || stat.size > 16384) throw new Error('Invalid WorkBuddy credential file')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('WorkBuddy credential file is not owned by this user')
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('WorkBuddy credential file is readable by other users')
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid WorkBuddy credential file')
  const value = raw as Record<string, unknown>
  if (value.version !== 1 || typeof value.apiKey !== 'string' || value.apiKey.length === 0 || value.apiKey.length > 8192) throw new Error('Invalid WorkBuddy credential file')
  const environment = typeof value.internetEnvironment === 'string' ? value.internetEnvironment : 'internal'
  return { apiKey: value.apiKey, internetEnvironment: environment }
}

export function writeWorkbuddyCredentials(configDirectory: string, credentials: WorkbuddyCredentials): void {
  if (credentials.apiKey.length === 0 || credentials.apiKey.length > 8192) throw new Error('Invalid WorkBuddy API Key')
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 })
  const file = credentialsPath(configDirectory)
  const temporary = path.join(configDirectory, 'workbuddy-credentials-' + crypto.randomUUID() + '.tmp')
  const payload: StoredCredentials = { version: 1, apiKey: credentials.apiKey, internetEnvironment: credentials.internetEnvironment }
  try {
    fs.writeFileSync(temporary, JSON.stringify(payload), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, file)
  } finally { fs.rmSync(temporary, { force: true }) }
}

export function clearWorkbuddyCredentials(configDirectory: string): boolean {
  const file = credentialsPath(configDirectory)
  if (!fs.existsSync(file)) return false
  fs.rmSync(file)
  return true
}
