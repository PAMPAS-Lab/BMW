import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {app,BrowserWindow,session} from 'electron'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {mediaRecord} from '../packages/media-native/src/media-contract.js'
import {readVideoTargets} from '../packages/browser-capability/src/video-target.js'
import {bmwProduct} from '../packages/product-bmw/index.js'
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-acquire-native-'))),project={id:'acquire-native',name:'Disposable acquisition fixture',directory:path.join(root,'project')},artifacts=path.join(project.directory,'artifacts')
fs.mkdirSync(artifacts,{recursive:true});app.setPath('userData',path.join(root,'profile'));app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
let bytes:Buffer=Buffer.alloc(0),denyDelivery=false,deliveryRequests=0,window:BrowserWindow|undefined,kernel:BrowserKernel|undefined,media:MediaController|undefined
const server=createServer((req,res)=>{
 if(req.url==='/clip.mp4'){
  if(!req.headers.range){deliveryRequests++;if(denyDelivery){res.writeHead(403);res.end();return}}
  const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(bytes.length-1,Number(range[2])):bytes.length-1
  res.writeHead(range?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${bytes.length}`}:{})});res.end(bytes.subarray(start,end+1));return
 }
 res.writeHead(200,{'content-type':'text/html'});res.end(req.url==='/lazy'?'<title>Lazy official MP4 fixture</title><video id="source" preload="none" controls style="width:640px;height:360px"><source src="/clip.mp4" type="video/mp4"></video>':'<title>Native acquisition fixture</title><video id="source" src="/clip.mp4" preload="auto" controls style="width:640px;height:360px"></video>')
})
async function run(){
 await app.whenReady();const pages=session.fromPartition('acquire-native-'+process.pid)
 window=new BrowserWindow({show:true,width:900,height:650,webPreferences:{session:pages,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
 await window.loadFile(path.resolve('packages/media-native/src/media/media.html'))
 // Encode deterministic frames/PCM directly. Fixture construction must not
 // depend on desktop presentation or Canvas captureStream delivering frames.
 bytes=Buffer.from(await window.webContents.executeJavaScript(`(async()=>{const {Output,Mp4OutputFormat,BufferTarget,CanvasSource,AudioSampleSource,AudioSample}=await import('mediabunny');const c=new OffscreenCanvas(1280,720),x=c.getContext('2d',{alpha:false}),target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target}),video=new CanvasSource(c,{codec:'avc',bitrate:2000000}),audio=new AudioSampleSource({codec:'aac',bitrate:128000});output.addVideoTrack(video,{frameRate:25});output.addAudioTrack(audio);await output.start();for(let n=0;n<55;n++){x.fillStyle=n%2?'red':'blue';x.fillRect(0,0,1280,720);await video.add(n/25,1/25)}video.close();for(let n=0;n<110;n++){const pcm=new Float32Array(960*2);for(let i=0;i<960;i++)pcm[i]=pcm[960+i]=.1*Math.sin((n*960+i)/48000*440*Math.PI*2);const sample=new AudioSample({data:pcm,format:'f32-planar',numberOfChannels:2,sampleRate:48000,timestamp:n*.02});await audio.add(sample);sample.close()}audio.close();await output.finalize();return [...new Uint8Array(target.buffer)]})()`,true) as number[])
 assert.ok(bytes.length>1000,'Encoded fixture must contain actual frames and PCM')
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const url='http://127.0.0.1:'+address.port
 kernel=new BrowserKernel({window,session:pages,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project,updateTabState:()=>{}},capabilityRegistry:new BrowserCapabilityRegistry(bmwProduct),artifactsDirectory:artifacts,onState:()=>{},settingsStore:undefined,sessionContinuity:undefined,allowedActions:undefined});kernel.setBounds({x:0,y:0,width:900,height:600})
 media=new MediaController({session:pages,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:()=>{}});kernel.setRecordingController(media)
 fs.writeFileSync(path.join(artifacts,'fixture.mp4'),bytes)
 const tab=await kernel.openTab({url,foreground:true,reuse:false}),wc=kernel.requireTab(tab.id).view.webContents
 await wc.mainFrame.executeJavaScript(`new Promise(resolve=>{const v=document.querySelector('video');if(v.readyState>=3)resolve(true);else v.addEventListener('canplay',()=>resolve(true),{once:true})})`,true)
 const state=await readVideoTargets(wc,{selector:'#source',index:0}),target=state.targets[0];assert.ok(target&&!state.blocked)
 const request={sourceGuard:{pageUrl:state.pageUrl,candidateUrl:url+'/clip.mp4',videoIdentity:target.identity,scope:{selector:'#source',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const}},videoSelector:'#source',filename:'fixture',fromStart:true,maxDurationMs:10000,tabId:tab.id}
 const original=mediaRecord(await kernel.acquireSource(request,AbortSignal.timeout(20000)));assert.equal(original.method,'preserve');assert.equal(mediaRecord(original.acquisition).reencoded,false);assert.equal(deliveryRequests,1)
 denyDelivery=true;kernel.setBrowserVisible(false)
 const acquired=mediaRecord(await kernel.acquireSource(request,AbortSignal.timeout(25000))),raw=mediaRecord(acquired.result),capture=mediaRecord(raw.capture);assert.equal(acquired.method,'capture');assert.equal(capture.stopReason,'ended');assert.ok(Number(capture.sourceStartSeconds)<.1);assert.ok(Number(capture.sourceEndSeconds)>2)
 assert.equal(mediaRecord((mediaRecord(acquired.acquisition).attempts as unknown[])[0]).reason,'HTTP_403');assert.equal(media.isCaptureActive(),false);kernel.setBrowserVisible(true)
 const decoded=mediaRecord(await media.processArtifact({action:'media.decode.check',artifactId:raw.artifactId})),info=mediaRecord(await media.processArtifact({action:'media.inspect',artifactId:raw.artifactId})),tracks=info.tracks as Record<string,unknown>[]
 assert.equal(decoded.completeFile,true);assert.deepEqual(tracks.map(t=>t.type).sort(),['audio','video']);assert.equal(tracks.find(t=>t.type==='video')?.width,1280)
 assert.ok(Number(info.durationSeconds)<3,'Prebuffering must not record a long blank warmup')
 assert.equal(await wc.mainFrame.executeJavaScript('document.querySelector("video").paused'),true)
 const lazyTab=await kernel.openTab({url:url+'/lazy',foreground:true,reuse:false}),lazyWc=kernel.requireTab(lazyTab.id).view.webContents
 assert.equal(await lazyWc.mainFrame.executeJavaScript('document.querySelector("video").readyState'),0,'preload=none must begin without decoded tracks')
 const lazyState=await readVideoTargets(lazyWc,{selector:'#source',index:0}),lazyTarget=lazyState.targets[0];assert.ok(lazyTarget)
 const lazyCaptured=mediaRecord(await kernel.captureSource({...request,tabId:lazyTab.id,fromStart:true,maxDurationMs:1000,sourceGuard:{...request.sourceGuard,pageUrl:lazyState.pageUrl,videoIdentity:lazyTarget.identity}},AbortSignal.timeout(20000)))
 const lazyInfo=mediaRecord(await media.processArtifact({action:'media.inspect',artifactId:lazyCaptured.artifactId}))
 assert.ok(Number(lazyInfo.durationSeconds)>.5,'Lazy playback must yield actual frames, not just a successful container')
 assert.equal(await lazyWc.mainFrame.executeJavaScript('document.querySelector("video").preload'),'none','Native warmup must restore preload policy')
 assert.equal(await lazyWc.mainFrame.executeJavaScript('document.querySelector("video").paused'),true)
 assert.equal(media.isCaptureActive(),false);await kernel.closeTab(lazyTab.id)
 // Simulate a player replacing its delivery during native warmup. The
 // original identity guard must reject capture, but cleanup must still pause
 // the scoped player and preserve that error rather than quarantine it.
 await wc.mainFrame.executeJavaScript(`(()=>{const v=document.querySelector('video');v.play=function(){delete this.play;this.src=${JSON.stringify(url+'/clip.mp4?identity-change=1')};return HTMLMediaElement.prototype.play.call(this)}})()`,true)
 await assert.rejects(kernel.acquireSource(request,AbortSignal.timeout(15000)),error=>{assert.ok(error instanceof Error);assert.match(error.message,/VIDEO_IDENTITY_(?:UNBOUND|CHANGED)/);assert.doesNotMatch(error.message,/MEDIA_CAPTURE_CLEANUP_FAILED/);assert.match(error.message,/Download attempts: muxed:HTTP_403/);return true})
 assert.equal(await wc.mainFrame.executeJavaScript('document.querySelector("video").paused'),true)
 assert.equal(kernel.busy,false,'Identity rejection after warmup must drain the actual player without granting capture')
 denyDelivery=false
 await wc.mainFrame.executeJavaScript(`new Promise((resolve,reject)=>{const v=document.querySelector('video');v.addEventListener('canplay',()=>resolve(true),{once:true});v.addEventListener('error',()=>reject(new Error('Fixture restore failed')),{once:true});v.src=${JSON.stringify(url+'/clip.mp4')};v.load()})`,true)
 denyDelivery=true
 await wc.mainFrame.executeJavaScript(`document.querySelector('video').pause=()=>{throw new Error('Fixture refusing prepared pause')}`,true)
 await assert.rejects(kernel.acquireSource(request,AbortSignal.timeout(15000)),/MEDIA_CAPTURE_CLEANUP_FAILED/)
 assert.equal(kernel.busy,true,'Failed playback cleanup must quarantine browser admission')
 await assert.rejects(kernel.execute({action:'media.inspect',artifactId:raw.artifactId}),/QUARANTINED/)
 await kernel.execute({action:'tabs.close',tabId:tab.id});assert.equal(kernel.busy,false,'Only actual page destruction releases failed preparation cleanup')
 console.log('Native acquisition passed: original encoded preservation; HTTP 403 -> drained cleanup -> buffered 720p/stereo complete capture; paused restoration; bounded duration; changed identity aborts capture but drains playback; failed pause quarantines until explicit page close.')
}
const watchdog=setTimeout(()=>{console.error('Acquisition smoke exceeded 60 seconds');app.exit(1)},60000)
run().then(async()=>{clearTimeout(watchdog);await media?.stop();if(kernel)for(const id of [...kernel.tabs.keys()])await kernel.closeTab(id);server.close();window?.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(0)}).catch(async error=>{console.error(error);clearTimeout(watchdog);await media?.stop().catch(()=>{});server.close();window?.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(1)})
