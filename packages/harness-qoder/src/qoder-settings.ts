import {spawn} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {query,qodercliAuth} from '@qodercn-ai/qodercn-agent-sdk'
import type {Options,Query,SDKUserMessage} from '@qodercn-ai/qodercn-agent-sdk'
import {agentIdentifier,agentRecord,agentText} from '@bmw-agent/agent-contract'
import type {AgentDriverSettings,AgentSettingsContext,AgentSettingsRequest,AgentModelChoice} from '@bmw-agent/agent-contract'
import {qoderBrowserCatalog} from './qoder-events.js'

// Maintained official Worker 1.1.64 model IDs; new catalog entries need development admission.
const supportedModels=new Set(['auto','qmodel_38max','qfmodel','qmodel_latest','qmodel','q37fmodel','dmodel','dfmodel','gmodel','gfmodel','gm51model','kmodel_latest','kmodel','mmodel'])

type ControlQuery=Pick<Query,'getAvailableModels'|'setModel'|'accountInfo'|'close'> & AsyncIterable<unknown>
class QoderLoginRequired extends Error {}
function missingColdLogin(value:Record<string,unknown>):boolean{
  return value.type==='result'&&value.subtype==='error_during_execution'&&value.num_turns===0&&value.total_cost_usd===0&&
    Array.isArray(value.errors)&&value.errors.length===1&&value.errors[0]==='No qodercli login found. Run "qodercli login" first.'
}
export interface QoderSettingsOptions {
  configDirectory:string
  connection:{bridgeUrl:string;bridgeToken:string;mcpServerPath:string;nodeExecutable:string}
  model():string|null
  setModel(modelId:string):void
  queryFactory?:(input:{prompt:AsyncIterable<SDKUserMessage>;options:Options})=>ControlQuery
  cliPath?:string
}
/** A cold SDK control session. Its async input is never released to a model. */
export class QoderSettings {
  private control:{query:ControlQuery;controller:AbortController;release():void;reader:Promise<void>}|undefined
  private loginChild:ChildProcess|undefined
  constructor(private readonly options:QoderSettingsOptions){}
  get busy():boolean{return Boolean(this.control||this.loginChild)}
  private empty():AgentDriverSettings{return {authentication:{state:'required',label:'需要登录 Qoder CN'},models:[],selectedModel:this.options.model(),loginMethods:[{id:'qoder-cli',label:'通过 Qoder 官方 CLI 登录',fields:[]}],canLogout:false}}
  async execute(request:AgentSettingsRequest,context:AgentSettingsContext):Promise<AgentDriverSettings>{
    if(this.busy)throw new Error('Qoder settings still own native work')
    context.signal.throwIfAborted();fs.mkdirSync(this.options.configDirectory,{recursive:true,mode:0o700})
    if(request.action==='auth.logout')throw new Error('The verified Qoder CLI has no noninteractive logout control')
    if(request.action==='auth.login'){
      if(request.methodId!=='qoder-cli'||Object.keys(request.values).length)throw new Error('Invalid Qoder login method')
      await this.login(context.signal)
    }
    let release!:()=>void,ready!:()=>void,fail!:(error:unknown)=>void
    const input=new Promise<void>(yes=>{release=yes}),prepared=new Promise<void>((yes,no)=>{ready=yes;fail=no});void prepared.catch(()=>{})
    async function* prompt():AsyncGenerator<SDKUserMessage>{await input}
    const controller=new AbortController(),connection=this.options.connection,model=request.action==='model.select'?request.modelId:this.options.model()
    const native=(this.options.queryFactory??query)({prompt:prompt(),options:{cwd:this.options.configDirectory,auth:qodercliAuth(),env:{QODERCN_CONFIG_DIR:this.options.configDirectory,ELECTRON_RUN_AS_NODE:'1'},abortController:controller,
      ...(model?{model}:{}),tools:[],skills:[],plugins:[],settingSources:[],strictMcpConfig:true,persistSession:false,includePartialMessages:false,controlRequestTimeoutMs:15000,stderr:()=>{},
      // Control discovery has no BMW execution lease and cannot call browser.
      mcpServers:{bmw:{type:'stdio',command:connection.nodeExecutable,args:[connection.mcpServerPath],env:{BMW_BRIDGE_URL:connection.bridgeUrl,BMW_BRIDGE_TOKEN:connection.bridgeToken,BMW_CATALOG_ONLY:'1',ELECTRON_RUN_AS_NODE:'1'},tools:[{name:'browser',exposedName:'browser',permission_policy:'always_allow',alwaysLoad:true}]}},
      canUseTool:async()=>({behavior:'deny',interrupt:true,message:'BMW settings never execute model tools'})
    }})
    const held={query:native,controller,release,reader:Promise.resolve()};this.control=held
    let readerFailure:unknown,initialized=false
    const check=(active=true)=>{context.signal.throwIfAborted();if(readerFailure)throw readerFailure;if(active&&controller.signal.aborted)throw new Error('Qoder settings stopped')}
    held.reader=(async()=>{try{for await(const raw of native){const value=agentRecord(raw);if(value.type==='system'&&value.subtype==='init'){qoderBrowserCatalog(value);initialized=true;ready()}else if(!initialized&&!controller.signal.aborted&&missingColdLogin(value))throw new QoderLoginRequired('Official Qoder CLI login is required');else if(['assistant','user','stream_event'].includes(String(value.type))||(value.type==='result'&&!controller.signal.aborted))throw new Error('Qoder settings released unexpected model work')}if(!controller.signal.aborted)throw new Error('Qoder control transport ended')}catch(error:unknown){readerFailure=error;fail(error);controller.abort();release();void native.close().catch(()=>{})}})()
    const abort=()=>{controller.abort();release();fail(new Error('Qoder settings cancelled'));void native.close().catch(()=>{})}
    const timeout=setTimeout(()=>fail(new Error('Qoder settings initialization timed out')),30000)
    context.signal.addEventListener('abort',abort,{once:true})
    try{
      await prepared;check()
      const account=await native.accountInfo(),available=await native.getAvailableModels({fetchStrategy:'live'})
      check()
      if(available.length>1000)throw new Error('Qoder model catalog exceeds its budget')
      const catalog=available.map(row=>({id:agentIdentifier(row.value),label:agentText(row.displayName,200),description:agentText(row.description,2048),enabled:row.isEnabled!==false}))
      if(new Set(catalog.map(row=>row.id)).size!==catalog.length)throw new Error('Duplicate Qoder models')
      const models:AgentModelChoice[]=catalog.filter(row=>row.enabled&&supportedModels.has(row.id)).map(({enabled:_enabled,...row})=>({...row,availability:'verified'}))
      const authenticated=Boolean(account.userId||account.tokenSource||account.apiKeySource)
      let selected:AgentModelChoice|undefined
      if(request.action==='model.select'){
        if(!authenticated)throw new Error('Qoder account is not authenticated')
        selected=models.find(row=>row.id===request.modelId)
        if(!selected||selected.availability==='unavailable')throw new Error('Qoder model is unavailable')
        await native.setModel(selected.id);check()
      }
      // Join the native event reader before committing a preference. A control
      // acknowledgement can race with an already queued model event; closing
      // the control transport must not turn that protocol failure into success.
      await this.drain();check(false)
      if(selected)this.options.setModel(selected.id)
      return {...this.empty(),authentication:{state:authenticated?'ready':'unknown',label:authenticated?'已通过 Qoder 官方 CLI 登录':'官方引擎已连接；账号状态未确认'},models,selectedModel:this.options.model()}
    }catch(error:unknown){
      if(!context.signal.aborted&&request.action==='refresh'&&error instanceof QoderLoginRequired)return this.empty()
      throw error
    }finally{clearTimeout(timeout);context.signal.removeEventListener('abort',abort)}
  }
  private async login(signal:AbortSignal):Promise<void>{
    const cli=this.options.cliPath??path.join(path.dirname(fileURLToPath(import.meta.resolve('@qodercn-ai/qoderclicn/package.json'))),'bundle/qoderclicn.js')
    if(!path.isAbsolute(cli))throw new Error('Qoder CLI path must be host-owned')
    const child=spawn(this.options.connection.nodeExecutable,[cli,'login'],{cwd:this.options.configDirectory,env:{...process.env,QODERCN_CONFIG_DIR:this.options.configDirectory,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']})
    this.loginChild=child
    // The official CLI opens its own normal browser login. Diagnostic output may
    // contain an authorization URL; it is never retained in BMW state or logs.
    child.stdout?.on('data',()=>{});child.stderr?.on('data',()=>{})
    let kill:ReturnType<typeof setTimeout>|undefined
    const abort=()=>{child.kill('SIGTERM');kill??=setTimeout(()=>child.kill('SIGKILL'),2000)};signal.addEventListener('abort',abort,{once:true})
    const timeout=setTimeout(abort,10*60*1000)
    try{
      await new Promise<void>((resolve,reject)=>{child.once('error',()=>reject(new Error('Qoder CLI could not start')));child.once('exit',(code)=>{if(signal.aborted)reject(new Error('Qoder login cancelled'));else if(code===0)resolve();else reject(new Error('Qoder CLI login failed'))})})
      signal.throwIfAborted()
    }finally{clearTimeout(timeout);if(kill)clearTimeout(kill);signal.removeEventListener('abort',abort);if(child.exitCode!==null||child.signalCode!==null||child.pid===undefined)this.loginChild=undefined}
  }
  async drain():Promise<void>{
    const held=this.control
    if(held){held.controller.abort();held.release();await held.query.close();await held.reader;if(this.control===held)this.control=undefined}
    const child=this.loginChild
    if(child){
      if(child.exitCode===null&&child.signalCode===null&&child.pid!==undefined){child.kill('SIGTERM');await new Promise<void>((resolve,reject)=>{const kill=setTimeout(()=>child.kill('SIGKILL'),2000),timeout=setTimeout(()=>reject(new Error('Qoder login process did not drain')),10000);child.once('exit',()=>{clearTimeout(kill);clearTimeout(timeout);resolve()})})}
      if(this.loginChild===child)this.loginChild=undefined
    }
  }
}
