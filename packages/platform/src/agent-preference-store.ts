import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { agentIdentifier, agentRecord } from '@bmw-agent/agent-contract'
import { readStateFile } from './state-load.js'
interface Preferences { version: 2; selections: { projectId: string; driverId: string }[];models?:{driverId:string;modelId:string}[] }
export function parseAgentPreferences(raw: unknown): Preferences {
  const value = agentRecord(raw, 'BMW Agent preferences')
  if (value.version !== 2 || !Array.isArray(value.selections) || Object.keys(value).some(key => !['version', 'selections','models'].includes(key))) throw new Error('Invalid BMW Agent preferences')
  const ids = new Set<string>()
  const selections = value.selections.map(rawRow => {
    const row = agentRecord(rawRow), projectId = agentIdentifier(row.projectId), driverId = agentIdentifier(row.driverId)
    if (ids.has(projectId) || Object.keys(row).some(key => !['projectId', 'driverId'].includes(key)) || !/^[a-z0-9-]{1,64}$/u.test(driverId)) throw new Error('Invalid selected BMW Agent')
    ids.add(projectId); return { projectId, driverId }
  })
  const modelDrivers=new Set<string>()
  if(value.models!==undefined&&(!Array.isArray(value.models)||value.models.length>1000))throw new Error('Invalid Agent model preferences')
  const models=(value.models as unknown[]|undefined)?.map(rawRow=>{
    const row=agentRecord(rawRow),driverId=agentIdentifier(row.driverId),modelId=agentIdentifier(row.modelId)
    if(modelDrivers.has(driverId)||!/^[a-z0-9-]{1,64}$/u.test(driverId)||Object.keys(row).some(key=>!['driverId','modelId'].includes(key)))throw new Error('Invalid Agent model preference')
    modelDrivers.add(driverId);return {driverId,modelId}
  })
  return { version: 2, selections,...(models?{models}:{}) }
}
export class AgentPreferenceStore {
  private state: Preferences
  constructor(private readonly file: string, private readonly defaultDriverId: string) {
    agentIdentifier(defaultDriverId)
    this.state = readStateFile(file, parseAgentPreferences) ?? { version: 2, selections: [] }
  }
  get(projectId: string): string { agentIdentifier(projectId); return this.state.selections.find(row => row.projectId === projectId)?.driverId ?? this.defaultDriverId }
  set(projectId: string, driverId: string): void {
    this.save({ ...this.state, selections: [...this.state.selections.filter(row => row.projectId !== projectId), { projectId, driverId }] })
  }
  model(driverId:string):string|null{return this.state.models?.find(row=>row.driverId===driverId)?.modelId??null}
  setModel(driverId:string,modelId:string):void{this.save({...this.state,models:[...(this.state.models??[]).filter(row=>row.driverId!==driverId),{driverId,modelId}]})}
  private save(raw:Preferences):void{
    const next=parseAgentPreferences(raw)
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = this.file + '.tmp-' + crypto.randomUUID()
    try { fs.writeFileSync(temporary, JSON.stringify(next) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, this.file); this.state = next }
    finally { fs.rmSync(temporary, { force: true }) }
  }
}
