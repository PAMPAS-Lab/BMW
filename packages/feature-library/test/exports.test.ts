import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {Ajv} from 'ajv'
import {assertComposition} from '@bmw-agent/media-native/composition'
import type {BrowserFeatureHost} from '@bmw-agent/browser-capability/host'
import {ProjectSourceStore} from '../../platform/src/project-source-store.js'
import {VideoStudioStore} from '../../feature-video/src/studio-store.js'
import {VideoStudioService} from '../../feature-video/src/studio-service.js'
import {captureWorkExport} from '../src/export-capture.js'
import {WorkExportStore} from '../src/export-store.js'
import {assertExportsRequest,exportsRequestSchema,assertWorkExport} from '../src/export-contract.js'
import {LibraryService} from '../src/library-service.js'
import {ExportQueryService} from '../src/export-service.js'
import {copyLibraryMaterial} from '../src/library-transfer.js'
import type {LibraryPage} from '../src/library-contract.js'
import type {ExportSummary,ExportUse} from '../src/export-contract.js'
import {mediaRecord} from '@bmw-agent/media-native/contract'

function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-export-ledger-'))),projects=['one','two'].map(id=>{const directory=path.join(root,id);fs.mkdirSync(directory);fs.mkdirSync(path.join(directory,'artifacts'));return {id,name:id,directory}}),sources=new Map(projects.map(p=>[p.id,new ProjectSourceStore(p.directory,p.id)]));let active=projects[0],serial=0
 const write=(id:string,text=id)=>fs.writeFileSync(path.join(active.directory,'artifacts',id),text)
 for(const id of ['footage.mp4','voice.wav','image.png','hidden.png','track.wav','unused.png'])write(id)
 const kernel:BrowserFeatureHost={projectStore:{active:()=>active},projectSources:()=>sources.get(active.id)!,execute:async()=>({}),recordingController:{narrate:async()=>({}),compose:async()=>{const artifactId='result-'+(++serial)+'.mp4';write(artifactId);return {artifactId,durationSeconds:6}},processArtifact:async raw=>{const r=mediaRecord(raw);if(r.action==='media.encode.check')return {kind:'encoding',width:r.width,height:r.height,fps:r.fps,videoCodec:'avc',audioCodec:'aac',videoSupported:true,audioSupported:true};if(r.action==='media.image.inspect')return {kind:'image',contentType:'image/png',width:1,height:1,pixels:1,bytes:9,canDecode:true};return {durationSeconds:r.artifactId==='footage.mp4'?5:4,tracks:r.artifactId==='footage.mp4'?[{type:'video',canDecode:true,startSeconds:0,endSeconds:5},{type:'audio',canDecode:true,startSeconds:0,endSeconds:4}]:[{type:'audio',canDecode:true,startSeconds:0,endSeconds:4}]}}}}
 const library=new LibraryService({active:()=>active,projects:()=>projects,sources:id=>sources.get(id)!,guard:()=>{}}),query=new ExportQueryService(library),ledger=()=>new WorkExportStore(active.directory,active.id)
 return {root,projects,sources,kernel,library,query,ledger,write,setActive:(id:string)=>{active=projects.find(p=>p.id===id)!},close:()=>fs.rmSync(root,{recursive:true,force:true})}
}
const layer={id:'visible',title:'Visible',kind:'image',artifactId:'image.png',startSeconds:1,durationSeconds:2,x:0,y:0,width:.5,height:.5,opacity:1,zIndex:1,color:'#ffffff'}
const audio={id:'music',title:'Music',artifactId:'track.wav',startSeconds:2,durationSeconds:1,sourceStartSeconds:1,playbackRate:2,volume:.5}
const scene={title:'A',durationSeconds:6,videoArtifactId:'footage.mp4',sourceStartSeconds:1,playbackRate:2,keepSourceAudio:true,audioArtifactId:'voice.wav',voiceSegments:[{id:'voice-a',startSeconds:1,sourceStartSeconds:.5,durationSeconds:1,playbackRate:2},{id:'voice-b',startSeconds:4,sourceStartSeconds:2.5,durationSeconds:.5,playbackRate:1}],layers:[layer,{...layer,id:'hidden',artifactId:'hidden.png',hidden:true},{...layer,id:'invisible',artifactId:'unused.png',opacity:0}],audioTracks:[audio,{...audio,id:'muted',muted:true},{...audio,id:'zero',volume:0}]}
async function record(f:ReturnType<typeof fixture>,output='output.mp4') {const capture=await captureWorkExport(f.kernel,assertComposition({title:'Work',music:false,scenes:[scene]}),undefined,'fixture-renderer');f.write(output);const r=await capture.record({artifactId:output,durationSeconds:6},{draftId:'draft',sessionId:'session',revision:2,sceneIds:['scene']});const pending=f.ledger().prepare(r);pending.commit();return r}

