import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {performance} from 'node:perf_hooks'
import {setTimeout as delay} from 'node:timers/promises'
import type {BrowserFeatureHost,CollectionPageRequest,CollectionPageResult} from '../packages/browser-capability/src/browser-host.js'
import {withCollectionPagePool} from '../packages/browser-capability/src/collection-page-pool.js'
import type {SourceObservation} from '../packages/media-native/src/source-contract.js'
import {ProjectSourceStore} from '../packages/platform/src/project-source-store.js'
import {LibraryService} from '../packages/feature-library/src/library-service.js'
import {RollingService,RollingStore} from '../packages/feature-library/src/rolling-service.js'
import {CollectionBatchService} from '../packages/feature-library/src/collection-batch-service.js'
import type {BatchRuntime} from '../packages/feature-library/src/collection-batch-service.js'
import {CollectionBatchStore} from '../packages/feature-library/src/collection-batch-store.js'
import type {BatchDecision,CollectionBatch} from '../packages/feature-library/src/collection-batch-contract.js'
import {sourcePreset} from '../packages/feature-library/src/source-presets.js'
import type {Subscription} from '../packages/feature-library/src/rolling-contract.js'

/** The same nine configured entry URLs as the real baseline, with explicitly
 * synthetic DOM observations. No network, credentials, model or profile is used. */
export const SAME_NINE_PRESETS=['nvidia-ai','huggingface-blog','techcrunch-ai','openai-news','qbitai','x-openai','x-trends','youtube-openai','youtube-ai-search'] as const
export type EntryFixtureMode='normal'|'restricted'|'blank'|'truncated'|'no-links'|'redirect'|'failed'
export interface CollectionFixtureOptions {ioConcurrency?:1|2|3;delayMs?:number;linksPerSource?:number;now?:number;articleTruncated?:boolean}
const articles=(id:string,index:number):string=>({
 'nvidia-ai':'https://blogs.nvidia.com/blog/fixture-ai-'+index+'/',
 'huggingface-blog':'https://huggingface.co/blog/fixture-ai-'+index,
 'techcrunch-ai':'https://techcrunch.com/2026/10/21/fixture-ai-'+index+'/',
 'openai-news':'https://openai.com/index/fixture-ai-'+index+'/',
 'qbitai':'https://www.qbitai.com/2026/10/'+(90000+index)+'.html',
 'x-openai':'https://x.com/OpenAI/status/'+(1000000+index),
 'youtube-openai':'https://www.youtube.com/watch?v=OpenAIFixture'+index,
 'youtube-ai-search':'https://www.youtube.com/watch?v=TopicFixture'+index
 }[id]??'https://x.com/explore/tabs/trending')
export function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve}}

/** Exported only for isolated regressions and this reproducible benchmark. All
 * source/checkpoint/rolling writes use the production stores in a disposable dir. */
