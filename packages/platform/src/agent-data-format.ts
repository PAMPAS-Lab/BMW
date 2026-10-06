import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import {readStateFile,stateRecord,StateLoadError} from './state-load.js'

export const AGENT_DATA_VERSION=2 as const
export const AGENT_DATA_MARKER='agent-data-version.json'
const agentFiles=['projects.json','global-settings.json','agent-conversations.json','agent-preferences.json','scheduled-tasks.json','agent-history']
/** A marker commits the explicit migration. Normal startup never converts state. */
export function requireCurrentAgentData(directory:string):void {
  const file=path.join(directory,AGENT_DATA_MARKER)
  const marker=readStateFile(file,raw=>{
    const row=stateRecord(raw)
    if(row.version!==AGENT_DATA_VERSION||Object.keys(row).some(key=>!['version'].includes(key)))throw new Error('Incomplete or unsupported BMW Agent data migration')
    return row
  })
  if(marker)return
  if(agentFiles.some(name=>fs.existsSync(path.join(directory,name))))throw new StateLoadError(file,new Error('This Profile requires explicit migration: npm run migrate:agent-data -- --profile <Profile path> --apply'))
  fs.mkdirSync(directory,{recursive:true,mode:0o700})
  fs.writeFileSync(file,JSON.stringify({version:AGENT_DATA_VERSION})+'\n',{flag:'wx',mode:0o600})
}

/** Normal startup and explicit migration share one Profile mutation lock. */
export function acquireAgentDataLock(directory:string):()=>void {
  fs.mkdirSync(directory,{recursive:true,mode:0o700})
  const file=path.join(directory,'agent-data-lock.json')
  const nonce=crypto.randomUUID(),content=JSON.stringify({pid:process.pid,nonce})+'\n'
  for(let attempt=0;attempt<2;attempt++){
    try{fs.writeFileSync(file,content,{flag:'wx',mode:0o600});return ()=>{if(fs.readFileSync(file,'utf8')!==content)throw new Error('BMW Profile lock ownership changed');fs.unlinkSync(file)}}
    catch(error:unknown){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
      const saved=fs.readFileSync(file,'utf8'),row=stateRecord(JSON.parse(saved))
      if(!Number.isSafeInteger(row.pid)||Number(row.pid)<1||typeof row.nonce!=='string')throw new StateLoadError(file,new Error('Invalid BMW Profile lock'))
      try{process.kill(Number(row.pid),0);throw new Error('This BMW Profile is in use; stop the application before migration')}
      catch(probe:unknown){if((probe as NodeJS.ErrnoException).code!=='ESRCH')throw probe}
      if(fs.readFileSync(file,'utf8')!==saved)throw new Error('BMW Profile lock changed during stale-owner recovery')
      fs.unlinkSync(file)
    }
  }
  throw new Error('Could not acquire BMW Profile lock')
}
