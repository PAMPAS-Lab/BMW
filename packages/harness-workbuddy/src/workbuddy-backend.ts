import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { agentIdentifier, agentRecord, agentText } from '@bmw-agent/agent-contract'
import type { AgentBackend, AgentDriverDescription, AgentDriverEvent, AgentRunRequest, AgentRunResult, AgentSettingsContext, AgentSettingsRequest, AgentDriverSettings } from '@bmw-agent/agent-contract'
import { createWorkbuddyAcp } from './workbuddy-acp.js'
import type { WorkbuddyAcp } from './workbuddy-acp.js'
import { readWorkbuddyCredentials, workbuddyCredentialFingerprint } from './workbuddy-credentials.js'
import type { WorkbuddyCredentials, WorkbuddyEncryption } from './workbuddy-credentials.js'
import { assertWorkbuddyCliVersion, findWorkbuddyCli, workbuddyNodeExecutable } from './workbuddy-installation.js'
import { workbuddyAdmittedModel, workbuddyPinnedCliVersion } from './workbuddy-model-catalog.js'
import { workbuddyAdmitsClientRequest, workbuddyAdmitsTool, workbuddyEnvironment, workbuddyInitializeParams, workbuddyMcpServer, workbuddyProtocolVersion, workbuddySessionParams, workbuddySpawnArgs, workbuddyStopOutcome, workbuddyUpdateToolName } from './workbuddy-policy.js'
import { WorkbuddySettings, markWorkbuddyVerified } from './workbuddy-settings.js'
import { WorkbuddyCatalogGate, WorkbuddyCleanupFailure, copyWorkbuddyResume } from './workbuddy-catalog.js'
import type { WorkbuddyAdmission, WorkbuddyBrowserDefinition, WorkbuddyCatalogOptions } from './workbuddy-catalog.js'

export interface WorkbuddyConnection {
  bridgeUrl: string; bridgeToken: string; binding: string; nodeExecutable: string; mcpServerPath: string
  definition: WorkbuddyBrowserDefinition
  attachProviderSession?(externalId: string): Promise<void> | void
}
export interface WorkbuddyBackendOptions {
  configDirectory: string; cli?: string; node?: string; model?: string
  encryption?: WorkbuddyEncryption
  getModel?(): string | null
  setModel?(modelId: string): void
  connection(request: AgentRunRequest): Promise<WorkbuddyConnection>
  acpFactory?: typeof createWorkbuddyAcp
  catalogGate?: Pick<WorkbuddyCatalogGate, 'verify'>
  promptsTimeoutMs?: number
  cancellationTimeoutMs?: number
}
interface Run {
  request: AgentRunRequest; controller: AbortController; signal: AbortSignal
  prepared: Promise<void>; running: Promise<AgentRunResult> | null
  acp?: WorkbuddyAcp; sessionId: string; temporary?: string; home?: string
  resume?: WorkbuddyCatalogOptions['resume']; proof?: WorkbuddyAdmission
  credentials?: WorkbuddyCredentials; model: string
  gateFailure?: WorkbuddyCleanupFailure
  released: boolean; emit: ((event: AgentDriverEvent) => Promise<void>) | null
  tail: Promise<void>; error: Error | null; failed: Promise<never>; reject(error: Error): void
  text: string; tools: Map<string, boolean>; stopping: boolean; terminal: boolean
  transportClosing: Promise<void> | null; cleanupError: Error | null; cleaning: Promise<void> | null; unsubscribe(): void; abort(): void
  cancelTimer?: ReturnType<typeof setTimeout>
}
function errorValue(error: unknown): Error { return error instanceof Error ? error : new Error('WorkBuddy operation failed') }

