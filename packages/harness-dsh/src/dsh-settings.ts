import {agentIdentifier,agentRecord,agentText} from '@bmw-agent/agent-contract'
import type {AgentDriverSettings,AgentSettingsRequest,AgentSettingsContext,AgentModelChoice} from '@bmw-agent/agent-contract'
import {DshRuntime} from './dsh-runtime.js'

const supportedModels=new Set(['deepseek-flash','deepseek-v4-pro'].map(model=>JSON.stringify(['deepseek-official',model])))

export function dshModelRoute(id:string):{provider:string;model:string}{
  const value:unknown=JSON.parse(id)
  if(!Array.isArray(value)||value.length!==2)throw new Error('Invalid DSH model route')
  return {provider:agentIdentifier(value[0]),model:agentIdentifier(value[1])}
}
/** Official redacted settings/credential and model-catalog APIs, without Agent input. */
export class DshSettings {
  private runtime:DshRuntime|undefined
  constructor(private readonly options:{createRuntime():DshRuntime;model():string|null;setModel(modelId:string):void}){}
  get busy():boolean{return this.runtime!==undefined}
  async execute(request:AgentSettingsRequest,context:AgentSettingsContext):Promise<AgentDriverSettings>{
    if(this.runtime)throw new Error('DSH settings still own a native process')
    context.signal.throwIfAborted();const runtime=this.options.createRuntime();this.runtime=runtime
    const abort=()=>{void runtime.stopAndWait().catch(()=>{})};context.signal.addEventListener('abort',abort,{once:true})
    try{
      await runtime.start();context.signal.throwIfAborted()
      const call=(method:string,args:Record<string,unknown>={})=>runtime.call(method,{args},{signal:context.signal})
      const description=agentRecord(await call('settings/describe')),refs=new Set<string>(['DEEPSEEK_API_KEY'])
      let visited=0
      const inspect=(raw:unknown,depth:number)=>{
        if(++visited>10000||depth>12)throw new Error('DSH credential reference view exceeds its budget')
        if(typeof raw==='string'&&/^[A-Z_][A-Z0-9_]*_(API_KEY|TOKEN)$/u.test(raw))refs.add(raw)
        else if(Array.isArray(raw))for(const value of raw)inspect(value,depth+1)
        else if(raw&&typeof raw==='object')for(const value of Object.values(raw))inspect(value,depth+1)
      }
      if(!Array.isArray(description.namespaces)||description.namespaces.length>1000)throw new Error('Invalid DSH settings view')
      for(const raw of description.namespaces)inspect(agentRecord(raw).value,0)
      const references=[...refs];if(references.length>20)throw new Error('Too many DSH credential references')
      let credentials=agentRecord(await call('credentials/describe',{refs:references}))
      if(request.action==='auth.login'){
        const ref=request.methodId.startsWith('credential:')?request.methodId.slice(11):''
        if(ref!=='DEEPSEEK_API_KEY'||!references.includes(ref)||Object.keys(request.values).some(key=>key!=='apiKey')||!request.values.apiKey?.trim())throw new Error('Invalid DSH credential method')
        if(agentRecord(credentials[ref]).writable!==true)throw new Error('DSH credential reference is read-only')
        await call('credentials/set',{ref,value:request.values.apiKey});credentials=agentRecord(await call('credentials/describe',{refs:references}))
      }
      if(request.action==='auth.logout'){
        const info=agentRecord(credentials.DEEPSEEK_API_KEY);if(info.configured===true&&info.writable===true)await call('credentials/unset',{ref:'DEEPSEEK_API_KEY'})
        credentials=agentRecord(await call('credentials/describe',{refs:references}))
      }
      const catalog=agentRecord(await call('session/modelCatalog')),models:AgentModelChoice[]=[],ids=new Set<string>()
      if(!Array.isArray(catalog.groups)||catalog.groups.length>1000)throw new Error('Invalid DSH model catalog')
      for(const rawGroup of catalog.groups){const group=agentRecord(rawGroup),provider=agentIdentifier(group.id);if(!Array.isArray(group.models))throw new Error('Invalid DSH provider models')
        for(const rawModel of group.models){const model=agentRecord(rawModel),id=JSON.stringify([provider,agentIdentifier(model.id)]);if(ids.has(id)||ids.size>=1000)throw new Error('Invalid DSH model identity');ids.add(id);if(supportedModels.has(id))models.push({id,label:agentText(group.name,100)+' · '+agentText(model.name,100),description:typeof model.description==='string'?agentText(model.description,2048):'',availability:'verified'})}
      }
      const credential=agentRecord(credentials.DEEPSEEK_API_KEY),configured=credential.configured===true
      if(request.action==='model.select'){
        if(!configured||!models.some(row=>row.id===request.modelId))throw new Error('DSH model is unavailable')
        await this.drain();context.signal.throwIfAborted();this.options.setModel(request.modelId)
      }
      context.signal.throwIfAborted()
      return {authentication:{state:configured?'ready':'required',label:configured?'DeepSeek API Key 已配置':'请配置 DeepSeek API Key'},models,selectedModel:this.options.model(),loginMethods:credential.writable===true?[{id:'credential:DEEPSEEK_API_KEY',label:'使用 DeepSeek API Key',fields:[{id:'apiKey',label:'API Key',secret:true,required:true}]}]:[],canLogout:configured&&credential.writable===true}
    }finally{context.signal.removeEventListener('abort',abort)}
  }
  async drain():Promise<void>{const runtime=this.runtime;if(runtime){await runtime.stopAndWait();if(this.runtime===runtime)this.runtime=undefined}}
}
