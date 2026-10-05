import {parseAgentLegacySession} from '@bmw-agent/agent-contract'
import type {AgentBackend,AgentLegacySession,AgentProject,AssistantLegacyImportState} from '@bmw-agent/agent-contract'
import type {AgentHost} from './agent-host.js'
import type {ConversationStore} from './conversation-store.js'
import type {AgentHistoryStore} from './agent-history-store.js'

export interface LegacyConversationMigrationOptions {
  host:AgentHost
  conversations:ConversationStore
  history:AgentHistoryStore
  backends:readonly AgentBackend[]
  projects(driverId:string):AgentProject[]
  onState():void
}
/** A restart can finish an imported history/index pair without replaying any input. */
export class LegacyConversationMigration {
  private readonly states=new Map<string,AssistantLegacyImportState>()
  private readonly cancellation=new AbortController()
  private task:Promise<void>|undefined
  private retryTask:Promise<void>|undefined
  constructor(private readonly options:LegacyConversationMigrationOptions){
    for(const backend of options.backends)if(backend.readLegacySessions){
      if(!backend.drainLegacy)throw new Error('Legacy discovery requires actual native cleanup')
      this.states.set(backend.description.id,{driverId:backend.description.id,state:'pending',message:''})
    }
  }
  snapshot():AssistantLegacyImportState[]{return structuredClone([...this.states.values()])}
  private state(driverId:string,state:AssistantLegacyImportState['state'],message=''):void {
    this.states.set(driverId,{driverId,state,message:message.slice(0,16384)});this.options.onState()
  }
  start():Promise<void>{
    this.task??=(async()=>{for(const driverId of this.states.keys()){if(this.cancellation.signal.aborted)break;await this.import(driverId).catch(()=>{})}})()
    return this.task
  }
  async retry(driverId:string):Promise<void>{
    if(!this.states.has(driverId))throw new Error('This driver has no legacy migration')
    if(this.states.get(driverId)?.state==='running')throw new Error('Legacy migration is already running')
    if(this.options.host.busy)throw new Error('Finish native cleanup before retrying legacy migration')
    const work=this.import(driverId);this.retryTask=work
    try{await work}finally{if(this.retryTask===work)this.retryTask=undefined}
  }
  private async import(driverId:string):Promise<void>{
    this.cancellation.signal.throwIfAborted()
    const backend=this.options.backends.find(row=>row.description.id===driverId)!,projects=this.options.projects(driverId)
    const {host,conversations,history}=this.options
    this.state(driverId,'running')
    try{
      await host.maintain(async()=>{
        // Preserve known owners even when native auth/history is temporarily unavailable.
        for(const project of projects)if(project.sessionId){
          const row=conversations.importLegacy(project.id,driverId,project.sessionId,'待恢复的会话',0)
          if(row.sessionId===row.externalSessionId&&!history.snapshot(row.sessionId).legacyImport)conversations.markLegacyPending(row.sessionId)
          if(!conversations.selected(project.id,driverId)&&row.archivedAt===null)conversations.select(row.sessionId,project.id)
        }
        const sources=(await backend.readLegacySessions!(projects,this.cancellation.signal)).map(parseAgentLegacySession)
        const ids=new Set<string>(),existing=conversations.all()
        for(const source of sources){
          if(ids.has(source.externalSessionId)||!projects.some(project=>project.id===source.projectId))throw new Error('Invalid legacy Project/Session membership')
          ids.add(source.externalSessionId)
          const bound=existing.find(row=>row.driverId===driverId&&row.externalSessionId===source.externalSessionId)
          if(bound&&bound.projectId!==source.projectId)throw new Error('Legacy Session belongs to another BMW Project')
          const collision=existing.find(row=>row.sessionId===source.externalSessionId)
          if(collision&&(collision.driverId!==driverId||collision.externalSessionId!==source.externalSessionId))throw new Error('Legacy Session identity conflicts with BMW history')
        }
        for(const project of projects)if(project.sessionId&&!ids.has(project.sessionId))throw new Error('Saved legacy Session was not returned by its official driver')
        const imported:AgentLegacySession[]=[]
        for(const source of sources){
          const row=conversations.importLegacy(source.projectId,driverId,source.externalSessionId,source.title,source.createdAt)
          if(row.sessionId!==source.externalSessionId)continue // Already owned by a new BMW Session.
          if(history.snapshot(row.sessionId).legacyImport&&!row.legacyImportPending)continue
          conversations.markLegacyPending(row.sessionId);imported.push(source)
        }
        // All identities exist before parent links are admitted.
        for(const source of imported)history.importLegacy(driverId,source)
        for(const source of imported)conversations.completeLegacy(driverId,history.legacySource(source.externalSessionId)!)
      },()=>backend.drainLegacy!())
      this.state(driverId,'complete')
    }catch(error:unknown){
      this.state(driverId,'failed',error instanceof Error?error.message:String(error));throw error
    }
  }
  async close():Promise<void>{this.cancellation.abort();await Promise.all([this.task,this.retryTask?.catch(()=>{})])}
}
