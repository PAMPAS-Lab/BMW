import path from 'node:path'
import fs from 'node:fs'
import {assistantClient,assistantPagePath,assistantPreloadPath} from '@bmw-agent/agent-ui'
import {DshBackend} from '@bmw-agent/harness-dsh'
import {CodexBackend} from '@bmw-agent/harness-codex'
import {QoderBackend} from '@bmw-agent/harness-qoder'
import type {AgentApplicationAssembly} from '@bmw-agent/platform/assistant'

export interface BmwAgentAssemblyOptions {
  defaultDriverId?:'dsh'|'codex'|'qoder-cn'
  dsh?:{sourceHome?:string}
  codex?:{executable?:string;configDirectory?:string;model?:string}
  qoder?:{configDirectory?:string}
}
function physicalPath(directory:string):string{
  let ancestor=directory;const parts:string[]=[]
  while(!fs.existsSync(ancestor)){const parent=path.dirname(ancestor);if(parent===ancestor)throw new Error('Agent profile parent is unavailable');parts.unshift(path.basename(ancestor));ancestor=parent}
  if(!fs.statSync(ancestor).isDirectory())throw new Error('Agent profile must resolve to a directory')
  return path.join(fs.realpathSync(ancestor),...parts)
}
/** Product composition owns concrete adapters. Authentication/configuration stays driver-local. */
export function createBmwAgentAssembly(raw:BmwAgentAssemblyOptions={}):AgentApplicationAssembly {
  const options=structuredClone(raw)
  for(const value of [options.codex?.executable,options.codex?.configDirectory,options.qoder?.configDirectory])if(value!==undefined&&!path.isAbsolute(value))throw new Error('BMW drivers require absolute installation/profile paths')
  if(options.dsh?.sourceHome!==undefined&&!path.isAbsolute(options.dsh.sourceHome))throw new Error('DSH source Home must be absolute')
  return {pagePath:assistantPagePath,preloadPath:assistantPreloadPath,client:assistantClient,defaultDriverId:options.defaultDriverId??'dsh',
    createBackends(config){
      const codex={...options.codex,configDirectory:options.codex?.configDirectory??path.join(config.userDataDirectory,'agent-drivers','codex')},qoder={...options.qoder,configDirectory:options.qoder?.configDirectory??path.join(config.userDataDirectory,'agent-drivers','qoder-cn')}
      const profiles=[path.resolve(config.userDataDirectory,'dsh-home'),path.resolve(codex.configDirectory),path.resolve(qoder.configDirectory)].map(physicalPath)
      if(profiles.some((value,index)=>profiles.some((other,otherIndex)=>index!==otherIndex&&(value===other||value.startsWith(other+path.sep)))))throw new Error('BMW Agent drivers require independent profile directories')
      return [
        new DshBackend({userDataDirectory:config.userDataDirectory,sourceDshHome:options.dsh?.sourceHome,connection:config.connection,legacyConnection:config.legacyConnection,getModel:()=>config.model('dsh'),setModel:modelId=>config.setModel('dsh',modelId),settingsProject:()=>{const project=config.projects('dsh')[0];if(!project)throw new Error('DSH settings require an existing BMW Project');return project},
          project(projectId){const project=config.projects('dsh').find(row=>row.id===projectId);if(!project)throw new Error('DSH Project is no longer available');return project}}),
        new CodexBackend({...codex,connection:config.connection,getModel:()=>config.model('codex'),setModel:modelId=>config.setModel('codex',modelId),definition:config.definition}),
        new QoderBackend({...qoder,connection:config.connection,getModel:()=>config.model('qoder-cn'),setModel:modelId=>config.setModel('qoder-cn',modelId),settingsConnection:{...config.legacyConnection,nodeExecutable:config.nodeExecutable}})
      ]
    }
  }
}
