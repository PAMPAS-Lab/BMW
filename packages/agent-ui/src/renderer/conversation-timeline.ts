import type {AgentEvent, AgentMessage, AssistantState} from '../../../agent-contract/index.js'

type TimelineEntry =
  | {kind:'message'; message:AgentMessage}
  | {kind:'tool'; text:string; status:string}
  | {kind:'outcome'; text:string; status:string}

/** Messages retain their first streaming position; same-millisecond events use Host order. */
export function conversationTimeline(state:Pick<AssistantState,'messages'|'events'|'activeRunId'>):TimelineEntry[]{
  const firstMessageEvent=new Map<string,number>(), completedTools=new Map<string,boolean>(), outcomes=new Map<string,AgentEvent['event']>()
  for(const [index,{runId,event}] of state.events.entries()){
    if((event.type==='message.delta'||event.type==='message.completed')&&!firstMessageEvent.has(event.messageId))firstMessageEvent.set(event.messageId,index)
    if(event.type==='tool.completed')completedTools.set(JSON.stringify([runId,event.callId]),event.success)
    if(event.type==='turn.completed'||event.type==='turn.disconnected')outcomes.set(runId,event)
  }
  const entries:{time:number; order:number; entry:TimelineEntry}[]=state.messages.map(message=>({time:message.createdAt,order:firstMessageEvent.get(message.id)??-1,entry:{kind:'message',message}}))
  const start=Math.max(0,state.events.length-100)
  for(let index=start;index<state.events.length;index++){
    const {createdAt,runId,event}=state.events[index]
    if(event.type==='tool.started'){
      const completed=completedTools.get(JSON.stringify([runId,event.callId])), outcome=outcomes.get(runId)
      const status=completed===true?'completed':completed===false?'failed':outcome?.type==='turn.completed'&&outcome.outcome==='interrupted'?'interrupted':state.activeRunId===runId&&!outcome?'running':'unknown'
      const label={completed:'已完成',failed:'失败',interrupted:'已停止',running:'执行中',unknown:'结果未确认'}[status]
      entries.push({time:createdAt,order:index,entry:{kind:'tool',status,text:'browser · '+event.action+' · '+label}})
    }
    if(event.type==='turn.completed'){
      const label={success:'本轮已完成',interrupted:'本轮已停止',failed:'本轮执行失败'}[event.outcome]
      entries.push({time:createdAt,order:index,entry:{kind:'outcome',status:event.outcome,text:label+(event.outcome!=='success'&&event.message?' · '+event.message:'')}})
    }
    if(event.type==='turn.disconnected')entries.push({time:createdAt,order:index,entry:{kind:'outcome',status:'disconnected',text:event.message}})
  }
  entries.sort((left,right)=>left.time-right.time||left.order-right.order)
  return entries.map(row=>row.entry)
}
