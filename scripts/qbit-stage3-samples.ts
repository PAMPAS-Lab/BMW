/** Actual editable BMW samples from the explicitly authorized local public-source index. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {app,BrowserWindow,session,ipcMain,webContents} from 'electron'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {createBridgeServer} from '../packages/browser-capability/src/bridge-server.js'
import {bmwProduct} from '@bmw-agent/product-bmw'
import {mediaRecord,assertArtifactId} from '../packages/media-native/src/media-contract.js'
import {assertVisualLayers,assertAudioLayers} from '../packages/media-native/src/composition-layers.js'
import type {VisualLayer} from '../packages/media-native/src/composition-layers.js'
import {assertLayerTextTreatment} from '../packages/media-native/src/layer-text-treatment.js'
import {assertLayerPackaging} from '../packages/media-native/src/layer-packaging.js'
import {VideoStudioStore} from '../packages/feature-video/src/studio-store.js'
import {newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import type {VideoDraft} from '../packages/feature-video/src/studio-contract.js'
import {addStudioCardStack} from '../packages/feature-video/src/studio-layer-edits.js'
import {VideoStudioRuntime} from '../packages/feature-video/src/studio-runtime.js'
import type {StudioKernel} from '../packages/feature-video/src/studio-service.js'

const input=process.env.BMW_QBIT_SOURCE_INDEX
if(!input||fs.statSync(input).size>65536)throw new Error('Set BMW_QBIT_SOURCE_INDEX to the authorized bounded local source list.')
const rows:unknown=JSON.parse(fs.readFileSync(input,'utf8'));if(!Array.isArray(rows)||rows.length>12)throw new Error('Invalid source list.')
const sources=['S02','S03','S06','S07'].map(id=>{const r=rows.map(mediaRecord).find(r=>r.sampleId===id);if(!r||typeof r.path!=='string'||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)||typeof r.pageUrl!=='string')throw new Error('Missing verified '+id);return {id,file:r.path,sha256:r.sha256,pageUrl:r.pageUrl,title:String(r.title)}})
const base=path.resolve('.bmw-runtime/qbit-stage3-samples'),resume=process.env.BMW_STAGE3_CASE_RESUME,root=resume?path.resolve(resume):path.join(base,new Date().toISOString().replace(/[:.]/g,'-')),profile=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-qbit-samples-')))
if(resume&&(path.dirname(root)!==base||fs.realpathSync(root)!==root||fs.lstatSync(root).isSymbolicLink()))throw new Error('Resume only a canonical stage-three sample directory.')
const project={id:'qbit-stage3-samples',name:'量子位调研 · BMW可编辑样片',directory:path.join(root,'project')},artifacts=path.join(project.directory,'artifacts'),sessionId='qbit-stage3-authoring'
fs.mkdirSync(artifacts,{recursive:true});app.setPath('userData',path.join(profile,'profile'))
if(resume&&fs.existsSync(path.join(root,'result.json')))fs.copyFileSync(path.join(root,'result.json'),path.join(root,'before-resume-'+Date.now()+'.json'))
let window:BrowserWindow|undefined,runtime:VideoStudioRuntime|undefined,bridge:Awaited<ReturnType<typeof createBridgeServer>>|undefined,exitCode=0,current='',lastProgress=0
const results:Record<string,unknown>[]=[]
async function fingerprint(file:string){const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('hex')}
function layer(id:string,kind:VisualLayer['kind'],fields:Record<string,unknown>):VisualLayer{return assertVisualLayers([{id,title:id,kind,startSeconds:0,durationSeconds:8,x:0,y:0,width:1,height:1,color:'#ffffff',zIndex:0,...fields}])[0]}
const bg=(id:string)=>layer(id,'rectangle',{color:'#0c1426'})
const text=(id:string,value:string,x:number,y:number,width:number,height:number,fontSize:number,fields:Record<string,unknown>={})=>layer(id,'text',{text:value,x,y,width,height,fontSize,zIndex:5,...fields})
const newsCaptions=['先把公开演示素材放进工程，\n保留来源，再安排镜头。','按信息变化切换画面，\n让每个镜头只承担一个重点。','关键词按字素显现，\n多行说明保持稳定排版。','卡片与入场效果保留独立参数，\n修改内容不必重做整段。','最后检查真实导出的画面、\n字幕和音频，记录未完成项目。']
function makeNews(store:VideoStudioStore):VideoDraft{
 let d=store.create('新闻快剪 · BMW可编辑能力样片');d.width=720;d.height=1280;d.fps=24;d.music=false;d.watermark={...d.watermark,enabled:false};d.tts={provider:'local-matcha',voice:'local-zh-en',ratePercent:0}
 const scripts=['先把公开演示素材放进工程，保留来源，再安排镜头。','按信息变化切换画面，让每个镜头只承担一个重点。','关键词按字素显现，多行说明保持稳定排版。','卡片与入场效果保留独立参数，修改内容不必重做整段。','最后检查真实导出的画面、字幕和音频，记录未完成的项目。'],titles=['先让素材有来源','让镜头承载重点','让文字逐字显现','让包装保持可编辑','以实际成片验收'],ids=['S06','S02','S03','native','S06'],starts=[1,8,18,0,25],keywords=['来源可追溯','镜头可调整','文字可重排','卡片可编辑','成片可核验']
 d.preparation.notes='40秒、9:16、720×1280/24fps。公开量子位原片仅作演示素材；新旁白解释BMW制作流程，不替原作者陈述新观点。原片裁切与已有包装属于素材，逐字/描边/入场/卡片组属于BMW原生可编辑对象。配色#0c1426/#ffffff/#acd9ff；正文24（相对720高度），脚注14。文字按编辑时序显现，不声称ASR逐字对齐。无付费模型、无原片完整复刻或声音核听声明。'
 d.scenes=scripts.map((script,i)=>{
  const id='news-'+i,s={...newStudioScene(id,titles[i]),durationSeconds:8,narration:script,label:'',showSceneNumber:false,captions:[],sources:ids[i]==='native'?[]:[sources.find(s=>s.id===ids[i])!.pageUrl]}
  const caption=text(id+'-caption',newsCaptions[i],.07,.81,.86,.11,24,{textTreatment:{reveal:'line',delaySeconds:.1,lineStaggerSeconds:.45,strokeWidth:1.5,strokeColor:'#0c1426'}})
  if(i===3)return {...s,layers:[bg(id+'-background'),caption]}
  const packaging=i===0?{introSeconds:.65,directionalBlurPixels:14}:i===1?{introSeconds:.7,flipDegrees:75}:i===4?{introSeconds:.65,radialBlur:.1}:undefined
  return {...s,layers:[bg(id+'-background'),layer(id+'-footage','video',{artifactId:ids[i]+'.mp4',sourceStartSeconds:starts[i],x:.04,y:.22,width:.92,height:.5,zIndex:1,sourceCrop:{x:0,y:.28,width:1,height:.43},...(packaging?{packaging}:{})}),text(id+'-label','BMW · 新闻快剪样片',.07,.04,.86,.05,18,{color:'#acd9ff'}),text(id+'-title',i===2?titles[i]+'\nEditable text reveal':titles[i],.07,.105,.86,.115,i===2?28:34,{textTreatment:{reveal:'grapheme',delaySeconds:.1,revealSeconds:.8,lineStaggerSeconds:i===2?.4:0,strokeWidth:2,strokeColor:'#0c1426'}}),layer(id+'-caption-band','rectangle',{x:0,y:.78,width:1,height:.22,color:'#0c1426',zIndex:3}),caption,text(id+'-keyword',keywords[i],.07,.72,.86,.05,22,{color:'#acd9ff',textTreatment:{strokeWidth:3,strokeColor:'#0c1426'},...(i===2?{packaging:{introSeconds:.8,glitchPixels:10,glitchHertz:14}}:{})}),text(id+'-source','素材：量子位 '+ids[i]+' / BMW能力演示',.07,.94,.86,.035,14,{color:'#b7c6dc'})]}
 })
 d=addStudioCardStack(d,'news-3').draft
 const cards=d.scenes[3].layers!.filter(l=>l.title.includes('文字'));cards.forEach((l,i)=>{l.text=['素材有来源','文字可编辑','效果可复现'][i]})
 return store.update(d.id,d.revision,d,true,true)
}
function makePip(store:VideoStudioStore):VideoDraft{
 const d=store.create('PIP讲解 · BMW可编辑能力样片');d.width=720;d.height=1280;d.fps=24;d.music=false;d.watermark={...d.watermark,enabled:false}
 d.preparation.notes='40秒、9:16、720×1280/24fps；S07公开原片36–76秒同期声。软件画面、人像与原字幕分别以原生video图层sourceCrop取区，声音由同源独立音轨拥有。画布位置、裁切、入场均可编辑；原片字幕仍为素材像素，不冒充可编辑文字或新旁白。源屏幕细字仅作背景演示，重要说明使用原生大字。无原片完整复刻、语义核听或自动跟踪声明。'
 const titles=['同源画面，独立排版','主画面保留演示','小窗拥有独立位置','文字说明可以改写','声画沿用来源时钟']
 d.scenes=titles.map((title,i)=>{
  const id='pip-'+i,start=36+i*8,video=(suffix:string,crop:{x:number;y:number;width:number;height:number},x:number,y:number,width:number,height:number,fields:Record<string,unknown>={})=>layer(id+suffix,'video',{artifactId:'S07.mp4',sourceStartSeconds:start,sourceCrop:crop,x,y,width,height,zIndex:2,...fields})
  return {...newStudioScene(id,title),durationSeconds:8,narration:'',label:'',showSceneNumber:false,captions:[],sources:[sources.find(s=>s.id==='S07')!.pageUrl],layers:[bg(id+'-background'),video('-screen',{x:.014,y:.24,width:.972,height:.307},.05,.22,.9,.36),video('-presenter',{x:.278,y:.563,width:.44,height:.132},.57,.59,.36,.18,{packaging:{introSeconds:.55,flipDegrees:i===0?65:0,directionalBlurPixels:i===2?10:0,directionalBlurDegrees:90}}),video('-original-subtitle',{x:.03,y:.765,width:.94,height:.06},.03,.82,.94,.06),text(id+'-label','BMW · PIP讲解样片',.07,.04,.86,.05,18,{color:'#acd9ff'}),text(id+'-title',title,.07,.105,.86,.11,32,{textTreatment:{reveal:'grapheme',revealSeconds:.7,strokeWidth:2,strokeColor:'#0c1426'}}),text(id+'-explanation','独立小窗\n保留原片声音',.07,.61,.44,.12,23,{textTreatment:{reveal:'line',lineStaggerSeconds:.35,strokeWidth:1,strokeColor:'#0c1426'}}),text(id+'-source','量子位 S07 原片节选 / BMW重新排版',.07,.94,.86,.035,14,{color:'#b7c6dc'})]}
 })
 d.audioTracks=assertAudioLayers([{id:'pip-original-audio',title:'S07同期原声36–76秒',artifactId:'S07.mp4',startSeconds:0,durationSeconds:40,sourceStartSeconds:36,playbackRate:1,volume:.85,muted:false,locked:false,ducking:false}])
 return store.update(d.id,d.revision,d,true,true)
}
async function run(){try{
 await app.whenReady();const isolated=session.fromPartition('qbit-stage3-'+process.pid);window=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});const fixture=path.join(profile,'fixture.html');fs.writeFileSync(fixture,'<!doctype html><title>BMW sample review</title>');await window.loadFile(fixture)
 const media=new MediaController({session:isolated,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:(s:{progress?:number})=>{if((s.progress??0)>=lastProgress+.25){lastProgress=s.progress!;process.stderr.write(current+' '+Math.round(lastProgress*100)+'%\n')}}}),registry=new BrowserCapabilityRegistry(bmwProduct),kernel=new BrowserKernel({window,session:isolated,capabilityRegistry:registry,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project},artifactsDirectory:artifacts,sessionContinuity:undefined,settingsStore:undefined,allowedActions:undefined,onState:undefined});kernel.setRecordingController(media)
 bridge=await createBridgeServer(kernel,{toolDefinition:registry.toolDefinition(),resolveProject:directory=>directory===project.directory?project:undefined,activeProjectId:()=>project.id});const binding=bridge.registerSession(sessionId,project.directory),headers={authorization:'Bearer '+bridge.token,'content-type':'application/json'},store=new VideoStudioStore(project.directory,sessionId)
 const call=async(args:unknown)=>{const response=await fetch(bridge!.url+'/execute',{method:'POST',headers,body:JSON.stringify({binding,arguments:args})}),body=mediaRecord(await response.json());if(!response.ok)throw new Error(String(body.error));return {result:mediaRecord(body.result),images:Array.isArray(body.images)?body.images:[]}}
 for(const source of sources){const stat=fs.lstatSync(source.file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=512*1024*1024);assert.equal(await fingerprint(source.file),source.sha256);const target=path.join(artifacts,source.id+'.mp4');if(!fs.existsSync(target)){const pending=path.join(artifacts,'.pending-'+source.id+'.mp4');try{fs.copyFileSync(source.file,pending,fs.constants.COPYFILE_EXCL);assert.equal(await fingerprint(pending),source.sha256);fs.renameSync(pending,target)}finally{if(fs.existsSync(pending))fs.unlinkSync(pending)}}assert.equal(await fingerprint(target),source.sha256)}
 runtime=new VideoStudioRuntime();runtime.configure({browserKernel:kernel as unknown as StudioKernel,projectStore:{active:()=>project},getMainWindow:()=>window,getShellWebContents:()=>window?.webContents,getTheme:()=> 'dark',getCurrentSessionId:()=>sessionId,isProjectChanging:()=>false,revealAgent:()=>{},enqueueAssistant:async()=>{throw new Error('This sample uses no language model.')},synchronizeAgentProject:async()=>({sessionId})});runtime.installIpc(ipcMain);window.setContentSize(1280,800);runtime.layout({x:0,y:0,width:1280,height:800},true);await runtime.openPanel('video-studio')
 const studio=webContents.getAllWebContents().find(w=>w.getURL().endsWith('/studio.html'))!;assert.ok(studio)
 const until=async(check:()=>Promise<boolean>,label:string)=>{const deadline=Date.now()+30000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Timed out: '+label)}
 await until(()=>studio.executeJavaScript("!!document.getElementById('view-toggle')&&!document.getElementById('view-toggle').disabled"),'Studio mode button');await studio.executeJavaScript("if(document.body.dataset.view!=='advanced')document.getElementById('view-toggle').click();true");await until(()=>studio.executeJavaScript("document.body.dataset.view==='advanced'&&!document.getElementById('view-toggle').disabled"),'Actual advanced editor')
 const descriptor=(await call({action:'video.studio',studioRequest:{operation:'describe-schema'}})).result;assert.equal(mediaRecord(descriptor.authorization).advancedEditing,true)
 for(const kind of ['news','pip'] as const){current=kind;lastProgress=0;try{
  const title=kind==='news'?'新闻快剪 · BMW可编辑能力样片':'PIP讲解 · BMW可编辑能力样片',existing=store.list().filter(d=>d.title===title);assert.ok(existing.length<=1);let draft=existing[0]??(kind==='news'?makeNews(store):makePip(store))
  if(process.env.BMW_STAGE3_POLISH==='1'){
   const document=store.readDocument(draft.id),commands:Record<string,unknown>[]=[]
   for(const track of document.content.timeline.tracks)for(const clip of track.clips)if(track.role==='overlay'){
    const identity=String(clip.properties.sourceIdentity),patch:Record<string,unknown>={}
    if(kind==='news'&&identity.endsWith('-footage'))Object.assign(patch,{sourceCrop:{x:0,y:.28,width:1,height:.43},y:.22,height:.5})
    if(kind==='news'&&identity==='news-2-title')Object.assign(patch,{text:'让文字逐字显现\nEditable text reveal',fontSize:28,textTreatment:{reveal:'grapheme',delaySeconds:.1,revealSeconds:.8,lineStaggerSeconds:.4,strokeWidth:2,strokeColor:'#0c1426'}})
    if(kind==='news'&&identity.endsWith('-caption')){const i=Number(identity.split('-')[1]);Object.assign(patch,{text:newsCaptions[i],fontSize:24})}
    if(kind==='pip'&&identity.endsWith('-original-subtitle'))Object.assign(patch,{sourceCrop:{x:.03,y:.765,width:.94,height:.06},x:.03,width:.94,height:.06})
    if(Object.entries(patch).some(([key,value])=>JSON.stringify(clip.properties[key])!==JSON.stringify(value)))commands.push({op:'layer.set',clipId:clip.id,patch})
   }
   if(commands.length){await call({action:'video.studio',studioRequest:{operation:'apply-edit',draftId:draft.id,expectedRevision:draft.revision,edit:{version:1,commands}}});draft=store.read(draft.id)}
  }
  if(kind==='news')for(const scene of draft.scenes)if(!scene.audioArtifactId||scene.audioText!==scene.narration){await call({action:'video.studio',studioRequest:{operation:'narrate-local',draftId:draft.id,expectedRevision:draft.revision,sceneId:scene.id}});draft=store.read(draft.id)}
  if(process.env.BMW_QBIT_WATCH_REPAIR==='1'){
   const next=structuredClone(draft)
   if(kind==='pip'){
    let elapsed=0;for(const [index,scene]of next.scenes.entries()){scene.durationSeconds=index===4?20/3:7;for(const l of scene.layers??[]){l.durationSeconds=scene.durationSeconds;if(l.kind==='video')l.sourceStartSeconds=39+2/24+elapsed}elapsed+=scene.durationSeconds}
    if(next.audioTracks?.[0]){next.audioTracks[0].sourceStartSeconds=39+2/24;next.audioTracks[0].durationSeconds=elapsed}
   }
   for(const [index,scene]of next.scenes.entries())for(const l of scene.layers??[]){
    if(l.id.endsWith('-background')){l.color='#eef4f8';if(kind==='news'){l.kind='video';l.artifactId=['S06.mp4','S02.mp4','S03.mp4','S06.mp4','S06.mp4'][index];l.sourceStartSeconds=[1,8,18,40,25][index];l.sourceCrop={x:.285,y:.28,width:.43,height:.43};Object.assign(l,{x:0,y:0,width:1,height:1,opacity:1,effects:{brightness:.65,contrast:1,saturation:.75,blurPixels:12}})}}
    if(l.kind==='text'){l.color=l.id.endsWith('-source')?'#4c6075':'#142c43';if(l.textTreatment)l.textTreatment={...l.textTreatment,strokeColor:'#eef4f8'};l.packaging=undefined}
    if(l.id.endsWith('-label')){l.y=.018;l.height=.035;l.fontSize=15}
    if(l.id.endsWith('-title')){l.y=.065;l.height=.085;l.fontSize=26;l.textTreatment=assertLayerTextTreatment({reveal:'none',strokeWidth:1,strokeColor:'#eef4f8'})}
    if(l.id.endsWith('-source')){l.y=.963;l.height=.025;l.fontSize=12}
    if(kind==='news'){
     if(l.id.endsWith('-footage')){l.x=.02;l.y=.155;l.width=.96;l.height=.59;l.sourceCrop={x:0,y:.28,width:1,height:.43};l.packaging=assertLayerPackaging({introSeconds:.2,directionalBlurPixels:3})}
     if(l.id.endsWith('-keyword')){l.y=.755;l.height=.04;l.fontSize=21}
     if(l.id.endsWith('-caption-band')){l.y=.805;l.height=.15;l.color='#eef4f8'}
     if(l.id.endsWith('-caption')){l.text=scene.narration;l.y=.82;l.height=.12;l.fontSize=22;l.startSeconds=scene.voiceTiming?.startSeconds??2/24;l.durationSeconds=Math.min(8-l.startSeconds,scene.voiceTiming?.durationSeconds??scene.audioDurationSeconds??7);l.textTreatment=assertLayerTextTreatment({reveal:'none',strokeWidth:1,strokeColor:'#eef4f8'})}
     if(index===3&&l.title.includes('文字')){l.color='#ffffff';l.textTreatment=assertLayerTextTreatment({reveal:'none',strokeWidth:1,strokeColor:'#142c43'})}
    }else{
     if(l.id.endsWith('-screen')){l.x=.02;l.y=.15;l.width=.96;l.height=.40}
     if(l.id.endsWith('-presenter')){l.x=.45;l.y=.58;l.width=.53;l.height=.25;l.sourceCrop={x:.278,y:.563,width:.44,height:.132};l.packaging=undefined}
     if(l.id.endsWith('-explanation')){l.x=.04;l.y=.62;l.width=.38;l.height=.14;l.fontSize=20;l.textTreatment=assertLayerTextTreatment({reveal:'none',strokeWidth:1,strokeColor:'#eef4f8'})}
     if(l.id.endsWith('-original-subtitle')){l.y=.865;l.height=.06}
    }
   }
   if(kind==='news'){
    const scene=next.scenes[3];scene.layers=scene.layers!.filter(l=>!l.title.startsWith('卡片3')&&!['news-3-motion-bed','news-3-head'].includes(l.id))
    for(const l of scene.layers){if(l.title.startsWith('卡片')){const second=l.title.startsWith('卡片2'),word=l.kind==='text';delete l.keyframes;delete l.packaging;Object.assign(l,{x:(second?.52:.08)+(word?.02:0),y:word?.15:.13,width:word?.36:.4,height:word?.08:.12,startSeconds:second?.25:0,durationSeconds:3});if(word){l.fontSize=22;l.text=second?'效果可复现':'文字可编辑'}}}
    scene.layers.push(layer('news-3-motion-bed','video',{artifactId:'S06.mp4',sourceStartSeconds:40,sourceCrop:{x:0,y:.28,width:1,height:.43},x:.02,y:.25,width:.96,height:.5,zIndex:1}),text('news-3-head','让包装保持可编辑',.07,.065,.86,.07,26,{color:'#142c43'}))
   }
   if(kind==='news')for(const scene of next.scenes)for(const l of scene.layers??[]){if(l.kind==='text'){l.color='#ffffff';l.textTreatment=assertLayerTextTreatment({...l.textTreatment,strokeWidth:2,strokeColor:'#142c43'})}if(l.id.endsWith('-caption-band')){l.color='#142c43';l.opacity=.86}}
   if(kind==='pip'){
    next.width=1280;next.height=720
    for(const scene of next.scenes)for(const l of scene.layers??[]){if(l.id.endsWith('-label'))l.hidden=true;if(l.id.endsWith('-title'))Object.assign(l,{x:.025,y:.035,width:.95,height:.08,fontSize:32});if(l.id.endsWith('-screen'))Object.assign(l,{x:.02,y:.14,width:.73,height:.68});if(l.id.endsWith('-presenter'))Object.assign(l,{x:.77,y:.15,width:.21,height:.4});if(l.id.endsWith('-explanation'))Object.assign(l,{x:.77,y:.59,width:.21,height:.2,fontSize:23});if(l.id.endsWith('-original-subtitle')){Object.assign(l,{x:.02,y:.84,width:.96,height:.115});l.sourceCrop={x:.03,y:.765,width:.94,height:.05}}if(l.id.endsWith('-source'))Object.assign(l,{x:.025,y:.966,width:.95,height:.03,fontSize:15})}
   }
   next.preparation.notes+='\n连续播放修订：浅色底、放大素材/人物、弱化翻牌模糊；新闻卡片缩为3秒并保留动态素材，字幕使用完整旁白并按实际语音窗口显示。PIP硬字幕与同源同期声共用39.083–73.75秒时钟，按ASR句段边界保留余量；字幕字词与声音语义尚未人工核听。'
   await call({action:'video.studio',studioRequest:{operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft:next}});draft=store.read(draft.id)
  }
  const duration=draft.scenes.reduce((n,s)=>n+s.durationSeconds,0);assert.ok(Math.abs(duration-(kind==='pip'&&process.env.BMW_QBIT_WATCH_REPAIR==='1'?104/3:40))<1e-6);const rendered=await call({action:'video.studio',studioRequest:{operation:'render',draftId:draft.id,expectedRevision:draft.revision}}),output=mediaRecord(rendered.result.export),outputId=assertArtifactId(output.artifactId),decode=mediaRecord(await media.processArtifact({action:'media.decode.check',artifactId:outputId}));assert.equal(decode.completeFile,true);assert.ok((decode.tracks as unknown[]).map(mediaRecord).some(t=>t.type==='video'&&t.sampleCount===Math.round(duration*24)))
  const audio=(await call({action:'media.audio.sample',artifactId:outputId,startSeconds:2,endSeconds:7})).result,evidence=mediaRecord(audio.evidence);assert.ok(Number(evidence.rms)>1e-5);assert.equal(evidence.missingFrames,0)
  let elapsed=0;const timestamps=draft.scenes.flatMap(s=>{const times=[.125,.75,Math.min(3.5,s.durationSeconds/2),s.durationSeconds-.5].map(t=>elapsed+t);elapsed+=s.durationSeconds;return times}),frames:Record<string,unknown>[]=[]
  for(let offset=0;offset<timestamps.length;offset+=8){const page=await call({action:'media.frames.sample',artifactId:outputId,timestampsSeconds:timestamps.slice(offset,offset+8),maxWidth:kind==='pip'?1280:390,maxHeight:720});assert.equal(page.images.length,(page.result.frames as unknown[]).length);for(const [index,raw]of (page.result.frames as unknown[]).entries()){const frame=mediaRecord(raw);assert.equal(await fingerprint(String(frame.path)),crypto.createHash('sha256').update(Buffer.from(String(mediaRecord(page.images[index]).data),'base64')).digest('hex'));frames.push(frame)}}
  const contacts:string[]=[];for(let offset=0;offset<frames.length;offset+=4){const page=frames.slice(offset,offset+4).map(f=>({src:'data:image/png;base64,'+fs.readFileSync(String(f.path)).toString('base64'),seconds:f.timestampSeconds,width:f.width,height:f.height})),png=await window.webContents.executeJavaScript(`(async()=>{const rows=${JSON.stringify(page)},c=document.createElement('canvas');c.width=780;const frameHeight=Math.round(390*rows[0].height/rows[0].width);c.height=(frameHeight+32)*2;const x=c.getContext('2d');x.fillStyle='#0c1426';x.fillRect(0,0,780,1452);for(let i=0;i<rows.length;i++){const image=new Image();image.src=rows[i].src;await image.decode();const px=i%2*390,py=Math.floor(i/2)*(frameHeight+32);x.drawImage(image,px,py,390,frameHeight);x.fillStyle='#ffffff';x.font='16px sans-serif';x.fillText('实际PTS '+Number(rows[i].seconds).toFixed(3)+'s',px+10,py+frameHeight+24)}return c.toDataURL().split(',')[1]})()`) as string,file=path.join(root,kind+'-contact-'+offset/4+'.png');fs.writeFileSync(file,Buffer.from(png,'base64'));contacts.push(file)}
  const reopened=new VideoStudioStore(project.directory,sessionId).read(draft.id),document=store.readDocument(draft.id);assert.equal(document.schemaVersion,'2.8');assert.equal(reopened.exports.at(-1)!.artifactId,outputId);fs.writeFileSync(path.join(root,kind+'.bmw.video.json'),JSON.stringify(document,null,2));const ready=await call({action:'video.studio',studioRequest:{operation:'review-export',draftId:draft.id,expectedRevision:reopened.revision,sceneId:reopened.scenes[0].id,reviewOffset:0}});assert.ok(ready.images.length>0)
  results.push({kind,status:'passed',duration,draftId:draft.id,revision:reopened.revision,document:path.join(root,kind+'.bmw.video.json'),output,outputSha256:await fingerprint(path.join(artifacts,outputId)),decode,audio,frames,contacts,review:ready.result,visualReview:'pending-contact-sheet-review',audioAuditioned:false});process.stderr.write('PASS '+kind+' '+duration+'s editable sample\n')
 }catch(error){exitCode=1;results.push({kind,status:'failed',error:String(error)});console.error(kind,error)}fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({complete:false,project,sessionId,results},null,2))}
 for(const source of sources)assert.equal(await fingerprint(source.file),source.sha256)
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({complete:exitCode===0,project,sessionId,sources,results,scope:'BMW native editable Projects and actual 720x1280/24fps MP4s; copied authorized media; disposable profile/mock keychain; no production Profile or paid-model run; audio evidence is technical, not audition.',languageModelCalls:0},null,2));console.log(JSON.stringify({root,exitCode}))
 }catch(error){exitCode=1;console.error(error)}finally{await bridge?.close();await runtime?.stop();window?.destroy();fs.rmSync(profile,{recursive:true,force:true});app.exit(exitCode)}}
void run()
