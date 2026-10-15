import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {assertExportReviewVerdict} from './export-review-contract.js'
import type {ExportReviewVerdict} from './export-review-contract.js'
import {studioId} from './studio-contract.js'
export interface ExportReviewFrame {index:number;artifactId:string;sha256:string;seconds:number}
export interface ExportReviewAssessment {status:'passed'|'needs-fix';notes:string;createdAt:string;sequence?:number}
export interface ExportReviewScene {sceneId:string;signature:string;totalSamples:number;frames:ExportReviewFrame[];agent?:ExportReviewAssessment;user?:ExportReviewAssessment}
export interface ExportReviewSnapshot {fingerprint:string;artifactId:string;createdAt:string;scenes:ExportReviewScene[];agent?:ExportReviewAssessment;user?:ExportReviewAssessment}
interface Journal {version:2;draftId:string;ownerSessionId:string;exports:ExportReviewSnapshot[]}
const LIMIT=2*1024*1024
function hash(v:unknown):string {if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new Error('Invalid export review fingerprint.');return v}
function assessment(raw:unknown,version:1|2):ExportReviewAssessment|undefined {
 if(raw===undefined)return undefined
 const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['status','notes','createdAt',...(version===2?['sequence']:[])].includes(k))||typeof v.createdAt!=='string'||!Number.isFinite(Date.parse(v.createdAt)))throw new Error('Invalid export review assessment.')
 const a=assertExportReviewVerdict({exportFingerprint:'0'.repeat(64),scope:'scene',status:v.status,notes:v.notes});return {status:a.status,notes:a.notes,createdAt:v.createdAt,...(v.sequence===undefined?{}:{sequence:finiteNumber(v.sequence,'review assessment sequence',1,Number.MAX_SAFE_INTEGER,true)})}
}
/** A Host-only side journal, not writable Video Document fields. Keeps eight
 * exports; summaries never infer that generating PNGs means visual approval. */
