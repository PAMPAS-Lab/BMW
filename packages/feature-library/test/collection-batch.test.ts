import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {Ajv} from 'ajv'
import {createCollectionBatchFixture,deferred,SAME_NINE_PRESETS} from '../../../scripts/library-collection-batch-benchmark.js'
import {assertBatchRequest,assertBatchBackgroundScope,collectionBatchRequestSchema,liveBatch} from '../src/collection-batch-contract.js'
import type {BatchDecision} from '../src/collection-batch-contract.js'
import {CollectionBatchStore,checkpointId} from '../src/collection-batch-store.js'
import type {EntryFixtureMode} from '../../../scripts/library-collection-batch-benchmark.js'
import {collectionArticleObservation} from '../src/collection-batch-adapters.js'
import {assertSourceObservation} from '../../media-native/src/source-contract.js'
import type {SourceObservation} from '../../media-native/src/source-contract.js'
import type {SubscriptionInput} from '../src/rolling-contract.js'

test('Closed batch contracts and trusted admission retain exact owner, anchor, revision and user priority',async()=>{
 const validate=new Ajv({strict:false}).compile(collectionBatchRequestSchema)
 for(const operation of ['collect','read','cancel','recover']){const r={operation,projectId:'p',id:'batch'};assert.ok(validate(r));assert.doesNotThrow(()=>assertBatchRequest(r))}
 for(const request of [{operation:'start',projectId:'p',expectedRevision:0,subscriptionIds:['a'],concurrency:4},{operation:'start',projectId:'p',expectedRevision:0,subscriptionIds:['a'],concurrency:2,articleLimit:21},{operation:'collect',projectId:'p',id:'batch',shell:'forbidden'}]){assert.equal(validate(request),false);assert.throws(()=>assertBatchRequest(request))}
 assert.throws(()=>assertBatchRequest({operation:'submit',projectId:'p',id:'batch',decisions:[{sourceId:'a',acquisitionId:'b',decision:'skip',title:'extra'}]}),/Only saved leads/)
 const f=await createCollectionBatchFixture()
 try{
  const start={expectedRevision:f.rolling.records.state().revision,subscriptionIds:f.subscriptions.map(s=>s.id),concurrency:2}
  await assert.rejects(f.execute('start',start),/USER_REQUIRED/)
  await assert.rejects(f.execute('start',{...start,expectedRevision:0},'user'),/CONFLICT/)
  f.state.availability='user task active';await assert.rejects(f.start(),/user task active/);assert.equal(f.state.dispatches,0)
  f.state.availability=null;f.state.anchor='';await assert.rejects(f.start(),/anchor/);assert.equal(f.store.active(),false)
  f.state.anchor='official-anchor';const id=await f.start();assert.equal(f.store.batch(id).binding.externalSessionId,'official-anchor')
  await assert.rejects(f.execute('collect',{id},'agent',{projectId:'p',sessionId:'other'}),/OWNER/)
  f.state.activeProject=1;await assert.rejects(f.execute('collect',{id}),/PROJECT/);f.state.activeProject=0
  f.state.anchor='different-anchor';await assert.rejects(f.execute('collect',{id}),/anchor/);f.state.anchor='official-anchor'
  const sub=f.rolling.entity(f.subscriptions[0].id,'subscription');f.rolling.commit([{...sub,revision:sub.revision+1,updatedAt:new Date().toISOString()}],f.rolling.records.state().revision,'fixture-subscription-revision')
  await assert.rejects(f.execute('collect',{id}),/Subscription/);assert.equal(f.state.visits.length,0)
  assert.equal(f.state.dispatches,1);assert.equal(fs.existsSync(path.join(f.projects[1].directory,'library')),false)
 }finally{f.close()}
})

test('Uncertain official delivery is persisted before enqueue and never replayed; explicit rejection is distinct',async()=>{
 const f=await createCollectionBatchFixture()
 try{
  f.state.enqueueThrows=true;await assert.rejects(f.start(),/uncertain input/)
  const records=f.store.records.page({terms:['kind:batch'],limit:20}).items
  assert.equal(records.length,1);const id=records[0].value.id;assert.equal(f.store.batch(id).status,'uncertain');assert.equal(f.store.batch(id).dispatchId,null)
  await assert.rejects(f.start(),/BUSY/);assert.equal(f.state.dispatches,1)
  await assert.rejects(f.execute('recover',{id}),/USER_REQUIRED/)
  f.state.availability='official input still active';await assert.rejects(f.execute('recover',{id},'user'),/uncertain.*busy/);assert.equal(f.store.batch(id).status,'uncertain');assert.equal(f.state.recoveries,0);f.state.availability=null
  await f.execute('recover',{id},'user');assert.equal(f.store.batch(id).status,'cancelled');assert.equal(f.state.dispatches,1)
  f.state.enqueueThrows=false;f.state.enqueueRejects=true;const rejected=await f.start();assert.equal(f.store.batch(rejected).status,'cancelled');assert.equal(f.state.dispatches,2);assert.equal(f.state.visits.length,0)
 }finally{f.close()}
})

