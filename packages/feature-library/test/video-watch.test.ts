import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Ajv} from 'ajv'
import {RollingService,RollingStore,collectionPrompt} from '../src/rolling-service.js'
import {LibraryService} from '../src/library-service.js'
import {rollingRequestSchema} from '../src/rolling-contract.js'
import type {CollectionRun,Lead} from '../src/rolling-contract.js'
import type {NewsTopicCandidate} from '../src/news-contract.js'
import {dueVideos,videoFollowupSummary} from '../src/video-watch-service.js'
import {watchFresh,watchExpired} from '../src/video-watch-policy.js'
import type {VerifyWatchVideo} from '../src/video-watch-service.js'
import {ProjectSourceStore} from '../../platform/src/project-source-store.js'

function fixture(verify?:VerifyWatchVideo){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-video-watch-'))),project={id:'watch-project',name:'Test Project',directory:root},sources=new ProjectSourceStore(root,project.id),owner={projectId:project.id,sessionId:'test-session'},runs:CollectionRun[]=[]
 let now=Date.now(),deliveryFails=false
 const library=new LibraryService({projects:()=>[project],active:()=>project,sources:()=>sources,guard:()=>{}}),store=new RollingStore(root,project.id)
 const service=()=>new RollingService(library,{start:async r=>{runs.push(r);if(deliveryFails)throw new Error('uncertain');return 'dispatch-'+runs.length},cancel:async()=>{}},()=>now,verify)
 const execute=(operation:string,fields:Record<string,unknown>={},actor:'user'|'agent'='agent',session=owner)=>service().execute({operation,projectId:project.id,...(['read','video-pool'].includes(operation)?{}:{expectedRevision:store.records.state().revision}),...fields},actor,session)
 const original=async(url:string,publishedAt=new Date(now-1000).toISOString())=>{const scope={selector:'main',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const},saved=await sources.collect({url,title:'GPU funding',author:'Publisher',publishedAt,scope,text:'Verified funding news',mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null},sources.state().revision);return {sourceId:saved.sourceId,acquisitionId:saved.acquisitionId,quote:'Verified funding news',quoteStart:0}}
 const setup=async()=>{const result=await execute('put-subscription',{input:{title:'AI news',platform:'web',url:'https://example.org/feed',fallbackUrls:[],identityBasis:'Official publisher',region:'global',language:'en',topicIds:[],directionIds:[],status:'following'}},'user') as {items:{id:string}[]};const sub=result.items[0].id;await execute('start',{id:sub},'user');const runId=runs.at(-1).id,e=await original('https://example.org/funding'),saved=await execute('save-lead',{runId,title:'Funding',summary:'New funding for GPUs',missing:'No source video yet',...e}) as {id:string};await execute('watch-video',{id:saved.id,runId,eventKey:'gpu-funding'});return {sub,id:saved.id,e}}
 const candidate=(e:Awaited<ReturnType<typeof original>>):NewsTopicCandidate=>({id:'funding',eventKey:'gpu-funding',subject:'Issuer',subjectKind:'organization',category:'company',region:'global',title:'GPU funding',news:'Funding announced',reason:'Material AI investment',angle:'Compute finance',format:'announcement',novelty:'new-event',recordedAt:null,missing:'',...e,previewArtifactId:'clip.mp4',mode:'video'})
 return {root,store,runs,owner,sources,execute,setup,original,candidate,now:()=>now,advance:(ms:number)=>now+=ms,fail:()=>deliveryFails=true,close:()=>fs.rmSync(root,{recursive:true,force:true})}
}

test('A civil publication day stays pending until its timezone range is known; ambiguity is never treated as proven expiry',()=>{
 const w={publishedAt:'2026-10-26'},now=Date.parse('2026-10-26T12:00:00Z')
 assert.equal(watchFresh(w,now),false);assert.equal(watchExpired(w,now),false)
 assert.equal(watchFresh(w,Date.parse('2026-10-28T00:00:00Z')),true)
 assert.equal(watchExpired(w,Date.parse('2026-10-31T00:00:00Z')),true)
})