export async function createCollectionBatchFixture(options:CollectionFixtureOptions={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-batch-fixture-')))
 const projects=['p','foreign'].map(id=>{const directory=path.join(root,id);fs.mkdirSync(directory);return {id,name:id,directory}})
 const ports=projects.map(p=>new ProjectSourceStore(p.directory,p.id)),owner={projectId:'p',sessionId:'s'}
 const state={activeProject:0,now:options.now??Date.now(),anchor:'official-anchor',availability:null as string|null,enqueueThrows:false,enqueueRejects:false,dispatches:0,cancels:0,recoveries:0,drained:false,cleanupFails:false,closeGate:null as Promise<void>|null,cancelGate:null as Promise<void>|null,beforeRead:null as ((url:string)=>Promise<void>)|null,metrics:'120 views',articleTruncated:options.articleTruncated??false,activeReads:0,peakReads:0,nativeReadBusyMs:0,nativeReadSumMs:0,closedLanes:0,visits:[] as string[],entryModes:new Map<string,EntryFixtureMode>()}
 const library=new LibraryService({projects:()=>projects,active:()=>projects[state.activeProject],sources:id=>ports[projects.findIndex(p=>p.id===id)],guard:()=>{},directions:()=>({version:1,revision:0,directions:[]})})
 const rolling=new RollingStore(projects[0].directory,'p'),store=new CollectionBatchStore(projects[0].directory,'p'),rollingService=new RollingService(library)
 const presets=SAME_NINE_PRESETS.map(sourcePreset),subscriptions:Subscription[]=[]
 for(const preset of presets){const response=await rollingService.execute({operation:'subscribe-preset',projectId:'p',expectedRevision:rolling.records.state().revision,presetId:preset.id,status:'following',topicIds:[],directionIds:[]},'user',owner) as {items:Subscription[]};subscriptions.push(response.items[0])}
 const runtime:BatchRuntime={binding:()=>({...owner,driverId:'qoder-cn'}),anchor:()=>state.anchor,available:()=>state.availability,recoverable:()=>true,
  enqueue:()=>{state.dispatches++;state.drained=false;if(state.enqueueThrows)throw new Error('uncertain input delivery');return state.enqueueRejects?{accepted:false,reason:'user task active'}:{accepted:true,dispatchId:'dispatch-'+state.dispatches}},
  receipt:()=>({state:state.drained?'interrupted':'active',drained:state.drained}),cancel:async()=>{state.cancels++;if(state.cancelGate)await state.cancelGate;state.drained=true}}
 const scope=(selector:string,truncated=false)=>({selector,index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated,status:'observed' as const})
 const observe=(request:CollectionPageRequest):CollectionPageResult=>{
  const preset=presets.find(p=>p.url===request.url),mode=preset?(state.entryModes.get(preset.id)??'normal'):'normal',range=scope(request.source.bodySelector??'body',mode==='truncated'||(!preset&&state.articleTruncated))
  if(mode==='failed')throw new Error('fixture navigation failed')
  const text=mode==='blank'?'':mode==='restricted'?'Sign in to confirm you’re not a bot':preset?'Visible entry for '+preset.id+' '+state.metrics:'Original fixture AI announcement '+request.url+' '+state.metrics
  const observation:SourceObservation={url:mode==='redirect'?'https://example.org/unconfigured':request.url,title:mode==='restricted'?'Sign in':'Fixture '+(preset?.id??'article'),author:'Fixture publisher',publishedAt:new Date(state.now-60*60*1000).toISOString(),scope:range,text,mediaScope:range,mediaTruncated:false,candidates:[],access:mode==='restricted'?'login-required':'unknown',accessText:mode==='restricted'?'Sign in':'',result:mode==='restricted'?'login-required':'observed',error:null}
  return {observation,links:preset&&mode!=='no-links'?Array.from({length:options.linksPerSource??2},(_,i)=>({url:articles(preset.id,i+1),text:'Fixture article '+(i+1)})):[],linksTruncated:false}
 }
 let serial=Promise.resolve(),busySince=0
 const read=async(request:CollectionPageRequest,signal:AbortSignal)=>{
  const work=async()=>{signal.throwIfAborted();const started=performance.now();state.visits.push(request.url);if(!state.activeReads)busySince=started;state.activeReads++;state.peakReads=Math.max(state.peakReads,state.activeReads)
   try{if(state.beforeRead)await state.beforeRead(request.url);await delay(options.delayMs??1,undefined,{signal});signal.throwIfAborted();return observe(request)}finally{const finished=performance.now();state.nativeReadSumMs+=finished-started;state.activeReads--;if(!state.activeReads)state.nativeReadBusyMs+=finished-busySince}}
  if(options.ioConcurrency!==1)return work()
  const result=serial.then(work);serial=result.then(()=>{},()=>{});return result
 }
 const browser:BrowserFeatureHost={projectStore:{active:()=>projects[state.activeProject]},projectSources:()=>ports[state.activeProject],recordingController:{narrate:async()=>{throw new Error('fixture forbids media')},compose:async()=>{throw new Error('fixture forbids media')},processArtifact:async()=>{throw new Error('fixture forbids media')}},execute:async()=>{throw new Error('fixture forbids general browser actions')},
  collectPageBatch:async(poolOptions,work,signal)=>withCollectionPagePool(poolOptions,()=>({visit:read,close:async()=>{if(state.closeGate)await state.closeGate;if(state.cleanupFails)throw new Error('fixture native cleanup quarantined');state.closedLanes++}}),work,signal),
  recoverCollectionPages:async()=>{state.recoveries++;if(state.cleanupFails)throw new Error('fixture cleanup still quarantined')}}
 const service=new CollectionBatchService(library,browser,runtime,()=>state.now)
 const execute=(operation:string,fields:Record<string,unknown>={},actor:'user'|'agent'='agent',sessionOwner=owner,signal?:AbortSignal)=>service.execute({operation,projectId:'p',...fields},actor,sessionOwner,signal)
 const start=async(concurrency:2|3=options.ioConcurrency===3?3:2,articleLimit=20,ids=subscriptions.map(s=>s.id))=>{const response=await execute('start',{expectedRevision:rolling.records.state().revision,subscriptionIds:ids,concurrency,articleLimit},'user') as {batch:CollectionBatch};return response.batch.id}
 const decisions=(id:string,decision:'save'|'skip'|'pending'='save'):BatchDecision[]=>store.batch(id).sources.flatMap(s=>s.originals.map(o=>decision==='save'?{sourceId:o.sourceId,acquisitionId:o.acquisitionId,decision,title:o.title,summary:'Synthetic original supports this isolated fixture lead.',missing:'Fixture content; no real news verification.',quote:o.excerpt,quoteStart:0,metricsText:state.metrics}:{sourceId:o.sourceId,acquisitionId:o.acquisitionId,decision}))
 return {root,projects,ports,owner,state,library,rolling,rollingService,store,service,browser,runtime,subscriptions,execute,start,decisions,close:()=>fs.rmSync(root,{recursive:true,force:true})}
}

export async function runCollectionBatchBenchmark(delayMs=30,samples=3){
 const results:Record<string,unknown>[]=[],qualityFingerprints:string[]=[],now=Date.now()
 for(const ioConcurrency of [1,2,3] as const)for(let sample=1;sample<=samples;sample++){
  const f=await createCollectionBatchFixture({ioConcurrency,delayMs,now})
  try{const started=performance.now(),id=await f.start(),beforeCollect=performance.now();await f.execute('collect',{id});const afterCollect=performance.now();await f.execute('submit',{id,decisions:f.decisions(id)});const finished=performance.now(),batch=f.store.batch(id),originals=batch.sources.reduce((n,s)=>n+s.originals.length,0),trendObservations=batch.sources.filter(s=>s.input.platform==='x'&&s.input.url.includes('/explore/')).reduce((n,s)=>n+s.originals.length,0)
   const qualityFingerprint=crypto.createHash('sha256').update(JSON.stringify(batch.sources.flatMap(s=>s.originals.map(o=>({url:o.url,bodySha256:o.bodySha256,author:o.author,publishedAt:o.publishedAt,complete:o.complete}))).sort((a,b)=>a.url.localeCompare(b.url)))).digest('hex')
   qualityFingerprints.push(qualityFingerprint)
   results.push({ioConcurrency,sample,qualityFingerprint,elapsedMs:Math.round(finished-started),collectMs:Math.round(afterCollect-beforeCollect),nativeReadBusyMs:Math.round(f.state.nativeReadBusyMs),nativeReadSumMs:Math.round(f.state.nativeReadSumMs),peakReads:f.state.peakReads,pageReads:f.state.visits.length,originals,articleOriginals:originals-trendObservations,trendObservations,savedLeads:batch.sources.reduce((n,s)=>n+s.originals.filter(o=>o.status==='saved').length,0),nativeActions:{trustedStart:1,officialCollect:1,officialSubmit:1},dispatches:f.state.dispatches,status:batch.status,sourceStates:batch.sources.map(s=>({url:s.input.url,state:s.state,pending:s.pendingUrls.length}))})
  }finally{f.close()}
 }
 return {kind:'deterministic-same-nine-store-and-io-benchmark',realNetwork:false,realProfile:false,paidModel:false,delayMs,samples,sourceUrls:SAME_NINE_PRESETS.map(id=>sourcePreset(id).url),qualityValidation:{matched:qualityFingerprints.length===samples*3&&new Set(qualityFingerprints).size===1,baseline:qualityFingerprints[0]??null,checked:qualityFingerprints.length,fields:['url','bodySha256','author','publishedAt','complete'],ordering:'url ascending'},comparison:'Identical fixture originals and real stores; serial I/O versus 2/3 bounded I/O within the same new batch service. This is not an old-Agent or production speed measurement. Trend observations are not verified independent news events.',timingNotes:'Native read Busy/Sum measure intervals while awaited reads are outstanding; serialized store I/O can delay the event loop. They are not pure network or renderer execution time.',historicalReference:{elapsedMinutes:59,browserCalls:231,newLeads:12,comparable:false,reason:'Historical logged-in run had different content, model think time and UI interaction; the fixture does not reproduce those conditions.'},results}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const delayMs=Number(process.argv[2]??30),samples=Number(process.argv[3]??3);if(!Number.isInteger(delayMs)||delayMs<0||delayMs>1000||!Number.isInteger(samples)||samples<1||samples>5)throw new Error('Usage: benchmark [I/O delay 0–1000ms] [1–5 samples]');const result=await runCollectionBatchBenchmark(delayMs,samples);process.stdout.write(JSON.stringify(result,null,2)+'\n');if(!result.qualityValidation.matched)process.exitCode=1}