test('Nine configured sources use bounded real-store collection, fair article slots and original/legacy preservation',async()=>{
 const f=await createCollectionBatchFixture({ioConcurrency:3,linksPerSource:5,delayMs:2})
 try{
  const protectedPaths=['video-studio/old-draft.json','video-studio/news/s-old-batch.json','library/recommendations/old-snapshot.json','library/exports/old-export.json','artifacts/old-finished.mp4']
  const oldFiles=protectedPaths.map((relative,index)=>{const file=path.join(f.projects[0].directory,relative),body='existing user data '+index;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);return {file,body}})
  const id=await f.start(3);await f.execute('collect',{id});const b=f.store.batch(id)
  assert.equal(b.status,'awaiting-review');assert.equal(b.sources.length,9);assert.equal(b.sources.reduce((n,s)=>n+s.originals.length,0),20)
  assert.equal(f.state.peakReads,3);assert.equal(f.state.visits.length,28);assert.equal(f.state.closedLanes,3)
  assert.deepEqual(new Set(f.state.visits.slice(0,9)),new Set(f.subscriptions.map(s=>s.input.url)))
  for(const s of b.sources){if(s.input.url.includes('/explore/')){assert.equal(s.state,'partial');assert.equal(s.originals.length,1);assert.equal(s.originals[0].url,s.input.url);continue}assert.ok(s.originals.length>=2&&s.originals.length<=3,'Every article-capable source receives two slots before any gets four')}
  const originals=b.sources.flatMap(s=>s.originals),read=await f.execute('read',{id},'user') as {originals:unknown[];nextOffset:number|null};assert.equal(read.originals.length,20);assert.equal(read.nextOffset,null)
  for(const o of originals){const body=await f.ports[0].readBody(o.sourceId,o.acquisitionId);assert.equal(body.acquisition.contentId,o.bodySha256);assert.equal(body.text,o.excerpt)}
  await assert.rejects(f.execute('collect',{id}),/ALREADY_STARTED/)
  await f.execute('submit',{id,decisions:f.decisions(id)});assert.equal(f.rolling.records.page({terms:['kind:lead'],limit:50}).items.length,20)
  const trend=f.store.batch(id).sources.find(s=>s.input.url.includes('/explore/'))!,trendLead=f.rolling.entity(trend.originals[0].leadId!,'lead')
  assert.equal(trendLead.social?.platformId,'trending');assert.equal(trendLead.social?.observationKind,'trend');assert.equal(trendLead.evidence.acquisitionId,trend.entry?.acquisitionId);assert.equal(f.rolling.entity(trend.subscriptionId,'subscription').cursor,'');assert.equal(trend.state,'partial')
  assert.equal(f.store.batch(id).status,'partial');assert.ok(f.store.batch(id).sources.every(s=>s.fromCursor===''))
  for(const {file,body} of oldFiles)assert.equal(fs.readFileSync(file,'utf8'),body)
  const rebuilt=new CollectionBatchStore(f.projects[0].directory,'p');assert.deepEqual(rebuilt.batch(id),f.store.batch(id));assert.equal(f.state.dispatches,1)
 }finally{f.close()}
})

test('Restricted, blank, incomplete, missing links and foreign redirects retain cursor and never become no-new',async()=>{
 for(const mode of ['restricted','blank','truncated','no-links','redirect','failed'] satisfies EntryFixtureMode[]){
  const f=await createCollectionBatchFixture()
  try{
   f.state.entryModes.set(SAME_NINE_PRESETS[0],mode);const sub=f.subscriptions[0],id=await f.start(2,20,[sub.id])
   await f.execute('collect',{id});assert.equal(f.store.batch(id).sources[0].originals.length,0)
   await f.execute('submit',{id,decisions:[]});const source=f.store.batch(id).sources[0]
   assert.ok(['partial','restricted','failed'].includes(source.state),mode+' must not become no-new')
   assert.equal(f.rolling.entity(sub.id,'subscription').cursor,'',mode+' must retain cursor');assert.equal(f.store.checkpoint(sub.id)?.cursor,'')
   if(mode!=='blank'&&mode!=='failed')assert.ok(source.entry,'Access/incomplete original remains inspectable')
  }finally{f.close()}
 }
})

