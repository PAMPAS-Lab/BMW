import type { AgentProject as ContextProject, AgentProjectContext as DshProjectContext } from '@bmw-agent/agent-contract'
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid DSH context snapshot')
 return value as Record<string,unknown>
}
function string(value:unknown,label:string):string{
 if(typeof value!=='string'||!value||value.length>4096)throw new Error('Invalid '+label)
 return value
}
/** This is the official DSH client selection store, not a renderer-supplied Project identity. */
export function selectedDshSession(raw:unknown):string|null{
 if(raw===null||raw===undefined||raw==='')return null
 if(typeof raw!=='string'||raw.length>4096)throw new Error('Invalid DSH selection')
 const value=object(JSON.parse(raw)),id=value.sessionId
 if(id===undefined)return null
 if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw new Error('Invalid DSH Session ID')
 return id
}
/** Resolve only through trusted DSH membership AND the known BMW Project directory. */
export function resolveDshProjectContext(sessionId:string,workspaceSnapshot:unknown,sessionSnapshot:unknown,projects:ContextProject[],presetId:string):DshProjectContext{
 const workspaces=object(workspaceSnapshot),sessions=object(sessionSnapshot)
 if(!Array.isArray(workspaces.items)||!Array.isArray(workspaces.archivedSessionIds)||!Array.isArray(sessions.items))throw new Error('Invalid DSH context lists')
 if(workspaces.archivedSessionIds.includes(sessionId))throw new Error('That DSH session is archived')
 const members=workspaces.items.map(object).filter(workspace=>{
  if(!Array.isArray(workspace.sessionIds)||!workspace.sessionIds.every(id=>typeof id==='string'))throw new Error('Invalid Workspace membership')
  return workspace.sessionIds.includes(sessionId)
 })
 if(members.length!==1)throw new Error('That DSH session must belong to exactly one Workspace')
 const workspace=members[0],workspaceId=string(workspace.workspaceId,'Workspace ID'),directory=string(workspace.path,'Workspace directory')
 const owners=projects.filter(project=>project.directory===directory&&(!project.workspaceId||project.workspaceId===workspaceId))
 if(owners.length!==1)throw new Error('This DSH Workspace is not linked to a BMW Project. Switch or create a Project in BMW.')
 const matching=sessions.items.map(object).filter(item=>item.sessionId===sessionId)
 if(matching.length!==1)throw new Error('That DSH session is unavailable')
 const session=matching[0]
 if(session.cwd!==directory||session.origin==='subagent')throw new Error('DSH session does not match the Project Workspace')
 if(session.agentPreset!==null&&session.agentPreset!==undefined&&session.agentPreset!==presetId)throw new Error('That session does not use the BMW browser-only preset')
 const projections=session.projections?object(session.projections):{},values=projections.values?object(projections.values):{}
 const title=typeof values.title==='string'&&values.title.trim()?values.title.trim():session.blank===true?'New session':'Session'
 const live=new Set(sessions.items.map(object).filter(item=>item.origin!=='subagent').map(item=>item.sessionId))
 const project=owners[0]
 return {projectId:project.id,projectName:project.name,directory,workspaceId,workspaceTitle:string(workspace.title,'Workspace title'),sessionId,sessionTitle:title,sessionCount:(workspace.sessionIds as string[]).filter(id=>live.has(id)&&!(workspaces.archivedSessionIds as unknown[]).includes(id)).length}
}
