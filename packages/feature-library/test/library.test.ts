import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {ProjectSourceStore} from '../../platform/src/project-source-store.js'
import {LibraryService} from '../src/library-service.js'
import {LibraryStorage} from '../src/library-storage.js'
import {assertLibraryRequest} from '../src/library-contract.js'
import {assertLibrarySourcePage,librarySourceRead,librarySourceSummary} from '../src/library-source-page.js'
import type {LibraryPage} from '../src/library-contract.js'
import type {SourceObservation} from '@bmw-agent/media-native/sources'

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=','base64')
function fixture(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-library-'))),projects=['one','two','archived'].map(id=>{const directory=path.join(root,id);fs.mkdirSync(directory);return {id,name:id,directory,...(id==='archived'?{archivedAt:'2026-01-01T00:00:00Z'}:{})}}),stores=new Map(projects.map(p=>[p.id,new ProjectSourceStore(p.directory,p.id)]));let active=projects[1];const service=new LibraryService({projects:archived=>projects.filter(p=>archived||!p.archivedAt),active:()=>active,sources:id=>stores.get(id)!,guard:()=>{}});return {root,projects,stores,service,setActive:(id:string)=>{active=projects.find(p=>p.id===id)!},close:()=>fs.rmSync(root,{recursive:true,force:true})}}
function observation():SourceObservation{const scope={selector:'article',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const};return {url:'https://example.com/research',title:'Research report',author:'Original author',publishedAt:'2026-10-20',scope,text:'Unique original text with quantum results.',mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null}}
test('Global discovery includes unindexed files, body search, archive filters and independent CAS metadata',async()=>{const f=fixture();try{
 for(const p of f.projects)fs.writeFileSync(path.join(p.directory,'artifacts','unindexed.png'),png)
 await f.stores.get('one')!.collect(observation(),0)
 const all=await f.service.execute({operation:'search'},'agent') as LibraryPage;assert.ok(all.items.some(i=>i.projectId==='one'&&i.artifactId==='unindexed.png'));assert.ok(all.items.some(i=>i.projectId==='two'));assert.ok(!all.items.some(i=>i.projectId==='archived'))
 const body=await f.service.execute({operation:'search',query:'quantum',kind:'source'},'agent') as LibraryPage;assert.equal(body.total,1);assert.equal(body.items[0].title,'Research report')
 const archived=await f.service.execute({operation:'search',includeArchived:true},'user') as LibraryPage;assert.ok(archived.items.some(i=>i.archived))
 await f.service.execute({operation:'set-metadata',projectId:'one',artifactId:'unindexed.png',expectedRevision:0,metadata:{title:'Edited material',description:'Saved description',tags:['test'],favorite:true}},'user')
 const favorites=await f.service.execute({operation:'search',favorites:true},'user') as LibraryPage;assert.equal(favorites.total,1);assert.equal(favorites.items[0].title,'Edited material')
 await assert.rejects(f.service.execute({operation:'set-metadata',projectId:'one',artifactId:'unindexed.png',expectedRevision:0,metadata:{title:'stale',description:'',tags:[],favorite:false}},'user'),/LIBRARY_CONFLICT/)
 await assert.rejects(f.service.execute({operation:'read',projectId:'one',artifactId:'unindexed.png'},'agent'),/LIBRARY_COPY_REQUIRED/)
 assert.throws(()=>assertLibraryRequest({operation:'search',path:'/etc/passwd'}),/Unsupported/)
}finally{f.close()}})
test('Cross-Project copy retains source originals, media and proofs, deduplicates repeats and survives loss of the source Project',async()=>{const f=fixture();try{
 const store=f.stores.get('one')!,saved=await store.collect(observation(),0),a=saved.catalog.sources[0].acquisitions[0],id='source-preview.png';fs.writeFileSync(path.join(f.projects[0].directory,'artifacts',id),png)
 await store.recordScreenshot({sourceId:saved.sourceId,acquisitionId:saved.acquisitionId,expectedRevision:1,artifactId:id,contentId:crypto.createHash('sha256').update(png).digest('hex'),inspection:{kind:'image',contentType:'image/png',width:1,height:1,pixels:1,bytes:png.length,canDecode:true},pageUrl:observation().url,scope:observation().scope,bodyContentId:a.contentId!,capturedAt:new Date().toISOString()})
 const result=await f.service.execute({operation:'copy',projectId:'one',artifactId:id,expectedRevision:0},'user') as {copied:boolean;artifactIds:string[]};assert.equal(result.copied,true);assert.ok(result.artifactIds.includes(id));assert.ok(result.artifactIds.some(i=>i.endsWith('.json')))
 const body=await f.stores.get('two')!.readBody(saved.sourceId,saved.acquisitionId);assert.equal(body.text,observation().text);assert.equal(body.mediaAvailability[0].available,true);assert.equal(body.acquisition.capturedAt,a.capturedAt)
 const before=fs.readdirSync(path.join(f.projects[1].directory,'artifacts')).sort();await f.service.execute({operation:'copy',projectId:'one',artifactId:id,expectedRevision:1},'user');assert.deepEqual(fs.readdirSync(path.join(f.projects[1].directory,'artifacts')).sort(),before)
 fs.renameSync(f.projects[0].directory,f.projects[0].directory+'-unavailable');assert.equal((await f.stores.get('two')!.readBody(saved.sourceId,saved.acquisitionId)).text,observation().text)
}finally{f.close()}})
test('Copy rejects hash changes and collisions; pre-aborted work leaves target artifacts and catalog unchanged',async()=>{const f=fixture();try{
 const saved=await f.stores.get('one')!.collect(observation(),0),original=saved.catalog.sources[0].acquisitions[0].originalTextArtifactId!;fs.writeFileSync(path.join(f.projects[0].directory,'artifacts',original),'changed')
 await assert.rejects(f.service.execute({operation:'copy',projectId:'one',sourceId:saved.sourceId,acquisitionId:saved.acquisitionId,expectedRevision:0},'user'),/changed/);assert.equal(f.stores.get('two')!.snapshot().revision,0)
 fs.writeFileSync(path.join(f.projects[0].directory,'artifacts','same.png'),png);fs.writeFileSync(path.join(f.projects[1].directory,'artifacts','same.png'),'existing')
 await assert.rejects(f.service.execute({operation:'copy',projectId:'one',artifactId:'same.png',expectedRevision:0},'user'),/different content/);assert.equal(fs.readFileSync(path.join(f.projects[1].directory,'artifacts','same.png'),'utf8'),'existing')
 const controller=new AbortController();controller.abort(new Error('fixture cancel'));await assert.rejects(f.service.execute({operation:'copy',projectId:'one',artifactId:'same.png',expectedRevision:0},'user',controller.signal),/fixture cancel/)
}finally{f.close()}})
test('Corrupt metadata and symlinked directories stay unchanged and surface as explicit discovery issues',async()=>{const f=fixture();try{
 const storage=new LibraryStorage(f.projects[0].directory);storage.writeJson('library/catalog.json',{version:99});const file=path.join(f.projects[0].directory,'library/catalog.json'),before=fs.readFileSync(file,'utf8'),result=await f.service.execute({operation:'search'},'user') as LibraryPage;assert.ok(result.issues.some(i=>i.projectId==='one'));assert.equal(fs.readFileSync(file,'utf8'),before)
 fs.renameSync(path.join(f.projects[1].directory,'artifacts'),path.join(f.projects[1].directory,'held'));fs.symlinkSync(path.join(f.projects[1].directory,'held'),path.join(f.projects[1].directory,'artifacts'));const results=await f.service.execute({operation:'search'},'user') as LibraryPage;assert.ok(results.issues.some(i=>i.projectId==='two'))
}finally{f.close()}})
test('Cancellation after staging drains cleanup, and repeated copies preserve independently edited target metadata',async()=>{const f=fixture(),read=ArtifactJobIO.prototype.read;try{
 fs.writeFileSync(path.join(f.projects[0].directory,'artifacts','original.png'),png)
 const cancelled=new AbortController();ArtifactJobIO.prototype.read=async function(offset,length){if(this.root.includes(path.sep+'transfers'+path.sep))cancelled.abort(new Error('cancel staged output'));return read.call(this,offset,length)}
 await assert.rejects(f.service.execute({operation:'copy',projectId:'one',artifactId:'original.png',expectedRevision:0},'user',cancelled.signal),/cancel staged output/)
 assert.deepEqual(fs.readdirSync(path.join(f.projects[1].directory,'artifacts')),[]);assert.equal(f.stores.get('two')!.snapshot().revision,0)
 ArtifactJobIO.prototype.read=read
 const metadata={title:'Source title',description:'',tags:['original'],favorite:false};await f.service.execute({operation:'set-metadata',projectId:'one',artifactId:'original.png',expectedRevision:0,metadata},'user');await f.service.execute({operation:'copy',projectId:'one',artifactId:'original.png',expectedRevision:0},'user')
 await f.service.execute({operation:'set-metadata',projectId:'two',artifactId:'original.png',expectedRevision:1,metadata:{...metadata,title:'Independent target title'}},'user');await f.service.execute({operation:'copy',projectId:'one',artifactId:'original.png',expectedRevision:0},'user')
 const detail=await f.service.execute({operation:'read',projectId:'two',artifactId:'original.png'},'user') as {metadata:{title:string}};assert.equal(detail.metadata.title,'Independent target title')
 await assert.rejects(f.service.execute({operation:'recover-copies'},'agent'),/trusted user/)
}finally{ArtifactJobIO.prototype.read=read;f.close()}})
test('Date and availability filters preserve publisher precision, and supporting artifacts require an explicit filter',async()=>{const f=fixture();try{
 const saved=await f.stores.get('one')!.collect(observation(),0)
 const dated=await f.service.execute({operation:'search',kind:'source',dateBasis:'published',fromDate:'2026-10-20',toDate:'2026-10-20'},'user') as LibraryPage;assert.equal(dated.total,1)
 assert.equal((await f.service.execute({operation:'search',kind:'source',dateBasis:'published',fromDate:'2026-10-21'},'user') as LibraryPage).total,0)
 assert.throws(()=>assertLibraryRequest({operation:'search',fromDate:'2026-02-31'}),/date/);assert.throws(()=>assertLibraryRequest({operation:'search',fromDate:'2026-10-21',toDate:'2026-10-20'}),/range/)
 const frame='media-'+crypto.randomUUID()+'-frame-1.png';fs.writeFileSync(path.join(f.projects[0].directory,'artifacts',frame),png)
 assert.ok(!(await f.service.execute({operation:'search',kind:'image'},'user') as LibraryPage).items.some(i=>i.artifactId===frame));assert.ok((await f.service.execute({operation:'search',kind:'image',includeSupportFiles:true},'user') as LibraryPage).items.some(i=>i.artifactId===frame))
 const technical=['speech-'+crypto.randomUUID()+'-raw.json','speech-'+crypto.randomUUID()+'-log.json','preserved-'+crypto.randomUUID()+'-1-preservation.json'],documents=['notes.json','speech-editor-notes-log.json']
 for(const name of [...technical,...documents])fs.writeFileSync(path.join(f.projects[0].directory,'artifacts',name),'{}')
 const normal=await f.service.execute({operation:'search',kind:'text'},'user') as LibraryPage,withSupport=await f.service.execute({operation:'search',kind:'text',includeSupportFiles:true},'user') as LibraryPage
 for(const name of technical){assert.ok(!normal.items.some(i=>i.artifactId===name));assert.ok(withSupport.items.some(i=>i.artifactId===name))}
 for(const name of documents)assert.ok(normal.items.some(i=>i.artifactId===name),'Preserve user JSON documents in the normal library')
 fs.unlinkSync(path.join(f.projects[0].directory,'artifacts',saved.catalog.sources[0].acquisitions[0].originalTextArtifactId!));assert.equal((await f.service.execute({operation:'search',kind:'source',availability:'missing'},'user') as LibraryPage).total,1)
}finally{f.close()}})
test('Model source pages preserve exact UTF16 positions without returning every acquisition or candidate',async()=>{
 const text='Original 😀 evidence. '.repeat(1000),raw={source:{id:'source',url:'https://example.org',acquisitions:[{unbounded:'not exposed'}]},acquisition:{id:'acquisition',title:'Original',candidates:Array.from({length:25},(_,i)=>({id:'candidate-'+i})),media:[]},text,mediaAvailability:[]}
 const first=librarySourceRead(raw,assertLibrarySourcePage(undefined));assert.equal(first.text,text.slice(0,4000));assert.equal(first.nextOffset,4000);assert.equal(first.quoteSpans![0].startCharacter,0);assert.equal('acquisitions' in first.source,false)
 const next=librarySourceRead(raw,assertLibrarySourcePage({offset:4000}));assert.equal(next.text,text.slice(4000,8000));assert.equal(next.quoteSpans![0].endCharacter,8000)
 const candidates=librarySourceRead(raw,assertLibrarySourcePage({section:'candidates',offset:20,limit:10}));assert.ok('candidates' in candidates);assert.equal(candidates.candidates.length,5);assert.equal(candidates.nextOffset,null)
 assert.throws(()=>assertLibrarySourcePage({path:'/etc/passwd'}),/Invalid/)
 const catalog={version:1 as const,projectId:'p',revision:4,sources:Array.from({length:25},(_,i)=>({id:'s-'+i,url:'https://example.org/'+i,acquisitions:[]}))};assert.equal(librarySourceSummary(catalog).sources.length,20);assert.equal(librarySourceSummary(catalog).nextOffset,20)
})