test('Agent batch pages avoid runtime output folding while every original and full GUI gap remains intact',async()=>{
 const f=await createCollectionBatchFixture({ioConcurrency:3})
 try{
  f.state.metrics='合成中文长正文用于核对分页，原文应完整保留。'.repeat(180)
  const id=await f.start(3),first=await f.execute('collect',{id}) as {originals:{acquisitionId:string;excerpt:string;excerptOnly:boolean}[];nextOffset:number|null;totalOriginals:number}
  const originals=f.store.batch(id).sources.flatMap(s=>s.originals),before=JSON.stringify(originals)
  assert.equal(first.totalOriginals,17);assert.equal(first.originals.length,4);assert.equal(first.nextOffset,4)
  const seen:string[]=[];let page=first
  for(;;){
   assert.ok(Buffer.byteLength(JSON.stringify(page))<24*1024,'The full tool reply stays below the observed runtime folding threshold')
   for(const original of page.originals){assert.equal(original.excerptOnly,true);assert.ok(original.excerpt.length<=600);const stored=originals.find(o=>o.acquisitionId===original.acquisitionId)!;assert.equal(original.excerpt,stored.excerpt.slice(0,600));seen.push(original.acquisitionId)}
   if(page.nextOffset===null)break
   page=await f.execute('read',{id,offset:page.nextOffset}) as typeof first
  }
  assert.deepEqual(seen,originals.map(o=>o.acquisitionId));assert.equal(new Set(seen).size,17);assert.equal(JSON.stringify(f.store.batch(id).sources.flatMap(s=>s.originals)),before)
  const gui=await f.execute('read',{id},'user') as {originals:{excerpt:string}[];nextOffset:number|null}
  assert.equal(gui.originals.length,17);assert.equal(gui.nextOffset,null);assert.ok(gui.originals.some(o=>o.excerpt.length>600))
  const body=await f.ports[0].readBody(originals[0].sourceId,originals[0].acquisitionId);assert.ok(body.text.length>2400);assert.equal(body.acquisition.contentId,originals[0].bodySha256)
 }finally{f.close()}
})

test('Incremental URL checkpoints ignore changed entry metrics without losing newly saved originals',async()=>{
 const f=await createCollectionBatchFixture({ioConcurrency:2})
 try{
  const first=await f.start();await f.execute('collect',{id:first});await f.execute('submit',{id:first,decisions:f.decisions(first)})
  assert.equal(f.store.batch(first).sources.reduce((n,s)=>n+s.originals.length,0),17)
  const before=f.state.visits.length,leadIds=f.rolling.records.page({terms:['kind:lead'],limit:50}).items.map(e=>e.key)
  f.state.metrics='150 views';const second=await f.start();await f.execute('collect',{id:second})
  assert.equal(f.state.visits.length-before,9);assert.equal(f.store.batch(second).sources.reduce((n,s)=>n+s.originals.length,0),1);assert.equal(f.store.batch(second).sources.find(s=>s.originals.length)?.input.platform,'x')
  await f.execute('submit',{id:second,decisions:[]})
  assert.deepEqual(f.rolling.records.page({terms:['kind:lead'],limit:50}).items.map(e=>e.key),leadIds)
  const sources=f.store.batch(second).sources
  assert.equal(sources.filter(s=>s.state==='no-new').length,8);assert.equal(sources.find(s=>s.input.url.includes('/explore/'))?.state,'partial')
  for(const source of sources.filter(s=>s.state==='no-new')){const cp=f.store.checkpoint(source.subscriptionId)!;assert.equal(cp.seenUrls.length,2);assert.equal(cp.pendingUrls.length,0);assert.match(cp.cursor,/^batch:/)}
  assert.equal(f.state.dispatches,2);assert.equal(f.store.batch(first).sources.reduce((n,s)=>n+s.originals.filter(o=>o.status==='saved').length,0),17)
 }finally{f.close()}
})

