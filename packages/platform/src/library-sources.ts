import fs from 'node:fs'
import path from 'node:path'
import type {ProjectSourcePort} from '@bmw-agent/media-native/sources'
import {ProjectSourceStore} from './project-source-store.js'

/** Global discovery must not initialize or repair another Project's directories. */
export function librarySourcePort(project:{id:string;directory:string},writable:boolean):ProjectSourcePort {
 if(writable)return new ProjectSourceStore(project.directory,project.id)
 const root=path.resolve(project.directory),identity=fs.lstatSync(root),directory=path.join(root,'sources'),artifacts=path.join(root,'artifacts')
 if(identity.isSymbolicLink()||!identity.isDirectory()||fs.realpathSync(root)!==root)throw new Error('Invalid library Project directory.')
 const guard=()=>{const current=fs.lstatSync(root);if(current.dev!==identity.dev||current.ino!==identity.ino||current.isSymbolicLink()||fs.realpathSync(root)!==root)throw new Error('Library Project changed.')}
 const deny=():never=>{throw new Error('Foreign Project sources are read-only; copy to the active Project first.')}
 const sourceDirectory=()=>{try{return fs.lstatSync(directory)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}}
 let source:ProjectSourceStore|undefined
 if(sourceDirectory()){
  for(const name of [directory,artifacts]){const stat=fs.lstatSync(name);if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(name)!==name)throw new Error('Library source directory unavailable; original preserved.')}
  source=new ProjectSourceStore(root,project.id)
 }
 return {
  state(){guard();return source?.state()??{projectId:project.id,revision:0}},
  lookup(sid,aid){guard();return source?.lookup(sid,aid)},
  hasSource(sid){guard();return source?.hasSource(sid)??false},
  search(request){guard();return source?.search(request)??{items:[],nextCursor:null,snapshotRevision:0,latestRevision:0,scanned:0,complete:true}},
  snapshot(){guard();if(source)return source.snapshot();if(sourceDirectory())throw new Error('Source catalog appeared; reload the library.');return {version:1,projectId:project.id,revision:0,sources:[]}},
  async readBody(sourceId,acquisitionId,signal){guard();if(!source)throw new Error('Source acquisition not found in this Project.');return source.readBody(sourceId,acquisitionId,signal)},
  collect:deny,confirm:deny,recordMedia:deny
 }
}

/** Lease checks also surround asynchronous DOM reads before their writes commit. */
export function collectionSourcePort(project:{id:string;directory:string},guard:()=>void,allowVideo=false):ProjectSourcePort {
 const port=new ProjectSourceStore(project.directory,project.id,guard)
 const deny=():never=>{throw new Error('Background source mutation is unavailable')}
 return {
  state(){guard();return port.state()},
  lookup(sourceId,acquisitionId){guard();return port.lookup(sourceId,acquisitionId)},
  hasSource(sourceId){guard();return port.hasSource(sourceId)},
  search(request){guard();return port.search(request)},
  snapshot(){guard();return port.snapshot()},
  collect(observation,revision,signal){guard();return port.collect(observation,revision,signal)},
  readBody(sourceId,acquisitionId,signal){guard();return port.readBody(sourceId,acquisitionId,signal)},
  confirm(...args){guard();return allowVideo?port.confirm(...args):deny()},recordMedia(...args){guard();return allowVideo?port.recordMedia(...args):deny()}
 }
}
