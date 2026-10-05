import {agentIdentifier,agentRecord,agentText} from './conversation.js'
import type {AgentMessage} from './conversation.js'

/** Display-only import. Native transcripts remain the authority for resume. */
export interface AgentLegacySession {
  projectId:string
  externalSessionId:string
  parentExternalSessionId:string|null
  title:string
  createdAt:number
  updatedAt:number
  archived:boolean
  selected:boolean
  throughSequence:number
  messages:AgentMessage[]
}
export function parseAgentLegacySession(raw:unknown):AgentLegacySession {
  const row=agentRecord(raw,'legacy Agent conversation')
  const fields=['projectId','externalSessionId','parentExternalSessionId','title','createdAt','updatedAt','archived','selected','throughSequence','messages']
  if(Object.keys(row).some(key=>!fields.includes(key))||typeof row.archived!=='boolean'||typeof row.selected!=='boolean'||!Array.isArray(row.messages)||row.messages.length>100000)throw new Error('Invalid legacy Agent conversation')
  for(const key of ['createdAt','updatedAt','throughSequence'])if(!Number.isSafeInteger(row[key])||Number(row[key])<0)throw new Error('Invalid legacy Agent cursor or timestamp')
  if(Number(row.updatedAt)<Number(row.createdAt)||row.archived&&row.selected)throw new Error('Invalid legacy Agent state')
  const ids=new Set<string>()
  const messages:AgentMessage[]=row.messages.map(rawMessage=>{
    const message=agentRecord(rawMessage),id=agentIdentifier(message.id)
    if(Object.keys(message).some(key=>!['id','role','text','createdAt','complete'].includes(key))||ids.has(id)||(message.role!=='user'&&message.role!=='assistant')||typeof message.complete!=='boolean'||!Number.isSafeInteger(message.createdAt)||Number(message.createdAt)<0)throw new Error('Invalid legacy display message')
    ids.add(id)
    return {id,role:message.role,text:agentText(message.text,2*1024*1024),createdAt:Number(message.createdAt),complete:message.complete}
  })
  const title=agentText(row.title,200)
  if(!title.trim())throw new Error('Legacy conversation title is required')
  if(row.parentExternalSessionId===row.externalSessionId)throw new Error('A legacy conversation cannot be its own parent')
  return {projectId:agentIdentifier(row.projectId),externalSessionId:agentIdentifier(row.externalSessionId),parentExternalSessionId:row.parentExternalSessionId===null?null:agentIdentifier(row.parentExternalSessionId),title,createdAt:Number(row.createdAt),updatedAt:Number(row.updatedAt),archived:row.archived,selected:row.selected,throughSequence:Number(row.throughSequence),messages}
}
