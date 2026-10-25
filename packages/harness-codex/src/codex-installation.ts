import fs from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import crypto from 'node:crypto'


const require=createRequire(import.meta.url)
/** Resolve the native executable from the official npm optional package. */
export function bundledCodexExecutable():string|null {
 const platform=process.platform,arch=process.arch
 const target=platform==='darwin'?(arch==='arm64'?'aarch64-apple-darwin':arch==='x64'?'x86_64-apple-darwin':null):platform==='linux'?(arch==='arm64'?'aarch64-unknown-linux-musl':arch==='x64'?'x86_64-unknown-linux-musl':null):platform==='win32'?(arch==='arm64'?'aarch64-pc-windows-msvc':arch==='x64'?'x86_64-pc-windows-msvc':null):null
 if(!target)return null
 try{const manifest=require.resolve('@openai/codex-'+platform+'-'+arch+'/package.json'),file=path.join(path.dirname(manifest),'vendor',target,'bin',platform==='win32'?'codex.exe':'codex');return fs.realpathSync(file)}catch{return null}
}

const macInstallations=[
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  '/Applications/Codex.app/Contents/Resources/codex',
  '/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
]
/** Resolve a public installed CLI, without touching any desktop account data. */
export function findCodexExecutable(options:{env?:NodeJS.ProcessEnv;installations?:readonly string[];configDirectory?:string;bundled?:string|null}={}):string|null{
  const env=options.env??process.env,explicit=env.BMW_CODEX_EXECUTABLE
  const usable=(file:string):string|null=>{
    if(!path.isAbsolute(file))return null
    try{const actual=fs.realpathSync(file),stat=fs.statSync(actual);return stat.isFile()&&(process.platform==='win32'||(stat.mode&0o111)!==0)?actual:null}catch{return null}
  }
  if(explicit){if(!path.isAbsolute(explicit))throw new Error('BMW_CODEX_EXECUTABLE must be an absolute installed CLI path');return usable(explicit)}
  const bundled=options.bundled===null?null:usable(options.bundled??bundledCodexExecutable()??'')
  if(options.configDirectory){
    const pin=path.join(options.configDirectory,'bmw-executable.json')
    let stat:fs.Stats|undefined
    try{stat=fs.lstatSync(pin)}catch(error:unknown){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    if(stat){
      if(!stat.isFile()||stat.size>8192||(typeof process.getuid==='function'&&stat.uid!==process.getuid())||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Invalid BMW Codex executable selection')
      const value:unknown=JSON.parse(fs.readFileSync(pin,'utf8'))
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!('version'in value)||value.version!==1||!('executable'in value)||typeof value.executable!=='string'||value.executable.length>4096||!path.isAbsolute(value.executable))throw new Error('Invalid BMW Codex executable selection')
      const found=usable(value.executable)
      if(bundled)return bundled
      if(!found)throw new Error('已验证的 Codex CLI 已不可用；请通过 BMW_CODEX_EXECUTABLE 指定已支持的官方 CLI。')
      return found
    }
  }
  if(bundled)return bundled
  for(const directory of (env.PATH??'').split(path.delimiter).filter(path.isAbsolute)){
    const found=usable(path.join(directory,process.platform==='win32'?'codex.exe':'codex'));if(found)return found
  }
  for(const file of options.installations??(process.platform==='darwin'?macInstallations:[])){const found=usable(file);if(found)return found}
  return null
}
/** Called only after the effective browser catalog has passed the existing gate. */
export function rememberCodexExecutable(configDirectory:string,executable:string):void{
  if(!path.isAbsolute(configDirectory)||!path.isAbsolute(executable)||executable.length>4096)throw new Error('Invalid BMW Codex executable selection')
  fs.mkdirSync(configDirectory,{recursive:true,mode:0o700})
  const file=path.join(configDirectory,'bmw-executable.json'),temporary=path.join(configDirectory,'bmw-executable-'+crypto.randomUUID()+'.tmp')
  try{fs.writeFileSync(temporary,JSON.stringify({version:1,executable:fs.realpathSync(executable)}),{mode:0o600,flag:'wx'});fs.renameSync(temporary,file)}finally{fs.rmSync(temporary,{force:true})}
}
