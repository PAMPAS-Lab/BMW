import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {app,BrowserWindow,session} from 'electron'
import {readVideoTargets,prepareVideoTransfer} from '../packages/browser-capability/src/video-target.js'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {selectVideoResource,selectVideoCaptureTarget} from '@bmw-agent/agent-contract/video-identity'
import type {SourceCaptureGuard} from '@bmw-agent/media-native/sources'
import {downloadMediaArtifact} from '../packages/browser-capability/src/media-artifact.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-video-identity-'));app.setPath('userData',path.join(root,'profile'))
let window:BrowserWindow|undefined,exitCode=0
const timeout=setTimeout(()=>{console.error('Video identity fixture timed out');app.exit(1)},45000)
async function run(){try{
 await app.whenReady();const isolated=session.fromPartition('video-identity-'+process.pid)
 // This partition has no external transport: every HTTPS URL terminates in a local fixture.
 isolated.protocol.handle('https',request=>new Response(new URL(request.url).hostname==='static.foxnews.com'?`<html><style>video{width:320px;height:180px}</style><body><div id="player" data-amp-guid="6403817944112"><video></video></div><script>const root=document.querySelector('#player'),video=root.querySelector('video');Object.defineProperty(video,'currentSrc',{value:'blob:https://static.foxnews.com/fixture'});Object.defineProperty(video,'duration',{value:10.1});window.amp={container:root,mediaElement:video,isLive:false,ads:{inProgress:false},media:{guid:'6403817944112',isLive:false,duration:10.1,poster:'https://a57.foxnews.com/v1/static/694940094001/6bb13dc4-51d4-439e-b983-fd9bbfb75423/image.jpg',source:[{type:'application/x-mpegURL',src:'https://manifest.prod.boltdns.net/manifest/v1/hls/v4/clear/694940094001/6bb13dc4-51d4-439e-b983-fd9bbfb75423/10s/master.m3u8'}]}}</script></body></html>`:'<html><style>video{width:320px;height:180px}</style><body></body></html>',{headers:{'content-type':'text/html'}}))
 window=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});const wc=window.webContents
 await window.loadURL('https://x.com/author/status/123')
 await wc.executeJavaScript(`(()=>{document.body.innerHTML='<article data-testid="tweet" id="original"><a href="/author/status/123"><time>Today</time></a><video poster="https://pbs.twimg.com/amplify_video_thumb/456/img/a.jpg"></video></article><article data-testid="tweet" id="reply"><a href="/reply/status/999"><time>Today</time></a><video poster="https://pbs.twimg.com/amplify_video_thumb/999/img/a.jpg"></video></article>';for(const v of document.querySelectorAll('video'))Object.defineProperty(v,'currentSrc',{configurable:true,value:'blob:https://x.com/'+v.parentElement.id})})()`)
 const correct='https://video.twimg.com/amplify_video/456/pl/master.m3u8',reply='https://video.twimg.com/amplify_video/999/pl/master.m3u8',animation='https://abs.twimg.com/playback1.mp4'
 const state=await readVideoTargets(wc);assert.equal(state.targets.length,1);assert.equal(selectVideoResource(state,correct).identity.targetId,'123')
 const tab={id:'fixture',view:{webContents:wc}},kernel={playbackAllowed:()=>true,serializeTab:()=>({id:'fixture'}),diagnosticsFor:()=>({media:[{url:reply,mimeType:'application/vnd.apple.mpegurl'},{url:correct,mimeType:'application/vnd.apple.mpegurl'},{url:animation,mimeType:'video/mp4'}]})}
 const listed=await BrowserKernel.prototype.listMedia.call(kernel,tab,{maxItems:200}) as {items:{url:string;videoIdentity?:{targetId:string}}[]}
 assert.ok(listed.items.some(i=>i.url===correct&&i.videoIdentity?.targetId==='123'));assert.ok(!listed.items.some(i=>i.url===reply||i.url===animation))
 const scoped=await BrowserKernel.prototype.listMedia.call(kernel,tab,{selector:'#original',maxItems:200}) as typeof listed;assert.ok(scoped.items.some(i=>i.url===correct&&i.videoIdentity?.targetId==='123'));assert.ok(!scoped.items.some(i=>i.url===reply||i.url===animation))
 await assert.rejects(prepareVideoTransfer(wc,reply),/UNBOUND/)
 await wc.executeJavaScript("document.querySelector('#original').removeAttribute('data-testid');document.querySelector('#original a').textContent='14:57 · 2024年5月15日';true")
 const modern=await readVideoTargets(wc);assert.equal(selectVideoResource(modern,correct).identity.targetId,'123');await assert.rejects(prepareVideoTransfer(wc,reply),/UNBOUND/)
 const admitted=await prepareVideoTransfer(wc,correct)
 await wc.executeJavaScript("document.querySelector('#original').dataset.bmwAd='true'")
 await assert.rejects(admitted.finish(),/CHANGED|UNBOUND/);await assert.rejects(prepareVideoTransfer(wc,correct),/UNAVAILABLE/)
 await wc.executeJavaScript("delete document.querySelector('#original').dataset.bmwAd;Object.defineProperty(document.querySelector('#original video'),'currentSrc',{configurable:true,value:'https://video.twimg.com/amplify_video/999/vid/a.mp4'});true")
 await assert.rejects(prepareVideoTransfer(wc,correct),/UNAVAILABLE/)
 await wc.executeJavaScript("Object.defineProperty(document.querySelector('#original video'),'currentSrc',{configurable:true,value:'blob:https://x.com/original'});true")
 const changing=await prepareVideoTransfer(wc,correct),artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts);fs.writeFileSync(path.join(artifacts,'existing.txt'),'keep')
 await assert.rejects(downloadMediaArtifact({projectDirectory:root,url:correct,guard:force=>force?changing.finish():changing.guard(),fetchImpl:async()=>{await wc.executeJavaScript("document.querySelector('#original video').poster='https://pbs.twimg.com/amplify_video_thumb/888/img/a.jpg'");return new Response('changed target',{headers:{'content-type':'video/mp4'}})}}),/UNBOUND/)
 assert.deepEqual(fs.readdirSync(artifacts),['existing.txt'])
 await window.loadURL('https://www.youtube.com/watch?v=abcdefghijk')
 const video='https://r1.googlevideo.com/videoplayback?itag=137&source=youtube',audio='https://r1.googlevideo.com/videoplayback?itag=140&source=youtube'
 await wc.executeJavaScript(`(()=>{document.body.innerHTML='<div id="movie_player"><video></video></div>';const p=document.querySelector('#movie_player'),v=p.querySelector('video');Object.defineProperty(v,'duration',{value:10});Object.defineProperty(v,'currentSrc',{value:'blob:https://www.youtube.com/player'});p.getVideoData=()=>({video_id:'abcdefghijk'});p.getPlayerResponse=()=>({playabilityStatus:{status:'OK'},videoDetails:{videoId:'abcdefghijk',lengthSeconds:'10'},streamingData:{adaptiveFormats:[{url:${JSON.stringify(video)},mimeType:'video/mp4',approxDurationMs:'10000'},{url:${JSON.stringify(audio)},mimeType:'audio/mp4',approxDurationMs:'10000',audioTrack:{id:'en',audioIsDefault:true}}]}})})()`)
 const yt=await prepareVideoTransfer(wc,video);assert.equal(yt.audio?.url,audio);assert.equal(yt.videoIdentity?.targetId,'abcdefghijk')
 await wc.executeJavaScript("history.replaceState(history.state,'',location.href+'&themeRefresh=2');true");await yt.finish()
 await wc.executeJavaScript("document.querySelector('#movie_player').classList.add('ad-interrupting')");await assert.rejects(yt.finish(),/CHANGED|UNAVAILABLE/)
 await wc.executeJavaScript("document.querySelector('#movie_player').classList.remove('ad-interrupting');const p=document.querySelector('#movie_player'),original=p.getPlayerResponse;p.getPlayerResponse=()=>{const r=original();r.streamingData.adaptiveFormats=r.streamingData.adaptiveFormats.map(f=>({...f,url:f.url+'&rotated=1'}));return r};true")
 const rotated=await readVideoTargets(wc)
 assert.equal(selectVideoCaptureTarget(rotated,video,yt.videoIdentity).identity.targetId,'abcdefghijk')
 await assert.rejects(prepareVideoTransfer(wc,video),/UNBOUND/)
 const sourceGuard:SourceCaptureGuard={pageUrl:rotated.pageUrl,candidateUrl:video,videoIdentity:yt.videoIdentity,scope:{selector:'#movie_player',index:0,excludeSelectors:[],characterUnit:'utf16',extraction:'visible-text-nodes',truncated:false,status:'observed'}}
 let preserved=0
 const host={requireTab:()=>({id:'yt-source',view:{webContents:wc}}),projectStore:{active:()=>({id:'fixture'})},recordingController:{isCaptureActive:()=>false},
  verifySourceVideo:(request:SourceCaptureGuard&{tabId?:string},signal?:AbortSignal)=>BrowserKernel.prototype.verifySourceVideo.call(host as unknown as BrowserKernel,request,signal),
  preserveSource:async(request:{url:string})=>{assert.equal(request.url,video+'&rotated=1');preserved++;return {artifactId:'fixture-preserved'}},captureSource:async()=>{throw new Error('Unexpected capture after successful preservation')}}
 await wc.executeJavaScript("history.replaceState(history.state,'',location.href+'&feature=share');true")
 assert.equal((await host.verifySourceVideo(sourceGuard)).targetId,'abcdefghijk','Final source identity survives delivery rotation')
 const freshDelivery=await BrowserKernel.prototype.acquireSource.call(host as unknown as BrowserKernel,{sourceGuard,videoSelector:'video',filename:'fixture'},new AbortController().signal)
 assert.equal(freshDelivery.method,'preserve');assert.equal(preserved,1,'Auto begins with the fresh observed delivery of the pinned target')
 await wc.executeJavaScript("document.querySelector('#movie_player').getSphericalProperties=()=>({yaw:0,pitch:0,roll:0,fov:100});true")
 const spherical=await readVideoTargets(wc);assert.equal(spherical.targets[0]?.requiresProjection,true)
 await assert.rejects(BrowserKernel.prototype.acquireSource.call(host as unknown as BrowserKernel,{sourceGuard,videoSelector:'video',filename:'fixture'},new AbortController().signal),/MEDIA_ACQUIRE_PROJECTION_UNSUPPORTED/)
 assert.equal(preserved,1,'Known spherical input must be rejected before transfer')
 await wc.executeJavaScript("document.querySelector('#movie_player').getSphericalProperties=()=>({});true")
 assert.equal((await readVideoTargets(wc)).targets[0]?.requiresProjection,undefined,'Unknown projection is not certified flat')
 await wc.executeJavaScript("document.querySelector('#movie_player').classList.add('ad-showing')");assert.throws(()=>selectVideoCaptureTarget({...rotated,targets:[]},video,yt.videoIdentity),/CHANGED/)
 await assert.rejects(prepareVideoTransfer(wc,video),/UNAVAILABLE/)
 await wc.executeJavaScript("document.querySelector('#movie_player').classList.remove('ad-showing');document.querySelector('#movie_player').getVideoData=()=>({video_id:'reply'});true");await assert.rejects(prepareVideoTransfer(wc,video),/UNAVAILABLE/)
 await window.loadURL('https://weibo.com/tv/show/1034:123')
 await wc.executeJavaScript(`(()=>{document.body.innerHTML='<video id="main"></video>';Object.defineProperty(document.querySelector('video'),'currentSrc',{value:'https://cdn.example/4k.mp4'})})()`)
 assert.equal((await prepareVideoTransfer(wc,'https://cdn.example/4k.mp4')).videoIdentity?.platform,'weibo')
 await wc.executeJavaScript("document.body.append(document.createElement('video'));true");await assert.rejects(prepareVideoTransfer(wc,'https://cdn.example/4k.mp4'),/UNAVAILABLE/)
 await window.loadURL('https://fixture.example/article')
 await wc.executeJavaScript("document.body.innerHTML='<source src=\"https://cdn.example/master.m3u8\">';true")
 const standalone=await prepareVideoTransfer(wc,'https://cdn.example/master.m3u8');assert.equal(standalone.videoIdentity?.platform,'page')
 await wc.executeJavaScript("document.querySelector('source').src='https://cdn.example/changed.m3u8';true");await assert.rejects(standalone.finish(),/UNBOUND/)
 // Bilingual official demos: DOM index zero can be a CSS-hidden translation,
 // while the visible player declares its MP4 through preload=none <source>.
 await wc.executeJavaScript(`document.body.innerHTML='<div style="display:none"><video id="hidden" preload="none"><source src="https://cdn.example/lazy.mp4" type="video/mp4"></video></div><div><video id="visible" preload="none"><source src="https://cdn.example/lazy.mp4" type="video/mp4"></video></div>';for(const v of document.querySelectorAll('video'))Object.defineProperty(v,'currentSrc',{configurable:true,value:''});true`)
 const lazy=await readVideoTargets(wc,{selector:'#visible'})
 assert.equal(lazy.targets.length,1,'A visible uniquely declared MP4 must bind before metadata loading')
 assert.equal(lazy.targets[0]!.identity.resourceId,'https://cdn.example/lazy.mp4','Empty currentSrc must never resolve to the article URL as player identity')
 assert.equal(lazy.targets[0]!.videoIndex,1);assert.equal(lazy.targets[0]!.durationSeconds,null)
 assert.equal((await readVideoTargets(wc,{selector:'#hidden'})).targets.length,0,'Hidden translation cannot authorize media')
 const lazyListing=await BrowserKernel.prototype.listMedia.call(kernel,tab,{selector:'video',index:0,maxItems:200}) as {videoTargets:unknown[];playerCandidates:{index:number;visible:boolean;state:string}[];items:{kind:string}[]}
 assert.equal(lazyListing.videoTargets.length,0)
 assert.deepEqual(lazyListing.playerCandidates.map(p=>[p.index,p.visible,p.state]),[[0,false,'hidden-or-excluded'],[1,true,'declared-source-not-loaded']])
 assert.ok(!lazyListing.items.some(item=>['source','video'].includes(item.kind)),'Hidden selected media must not be offered as downloadable')
 const lazyTransfer=await prepareVideoTransfer(wc,'https://cdn.example/lazy.mp4',undefined,{pageUrl:wc.getURL(),candidateUrl:'https://cdn.example/lazy.mp4',videoIdentity:lazy.targets[0]!.identity,scope:{selector:'#visible',index:0,excludeSelectors:[],characterUnit:'utf16',extraction:'visible-text-nodes',truncated:false,status:'observed'}})
 await wc.executeJavaScript("document.querySelector('#visible source').src='https://cdn.example/changed.mp4';true")
 await assert.rejects(lazyTransfer.finish(),/UNBOUND/)
 await wc.executeJavaScript("document.querySelector('#visible').innerHTML='<source src=\"https://cdn.example/one.mp4\" type=\"video/mp4\"><source src=\"https://cdn.example/two.mp4\" type=\"video/mp4\">';true")
 assert.equal((await readVideoTargets(wc,{selector:'#visible'})).targets.length,0,'Multiple unloaded alternatives require an actual selected resource')
 await wc.executeJavaScript("document.querySelector('#visible').innerHTML='<source src=\"https://cdn.example/lazy.mp4\" type=\"video/mp4\">';document.querySelector('#visible').dataset.bmwAd='true';true")
 assert.equal((await readVideoTargets(wc,{selector:'#visible'})).targets.length,0,'Declared-source fallback does not admit ads')
 const cnbcPage='https://www.cnbc.com/video/2026/10/07/clip.html',cnbcMp4='https://pdl-iphone-cnbc-com.akamaized.net/70001/version/clip.mp4',cnbcHls='https://cnbcawsmpvod.akamaized.net/out/v1/original/master.m3u8'
 await window.loadURL(cnbcPage)
 await wc.executeJavaScript(`(()=>{document.body.innerHTML='<h1>Original CNBC</h1><div id="current" class="jwplayer"><video></video></div>';const v=document.querySelector('video'),container=v.parentElement;Object.defineProperty(v,'duration',{value:120});Object.defineProperty(v,'currentSrc',{value:'blob:https://www.cnbc.com/current'});const item={mediaid:'cnbc_70001',duration:120,title:'Original CNBC',url:${JSON.stringify(cnbcPage)},file:${JSON.stringify(cnbcHls)},sources:[{mediaid:'cnbc_70001',url:${JSON.stringify(cnbcPage)},type:'hls',file:${JSON.stringify(cnbcHls)}}]};window.__CNBC_META_DATA={vcpsId:70001,url:${JSON.stringify(cnbcPage)},title:'Original CNBC',type:'cnbcvideo'};window.jwplayer=()=>({getContainer:()=>container,getPlaylistItem:()=>item,getDuration:()=>120});window.fixtureItem=item;const data=document.createElement('script');data.type='application/ld+json';data.textContent=JSON.stringify({'@type':'VideoObject',name:'Original CNBC',duration:'PT2M',contentUrl:${JSON.stringify(cnbcMp4)}});document.head.append(data)})()`)
 const cnbcState=await readVideoTargets(wc);assert.equal(cnbcState.targets[0]?.identity.resourceId,'cnbc:70001');assert.deepEqual(cnbcState.targets[0]?.resources.map(r=>r.url),[cnbcMp4,cnbcHls])
 await wc.executeJavaScript('delete window.fixtureItem.duration;true');assert.equal((await readVideoTargets(wc)).targets.length,1,'CNBC normalized playlist may omit duration; current SDK duration must still match the real player');
 const cnbcAdmission=await prepareVideoTransfer(wc,cnbcHls);await assert.rejects(prepareVideoTransfer(wc,'https://ads.example/ad.mp4'),/UNBOUND/)
 const publisherList=await BrowserKernel.prototype.listMedia.call({...kernel,diagnosticsFor:()=>({media:[{url:cnbcHls,mimeType:'application/vnd.apple.mpegurl'},{url:'https://ads.example/ad.mp4',mimeType:'video/mp4'}]})},tab,{maxItems:200}) as typeof listed
 assert.ok(publisherList.items.some(i=>i.url===cnbcHls&&i.videoIdentity));assert.ok(!publisherList.items.some(i=>i.url==='https://ads.example/ad.mp4'))
 await wc.executeJavaScript("document.querySelector('.jwplayer').classList.add('jw-flag-ads');true");await assert.rejects(cnbcAdmission.finish(),/CHANGED|UNBOUND|UNAVAILABLE/)
 await wc.executeJavaScript("document.querySelector('.jwplayer').classList.remove('jw-flag-ads');window.fixtureItem.mediaid='cnbc_70002';true");assert.ok((await readVideoTargets(wc)).blocked)
 const foxPage='https://www.foxnews.com/video/6403817944112',foxMp4='http://vod.foxnews.com/media/v1/pmp4/static/clear/694940094001/6bb13dc4-51d4-439e-b983-fd9bbfb75423/0c96ac9b-0894-452a-80d3-b85098200c10/main.mp4',foxFrame='https://static.foxnews.com/static/orion/html/video/iframe/vod.html?v=null#uid=fnc-embed-1&url=www.foxnews.com%2Fvideo%2F6403817944112'
 await window.loadURL(foxPage)
 await wc.executeJavaScript(`(()=>{document.body.innerHTML='<h1>Original Fox</h1><div id="embed" data-widget-type="embed" data-video-id="6403817944112" data-video-gated="false" data-embed-uid="fnc-embed-1"><iframe src="${foxFrame}"></iframe></div><div id="other">Outside</div>';const data=document.createElement('script');data.type='application/ld+json';data.textContent=JSON.stringify({'@type':'VideoObject',name:'Original Fox',duration:'PT10S',contentUrl:${JSON.stringify(foxPage)},embedUrl:${JSON.stringify(foxMp4)}});document.head.append(data)})()`)
 let foxState=await readVideoTargets(wc);for(let attempt=0;attempt<40&&!foxState.targets.length;attempt++){await new Promise(resolve=>setTimeout(resolve,50));foxState=await readVideoTargets(wc)}
 assert.equal(foxState.targets[0]?.identity.resourceId,'fox:6403817944112',foxState.blocked??'Missing Fox frame target');assert.equal(foxState.targets[0]?.videoIndex,-1)
 assert.equal((await readVideoTargets(wc,{selector:'iframe'})).targets.length,1);assert.equal((await readVideoTargets(wc,{selector:'#other'})).targets.length,0)
 const foxAdmission=await prepareVideoTransfer(wc,foxMp4),frame=wc.mainFrame.framesInSubtree.find(f=>f.url===foxFrame);assert.ok(frame)
 await frame.executeJavaScript('window.amp.ads.inProgress=true;true');await assert.rejects(foxAdmission.finish(),/CHANGED|UNAVAILABLE/)
 await frame.executeJavaScript("window.amp.ads.inProgress=false;window.amp.media.guid='6403817944113';true");assert.ok((await readVideoTargets(wc)).blocked)
 await frame.executeJavaScript("window.amp.media.guid='6403817944112';true");const attached=await prepareVideoTransfer(wc,foxMp4)
 await wc.executeJavaScript("document.querySelector('iframe').remove();true");await assert.rejects(attached.finish(),/CHANGED|UNAVAILABLE/)
 await assert.rejects(readVideoTargets(wc,{},AbortSignal.abort(new Error('cancel publisher read'))),/cancel publisher read/)
 const cnnPage='https://edition.cnn.com/2026/10/28/politics/video/original',cnnId='mecef3e95814a7c3788851d76c807e13bc6cf6e102',cnnMp4='https://clips-media-aka.warnermediacdn.com/cnn/clips/2026-10/2413539-234abbc2b3454154b092f7651e6ec9ea/mp4/original-2413539-1920x1080_8000k.mp4'
 await window.loadURL(cnnPage)
 await wc.executeJavaScript(`(()=>{document.body.innerHTML='<h1>Original CNN</h1><div id="advert"><video src="https://ads.example/ad.mp4"></video></div><div id="cnn" data-component-name="video-resource" data-video-id="${cnnId}" data-media-id="${cnnId}" data-canonical-url-path="/2026/10/28/politics/video/original" data-canonical-url="https://www.cnn.com/2026/10/28/politics/video/original" data-headline="Original CNN" data-live="" data-auth-type="" data-content-type="mediasource-clip"><video></video></div>';const data=document.createElement('script');data.id='cnn-json';data.type='application/ld+json';data.textContent=JSON.stringify({'@type':'VideoObject',name:'Original CNN',duration:'PT2M5S',contentUrl:${JSON.stringify(cnnMp4)},embedUrl:'https://fave.api.cnn.io/v1/fav/?video=${cnnId}'});document.head.append(data)})()`)
 const cnnState=await readVideoTargets(wc);assert.equal(cnnState.targets[0]?.identity.resourceId,'cnn:'+cnnId);assert.equal(cnnState.targets[0]?.videoIndex,-1)
 assert.equal((await readVideoTargets(wc,{selector:'#cnn video'})).targets.length,1);assert.equal((await readVideoTargets(wc,{selector:'#advert'})).targets.length,0)
 await assert.rejects(prepareVideoTransfer(wc,'https://ads.example/ad.mp4'),/UNBOUND/)
 const cnnAdmission=await prepareVideoTransfer(wc,cnnMp4)
 await wc.executeJavaScript("document.querySelector('#cnn').setAttribute('data-live','true');true");await assert.rejects(cnnAdmission.finish(),/CHANGED|UNAVAILABLE/)
 await wc.executeJavaScript("document.querySelector('#cnn').setAttribute('data-live','');const data=document.querySelector('#cnn-json'),v=JSON.parse(data.textContent);v.embedUrl='https://fave.api.cnn.io/v1/fav/?video=me00000000000000000000000000000000';data.textContent=JSON.stringify(v);true");assert.ok((await readVideoTargets(wc)).blocked)
 const yahooPage='https://ca.finance.yahoo.com/video/original-164139763.html',yahooId='0c1b39db-70fa-4379-afbc-b24956ef2e03',yahooHls='https://video.media.yql.yahoo.com/v1/video/sapi/hlsstreams/'+yahooId+'.m3u8?site=finance'
 await window.loadURL(yahooPage)
 await wc.executeJavaScript(`(()=>{document.head.innerHTML='';document.body.innerHTML='<main id="original"><h1>Original Yahoo</h1></main><div id="advert"><video src="https://ads.example/ad.mp4"></video></div>';const canonical=document.createElement('link');canonical.rel='canonical';canonical.href=${JSON.stringify(yahooPage)};document.head.append(canonical);const data=document.createElement('script');data.id='yahoo-json';data.type='application/ld+json';data.textContent=JSON.stringify({'@type':'VideoObject',identifier:${JSON.stringify(yahooId)},name:'Original Yahoo',duration:'PT137S',contentUrl:${JSON.stringify(yahooHls)},embedUrl:${JSON.stringify(yahooPage+'?format=embed')}});document.head.append(data)})()`)
 const yahooState=await readVideoTargets(wc);assert.equal(yahooState.targets[0]?.identity.resourceId,'yahoo-finance:'+yahooId);assert.equal(yahooState.targets[0]?.videoIndex,-1)
 assert.equal((await readVideoTargets(wc,{selector:'#original'})).targets.length,1);assert.equal((await readVideoTargets(wc,{selector:'#advert'})).targets.length,0)
 await assert.rejects(prepareVideoTransfer(wc,'https://ads.example/ad.mp4'),/UNBOUND/)
 const yahooAdmission=await prepareVideoTransfer(wc,yahooHls)
 await wc.executeJavaScript("document.querySelector('link[rel=canonical]').href+='?other=1';true");await assert.rejects(yahooAdmission.finish(),/CHANGED|UNAVAILABLE/)
 await wc.executeJavaScript("document.querySelector('link[rel=canonical]').href=location.href;document.querySelector('h1').textContent='Different';true");assert.ok((await readVideoTargets(wc)).blocked)
 console.log('PASS isolated original/reply/ad/error identities, publisher SDK/JSON-LD binding, CNN canonical original versus ad/foreign/live declarations, scoped cross-origin Fox frame, ads/foreign content/frame removal, blocked network candidates and cancellation; no external profiles')
}catch(error){exitCode=1;console.error(error)}finally{clearTimeout(timeout);window?.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(exitCode)}}
void run()