test('Actual enabled render inputs preserve rates, segmented voice, source EOF and held frames without reference/hidden/muted adoption',async()=>{const f=fixture();try{
 const r=await record(f);assert.equal(r.uses.length,6);assert.ok(!r.uses.some(u=>u.artifactId==='hidden.png'||u.artifactId==='unused.png'))
 const main=r.uses.find(u=>u.role==='main-video')!;assert.deepEqual(main.sourceRange,{startSeconds:1,endSeconds:5});assert.deepEqual(main.outputRange,{startSeconds:0,endSeconds:6});assert.equal(main.holdFromOutputSeconds,2)
 assert.deepEqual(r.uses.find(u=>u.role==='source-audio')!.outputRange,{startSeconds:0,endSeconds:1.5})
 const voices=r.uses.filter(u=>u.role==='narration');assert.deepEqual(voices.map(u=>u.sourceRange),[{startSeconds:.5,endSeconds:2.5},{startSeconds:2.5,endSeconds:3}]);assert.equal(voices[0].playbackRate,2)
 assert.deepEqual(r.uses.find(u=>u.role==='audio-layer')!.sourceRange,{startSeconds:1,endSeconds:3})
 assert.equal(f.ledger().scan(false).records[0].compositionSha256,r.compositionSha256)
}finally{f.close()}})

test('Read-only bidirectional queries paginate and expose changed/missing output and material hashes without rewriting historical adoption',async()=>{const f=fixture();try{
 const r=await record(f),before=fs.readFileSync(path.join(f.projects[0].directory,'library/exports',r.id+'.json'))
 const uses=await f.query.execute({operation:'uses',projectId:'one',exportId:r.id,limit:2}) as {items:ExportUse[];total:number;nextOffset:number};assert.equal(uses.total,6);assert.equal(uses.nextOffset,2)
 f.write('footage.mp4','changed');const adopted=await f.query.execute({operation:'adoptions',identity:{projectId:'one',artifactId:'footage.mp4'}}) as {items:{uses:{status:string}[]}[]};assert.equal(adopted.items[0].uses[0].status,'changed')
 f.write('output.mp4','replaced');const versions=await f.query.execute({operation:'versions',projectId:'one',workId:'draft'}) as {items:{status:string}[]};assert.equal(versions.items[0].status,'changed')
 fs.unlinkSync(path.join(f.projects[0].directory,'artifacts','output.mp4'));assert.equal((await f.query.execute({operation:'versions',projectId:'one',artifactId:'output.mp4'}) as {items:{status:string}[]}).items[0].status,'missing')
 assert.deepEqual(fs.readFileSync(path.join(f.projects[0].directory,'library/exports',r.id+'.json')),before)
 const materials=await f.library.execute({operation:'search',purpose:'work'},'user') as LibraryPage;assert.equal(materials.items[0].availability,'missing');assert.equal(materials.items[0].exportVersionId,r.id)
}finally{f.close()}})

test('Only host-admitted committed copies add original Project ancestry to automatic adoption',async()=>{const f=fixture();try{
 await copyLibraryMaterial(f.library,{projectId:'two',artifactId:'not-there.png',expectedRevision:0}).then(()=>assert.fail(),()=>{})
 f.setActive('two');await copyLibraryMaterial(f.library,{projectId:'one',artifactId:'image.png',expectedRevision:0});const captured=await captureWorkExport(f.kernel,assertComposition({title:'Copy work',music:false,scenes:[{title:'Copy',durationSeconds:2,imageArtifactId:'image.png'}]}),undefined,'fixture');f.write('copy.mp4');const r=await captured.record({artifactId:'copy.mp4',durationSeconds:2});f.ledger().prepare(r).commit()
 const adopted=await f.query.execute({operation:'adoptions',identity:{projectId:'one',artifactId:'image.png'},includeArchived:true}) as {items:{export:ExportSummary;uses:ExportUse[]}[]};assert.equal(adopted.items[0].export.projectId,'two');assert.ok(adopted.items[0].uses[0].origins.some(o=>o.projectId==='one'))
 await assert.rejects(f.library.execute({operation:'read',projectId:'one',artifactId:'image.png'},'agent'),/COPY_REQUIRED/)
}finally{f.close()}})

