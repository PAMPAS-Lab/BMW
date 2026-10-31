import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { CodexRpc } from './codex-rpc.js'

/** Retention accounting only. Native history, Project evidence and resume anchors are never rewritten. */
interface ContextState {version:1;binding:string;scopeHash:string;guideHash:string;imageBytes:number;images:number;instructionBytes:number;maintenancePending?:boolean}
export function legacyCodexContextHeavy(thread:Record<string,unknown>):boolean{
  if(typeof thread.path!=='string'||!path.isAbsolute(thread.path)||!/^rollout-.*\.jsonl$/.test(path.basename(thread.path)))return false
  const stat=fs.lstatSync(thread.path)
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Invalid official Codex rollout metadata')
  return stat.size>=8*1024*1024
}
export class CodexContextLedger {
  private readonly file:string
  private state:ContextState
  readonly legacy:boolean
  constructor(directory:string,projectId:string,sessionId:string,anchor:string){
    const binding=crypto.createHash('sha256').update(JSON.stringify([projectId,sessionId,anchor])).digest('hex')
    this.file=path.join(directory,'bmw-context',binding+'.json')
    if(fs.existsSync(path.dirname(this.file))&&fs.lstatSync(path.dirname(this.file)).isSymbolicLink())throw new Error('Invalid Codex context directory')
    this.state={version:1,binding,scopeHash:'',guideHash:'',imageBytes:0,images:0,instructionBytes:0}
    this.legacy=!fs.existsSync(this.file)
    if(!this.legacy){
      const stat=fs.lstatSync(this.file)
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw new Error('Invalid Codex context ledger')
      const row:unknown=JSON.parse(fs.readFileSync(this.file,'utf8'))
      if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Invalid Codex context ledger')
      const value=row as Record<string,unknown>
      if(value.version!==1||value.binding!==binding||!['scopeHash','guideHash'].every(key=>typeof value[key]==='string'&&/^(?:[a-f0-9]{64})?$/.test(value[key] as string))||!['imageBytes','images','instructionBytes'].every(key=>Number.isSafeInteger(value[key])&&(value[key] as number)>=0))throw new Error('Invalid Codex context ledger')
      this.state=value as unknown as ContextState
      if(value.maintenancePending!==undefined&&typeof value.maintenancePending!=='boolean')throw new Error('Invalid Codex context ledger')
      if(this.state.maintenancePending)throw new Error('Codex context maintenance has an unconfirmed result; inspect the official receipt before explicitly recovering, never replay automatically')
    }
  }
  needsCompaction(resumed:boolean,legacyHeavy=true):boolean{return resumed&&(this.legacy&&legacyHeavy||this.state.images>=24||this.state.imageBytes>=6*1024*1024||this.state.instructionBytes>=48*1024)}
  maintenanceStarted():void{this.state.maintenancePending=true;this.save()}
  static hash(text:string):string{return crypto.createHash('sha256').update(text).digest('hex')}
  instructions(scope:string,guide:string):string|null{
    const scopeHash=CodexContextLedger.hash(scope),guideHash=CodexContextLedger.hash(guide)
    if(this.state.scopeHash===scopeHash&&this.state.guideHash===guideHash)return null
    return (this.state.guideHash===guideHash?'':guide+'\n')+scope
  }
  acknowledged(scope:string,guide:string,bytes:number):void{
    this.state.scopeHash=CodexContextLedger.hash(scope);this.state.guideHash=CodexContextLedger.hash(guide)
    this.state.instructionBytes+=bytes;this.save()
  }
  compacted():void{this.state={...this.state,scopeHash:'',guideHash:'',imageBytes:0,images:0,instructionBytes:0,maintenancePending:false};this.save()}
  imagesDelivered(images:readonly {data:string}[]):void{
    this.state.images+=images.length;this.state.imageBytes+=images.reduce((total,image)=>total+Buffer.byteLength(image.data),0);this.save()
  }
  private save():void{
    const directory=path.dirname(this.file);fs.mkdirSync(directory,{recursive:true,mode:0o700})
    if(fs.lstatSync(directory).isSymbolicLink())throw new Error('Invalid Codex context directory')
    const temporary=this.file+'.'+crypto.randomUUID()+'.tmp'
    try{fs.writeFileSync(temporary,JSON.stringify(this.state)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temporary,this.file)}finally{fs.rmSync(temporary,{force:true})}
  }
}

/** Official runtime owns summarization and history replacement. No input or tool replay. */
export async function compactCodexContext(rpc:CodexRpc,threadId:string,signal:AbortSignal,observe:(phase:'compaction.started'|'compaction.completed')=>void):Promise<void>{
  signal.throwIfAborted()
  let resolve!:()=>void,reject!:(error:Error)=>void
  const completed=new Promise<void>((yes,no)=>{resolve=yes;reject=no});void completed.catch(()=>{})
  const abort=()=>reject(new Error('Codex context maintenance cancelled'))
  const timer=setTimeout(()=>reject(new Error('Codex context maintenance did not settle; input not dispatched')),180000)
  const unsubscribe=rpc.onNotification((method,raw)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return
    const value=raw as Record<string,unknown>
    if(value.threadId!==threadId||method!=='turn/completed')return
    const turn=value.turn as {status?:unknown}|undefined
    if(turn?.status==='completed')resolve();else reject(new Error('Codex context maintenance failed; input not dispatched'))
  })
  signal.addEventListener('abort',abort,{once:true})
  try{observe('compaction.started');await rpc.call('thread/compact/start',{threadId});await completed;signal.throwIfAborted();observe('compaction.completed')}
  finally{clearTimeout(timer);unsubscribe();signal.removeEventListener('abort',abort)}
}
