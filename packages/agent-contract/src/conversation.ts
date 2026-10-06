/** BMW identities are stable; provider identities are only resume anchors. */
import type {AgentDriverSettings,AgentSettingsRequest,AgentSettingsContext} from './driver-settings.js'
export type AgentConversationStatus = 'idle' | 'queued' | 'running' | 'waiting-user' | 'waiting-approval' | 'cancelling' | 'interrupted' | 'failed' | 'disconnected'
export interface AgentConversation {
  sessionId: string
  projectId: string
  driverId: string
  externalSessionId: string | null
  title: string
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  parentSessionId: string | null
  status: AgentConversationStatus
  /** Native lineage may refer outside the BMW Project; it never grants membership. */
  externalParentSessionId?:string
}
export interface AgentDriverCapabilities {
  streaming: boolean
  images: boolean
  interrupt: boolean
  steer: boolean
  fork: boolean
  approvals: boolean
  nativeOpen: boolean
  /** True only after the adapter verifies its effective runtime tool catalog. */
  browserOnly: boolean
}
export interface AgentDriverDescription {
  id: string
  label: string
  baseline: string
  capabilities: AgentDriverCapabilities
}
export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  complete: boolean
}
export interface AgentInteraction {
  id: string
  kind: 'approval' | 'question'
  message: string
  choices: { id: string; label: string }[]
}
export type AgentDriverEvent =
  | { type: 'session.bound'; externalSessionId: string }
  | { type: 'input.accepted'; receiptId: string }
  | { type: 'message.delta'; messageId: string; text: string }
  | { type: 'message.completed'; messageId: string; text: string }
  | { type: 'tool.started'; callId: string; name: 'browser'; action: string }
  | { type: 'tool.completed'; callId: string; success: boolean; message: string }
  | { type: 'interaction.requested'; interaction: AgentInteraction }
  | { type: 'interaction.resolved'; interactionId: string }
  | { type: 'turn.completed'; outcome: 'success' | 'interrupted' | 'failed'; message: string }
  | { type: 'turn.disconnected'; message: string }
export interface AgentEvent {
  sessionId: string
  runId: string
  sequence: number
  createdAt: number
  event: AgentDriverEvent
}
export interface AgentRunRequest {
  sessionId: string
  externalSessionId: string | null
  runId: string
  messageId: string
  project: { id: string; name: string; directory: string }
  text: string
  context: string
  signal: AbortSignal
}
export interface AgentRunResult { outcome: 'success' | 'interrupted' | 'failed'; message: string }
/** Implementations own their Agent loop. A run resolves only after tools drain. */
export interface AgentBackend {
  readonly description: AgentDriverDescription
  /** Perform authentication/protocol/tool-catalog checks before releasing user input. */
  prepare(request: AgentRunRequest): Promise<AgentDriverDescription>
  run(request: AgentRunRequest, emit: (event: AgentDriverEvent) => Promise<void>): Promise<AgentRunResult>
  interrupt(sessionId: string, runId: string): Promise<void>
  respond(sessionId: string, runId: string, interactionId: string, response: string): Promise<void>
  close(): Promise<void>
  /** Retry per-run native cleanup after a failed transport/close; never resubmit input. */
  drain?(sessionId: string, runId: string): Promise<void>
  /** Official control operations only; never releases model input. */
  settings?(request:AgentSettingsRequest,context:AgentSettingsContext):Promise<AgentDriverSettings>
  /** Actual cleanup, including an interrupted login, retained until successful. */
  drainSettings?():Promise<void>
}

