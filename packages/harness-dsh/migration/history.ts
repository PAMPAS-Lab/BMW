import crypto from 'node:crypto'
import fs from 'node:fs'
import {agentIdentifier,agentRecord,agentText} from '@bmw-agent/agent-contract'
import type {AgentMessage} from '@bmw-agent/agent-contract'
import type {DshRuntime} from '../src/dsh-runtime.js'
import type {DshProject} from '../src/project-bindings.js'
import {parseDshMigrationSource} from './source.js'
import type {DshMigrationSource} from './source.js'
import {dshMessageText} from '../src/dsh-events.js'

function rows(value:unknown,label:string):Record<string,unknown>[] {
  if(!Array.isArray(value)||value.length>100000)throw new Error('Invalid DSH '+label)
  return value.map(item=>agentRecord(item,label))
}
function timestamp(value:unknown):number {
  if(!Number.isSafeInteger(value)||Number(value)<0)throw new Error('Invalid DSH history timestamp or cursor')
  return Number(value)
}
/** Durable display history retains original human/model messages, including compacted prefixes.
 * Synthetic context, replacement summaries, thinking and image bytes stay native. */
export function dshMigrationMessages(sessionId:string,records:readonly Record<string,unknown>[],cursor:number):AgentMessage[] {
  const messages:AgentMessage[]=[]
  let previous=-1
  for(const raw of records){
    const event=agentRecord(raw.event),seq=timestamp(event.seq),time=timestamp(event.time)
    if(seq<=previous||seq>cursor)throw new Error('DSH legacy history is not ordered at its frozen cursor')
    previous=seq
    if(event.type!=='user/message'&&event.type!=='assistant/message')continue
    if(event.surfaceOp!=='append'){
      const operation=agentRecord(event.surfaceOp)
      if(operation.op!=='replace'||timestamp(operation.startSeq)>timestamp(operation.endSeq))throw new Error('Invalid DSH surface replacement')
      continue
    }
    const data=agentRecord(event.data),message=event.type==='user/message'?data:agentRecord(data.message),source=agentRecord(message.source)
    const role=event.type==='user/message'?'user':'assistant'
    if(source.kind!==(role==='user'?'user':'model'))continue
    const text=dshMessageText(message.content)
    if(!text)continue
    const id='legacy-'+crypto.createHash('sha256').update(JSON.stringify([sessionId,seq])).digest('hex')
    messages.push({id,role,text,createdAt:time,complete:true})
  }
  return messages
}
async function history(runtime:DshRuntime,sessionId:string,signal:AbortSignal):Promise<{header:Record<string,unknown>;cursor:number;records:Record<string,unknown>[]}> {
  const snapshot=agentRecord(await runtime.call('session.history',{sessionId,maxMessages:200},{signal})),header=agentRecord(snapshot.header)
  if(header.id!==sessionId||typeof snapshot.hasMore!=='boolean')throw new Error('DSH legacy history identity changed')
  const cursor=timestamp(snapshot.cursor),records=rows(snapshot.events,'history')
  let hasMore=snapshot.hasMore,bytes=Buffer.byteLength(JSON.stringify(records))
  while(hasMore){
    signal.throwIfAborted()
    const beforeSeq=timestamp(agentRecord(records[0]?.event).seq)
    const page=agentRecord(await runtime.call('session.page',{address:{kind:'session',sessionId},throughSeq:cursor,beforeSeq,maxMessages:200},{signal}))
    const preceding=rows(page.records,'history page')
    if(!preceding.length||typeof page.hasMore!=='boolean'||preceding.some(row=>timestamp(agentRecord(row.event).seq)>=beforeSeq))throw new Error('DSH legacy pagination made no progress')
    bytes+=Buffer.byteLength(JSON.stringify(preceding))
    if(bytes>64*1024*1024||records.length+preceding.length>1000000)throw new Error('DSH legacy history exceeds its import budget')
    records.unshift(...preceding);hasMore=page.hasMore
  }
  if(bytes>64*1024*1024)throw new Error('DSH legacy history exceeds its import budget')
  return {header,cursor,records}
}
/** Only cold official reads; no ensureWorkspace, rename, prompt or Agent promotion. */
export async function readDshMigrationSessions(runtime:DshRuntime,projects:readonly (DshProject&{archivedProject?:boolean})[],presetId:string,signal:AbortSignal):Promise<DshMigrationSource[]> {
  const [listed,workspaceList]=await Promise.all([
    runtime.call('session.list',{}, {signal}),runtime.call('workspace.list',{}, {signal})
  ])
  const sessions=rows(listed.items,'Sessions'),workspaces=rows(workspaceList.items,'workspaces')
  if(!Array.isArray(workspaceList.archivedSessionIds))throw new Error('Invalid DSH archive list')
  const archived=new Set(workspaceList.archivedSessionIds.map(id=>agentIdentifier(id)))
  const byId=new Map<string,Record<string,unknown>>()
  for(const row of sessions){const id=agentIdentifier(row.sessionId);if(byId.has(id))throw new Error('Duplicate DSH Session identity');byId.set(id,row)}
  const imported:DshMigrationSource[]=[],claimed=new Set<string>()
  for(const project of projects){
    signal.throwIfAborted()
    if(!project.workspaceId&&!project.sessionId)continue
    const directory=fs.realpathSync(project.directory)
    const matches=workspaces.filter(row=>row.workspaceId===project.workspaceId)
    if(matches.length>1)throw new Error('Ambiguous saved DSH Workspace')
    if(matches.length===0&&!project.archivedProject)throw new Error('Saved DSH Workspace is unavailable in its active BMW Project')
    const workspace=matches[0]
    if(workspace&&(typeof workspace.path!=='string'||fs.realpathSync(workspace.path)!==directory||!Array.isArray(workspace.sessionIds)))throw new Error('Invalid DSH Workspace directory or membership')
    // BMW's retired archive path removed native Workspaces. Only explicit
    // migration may recover those Sessions using both native list and header cwd.
    const membership=new Set(workspace?(workspace.sessionIds as unknown[]).map(id=>agentIdentifier(id)):sessions.filter(row=>row.cwd===directory).map(row=>agentIdentifier(row.sessionId)))
    const ids=[...membership,...sessions.filter(row=>archived.has(String(row.sessionId))&&row.cwd===directory).map(row=>agentIdentifier(row.sessionId))]
    if(project.sessionId&&!ids.includes(project.sessionId))throw new Error('Saved DSH Session is unavailable in its BMW Project')
    for(const id of new Set(ids)){
      const row=byId.get(id)
      if(!row)throw new Error('DSH workspace references a missing Session')
      if(row.origin==='subagent')continue
      if(row.cwd!==directory)throw new Error('DSH Session directory differs from its BMW Project')
      const saved=await history(runtime,id,signal),header=saved.header
      if(!workspace&&header.cwd!==directory)throw new Error('Archived Project recovery requires a matching native history directory')
      if(header.agentPreset!==undefined&&header.agentPreset!==presetId){if(id===project.sessionId)throw new Error('Saved DSH Session uses another Agent preset');continue}
      if(header.cwd!==undefined&&(typeof header.cwd!=='string'||fs.realpathSync(header.cwd)!==directory))throw new Error('DSH history directory differs from its BMW Project')
      if(header.origin==='subagent')continue
      if(row.running===true)throw new Error('Stop the existing DSH turn before importing its BMW conversation')
      if(claimed.has(id))throw new Error('DSH Session is claimed by multiple BMW Projects')
      claimed.add(id)
      const parent=header.parentSession===undefined?null:agentIdentifier(header.parentSession)
      if(row.parentSessionId!==undefined&&row.parentSessionId!==parent)throw new Error('DSH legacy lineage changed')
      const values=row.projections===undefined?{}:agentRecord(agentRecord(row.projections).values)
      const title=typeof values.title==='string'&&values.title.trim()?agentText(values.title.trim(),200):id
      const createdAt=timestamp(header.createdAt),messages=dshMigrationMessages(id,saved.records,saved.cursor)
      imported.push(parseDshMigrationSource({projectId:project.id,externalSessionId:id,parentExternalSessionId:parent,title,createdAt,updatedAt:messages.reduce((latest,message)=>Math.max(latest,message.createdAt),Math.max(createdAt,timestamp(row.updatedAt))),archived:archived.has(id),selected:project.sessionId===id&&!archived.has(id),throughSequence:saved.cursor,messages}))
    }
  }
  return imported
}