test('Partial decision failures preserve per-item saved receipt and retry does not duplicate the accepted lead',async()=>{
 const f=await createCollectionBatchFixture()
 try{
  const id=await f.start();await f.execute('collect',{id});const decisions=f.decisions(id),bad={...decisions[1],metricsText:'not present in this source'}
  await assert.rejects(f.execute('submit',{id,decisions:[decisions[0],bad]}),/METRICS/)
  const original=f.store.batch(id).sources.flatMap(s=>s.originals).find(o=>o.acquisitionId===decisions[0].acquisitionId)!
  assert.equal(original.status,'saved');assert.ok(original.leadId);assert.equal(f.rolling.entity(original.leadId,'lead').revision,1);assert.equal(f.store.batch(id).status,'awaiting-review')
  const pendingDecision:BatchDecision={sourceId:original.sourceId,acquisitionId:original.acquisitionId,decision:'pending'}
  await assert.rejects(f.execute('submit',{id,decisions:[pendingDecision]}),/cannot be (?:reset|overwritten)/)
  await f.execute('submit',{id,decisions});assert.equal(f.rolling.entity(original.leadId,'lead').revision,1);assert.equal(f.rolling.records.page({terms:['kind:lead'],limit:50}).items.length,17)
  const revision=f.rolling.records.state().revision,repeated=await f.execute('submit',{id,decisions}) as {idempotent:boolean};assert.equal(repeated.idempotent,true);assert.equal(f.rolling.records.state().revision,revision)
  const reordered=await f.execute('submit',{id,decisions:decisions.map(d=>Object.fromEntries(Object.entries(d).reverse()))}) as {idempotent:boolean};assert.equal(reordered.idempotent,true);assert.equal(f.rolling.records.state().revision,revision)
  await assert.rejects(f.execute('submit',{id,decisions:[{...decisions[0],summary:'changed after completion'}]}),/identical/)
  const read=await f.execute('read',{id}) as {originals:{status:string;leadId:string|null}[]};assert.ok(read.originals.every(o=>o.status==='saved'&&o.leadId))
 }finally{f.close()}
})

test('Pending links survive cancellation and a fresh explicit batch; cleanup must drain and quarantine recovery never replays input',async()=>{
 const f=await createCollectionBatchFixture({ioConcurrency:2})
 try{
  const first=await f.start();await f.execute('collect',{id:first});const originalIds=f.store.batch(first).sources.flatMap(s=>s.originals).map(o=>o.acquisitionId)
  assert.equal(f.store.checkpoint(f.subscriptions[0].id)?.pendingUrls.length,2)
  const gate=deferred();f.state.cancelGate=gate.promise;let cancelled=false
  const cancellation=f.execute('cancel',{id:first},'user').then(()=>{cancelled=true});await delay(5);assert.equal(cancelled,false);assert.equal(f.state.recoveries,0)
  gate.resolve();await cancellation;assert.equal(f.state.drained,true);assert.equal(f.store.batch(first).status,'cancelled');assert.equal(f.state.dispatches,1)
  assert.equal(f.store.checkpoint(f.subscriptions[0].id)?.pendingUrls.length,2);assert.equal(f.rolling.entity(f.subscriptions[0].id,'subscription').cursor,'')
  f.state.cancelGate=null;const second=await f.start();await f.execute('collect',{id:second});assert.equal(f.store.batch(second).sources.reduce((n,s)=>n+s.originals.length,0),17)
  for(const acquisitionId of originalIds)assert.ok(f.store.batch(first).sources.some(s=>s.originals.some(o=>o.acquisitionId===acquisitionId)))
  f.state.cleanupFails=true;await assert.rejects(f.execute('cancel',{id:second},'user'),/quarantined/);assert.ok(liveBatch(f.store.batch(second)))
  await assert.rejects(f.start(),/BUSY/);assert.equal(f.state.dispatches,2)
  f.state.cleanupFails=false;await f.execute('recover',{id:second},'user');assert.equal(f.store.batch(second).status,'cancelled');assert.equal(f.state.dispatches,2)
 }finally{f.close()}
})

test('User cancellation settles only after all native page lanes close; saved originals and uncertain collection remain inspectable',async()=>{
 const f=await createCollectionBatchFixture({ioConcurrency:3,delayMs:2})
 try{
  const id=await f.start(),readGate=deferred(),closeGate=deferred(),started=deferred(),abort=new AbortController()
  f.state.beforeRead=async()=>{started.resolve();await readGate.promise};f.state.closeGate=closeGate.promise
  let settled=false;const collecting=f.execute('collect',{id},'agent',f.owner,abort.signal).catch(error=>{settled=true;return error})
  await started.promise;abort.abort(new Error('foreground user task'));readGate.resolve();await delay(5);assert.equal(settled,false);assert.equal(f.state.closedLanes,0)
  closeGate.resolve();const failure=await collecting;assert.match(String(failure),/foreground user task/);assert.equal(f.state.closedLanes,3);assert.equal(f.state.activeReads,0);assert.equal(f.store.batch(id).status,'review')
  await assert.rejects(f.start(),/BUSY/);assert.equal(f.state.dispatches,1);await f.execute('recover',{id},'user');assert.equal(f.store.batch(id).status,'cancelled')
 }finally{f.close()}
})

