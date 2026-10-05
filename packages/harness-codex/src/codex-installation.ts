import fs from 'node:fs'
import path from 'node:path'

const macInstallations=[
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  '/Applications/Codex.app/Contents/Resources/codex',
  '/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
]
/** Resolve a public installed CLI, without touching any desktop account data. */
export function findCodexExecutable(options:{env?:NodeJS.ProcessEnv;installations?:readonly string[]}={}):string|null{
  const env=options.env??process.env,explicit=env.BMW_CODEX_EXECUTABLE
  const usable=(file:string):string|null=>{
    if(!path.isAbsolute(file))return null
    try{const actual=fs.realpathSync(file),stat=fs.statSync(actual);return stat.isFile()&&(process.platform==='win32'||(stat.mode&0o111)!==0)?actual:null}catch{return null}
  }
  if(explicit){if(!path.isAbsolute(explicit))throw new Error('BMW_CODEX_EXECUTABLE must be an absolute installed CLI path');return usable(explicit)}
  for(const directory of (env.PATH??'').split(path.delimiter).filter(path.isAbsolute)){
    const found=usable(path.join(directory,process.platform==='win32'?'codex.exe':'codex'));if(found)return found
  }
  for(const file of options.installations??(process.platform==='darwin'?macInstallations:[])){const found=usable(file);if(found)return found}
  return null
}