test('Video pool persists across next-day runs, preserves original dates, deduplicates events, and reschedules missing footage without confirmation',async()=>{
 const f=fixture();try{const {sub,id}=await f.setup(),initial=f.store.entity(id,'lead').videoWatch.publishedAt
  const first=f.runs.at(-1).id;await f.execute('update-video',{id,runId:first,missing:'Checked two sources; no video yet'})
  await assert.rejects(f.execute('update-video',{id,runId:first,missing:'Repeat'}),/CHECKED/)
  await f.execute('finish',{runId:first,status:'partial',note:'Video waiting; coverage retained'})
  f.advance(24*3600000);const restarted=new RollingStore(f.root,f.owner.projectId);assert.equal(restarted.entity(id,'lead').videoWatch.state,'waiting');assert.equal(dueVideos(restarted,sub,f.now())[0].id,id)
  await f.execute('start',{id:sub},'user');const next=f.runs.at(-1);assert.deepEqual(next.videoLeadIds,[id]);assert.match(collectionPrompt(f.owner.projectId,next),/不要求用户确认素材重投/)
  const read=await f.execute('read',{id:next.id}) as {videoFollowups:Lead[]};assert.equal(read.videoFollowups[0].id,id)
  const large=f.store.entity(id,'lead');large.videoWatch.evidence=Array.from({length:20},()=>({...large.evidence,quote:'x'.repeat(4000),url:'https://example.org/'+ 'a'.repeat(1800)}));const summary=videoFollowupSummary(large,f.now());assert.equal(summary.evidenceCount,20);assert.equal(summary.evidenceOmitted,17);assert.ok(JSON.stringify(summary).length<3000)
  await assert.rejects(f.execute('update-video',{id,runId:next.id,missing:'Wrong session'},'agent',{...f.owner,sessionId:'other'}),/LEASE/)
  await f.execute('update-video',{id,runId:next.id,missing:'Still no video; normal wait'})
  const w=f.store.entity(id,'lead').videoWatch;assert.equal(w.publishedAt,initial);assert.equal(w.checks,2);assert.ok(Date.parse(w.nextCheckAt)>f.now());assert.equal(w.state,'waiting')
  await f.execute('finish',{runId:next.id,status:'partial',note:'Normal waiting'})
  const old=f.store.entity(id,'lead');await f.execute('watch-video',{id,eventKey:w.eventKey,expectedLeadRevision:old.revision,paused:true},'user');f.advance(3600000);assert.equal(dueVideos(f.store,sub,f.now()).length,0)
  await f.execute('start',{id:sub},'user');assert.deepEqual(f.runs.at(-1).videoLeadIds,[])
 }finally{f.close()}
})

