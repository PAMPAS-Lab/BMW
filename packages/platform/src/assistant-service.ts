import path from 'node:path'
import { agentRecord, agentText } from '@bmw-agent/agent-contract'
import type { AgentBackend, AgentClient, AgentRunRequest,AgentProject } from '@bmw-agent/agent-contract'
import type { createBridgeServer } from '@bmw-agent/browser-capability/bridge'
import { AgentHost } from './agent-host.js'
import { ConversationStore } from './conversation-store.js'
import { AgentHistoryStore } from './agent-history-store.js'
import { AgentPreferenceStore } from './agent-preference-store.js'
import { AgentWorkspaceRuntime } from './agent-workspace-runtime.js'
import { AssistantController } from './assistant-controller.js'
import type { AgentHostProject } from './agent-host.js'
import {LegacyConversationMigration} from './legacy-conversation-migration.js'
import {AgentSettingsController} from './agent-settings-controller.js'

type BrowserBridge = Awaited<ReturnType<typeof createBridgeServer>>
export interface AssistantStores {conversations:ConversationStore;history:AgentHistoryStore;preferences:AgentPreferenceStore}
export function loadAssistantStores(directory:string,defaultDriverId:string,onState?:()=>void):AssistantStores{
  const conversations=new ConversationStore(path.join(directory,'agent-conversations.json'),onState,{recoverOnLoad:false})
  const history=new AgentHistoryStore(path.join(directory,'agent-history'))
  const preferences=new AgentPreferenceStore(path.join(directory,'agent-preferences.json'),defaultDriverId)
  for(const row of conversations.all()){history.snapshot(row.sessionId);history.validateLegacyBinding(row)}
  for(const sessionId of conversations.recoveredSessionIds)history.recoverInterrupted(sessionId)
  conversations.recoverAfterStartup()
  return {conversations,history,preferences}
}
export interface AgentBridgeConnection {
  bridgeUrl: string
  bridgeToken: string
  binding: string
  nodeExecutable: string
  mcpServerPath: string
  attachProviderSession(externalSessionId: string): void
  definition: { name: 'browser'; description: string; inputSchema: Record<string, unknown> }
  execute(argumentsValue: Record<string, unknown>, signal: AbortSignal): Promise<{ result: unknown; images?: { type: 'image'; mimeType: 'image/png'; data: string }[] }>
}
export interface AgentApplicationAssembly {
  pagePath: string
  preloadPath: string
  client: AgentClient
  defaultDriverId: string
  createBackends(config: { userDataDirectory: string; connection(request: AgentRunRequest): Promise<AgentBridgeConnection>;projects(driverId:string):AgentProject[];legacyConnection:Pick<AgentBridgeConnection,'bridgeUrl'|'bridgeToken'|'mcpServerPath'>;nodeExecutable:string;model(driverId:string):string|null;setModel(driverId:string,modelId:string):void;definition:AgentBridgeConnection['definition'] }): readonly AgentBackend[]
}
export interface AssistantServiceOptions {
  stores?:AssistantStores
  assembly: AgentApplicationAssembly
  userDataDirectory: string
  nodeExecutable: string
  mcpServerPath: string
  definition: AgentBridgeConnection['definition']
  bridge: BrowserBridge
  currentProject(): AgentHostProject
  getProjects(): AgentHostProject[]
  providerProjects?(driverId:string):AgentProject[]
  context(sessionId: string, projectId: string): Promise<string>
  transition(operation: () => Promise<void>): Promise<void>
  onSelection(sessionId: string | null): Promise<void>
  onState(): void
  openExternal?(url:string):Promise<void>
}
/** Shared composition for owned UI and provider-neutral Feature/Shell ports. */
export class AssistantService {
  readonly conversations: ConversationStore
  readonly history: AgentHistoryStore
  readonly preferences: AgentPreferenceStore
  readonly host: AgentHost
  readonly controller: AssistantController
  readonly runtime: AgentWorkspaceRuntime
  readonly migration:LegacyConversationMigration
  readonly settings:AgentSettingsController
  private readonly leases = new Map<string, string>()
  private readonly unsubscribe: () => void
  constructor(private readonly options: AssistantServiceOptions) {
    const stores=options.stores??loadAssistantStores(options.userDataDirectory,options.assembly.defaultDriverId,options.onState)
    this.conversations = stores.conversations
    this.history = stores.history
    this.preferences = stores.preferences
    const projects=(driverId:string)=>options.providerProjects?.(driverId)??options.getProjects()
    const backends=options.assembly.createBackends({userDataDirectory:options.userDataDirectory,connection:request=>this.connection(request),projects,
      legacyConnection:{bridgeUrl:options.bridge.url,bridgeToken:options.bridge.token,mcpServerPath:options.mcpServerPath},nodeExecutable:options.nodeExecutable,model:driverId=>this.preferences.model(driverId),setModel:(driverId,modelId)=>this.preferences.setModel(driverId,modelId),definition:options.definition})
    this.host = new AgentHost({ conversations: this.conversations, history: this.history,backends,
      currentProject: options.currentProject, context: options.context,
      drain: async request => { const binding = this.leases.get(request.runId); if (binding) { await options.bridge.releaseSession(binding); this.leases.delete(request.runId) } }
    })
    this.migration=new LegacyConversationMigration({host:this.host,conversations:this.conversations,history:this.history,backends,projects,onState:options.onState})
    this.settings=new AgentSettingsController({host:this.host,backends,openExternal:options.openExternal??(async()=>{throw new Error('Official login browser is unavailable')}),onState:options.onState})
    this.unsubscribe = this.host.subscribe(options.onState)
    this.controller = new AssistantController({ host: this.host, conversations: this.conversations, history: this.history, currentProject: options.currentProject,
      getDriver: projectId => this.preferences.get(projectId), setDriver: (projectId, driverId) => this.preferences.set(projectId, driverId),
      transition: options.transition, onSelection: options.onSelection,legacyImports:()=>this.migration.snapshot(),retryLegacy:driverId=>this.migration.retry(driverId),settings:this.settings
    })
    this.runtime = new AgentWorkspaceRuntime({ host: this.host, conversations: this.conversations, history: this.history, pagePath: options.assembly.pagePath,
      currentProject: options.currentProject, getProjects: options.getProjects, getDriver: projectId => this.preferences.get(projectId),initialize:()=>this.migration.start(),beforeStop:async()=>{await this.settings.close();await this.migration.close()}
    })
  }
  selected(projectId: string): string | null { return this.conversations.selected(projectId, this.preferences.get(projectId)) }
  driverId(projectId: string): string { return this.preferences.get(projectId) }
  select(sessionId: string, projectId: string): void {
    if (this.host.busy) throw new Error('Stop and drain the Agent before changing conversations')
    const row = this.conversations.get(sessionId, projectId)
    this.preferences.set(projectId, row.driverId); this.conversations.select(sessionId, projectId)
  }
  private async connection(request: AgentRunRequest): Promise<AgentBridgeConnection> {
    if (this.leases.has(request.runId)) throw new Error('Agent run already owns a browser lease')
    const binding = this.options.bridge.registerSession(request.sessionId, request.project.directory)
    this.leases.set(request.runId, binding)
    const bridgeUrl = this.options.bridge.url, bridgeToken = this.options.bridge.token
    return { bridgeUrl, bridgeToken, binding, nodeExecutable: this.options.nodeExecutable, mcpServerPath: this.options.mcpServerPath, definition: this.options.definition,
      attachProviderSession: externalSessionId => { const row=this.conversations.get(request.sessionId,request.project.id);this.options.bridge.attachProviderSession(binding,row.driverId,externalSessionId) },
      execute: async (argumentsValue, signal) => {
        if (Object.hasOwn(argumentsValue, '__bmwSession')) throw new Error('BMW Session scope is owned by the host')
        const response = await fetch(bridgeUrl + '/execute', { method: 'POST', headers: { authorization: 'Bearer ' + bridgeToken, 'content-type': 'application/json' }, body: JSON.stringify({ binding, arguments: argumentsValue }), signal })
        const value = agentRecord(await response.json())
        if (!response.ok || value.ok !== true) throw new Error(typeof value.error === 'string' ? value.error : 'BMW browser request failed')
        const images: { type: 'image'; mimeType: 'image/png'; data: string }[] = []
        if (value.images !== undefined) {
          if (!Array.isArray(value.images) || value.images.length > 24) throw new Error('Invalid admitted BMW image results')
          for (const raw of value.images) {
            const image = agentRecord(raw)
            if (image.type !== 'image' || image.mimeType !== 'image/png') throw new Error('Only Bridge-admitted BMW PNG images may reach the Agent')
            images.push({ type: 'image', mimeType: 'image/png', data: agentText(image.data, 28 * 1024 * 1024) })
          }
        }
        return { result: value.result, ...(images.length ? { images } : {}) }
      }
    }
  }
  async close(): Promise<void> { this.unsubscribe(); await this.runtime.stop() }
}
