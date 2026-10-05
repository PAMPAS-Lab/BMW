import fs from 'node:fs'
import {agentIdentifier,agentRecord,agentText} from '@bmw-agent/agent-contract'
import type {AgentDriverSettings,AgentModelChoice,AgentSettingsContext,AgentSettingsRequest} from '@bmw-agent/agent-contract'
import {createCodexRpc} from './codex-rpc.js'
import type {CodexRpc} from './codex-rpc.js'
import {initializeCodex} from './codex-policy.js'
import type {CodexBrowserDefinition,CodexCatalogGate} from './codex-policy.js'
import {codexNeedsBrowserCatalog} from './codex-model-catalog.js'

export interface CodexSettingsOptions {
  executable:string;configDirectory:string
  model():string|null
  setModel(modelId:string):void
  definition:CodexBrowserDefinition
  gate:Pick<CodexCatalogGate,'verify'> & Partial<Pick<CodexCatalogGate,'invalidate'>>
  rpcFactory?:typeof createCodexRpc
}
/** The account and live model catalog are checked again before every user turn. */
export async function codexAccountModels(rpc:CodexRpc):Promise<Pick<AgentDriverSettings,'authentication'|'models'|'canLogout'>>{
  const account=agentRecord(await rpc.call('account/read',{refreshToken:true})),native=account.account===null||account.account===undefined?null:agentRecord(account.account)
  if(typeof account.requiresOpenaiAuth!=='boolean')throw new Error('Invalid Codex account response')
  const ready=native!==null||account.requiresOpenaiAuth===false,models:AgentModelChoice[]=[],seen=new Set<string>(),cursors=new Set<string>()
  let cursor:string|null=null
  if(ready)do{
    const page=agentRecord(await rpc.call('model/list',{cursor,limit:100,includeHidden:false}))
    if(!Array.isArray(page.data)||models.length+page.data.length>1000)throw new Error('Invalid Codex model page')
    for(const raw of page.data){const row=agentRecord(raw),id=agentIdentifier(row.model);if(seen.has(id))throw new Error('Duplicate Codex model');seen.add(id);models.push({id,label:agentText(row.displayName,200),description:agentText(row.description,2048),availability:'unverified'})}
    cursor=page.nextCursor==null?null:agentIdentifier(page.nextCursor)
    if(cursor){if(cursors.has(cursor)||cursors.size>=1000)throw new Error('Codex model pagination made no progress or exceeded its budget');cursors.add(cursor)}
  }while(cursor)
  return {authentication:{state:ready?'ready':'required',label:native?.type==='chatgpt'?'已通过 ChatGPT 登录':native?.type==='apiKey'?'已配置 API Key':ready?'官方引擎认证可用':'需要登录 Codex'},models,canLogout:native!==null}
}
/** Native account/model control only. This process never creates a model turn. */
export class CodexSettings {
  private rpc:CodexRpc|undefined
  constructor(private readonly options:CodexSettingsOptions){}
  get busy():boolean{return this.rpc!==undefined}
  async execute(request:AgentSettingsRequest,context:AgentSettingsContext):Promise<AgentDriverSettings>{
    if(this.rpc)throw new Error('Codex settings still own a native process')
    context.signal.throwIfAborted();fs.mkdirSync(this.options.configDirectory,{recursive:true,mode:0o700})
    const rpc=(this.options.rpcFactory??createCodexRpc)(this.options.executable,this.options.configDirectory,this.options.configDirectory)
    this.rpc=rpc
    const abort=()=>{void rpc.close().catch(()=>{})};context.signal.addEventListener('abort',abort,{once:true})
    try{
      await initializeCodex(rpc);context.signal.throwIfAborted()
      if(request.action==='auth.login')await this.login(rpc,request,context)
      if(request.action==='auth.logout'){await rpc.call('account/logout',{});this.options.gate.invalidate?.()}
      const snapshot=await this.read(rpc)
      if(request.action==='model.select'){
        const model=snapshot.models.find(row=>row.id===request.modelId)
        if(!model||snapshot.authentication.state!=='ready')throw new Error('Codex model is unavailable for the signed-in account')
        await this.drain();context.signal.throwIfAborted();this.options.setModel(model.id)
        snapshot.selectedModel=model.id
      }
      context.signal.throwIfAborted();return snapshot
    }finally{context.signal.removeEventListener('abort',abort)}
  }
  private async read(rpc:CodexRpc):Promise<AgentDriverSettings>{
    const account=await codexAccountModels(rpc)
    return {...account,models:account.models.filter(row=>row.id==='gpt-5.5'||codexNeedsBrowserCatalog(row.id)).map(row=>({...row,availability:'verified' as const})),selectedModel:this.options.model(),loginMethods:[{id:'chatgpt',label:'通过 ChatGPT 登录',fields:[]}]}
  }
  private async login(rpc:CodexRpc,request:Extract<AgentSettingsRequest,{action:'auth.login'}>,context:AgentSettingsContext):Promise<void>{
    if(request.methodId!=='chatgpt'||Object.keys(request.values).length)throw new Error('Invalid Codex login method')
    let loginId:string|undefined,resolve!:()=>void,reject!:(error:Error)=>void
    const completed=new Promise<void>((yes,no)=>{resolve=yes;reject=no});void completed.catch(()=>{})
    const early:unknown[]=[]
    const consume=(raw:unknown)=>{try{const value=agentRecord(raw);if(value.loginId!==loginId)return;if(value.success===true)resolve();else reject(new Error('Codex login failed'))}catch{reject(new Error('Invalid Codex login completion'))}}
    const unsubscribe=rpc.onNotification((method,params)=>{if(method==='account/login/completed'){if(loginId)consume(params);else if(early.length<4)early.push(params)}})
    rpc.onFailure(()=>reject(new Error('Codex login connection ended')))
    const abort=()=>{reject(new Error('Codex login cancelled'));if(loginId)void rpc.call('account/login/cancel',{loginId}).catch(()=>{})}
    const timeout=setTimeout(()=>reject(new Error('Codex login timed out')),10*60*1000)
    context.signal.addEventListener('abort',abort,{once:true})
    try{
      const response=agentRecord(await rpc.call('account/login/start',{type:'chatgpt',useHostedLoginSuccessPage:true}))
      if(response.type!=='chatgpt')throw new Error('Unexpected Codex login response')
      loginId=agentIdentifier(response.loginId);for(const event of early)consume(event)
      const url=agentText(response.authUrl,16384),parsed=new URL(url)
      if(parsed.protocol!=='https:'||!['auth.openai.com','chatgpt.com','auth.chatgpt.com'].includes(parsed.hostname)||parsed.username||parsed.password)throw new Error('Unexpected Codex login origin')
      context.signal.throwIfAborted();await context.openExternal(url);await completed
      context.signal.throwIfAborted();this.options.gate.invalidate?.()
    }catch(error:unknown){if(loginId)await rpc.call('account/login/cancel',{loginId}).catch(()=>{});throw error}
    finally{clearTimeout(timeout);unsubscribe();context.signal.removeEventListener('abort',abort)}
  }
  async drain():Promise<void>{const rpc=this.rpc;if(rpc){await rpc.close();if(this.rpc===rpc)this.rpc=undefined}}
}
