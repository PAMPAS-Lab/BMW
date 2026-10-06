import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {agentIdentifier,agentRecord,parseAgentConversation} from '@bmw-agent/agent-contract'
import type {AgentConversation} from '@bmw-agent/agent-contract'
import {parseProjectState,parseGlobalSettingsState,parseConversationState,parseAgentHistory,parseAgentPreferences,parseScheduledTaskState,AGENT_DATA_MARKER} from '@bmw-agent/platform/agent-data'
import {parseDshMigrationSource,parseDshProjectBindings} from '@bmw-agent/harness-dsh/migration'
import type {DshMigrationSource} from '@bmw-agent/harness-dsh/migration'

interface Snapshot {content:Buffer|null;link?:string;hash:string}
interface Change {before:Snapshot;after:Buffer}
interface Project {id:string;name:string;directory:string;archivedAt:string|null;binding:{workspaceId:string|null;sessionId:string|null}}
export interface MigrationReport {version:2;alreadyCurrent:boolean;projects:number;sessions:number;importedSessions:number;drafts:number;changedFiles:number;warnings:string[]}
export interface MigrationPlan {profile:string;changes:Map<string,Change>;guards:Map<string,Snapshot>;report:MigrationReport}
function digest(value:Buffer|string):string{return crypto.createHash('sha256').update(value).digest('hex')}
function json(value:unknown):Buffer{return Buffer.from(JSON.stringify(value,null,2)+'\n')}
function snapshot(file:string,allowLink=false):Snapshot {
  const stat=fs.lstatSync(file,{throwIfNoEntry:false})
  if(!stat)return {content:null,hash:'missing'}
  if(stat.isSymbolicLink()){
    if(!allowLink)throw new Error('Migration refuses a linked state file: '+file)
    const link=fs.readlinkSync(file),content=fs.readFileSync(file)
    if(content.byteLength>1024*1024)throw new Error('Linked credential copy exceeds its budget')
    return {content,link,hash:'link:'+digest(link)+':'+digest(content)}
  }
  if(!stat.isFile()||stat.size>128*1024*1024)throw new Error('State file exceeds migration budget: '+file)
  const content=fs.readFileSync(file);return {content,hash:digest(content)}
}
function saved(plan:MigrationPlan,name:string,required=false):Record<string,unknown>|null {
  const file=path.join(plan.profile,name),row=snapshot(file);plan.guards.set(file,row)
  if(!row.content){if(required)throw new Error('Missing required state: '+name);return null}
  return agentRecord(JSON.parse(row.content.toString('utf8')))
}
function change(plan:MigrationPlan,name:string,value:unknown):void {
  const file=path.join(plan.profile,name),before=plan.guards.get(file)??snapshot(file),after=json(value)
  plan.guards.set(file,before)
  if(before.hash!==digest(after))plan.changes.set(file,{before,after})
}
export function migrationProjects(profile:string):Project[] {
  const row=agentRecord(JSON.parse(fs.readFileSync(path.join(profile,'projects.json'),'utf8')))
  if(!Array.isArray(row.projects))throw new Error('Invalid Project index')
  return row.projects.map(raw=>{
    const project=agentRecord(raw),bindings=project.agentBindings===undefined?{}:agentRecord(project.agentBindings),binding=bindings.dsh===undefined?{}:agentRecord(bindings.dsh)
    if(typeof project.directory!=='string'||!path.isAbsolute(project.directory)||typeof project.name!=='string'||(project.archivedAt!==null&&typeof project.archivedAt!=='string'))throw new Error('Invalid Project identity')
    for(const [driver,value]of Object.entries(bindings))if(driver!=='dsh'&&value!==null)throw new Error('Unexpected native Project mapping; preserve and repair explicitly')
    return {id:agentIdentifier(project.id),name:project.name,directory:fs.realpathSync(project.directory),archivedAt:project.archivedAt as string|null,binding:{workspaceId:(binding.workspaceId??project.dshWorkspaceId)==null?null:agentIdentifier(binding.workspaceId??project.dshWorkspaceId),sessionId:(binding.sessionId??project.dshSessionId)==null?null:agentIdentifier(binding.sessionId??project.dshSessionId)}}
  })
}
/** Pure plan construction; importing display history never invents dispatch receipts. */
export function planAgentDataMigration(profileDirectory:string,nativeSources:readonly DshMigrationSource[]):MigrationPlan {
  const profile=fs.realpathSync(profileDirectory),plan:MigrationPlan={profile,changes:new Map(),guards:new Map(),report:{version:2,alreadyCurrent:false,projects:0,sessions:0,importedSessions:0,drafts:0,changedFiles:0,warnings:[]}}
  const projectState=saved(plan,'projects.json',true)!,settings=saved(plan,'global-settings.json'),index=saved(plan,'agent-conversations.json'),preferences=saved(plan,'agent-preferences.json'),tasks=saved(plan,'scheduled-tasks.json'),marker=saved(plan,AGENT_DATA_MARKER)
  const projects=migrationProjects(profile),projectById=new Map(projects.map(row=>[row.id,row]))
  const savedBindings=saved(plan,'dsh-home/bmw-project-bindings.json')
  if(savedBindings)for(const binding of parseDshProjectBindings(savedBindings).bindings){
    const project=projectById.get(binding.projectId)
    if(!project||fs.realpathSync(binding.directory)!==project.directory||project.binding.workspaceId&&binding.workspaceId!==project.binding.workspaceId)throw new Error('Existing DSH Workspace mapping differs from its BMW Project')
  }
  plan.report.projects=projects.length
  const current=marker?.version===2
  if(marker&&!current)throw new Error('Unsupported or incomplete migration marker')
  if(current){parseProjectState(projectState);if(settings)parseGlobalSettingsState(settings);if(preferences)parseAgentPreferences(preferences);if(tasks)parseScheduledTaskState(tasks)}
  else {
    if(projectState.version!==1||index&&index.version!==1||preferences&&preferences.version!==1||tasks&&tasks.version!==1||settings&&settings.version!==undefined&&settings.version!==1)throw new Error('Mixed or unsupported old state; restore the migration backup before retrying')
    for(const raw of projectState.projects as unknown[]){const row=agentRecord(raw);for(const key of ['agentBindings','dshWorkspaceId','dshSessionId','connectors'])delete row[key]}
    projectState.version=2;parseProjectState(projectState);change(plan,'projects.json',projectState)
    if(settings){for(const key of ['agentSidebarVisible','dshSidebarVisible','webContainerModuleUrl'])delete settings[key];settings.version=2;parseGlobalSettingsState(settings);change(plan,'global-settings.json',settings)}
    if(preferences){preferences.version=2;parseAgentPreferences(preferences);change(plan,'agent-preferences.json',preferences)}
    else change(plan,'agent-preferences.json',{version:2,selections:[]})
    const bindings=projects.filter(row=>row.binding.workspaceId).map(row=>({projectId:row.id,workspaceId:row.binding.workspaceId,directory:row.directory}))
    if(savedBindings&&JSON.stringify(parseDshProjectBindings(savedBindings).bindings)!==JSON.stringify(bindings))throw new Error('Existing DSH Workspace mappings cannot be overwritten by migration')
    change(plan,'dsh-home/bmw-project-bindings.json',parseDshProjectBindings({version:2,bindings}))
  }
  const rawIndex=index??{version:current?2:1,revision:0,conversations:[],selections:[]}
  if(!Array.isArray(rawIndex.conversations)||!Array.isArray(rawIndex.selections))throw new Error('Invalid old conversation index')
  const sources=nativeSources.map(parseDshMigrationSource),sourceById=new Map<string,DshMigrationSource>()
  for(const source of sources){if(sourceById.has(source.externalSessionId)||!projectById.has(source.projectId))throw new Error('Duplicate or foreign native migration source');sourceById.set(source.externalSessionId,source)}
  const pending=new Set<string>(),rows=rawIndex.conversations.map(raw=>{
    const row=agentRecord(raw)
    if(row.legacyImportPending!==undefined){if(row.legacyImportPending!==true||current)throw new Error('Invalid pending migration');pending.add(agentIdentifier(row.sessionId));delete row.legacyImportPending}
    const result=parseAgentConversation(row)
    if(!projectById.has(result.projectId))throw new Error('Conversation belongs to a missing Project')
    if(!current&&result.driverId==='dsh'&&result.externalSessionId){const source=sourceById.get(result.externalSessionId);if(!source||source.projectId!==result.projectId)throw new Error('Native DSH resume anchor is missing or belongs to another Project')}
    return result
  })
  if(!current){
    for(const project of projects)if(project.binding.sessionId){const source=sourceById.get(project.binding.sessionId);if(!source||source.projectId!==project.id)throw new Error('Preserved Project Session requires a matching native history export')}
    for(const source of sources){
      if(rows.some(row=>row.driverId==='dsh'&&row.externalSessionId===source.externalSessionId))continue
      if(rows.some(row=>row.sessionId===source.externalSessionId))throw new Error('Native Session collides with another BMW identity')
      const project=projectById.get(source.projectId)!
      rows.push(parseAgentConversation({sessionId:source.externalSessionId,projectId:source.projectId,driverId:'dsh',externalSessionId:source.externalSessionId,title:source.title,createdAt:source.createdAt,updatedAt:source.updatedAt,archivedAt:project.archivedAt?Date.parse(project.archivedAt):source.archived?source.updatedAt:null,parentSessionId:null,...(source.parentExternalSessionId?{externalParentSessionId:source.parentExternalSessionId}:{}),status:'idle'}))
      plan.report.importedSessions++
    }
    for(const row of rows){const source=row.driverId==='dsh'&&row.externalSessionId?sourceById.get(row.externalSessionId):undefined;if(source?.parentExternalSessionId&&!row.parentSessionId){const parent=rows.find(parent=>parent.driverId===row.driverId&&parent.projectId===row.projectId&&parent.externalSessionId===source.parentExternalSessionId);row.parentSessionId=parent?.sessionId??null}}
    for(const project of projects){
      if(project.archivedAt!==null||rawIndex.selections.some(raw=>{const selection=agentRecord(raw);return selection.projectId===project.id&&selection.driverId==='dsh'}))continue
      const selected=sources.filter(source=>source.projectId===project.id&&source.selected)
      if(selected.length>1)throw new Error('Native Project has ambiguous selected Sessions')
      const anchor=project.binding.sessionId??selected[0]?.externalSessionId
      const row=rows.find(row=>row.projectId===project.id&&row.driverId==='dsh'&&row.externalSessionId===anchor&&row.archivedAt===null)
      if(row)rawIndex.selections.push({projectId:project.id,driverId:'dsh',sessionId:row.sessionId})
    }
  }
  const ownerById=new Map(rows.map(row=>[row.sessionId,row]))
  const historyDirectory=path.join(profile,'agent-history')
  const histories=new Map<string,{name:string;value:Record<string,unknown>}>()
  if(fs.existsSync(historyDirectory))for(const name of fs.readdirSync(historyDirectory)){
    if(!name.endsWith('.json'))continue
    const value=saved(plan,'agent-history/'+name,true)!,id=agentIdentifier(value.sessionId)
    if(name!==digest(id)+'.json'||histories.has(id)||!ownerById.has(id))throw new Error('History filename or owner differs from the BMW index')
    histories.set(id,{name,value})
  }
  for(const row of rows){
    const existing=histories.get(row.sessionId),source=row.externalSessionId?sourceById.get(row.externalSessionId):undefined
    const history=existing?.value??{version:current?2:1,sessionId:row.sessionId,revision:0,events:[],messages:[],interactions:[],receipts:[]}
    if(current&&history.version!==2||!current&&history.version!==1)throw new Error('Mixed display history versions')
    const legacy=history.legacyImport===undefined?null:agentRecord(history.legacyImport)
    if(legacy){const frozen=parseDshMigrationSource({...agentRecord(legacy.source),messages:history.messages});if(legacy.driverId!==row.driverId||legacy.externalSessionId!==row.externalSessionId||frozen.projectId!==row.projectId||frozen.externalSessionId!==row.sessionId||legacy.throughSequence!==frozen.throughSequence)throw new Error('Legacy display history owner or cursor differs from its BMW binding')}
    if(!current&&(pending.has(row.sessionId)||!existing)){
      if(source&&!legacy){if((history.messages as unknown[]).length||(history.events as unknown[]).length||(history.receipts as unknown[]).length)throw new Error('Incomplete import cannot replace BMW history');history.messages=source.messages}
      else if(pending.has(row.sessionId)&&!legacy)throw new Error('Pending import has no frozen native source')
    }
    if(!current){delete history.legacyImport;history.version=2;history.owner={projectId:row.projectId,driverId:row.driverId,externalSessionId:row.externalSessionId}}
    const validated=parseAgentHistory(history,row.sessionId)
    if(validated.owner.projectId!==row.projectId||validated.owner.driverId!==row.driverId||validated.owner.externalSessionId!==row.externalSessionId)throw new Error('Display history owner differs from the BMW index')
    if(!current)change(plan,'agent-history/'+digest(row.sessionId)+'.json',validated)
  }
  rawIndex.version=2;rawIndex.conversations=rows
  parseConversationState(rawIndex)
  if(!current)change(plan,'agent-conversations.json',rawIndex)
  if(tasks){
    for(const raw of tasks.tasks as unknown[]){const task=agentRecord(raw),owner=typeof task.sessionId==='string'?ownerById.get(task.sessionId):undefined
      if(!current&&task.driverId===undefined)task.driverId=owner&&owner.projectId===task.projectId?owner.driverId:null
      if(task.sessionId&&(!owner||owner.projectId!==task.projectId||owner.driverId!==task.driverId))throw new Error('Scheduled task differs from its BMW Session binding')
      if(!task.sessionId||!task.driverId){task.enabled=false;task.nextRunAt=null;task.lastError='Select an explicit BMW Session and driver before enabling this task.';plan.report.warnings.push('Unbound schedule retained disabled')}
    }
    tasks.version=2;parseScheduledTaskState(tasks);if(!current)change(plan,'scheduled-tasks.json',tasks)
  }
  for(const project of projects){
    const directory=path.join(project.directory,'video-studio')
    if(!fs.existsSync(directory))continue
    for(const name of fs.readdirSync(directory).filter(name=>/^[a-zA-Z0-9-]+\.json$/u.test(name))){
      const file=path.join(directory,name),before=snapshot(file);plan.guards.set(file,before)
      const draft=agentRecord(JSON.parse(before.content!.toString('utf8'))),owner=typeof draft.ownerSessionId==='string'?ownerById.get(draft.ownerSessionId):undefined
      if(!owner||owner.projectId!==project.id)throw new Error('Studio draft ownership requires explicit repair before migration')
      plan.report.drafts++
    }
  }
  const credentialFile=path.join(profile,'dsh-home','.credentials.yaml')
  if(fs.lstatSync(credentialFile,{throwIfNoEntry:false})?.isSymbolicLink()){
    if(current)throw new Error('Current Profile cannot contain linked DSH credentials')
    const before=snapshot(credentialFile,true);plan.guards.set(credentialFile,before);plan.changes.set(credentialFile,{before,after:before.content!})
  }
  if(!current)change(plan,AGENT_DATA_MARKER,{version:2})
  plan.report.sessions=rows.length;plan.report.changedFiles=plan.changes.size;plan.report.alreadyCurrent=current
  return plan
}
function unchanged(file:string,expected:Snapshot):void {if(snapshot(file,Boolean(expected.link)).hash!==expected.hash)throw new Error('State changed during migration planning: '+file)}
function atomicWrite(file:string,content:Buffer):void {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700})
  const temporary=file+'.migration-'+crypto.randomUUID()
  try{fs.writeFileSync(temporary,content,{mode:0o600,flag:'wx'});fs.renameSync(temporary,file)}finally{fs.rmSync(temporary,{force:true})}
}
/** Marker commits last; a failure restores only files still owned by this transaction. */
export function applyAgentDataMigration(plan:MigrationPlan,backupDirectory:string,hooks:{afterWrite?(file:string,index:number):void}={}):{backupDirectory:string;report:MigrationReport} {
  for(const [file,before]of plan.guards)unchanged(file,before)
  if(plan.report.alreadyCurrent)return {backupDirectory:'',report:plan.report}
  if(fs.existsSync(backupDirectory))throw new Error('Migration backup directory must be new')
  fs.mkdirSync(backupDirectory,{recursive:true,mode:0o700})
  const manifest={version:2,status:'prepared',profile:plan.profile,report:plan.report,files:[...plan.changes].map(([file,row])=>({path:path.relative(plan.profile,file),beforeHash:row.before.hash,afterHash:digest(row.after),existed:row.before.content!==null,link:row.before.link??null}))}
  for(const [file,row]of plan.changes){if(row.before.content){const destination=path.join(backupDirectory,'before',path.relative(plan.profile,file));fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});fs.writeFileSync(destination,row.before.content,{mode:0o600,flag:'wx'})}}
  atomicWrite(path.join(backupDirectory,'manifest.json'),json(manifest))
  const written:string[]=[]
  try{
    for(const [file,row]of plan.changes){unchanged(file,row.before);atomicWrite(file,row.after);written.push(file);hooks.afterWrite?.(file,written.length)}
    for(const [file,row]of plan.changes)if(snapshot(file).hash!==digest(row.after))throw new Error('Migration output changed before commit verification')
    for(const [file,row]of plan.guards)if(!plan.changes.has(file))unchanged(file,row)
    manifest.status='complete';atomicWrite(path.join(backupDirectory,'manifest.json'),json(manifest))
    return {backupDirectory,report:plan.report}
  }catch(error:unknown){
    const conflicts:string[]=[]
    for(const file of written.reverse()){
      const row=plan.changes.get(file)!
      if(snapshot(file).hash!==digest(row.after)){conflicts.push(path.relative(plan.profile,file));continue}
      if(row.before.link){fs.unlinkSync(file);fs.symlinkSync(row.before.link,file)}else if(row.before.content)atomicWrite(file,row.before.content);else fs.unlinkSync(file)
    }
    manifest.status=conflicts.length?'rollback-conflict':'rolled-back';atomicWrite(path.join(backupDirectory,'manifest.json'),json({...manifest,conflicts}))
    throw new Error('BMW migration failed; backup '+backupDirectory+'; '+(conflicts.length?'concurrent changes preserved':'original state restored'),{cause:error})
  }
}