export class ExportReviewJournal {
 private readonly directory:string
 constructor(private root:string,private draftId:string,private ownerSessionId:string){studioId(draftId);studioId(ownerSessionId);this.directory=path.join(root,'export-reviews')}
 private guard():void {if(fs.realpathSync(this.root)!==this.root||fs.lstatSync(this.root).isSymbolicLink())throw new Error('Export review Project changed.');if(fs.existsSync(this.directory)&&(fs.lstatSync(this.directory).isSymbolicLink()||!fs.lstatSync(this.directory).isDirectory()||fs.realpathSync(this.directory)!==this.directory))throw new Error('Export review journal escaped its Project.')}
 private read():Journal {
  this.guard();const file=path.join(this.directory,this.draftId+'.json')
  if(!fs.existsSync(file))return {version:2,draftId:this.draftId,ownerSessionId:this.ownerSessionId,exports:[]}
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>LIMIT)throw new Error('Invalid export review journal file.')
  const v=mediaRecord(JSON.parse(fs.readFileSync(file,'utf8')))
  if(Object.keys(v).some(k=>!['version','draftId','ownerSessionId','exports'].includes(k))||(v.version!==1&&v.version!==2)||v.draftId!==this.draftId||v.ownerSessionId!==this.ownerSessionId||!Array.isArray(v.exports)||v.exports.length>8)throw new Error('Invalid or foreign export review journal.')
  const version=v.version
  const seen=new Set<string>(),exports:ExportReviewSnapshot[]=v.exports.map(raw=>{
   const e=mediaRecord(raw);if(Object.keys(e).some(k=>!['fingerprint','artifactId','createdAt','scenes','agent','user'].includes(k))||!Array.isArray(e.scenes)||e.scenes.length>24||typeof e.createdAt!=='string'||!Number.isFinite(Date.parse(e.createdAt)))throw new Error('Invalid export review snapshot.')
   const fingerprint=hash(e.fingerprint);if(seen.has(fingerprint))throw new Error('Duplicate export review fingerprint.');seen.add(fingerprint)
   const sequences=new Set<number>(),readAssessment=(raw:unknown)=>{const a=assessment(raw,version);if(a?.sequence!==undefined){if(sequences.has(a.sequence))throw new Error('Duplicate export review assessment sequence.');sequences.add(a.sequence)}return a}
   const ids=new Set<string>(),scenes=e.scenes.map(raw=>{
    const s=mediaRecord(raw);if(Object.keys(s).some(k=>!['sceneId','signature','totalSamples','frames','agent','user'].includes(k))||!Array.isArray(s.frames)||s.frames.length>24)throw new Error('Invalid export review scene.')
    const sceneId=studioId(s.sceneId),totalSamples=finiteNumber(s.totalSamples,'review sample count',0,24,true);if(ids.has(sceneId))throw new Error('Duplicate review scene.');ids.add(sceneId)
    const indices=new Set<number>(),frames=s.frames.map(raw=>{const f=mediaRecord(raw);if(Object.keys(f).some(k=>!['index','artifactId','sha256','seconds'].includes(k)))throw new Error('Invalid review frame proof.');const index=finiteNumber(f.index,'review sample index',0,totalSamples-1,true);if(indices.has(index))throw new Error('Duplicate review sample.');indices.add(index);return {index,artifactId:assertArtifactId(f.artifactId),sha256:hash(f.sha256),seconds:finiteNumber(f.seconds,'review frame time',0,180)}})
    return {sceneId,signature:hash(s.signature),totalSamples,frames,...(s.agent===undefined?{}:{agent:readAssessment(s.agent)}),...(s.user===undefined?{}:{user:readAssessment(s.user)})}
   })
   return {fingerprint,artifactId:assertArtifactId(e.artifactId),createdAt:e.createdAt,scenes,...(e.agent===undefined?{}:{agent:readAssessment(e.agent)}),...(e.user===undefined?{}:{user:readAssessment(e.user)})}
  })
  return {version:2,draftId:this.draftId,ownerSessionId:this.ownerSessionId,exports}
 }
 private save(snapshot:ExportReviewSnapshot):void {
  const state=this.read();state.exports=[...state.exports.filter(e=>e.fingerprint!==snapshot.fingerprint),snapshot].slice(-8)
  const encoded=JSON.stringify(state);if(Buffer.byteLength(encoded)>LIMIT)throw new Error('Export review journal exceeds 2 MiB.')
  this.guard();fs.mkdirSync(this.directory,{recursive:true,mode:0o700});this.guard()
  const target=path.join(this.directory,this.draftId+'.json');if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw new Error('Export review journal cannot be a link.')
  const temporary=path.join(this.directory,crypto.randomUUID()+'.tmp')
  try{fs.writeFileSync(temporary,encoded,{flag:'wx',mode:0o600});this.guard();fs.renameSync(temporary,target)}catch(error){try{fs.rmSync(temporary,{force:true})}catch{}throw error}
 }
 current(snapshot:ExportReviewSnapshot):ExportReviewSnapshot {
  const old=this.read().exports.find(e=>e.fingerprint===snapshot.fingerprint)
  if(!old)return structuredClone(snapshot)
  if(old.artifactId!==snapshot.artifactId||old.scenes.length!==snapshot.scenes.length||old.scenes.some((s,i)=>s.sceneId!==snapshot.scenes[i].sceneId||s.signature!==snapshot.scenes[i].signature||s.totalSamples!==snapshot.scenes[i].totalSamples))throw new Error('Export review manifest changed within its fingerprint.')
  return old
 }
 recordFrames(snapshot:ExportReviewSnapshot,sceneId:string,frames:ExportReviewFrame[]):void {
  const current=this.current(snapshot),scene=current.scenes.find(s=>s.sceneId===sceneId);if(!scene)throw new Error('Unknown review scene.')
  for(const f of frames){if(f.index<0||f.index>=scene.totalSamples||!Number.isInteger(f.index))throw new Error('Invalid actual review sample.');scene.frames=scene.frames.filter(old=>old.index!==f.index);scene.frames.push(structuredClone(f))}
  scene.frames.sort((a,b)=>a.index-b.index);this.save(current)
 }
 recordVerdict(snapshot:ExportReviewSnapshot,raw:ExportReviewVerdict,sceneId:string|undefined,actor:'agent'|'user',valid:ReadonlyMap<string,ReadonlySet<number>>):void {
  const verdict=assertExportReviewVerdict(raw);if(verdict.exportFingerprint!==snapshot.fingerprint)throw new Error('STUDIO_REVIEW_STALE: 成片指纹已变化，请重新审片。')
  const current=this.current(snapshot),complete=(s:ExportReviewScene)=>s.totalSamples>0&&valid.get(s.sceneId)?.size===s.totalSamples
  if(actor==='agent'&&verdict.status==='passed'){
   if(verdict.scope==='scene'){const scene=current.scenes.find(s=>s.sceneId===sceneId);if(!scene||!complete(scene))throw new Error('STUDIO_REVIEW_INCOMPLETE: 请先取得当前镜头全部关键状态，再提交模型视觉判断。')}
   else if(!current.scenes.length||current.scenes.some(s=>!complete(s)||s.agent?.status!=='passed'))throw new Error('STUDIO_REVIEW_INCOMPLETE: 整片模型判断要求每个镜头的当前取帧完整且已单独审阅。')
  }
  const target=verdict.scope==='film'?current:current.scenes.find(s=>s.sceneId===sceneId);if(!target)throw new Error('Unknown review scene.')
  const sequence=finiteNumber(Math.max(0,...[current.agent,current.user,...current.scenes.flatMap(s=>[s.agent,s.user])].map(a=>a?.sequence??0))+1,'review assessment sequence',1,Number.MAX_SAFE_INTEGER,true)
  target[actor]={status:verdict.status,notes:verdict.notes,createdAt:new Date().toISOString(),sequence};this.save(current)
 }
 status(snapshot:ExportReviewSnapshot,valid:ReadonlyMap<string,ReadonlySet<number>>){
  const history=this.read().exports,current=this.current(snapshot),previous=[...history].reverse().find(e=>e.fingerprint!==snapshot.fingerprint)
  const scenes=current.scenes.map(s=>{const indices=valid.get(s.sceneId)??new Set<number>(),complete=s.totalSamples>0&&indices.size===s.totalSamples,missingReviewOffsets=[0,8,16].filter(offset=>offset<s.totalSamples&&Array.from({length:Math.min(8,s.totalSamples-offset)},(_,i)=>offset+i).some(i=>!indices.has(i)));return {sceneId:s.sceneId,totalSamples:s.totalSamples,generatedCurrentFrames:indices.size,frameGenerationComplete:complete,missingReviewOffsets,agent:s.agent?{...s.agent,status:s.agent.status==='passed'&&!complete?'needs-recheck':s.agent.status,authority:'agent-declared'}:{status:'pending',authority:'agent-declared'},user:s.user?{...s.user,authority:'user-declared'}:{status:'pending',authority:'user-declared'}}})
  const changedSceneIds=current.scenes.filter(s=>previous?.scenes.find(old=>old.sceneId===s.sceneId)?.signature!==s.signature).map(s=>s.sceneId),unchangedSceneIds=current.scenes.filter(s=>!changedSceneIds.includes(s.sceneId)).map(s=>s.sceneId),complete=scenes.length>0&&scenes.every(s=>s.frameGenerationComplete&&s.agent.status==='passed')
  // Sequence keeps declaration order even when the wall clock repeats or moves
  // backwards. Legacy same-time declarations conservatively require recheck.
  const laterSceneAssessment=(actor:'agent'|'user')=>{const film=current[actor];return film?.status==='passed'&&current.scenes.some(s=>{const scene=s[actor];if(!scene)return false;if(scene.sequence!==undefined)return film.sequence===undefined||scene.sequence>film.sequence;if(film.sequence!==undefined)return false;return Date.parse(scene.createdAt)>=Date.parse(film.createdAt)})}
  return {exportFingerprint:snapshot.fingerprint,sourceArtifactId:snapshot.artifactId,scenes,agent:current.agent?{...current.agent,status:current.agent.status==='passed'&&(!complete||laterSceneAssessment('agent'))?'needs-recheck':current.agent.status,authority:'agent-declared'}:{status:'pending',authority:'agent-declared'},user:current.user?{...current.user,status:laterSceneAssessment('user')?'needs-recheck':current.user.status,authority:'user-declared'}:{status:'pending',authority:'user-declared'},plan:{previousArtifactId:previous?.artifactId??null,changedSceneIds,unchangedSceneIds,reviewSceneOrder:[...changedSceneIds,...unchangedSceneIds],requiresFullFilmReview:true,reuseOldFrames:false},coverageMeaning:'Generated actual export samples; model/user assessments are separate declarations, not automatic semantic or audio certification.'}
 }
}