/** The official CLI owns the Agent loop. BMW admits its directory and normalizes its wire events. */
export class WorkbuddyBackend implements AgentBackend {
  readonly description: AgentDriverDescription = {
    id: 'workbuddy', label: 'WorkBuddy', baseline: 'CodeBuddy Code ' + workbuddyPinnedCliVersion + ' / ACP v1 / effective browser catalog',
    capabilities: { streaming: true, images: false, interrupt: true, steer: false, fork: false, approvals: false, nativeOpen: false, browserOnly: false },
  }
  private readonly runs = new Map<string, Run>()
  private readonly settingsPort?: WorkbuddySettings
  private readonly gate: Pick<WorkbuddyCatalogGate, 'verify'>
  private closed = false
  constructor(private readonly options: WorkbuddyBackendOptions) {
    if (!path.isAbsolute(options.configDirectory)) throw new Error('WorkBuddy requires an absolute host-owned profile')
    if (options.model !== undefined) agentIdentifier(options.model)
    this.gate = options.catalogGate ?? new WorkbuddyCatalogGate()
    if (options.setModel) this.settingsPort = new WorkbuddySettings({ configDirectory: options.configDirectory, encryption: options.encryption, model: () => this.model(), setModel: options.setModel })
  }
  private model(): string | null { return this.options.getModel?.() ?? this.options.model ?? null }
  private resolveCli(): string {
    const cli = this.options.cli ?? findWorkbuddyCli()
    if (!cli) throw new Error('未找到已固定的 WorkBuddy 官方 CLI')
    return cli
  }
  async prepare(request: AgentRunRequest): Promise<AgentDriverDescription> {
    if (this.closed || this.runs.size || this.settingsPort?.busy) throw new Error('WorkBuddy still owns native work or quarantined resources')
    request.signal.throwIfAborted()
    const controller = new AbortController()
    let reject!: Run['reject']
    const failed = new Promise<never>((_, no) => { reject = no }); void failed.catch(() => {})
    const run: Run = { request, controller, signal: AbortSignal.any([request.signal, controller.signal]), prepared: Promise.resolve(), running: null, sessionId: '', model: '', released: false, emit: null, tail: Promise.resolve(), error: null, failed, reject, text: '', tools: new Map(), stopping: false, terminal: false, transportClosing: null, cleanupError: null, cleaning: null, unsubscribe: () => {}, abort: () => {} }
    // Own the slot before the first await, including verification and failed cleanup.
    this.runs.set(request.runId, run)
    run.abort = () => { void this.stop(run).catch(error => this.fail(run, errorValue(error))) }
    run.signal.addEventListener('abort', run.abort, { once: true })
    run.prepared = this.prepareRun(run)
    try { await run.prepared; return { ...this.description, capabilities: { ...this.description.capabilities, browserOnly: true } } }
    catch (error: unknown) { if (!run.gateFailure) await this.release(run); throw error }
  }
  private async prepareRun(run: Run): Promise<void> {
    const { request, signal } = run
    const credentials = readWorkbuddyCredentials(this.options.configDirectory, this.options.encryption)
    if (!credentials) throw new Error('请先在 Agent 设置中配置 WorkBuddy API Key')
    const model = this.model()
    if (!model || !workbuddyAdmittedModel(model)) throw new Error('请选择 WorkBuddy 准入名单中的兼容模型')
    run.credentials = credentials; run.model = model
    const node = workbuddyNodeExecutable(this.options.node), cli = this.resolveCli()
    await assertWorkbuddyCliVersion(node, cli); signal.throwIfAborted()
    const connection = await this.options.connection(request); signal.throwIfAborted()
    run.resume = this.resume(request)
    try {
      run.proof = await this.gate.verify({ node, cli, model, workspace: request.project.directory, internetEnvironment: credentials.internetEnvironment, browser: connection.definition, mcp: { node: connection.nodeExecutable, serverPath: connection.mcpServerPath, bridgeUrl: connection.bridgeUrl, bridgeToken: connection.bridgeToken }, signal, watchedFiles: [path.join(this.options.configDirectory, 'workbuddy-credentials.enc')], ...(run.resume ? { resume: run.resume } : {}) })
    } catch (error: unknown) { if (error instanceof WorkbuddyCleanupFailure) run.gateFailure = error; throw error }
    signal.throwIfAborted(); run.proof.assertCurrent()
    run.temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-run-')))
    run.home = path.join(run.temporary, 'home'); fs.mkdirSync(run.home, { mode: 0o700 }); copyWorkbuddyResume(run.home, run.resume)
    const env = workbuddyEnvironment({ home: run.home, apiKey: credentials.apiKey, internetEnvironment: credentials.internetEnvironment, parent: {} }); env.TMPDIR = run.temporary
    const acp = run.acp = (this.options.acpFactory ?? createWorkbuddyAcp)({ node, cli, args: workbuddySpawnArgs(model), cwd: request.project.directory, env })
    acp.onFailure(error => { if (!run.terminal) this.fail(run, error) })
    acp.onRequest(async (method, raw) => {
      try { return this.clientRequest(run, method, raw) } catch (error: unknown) { this.fail(run, errorValue(error)); throw error }
    })
    run.unsubscribe = acp.onNotification((method, raw) => {
      const work = run.tail.then(() => this.notification(run, method, raw))
      run.tail = work; void work.catch(error => this.fail(run, errorValue(error)))
    })
    workbuddyProtocolVersion(await acp.call('initialize', workbuddyInitializeParams()))
    signal.throwIfAborted()
    const params = workbuddySessionParams(request.project.directory, workbuddyMcpServer({ node: connection.nodeExecutable, serverPath: connection.mcpServerPath, bridgeUrl: connection.bridgeUrl, bridgeToken: connection.bridgeToken, binding: connection.binding }))
    const session = agentRecord(await acp.call(request.externalSessionId ? 'session/load' : 'session/new', { ...params, ...(request.externalSessionId ? { sessionId: request.externalSessionId } : {}) }, 60000))
    run.sessionId = agentIdentifier(session.sessionId ?? request.externalSessionId)
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(run.sessionId)) throw new Error('Invalid WorkBuddy native Session id')
    if (request.externalSessionId && run.sessionId !== request.externalSessionId) throw new Error('WorkBuddy resumed a different provider Session')
    const models = agentRecord(session.models, 'WorkBuddy model catalog')
    if (models.currentModelId !== model || !Array.isArray(models.availableModels) || !models.availableModels.some(value => agentRecord(value).modelId === model)) throw new Error('WorkBuddy runtime did not retain the selected compatible model')
    await connection.attachProviderSession?.(run.sessionId)
    await run.tail; signal.throwIfAborted(); if (run.error) throw run.error
    run.proof.assertCurrent()
  }
  async run(request: AgentRunRequest, emit: (event: AgentDriverEvent) => Promise<void>): Promise<AgentRunResult> {
    const run = this.member(request.sessionId, request.runId)
    await run.prepared
    if (run.released || run.terminal || !run.acp || !run.proof || !run.credentials) throw new Error('WorkBuddy input cannot be released')
    run.signal.throwIfAborted(); run.proof.assertCurrent()
    const stored = readWorkbuddyCredentials(this.options.configDirectory, this.options.encryption)
    if (!stored || workbuddyCredentialFingerprint(stored) !== workbuddyCredentialFingerprint(run.credentials) || this.model() !== run.model || request.text !== run.request.text || request.context !== run.request.context) throw new Error('WorkBuddy input/configuration changed after prepare')
    run.emit = emit
    run.running = this.runTurn(run)
    try { return await run.running } finally { await this.release(run) }
  }
  private async runTurn(run: Run): Promise<AgentRunResult> {
    const emit = run.emit!
    try {
      await emit({ type: 'session.bound', externalSessionId: run.sessionId })
      run.signal.throwIfAborted(); run.proof!.assertCurrent()
      fs.rmSync(path.join(this.options.configDirectory, 'task-verification.json'), { force: true })
      run.released = true
      const context = agentText(run.request.context, 16384), text = agentText(run.request.text, 2 * 1024 * 1024)
      const response = await Promise.race([run.acp!.call('session/prompt', { sessionId: run.sessionId, prompt: [{ type: 'text', text: context ? 'Current BMW Project context:\n' + context + '\n\nUser request:\n' + text : text }] }, this.options.promptsTimeoutMs ?? 30 * 60 * 1000), run.failed])
      await run.tail
      if (run.error) throw run.error
      const value = agentRecord(response)
      // ACP has no early transport acceptance. Only its native prompt response is a receipt.
      const receipt = agentIdentifier(value.userMessageId, 'WorkBuddy native input receipt')
      await emit({ type: 'input.accepted', receiptId: receipt })
      const result = workbuddyStopOutcome(value)
      if (run.stopping || run.signal.aborted) { result.outcome = 'interrupted'; result.message = 'WorkBuddy stopped' }
      if ([...run.tools.values()].some(active => active)) throw new Error('WorkBuddy completed before its browser tools settled')
      if (run.text && result.outcome !== 'failed') await emit({ type: 'message.completed', messageId: run.request.runId + ':assistant', text: run.text })
      if (result.outcome === 'success') markWorkbuddyVerified(this.options.configDirectory, run.credentials!, run.model)
      run.terminal = true
      await emit({ type: 'turn.completed', ...result }); return result
    } catch (error: unknown) {
      await run.tail.catch(() => {})
      const interrupted = run.stopping || run.signal.aborted
      const result: AgentRunResult = { outcome: interrupted ? 'interrupted' : 'failed', message: interrupted ? 'WorkBuddy stopped' : 'WorkBuddy 连接或协议失败；输入可能已送达，请确认后再重试' }
      run.terminal = true
      await emit(interrupted ? { type: 'turn.completed', ...result } : { type: 'turn.disconnected', message: result.message })
      return result
    }
  }
  private async notification(run: Run, method: string, raw: unknown): Promise<void> {
    if (method !== 'session/update') return
    const value = agentRecord(raw)
    if (value.sessionId !== run.sessionId && run.sessionId) throw new Error('WorkBuddy event belongs to another native Session')
    const update = agentRecord(value.update), kind = update.sessionUpdate
    // Loading native history may replay content; BMW already owns visible history.
    if (!run.released || !run.emit) return
    if (run.terminal || run.error) throw new Error('WorkBuddy emitted work after completion/failure')
    if (kind === 'agent_message_chunk') {
      const content = agentRecord(update.content)
      if (content.type !== 'text') throw new Error('Unsupported WorkBuddy message content')
      const text = agentText(content.text, 2 * 1024 * 1024)
      run.text = agentText(run.text + text, 2 * 1024 * 1024)
      await run.emit({ type: 'message.delta', messageId: run.request.runId + ':assistant', text })
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      const name = workbuddyUpdateToolName(update)
      if (name && !workbuddyAdmitsTool(update)) throw new Error('WorkBuddy emitted a foreign tool')
      if (update.toolCallId === '' || update.toolCallId === undefined) { if (kind === 'tool_call') throw new Error('WorkBuddy tool identity is missing'); return }
      const id = agentIdentifier(update.toolCallId), seen = run.tools.has(id), status = update.status
      if (!seen) {
        if (!name) { if (kind === 'tool_call' || status === 'completed' || status === 'failed') throw new Error('WorkBuddy announced an unknown tool'); return }
        run.tools.set(id, true)
        const input = update.rawInput && typeof update.rawInput === 'object' ? update.rawInput as Record<string, unknown> : {}
        await run.emit({ type: 'tool.started', callId: run.request.runId + ':' + id, name: 'browser', action: typeof input.action === 'string' ? agentText(input.action, 200) : 'browser' })
      } else if (run.tools.get(id) === false) throw new Error('WorkBuddy reused a completed tool id')
      if (status === 'completed' || status === 'failed') {
        run.tools.set(id, false)
        await run.emit({ type: 'tool.completed', callId: run.request.runId + ':' + id, success: status === 'completed', message: status === 'completed' ? '' : 'BMW browser action failed' })
      } else if (status !== undefined && !['pending', 'in_progress'].includes(String(status))) throw new Error('Invalid WorkBuddy tool status')
    }
  }
  private clientRequest(run: Run, method: string, raw: unknown): unknown {
    if (!run.released || !workbuddyAdmitsClientRequest(method, raw)) throw new Error('WorkBuddy requested an unadmitted capability')
    const value = agentRecord(raw)
    if (value.sessionId !== run.sessionId) throw new Error('WorkBuddy permission belongs to another native Session')
    if (run.stopping || run.terminal || run.error || run.signal.aborted) return { outcome: { outcome: 'cancelled' } }
    const choices = Array.isArray(value.options) ? value.options.map(option => agentRecord(option)) : []
    const allow = choices.find(option => option.kind === 'allow_once')
    if (!allow || typeof allow.optionId !== 'string') throw new Error('WorkBuddy has no single-use browser permission')
    return { outcome: { outcome: 'selected', optionId: agentIdentifier(allow.optionId) } }
  }
  private fail(run: Run, error: Error): void { run.error ??= error; run.reject(error) }
  private member(sessionId: string, runId: string): Run {
    const run = this.runs.get(runId)
    if (!run || run.request.sessionId !== sessionId) throw new Error('WorkBuddy run does not belong to this BMW Session')
    return run
  }
  private async stop(run: Run): Promise<void> {
    run.stopping = true
    if (!run.acp) return
    if (!run.released) { await this.closeTransport(run); return }
    try { run.acp.notify('session/cancel', { sessionId: run.sessionId }) } catch (error: unknown) { this.fail(run, errorValue(error)) }
    if (!run.cancelTimer) run.cancelTimer = setTimeout(() => { void this.closeTransport(run).then(() => this.fail(run, new Error('WorkBuddy cancellation closed transport')), error => this.fail(run, errorValue(error))) }, this.options.cancellationTimeoutMs ?? 10000)
  }
  async interrupt(sessionId: string, runId: string): Promise<void> {
    if (!this.runs.has(runId)) return
    const run = this.member(sessionId, runId); run.controller.abort(); await this.stop(run)
  }
  async respond(): Promise<void> { throw new Error('WorkBuddy uses BMW browser permission controls') }
  async drain(sessionId: string, runId: string): Promise<void> {
    if (!this.runs.has(runId)) return
    const run = this.member(sessionId, runId)
    run.controller.abort(); await run.prepared.catch(() => {})
    await this.release(run, true)
    await run.running
  }
  private async closeTransport(run: Run, recover = false): Promise<void> {
    if (run.transportClosing) return run.transportClosing
    if (run.cleanupError && !recover) throw run.cleanupError
    const work = Promise.resolve().then(() => run.acp?.close())
    run.transportClosing = work
    try { await work; run.cleanupError = null }
    catch (error: unknown) { run.cleanupError = errorValue(error); throw error }
    finally { if (run.transportClosing === work) run.transportClosing = null }
  }
  private async release(run: Run, recover = false): Promise<void> {
    if (run.cleaning) return run.cleaning
    if (run.cleanupError && !recover) throw run.cleanupError
    const work = (async () => {
      if (run.gateFailure) { if (!recover) throw run.gateFailure; await run.gateFailure.recover(); run.gateFailure = undefined }
      await this.closeTransport(run, recover)
      await run.tail.catch(() => {})
      if (run.home && run.released && run.sessionId) this.persist(run)
      if (run.temporary) fs.rmSync(run.temporary, { recursive: true, force: true })
      run.terminal = true; run.unsubscribe(); run.signal.removeEventListener('abort', run.abort)
      if (run.cancelTimer) clearTimeout(run.cancelTimer)
      this.runs.delete(run.request.runId)
    })()
    run.cleaning = work
    try { await work } catch (error: unknown) { run.cleanupError = errorValue(error); throw error } finally { if (run.cleaning === work) run.cleaning = null }
  }
  private resume(request: AgentRunRequest): WorkbuddyCatalogOptions['resume'] {
    if (!request.externalSessionId) return undefined
    if (!/^[a-zA-Z0-9-]+$/.test(request.externalSessionId)) throw new Error('Invalid WorkBuddy native Session id')
    const mapping = agentRecord(JSON.parse(fs.readFileSync(path.join(this.options.configDirectory, 'sessions', request.externalSessionId + '.json'), 'utf8')))
    if (mapping.sessionId !== request.sessionId || mapping.projectId !== request.project.id || mapping.directory !== request.project.directory || typeof mapping.relativeHistoryPath !== 'string' || !/^\.codebuddy\/projects\/[^/]+\/[a-zA-Z0-9-]+\.jsonl$/.test(mapping.relativeHistoryPath) || !mapping.relativeHistoryPath.endsWith('/' + request.externalSessionId + '.jsonl')) throw new Error('WorkBuddy native history belongs to another BMW Session/Project')
    return { sessionId: request.externalSessionId, historyFile: path.join(this.options.configDirectory, 'home', mapping.relativeHistoryPath), relativeHistoryPath: mapping.relativeHistoryPath }
  }
  private persist(run: Run): void {
    const base = path.join(run.home!, '.codebuddy', 'projects')
    const candidates = fs.existsSync(base) ? fs.readdirSync(base, { withFileTypes: true }).filter(row => row.isDirectory()).map(row => path.join(base, row.name, run.sessionId + '.jsonl')).filter(file => fs.existsSync(file)) : []
    // A transport failure may happen before the CLI writes a history. Keep the immutable
    // binding; never invent a replacement provider Session or automatically replay input.
    if (!candidates.length) return
    if (candidates.length !== 1) throw new Error('Ambiguous WorkBuddy native history')
    const relativeHistoryPath = path.relative(run.home!, candidates[0])
    const destination = path.join(this.options.configDirectory, 'home', relativeHistoryPath)
    copyWorkbuddyResume(path.join(this.options.configDirectory, 'home'), { sessionId: run.sessionId, historyFile: candidates[0], relativeHistoryPath })
    fs.chmodSync(destination, 0o600)
    const mappings = path.join(this.options.configDirectory, 'sessions'); fs.mkdirSync(mappings, { recursive: true, mode: 0o700 })
    const target = path.join(mappings, run.sessionId + '.json'), temporary = target + '.' + crypto.randomUUID() + '.tmp'
    try { fs.writeFileSync(temporary, JSON.stringify({ sessionId: run.request.sessionId, projectId: run.request.project.id, directory: run.request.project.directory, relativeHistoryPath }), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, target) }
    finally { fs.rmSync(temporary, { force: true }) }
  }
  async settings(request: AgentSettingsRequest, context: AgentSettingsContext): Promise<AgentDriverSettings> {
    if (this.closed || this.runs.size || !this.settingsPort) throw new Error('WorkBuddy settings are unavailable during native work/cleanup')
    return this.settingsPort.execute(request, context)
  }
  async drainSettings(): Promise<void> { await this.settingsPort?.drain() }
  async close(): Promise<void> {
    this.closed = true
    for (const run of [...this.runs.values()]) await this.drain(run.request.sessionId, run.request.runId)
    await this.drainSettings()
  }
}
