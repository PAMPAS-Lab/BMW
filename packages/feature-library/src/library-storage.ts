import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {mediaRecord} from '@bmw-agent/media-native/contract'
import {assertLibraryMetadata} from './library-contract.js'
import type {LibraryMetadata} from './library-contract.js'

export interface Organization {version:1;revision:number;records:Record<string,LibraryMetadata>}
/** All paths here are host-selected, bounded descendants of a registered Project. */
export class LibraryStorage {
  readonly root:string
  private identity:{dev:number;ino:number}
  private directories=new Map<string,{dev:number;ino:number}>()
  constructor(directory:string) {
    this.root=path.resolve(directory)
    const stat=fs.lstatSync(this.root)
    if(stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(this.root)!==this.root)throw new Error('Invalid library Project directory.')
    this.identity={dev:stat.dev,ino:stat.ino}
  }
  guard():void {const stat=fs.lstatSync(this.root);if(stat.dev!==this.identity.dev||stat.ino!==this.identity.ino||stat.isSymbolicLink()||fs.realpathSync(this.root)!==this.root)throw new Error('Library Project changed.');for(const [directory,identity]of this.directories){const current=fs.lstatSync(directory);if(current.isSymbolicLink()||!current.isDirectory()||current.dev!==identity.dev||current.ino!==identity.ino||fs.realpathSync(directory)!==directory)throw new Error('Library directory identity changed.')}}
  file(relative:string,create=false):string {
    this.guard()
    const file=path.resolve(this.root,relative)
    if(!file.startsWith(this.root+path.sep))throw new Error('Library path escaped Project.')
    const components=path.relative(this.root,path.dirname(file)).split(path.sep).filter(Boolean)
    let directory=this.root
    for(const component of components){directory=path.join(directory,component);if(!fs.existsSync(directory)){if(!create)return file;fs.mkdirSync(directory,{mode:0o700})}const stat=fs.lstatSync(directory);if(stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(directory)!==directory)throw new Error('Library directory changed.');if(!this.directories.has(directory))this.directories.set(directory,{dev:stat.dev,ino:stat.ino})}
    if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('Library symbolic link denied.')
    this.guard();return file
  }
  readJson(relative:string,maximum=4*1024*1024):unknown|undefined {
    const file=this.file(relative)
    let stat:fs.Stats
    try{stat=fs.lstatSync(file)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw new Error('Invalid library record; original preserved.')
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
    try{const pinned=fs.fstatSync(fd);if(pinned.dev!==stat.dev||pinned.ino!==stat.ino||pinned.size>maximum)throw new Error('Library record changed.');const buffer=Buffer.alloc(pinned.size);let offset=0;while(offset<buffer.length){const bytes=fs.readSync(fd,buffer,offset,buffer.length-offset,offset);if(!bytes)throw new Error('Library record truncated.');offset+=bytes}const after=fs.fstatSync(fd),named=fs.lstatSync(file);if(after.size!==pinned.size||after.mtimeMs!==pinned.mtimeMs||after.ctimeMs!==pinned.ctimeMs||named.dev!==pinned.dev||named.ino!==pinned.ino||named.isSymbolicLink())throw new Error('Library record changed.');this.guard();return JSON.parse(buffer.toString('utf8'))}finally{fs.closeSync(fd)}
  }
  writeJson(relative:string,value:unknown):void {
    const file=this.file(relative,true),text=JSON.stringify(value,null,2)+'\n'
    if(Buffer.byteLength(text)>4*1024*1024)throw new Error('Library metadata budget exceeded.')
    const temporary=this.file(path.join(path.dirname(relative),'.'+crypto.randomUUID()+'.tmp'),true)
    try{const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}this.guard();this.file(relative);fs.renameSync(temporary,file)}finally{this.guard();if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
  }
  organization():Organization {
    const raw=this.readJson('library/catalog.json')
    if(raw===undefined)return {version:1,revision:0,records:{}}
    const v=mediaRecord(raw),records=mediaRecord(v.records)
    if(v.version!==1||!Number.isSafeInteger(v.revision)||Number(v.revision)<0||Object.keys(v).some(k=>!['version','revision','records'].includes(k))||Object.keys(records).length>20000)throw new Error('Invalid library organization; original preserved.')
    const parsed:Record<string,LibraryMetadata>={}
    for(const [key,value] of Object.entries(records)){if(key.length>400||['__proto__','constructor','prototype'].includes(key))throw new Error('Invalid library key.');parsed[key]=assertLibraryMetadata(value)}
    return {version:1,revision:Number(v.revision),records:parsed}
  }
  setMetadata(key:string,value:LibraryMetadata,revision:number):Organization {
    const state=this.organization();if(state.revision!==revision)throw new Error('LIBRARY_CONFLICT: Reload material metadata.')
    const next:Organization={...state,revision:revision+1,records:{...state.records,[key]:assertLibraryMetadata(value)}}
    if(next.revision>1000000||Object.keys(next.records).length>20000)throw new Error('Library organization budget exceeded; original preserved.')
    this.writeJson('library/catalog.json',next);return next
  }
}
