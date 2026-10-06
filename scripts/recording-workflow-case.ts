import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {app,webContents} from 'electron'
import type {BrowserWindow,Session,WebContents} from 'electron'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {createBridgeServer} from '../packages/browser-capability/src/bridge-server.js'
import {assertBrowserFeatureHost} from '../packages/browser-capability/src/browser-host.js'
import type {MediaController} from '../packages/media-native/src/media-controller.js'
import {assertRecordingEvents} from '../packages/media-native/src/recording-contract.js'
import {focusFraming,visibleFocusIntervals} from '../packages/media-native/src/focus-contract.js'
import type {FocusInterval} from '../packages/media-native/src/focus-contract.js'
import {newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import type {VideoDraft} from '../packages/feature-video/src/studio-contract.js'
import {VideoStudioRuntime} from '../packages/feature-video/src/studio-runtime.js'
import {ipcMain} from 'electron'
import {captureRendererEvidence} from './renderer-evidence.js'
import product from '../apps/bmw/product.js'
type Rect={x:number;y:number;width:number;height:number}
type Step={id:string;task:string;before:string;after:string;click:Rect;result:Rect;pageUrl:string}
const htmlStyle=`<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#16283b;font:19px 'PingFang SC',sans-serif}header{padding:24px 70px;background:#14263a;color:white}main{width:760px;margin:24px auto}section{padding:24px;background:white;border:1px solid #ccd5df;border-radius:12px;margin:20px 0;min-height:260px}button{font:inherit;padding:14px 22px;background:#135dba;color:white;border:0;border-radius:8px;cursor:pointer}.result{padding:16px;background:#edf3fa;border-radius:8px;margin-top:16px;min-height:62px}#voice{margin-top:360px}a{color:#1d5faa}</style>`
const startPage=htmlStyle+`<title>媒体项目配置</title><header>媒体工作台 · 创建交付任务</header><main><h1>配置一条产品介绍视频</h1><section id="template"><h2>1 · 选择画面模板</h2><button id="select-template">选择横屏模板</button><div class="result" id="template-result">尚未选择模板</div></section><section id="voice"><h2>2 · 选择旁白</h2><button id="select-voice" disabled>选择本地中文旁白</button><div class="result" id="voice-result">请先选择模板</div></section><section><h2>3 · 创建交付任务</h2><button id="submit-job" disabled>提交配置并查看任务</button><div class="result" id="submit-result">模板与旁白就绪后可提交</div></section></main><script>
const config={};document.querySelector('#select-template').onclick=()=>{config.width=1280;config.height=720;document.querySelector('#template-result').textContent='横屏模板已选定 · 1280 × 720';document.querySelector('#template-result').style.background='#b6e4bf';document.querySelector('#select-voice').disabled=false;document.querySelector('#voice-result').textContent='可选择旁白方式'};
document.querySelector('#select-voice').onclick=()=>{config.voice='local-zh-en';document.querySelector('#voice-result').textContent='本地中文旁白已选定 · 不依赖在线服务';document.querySelector('#voice-result').style.background='#ffe3a7';document.querySelector('#submit-job').disabled=false;document.querySelector('#submit-result').textContent='配置已就绪，提交将建立任务清单'};
document.querySelector('#submit-job').onclick=async()=>{document.querySelector('#submit-job').disabled=true;const result=await(await fetch('/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(config)})).json();location.href='/jobs/'+result.id};</script>`
export async function runRecordingWorkflowCase(options:{window:BrowserWindow;session:Session;media:MediaController;projectDirectory:string;completion:(done:(value:unknown)=>void,fail:(error:unknown)=>void)=>void;proof:string}):Promise<void>{
 const {window:host,media}=options,project={id:'recording-workflow',name:'Three-step website',directory:options.projectDirectory},artifacts=path.join(project.directory,'artifacts'),proof=path.join(options.proof,'three-step');fs.mkdirSync(proof,{recursive:true})
 const jobs:{id:string;width:number;height:number;voice:string}[]=[],httpEvidence:{method:string;url:string;config?:unknown}[]=[]
 const server=http.createServer((request,response)=>{
  const url=request.url??'/';httpEvidence.push({method:request.method??'GET',url})
  if(request.method==='POST'&&url==='/jobs'){
   let body='';request.setEncoding('utf8');request.on('data',(chunk:string)=>{body+=chunk;if(body.length>4096)request.destroy()});request.on('end',()=>{try{const config=JSON.parse(body) as {width:number;height:number;voice:string};assert.deepEqual(config,{width:1280,height:720,voice:'local-zh-en'});const job={id:String(jobs.length+1),...config};jobs.push(job);httpEvidence.at(-1)!.config=config;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({id:job.id}))}catch{response.writeHead(400);response.end()}});return
  }
  const job=/^\/jobs\/(\d+)(\/manifest)?$/.exec(url),record=job?jobs.find(j=>j.id===job[1]):undefined
  if(job?.[2]&&record){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(record));return}
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'})
  response.end(record?htmlStyle+`<title>任务 ${record.id} 已建立</title><header>媒体工作台 · 任务结果</header><main><h1>任务 ${record.id} 已建立</h1><section id="job-result" style="background:#d2eafb"><h2>交付清单</h2><p>画面：${record.width} × ${record.height} · 横屏</p><p>旁白：本地中文 / 英文</p><p>状态：配置已提交，等待制作</p><a href="/jobs/${record.id}/manifest">查看已保存的配置清单</a></section><p>这是实际提交的配置任务，尚未宣称网站已制作视频。</p></main>`:startPage)
 })
 let bridge:Awaited<ReturnType<typeof createBridgeServer>>|undefined,runtime:VideoStudioRuntime|undefined,kernel:BrowserKernel|undefined,studio:WebContents|undefined
 const wait=async(read:()=>Promise<unknown>,label:string)=>{const until=Date.now()+20000;while(Date.now()<until){if(await read())return;await new Promise(resolve=>setTimeout(resolve,40))}throw new Error('Workflow timeout: '+label)}
 const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port
  const registry=new BrowserCapabilityRegistry(product)
  kernel=new BrowserKernel({window:host,session:options.session,capabilityRegistry:registry,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project,updateTabState:(projectId:string,state:{urls:string[];activeUrl:string|null})=>{assert.equal(projectId,project.id);assert.ok(state.urls.every(url=>url.startsWith(base+'/')));assert.ok(state.activeUrl===null||state.urls.includes(state.activeUrl))}},artifactsDirectory:artifacts,sessionContinuity:undefined,settingsStore:undefined,allowedActions:undefined,onState:undefined});kernel.setBounds({x:0,y:0,width:900,height:650});kernel.setRecordingController(media)
  bridge=await createBridgeServer(kernel,{toolDefinition:registry.toolDefinition(),resolveProject:directory=>directory===project.directory?project:undefined,activeProjectId:()=>project.id})
  const headers={authorization:'Bearer '+bridge.token,'content-type':'application/json'},binding=bridge.registerSession('recording-workflow',project.directory),actions:unknown[]=[]
  const call=async<T=Record<string,unknown>>(args:unknown):Promise<T>=>{console.log('[BMW workflow] action',JSON.stringify(args).slice(0,180));const response=await fetch(bridge!.url+'/execute',{method:'POST',headers,body:JSON.stringify({binding,arguments:args})}),value=await response.json() as {result:T;error:string};actions.push({request:args,status:response.status});if(!response.ok)throw new Error(value.error);return value.result}
  const tab=await call<{id:string}>({action:'tabs.open',url:base+'/',foreground:true,reuse:false}),page=kernel.requireTab(tab.id).view.webContents
  await wait(()=>page.executeJavaScript("!!document.querySelector('#select-template')"),'website load');host.show();app.focus({steal:true});host.focus();page.focus()
  const pending=new Promise<unknown>((resolve,reject)=>options.completion(resolve,reject));void pending.catch(()=>{})
  await call({action:'media.record.start',tabId:tab.id,fps:24});console.log('[BMW workflow] start returned');await wait(async()=>Boolean(media['recordingClock']),'recording clock');console.log('[BMW workflow] clock available');await delay(700)
  const steps:Step[]=[],clicks=['select-template','select-voice','submit-job'],results=['template-result','voice-result','job-result'],tasks=['选择横屏模板','选择本地中文旁白','提交配置并查看任务结果']
  for(const [index,id]of clicks.entries()){
   console.log('[BMW workflow] task begin',id)
   if(index>0){await page.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`);await delay(350)}
   const prior=await page.executeJavaScript(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect();return {text:document.body.innerText,rect:{x:r.x,y:r.y,width:r.width,height:r.height},width:innerWidth,height:innerHeight}})()`) as {text:string;rect:Rect;width:number;height:number}
   const x=Math.round(prior.rect.x+prior.rect.width/2),y=Math.round(prior.rect.y+prior.rect.height/2);assert.ok(x>0&&y>0&&x<prior.width&&y<prior.height)
   page.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});page.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1})
   await wait(()=>page.executeJavaScript(`!!document.getElementById(${JSON.stringify(results[index])})&&${index===2?"location.pathname.startsWith('/jobs/')":"document.getElementById("+JSON.stringify(results[index])+").textContent.includes('已选定')"}`),'task '+(index+1)+' result')
   const after=await page.executeJavaScript(`(()=>{const e=document.getElementById(${JSON.stringify(results[index])}),r=e.getBoundingClientRect();return {text:e.textContent,rect:{x:r.x,y:r.y,width:r.width,height:r.height},url:location.href}})()`) as {text:string;rect:Rect;url:string}
   console.log('[BMW workflow] task result',id,after.text);steps.push({id,task:tasks[index],before:prior.text,after:after.text,click:prior.rect,result:after.rect,pageUrl:after.url});await delay(2300)
  }
  await delay(2400);await call({action:'media.record.stop',tabId:tab.id});const recorded=await pending as {artifactId:string;eventsArtifactId:string}
  assert.equal(jobs.length,1);assert.deepEqual(jobs[0],{id:'1',width:1280,height:720,voice:'local-zh-en'})
  const trace=assertRecordingEvents(JSON.parse(fs.readFileSync(path.join(artifacts,recorded.eventsArtifactId),'utf8')),recorded.artifactId),events=trace.events.filter(e=>e.kind==='click');assert.equal(events.length,3);assert.ok(events.every(e=>e.source==='page-event'&&e.timing==='measured-frame'));assert.ok(trace.events.some(e=>e.kind==='scroll'&&e.scrollY>300));assert.ok(trace.events.some(e=>e.kind==='navigation'&&e.url===base+'/jobs/1'));assert.equal(trace.truncated,false)
  const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(artifacts,recorded.artifactId))).digest('hex')
  let draft=await call<VideoDraft>({action:'video.studio',studioRequest:{operation:'create',title:'三步网站操作与结果'}})
  const narration='先选择横屏模板，确认画面尺寸。再选择本地中文旁白。最后提交配置，进入任务结果页，查看交付清单。'
  draft.width=960;draft.height=540;draft.fps=12;draft.music=false;draft.scenes=[{...newStudioScene('workflow-scene','三步网站操作'),narration,durationSeconds:Math.ceil(trace.durationSeconds),endPolicy:'hold'}]
  draft=await call<VideoDraft>({action:'video.studio',studioRequest:{operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}})
  draft=await call<VideoDraft>({action:'video.studio',studioRequest:{operation:'attach',draftId:draft.id,expectedRevision:draft.revision,sceneId:'workflow-scene',artifactId:recorded.artifactId,assetKind:'video'}})
  draft=(await call<{draft:VideoDraft}>({action:'video.studio',studioRequest:{operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:'workflow-scene',provider:'local-matcha',voice:'local-zh-en',ratePercent:0}})).draft
  const voiceBinding=structuredClone({id:draft.scenes[0].audioArtifactId,text:draft.scenes[0].audioText,generation:draft.scenes[0].audioGeneration})
  const suggestions=await call<{focusIntervals:FocusInterval[]}>({action:'video.studio',studioRequest:{operation:'suggest-focus',draftId:draft.id,expectedRevision:draft.revision,sceneId:'workflow-scene'}});assert.equal(suggestions.focusIntervals.length,3)
  const trim=.2,rate=1.25,scene=draft.scenes[0];scene.sourceStartSeconds=trim;scene.playbackRate=rate;scene.durationSeconds=Math.ceil(Math.max((trace.durationSeconds-trim)/rate,(scene.audioDurationSeconds??0)+1)*12)/12
  // Widen the editable recommendations so button and result remain visible together.
  scene.focusIntervals=suggestions.focusIntervals.map(f=>({...f,zoom:1.08}))
  const last=scene.focusIntervals.at(-1)!,manualStart=last.endSeconds+.15;assert.ok(trace.durationSeconds-manualStart>.4)
  scene.focusIntervals.push({startSeconds:manualStart,endSeconds:trace.durationSeconds-.05,x:.5,y:.5,zoom:1.08,emphasize:false})
  draft=await call<VideoDraft>({action:'video.studio',studioRequest:{operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}})
  assert.deepEqual({id:draft.scenes[0].audioArtifactId,text:draft.scenes[0].audioText,generation:draft.scenes[0].audioGeneration},voiceBinding,'Focus/trim/rate retain narration')
  const times=events.map(e=>Math.ceil(((e.seconds+.65-trim)/rate)*4)/4);times.push(Math.ceil(((manualStart+.25-trim)/rate)*4)/4)
  const framing=times.map((time,index)=>{const crop=focusFraming(draft.scenes[0],time).crop
   const required=index<3?[steps[index].result,...(index<2?[steps[index].click]:[])]:[steps[2].result]
   for(const r of required){assert.ok(r.x/900>=crop.x-.001&&r.y/650>=crop.y-.001&&(r.x+r.width)/900<=crop.x+crop.width+.001&&(r.y+r.height)/650<=crop.y+crop.height+.001,'Focus cuts task target/result '+index+': '+JSON.stringify({r,crop}))}return {time,crop,required}})
  const raw=await media.processArtifact({action:'media.frames.sample',artifactId:recorded.artifactId,timestampsSeconds:events.map(e=>e.seconds+.65),maxWidth:900,maxHeight:650});assert.ok('frames' in raw)
  raw.frames.forEach((frame,index)=>fs.copyFileSync(path.join(artifacts,frame.artifactId),path.join(proof,'task-'+(index+1)+'-recorded-result.png')))
  runtime=new VideoStudioRuntime();runtime.configure({browserKernel:assertBrowserFeatureHost(kernel),projectStore:{active:()=>project},getMainWindow:()=>host,getShellWebContents:()=>host.webContents,getTheme:()=> 'light',setWorkspaceMode:()=>{},getCurrentSessionId:()=> 'recording-workflow',isProjectChanging:()=>false,revealAgent:()=>{},enqueueAssistant:async()=>{throw new Error('This fixture cannot submit Assistant input')},synchronizeAgentProject:async()=>({sessionId:'recording-workflow'})});runtime.installIpc(ipcMain);runtime.layout({x:0,y:0,width:1220,height:790},true);await runtime.openPanel('video-studio');studio=webContents.getAllWebContents().find(c=>c.getURL().endsWith('/studio.html'))!
  await wait(()=>studio!.executeJavaScript(`document.getElementById('draft-title').value===${JSON.stringify(draft.title)}`),'Studio loaded');await studio.executeJavaScript("document.querySelector('[data-stage=\"4\"]').click()",true)
  await wait(()=>studio!.executeJavaScript("!document.getElementById('seek').disabled&&document.getElementById('preview-status').textContent==='预览已更新'"),'Studio preview ready')
  assert.equal(await studio.executeJavaScript("document.querySelectorAll('#timeline-focus button').length"),4)
  const preview:number[][]=[]
  for(const time of times){await studio.executeJavaScript(`document.getElementById('seek').value=${time};document.getElementById('seek').dispatchEvent(new Event('input',{bubbles:true}))`,true);await wait(()=>studio!.executeJavaScript(`Math.abs(parseFloat(document.getElementById('timeline-playhead').style.left.match(/([0-9.]+)%/)[1])/100-${time/draft.scenes[0].durationSeconds})<.000001`),'Studio seek finished '+time);fs.writeFileSync(path.join(proof,'preview-'+(preview.length+1)+'.png'),Buffer.from(await studio.executeJavaScript("document.getElementById('preview').toDataURL().split(',')[1]") as string,'base64'));preview.push(await studio.executeJavaScript("(()=>{const c=document.getElementById('preview');return [...c.getContext('2d').getImageData(0,0,c.width,c.height).data]})()") as number[])}
  fs.writeFileSync(path.join(proof,'studio-workflow.png'),(await captureRendererEvidence(studio)).toPNG())
  const rendered=await call<{draft:VideoDraft;export:{artifactId:string;verificationArtifactId:string}}>({action:'video.studio',studioRequest:{operation:'render',draftId:draft.id,expectedRevision:draft.revision}});draft=rendered.draft
  for(const id of [recorded.artifactId,recorded.eventsArtifactId,draft.scenes[0].audioArtifactId!,rendered.export.artifactId,rendered.export.verificationArtifactId])fs.copyFileSync(path.join(artifacts,id),path.join(proof,id))
  fs.writeFileSync(path.join(proof,'workflow-before-comparison.json'),JSON.stringify({steps,trace,times,framing,draft},null,2)+'\n')
  const output=await media.processArtifact({action:'media.frames.sample',artifactId:rendered.export.artifactId,timestampsSeconds:times,maxWidth:960,maxHeight:540});assert.ok('frames' in output);const errors:number[]=[]
  for(const [index,frame]of output.frames.entries()){const data=fs.readFileSync(path.join(artifacts,frame.artifactId));fs.writeFileSync(path.join(proof,'focus-result-'+(index+1)+'.png'),data);const pixels=await studio.executeJavaScript(`(async()=>{const i=new Image();i.src='data:image/png;base64,${data.toString('base64')}';await i.decode();const c=document.createElement('canvas');c.width=960;c.height=540;const x=c.getContext('2d');x.drawImage(i,0,0);return [...x.getImageData(0,0,c.width,c.height).data]})()`) as number[];let error=0;assert.equal(pixels.length,preview[index].length);for(let p=0;p<pixels.length;p++)if(p%4!==3)error+=Math.abs(pixels[p]-preview[index][p]);error/=960*540*3;errors.push(error);assert.ok(error<7,'Recorded workflow preview/export differs '+error)}
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(artifacts,recorded.artifactId))).digest('hex'),sourceHash)
  for(const id of [recorded.artifactId,recorded.eventsArtifactId,draft.scenes[0].audioArtifactId!,rendered.export.artifactId,rendered.export.verificationArtifactId])fs.copyFileSync(path.join(artifacts,id),path.join(proof,id))
  fs.writeFileSync(path.join(proof,'workflow-verification.json'),JSON.stringify({status:'passed',fixture:'controlled-functional-website',modelDriven:false,humanAcousticReference:false,steps,httpEvidence,recorded,trace,suggestions:suggestions.focusIntervals,editedFocus:draft.scenes[0].focusIntervals,visibleFocus:visibleFocusIntervals(draft.scenes[0],draft.scenes[0].durationSeconds),sourceHash,trim,rate,framing,times,meanAbsolutePixelErrors:errors,draft,actions},null,2)+'\n')
  console.log('PASS actual three-step website: native clicks, persisted server task, scroll/navigation, editable recommendations/manual hold, trim/rate, real local speech, GUI timeline and MP4 parity',errors)
 }catch(error){console.error('[BMW workflow] failure',error);throw error}finally{
  if(media.isCaptureActive())await media.stop({discard:true}).catch(()=>{})
  await runtime?.stop();await bridge?.close();if(kernel)for(const tab of kernel.tabs.values()){if(host.contentView.children.includes(tab.view))host.contentView.removeChildView(tab.view);if(!tab.view.webContents.isDestroyed())tab.view.webContents.close()}
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))
 }
}