test('A lead commit followed by interrupted batch receipt recovers the exact decision without a duplicate lead revision',async()=>{
 const f=await createCollectionBatchFixture(),save=CollectionBatchStore.prototype.save
 try{
  const id=await f.start(2,2,[f.subscriptions[0].id]);await f.execute('collect',{id});const decisions=f.decisions(id);let interrupted=false
  CollectionBatchStore.prototype.save=function(items,signal){
   if(!interrupted&&items.some(r=>r.kind==='batch'&&r.sources.some(s=>s.originals.some(o=>o.status==='saved')))){interrupted=true;throw new Error('fixture interruption after lead commit')}
   return save.call(this,items,signal)
  }
  await assert.rejects(f.execute('submit',{id,decisions}),/after lead commit/);assert.equal(interrupted,true)
  const lead=f.rolling.records.page({terms:['kind:lead'],limit:20}).items[0].value;assert.equal(lead.revision,1)
  assert.equal(f.store.batch(id).sources[0].originals[0].status,'pending')
  await assert.rejects(f.execute('submit',{id,decisions:[{...decisions[0],summary:'different editorial decision after interrupted receipt'}]}),/different|changed|identical|mismatch/i)
  await f.execute('submit',{id,decisions});assert.equal(f.rolling.entity(lead.id,'lead').revision,1);assert.equal(f.rolling.records.page({terms:['kind:lead'],limit:20}).items.length,2)
  assert.ok(f.store.batch(id).sources[0].originals.every(o=>o.status==='saved'&&o.reviewSha256))
 }finally{CollectionBatchStore.prototype.save=save;f.close()}
})

test('A full 200-URL backlog drains saved pending before reading new entries and never truncates unreviewed URLs',async()=>{
 const f=await createCollectionBatchFixture()
 try{
  const sub=f.subscriptions[0],first=await f.start(2,1,[sub.id]);await f.execute('collect',{id:first});await f.execute('cancel',{id:first},'user')
  const prior=f.store.checkpoint(sub.id)!,pending=Array.from({length:200},(_,i)=>'https://blogs.nvidia.com/blog/backlog-fixture-'+i+'/')
  f.store.save([{...prior,id:checkpointId(sub.id),revision:prior.revision+1,pendingUrls:pending}])
  const before=f.state.visits.length,next=await f.start(2,1,[sub.id]);await f.execute('collect',{id:next})
  assert.deepEqual(f.state.visits.slice(before),[pending[0]]);assert.deepEqual(f.store.batch(next).sources[0].pendingUrls,pending);assert.deepEqual(f.store.checkpoint(sub.id)?.pendingUrls,pending)
  await f.execute('submit',{id:next,decisions:f.decisions(next,'skip')})
  assert.deepEqual(f.store.checkpoint(sub.id)?.pendingUrls,pending.slice(1));assert.equal(f.store.checkpoint(sub.id)?.seenUrls.at(-1),pending[0]);assert.equal(f.rolling.entity(sub.id,'subscription').cursor,'');assert.equal(f.store.batch(next).status,'partial')
 }finally{f.close()}
})

