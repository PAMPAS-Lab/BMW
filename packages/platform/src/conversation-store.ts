import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { agentIdentifier, agentRecord, agentText, parseAgentConversation,parseAgentLegacySession } from '@bmw-agent/agent-contract'
import type { AgentConversation, AgentConversationStatus,AgentLegacySession } from '@bmw-agent/agent-contract'
import { readStateFile } from './state-load.js'

interface Selection { projectId: string; driverId: string; sessionId: string }
interface ConversationState { version: 1; revision: number; conversations: AgentConversation[]; selections: Selection[] }
const transient = new Set<AgentConversationStatus>(['queued', 'running', 'waiting-user', 'waiting-approval', 'cancelling'])
function selectionKey(value: Pick<Selection, 'projectId' | 'driverId'>): string { return JSON.stringify([value.projectId, value.driverId]) }
function bindingKey(value: AgentConversation): string { return JSON.stringify([value.driverId, value.externalSessionId]) }
function parseState(raw: unknown): ConversationState {
  const value = agentRecord(raw, 'BMW conversation state')
  if (Object.keys(value).some(key => !['version', 'revision', 'conversations', 'selections'].includes(key))) throw new Error('Unknown conversation state field')
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.conversations) || !Array.isArray(value.selections)) throw new Error('Unsupported conversation state')
  if (value.conversations.length > 100000 || value.selections.length > 100000) throw new Error('Conversation index exceeds its budget')
  const conversations = value.conversations.map(parseAgentConversation), identities = new Set<string>(), bindings = new Set<string>()
  for (const row of conversations) {
    if (identities.has(row.sessionId)) throw new Error('Duplicate BMW Session identity')
    identities.add(row.sessionId)
    if (row.externalSessionId !== null) {
      const binding = bindingKey(row)
      if (bindings.has(binding)) throw new Error('A driver Session is bound to multiple BMW Sessions')
      bindings.add(binding)
    }
  }
  for (const row of conversations) if (row.parentSessionId !== null && !conversations.some(parent => parent.sessionId === row.parentSessionId && parent.projectId === row.projectId && parent.driverId === row.driverId)) throw new Error('Invalid conversation parent membership')
  const keys = new Set<string>()
  const selections = value.selections.map(rawSelection => {
    const row = agentRecord(rawSelection, 'BMW Session selection')
    if (Object.keys(row).some(key => !['projectId', 'driverId', 'sessionId'].includes(key))) throw new Error('Unknown conversation selection field')
    const selection = { projectId: agentIdentifier(row.projectId), driverId: agentIdentifier(row.driverId), sessionId: agentIdentifier(row.sessionId) }
    const key = selectionKey(selection)
    if (keys.has(key) || !conversations.some(item => item.sessionId === selection.sessionId && item.projectId === selection.projectId && item.driverId === selection.driverId && item.archivedAt === null)) throw new Error('Invalid selected Session membership')
    keys.add(key)
    return selection
  })
  return { version: 1, revision: Number(value.revision), conversations, selections }
}

