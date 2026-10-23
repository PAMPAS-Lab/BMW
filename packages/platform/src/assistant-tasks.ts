import {agentIdentifier,agentText} from '@bmw-agent/agent-contract'
import type {AgentHost} from './agent-host.js'
import type {AgentHistoryStore} from './agent-history-store.js'
import {parseAgentTaskReceipt} from './agent-history-store.js'
import type {ConversationStore} from './conversation-store.js'
import type {FeatureAssistantTasks,FeatureAssistantTask} from './feature-contract.js'
type Owner={projectId:string;sessionId:string}
/** Persists task identity with the input receipt before the existing FIFO dispatch.
 * The official backend owns all reasoning, tool use and completion. */
export function assistantTasks(options:{host:AgentHost;history:AgentHistoryStore;conversations:ConversationStore;model(driverId:string):string|null;owner():Owner|null;changing():boolean}):FeatureAssistantTasks {
 const member=(owner:Owner)=>{
  const current=options.owner(),row=options.conversations.get(agentIdentifier(owner.sessionId),agentIdentifier(owner.projectId))
  if(options.changing()||!current||current.projectId!==owner.projectId||current.sessionId!==owner.sessionId||row.archivedAt!==null)throw new Error('Internal task Project / Session is no longer selected')
  return row
 }
 const read=(owner:Owner,runId:string):FeatureAssistantTask=>{
  const row=member(owner),receipt=options.history.snapshot(owner.sessionId).receipts.find(r=>r.runId===agentIdentifier(runId))
  if(!receipt?.task)throw new Error('Unknown internal task receipt in this Session')
  const active=options.host.ownsRun(runId),state=receipt.state==='unknown'?'uncertain':active?(options.host.activeRunId===runId?'running':'queued'):receipt.state==='finished'?receipt.outcome!:'uncertain'
  return {runId,driverId:row.driverId,modelId:receipt.task.modelId,key:receipt.task.key,payload:receipt.task.payload,state,drained:!active}
 }
 const find=(owner:Owner,key:string)=>{member(owner);const receipt=options.history.snapshot(owner.sessionId).receipts.findLast(r=>r.task?.key===key);return receipt?read(owner,receipt.runId):null}
 return {read,find,start:(owner,task)=>{
  const row=member(owner),metadata=parseAgentTaskReceipt({kind:'video-review',key:task.key,payload:task.payload,modelId:options.model(row.driverId)})
  agentText(task.text,65536);agentText(task.context,16384)
  const old=find(owner,metadata.key);if(old)return old // Includes uncertain delivery: never replay.
  const run=options.host.enqueueTask(row.sessionId,task.text,task.context,metadata)
  return read(owner,run.runId)
 }}
}
