/** BMW owns Project and conversation identities; adapters own all native mappings. */
export interface AgentProject { id: string; name: string; directory: string }
export interface AgentSession { sessionId: string; title: string; updatedAt: number; running: boolean; blank: boolean; parentSessionId: string | null; snippet: string; canFork?:boolean }
export interface AgentSessionList { projectId: string; selectedSessionId: string | null; items: AgentSession[]; hasMore: boolean; membership: string[] }
export interface AgentProjectContext { projectId: string; projectName: string; directory: string; sessionId: string; sessionTitle: string; sessionCount: number }
export interface PromptWaitOptions { timeoutMs?: number; pollIntervalMs?: number }
export { parseAgentContextState } from './src/context-sync.js'
export type { AgentContextState } from './src/context-sync.js'
export { agentRecord, agentIdentifier, agentText, parseAgentConversation, parseAgentCapabilities, parseAgentInteraction, parseAgentDriverEvent, parseAgentEvent } from './src/conversation.js'
export type { AgentConversationStatus, AgentConversation, AgentDriverCapabilities, AgentDriverDescription, AgentMessage, AgentInteraction, AgentDriverEvent, AgentEvent, AgentRunRequest, AgentRunResult, AgentBackend } from './src/conversation.js'
export { parseAssistantCommand } from './src/assistant-ui.js'
export type { AssistantState, AssistantCommand, AssistantUiPort, AssistantStudioTarget } from './src/assistant-ui.js'
export {parseAgentSettingsRequest,parseAgentDriverSettings} from './src/driver-settings.js'
export type {AgentModelChoice,AgentLoginMethod,AgentDriverSettings,AgentSettingsRequest,AgentSettingsContext,AssistantSettingsState} from './src/driver-settings.js'
