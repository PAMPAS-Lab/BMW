import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {app,BrowserWindow,session} from 'electron'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {closeNavigationPage} from '../packages/browser-capability/src/page-navigation.js'
import {advanceYoutubePlayer} from '../packages/browser-capability/src/video-capture-ready.js'
import {MAX_AGENT_TABS_PER_PROJECT} from '../packages/browser-capability/src/tab-policy.js'
import {ProjectStore} from '../packages/platform/src/project-store.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-tab-lifecycle-'))
app.setPath('userData',path.join(root,'profile'))
const player=`<video id="player" muted></video><canvas id="canvas" width="32" height="32"></canvas><script>const v=document.querySelector('video'),c=document.querySelector('canvas');v.srcObject=c.captureStream(10);let tick=0;setInterval(()=>{c.getContext('2d').fillStyle=tick++%2?'red':'blue';c.getContext('2d').fillRect(0,0,32,32)},100);</script>`
const frameServer=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(player)})
let frameOrigin=''
const server=http.createServer((req,res)=>{if(req.url?.startsWith('/restore-slow/')){restoringRequests++;restoringPeak=Math.max(restoringPeak,restoringRequests);setTimeout(()=>{restoringRequests--;res.setHeader('Content-Type','text/html');res.end('<title>Restored</title><p>Retained original page</p>')},400);return}if(req.url?.startsWith('/fail')){req.socket.destroy();return}res.setHeader('Content-Type','text/html');res.end('<title>Research fixture</title><p>Original local news evidence</p>'+player+(req.url==='/user'?`<iframe src="${frameOrigin}/frame"></iframe>`:''))})
let restoringRequests=0,restoringPeak=0
const windows:BrowserWindow[]=[],kernels:BrowserKernel[]=[]
async function run(){let code=0;const watchdog=setTimeout(()=>app.exit(1),120000);watchdog.unref()
 try{
  await app.whenReady();await new Promise<void>(resolve=>frameServer.listen(0,'127.0.0.1',resolve));const frameAddress=frameServer.address();if(!frameAddress||typeof frameAddress==='string')throw new Error('No frame fixture port');frameOrigin=`http://127.0.0.1:${frameAddress.port}`;await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No local fixture port');const origin=`http://127.0.0.1:${address.port}`
  const createStore=()=>new ProjectStore({filePath:path.join(root,'projects.json'),projectsDirectory:path.join(root,'projects'),initialWorkspacePath:path.join(root,'workspace'),onState:undefined})
  const store=createStore();store.completeInitialSetup({name:'Daily news fixture',homeUrl:origin+'/user'})
  const browserSession=session.fromPartition('tab-lifecycle-'+process.pid)
  const make=(projects:ProjectStore)=>{const window=new BrowserWindow({show:false,webPreferences:{session:browserSession,sandbox:true}});windows.push(window);const k=new BrowserKernel({window,session:browserSession,projectStore:projects,permissionStore:{hasAgentControl:()=>true},sessionContinuity:null,settingsStore:null,capabilityRegistry:null,allowedActions:undefined,artifactsDirectory:path.join(root,'artifacts'),onState:()=>{}});k.setRecordingController({isCaptureActive:()=>false});kernels.push(k);return k}
  const k=make(store),user=await k.initialize();await k.showTab(user.id);const userPage=k.tabs.get(user.id).view.webContents
  await userPage.executeJavaScript(`(()=>{const box=document.createElement('section');box.id='text-find-fixture';box.innerHTML='<p hidden>Share your secret</p><aside><p>Share your excluded text</p></aside><p>A 25 cm <b>open-source</b> biped</p><p>Share your new behavior with the community!</p><p><span style="display:none">Share your hidden text</span><input value="Share your input secret"></p>'+Array.from({length:10},(_,i)=>'<p>Share your visible behavior '+i+'</p>').join('')+'<p>'+'x'.repeat(2100)+' invisible-tail-query</p>';document.body.append(box);return true})()`)
  const splitText=await k.execute({action:'page.text.find',tabId:user.id,selector:'#text-find-fixture p',text:'25 cm OPEN-SOURCE'}) as {matches:{index:number}[]};assert.deepEqual(splitText.matches.map(m=>m.index),[2],'Visible inline nodes match across normalized text boundaries')
  const found=await k.execute({action:'page.text.find',tabId:user.id,selector:'#text-find-fixture p',text:'SHARE  YOUR',excludeSelectors:['aside']}) as {matches:{index:number;text:string}[];nextOffset:number;complete:boolean}
  assert.equal(found.matches.length,8);assert.deepEqual(found.matches.slice(0,1).map(m=>m.index),[3]);assert.ok(found.matches.every(m=>!m.text.includes('secret')&&!m.text.includes('excluded')&&!m.text.includes('hidden')));assert.equal(found.complete,false)
  const next=await k.execute({action:'page.text.find',tabId:user.id,selector:'#text-find-fixture p',text:'share your',excludeSelectors:['aside'],findOffset:found.nextOffset}) as {matches:{index:number;text:string}[];partialElementIndices:number[];complete:boolean;nextOffset:number|null}
  assert.equal(next.matches.length,3);assert.equal(next.nextOffset,null);assert.equal(next.complete,false,'Truncated paragraph is an explicit search gap, not proven absence');assert.equal(next.partialElementIndices.length,1);assert.ok(next.matches.every(m=>m.index>=found.nextOffset))
  const original=await k.execute({action:'observe',tabId:user.id,selector:found.matches.length?'#text-find-fixture p':'p',index:found.matches[0].index}) as {text:string};assert.equal(original.text,'Share your new behavior with the community!','Returned index selects the exact original paragraph')
  console.log('PASS bounded page text finding: exact native selectors, normalized split text, exclusions, pagination and explicit truncation gaps')
  await userPage.executeJavaScript(`(()=>{const p=document.createElement('div');p.id='movie_player';p.className='ad-showing';p.getVideoData=()=>({video_id:'pinned'});p.getPlayerResponse=()=>({videoDetails:{videoId:'pinned'},playabilityStatus:{status:'OK'}});p.innerHTML='<video></video><button class="ytp-skip-ad-button">Skip ad</button>';p.querySelector('button').onclick=()=>{p.className='';p.dataset.skipped='yes'};document.body.append(p)})()`)
  const probe=(id:string)=>userPage.executeJavaScript(`(${advanceYoutubePlayer.toString()})(${JSON.stringify(id)})`,true)
  assert.equal(await probe('other'),'different-target');assert.equal(await userPage.executeJavaScript('document.querySelector("#movie_player").dataset.skipped??null'),null)
  assert.equal(await probe('pinned'),'advertisement','Clicking skip cannot itself certify content')
  assert.equal(await userPage.executeJavaScript('document.querySelector("#movie_player").dataset.skipped'),'yes')
  assert.equal(await probe('pinned'),'waiting','No decoded content is not ready after skip')
  await userPage.executeJavaScript('document.getElementById("movie_player").remove()')
  console.log('PASS ad readiness: different target never clicked; visible normal skip executes; ad and undecoded post-ad player never certify content')
  // Exercise the actual background playback policy, not only the DOM helper.
  const encoder=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.push(encoder)
  await encoder.loadFile(path.resolve('packages/media-native/src/media/media.html'))
  const clip=Buffer.from(await encoder.webContents.executeJavaScript(`(async()=>{const {Output,Mp4OutputFormat,BufferTarget,CanvasSource}=await import('mediabunny');const c=new OffscreenCanvas(64,64),x=c.getContext('2d'),target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target}),video=new CanvasSource(c,{codec:'avc',bitrate:100000});output.addVideoTrack(video,{frameRate:10});await output.start();for(let n=0;n<10;n++){x.fillStyle=n%2?'red':'blue';x.fillRect(0,0,64,64);await video.add(n/10,.1)}video.close();await output.finalize();return [...new Uint8Array(target.buffer)]})()`,true) as number[]).toString('base64');encoder.destroy()
  await browserSession.protocol.handle('https',request=>{const address=new URL(request.url);if(address.hostname==='player-frame.example')return new Response(player,{headers:{'content-type':'text/html'}});const id=address.searchParams.get('v');return new Response(`<!doctype html><title>Controlled ad readiness</title><div id="movie_player" class="ad-showing"><video muted loop preload="auto" src="data:video/mp4;base64,${clip}"></video></div>${id==='frame-failure'?'<iframe src="https://player-frame.example/player"></iframe>':''}<script>const p=document.getElementById('movie_player'),v=p.querySelector('video');p.getVideoData=()=>({video_id:${JSON.stringify(id)}});p.getPlayerResponse=()=>({videoDetails:{videoId:${JSON.stringify(id)}},playabilityStatus:{status:'OK'}});p.dataset.playCount='0';p.dataset.pauseCount='0';v.addEventListener('play',()=>p.dataset.playCount=String(Number(p.dataset.playCount)+1));v.addEventListener('pause',()=>p.dataset.pauseCount=String(Number(p.dataset.pauseCount)+1));setInterval(()=>{if(${JSON.stringify(id)}!=='never-ready'&&v.currentTime>.15)p.classList.remove('ad-showing')},20)</script>`,{headers:{'content-type':'text/html'}})})
  const readinessMuteStates:boolean[]=[]
  const framePolicies:boolean[]=[],frameScripts=new Map<Electron.WebFrameMain,Electron.WebFrameMain['executeJavaScript']>()
  const traceReadiness=(_event:Electron.Event,contents:Electron.WebContents)=>{
    contents.on('media-started-playing',()=>{if(contents.getURL().includes('www.youtube.com/watch?v='))readinessMuteStates.push(contents.isAudioMuted())})
    contents.on('did-frame-finish-load',()=>{if(contents.getURL().includes('v=frame-failure'))for(const frame of contents.mainFrame.framesInSubtree)if(frame.url.startsWith('https://player-frame.example/')&&!frameScripts.has(frame)){
      frameScripts.set(frame,frame.executeJavaScript);const execute=frame.executeJavaScript.bind(frame)
      frame.executeJavaScript=async(code:string,userGesture?:boolean)=>{if(code.includes('__bmwPlaybackPolicy')){framePolicies.push(code.includes('state.allowed=true'));throw new Error('Controlled unrelated frame failure')}return execute(code,userGesture)}
    }})
  }
  app.on('web-contents-created',traceReadiness)
  k.setBrowserVisible(false)
  try{
    let readyTab:Awaited<ReturnType<BrowserKernel['openTab']>>
    try{readyTab=await k.openTab({url:'https://www.youtube.com/watch?v=ad-lease',foreground:false,source:'agent'},AbortSignal.timeout(4000))}catch(error){const blocked=[...k.tabs.values()].find(tab=>tab.url.includes('ad-lease'));if(blocked)console.error('Controlled ad state',await blocked.view.webContents.executeJavaScript("(()=>{const p=document.getElementById('movie_player'),v=p.querySelector('video');return {readyState:v.readyState,width:v.videoWidth,duration:v.duration,currentTime:v.currentTime,paused:v.paused,plays:p.dataset.playCount,pauses:p.dataset.pauseCount,policy:globalThis.__bmwPlaybackPolicy}})()"));throw error}
    const readyPage=k.tabs.get(readyTab.id).view.webContents
    assert.equal(k.activeTabId,user.id,'Readiness must not steal the foreground tab')
    assert.equal(await readyPage.executeJavaScript("document.getElementById('movie_player').classList.contains('ad-showing')"),false,'The controlled ad actually advanced under the real background policy')
    assert.equal(await readyPage.executeJavaScript("document.querySelector('video').paused"),true,'Readiness always pauses after admission')
    assert.equal(readyPage.isAudioMuted(),true,'Background readiness never makes ads audible')
    assert.ok(readinessMuteStates.length>0&&readinessMuteStates.every(Boolean),'Every actual media-started notification during readiness remains natively muted')
    await readyPage.executeJavaScript("document.querySelector('video').play().catch(()=>{});true",true);await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(await readyPage.executeJavaScript("document.querySelector('video').paused"),true,'The temporary playback exception is revoked')
    await k.closeTab(readyTab.id)
    await assert.rejects(k.openTab({url:'https://www.youtube.com/watch?v=never-ready',foreground:false,source:'agent'},AbortSignal.timeout(1000)),/abort|timeout/i)
    const stopped=[...k.tabs.values()].find(tab=>tab.url.includes('never-ready'))
    if(stopped){assert.equal(stopped.view.webContents.isAudioMuted(),true);assert.equal(await stopped.view.webContents.executeJavaScript("document.querySelector('video').paused"),true);await k.closeTab(stopped.id)}
    const independent=await k.openTab({url:'https://www.youtube.com/watch?v=frame-failure',foreground:false,source:'agent'},AbortSignal.timeout(4000)),independentPage=k.tabs.get(independent.id).view.webContents
    assert.ok(framePolicies.length>0&&framePolicies.every(allowed=>!allowed),'Readiness never grants playback to the unrelated child frame')
    assert.equal(independentPage.isAudioMuted(),true);assert.equal(await independentPage.executeJavaScript("document.querySelector('video').paused"),true)
    assert.ok(k.diagnosticsFor(independent.id).media.some((entry:{message?:string})=>entry.message?.includes('remains muted')),'The unrelated frame failure remains visible')
    await k.closeTab(independent.id)
    console.log('PASS background ad readiness: actual decoding progresses muted, foreground is preserved, normal background pause returns and cancellation drains')
  }finally{for(const [frame,execute] of frameScripts)if(!frame.isDestroyed()&&!frame.detached)frame.executeJavaScript=execute;app.removeListener('web-contents-created',traceReadiness);k.setBrowserVisible(true);await browserSession.protocol.unhandle('https')}
  const paused=async(page:typeof userPage)=>page.executeJavaScript("document.querySelector('video').paused")
  const play=async(page:typeof userPage)=>{await page.executeJavaScript("document.querySelector('video').play().catch(()=>{});true",true);await new Promise(resolve=>setTimeout(resolve,100))}
  const firstFrame=userPage.mainFrame,realScript=firstFrame.executeJavaScript.bind(firstFrame)
  firstFrame.executeJavaScript=async()=>{throw new Error('Script not run')}
  await k.showTab(user.id);assert.equal(userPage.isAudioMuted(),true,'Uncontrollable frame remains muted without failing activation')
  assert.ok(k.diagnosticsFor(user.id).media.some((entry:{message?:string})=>entry.message?.includes('remains muted')))
  firstFrame.executeJavaScript=realScript;await k.showTab(user.id);assert.equal(userPage.isAudioMuted(),false,'Explicit retry installs policy and recovers active playback')
  await play(userPage);assert.equal(await paused(userPage),false)
  const cross=userPage.mainFrame.framesInSubtree.find(frame=>frame.url.startsWith(frameOrigin))!;assert.ok(cross,'Actual cross-origin player frame is loaded')
  await cross.executeJavaScript("document.querySelector('video').play().catch(()=>{});true",true)
  const other=await k.openTab({url:origin+'/media-other',foreground:true,source:'user'})
  assert.equal(await paused(userPage),true);assert.equal(userPage.isAudioMuted(),true);assert.equal(await cross.executeJavaScript("document.querySelector('video').paused"),true)
  await play(userPage);assert.equal(await paused(userPage),true,'Background replay attempts are blocked')
  await cross.executeJavaScript("document.querySelector('video').play().catch(()=>{});true",true);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(await cross.executeJavaScript("document.querySelector('video').paused"),true)
  await k.showTab(user.id);assert.equal(await paused(userPage),true,'Reactivation does not resume playback');assert.equal(userPage.isAudioMuted(),false)
  await play(userPage);k.setBrowserVisible(false);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(await paused(userPage),true);assert.equal(userPage.isAudioMuted(),true)
  await play(userPage);assert.equal(await paused(userPage),true,'Studio-covered page cannot autoplay')
  k.setBrowserVisible(true);await new Promise(resolve=>setTimeout(resolve,100));await k.showTab(other.id)
  k.setRecordingController({isCaptureActive:()=>false,captureVideo:async(tab:{view:{webContents:typeof userPage}})=>{await play(tab.view.webContents);assert.equal(await paused(tab.view.webContents),false);return {captured:true}}})
  k.setBrowserVisible(false);await k.execute({action:'media.video.capture',tabId:user.id,selector:'video',maxDurationMs:1000});assert.equal(k.activeTabId,other.id);assert.equal(await paused(userPage),true);assert.equal(userPage.isAudioMuted(),true)
  k.setRecordingController({isCaptureActive:()=>false,captureVideo:async(tab:{view:{webContents:typeof userPage}})=>{await play(tab.view.webContents);throw new Error('fixture capture cancelled')}})
  await assert.rejects(k.execute({action:'media.video.capture',tabId:user.id,selector:'video',maxDurationMs:1000}),/fixture capture cancelled/);assert.equal(k.activeTabId,other.id);assert.equal(await paused(userPage),true)
  const crossScript=cross.executeJavaScript.bind(cross)
  const failAfterCapture=async()=>{await play(userPage);await userPage.executeJavaScript("document.querySelector('video').pause();true");cross.executeJavaScript=async()=>{throw new Error('Script not run')}}
  k.setRecordingController({isCaptureActive:()=>false,captureVideo:async()=>{await failAfterCapture();return {captured:true}}})
  const captured=await k.execute({action:'media.video.capture',tabId:user.id,selector:'video',maxDurationMs:1000})
  assert.equal(captured.captured,true,'A failing unrelated frame policy must not discard a drained native capture result')
  assert.equal(k.activeTabId,other.id);assert.equal(await paused(userPage),true);assert.equal(userPage.isAudioMuted(),true)
  cross.executeJavaScript=crossScript;await k.showTab(user.id);await k.showTab(other.id)
  k.setRecordingController({isCaptureActive:()=>false,captureVideo:async()=>{await failAfterCapture();throw new Error('original capture failure')}})
  await assert.rejects(k.execute({action:'media.video.capture',tabId:user.id,selector:'video',maxDurationMs:1000}),/original capture failure/,'Frame policy failure must not mask the original capture error')
  assert.equal(k.activeTabId,other.id);assert.equal(userPage.isAudioMuted(),true)
  cross.executeJavaScript=crossScript
  k.setRecordingController({isCaptureActive:()=>false});k.setBrowserVisible(true)
  for(let n=0;n<9;n++){const before=[...k.tabs.values()].filter(t=>t.source==='agent').map(t=>t.view.webContents);await k.execute({action:'tabs.open',url:origin+'/research/'+n,reuse:false});assert.ok([...k.tabs.values()].filter(t=>t.source==='agent').length<=MAX_AGENT_TABS_PER_PROJECT);for(const page of before)if(![...k.tabs.values()].some(t=>t.view.webContents===page))assert.equal(page.isDestroyed(),true)}
  for(let n=0;n<3;n++){await assert.rejects(k.execute({action:'tabs.open',url:origin+'/fail/'+n,reuse:false}));assert.equal([...k.tabs.values()].filter(t=>t.source==='agent').length,MAX_AGENT_TABS_PER_PROJECT)}
  assert.equal(userPage.isDestroyed(),false)
  const opener=[...k.tabs.values()].filter(t=>t.source==='agent'&&t.url.includes('/research/')).at(-1)!
  await opener.view.webContents.executeJavaScript(`window.open(${JSON.stringify(origin+'/research-popup')});true`,true)
  const popupState=await k.execute({action:'tabs.list'})
  assert.ok(popupState.tabs.some(t=>t.url===origin+'/research-popup'&&t.source==='agent'));assert.equal(popupState.tabs.filter(t=>t.source==='agent').length,6)
  const popup=popupState.tabs.find(t=>t.url===origin+'/research-popup')!;assert.equal(popup.openerTabId,opener.id);assert.equal(popup.active,false);assert.equal(popup.deferred,true,'Unrequested popups cannot navigate or steal the source selection')
  await opener.view.webContents.executeJavaScript(`(()=>{const a=document.createElement('a');a.id='original-source';a.href=${JSON.stringify(origin+'/clicked-source')};a.target='_blank';a.textContent='Original footage';document.body.append(a)})()`)
  const clicked=await k.execute({action:'click',tabId:opener.id,selector:'#original-source'})
  assert.equal(clicked.sourceTab.id,opener.id);assert.equal(clicked.href,origin+'/clicked-source');assert.equal(clicked.destinationTab.url,clicked.href);assert.equal(clicked.destinationTab.openerTabId,opener.id);assert.equal(clicked.destinationTab.projectId,store.active().id);assert.notEqual(clicked.destinationTab.id,opener.id)
  console.log('PASS source tab attribution: explicit new-tab link returns clicked URL, actual destination and Project-bound opener; unsolicited popup remains deferred/background')
  const delayed=await k.execute({action:'tabs.open',url:origin+'/delayed-close',reuse:false}),wc=k.tabs.get(delayed.id).view.webContents,close=wc.close.bind(wc)
  wc.close=options=>{setTimeout(()=>close(options),60)}
  const closing=k.execute({action:'tabs.close',tabId:delayed.id}),queued=k.execute({action:'tabs.list'});assert.equal(wc.isDestroyed(),false);await closing;assert.equal(wc.isDestroyed(),true);assert.equal((await queued).tabs.some(t=>t.id===delayed.id),false)
  const stuck=await k.execute({action:'tabs.open',url:origin+'/stuck-close',reuse:false}),stuckPage=k.tabs.get(stuck.id).view.webContents,realClose=stuckPage.close.bind(stuckPage)
  stuckPage.close=()=>{};await assert.rejects(k.execute({action:'tabs.close',tabId:stuck.id}),/CLEANUP_FAILED/);assert.equal(k.busy,true);assert.equal(stuckPage.isDestroyed(),false);assert.equal(k.tabs.has(stuck.id),true)
  await assert.rejects(k.execute({action:'tabs.open',url:origin+'/blocked'}),/QUARANTINED/);stuckPage.close=realClose;await k.execute({action:'tabs.close',tabId:stuck.id});assert.equal(stuckPage.isDestroyed(),true);assert.equal(k.busy,false)
  for(const t of [...k.tabs.values()].filter(t=>t.source==='agent'))await k.closeTab(t.id)
  for(let n=0;n<6;n++)await k.execute({action:'tabs.open',url:origin+'/saved/'+n,reuse:false})
  const active=[...k.tabs.values()].filter(t=>t.source==='agent').at(-1)!;await k.showTab(active.id);const firstId=store.active().id,oldAgents=[...k.tabs.values()].filter(t=>t.source==='agent').map(t=>t.view.webContents)
  await k.releaseProjectResearchTabs();assert.ok(oldAgents.every(p=>p.isDestroyed()));assert.equal(userPage.isDestroyed(),false);await play(userPage);assert.equal(await paused(userPage),true)
  const second=store.create({name:'Second daily Project',homeUrl:origin+'/second'});await k.switchProject(second)
  assert.equal([...k.tabs.values()].some(t=>t.projectId===firstId&&t.source==='agent'),false)
  await k.releaseProjectResearchTabs();await k.switchProject(store.switch(firstId));assert.equal(k.tabs.get(user.id).view.webContents,userPage);assert.equal(k.state().tabs.filter(t=>t.source==='agent').length,6);assert.equal(k.activeUrl(),active.url)
  k.saveTabState(firstId);clearTimeout(k.tabStateTimer)
  for(const t of k.tabs.values())await closeNavigationPage(t.view.webContents);k.tabs.clear()
  const restarted=make(createStore());await restarted.initialize();assert.equal(restarted.state().tabs.filter(t=>t.source==='agent').length,6)
  for(let n=0;n<10;n++)await restarted.execute({action:'tabs.open',url:origin+'/tomorrow/'+n,reuse:false})
  assert.equal(restarted.state().tabs.filter(t=>t.source==='agent').length,6);assert.ok(restarted.state().tabs.some(t=>t.source==='user'&&t.url===origin+'/user'))
  const restoreStore=createStore(),restoreProject=restoreStore.active(),restoreUrls=Array.from({length:9},(_,n)=>origin+'/restore-slow/'+n)
  restoreStore.updateTabState(restoreProject.id,{urls:restoreUrls,tabs:restoreUrls.map(url=>({url,source:'user'})),activeUrl:restoreUrls[4]})
  const bounded=make(restoreStore);await bounded.initialize();assert.equal(restoringPeak,0);assert.equal(bounded.state().tabs.length,9);assert.deepEqual(bounded.state().tabs.map(t=>t.url),restoreUrls);assert.equal(bounded.activeUrl(),restoreUrls[4]);assert.equal(restoringRequests,0);assert.ok(bounded.state().tabs.every(t=>t.deferred));const deferred=bounded.state().tabs[2];await bounded.execute({action:'observe',tabId:deferred.id});assert.equal(restoringPeak,1);assert.equal(bounded.state().tabs.filter(t=>!t.deferred).length,1);await bounded.execute({action:'tabs.show',tabId:bounded.state().tabs[4].id});assert.equal(bounded.state().tabs.filter(t=>!t.deferred).length,2)
  console.log('PASS lazy startup restoration: zero network requests, preserved user URLs/order/selection, observe and selection load only required pages')
  console.log('PASS playback: actual main/cross-origin media pauses on tab/Project/Studio changes, background replay blocked, no resume on activation, capture success/failure cleans playback and restores selection')
  console.log('PASS tab lifecycle: native LRU destruction, failed-load cap, FIFO close drain, quarantine recovery, inactive Project Agent release, saved ownership/restart and preserved user pages; isolated local HTTP only')
 }catch(error){code=1;console.error(error)}finally{clearTimeout(watchdog);for(const k of kernels){clearTimeout(k.tabStateTimer);for(const t of k.tabs.values())if(!t.view.webContents.isDestroyed())t.view.webContents.close({waitForBeforeUnload:false})}for(const w of windows)if(!w.isDestroyed())w.destroy();frameServer.closeAllConnections();await new Promise<void>(resolve=>frameServer.close(()=>resolve()));server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(root,{recursive:true,force:true});app.exit(code)}
}
void run()
