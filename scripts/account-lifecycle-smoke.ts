import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {app,BrowserWindow,session,webContents} from 'electron'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {bmwProduct} from '../packages/product-bmw/index.js'
import {ProjectSourceStore} from '../packages/platform/src/project-source-store.js'
import type {TextReadBatchReceipt,TextReadDiagnostic} from '../packages/media-native/src/source-contract.js'
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-account-lifecycle-')))
app.setPath('userData',path.join(root,'profile'))
type Page={text?:string;nextOffset:number|null;coverage:{complete:boolean;throughOffset:number;total:number;nextRequiredOffset:number|null}}
type Summary=TextReadBatchReceipt&{read:number;incomplete:number;cleanupState:string}
const stops:{id:number;at:number}[]=[],aborts:{at:number;url:string;id:number}[]=[],failures:{at:number;url:string;id:number}[]=[]
app.on('web-contents-created',(_event,wc)=>{const stop=wc.stop.bind(wc);wc.stop=()=>{stops.push({id:wc.id,at:Date.now()});stop()};wc.on('console-message',d=>{if(d.message==='FIXTURE_CLIENT_ABORT')aborts.push({at:Date.now(),url:wc.getURL(),id:wc.id})});const requests=new Map<string,string>();wc.debugger.on('message',(_event,method,p)=>{if(method==='Network.requestWillBeSent')requests.set(String(p.requestId),String(p.request?.url??''));if(method==='Network.loadingFailed')failures.push({at:Date.now(),url:requests.get(String(p.requestId))??'',id:wc.id})})})
let window:BrowserWindow|undefined,kernel:BrowserKernel|undefined
const streams:ReadableStreamDefaultController<Uint8Array>[]=[]
void(async()=>{let code=0;const watchdog=setTimeout(()=>app.exit(1),45000);try{
 await app.whenReady()
 const isolated=session.fromPartition('account-lifecycle-'+crypto.randomUUID())
 let mode:'posts'|'client-abort'|'header'|'discovery'|'streaming'='posts'
 await isolated.protocol.handle('https',async request=>{
  const url=new URL(request.url)
  if(url.pathname==='/held-image')return new Response(new ReadableStream<Uint8Array>({start(controller){streams.push(controller)}}),{headers:{'content-type':'image/png'}})
  if(url.pathname==='/timeline'){await new Promise(resolve=>setTimeout(resolve,mode==='client-abort'?2000:100));return new Response(JSON.stringify({html:mode==='discovery'?'<p>FULL_BODY_SENTINEL_DO_NOT_ARCHIVE</p><article hidden><p>Hidden fake post</p><a href="/Kimi_Moonshot/status/111">Now</a></article><article><p>Other author</p><a href="/other/status/222">Now</a></article>'+Array.from({length:7},(_,i)=>'<article data-testid="tweet">'+(i===0?'Pinned':'')+'<p data-testid="tweetText">Real fixture excerpt '+i+' '+('text '.repeat(150))+'</p><a href="/Kimi_Moonshot/status/'+(123456789+i)+'">'+(i===0?'Today</a><blockquote><a href="/Kimi_Moonshot/status/999"><time datetime="2030-01-01T00:00:00Z">Quoted date</time></a></blockquote>':'<time datetime="2026-10-24T12:00:00Z">Today</time></a>')+'</article>').join(''):'<article data-testid="tweet"><p>Authentic local fixture post body, never a live X result.</p><a href="/Kimi_Moonshot/status/123456789">Now</a></article>'}),{headers:{'content-type':'application/json'}})}
  if(mode==='streaming')return new Response(new ReadableStream<Uint8Array>({start(controller){
   const encode=(text:string)=>new TextEncoder().encode(text)
   controller.enqueue(encode('<!doctype html><title>Streaming fixture</title><body><main>Profile header</main>'))
   const heartbeat=setInterval(()=>{try{controller.enqueue(encode('<!-- '+'.'.repeat(4000)+' -->'))}catch{clearInterval(heartbeat)}},250)
   setTimeout(()=>{clearInterval(heartbeat);try{controller.enqueue(encode('<article data-testid="tweet"><p data-testid="tweetText">Authentic local streamed post, not live X news.</p><a href="/Kimi_Moonshot/status/123456790"><time datetime="2026-10-24T12:00:00Z">Today</time></a></article></body>'));controller.close()}catch{}},8500)
  }}),{headers:{'content-type':'text/html'}})
  const script=mode==='posts'||mode==='discovery'?'fetch("/timeline").then(r=>r.json()).then(r=>document.querySelector("main").insertAdjacentHTML("beforeend",r.html))':mode==='client-abort'?'const x=new XMLHttpRequest();x.open("GET","/timeline");x.send();setTimeout(()=>{console.debug("FIXTURE_CLIENT_ABORT");x.abort();document.querySelector("main").insertAdjacentHTML("beforeend","<p>Something went wrong. Try reloading.</p>")},100)':''
  return new Response('<!doctype html><title>Account fixture</title><main><h1>Kimi</h1><p>Profile header</p></main><img src="/held-image"><script>'+script+'</script>',{headers:{'content-type':'text/html'}})
 })
 window=new BrowserWindow({show:false,width:1000,height:750,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
 const project={id:'account-lifecycle',name:'Isolated account lifecycle',directory:path.join(root,'project')};fs.mkdirSync(path.join(project.directory,'artifacts'),{recursive:true})
 const sources=new ProjectSourceStore(project.directory,project.id),owner={projectId:project.id,sessionId:'account-test'}
 kernel=new BrowserKernel({window,session:isolated,detached:false,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project,updateTabState:()=>{}},settingsStore:undefined,sessionContinuity:undefined,capabilityRegistry:new BrowserCapabilityRegistry(bmwProduct),allowedActions:undefined,artifactsDirectory:path.join(project.directory,'artifacts'),onState:undefined});kernel.projectSources=()=>sources
 const front=await kernel.openTab({url:'about:blank',foreground:true,source:'user'}),before=webContents.getAllWebContents().map(w=>w.id)
 const start=Date.now(),success=await kernel.execute({action:'pages.read',urls:['https://x.com/Kimi_Moonshot']},{sessionOwner:owner}) as Summary
 assert.equal(success.read,1);assert.ok(Date.now()-start<2500,'A rendered post must not wait for a held image or depend on Host stop')
 const good=sources.readTextBatch(success.batchId,success.revision,success.sha256).rows[0]
 assert.equal(good.diagnostic?.contentState,'posts');assert.ok(good.diagnostic?.visiblePosts);assert.ok(good.diagnostic?.matchingPostLinks);assert.ok(!good.diagnostic?.rendererFailure);assert.match((await sources.readBody(good.sourceId!,good.acquisitionId!)).text,/Authentic local fixture/)
 assert.ok(!good.diagnostic?.navigation.some(event=>event.reason==='load'),'The initial about:blank load must not be misattributed to the still-loading account document')
 assert.equal(success.cleanupState,'complete');assert.deepEqual(webContents.getAllWebContents().map(w=>w.id),before);assert.equal(kernel.activeTabId,front.id)
 mode='discovery'
 const discovery=await kernel.execute({action:'pages.discover',urls:['https://x.com/Kimi_Moonshot']},{sessionOwner:owner}) as Summary
 const discoveryBatch=sources.readTextBatch(discovery.batchId,discovery.revision,discovery.sha256),discoveryRow=discoveryBatch.rows[0]
 assert.equal(discovery.read,1);assert.equal(discoveryBatch.mode,'discovery');assert.equal(discoveryRow.leads?.length,5)
 assert.ok(discoveryRow.leads?.every(lead=>lead.summary.length===360&&lead.excerptTruncated))
 assert.equal(discoveryRow.leads?.[0].url,'https://x.com/kimi_moonshot/status/123456789');assert.equal(discoveryRow.leads?.[0].publishedAt,null);assert.equal(discoveryRow.leads?.[0].displayTime,'Today');assert.ok(discoveryRow.leads?.slice(1).every(lead=>lead.publishedAt==='2026-10-24T12:00:00.000Z'));assert.equal(discoveryRow.leads?.[0].pinned,true);assert.equal(discoveryRow.leads?.[1].pinned,false)
 assert.ok(discoveryRow.leads?.every(lead=>!lead.summary.includes('Hidden fake')&&!lead.url.includes('/other/')))
 const excerptBody=await sources.readBody(discoveryRow.sourceId!,discoveryRow.acquisitionId!)
 assert.equal(excerptBody.acquisition.scope.extraction,'visible-post-excerpts');assert.equal(excerptBody.acquisition.scope.truncated,true);assert.equal(excerptBody.acquisition.candidates.length,0)
 assert.ok(!excerptBody.text.includes('FULL_BODY_SENTINEL'));assert.equal(JSON.parse(excerptBody.text).fullTextRead,false)
 const projected=await kernel.execute({action:'pages.read-result',batchId:discovery.batchId,revision:discovery.revision,sha256:discovery.sha256,section:'leads',offset:0},{sessionOwner:owner}) as Record<string,unknown>
 assert.equal(projected.projection,'discovery-only');assert.equal(projected.fullTextRead,false);assert.equal((projected.coverage as {complete:boolean}).complete,true);assert.ok(JSON.stringify(projected).length<=7000)
 await assert.rejects(kernel.execute({action:'pages.discover',urls:['https://x.com/home']},{sessionOwner:owner}),/account URLs/)
 assert.deepEqual(webContents.getAllWebContents().map(w=>w.id),before)
 mode='streaming'
 const streamStart=Date.now(),streamed=await kernel.execute({action:'pages.discover',urls:['https://x.com/Kimi_Moonshot']},{sessionOwner:owner}) as Summary
 const streamRow=sources.readTextBatch(streamed.batchId,streamed.revision,streamed.sha256).rows[0]
 assert.equal(streamed.read,1);assert.ok(Date.now()-streamStart>=8500&&Date.now()-streamStart<12000)
 assert.match(streamRow.leads?.[0].summary??'',/Authentic local streamed post/)
 assert.ok(streamRow.diagnostic?.documentTransfer?.receivedBytes);assert.equal(streamed.cleanupState,'complete');assert.deepEqual(webContents.getAllWebContents().map(w=>w.id),before)
 mode='client-abort';const negative=await kernel.execute({action:'pages.read',urls:['https://x.com/Kimi_Moonshot']},{sessionOwner:owner}) as Summary
 const bad=sources.readTextBatch(negative.batchId,negative.revision,negative.sha256).rows[0]
 assert.equal(negative.read,0);assert.equal(negative.incomplete,1);assert.equal(bad.diagnostic?.contentState,'error')
 const client=aborts.at(-1)!;assert.ok(client);const native=failures.find(event=>event.id===client.id&&event.url.endsWith('/timeline'));assert.ok(native);assert.ok(stops.filter(event=>event.id===client.id).every(event=>event.at>=client.at),'Client cancellation happens before any Host stop on that page')
 assert.ok(bad.diagnostic?.network.some(event=>event.url.endsWith('/timeline')&&event.canceled===true))
 mode='header';const timeoutStart=Date.now(),header=await kernel.execute({action:'pages.read',urls:['https://x.com/Kimi_Moonshot']},{sessionOwner:owner}) as Summary
 assert.equal(header.read,0);assert.equal(header.incomplete,1);assert.ok(Date.now()-timeoutStart>=8000,'Existing native page budget is not reduced')
 assert.equal(sources.readTextBatch(header.batchId,header.revision,header.sha256).rows[0].diagnostic?.contentState,'header-only')
 // Inflate only this isolated saved diagnostic, then exercise the production
 // Session pager: an offset jump must fail, not falsely certify the tail.
 const original=sources.readTextBatch(success.batchId,success.revision,success.sha256),longDiagnostic:TextReadDiagnostic={...good.diagnostic!,network:Array.from({length:30},(_,i)=>({type:'failed',url:'https://x.com/api/'+i,resourceType:'XHR',errorText:'bounded failure detail '.repeat(7),at:Date.now()}))}
 const now=new Date().toISOString(),pagingBatch={...original,id:'paging-lifecycle',revision:0,startedAt:now,finishedAt:now,rows:[{...good,startedAt:undefined,readFinishedAt:undefined,finishedAt:undefined,diagnostic:longDiagnostic}]}
 const receipt=sources.writeTextBatch(pagingBatch),base={action:'pages.read-result',...receipt,section:'diagnostics',rowIndex:0}
 const first=await kernel.execute({...base,offset:0},{sessionOwner:owner}) as Page
 assert.equal(first.coverage.complete,false);assert.ok(first.nextOffset)
 await assert.rejects(kernel.execute({...base,offset:first.coverage.total-1200},{sessionOwner:owner}),/TEXT_READ_PAGE_ORDER/)
 await assert.rejects(kernel.execute({...base,offset:first.nextOffset},{sessionOwner:{...owner,sessionId:'other-session'}}),/next required offset is 0/)
 let current=first,restored=first.text??''
 while(current.nextOffset!==null){current=await kernel.execute({...base,offset:current.nextOffset},{sessionOwner:owner}) as Page;assert.ok(JSON.stringify(current).length<=3000);restored+=current.text??''}
 assert.equal(current.coverage.complete,true);assert.equal(current.coverage.nextRequiredOffset,null);assert.deepEqual(JSON.parse(restored),longDiagnostic)
 assert.equal(kernel.tabs.size,1);assert.deepEqual(kernel.state().collection,{running:false,quarantined:false,surfaces:0,pages:0});assert.equal(kernel.busy,false)
 const report={scope:'Local native fixtures, disposable test Profile only; no real X/default Profile/model',success,streamed:{summary:streamed,diagnostic:streamRow.diagnostic},discovery:{summary:discovery,leads:discoveryRow.leads,projection:projected,sourceScope:excerptBody.acquisition.scope},clientAbort:{result:negative,diagnostic:bad.diagnostic,caller:client,networkFailure:native,hostStops:stops.filter(e=>e.id===client.id)},unchangedDeadline:{header,elapsedMs:Date.now()-timeoutStart},paging:{jumpRejected:true,sessionIsolation:true,complete:current.coverage.complete,exactDiagnosticRoundTrip:true},cleanup:kernel.state().collection}
 const output=process.env.BMW_VALIDATION_DIR;if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'account-lifecycle.json'),JSON.stringify(report,null,2))}
 console.log('PASS bounded discovery excerpts/source receipts/explicit projection, no full body/media, hidden/foreign posts excluded; current-frame snapshot precedes Host cleanup despite held resources; client XMLHttpRequest.abort is separately attributed; header-only stays incomplete for the unchanged 8s budget; diagnostic offset jumps rejected and contiguous bytes delivered')
 }catch(error){code=1;console.error(error)}finally{clearTimeout(watchdog);if(kernel){await kernel.recoverCollectionPages();clearTimeout(kernel.tabStateTimer);for(const tab of kernel.tabs.values())if(!tab.view.webContents.isDestroyed())tab.view.webContents.close({waitForBeforeUnload:false})}window?.destroy();for(const stream of streams)try{stream.close()}catch{};fs.rmSync(root,{recursive:true,force:true});app.exit(code)}})()

