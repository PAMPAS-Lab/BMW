import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {app,BrowserWindow,session} from 'electron'
import {BrowserKernel} from '@bmw-agent/browser-capability/kernel'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {createBridgeServer} from '@bmw-agent/browser-capability/bridge'
import {MediaController} from '@bmw-agent/media-native'
import {ProjectSourceStore} from '../packages/platform/src/project-source-store.js'
import {VideoStudioStore} from '../packages/feature-video/src/studio-store.js'
import {assertStudioScene,newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import type {VideoDraft} from '../packages/feature-video/src/studio-contract.js'
import type {SourceCatalog} from '@bmw-agent/media-native/sources'
import product from '../apps/bmw/product.js'
if(process.env.BMW_SOURCE_PLATFORM_CASE!=='1')throw new Error('Set BMW_SOURCE_PLATFORM_CASE=1 to probe the documented public sources with a disposable Profile.')
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-public-sources-'))),project={id:'public-source-case',name:'Public source case',directory:path.join(root,'project')},artifacts=path.join(project.directory,'artifacts')
fs.mkdirSync(artifacts,{recursive:true});fs.mkdirSync(path.join(root,'profile'));app.setPath('userData',path.join(root,'profile'))
const proof=path.resolve('.bmw-runtime/p0-platform-sources',new Date().toISOString().replaceAll(':','-'));fs.mkdirSync(proof,{recursive:true})
const resume=process.env.BMW_SOURCE_PLATFORM_CASE_RESUME
if(resume){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/.test(resume))throw new Error('Resume requires a saved public-source case timestamp.')
 const saved=path.resolve('.bmw-runtime/p0-platform-sources',resume);if(fs.realpathSync(saved)!==saved)throw new Error('Saved public-source proof cannot be a symlink.')
 fs.mkdirSync(path.join(project.directory,'sources'));fs.copyFileSync(path.join(saved,'source-catalog.json'),path.join(project.directory,'sources/catalog.json'))
 for(const artifact of fs.readdirSync(path.join(saved,'raw-artifacts')))if(fs.lstatSync(path.join(saved,'raw-artifacts',artifact)).isFile())fs.copyFileSync(path.join(saved,'raw-artifacts',artifact),path.join(artifacts,artifact))
 fs.copyFileSync(path.join(saved,'controlled-failure.json'),path.join(proof,'controlled-failure.json'))
 saveResume()
 function saveResume(){fs.writeFileSync(path.join(proof,'resumed-from.json'),JSON.stringify({proof:saved,acquisitionTimesPreserved:true,freshPublicObservation:false},null,2)+'\n')}
}
const pages=[
 {name:'bili-video',url:'https://www.bilibili.com/video/BV1Jm421u7Tm/',bodySelector:'#viewbox_report',mediaSelector:'#bilibili-player',authorSelector:'.up-name',publishedSelector:'.pubdate-ip-text',accessSelector:'#bilibili-player'},
 {name:'bili-opus',url:'https://www.bilibili.com/opus/973229238442262544',bodySelector:'.opus-module-content',authorSelector:'.opus-module-author__name',publishedSelector:'.opus-module-author__pub__text'},
 {name:'hyperframes',url:'https://hyperframes.heygen.com/guides/product-launch-video',bodySelector:'#content-area',excludeSelectors:['nav','footer','input','button','.feedback'],mediaExcludeSelectors:['nav','footer','input','button','.feedback']},
 {name:'cap',url:'https://cap.so/docs/recording/studio-mode',bodySelector:'article',excludeSelectors:['nav','footer','button']},
 {name:'hypit',url:'https://github.com/hypit-ai/hypit/blob/main/packages/speech-alignment/README.md',bodySelector:'.markdown-body'}
]
let sourcePort:ProjectSourceStore|undefined
let failureServer:http.Server|undefined
let host:BrowserWindow|undefined,bridge:Awaited<ReturnType<typeof createBridgeServer>>|undefined,code=0
const events:unknown[]=[]
const save=(name:string,value:unknown)=>fs.writeFileSync(path.join(proof,name),JSON.stringify(value,null,2)+'\n')
const watchdog=setTimeout(()=>{console.error('Public source case exceeded 9 minutes');app.exit(1)},540000)
async function run(){try{
 await app.whenReady();const isolated=session.fromPartition('public-sources-'+process.pid)
 if(process.env.HTTPS_PROXY)await isolated.setProxy({proxyRules:process.env.HTTPS_PROXY})
 host=new BrowserWindow({show:true,width:1280,height:820,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await host.loadURL('data:text/html,<title>Public sources disposable probe</title>')
 const sources=new ProjectSourceStore(project.directory,project.id);sourcePort=sources;const registry=new BrowserCapabilityRegistry(product),media=new MediaController({session:isolated,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:undefined})
 const kernel=new BrowserKernel({window:host,session:isolated,capabilityRegistry:registry,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project,updateTabState:()=>{}},artifactsDirectory:artifacts,sessionContinuity:undefined,settingsStore:undefined,allowedActions:registry.allowedActions,onState:undefined});kernel.setBounds({x:0,y:0,width:1180,height:760});kernel.setRecordingController(media);kernel.projectSources=()=>sources
 bridge=await createBridgeServer(kernel,{toolDefinition:registry.toolDefinition(),resolveProject:directory=>directory===project.directory?project:undefined,activeProjectId:()=>project.id});const headers={authorization:'Bearer '+bridge.token,'content-type':'application/json'},binding=bridge.registerSession('public-source-session',project.directory)
 const call=async(args:unknown)=>{const response=await fetch(bridge!.url+'/execute',{method:'POST',headers,body:JSON.stringify({binding,arguments:args})}),value=await response.json() as {result:unknown;error?:string};events.push({at:new Date().toISOString(),args,result:value.result,error:value.error??null});save('browser-actions.json',events);if(!response.ok)throw new Error(value.error);return value.result}
 const source=async(request:unknown)=>call({action:'video.studio',studioRequest:{operation:'source',sourceRequest:request}})
 const results:unknown[]=[],collectedSources=new Map<string,{sourceId:string;acquisitionId:string;tabId:string}>()
 if(resume)for(const entry of pages){const record=sources.snapshot().sources.find(record=>record.url===entry.url),acquisition=record?.acquisitions.at(-1);if(record&&acquisition)collectedSources.set(entry.name,{sourceId:record.id,acquisitionId:acquisition.id,tabId:'saved-evidence'})}
 for(const entry of resume?[]:pages){
  console.log('PUBLIC SOURCE '+entry.name)
  let tabId:string|undefined
  try{
   const tab=await call({action:'tabs.open',url:entry.url,foreground:true,reuse:false}) as {id:string};tabId=tab.id
   const wc=kernel.requireTab(tab.id).view.webContents
   await new Promise(resolve=>setTimeout(resolve,2500))
   const diagnostic=await wc.executeJavaScript(`(()=>({url:location.href,title:document.title,scopes:[...document.querySelectorAll('article,main,#content-area,#viewbox_report,#bilibili-player,pre,[class*="opus-module"],[class*="pubdate"],[class*="up-name"]')].slice(0,36).map(element=>({tag:element.tagName,id:element.id,className:element.className,text:element.textContent.slice(0,200),width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height})),videos:[...document.querySelectorAll('video')].slice(0,8).map(video=>({src:video.currentSrc,duration:Number.isFinite(video.duration)?video.duration:null,readyState:video.readyState})),bodyExcerpt:(document.body?.innerText??'').slice(0,1600)}))()`,true)
   save(entry.name+'-diagnostic.json',diagnostic)
   const {name,url,...selection}=entry
   const collected=await source({operation:'collect',expectedRevision:sources.snapshot().revision,tabId:tab.id,...selection}) as {sourceId:string;acquisitionId:string;catalog:SourceCatalog}
   collectedSources.set(entry.name,{sourceId:collected.sourceId,acquisitionId:collected.acquisitionId,tabId:tab.id})
   const body=await sources.readBody(collected.sourceId,collected.acquisitionId);save(entry.name+'-source.json',body)
   assert.equal(body.source.url,new URL(entry.url).href)
   if(body.acquisition.scope.status!=='observed')assert.equal(body.text,'','Missing scoped body cannot fall back to navigation/recommendations')
   results.push({name,url,tabId,sourceId:body.source.id,acquisitionId:body.acquisition.id,result:body.acquisition.result,scope:body.acquisition.scope,author:body.acquisition.author,publishedAt:body.acquisition.publishedAt,access:body.acquisition.access,textCharacters:body.text.length,candidateCount:body.acquisition.candidates.length})
  }catch(error){results.push({name:entry.name,url:entry.url,tabId,error:error instanceof Error?error.message:String(error),fullVideo:false})}
  save('results.json',{capturedAt:new Date().toISOString(),profile:'disposable',realDSHModel:false,automaticLogin:false,wholePlatformVideoProven:false,results})
 }

 // Explicit case-author confirmation of bounded candidates; discoveries are never success receipts.
 const acquisitions:unknown[]=[]
 for(const name of resume?[]:['bili-video','bili-opus']){
  const selected=collectedSources.get(name);if(!selected)continue
  const body=await sources.readBody(selected.sourceId,selected.acquisitionId),candidate=body.acquisition.candidates.find(candidate=>name==='bili-video'?candidate.kind==='video':candidate.kind==='image')
  if(!candidate){acquisitions.push({name,state:'no-confirmed-candidate'});continue}
  await source({operation:'confirm',expectedRevision:sources.snapshot().revision,sourceId:selected.sourceId,acquisitionId:selected.acquisitionId,candidateIds:[candidate.id]})
  const acquired=await source({operation:'acquire',expectedRevision:sources.snapshot().revision,sourceId:selected.sourceId,acquisitionId:selected.acquisitionId,candidateId:candidate.id,method:name==='bili-video'?'capture':'download',tabId:selected.tabId,...(name==='bili-video'?{videoSelector:'#bilibili-player',maxDurationMs:35000}:{})}) as {state:string;artifactId?:string;error?:string}
  if(name==='bili-video'&&acquired.state!=='failed')assert.equal(acquired.state,'partial-preview','Trial/max-duration must not claim whole-platform completion')
  acquisitions.push({name,confirmation:'case-author-selected',...acquired});save(name+'-acquisition.json',acquired)
 }
 if(!resume){
 failureServer=http.createServer((request,response)=>{if(request.url==='/failed.png'){response.writeHead(503,{'content-type':'text/plain'});response.end('controlled source download failure');return}response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end('<main><article id="body"><p>Controlled public source failure.</p><img src="/failed.png"></article><aside>Recommendations excluded.</aside></main>')})
 await new Promise<void>(resolve=>failureServer!.listen(0,'127.0.0.1',resolve));const failureUrl='http://127.0.0.1:'+(failureServer.address() as import('node:net').AddressInfo).port
 const failureTab=await call({action:'tabs.open',url:failureUrl,foreground:false,reuse:false}) as {id:string},failedRecord=await source({operation:'collect',expectedRevision:sources.snapshot().revision,tabId:failureTab.id,bodySelector:'#body'}) as {sourceId:string;acquisitionId:string},failureBody=await sources.readBody(failedRecord.sourceId,failedRecord.acquisitionId),candidate=failureBody.acquisition.candidates[0]
 assert.equal(failureBody.text,'Controlled public source failure.');await source({operation:'confirm',expectedRevision:sources.snapshot().revision,sourceId:failedRecord.sourceId,acquisitionId:failedRecord.acquisitionId,candidateIds:[candidate.id]})
 const controlled=await source({operation:'acquire',expectedRevision:sources.snapshot().revision,sourceId:failedRecord.sourceId,acquisitionId:failedRecord.acquisitionId,candidateId:candidate.id,method:'download',tabId:failureTab.id}) as {state:string;error:string};assert.equal(controlled.state,'failed');assert.match(controlled.error,/503/);save('controlled-failure.json',controlled)
 }
 const commentary=[
  {name:'hyperframes',title:'真实产品画面',fact:'原始录屏并非 HyperFrames 默认成片。',needle:'A raw screen recording is not the default.',narration:'第一条事实来自 HyperFrames 官方制作指南。它说明原始录屏并不是默认成片。我的判断是，操作证据和成片表达应当分开设计。',opinion:'操作证据与成片表达应分开设计。'},
  {name:'cap',title:'录制后仍可修改',fact:'Cap Studio 创建本地可编辑项目。',needle:'Studio Mode creates a local, editable Cap project.',narration:'第二条事实来自 Cap 官方文档。Studio 模式创建本地可编辑项目。我的判断是，录屏中的重点、隐私遮挡和节奏调整，需要保存为可以修改的数据。',opinion:'重点、遮挡和节奏应保留可编辑数据。'},
  {name:'hypit',title:'声学证据的边界',fact:'Hypit 对齐模块本身不读取音频或调用语音服务。',needle:'The package does not\ninvoke Python, read audio, call a speech provider',narration:'第三条事实来自 Hypit 的语音对齐模块说明。这个模块本身不运行语音识别。我的判断是，字幕时间和重点揭示必须保留证据来源，不能把估算改名为实测。',opinion:'估算时间不能冒充声学实测。'}
 ]
 const store=new VideoStudioStore(project.directory,'public-source-session');let draft=store.create('三来源点评：证据、编辑与时间');draft.width=1280;draft.height=720;draft.music=false;draft.tts={provider:'local-matcha',voice:'local-zh-en',ratePercent:0};draft.preparation.notes='技术资料点评；非当日新闻。作者意见明确标记，事件日期未知；未做人工事实核查，不推断平台全长。'
 for(const [index,item] of commentary.entries()){
  const selected=collectedSources.get(item.name);if(!selected)throw new Error('Commentary source unavailable: '+item.name)
  const body=await sources.readBody(selected.sourceId,selected.acquisitionId),start=body.text.toLowerCase().indexOf(item.needle.toLowerCase());if(start<0)throw new Error('Official source quote not found: '+item.name+' / '+item.needle)
  const quote=body.text.slice(start,start+item.needle.length),scene=newStudioScene('commentary-'+index,item.title);scene.narration=item.narration;scene.bullets=['事实：'+item.fact,'作者观点：'+item.opinion,'发表/事件时间未知；事实核查待确认'];scene.sources=[body.source.url];scene.endPolicy='hold';scene.citations=[{sourceId:body.source.id,acquisitionId:body.acquisition.id,startCharacter:start,endCharacter:start+quote.length,quote,kind:'fact',claim:item.fact,conflict:'pending',eventAt:null}];draft.scenes.push(assertStudioScene(scene))
 }
 draft=await call({action:'video.studio',studioRequest:{operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}}) as VideoDraft
 const cited=await call({action:'video.studio',studioRequest:{operation:'export-citations',draftId:draft.id,expectedRevision:draft.revision}}) as {artifactId:string;citationCount:number};assert.equal(cited.citationCount,3);fs.copyFileSync(path.join(artifacts,cited.artifactId),path.join(proof,'commentary-citations.json'))
 const spoken=await call({action:'video.studio',studioRequest:{operation:'narrate-pending',draftId:draft.id,expectedRevision:draft.revision}}) as {draft:VideoDraft};draft=spoken.draft
 const rendered=await call({action:'video.studio',studioRequest:{operation:'render',draftId:draft.id,expectedRevision:draft.revision}}) as {draft:VideoDraft;export:{artifactId:string;verificationArtifactId:string}};draft=rendered.draft
 fs.copyFileSync(path.join(artifacts,rendered.export.artifactId),path.join(proof,'three-source-commentary.mp4'));fs.copyFileSync(path.join(artifacts,rendered.export.verificationArtifactId),path.join(proof,'commentary-video-verification.json'));save('commentary-draft.json',draft);save('acquisitions.json',acquisitions)
 save('source-catalog.json',sources.snapshot());const output=path.join(proof,'raw-artifacts');fs.mkdirSync(output);for(const artifact of fs.readdirSync(artifacts))fs.copyFileSync(path.join(artifacts,artifact),path.join(output,artifact))
 console.log('Public source proof: '+proof)
}catch(error){code=1;console.error(error);save('failure.json',{error:error instanceof Error?error.message:String(error)})}finally{
 clearTimeout(watchdog);await bridge?.close();failureServer?.close();host?.destroy()
 // Preserve completed receipts and original files even when a later sample step fails.
 if(sourcePort)save('source-catalog.json',sourcePort.snapshot())
 const output=path.join(proof,'raw-artifacts');fs.mkdirSync(output,{recursive:true});for(const artifact of fs.readdirSync(artifacts))if(fs.lstatSync(path.join(artifacts,artifact)).isFile())fs.copyFileSync(path.join(artifacts,artifact),path.join(output,artifact))
 save('case-result.json',{status:code===0?'passed':'failed',profile:'disposable',automaticLogin:false,cookieExport:false,realDSHModel:false,wordAlignmentMeasured:false,proof})
 console.log('Public source proof: '+proof);fs.rmSync(root,{recursive:true,force:true});app.exit(code)
 }}
void run()
