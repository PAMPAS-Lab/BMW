import {sourceState,sourceLookup,sourceBindings} from '@bmw-agent/media-native/sources'
import fs from 'node:fs'
import path from 'node:path'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {assertArtifactId,mediaRecord} from '@bmw-agent/media-native/contract'
import type {ProjectSourcePort,SourceAcquisition} from '@bmw-agent/media-native/sources'
import {MaterialIndexStore} from './material-index-store.js'
import {LibraryStorage} from './library-storage.js'
import {copyLibraryMaterial,recoverLibraryTransfers,pendingLibraryArtifacts} from './library-transfer.js'
import {assertLibraryRequest,libraryKey} from './library-contract.js'
import type {LibraryIdentity,LibraryEntry,LibraryKind,LibraryPage,LibraryQuery} from './library-contract.js'
import {WorkExportStore} from './export-store.js'
import type {ExportSummary} from './export-contract.js'
import {ProjectResearchStore} from './research-store.js'
import type {DirectionCatalog,ProjectResearch} from './research-contract.js'

export interface LibraryProject {id:string;name:string;directory:string;archivedAt?:string}
export interface LibraryServiceHost {
  projects(includeArchived:boolean):LibraryProject[]
  active():LibraryProject
  sources(projectId:string):ProjectSourcePort
  guard():void
  directions?():DirectionCatalog
}
export const libraryKind=(id:string):LibraryKind|undefined=>/\.(png|jpe?g|webp|gif)$/i.test(id)?'image':/\.(mp4|webm|mov|mkv)$/i.test(id)?'video':/\.(wav|mp3|m4a|ogg|flac)$/i.test(id)?'audio':/\.(txt|md|srt|vtt|json)$/i.test(id)?'text':undefined
const role=(id:string)=>/frame-\d+\.png$/i.test(id)?'审阅帧':/narration|tts|speech\.wav/i.test(id)?'旁白 / 语音':/\.srt$|\.vtt$/i.test(id)?'字幕':/\.json$/i.test(id)?'元数据':'素材'
export class LibraryService {
  constructor(readonly host:LibraryServiceHost){}
  project(id:string):LibraryProject {const project=this.host.projects(true).find(p=>p.id===id);if(!project)throw new Error('Unknown library Project.');return project}
  async execute(raw:unknown,actor:'agent'|'user',signal?:AbortSignal):Promise<unknown> {
    const request=assertLibraryRequest(raw);this.host.guard();signal?.throwIfAborted()
    if(request.operation==='search')return this.search(request,signal)
    if(request.operation==='recover-copies'){if(actor!=='user')throw new Error('Only the trusted user may recover copy cleanup.');const project=this.host.active();recoverLibraryTransfers(new LibraryStorage(project.directory),this.host.sources(project.id),true);return {recovered:true}}
    const project=this.project(request.projectId)
    if(request.operation==='read'){
      if(actor!=='user'&&project.id!==this.host.active().id)throw new Error('LIBRARY_COPY_REQUIRED: Copy this material to the active Project before reading content.')
      return this.read(request,signal)
    }
    if(request.operation==='copy')return copyLibraryMaterial(this,request,signal)
    if(actor!=='user'&&project.id!==this.host.active().id)throw new Error('Library metadata edits require the active Project.')
    if(project.archivedAt)throw new Error('Archived Project materials are read-only.')
    const checkedStore=new LibraryStorage(project.directory)
    if(request.artifactId){const stat=fs.lstatSync(checkedStore.file('artifacts/'+request.artifactId));if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Invalid material file.')}else{const source=sourceLookup(this.host.sources(project.id),request.sourceId!,request.acquisitionId!);if(!source)throw new Error('Unknown source acquisition.')}
    const store=checkedStore;this.host.guard();signal?.throwIfAborted()
    return {organization:store.setMetadata(libraryKey(request),request.metadata,request.expectedRevision)}
  }
  async search(query:LibraryQuery,signal?:AbortSignal):Promise<LibraryPage> {
    const projects=this.host.projects(query.includeArchived),rows:LibraryEntry[]=[],issues:LibraryPage['issues']=[]
    const sourceContinuations:NonNullable<LibraryPage['sourceContinuations']>=[]
    let searchBytes=0
    const exportBudget={remaining:32*1024*1024}
    let directions:DirectionCatalog['directions']=[]
    try{directions=this.host.directions?.().directions??[]}catch(error){issues.push({projectId:this.host.active().id,message:'关注方向暂不可读取：'+String(error)})}
    const needle=query.query.trim().toLocaleLowerCase()
    for(const project of projects){
      if(query.projectId&&query.projectId!==project.id)continue
      signal?.throwIfAborted();this.host.guard()
      try{
        const storage=new LibraryStorage(project.directory),organization=storage.organization(),pending=pendingLibraryArtifacts(storage),catalog=this.host.sources(project.id).snapshot(),index=await new MaterialIndexStore(project).snapshot(),artifacts=storage.file('artifacts/.boundary'),directory=path.dirname(artifacts)
        let exports:ExportSummary[]=[]
        try{const catalog=new WorkExportStore(project.directory,project.id).scan(true,exportBudget);exports=catalog.summaries;issues.push(...catalog.issues.map(message=>({projectId:project.id,message})))}catch(error){issues.push({projectId:project.id,message:'成品账本暂不可读取：'+String(error)})}
        if(catalog.complete===false){sourceContinuations.push({projectId:project.id,action:'library.streams',streamRequest:{operation:'sources',projectId:project.id}});issues.push({projectId:project.id,message:'来源已超出旧目录窗口；请使用来源流的稳定分页检索全部记录。'})};
        const exportByArtifact=new Map(exports.map(e=>[e.artifactId,e])),seenArtifacts=new Set<string>()
        let research:ProjectResearch|undefined
        try{research=new ProjectResearchStore(project.directory,project.id).read()}catch(error){issues.push({projectId:project.id,message:'专题关联暂不可读取，原始素材保留：'+String(error)})}
        const assignments=new Map(research?.assignments.map(a=>[libraryKey(a.identity),a])??[]),directionsByTopic=new Map<string,string[]>()
        for(const d of directions)for(const ref of d.topics)if(ref.projectId===project.id){const list=directionsByTopic.get(ref.topicId)??[];list.push(d.id);directionsByTopic.set(ref.topicId,list)}
        const organize=(entry:LibraryEntry,inheritedKey?:string)=>{const assignment=assignments.get(entry.key),grouping=assignment??(inheritedKey?assignments.get(inheritedKey):undefined);const output=entry.artifactId?exportByArtifact.get(entry.artifactId):undefined;entry.purpose=assignment?.purpose??(output?'work':entry.kind==='source'?'source':'unclassified');if(output){entry.exportWorkId=output.workId;entry.exportVersionId=output.id;entry.exportCreatedAt=output.createdAt;entry.workVersionCount=exports.filter(e=>e.workId===output.workId).length;if(!organization.records[entry.key]?.title)entry.title=output.title}entry.topicIds=grouping?.topicIds??[];entry.directionIds=[...new Set([...(grouping?.directionIds??[]),...entry.topicIds.flatMap(id=>directionsByTopic.get(id)??[])])];return entry}
        if(pending.size)issues.push({projectId:project.id,message:'LIBRARY_QUARANTINED: 有未完成的复制资源，恢复清理前不展示这些文件。'})
        const related=new Map<string,{sourceId:string;acquisition:SourceAcquisition}>()
        for(const source of catalog.sources)for(const a of source.acquisitions){
          const entry:LibraryEntry={projectId:project.id,projectName:project.name,sourceId:source.id,acquisitionId:a.id,key:libraryKey({projectId:project.id,sourceId:source.id,acquisitionId:a.id}),kind:'source',bytes:0,title:(a.title||source.url).slice(0,120),description:'',tags:[],favorite:false,modifiedAt:a.capturedAt,publishedAt:a.publishedAt,author:a.author,url:source.url,archived:Boolean(project.archivedAt),availability:a.originalTextArtifactId?'saved':'unverified',role:'网页与原文'}
          entry.metadataRevision=organization.revision;Object.assign(entry,organization.records[entry.key]??{})
          organize(entry)
          if(a.originalTextArtifactId&&!fs.existsSync(storage.file('artifacts/'+assertArtifactId(a.originalTextArtifactId))))entry.availability='missing'
          for(const id of [a.originalTextArtifactId,...a.media.map(m=>m.artifactId)].filter((id):id is string=>Boolean(id)))if(!related.has(id))related.set(id,{sourceId:source.id,acquisition:a})
          let match=!needle||[entry.title,entry.description,...entry.tags,source.url,a.author??''].some(t=>t.toLocaleLowerCase().includes(needle))
          if(!match&&a.originalTextArtifactId&&searchBytes<16*1024*1024){const file=storage.file('artifacts/'+assertArtifactId(a.originalTextArtifactId));try{const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:a.originalTextArtifactId});try{if(input.bytes<=256*1024){searchBytes+=input.bytes;match=new TextDecoder().decode(await input.read(0,input.bytes)).toLocaleLowerCase().includes(needle)}}finally{await input.close()}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')issues.push({projectId:project.id,message:'一份原文暂不可检索：'+String(error)})}void file}
          if(match&&(!query.kind||query.kind==='source')&&(!query.favorites||entry.favorite))rows.push(entry)
        }
        if(fs.existsSync(directory))for(const artifactId of fs.readdirSync(directory).sort()){
          if(pending.has(artifactId)||!query.includeSupportFiles&&/^(?:media-[a-f0-9-]+-frame-\d+\.png|source-[a-f0-9-]+\.json|video-[a-f0-9-]+\.json|speech-[a-f0-9-]+\.json|speech-[a-f0-9-]{36}-(?:raw|log)\.json|preserved-[a-f0-9-]{36}-\d+-preservation\.json)$|\.source(?:-\d+\.png|\.json)$/i.test(artifactId))continue
          const kind=libraryKind(artifactId);if(!kind||query.kind&&query.kind!==kind)continue
          try{assertArtifactId(artifactId)}catch{continue}
          const stat=fs.lstatSync(storage.file('artifacts/'+artifactId));if(!stat.isFile()||stat.isSymbolicLink())continue;seenArtifacts.add(artifactId)
          const binding=related.get(artifactId),record=index.records.find(r=>r.artifactId===artifactId),key=libraryKey({projectId:project.id,artifactId}),entry:LibraryEntry={key,projectId:project.id,projectName:project.name,artifactId,kind,bytes:stat.size,modifiedAt:stat.mtime.toISOString(),title:(record?.title&&record.title!==artifactId?record.title:binding?.acquisition.title||artifactId).slice(0,120),description:record?.description??'',tags:record?.tags??[],favorite:false,archived:Boolean(project.archivedAt),availability:'saved',role:role(artifactId),...(binding?{publishedAt:binding.acquisition.publishedAt,author:binding.acquisition.author,url:catalog.sources.find(s=>s.id===binding.sourceId)?.url}:{})}
          entry.metadataRevision=organization.revision;Object.assign(entry,organization.records[key]??{})
          organize(entry,binding?libraryKey({projectId:project.id,sourceId:binding.sourceId,acquisitionId:binding.acquisition.id}):undefined)
          let match=!needle||[entry.title,entry.description,...entry.tags,artifactId].some(t=>t.toLocaleLowerCase().includes(needle))
          if(!match&&record)for(const part of record.parts){if(searchBytes>=16*1024*1024)break;try{const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:part.evidenceArtifactId});try{if(io.bytes<=4*1024*1024){searchBytes+=io.bytes;if((await io.fingerprint(signal))===part.evidenceSha256&&new TextDecoder().decode(await io.read(0,Math.min(io.bytes,1024*1024))).toLocaleLowerCase().includes(needle)){match=true;break}}}finally{await io.close()}}catch{signal?.throwIfAborted()}}
          if(match&&(!query.favorites||entry.favorite))rows.push(entry)
        }
        if(!query.kind||query.kind==='video')for(const output of exports){if(seenArtifacts.has(output.artifactId))continue
          const entry:LibraryEntry={projectId:project.id,projectName:project.name,artifactId:output.artifactId,key:libraryKey({projectId:project.id,artifactId:output.artifactId}),kind:'video',bytes:0,modifiedAt:output.createdAt,title:output.title,description:'',tags:[],favorite:false,archived:Boolean(project.archivedAt),availability:'missing',role:'成品'}
          entry.metadataRevision=organization.revision;Object.assign(entry,organization.records[entry.key]??{});organize(entry);if((!needle||[entry.title,entry.description,...entry.tags].some(t=>t.toLocaleLowerCase().includes(needle)))&&(!query.favorites||entry.favorite))rows.push(entry)
        }
        storage.guard()
      }catch(error){signal?.throwIfAborted();issues.push({projectId:project.id,message:error instanceof Error?error.message:String(error)})}
    }
    if(searchBytes>=16*1024*1024)issues.push({projectId:query.projectId??this.host.active().id,message:'全文检索达到本次16 MiB读取预算；请缩小Project或类型范围，结果可能不完整。'})
    const dateKey=(entry:LibraryEntry)=>{if(query.dateBasis==='published')return entry.publishedAt?.slice(0,10);const date=new Date(entry.modifiedAt);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}
    let filtered=rows.filter(entry=>{const date=dateKey(entry);return (!query.purpose||entry.purpose===query.purpose)&&(!query.topicId||entry.topicIds?.includes(query.topicId))&&(!query.directionId||entry.directionIds?.includes(query.directionId))&&(!query.availability||entry.availability===query.availability)&&(!query.fromDate||date!==undefined&&date>=query.fromDate)&&(!query.toDate||date!==undefined&&date<=query.toDate)})
    filtered.sort((a,b)=>query.sort==='title'?a.title.localeCompare(b.title)||a.key.localeCompare(b.key):query.sort==='oldest'?a.modifiedAt.localeCompare(b.modifiedAt)||a.key.localeCompare(b.key):b.modifiedAt.localeCompare(a.modifiedAt)||a.key.localeCompare(b.key))
    if(query.groupWorks){const groups=new Map<string,LibraryEntry>();for(const entry of filtered){const key=entry.projectId+':'+(entry.exportWorkId??entry.key);const previous=groups.get(key);if(!previous||(entry.exportCreatedAt??entry.modifiedAt)>(previous.exportCreatedAt??previous.modifiedAt))groups.set(key,entry)}filtered=[...groups.values()]}
    this.host.guard();signal?.throwIfAborted()
    return {complete:issues.length===0,sourceContinuations,items:filtered.slice(query.offset,query.offset+query.limit),total:filtered.length,nextOffset:query.offset+query.limit<filtered.length?query.offset+query.limit:null,projects:projects.map(p=>({id:p.id,name:p.name,archived:Boolean(p.archivedAt)})),issues}
  }
  async read(identity:LibraryIdentity,signal?:AbortSignal){
    const project=this.project(identity.projectId),storage=new LibraryStorage(project.directory),organization=storage.organization(),metadata=organization.records[libraryKey(identity)]??null,sourcePort=this.host.sources(project.id)
    if(!identity.artifactId){const source=await sourcePort.readBody(identity.sourceId!,identity.acquisitionId!,signal);this.host.guard();return {identity,metadata,revision:organization.revision,source,targetSourceRevision:sourceState(this.host.sources(this.host.active().id)).revision}}
    const id=assertArtifactId(identity.artifactId)
    try{fs.lstatSync(storage.file('artifacts/'+id))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(new WorkExportStore(project.directory,project.id).scan().summaries.some(s=>s.artifactId===id))return {identity,metadata,revision:organization.revision,artifact:{artifactId:id,bytes:0,kind:libraryKind(id),missing:true},targetSourceRevision:sourceState(this.host.sources(this.host.active().id)).revision};throw error}
    const input=await ArtifactJobIO.open(path.dirname(storage.file('artifacts/'+id)),{action:'media.inspect',artifactId:id})
    try{
      const sha256=await input.fingerprint(signal),index=await new MaterialIndexStore(project).snapshot(),record=index.records.find(r=>r.artifactId===id),sources=sourceBindings(sourcePort,id).map(({source,acquisition:a})=>({sourceId:source.id,acquisitionId:a.id,title:a.title,url:source.url,publishedAt:a.publishedAt,author:a.author}))
      const text=libraryKind(id)==='text'&&input.bytes<=256*1024?new TextDecoder().decode(await input.read(0,input.bytes)):undefined
      const usage:{draftId:string;title:string}[]=[],studio=storage.file('video-studio/.boundary'),draftDirectory=path.dirname(studio)
      if(fs.existsSync(draftDirectory))for(const file of fs.readdirSync(draftDirectory).filter(f=>/^[a-zA-Z0-9-]+\.json$/.test(f)).slice(0,100)){const raw=storage.readJson('video-studio/'+file,1024*1024);if(raw&&JSON.stringify(raw).includes(JSON.stringify(id))){const d=mediaRecord(raw);if(typeof d.id==='string'&&typeof d.title==='string')usage.push({draftId:d.id,title:d.title})}}
      this.host.guard();return {identity,metadata,revision:organization.revision,artifact:{artifactId:id,bytes:input.bytes,sha256,kind:libraryKind(id)},index:record??null,indexStale:Boolean(record&&record.sha256!==sha256),sources,usage,text,targetSourceRevision:sourceState(this.host.sources(this.host.active().id)).revision}
    }finally{await input.close()}
  }
}
