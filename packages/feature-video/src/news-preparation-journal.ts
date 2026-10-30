import {assertDiagramEvidence} from './diagram-preparation.js'
import type {DiagramEvidence} from './diagram-preparation.js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {assertNewsScenePreparation,preparationId} from './news-preparation-contract.js'
import type {NewsScenePreparation} from './news-preparation-contract.js'
export interface NewsPreparationState {revision:number;enabled:boolean;originalSpeechRequired:boolean;diagrams?:DiagramEvidence[];aiFilmApproval?:{artifactId:string;sha256:string;approvedAt:string};scenes:(NewsScenePreparation&{origin:'user'|'agent';capturedRevision:number;createdAt:string})[]}
/** Separate Host-owned journal: cannot be forged by draft update/import/restore. */
export class NewsPreparationJournal {
 private root:string;private directory:string;private file:string;private identity:{dev:number;ino:number}
 constructor(directory:string,private owner:{projectId:string;sessionId:string;draftId:string}){Object.values(owner).forEach(preparationId);this.root=fs.realpathSync(directory);const s=fs.statSync(this.root);this.identity={dev:s.dev,ino:s.ino};this.directory=path.join(this.root,'video-studio','news-preparation');this.file=path.join(this.directory,owner.draftId+'.json')}
 private guard(){const s=fs.lstatSync(this.root);if(s.isSymbolicLink()||s.dev!==this.identity.dev||s.ino!==this.identity.ino||fs.realpathSync(this.root)!==this.root)throw new Error('Preparation Project changed.');for(const d of [path.dirname(this.directory),this.directory])if(fs.existsSync(d)&&(fs.lstatSync(d).isSymbolicLink()||!fs.statSync(d).isDirectory()||fs.realpathSync(d)!==d))throw new Error('Preparation directory escaped Project.')}
 read():NewsPreparationState {
  this.guard();if(!fs.existsSync(this.file))return {revision:0,enabled:false,originalSpeechRequired:false,scenes:[]}
  const s=fs.lstatSync(this.file);if(!s.isFile()||s.isSymbolicLink()||s.size>1024*1024)throw new Error('Invalid preparation journal.')
  const fd=fs.openSync(this.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let raw:unknown
  try{const pinned=fs.fstatSync(fd);if(pinned.dev!==s.dev||pinned.ino!==s.ino)throw new Error('Preparation journal changed.');const data=fs.readFileSync(fd,'utf8');if(Buffer.byteLength(data)>1024*1024)throw new Error('Preparation journal exceeds budget.');raw=JSON.parse(data)}finally{fs.closeSync(fd)}
  this.guard();const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['version','projectId','sessionId','draftId','revision','enabled','originalSpeechRequired','aiFilmApproval','scenes','diagrams'].includes(k))||v.version!==1||v.projectId!==this.owner.projectId||v.sessionId!==this.owner.sessionId||v.draftId!==this.owner.draftId||typeof v.enabled!=='boolean'||typeof v.originalSpeechRequired!=='boolean'||!Array.isArray(v.scenes)||v.scenes.length>96)throw new Error('Foreign or invalid preparation journal.')
  let aiFilmApproval:NewsPreparationState['aiFilmApproval'];if(v.aiFilmApproval!==undefined){const a=mediaRecord(v.aiFilmApproval);if(Object.keys(a).some(k=>!['artifactId','sha256','approvedAt'].includes(k))||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)||typeof a.approvedAt!=='string'||!Number.isFinite(Date.parse(a.approvedAt)))throw new Error('Invalid AI-film approval.');aiFilmApproval={artifactId:assertArtifactId(a.artifactId),sha256:a.sha256,approvedAt:a.approvedAt}}
  const scenes=v.scenes.map(raw=>{const r=mediaRecord(raw),{origin,capturedRevision,createdAt,...scene}=r;if(!['user','agent'].includes(String(origin))||typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt)))throw new Error('Invalid preparation author.');return {...assertNewsScenePreparation(scene),origin:origin as 'user'|'agent',capturedRevision:finiteNumber(capturedRevision,'captured draft revision',1,1000000,true),createdAt}})
  if(new Set(scenes.map(s=>s.sceneId)).size!==scenes.length)throw new Error('Duplicate prepared scene.');const diagrams=v.diagrams===undefined?[]:(()=>{if(!Array.isArray(v.diagrams)||v.diagrams.length>8)throw new Error('Diagram evidence budget.');return v.diagrams.map(assertDiagramEvidence)})();return {...(diagrams.length?{diagrams}:{}),revision:finiteNumber(v.revision,'checklist revision',1,1000000,true),enabled:v.enabled,originalSpeechRequired:v.originalSpeechRequired,...(aiFilmApproval?{aiFilmApproval}:{}),scenes}
 }
 save(expected:number,next:NewsPreparationState):NewsPreparationState {
  const previous=this.read();if(previous.revision!==expected)throw new Error('NEWS_PREPARATION_CONFLICT: Reload checklist revision.')
  if(previous.enabled&&!next.enabled||previous.originalSpeechRequired&&!next.originalSpeechRequired)throw new Error('NEWS_PREPARATION_POLICY: Existing preparation requirements cannot be weakened.')
  const updated={...next,revision:expected+1},encoded=JSON.stringify({version:1,...this.owner,...updated})
  if(Buffer.byteLength(encoded)>1024*1024)throw new Error('Preparation journal exceeds budget.')
  fs.mkdirSync(this.directory,{recursive:true,mode:0o700});this.guard();const temporary=path.join(this.directory,crypto.randomUUID()+'.tmp')
  try{fs.writeFileSync(temporary,encoded,{flag:'wx',mode:0o600});this.guard();if(this.read().revision!==expected)throw new Error('NEWS_PREPARATION_CONFLICT: Concurrent checklist update.');fs.renameSync(temporary,this.file)}finally{if(fs.existsSync(temporary)){this.guard();fs.unlinkSync(temporary)}}
  return this.read()
 }
}