test('Legacy exports project read-only unknown adoption; pending records need a matching owned draft receipt',async()=>{const f=fixture();try{
 const studio=new VideoStudioStore(f.projects[0].directory,'session');let d=studio.create('Old');const legacyFile=path.join(f.projects[0].directory,'video-studio',d.id+'.json');const snapshot=fs.readFileSync(legacyFile)
 d=studio.update(d.id,d.revision,{...d,scenes:[{...d.scenes[0],id:'scene',title:'A',narration:'',durationSeconds:6,visualBrief:'',sources:[],endPolicy:'hold',imageArtifactId:'image.png'}]});f.write('old.mp4');d=studio.addExport(d.id,d.revision,{artifactId:'old.mp4',durationSeconds:6});const oldBytes=fs.readFileSync(legacyFile)
 const old=await f.query.execute({operation:'versions',projectId:'one',workId:d.id}) as {items:ExportSummary[]};assert.equal(old.items[0].provenance,'legacy-unknown');assert.equal((await f.query.execute({operation:'uses',projectId:'one',exportId:old.items[0].id}) as {known:boolean}).known,false);assert.deepEqual(fs.readFileSync(legacyFile),oldBytes);assert.notDeepEqual(oldBytes,snapshot)
 const capture=await captureWorkExport(f.kernel,assertComposition({title:'New',music:false,scenes:[{title:'New',durationSeconds:6,imageArtifactId:'image.png'}]}),undefined,'fixture');f.write('new.mp4');const record=await capture.record({artifactId:'new.mp4',durationSeconds:6},{draftId:d.id,sessionId:'session',revision:d.revision,sceneIds:['scene']}),pending=f.ledger().prepare(record)
 assert.equal(f.ledger().scan(false).records.length,0);studio.addExport(d.id,d.revision,{artifactId:'new.mp4',durationSeconds:6});assert.equal(new WorkExportStore(f.projects[0].directory,'one').scan(false).summaries[0].recovered,true);pending.commit();assert.equal(f.ledger().scan(false).summaries[0].recovered,undefined)
}finally{f.close()}})

test('Studio export history remains independent beyond thirty draft receipts and cache reuse never creates another version',async()=>{const f=fixture();try{
 const studio=new VideoStudioStore(f.projects[0].directory,'session');let draft=studio.create('Versioned');draft=studio.update(draft.id,draft.revision,{...draft,scenes:[{id:'scene',title:'A',durationSeconds:6,narration:'',visualBrief:'',sources:[],endPolicy:'hold',imageArtifactId:'image.png'}]});const service=new VideoStudioService(f.kernel),owner={projectId:'one',sessionId:'session'}
 for(let i=0;i<32;i++){const result=await service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision,forceRender:true},undefined,owner,'user') as {draft:typeof draft;libraryWarning?:string};assert.equal(result.libraryWarning,undefined);draft=result.draft}
 assert.equal(draft.exports.length,30);assert.equal(f.ledger().scan(false).records.length,32)
 const before=fs.readdirSync(path.join(f.projects[0].directory,'artifacts')).sort(),reused=await service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision},undefined,owner,'user') as {reused:boolean};assert.equal(reused.reused,true);assert.deepEqual(fs.readdirSync(path.join(f.projects[0].directory,'artifacts')).sort(),before);assert.equal(f.ledger().scan(false).records.length,32)
 const grouped=await f.library.execute({operation:'search',purpose:'work',groupWorks:true},'user') as LibraryPage;assert.equal(grouped.total,1);assert.equal(grouped.items[0].workVersionCount,32)
 const page=await f.query.execute({operation:'versions',projectId:'one',workId:draft.id,offset:20}) as {items:unknown[];total:number};assert.equal(page.total,32);assert.equal(page.items.length,12)
 studio.delete(draft.id,draft.revision);assert.equal(f.ledger().scan(false).records.length,32)
}finally{f.close()}})

test('Cancelled, changed-input and corrupt-ledger paths preserve old work, report unverified adoption and never mint a false committed record',async()=>{const f=fixture();try{
 const abort=new AbortController();abort.abort();await assert.rejects(captureWorkExport(f.kernel,assertComposition({title:'A',scenes:[{title:'A',durationSeconds:2,imageArtifactId:'image.png'}]}),abort.signal,'fixture'))
 const capture=await captureWorkExport(f.kernel,assertComposition({title:'A',scenes:[{title:'A',durationSeconds:2,imageArtifactId:'image.png'}]}),undefined,'fixture');f.write('image.png','changed');f.write('out.mp4');await assert.rejects(capture.record({artifactId:'out.mp4',durationSeconds:2}),/INPUT_CHANGED/);assert.equal(f.ledger().scan(false).records.length,0)
 const r=await record(f),file=path.join(f.projects[0].directory,'library/exports',r.id+'.json');fs.writeFileSync(file,'{"broken":');const original=fs.readFileSync(file);assert.ok(f.ledger().scan().issues.length);assert.deepEqual(fs.readFileSync(file),original)
 fs.unlinkSync(file);fs.symlinkSync(path.join(f.projects[0].directory,'artifacts','image.png'),file);assert.ok(f.ledger().scan().issues.length);assert.equal(fs.lstatSync(file).isSymbolicLink(),true)
 const copied=assertWorkExport(r,'one');copied.uses[0].outputRange.endSeconds=100;assert.throws(()=>assertWorkExport(copied,'one'),/timeline/)
}finally{f.close()}})

