import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import path from 'node:path'
import {ProjectSourceStore} from '../src/project-source-store.js'
import {assertSourceRequest,assertSourceCitation,assertSourceCatalog,assertSourceMediaAvailability,assertSourceCaptureEvidence} from '@bmw-agent/media-native/sources'
import {assertTextReadBatch,assertTextReadDiagnostic} from '@bmw-agent/media-native/sources'
import type {TextReadBatch,TextReadDiagnostic} from '@bmw-agent/media-native/sources'
import {DatabaseSync} from 'node:sqlite'
import type {SourceObservation} from '@bmw-agent/media-native/sources'
function fixture(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-source-contract-'))),store=new ProjectSourceStore(root,'p');return {root,store,close:()=>fs.rmSync(root,{recursive:true,force:true})}}
function observation(url='https://example.com/article'):SourceObservation {const scope={selector:'article',index:0,excludeSelectors:['.recommendation','.avatar'],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const};return {url,title:'Original',author:null,publishedAt:null,scope,text:'来源原文😀：事实与观点分别呈现。',mediaScope:scope,mediaTruncated:false,candidates:[{kind:'image',url:'https://example.com/original.png',durationSeconds:null,role:'body'}],access:'unknown',accessText:'',result:'observed',error:null}}
test('Body metadata witnesses persist beside originals while old acquisitions stay unchanged and invalid witnesses cannot be admitted',async()=>{const f=fixture();try{
 const old=await f.store.collect(observation(),0),prior=await f.store.readBody(old.sourceId,old.acquisitionId),text='📰\nPublished\nOctober 20, 2026\n作者\nOpenAI',range=(quote:string)=>({startCharacter:text.indexOf(quote),endCharacter:text.indexOf(quote)+quote.length,quote}),metadataRanges={author:range('OpenAI'),publishedAt:range('October 20, 2026')},fresh={...observation(),text,author:'OpenAI',publishedAt:'October 20, 2026',metadataRanges}
 const saved=await f.store.collect(fresh,1),read=await new ProjectSourceStore(f.root,'p').readBody(saved.sourceId,saved.acquisitionId);assert.deepEqual(read.acquisition.metadataRanges,metadataRanges);assert.equal(read.text,text);assert.deepEqual((await f.store.readBody(old.sourceId,old.acquisitionId)).acquisition,prior.acquisition)
 const catalog=assertSourceCatalog(saved.catalog);assert.deepEqual(catalog.sources[0].acquisitions.find(a=>a.id===saved.acquisitionId)?.metadataRanges,metadataRanges)
 await assert.rejects(f.store.collect({...fresh,text:text.replace('October 20','October 19')},2),/witness differs/);assert.equal(f.store.state().revision,2)
 assert.throws(()=>assertSourceCatalog({...catalog,sources:catalog.sources.map(s=>({...s,acquisitions:s.acquisitions.map(a=>a.id===saved.acquisitionId?{...a,author:'Invented'}:a)}))}),/witness differs/)
 for(const r of [{metadataRanges:{}},{authorSelector:'.author',metadataRanges},{publishedSelector:'time',metadataRanges},{metadataRanges:{author:{...range('OpenAI'),startCharacter:-1}}},{metadataRanges:{publishedAt:{...range('October 20, 2026'),quote:'Yesterday'}}}])assert.throws(()=>assertSourceRequest({operation:'collect',expectedRevision:2,bodySelector:'article',...r}))
}finally{f.close()}})
test('Source text content deduplicates across URLs while acquisitions, missing dates and candidate confirmation remain independent',async()=>{const f=fixture();try{
 const a=await f.store.collect(observation(),0),b=await f.store.collect(observation('https://other.example/article'),1),c=await f.store.collect(observation(),2)
 assert.equal(c.catalog.sources.length,2);assert.equal(c.catalog.sources[0].acquisitions.length,2);assert.equal(new Set(c.catalog.sources.flatMap(s=>s.acquisitions).map(a=>a.originalTextArtifactId)).size,1)
 const first=await f.store.readBody(a.sourceId,a.acquisitionId);assert.equal(first.text,observation().text);assert.equal(first.acquisition.author,null);assert.equal(first.acquisition.publishedAt,null);assert.equal(first.acquisition.eventAt,null);assert.deepEqual(first.acquisition.media,[])
 const candidateId=first.acquisition.candidates[0].id
 await assert.rejects(f.store.recordMedia(a.sourceId,a.acquisitionId,candidateId,{state:'failed',error:'HTTP 503'},3),/Confirm/)
 const catalog=f.store.confirm({operation:'confirm',expectedRevision:3,sourceId:a.sourceId,acquisitionId:a.acquisitionId,candidateIds:[candidateId],eventAt:'2026-09-30'})
 assert.equal(catalog.sources[0].acquisitions[0].eventTimeOrigin,'user-declared');assert.equal(catalog.sources[1].acquisitions[0].eventAt,null)
 await assert.rejects(f.store.recordMedia(a.sourceId,a.acquisitionId,candidateId,{state:'completed-decoded',artifactId:'fake.mp4',contentId:'a'.repeat(64)},4),/actual decode/)
 const failed=await f.store.recordMedia(a.sourceId,a.acquisitionId,candidateId,{state:'failed',error:'HTTP 503'},4);assert.equal(failed.sources[0].acquisitions[0].media[0].artifactId,null);assert.equal(await f.store.readBody(b.sourceId,b.acquisitionId).then(value=>value.text),first.text)
 assert.throws(()=>f.store.confirm({operation:'confirm',expectedRevision:4,sourceId:a.sourceId,acquisitionId:a.acquisitionId,candidateIds:[]}),/SOURCE_CONFLICT/)
}finally{f.close()}})
test('Concurrent source commits and cancellation after writing remove only current text outputs',async()=>{const f=fixture();try{
 const attempts=await Promise.allSettled([f.store.collect(observation(),0),f.store.collect({...observation('https://other.example'),text:'different'},0)]);assert.equal(attempts.filter(value=>value.status==='fulfilled').length,1);assert.equal(fs.readdirSync(path.join(f.root,'artifacts')).length,1)
 const before=fs.readdirSync(path.join(f.root,'artifacts')).sort(),controller=new AbortController(),hooks=f.store as unknown as {writeArtifact(extension:'txt'|'json',text:string):Promise<string>},write=hooks.writeArtifact.bind(f.store)
 hooks.writeArtifact=async(extension,text)=>{const id=await write(extension,text);controller.abort(new Error('cancel after write'));return id}
 await assert.rejects(f.store.collect({...observation(),text:'new cancelled evidence'},1,controller.signal),/cancel after write/);assert.deepEqual(fs.readdirSync(path.join(f.root,'artifacts')).sort(),before);assert.equal(f.store.snapshot().revision,1)
}finally{f.close()}})
test('Source corrupt state, mutated original text and symlinked artifacts fail closed without overwriting evidence',async()=>{const f=fixture();try{
 const value=await f.store.collect(observation(),0),body=await f.store.readBody(value.sourceId,value.acquisitionId),artifact=path.join(f.root,'artifacts',body.acquisition.originalTextArtifactId!)
 fs.writeFileSync(artifact,'tampered');await assert.rejects(f.store.readBody(value.sourceId,value.acquisitionId),/original text was changed/);assert.equal(fs.readFileSync(artifact,'utf8'),'tampered')
 const file=path.join(f.root,'sources/catalog.json');fs.writeFileSync(file,'{ corrupt');assert.throws(()=>f.store.snapshot());await assert.rejects(f.store.collect(observation(),1));assert.equal(fs.readFileSync(file,'utf8'),'{ corrupt')
 fs.renameSync(path.join(f.root,'artifacts'),path.join(f.root,'preserved'));fs.symlinkSync(path.join(f.root,'preserved'),path.join(f.root,'artifacts'));assert.throws(()=>f.store.snapshot(),/boundary changed/);assert.throws(()=>new ProjectSourceStore(f.root,'p'),/inside their Project/);assert.equal(fs.readFileSync(path.join(f.root,'preserved',body.acquisition.originalTextArtifactId!),'utf8'),'tampered')
}finally{f.close()}})
test('Closed source requests reject missing ranges, credentials, injected file receipts and fictional fact-check status',()=>{
 const read={operation:'read',sourceId:'saved-source',acquisitionId:'saved-acquisition'}
 assert.deepEqual(assertSourceRequest(read),read)
 assert.throws(()=>assertSourceRequest({...read,expectedRevision:454}),/Unsupported source field for read: \["expectedRevision"\].*Allowed fields: operation, sourceId, acquisitionId.*No operation was executed/)
 const unknown=Object.fromEntries(Array.from({length:20},(_,i)=>['unknown-'+i+'x'.repeat(500),'private-value-must-not-be-echoed']))
 assert.throws(()=>assertSourceRequest({...read,...unknown}),(error:unknown)=>error instanceof TypeError&&error.message.length<1000&&error.message.includes('additional fields omitted')&&!error.message.includes('private-value-must-not-be-echoed'))
 assert.throws(()=>assertSourceRequest({operation:'collect',expectedRevision:0}),/explicit body/)
 assert.throws(()=>assertSourceRequest({operation:'confirm',expectedRevision:0,sourceId:'s',acquisitionId:'a',candidateIds:[],artifactId:'fake.mp4'}),/Unsupported/)
 assert.throws(()=>assertSourceCitation({sourceId:'s',acquisitionId:'a',startCharacter:0,endCharacter:2,quote:'😀',kind:'fact',claim:'claim',conflict:'verified',eventAt:null}),/enum/)
 assert.throws(()=>assertSourceMediaAvailability([{mediaId:'m',artifactStatus:'missing',proofStatus:'verified',available:true,checkedAt:'2026-10-04'}]),/current source availability/)
 const quote=assertSourceCitation({sourceId:'s',acquisitionId:'a',startCharacter:0,endCharacter:2,quote:'😀',kind:'opinion',claim:'claim',conflict:'pending',eventAt:null});assert.equal(quote.endCharacter,2)
 assert.throws(()=>assertSourceCatalog({version:1,projectId:'p',revision:0,sources:[{id:'s',url:'https://user:password@example.com',acquisitions:[]}]}),/public page/)
})

test('Current source media and proof hashes report missing/changed/linked/legacy evidence without rewriting acquisition history',async()=>{const f=fixture();try{
 const collected=await f.store.collect(observation(),0),body=await f.store.readBody(collected.sourceId,collected.acquisitionId),candidateId=body.acquisition.candidates[0].id
 f.store.confirm({operation:'confirm',expectedRevision:1,sourceId:collected.sourceId,acquisitionId:collected.acquisitionId,candidateIds:[candidateId]})
 const image=Buffer.from('contract media fixture'),file=path.join(f.root,'artifacts/image.png');fs.writeFileSync(file,image)
 const saved=await f.store.recordMedia(collected.sourceId,collected.acquisitionId,candidateId,{state:'image-decoded',artifactId:'image.png',contentId:crypto.createHash('sha256').update(image).digest('hex'),proof:{kind:'image',contentType:'image/png',width:1,height:1,pixels:1,bytes:image.length,canDecode:true}},2)
 const media=saved.sources[0].acquisitions[0].media[0],proofFile=path.join(f.root,'artifacts',media.proofArtifactId!),proof=fs.readFileSync(proofFile),catalogFile=path.join(f.root,'sources/stream/commits/0000/0000003.json'),originalCatalog=fs.readFileSync(catalogFile)
 const read=()=>f.store.readBody(collected.sourceId,collected.acquisitionId);assert.equal((await read()).mediaAvailability[0].available,true);assert.ok(media.proofContentId)
 fs.writeFileSync(file,'changed');const changed=await read();assert.equal(changed.mediaAvailability[0].artifactStatus,'changed');assert.equal(changed.mediaAvailability[0].available,false);assert.equal(changed.acquisition.media[0].state,'image-decoded');fs.writeFileSync(file,image)
 fs.rmSync(proofFile);assert.equal((await read()).mediaAvailability[0].proofStatus,'missing');fs.writeFileSync(proofFile,proof)
 fs.writeFileSync(proofFile,'changed proof');assert.equal((await read()).mediaAvailability[0].proofStatus,'changed');fs.writeFileSync(proofFile,proof)
 fs.renameSync(file,file+'.preserved');fs.symlinkSync(file+'.preserved',file);assert.equal((await read()).mediaAvailability[0].artifactStatus,'invalid');fs.rmSync(file);fs.renameSync(file+'.preserved',file)
 const older=structuredClone(saved);delete older.sources[0].acquisitions[0].media[0].proofContentId;const legacyRoot=path.join(f.root,'legacy');fs.mkdirSync(legacyRoot);fs.cpSync(path.join(f.root,'artifacts'),path.join(legacyRoot,'artifacts'),{recursive:true});fs.mkdirSync(path.join(legacyRoot,'sources'));fs.writeFileSync(path.join(legacyRoot,'sources/catalog.json'),JSON.stringify(older));const legacy=new ProjectSourceStore(legacyRoot,'p');assert.equal((await legacy.readBody(collected.sourceId,collected.acquisitionId)).mediaAvailability[0].proofStatus,'unrecorded');assert.ok(!fs.existsSync(path.join(legacyRoot,'sources/stream')))
 assert.deepEqual(fs.readFileSync(catalogFile),originalCatalog);assert.deepEqual(fs.readFileSync(proofFile),proof);assert.deepEqual(fs.readFileSync(file),image);assert.equal((await read()).mediaAvailability[0].available,true)
 const controller=new AbortController();controller.abort(new Error('cancel source availability'));await assert.rejects(f.store.readBody(collected.sourceId,collected.acquisitionId,controller.signal),/cancel source availability/);assert.deepEqual(fs.readFileSync(catalogFile),originalCatalog)
}finally{f.close()}})

test('Capture requests require a video selector and measured source evidence cannot cross the confirmed range or claim platform completeness',()=>{
 const request=assertSourceRequest({operation:'acquire',sourceId:'s',acquisitionId:'a',candidateId:'c',expectedRevision:0,method:'capture',videoSelector:'#player',maxDurationMs:1000});assert.equal(request.operation,'acquire')
 assert.throws(()=>assertSourceRequest({operation:'acquire',sourceId:'s',acquisitionId:'a',candidateId:'c',expectedRevision:0,method:'capture'}),/selector/)
 assert.throws(()=>assertSourceRequest({operation:'acquire',sourceId:'s',acquisitionId:'a',candidateId:'c',expectedRevision:0,method:'download',videoSelector:'#player'}),/Capture options/)
 const scope=observation().scope,evidence={kind:'video-element',pageUrl:'https://example.com/article',candidateUrl:'blob:https://example.com/clip',scope,selector:'video',index:0,fromStart:true,sourceStartSeconds:0,sourceEndSeconds:1,sourceDurationSeconds:10,stopReason:'maximum-duration',startedAt:'2026-10-04T00:00:00Z',endedAt:'2026-10-04T00:00:01Z'}
 assert.equal(assertSourceCaptureEvidence(evidence).sourceEndSeconds,1);assert.throws(()=>assertSourceCaptureEvidence({...evidence,sourceEndSeconds:11}),/exceeds/);assert.throws(()=>assertSourceCaptureEvidence({...evidence,shell:'curl'}),/Unsupported/);assert.throws(()=>assertSourceCaptureEvidence({...evidence,scope:{...scope,status:'failed'}}),/observed/)
})

test('Delivery preview is a closed preserve-only interval and cannot claim a capture or exceed the short preview budget',()=>{
 const acquire={operation:'acquire',sourceId:'s',acquisitionId:'a',candidateId:'c',expectedRevision:0,method:'preserve',preview:{startSeconds:123,endSeconds:143}}
 assert.deepEqual(assertSourceRequest(acquire),acquire)
 for(const method of ['download','capture'])assert.throws(()=>assertSourceRequest({...acquire,method,...(method==='capture'?{videoSelector:'video'}:{})}),/preserve/)
 for(const preview of [{startSeconds:0,endSeconds:30.001},{startSeconds:143,endSeconds:123},{startSeconds:-1,endSeconds:1},{startSeconds:1790,endSeconds:1801},{startSeconds:0,endSeconds:1,shell:'curl'}])assert.throws(()=>assertSourceRequest({...acquire,preview}))
 assert.throws(()=>assertSourceRequest({...acquire,fromStart:false}),/Capture options/)
})

test('Host video identities round-trip in candidates and capture witnesses while legacy sources remain readable',async()=>{const f=fixture();try{
 const original=observation('https://www.youtube.com/watch?v=target'),videoIdentity={version:1 as const,platform:'youtube' as const,targetId:'target',resourceId:'target'}
 original.candidates=[{kind:'video',url:'blob:https://www.youtube.com/player',durationSeconds:10,role:'video',videoIdentity}]
 const saved=await f.store.collect(original,0),candidate=(await new ProjectSourceStore(f.root,'p').readBody(saved.sourceId,saved.acquisitionId)).acquisition.candidates[0];assert.deepEqual(candidate.videoIdentity,videoIdentity)
 const capture=assertSourceCaptureEvidence({kind:'video-element',pageUrl:original.url,candidateUrl:candidate.url,scope:original.mediaScope,videoIdentity,selector:'video',index:0,fromStart:true,sourceStartSeconds:0,sourceEndSeconds:10,sourceDurationSeconds:10,stopReason:'ended',startedAt:'2026-10-22T00:00:00Z',endedAt:'2026-10-22T00:00:10Z'});assert.deepEqual(capture.videoIdentity,videoIdentity)
 const legacy=structuredClone(saved.catalog);delete legacy.sources[0].acquisitions[0].candidates[0].videoIdentity;assert.equal(assertSourceCatalog(legacy).sources[0].acquisitions[0].candidates[0].videoIdentity,undefined)
 assert.throws(()=>assertSourceRequest({operation:'acquire',expectedRevision:1,sourceId:saved.sourceId,acquisitionId:saved.acquisitionId,candidateId:candidate.id,method:'preserve',videoIdentity}),/Unsupported/)
}finally{f.close()}})


function textBatch():TextReadBatch{return {version:1,id:'text-batch',projectId:'p',revision:0,startedAt:'2026-10-24T12:00:00.000Z',finishedAt:null,rows:[{index:0,url:'https://x.com/fixture',state:'pending'},{index:1,url:'https://x.com/fixture-two',state:'pending'}]}}
function textDiagnostic():TextReadDiagnostic{return {at:'2026-10-24T12:00:01.000Z',url:'https://x.com/fixture',title:'Fixture',documentReadyState:'complete',bodyTextCharacters:30,visiblePosts:0,matchingPostLinks:0,contentState:'header-only',mainDocumentStatus:200,navigation:[{phase:'stop',reason:'deadline',elapsedMs:8000,at:1792843201000}],network:[],pending:[]}}
test('Text-read codec rejects body injection, mismatched evidence, unsafe diagnostic URLs and oversized replies',()=>{
 assert.deepEqual(assertTextReadBatch(textBatch()),textBatch());assert.equal(Object.hasOwn(assertTextReadBatch(textBatch()),'cleanupState'),false);for(const cleanupState of ['pending','complete','quarantined'] as const)assert.equal(assertTextReadBatch({...textBatch(),cleanupState}).cleanupState,cleanupState);assert.throws(()=>assertTextReadBatch({...textBatch(),cleanupState:'assumed-complete'}));assert.deepEqual(assertTextReadDiagnostic(textDiagnostic()),textDiagnostic());assert.equal(assertTextReadDiagnostic({...textDiagnostic(),truncated:true}).truncated,true);assert.throws(()=>assertTextReadDiagnostic({...textDiagnostic(),truncated:'yes'}))
 const batch=textBatch()
 const transfer={url:'https://x.com/fixture',status:200,receivedBytes:123,lastDataAt:1792843201000,completed:false,failed:false}
 assert.deepEqual(assertTextReadDiagnostic({...textDiagnostic(),documentTransfer:transfer}).documentTransfer,transfer)
 assert.throws(()=>assertTextReadDiagnostic({...textDiagnostic(),documentTransfer:{...transfer,receivedBytes:-1}}))
 assert.throws(()=>assertTextReadDiagnostic({...textDiagnostic(),documentTransfer:{...transfer,url:'https://x.com/fixture?secret=1'}}))
 for(const invalid of [{...batch,body:'Do not embed source text'},{...batch,rows:[{...batch.rows[0],sourceId:'source-only'}]},{...batch,rows:[{...batch.rows[0],state:'read'}]},{...batch,rows:[{...batch.rows[0],url:'https://user:secret@example.com'}]},{...batch,rows:[batch.rows[0],{...batch.rows[1],url:batch.rows[0].url}]},{...batch,startedAt:'2026-02-30T12:00:00.000Z'},{...batch,rows:Array.from({length:61},(_,index)=>({...batch.rows[0],index,url:'https://x.com/a'+index}))}])assert.throws(()=>assertTextReadBatch(invalid))
 for(const address of ['https://x.com/fixture?token=secret','https://x.com/fixture#private','file:///private','https://user:secret@x.com/fixture'])assert.throws(()=>assertTextReadDiagnostic({...textDiagnostic(),url:address}))
 assert.throws(()=>assertTextReadDiagnostic({...textDiagnostic(),network:[{type:'failed',url:'https://x.com/api?token=secret',resourceType:'XHR',errorText:'failed',at:1792843201000}]}))
 assert.throws(()=>assertTextReadDiagnostic({...textDiagnostic(),pending:Array.from({length:30},(_,i)=>({url:'https://x.com/'+i+'a'.repeat(500),resourceType:'Script'}))}),/byte budget/)
})
test('Text-read checkpoints durably preserve pending, failed and incomplete rows with fixed revisions and CAS',()=>{const f=fixture();try{
 const initial=textBatch(),receipt0=f.store.writeTextBatch(initial);assert.equal(receipt0.revision,0);assert.equal(receipt0.sha256.length,64)
 const reopened=new ProjectSourceStore(f.root,'p');assert.deepEqual(reopened.readTextBatch(receipt0.batchId,0,receipt0.sha256),initial);assert.equal(reopened.snapshot().sources.length,0,'Batch metadata never creates fictional news sources')
 const progressed:TextReadBatch={...initial,revision:1,rows:[{...initial.rows[0],state:'failed',reason:'navigation-timeout',diagnostic:textDiagnostic(),error:'sensitive fixture detail not indexed',finishedAt:'2026-10-24T12:00:01.000Z'},initial.rows[1]]},receipt1=reopened.writeTextBatch(progressed,0)
 assert.deepEqual(reopened.readTextBatch(receipt0.batchId,0,receipt0.sha256),initial,'Pinned old revision never silently becomes latest')
 assert.deepEqual(new ProjectSourceStore(f.root,'p').readTextBatch(receipt1.batchId,1,receipt1.sha256),progressed,'Crash leaves unfinished row pending; read has no dispatch/replay')
 assert.throws(()=>reopened.writeTextBatch({...progressed,revision:1},0),/CONFLICT/)
 assert.throws(()=>reopened.writeTextBatch({...progressed,revision:2,rows:[{...progressed.rows[0],state:'pending'},progressed.rows[1]]},1),/CONFLICT/)
 assert.throws(()=>reopened.writeTextBatch({...progressed,revision:2,rows:[progressed.rows[0],{...progressed.rows[1],url:'https://x.com/changed'}]},1),/CONFLICT/)
 const final:TextReadBatch={...progressed,revision:2,finishedAt:'2026-10-24T12:00:02.000Z',rows:[progressed.rows[0],{...initial.rows[1],state:'incomplete',reason:'header-only',finishedAt:'2026-10-24T12:00:02.000Z'}]},receipt2=reopened.writeTextBatch(final,1)
 assert.deepEqual(reopened.readTextBatch(receipt2.batchId,2,receipt2.sha256),final)
 assert.throws(()=>reopened.readTextBatch(receipt2.batchId,1,receipt2.sha256),/INTEGRITY/)
 assert.throws(()=>reopened.readTextBatch(receipt2.batchId,2,'a'.repeat(64)),/INTEGRITY/)
 assert.throws(()=>reopened.writeTextBatch({...final,revision:3},2),/CONFLICT/)
 assert.throws(()=>reopened.writeTextBatch({...initial,id:'foreign',projectId:'other'}),/PROJECT/)
 const indexDirectory=path.join(f.root,'sources/text-batches/index'),ref=JSON.parse(fs.readFileSync(path.join(indexDirectory,'current.json'),'utf8')),db=new DatabaseSync(path.join(indexDirectory,ref.generation+'.sqlite'),{readOnly:true});try{const search=db.prepare('SELECT search FROM entries').all().map(row=>row.search).join(' ');assert.match(search,/failed/);assert.ok(!search.includes('sensitive fixture detail'),'SQLite index contains only identifiers, URL and states')}finally{db.close()}
 assert.equal(fs.readdirSync(path.join(f.root,'sources/text-batches/commits/0000')).length,3);assert.equal(reopened.state().revision,0,'Batch CAS is independent of source revision')
}finally{f.close()}})
test('Text-read immutable checkpoint corruption is rejected without rewriting authoritative files',()=>{const f=fixture();try{
 const receipt=f.store.writeTextBatch(textBatch()),file=path.join(f.root,'sources/text-batches/commits/0000/0000001.json'),original=fs.readFileSync(file,'utf8'),value=JSON.parse(original)
 value.changes[0].value.batch.rows[0].reason='tampered';fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>f.store.readTextBatch(receipt.batchId,receipt.revision,receipt.sha256));assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).changes[0].value.batch.rows[0].reason,'tampered')
}finally{f.close()}})

