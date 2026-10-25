import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFile} from 'node:child_process'
import {agentRecord} from '@bmw-agent/agent-contract'

export const codexVerifiedProtocolVersions:readonly string[]=Object.freeze(['0.160.0','0.160.1'])
export function codexSupportsProtocolVersion(value:unknown):value is string{return typeof value==='string'&&codexVerifiedProtocolVersions.includes(value)}
// A shared official profile may have been refreshed by a newer desktop client.
// This is a data-format admission list, not permission to run that CLI version.
const verifiedCacheVersions:readonly string[]=Object.freeze([...codexVerifiedProtocolVersions,'0.164.0'])

const browserModels=new Set(['gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna'])
export function codexNeedsBrowserCatalog(model:string):boolean{return browserModels.has(model)}

/** Official startup catalog projection; model IDs, native transport and model capabilities stay intact. */
export function codexBrowserModelCatalog(raw:unknown,model:string):{models:Record<string,unknown>[]} {
  const cache=agentRecord(raw)
  if(typeof cache.client_version!=='string'||!verifiedCacheVersions.includes(cache.client_version)||!Array.isArray(cache.models)||!cache.models.length||cache.models.length>1000)throw new Error('Codex GPT-6 requires a current official model catalog with a supported cache format (detected '+String(cache.client_version)+'); refresh Codex settings or update BMW cache compatibility')
  const seen=new Set<string>()
  const models=cache.models.map(value=>{
    const row=agentRecord(value)
    if(typeof row.slug!=='string'||!row.slug||seen.has(row.slug))throw new Error('Invalid Codex model catalog identity')
    seen.add(row.slug)
    const next=structuredClone(row)
    if(browserModels.has(row.slug)){
      // Forced model tool modes override ordinary feature flags in the verified 0.160.0/0.160.1 runtimes.
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
export function materializeCodexBrowserCatalog(configDirectory:string,model:string,officialCatalog?:unknown):string|undefined {
  if(!codexNeedsBrowserCatalog(model))return undefined
  const source=path.join(configDirectory,'models_cache.json')
  if(officialCatalog===undefined&&(!fs.existsSync(source)||!fs.lstatSync(source).isFile()||fs.lstatSync(source).isSymbolicLink()||fs.statSync(source).size>8*1024*1024))throw new Error('Codex GPT-6 requires a current official model catalog; refresh Codex settings')
  const bytes=Buffer.from(JSON.stringify(codexBrowserModelCatalog(officialCatalog??JSON.parse(fs.readFileSync(source,'utf8')),model)))
  const directory=path.join(configDirectory,'bmw-browser-catalogs')
  fs.mkdirSync(directory,{recursive:true,mode:0o700})
  if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink())throw new Error('Invalid BMW Codex catalog directory')
  const file=path.join(directory,crypto.createHash('sha256').update(bytes).digest('hex')+'.json')
  if(fs.existsSync(file)){
    if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||!fs.readFileSync(file).equals(bytes))throw new Error('BMW Codex browser catalog changed after publication')
  }else fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600})
  return file
}

/** The selected official CLI owns catalog refresh; a shared cache may belong to a different CLI. No model turn is created. */
export async function refreshCodexBrowserCatalog(executable:string,configDirectory:string,model:string,protocolVersion:string,signal:AbortSignal):Promise<string|undefined>{
  if(!codexNeedsBrowserCatalog(model))return undefined
  if(!codexSupportsProtocolVersion(protocolVersion))throw new Error('Unverified Codex catalog runtime')
  signal.throwIfAborted()
  const stdout=await new Promise<string>((resolve,reject)=>execFile(executable,['debug','models'],{cwd:configDirectory,env:{...process.env,CODEX_HOME:configDirectory},signal,timeout:30000,maxBuffer:8*1024*1024},(error,output)=>error?reject(new Error('Official Codex model catalog refresh failed')):resolve(output)))
  signal.throwIfAborted()
  const catalog=agentRecord(JSON.parse(stdout))
  return materializeCodexBrowserCatalog(configDirectory,model,{client_version:protocolVersion,models:catalog.models})
}

/** Reuse only raw catalog metadata within this Host process. The effective
 * single-browser proof and live account/config checks still run independently.
 * A changed CLI/config fingerprint, expiry or modified projection forces refresh. */
export class CodexCatalogRefreshCache {
  private readonly entries=new Map<string,{file:string|undefined;sha:string;until:number}>()
  constructor(private readonly now:()=>number=Date.now,private readonly ttlMs=5*60*1000){}
  clear():void{this.entries.clear()}
  async get(key:string,refresh:()=>Promise<string|undefined>,signal:AbortSignal):Promise<string|undefined>{
    signal.throwIfAborted()
    const prior=this.entries.get(key),hash=(file:string|undefined)=>file?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):''
    if(prior&&prior.until>this.now()){
      try{if(!prior.file||fs.lstatSync(prior.file).isFile()&&!fs.lstatSync(prior.file).isSymbolicLink())if(hash(prior.file)===prior.sha)return prior.file}catch{/* A missing or changed projection is never admitted from cache. */}
    }
    this.entries.delete(key)
    const file=await refresh();signal.throwIfAborted()
    this.entries.set(key,{file,sha:hash(file),until:this.now()+this.ttlMs})
    if(this.entries.size>16)this.entries.delete(this.entries.keys().next().value!)
    return file
  }
}
