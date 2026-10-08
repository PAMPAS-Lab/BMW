import crypto from 'node:crypto'
import { agentIdentifier, agentText, parseAgentCapabilities, parseAgentDriverEvent } from '@bmw-agent/agent-contract'
import type { AgentBackend, AgentConversation, AgentDriverDescription, AgentDriverEvent, AgentEvent, AgentRunRequest, AgentRunResult } from '@bmw-agent/agent-contract'
import { ConversationStore } from './conversation-store.js'
import { AgentHistoryStore } from './agent-history-store.js'

export interface AgentHostProject { id: string; name: string; directory: string }
export interface AgentHostOptions {
  conversations: ConversationStore
  history: AgentHistoryStore
  backends: readonly AgentBackend[]
  currentProject(): AgentHostProject
  context(sessionId: string, projectId: string): Promise<string>
  /** Revoke the run's tool binding and await its actual browser work, including cancellation. */
  drain(request: AgentRunRequest): Promise<void>
  /** Invalidate display cache only; never refresh or replay a failed native task. */
  onSettingsInvalidated?(driverId:string):void
}
interface PendingRun {
  request: AgentRunRequest
  backend: AgentBackend
  frozenContext?:string
  controller: AbortController
  settled: Promise<AgentRunResult>
  resolve: (result: AgentRunResult) => void
  reject: (error: unknown) => void
}
/** Coordinates submissions and resources. It never implements a model/Agent loop. */
export class AgentHost {
  private readonly backends = new Map<string, AgentBackend>()
  private readonly pending = new Map<string, PendingRun>()
  private readonly listeners = new Set<(value: { sessionId: string; event?: AgentEvent }) => void>()
  private tail: Promise<void> = Promise.resolve()
  private active: PendingRun | null = null
  private quarantined: PendingRun | null = null
  private readonly completed = new Map<string, Promise<AgentRunResult>>()
  private closed = false
  private maintenance:{cleanup:()=>Promise<void>;quarantined:boolean;settled:Promise<void>}|null=null
  constructor(private readonly options: AgentHostOptions) {
    for (const sessionId of options.conversations.recoveredSessionIds) options.history.recoverInterrupted(sessionId)
    for (const backend of options.backends) {
      const description = backend.description
      if (!/^[a-z0-9-]{1,64}$/u.test(description.id) || this.backends.has(description.id)) throw new Error('Invalid or duplicate Agent backend')
      agentText(description.label, 200); agentText(description.baseline, 200); parseAgentCapabilities(description.capabilities)
      this.backends.set(description.id, backend)
    }
  }
  get busy(): boolean { return this.pending.size > 0||this.maintenance!==null }
  get activeRunId(): string | null { return this.active?.request.runId ?? null }
  get resourcesDisconnected(): boolean { return this.quarantined!==null||this.maintenance?.quarantined===true }
  /** Migration/configuration owns the same resource exclusion as a user turn. */
  async maintain<T>(operation:()=>Promise<T>,cleanup:()=>Promise<void>):Promise<T>{
    if(this.closed||this.busy)throw new Error('BMW Agent resources are busy or closed')
    const held={cleanup,quarantined:false,settled:Promise.resolve()}
    this.maintenance=held;this.publish('maintenance')
    const work=(async()=>{
      let result:T,failure:unknown,failed=false
      try{result=await operation()}catch(error:unknown){failure=error;failed=true}
      try{await cleanup()}catch(error:unknown){held.quarantined=true;this.publish('maintenance');throw error}
      this.maintenance=null;this.publish('maintenance')
      if(failed)throw failure
      return result!
    })()
    held.settled=work.then(()=>{},()=>{})
    return work
  }
  descriptions(): AgentDriverDescription[] { return structuredClone([...this.backends.values()].map(row => row.description)) }
  subscribe(listener: (value: { sessionId: string; event?: AgentEvent }) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener)
  }
  private publish(sessionId: string, event?: AgentEvent): void {
    for (const listener of this.listeners) { try { listener(structuredClone({ sessionId, event })) } catch { /* A closed view cannot undo a persisted event. */ } }
  }
  private backend(driverId: string): AgentBackend {
    const value = this.backends.get(driverId)
    if (!value) throw new Error('This Agent driver is not installed')
    return value
  }
  private member(sessionId: string): AgentConversation {
    const row = this.options.conversations.get(sessionId, this.options.currentProject().id)
    if (row.archivedAt !== null) throw new Error('This BMW Session is archived')
    return row
  }
  create(driverId: string, title?: string): AgentConversation {
    if (this.closed) throw new Error('BMW Agent host has closed')
    if(this.maintenance)throw new Error('BMW Agent resources are completing maintenance')
    this.backend(driverId)
    const row = this.options.conversations.create(this.options.currentProject().id, driverId, title)
    this.publish(row.sessionId)
    return row
  }
  activeContext(sessionId:string,projectId:string):string|null{const request=this.active?.request;return request?.sessionId===sessionId&&request.project.id===projectId&&request.context?request.context:null}
  enqueue(sessionId: string, text: string, frozenContext?:string): { runId: string; messageId: string } {
    if (this.closed) throw new Error('BMW Agent host has closed')
    if(this.maintenance)throw new Error('BMW Agent resources are completing maintenance')
    if (this.quarantined) throw new Error('BMW Agent resources are disconnected; drain recovery must finish before sending')
    agentText(text, 65536)
    if(frozenContext!==undefined)agentText(frozenContext,16384,'BMW frozen context')
    if (!text.trim()) throw new Error('Enter a message before sending')
    const row = this.member(sessionId), project = this.options.currentProject()
    if (row.externalSessionId === null && this.options.history.snapshot(sessionId).receipts.some(receipt => receipt.state === 'unknown')) throw new Error('An uncertain submission has no provider resume anchor; create an explicit new BMW Session')
    const backend = this.backend(row.driverId), controller = new AbortController(), runId = crypto.randomUUID(), messageId = crypto.randomUUID()
    this.options.history.prepare(sessionId, runId, messageId, text)
    let resolve: PendingRun['resolve'], reject: PendingRun['reject']
    const settled = new Promise<AgentRunResult>((accept, decline) => { resolve = accept; reject = decline })
    // A UI submission may never await the result. Keep failures available to wait().
    void settled.catch(() => {})
    const pending: PendingRun = { request: { sessionId, externalSessionId: row.externalSessionId, runId, messageId, project: structuredClone(project), text, context: '', signal: controller.signal }, backend, frozenContext, controller, settled, resolve: resolve!, reject: reject! }
    this.pending.set(runId, pending)
    if (this.active?.request.sessionId !== sessionId) this.options.conversations.setStatus(sessionId, 'queued')
    this.publish(sessionId)
    const work = this.tail.then(() => this.execute(pending))
    this.tail = work.catch(() => {})
    return { runId, messageId }
  }
  async wait(runId: string): Promise<AgentRunResult> {
    const run = this.pending.get(runId)
    if (run) return run.settled
    const completed = this.completed.get(runId)
    if (completed) return completed
    throw new Error('Agent run is no longer active; read its persisted receipt')
  }
  private async execute(pending: PendingRun): Promise<void> {
    if (!this.pending.has(pending.request.runId)) return // A queued cancellation was already persisted.
    const { request, backend, controller } = pending
    let result: AgentRunResult | undefined, failure: unknown, eventTail = Promise.resolve()
    const tools = new Set<string>(), requested = new Set<string>()
    let terminal: AgentRunResult | undefined, entered = false, eventFailure: unknown
    let acceptingCallbacks=true
    const seenTools = new Set<string>()
    const emit = (raw: AgentDriverEvent): Promise<void> => {
      const write = eventTail.then(() => {
        if(!acceptingCallbacks)throw new Error('Agent callback arrived after the native run settled')
        const event = parseAgentDriverEvent(raw)
        if (event.type === 'turn.disconnected') throw new Error('Only BMW Host may declare an uncertain disconnected run')
        if (terminal) throw new Error('Agent emitted work after its terminal event')
        if (event.type === 'tool.started') {
          if (controller.signal.aborted || seenTools.has(event.callId)) throw new Error('Agent tool started after cancellation or reused its identity')
          tools.add(event.callId); seenTools.add(event.callId)
        }
        if (event.type === 'tool.completed') {
          if (!tools.delete(event.callId)) throw new Error('Agent completed a tool that was not running')
        }
        if (event.type === 'session.bound') this.options.conversations.bind(request.sessionId, event.externalSessionId)
        if (event.type === 'interaction.requested') {
          if (controller.signal.aborted || requested.has(event.interaction.id)) throw new Error('Invalid pending Agent interaction')
          requested.add(event.interaction.id)
          this.options.conversations.setStatus(request.sessionId, event.interaction.kind === 'approval' ? 'waiting-approval' : 'waiting-user')
        }
        if (event.type === 'interaction.resolved') {
          if (!requested.delete(event.interactionId)) throw new Error('Agent resolved an unknown interaction')
          this.options.conversations.setStatus(request.sessionId, controller.signal.aborted ? 'cancelling' : 'running')
        }
        if (event.type === 'turn.completed') {
          if (tools.size || requested.size) throw new Error('Agent cannot finish before its tools and interactions drain')
          // Provider completion is provisional until the bridge has actually drained.
          terminal = { outcome: event.outcome, message: event.message }
          return
        }
        const sequence = this.options.history.snapshot(request.sessionId).events.length + 1
        const envelope: AgentEvent = { sessionId: request.sessionId, runId: request.runId, sequence, createdAt: Date.now(), event }
        this.options.history.append(envelope)
        this.publish(request.sessionId, envelope)
      })
      void write.catch(error => { eventFailure ??= error })
      eventTail = write
      return write
    }
    try {
      if (this.quarantined && this.quarantined !== pending) throw new Error('An earlier Agent run still owns disconnected browser resources')
      this.active = pending
      if (controller.signal.aborted) result = { outcome: 'interrupted', message: 'Queued message cancelled before execution' }
      else {
        const row = this.member(request.sessionId)
        if (row.projectId !== request.project.id || row.driverId !== backend.description.id) throw new Error('Agent Session membership changed before execution')
        request.externalSessionId = row.externalSessionId
        request.context = agentText(pending.frozenContext??await this.options.context(row.sessionId, row.projectId), 16384, 'BMW Project context')
        const ready = await backend.prepare(request)
        if (ready.id !== row.driverId || !parseAgentCapabilities(ready.capabilities).browserOnly) throw new Error('Agent driver has not verified a browser-only tool catalog')
        if (controller.signal.aborted) result = { outcome: 'interrupted', message: 'Message cancelled during driver preparation' }
        else {
          entered = true
          this.options.conversations.setStatus(request.sessionId, 'running'); this.publish(request.sessionId)
          result = await backend.run(request, emit)
          await eventTail
          if (eventFailure) throw eventFailure
          if (!result || !['success', 'interrupted', 'failed'].includes(result.outcome)) throw new Error('Invalid Agent run result')
          agentText(result.message, 16384)
          if(result.outcome==='failed')this.options.onSettingsInvalidated?.(backend.description.id)
          if (terminal && terminal.outcome !== result.outcome) throw new Error('Agent result disagrees with its terminal event')
          if (tools.size || requested.size) throw new Error('Agent returned before its tools or interactions drained')
        }
      }
    } catch (error: unknown) {
      failure = error
      if(!controller.signal.aborted)this.options.onSettingsInvalidated?.(backend.description.id)
      controller.abort()
      if (entered) { try { await backend.interrupt(request.sessionId, request.runId) } catch { /* Resource drain below remains authoritative. */ } }
    }
    try { await eventTail } catch (error: unknown) { failure ??= error }
    acceptingCallbacks=false
    // Even a terminal provider event does not release BMW resources before actual cleanup.
    try { await this.drain(pending) }
    catch (error: unknown) {
      // Retain admission and the active identity until close()/explicit recovery drains it.
      this.quarantined = pending
      this.active = pending
      pending.reject(error)
      try{this.options.history.markUncertain(request.sessionId, request.runId, error instanceof Error ? error.message : 'BMW browser cleanup failed')}catch{/* A storage error must never drop native resource ownership. */}
      try{this.options.conversations.setStatus(request.sessionId, 'disconnected')}catch{/* Recovery remains available from Host state. */}
      this.publish(request.sessionId)
      return
    }
    failure??=eventFailure
    try {
      if (failure && entered) {
        this.options.history.markUncertain(request.sessionId, request.runId, failure instanceof Error ? failure.message : 'Agent connection failed after input submission')
        this.options.conversations.setStatus(request.sessionId, 'disconnected')
        pending.reject(failure)
      } else {
        result ??= { outcome: 'failed', message: failure instanceof Error ? failure.message.slice(0, 16384) : 'Agent driver could not start' }
        // A fresh Host event queue avoids reusing a poisoned provider callback chain.
        const envelope: AgentEvent = { sessionId: request.sessionId, runId: request.runId, sequence: this.options.history.snapshot(request.sessionId).events.length + 1, createdAt: Date.now(), event: { type: 'turn.completed', ...result } }
        this.options.history.append(envelope)
        this.publish(request.sessionId, envelope)
        this.options.conversations.setStatus(request.sessionId, result.outcome === 'success' ? 'idle' : result.outcome === 'interrupted' ? 'interrupted' : 'failed')
        pending.resolve(result)
      }
    } catch (error: unknown) {
      // Cleanup already drained. Preserve storage failure, release no unpersisted success.
      pending.reject(error)
    }
    this.remember(pending)
    this.pending.delete(request.runId)
    if (this.active === pending) this.active = null
    if ([...this.pending.values()].some(run => run.request.sessionId === request.sessionId)) this.options.conversations.setStatus(request.sessionId, 'queued')
    this.publish(request.sessionId)
  }
  private remember(pending: PendingRun): void {
    this.completed.set(pending.request.runId, pending.settled)
    if (this.completed.size > 256) this.completed.delete(this.completed.keys().next().value!)
  }
  private async drain(pending: PendingRun): Promise<void> {
    const results=await Promise.allSettled([Promise.resolve().then(()=>pending.backend.drain?.(pending.request.sessionId,pending.request.runId)),Promise.resolve().then(()=>this.options.drain(pending.request))])
    const failure=results.find((row):row is PromiseRejectedResult=>row.status==='rejected')
    if(failure)throw failure.reason
  }
  /** Retry cleanup only. Recovery never resubmits uncertain user input. */
  async recover(): Promise<void> {
    if(this.maintenance){
      if(!this.maintenance.quarantined)throw new Error('BMW Agent maintenance is still running')
      await this.maintenance.cleanup();this.maintenance=null;this.publish('maintenance')
    }
    const pending = this.quarantined
    if (!pending) return
    await this.drain(pending)
    this.remember(pending)
    this.pending.delete(pending.request.runId)
    this.quarantined = null
    if (this.active === pending) this.active = null
    this.publish(pending.request.sessionId)
  }
  async cancel(sessionId: string): Promise<void> {
    this.member(sessionId)
    const runs = [...this.pending.values()].filter(row => row.request.sessionId === sessionId)
    for (const run of runs) {
      run.controller.abort()
      if (this.active !== run && this.quarantined !== run) {
        const result: AgentRunResult = { outcome: 'interrupted', message: 'Queued message cancelled before execution' }
        const event: AgentEvent = { sessionId, runId: run.request.runId, sequence: this.options.history.snapshot(sessionId).events.length + 1, createdAt: Date.now(), event: { type: 'turn.completed', ...result } }
        this.options.history.append(event); this.publish(sessionId, event)
        run.resolve(result); this.remember(run); this.pending.delete(run.request.runId)
      }
    }
    if (this.active?.request.sessionId === sessionId) {
      this.options.conversations.setStatus(sessionId, 'cancelling'); this.publish(sessionId)
      try { await this.active.backend.interrupt(sessionId, this.active.request.runId) }
      catch { /* AbortSignal and awaited resource drain still own cancellation. */ }
    }
    if (!this.pendingHasSession(sessionId)) { this.options.conversations.setStatus(sessionId, 'interrupted'); this.publish(sessionId) }
    await Promise.all(runs.map(row => row.settled))
  }
  private pendingHasSession(sessionId: string): boolean { return [...this.pending.values()].some(run => run.request.sessionId === sessionId) }
  async respond(sessionId: string, runId: string, interactionId: string, response: string): Promise<void> {
    this.member(sessionId); agentIdentifier(interactionId); agentText(response, 65536)
    const active = this.active
    if (!active || active.request.sessionId !== sessionId || active.request.runId !== runId || active.controller.signal.aborted) throw new Error('Agent interaction is no longer active')
    const interaction = this.options.history.snapshot(sessionId).interactions.find(row => row.id === interactionId)
    if (!interaction) throw new Error('Unknown Agent interaction')
    if (interaction.kind === 'approval' && !interaction.choices.some(row => row.id === response)) throw new Error('Invalid Agent approval choice')
    await active.backend.respond(sessionId, runId, interactionId, response)
  }
  async close(): Promise<void> {
    this.closed = true
    if(this.maintenance)await this.maintenance.settled
    for (const run of this.pending.values()) run.controller.abort()
    const closures = await Promise.allSettled([...this.backends.values()].map(row => row.close()))
    await this.tail
    await this.recover()
    if (this.pending.size) throw new Error('BMW Agent host still owns undrained runs')
    const failed = closures.find((row): row is PromiseRejectedResult => row.status === 'rejected')
    if (failed) throw failed.reason
    this.listeners.clear()
  }
}
