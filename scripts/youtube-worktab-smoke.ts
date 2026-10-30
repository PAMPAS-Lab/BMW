import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {app,BrowserWindow,session} from 'electron'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {youtubeSwitchAction,youtubeSwitchReady,youtubeNavigationSurfaceReady,switchYoutubeVideo} from '../packages/browser-capability/src/youtube-switch.js'
import {closeNavigationPage} from '../packages/browser-capability/src/page-navigation.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-youtube-worktab-'));app.setPath('userData',path.join(root,'profile'));app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
const ids=['jNQXAC9IVRw','zHBrUVyQJWc','a9LDPn-MO4I'],url=(n:number)=>'https://www.youtube.com/watch?v='+ids[n]
let window:BrowserWindow|undefined,kernel:BrowserKernel|undefined,documents=0
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function run(){
 await app.whenReady();const pages=session.fromPartition('youtube-worktab-fixture-'+process.pid)
 window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
 // Only controlled local responses. The website fixture owns its SPA history
 // and player updates; the production adapter may only click its real controls.
 const encoder=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
 let clip:string
 try{await encoder.loadFile(path.resolve('packages/media-native/src/media/media.html'));clip=Buffer.from(await encoder.webContents.executeJavaScript(`(async()=>{const {Output,Mp4OutputFormat,BufferTarget,CanvasSource}=await import('mediabunny');const c=new OffscreenCanvas(64,64),x=c.getContext('2d'),target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target}),video=new CanvasSource(c,{codec:'avc',bitrate:100000});output.addVideoTrack(video,{frameRate:10});await output.start();for(let n=0;n<10;n++){x.fillStyle=n%2?'red':'blue';x.fillRect(0,0,64,64);await video.add(n/10,.1)}video.close();await output.finalize();return [...new Uint8Array(target.buffer)]})()`,true) as number[]).toString('base64')}finally{encoder.destroy()}
 pages.protocol.handle('https',request=>{documents++
 if(new URL(request.url).searchParams.get('v')==='BmwBoot0001'){
  const timers:ReturnType<typeof setTimeout>[]=[]
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(`<!doctype html><div id="movie_player"><video muted preload="auto" src="data:video/mp4;base64,${clip}"></video></div><script>const p=document.getElementById('movie_player');let bootPlayback=0;p.getVideoData=()=>({video_id:'BmwBoot0001',cpn:'bootstrap-'+bootPlayback});p.getPlayerResponse=()=>({videoDetails:{videoId:'BmwBoot0001'},playabilityStatus:{status:'OK'}})</script>`));timers.push(setTimeout(()=>{c.enqueue(new TextEncoder().encode('<yt-searchbox><form><input name="search_query"></form><button aria-label="Search">Search</button></yt-searchbox>'))},6500));timers.push(setTimeout(()=>{c.enqueue(new TextEncoder().encode(`<script>document.querySelector('button').onclick=()=>{history.pushState({},'','/results?search_query=BmwBoot0001');const a=document.createElement('a');a.href='/watch?v=BmwBoot0001';a.textContent='bootstrap result';a.onclick=e=>{e.preventDefault();history.pushState({},'',a.href);bootPlayback++};document.body.append(a)}</script>`));c.close()},8000))},cancel(){timers.forEach(clearTimeout)}})
  return new Response(body,{headers:{'content-type':'text/html'}})
 }
 return new Response(`<!doctype html><title>Controlled work tab</title><a id="logo" href="/">Home</a><form><input name="search_query"><button type="submit">Search</button></form><div id="links"></div><div id="movie_player"><video muted loop src="data:video/mp4;base64,${clip}"></video><a href="/watch?v=jNQXAC9IVRw" target="_blank">Old player title</a></div><script>
 const ids=${JSON.stringify(ids)},p=document.querySelector('#movie_player'),links=document.querySelector('#links');let current=new URL(location.href).searchParams.get('v'),playback=0,switching=false;window.documentWitness=Math.random();window.events=[];
 p.getVideoData=()=>({video_id:current,cpn:'fixture-'+playback});p.getPlayerResponse=()=>switching?null:({videoDetails:{videoId:current},playabilityStatus:{status:'OK'},microformat:{playerMicroformatRenderer:{isUnlisted:current==='BmwHide0001'}}});
 function anchor(id,parent=links){const a=document.createElement('a');a.href='/watch?v='+id;a.textContent=id;a.onclick=e=>{e.preventDefault();events.push('click:'+id);switching=true;history.pushState({},'',a.href);setTimeout(()=>{current=id;playback++;switching=false;links.replaceChildren();},80)};parent.append(a)}
 anchor(ids[1]);const ad=document.createElement('ytd-ad-slot-renderer');links.append(ad);anchor(ids[2],ad);
 document.querySelector('#logo').onclick=e=>{e.preventDefault();events.push('home');history.pushState({},'','/')};addEventListener('popstate',()=>{switching=true;setTimeout(()=>{current=new URL(location.href).searchParams.get('v');playback++;switching=false;events.push('history:'+current)},80)});
 document.querySelector('form').onsubmit=e=>{e.preventDefault();const id=document.querySelector('input').value;events.push('search:'+id);history.pushState({},'','/results?search_query='+id);links.replaceChildren();setTimeout(()=>anchor(id),80)};
 </script>`,{headers:{'content-type':'text/html'}})})
 let active={id:'a',name:'A',directory:path.join(root,'a')};const b={id:'b',name:'B',directory:path.join(root,'b')}
 const k=kernel=new BrowserKernel({window,session:pages,projectStore:{active:()=>active,updateTabState:()=>{}},permissionStore:{hasAgentControl:()=>true},sessionContinuity:null,settingsStore:null,capabilityRegistry:null,allowedActions:undefined,artifactsDirectory:path.join(root,'artifacts'),onState:()=>{}});k.setRecordingController({isCaptureActive:()=>false})
 const user=await k.openTab({url:url(0),source:'user',foreground:true,reuse:false}),first=await k.execute({action:'tabs.open',url:url(0),foreground:true,reuse:false}) as {id:string;worktab:string;youtubeNavigation:{method:string;budgetMs:number;bootstrapReady:boolean}}
 assert.notEqual(user.id,first.id);assert.equal(first.worktab,'youtube');assert.equal(first.youtubeNavigation.method,'cold');assert.equal(first.youtubeNavigation.budgetMs,180000);assert.equal(first.youtubeNavigation.bootstrapReady,true);const wc=k.requireTab(first.id).view.webContents,witness=await wc.executeJavaScript('documentWitness'),count=documents
 k.setRecordingController({isCaptureActive:()=>true});await assert.rejects(k.withYoutubeWorkTab(url(1),async()=>{}),/MEDIA_CAPTURE_ACTIVE/);assert.equal(wc.getURL(),url(0),'Pending or quarantined media cleanup cannot move the work tab');k.setRecordingController({isCaptureActive:()=>false})
 await wc.executeJavaScript('events.length=0;document.querySelector("#links").replaceChildren();anchor(ids[1])')
 const surface=()=>wc.executeJavaScript(`(${youtubeNavigationSurfaceReady.toString()})()`,true)
 assert.equal(await surface(),true);await wc.executeJavaScript('document.querySelector("form").style.display="none"');assert.equal(await surface(),false,'Hidden chunked search placeholders cannot authorize an early stop');await wc.executeJavaScript('document.querySelector("form").style.display="";document.querySelector("button").disabled=true');assert.equal(await surface(),false,'Disabled search is not a usable navigation surface');await wc.executeJavaScript('document.querySelector("button").disabled=false')
 await wc.executeJavaScript(`(()=>{const form=document.querySelector('form'),box=document.createElement('yt-searchbox'),button=form.querySelector('button');form.replaceWith(box);box.append(form,button);button.type='button';button.setAttribute('aria-label','Search');button.onclick=()=>form.requestSubmit()})()`)
 assert.equal(await surface(),true,'Modern YouTube puts its search button outside the inner form; the component owns both controls')
 const second=await k.execute({action:'tabs.open',url:url(1),foreground:true,reuse:false}) as typeof first;assert.equal(second.id,first.id);assert.equal(second.youtubeNavigation.method,'in-page-link');assert.equal(second.youtubeNavigation.budgetMs,90000);assert.equal(documents,count);assert.equal(await wc.executeJavaScript('documentWitness'),witness)
 assert.equal(await wc.executeJavaScript(`(${youtubeSwitchReady.toString()})(${JSON.stringify(url(0))})`),false,'A stale player cannot certify the requested target')
 // Only an ad contains the third target: the adapter must use real search.
 await wc.executeJavaScript(`(()=>{const ad=document.createElement('ytd-ad-slot-renderer');ad.innerHTML='<a href="/watch?v=${ids[2]}">ad</a>';document.querySelector('#links').append(ad)})()`)
 const third=await k.execute({action:'navigate',tabId:first.id,url:url(2)}) as typeof first;assert.equal(third.id,first.id);assert.equal(third.youtubeNavigation.method,'in-page-search');assert.equal(documents,count);assert.equal(await wc.executeJavaScript('documentWitness'),witness);assert.deepEqual(await wc.executeJavaScript('events'),['click:'+ids[1],'search:'+ids[2],'click:'+ids[2]])
 assert.equal(k.requireTab(user.id).view.webContents.getURL(),url(0),'User tab remains on its own page')
 const order:string[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve})
 const job=k.withYoutubeWorkTab(url(2),async()=>{order.push('download');try{await gate}finally{await sleep(30);order.push('cleanup')}})
 await sleep(100);const queued=k.withYoutubeWorkTab(url(0),async()=>{order.push('next')});await sleep(100);assert.deepEqual(order,['download']);assert.equal(wc.getURL(),url(2));release();await Promise.all([job,queued]);assert.deepEqual(order,['download','cleanup','next'])
 const cancelled=new AbortController();let release2!:()=>void;const gate2=new Promise<void>(resolve=>{release2=resolve});const hold=k.withYoutubeWorkTab(url(0),async()=>{await gate2});await sleep(50);const cancelledJob=k.withYoutubeWorkTab(url(1),async()=>{throw new Error('Must not run')},cancelled.signal);cancelled.abort();const rejection=assert.rejects(cancelledJob,/abort/i);release2();await Promise.all([hold,rejection]);assert.equal(wc.getURL(),url(0))
 for(let n=0;n<8;n++)await k.openTab({url:'about:blank',source:'agent',reuse:false});assert.ok(k.tabs.has(first.id),'Worker survives Agent LRU pressure');assert.ok([...k.tabs.values()].filter(t=>t.projectId==='a'&&t.source==='agent').length<=6)
 await k.releaseProjectResearchTabs();assert.ok(k.tabs.has(first.id));assert.equal(await wc.executeJavaScript('document.querySelector("video").paused'),true)
 active=b;await k.switchProject(b);assert.throws(()=>k.requireTab(first.id),/another BMW project/);const other=await k.withYoutubeWorkTab(url(1),async tab=>tab);assert.notEqual(other.id,first.id)
 await k.releaseProjectResearchTabs();active={id:'a',name:'A',directory:path.join(root,'a')};await k.switchProject(active);const back=await k.withYoutubeWorkTab(url(2),async tab=>tab);assert.equal(back.id,first.id)
 await sleep(0);await k.closeProjectYoutubeWorktab('b');assert.equal(k.tabs.has(other.id),false,'Inactive archive destroys its Project worker')
 await k.closeTab(first.id);assert.equal(wc.isDestroyed(),true);const replacement=await k.withYoutubeWorkTab(url(0),async tab=>tab);assert.notEqual(replacement.id,first.id)
 // Missing real controls returns unavailable rather than synthesizing a route.
 const replacementWc=k.requireTab(replacement.id).view.webContents;await replacementWc.executeJavaScript('document.querySelector("form").remove();document.querySelector("#links").replaceChildren()');assert.equal(await replacementWc.executeJavaScript(`(${youtubeSwitchAction.toString()})(${JSON.stringify(url(1))})`),'unavailable')
 const fallback=await k.withYoutubeWorkTab(url(1),async tab=>tab);assert.equal(fallback.youtubeNavigation?.method,'reload-fallback');assert.equal(fallback.id,replacement.id)
 await replacementWc.executeJavaScript('document.querySelector("video").remove()');await assert.rejects(k.withYoutubeWorkTab(url(2),async()=>{},AbortSignal.timeout(400)),/abort|timeout/i);assert.equal(replacementWc.isDestroyed(),true,'Aborted route is destroyed before admitting the next job')
 const quarantine=await k.withYoutubeWorkTab(url(0),async tab=>tab),quarantinedWc=k.requireTab(quarantine.id).view.webContents,frame=quarantinedWc.mainFrame,execute=frame.executeJavaScript.bind(frame)
 frame.executeJavaScript=async(code:string,userGesture?:boolean)=>{if(code.includes('v.pause();return v.paused===true'))throw new Error('Controlled pause verification failure');return execute(code,userGesture)}
 await assert.rejects(k.withYoutubeWorkTab(url(0),async()=>{}),/CLEANUP_FAILED/);assert.equal(quarantinedWc.isDestroyed(),false,'Failed cleanup is retained for explicit recovery');await assert.rejects(k.withYoutubeWorkTab(url(1),async()=>{}),/QUARANTINED/)
 frame.executeJavaScript=execute;await k.execute({action:'tabs.close',tabId:quarantine.id});assert.equal(quarantinedWc.isDestroyed(),true);await k.withYoutubeWorkTab(url(0),async()=>{})
 const restored=await k.withYoutubeWorkTab(url(0),async tab=>tab);await k.closeTab(restored.id)
 const bootstrapAt=performance.now();await k.withYoutubeWorkTab('https://www.youtube.com/watch?v=BmwBoot0001',async tab=>{const page=k.requireTab(tab.id).view.webContents;assert.equal(await page.executeJavaScript(`(${youtubeNavigationSurfaceReady.toString()})()`,true),true)},AbortSignal.timeout(12000));assert.ok(performance.now()-bootstrapAt>=7500,'Visible controls cannot cancel a still-streaming application before their event handlers arrive')
 const boot=await k.withYoutubeWorkTab('https://www.youtube.com/watch?v=BmwBoot0001',async tab=>tab);await k.closeTab(boot.id)
 // Site re-entry must not drop time, playlist or language semantics. These
 // targets use a real full navigation and retain their original query exactly.
 let semanticTab:string|undefined
 for(const suffix of ['&t=5','&list=PLfixture','&hl=en']){const target=url(0)+suffix;await k.withYoutubeWorkTab(target,async tab=>{semanticTab=tab.id;const page=k.requireTab(tab.id).view.webContents;assert.equal(page.getURL(),target);assert.deepEqual(await page.executeJavaScript('events'),[],'Semantic watch targets must not be sent through search/home activation')})}
 await k.closeTab(semanticTab!)
 const hidden='https://www.youtube.com/watch?v=BmwHide0001',beforeHidden=documents
 await k.withYoutubeWorkTab(hidden,async tab=>{const page=k.requireTab(tab.id).view.webContents;assert.equal(page.getURL(),hidden);assert.equal(documents,beforeHidden+1,'Actual site home/back activation retains the initialized document');assert.ok(k.diagnosticsFor(tab.id).network.some((event:{type?:string;method?:string})=>event.type==='youtube-bootstrap-activation'&&event.method==='site-history'));assert.deepEqual(await page.executeJavaScript('events'),['home','history:BmwHide0001'])
  const beforeIndex=page.navigationHistory.getActiveIndex();await page.executeJavaScript(`document.querySelector('#logo').onclick=e=>{e.preventDefault();history.pushState({},'','/');history.pushState({},'','/')} ;true`)
  const refused=await switchYoutubeVideo(page,hidden,new AbortController().signal,500,true);assert.equal(refused.method,'unavailable');assert.equal(page.navigationHistory.getActiveIndex(),beforeIndex+2,'A foreign/intervening history entry cannot authorize goBack')
 })
 console.log('PASS resident YouTube: real link/search SPA; strict player identity; full-job FIFO; queued cancellation; user ownership; LRU; Project pause/return/archive; close/recreate; bounded reload fallback; aborted renderer cleanup')
}
const watchdog=setTimeout(()=>app.exit(2),90000)
process.on('uncaughtException',error=>{console.error(error);app.exit(1)});process.on('unhandledRejection',error=>{console.error(error);app.exit(1)})
run().then(()=>{process.exitCode=0},error=>{console.error(error);process.exitCode=1}).finally(async()=>{clearTimeout(watchdog);if(kernel)for(const tab of [...kernel.tabs.values()])await closeNavigationPage(tab.view.webContents).catch(error=>{console.error(error);process.exitCode=1});window?.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(Number(process.exitCode??1))})
