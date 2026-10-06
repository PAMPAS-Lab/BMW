import {agentIdentifier,agentRecord,agentText} from './conversation.js'

export interface AgentModelChoice {id:string;label:string;description:string;availability:'unverified'|'verified'|'unavailable';reason?:string}
export interface AgentLoginMethod {id:string;label:string;fields:{id:string;label:string;secret:boolean;required:boolean;value?:string}[]}
/** A display projection, never an account token, credential value or provider config. */
export interface AgentDriverSettings {
  authentication:{state:'ready'|'required'|'unknown';label:string}
  models:AgentModelChoice[]
  selectedModel:string|null
  loginMethods:AgentLoginMethod[]
  canLogout:boolean
}
export type AgentSettingsRequest =
  | {action:'refresh'}
  /** Reuse the Profile's display cache; cold-load only when no attempt exists. */
  | {action:'ensure'}
  | {action:'model.select';modelId:string}
  | {action:'auth.login';methodId:string;values:Record<string,string>}
  | {action:'auth.logout'}
export interface AgentSettingsContext {signal:AbortSignal;openExternal(url:string):Promise<void>}
export interface AssistantSettingsState {driverId:string;phase:'idle'|'working'|'failed';message:string;value:AgentDriverSettings|null;cache?:{authenticationCheckedAt:number|null;modelsCheckedAt:number|null;authenticationStale:boolean;modelsStale:boolean}}
function closed(value:Record<string,unknown>,keys:readonly string[]):void{if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Unknown Agent settings field')}
export function parseAgentSettingsRequest(raw:unknown):AgentSettingsRequest{
  const value=agentRecord(raw)
  if(value.action==='refresh'||value.action==='ensure'||value.action==='auth.logout'){closed(value,['action']);return {action:value.action}}
  if(value.action==='model.select'){closed(value,['action','modelId']);return {action:value.action,modelId:agentIdentifier(value.modelId)}}
  if(value.action==='auth.login'){
    closed(value,['action','methodId','values']);const rawValues=agentRecord(value.values),values:Record<string,string>=Object.create(null)
    if(Object.keys(rawValues).length>20)throw new Error('Too many Agent login fields')
    for(const [key,text] of Object.entries(rawValues)){if(!/^[a-zA-Z0-9_.-]{1,64}$/u.test(key))throw new Error('Invalid login field');values[key]=agentText(text,8192)}
    return {action:value.action,methodId:agentIdentifier(value.methodId),values}
  }
  throw new Error('Unknown Agent settings operation')
}
export function parseAgentDriverSettings(raw:unknown):AgentDriverSettings{
  const value=agentRecord(raw);closed(value,['authentication','models','selectedModel','loginMethods','canLogout'])
  const auth=agentRecord(value.authentication);closed(auth,['state','label'])
  if(auth.state!=='ready'&&auth.state!=='required'&&auth.state!=='unknown')throw new Error('Invalid authentication state')
  if(!Array.isArray(value.models)||value.models.length>1000||!Array.isArray(value.loginMethods)||value.loginMethods.length>20||typeof value.canLogout!=='boolean')throw new Error('Invalid driver settings')
  const modelIds=new Set<string>(),methodIds=new Set<string>()
  const models=value.models.map(rawModel=>{
    const model=agentRecord(rawModel);closed(model,['id','label','description','availability','reason'])
    const id=agentIdentifier(model.id);if(modelIds.has(id))throw new Error('Duplicate model');modelIds.add(id)
    if(model.availability!=='verified'&&model.availability!=='unverified'&&model.availability!=='unavailable')throw new Error('Invalid model availability')
    return {id,label:agentText(model.label,200),description:agentText(model.description,2048),availability:model.availability,...(model.reason===undefined?{}:{reason:agentText(model.reason,1000)})} as AgentModelChoice
  })
  const loginMethods=value.loginMethods.map(rawMethod=>{
    const method=agentRecord(rawMethod);closed(method,['id','label','fields']);const id=agentIdentifier(method.id)
    if(methodIds.has(id)||!Array.isArray(method.fields)||method.fields.length>20)throw new Error('Invalid login method');methodIds.add(id)
    const fieldIds=new Set<string>(),fields=method.fields.map(rawField=>{
      const field=agentRecord(rawField);closed(field,['id','label','secret','required','value']);const fieldId=agentIdentifier(field.id)
      if(fieldIds.has(fieldId)||typeof field.secret!=='boolean'||typeof field.required!=='boolean'||(field.secret&&field.value!==undefined))throw new Error('Invalid or secret-bearing login field');fieldIds.add(fieldId)
      return {id:fieldId,label:agentText(field.label,200),secret:field.secret,required:field.required,...(field.value===undefined?{}:{value:agentText(field.value,8192)})}
    })
    return {id,label:agentText(method.label,200),fields}
  })
  return {authentication:{state:auth.state,label:agentText(auth.label,200)},models,selectedModel:value.selectedModel===null?null:agentIdentifier(value.selectedModel),loginMethods,canLogout:value.canLogout}
}
