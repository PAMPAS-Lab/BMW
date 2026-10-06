import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {agentIdentifier,agentRecord} from '@bmw-agent/agent-contract'
import type {AgentProject} from '@bmw-agent/agent-contract'

export interface DshProject extends AgentProject {workspaceId?:string|null;sessionId?:string|null}
export interface DshProjectBinding {projectId:string;workspaceId:string;directory:string}
export interface DshProjectBindingState {version:2;bindings:DshProjectBinding[]}
export function parseDshProjectBindings(raw:unknown):DshProjectBindingState {
  const row=agentRecord(raw)
  if(row.version!==2||!Array.isArray(row.bindings)||Object.keys(row).some(key=>!['version','bindings'].includes(key)))throw new Error('Invalid DSH Project mappings')
  const projects=new Set<string>(),workspaces=new Set<string>()
  const bindings=row.bindings.map(rawBinding=>{
    const binding=agentRecord(rawBinding),projectId=agentIdentifier(binding.projectId),workspaceId=agentIdentifier(binding.workspaceId)
    if(Object.keys(binding).some(key=>!['projectId','workspaceId','directory'].includes(key))||typeof binding.directory!=='string'||!path.isAbsolute(binding.directory)||projects.has(projectId)||workspaces.has(workspaceId))throw new Error('Invalid DSH Project mapping identity')
    projects.add(projectId);workspaces.add(workspaceId)
    return {projectId,workspaceId,directory:binding.directory}
  })
  return {version:2,bindings}
}
/** Native workspace identity is private to DSH; BMW owns Session selection. */
export class DshProjectBindings {
  private state:DshProjectBindingState
  private saved:string|null
  constructor(private readonly file:string){
    try{this.saved=fs.readFileSync(file,'utf8');this.state=parseDshProjectBindings(JSON.parse(this.saved))}
    catch(error:unknown){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;this.saved=null;this.state={version:2,bindings:[]}}
  }
  project(project:AgentProject):DshProject {
    const binding=this.state.bindings.find(row=>row.projectId===project.id)
    if(binding&&fs.realpathSync(binding.directory)!==fs.realpathSync(project.directory))throw new Error('DSH Project directory differs from its saved mapping')
    return {...project,...(binding?{workspaceId:binding.workspaceId}:{})}
  }
  remember(project:AgentProject,workspaceId:string):void {
    agentIdentifier(workspaceId)
    const directory=fs.realpathSync(project.directory),existing=this.state.bindings.find(row=>row.projectId===project.id)
    if(existing){if(existing.workspaceId!==workspaceId||fs.realpathSync(existing.directory)!==directory)throw new Error('DSH cannot replace an existing native Workspace');return}
    const next=parseDshProjectBindings({version:2,bindings:[...this.state.bindings,{projectId:project.id,workspaceId,directory}]})
    let actual:string|null
    try{actual=fs.readFileSync(this.file,'utf8')}catch(error:unknown){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;actual=null}
    if(actual!==this.saved)throw new Error('DSH Project mappings changed in another process')
    fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700})
    const temporary=this.file+'.tmp-'+crypto.randomUUID(),content=JSON.stringify(next)+'\n'
    try{fs.writeFileSync(temporary,content,{mode:0o600,flag:'wx'});fs.renameSync(temporary,this.file);this.state=next;this.saved=content}
    finally{fs.rmSync(temporary,{force:true})}
  }
}
