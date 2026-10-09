import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {app,BrowserWindow,ipcMain,session} from 'electron'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {createBridgeServer} from '../packages/browser-capability/src/bridge-server.js'
import product from '../apps/bmw/product.js'
import {newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import type {VideoDraft,StudioScene} from '../packages/feature-video/src/studio-contract.js'

if(process.env.BMW_CARD_BLOG_CASE!=='1')throw new Error('Set BMW_CARD_BLOG_CASE=1 for the authorized public-blog sample.')
const mode=process.env.BMW_CARD_BLOG_MODE??'research'
const root=path.resolve(import.meta.dirname,'..'),workspace=path.join(root,'.bmw-runtime','card-blog-sample'),artifacts=path.join(workspace,'artifacts')
const sourceUrl='https://openai.com/index/gpt-6-for-everyone/'
const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-card-blog-')))
fs.mkdirSync(artifacts,{recursive:true});fs.mkdirSync(path.join(temporary,'profile'));app.setPath('userData',path.join(temporary,'profile'))
app.on('window-all-closed',()=>{})
let window:BrowserWindow|undefined,bridge:Awaited<ReturnType<typeof createBridgeServer>>|undefined,media:MediaController|undefined,exitCode=0
const timeout=setTimeout(()=>{console.error('Public-blog case exceeded its bounded runtime.');app.exit(1)},600_000)
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected object');return value as Record<string,unknown>}
function save(name:string,value:unknown):void{fs.writeFileSync(path.join(workspace,name),JSON.stringify(value,null,2)+'\n')}
async function run():Promise<void>{try{
 await app.whenReady();const isolated=session.fromPartition(`card-blog-${process.pid}`)
 if(process.env.HTTPS_PROXY)await isolated.setProxy({proxyRules:process.env.HTTPS_PROXY})
 window=new BrowserWindow({show:true,width:1200,height:900,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
 const project={id:'card-blog-sample',name:'BMW eight-card official-blog sample',directory:workspace},registry=new BrowserCapabilityRegistry(product)
 const kernel=new BrowserKernel({window,session:isolated,capabilityRegistry:registry,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project},artifactsDirectory:artifacts,sessionContinuity:undefined,settingsStore:{snapshot:()=>({edgeNarrationEnabled:false}),update:()=>{throw new Error('Sample settings are not persisted outside the draft.')}},allowedActions:undefined,onState:undefined})
 media=new MediaController({session:isolated,preloadPath:path.join(root,'packages/media-native/src/preload/media-preload.cjs'),pagePath:path.join(root,'packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:(value:Record<string,unknown>)=>{if(value.progress!==undefined)console.log(`${value.action}: ${Math.round(Number(value.progress)*100)}%`)}});kernel.setRecordingController(media)
 bridge=await createBridgeServer(kernel,{toolDefinition:registry.toolDefinition(),resolveProject:directory=>directory===workspace?project:undefined,activeProjectId:()=>project.id})
 const headers={authorization:`Bearer ${bridge.token}`,'content-type':'application/json'},binding=bridge.registerSession('card-blog-production',workspace),calls:unknown[]=[]
 const execute=async(input:unknown):Promise<Record<string,unknown>>=>{
  const response=await fetch(`${bridge!.url}/execute`,{method:'POST',headers,body:JSON.stringify({binding,arguments:input})}),body=record(await response.json())
  if(!response.ok)throw new Error(String(body.error));const result=record(body.result);calls.push({time:new Date().toISOString(),input,result});save(`${mode}-calls.json`,calls);return result
 }
 const tab={id:'official-blog',projectId:project.id,source:'agent',title:'OpenAI official product blog',url:sourceUrl,view:{webContents:window.webContents}};kernel.tabs.set(tab.id,tab);kernel.activeTabId=tab.id
 const load=async()=>{
  void window!.loadURL(sourceUrl).catch(error=>console.log('Public page load:',error.message))
  for(let attempt=0;attempt<60;attempt++){
   await delay(1000);const text=await window!.webContents.executeJavaScript('document.body?.innerText??""') as string
   if(/verify you are human|Access denied|Just a moment/i.test(text))throw new Error('Public source requires verification; no substitute page will be captured.')
   if(text.includes('Intelligent UI')&&text.includes('44%')){await delay(2000);return}
  }
  save('source-readiness-failure.json',{url:window!.webContents.getURL(),text:await window!.webContents.executeJavaScript('(document.body?.innerText??"").slice(0,12000)')});throw new Error('Official article did not expose the expected source content within sixty seconds.')
 }
 if(mode==='research'){
  await load()
  const observation=await window.webContents.executeJavaScript(`({url:location.href,title:document.title,width:innerWidth,height:innerHeight,text:(document.body.innerText??'').slice(0,16000),headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>({tag:e.tagName,text:e.textContent,y:e.getBoundingClientRect().top+scrollY})),buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText,label:e.getAttribute('aria-label')}))})`)
  const screenshot=await execute({action:'media.screenshot',tabId:tab.id,filename:'official-blog-overview.png'})
  const targets=await window.webContents.executeJavaScript(`({paragraphs:[...document.querySelectorAll('p')].map((e,index)=>({index,text:e.innerText,rect:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}})).filter(e=>e.text.includes('44%')),examples:[...document.querySelectorAll('button')].filter(e=>['All','Frame','账单分摊工具','筹备周日烤肉餐'].includes(e.innerText.trim())).map(e=>({button:e.outerHTML,parents:[e.parentElement,e.parentElement?.parentElement,e.parentElement?.parentElement?.parentElement,e.parentElement?.parentElement?.parentElement?.parentElement].filter(Boolean).map(p=>({tag:p.tagName,id:p.id,classes:p.className,text:p.innerText.slice(0,200),width:p.getBoundingClientRect().width,height:p.getBoundingClientRect().height}))}))})`)
  save('research.json',{checkedAt:new Date().toISOString(),sourceUrl,observation,screenshot,targets});console.log(JSON.stringify({workspace,targets,screenshot},null,2))
 }else if(mode==='capture'){
  await load()
  const paragraphIndex=await window.webContents.executeJavaScript(`[...document.querySelectorAll('p')].findIndex(e=>e.innerText.includes('44%')&&e.innerText.includes('web search'))`) as number
  if(paragraphIndex<0)throw new Error('The source no longer contains the verified 44% statement.')
  await window.webContents.executeJavaScript(`(()=>{const e=document.querySelectorAll('p')[${paragraphIndex}];e.setAttribute('data-bmw-source-capture','answer-start');e.scrollIntoView({block:'center'})})()`);await delay(1500)
  const statement=await window.webContents.executeJavaScript(`document.querySelector('[data-bmw-source-capture="answer-start"]').innerText`) as string
  if(!statement.includes('44%')||!statement.includes('web search'))throw new Error('Captured source identity changed.')
  const evidence=await execute({action:'media.screenshot',tabId:tab.id,selector:'[data-bmw-source-capture="answer-start"]',filename:'answer-start-evidence.png'})
  save('capture.json',{sourceUrl,checkedAt:new Date().toISOString(),evidence})
  const bikeSelector='div[class*="ui-timeline-chat-module"][class*="composition"]'
  const bikeTop=await window.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(bikeSelector)});if(!e)throw Error('Public bicycle example unavailable');return e.getBoundingClientRect().top+scrollY})()`) as number
  let ready=false
  for(let offset=0;offset<=2200;offset+=200){
   await window.webContents.executeJavaScript(`scrollTo(0,${bikeTop}+${offset})`);await delay(500)
   ready=await window.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Frame');return !!b&&getComputedStyle(b).pointerEvents!=='none'&&Number(getComputedStyle(b).opacity)>.9})()`) as boolean
   if(ready)break
  }
  if(!ready)throw new Error('Public bicycle controls never became interactive; no synthetic footage substituted.')
  const bike=await execute({action:'media.screenshot',tabId:tab.id,selector:bikeSelector,filename:'bicycle-example.png'})
  media.configureDisplayMedia()
  ipcMain.on('media-chunk',(event,data:ArrayBuffer)=>{if(media!.ownsCaptureSender(event))media!.acceptChunk(data)})
  ipcMain.on('media-state',(event,state:unknown)=>{if(media!.ownsCaptureSender(event))media!.updateState(state)})
  let finish:(value:unknown)=>void=()=>{}
  ipcMain.on('media-finished',(event,summary:unknown)=>{if(media!.ownsCaptureSender(event))finish(media!.finalize(summary))})
  const pending=new Promise<unknown>(resolve=>{finish=resolve})
  await execute({action:'media.record.start',tabId:tab.id,fps:24});await delay(2000)
  for(const text of ['Frame','Drivetrain','All']){await execute({action:'click',tabId:tab.id,text});await delay(3000)}
  await execute({action:'media.record.stop',tabId:tab.id});const recording=record(await pending)
  const metadata=await execute({action:'media.inspect',artifactId:recording.artifactId})
  const bikeDetail=await execute({action:'media.screenshot',tabId:tab.id,selector:bikeSelector,filename:'bicycle-return-all.png'})
  const diagram=await execute({action:'media.image.draw',width:960,height:640,background:'#232323',shapes:[
   {type:'text',x:60,y:34,text:'根据问题选择表达方式',fontSize:40,color:'#ffffff',maxWidth:840},
   {type:'rect',x:330,y:126,width:300,height:92,fill:'#3b475c',color:'#8ebaff'},
   {type:'text',x:395,y:149,text:'一个问题',fontSize:36,color:'#ffffff',maxWidth:220},
   ...[170,480,790].map(x=>({type:'arrow',x1:480,y1:224,x2:x,y2:336,color:'#8ebaff',lineWidth:5})),
   ...['文字回答','可视图解','交互工具'].flatMap((text,index)=>[{type:'rect',x:50+index*310,y:360,width:240,height:110,fill:'#354152',color:'#8ebaff'},{type:'text',x:72+index*310,y:395,text,fontSize:34,color:'#ffffff',maxWidth:210}]),
   {type:'text',x:60,y:540,text:'解说示意图 · 根据 OpenAI 官方博客整理',fontSize:24,color:'#c4cbd7',maxWidth:840}
  ]})
  save('capture.json',{sourceUrl,actualUrl:window.webContents.getURL(),checkedAt:new Date().toISOString(),evidence,bike,bikeDetail,recording,metadata,diagram})
  console.log(JSON.stringify({workspace,evidence,bike,recording,diagram},null,2))
 }else if(mode==='evidence'){
  await load()
  await window.webContents.executeJavaScript(`(()=>{const e=[...document.querySelectorAll('p')].find(e=>e.innerText.includes('44%')&&e.innerText.includes('web search'));if(!e)throw Error('Verified source statement missing');e.scrollIntoView({block:'center'})})()`);await delay(2000)
  const evidence=await execute({action:'media.screenshot',tabId:tab.id,filename:'answer-start-source-viewport.png'})
  const captured=record(JSON.parse(fs.readFileSync(path.join(workspace,'capture.json'),'utf8')));captured.evidence=evidence;save('capture.json',captured);console.log(JSON.stringify(evidence,null,2))
 }else if(mode==='produce'){
  const captured=record(JSON.parse(fs.readFileSync(path.join(workspace,'capture.json'),'utf8')))
  const asset=(key:string)=>String(record(captured[key]).artifactId)
  const studio=async(request:unknown)=>execute({action:'video.studio',studioRequest:request})
  let draft=await studio({operation:'create',title:'GPT-6 与 Intelligent UI\nOpenAI 官方博客解读',options:{aspectRatio:'9:16',resolution:'720p',fps:24,music:false,style:'bmw-dark',cardLayout:'news',narrationPacing:'compact',watermark:{enabled:true,text:'BMW · 模板样片',position:'top-left',size:14,opacity:1},tts:{provider:'local-matcha',voice:'local-zh-en',ratePercent:15}}}) as unknown as VideoDraft
  const make=(index:number,title:string,narration:string,spec:StudioScene['cardSpec'],bullets:string[]=[])=>Object.assign(newStudioScene(`blog-${index}`,title),{narration,cardSpec:spec,bullets,sources:[sourceUrl],endPolicy:'hold' as const})
  draft.scenes=[
   make(1,'回答，也可以是界面','十月七日，OpenAI 发布博客，介绍 GPT 六的交互界面能力。',{version:1,templateId:'title/basic',motion:'fade-in'},['OpenAI · 2026.10.07']),
   make(2,'更早开始回答','对于需要网页搜索的问题，官方称平均更早开始回答，幅度为百分之四十四。',{version:1,templateId:'metric/hero',motion:'count-up',value:44,decimals:0,unit:'%'},['需网页搜索 · 对比 GPT-5.6 Instant']),
   Object.assign(make(3,'把数字放回原文','注意，这说的是开始回答的等待时间，并不等于完成整个任务的时间。',{version:1,templateId:'evidence/screenshot'},['官方报告 · 开始回答时间']),{imageArtifactId:asset('evidence')}),
   Object.assign(make(4,'点击，探索自行车结构','这是博客里的公开示例。点击车架和传动系统，就能看到对应的结构说明。',{version:1,templateId:'demo/recording'}),{videoArtifactId:asset('recording'),sourceDurationSeconds:Number(record(captured.metadata).durationSeconds)}),
   Object.assign(make(5,'按问题选择表达方式','文字、图解或交互工具，模型根据问题选择组合。这张图是我们整理的解说示意。',{version:1,templateId:'diagram/image'},['解说示意 · 不是产品内部架构图']),{imageArtifactId:asset('diagram')}),
   make(6,'不同套餐的模型','博客介绍，付费套餐由 Sol 支持，Free 和 Go 使用 Luna。这次发布面向 Chat。',{version:1,templateId:'comparison/two'},['Sol\nPlus · Pro · Business · Enterprise','Luna\nFree · Go']),
   Object.assign(make(7,'公开示例的画面','公开页面展示了交互式自行车图解。这里保留实际页面画面，方便回到原文核对。',{version:1,templateId:'media/sequence'}),{visualSegments:[{imageArtifactId:asset('bike'),durationSeconds:4,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut',transitionSeconds:.3},{imageArtifactId:asset('bikeDetail'),durationSeconds:4,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'fade',transitionSeconds:.3}]}),
   make(8,'三个使用方向','让日常回答更直观，帮助探索复杂概念，再按任务生成小工具。具体效果仍要实际体验。',{version:1,templateId:'points/three',motion:'reveal-items'},['日常回答更直观','复杂概念可探索','按任务生成小工具'])
  ]
  draft.preparation.notes='依据 OpenAI 2026-10-07 官方博客；44% 为发布方报告的开始回答时间对比，非 BMW 实测。字幕按句估算，尚未声学核对。公开页面录屏没有有效指针事件，不声称真实连续轨迹。'
  draft=await studio({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}) as unknown as VideoDraft
  save('editable-draft.json',draft)
  for(const scene of draft.scenes){
   const response=await studio({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:scene.id})
   draft=response.draft as VideoDraft;save('editable-draft.json',draft);console.log(`Real narration ready: ${scene.id}`)
  }
  for(const scene of draft.scenes){
   const parts=scene.narration.split(/(?<=[，。])/u).filter(Boolean),start=scene.voiceTiming?.startSeconds??.5,duration=scene.voiceTiming?.durationSeconds??scene.audioDurationSeconds??1,total=parts.reduce((sum,text)=>sum+text.length,0)
   let cursor=start
   scene.captions=parts.map(text=>{const end=cursor+duration*text.length/total,caption={startSeconds:cursor,endSeconds:end,text};cursor=end;return caption})
  }
  draft=await studio({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}) as unknown as VideoDraft
  save('editable-draft.json',draft)
  save('editable-document.json',await studio({operation:'read-document',draftId:draft.id,expectedRevision:draft.revision}))
  const check=await studio({operation:'check',draftId:draft.id,expectedRevision:draft.revision});save('readiness.json',check)
  if(check.ready!==true)throw new Error('Blog sample did not pass actual Studio readiness: '+JSON.stringify(check))
  const rendered=await studio({operation:'render',draftId:draft.id,expectedRevision:draft.revision});save('render.json',rendered)
  const exported=record(rendered.export);let cursor=0;const timestamps=draft.scenes.map(scene=>{const time=cursor+Math.min(2,scene.durationSeconds/2);cursor+=scene.durationSeconds;return time})
  save('review-frames.json',await execute({action:'media.frames.sample',artifactId:exported.artifactId,timestampsSeconds:timestamps}))
  console.log(JSON.stringify({draftId:draft.id,export:exported,seconds:cursor},null,2))
 }else if(mode==='polish'){
  const saved=record(JSON.parse(fs.readFileSync(path.join(workspace,'editable-draft.json'),'utf8'))),studio=async(request:unknown)=>execute({action:'video.studio',studioRequest:request})
  let draft=await studio({operation:'read',draftId:saved.id}) as unknown as VideoDraft
  draft.scenes[1].bullets=['需网页搜索\n对比 GPT-5.6 Instant']
  draft.scenes[2].crop={x:.25,y:.46,width:.5,height:.25}
  draft.scenes[3].crop={x:.25,y:.04,width:.5,height:.68}
  draft.scenes[5].bullets=['Sol\nPlus · Pro · Business\nEnterprise','Luna\nFree · Go']
  const captured=record(JSON.parse(fs.readFileSync(path.join(workspace,'capture.json'),'utf8')))
  const sampled=await execute({action:'media.frames.sample',artifactId:record(captured.recording).artifactId,timestampsSeconds:[6]})
  const detail=record((sampled.frames as unknown[])[0])
  const visuals=draft.scenes[6].visualSegments!;visuals[1].imageArtifactId=String(detail.artifactId);visuals[1].crop={x:.25,y:.04,width:.5,height:.68}
  const revisions:Readonly<Record<string,string>>={
   'blog-1':'十月七日，官方文章介绍了新的交互界面能力。',
   'blog-3':'这个数字衡量的是开始回答的等待时间。它不能说明完成任务的总耗时。',
   'blog-4':'这是官方文章里的公开演示。点击车架和传动系统，就能看到结构说明。',
   'blog-6':'画面列出了两组套餐，对应不同模型。这次更新面向聊天体验。',
   'blog-7':'这是公开页面的两个实际画面。我们保留了来源，方便核对。'
  }
  const pending=draft.scenes.filter(scene=>revisions[scene.id]&&scene.narration!==revisions[scene.id]).map(scene=>scene.id)
  for(const scene of draft.scenes)if(pending.includes(scene.id)){scene.narration=revisions[scene.id];delete scene.captions}
  draft=await studio({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}) as unknown as VideoDraft
  for(const sceneId of pending){const response=await studio({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId});draft=response.draft as VideoDraft;save('editable-draft.json',draft)}
  for(const scene of draft.scenes){
   const parts=scene.narration.split(/(?<=[，。])/u).filter(Boolean),start=scene.voiceTiming?.startSeconds??.5,duration=scene.voiceTiming?.durationSeconds??scene.audioDurationSeconds??1,total=parts.reduce((sum,text)=>sum+text.length,0)
   let cursor=start;scene.captions=parts.map(text=>{const end=cursor+duration*text.length/total,caption={startSeconds:cursor,endSeconds:end,text};cursor=end;return caption})
  }
  draft=await studio({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}) as unknown as VideoDraft
  save('editable-draft.json',draft);save('editable-document.json',await studio({operation:'read-document',draftId:draft.id,expectedRevision:draft.revision}))
  const rendered=await studio({operation:'render',draftId:draft.id,expectedRevision:draft.revision});save('render.json',rendered)
  const exported=record(rendered.export);let cursor=0;const timestamps=draft.scenes.map(scene=>{const time=cursor+Math.min(2,scene.durationSeconds/2);cursor+=scene.durationSeconds;return time})
  save('review-frames.json',await execute({action:'media.frames.sample',artifactId:exported.artifactId,timestampsSeconds:timestamps}))
  await window.loadURL('data:text/html,<title>Independent MP4 verification</title>')
  const dataUrl='data:video/mp4;base64,'+fs.readFileSync(String(exported.path)).toString('base64')
  const proof=await window.webContents.executeJavaScript(`(async()=>{const video=document.createElement('video');video.muted=true;video.src=${JSON.stringify(dataUrl)};await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject});await video.play();await new Promise(resolve=>setTimeout(resolve,300));video.pause();const context=new AudioContext();const response=await fetch(video.src),audio=await context.decodeAudioData(await response.arrayBuffer());let peak=0,energy=0;for(const sample of audio.getChannelData(0)){peak=Math.max(peak,Math.abs(sample));energy+=sample*sample}await context.close();return {duration:video.duration,width:video.videoWidth,height:video.videoHeight,time:video.currentTime,audioDuration:audio.duration,peak,rms:Math.sqrt(energy/audio.length)}})()`)
  const checked=record(proof);if(Number(checked.time)<=0||Number(checked.peak)<=.1||Number(checked.rms)<=.01)throw new Error('Independent playback/audio decoding failed.')
  save('independent-playback.json',proof);console.log(JSON.stringify({path:exported.path,proof},null,2))
 }else if(mode==='dense'){
  const saved=record(JSON.parse(fs.readFileSync(path.join(workspace,'editable-draft.json'),'utf8'))),studio=async(request:unknown)=>execute({action:'video.studio',studioRequest:request})
  let draft=await studio({operation:'read',draftId:saved.id}) as unknown as VideoDraft
  const prior=path.join(workspace,'before-dense-'+draft.revision);if(!fs.existsSync(prior)){fs.mkdirSync(prior);for(const name of ['editable-draft.json','editable-document.json','render.json','readiness.json','dynamic-review.json','independent-playback.json'])if(fs.existsSync(path.join(workspace,name)))fs.copyFileSync(path.join(workspace,name),path.join(prior,name));save('dense-baseline.json',draft)}
  const captured=record(JSON.parse(fs.readFileSync(path.join(workspace,'capture.json'),'utf8'))),asset=(key:string)=>String(record(captured[key]).artifactId),source={artifactId:asset('evidence'),sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(artifacts,asset('evidence')))).digest('hex')}
  const byId=(id:string)=>{const scene=draft.scenes.find(s=>s.id===id);if(!scene)throw Error('Missing sample card '+id);return scene}
  const first=byId('blog-1');first.cardSpec={version:2,templateId:'title/emphasis',motion:'wipe'};first.imageArtifactId=asset('bike')
  const metric=byId('blog-2');metric.cardSpec={version:2,templateId:'metric/backdrop',value:44,decimals:0,unit:'%',motion:'count-up',phase:'to-evidence',holdSeconds:1.5};metric.imageArtifactId=source.artifactId;metric.crop={x:.25,y:.46,width:.5,height:.5}
  const evidence=byId('blog-3');delete evidence.crop;evidence.cardSpec={version:2,templateId:'evidence/highlight',reading:{mode:'sequence',targets:[{source,rect:{x:.26,y:.515,width:.48,height:.064},name:'条件与原句'},{source,rect:{x:.27,y:.73,width:.46,height:.21},name:'开始回答时间图'}],returnToWhole:false},highlights:[{source,name:'完整原句两行',rects:[{x:.266,y:.519,width:.466,height:.025},{x:.266,y:.550,width:.28,height:.025}],style:'invert',startSeconds:.2,endSeconds:3.6}]};evidence.bullets=['原文与图表 · 不等于任务完成时间']
  const diagram=byId('blog-5');delete diagram.crop;diagram.cardSpec={version:2,templateId:'diagram/image',reading:{mode:'detail-to-whole',targets:[{source:{artifactId:asset('diagram'),sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(artifacts,asset('diagram')))).digest('hex')},rect:{x:.36,y:.2,width:.28,height:.53},name:'问题与表达选择'}],returnToWhole:true}}
  let translation=draft.scenes.find(s=>s.id==='blog-dense-translation');if(!translation){translation=Object.assign(newStudioScene('blog-dense-translation','原文与编辑译文'),{narration:'原句明确限定为需要网页搜索的问题。译文放在解释栏，方便与原始资料核对。',sources:[sourceUrl],endPolicy:'hold' as const,imageArtifactId:source.artifactId,cardSpec:{version:2 as const,templateId:'evidence/translation' as const,quote:{excerpt:'GPT‑6 Instant starts answering 44% sooner, on average, than GPT‑5.6 Instant.',translation:'需网页搜索的问题：平均更早开始回答 44%。',attribution:'OpenAI · 官方博客 · 2026.10.07',display:'staged' as const}}});translation.crop={x:.25,y:.46,width:.5,height:.25};draft.scenes.splice(draft.scenes.indexOf(evidence)+1,0,translation)}
  if(translation.cardSpec?.templateId==='evidence/translation')translation.cardSpec.quote.translation='需网页搜索的问题\n平均更早开始回答 44%'
  const sequence=byId('blog-7');if(sequence.visualSegments)for(const visual of sequence.visualSegments)visual.transition='cut'
  let relation=draft.scenes.find(s=>s.id==='blog-dense-target');if(!relation){relation=Object.assign(newStudioScene('blog-dense-target','多种表达，组合成回答'),{narration:'这些表达方式服务于同一个回答。如何组合，由问题需要决定。',sources:[sourceUrl],endPolicy:'hold' as const,cardSpec:{version:2 as const,templateId:'diagram/to-target' as const,motion:'reveal-items' as const,objects:[{label:'文字'},{label:'可视图解'},{label:'交互工具'}],target:{label:'回答问题'},relation:'根据问题选用 · 解说示意'}});draft.scenes.splice(draft.scenes.indexOf(diagram)+1,0,relation)}
  draft.preparation.notes=draft.preparation.notes.split('\n密集调研增量：')[0]+'\n密集调研增量：源图阅读/两行原像素反白、原文/译文、背景数字退回依据、关键词擦入、结构化共同目标。真实资料与旧音频保留；官方文章署名 OpenAI，未捏造个人引述或肖像。范围关系用受控验收，不将 44% 误当任务完成进度。'
  draft=await studio({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}) as unknown as VideoDraft
  for(const id of ['blog-dense-translation','blog-dense-target']){const scene=draft.scenes.find(s=>s.id===id)!;if(!scene.audioArtifactId){const result=await studio({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:id});draft=result.draft as VideoDraft}}
  for(const scene of draft.scenes.filter(s=>s.id.startsWith('blog-dense-'))){const parts=scene.narration.split(/(?<=[，。])/u).filter(Boolean),start=scene.voiceTiming?.startSeconds??.5,duration=scene.voiceTiming?.durationSeconds??scene.audioDurationSeconds??1,total=parts.reduce((n,t)=>n+t.length,0);let cursor=start;scene.captions=parts.map(text=>{const end=cursor+duration*text.length/total,cue={startSeconds:cursor,endSeconds:end,text};cursor=end;return cue})}
  for(const scene of draft.scenes)for(const cue of scene.captions??[])cue.text=cue.text.replace('这个数字衡量的是开始回答的等待时间。','这个数字衡量的是\n开始回答的等待时间。').replace('原句明确限定为需要网页搜索的问题。','原句明确限定为\n需要网页搜索的问题。')
  draft=await studio({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}) as unknown as VideoDraft
  save('editable-draft.json',draft);save('editable-document.json',await studio({operation:'read-document',draftId:draft.id,expectedRevision:draft.revision}));const check=await studio({operation:'check',draftId:draft.id,expectedRevision:draft.revision});save('dense-readiness.json',check);if(check.ready!==true)throw Error('New blog readiness: '+JSON.stringify(check))
  const rendered=await studio({operation:'render',draftId:draft.id,expectedRevision:draft.revision});save('dense-render.json',rendered);save('render.json',rendered)
  const exported=record(rendered.export),probes:{purpose:string;seconds:number}[]=[];let cursor=0
  for(const scene of draft.scenes){for(const local of [.1,Math.min(1.3,scene.durationSeconds-.1),scene.durationSeconds/2,scene.durationSeconds-.15])probes.push({purpose:scene.id,seconds:cursor+local});cursor+=scene.durationSeconds}
  const frames:unknown[]=[];for(let i=0;i<probes.length;i+=8){const batch=probes.slice(i,i+8),result=await execute({action:'media.frames.sample',artifactId:exported.artifactId,timestampsSeconds:batch.map(p=>p.seconds)});frames.push(...(result.frames as unknown[]).map((f,j)=>({...record(f),purpose:batch[j].purpose})))}save('dense-review.json',{artifactId:exported.artifactId,frames})
  await window.loadURL('data:text/html,<title>Actual updated blog MP4</title>');const url='data:video/mp4;base64,'+fs.readFileSync(String(exported.path)).toString('base64');const proof=await window.webContents.executeJavaScript('(async()=>{const v=document.createElement("video");v.muted=true;v.src='+JSON.stringify(url)+';await new Promise((r,j)=>{v.onloadeddata=r;v.onerror=j});await v.play();await new Promise(r=>setTimeout(r,300));v.pause();const a=new AudioContext(),b=await a.decodeAudioData(await(await fetch(v.src)).arrayBuffer());let peak=0,energy=0;for(const x of b.getChannelData(0)){peak=Math.max(peak,Math.abs(x));energy+=x*x}await a.close();return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,audioDuration:b.duration,peak,rms:Math.sqrt(energy/b.length)}})()');const decoded=record(proof);if(Number(decoded.time)<=0||Number(decoded.peak)<.1)throw Error('Updated MP4 decoding failed');save('dense-playback.json',proof)
  console.log(JSON.stringify({path:exported.path,draftId:draft.id,seconds:cursor,scenes:draft.scenes.length,proof},null,2))
 }else if(mode==='verify'){
  const rendered=record(JSON.parse(fs.readFileSync(path.join(workspace,'render.json'),'utf8'))),exported=record(rendered.export)
  const draft=JSON.parse(fs.readFileSync(path.join(workspace,'editable-draft.json'),'utf8')) as VideoDraft
  let offset=0;const starts=draft.scenes.map(scene=>{const start=offset;offset+=scene.durationSeconds;return start})
  const probes=[
   ...[.1,.6,1.3].map(t=>({purpose:'metric-count',seconds:starts[1]+t})),
   ...[.1,1.6,3.2].map(t=>({purpose:'point-reveal',seconds:starts[7]+t})),
   ...[1,3,5.3].map(t=>({purpose:'actual-recording',seconds:starts[3]+t})),
   ...[1,Math.min(4.7,draft.scenes[6].durationSeconds-2/draft.fps)].map(t=>({purpose:'sequence',seconds:starts[6]+t})),
   ...starts.slice(1).flatMap(seconds=>[{purpose:'before-cut',seconds:seconds-1/draft.fps},{purpose:'after-cut',seconds:seconds+1/draft.fps}])
  ]
  const frames:unknown[]=[]
  for(let index=0;index<probes.length;index+=8){const batch=probes.slice(index,index+8),result=await execute({action:'media.frames.sample',artifactId:exported.artifactId,timestampsSeconds:batch.map(p=>p.seconds)});frames.push(...(result.frames as unknown[]).map((frame,i)=>({...record(frame),purpose:batch[i].purpose})))}
  save('dynamic-review.json',{artifactId:exported.artifactId,frames})
  // Speech processing is an internal native port, not a standalone model action.
  // Keep this verification inside the trusted production script's Project scope.
  const speech=record(await media.processArtifact({action:'media.speech.align',artifactId:exported.artifactId,model:'base',language:'zh'}))
  save('audio-asr-review.json',{scope:'Actual final MP4 audio decoded and recognized locally; ASR evidence does not establish human listening or approved subtitle timing.',expectedScript:draft.scenes.map(scene=>scene.narration),speech})
  console.log(JSON.stringify({artifactId:exported.artifactId,frames:frames.length,segments:speech.segments,automaticTimingApproved:speech.automaticTimingApproved},null,2))
 }else throw new Error('Unsupported public-blog case mode.')
}catch(error:unknown){exitCode=1;console.error(error)}finally{
 clearTimeout(timeout);await bridge?.close();for(const win of BrowserWindow.getAllWindows())win.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.exit(exitCode)
}}
void run()
