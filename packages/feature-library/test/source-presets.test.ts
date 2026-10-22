import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Ajv} from 'ajv'
import {AI_NEWS_SOURCE_PRESETS,sourcePreset} from '../src/source-presets.js'
import {LibraryService} from '../src/library-service.js'
import {RollingService,RollingStore} from '../src/rolling-service.js'
import {assertRolling,assertRollingRequest,rollingRequestSchema,subscriptionInput,socialObservationKind,socialAccessIssue} from '../src/rolling-contract.js'
import {ProjectSourceStore} from '../../platform/src/project-source-store.js'
test('Fixed catalog is closed, HTTPS and platform checked, with official/research/reporting and X/YouTube observation coverage',()=>{
 assert.equal(AI_NEWS_SOURCE_PRESETS.length,24);assert.equal(new Set(AI_NEWS_SOURCE_PRESETS.map(p=>p.id)).size,24)
 for(const preset of AI_NEWS_SOURCE_PRESETS){assert.equal(new URL(preset.identityUrl).protocol,'https:');subscriptionInput({title:preset.title,platform:preset.platform,url:preset.url,fallbackUrls:preset.fallbackUrls,identityBasis:preset.identityUrl,region:preset.region,language:preset.language,status:'paused',topicIds:[],directionIds:[]})}
 assert.throws(()=>sourcePreset('missing'))
 const validate=new Ajv({strict:false}).compile(rollingRequestSchema)
 for(const raw of [{operation:'presets',projectId:'p'},{operation:'subscribe-preset',projectId:'p',presetId:'x-openai',expectedRevision:0,status:'paused',topicIds:[],directionIds:[]}]){assert.ok(validate(raw));assertRollingRequest(raw)}
 assert.throws(()=>assertRollingRequest({operation:'presets',projectId:'p',shell:'x'}))
})
test('Preset subscription is trusted, CAS protected, repeat safe and preserves edited subscriptions, old files and paused defaults',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-fixed-sources-'))),projects=['p','q'].map(id=>{const directory=path.join(root,id);fs.mkdirSync(directory);return {id,name:id,directory}}),source=new ProjectSourceStore(projects[0].directory,'p'),library=new LibraryService({projects:()=>projects,active:()=>projects[0],sources:()=>source,guard:()=>{}}),service=new RollingService(library),store=new RollingStore(projects[0].directory,'p')
 try{const old=path.join(projects[0].directory,'old-news.json');fs.writeFileSync(old,'preserved');const request={operation:'subscribe-preset',projectId:'p',presetId:'openai-news',expectedRevision:0,status:'paused',topicIds:[],directionIds:[]}
  assert.equal((await service.execute({operation:'presets',projectId:'p'},'agent') as {items:unknown[]}).items.length,24);assert.equal(store.records.state().revision,0)
  await assert.rejects(service.execute(request,'agent'),/USER_REQUIRED/);await assert.rejects(service.execute({...request,projectId:'q'},'user'),/PROJECT/)
  const added=await service.execute(request,'user') as {items:{id:string}[]};const saved=store.entity(added.items[0].id,'subscription');assert.equal(saved.input.status,'paused')
  await service.execute({operation:'put-subscription',projectId:'p',id:saved.id,expectedRevision:store.records.state().revision,input:{...saved.input,title:'User edited',status:'following'}},'user');const before=store.entity(saved.id,'subscription'),sequence=store.records.state().sequence
  const repeat=await service.execute({...request,expectedRevision:store.records.state().revision},'user') as {preserved:boolean};assert.equal(repeat.preserved,true);assert.equal(store.records.state().sequence,sequence);assert.deepEqual(store.entity(saved.id,'subscription'),before);assert.equal(fs.readFileSync(old,'utf8'),'preserved')
  await assert.rejects(service.execute(request,'user'),/CONFLICT/);assert.equal(fs.existsSync(path.join(root,'library','collection-schedules.json')),false)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('Social observation kinds and challenge guards do not invent growth or reinterpret old optional fields',()=>{
 for(const [url,platform,kind]of [['https://x.com/OpenAI/status/123','x','post'],['https://x.com/explore/tabs/trending','x','trend'],['https://x.com/search?q=AI','x','topic'],['https://x.com/OpenAI','x','account'],['https://www.youtube.com/watch?v=abc','youtube','video'],['https://www.youtube.com/results?search_query=AI','youtube','topic']] as const)assert.equal(socialObservationKind(url,platform),kind)
 for(const text of ['Sign in to confirm you’re not a bot','Something went wrong. Try again.','Log in to X'])assert.equal(socialAccessIssue(text),true)
 assert.equal(socialAccessIssue('','https://x.com/i/jf/onboarding/web?mode=login'),true)
 assert.equal(socialAccessIssue('OpenAI\n5M followers\nSign in\nAn actual visible post'),false)
 const scope={sourceId:'s',acquisitionId:'a',bodySha256:'a'.repeat(64),url:'https://x.com/OpenAI/status/123',observedAt:new Date().toISOString(),quote:'original',quoteStart:0},legacy={version:1,kind:'lead',id:'l',revision:1,updatedAt:new Date().toISOString(),subscriptionId:'sub',runId:'run',title:'Original',summary:'Old',missing:'',status:'open',evidence:scope,social:{platform:'x',platformId:'123',entryUrl:'https://x.com/OpenAI',region:'global',language:'en',metricsText:''},topicIds:[],directionIds:[]}
 assert.equal(Object.hasOwn((assertRolling(legacy) as typeof legacy).social,'observationKind'),false)
})