/** Host-owned index. Provider transcripts remain the authority for model resume. */
export class ConversationStore {
  private state: ConversationState
  readonly recoveredSessionIds: readonly string[]
  constructor(private readonly filePath: string, private readonly onChange?: () => void, options: { recoverOnLoad?: boolean } = {}) {
    this.state = readStateFile(filePath, parseState) ?? { version: 1, revision: 0, conversations: [], selections: [] }
    this.recoveredSessionIds = this.state.conversations.filter(row => transient.has(row.status)).map(row => row.sessionId)
    // A crashed connection is never presented as still running or automatically replayed.
    if(options.recoverOnLoad!==false)this.recoverAfterStartup()
  }
  all(): AgentConversation[] { return structuredClone(this.state.conversations) }
  recoverAfterStartup(): void {
    if (this.state.conversations.some(row => transient.has(row.status))) this.commit(next => {
      for (const row of next.conversations) if (transient.has(row.status)) row.status = 'disconnected'
    })
  }
  private commit(change: (state: ConversationState) => void): void {
    const next = structuredClone(this.state)
    change(next)
    next.revision++
    parseState(next)
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const lock = this.filePath + '.lock'
    let handle: number
    try { handle = fs.openSync(lock, 'wx', 0o600) }
    catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('BMW conversation state is being written; retry after the other writer finishes'); throw error }
    const temporary = this.filePath + '.tmp-' + crypto.randomUUID()
    try {
      const current = readStateFile(this.filePath, parseState)
      if ((current?.revision ?? 0) !== this.state.revision) throw new Error('BMW conversation state changed in another writer; reload before saving')
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, this.filePath)
      this.state = next
    } finally {
      fs.closeSync(handle)
      fs.rmSync(temporary, { force: true })
      fs.unlinkSync(lock)
    }
    this.onChange?.()
  }
  list(projectId: string, options: { driverId?: string; includeArchived?: boolean; query?: string } = {}): AgentConversation[] {
    agentIdentifier(projectId)
    const query = (options.query ?? '').toLocaleLowerCase()
    return structuredClone(this.state.conversations.filter(row => row.projectId === projectId && (!options.driverId || row.driverId === options.driverId) && (options.includeArchived || row.archivedAt === null) && (!query || row.title.toLocaleLowerCase().includes(query))))
  }
  get(sessionId: string, projectId?: string): AgentConversation {
    const row = this.state.conversations.find(item => item.sessionId === sessionId && (!projectId || item.projectId === projectId))
    if (!row) throw new Error('BMW Session does not belong to this Project')
    return structuredClone(row)
  }
  selected(projectId: string, driverId: string): string | null {
    return this.state.selections.find(item => item.projectId === projectId && item.driverId === driverId)?.sessionId ?? null
  }
  create(projectId: string, driverId: string, title = '新会话', parentSessionId: string | null = null): AgentConversation {
    if (parentSessionId) {
      const parent = this.get(parentSessionId, projectId)
      if (parent.driverId !== driverId) throw new Error('A conversation branch must keep its driver')
    }
    const now = Date.now()
    const row = parseAgentConversation({ sessionId: crypto.randomUUID(), projectId, driverId, externalSessionId: null, title, createdAt: now, updatedAt: now, archivedAt: null, parentSessionId, status: 'idle' })
    this.commit(next => { next.conversations.push(row); this.selectIn(next, row) })
    return structuredClone(row)
  }
  /** Preserve old DSH IDs so existing Studio ownerSessionId references remain valid. */
  importLegacy(projectId: string, driverId: string, externalSessionId: string, title: string, createdAt: number): AgentConversation {
    const existing = this.state.conversations.find(row => row.driverId === driverId && row.externalSessionId === externalSessionId)
    if (existing) {
      if (existing.projectId !== projectId) throw new Error('Legacy Session belongs to another Project')
      return structuredClone(existing)
    }
    if (this.state.conversations.some(row => row.sessionId === externalSessionId)) throw new Error('Legacy Session identity conflicts with an existing BMW Session')
    const now = Math.max(Date.now(), createdAt)
    const row = parseAgentConversation({ sessionId: externalSessionId, projectId, driverId, externalSessionId, title, createdAt, updatedAt: now, archivedAt: null, parentSessionId: null, status: 'idle',legacyImportPending:true })
    this.commit(next => next.conversations.push(row))
    return structuredClone(row)
  }
  markLegacyPending(sessionId:string):void {
    const row=this.get(sessionId)
    if(row.sessionId!==row.externalSessionId)throw new Error('Only preserved legacy Sessions may be imported')
    if(row.legacyImportPending)return
    this.commit(next=>{next.conversations.find(item=>item.sessionId===sessionId)!.legacyImportPending=true})
  }
  /** Call only after the matching display history has committed successfully. */
  completeLegacy(driverId:string,raw:AgentLegacySession):void {
    const source=parseAgentLegacySession(raw),row=this.get(source.externalSessionId,source.projectId)
    if(row.driverId!==driverId||row.externalSessionId!==source.externalSessionId)throw new Error('Legacy import binding changed')
    if(!row.legacyImportPending)return
    this.commit(next=>{
      const target=next.conversations.find(item=>item.sessionId===row.sessionId)!
      target.title=source.title;target.createdAt=source.createdAt;target.updatedAt=source.updatedAt
      target.archivedAt=source.archived?Math.max(Date.now(),source.updatedAt):null
      const parent=next.conversations.find(item=>item.driverId===driverId&&item.externalSessionId===source.parentExternalSessionId&&item.projectId===source.projectId)
      target.parentSessionId=parent?.sessionId??null
      if(source.parentExternalSessionId)target.externalParentSessionId=source.parentExternalSessionId
      delete target.legacyImportPending
      if(source.archived)next.selections=next.selections.filter(item=>item.sessionId!==target.sessionId)
      else if(source.selected&&!next.selections.some(item=>item.projectId===source.projectId&&item.driverId===driverId))this.selectIn(next,target)
    })
  }
  bind(sessionId: string, externalSessionId: string): void {
    agentIdentifier(externalSessionId)
    const row = this.get(sessionId)
    if (row.externalSessionId === externalSessionId) return
    if (row.externalSessionId !== null) throw new Error('BMW Session cannot change its driver Session binding')
    this.commit(next => { const target = next.conversations.find(item => item.sessionId === sessionId)!; target.externalSessionId = externalSessionId; target.updatedAt = Math.max(Date.now(), target.createdAt) })
  }
  private selectIn(next: ConversationState, row: AgentConversation): void {
    next.selections = next.selections.filter(item => item.projectId !== row.projectId || item.driverId !== row.driverId)
    next.selections.push({ projectId: row.projectId, driverId: row.driverId, sessionId: row.sessionId })
  }
  select(sessionId: string, projectId: string): void {
    const row = this.get(sessionId, projectId)
    if (row.archivedAt !== null) throw new Error('Archived BMW Session cannot be selected')
    this.commit(next => this.selectIn(next, row))
  }
  rename(sessionId: string, projectId: string, title: string): void {
    this.get(sessionId, projectId); agentText(title, 200, 'Agent title')
    this.commit(next => { const row = next.conversations.find(item => item.sessionId === sessionId)!; row.title = title; row.updatedAt = Math.max(Date.now(), row.createdAt) })
  }
  setStatus(sessionId: string, status: AgentConversationStatus): void {
    this.get(sessionId)
    this.commit(next => { const row = next.conversations.find(item => item.sessionId === sessionId)!; row.status = status; row.updatedAt = Math.max(Date.now(), row.createdAt) })
  }
  archive(sessionId: string, projectId: string): void {
    const row = this.get(sessionId, projectId)
    if (transient.has(row.status)) throw new Error('Stop and drain the Agent before archiving its Session')
    this.commit(next => {
      const target = next.conversations.find(item => item.sessionId === sessionId)!
      target.archivedAt = Math.max(Date.now(), target.createdAt); target.updatedAt = target.archivedAt
      next.selections = next.selections.filter(item => item.sessionId !== sessionId)
    })
  }
  move(sessionId: string, projectId: string, beforeSessionId?: string): void {
    const row = this.get(sessionId, projectId)
    if (beforeSessionId) {
      const before = this.get(beforeSessionId, projectId)
      if (before.driverId !== row.driverId || before.archivedAt !== null) throw new Error('Cannot reorder across drivers or archived Sessions')
    }
    if (beforeSessionId === sessionId) return
    this.commit(next => {
      const index = next.conversations.findIndex(item => item.sessionId === sessionId)
      const [item] = next.conversations.splice(index, 1)
      const before = beforeSessionId ? next.conversations.findIndex(candidate => candidate.sessionId === beforeSessionId) : next.conversations.length
      next.conversations.splice(before, 0, item)
    })
  }
}
