import fs from 'node:fs'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { agentIdentifier, agentRecord, agentText } from '@bmw-agent/agent-contract'
import type { AgentBackend, AgentDriverDescription, AgentDriverEvent, AgentRunRequest, AgentRunResult, AgentSettingsContext, AgentSettingsRequest, AgentDriverSettings } from '@bmw-agent/agent-contract'
import { createWorkbuddyAcp } from './workbuddy-acp.js'
import type { WorkbuddyAcp } from './workbuddy-acp.js'
import { readWorkbuddyCredentials } from './workbuddy-credentials.js'
import { assertWorkbuddyCliVersion, findWorkbuddyCli, workbuddyNodeExecutable } from './workbuddy-installation.js'
import { workbuddyAdmittedModel, workbuddyPinnedCliVersion } from './workbuddy-model-catalog.js'
import {
  workbuddyAdmitsClientRequest, workbuddyAdmitsTool, workbuddyEnvironment, workbuddyInitializeParams,
  workbuddyArgumentsComplete, workbuddyIsDiscoveryTool, workbuddyMcpServer, workbuddyProtocolVersion, workbuddySessionParams,
  workbuddySpawnArgs, workbuddyStopOutcome, workbuddyUpdateToolName,
} from './workbuddy-policy.js'
import { WorkbuddySettings } from './workbuddy-settings.js'

/** Host-owned bridge to the BMW browser MCP server. The CLI never learns BMW's Session scope. */
export interface WorkbuddyConnection {
  bridgeUrl: string
  bridgeToken: string
  binding: string
  nodeExecutable: string
  mcpServerPath: string
}

export interface WorkbuddyBackendOptions {
  configDirectory: string
  cli?: string
  node?: string
  model?: string
  getModel?(): string | null
  setModel?(modelId: string): void
  connection(request: AgentRunRequest): Promise<WorkbuddyConnection>
  acpFactory?: typeof createWorkbuddyAcp
  promptsTimeoutMs?: number
  cancellationTimeoutMs?: number
}

interface Run {
  request: AgentRunRequest
  acp: WorkbuddyAcp
  sessionId: string
  externalSessionId: string | null
  released: boolean
  emit: ((event: AgentDriverEvent) => Promise<void>) | null
  text: string
  tools: Set<string>
  stopping: boolean
  cancelSent: boolean
  terminal: boolean
  unsubscribe(): void
  abort(): void
  cancelTimer?: ReturnType<typeof setTimeout>
}

const workbuddyToolName = 'browser'

/** Operator-only trace: enabled solely by BMW_ACP_STDERR_LOG for local diagnosis. */
function workbuddyTrace(stage: string, detail: unknown): void {
  const file = process.env.BMW_ACP_STDERR_LOG
  if (!file) return
  try { appendFileSync(file, JSON.stringify({ at: Date.now(), stage, detail }) + '\n') } catch {}
}

/** The forwarded action lives in `params.action`; a direct call carries it inline. */
function workbuddyToolAction(update: Record<string, unknown>): string {
  const raw = update.rawInput
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const input = raw as Record<string, unknown>
    if (typeof input.action === 'string') return input.action.slice(0, 200)
    const nested = input.params
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const action = (nested as Record<string, unknown>).action
      if (typeof action === 'string') return action.slice(0, 200)
    }
  }
  return typeof update.title === 'string' ? update.title.slice(0, 200) : workbuddyToolName
}

