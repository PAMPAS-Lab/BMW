import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {mediaRecord} from '../../media-native/src/media-contract.js'
/** Host-owned checkpoints, separate from importable Project artifacts. Artifact
 * text exports are diagnostics, never authority for source mappings or frames. */
export class ShotCheckpointStore {
 private root:string;private directory:string;private identity:{dev:number;ino:number}
 constructor(directory:string,private owner:{projectId:string;sessionId:string;draftId:string}){this.root=fs.realpathSync(directory);this.identity=fs.statSync(this.root);this.directory=path.join(this.root,'video-studio','shot-checkpoints')}
 private guard(){const s=fs.lstatSync(this.root);if(s.isSymbolicLink()||s.dev!==this.identity.dev||s.ino!==this.identity.ino||fs.realpathSync(this.root)!==this.root)throw new Error('Shot checkpoint Project changed.');for(const d of [path.dirname(this.directory),this.directory])if(fs.existsSync(d)&&(fs.lstatSync(d).isSymbolicLink()||!fs.statSync(d).isDirectory()||fs.realpathSync(d)!==d))throw new Error('Shot checkpoint directory escaped Project.')}
 private file(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid shot checkpoint ID.');return path.join(this.directory,id+'.json')}
 read(id:string):Record<string,unknown>{
  this.guard();const file=this.file(id),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let data:string
  try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>256*1024)throw new Error('Invalid shot checkpoint.');data=fs.readFileSync(fd,'utf8');if(Buffer.byteLength(data)>256*1024)throw new Error('Shot checkpoint exceeds budget.')}finally{fs.closeSync(fd)}
  this.guard();const value=mediaRecord(JSON.parse(data));if(value.projectId!==this.owner.projectId||value.sessionId!==this.owner.sessionId||value.draftId!==this.owner.draftId||value.version!==1||!Number.isSafeInteger(value.checkpointRevision)||Number(value.checkpointRevision)<1)throw new Error('Foreign or invalid shot checkpoint.');return value
 }
 save(id:string,expectedRevision:number,value:Record<string,unknown>):void{
  this.guard();fs.mkdirSync(this.directory,{recursive:true,mode:0o700});this.guard();const file=this.file(id),lock=file+'.lock',handle=fs.openSync(lock,'wx',0o600),temporary=file+'.tmp-'+crypto.randomUUID()
  try{if(expectedRevision===0?fs.existsSync(file):this.read(id).checkpointRevision!==expectedRevision)throw new Error('SHOT_CHECKPOINT_CONFLICT: Reload current progress.');const text=JSON.stringify({...value,version:1,...this.owner,checkpointRevision:expectedRevision+1});if(Buffer.byteLength(text)>256*1024)throw new Error('Shot checkpoint exceeds budget.');fs.writeFileSync(temporary,text,{flag:'wx',mode:0o600});this.guard();fs.renameSync(temporary,file)}finally{fs.closeSync(handle);this.guard();fs.rmSync(temporary,{force:true});fs.unlinkSync(lock)}
 }
}
