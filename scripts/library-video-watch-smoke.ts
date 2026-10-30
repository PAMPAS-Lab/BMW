import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {app,BrowserWindow,session,ipcMain,webContents} from 'electron'
import {bmwProduct} from '../packages/product-bmw/index.js'
import {activateWorkspaces} from '../packages/platform/src/workspace-runtime.js'
import type {FeatureRuntime} from '../packages/platform/src/feature-contract.js'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import type {BrowserFeatureHost} from '../packages/browser-capability/src/browser-host.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {GlobalSettingsStore} from '../packages/platform/src/global-settings-store.js'
import {ProjectSourceStore} from '../packages/platform/src/project-source-store.js'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {RollingStore} from '../packages/feature-library/src/rolling-service.js'
import {NewsJournal} from '../packages/feature-library/src/news-store.js'
import {NewsResearchService} from '../packages/feature-library/src/news-research-service.js'
import type {NewsTopicCandidate} from '../packages/feature-library/src/news-contract.js'
import {mediaRecord} from '../packages/media-native/src/media-contract.js'

const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-watch-profile-'))),profile=path.join(root,'profile'),project={id:'watch-test',name:'Video wait test',directory:path.join(root,'project')},artifacts=path.join(project.directory,'artifacts'),sessionId='watch-session'
fs.mkdirSync(profile);fs.mkdirSync(artifacts,{recursive:true});app.setPath('userData',profile);app.setPath('home',root)
let runtime:FeatureRuntime|undefined,window:BrowserWindow|undefined,media:MediaController|undefined,phase='startup'
const deadline=setTimeout(()=>{console.error('Video watch timeout:',phase);app.exit(1)},90000)
async function wait<T>(fn:()=>Promise<T>,label:string){phase=label;const until=Date.now()+12000;while(Date.now()<until){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,50))}throw new Error('Video watch wait failed: '+label)}
async function run(){try{
 const isolated=session.fromPartition('watch-test-'+crypto.randomUUID()),sources=new ProjectSourceStore(project.directory,project.id),store=new RollingStore(project.directory,project.id),owner={projectId:project.id,sessionId},registry=new BrowserCapabilityRegistry(bmwProduct),settings=new GlobalSettingsStore({filePath:path.join(profile,'settings.json'),onState:undefined})
 window=new BrowserWindow({width:1400,height:950,show:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}})
 await window.loadFile(path.resolve('packages/media-native/src/media/media.html'))
 // Controlled moving CG fixture, not a public news clip or paid-model test.
 const bytes=await window.webContents.executeJavaScript(`(async()=>{const {Output,WebMOutputFormat,BufferTarget,CanvasSource}=await import('mediabunny');const c=new OffscreenCanvas(160,90),x=c.getContext('2d'),target=new BufferTarget(),o=new Output({format:new WebMOutputFormat(),target}),v=new CanvasSource(c,{codec:'vp9',bitrate:150000});o.addVideoTrack(v,{frameRate:10});await o.start();for(let n=0;n<40;n++){x.fillStyle='#182338';x.fillRect(0,0,160,90);x.fillStyle='#ffcc55';x.fillRect(n*3,25,20,40);await v.add(n/10,.1)}v.close();await o.finalize();return [...new Uint8Array(target.buffer)]})()`) as number[]
 fs.writeFileSync(path.join(artifacts,'source-video.webm'),Buffer.from(bytes))
 media=new MediaController({session:isolated,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:()=>{}})
 const kernel=new BrowserKernel({window,session:isolated,capabilityRegistry:registry,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project},artifactsDirectory:artifacts,sessionContinuity:undefined,settingsStore:settings,allowedActions:undefined,onState:undefined});kernel.setRecordingController(media);kernel.projectSources=()=>sources
 runtime=await activateWorkspaces(bmwProduct.features,{session:isolated,projectStore:{active:()=>project}})
 const prompts:string[]=[]
 runtime.configure!({browserKernel:kernel as unknown as BrowserFeatureHost,projectStore:{active:()=>project},libraryProfileDirectory:()=>profile,listLibraryProjects:()=>[project],librarySources:()=>sources,getMainWindow:()=>window,getShellWebContents:()=>window.webContents,getTheme:()=>'light',getCurrentSessionId:()=>sessionId,isProjectChanging:()=>false,setWorkspaceMode:()=>runtime.layout!({x:0,y:0,width:1400,height:950},true),revealAgent:()=>{},synchronizeAgentProject:async()=>({sessionId}),enqueueAssistant:async(_s,p)=>{prompts.push(p);return 'fixture-'+prompts.length},cancelAssistant:async()=>{},getAssistantActivity:()=>({projectId:project.id,sessionId,status:'idle',runId:null}),sendToAgent:()=>{},sendToShell:()=>{}})
 runtime.installIpc!(ipcMain);await runtime.setMode!('library')
 const ui=await wait(async()=>webContents.getAllWebContents().find(w=>w.getURL().endsWith('/library.html')&&!w.isLoading()),'library renderer'),script=<T>(code:string)=>ui.executeJavaScript(code) as Promise<T>
 await wait(()=>script("document.body.dataset.libraryBusy==='false'"),'library initialized')
 const execute=async(operation:string,fields:Record<string,unknown>={},actor:'agent'|'user'='agent')=>kernel.execute({action:'library.collecting',collectionRequest:{operation,projectId:project.id,...(['read','video-pool'].includes(operation)?{}:{expectedRevision:store.records.state().revision}),...fields}},{actor,sessionOwner:owner})
 const sub=mediaRecord(await execute('put-subscription',{input:{title:'AI funding',platform:'web',url:'https://example.org/news',fallbackUrls:[],identityBasis:'Controlled fixture',region:'global',language:'en',topicIds:[],directionIds:[],status:'following'}},'user')),subId=String((sub.items as {id:string}[])[0].id)
 const start=mediaRecord(await execute('start',{id:subId},'user')),runId=String(start.runId),scope={selector:'main',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const},quote='GPU funding announced yesterday',originalDate=new Date(Date.now()-24*3600000).toISOString()
 const original=await sources.collect({url:'https://example.org/funding',title:'AI funding',author:'Issuer',publishedAt:originalDate,scope,text:quote,mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null},sources.state().revision)
 const saved=mediaRecord(await execute('save-lead',{runId,title:'AI funding',summary:'Funding announced, video pending',missing:'No video on publication day',sourceId:original.sourceId,acquisitionId:original.acquisitionId,quote,quoteStart:0})),id=String(saved.id)
 await script("document.querySelector('[data-category=leads]').click();true")
 await wait(()=>script("Boolean(Array.from(document.querySelectorAll('#collection-page button')).find(b=>b.textContent==='加入视频待选池'))"),'enroll control')
 await script("Array.from(document.querySelectorAll('#collection-page button')).find(b=>b.textContent==='加入视频待选池').click();true")
 await wait(async()=>store.entity(id,'lead').videoWatch?.state==='waiting','persistent waiting state')
 await execute('update-video',{id,runId,missing:'No video in first check; wait for later source'})
 await execute('finish',{runId,status:'partial',note:'Normal waiting, no confirmation required'})
 // Reopen the actual stores, make the test-only check due, then use a new official-input receipt.
 const reloaded=new RollingStore(project.directory,project.id),lead=reloaded.entity(id,'lead');reloaded.commit([{...lead,revision:lead.revision+1,videoWatch:{...lead.videoWatch,nextCheckAt:new Date(Date.now()-1000).toISOString()}}],reloaded.records.state().revision,'fixture-next-check-due')
 const second=mediaRecord(await execute('start',{id:subId},'user')),secondRun=String(second.runId);assert.deepEqual(store.entity(secondRun,'run').videoLeadIds,[id]);assert.equal(prompts.length,2)
 const video=await sources.collect({url:'https://example.org/next-day-video',title:'Issuer source video',author:'Issuer',publishedAt:new Date(Date.now()-1000).toISOString(),scope,text:quote,mediaScope:scope,mediaTruncated:false,candidates:[{kind:'video',url:'https://example.org/source-video.webm',durationSeconds:4,role:'video'}],access:'unknown',accessText:'',result:'observed',error:null},sources.state().revision)
 const body=await sources.readBody(video.sourceId,video.acquisitionId),candidateId=body.acquisition.candidates[0].id
 sources.confirm({operation:'confirm',sourceId:video.sourceId,acquisitionId:video.acquisitionId,candidateIds:[candidateId],expectedRevision:sources.state().revision})
 const proof=mediaRecord(await media.processArtifact({action:'media.decode.check',artifactId:'source-video.webm'}))
 await sources.recordMedia(video.sourceId,video.acquisitionId,candidateId,{state:'decoded-file',artifactId:'source-video.webm',contentId:crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),startSeconds:0,endSeconds:Number(proof.durationSeconds),proof},sources.state().revision)
 const c:NewsTopicCandidate={id:'test-funding',eventKey:id,subject:'Issuer',subjectKind:'organization',category:'company',region:'global',title:'算力融资新进展',news:'融资事件，次日补齐来源视频。',reason:'行业影响与原始证据。',angle:'讲清事件与后续进展。',format:'announcement',novelty:'new-event',recordedAt:null,missing:'Controlled CG fixture; no public-news coverage claim',sourceId:video.sourceId,acquisitionId:video.acquisitionId,quote,quoteStart:0,previewArtifactId:'source-video.webm',mode:'video'}
 await execute('update-video',{id,runId:secondRun,missing:'',sourceId:video.sourceId,acquisitionId:video.acquisitionId,quote,quoteStart:0,candidate:c,contentKind:'cg'})
 assert.equal(store.entity(id,'lead').videoWatch.state,'ready');assert.equal(store.entity(id,'lead').videoWatch.publishedAt,originalDate);assert.equal(store.entity(id,'lead').videoWatch.topic.facts.durationSeconds,4)
 await execute('finish',{runId:secondRun,status:'partial',note:'Video ready, no auto production'})
 await script("document.querySelector('[data-category=video-pool]').click();true")
 await wait(()=>script("Boolean(document.querySelector('[data-video-watch=ready]'))"),'ready card')
 if(process.env.BMW_VALIDATION_DIR){fs.mkdirSync(process.env.BMW_VALIDATION_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.BMW_VALIDATION_DIR,'video-watch-ready.png'),(await ui.capturePage()).toPNG())}
 await script("Array.from(document.querySelectorAll('#collection-page button')).find(b=>b.textContent==='加入新闻选题板').click();true")
 const journal=new NewsJournal(project.directory,owner);await wait(async()=>journal.read().topics.length===1,'trusted proposal handoff');assert.equal(journal.read().topics[0].candidate.mode,'video');assert.equal(journal.read().selection,undefined);assert.equal(prompts.length,2,'No automatic production or replay')
 await wait(()=>script("document.body.dataset.libraryBusy==='false'"),'handoff UI drained')
 const future=await new NewsResearchService(kernel as unknown as BrowserFeatureHost,owner,()=>Date.parse(originalDate)+72*3600000+1).topics()
 assert.equal(future.topics[0].eligible,false,'An unselected news-board card must expire with the original event, even while the later video is still fresh')
 assert.ok(future.topics[0].issues.some(issue=>issue.includes('NEWS_EVENT_EXPIRED')))
 // A changed video must never be silently reproposed using the old ready proof.
 fs.appendFileSync(path.join(artifacts,'source-video.webm'),'tampered')
 await assert.rejects(execute('propose-video',{id,expectedLeadRevision:store.entity(id,'lead').revision},'user'),/PREVIEW|changed|unavailable/i)
 assert.equal(store.entity(id,'lead').videoWatch.state,'waiting');assert.equal(store.entity(id,'lead').videoWatch.publishedAt,originalDate)
 console.log('PASS disposable test Profile: GUI enroll, normal waiting, persisted reload, new-input followup, actual native CG video decode/hash/source proof, ready card, trusted candidate handoff, tamper rejection; no production profile, paid model or external news coverage')
 }finally{clearTimeout(deadline);await runtime?.stop?.();await media?.stop();if(window&&!window.isDestroyed())window.destroy();fs.rmSync(root,{recursive:true,force:true})}}
app.whenReady().then(run).then(()=>app.exit(0)).catch(error=>{console.error(phase,error);app.exit(1)})