export class WorkbuddyBackend implements AgentBackend {
  readonly description: AgentDriverDescription = {
    id: 'workbuddy',
    label: 'WorkBuddy',
    baseline: 'CodeBuddy Code ' + workbuddyPinnedCliVersion + ' / ACP v1 / browser-only',
    capabilities: { streaming: true, images: false, interrupt: true, steer: false, fork: false, approvals: false, nativeOpen: false, browserOnly: false },
  }
  private readonly runs = new Map<string, Run>()
  private readonly settingsPort: WorkbuddySettings | undefined
  private versionChecked = false
  private closed = false
  constructor(private readonly options: WorkbuddyBackendOptions) {
    if (!path.isAbsolute(options.configDirectory)) throw new Error('WorkBuddy requires an absolute host-owned profile path')
    if (options.model !== undefined) agentIdentifier(options.model, 'WorkBuddy model')
    if (options.setModel !== undefined) {
      this.settingsPort = new WorkbuddySettings({
        node: workbuddyNodeExecutable(options.node),
        cli: this.resolveCli(),
        configDirectory: options.configDirectory,
        model: () => this.options.getModel?.() ?? this.options.model ?? null,
        setModel: options.setModel,
        acpFactory: options.acpFactory,
      })
    }
  }
  private resolveCli(): string {
    const cli = this.options.cli ?? findWorkbuddyCli()
    if (!cli) throw new Error('未找到 WorkBuddy 官方 CLI；请重新安装依赖或通过 BMW_WORKBUDDY_EXECUTABLE 指定')
    return cli
  }
  private profileHome(): string { return path.join(this.options.configDirectory, 'home') }

  async prepare(request: AgentRunRequest): Promise<AgentDriverDescription> {
    if (this.closed || this.runs.size || this.settingsPort?.busy) throw new Error('WorkBuddy backend is closed or still owns an active process')
    request.signal.throwIfAborted()
    const node = workbuddyNodeExecutable(this.options.node)
    const cli = this.resolveCli()
    if (!this.versionChecked) { await assertWorkbuddyCliVersion(node, cli); this.versionChecked = true }
    fs.mkdirSync(this.profileHome(), { recursive: true, mode: 0o700 })
    const stored = readWorkbuddyCredentials(this.options.configDirectory)
    if (!stored) throw new Error('请先在 Agent 设置中填写 WorkBuddy API Key')
    const model = this.options.getModel?.() ?? this.options.model ?? null
    if (!model) throw new Error('请先在 Agent 设置中选择已通过验证的 WorkBuddy 模型')
    if (!workbuddyAdmittedModel(model)) throw new Error('该模型不在 BMW 的 WorkBuddy 准入名单内')
    const connection = await this.options.connection(request)
    request.signal.throwIfAborted()
    const env = workbuddyEnvironment({ home: this.profileHome(), apiKey: stored.apiKey, internetEnvironment: stored.internetEnvironment })
    const acp = (this.options.acpFactory ?? createWorkbuddyAcp)({ node, cli, args: workbuddySpawnArgs(model), cwd: request.project.directory, env })
    let run: Run | null = null
    try {
      const initialized = await acp.call('initialize', workbuddyInitializeParams())
      workbuddyProtocolVersion(initialized)
      request.signal.throwIfAborted()
      const server = workbuddyMcpServer({ node: connection.nodeExecutable, serverPath: connection.mcpServerPath, bridgeUrl: connection.bridgeUrl, bridgeToken: connection.bridgeToken, binding: connection.binding })
      const params = workbuddySessionParams(request.project.directory, server)
      let sessionId: string
      let external: string | null = request.externalSessionId
      if (request.externalSessionId) {
        const loaded = agentRecord(await acp.call('session/load', { ...params, sessionId: request.externalSessionId }, 60000), 'WorkBuddy session/load result')
        sessionId = typeof loaded.sessionId === 'string' ? loaded.sessionId : request.externalSessionId
        if (sessionId !== request.externalSessionId) throw new Error('WorkBuddy resumed a different provider Session')
      } else {
        const created = agentRecord(await acp.call('session/new', params, 60000), 'WorkBuddy session/new result')
        sessionId = agentIdentifier(created.sessionId)
        external = sessionId
      }
      request.signal.throwIfAborted()
      run = {
        request, acp, sessionId, externalSessionId: external, released: false, emit: null, text: '',
        tools: new Set(), stopping: false, cancelSent: false, terminal: false, unsubscribe: () => {}, abort: () => {},
      }
      this.runs.set(request.runId, run)
      run.unsubscribe = acp.onNotification((method, raw) => {
        try { this.notification(run as Run, method, raw) } catch (error: unknown) { this.fail(run as Run, error) }
      })
      acp.onRequest(async (method, raw) => this.clientRequest(run as Run, method, raw))
      acp.onFailure(error => { if (run && !run.terminal) this.fail(run, error) })
      run.abort = () => { void this.stop(run as Run) }
      request.signal.addEventListener('abort', run.abort, { once: true })
      return { ...this.description, capabilities: { ...this.description.capabilities, browserOnly: true } }
    } catch (error: unknown) {
      if (run) await this.release(run)
      else await acp.close().catch(() => {})
      throw error
    }
  }