test('Native verifier is mandatory; video promotion retains both sources and original event freshness, rejecting image substitution and expired late footage',async()=>{
 let verifyCount=0
 const f=fixture(async c=>{verifyCount++;return {candidate:c,facts:{url:'https://video.example.org/new',author:'Official',publishedAt:new Date(f.now()).toISOString(),contentSha256:'a'.repeat(64),previewSha256:'b'.repeat(64),durationSeconds:4,sourceRange:{startSeconds:0,endSeconds:4},checkedAt:new Date(f.now()).toISOString()}}})
 try{const {sub,id}=await f.setup(),initial=f.store.entity(id,'lead').videoWatch.publishedAt;await f.execute('finish',{runId:f.runs.at(-1).id,status:'partial',note:'Waiting'})
  f.advance(24*3600000);await f.execute('start',{id:sub},'user');const runId=f.runs.at(-1).id,e=await f.original('https://video.example.org/new'),c=f.candidate(e)
  await assert.rejects(f.execute('update-video',{id,runId,missing:'',...e,candidate:{...c,mode:'image'},contentKind:'cg'}),/VIDEO/)
  await assert.rejects(f.execute('update-video',{id,runId,missing:'',candidate:c,contentKind:'cg'}),/evidence/)
  await f.execute('update-video',{id,runId,missing:'',...e,candidate:c,contentKind:'cg'})
  const w=f.store.entity(id,'lead').videoWatch;assert.equal(w.state,'ready');assert.equal(w.contentKind,'cg');assert.equal(w.publishedAt,initial);assert.equal(w.evidence.length,1);assert.equal(verifyCount,1)
  f.advance(72*3600000);const pool=await f.execute('video-pool') as {items:{videoEligible:boolean;videoState:string}[]};assert.equal(pool.items[0].videoState,'expired');assert.equal(pool.items[0].videoEligible,false)
 }finally{f.close()}
 const expired=fixture();try{const {id,sub}=await expired.setup();await expired.execute('finish',{runId:expired.runs.at(-1).id,status:'partial',note:'Waiting'});expired.advance(4*86400000);assert.deepEqual(dueVideos(expired.store,sub,expired.now()),[]);const old=expired.store.entity(id,'lead');await expired.execute('watch-video',{id,eventKey:'gpu-funding',expectedLeadRevision:old.revision,paused:false},'user');assert.equal(expired.store.entity(id,'lead').videoWatch.state,'expired')}finally{expired.close()}
})

test('Video watch closed schema, event identity, GUI CAS and uncertain delivery boundary survive new collection attempts',async()=>{
 const validate=new Ajv({strict:false}).compile(rollingRequestSchema)
 assert.ok(validate({operation:'update-video',projectId:'p',expectedRevision:0,id:'lead',runId:'run',missing:'Waiting'}))
 assert.equal(validate({operation:'watch-video',projectId:'p',expectedRevision:0,id:'lead',eventKey:'event',shell:'no'}),false)
 const f=fixture();try{const {id,sub}=await f.setup(),runId=f.runs.at(-1).id;await f.execute('finish',{runId,status:'partial',note:'Waiting'})
  await assert.rejects(f.execute('watch-video',{id,eventKey:'different',expectedLeadRevision:f.store.entity(id,'lead').revision},'user'),/IDENTITY/)
  await assert.rejects(f.execute('watch-video',{id,eventKey:'gpu-funding',expectedLeadRevision:0,paused:true},'user'),/CONFLICT/)
  f.advance(3*3600000);f.fail();await assert.rejects(f.execute('start',{id:sub},'user'),/uncertain/);const uncertain=f.runs.at(-1);assert.equal(f.store.entity(uncertain.id,'run').status,'uncertain');assert.equal(f.store.entity(uncertain.id,'run').dispatchId,null)
  await assert.rejects(f.execute('start',{id:sub},'user'),/BUSY/);assert.equal(f.runs.length,2);assert.equal(f.store.entity(id,'lead').videoWatch.checks,0)
 }finally{f.close()}
})

test('A GUI edit during native verification wins; supplementary sources and ready state are not partially committed',async()=>{
 let f:ReturnType<typeof fixture>
 f=fixture(async c=>{const old=f.store.entity(target,'lead');f.store.commit([{...old,revision:old.revision+1,missing:'User correction'}],f.store.records.state().revision,'fixture-gui-edit');return {candidate:c,facts:{url:'https://example.org/video',author:'Issuer',publishedAt:new Date(f.now()-1000).toISOString(),contentSha256:'c'.repeat(64),previewSha256:'d'.repeat(64),durationSeconds:4,sourceRange:null,checkedAt:new Date(f.now()).toISOString()}}})
 let target=''
 try{const {id}=await f.setup();target=id;const e=await f.original('https://example.org/video');await assert.rejects(f.execute('update-video',{id,runId:f.runs.at(-1).id,missing:'',...e,candidate:f.candidate(e),contentKind:'animation'}),/CONFLICT/);const lead=f.store.entity(id,'lead');assert.equal(lead.missing,'User correction');assert.equal(lead.videoWatch.state,'waiting');assert.equal(lead.videoWatch.evidence.length,0)}finally{f.close()}
})
