import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {app,BrowserWindow,session} from 'electron'
import {BrowserKernel} from '@bmw-agent/browser-capability/kernel'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {readVideoTargets} from '../packages/browser-capability/src/video-target.js'
import {MediaController} from '@bmw-agent/media-native'
import {mediaRecord} from '@bmw-agent/media-native/contract'
import {GlobalSettingsStore,configureNetworkStartup} from '../packages/platform/src/global-settings-store.js'
import {browserCompatibleUserAgent} from '../packages/platform/src/browser-user-agent.js'
import {bmwProduct} from '../packages/product-bmw/index.js'

if(process.env.BMW_YOUTUBE_NAVIGATION_CASE!=='1')throw new Error('Explicit BMW_YOUTUBE_NAVIGATION_CASE=1 required for public YouTube validation.')
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-youtube-navigation-'))),output=path.resolve(process.env.BMW_VALIDATION_DIR??'.bmw-runtime/youtube-navigation-'+Date.now()),project={id:'youtube-navigation',name:'Disposable public YouTube validation',directory:path.join(output,'project')},artifacts=path.join(project.directory,'artifacts')
if(fs.existsSync(project.directory))throw new Error('Use a fresh validation directory; previous media must not be overwritten.')
fs.mkdirSync(artifacts,{recursive:true});app.setPath('userData',path.join(root,'profile'))
const settingsFile=path.join(root,'settings.json'),settings=new GlobalSettingsStore({filePath:settingsFile,onState:undefined})
settings.update({http1Compatibility:process.env.BMW_YOUTUBE_HTTP1==='1'})
const http1Compatibility=configureNetworkStartup(settingsFile,name=>app.commandLine.appendSwitch(name))
app.userAgentFallback=browserCompatibleUserAgent(app.userAgentFallback);app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
const samples=['jNQXAC9IVRw','zHBrUVyQJWc','a9LDPn-MO4I'],results:Record<string,unknown>[]=[],startedAt=new Date().toISOString(),started=performance.now(),controller=new AbortController()
const sources=['packages/browser-capability/src/browser-kernel.ts','packages/browser-capability/src/page-navigation.ts','packages/browser-capability/src/video-target.ts','packages/browser-capability/src/youtube-sabr-observation.ts','packages/media-native/src/youtube-sabr.ts','packages/media-native/src/youtube-sabr-response.ts','packages/media-native/src/youtube-sabr-worker.ts','packages/platform/src/global-settings-store.ts','scripts/youtube-navigation-case.ts'].flatMap(file=>[file,file.replace(/\.ts$/,'.js')])
const sourceSha256=Object.fromEntries(sources.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))
const safe=(error:unknown)=>String(error).replace(/https?:\/\/\S+/g,'[delivery]').slice(0,700)
const address=(value:unknown)=>{try{const u=new URL(String(value));return u.origin+u.pathname}catch{return '[unavailable]'}}
const log=(stage:string,value:Record<string,unknown>={})=>fs.appendFileSync(path.join(output,'stages.jsonl'),JSON.stringify({at:new Date().toISOString(),ms:Math.round(performance.now()-started),stage,...value})+'\n')
const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({startedAt,environment:{profile:'disposable signed-out',mockKeychain:process.platform==='darwin',http1Compatibility,modelCalls:0,externalDownloader:false},sourceSha256,sourceUnchanged:sources.every(file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===sourceSha256[file]),results},null,2)+'\n')
async function phase<T>(name:string,job:()=>Promise<T>):Promise<T>{const before=performance.now();log(name+':start');try{const result=await job();log(name+':end',{elapsedMs:Math.round(performance.now()-before)});return result}catch(error){log(name+':failed',{elapsedMs:Math.round(performance.now()-before),error:safe(error)});throw error}}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
let window:BrowserWindow|undefined,kernel:BrowserKernel|undefined,media:MediaController|undefined
let hardStop:ReturnType<typeof setTimeout>|undefined
app.on('login',(event,_wc,_details,auth,callback)=>{event.preventDefault();log('authentication-denied',{isProxy:auth.isProxy});callback()})
app.on('certificate-error',(_event,_wc,_url,error)=>log('certificate-error',{error}))
const watchdog=setTimeout(()=>{log('case-deadline');controller.abort(new Error('YouTube case deadline'));hardStop=setTimeout(()=>{save();app.exit(2)},10000)},12*60*1000)
async function run(){
 await phase('app-ready',()=>app.whenReady());const pages=session.fromPartition('youtube-navigation-'+crypto.randomUUID());log('session-created')
 pages.setUserAgent(app.userAgentFallback);pages.setPermissionRequestHandler((_wc,_p,done)=>done(false));pages.on('will-download',event=>event.preventDefault())
 await phase('proxy-config',async()=>{if(process.env.HTTPS_PROXY)await pages.setProxy({mode:'fixed_servers',proxyRules:process.env.HTTPS_PROXY,proxyBypassRules:'<local>'})});log('proxy-configured',{explicitProxy:!!process.env.HTTPS_PROXY})
 window=new BrowserWindow({show:true,width:1200,height:850,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
 kernel=new BrowserKernel({window,session:pages,pageTheme:'dark',permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project,updateTabState:()=>{}},sessionContinuity:undefined,settingsStore:undefined,capabilityRegistry:new BrowserCapabilityRegistry(bmwProduct),allowedActions:undefined,artifactsDirectory:artifacts,onState:()=>{}});kernel.setBounds({x:0,y:0,width:1200,height:800})
 media=new MediaController({session:pages,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:()=>{}});kernel.setRecordingController(media)
 for(const id of samples){
  controller.signal.throwIfAborted();const row:Record<string,unknown>={id,url:'https://www.youtube.com/watch?v='+id,startedAt:new Date().toISOString()},before=performance.now(),oldFiles=new Set(fs.readdirSync(artifacts));results.push(row);save();let tabId:string|undefined
  try{
   const tab=await phase(id+':blank',()=>kernel!.openTab({url:'about:blank',foreground:true,source:'agent',reuse:false},controller.signal));tabId=tab.id;const wc=kernel.requireTab(tab.id).view.webContents
   // The Host owns the debugger. Observe its enabled events without awaiting
   // Network.enable on an uninitialized renderer or replacing its request hook.
   wc.debugger.on('message',(_event,method,raw)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))return;const p=raw as Record<string,unknown>;if(method==='Network.responseReceived'&&['Document','Script'].includes(String(p.type))&&p.response&&typeof p.response==='object'&&!Array.isArray(p.response)){const response=p.response as Record<string,unknown>;log(id+':resource-response',{type:p.type,status:response.status,protocol:response.protocol,url:address(response.url)})}if(method==='Network.loadingFailed')log(id+':resource-failed',{type:p.type,error:p.errorText,canceled:p.canceled})})
   const navigationAt=performance.now();await phase(id+':navigate',()=>kernel!.execute({action:'navigate',tabId:tab.id,url:String(row.url)},{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(100000)])}));row.navigationMs=Math.round(performance.now()-navigationAt)
   const state=await readVideoTargets(wc,{},controller.signal),target=state.targets.length===1?state.targets[0]:undefined,resource=target?.resources.find(r=>r.role==='sabr')
   if(state.blocked||!target||!resource)throw new Error('YOUTUBE_TARGET_UNAVAILABLE: No uniquely bound native SABR player.')
   row.title=await wc.mainFrame.executeJavaScript('document.title');row.videoIdentity=target.identity;row.advertisedSeconds=target.durationSeconds
   await phase(id+':native-playback-warmup',async()=>{await wc.mainFrame.executeJavaScript("(()=>{const v=document.querySelector('#movie_player video');v.muted=true;void v.play().catch(()=>{});return true})()",true);await sleep(7000);await wc.mainFrame.executeJavaScript("document.querySelector('#movie_player video').pause();true",true)})
   await wc.mainFrame.executeJavaScript("(()=>{const u=new URL(location.href);u.searchParams.set('themeRefresh','navigation-case');history.replaceState(history.state,'',u);return true})()",true)
   const transferAt=performance.now(),raw=mediaRecord(await phase(id+':preserve',()=>kernel!.preserveSource({tabId:tab.id,url:resource.url,pageUrl:state.pageUrl,sourceGuard:{pageUrl:state.pageUrl,candidateUrl:resource.url,videoIdentity:target.identity,scope:{selector:'#movie_player',index:0,excludeSelectors:[],characterUnit:'utf16',extraction:'visible-text-nodes',status:'observed',truncated:false}}},AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]))))
   row.transferMs=Math.round(performance.now()-transferAt);row.artifactId=raw.artifactId;row.bytes=raw.bytes;row.preservation=raw.preservation;save()
   row.decode=await phase(id+':decode',()=>media!.processArtifact({action:'media.decode.check',artifactId:raw.artifactId},controller.signal));row.inspection=await media.processArtifact({action:'media.inspect',artifactId:raw.artifactId},controller.signal)
   const decoded=mediaRecord(row.decode),tracks=Array.isArray(decoded.tracks)?decoded.tracks:[]
   if(decoded.completeFile!==true||!['video','audio'].every(type=>tracks.some(track=>mediaRecord(track).type===type))||mediaRecord(raw.videoIdentity).targetId!==id)throw new Error('Delivered original identity and both complete decoded tracks are required.')
   const duration=Number(mediaRecord(row.inspection).durationSeconds);row.frames=await media.processArtifact({action:'media.frames.sample',artifactId:raw.artifactId,timestampsSeconds:[0,duration/2,Math.max(0,duration-.2)],maxWidth:640,maxHeight:360},controller.signal)
   row.ok=true;row.humanListening='not performed';console.log('PASS',id,row.navigationMs,row.transferMs,row.bytes)
  }catch(error){row.ok=false;row.error=safe(error);row.newFilesAfterFailure=fs.readdirSync(artifacts).filter(file=>!oldFiles.has(file));console.log('FAIL',id,row.error)}
  finally{row.totalMs=Math.round(performance.now()-before);if(tabId){row.navigationDiagnostics=kernel.diagnosticsFor(tabId).network.filter((event:{type?:string})=>event.type==='navigation'||event.type==='navigation-start');await kernel.closeTab(tabId).catch(error=>{row.cleanupError=safe(error)})}save()}
 }
}
log('entry',{http1Compatibility})
const emergency=(error:unknown)=>{log('uncaught-error',{error:safe(error)});controller.abort(error);hardStop??=setTimeout(()=>{save();window?.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(1)},10000)}
process.on('uncaughtException',emergency);process.on('unhandledRejection',emergency)
run().catch(error=>{log('fatal',{error:safe(error)});results.push({fatal:safe(error)});save()}).finally(async()=>{clearTimeout(watchdog);await media?.stop().catch(error=>log('cleanup-error',{error:safe(error)}));if(kernel)for(const id of [...kernel.tabs.keys()])await kernel.closeTab(id).catch(error=>log('cleanup-error',{error:safe(error)}));window?.destroy();fs.rmSync(root,{recursive:true,force:true});log('cleanup-complete');save();if(hardStop)clearTimeout(hardStop);app.exit(results.length===samples.length&&results.every(r=>r.ok===true)?0:1)})
