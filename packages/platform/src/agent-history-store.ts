import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { agentIdentifier, agentRecord, agentText, parseAgentEvent } from '@bmw-agent/agent-contract'
import type { AgentEvent, AgentMessage, AgentInteraction,AgentConversation } from '@bmw-agent/agent-contract'
import { readStateFile,StateLoadError } from './state-load.js'

export type AgentTimingPhase='queued'|'dispatch'|'context.started'|'context.completed'|'prepare.started'|'prepare.completed'|'runtime.started'|'runtime.returned'|'runtime.failed'|'input.accepted'|'output.started'|'output.completed'|'tool.started'|'tool.completed'|'cleanup.started'|'cleanup.completed'|'cleanup.failed'|'settled'|'cancel.requested'
export interface AgentTimingPoint {phase:AgentTimingPhase;callId?:string;messageId?:string;action?:string;component?:'driver'|'browser';elapsedMs?:number;outsideToolGapMs?:number|null;success?:boolean;outcome?:'success'|'failed'|'interrupted'|'uncertain';modelId?:string|null}

export interface AgentTaskReceipt {kind:'video-review';key:string;payload:string;modelId:string|null}
export function parseAgentTaskReceipt(raw:unknown):AgentTaskReceipt {
 const v=agentRecord(raw)
 if(Object.keys(v).some(k=>!['kind','key','payload','modelId'].includes(k))||v.kind!=='video-review'||typeof v.key!=='string'||!/^[a-f0-9]{64}$/.test(v.key))throw new Error('Invalid internal Agent task receipt')
 return {kind:v.kind,key:v.key,payload:agentText(v.payload,8192),modelId:v.modelId===null?null:agentIdentifier(v.modelId)}
}
export interface CancelledUnknownResolution {kind:'user-cancelled-unknown';resolvedAt:number;previousState:'unknown'}
export interface AgentReceipt { runId: string; messageId: string; providerReceiptId: string | null; state: 'prepared' | 'accepted' | 'finished' | 'unknown'; outcome: 'success' | 'interrupted' | 'failed' | null;task?:AgentTaskReceipt;resolution?:CancelledUnknownResolution }
export interface AgentHistory { version: 2; sessionId: string; revision: number; events: AgentEvent[]; messages: AgentMessage[]; interactions: AgentInteraction[]; receipts: AgentReceipt[]; owner:{projectId:string;driverId:string;externalSessionId:string|null} }
export function parseAgentHistory(raw: unknown, sessionId: string): AgentHistory {
  const value = agentRecord(raw, 'Agent history')
  if (value.version !== 2 || value.sessionId !== sessionId || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.events) || !Array.isArray(value.messages) || !Array.isArray(value.interactions) || !Array.isArray(value.receipts)) throw new Error('Invalid saved Agent history')
  if (Object.keys(value).some(key => !['version', 'sessionId', 'revision', 'events', 'messages', 'interactions', 'receipts','owner'].includes(key))) throw new Error('Unknown Agent history field')
  const ownerRow=agentRecord(value.owner,'history owner')
  if(Object.keys(ownerRow).some(key=>!['projectId','driverId','externalSessionId'].includes(key)))throw new Error('Unknown history owner field')
  const owner={projectId:agentIdentifier(ownerRow.projectId),driverId:agentIdentifier(ownerRow.driverId),externalSessionId:ownerRow.externalSessionId===null?null:agentIdentifier(ownerRow.externalSessionId)}
  const events = value.events.map(parseAgentEvent)
  for (let index = 0; index < events.length; index++) if (events[index].sessionId !== sessionId || events[index].sequence !== index + 1) throw new Error('Invalid Agent history ordering')
  const ids = new Set<string>()
  const messages: AgentMessage[] = value.messages.map(rawMessage => {
    const row = agentRecord(rawMessage)
    const id = agentIdentifier(row.id)
    if (ids.has(id) || (row.role !== 'user' && row.role !== 'assistant') || typeof row.complete !== 'boolean' || !Number.isSafeInteger(row.createdAt) || Number(row.createdAt) < 0 || Object.keys(row).some(key => !['id', 'role', 'text', 'createdAt', 'complete'].includes(key))) throw new Error('Invalid saved Agent message')
    ids.add(id)
    return { id, role: row.role, text: agentText(row.text, 2 * 1024 * 1024), createdAt: Number(row.createdAt), complete: row.complete }
  })
  const runIds = new Set<string>()
  const receipts: AgentReceipt[] = value.receipts.map(rawReceipt => {
    const row = agentRecord(rawReceipt), runId = agentIdentifier(row.runId), messageId = agentIdentifier(row.messageId)
    if (runIds.has(runId) || !messages.some(message => message.id === messageId && message.role === 'user') || !['prepared', 'accepted', 'finished', 'unknown'].includes(String(row.state)) || (row.outcome !== null && row.outcome !== 'success' && row.outcome !== 'failed' && row.outcome !== 'interrupted') || Object.keys(row).some(key => !['runId', 'messageId', 'providerReceiptId', 'state', 'outcome','task','resolution'].includes(key))) throw new Error('Invalid saved Agent receipt')
    runIds.add(runId)
    const receipt: AgentReceipt = { runId, messageId, providerReceiptId: row.providerReceiptId === null ? null : agentIdentifier(row.providerReceiptId), state: row.state as AgentReceipt['state'], outcome: row.outcome as AgentReceipt['outcome'] }
    if(row.task!==undefined)receipt.task=parseAgentTaskReceipt(row.task)
    if(row.resolution!==undefined){
      const resolution=agentRecord(row.resolution,'unknown input resolution')
      if(Object.keys(resolution).some(key=>!['kind','resolvedAt','previousState'].includes(key))||resolution.kind!=='user-cancelled-unknown'||resolution.previousState!=='unknown'||!Number.isSafeInteger(resolution.resolvedAt)||Number(resolution.resolvedAt)<0||receipt.state!=='finished'||receipt.outcome!=='interrupted')throw new Error('Invalid cancelled unknown resolution')
      receipt.resolution={kind:'user-cancelled-unknown',previousState:'unknown',resolvedAt:Number(resolution.resolvedAt)}
    }
    if ((receipt.state === 'finished') !== (receipt.outcome !== null)) throw new Error('Invalid Agent receipt completion')
    return receipt
  })
  for (const event of events) if (!runIds.has(event.runId)) throw new Error('Agent event has no submission receipt')
  // Interactions are projected exclusively from admitted events, never a second authority.
  const interactions: AgentInteraction[] = []
  for (const { event } of events) {
    if (event.type === 'interaction.requested') {
      if (interactions.some(item => item.id === event.interaction.id)) throw new Error('Duplicate pending Agent interaction')
      interactions.push(event.interaction)
    } else if (event.type === 'interaction.resolved') {
      const index = interactions.findIndex(item => item.id === event.interactionId)
      if (index < 0) throw new Error('Resolved Agent interaction was not pending')
      interactions.splice(index, 1)
    } else if (event.type === 'turn.disconnected') {
      interactions.length = 0
    }
  }
  if (JSON.stringify(interactions) !== JSON.stringify(value.interactions)) throw new Error('Invalid saved Agent interaction projection')
  return { version: 2, sessionId, revision: Number(value.revision), events, messages, interactions, receipts,owner }
}
export class AgentHistoryStore {
  private readonly cache = new Map<string, AgentHistory>()
  private readonly timingBootId=crypto.randomUUID()
  private timingFailed=false
  constructor(private readonly directory: string, private readonly conversation:(sessionId:string)=>AgentConversation) {}
  private file(sessionId: string): string {
    agentIdentifier(sessionId)
    return path.join(this.directory, crypto.createHash('sha256').update(sessionId).digest('hex') + '.json')
  }
  private read(sessionId: string): AgentHistory {
    let value = this.cache.get(sessionId)
    if (!value) {
      const row=this.conversation(sessionId)
      value = readStateFile(this.file(sessionId), raw => parseAgentHistory(raw, sessionId)) ?? { version: 2, sessionId, revision: 0, events: [], messages: [], interactions: [], receipts: [],owner:{projectId:row.projectId,driverId:row.driverId,externalSessionId:row.externalSessionId} }
      this.cache.set(sessionId, value)
    }
    return value
  }
  snapshot(sessionId: string): AgentHistory { return structuredClone(this.read(sessionId)) }
  /** Host observation only. No prompts, arguments, response text or credentials.
   * Segments are append-only and retained; logging never changes admission. */
  recordTiming(sessionId:string,runId:string,point:AgentTimingPoint):boolean {
    try{
      agentIdentifier(runId);const history=this.read(sessionId)
      if(!history.receipts.some(r=>r.runId===runId))throw new Error('Timing requires a persisted input receipt')
      const allowed=['phase','callId','messageId','action','component','elapsedMs','outsideToolGapMs','success','outcome','modelId']
      if(Object.keys(point).some(k=>!allowed.includes(k)))throw new Error('Timing accepts metadata only')
      if(!['queued','dispatch','context.started','context.completed','prepare.started','prepare.completed','runtime.started','runtime.returned','runtime.failed','input.accepted','output.started','output.completed','tool.started','tool.completed','cleanup.started','cleanup.completed','cleanup.failed','settled','cancel.requested'].includes(point.phase))throw new Error('Unknown timing phase')
      for(const value of [point.elapsedMs,point.outsideToolGapMs])if(value!==undefined&&value!==null&&(!Number.isFinite(value)||value<0))throw new Error('Invalid timing duration')
      const row={version:1,at:Date.now(),monotonicMs:performance.now(),bootId:this.timingBootId,projectId:history.owner.projectId,sessionId,runId,driverId:history.owner.driverId,...point,...(point.action?{action:/^[a-z][a-z0-9.-]{0,100}$/.test(point.action)?point.action:'unknown'}:{}),measurement:'host-observed; server-inference-and-queue-unavailable'}
      const line=JSON.stringify(row)+'\n';if(Buffer.byteLength(line)>4096)throw new Error('Timing row exceeds budget')
      const directory=path.join(this.directory,'timings');fs.mkdirSync(directory,{recursive:true,mode:0o700})
      if(fs.lstatSync(directory).isSymbolicLink())throw new Error('Timing directory must be local')
      const prefix=crypto.createHash('sha256').update(sessionId+'\0'+runId).digest('hex')+'-'+this.timingBootId
      for(let segment=0;segment<10000;segment++){
        const file=path.join(directory,prefix+'-'+segment+'.jsonl')
        const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600)
        try{const stat=fs.fstatSync(fd);if(!stat.isFile())throw new Error('Timing output must be a regular file');if(stat.size+Buffer.byteLength(line)>8*1024*1024)continue;fs.writeFileSync(fd,line);return true}finally{fs.closeSync(fd)}
      }
      throw new Error('Timing segment budget exceeded')
    }catch{
      if(!this.timingFailed){this.timingFailed=true;console.warn('[BMW timing unavailable] Metadata log could not be saved; input receipts and cleanup remain authoritative.')}
      return false
    }
  }
  validateBinding(row:AgentConversation):void {
    const owner=this.read(row.sessionId).owner
    if(owner.driverId!==row.driverId||owner.projectId!==row.projectId||owner.externalSessionId!==row.externalSessionId)throw new StateLoadError(this.file(row.sessionId),new Error('Display history belongs to another Project or driver binding'))
  }
  private commit(sessionId: string, change: (next: AgentHistory) => void): void {
    const before = this.read(sessionId), next = structuredClone(before)
    change(next); next.revision++
    parseAgentHistory(next, sessionId)
    const body = JSON.stringify(next)
    if (Buffer.byteLength(body) > 64 * 1024 * 1024) throw new Error('BMW Agent history exceeds its storage budget')
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = this.file(sessionId), temporary = file + '.tmp-' + crypto.randomUUID(), lock = file + '.lock'
    const handle = fs.openSync(lock, 'wx', 0o600)
    try {
      const current = readStateFile(file, raw => parseAgentHistory(raw, sessionId))
      if ((current?.revision ?? 0) !== before.revision) throw new Error('Agent history changed in another writer; reload before saving')
      fs.writeFileSync(temporary, body + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file)
      this.cache.set(sessionId, next)
    } finally { fs.closeSync(handle); fs.rmSync(temporary, { force: true }); fs.unlinkSync(lock) }
  }
  prepare(sessionId: string, runId: string, messageId: string, text: string,task?:AgentTaskReceipt): void {
    agentIdentifier(runId); agentIdentifier(messageId); agentText(text, 65536)
    this.commit(sessionId, next => {
      if (next.receipts.some(row => row.runId === runId || row.messageId === messageId) || next.messages.some(row => row.id === messageId)) throw new Error('Agent submission identity has already been used')
      next.messages.push({ id: messageId, role: 'user', text, createdAt: Date.now(), complete: true })
      next.receipts.push({ runId, messageId, providerReceiptId: null, state: 'prepared', outcome: null,...(task?{task:parseAgentTaskReceipt(task)}:{}) })
    })
  }
  append(raw: AgentEvent): void {
    const event = parseAgentEvent(raw)
    this.commit(event.sessionId, next => {
      if (event.sequence !== next.events.length + 1) throw new Error('Agent event is out of order')
      const receipt = next.receipts.find(row => row.runId === event.runId)
      if (!receipt || receipt.state === 'finished') throw new Error('Agent event belongs to an inactive submission')
      const payload = event.event
      if(payload.type==='session.bound'){
        if(next.owner.externalSessionId!==null&&next.owner.externalSessionId!==payload.externalSessionId)throw new Error('History resume anchor cannot be replaced')
        next.owner.externalSessionId=payload.externalSessionId
      }
      if (payload.type === 'input.accepted') {
        if (receipt.providerReceiptId !== null && receipt.providerReceiptId !== payload.receiptId) throw new Error('Agent submission receipt cannot be replaced')
        receipt.providerReceiptId = payload.receiptId; receipt.state = 'accepted'
      }
      if (payload.type === 'message.delta' || payload.type === 'message.completed') {
        let message = next.messages.find(row => row.id === payload.messageId)
        if (message && (message.role !== 'assistant' || message.complete)) throw new Error('Agent message identity was already completed or belongs to the user')
        if (!message) { message = { id: payload.messageId, role: 'assistant', text: '', createdAt: event.createdAt, complete: false }; next.messages.push(message) }
        message.text = payload.type === 'message.delta' ? message.text + payload.text : payload.text
        agentText(message.text, 2 * 1024 * 1024)
        message.complete = payload.type === 'message.completed'
      }
      if (payload.type === 'interaction.requested') next.interactions.push(payload.interaction)
      if (payload.type === 'interaction.resolved') next.interactions = next.interactions.filter(row => row.id !== payload.interactionId)
      if (payload.type === 'turn.completed') { receipt.state = 'finished'; receipt.outcome = payload.outcome }
      if (payload.type === 'turn.disconnected') { receipt.state = 'unknown'; next.interactions = [] }
      next.events.push(event)
    })
  }
  markUncertain(sessionId: string, runId: string, reason?: string): void {
    this.commit(sessionId, next => {
      const receipt = next.receipts.find(row => row.runId === runId)
      if (!receipt) throw new Error('Unknown Agent submission')
      if (receipt.state !== 'finished') {
        receipt.state = 'unknown'
        if (reason) {
          next.events.push(parseAgentEvent({ sessionId, runId, sequence: next.events.length + 1, createdAt: Date.now(), event: { type: 'turn.disconnected', message: reason.slice(0, 16384) } }))
          next.interactions = []
        }
      }
    })
  }
  /** Explicit user disposition, not a provider completion; retain every event/message. */
  resolveCancelledUnknown(sessionId:string,runId:string):void {
    this.commit(sessionId,next=>{
      const receipt=next.receipts.find(row=>row.runId===runId)
      if(!receipt)throw new Error('Unknown Agent submission')
      if(receipt.resolution?.kind==='user-cancelled-unknown')return
      if(receipt.state!=='unknown')throw new Error('Only an uncertain input can be explicitly ended')
      receipt.state='finished';receipt.outcome='interrupted'
      receipt.resolution={kind:'user-cancelled-unknown',previousState:'unknown',resolvedAt:Date.now()}
    })
  }
  recoverInterrupted(sessionId: string): void {
    if (!this.read(sessionId).receipts.some(row => row.state === 'prepared' || row.state === 'accepted')) return
    this.commit(sessionId, next => {
      for (const row of next.receipts) if (row.state === 'prepared' || row.state === 'accepted') {
        row.state = 'unknown'
        next.events.push(parseAgentEvent({sessionId,runId:row.runId,sequence:next.events.length+1,createdAt:Date.now(),event:{type:'turn.disconnected',message:'BMW restarted before this submission completed; its result is unknown and the input will not be replayed.'}}))
        next.interactions=[]
      }
    })
  }
}