test('Discovery checkpoints preserve excerpt domain and cannot be promoted to full-text batches',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'discovery-batch-'))
 try{const store=new ProjectSourceStore(root,'p'),base={...textBatch(),mode:'discovery' as const},receipt=store.writeTextBatch(base)
 assert.equal(store.readTextBatch(receipt.batchId,receipt.revision,receipt.sha256).mode,'discovery')
 const changed={...base,revision:1};delete changed.mode
 assert.throws(()=>store.writeTextBatch(changed,0),/CONFLICT/)
 assert.throws(()=>assertTextReadBatch({...base,rows:[{...base.rows[0],state:'read',sourceId:'s',acquisitionId:'a',diagnostic:{...textDiagnostic(),contentState:'posts',visiblePosts:1,matchingPostLinks:1}}]}),/saved leads/)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})

 test('Automatic finite video acquisition binds a confirmed player and validates delivery preview separately from capture',()=>{
 const base={operation:'acquire',sourceId:'s',acquisitionId:'a',candidateId:'c',expectedRevision:0,method:'auto',videoSelector:'#player'}
 assert.equal(assertSourceRequest(base).operation,'acquire')
 assert.throws(()=>assertSourceRequest({...base,videoSelector:undefined}),/selector/)
 const preview=assertSourceRequest({...base,preview:{startSeconds:0,endSeconds:10}})
 if(preview.operation!=='acquire')throw new Error('Expected acquisition request')
 assert.deepEqual(preview.preview,{startSeconds:0,endSeconds:10})
 for(const method of ['capture','download'])assert.throws(()=>assertSourceRequest({...base,method,videoSelector:method==='capture'?base.videoSelector:undefined,preview:{startSeconds:0,endSeconds:10}}),/preserve or auto/)
 assert.throws(()=>assertSourceRequest({...base,preview:{startSeconds:0,endSeconds:31}}),/preview|range|30/i)
 assert.throws(()=>assertSourceRequest({...base,downloadBudgetMs:999999}),/Unsupported/)
 })