test('Restricted or incomplete next entries preserve all prior 1–100 pending URLs and the previous successful cursor',async()=>{
 const modes=['restricted','blank','truncated','no-links','redirect','failed'] satisfies EntryFixtureMode[]
 for(const [index,mode] of modes.entries()){
  const f=await createCollectionBatchFixture()
  try{
   const sub=f.subscriptions[0],cursor='previous-successful-entry',pending=Array.from({length:[1,100,42][index%3]},(_,i)=>'https://blogs.nvidia.com/blog/prior-pending-'+i+'/')
   f.rolling.commit([{...sub,revision:sub.revision+1,updatedAt:new Date(f.state.now).toISOString(),cursor}],f.rolling.records.state().revision,'fixture-successful-cursor')
   f.store.save([{version:1,kind:'checkpoint',id:checkpointId(sub.id),revision:1,updatedAt:new Date(f.state.now).toISOString(),subscriptionId:sub.id,cursor,entry:null,seenUrls:[],pendingUrls:pending,batchId:'previous-batch'}])
   f.state.entryModes.set(SAME_NINE_PRESETS[0],mode);const id=await f.start(2,20,[sub.id]);await f.execute('collect',{id})
   assert.deepEqual(f.store.batch(id).sources[0].pendingUrls,pending,mode+' collection retains prior pending')
   await f.execute('submit',{id,decisions:[]});const source=f.store.batch(id).sources[0]
   assert.deepEqual(f.store.checkpoint(sub.id)?.pendingUrls,pending,mode+' submission retains prior pending');assert.deepEqual(source.pendingUrls,pending)
   assert.equal(f.store.checkpoint(sub.id)?.cursor,cursor);assert.equal(f.rolling.entity(sub.id,'subscription').cursor,cursor);assert.equal(source.fromCursor,cursor)
   assert.ok(['partial','restricted','failed'].includes(source.state));assert.notEqual(source.state,'no-new');assert.equal(source.originals.length,0);assert.deepEqual(f.state.visits,[sub.input.url])
  }finally{f.close()}
 }
})

test('Observed truncated article originals can save leads with explicit gaps but stay pending and never advance source cursors',async()=>{
 const f=await createCollectionBatchFixture({articleTruncated:true})
 try{
  const sub=f.subscriptions[0],id=await f.start(2,2,[sub.id]);await f.execute('collect',{id});const before=f.store.batch(id).sources[0]
  assert.equal(before.originals.length,2);assert.ok(before.originals.every(o=>o.complete===false));assert.equal(before.pendingUrls.length,2)
  for(const original of before.originals){const body=await f.ports[0].readBody(original.sourceId,original.acquisitionId);assert.equal(body.acquisition.result,'observed');assert.equal(body.acquisition.scope.truncated,true);assert.equal(body.acquisition.contentId,original.bodySha256)}
  await f.execute('submit',{id,decisions:f.decisions(id)});const after=f.store.batch(id).sources[0],checkpoint=f.store.checkpoint(sub.id)!
  assert.equal(after.state,'partial');assert.equal(f.store.batch(id).status,'partial');assert.equal(f.rolling.entity(sub.id,'subscription').cursor,'');assert.equal(checkpoint.cursor,'')
  assert.deepEqual(checkpoint.pendingUrls,before.pendingUrls);assert.deepEqual(checkpoint.seenUrls,[]);assert.deepEqual(after.pendingUrls,before.pendingUrls)
  for(const original of after.originals){assert.equal(original.status,'saved');assert.equal(original.complete,false);assert.ok(original.leadId);assert.match(f.rolling.entity(original.leadId,'lead').missing,/原文范围已截断/)}
  f.state.articleTruncated=false;const next=await f.start(2,2,[sub.id]);await f.execute('collect',{id:next});const reread=f.store.batch(next).sources[0]
  assert.equal(reread.originals.length,2,'Existing leads must not suppress explicit pending rereads');assert.ok(reread.originals.every(o=>o.complete===true))
  await f.execute('submit',{id:next,decisions:f.decisions(next)});const finished=f.store.checkpoint(sub.id)!
  assert.deepEqual(finished.pendingUrls,[]);assert.equal(finished.seenUrls.length,2);assert.match(finished.cursor,new RegExp('^batch:'+next+':'));assert.equal(f.store.batch(next).sources[0].state,'completed')
  for(const original of after.originals)assert.equal(f.rolling.entity(original.leadId!,'lead').revision,2)
  assert.ok(f.store.batch(id).sources[0].originals.every(o=>o.complete===false&&o.status==='saved'));assert.equal(f.state.dispatches,2)
 }finally{f.close()}
})

