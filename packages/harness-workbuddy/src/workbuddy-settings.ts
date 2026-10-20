import fs from 'node:fs'
import path from 'node:path'
import type { AgentDriverSettings, AgentSettingsContext, AgentSettingsRequest } from '@bmw-agent/agent-contract'
import { clearWorkbuddyCredentials, readWorkbuddyCredentials, writeWorkbuddyCredentials, workbuddyCredentialFingerprint } from './workbuddy-credentials.js'
import type { WorkbuddyEncryption, WorkbuddyCredentials } from './workbuddy-credentials.js'
import { workbuddyModelAllowlist } from './workbuddy-model-catalog.js'

export interface WorkbuddySettingsOptions {
  configDirectory: string
  encryption?: WorkbuddyEncryption
  model(): string | null
  setModel(modelId: string): void
}
export const workbuddyApiKeyMethod = 'apiKey'
/** Only an actual successful task establishes service access for this credential/model pair. */
export function markWorkbuddyVerified(config: string, credentials: WorkbuddyCredentials, model: string): void {
  const target = path.join(config, 'task-verification.json'), temporary = target + '.tmp'
  const record = { fingerprint: workbuddyCredentialFingerprint(credentials), model }
  try { fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 }); fs.renameSync(temporary, target) }
  finally { fs.rmSync(temporary, { force: true }) }
}
function verifiedModel(config: string, credentials: WorkbuddyCredentials): string | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(config, 'task-verification.json'), 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    return record.fingerprint === workbuddyCredentialFingerprint(credentials) && typeof record.model === 'string' ? record.model : null
  } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('WorkBuddy 任务验证记录无法读取；原文件已保留') }
}
/** Local credential configuration only. Refresh never opens a model turn or claims remote authentication. */
export class WorkbuddySettings {
  private running: Promise<AgentDriverSettings> | null = null
  constructor(private readonly options: WorkbuddySettingsOptions) {}
  get busy(): boolean { return this.running !== null }
  async execute(request: AgentSettingsRequest, context: AgentSettingsContext): Promise<AgentDriverSettings> {
    if (this.running) throw new Error('WorkBuddy settings are busy')
    const work = Promise.resolve().then(() => {
      context.signal.throwIfAborted()
      if (request.action === 'auth.logout') {
        clearWorkbuddyCredentials(this.options.configDirectory)
        fs.rmSync(path.join(this.options.configDirectory, 'task-verification.json'), { force: true })
      }
      if (request.action === 'auth.login') {
        if (request.methodId !== workbuddyApiKeyMethod || (request.values.environment && !['internal', 'global'].includes(request.values.environment))) throw new Error('WorkBuddy API Key 或服务区域格式无效')
        writeWorkbuddyCredentials(this.options.configDirectory, { apiKey: (request.values.apiKey ?? '').trim(), internetEnvironment: request.values.environment === 'global' ? '' : 'internal' }, this.options.encryption)
      }
      const snapshot = this.snapshot()
      if (request.action === 'model.select') {
        if (!snapshot.canLogout || !snapshot.models.some(row => row.id === request.modelId && row.availability !== 'unavailable')) throw new Error('请先配置 WorkBuddy Key 并选择兼容模型')
        context.signal.throwIfAborted(); this.options.setModel(request.modelId); return this.snapshot()
      }
      context.signal.throwIfAborted(); return snapshot
    })
    this.running = work
    try { return await work } finally { if (this.running === work) this.running = null }
  }
  private snapshot(): AgentDriverSettings {
    let stored: WorkbuddyCredentials | null = null, error: string | null = null
    try { stored = readWorkbuddyCredentials(this.options.configDirectory, this.options.encryption) } catch (failure: unknown) { error = failure instanceof Error ? failure.message : 'WorkBuddy 凭据无法读取' }
    const verified = stored ? verifiedModel(this.options.configDirectory, stored) : null
    const selected = this.options.model()
    return {
      authentication: { state: stored ? verified !== null && verified === selected ? 'ready' : 'configured' : 'required', label: error ?? (stored ? verified !== null && verified === selected ? '当前 Key 与模型已通过真实任务验证' : 'Key 已配置，服务权限由实际任务验证' : '请配置 WorkBuddy API Key') },
      models: workbuddyModelAllowlist.map(id => ({ id, label: id, description: verified === id ? '已通过真实任务验证' : '兼容模型；服务权限由实际任务验证', availability: !stored ? 'unavailable' : verified === id ? 'verified' : 'unverified' })),
      selectedModel: selected,
      loginMethods: [{ id: workbuddyApiKeyMethod, label: 'WorkBuddy API Key', fields: [
        { id: 'apiKey', label: 'API Key', secret: true, required: true },
        { id: 'environment', label: '服务区域：中国版 internal，海外版 global（默认中国版）', secret: false, required: false },
      ] }],
      canLogout: stored !== null || error !== null,
    }
  }
  async drain(): Promise<void> { await this.running?.then(() => {}, () => {}) }
}
