import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {mediaRecord} from '../../media-native/src/media-contract.js'
import {assertAssessmentRecord,assertProductionAssessment,assessmentRevision} from './production-assessment-contract.js'
import type {ProductionAssessmentRecord,ProductionAssessment} from './production-assessment-contract.js'
import type {VideoDraft} from './studio-contract.js'
import {productionFacts,productionHash} from './production-impact.js'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {studioId} from './studio-contract.js'
import type {VideoStudioStore} from './studio-store.js'
/** Host-owned evidence alongside the existing export-review journal. Never an editable brief field. */
export class ProductionAssessmentJournal {
 private root:string;private directory:string;private file:string;private identity:{dev:number;ino:number}
 constructor(directory:string,private owner:{projectId:string;sessionId:string;draftId:string}){studioId(owner.projectId);studioId(owner.sessionId);studioId(owner.draftId);this.root=fs.realpathSync(directory);const stat=fs.statSync(this.root);this.identity={dev:stat.dev,ino:stat.ino};this.directory=path.join(this.root,'video-studio','type-reviews');this.file=path.join(this.directory,owner.draftId+'.json')}
 private guard():void{const stat=fs.lstatSync(this.root);if(stat.isSymbolicLink()||stat.dev!==this.identity.dev||stat.ino!==this.identity.ino||fs.realpathSync(this.root)!==this.root)throw new Error('Assessment Project changed.');for(const folder of [path.dirname(this.directory),this.directory])if(fs.existsSync(folder)&&(fs.lstatSync(folder).isSymbolicLink()||fs.realpathSync(folder)!==folder))throw new Error('Assessment directory must stay in its Project.')}
 read():{revision:number;records:ProductionAssessmentRecord[]}{this.guard();if(!fs.existsSync(this.file))return {revision:0,records:[]};const stat=fs.lstatSync(this.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)throw new Error('Invalid assessment journal.');const fd=fs.openSync(this.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let raw:unknown;try{const pinned=fs.fstatSync(fd);if(pinned.dev!==stat.dev||pinned.ino!==stat.ino)throw new Error('Assessment journal changed.');raw=JSON.parse(fs.readFileSync(fd,'utf8'))}finally{fs.closeSync(fd)}this.guard();const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['version','projectId','sessionId','draftId','revision','records'].includes(k))||v.version!==1||v.projectId!==this.owner.projectId||v.sessionId!==this.owner.sessionId||v.draftId!==this.owner.draftId||!Array.isArray(v.records)||v.records.length>40)throw new Error('Foreign or invalid assessment journal.');const records=v.records.map(assertAssessmentRecord);if(new Set(records.map(r=>r.id)).size!==records.length)throw new Error('Duplicate assessment identity.');return {revision:assessmentRevision(v.revision),records}}
 append(expectedRevision:number,record:ProductionAssessmentRecord):void{const previous=this.read();if(previous.revision!==expectedRevision)throw new Error('PRODUCTION_REVIEW_CONFLICT: Reload the type review before recording.');if(previous.records.some(r=>r.id===record.id))throw new Error('Duplicate assessment identity.');const records=[...previous.records,assertAssessmentRecord(record)],encode=()=>JSON.stringify({version:1,...this.owner,revision:expectedRevision+1,records},null,2)+'\n';while(records.length>40||Buffer.byteLength(encode())>256*1024){const latestUser=records.findLast(r=>r.origin==='user'),latestAgent=records.findLast(r=>r.origin==='agent'),index=records.findIndex(r=>r!==latestUser&&r!==latestAgent);if(index<0)throw new Error('Assessment journal budget exceeded.');records.splice(index,1)}fs.mkdirSync(this.directory,{recursive:true,mode:0o700});this.guard();const temporary=path.join(this.directory,crypto.randomUUID()+'.tmp');try{fs.writeFileSync(temporary,encode(),{flag:'wx',mode:0o600});this.guard();if(this.read().revision!==expectedRevision)throw new Error('PRODUCTION_REVIEW_CONFLICT: Concurrent assessment.');fs.renameSync(temporary,this.file)}finally{if(fs.existsSync(temporary)&&fs.realpathSync(this.directory)===this.directory)fs.rmSync(temporary)}}
}
export async function productionAssessmentSnapshot(draft:VideoDraft,store:VideoStudioStore,directory:string,sourceFacts:unknown,signal?:AbortSignal){
 const facts=await productionFacts(draft,directory,signal,sourceFacts),output=store.reusableExport(draft)
 if(!output)return {fingerprint:null,exportArtifactId:null}
 const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:output.artifactId});let outputSha256:string;try{outputSha256=await io.fingerprint(signal)}finally{await io.close()}
 return {fingerprint:productionHash({contentFingerprint:facts.contentFingerprint,exportFingerprint:output.fingerprint,outputSha256}),exportArtifactId:output.artifactId}
}
export function makeProductionAssessment(draft:VideoDraft,assessment:ProductionAssessment,scope:{fingerprint:string;exportArtifactId:string},origin:'user'|'agent'):ProductionAssessmentRecord {
 const a=assertProductionAssessment(assessment),p=draft.preparation.production;if(!p)throw new Error('Choose a production type first.')
 if(origin==='agent'&&(a.listening!=='not-performed'||a.retellingAnswer.trim()||a.predictionAnswer.trim()||a.checks.some(c=>c.id==='check-5'&&c.status==='passed')))throw new Error('PRODUCTION_HUMAN_REQUIRED: Agent opinions cannot declare human listening or viewer retelling.')
 return {...a,...scope,id:crypto.randomUUID(),createdAt:new Date().toISOString(),origin,profileId:p.profileId,profileVersion:p.profileVersion}
}
export function acceptedProductionAssessment(record:ProductionAssessmentRecord|undefined,type:string):boolean{return Boolean(record&&record.origin==='user'&&record.checks.every(c=>c.status==='passed')&&record.listening==='passed'&&record.retellingAnswer.trim()&&(type==='news-brief'||record.predictionAnswer.trim()))}
