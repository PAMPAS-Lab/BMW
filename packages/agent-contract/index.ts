/** Agent drivers implement this boundary; BMW owns pages, media and Project transitions. */
export interface AgentBinding { workspaceId: string | null; sessionId: string | null }
export interface AgentProject { id: string; name: string; directory: string; workspaceId?: string | null; sessionId?: string | null }
export interface AgentWorkspace { workspaceId: string; title: string; path: string; sessionIds: string[] }
export interface AgentSession { sessionId: string; title: string; updatedAt: number; running: boolean; blank: boolean; parentSessionId: string | null; snippet: string; canFork?:boolean }
export interface AgentSessionList { workspaceId: string; selectedSessionId: string | null; items: AgentSession[]; hasMore: boolean; membership: string[] }
export interface AgentProjectContext { projectId: string; projectName: string; directory: string; workspaceId: string; workspaceTitle: string; sessionId: string; sessionTitle: string; sessionCount: number }
export interface PromptWaitOptions { timeoutMs?: number; pollIntervalMs?: number }
export interface AgentRuntime {
 readonly running: boolean
 readonly url: string | null
 start(): Promise<string>
 stop(): void | Promise<void>
 ensureWorkspace(project: AgentProject): Promise<AgentWorkspace>
 activateWorkspace(project: AgentProject): Promise<{ workspace: AgentWorkspace; sessionId: string }>
 listProjectSessions(project: AgentProject, query?: string): Promise<AgentSessionList>
 createProjectSession(project: AgentProject): Promise<{ sessionId: string }>
 renameSession(sessionId: string, title: string): Promise<void>
 forkSession(sessionId: string): Promise<{ sessionId: string }>
 archiveSession(sessionId: string): Promise<void>
 moveSession(workspaceId: string, sessionId: string, beforeSessionId?: string): Promise<void>
 deleteWorkspace(workspaceId: string): Promise<void>
 resolveContext(sessionId: string, projects: AgentProject[]): Promise<AgentProjectContext>
 enqueuePrompt(sessionId: string, text: string): Promise<string>
 promptAndWait(sessionId: string, text: string, options?: PromptWaitOptions): Promise<string>
 cancelSession(sessionId: string): Promise<unknown>
}
export interface AgentClientSurface {
 isDestroyed(): boolean
 getURL(): string
 executeJavaScript(code: string): Promise<unknown>
}
export interface AgentClient {
 readSelection(surface: AgentClientSurface, runtimeUrl: string): Promise<string | null>
 selectSession(surface: AgentClientSurface, sessionId: string, reload?: boolean): Promise<void>
 applySidebarPolicy(surface: AgentClientSurface, visible: boolean): Promise<void>
 openSettings(surface: AgentClientSurface): Promise<void>
}
export interface AgentRuntimeConfiguration {
 productId: string; userDataDirectory: string; workspacePath: string; workspaceTitle: string
 mcpServerPath: string; bridgeUrl: string; bridgeToken: string
 onLog(entry: { stream: string; text: string }): void
 onStatus(entry: Record<string, unknown>): void
}
export interface AgentDriver {
 readonly id: string; readonly label: string; readonly baseline: string; readonly preloadPath: string
 readonly client: AgentClient
 createRuntime(config: AgentRuntimeConfiguration): AgentRuntime
 migrateSettings(settings: Record<string, unknown>): Record<string, unknown>
 migrateProjectMetadata(project: Record<string, unknown>): Record<string, unknown>
}
export { AgentSelectionSynchronizer, parseAgentContextState } from './src/context-sync.js'
export type { AgentContextState } from './src/context-sync.js'
export { agentRecord, agentIdentifier, agentText, parseAgentConversation, parseAgentCapabilities, parseAgentInteraction, parseAgentDriverEvent, parseAgentEvent } from './src/conversation.js'
export type { AgentConversationStatus, AgentConversation, AgentDriverCapabilities, AgentDriverDescription, AgentMessage, AgentInteraction, AgentDriverEvent, AgentEvent, AgentRunRequest, AgentRunResult, AgentBackend } from './src/conversation.js'
export { parseAssistantCommand } from './src/assistant-ui.js'
export type { AssistantState, AssistantCommand, AssistantUiPort,AssistantLegacyImportState } from './src/assistant-ui.js'
export {parseAgentLegacySession} from './src/legacy-session.js'
export type {AgentLegacySession} from './src/legacy-session.js'
export {parseAgentSettingsRequest,parseAgentDriverSettings} from './src/driver-settings.js'
export type {AgentModelChoice,AgentLoginMethod,AgentDriverSettings,AgentSettingsRequest,AgentSettingsContext,AssistantSettingsState} from './src/driver-settings.js'
