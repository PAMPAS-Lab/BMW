import {parseAgentDriverSettings,parseAgentSettingsRequest} from '@bmw-agent/agent-contract'
import type {AgentBackend,AgentSettingsRequest,AssistantSettingsState} from '@bmw-agent/agent-contract'
import type {AgentHost} from './agent-host.js'

export class AgentSettingsController {
  private state:AssistantSettingsState|undefined
  private active:{controller:AbortController;settled:Promise<void>}|undefined
  private closed=false
  constructor(private readonly options:{host:AgentHost;backends:readonly AgentBackend[];openExternal(url:string):Promise<void>;onState():void}){}
  snapshot():AssistantSettingsState|undefined{return this.state?structuredClone(this.state):undefined}
  start(driverId:string,raw:AgentSettingsRequest):void{
    if(this.closed||this.active||this.options.host.busy)throw new Error('Finish the active BMW operation before changing Agent settings')
    const backend=this.options.backends.find(row=>row.description.id===driverId)
    if(!backend?.settings||!backend.drainSettings)throw new Error('This driver has no verified settings interface')
    const request=parseAgentSettingsRequest(raw),controller=new AbortController()
    const value=this.state?.driverId===driverId?this.state.value:null
    this.state={driverId,phase:'working',message:request.action==='auth.login'?'正在登录；完成授权后可选择模型':request.action==='model.select'?'正在保存模型选择':'正在读取登录状态和可选模型',value}
    const active={controller,settled:Promise.resolve()};this.active=active
    // The native operation and its cleanup hold the same exclusion as a turn.
    active.settled=this.options.host.maintain(async()=>{
      return parseAgentDriverSettings(await backend.settings!(request,{signal:controller.signal,openExternal:async url=>{
        controller.signal.throwIfAborted();const parsed=new URL(url)
        if(parsed.protocol!=='https:'||parsed.username||parsed.password||url.length>16384)throw new Error('Invalid official login address')
        await this.options.openExternal(url)
      }}))
    },()=>backend.drainSettings!()).then(result=>{this.state={driverId,phase:'idle',message:'设置已更新',value:result}},()=>{
      // Provider errors can contain submitted credentials; no raw error crosses UI.
      this.state={driverId,phase:'failed',message:controller.signal.aborted?'设置操作已取消':'设置操作失败；请重试登录、刷新状态或切换其他 Agent',value}
    }).finally(()=>{if(this.active===active)this.active=undefined;this.options.onState()})
    this.options.onState()
  }
  async cancel():Promise<void>{const active=this.active;if(active){active.controller.abort();await active.settled}}
  async close():Promise<void>{this.closed=true;await this.cancel()}
}
