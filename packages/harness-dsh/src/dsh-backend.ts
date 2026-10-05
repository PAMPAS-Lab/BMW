import fs from 'node:fs'
import path from 'node:path'
import { agentIdentifier, agentRecord } from '@bmw-agent/agent-contract'
import type { AgentBackend, AgentDriverDescription, AgentDriverEvent, AgentProject, AgentRunRequest, AgentRunResult,AgentLegacySession } from '@bmw-agent/agent-contract'
import { DshRuntime } from './dsh-runtime.js'
import { dshConfiguration } from './driver.js'
import { resolveDshHome } from './dsh-preset.js'
import { DshEvents, dshBrowserCatalog } from './dsh-events.js'
import {readDshLegacySessions} from './dsh-legacy.js'
import {DshSettings,dshModelRoute} from './dsh-settings.js'
import type {AgentSettingsRequest,AgentSettingsContext,AgentDriverSettings} from '@bmw-agent/agent-contract'

export interface DshBackendOptions {
  userDataDirectory:string
  sourceDshHome?:string
  connection(request:AgentRunRequest):Promise<{bridgeUrl:string;bridgeToken:string;mcpServerPath:string;attachProviderSession(externalSessionId:string):void}>
  project(projectId:string):AgentProject
  runtimeFactory?:(config:ConstructorParameters<typeof DshRuntime>[0])=>DshRuntime
  legacyConnection?:{bridgeUrl:string;bridgeToken:string;mcpServerPath:string}
  getModel?():string|null
  setModel?(modelId:string):void
  settingsProject?():AgentProject
}
interface Prepared {request:AgentRunRequest;externalSessionId:string;stopping:boolean;rpcId:string|null;cancelPromise?:Promise<boolean>;controlUrl:string;token:string}
export class DshBackend implements AgentBackend {
  readonly description:AgentDriverDescription={id:'dsh',label:'DSH',baseline:'0.2.0-rc.2 / official scoped catalog',capabilities:{streaming:false,images:true,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:false}}
  private runtime:DshRuntime|undefined
  private startPromise:Promise<string>|undefined
  private prepared:Prepared|undefined
  private owner:{sessionId:string;runId:string;stage:'preparing'|'ready'|'settled'}|undefined
  private closed=false
  private legacyRuntime:DshRuntime|undefined
  private settingsPort:DshSettings|undefined
  constructor(private readonly options:DshBackendOptions){}
  private async start(request:AgentRunRequest):Promise<Awaited<ReturnType<DshBackendOptions['connection']>>> {
    const connection=await this.options.connection(request)
    if(!this.runtime){
      this.runtime=(this.options.runtimeFactory??(config=>new DshRuntime(config)))({...dshConfiguration,productId:'bmw',dshHome:path.join(this.options.userDataDirectory,'dsh-home'),sourceDshHome:this.options.sourceDshHome??resolveDshHome(),workspacePath:request.project.directory,workspaceTitle:request.project.name,bridgeUrl:connection.bridgeUrl,bridgeToken:connection.bridgeToken,mcpServerPath:connection.mcpServerPath,controlFilePath:path.join(this.options.userDataDirectory,'dsh-home','.bmw-driver-control.json'),isolateCredentials:true})
      this.startPromise=this.runtime.start()
    }
    try{await this.startPromise}catch(error:unknown){await this.stopRuntime();throw error}
    return connection
  }
  async prepare(request:AgentRunRequest):Promise<AgentDriverDescription>{
    if(this.closed||this.owner||this.legacyRuntime||this.settingsPort?.busy)throw new Error('DSH backend is closed or owns another turn')
    request.signal.throwIfAborted()
    this.owner={sessionId:request.sessionId,runId:request.runId,stage:'preparing'}
    const connection=await this.start(request),runtime=this.runtime!,project=this.options.project(request.project.id)
    if(project.directory!==request.project.directory)throw new Error('DSH Project membership changed')
    const sessions=agentRecord(await runtime.listProjectSessions(project))
    if(!Array.isArray(sessions.items)||!Array.isArray(sessions.membership))throw new Error('Invalid DSH Session list')
    let externalSessionId=request.externalSessionId
    if(externalSessionId){
      const native=sessions.items.map(row=>agentRecord(row)).find(row=>row.sessionId===externalSessionId)
      if(!native||!sessions.membership.includes(externalSessionId))throw new Error('Saved DSH Session is unavailable in its BMW Project')
      if(native.running===true)throw new Error('DSH Session is already running outside BMW Host')
      // Resume the official Agent world without sending model input.
      await runtime.call('session.rename',{sessionId:externalSessionId,title:String(native.title)})
    }else externalSessionId=agentIdentifier(agentRecord(await runtime.createProjectSession(project)).sessionId)
    const model=this.options.getModel?.()
    if(model){const route=dshModelRoute(model),response=agentRecord(await runtime.call('session/selectModel',{args:{request:{sessionId:externalSessionId,...route}}},{signal:request.signal})),selected=agentRecord(response.selected);if(selected.provider!==route.provider||selected.model!==route.model)throw new Error('DSH changed the selected model route')}
    const readyFile=path.join(this.options.userDataDirectory,'dsh-home','.bmw-driver-control.json'),deadline=Date.now()+30000
    let verified=false
    while(Date.now()<deadline){
      request.signal.throwIfAborted()
      if(fs.existsSync(readyFile)){
        const control=agentRecord(JSON.parse(fs.readFileSync(readyFile,'utf8'))),url=new URL(String(control.url))
        if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/')throw new Error('Invalid DSH host control address')
        const response=await fetch(url.origin+'/catalog?sessionId='+encodeURIComponent(externalSessionId),{headers:{authorization:'Bearer '+connection.bridgeToken},signal:AbortSignal.any([request.signal,AbortSignal.timeout(5000)])})
        if(response.ok){const catalog=agentRecord(await response.json());if(Array.isArray(catalog.tools)&&catalog.tools.length){dshBrowserCatalog(catalog,externalSessionId,fs.realpathSync(project.directory));this.prepared={request,externalSessionId,stopping:false,rpcId:null,controlUrl:url.origin,token:connection.bridgeToken};verified=true;break}}
      }
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    if(!verified)throw new Error('DSH scoped browser catalog did not become ready before input admission')
    connection.attachProviderSession(externalSessionId)
    this.owner.stage='ready'
    return {...this.description,capabilities:{...this.description.capabilities,browserOnly:true}}
  }
  async run(request:AgentRunRequest,emit:(event:AgentDriverEvent)=>Promise<void>):Promise<AgentRunResult>{
    const prepared=this.member(request.sessionId,request.runId),runtime=this.runtime!,decoder=new DshEvents(request.runId)
    await emit({type:'session.bound',externalSessionId:prepared.externalSessionId})
    const abort=()=>{void this.interrupt(request.sessionId,request.runId).catch(()=>{})}
    request.signal.addEventListener('abort',abort,{once:true})
    try{
      request.signal.throwIfAborted()
      const rpcId=agentIdentifier(await runtime.enqueuePrompt(prepared.externalSessionId,request.text))
      prepared.rpcId=rpcId
      await emit({type:'input.accepted',receiptId:rpcId})
      if(request.signal.aborted||prepared.stopping)await this.interrupt(request.sessionId,request.runId)
      const deadline=Date.now()+30*60*1000
      while(Date.now()<deadline){
        const history=await runtime.call('session.history',{sessionId:prepared.externalSessionId,maxMessages:200,rpcId})
        if(!Array.isArray(history.events))throw new Error('Invalid DSH prompt history')
        const index=history.events.findIndex(row=>row.event.type==='user/message'&&row.event.data?.source?.rpcId===rpcId)
        if(prepared.cancelPromise&&await prepared.cancelPromise)return {outcome:'interrupted',message:'DSH queued input removed before its turn started'}
        if(index>=0)for(const row of history.events.slice(index+1)){const result=await decoder.receive(row.event,emit);if(result){await this.control(prepared,'idle');this.prepared=undefined;this.owner!.stage='settled';return result}}
        await new Promise(resolve=>setTimeout(resolve,250))
      }
      await this.interrupt(request.sessionId,request.runId)
      throw new Error('DSH turn did not finish before its deadline')
    }catch(error:unknown){await this.stopRuntime();this.prepared=undefined;throw error}
    finally{request.signal.removeEventListener('abort',abort)}
  }
  private member(sessionId:string,runId:string):Prepared{const run=this.prepared;if(!run||run.request.sessionId!==sessionId||run.request.runId!==runId)throw new Error('DSH run does not belong to this BMW Session');return run}
  private async control(run:Prepared,action:'idle'|'cancel'):Promise<boolean>{
    const response=await fetch(run.controlUrl+'/'+action+'?sessionId='+encodeURIComponent(run.externalSessionId)+(run.rpcId?'&receiptId='+encodeURIComponent(run.rpcId):''),{headers:{authorization:'Bearer '+run.token},signal:AbortSignal.timeout(30000)})
    const value=agentRecord(await response.json())
    if(!response.ok||value.sessionId!==run.externalSessionId||value.idle!==true)throw new Error('DSH did not confirm native task cleanup')
    return value.removed===true
  }
  async interrupt(sessionId:string,runId:string):Promise<void>{const run=this.prepared;if(!run)return;this.member(sessionId,runId);run.stopping=true;if(!run.rpcId)return;run.cancelPromise??=this.control(run,'cancel');await run.cancelPromise}
  private async stopRuntime():Promise<void>{await this.runtime?.stopAndWait();this.runtime=undefined;this.startPromise=undefined}
  async drain(sessionId:string,runId:string):Promise<void>{
    const owner=this.owner;if(!owner)return
    if(owner.sessionId!==sessionId||owner.runId!==runId)throw new Error('DSH cleanup does not belong to this BMW Session')
    await this.stopRuntime()
    this.prepared=undefined;this.owner=undefined
  }
  async respond():Promise<void>{throw new Error('DSH browser permissions use BMW controls')}
  async readLegacySessions(projects:readonly AgentProject[],signal:AbortSignal):Promise<AgentLegacySession[]>{
    if(this.closed||this.owner)throw new Error('DSH backend is closed or owns another turn')
    await this.drainLegacy()
    const bound=projects.filter(project=>project.workspaceId||project.sessionId)
    if(!bound.length)return []
    if(!this.options.legacyConnection)throw new Error('DSH legacy discovery requires a Host-owned Bridge connection')
    signal.throwIfAborted()
    const project=bound[0]
    this.legacyRuntime=(this.options.runtimeFactory??(config=>new DshRuntime(config)))({...dshConfiguration,...this.options.legacyConnection,productId:'bmw',dshHome:path.join(this.options.userDataDirectory,'dsh-home'),sourceDshHome:this.options.sourceDshHome??resolveDshHome(),workspacePath:project.directory,workspaceTitle:project.name})
    await this.legacyRuntime.start()
    signal.throwIfAborted()
    return readDshLegacySessions(this.legacyRuntime,bound,dshConfiguration.presetId,signal)
  }
  async drainLegacy():Promise<void>{await this.legacyRuntime?.stopAndWait();this.legacyRuntime=undefined}
  async settings(request:AgentSettingsRequest,context:AgentSettingsContext):Promise<AgentDriverSettings>{
    if(this.closed||this.owner||this.legacyRuntime||!this.options.legacyConnection||!this.options.setModel||!this.options.settingsProject)throw new Error('DSH settings are unavailable while native work is active')
    this.settingsPort??=new DshSettings({model:()=>this.options.getModel?.()??null,setModel:this.options.setModel,createRuntime:()=>{
      const project=this.options.settingsProject!(),connection=this.options.legacyConnection!
      return (this.options.runtimeFactory??(config=>new DshRuntime(config)))({...dshConfiguration,productId:'bmw',dshHome:path.join(this.options.userDataDirectory,'dsh-home'),sourceDshHome:this.options.sourceDshHome??resolveDshHome(),workspacePath:project.directory,workspaceTitle:project.name,...connection,isolateCredentials:true})
    }})
    return this.settingsPort.execute(request,context)
  }
  async drainSettings():Promise<void>{await this.settingsPort?.drain()}
  async close():Promise<void>{this.closed=true;const results=await Promise.allSettled([this.stopRuntime(),this.drainLegacy(),this.drainSettings()]);const failure=results.find((row):row is PromiseRejectedResult=>row.status==='rejected');if(failure)throw failure.reason;this.prepared=undefined;this.owner=undefined}
}
