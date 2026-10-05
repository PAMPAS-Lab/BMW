import fs from 'node:fs'
import path from 'node:path'
import { agentIdentifier, agentRecord, agentText } from '@bmw-agent/agent-contract'
import type { AgentBackend, AgentDriverDescription, AgentDriverEvent, AgentRunRequest, AgentRunResult } from '@bmw-agent/agent-contract'
import { CodexCatalogGate, codexThreadParameters, initializeCodex } from './codex-policy.js'
import type { CodexBrowserDefinition } from './codex-policy.js'
import { createCodexRpc } from './codex-rpc.js'
import type { CodexRpc } from './codex-rpc.js'
import {CodexSettings,codexAccountModels} from './codex-settings.js'
import {findCodexExecutable} from './codex-installation.js'
import {codexNeedsBrowserCatalog} from './codex-model-catalog.js'
import type {AgentSettingsRequest,AgentSettingsContext,AgentDriverSettings} from '@bmw-agent/agent-contract'

export interface CodexBrowserConnection {
  definition: CodexBrowserDefinition
  /** Host pins the BMW lease; no provider/model Session scope is accepted here. */
  execute(argumentsValue: Record<string, unknown>, signal: AbortSignal): Promise<{ result: unknown; images?: { type: 'image'; mimeType: 'image/png'; data: string }[] }>
}
export interface CodexBackendOptions {
  executable?: string
  configDirectory: string
  model?: string
  getModel?():string|null
  setModel?(modelId:string):void
  definition?:CodexBrowserDefinition
  connection(request: AgentRunRequest): Promise<CodexBrowserConnection>
  rpcFactory?: typeof createCodexRpc
  catalogGate?: Pick<CodexCatalogGate, 'verify'>
  cancellationTimeoutMs?: number
}
interface Run {
  request: AgentRunRequest
  rpc: CodexRpc
  connection: CodexBrowserConnection
  threadId: string
  turnId: string | null
  released: boolean
  accepted: Promise<void>
  accept(): void
  emit: ((event: AgentDriverEvent) => Promise<void>) | null
  tail: Promise<void>
  tools: Map<string, Promise<unknown>>
  seenTools: Set<string>
  messages: Map<string, string>
  completedMessages: Set<string>
  done: Promise<AgentRunResult>
  resolve(result: AgentRunResult): void
  reject(error: unknown): void
  stopping: boolean
  interruptSent: boolean
  terminal: boolean
  cancelTimer?: ReturnType<typeof setTimeout>
  unsubscribe(): void
  abort(): void
}
export class CodexBackend implements AgentBackend {
  readonly description: AgentDriverDescription = {
    id: 'codex', label: 'Codex', baseline: 'App Server 0.160.0 / dynamicTools',
    capabilities: { streaming: true, images: true, interrupt: true, steer: false, fork: false, approvals: false, nativeOpen: false, browserOnly: false }
  }
  private readonly runs = new Map<string, Run>()
  private readonly gate: Pick<CodexCatalogGate, 'verify'>
  private closed = false
  private settingsPort:CodexSettings|undefined
  private settingsExecutable:string|undefined
  constructor(private readonly options: CodexBackendOptions) {
    if (!path.isAbsolute(options.configDirectory) || (options.executable!==undefined&&!path.isAbsolute(options.executable))) throw new Error('Codex requires absolute host-owned executable and profile paths')
    if(options.model!==undefined)agentIdentifier(options.model, 'Codex model')
    this.gate = options.catalogGate ?? new CodexCatalogGate()
  }
  async prepare(request: AgentRunRequest): Promise<AgentDriverDescription> {
    if (this.closed || this.runs.size||this.settingsPort?.busy) throw new Error('Codex backend is closed or still owns an active process')
    request.signal.throwIfAborted()
    const executable=this.options.executable??findCodexExecutable()
    if(!executable)throw new Error('未找到 Codex 官方 CLI；请安装 Codex 后打开 Agent 设置')
    fs.mkdirSync(this.options.configDirectory, { recursive: true, mode: 0o700 })
    const model=this.options.getModel?.()??this.options.model
    if(!model)throw new Error('Open Codex settings and select a verified model before sending')
    const connection = await this.options.connection(request)
    const modelCatalogPath=await this.gate.verify(executable, this.options.configDirectory, model, connection.definition, request.signal)
    if(codexNeedsBrowserCatalog(model)&&typeof modelCatalogPath!=='string')throw new Error('Codex GPT-6 browser catalog was not admitted')
    request.signal.throwIfAborted()
    const rpc = (this.options.rpcFactory ?? createCodexRpc)(executable, request.project.directory, this.options.configDirectory,{},typeof modelCatalogPath==='string'?modelCatalogPath:undefined)
    let accept!: () => void, resolve!: Run['resolve'], reject!: Run['reject']
    const accepted = new Promise<void>(yes => { accept = yes })
    const done = new Promise<AgentRunResult>((yes, no) => { resolve = yes; reject = no })
    void done.catch(() => {})
    const run: Run = { request, rpc, connection, threadId: '', turnId: null, released: false, accepted, accept, emit: null, tail: Promise.resolve(), tools: new Map(), seenTools: new Set(), messages: new Map(), completedMessages: new Set(), done, resolve, reject, stopping: false, interruptSent: false, terminal: false, unsubscribe: () => {}, abort: () => {} }
    this.runs.set(request.runId, run)
    run.unsubscribe = rpc.onNotification((method, params) => {
      if (method === 'turn/started' && run.released) {
        try {
          const value = agentRecord(params)
          if (value.threadId !== run.threadId) throw new Error('Codex turn belongs to another provider Session')
          const turnId = agentIdentifier(agentRecord(value.turn).id)
          if (run.turnId && run.turnId !== turnId) throw new Error('Codex started a different turn')
          run.turnId = turnId
        } catch (error: unknown) { run.reject(error) }
      }
      const work = run.tail.then(() => this.notification(run, method, params))
      run.tail = work
      void work.catch(error => run.reject(error))
    })
    rpc.onRequest(async (method, params) => {
      try { return await this.tool(run, method, params) }
      catch (error: unknown) { run.reject(error); throw error }
    })
    rpc.onFailure(error => { if (!run.terminal) run.reject(error) })
    run.abort = () => { void this.stop(run).catch(error => run.reject(error)) }
    request.signal.addEventListener('abort', run.abort, { once: true })
    try {
      await initializeCodex(rpc)
      const catalog=await codexAccountModels(rpc)
      if(catalog.authentication.state!=='ready'||!catalog.models.some(row=>row.id===model))throw new Error('Codex model is unavailable for the signed-in account; open Agent settings')
      request.signal.throwIfAborted()
      const params = codexThreadParameters(request.project.directory, model, connection.definition, agentText(request.context, 16384))
      let started: Record<string, unknown>
      if (request.externalSessionId) {
        // Dynamic tools persist in official rollout metadata. Resume never adopts
        // another provider Session or substitutes a new one after a failure.
        delete params.dynamicTools
        started = agentRecord(await rpc.call('thread/resume', { ...params, threadId: request.externalSessionId }))
      } else started = agentRecord(await rpc.call('thread/start', params))
      run.threadId = agentIdentifier(agentRecord(started.thread).id)
      if (request.externalSessionId && run.threadId !== request.externalSessionId) throw new Error('Codex resumed a different provider Session')
      if (started.model !== model) throw new Error('Codex changed the model after catalog verification')
      request.signal.throwIfAborted()
      return { ...this.description, capabilities: { ...this.description.capabilities, browserOnly: true } }
    } catch (error: unknown) { await this.cleanup(run); throw error }
  }
  async settings(request:AgentSettingsRequest,context:AgentSettingsContext):Promise<AgentDriverSettings>{
    if(this.closed||this.runs.size||this.settingsPort?.busy||!this.options.definition||!this.options.setModel)throw new Error('Codex settings are unavailable while native work is active')
    const executable=this.options.executable??findCodexExecutable()
    if(!executable){if(request.action!=='refresh')throw new Error('Codex 官方 CLI 尚未安装');return {authentication:{state:'unknown',label:'未找到 Codex 官方 CLI；安装后点击刷新'},models:[],selectedModel:this.options.getModel?.()??this.options.model??null,loginMethods:[],canLogout:false}}
    if(!this.settingsPort||this.settingsExecutable!==executable){this.settingsPort=new CodexSettings({executable,configDirectory:this.options.configDirectory,model:()=>this.options.getModel?.()??this.options.model??null,setModel:this.options.setModel,definition:this.options.definition,gate:this.gate,rpcFactory:this.options.rpcFactory});this.settingsExecutable=executable}
    return this.settingsPort.execute(request,context)
  }
  async drainSettings():Promise<void>{await this.settingsPort?.drain()}
  private async notification(run: Run, method: string, raw: unknown): Promise<void> {
    if (!run.released || !run.emit) return
    if (!['item/agentMessage/delta', 'item/started', 'item/completed', 'turn/completed', 'error'].includes(method)) return
    const value = agentRecord(raw, 'Codex notification')
    if (value.threadId !== run.threadId) throw new Error('Codex notification belongs to another provider Session')
    await run.accepted
    const turnId = method === 'turn/completed' ? agentRecord(value.turn).id : value.turnId
    if (turnId && turnId !== run.turnId) throw new Error('Codex notification belongs to another turn')
    if (run.terminal) throw new Error('Codex emitted work after turn completion')
    if (method === 'item/agentMessage/delta') {
      const id = agentIdentifier(value.itemId), text = agentText(value.delta, 2 * 1024 * 1024)
      if (run.completedMessages.has(id)) throw new Error('Codex changed a completed message')
      run.messages.set(id, agentText((run.messages.get(id) ?? '') + text, 2 * 1024 * 1024))
      await run.emit({ type: 'message.delta', messageId: run.request.runId + ':' + id, text })
    } else if (method === 'item/started' || method === 'item/completed') {
      const item = agentRecord(value.item)
      if (['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'imageGeneration', 'collabAgentToolCall'].includes(String(item.type))) throw new Error('Codex emitted a tool outside BMW browser admission')
      if (item.type === 'dynamicToolCall' && item.tool !== 'browser') throw new Error('Codex emitted a foreign dynamic tool')
      if (method === 'item/completed' && item.type === 'agentMessage') {
        const id = agentIdentifier(item.id), text = agentText(item.text, 2 * 1024 * 1024), previous = run.messages.get(id) ?? ''
        if (run.completedMessages.has(id) || !text.startsWith(previous)) throw new Error('Codex completion disagrees with its message stream')
        run.completedMessages.add(id)
        await run.emit({ type: 'message.completed', messageId: run.request.runId + ':' + id, text })
      }
    } else if (method === 'error') {
      if (value.willRetry !== true) throw new Error('Codex runtime failed during the Agent turn')
    } else {
      const turn = agentRecord(value.turn), status = turn.status
      if (!['completed', 'interrupted', 'failed'].includes(String(status))) throw new Error('Invalid Codex terminal status')
      await Promise.all([...run.tools.values()])
      const result: AgentRunResult = { outcome: status === 'completed' ? 'success' : status === 'interrupted' ? 'interrupted' : 'failed', message: status === 'failed' ? 'Codex Agent turn failed' : status === 'interrupted' ? 'Codex stopped' : '' }
      await run.emit({ type: 'turn.completed', ...result })
      run.terminal = true; run.resolve(result)
    }
  }
  private async tool(run: Run, method: string, raw: unknown): Promise<unknown> {
    if (method !== 'item/tool/call' || !run.released || !run.emit || run.stopping || run.terminal || run.request.signal.aborted) throw new Error('Codex request is outside BMW browser admission')
    const value = agentRecord(raw), id = agentIdentifier(value.callId)
    if (value.threadId !== run.threadId || value.turnId !== run.turnId || value.tool !== 'browser' || value.namespace != null || run.seenTools.has(id)) throw new Error('Codex browser request has invalid scope or identity')
    const argumentsValue = agentRecord(value.arguments)
    if (Object.hasOwn(argumentsValue, '__bmwSession')) throw new Error('BMW Session scope is owned by the host')
    run.seenTools.add(id)
    const callId = run.request.runId + ':' + id
    const operation = (async () => {
      await run.accepted
      await run.emit!({ type: 'tool.started', callId, name: 'browser', action: agentText(argumentsValue.action, 200) })
      let success = false, message = ''
      try {
        run.request.signal.throwIfAborted()
        const reply = await run.connection.execute(argumentsValue, run.request.signal)
        run.request.signal.throwIfAborted()
        const contentItems: ({ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string })[] = [{ type: 'inputText', text: agentText(JSON.stringify(reply.result), 2 * 1024 * 1024) }]
        for (const image of reply.images ?? []) {
          if (image.type !== 'image' || image.mimeType !== 'image/png' || image.data.length > 28 * 1024 * 1024 || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(image.data)) throw new Error('Invalid admitted BMW PNG image')
          contentItems.push({ type: 'inputImage', imageUrl: 'data:image/png;base64,' + image.data })
        }
        success = true
        return { success, contentItems }
      } catch (error: unknown) {
        message = error instanceof Error ? error.message.slice(0, 16384) : 'BMW browser action failed'
        return { success: false, contentItems: [{ type: 'inputText', text: message }] }
      } finally { await run.emit!({ type: 'tool.completed', callId, success, message }) }
    })()
    run.tools.set(id, operation)
    try { return await operation } finally { run.tools.delete(id) }
  }
  async run(request: AgentRunRequest, emit: (event: AgentDriverEvent) => Promise<void>): Promise<AgentRunResult> {
    const run = this.member(request.sessionId, request.runId)
    if (run.released) throw new Error('Codex input was already released')
    await emit({ type: 'session.bound', externalSessionId: run.threadId })
    run.emit = emit; run.released = true
    try {
      const started = agentRecord(await run.rpc.call('turn/start', { threadId: run.threadId, input: [{ type: 'text', text: request.text }] }))
      const turnId = agentIdentifier(agentRecord(started.turn).id)
      if (run.turnId && run.turnId !== turnId) throw new Error('Codex input receipt disagrees with the running turn')
      run.turnId = turnId
      await emit({ type: 'input.accepted', receiptId: turnId }); run.accept()
      if (request.signal.aborted) await this.stop(run)
      return await run.done
    } finally { run.accept(); await this.cleanup(run) }
  }
  private member(sessionId: string, runId: string): Run {
    const run = this.runs.get(runId)
    if (!run || run.request.sessionId !== sessionId) throw new Error('Codex run does not belong to this BMW Session')
    return run
  }
  private async stop(run: Run): Promise<void> {
    if (run.terminal) return
    if (!run.stopping) {
      run.stopping = true
      run.cancelTimer = setTimeout(() => { run.reject(new Error('Codex did not acknowledge cancellation')); void run.rpc.close().catch(() => {}) }, this.options.cancellationTimeoutMs ?? 10000)
    }
    if (run.turnId && !run.interruptSent) { run.interruptSent = true; await run.rpc.call('turn/interrupt', { threadId: run.threadId, turnId: run.turnId }) }
    else if (!run.released) await run.rpc.close()
    // If cancellation races turn/start, run() sends the official interrupt once
    // the receipt identifies the turn. No second input is submitted.
  }
  async interrupt(sessionId: string, runId: string): Promise<void> { if (this.runs.has(runId)) await this.stop(this.member(sessionId, runId)) }
  async respond(): Promise<void> { throw new Error('Codex browser-only runtime uses BMW browser permission controls') }
  async drain(sessionId: string, runId: string): Promise<void> { if(this.runs.has(runId))await this.cleanup(this.member(sessionId,runId),false) }
  private async cleanup(run: Run, checkEvents=true): Promise<void> {
    run.request.signal.removeEventListener('abort', run.abort)
    if (run.cancelTimer) clearTimeout(run.cancelTimer)
    run.unsubscribe()
    await run.rpc.close()
    await Promise.allSettled([...run.tools.values()])
    let eventFailure:unknown
    await run.tail.catch(error => {eventFailure=error})
    this.runs.delete(run.request.runId)
    if(checkEvents&&eventFailure)throw eventFailure
  }
  async close(): Promise<void> {
    this.closed = true
    const runs = [...this.runs.values()]
    for (const run of runs) { run.reject(new Error('Codex backend closed')); run.accept() }
    await Promise.all([...runs.map(run => this.cleanup(run)),this.drainSettings()])
  }
}
