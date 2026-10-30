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

if(process.env.BMW_YOUTUBE_WORKTAB_CASE!=='1')throw new Error('Explicit BMW_YOUTUBE_WORKTAB_CASE=1 required for public YouTube validation.')
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-youtube-worktab-live-'))),output=path.resolve(process.env.BMW_VALIDATION_DIR??'.bmw-runtime/youtube-worktab-'+Date.now()),project={id:'youtube-worktab',name:'Disposable public YouTube validation',directory:path.join(output,'project')},artifacts=path.join(project.directory,'artifacts')
if(fs.existsSync(project.directory))throw new Error('Use a fresh validation directory; previous media must not be overwritten.')
fs.mkdirSync(artifacts,{recursive:true});app.setPath('userData',path.join(root,'profile'))
const settingsFile=path.join(root,'settings.json'),settings=new GlobalSettingsStore({filePath:settingsFile,onState:undefined})
settings.update({http1Compatibility:process.env.BMW_YOUTUBE_HTTP1==='1'})
const http1Compatibility=configureNetworkStartup(settingsFile,name=>app.commandLine.appendSwitch(name))
app.userAgentFallback=browserCompatibleUserAgent(app.userAgentFallback);app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
const transferBudgetMs=Number(process.env.BMW_YOUTUBE_TRANSFER_BUDGET_MS??600000)
if(!Number.isSafeInteger(transferBudgetMs)||transferBudgetMs<60000||transferBudgetMs>2700000)throw new Error('Public validation transfer budget must be 60–2700 seconds.')
const mode=process.env.BMW_YOUTUBE_WORKTAB_MODE;if(mode!=='cold'&&mode!=='resident')throw new Error('BMW_YOUTUBE_WORKTAB_MODE=cold|resident required.');
const samples=['jNQXAC9IVRw','zHBrUVyQJWc','a9LDPn-MO4I'],results:Record<string,unknown>[]=[],startedAt=new Date().toISOString(),started=performance.now(),controller=new AbortController()
const sources=['packages/browser-capability/src/browser-kernel.ts','packages/browser-capability/src/page-navigation.ts','packages/browser-capability/src/video-target.ts','packages/browser-capability/src/youtube-sabr-observation.ts','packages/media-native/src/youtube-sabr.ts','packages/media-native/src/youtube-sabr-response.ts','packages/media-native/src/youtube-sabr-worker.ts','packages/platform/src/global-settings-store.ts','packages/browser-capability/src/youtube-worktabs.ts','packages/browser-capability/src/youtube-switch.ts','packages/browser-capability/src/video-capture-ready.ts','packages/browser-capability/src/browser-deadline.ts','scripts/youtube-worktab-case.ts'].flatMap(file=>[file,file.replace(/\.ts$/,'.js')])
const sourceSha256=Object.fromEntries(sources.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))
const safe=(error:unknown)=>String(error).replace(/https?:\/\/\S+/g,'[delivery]').slice(0,700)
const log=(stage:string,value:Record<string,unknown>={})=>fs.appendFileSync(path.join(output,'stages.jsonl'),JSON.stringify({at:new Date().toISOString(),ms:Math.round(performance.now()-started),stage,...value})+'\n')
const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({startedAt,environment:{profile:'disposable signed-out',mockKeychain:process.platform==='darwin',mode,http1Compatibility,transferBudgetMs,modelCalls:0,externalDownloader:false},sourceSha256,sourceUnchanged:sources.every(file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===sourceSha256[file]),results},null,2)+'\n')
async function phase<T>(name:string,job:()=>Promise<T>):Promise<T>{const before=performance.now();log(name+':start');try{const result=await job();log(name+':end',{elapsedMs:Math.round(performance.now()-before)});return result}catch(error){log(name+':failed',{elapsedMs:Math.round(performance.now()-before),error:safe(error)});throw error}}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
let window:BrowserWindow|undefined,kernel:BrowserKernel|undefined,media:MediaController|undefined
let hardStop:ReturnType<typeof setTimeout>|undefined
app.on('login',(event,_wc,_details,auth,callback)=>{event.preventDefault();log('authentication-denied',{isProxy:auth.isProxy});callback()})
app.on('certificate-error',(_event,_wc,_url,error)=>log('certificate-error',{error}))
const watchdog=setTimeout(()=>{log('case-deadline');controller.abort(new Error('YouTube case deadline'));hardStop=setTimeout(()=>{save();app.exit(2)},10000)},3*(transferBudgetMs+240000))
async function run(){
 await phase('app-ready',()=>app.whenReady());const pages=session.fromPartition('youtube-navigation-'+crypto.randomUUID());log('session-created')
 pages.setUserAgent(app.userAgentFallback);pages.setPermissionRequestHandler((_wc,_p,done)=>done(false));pages.on('will-download',event=>event.preventDefault())
 await phase('proxy-config',async()=>{if(process.env.HTTPS_PROXY)await pages.setProxy({mode:'fixed_servers',proxyRules:process.env.HTTPS_PROXY,proxyBypassRules:'<local>'})});log('proxy-configured',{explicitProxy:!!process.env.HTTPS_PROXY})
 window=new BrowserWindow({show:true,width:1200,height:850,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
 kernel=new BrowserKernel({window,session:pages,youtubeWorktabsEnabled:mode==='resident',pageTheme:'dark',permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project,updateTabState:()=>{}},sessionContinuity:undefined,settingsStore:undefined,capabilityRegistry:new BrowserCapabilityRegistry(bmwProduct),allowedActions:undefined,artifactsDirectory:artifacts,onState:()=>{}});kernel.setBounds({x:0,y:0,width:1200,height:800})
 media=new MediaController({session:pages,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:()=>{}});kernel.setRecordingController(media)
 // Measure the actual Host guard without bypassing any identity/CPN/config
 // checks. Only counts and elapsed times are persisted, never page responses.
 const preserve=media.preserveMedia.bind(media)
 media.preserveMedia=async input=>{let calls=0,totalMs=0,maxMs=0;const guard=input.guard,at=performance.now(),timer=setInterval(()=>log('preservation-progress',{elapsedMs:Math.round(performance.now()-at),guardCalls:calls,guardMs:Math.round(totalMs),maxGuardMs:Math.round(maxMs)}),10000)
  try{return await preserve({...input,...(guard?{guard:async force=>{const before=performance.now();try{await guard(force)}finally{const ms=performance.now()-before;calls++;totalMs+=ms;maxMs=Math.max(maxMs,ms)}}}:{})})}
  finally{clearInterval(timer);log('preservation-guard-summary',{elapsedMs:Math.round(performance.now()-at),guardCalls:calls,guardMs:Math.round(totalMs),maxGuardMs:Math.round(maxMs)})}}
 for(const id of samples){
  controller.signal.throwIfAborted();const row:Record<string,unknown>={id,url:'https://www.youtube.com/watch?v='+id,startedAt:new Date().toISOString()},before=performance.now(),oldFiles=new Set(fs.readdirSync(artifacts));results.push(row);save();let tabId:string|undefined
  try{
   const navigationAt=performance.now();log(id+':navigation:start');await kernel.withYoutubeWorkTab(String(row.url),async tab=>{
   tabId=tab.id;const wc=kernel!.requireTab(tab.id).view.webContents;row.navigationMs=Math.round(performance.now()-navigationAt);row.navigation=tab.youtubeNavigation;row.tabId=tab.id;row.documentTimeOrigin=await wc.executeJavaScript('performance.timeOrigin');row.navigationOk=true
   log(id+':navigation:end',{elapsedMs:row.navigationMs,navigation:row.navigation});save()
   const initial=await readVideoTargets(wc,{},controller.signal)
   if(initial.blocked||initial.targets.length!==1||initial.targets[0]?.identity.targetId!==id)throw new Error('YOUTUBE_TARGET_UNAVAILABLE: Initial player did not match the requested target.')
   await phase(id+':native-playback-warmup',async()=>{await wc.mainFrame.executeJavaScript("(()=>{const v=document.querySelector('#movie_player video');v.muted=true;void v.play().catch(()=>{});return true})()",true);await sleep(7000);await wc.mainFrame.executeJavaScript("document.querySelector('#movie_player video').pause();true",true)})
   const state=await readVideoTargets(wc,{},controller.signal),target=state.targets.length===1?state.targets[0]:undefined,resource=target?.resources.find(r=>r.role==='sabr')
   if(state.blocked||!target||target.identity.targetId!==id||!resource)throw new Error('YOUTUBE_TARGET_UNAVAILABLE: No uniquely bound current SABR player after warmup.')
   row.title=await wc.mainFrame.executeJavaScript('document.title');row.videoIdentity=target.identity;row.advertisedSeconds=target.durationSeconds
   const transferAt=performance.now(),raw=mediaRecord(await phase(id+':preserve',()=>kernel!.preserveSource({tabId:tab.id,url:resource.url,pageUrl:state.pageUrl,sourceGuard:{pageUrl:state.pageUrl,candidateUrl:resource.url,videoIdentity:target.identity,scope:{selector:'#movie_player',index:0,excludeSelectors:[],characterUnit:'utf16',extraction:'visible-text-nodes',status:'observed',truncated:false}}},AbortSignal.any([controller.signal,AbortSignal.timeout(transferBudgetMs)]))))
   row.transferMs=Math.round(performance.now()-transferAt);row.artifactId=raw.artifactId;row.bytes=raw.bytes;row.preservation=raw.preservation;save()
   row.decode=await phase(id+':decode',()=>media!.processArtifact({action:'media.decode.check',artifactId:raw.artifactId},controller.signal));row.inspection=await media.processArtifact({action:'media.inspect',artifactId:raw.artifactId},controller.signal)
   const decoded=mediaRecord(row.decode),tracks=Array.isArray(decoded.tracks)?decoded.tracks:[]
   if(decoded.completeFile!==true||!['video','audio'].every(type=>tracks.some(track=>mediaRecord(track).type===type))||mediaRecord(raw.videoIdentity).targetId!==id)throw new Error('Delivered original identity and both complete decoded tracks are required.')
   const duration=Number(mediaRecord(row.inspection).durationSeconds);row.frames=await media.processArtifact({action:'media.frames.sample',artifactId:raw.artifactId,timestampsSeconds:[0,duration/2,Math.max(0,duration-.2)],maxWidth:640,maxHeight:360},controller.signal)
   row.ok=true;row.humanListening='not performed';console.log('PASS',mode,id,row.navigationMs,row.transferMs,row.bytes)
   },AbortSignal.any([controller.signal,AbortSignal.timeout(300000)]))
  }catch(error){row.ok=false;row.error=safe(error);if(!row.navigationOk){row.navigationFailedMs=Math.round(performance.now()-before);if(error instanceof Error&&'youtubeNavigation'in error)row.navigationFailureDiagnostics=error.youtubeNavigation}row.newFilesAfterFailure=fs.readdirSync(artifacts).filter(file=>!oldFiles.has(file));console.log('FAIL',mode,id,row.navigationMs,row.error)}
  finally{row.totalMs=Math.round(performance.now()-before);if(tabId){row.navigationDiagnostics=kernel.diagnosticsFor(tabId).network.filter((event:{type?:string})=>['navigation','navigation-start','main-navigation','navigation-continuation','youtube-switch','youtube-bootstrap-activation','youtube-verification-playback','youtube-navigation-surface'].includes(event.type??''));if(mode==='cold')await kernel.closeTab(tabId).catch(error=>{row.cleanupError=safe(error)})}save()}
 }
}
log('entry',{mode,http1Compatibility})
const emergency=(error:unknown)=>{log('uncaught-error',{error:safe(error)});controller.abort(error);hardStop??=setTimeout(()=>{save();window?.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(1)},10000)}
process.once('SIGTERM',()=>emergency(new Error('YouTube validation explicitly cancelled by SIGTERM')));process.once('SIGINT',()=>emergency(new Error('YouTube validation explicitly cancelled by SIGINT')))
process.on('uncaughtException',emergency);process.on('unhandledRejection',emergency)
run().catch(error=>{log('fatal',{error:safe(error)});results.push({fatal:safe(error)});save()}).finally(async()=>{clearTimeout(watchdog);await media?.stop().catch(error=>log('cleanup-error',{error:safe(error)}));if(kernel)for(const id of [...kernel.tabs.keys()])await kernel.closeTab(id).catch(error=>log('cleanup-error',{error:safe(error)}));window?.destroy();fs.rmSync(root,{recursive:true,force:true});log('cleanup-complete');save();if(hardStop)clearTimeout(hardStop);app.exit(results.length===samples.length&&results.every(r=>r.ok===true)?0:1)})
