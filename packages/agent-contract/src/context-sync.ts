import type { AgentProjectContext } from '../index.js'
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid Agent context snapshot')
 return value as Record<string,unknown>
}
function string(value:unknown,label:string):string{
 if(typeof value!=='string'||!value||value.length>4096)throw new Error('Invalid '+label)
 return value
}
interface SynchronizerOptions {
 readSelection:()=>Promise<string|null>;resolve:(sessionId:string)=>Promise<AgentProjectContext>;
 apply:(context:AgentProjectContext,stillCurrent:()=>Promise<boolean>)=>Promise<void>;
 blocked:()=>boolean;restore:()=>Promise<void>;
 publish:(value:{state:'ready'|'waiting'|'error'|'empty';context?:AgentProjectContext;message?:string})=>void
}
/** Observe client navigation; The driver owns the Agent loop and its Session lifecycle. */
export class AgentSelectionSynchronizer{
 private running=false;private stopped=false;private version=0;private lastId:string|null=null;private refreshAt=0
 constructor(private options:SynchronizerOptions){}
 invalidate():void{this.version++;this.refreshAt=0}
 stop():void{this.stopped=true;this.version++}
 async tick():Promise<void>{
  if(this.running||this.stopped)return
  this.running=true
  const version=this.version
  let id:string|null=null
  try{
   id=(await this.options.readSelection())
   if(version!==this.version||this.stopped)return
   if(!id){this.lastId=null;this.options.publish({state:'empty'});return}
   if(id===this.lastId&&Date.now()<this.refreshAt)return
   if(this.options.blocked()){this.options.publish({state:'waiting',message:'Waiting for the current browser operation or media job to finish…'});return}
   if(id!==this.lastId)this.options.publish({state:'waiting',message:'Switching to the selected conversation…'})
   const context=await this.options.resolve(id)
   const stillCurrent=async()=>!this.stopped&&version===this.version&&!this.options.blocked()&&(await this.options.readSelection())===id
   if(!await stillCurrent())return
   await this.options.apply(context,stillCurrent)
   if(!await stillCurrent())return
   this.lastId=id;this.refreshAt=Date.now()+10_000
   this.options.publish({state:'ready',context})
  }catch(error:unknown){
   if(!this.stopped&&version===this.version&&!this.options.blocked()){
    // Rejected navigation never silently points the browser at an unrelated Project.
    await this.options.restore().catch(()=>{})
    this.options.publish({state:'error',message:error instanceof Error?error.message:String(error)})
    this.refreshAt=Date.now()+10_000
   }
  }finally{this.running=false}
 }
}

export interface AgentContextState {state:'starting'|'ready'|'waiting'|'error'|'empty';context?:AgentProjectContext;message?:string}
export function parseAgentContextState(raw:unknown):AgentContextState{
 const value=object(raw)
 if(!['starting','ready','waiting','error','empty'].includes(String(value.state)))throw new Error('Invalid context state')
 const result:AgentContextState={state:value.state as AgentContextState['state']}
 if(value.message!==undefined)result.message=string(value.message,'context message')
 if(value.context!==undefined){
  const context=object(value.context)
  if(!Number.isSafeInteger(context.sessionCount)||Number(context.sessionCount)<0)throw new Error('Invalid session count')
  result.context={projectId:string(context.projectId,'Project ID'),projectName:string(context.projectName,'Project name'),directory:string(context.directory,'directory'),workspaceId:string(context.workspaceId,'Workspace ID'),workspaceTitle:string(context.workspaceTitle,'Workspace title'),sessionId:string(context.sessionId,'Session ID'),sessionTitle:string(context.sessionTitle,'Session title'),sessionCount:Number(context.sessionCount)}
 }
 if(result.state==='ready'&&!result.context)throw new Error('Ready context has no binding')
 return result
}
