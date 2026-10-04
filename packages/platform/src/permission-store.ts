import fs from 'node:fs'
import path from 'node:path'
import {readStateFile, stateRecord} from './state-load.js'

interface PermissionState {agentControlGranted: boolean; sites: Record<string, Record<string, boolean>>}
function validate(raw: unknown): PermissionState {
  const value = stateRecord(raw)
  if (value.version !== undefined && value.version !== 1) throw new Error('Unsupported permission state version.')
  if (typeof value.agentControlGranted !== 'boolean') throw new Error('Invalid saved Agent permission.')
  const sites = stateRecord(value.sites)
  for (const permissions of Object.values(sites)) {
    if (Object.values(stateRecord(permissions)).some(allowed => typeof allowed !== 'boolean')) throw new Error('Invalid saved site permission.')
  }
  return {agentControlGranted: value.agentControlGranted, sites: sites as PermissionState['sites']}
}
export class PermissionStore {
  private state: PermissionState
  constructor(readonly filePath: string) {
    this.state = readStateFile(filePath, validate) ?? {agentControlGranted: false, sites: {}}
  }
  #save(next: PermissionState): void {
    fs.mkdirSync(path.dirname(this.filePath), {recursive: true})
    const temporary = `${this.filePath}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), {mode: 0o600})
    fs.renameSync(temporary, this.filePath)
    this.state = next
  }
  hasAgentControl(): boolean {return this.state.agentControlGranted}
  grantAgentControl(): void {this.#save({...this.state, agentControlGranted: true})}
  revokeAgentControl(): void {this.#save({...this.state, agentControlGranted: false})}
  getSitePermission(origin: string, permission: string): boolean | undefined {return this.state.sites[origin]?.[permission]}
  setSitePermission(origin: string, permission: string, allowed: boolean): void {
    if (!origin || !permission || typeof allowed !== 'boolean') throw new TypeError('Invalid site permission update.')
    const next = structuredClone(this.state)
    Object.defineProperty(next.sites, origin, {value: {...next.sites[origin], [permission]: allowed}, enumerable: true, writable: true, configurable: true})
    this.#save(next)
  }
  snapshot(): PermissionState {return structuredClone(this.state)}
}
