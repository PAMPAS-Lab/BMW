import { agentIdentifier } from '@bmw-agent/agent-contract'
import type { AgentProject, AgentProjectContext, AgentSessionList, PromptWaitOptions } from '@bmw-agent/agent-contract'
import type { AgentHost } from './agent-host.js'
import type { AgentHistoryStore } from './agent-history-store.js'
import type { ConversationStore } from './conversation-store.js'

export interface BmwSessionServiceOptions {
  host: AgentHost
  conversations: ConversationStore
  history: AgentHistoryStore
  getProjects(): AgentProject[]
  getDriver(projectId: string): string
  currentProject(): AgentProject
}
/** Product operations use the BMW index, never a provider's workspace or UI. */
export class BmwSessionService {
  constructor(private readonly options: BmwSessionServiceOptions) {}
  private project(project: AgentProject): AgentProject {
    const owned = this.options.getProjects().find(row => row.id === project.id && row.directory === project.directory)
    if (!owned) throw new Error('Conversation Project does not belong to BMW')
    return owned
  }
  private idle():void {if(this.options.host.busy)throw new Error('Stop and drain the Agent before changing conversations')}
  async activateProject(project: AgentProject): Promise<{sessionId: string}> {
    this.idle()
    const owned = this.project(project), driverId = this.options.getDriver(owned.id)
    let sessionId = this.options.conversations.selected(owned.id, driverId)
    if(owned.id!==this.options.currentProject().id)throw new Error('Activate the Project before selecting a conversation')
    if (!sessionId) sessionId = this.options.host.create(driverId).sessionId
    return {sessionId}
  }
  async listProjectSessions(project: AgentProject, query = ''): Promise<AgentSessionList> {
    const owned = this.project(project), all = this.options.conversations.list(owned.id), rows = this.options.conversations.list(owned.id, {query})
    const descriptions = this.options.host.descriptions()
    return {projectId: owned.id, selectedSessionId: this.options.conversations.selected(owned.id, this.options.getDriver(owned.id)), membership: all.map(row => row.sessionId), hasMore: false, items: rows.map(row => {
      const saved = this.options.history.snapshot(row.sessionId)
      return {sessionId: row.sessionId, title: (descriptions.find(driver => driver.id === row.driverId)?.label ?? row.driverId) + ' · ' + row.title, updatedAt: row.updatedAt, running: ['queued', 'running', 'waiting-user', 'waiting-approval', 'cancelling'].includes(row.status), blank: saved.messages.length === 0, parentSessionId: row.parentSessionId, snippet: saved.messages.at(-1)?.text.slice(0, 200) ?? '', canFork: false}
    })}
  }
  async createProjectSession(project: AgentProject): Promise<{sessionId: string}> {
    const owned = this.project(project)
    if (owned.id !== this.options.currentProject().id) throw new Error('Activate the BMW Project before creating a Session')
    return {sessionId: this.options.host.create(this.options.getDriver(owned.id)).sessionId}
  }
  async renameSession(sessionId: string, title: string): Promise<void> {this.idle();this.options.conversations.rename(sessionId, this.options.currentProject().id, title)}
  async forkSession(): Promise<{sessionId: string}> {throw new Error('Verified conversation branching is not enabled')}
  async archiveSession(sessionId: string): Promise<void> {this.idle();this.options.conversations.archive(sessionId, this.options.currentProject().id)}
  async moveSession(projectId: string, sessionId: string, beforeSessionId?: string): Promise<void> {
    this.idle()
    if (projectId !== this.options.currentProject().id) throw new Error('Foreign BMW Project')
    this.options.conversations.move(sessionId, projectId, beforeSessionId)
  }
  async archiveProject(projectId: string): Promise<void> {
    agentIdentifier(projectId)
    if (this.options.host.busy) throw new Error('Stop and drain the Agent before archiving a Project')
    for (const row of this.options.conversations.list(projectId)) this.options.conversations.archive(row.sessionId, projectId)
  }
  async resolveContext(sessionId: string, projects: AgentProject[]): Promise<AgentProjectContext> {
    const row = this.options.conversations.get(sessionId), project = projects.find(project => project.id === row.projectId)
    if (!project || row.archivedAt !== null) throw new Error('Selection is not an active BMW Project conversation')
    this.project(project)
    return {projectId: project.id, projectName: project.name, directory: project.directory, sessionId: row.sessionId, sessionTitle: row.title, sessionCount: this.options.conversations.list(project.id).length}
  }
  async enqueuePrompt(sessionId: string, text: string): Promise<string> {return this.options.host.enqueue(sessionId, text).runId}
  async promptAndWait(sessionId: string, text: string, options: PromptWaitOptions = {}): Promise<string> {
    const submission = this.options.host.enqueue(sessionId, text)
    const timer = setTimeout(() => {void this.options.host.cancel(sessionId).catch(() => {})}, options.timeoutMs ?? 30 * 60_000)
    try {
      const result = await this.options.host.wait(submission.runId)
      if (result.outcome !== 'success') throw new Error(result.message || 'Agent execution did not finish successfully')
      return this.options.history.snapshot(sessionId).events.filter(row => row.runId === submission.runId).flatMap(row => row.event.type === 'message.completed' ? [row.event.text] : []).join('\n\n')
    } finally {clearTimeout(timer)}
  }
  async cancelSession(sessionId: string): Promise<void> {await this.options.host.cancel(sessionId)}
}
