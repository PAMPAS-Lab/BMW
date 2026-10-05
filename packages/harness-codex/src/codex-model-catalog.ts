import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {agentRecord} from '@bmw-agent/agent-contract'

const browserModels=new Set(['gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna'])
export function codexNeedsBrowserCatalog(model:string):boolean{return browserModels.has(model)}

/** Official startup catalog projection; model IDs, native transport and model capabilities stay intact. */
export function codexBrowserModelCatalog(raw:unknown,model:string):{models:Record<string,unknown>[]} {
  const cache=agentRecord(raw)
  if(cache.client_version!=='0.160.0'||!Array.isArray(cache.models)||!cache.models.length||cache.models.length>1000)throw new Error('Codex GPT-6 requires a current official model catalog; refresh Codex settings')
  const seen=new Set<string>()
  const models=cache.models.map(value=>{
    const row=agentRecord(value)
    if(typeof row.slug!=='string'||!row.slug||seen.has(row.slug))throw new Error('Invalid Codex model catalog identity')
    seen.add(row.slug)
    const next=structuredClone(row)
    if(browserModels.has(row.slug)){
      // Forced model tool modes override ordinary feature flags in 0.160.0.
      // Omission restores the runtime defaults, which obey BMW's disabled flags.
      delete next.tool_mode;delete next.multi_agent_version;delete next.multi_agent_reasoning_effort
      next.experimental_supported_tools=[]
    }
    return next
  })
  if(!seen.has(model))throw new Error('Selected Codex model is absent from its official catalog')
  return {models}
}

/** Content-addressed, host-owned copy. Never overwrite the official cache or a foreign/symlinked file. */
export function materializeCodexBrowserCatalog(configDirectory:string,model:string):string|undefined {
  if(!codexNeedsBrowserCatalog(model))return undefined
  const source=path.join(configDirectory,'models_cache.json')
  if(!fs.existsSync(source)||!fs.lstatSync(source).isFile()||fs.lstatSync(source).isSymbolicLink()||fs.statSync(source).size>8*1024*1024)throw new Error('Codex GPT-6 requires a current official model catalog; refresh Codex settings')
  const bytes=Buffer.from(JSON.stringify(codexBrowserModelCatalog(JSON.parse(fs.readFileSync(source,'utf8')),model)))
  const directory=path.join(configDirectory,'bmw-browser-catalogs')
  fs.mkdirSync(directory,{recursive:true,mode:0o700})
  if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink())throw new Error('Invalid BMW Codex catalog directory')
  const file=path.join(directory,crypto.createHash('sha256').update(bytes).digest('hex')+'.json')
  if(fs.existsSync(file)){
    if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||!fs.readFileSync(file).equals(bytes))throw new Error('BMW Codex browser catalog changed after publication')
  }else fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600})
  return file
}
