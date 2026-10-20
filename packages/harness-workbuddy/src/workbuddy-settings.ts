import fs from 'node:fs'
import path from 'node:path'
import { agentRecord } from '@bmw-agent/agent-contract'
import type { AgentDriverSettings, AgentModelChoice, AgentSettingsContext, AgentSettingsRequest } from '@bmw-agent/agent-contract'
import { createWorkbuddyAcp } from './workbuddy-acp.js'
import { workbuddyEnvironment, workbuddyInitializeParams, workbuddyProbeSessionParams, workbuddyProtocolVersion, workbuddySpawnArgs } from './workbuddy-policy.js'
import { clearWorkbuddyCredentials, readWorkbuddyCredentials, writeWorkbuddyCredentials } from './workbuddy-credentials.js'
import { workbuddyModelAllowlist } from './workbuddy-model-catalog.js'

export interface WorkbuddySettingsOptions {
  node: string
  cli: string
  configDirectory: string
  model(): string | null
  setModel(modelId: string): void
  acpFactory?: typeof createWorkbuddyAcp
}

export const workbuddyApiKeyMethod = 'apiKey'

interface ProbeResult {
  ready: boolean
  authMethods: { id: string; label: string }[]
}

/**
 * Prove the credential by opening (and closing) a real session. No model turn
 * runs, so this never bills inference and never releases user input.
 */
async function probe(options: WorkbuddySettingsOptions, signal: AbortSignal): Promise<ProbeResult> {
  const stored = readWorkbuddyCredentials(options.configDirectory)
  if (!stored) return { ready: false, authMethods: [] }
  fs.mkdirSync(path.join(options.configDirectory, 'home'), { recursive: true, mode: 0o700 })
  const env = workbuddyEnvironment({ home: path.join(options.configDirectory, 'home'), apiKey: stored.apiKey, internetEnvironment: stored.internetEnvironment })
  const model = options.model() ?? workbuddyModelAllowlist[0]
  const acp = (options.acpFactory ?? createWorkbuddyAcp)({ node: options.node, cli: options.cli, args: workbuddySpawnArgs(model), cwd: options.configDirectory, env })
  const abort = () => { void acp.close().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const initialized = await acp.call('initialize', workbuddyInitializeParams())
    workbuddyProtocolVersion(initialized)
    signal.throwIfAborted()
    try {
      await acp.call('session/new', workbuddyProbeSessionParams(options.configDirectory), 60000)
      return { ready: true, authMethods: methods(initialized) }
    } catch {
      return { ready: false, authMethods: methods(initialized) }
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await acp.close().catch(() => {})
  }
}

function methods(initialized: unknown): { id: string; label: string }[] {
  const value = agentRecord(initialized, 'WorkBuddy initialize result')
  if (!Array.isArray(value.authMethods)) return []
  return value.authMethods.slice(0, 20).flatMap(raw => {
    const method = agentRecord(raw)
    return typeof method.id === 'string' && method.id.length <= 64 ? [{ id: method.id, label: typeof method.name === 'string' ? method.name.slice(0, 200) : method.id }] : []
  })
}

/** Native credential and model control only. This process never creates a model turn. */
export class WorkbuddySettings {
  private running: Promise<AgentDriverSettings> | null = null
  constructor(private readonly options: WorkbuddySettingsOptions) {}
  get busy(): boolean { return this.running !== null }
  async execute(request: AgentSettingsRequest, context: AgentSettingsContext): Promise<AgentDriverSettings> {
    if (this.running) throw new Error('WorkBuddy settings still own an active probe')
    context.signal.throwIfAborted()
    fs.mkdirSync(this.options.configDirectory, { recursive: true, mode: 0o700 })
    if (request.action === 'auth.login') this.login(request)
    if (request.action === 'auth.logout') clearWorkbuddyCredentials(this.options.configDirectory)
    const work = this.snapshot(context.signal)
    this.running = work
    try {
      const snapshot = await work
      if (request.action === 'model.select') {
        const choice = snapshot.models.find(row => row.id === request.modelId)
        if (!choice || snapshot.authentication.state !== 'ready') throw new Error('该 WorkBuddy 模型当前不可用')
        this.options.setModel(choice.id)
        snapshot.selectedModel = choice.id
      }
      context.signal.throwIfAborted()
      return snapshot
    } finally {
      if (this.running === work) this.running = null
    }
  }
  private login(request: Extract<AgentSettingsRequest, { action: 'auth.login' }>): void {
    if (request.methodId !== workbuddyApiKeyMethod) throw new Error('BMW 目前只支持通过 API Key 登录 WorkBuddy')
    const key = request.values.apiKey
    if (typeof key !== 'string' || key.trim().length < 8) throw new Error('WorkBuddy API Key 格式无效')
    const environment = request.values.environment === 'global' ? '' : 'internal'
    writeWorkbuddyCredentials(this.options.configDirectory, { apiKey: key.trim(), internetEnvironment: environment })
  }
  private async snapshot(signal: AbortSignal): Promise<AgentDriverSettings> {
    let result: ProbeResult
    try { result = await probe(this.options, signal) }
    catch { result = { ready: false, authMethods: [] } }
    const stored = readWorkbuddyCredentials(this.options.configDirectory)
    const selected = this.options.model() ?? workbuddyModelAllowlist[0]
    const models: AgentModelChoice[] = workbuddyModelAllowlist.map(id => ({
      id,
      label: id,
      description: 'BMW 已验证的 WorkBuddy 模型',
      availability: result.ready ? 'verified' : 'unavailable',
      ...(result.ready ? {} : { reason: '需要先完成 WorkBuddy 认证' }),
    }))
    return {
      authentication: {
        state: result.ready ? 'ready' : stored ? 'required' : 'unknown',
        label: result.ready ? '已配置 WorkBuddy API Key' : stored ? 'WorkBuddy API Key 未通过校验，请重新填写' : '需要 WorkBuddy API Key',
      },
      models,
      selectedModel: result.ready ? selected : null,
      loginMethods: [{
        id: workbuddyApiKeyMethod,
        label: 'WorkBuddy API Key',
        fields: [
          { id: 'apiKey', label: 'API Key', secret: true, required: true },
          { id: 'environment', label: '中国版填 internal，海外版填 global（留空按中国版处理）', secret: false, required: false, value: '' },
        ],
      }],
      canLogout: stored !== null,
    }
  }
  async drain(): Promise<void> { this.running = null }
}