test('Qbit publication fallback admits only one valid complete civil date beside the independent byline with an exact UTF16 witness',()=>{
 const input:SubscriptionInput={title:'量子位',platform:'web',url:'https://www.qbitai.com/',fallbackUrls:[],identityBasis:'https://www.qbitai.com/',region:'CN',language:'zh',topicIds:[],directionIds:[],status:'following'}
 const author='研究员甲',date='2024-02-29',text='AI🚀标题\n'+author+'\n'+date+'\n09:30:45\n正文',scope={selector:'body',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const}
 const original:SourceObservation={url:'https://www.qbitai.com/2024/02/90001.html',title:'AI🚀标题',author,publishedAt:null,scope,text,mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null}
 const authorWitness={startCharacter:text.indexOf(author),endCharacter:text.indexOf(author)+author.length,quote:author},withAuthor={...original,metadataRanges:{author:authorWitness}},adapted=collectionArticleObservation(input,withAuthor)
 assert.equal(adapted.publishedAt,date);assert.equal(adapted.text,text);assert.notEqual(adapted,withAuthor);assert.equal(withAuthor.publishedAt,null);assert.deepEqual(adapted.metadataRanges?.author,authorWitness)
 const witness=adapted.metadataRanges!.publishedAt!
 assert.deepEqual(witness,{startCharacter:text.indexOf(date),endCharacter:text.indexOf(date)+date.length,quote:date});assert.equal(text.slice(witness.startCharacter,witness.endCharacter),date)
 assert.notEqual([...text.slice(0,witness.startCharacter)].length,witness.startCharacter,'The astral symbol demonstrates UTF16 offsets rather than codepoint offsets')
 assert.equal(assertSourceObservation(adapted).publishedAt,date);assert.doesNotMatch(adapted.publishedAt!,/[TZ+]/,'Civil dates must not gain an inferred timezone')
 const negatives:{label:string;input?:SubscriptionInput;observation:SourceObservation}[]=[
  {label:'updated date label',observation:{...original,text:text.replace(date,'Updated '+date)}},
  {label:'separate update marker',observation:{...original,text:text.replace(author+'\n',author+'\n更新于\n')}},
  {label:'different independent author',observation:{...original,author:'研究员乙'}},
  {label:'byline not exactly the preceding line',observation:{...original,text:text.replace(author,author+' ')}},
  ...['2023-02-29','2024-04-31','2024-13-01'].map(invalid=>({label:'invalid civil day '+invalid,observation:{...original,text:text.replace(date,invalid)}})),
  {label:'multiple header dates',observation:{...original,text:text+'\n2024-03-01\n10:00:00'}},
  {label:'invalid clock',observation:{...original,text:text.replace('09:30:45','24:00:00')}},
  {label:'date after first ten lines',observation:{...original,text:Array.from({length:10},()=> 'Header').join('\n')+'\n'+text}},
  {label:'truncated body',observation:{...original,scope:{...scope,truncated:true}}},
  {label:'non-observed result',observation:{...original,result:'truncated'}},
  {label:'already known publication',observation:{...original,publishedAt:'2024-02-28'}},
  {label:'non-Qbit subscription',input:{...input,url:'https://blogs.nvidia.com/blog/category/generative-ai/'},observation:original},
  {label:'non-Qbit original redirect',observation:{...original,url:'https://example.org/2024/02/90001.html'}}
 ]
 for(const row of negatives)assert.equal(collectionArticleObservation(row.input??input,row.observation),row.observation,row.label+' must preserve the original without synthesizing a date')
})

