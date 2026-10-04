import path from 'node:path'
import type { AgentDriver } from '@bmw-agent/agent-contract'
import { DshRuntime } from './dsh-runtime.js'
import { BMW_DSH_BASELINE, DshHarnessPort } from './harness-port.js'
import { resolveDshHome } from './dsh-preset.js'
import { dshClient } from './dsh-client.js'
const root=path.resolve(import.meta.dirname,'..')
export const dshConfiguration=Object.freeze({presetId:'bmw',patchPath:path.join(root,'dsh/base.patch.yml'),presetSourcePath:path.join(root,'dsh/preset/base')})
function identifier(value:unknown):string|null{
 if(value==null)return null
 if(typeof value!=='string'||!value||value.length>4096)throw new Error('Invalid saved DSH binding')
 return value
}
export function migrateDshProjectMetadata(project:Record<string,unknown>):Record<string,unknown>{
 const result={...project}
 const bindings=project.agentBindings&&typeof project.agentBindings==='object'&&!Array.isArray(project.agentBindings)?{...project.agentBindings as Record<string,unknown>}:{}
 if(!Object.hasOwn(bindings,'dsh')&&(Object.hasOwn(project,'dshWorkspaceId')||Object.hasOwn(project,'dshSessionId'))){
  bindings.dsh={workspaceId:identifier(project.dshWorkspaceId),sessionId:identifier(project.dshSessionId)}
 }
 result.agentBindings=bindings
 delete result.dshWorkspaceId;delete result.dshSessionId
 return result
}
export const dshDriver:AgentDriver=Object.freeze({
 id:'dsh',label:'DSH',baseline:BMW_DSH_BASELINE,preloadPath:path.join(root,'preload/bmw-preload.cjs'),client:dshClient,
 migrateProjectMetadata:migrateDshProjectMetadata,
 migrateSettings(settings){const result={...settings};if(result.agentSidebarVisible===undefined)result.agentSidebarVisible=settings.dshSidebarVisible===true;delete result.dshSidebarVisible;return result},
 createRuntime(config){
  return new DshHarnessPort(new DshRuntime({...dshConfiguration,...config,dshHome:path.join(config.userDataDirectory,'dsh-home'),sourceDshHome:resolveDshHome()}))
 }
})
