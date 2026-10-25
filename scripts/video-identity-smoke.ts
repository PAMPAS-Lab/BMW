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
 isolated.protocol.handle('https',()=>new Response('<html><style>video{width:320px;height:180px}</style><body></body></html>',{headers:{'content-type':'text/html'}}))
 window=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});const wc=window.webContents
 await window.loadURL('https://x.com/author/status/123')
 await wc.executeJavaScript(`(()=>{document.body.innerHTML='<article data-testid="tweet" id="original"><a href="/author/status/123"><time>Today</time></a><video poster="https://pbs.twimg.com/amplify_video_thumb/456/img/a.jpg"></video></article><article data-testid="tweet" id="reply"><a href="/reply/status/999"><time>Today</time></a><video poster="https://pbs.twimg.com/amplify_video_thumb/999/img/a.jpg"></video></article>';for(const v of document.querySelectorAll('video'))Object.defineProperty(v,'currentSrc',{configurable:true,value:'blob:https://x.com/'+v.parentElement.id})})()`)
 const correct='https://video.twimg.com/amplify_video/456/pl/master.m3u8',reply='https://video.twimg.com/amplify_video/999/pl/master.m3u8',animation='https://abs.twimg.com/playback1.mp4'
 const state=await readVideoTargets(wc);assert.equal(state.targets.length,1);assert.equal(selectVideoResource(state,correct).identity.targetId,'123')
 const tab={id:'fixture',view:{webContents:wc}},kernel={serializeTab:()=>({id:'fixture'}),diagnosticsFor:()=>({media:[{url:reply,mimeType:'application/vnd.apple.mpegurl'},{url:correct,mimeType:'application/vnd.apple.mpegurl'},{url:animation,mimeType:'video/mp4'}]})}
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
 await window.loadURL('https://www.youtube.com/watch?v=target')
 const video='https://r1.googlevideo.com/videoplayback?itag=137&source=youtube',audio='https://r1.googlevideo.com/videoplayback?itag=140&source=youtube'
 await wc.executeJavaScript(`(()=>{document.body.innerHTML='<div id="movie_player"><video></video></div>';const p=document.querySelector('#movie_player'),v=p.querySelector('video');Object.defineProperty(v,'duration',{value:10});Object.defineProperty(v,'currentSrc',{value:'blob:https://www.youtube.com/player'});p.getVideoData=()=>({video_id:'target'});p.getPlayerResponse=()=>({playabilityStatus:{status:'OK'},videoDetails:{videoId:'target',lengthSeconds:'10'},streamingData:{adaptiveFormats:[{url:${JSON.stringify(video)},mimeType:'video/mp4',approxDurationMs:'10000'},{url:${JSON.stringify(audio)},mimeType:'audio/mp4',approxDurationMs:'10000',audioTrack:{id:'en',audioIsDefault:true}}]}})})()`)
 const yt=await prepareVideoTransfer(wc,video);assert.equal(yt.audio?.url,audio);assert.equal(yt.videoIdentity?.targetId,'target')
 await wc.executeJavaScript("document.querySelector('#movie_player').classList.add('ad-interrupting')");await assert.rejects(yt.finish(),/CHANGED|UNAVAILABLE/)
 await wc.executeJavaScript("document.querySelector('#movie_player').classList.remove('ad-interrupting');const p=document.querySelector('#movie_player'),original=p.getPlayerResponse;p.getPlayerResponse=()=>{const r=original();r.streamingData.adaptiveFormats=r.streamingData.adaptiveFormats.map(f=>({...f,url:f.url+'&rotated=1'}));return r};true")
 const rotated=await readVideoTargets(wc)
 assert.equal(selectVideoCaptureTarget(rotated,video,yt.videoIdentity).identity.targetId,'target')
 await assert.rejects(prepareVideoTransfer(wc,video),/UNBOUND/)
 const sourceGuard:SourceCaptureGuard={pageUrl:rotated.pageUrl,candidateUrl:video,videoIdentity:yt.videoIdentity,scope:{selector:'#movie_player',index:0,excludeSelectors:[],characterUnit:'utf16',extraction:'visible-text-nodes',truncated:false,status:'observed'}}
 let preserved=0
 const host={requireTab:()=>({id:'yt-source',view:{webContents:wc}}),projectStore:{active:()=>({id:'fixture'})},recordingController:{isCaptureActive:()=>false},
  verifySourceVideo:(request:SourceCaptureGuard&{tabId?:string},signal?:AbortSignal)=>BrowserKernel.prototype.verifySourceVideo.call(host as unknown as BrowserKernel,request,signal),
  preserveSource:async(request:{url:string})=>{assert.equal(request.url,video+'&rotated=1');preserved++;return {artifactId:'fixture-preserved'}},captureSource:async()=>{throw new Error('Unexpected capture after successful preservation')}}
 assert.equal((await host.verifySourceVideo(sourceGuard)).targetId,'target','Final source identity survives delivery rotation')
 const freshDelivery=await BrowserKernel.prototype.acquireSource.call(host as unknown as BrowserKernel,{sourceGuard,videoSelector:'video',filename:'fixture'},new AbortController().signal)
 assert.equal(freshDelivery.method,'preserve');assert.equal(preserved,1,'Auto begins with the fresh observed delivery of the pinned target')
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
 console.log('PASS isolated X original/reply/ad/error identity, changed-target download rollback, YouTube same-target pair/ad rejection, Weibo unique player; no external platforms/profiles')
}catch(error){exitCode=1;console.error(error)}finally{clearTimeout(timeout);window?.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(exitCode)}}
void run()