const statuses: readonly string[] = ['idle', 'queued', 'running', 'waiting-user', 'waiting-approval', 'cancelling', 'interrupted', 'failed', 'disconnected']
export function agentRecord(value: unknown, label = 'Agent value'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value as Record<string, unknown>
}
export function agentIdentifier(value: unknown, label = 'Agent identity'): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`Invalid ${label}`)
  return value
}
export function agentText(value: unknown, limit: number, label = 'Agent text'): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`Invalid ${label}`)
  return value
}
function time(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid Agent timestamp')
  return Number(value)
}
function nullableIdentity(value: unknown): string | null { return value === null ? null : agentIdentifier(value) }
function closed(value: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(value).some(key => !fields.includes(key))) throw new Error('Unknown Agent field')
}
export function parseAgentConversation(raw: unknown): AgentConversation {
  const value = agentRecord(raw, 'Agent conversation')
  closed(value, ['sessionId', 'projectId', 'driverId', 'externalSessionId', 'title', 'createdAt', 'updatedAt', 'archivedAt', 'parentSessionId', 'status','externalParentSessionId'])
  if (typeof value.driverId !== 'string' || !/^[a-z0-9-]{1,64}$/u.test(value.driverId)) throw new Error('Invalid Agent driver identity')
  if (typeof value.status !== 'string' || !statuses.includes(value.status)) throw new Error('Invalid Agent conversation status')
  const title = agentText(value.title, 200, 'Agent title')
  if (!title.trim()) throw new Error('Agent title is required')
  const result: AgentConversation = {
    sessionId: agentIdentifier(value.sessionId), projectId: agentIdentifier(value.projectId), driverId: value.driverId,
    externalSessionId: nullableIdentity(value.externalSessionId), title,
    createdAt: time(value.createdAt), updatedAt: time(value.updatedAt), archivedAt: value.archivedAt === null ? null : time(value.archivedAt),
    parentSessionId: nullableIdentity(value.parentSessionId), status: value.status as AgentConversationStatus,
    ...(value.externalParentSessionId===undefined?{}:{externalParentSessionId:agentIdentifier(value.externalParentSessionId)})
  }
  if (result.updatedAt < result.createdAt || (result.archivedAt !== null && result.archivedAt < result.createdAt)) throw new Error('Invalid Agent conversation chronology')
  if (result.parentSessionId === result.sessionId) throw new Error('An Agent conversation cannot be its own parent')
  return result
}
export function parseAgentCapabilities(raw: unknown): AgentDriverCapabilities {
  const value = agentRecord(raw, 'Agent capabilities')
  const fields = ['streaming', 'images', 'interrupt', 'steer', 'fork', 'approvals', 'nativeOpen', 'browserOnly'] as const
  closed(value, fields)
  const result = {} as AgentDriverCapabilities
  for (const key of fields) {
    if (typeof value[key] !== 'boolean') throw new Error(`Invalid Agent capability: ${key}`)
    result[key] = value[key]
  }
  return result
}
export function parseAgentInteraction(raw: unknown): AgentInteraction {
  const value = agentRecord(raw, 'Agent interaction')
  closed(value, ['id', 'kind', 'message', 'choices'])
  if (value.kind !== 'approval' && value.kind !== 'question') throw new Error('Invalid Agent interaction kind')
  if (!Array.isArray(value.choices) || value.choices.length < 1 || value.choices.length > 10) throw new Error('Invalid Agent interaction choices')
  const ids = new Set<string>()
  const choices = value.choices.map(rawChoice => {
    const choice = agentRecord(rawChoice, 'Agent choice'); closed(choice, ['id', 'label'])
    const id = agentIdentifier(choice.id)
    if (ids.has(id)) throw new Error('Duplicate Agent interaction choice')
    ids.add(id)
    return { id, label: agentText(choice.label, 200, 'Agent choice label') }
  })
  return { id: agentIdentifier(value.id), kind: value.kind, message: agentText(value.message, 16384), choices }
}
export function parseAgentDriverEvent(raw: unknown): AgentDriverEvent {
  const value = agentRecord(raw, 'Agent driver event')
  switch (value.type) {
    case 'session.bound':
      closed(value, ['type', 'externalSessionId'])
      return { type: value.type, externalSessionId: agentIdentifier(value.externalSessionId) }
    case 'input.accepted':
      closed(value, ['type', 'receiptId'])
      return { type: value.type, receiptId: agentIdentifier(value.receiptId) }
    case 'message.delta': case 'message.completed':
      closed(value, ['type', 'messageId', 'text'])
      return { type: value.type, messageId: agentIdentifier(value.messageId), text: agentText(value.text, 2 * 1024 * 1024) }
    case 'tool.started':
      closed(value, ['type', 'callId', 'name', 'action'])
      if (value.name !== 'browser') throw new Error('BMW permits only the browser model tool')
      return { type: value.type, callId: agentIdentifier(value.callId), name: 'browser', action: agentText(value.action, 200) }
    case 'tool.completed':
      closed(value, ['type', 'callId', 'success', 'message'])
      if (typeof value.success !== 'boolean') throw new Error('Invalid Agent tool outcome')
      return { type: value.type, callId: agentIdentifier(value.callId), success: value.success, message: agentText(value.message, 16384) }
    case 'interaction.requested':
      closed(value, ['type', 'interaction'])
      return { type: value.type, interaction: parseAgentInteraction(value.interaction) }
    case 'interaction.resolved':
      closed(value, ['type', 'interactionId'])
      return { type: value.type, interactionId: agentIdentifier(value.interactionId) }
    case 'turn.completed':
      closed(value, ['type', 'outcome', 'message'])
      if (value.outcome !== 'success' && value.outcome !== 'failed' && value.outcome !== 'interrupted') throw new Error('Invalid Agent turn outcome')
      return { type: value.type, outcome: value.outcome, message: agentText(value.message, 16384) }
    case 'turn.disconnected':
      closed(value, ['type', 'message'])
      return { type: value.type, message: agentText(value.message, 16384) }
    default: throw new Error('Unknown Agent driver event')
  }
}
export function parseAgentEvent(raw: unknown): AgentEvent {
  const value = agentRecord(raw, 'Agent event')
  closed(value, ['sessionId', 'runId', 'sequence', 'createdAt', 'event'])
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1) throw new Error('Invalid Agent event sequence')
  return { sessionId: agentIdentifier(value.sessionId), runId: agentIdentifier(value.runId), sequence: Number(value.sequence), createdAt: time(value.createdAt), event: parseAgentDriverEvent(value.event) }
}
