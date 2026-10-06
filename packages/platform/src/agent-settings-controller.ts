import {parseAgentDriverSettings,parseAgentSettingsRequest} from '@bmw-agent/agent-contract'
import type {AgentBackend,AgentSettingsRequest,AssistantSettingsState} from '@bmw-agent/agent-contract'
import type {AgentHost} from './agent-host.js'

interface CachedSettings {state:AssistantSettingsState;key:string;authenticationCheckedAt:number|null;modelsCheckedAt:number|null}
/** Profile-scoped display cache. It never admits model input or owns a native loop. */
export class AgentSettingsController {
  private readonly cache=new Map<string,CachedSettings>()
  private state:AssistantSettingsState|undefined
  private active:{driverId:string;controller:AbortController;settled:Promise<void>}|undefined
  private closed=false
  constructor(private readonly options:{host:AgentHost;backends:readonly AgentBackend[];openExternal(url:string):Promise<void>;onState():void;now?():number;configurationKey?(driverId:string):string}){}
  private key(driverId:string):string{return JSON.stringify([this.options.backends.find(row=>row.description.id===driverId)?.description.baseline,this.options.configurationKey?.(driverId)??''])}
  private entry(driverId:string):CachedSettings|undefined{
    const entry=this.cache.get(driverId)
    if(entry&&entry.key!==this.key(driverId)){this.cache.delete(driverId);return undefined}
    return entry
  }
  snapshot(driverId?:string):AssistantSettingsState|undefined{
    const id=driverId??this.state?.driverId
    if(!id)return undefined
    const entry=this.entry(id)
    if(this.active?.driverId===id)return this.state?structuredClone(this.state):undefined
    if(!entry)return undefined
    const now=(this.options.now??Date.now)()
    return structuredClone({...entry.state,cache:{authenticationCheckedAt:entry.authenticationCheckedAt,modelsCheckedAt:entry.modelsCheckedAt,
      authenticationStale:entry.authenticationCheckedAt===null||now-entry.authenticationCheckedAt>=5*60*1000,
      modelsStale:entry.modelsCheckedAt===null||now-entry.modelsCheckedAt>=30*60*1000}})
  }
  /** Native task failures invalidate display freshness without starting another check. */
  invalidate(driverId:string):void{
    const entry=this.entry(driverId)
    if(!entry)return
    entry.authenticationCheckedAt=entry.modelsCheckedAt=null
    entry.state={...entry.state,message:'本轮任务失败；登录状态与模型待检查，可手动刷新'}
    this.options.onState()
  }
  start(driverId:string,raw:AgentSettingsRequest):void{
    const requested=parseAgentSettingsRequest(raw)
    if(this.closed)throw new Error('Agent 设置已关闭，请重新打开 BMW')
    // Viewing an existing projection is safe even while a task/cleanup holds Host admission.
    if(requested.action==='ensure'&&this.entry(driverId)){this.options.onState();return}
    const request:AgentSettingsRequest=requested.action==='ensure'?{action:'refresh'}:requested
    if(this.options.host.resourcesDisconnected)throw new Error('Agent 连接清理失败，请先恢复连接清理再修改设置')
    if(this.active){
      if(driverId===this.active.driverId&&request.action==='refresh')return
      throw new Error('正在处理 Agent 设置或清理连接，请等待完成，或取消当前设置操作')
    }
    if(this.options.host.busy)throw new Error('Agent 任务尚未结束，请先停止任务并等待清理完成')
    const backend=this.options.backends.find(row=>row.description.id===driverId)
    if(!backend?.settings||!backend.drainSettings)throw new Error('This driver has no verified settings interface')
    const previous=this.entry(driverId),controller=new AbortController(),value=previous?.state.value??null,key=this.key(driverId)
    // Mutations can partially succeed before cancellation/cleanup: never retain a ready cache then.
    if(request.action!=='refresh')this.cache.delete(driverId)
    this.state={driverId,phase:'working',message:request.action==='auth.login'?'正在登录；完成授权后可选择模型':request.action==='model.select'?'正在保存模型选择':'正在读取登录状态和可选模型',value}
    const active={driverId,controller,settled:Promise.resolve()};this.active=active
    active.settled=this.options.host.maintain(async()=>{
      return parseAgentDriverSettings(await backend.settings!(request,{signal:controller.signal,openExternal:async url=>{
        controller.signal.throwIfAborted();const parsed=new URL(url)
        if(parsed.protocol!=='https:'||parsed.username||parsed.password||url.length>16384)throw new Error('Invalid official login address')
        await this.options.openExternal(url)
      }}))
    },()=>{
      if(this.state)this.state={...this.state,message:controller.signal.aborted?'正在取消设置并清理 Agent 连接，请稍候':'正在清理 Agent 设置连接，请稍候'}
      this.options.onState();return backend.drainSettings!()
    }).then(result=>{
      controller.signal.throwIfAborted()
      const checkedAt=(this.options.now??Date.now)(),changed=request.action==='refresh'&&key!==this.key(driverId)
      this.state={driverId,phase:'idle',message:changed?'配置已变化；请手动刷新状态与模型':'显示上次检查结果；实际任务仍由官方引擎验证',value:changed?null:result}
      this.cache.set(driverId,{state:this.state,key:this.key(driverId),authenticationCheckedAt:changed?null:checkedAt,modelsCheckedAt:changed?null:checkedAt})
    }).catch(()=>{
      // No raw provider error or submitted credential is stored. Explicit failures don't auto-retry on view.
      this.state={driverId,phase:'failed',message:controller.signal.aborted?'设置操作已取消；可手动刷新':'设置操作失败；请重试登录、刷新状态或切换其他 Agent',value:request.action==='refresh'?value:null}
      this.cache.set(driverId,{state:this.state,key:this.key(driverId),authenticationCheckedAt:previous?.authenticationCheckedAt??null,modelsCheckedAt:previous?.modelsCheckedAt??null})
      if(request.action!=='refresh'||this.options.host.resourcesDisconnected||key!==this.key(driverId)){const entry=this.cache.get(driverId)!;entry.authenticationCheckedAt=entry.modelsCheckedAt=null;entry.state.value=null}
    }).finally(()=>{if(this.active===active)this.active=undefined;this.options.onState()})
    this.options.onState()
  }
  async cancel():Promise<void>{
    const active=this.active
    if(active){
      if(this.state)this.state={...this.state,message:'正在取消设置并清理 Agent 连接，请稍候'}
      this.options.onState();active.controller.abort();await active.settled
    }
  }
  async close():Promise<void>{this.closed=true;await this.cancel();this.cache.clear();this.state=undefined}
}