  async run(request: AgentRunRequest, emit: (event: AgentDriverEvent) => Promise<void>): Promise<AgentRunResult> {
    const run = this.member(request.sessionId, request.runId)
    if (run.released) throw new Error('WorkBuddy input was already released')
    if (run.externalSessionId) await emit({ type: 'session.bound', externalSessionId: run.externalSessionId })
    run.emit = emit
    run.released = true
    try {
      const receipt = request.runId + ':' + run.sessionId
      const pending = run.acp.call('session/prompt', { sessionId: run.sessionId, prompt: [{ type: 'text', text: request.text }] }, this.options.promptsTimeoutMs ?? 30 * 60 * 1000)
      // ACP acknowledges a prompt only at completion, so acceptance is the transport receipt.
      await emit({ type: 'input.accepted', receiptId: receipt })
      if (request.signal.aborted) await this.stop(run)
      const response = await pending
      if (run.terminal) return { outcome: 'interrupted', message: 'WorkBuddy stopped' }
      const result = workbuddyStopOutcome(response)
      if (run.text !== '' && result.outcome !== 'failed') await emit({ type: 'message.completed', messageId: request.runId + ':assistant', text: run.text })
      await emit({ type: 'turn.completed', ...result })
      run.terminal = true
      return result
    } finally { await this.release(run) }
  }

  private notification(run: Run, method: string, raw: unknown): void {
    if (method !== 'session/update' || !run.emit) return
    const value = agentRecord(raw, 'WorkBuddy session update')
    if (value.sessionId !== run.sessionId) throw new Error('WorkBuddy notification belongs to another provider Session')
    const update = agentRecord(value.update, 'WorkBuddy update')
    if (run.terminal) throw new Error('WorkBuddy emitted work after turn completion')
    const kind = update.sessionUpdate
    if (kind === 'agent_message_chunk') {
      const block = agentRecord(update.content, 'WorkBuddy content block')
      if (block.type !== 'text' || typeof block.text !== 'string') return
      const text = agentText(block.text, 2 * 1024 * 1024)
      run.text = agentText(run.text + text, 2 * 1024 * 1024)
      this.emitLater(run, { type: 'message.delta', messageId: run.request.runId + ':assistant', text })
      return
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      // Catalogue lookups never leave the CLI and never appear in BMW's turn.
      if (workbuddyIsDiscoveryTool(update)) { workbuddyTrace('tool.discovery', update); return }
      // Argument fragments stream ahead of the call that names them; they carry
      // no tool id yet and must not be mistaken for an unadmitted tool.
      if (typeof update.toolCallId !== 'string' || update.toolCallId === '') return
      const toolCallId = agentIdentifier(update.toolCallId)
      const callId = run.request.runId + ':' + toolCallId
      const status = typeof update.status === 'string' ? update.status : 'pending'
      const admitted = run.tools.has(toolCallId)
      if (!admitted) {
        workbuddyTrace('tool.candidate', update)
        if (workbuddyUpdateToolName(update) === '') return
        // The forwarded tool is named only once its arguments land; before that
        // there is nothing to admit and nothing to reject.
        if (!workbuddyArgumentsComplete(update)) return
        if (!workbuddyAdmitsTool(update)) throw new Error('WorkBuddy emitted a tool outside BMW browser admission')
      }
      if (status === 'completed' || status === 'failed') {
        run.tools.delete(toolCallId)
        this.emitLater(run, { type: 'tool.completed', callId, success: status === 'completed', message: status === 'completed' ? '' : 'BMW browser action failed' })
      } else if (!admitted) {
        run.tools.add(toolCallId)
        this.emitLater(run, { type: 'tool.started', callId, name: 'browser', action: workbuddyToolAction(update) })
      }
      return
    }
    // Plans, thoughts, usage and command catalogs are not part of BMW's visible turn.
  }

