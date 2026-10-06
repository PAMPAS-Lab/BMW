import type { AgentProjectContext } from '../index.js'
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid Agent context snapshot')
 return value as Record<string,unknown>
}
function string(value:unknown,label:string):string{
 if(typeof value!=='string'||!value||value.length>4096)throw new Error('Invalid '+label)
 return value
}
export interface AgentContextState {state:'starting'|'ready'|'waiting'|'error'|'empty';context?:AgentProjectContext;message?:string}
export function parseAgentContextState(raw:unknown):AgentContextState{
 const value=object(raw)
 if(Object.keys(value).some(key=>!['state','context','message'].includes(key)))throw new Error('Unknown context fields')
 if(!['starting','ready','waiting','error','empty'].includes(String(value.state)))throw new Error('Invalid context state')
 const result:AgentContextState={state:value.state as AgentContextState['state']}
 if(value.message!==undefined)result.message=string(value.message,'context message')
 if(value.context!==undefined){
  const context=object(value.context)
  if(Object.keys(context).some(key=>!['projectId','projectName','directory','sessionId','sessionTitle','sessionCount'].includes(key)))throw new Error('Unknown context fields')
  if(!Number.isSafeInteger(context.sessionCount)||Number(context.sessionCount)<0)throw new Error('Invalid session count')
  result.context={projectId:string(context.projectId,'Project ID'),projectName:string(context.projectName,'Project name'),directory:string(context.directory,'directory'),sessionId:string(context.sessionId,'Session ID'),sessionTitle:string(context.sessionTitle,'Session title'),sessionCount:Number(context.sessionCount)}
 }
 if(result.state==='ready'&&!result.context)throw new Error('Ready context has no binding')
 return result
}
