import path from 'node:path'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {WorkExportStore} from './export-store.js'
import {assertExportsRequest} from './export-contract.js'
import type {ExportSummary,WorkExport,ExportUse} from './export-contract.js'
import type {LibraryService,LibraryProject} from './library-service.js'
import {libraryKey} from './library-contract.js'
import type {LibraryIdentity} from './library-contract.js'
export class ExportQueryService {
 constructor(private library:LibraryService){}
 async execute(raw:unknown,signal?:AbortSignal):Promise<unknown>{
  const r=assertExportsRequest(raw);signal?.throwIfAborted();this.library.host.guard()
  const projects='projectId' in r&&r.projectId?[this.library.project(r.projectId)]:this.library.host.projects('includeArchived' in r&&r.includeArchived),issues:{projectId:string;message:string}[]=[],all:{project:LibraryProject;summary:ExportSummary;record?:WorkExport}[]=[],budget={remaining:32*1024*1024}
  for(const project of projects){signal?.throwIfAborted();this.library.host.guard();try{const catalog=new WorkExportStore(project.directory,project.id).scan(true,budget);issues.push(...catalog.issues.map(message=>({projectId:project.id,message})));const records=new Map(catalog.records.map(x=>[x.id,x]));for(const summary of catalog.summaries)all.push({project,summary,record:records.get(summary.id)})}catch(error){issues.push({projectId:project.id,message:String(error)})}}
  const issuesOmitted=Math.max(0,issues.length-20);issues.splice(20)
  const cache=new Map<string,Promise<{status:string;bytes?:number}>>()
  const check=(project:LibraryProject,id:string,sha:string|null)=>{const key=project.id+':'+id+':'+sha;let task=cache.get(key);if(!task){task=(async()=>{signal?.throwIfAborted();let io:ArtifactJobIO|undefined;try{io=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:id});return {status:sha===null?'legacy-unknown':await io.fingerprint(signal)===sha?'available':'changed',bytes:io.bytes}}catch(error){signal?.throwIfAborted();return {status:(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'unavailable'}}finally{await io?.close();this.library.host.guard()}})();cache.set(key,task)}return task}
  const checked=async(row:typeof all[number])=>({...row.summary,projectName:row.project.name,archived:Boolean(row.project.archivedAt),...await check(row.project,row.summary.artifactId,row.summary.outputSha256)})
  const finish=(items:unknown[],total:number)=>{signal?.throwIfAborted();this.library.host.guard();return {items,total,nextOffset:r.offset+r.limit<total?r.offset+r.limit:null,issues,issuesOmitted}}
  if(r.operation==='works'){
   const groups=new Map<string,(typeof all)>();for(const row of all){const key=row.project.id+':'+row.summary.workId,list=groups.get(key)??[];list.push(row);groups.set(key,list)}
   const rows=[...groups.values()].map(list=>list.sort((a,b)=>b.summary.createdAt.localeCompare(a.summary.createdAt)||b.summary.id.localeCompare(a.summary.id))).sort((a,b)=>b[0].summary.createdAt.localeCompare(a[0].summary.createdAt))
   const items:unknown[]=[];for(const list of rows.slice(r.offset,r.offset+r.limit))items.push({workId:list[0].summary.workId,projectId:list[0].project.id,versionCount:list.length,latest:await checked(list[0])});return finish(items,rows.length)
  }
  if(r.operation==='versions'){
   const workId=r.workId??all.find(x=>x.summary.artifactId===r.artifactId)?.summary.workId,rows=all.filter(x=>x.summary.workId===workId).sort((a,b)=>a.summary.createdAt.localeCompare(b.summary.createdAt)||a.summary.id.localeCompare(b.summary.id)),items:unknown[]=[]
   for(const row of [...rows].reverse().slice(r.offset,r.offset+r.limit))items.push({...await checked(row),versionNumber:rows.indexOf(row)+1});return finish(items,rows.length)
  }
  if(r.operation==='uses'){
   const row=all.find(x=>x.summary.id===r.exportId);if(!row)throw new Error('Unknown saved export version.')
   const uses=row.record?.uses??[],items:unknown[]=[];for(const use of uses.slice(r.offset,r.offset+r.limit))items.push({...use,...await check(row.project,use.artifactId,use.sha256)})
   return {...finish(items,uses.length),export:await checked(row),known:row.summary.provenance==='recorded',...(row.summary.provenance==='legacy-unknown'?{reason:'旧成品没有导出时的采用快照；没有从当前草稿反推。'}:{})}
  }
  const target=r.identity;this.library.project(target.projectId)
  const matches=(row:typeof all[number],use:ExportUse)=>{const local=target.projectId===row.project.id&&(target.artifactId?use.artifactId===target.artifactId:use.sources.some(s=>s.sourceId===target.sourceId&&s.acquisitionId===target.acquisitionId));return local||use.origins.some(id=>libraryKey(id)===libraryKey(target))}
  const rows=all.flatMap(row=>{const uses=row.record?.uses.filter(use=>matches(row,use))??[];return uses.length?[{...row,uses}]:[]}).sort((a,b)=>b.summary.createdAt.localeCompare(a.summary.createdAt)),items:unknown[]=[]
  for(const row of rows.slice(r.offset,r.offset+r.limit)){const uses=row.uses;items.push({export:await checked(row),useCount:uses.length,uses:await Promise.all(uses.slice(0,20).map(async use=>({...use,...await check(row.project,use.artifactId,use.sha256)}))),usesNextOffset:uses.length>20?20:null})}
  return {...finish(items,rows.length),identity:target,legacyAdoption:'unknown; legacy exports are never inferred from current draft references'}
 }
}
export type {LibraryIdentity}
