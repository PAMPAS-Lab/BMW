import { pathToFileURL } from 'node:url'
import { agentIdentifier } from '@bmw-agent/agent-contract'
import type { AgentProject, AgentProjectContext, AgentRuntime, AgentSessionList, AgentWorkspace, PromptWaitOptions } from '@bmw-agent/agent-contract'
import type { AgentHost } from './agent-host.js'
import type { AgentHistoryStore } from './agent-history-store.js'
import type { ConversationStore } from './conversation-store.js'

export interface AgentWorkspaceRuntimeOptions {
  host: AgentHost
  conversations: ConversationStore
  history: AgentHistoryStore
  pagePath: string
  getProjects(): AgentProject[]
  getDriver(projectId: string): string
  currentProject(): AgentProject
  initialize?():Promise<void>
  beforeStop?():Promise<void>
}
/** Compatibility for existing Feature/Shell ports, backed by canonical BMW Sessions. */
export class AgentWorkspaceRuntime implements AgentRuntime {
  private started = false
  private initialization:Promise<void>=Promise.resolve()
  constructor(private readonly options: AgentWorkspaceRuntimeOptions) {}
  get running(): boolean { return this.started }
  get url(): string | null { return this.started ? pathToFileURL(this.options.pagePath).href : null }
  async start(): Promise<string> { if(!this.started){this.started = true;this.initialization=this.options.initialize?.()??Promise.resolve();void this.initialization.catch(()=>{})} return this.url! }
  async stop(): Promise<void> { await this.options.beforeStop?.();await this.initialization;await this.options.host.close(); this.started = false }
  private project(project: AgentProject): AgentProject {
    const owned = this.options.getProjects().find(row => row.id === project.id && row.directory === project.directory)
    if (!owned) throw new Error('Agent workspace does not belong to a BMW Project')
    return owned
  }
  async ensureWorkspace(project: AgentProject): Promise<AgentWorkspace> {
    await this.initialization
    const owned = this.project(project)
    return { workspaceId: owned.id, title: owned.name, path: owned.directory, sessionIds: this.options.conversations.list(owned.id).map(row => row.sessionId) }
  }
  async activateWorkspace(project: AgentProject): Promise<{ workspace: AgentWorkspace; sessionId: string }> {
    await this.initialization
    const owned = this.project(project), driverId = this.options.getDriver(owned.id)
    let sessionId = this.options.conversations.selected(owned.id, driverId)
    if (!sessionId) sessionId = this.options.conversations.create(owned.id, driverId).sessionId
    return { workspace: await this.ensureWorkspace(owned), sessionId }
  }
  async listProjectSessions(project: AgentProject, query = ''): Promise<AgentSessionList> {
    await this.initialization
    const owned = this.project(project), all = this.options.conversations.list(owned.id), rows = this.options.conversations.list(owned.id, { query })
    const descriptions = this.options.host.descriptions()
    return { workspaceId: owned.id, selectedSessionId: this.options.conversations.selected(owned.id, this.options.getDriver(owned.id)), membership: all.map(row => row.sessionId), hasMore: false, items: rows.map(row => {
      const saved = this.options.history.snapshot(row.sessionId)
      return { sessionId: row.sessionId, title: (descriptions.find(driver => driver.id === row.driverId)?.label ?? row.driverId) + ' · ' + row.title, updatedAt: row.updatedAt, running: ['queued', 'running', 'waiting-user', 'waiting-approval', 'cancelling'].includes(row.status), blank: saved.messages.length === 0, parentSessionId: row.parentSessionId, snippet: saved.messages.at(-1)?.text.slice(0, 200) ?? '',canFork:false }
    }) }
  }
  async createProjectSession(project: AgentProject): Promise<{ sessionId: string }> {
    const owned = this.project(project)
    if (owned.id !== this.options.currentProject().id) throw new Error('Activate the BMW Project before creating a Session')
    return { sessionId: this.options.host.create(this.options.getDriver(owned.id)).sessionId }
  }
  async renameSession(sessionId: string, title: string): Promise<void> { this.options.conversations.rename(sessionId, this.options.currentProject().id, title) }
  async forkSession(): Promise<{ sessionId: string }> { throw new Error('This Agent driver has not enabled verified native conversation branching') }
  async archiveSession(sessionId: string): Promise<void> { this.options.conversations.archive(sessionId, this.options.currentProject().id) }
  async moveSession(workspaceId: string, sessionId: string, beforeSessionId?: string): Promise<void> {
    if (workspaceId !== this.options.currentProject().id) throw new Error('Foreign Agent workspace')
    this.options.conversations.move(sessionId, workspaceId, beforeSessionId)
  }
  async deleteWorkspace(workspaceId: string): Promise<void> {
    agentIdentifier(workspaceId)
    if (this.options.host.busy) throw new Error('Stop and drain the Agent before archiving a Project')
    for (const row of this.options.conversations.list(workspaceId)) this.options.conversations.archive(row.sessionId, workspaceId)
  }
  async resolveContext(sessionId: string, projects: AgentProject[]): Promise<AgentProjectContext> {
    const row = this.options.conversations.get(sessionId), project = projects.find(project => project.id === row.projectId)
    if (!project || row.archivedAt !== null) throw new Error('Agent selection is not an active BMW Project conversation')
    this.project(project)
    return { projectId: project.id, projectName: project.name, directory: project.directory, workspaceId: project.id, workspaceTitle: project.name, sessionId: row.sessionId, sessionTitle: row.title, sessionCount: this.options.conversations.list(project.id).length }
  }
  async enqueuePrompt(sessionId: string, text: string): Promise<string> { return this.options.host.enqueue(sessionId, text).runId }
  async promptAndWait(sessionId: string, text: string, options: PromptWaitOptions = {}): Promise<string> {
    const submission = this.options.host.enqueue(sessionId, text)
    const timer = setTimeout(() => { void this.options.host.cancel(sessionId).catch(() => {}) }, options.timeoutMs ?? 30 * 60_000)
    try {
      const result = await this.options.host.wait(submission.runId)
      if (result.outcome !== 'success') throw new Error(result.message || 'Agent execution did not finish successfully')
      return this.options.history.snapshot(sessionId).events.filter(row => row.runId === submission.runId).flatMap(row => row.event.type === 'message.completed' ? [row.event.text] : []).join('\n\n')
    } finally { clearTimeout(timer) }
  }
  async cancelSession(sessionId: string): Promise<void> { await this.options.host.cancel(sessionId) }
}
