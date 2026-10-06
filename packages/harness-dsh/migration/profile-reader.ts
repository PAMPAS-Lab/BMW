import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import {DshRuntime} from '../src/dsh-runtime.js'
import {dshConfiguration} from '../src/configuration.js'
import type {DshProject} from '../src/project-bindings.js'
import {readDshMigrationSessions} from './history.js'
import type {DshMigrationSource} from './source.js'

export interface DshProfileMigrationRead {
  profileDirectory:string
  projects:readonly (DshProject&{archivedProject?:boolean})[]
  mcpServerPath:string
  toolDefinition:{name:'browser';description:string;inputSchema:Record<string,unknown>}
}
/** Explicit cold export runs against a disposable native Home; no user input. */
export async function readDshProfileForMigration(options:DshProfileMigrationRead,signal:AbortSignal):Promise<DshMigrationSource[]> {
  const source=path.join(options.profileDirectory,'dsh-home'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-dsh-data-export-')),home=path.join(temporary,'dsh-home')
  fs.chmodSync(temporary,0o700)
  const token=crypto.randomBytes(32).toString('hex')
  let runtime:DshRuntime|undefined,cleanupFailed=false
  const server=http.createServer((request,response)=>{
    if(request.method!=='GET'||request.url!=='/tool'||request.headers.authorization!=='Bearer '+token){response.writeHead(403);response.end();return}
    response.setHeader('content-type','application/json');response.end(JSON.stringify(options.toolDefinition))
  })
  try {
    signal.throwIfAborted()
    fs.cpSync(source,home,{recursive:true,dereference:false})
    const credentials=path.join(home,'.credentials.yaml')
    if(fs.lstatSync(credentials,{throwIfNoEntry:false})?.isSymbolicLink()){
      const data=fs.readFileSync(path.join(source,'.credentials.yaml'))
      if(data.byteLength>1024*1024)throw new Error('Linked DSH credentials exceed migration budget')
      fs.unlinkSync(credentials);fs.writeFileSync(credentials,data,{mode:0o600,flag:'wx'})
    }
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
    const project=options.projects[0]
    if(!project)return []
    runtime=new DshRuntime({...dshConfiguration,productId:'bmw',dshHome:home,sourceDshHome:home,workspacePath:project.directory,workspaceTitle:project.name,mcpServerPath:options.mcpServerPath,bridgeUrl:'http://127.0.0.1:'+(server.address() as AddressInfo).port,bridgeToken:token,catalogOnly:true})
    await runtime.start();signal.throwIfAborted()
    return await readDshMigrationSessions(runtime,options.projects,dshConfiguration.presetId,signal)
  } finally {
    try{await runtime?.stopAndWait()}catch(error:unknown){cleanupFailed=true;throw error}
    finally{
      await new Promise<void>(resolve=>server.listening?server.close(()=>resolve()):resolve())
      if(!cleanupFailed)fs.rmSync(temporary,{recursive:true,force:true})
    }
  }
}