  /** Events are serialized so a slow host cannot reorder deltas. */
  private emitLater(run: Run, event: AgentDriverEvent): void {
    const emit = run.emit
    if (!emit) return
    const tail = Promise.resolve().then(() => emit(event))
    void tail.catch(error => this.fail(run, error))
  }

  private async clientRequest(run: Run, method: string, raw: unknown): Promise<unknown> {
    workbuddyTrace('clientRequest', { method, raw })
    if (!workbuddyAdmitsClientRequest(method, raw)) {
      this.fail(run, new Error('WorkBuddy requested a capability BMW did not declare'))
      throw new Error('BMW rejects this Agent request')
    }
    if (run.stopping || run.terminal) return { outcome: { outcome: 'cancelled' } }
    const value = agentRecord(raw, 'WorkBuddy permission request')
    const toolCall = value.toolCall === undefined ? null : agentRecord(value.toolCall, 'WorkBuddy permission tool call')
    if (!toolCall || !workbuddyAdmitsTool(toolCall)) {
      this.fail(run, new Error('WorkBuddy requested permission for a tool outside BMW browser admission'))
      throw new Error('BMW rejects this Agent request')
    }
    const options = Array.isArray(value.options) ? value.options : []
    const allow = options.map(rawOption => agentRecord(rawOption)).find(option => option.kind === 'allow_once' || option.kind === 'allow_always')
    if (!allow || typeof allow.optionId !== 'string') {
      this.fail(run, new Error('WorkBuddy offered no browser permission option'))
      throw new Error('BMW rejects this Agent request')
    }
    return { outcome: { outcome: 'selected', optionId: allow.optionId } }
  }

  private fail(run: Run, error: unknown): void {
    workbuddyTrace('fail', { reason: error instanceof Error ? error.message : String(error), terminal: run.terminal })
    if (run.terminal) return
    run.terminal = true
    const message = error instanceof Error ? error.message : 'WorkBuddy runtime failed'
    const emit = run.emit
    if (emit) void emit({ type: 'turn.disconnected', message }).catch(() => {})
    void run.acp.close().catch(() => {})
  }

  private member(sessionId: string, runId: string): Run {
    const run = this.runs.get(runId)
    if (!run || run.request.sessionId !== sessionId) throw new Error('WorkBuddy run does not belong to this BMW Session')
    return run
  }

  private async stop(run: Run): Promise<void> {
    if (run.terminal || !run.released) return
    workbuddyTrace('stop', { stopping: run.stopping, released: run.released })
    if (!run.stopping) {
      run.stopping = true
      run.cancelTimer = setTimeout(() => { void run.acp.close().catch(() => {}) }, this.options.cancellationTimeoutMs ?? 10000)
    }
    if (!run.cancelSent) { run.cancelSent = true; run.acp.notify('session/cancel', { sessionId: run.sessionId }) }
  }

  async interrupt(sessionId: string, runId: string): Promise<void> { if (this.runs.has(runId)) await this.stop(this.member(sessionId, runId)) }

  async respond(): Promise<void> { throw new Error('WorkBuddy browser-only runtime uses BMW browser permission controls') }

  async drain(sessionId: string, runId: string): Promise<void> { if (this.runs.has(runId)) await this.release(this.member(sessionId, runId)) }

  async settings(request: AgentSettingsRequest, context: AgentSettingsContext): Promise<AgentDriverSettings> {
    if (this.closed || this.runs.size || !this.settingsPort) throw new Error('WorkBuddy settings are unavailable while native work is active')
    return this.settingsPort.execute(request, context)
  }

  async drainSettings(): Promise<void> { await this.settingsPort?.drain() }

  private async release(run: Run): Promise<void> {
    run.terminal = true
    run.request.signal.removeEventListener('abort', run.abort)
    if (run.cancelTimer) clearTimeout(run.cancelTimer)
    run.unsubscribe()
    await run.acp.close().catch(() => {})
    this.runs.delete(run.request.runId)
  }

  async close(): Promise<void> {
    this.closed = true
    const runs = [...this.runs.values()]
    for (const run of runs) run.terminal = true
    await Promise.all([...runs.map(run => this.release(run)), this.drainSettings()])
  }
}