test('Ledger admission failure preserves successful Studio work while CAS failure removes only the uncommitted output',async()=>{const f=fixture();try{
 const studio=new VideoStudioStore(f.projects[0].directory,'session');let draft=studio.create('Preserved');draft=studio.update(draft.id,draft.revision,{...draft,scenes:[{id:'scene',title:'A',durationSeconds:6,narration:'',visualBrief:'',sources:[],endPolicy:'hold',imageArtifactId:'image.png'}]});const service=new VideoStudioService(f.kernel),owner={projectId:'one',sessionId:'session'}
 const directory=path.join(f.projects[0].directory,'library');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'exports'),'retained-corruption')
 const result=await service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision},undefined,owner,'user') as {draft:typeof draft;libraryWarning?:string};assert.ok(result.libraryWarning);draft=result.draft;assert.equal(draft.exports.length,1);assert.ok(fs.existsSync(path.join(f.projects[0].directory,'artifacts',draft.exports[0].artifactId)));assert.equal(fs.readFileSync(path.join(directory,'exports'),'utf8'),'retained-corruption')
 fs.unlinkSync(path.join(directory,'exports'));const oldExport=draft.exports[0].artifactId,before=fs.readFileSync(path.join(f.projects[0].directory,'artifacts',oldExport)),original=f.kernel.recordingController.compose
 f.kernel.recordingController.compose=async(...args)=>{const value=await original(...args);studio.update(draft.id,draft.revision,{...draft,title:'GUI edit'});return value}
 await assert.rejects(service.execute({operation:'render',draftId:draft.id,expectedRevision:draft.revision,forceRender:true},undefined,owner,'user'),/CONFLICT/);assert.equal(studio.read(draft.id).title,'GUI edit');assert.deepEqual(fs.readFileSync(path.join(f.projects[0].directory,'artifacts',oldExport)),before);assert.equal(f.ledger().scan(false).records.length,0);assert.ok(!fs.existsSync(path.join(f.projects[0].directory,'artifacts','result-2.mp4')))
}finally{f.close()}})

test('Immutable admission refuses a target created after preparation, and damaged ledger queries keep diagnostics bounded',async()=>{const f=fixture();try{
 const captured=await captureWorkExport(f.kernel,assertComposition({title:'A',scenes:[{title:'A',durationSeconds:2,imageArtifactId:'image.png'}]}),undefined,'fixture');f.write('out.mp4');const r=await captured.record({artifactId:'out.mp4',durationSeconds:2}),pending=f.ledger().prepare(r),directory=path.join(f.projects[0].directory,'library/exports'),file=path.join(directory,r.id+'.json')
 fs.symlinkSync(path.join(f.root,'does-not-exist'),file);assert.throws(()=>pending.commit());assert.ok(fs.lstatSync(file).isSymbolicLink());pending.discard()
 fs.unlinkSync(file);for(let i=0;i<40;i++)fs.writeFileSync(path.join(directory,i.toString(16).padStart(64,'0')+'.json'),'broken')
 const response=await f.query.execute({operation:'works'}) as {items:unknown[];issues:unknown[];issuesOmitted:number};assert.equal(response.items.length,0);assert.equal(response.issues.length,20);assert.ok(response.issuesOmitted>0);assert.equal(fs.readdirSync(directory).length,40)
}finally{f.close()}})

test('Export browser queries are closed, bounded and read-only with no model export-admission route',()=>{
 const validate=new Ajv({strict:false}).compile(exportsRequestSchema);for(const r of [{operation:'works'},{operation:'versions',projectId:'one',workId:'draft'},{operation:'uses',projectId:'one',exportId:'a'.repeat(64)},{operation:'adoptions',identity:{projectId:'one',artifactId:'image.png'}}]){assert.equal(validate(r),true);assert.doesNotThrow(()=>assertExportsRequest(r))}
 for(const r of [{operation:'commit',record:{}},{operation:'works',limit:21},{operation:'uses',projectId:'one',exportId:'../file'},{operation:'versions',projectId:'one',workId:'draft',artifactId:'file'},{operation:'adoptions',identity:{projectId:'one',artifactId:'../secret'}}])assert.throws(()=>assertExportsRequest(r))
 assert.equal(crypto.createHash('sha256').update('fixture').digest('hex').length,64)
})
