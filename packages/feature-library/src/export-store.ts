import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {assertArtifactId,finiteNumber,mediaRecord} from '@bmw-agent/media-native/contract'
import {sourceId} from '@bmw-agent/media-native/sources'
import {LibraryStorage} from './library-storage.js'
import {assertWorkExport,exportSummary,exportDate,exportSha} from './export-contract.js'
import type {WorkExport,ExportSummary} from './export-contract.js'
import {researchText} from './research-contract.js'

export const workExportId=(projectId:string,workId:string,artifactId:string)=>crypto.createHash('sha256').update(JSON.stringify([projectId,workId,artifactId])).digest('hex')
export interface ExportCatalog {records:WorkExport[];summaries:ExportSummary[];issues:string[]}
/** Host-only append-only export admission; no browser write operation exposes this. */
export class WorkExportStore {
 private storage:LibraryStorage
 constructor(directory:string,readonly projectId:string){sourceId(projectId);this.storage=new LibraryStorage(directory)}
 private relative(id:string,pending=false){return 'library/exports/'+(pending?'pending-':'')+exportSha(id)+'.json'}
 prepare(value:WorkExport):{commit():void;discard():void}{
  const record=assertWorkExport(value,this.projectId);if(record.id!==workExportId(record.projectId,record.workId,record.artifactId))throw new Error('Export ledger identity mismatch.')
  const relative=this.relative(record.id,true),committed=this.storage.readJson(this.relative(record.id))
  if(committed!==undefined){if(JSON.stringify(assertWorkExport(committed,this.projectId))!==JSON.stringify(record))throw new Error('Immutable export already exists.');return {commit(){},discard(){}}}
  const directory=path.dirname(this.storage.file(relative,true));if(fs.readdirSync(directory).filter(n=>/^(?:pending-)?[a-f0-9]{64}\.json$/.test(n)).length>=4096)throw new Error('Export ledger capacity reached; completed outputs are preserved.')
  const old=this.storage.readJson(relative);if(old!==undefined&&JSON.stringify(assertWorkExport(old,this.projectId))!==JSON.stringify(record))throw new Error('Export pending identity collision.')
  if(old===undefined)this.storage.writeJson(relative,record)
  const file=this.storage.file(relative),pinned=fs.lstatSync(file)
  return {commit:()=>{this.storage.guard();const current=fs.lstatSync(this.storage.file(relative));if(current.dev!==pinned.dev||current.ino!==pinned.ino||current.isSymbolicLink())throw new Error('Export pending file changed.');if(JSON.stringify(assertWorkExport(this.storage.readJson(relative),this.projectId))!==JSON.stringify(record))throw new Error('Export pending record changed.');const target=this.storage.file(this.relative(record.id));fs.linkSync(file,target);fs.unlinkSync(file);this.storage.guard()},discard:()=>{this.storage.guard();try{const current=fs.lstatSync(this.storage.file(relative));if(current.dev!==pinned.dev||current.ino!==pinned.ino||current.isSymbolicLink())throw new Error('Export pending cleanup identity changed.');fs.unlinkSync(file)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}}
 }
 private draftReceipt(record:WorkExport):boolean{
  if(!record.draftId)return false
  const raw=this.storage.readJson('video-studio/'+record.draftId+'.json',1024*1024);if(raw===undefined)return false
  const d=mediaRecord(raw),owner=d.version===1?d.ownerSessionId:mediaRecord(d.owner).sessionId,rows=d.version===1?d.exports:mediaRecord(d.records).exports
  return d.id===record.draftId&&owner===record.sessionId&&Array.isArray(rows)&&rows.some(raw=>{const r=mediaRecord(raw);return r.artifactId===record.artifactId&&r.revision===record.draftRevision})
 }
 scan(includeLegacy=true,budget={remaining:32*1024*1024}):ExportCatalog{
  let omitted=0
  const records:WorkExport[]=[],summaries:ExportSummary[]=[],issues:string[]=[],warn=(message:string)=>{if(issues.length<20)issues.push(message);else omitted++},directory=path.dirname(this.storage.file('library/exports/.boundary'))
  if(fs.existsSync(directory)){
   const names=fs.readdirSync(directory).filter(n=>/^(?:pending-)?[a-f0-9]{64}\.json$/.test(n)).sort();if(names.length>4096)throw new Error('Export ledger exceeds its bounded capacity; originals preserved.')
   for(const name of names){try{const size=fs.lstatSync(this.storage.file('library/exports/'+name)).size;if(size>budget.remaining){warn('Export metadata scan budget reached; results are incomplete.');break}budget.remaining-=size;const r=assertWorkExport(this.storage.readJson('library/exports/'+name),this.projectId);if(r.id!==workExportId(r.projectId,r.workId,r.artifactId)||name!==(name.startsWith('pending-')?'pending-':'')+r.id+'.json')throw new Error('Export record identity mismatch.');if(name.startsWith('pending-')){if(records.some(x=>x.id===r.id))continue;if(!this.draftReceipt(r)){warn('Uncommitted export is retained: '+r.artifactId);continue}}records.push(r);summaries.push(exportSummary(r,name.startsWith('pending-')))}catch(error){warn(name+': '+String(error))}}
  }
  if(includeLegacy){const directory=path.dirname(this.storage.file('video-studio/.boundary'));if(fs.existsSync(directory))for(const name of fs.readdirSync(directory).filter(n=>/^[a-zA-Z0-9-]+\.json$/.test(n)).slice(0,100)){try{
   const size=fs.lstatSync(this.storage.file('video-studio/'+name)).size;if(size>budget.remaining){warn('Legacy export scan budget reached; results are incomplete.');break}budget.remaining-=size;const d=mediaRecord(this.storage.readJson('video-studio/'+name,1024*1024));if(d.version!==1&&(d.format!=='bmw.video'||!/^2\.(?:[0-9]|10)$/.test(String(d.schemaVersion))))continue
   const draftId=sourceId(d.id);if(name!==draftId+'.json')throw new Error('Legacy export draft identity mismatch.')
   const session=d.version===1?d.ownerSessionId:mediaRecord(d.owner).sessionId,title=researchText(d.version===1?d.title:mediaRecord(d.content).title,120,true),rows=d.version===1?d.exports:mediaRecord(d.records).exports;if(!Array.isArray(rows)||rows.length>30)throw new Error('Invalid legacy export journal.')
   for(const raw of rows){const r=mediaRecord(raw),artifactId=assertArtifactId(r.artifactId);if(summaries.some(s=>s.artifactId===artifactId))continue;const createdAt=exportDate(r.createdAt),draftRevision=finiteNumber(r.revision,'legacy export revision',1,1000000,true);summaries.push({id:crypto.createHash('sha256').update(JSON.stringify([this.projectId,draftId,artifactId,createdAt,draftRevision])).digest('hex'),projectId:this.projectId,workId:draftId,draftId,sessionId:session===undefined?null:sourceId(session),draftRevision,title,createdAt,artifactId,outputSha256:null,durationSeconds:finiteNumber(r.durationSeconds,'legacy duration',.001,721),provenance:'legacy-unknown',useCount:null})}
  }catch(error){warn('Legacy '+name+': '+String(error))}}}
  if(omitted)issues.push(String(omitted)+' further export issues omitted; results may be incomplete.')
  this.storage.guard();return {records,summaries,issues}
 }
}