test('Compact review covers the whole batch once, keeps uncertain dates pending, and supplies immutable evidence',async()=>{
 const validate=new Ajv({strict:false}).compile(collectionBatchRequestSchema)
 for(const request of [
  {operation:'submit',projectId:'p',id:'batch',decisions:[{sourceId:'a',acquisitionId:'b',decision:'skip',title:'extra'}]},
  {operation:'submit',projectId:'p',id:'batch',decisions:[{sourceId:'a',acquisitionId:'b',decision:'save'}]},
  {operation:'review',projectId:'p',id:'batch',choices:[{index:0,decision:'skip',summary:'extra'}]},
  {operation:'review',projectId:'p',id:'batch',choices:[{index:0,decision:'save',title:'invented',summary:'x'}]}
 ]){assert.equal(validate(request),false);assert.throws(()=>assertBatchRequest(request))}
 assert.throws(()=>assertBatchRequest({operation:'review',projectId:'p',id:'b',choices:[{index:0,decision:'skip'},{index:0,decision:'skip'}]}),/Duplicate/)
 const f=await createCollectionBatchFixture({ioConcurrency:3})
 try{
  f.state.metrics='中文正文'.repeat(1000)
  const id=await f.start(3),packet=await f.execute('collect',{id,reviewFormat:'compact'}) as {totalOriginals:number;candidates:{index:number;title:string;excerpt:string}[];screened:{index:number;decision:string}[]}
  assert.equal(packet.totalOriginals,17);assert.equal(packet.candidates.length+packet.screened.length,17);assert.equal(new Set([...packet.candidates,...packet.screened].map(r=>r.index)).size,17)
  assert.ok(Buffer.byteLength(JSON.stringify(packet))<24*1024);assert.ok(packet.candidates.every(c=>c.excerpt.length<=220))
  const dense=f.store.batch(id);dense.sources.forEach(s=>s.originals.forEach(o=>{o.title='中文长标题'.repeat(32)}));dense.revision++;f.store.save([dense])
  const densePacket=await f.execute('read',{id,reviewFormat:'compact'});assert.ok(Buffer.byteLength(JSON.stringify(densePacket))<=20*1024,'Entire CJK reply has a byte budget, including repeated titles and identities')
  const before=f.store.batch(id),originals=before.sources.flatMap(s=>s.originals),chosen=packet.candidates[0]
  await assert.rejects(f.execute('review',{id,choices:[{index:19,decision:'skip'}]}),/outside/)
  const result=await f.execute('review',{id,choices:[{index:chosen.index,decision:'save',summary:'Synthetic reviewed announcement.'}]}) as {saved:number;pending:number}
  assert.equal(result.saved,1);assert.equal(result.pending,16)
  const saved=f.store.batch(id).sources.flatMap(s=>s.originals)[chosen.index],lead=f.rolling.entity(saved.leadId!,'lead')
  assert.equal(lead.title,originals[chosen.index].title);assert.equal(lead.evidence.quote,originals[chosen.index].excerpt.slice(0,500));assert.equal(lead.evidence.bodySha256,originals[chosen.index].bodySha256)
  const revision=f.rolling.records.state().revision
  await f.execute('review',{id,choices:[{index:chosen.index,decision:'save',summary:'Synthetic reviewed announcement.'}]});assert.equal(f.rolling.records.state().revision,revision)
 }finally{f.close()}
})

test('News screening uses frozen publication intervals, excludes proven old originals and retains uncertainty',async()=>{
 const {screenBatchOriginal,publicationInterval}=await import('../src/collection-batch-screening.js')
 assert.equal(publicationInterval('2026-02-30'),null);assert.equal(publicationInterval('2026-02-30T12:00:00Z'),null);assert.equal(publicationInterval('about 16 hours ago'),null);assert.equal(publicationInterval('Jul 15'),null)
 assert.deepEqual(publicationInterval('Feb 22, 2024'),publicationInterval('2024-02-22'))
 const f=await createCollectionBatchFixture({now:Date.parse('2026-10-22T13:00:00Z')})
 try{
  const id=await f.start();await f.execute('collect',{id});const original=f.store.batch(id).sources.flatMap(s=>s.originals)[0],body=await f.ports[0].readBody(original.sourceId,original.acquisitionId)
  const screen=(publishedAt:string,text=publishedAt)=>screenBatchOriginal('2026-10-22T13:00:00Z',original,{...body.acquisition,publishedAt},text)
  assert.equal(screen('2026-10-21T12:00:00Z').decision,'review');assert.equal(screen('2024-02-22').decision,'skip')
  assert.equal(screen('2026-10-22').decision,'pending');assert.equal(screen('2026-10-21','date absent').decision,'pending');assert.equal(screen('3 days ago').decision,'pending')
  assert.equal(screenBatchOriginal('2026-10-22T13:00:00Z',{...original,complete:false},body.acquisition,body.text).decision,'pending')
  assert.equal(screenBatchOriginal('2026-10-22T13:00:00Z',original,body.acquisition,body.text,true).reason,'unverified-trend-observation')
 }finally{f.close()}
})

test('Background batch scope admits compact review only for its exact agent Project, Session and saved batch',()=>{
 const owner={projectId:'p',sessionId:'s'},request={operation:'review',projectId:'p',id:'batch',choices:[]}
 for(const operation of ['collect','read','submit','review'])assert.doesNotThrow(()=>assertBatchBackgroundScope({...request,operation},'agent',owner,owner,'batch'))
 for(const other of [{...request,id:'other'},{...request,projectId:'foreign'},{...request,operation:'start'},{...request,operation:'cancel'},{...request,operation:'recover'}])assert.throws(()=>assertBatchBackgroundScope(other,'agent',owner,owner,'batch'),/restricted/)
 assert.throws(()=>assertBatchBackgroundScope(request,'user',owner,owner,'batch'),/restricted/)
 assert.throws(()=>assertBatchBackgroundScope(request,'agent',{...owner,sessionId:'other'},owner,'batch'),/restricted/)
})
