import { agentIdentifier, agentRecord, agentText } from '@bmw-agent/agent-contract'
import type { AgentDriverEvent, AgentRunResult } from '@bmw-agent/agent-contract'

export function dshMessageText(raw: unknown): string {
  if (!Array.isArray(raw)) return ''
  return agentText(raw.map(value => { const block=agentRecord(value);return block.type==='text'&&typeof block.text==='string'?block.text:'' }).join(''),2*1024*1024)
}
export function dshBrowserCatalog(raw: unknown, sessionId: string, directory: string): void {
  const value=agentRecord(raw)
  if(value.sessionId!==sessionId||value.directory!==directory||!Array.isArray(value.tools)||value.tools.length!==1||agentRecord(value.tools[0]).name!=='browser')throw new Error('DSH effective scoped model catalog must contain exactly BMW browser')
}
/** Read only official durable display events; private reasoning/attachments stay native. */
export class DshEvents {
  private cursor=-1
  private readonly tools=new Set<string>()
  constructor(private readonly runId:string){}
  async receive(raw:unknown,emit:(event:AgentDriverEvent)=>Promise<void>):Promise<AgentRunResult|null>{
    const event=agentRecord(raw),seq=Number(event.seq)
    if(!Number.isSafeInteger(seq)||seq<0)throw new Error('Invalid DSH event sequence')
    if(seq<=this.cursor)return null
    this.cursor=seq
    const data=agentRecord(event.data)
    if(event.type==='request/header'){
      const header=agentRecord(data.header)
      if(!Array.isArray(header.tools)||header.tools.length!==1||agentRecord(header.tools[0]).name!=='browser')throw new Error('DSH request changed its browser-only model catalog')
    }
    if(event.type==='assistant/message'){
      const text=dshMessageText(agentRecord(data.message).content)
      if(text)await emit({type:'message.completed',messageId:this.runId+':'+seq,text})
    }
    if(event.type==='tool/call'){
      if(data.name!=='browser')throw new Error('DSH requested a tool outside BMW browser')
      const callId=this.runId+':'+agentIdentifier(data.callId),args=agentRecord(JSON.parse(agentText(data.arguments,1000000)))
      if(this.tools.has(callId))throw new Error('DSH repeated a browser call identity')
      this.tools.add(callId);await emit({type:'tool.started',callId,name:'browser',action:agentText(args.action,200)})
    }
    if(event.type==='tool/result'){
      const message=agentRecord(data.message),source=agentRecord(message.source)
      const nativeCallId=agentIdentifier(message.toolCallId),callId=this.runId+':'+nativeCallId
      if(source.kind!=='tool'||source.callId!==nativeCallId)throw new Error('DSH tool result source changed its call identity')
      if(!this.tools.delete(callId))throw new Error('DSH browser result has no running call')
      await emit({type:'tool.completed',callId,success:message.isError!==true,message:dshMessageText(message.content).slice(0,16384)})
    }
    if(event.type==='turn/end'){
      if(this.tools.size)throw new Error('DSH ended before browser calls returned')
      const reason=agentRecord(data.reason)
      if(reason.kind==='error')return {outcome:'failed',message:agentText(agentRecord(reason.error).message,16384)}
      if(reason.kind==='aborted')return {outcome:'interrupted',message:'DSH turn cancelled'}
      if(reason.kind==='blocked'||reason.kind==='max-tokens')return {outcome:'failed',message:reason.kind==='blocked'?'DSH turn was blocked':'DSH reached the output-token limit'}
      if(reason.kind!=='completed')throw new Error('Unsupported DSH turn completion reason')
      return {outcome:'success',message:''}
    }
    return null
  }
}
