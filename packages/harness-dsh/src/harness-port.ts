import type { AgentProject, AgentRuntime, AgentSessionList, AgentWorkspace, PromptWaitOptions } from '@bmw-agent/agent-contract'
import { DshRuntime } from './dsh-runtime.js'
import { resolveDshProjectContext } from './dsh-context.js'

export const BMW_DSH_BASELINE = '0.2.0-rc.2'
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid DSH driver response')
 return value as Record<string,unknown>
}
function text(value:unknown):string{
 if(typeof value!=='string'||!value||value.length>4096)throw new Error('Invalid DSH driver identifier')
 return value
}
function identifiers(value:unknown):string[]{
 if(!Array.isArray(value))throw new Error('Invalid DSH driver membership')
 return value.map(text)
}
function workspace(value:unknown):AgentWorkspace{
 const row=object(value)
 return {workspaceId:text(row.workspaceId),title:text(row.title),path:text(row.path),sessionIds:identifiers(row.sessionIds)}
}

/** The platform sees normalized operations, never DSH RPC names or wire values. */
export class DshHarnessPort implements AgentRuntime {
 constructor(private runtime:DshRuntime){}
 get running():boolean{return Boolean(this.runtime.child && this.runtime.authCookie)}
 get url():string|null{return this.runtime.url}
 start():Promise<string>{return this.runtime.start()}
 stop():void{this.runtime.stop()}
 async ensureWorkspace(project:AgentProject):Promise<AgentWorkspace>{return workspace(await this.runtime.ensureWorkspace(project))}
 async activateWorkspace(project:AgentProject):Promise<{workspace:AgentWorkspace;sessionId:string}>{
  const result=object(await this.runtime.activateWorkspace(project))
  return {workspace:workspace(result.workspace),sessionId:text(result.sessionId)}
 }
 async listProjectSessions(project:AgentProject,query=''):Promise<AgentSessionList>{
  const result=object(await this.runtime.listProjectSessions(project,query))
  if(!Array.isArray(result.items))throw new Error('Invalid DSH driver sessions')
  return {workspaceId:text(result.workspaceId),selectedSessionId:result.selectedSessionId==null?null:text(result.selectedSessionId),hasMore:result.hasMore===true,membership:identifiers(result.membership),
   items:result.items.map(value=>{
    const row=object(value)
    if(typeof row.updatedAt!=='number'||!Number.isFinite(row.updatedAt))throw new Error('Invalid DSH session timestamp')
    return {sessionId:text(row.sessionId),title:text(row.title),updatedAt:row.updatedAt,running:row.running===true,blank:row.blank===true,
     parentSessionId:row.parentSessionId==null?null:text(row.parentSessionId),snippet:typeof row.snippet==='string'?row.snippet:''}
   })}
 }
 async createProjectSession(project:AgentProject):Promise<{sessionId:string}>{return {sessionId:text(object(await this.runtime.createProjectSession(project)).sessionId)}}
 async renameSession(sessionId:string,title:string):Promise<void>{await this.runtime.call('session.rename',{sessionId,title})}
 async forkSession(sessionId:string):Promise<{sessionId:string}>{return {sessionId:text(object(await this.runtime.call('session.fork',{sessionId})).sessionId)}}
 async archiveSession(sessionId:string):Promise<void>{await this.runtime.call('workspace.archiveSession',{sessionId})}
 async moveSession(workspaceId:string,sessionId:string,beforeSessionId?:string):Promise<void>{await this.runtime.call('workspace.insertSessionBefore',{workspaceId,sessionId,...(beforeSessionId?{beforeSessionId}:{})})}
 async deleteWorkspace(workspaceId:string):Promise<void>{await this.runtime.call('workspace.delete',{workspaceId})}
 async resolveContext(sessionId:string,projects:AgentProject[]){
  const [workspaces,sessions]=await Promise.all([this.runtime.call('workspace.list',{}),this.runtime.call('session.list',{})])
  return resolveDshProjectContext(sessionId,workspaces,sessions,projects,this.runtime.presetId)
 }
 enqueuePrompt(sessionId:string,text:string):Promise<string>{return this.runtime.enqueuePrompt(sessionId,text)}
 promptAndWait(sessionId:string,text:string,options?:PromptWaitOptions):Promise<string>{return this.runtime.promptAndWait(sessionId,text,options)}
 cancelSession(sessionId:string):Promise<unknown>{return this.runtime.call('session.cancel',{sessionId})}
 subscribe(listener:(event:{type:string;value:unknown})=>void):()=>void{return this.runtime.subscribe(listener)}
 async health(){
  if(!this.running||!this.url)return {ready:false,url:this.url,baseline:BMW_DSH_BASELINE}
  try{
   const response=await fetch(this.url,{headers:this.runtime.authHeaders(),signal:AbortSignal.timeout(5000)})
   return {ready:response.ok,status:response.status,url:this.url,baseline:BMW_DSH_BASELINE}
  }catch(error:unknown){return {ready:false,url:this.url,baseline:BMW_DSH_BASELINE,error:error instanceof Error?error.message:String(error)}}
 }
}
