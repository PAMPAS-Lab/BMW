import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface WorkbuddyCredentials { apiKey: string; internetEnvironment: 'internal' | '' }
/** Supplied by the desktop composition; the harness never imports Electron. */
export interface WorkbuddyEncryption {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
function file(config: string): string {
  if (!path.isAbsolute(config)) throw new Error('WorkBuddy profile must be absolute')
  return path.join(config, 'workbuddy-credentials.enc')
}
function encryption(port?: WorkbuddyEncryption): WorkbuddyEncryption {
  if (!port?.isEncryptionAvailable() || port.getSelectedStorageBackend?.() === 'basic_text') throw new Error('WorkBuddy 需要可用的系统密钥加密服务')
  return port
}
function validate(value: unknown): WorkbuddyCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid encrypted WorkBuddy credentials')
  const row = value as Record<string, unknown>
  if (typeof row.apiKey !== 'string' || row.apiKey.length < 8 || row.apiKey.length > 8192 || /[\s\x00-\x1f\x7f]/u.test(row.apiKey) || (row.internetEnvironment !== 'internal' && row.internetEnvironment !== '')) throw new Error('WorkBuddy API Key 或服务区域格式无效')
  return { apiKey: row.apiKey, internetEnvironment: row.internetEnvironment }
}
export function readWorkbuddyCredentials(config: string, port?: WorkbuddyEncryption): WorkbuddyCredentials | null {
  if (fs.existsSync(path.join(config, 'workbuddy-credentials.json'))) throw new Error('检测到旧版明文凭据；请显式退出登录后重新配置，原文件已保留')
  const target = file(config)
  let stat: fs.Stats
  try { stat = fs.lstatSync(target) } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('WorkBuddy credential ownership or permissions are invalid')
  try { return validate(JSON.parse(encryption(port).decryptString(fs.readFileSync(target)))) }
  catch { throw new Error('WorkBuddy 密钥无法解密；原文件已保留，请恢复系统加密服务或显式退出登录') }
}
export function writeWorkbuddyCredentials(config: string, value: WorkbuddyCredentials, port?: WorkbuddyEncryption): void {
  const checked = validate(value), cipher = encryption(port).encryptString(JSON.stringify(checked))
  // Never overwrite an unreadable state or silently migrate plaintext credentials.
  readWorkbuddyCredentials(config, port)
  fs.mkdirSync(config, { recursive: true, mode: 0o700 })
  const target = file(config), temporary = target + '.' + crypto.randomUUID() + '.tmp'
  try { fs.writeFileSync(temporary, cipher, { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, target) }
  finally { fs.rmSync(temporary, { force: true }) }
}
export function clearWorkbuddyCredentials(config: string): boolean {
  let removed = false
  for (const target of [file(config), path.join(config, 'workbuddy-credentials.json')]) {
    try { fs.unlinkSync(target); removed = true } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return removed
}
export function workbuddyCredentialFingerprint(value: WorkbuddyCredentials): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
