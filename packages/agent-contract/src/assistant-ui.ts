import { agentIdentifier, agentRecord, agentText } from './conversation.js'
import type { AgentConversation, AgentDriverDescription, AgentEvent, AgentInteraction, AgentMessage } from './conversation.js'
import {parseAgentSettingsRequest} from './driver-settings.js'
import type {AgentSettingsRequest,AssistantSettingsState} from './driver-settings.js'
export interface AssistantState {
  project: { id: string; name: string }
  driverId: string
  drivers: AgentDriverDescription[]
  sessions: AgentConversation[]
  selectedSessionId: string | null
  messages: AgentMessage[]
  events: AgentEvent[]
  interactions: AgentInteraction[]
  activeRunId: string | null
  busy: boolean
  resourcesDisconnected: boolean
  legacyImports?:AssistantLegacyImportState[]
  settings?:AssistantSettingsState
}
export interface AssistantLegacyImportState {driverId:string;state:'pending'|'running'|'complete'|'failed';message:string}
export type AssistantCommand =
  | { action: 'snapshot' }
  | { action: 'driver.select'; driverId: string }
  | { action: 'session.create'; title?: string }
  | { action: 'session.select'; sessionId: string }
  | { action: 'session.rename'; sessionId: string; title: string }
  | { action: 'session.archive'; sessionId: string }
  | { action: 'message.send'; sessionId: string; text: string }
  | { action: 'message.cancel'; sessionId: string }
  | { action: 'interaction.respond'; sessionId: string; runId: string; interactionId: string; response: string }
  | { action: 'resources.recover' }
  | { action: 'legacy.retry';driverId:string }
  | { action:'settings.run';driverId:string;request:AgentSettingsRequest }
  | { action:'settings.cancel' }
export interface AssistantUiPort {
  invoke(command: AssistantCommand): Promise<AssistantState>
  subscribe(listener: (state: AssistantState) => void): () => void
  onComposerContext(listener: (value: unknown) => void): () => void
  composerContext(): Promise<unknown>
  setWorkspaceMode(mode: 'browser' | 'studio'): Promise<unknown>
}
export function parseAssistantCommand(raw: unknown): AssistantCommand {
  const value = agentRecord(raw, 'Assistant command')
  function fields(keys: string[]): void { if (Object.keys(value).some(key => !['action', ...keys].includes(key))) throw new Error('Unknown Assistant command field') }
  switch (value.action) {
    case 'snapshot': case 'resources.recover': case 'settings.cancel': fields([]); return { action: value.action }
    case 'settings.run':fields(['driverId','request']);return {action:value.action,driverId:agentIdentifier(value.driverId),request:parseAgentSettingsRequest(value.request)}
    case 'driver.select': case 'legacy.retry': fields(['driverId']); return { action: value.action, driverId: agentIdentifier(value.driverId) }
    case 'session.create': fields(['title']); return { action: value.action, ...(value.title === undefined ? {} : { title: agentText(value.title, 200) }) }
    case 'session.select': case 'session.archive': case 'message.cancel': fields(['sessionId']); return { action: value.action, sessionId: agentIdentifier(value.sessionId) }
    case 'session.rename': fields(['sessionId', 'title']); return { action: value.action, sessionId: agentIdentifier(value.sessionId), title: agentText(value.title, 200) }
    case 'message.send': fields(['sessionId', 'text']); return { action: value.action, sessionId: agentIdentifier(value.sessionId), text: agentText(value.text, 65536) }
    case 'interaction.respond': fields(['sessionId', 'runId', 'interactionId', 'response']); return { action: value.action, sessionId: agentIdentifier(value.sessionId), runId: agentIdentifier(value.runId), interactionId: agentIdentifier(value.interactionId), response: agentText(value.response, 65536) }
    default: throw new Error('Unknown BMW Assistant command')
  }
}
