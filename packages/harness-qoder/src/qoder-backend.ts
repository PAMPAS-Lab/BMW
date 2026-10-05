import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { query, qodercliAuth } from '@qodercn-ai/qodercn-agent-sdk'
import type { Options, SDKUserMessage } from '@qodercn-ai/qodercn-agent-sdk'
import { agentRecord, agentText } from '@bmw-agent/agent-contract'
import type { AgentBackend, AgentDriverDescription, AgentDriverEvent, AgentRunRequest, AgentRunResult } from '@bmw-agent/agent-contract'
import { QoderEvents, qoderBrowserCatalog } from './qoder-events.js'
import {qoderBmwGuidance} from './bmw-guidance.js'
import {QoderSettings} from './qoder-settings.js'
import type {AgentSettingsRequest,AgentSettingsContext,AgentDriverSettings} from '@bmw-agent/agent-contract'

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  void promise.catch(() => {})
  return { promise, resolve, reject }
}
type QoderQuery = { interrupt(): Promise<unknown>; close(): Promise<void> } & AsyncIterable<unknown>
export interface QoderBackendOptions {
  configDirectory: string
  connection(request: AgentRunRequest): Promise<{ bridgeUrl: string; bridgeToken: string; binding: string; nodeExecutable: string; mcpServerPath: string }>
  queryFactory?: (input: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => QoderQuery
  preparationTimeoutMs?: number
  cancellationTimeoutMs?: number
  getModel?():string|null
  setModel?(modelId:string):void
  settingsConnection?:{bridgeUrl:string;bridgeToken:string;mcpServerPath:string;nodeExecutable:string}
}
interface Run {
  request: AgentRunRequest
  query: QoderQuery
  controller: AbortController
  input: Deferred<SDKUserMessage | null>
  inputEnd: Deferred<void>
  ready: Deferred<string>
  done: Deferred<AgentRunResult>
  events: QoderEvents
  emit: ((event: AgentDriverEvent) => Promise<void>) | null
  released: boolean
  stopping: boolean
  nativeClosed: boolean
  reader: Promise<void>
  cancelTimer?: ReturnType<typeof setTimeout>
}
export class QoderBackend implements AgentBackend {
  readonly description: AgentDriverDescription = {
    id: 'qoder-cn', label: 'Qoder CN', baseline: 'SDK 1.0.50 / Worker 1.1.64',
    capabilities: { streaming: true, images: true, interrupt: true, steer: false, fork: false, approvals: false, nativeOpen: false, browserOnly: false }
  }
  private readonly runs = new Map<string, Run>()
  private closed = false
  private settingsPort:QoderSettings|undefined
  constructor(private readonly options: QoderBackendOptions) {
    if (!path.isAbsolute(options.configDirectory)) throw new Error('Qoder BMW profile must use an absolute host-owned directory')
  }
  async prepare(request: AgentRunRequest): Promise<AgentDriverDescription> {
    if (this.closed || this.runs.size||this.settingsPort?.busy) throw new Error('Qoder backend is closed or still owns an active worker')
    request.signal.throwIfAborted()
    fs.mkdirSync(this.options.configDirectory, { recursive: true, mode: 0o700 })
    const connection = await this.options.connection(request)
    const input = deferred<SDKUserMessage | null>(), inputEnd = deferred<void>(), ready = deferred<string>(), done = deferred<AgentRunResult>(), controller = new AbortController()
    async function* prompt(): AsyncGenerator<SDKUserMessage> { const message = await input.promise; if (message) { yield message; await inputEnd.promise } }
    const runtime = (this.options.queryFactory ?? query)({ prompt: prompt(), options: {
      cwd: request.project.directory, auth: qodercliAuth(), env: { QODERCN_CONFIG_DIR: this.options.configDirectory, ELECTRON_RUN_AS_NODE: '1' },
      ...(this.options.getModel?.()?{model:this.options.getModel()!}:{}),
      ...(request.externalSessionId ? { resume: request.externalSessionId } : { sessionId: crypto.randomUUID() }),
      abortController: controller, tools: [], allowedTools: ['browser'], skills: [], plugins: [], settingSources: [], strictMcpConfig: true,
      mcpServers: { bmw: { type: 'stdio', command: connection.nodeExecutable, args: [connection.mcpServerPath], env: { BMW_BRIDGE_URL: connection.bridgeUrl, BMW_BRIDGE_TOKEN: connection.bridgeToken, BMW_SESSION_BINDING: connection.binding, ELECTRON_RUN_AS_NODE: '1' }, tools: [{ name: 'browser', exposedName: 'browser', permission_policy: 'always_allow', alwaysLoad: true }] } },
      canUseTool: async (name, value) => name === 'browser' ? { behavior: 'allow', updatedInput: value } : { behavior: 'deny', interrupt: true, message: 'BMW permits only its browser model tool' },
      includePartialMessages: true, persistSession: true, permissionMode: 'default',
      systemPrompt: 'You are BMW Assistant.\n'+qoderBmwGuidance()+'\nCurrent BMW Project context:\n'+agentText(request.context,16384),
      controlRequestTimeoutMs: 15000, stderr: () => {}
    } })
    const run: Run = { request, query: runtime, controller, input, inputEnd, ready, done, events: new QoderEvents(request.runId, request.messageId), emit: null, released: false, stopping: false, nativeClosed: false, reader: Promise.resolve() }
    this.runs.set(request.runId, run)
    const abort = () => { void this.stop(run).catch(() => {}) }
    request.signal.addEventListener('abort', abort, { once: true })
    run.reader = this.read(run).finally(() => {
      request.signal.removeEventListener('abort', abort)
      if (run.cancelTimer) clearTimeout(run.cancelTimer)
      if (!run.released && run.stopping && run.nativeClosed) this.runs.delete(request.runId)
    })
    const timeout = setTimeout(() => { ready.reject(new Error('Qoder browser catalog preparation timed out')); controller.abort(); input.resolve(null); inputEnd.resolve() }, this.options.preparationTimeoutMs ?? 30000)
    try {
      await ready.promise
      request.signal.throwIfAborted()
      return { ...this.description, capabilities: { ...this.description.capabilities, browserOnly: true } }
    } catch (error: unknown) {
      controller.abort(); input.resolve(null); inputEnd.resolve(); await runtime.close();run.nativeClosed=true; await run.reader
      this.runs.delete(request.runId)
      throw error
    } finally { clearTimeout(timeout) }
  }
  async settings(request:AgentSettingsRequest,context:AgentSettingsContext):Promise<AgentDriverSettings>{
    if(this.closed||this.runs.size||!this.options.settingsConnection||!this.options.setModel)throw new Error('Qoder settings are unavailable while native work is active')
    this.settingsPort??=new QoderSettings({configDirectory:this.options.configDirectory,connection:this.options.settingsConnection,model:()=>this.options.getModel?.()??null,setModel:this.options.setModel})
    return this.settingsPort.execute(request,context)
  }
  async drainSettings():Promise<void>{await this.settingsPort?.drain()}
  private async read(run: Run): Promise<void> {
    let result: AgentRunResult | null = null, failure: unknown
    try {
      let initialized: string | null = null
      for await (const raw of run.query) {
        const value = agentRecord(raw, 'Qoder message')
        if (value.type === 'system' && value.subtype === 'init') {
          const catalog = qoderBrowserCatalog(value)
          if ((initialized && initialized !== catalog.sessionId) || (run.request.externalSessionId && run.request.externalSessionId !== catalog.sessionId)) throw new Error('Qoder resumed a different provider Session')
          initialized = catalog.sessionId; run.ready.resolve(initialized)
          continue
        }
        if (value.type === 'assistant' || value.type === 'user' || value.type === 'stream_event' || value.type === 'result') {
          if (!run.released || !initialized || !run.emit) throw new Error('Qoder released model work before BMW catalog admission')
          if (value.session_id !== initialized) throw new Error('Qoder event belongs to another provider Session')
          result = await run.events.receive(raw, run.emit)
          if (result) break
        }
      }
      if (!result && !run.stopping) throw new Error('Qoder transport closed before a terminal result')
    } catch (error: unknown) { failure = error; run.ready.reject(error) }
    finally {
      run.input.resolve(null); run.inputEnd.resolve()
      try { await run.query.close();run.nativeClosed=true } catch (error: unknown) { failure ??= error }
    }
    if (run.stopping && run.emit) {
      try { await run.events.interrupted(run.emit); result = { outcome: 'interrupted', message: 'Qoder stopped' }; failure = undefined }
      catch (error: unknown) { failure = error }
    }
    if (failure) run.done.reject(failure)
    else run.done.resolve(result ?? { outcome: 'interrupted', message: 'Qoder preparation cancelled' })
  }
  async run(request: AgentRunRequest, emit: (event: AgentDriverEvent) => Promise<void>): Promise<AgentRunResult> {
    const run = this.member(request.sessionId, request.runId)
    if (run.released) throw new Error('Qoder input was already released')
    await emit({ type: 'session.bound', externalSessionId: await run.ready.promise })
    run.emit = emit; run.released = true
    run.input.resolve({ type: 'user', uuid: request.messageId, session_id: await run.ready.promise, message: { role: 'user', content: request.text }, parent_tool_use_id: null, client_composed: true, priority: 'next' })
    try { return await run.done.promise }
    finally { await run.reader; if(run.nativeClosed)this.runs.delete(request.runId) }
  }
  private member(sessionId: string, runId: string): Run {
    const run = this.runs.get(runId)
    if (!run || run.request.sessionId !== sessionId) throw new Error('Qoder run does not belong to this BMW Session')
    return run
  }
  private async stop(run: Run): Promise<void> {
    if (run.stopping) return
    run.stopping = true
    run.cancelTimer = setTimeout(() => { run.controller.abort(); run.input.resolve(null); run.inputEnd.resolve() }, this.options.cancellationTimeoutMs ?? 10000)
    if (run.released) await run.query.interrupt()
    else { run.ready.reject(new Error('Qoder preparation cancelled')); run.controller.abort(); run.input.resolve(null); run.inputEnd.resolve() }
  }
  async interrupt(sessionId: string, runId: string): Promise<void> { const run = this.runs.get(runId); if (run) { this.member(sessionId, runId); await this.stop(run) } }
  async respond(): Promise<void> { throw new Error('Qoder browser runtime does not expose Agent approval/question tools; browser permissions use BMW controls') }
  async drain(sessionId: string, runId: string): Promise<void> {
    const run=this.runs.get(runId)
    if(!run)return
    this.member(sessionId,runId);run.controller.abort();run.input.resolve(null);run.inputEnd.resolve()
    await run.query.close();run.nativeClosed=true;await run.reader;this.runs.delete(runId)
  }
  async close(): Promise<void> {
    this.closed = true
    const runs = [...this.runs.values()]
    for (const run of runs) { run.stopping = true; run.controller.abort(); run.ready.reject(new Error('Qoder backend closed')); run.input.resolve(null); run.inputEnd.resolve() }
    await Promise.all([...runs.map(async run => { await run.query.close(); await run.reader }),this.drainSettings()])
    this.runs.clear()
  }
}
