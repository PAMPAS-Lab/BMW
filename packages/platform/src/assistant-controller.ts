import { agentIdentifier, parseAssistantCommand } from '@bmw-agent/agent-contract'
import type { AssistantState, AgentConversation } from '@bmw-agent/agent-contract'
import type { AgentHost } from './agent-host.js'
import type { AgentHistoryStore } from './agent-history-store.js'
import type { ConversationStore } from './conversation-store.js'
import type {AgentSettingsController} from './agent-settings-controller.js'
export interface AssistantControllerOptions {
  host: AgentHost
  history: AgentHistoryStore
  conversations: ConversationStore
  currentProject(): { id: string; name: string }
  getDriver(projectId: string): string
  setDriver(projectId: string, driverId: string): void
  /** Flush Studio, acquire transition exclusion and publish canonical selection. */
  transition(operation: () => Promise<void>): Promise<void>
  onSelection(sessionId: string | null): Promise<void>
  settings?:AgentSettingsController
}
export class AssistantController {
  constructor(private readonly options: AssistantControllerOptions) {}
  snapshot(): AssistantState {
    const { host, conversations, history } = this.options, project = this.options.currentProject(), driverId = this.options.getDriver(project.id)
    const selectedSessionId = conversations.selected(project.id, driverId)
    const saved = selectedSessionId ? history.snapshot(selectedSessionId) : null
    const settings=this.options.settings?.snapshot(driverId)
    const activeRunId = saved?.receipts.find(row => row.runId === host.activeRunId)?.runId ?? null
    return { project, driverId, drivers: host.descriptions(), sessions: conversations.list(project.id), selectedSessionId, messages: saved?.messages ?? [], events: saved?.events ?? [], interactions: activeRunId ? saved!.interactions : [], activeRunId, busy: host.busy, resourcesDisconnected:host.resourcesDisconnected,...(settings?{settings}:{} ) }
  }
  private member(sessionId: string): AgentConversation { return this.options.conversations.get(agentIdentifier(sessionId), this.options.currentProject().id) }
  private async selection(operation: () => Promise<void>): Promise<void> {
    if (this.options.host.busy) throw new Error('Stop and drain the current Agent before changing conversations')
    await this.options.transition(operation)
    await this.options.onSelection(this.snapshot().selectedSessionId)
  }
  async invoke(raw: unknown): Promise<AssistantState> {
    const command = parseAssistantCommand(raw), { host, conversations } = this.options
    switch (command.action) {
      case 'snapshot': break
      case 'settings.run':
        if(!this.options.settings)throw new Error('Agent settings are unavailable')
        this.options.settings.start(command.driverId,command.request);break
      case 'settings.cancel':await this.options.settings?.cancel();break
      case 'driver.select':
        if (!host.descriptions().some(row => row.id === command.driverId)) throw new Error('This Agent driver is not installed')
        await this.selection(async () => {
          const projectId=this.options.currentProject().id
          if(!conversations.selected(projectId,command.driverId)){
            const existing=conversations.list(projectId,{driverId:command.driverId}).at(-1)
            if(existing)conversations.select(existing.sessionId,projectId)
            else host.create(command.driverId)
          }
          this.options.setDriver(projectId, command.driverId)
        }); break
      case 'session.create':
        await this.selection(async () => { host.create(this.options.getDriver(this.options.currentProject().id), command.title) }); break
      case 'session.select': {
        const row = this.member(command.sessionId)
        await this.selection(async () => { conversations.select(row.sessionId, row.projectId); this.options.setDriver(row.projectId, row.driverId) }); break
      }
      case 'session.rename': { const row = this.member(command.sessionId); conversations.rename(row.sessionId, row.projectId, command.title); break }
      case 'session.archive': {
        const row = this.member(command.sessionId)
        await this.selection(async () => {
          conversations.archive(row.sessionId, row.projectId)
          const driverId=this.options.getDriver(row.projectId)
          if(!conversations.selected(row.projectId,driverId)){
            const remaining=conversations.list(row.projectId,{driverId}).at(-1)
            if(remaining)conversations.select(remaining.sessionId,row.projectId)
            else host.create(driverId)
          }
        });break
      }
      case 'message.send': this.member(command.sessionId);if(command.sessionId!==this.snapshot().selectedSessionId)throw new Error('Select the BMW Session before sending its message');host.enqueue(command.sessionId, command.text); break
      case 'message.cancel': this.member(command.sessionId); await host.cancel(command.sessionId); break
      case 'interaction.respond': this.member(command.sessionId); await host.respond(command.sessionId, command.runId, command.interactionId, command.response); break
      case 'resources.recover': await host.recover(); break
    }
    return this.snapshot()
  }
}
