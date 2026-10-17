/** Explicit local public-video references plus editable finite BMW diagrams. */
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
import {assertVisualLayers} from '../packages/media-native/src/composition-layers.js'
import type {VisualLayer} from '../packages/media-native/src/composition-layers.js'
import {assertScienceSpec,defaultScienceSpec} from '../packages/media-native/src/science-spec.js'
import type {ScienceSpec} from '../packages/media-native/src/science-spec.js'
import {assertLayerTextTreatment} from '../packages/media-native/src/layer-text-treatment.js'
import {VideoStudioStore} from '../packages/feature-video/src/studio-store.js'
import {VideoStudioRuntime} from '../packages/feature-video/src/studio-runtime.js'
import {newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import type {VideoDraft} from '../packages/feature-video/src/studio-contract.js'
import type {StudioKernel} from '../packages/feature-video/src/studio-service.js'

const input=process.env.BMW_QBIT_SOURCE_INDEX
if(!input||fs.statSync(input).size>65536)throw new Error('Set BMW_QBIT_SOURCE_INDEX to the authorized local public-source list.')
const rows:unknown=JSON.parse(fs.readFileSync(input,'utf8'));if(!Array.isArray(rows)||rows.length>12)throw new Error('Invalid source list.')
const sources=['S09','S10'].map(id=>{const r=rows.map(mediaRecord).find(r=>r.sampleId===id);if(!r||typeof r.path!=='string'||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256))throw new Error('Missing '+id);return {id,file:r.path,sha256:r.sha256,pageUrl:typeof r.pageUrl==='string'&&/^https?:\/\//.test(r.pageUrl)?r.pageUrl:undefined,title:String(r.title)}})
const base=path.resolve('.bmw-runtime/qbit-stage4-samples'),resume=process.env.BMW_STAGE4_CASE_RESUME,root=resume?path.resolve(resume):path.join(base,new Date().toISOString().replace(/[:.]/g,'-')),profile=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-qbit-science-')))
if(resume&&(path.dirname(root)!==base||fs.realpathSync(root)!==root||fs.lstatSync(root).isSymbolicLink()))throw new Error('Resume only a canonical stage-four sample directory.')
const project={id:'qbit-stage4-samples',name:'量子位调研 · 原生科学图解节选',directory:path.join(root,'project')},artifacts=path.join(project.directory,'artifacts'),sessionId='qbit-stage4-authoring'
fs.mkdirSync(artifacts,{recursive:true});app.setPath('userData',path.join(profile,'profile'));if(resume&&fs.existsSync(path.join(root,'result.json')))fs.copyFileSync(path.join(root,'result.json'),path.join(root,'before-resume-'+Date.now()+'.json'))
let window:BrowserWindow|undefined,runtime:VideoStudioRuntime|undefined,bridge:Awaited<ReturnType<typeof createBridgeServer>>|undefined,current='',lastProgress=0,exitCode=0
const results:Record<string,unknown>[]=[]
async function fingerprint(file:string){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex')}
interface Chapter {id:string;title:string;seconds:number;script:string;caption:string;referenceSeconds?:number;science?:ScienceSpec}
function chapters(id:'S09'|'S10'):Chapter[]{
 const clock={durationSeconds:5,delaySeconds:.25}
 if(id==='S10')return [
  {id:'curve-reference',title:'原片参考 · 曲线',seconds:4,referenceSeconds:153,script:'原片用曲线展示比例变化。',caption:'原片参考画面\n包含原作者已有图解与包装'},
  {id:'curve-native',title:'原生曲线 · 示意数据',seconds:8,script:'曲线与沿线点共用数据，读数同步变化，数值仅作示意。',caption:'曲线与沿线点共用数据，\n读数同步变化，数值仅作示意。',science:assertScienceSpec({...defaultScienceSpec('curve'),...clock,title:'曲线生长与沿线点',unit:'%',xUnit:'%',xDomain:[0,100],yDomain:[0,100],points:[{x:0,y:0},{x:10,y:2},{x:25,y:5.5},{x:50,y:18},{x:65,y:32},{x:80,y:55},{x:100,y:100}],note:'归一化示意曲线，非原片实验读数。'})},
  {id:'ratio-native',title:'原生比例 · 75:25',seconds:8,script:'原片标注七十五比二十五，可用同一数据切换比例视图。',caption:'75:25引自原片标注，\n条形、饼与环图共用分项数据。',science:assertScienceSpec({...defaultScienceSpec('ratio'),...clock,title:'可编辑比例视图',unit:'份',mode:'ring',parts:[{label:'组分A',value:75,color:'#ffc56b'},{label:'组分B',value:25,color:'#cbacff'}],note:'75:25引自S10画面标注，组分名称为示意。'})},
  {id:'array-reference',title:'原片参考 · 实验分组',seconds:4,referenceSeconds:301,script:'这里是原片的实验分组画面。',caption:'原片“37次实验”标注\n保留为规模与动效参考'},
  {id:'array-native',title:'原生阵列 · 可编辑分组',seconds:8,script:'三十七个对象重新分组，分组数量和标签都可以修改。',caption:'37个对象重新分组，\n数量与标签来自同一分区数据。',science:assertScienceSpec({...defaultScienceSpec('array'),...clock,title:'对象阵列重新分组',unit:'个',groups:[{label:'示意A',count:12,color:'#70d5ff'},{label:'示意B',count:9,color:'#75e2b7'},{label:'示意C',count:8,color:'#ffc56b'},{label:'示意D',count:8,color:'#cbacff'}],note:'对象规模37对应原片标注，A/B/C/D分区为示意。'})}
 ]
 return [
  {id:'drill-reference',title:'原片参考 · 钻井',seconds:4,referenceSeconds:282,script:'原片用剖面画面解释钻井。',caption:'原片参考画面\n包含原有三维素材与深度标注'},
  {id:'drill-native',title:'原生路径 · 深度联动',seconds:8,script:'路径向下生长，深度读数跟随钻头的垂直位置。',caption:'深度由钻头垂直位置派生，\n水平段不增加垂直深度。',science:assertScienceSpec({...defaultScienceSpec('flow'),...clock,mode:'drill',title:'钻井路径与深度',unit:'km',valueStart:0,valueEnd:12,path:[{x:.28,y:.05},{x:.28,y:.72},{x:.72,y:.72},{x:.72,y:.95}],note:'12 km引自S09标注；路径位置为示意。'})},
  {id:'flow-reference',title:'原片参考 · 水流',seconds:4,referenceSeconds:522,script:'再看原片里的流动示意。',caption:'原片流动示意参考\n保留原有素材的视觉表现'},
  {id:'flow-native',title:'原生流向 · 纯时钟',seconds:8,script:'粒子沿设定路径移动，跳转时间后也能回到同一个状态。',caption:'粒子沿设定路径移动，\n跳转时间后仍可复现同一状态。',science:assertScienceSpec({...defaultScienceSpec('flow'),...clock,title:'路径与流动粒子',unit:'%',mode:'flow',path:[{x:.2,y:.05},{x:.2,y:.5},{x:.35,y:.72},{x:.78,y:.72},{x:.88,y:.77}],dots:16,cycles:3,valueStart:0,valueEnd:100,note:'原生路径/粒子示意，不计算压力、流量或流体物理。'})}
 ]
}
function makeDraft(store:VideoStudioStore,id:'S09'|'S10'):VideoDraft{
 const d=store.create(id+' · 原生科学图解节选');d.width=720;d.height=1280;d.fps=24;d.music=false;d.watermark={...d.watermark,enabled:false};d.tts={provider:'local-matcha',voice:'local-zh-en',ratePercent:0}
 d.preparation.notes='按原片视觉类型制作有限模块示意：原片参考段与BMW原生组件明确分开。曲线数值、对象分区及路径形状为演示参数；S10的75:25、37次实验和S09的12 km仅引用画面标注，不代替科学事实核验。数据/单位/图形内读数共用science状态；修改数据后需检查旁白/说明文字。原有3D仍为外部视频素材。720×1280/24fps，字体按390像素手机宽度检查；本地合成旁白，未作语义核听。'
 const source=sources.find(s=>s.id===id)!
 d.scenes=chapters(id).map(c=>{
  const key=id.toLowerCase()+'-'+c.id,layer=(suffix:string,kind:VisualLayer['kind'],fields:Record<string,unknown>)=>assertVisualLayers([{id:key+'-'+suffix,title:suffix,kind,startSeconds:0,durationSeconds:c.seconds,x:0,y:0,width:1,height:1,color:'#ffffff',...fields}])[0],text=(suffix:string,value:string,x:number,y:number,width:number,height:number,fontSize:number,fields:Record<string,unknown>={})=>layer(suffix,'text',{text:value,x,y,width,height,fontSize,zIndex:5,...fields})
  return {...newStudioScene(key,c.title),durationSeconds:c.seconds,narration:c.script,captions:[],label:'',showSceneNumber:false,sources:source.pageUrl?[source.pageUrl]:[],layers:[layer('background','rectangle',{color:'#0c1426',zIndex:0}),text('label','BMW · 科学图解能力样片',.07,.04,.86,.05,18,{color:'#acd9ff'}),...(c.science?[layer('diagram','diagram',{x:.04,y:.13,width:.92,height:.65,zIndex:2,science:c.science})]:[layer('reference','video',{artifactId:id+'.mp4',sourceStartSeconds:c.referenceSeconds,x:.04,y:.16,width:.92,height:.6,zIndex:1}),text('reference-title',c.title,.07,.105,.86,.09,28)]),text('caption',c.caption,.07,.81,.86,.11,22,{textTreatment:{reveal:'line',delaySeconds:.15,lineStaggerSeconds:.35,strokeWidth:1,strokeColor:'#0c1426'}}),text('source',c.science?'BMW原生组件 / 数据说明见图内':('参考：量子位 '+id+' / 原片自带图解'),.07,.94,.86,.035,14,{color:'#b7c6dc'})]}
 })
 return store.update(d.id,d.revision,d,true,true)
}
async function run(){try{
 await app.whenReady();const isolated=session.fromPartition('qbit-stage4-'+process.pid);window=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});const fixture=path.join(profile,'fixture.html');fs.writeFileSync(fixture,'<!doctype html><title>BMW scientific samples</title>');await window.loadFile(fixture)
 const media=new MediaController({session:isolated,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:(s:{progress?:number})=>{if((s.progress??0)>=lastProgress+.25){lastProgress=s.progress!;process.stderr.write(current+' '+Math.round(lastProgress*100)+'%\n')}}}),registry=new BrowserCapabilityRegistry(bmwProduct),kernel=new BrowserKernel({window,session:isolated,capabilityRegistry:registry,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project},artifactsDirectory:artifacts,sessionContinuity:undefined,settingsStore:undefined,allowedActions:undefined,onState:undefined});kernel.setRecordingController(media)
 bridge=await createBridgeServer(kernel,{toolDefinition:registry.toolDefinition(),resolveProject:directory=>directory===project.directory?project:undefined,activeProjectId:()=>project.id});const binding=bridge.registerSession(sessionId,project.directory),headers={authorization:'Bearer '+bridge.token,'content-type':'application/json'},store=new VideoStudioStore(project.directory,sessionId),call=async(args:unknown)=>{const response=await fetch(bridge!.url+'/execute',{method:'POST',headers,body:JSON.stringify({binding,arguments:args})}),body=mediaRecord(await response.json());if(!response.ok)throw new Error(String(body.error));return {result:mediaRecord(body.result),images:Array.isArray(body.images)?body.images:[]}}
 for(const source of sources){const stat=fs.lstatSync(source.file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=512*1024*1024);assert.equal(await fingerprint(source.file),source.sha256);const target=path.join(artifacts,source.id+'.mp4');if(!fs.existsSync(target)){const pending=path.join(artifacts,'.pending-'+source.id+'.mp4');try{fs.copyFileSync(source.file,pending,fs.constants.COPYFILE_EXCL);assert.equal(await fingerprint(pending),source.sha256);fs.renameSync(pending,target)}finally{if(fs.existsSync(pending))fs.unlinkSync(pending)}}assert.equal(await fingerprint(target),source.sha256)}
 for(const id of ['S10','S09'] as const){const existing=store.list().filter(d=>d.title===id+' · 原生科学图解节选');assert.ok(existing.length<=1);if(!existing.length)makeDraft(store,id)}
 runtime=new VideoStudioRuntime();runtime.configure({browserKernel:kernel as unknown as StudioKernel,projectStore:{active:()=>project},getMainWindow:()=>window,getShellWebContents:()=>window?.webContents,getTheme:()=> 'dark',getCurrentSessionId:()=>sessionId,isProjectChanging:()=>false,revealAgent:()=>{},enqueueAssistant:async()=>{throw new Error('No language model in this sample.')},synchronizeAgentProject:async()=>({sessionId})});runtime.installIpc(ipcMain);window.setContentSize(1280,800);runtime.layout({x:0,y:0,width:1280,height:800},true);await runtime.openPanel('video-studio');const studio=webContents.getAllWebContents().find(w=>w.getURL().endsWith('/studio.html'))!;assert.ok(studio)
 const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Timed out: '+label)};await until(()=>studio.executeJavaScript("!!document.getElementById('view-toggle')&&!document.getElementById('view-toggle').disabled"),'Mode button');await studio.executeJavaScript("if(document.body.dataset.view!=='advanced')document.getElementById('view-toggle').click();true");await until(()=>studio.executeJavaScript("document.body.dataset.view==='advanced'&&!document.getElementById('view-toggle').disabled"),'Advanced mode');assert.equal(mediaRecord((await call({action:'video.studio',studioRequest:{operation:'describe-schema'}})).result.authorization).advancedEditing,true)
 for(const id of ['S10','S09'] as const){current=id;lastProgress=0;try{
  let draft=store.list().find(d=>d.title===id+' · 原生科学图解节选')!;for(const scene of draft.scenes)if(!scene.audioArtifactId||scene.audioText!==scene.narration){await call({action:'video.studio',studioRequest:{operation:'narrate-local',draftId:draft.id,expectedRevision:draft.revision,sceneId:scene.id}});draft=store.read(draft.id)}
  if(process.env.BMW_QBIT_WATCH_REPAIR==='1'){
   const next=structuredClone(draft)
   for(const scene of next.scenes)for(const l of scene.layers??[]){
    if(l.kind==='rectangle')l.color='#eef4f8'
    if(l.kind==='text'){l.color=l.id.endsWith('-source')?'#4c6075':'#142c43';if(l.textTreatment)l.textTreatment={...l.textTreatment,strokeColor:'#eef4f8'}}
    if(l.science)l.science={...l.science,theme:'light'}
    if(l.id.endsWith('-caption')){l.text=scene.narration;l.startSeconds=scene.voiceTiming?.startSeconds??2/24;l.durationSeconds=Math.min(scene.durationSeconds-l.startSeconds,scene.voiceTiming?.durationSeconds??scene.audioDurationSeconds??scene.durationSeconds-.1);l.fontSize=22;l.height=.12;l.textTreatment=assertLayerTextTreatment({reveal:'none',strokeWidth:1,strokeColor:'#eef4f8'})}
   }
   next.preparation.notes+='\n连续播放修订：浅色底与图解主题，字幕改为完整旁白并按实测语音窗口显示；图内示意数据/来源说明保留。ASR及播放不冒充模型核听。'
   await call({action:'video.studio',studioRequest:{operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft:next}});draft=store.read(draft.id)
  }
  const duration=chapters(id).reduce((n,c)=>n+c.seconds,0);assert.equal(draft.scenes.reduce((n,s)=>n+s.durationSeconds,0),duration);const rendered=await call({action:'video.studio',studioRequest:{operation:'render',draftId:draft.id,expectedRevision:draft.revision}}),output=mediaRecord(rendered.result.export),outputId=assertArtifactId(output.artifactId),decode=mediaRecord(await media.processArtifact({action:'media.decode.check',artifactId:outputId}));assert.equal(decode.completeFile,true);assert.ok((decode.tracks as unknown[]).map(mediaRecord).some(t=>t.type==='video'&&t.sampleCount===duration*24));const audio=(await call({action:'media.audio.sample',artifactId:outputId,startSeconds:2,endSeconds:7})).result;assert.ok(Number(mediaRecord(audio.evidence).rms)>1e-5);assert.equal(mediaRecord(audio.evidence).missingFrames,0)
  let start=0;const timestamps=chapters(id).flatMap(c=>{const values=(c.science?[.25,1.5,4,7.5]:[.25,2,3.75]).map(t=>start+t);start+=c.seconds;return values}),frames:Record<string,unknown>[]=[]
  for(let offset=0;offset<timestamps.length;offset+=8){const sampled=await call({action:'media.frames.sample',artifactId:outputId,timestampsSeconds:timestamps.slice(offset,offset+8),maxWidth:390,maxHeight:720});assert.equal(sampled.images.length,(sampled.result.frames as unknown[]).length);for(const [index,raw]of (sampled.result.frames as unknown[]).entries()){const frame=mediaRecord(raw);assert.equal(await fingerprint(String(frame.path)),crypto.createHash('sha256').update(Buffer.from(String(mediaRecord(sampled.images[index]).data),'base64')).digest('hex'));frames.push(frame)}}
  const contacts:string[]=[];for(let offset=0;offset<frames.length;offset+=4){const page=frames.slice(offset,offset+4).map(f=>({src:'data:image/png;base64,'+fs.readFileSync(String(f.path)).toString('base64'),seconds:f.timestampSeconds})),png=await window.webContents.executeJavaScript(`(async()=>{const rows=${JSON.stringify(page)},c=document.createElement('canvas');c.width=780;c.height=1452;const x=c.getContext('2d');x.fillStyle='#0c1426';x.fillRect(0,0,780,1452);for(let i=0;i<rows.length;i++){const image=new Image();image.src=rows[i].src;await image.decode();const px=i%2*390,py=Math.floor(i/2)*726;x.drawImage(image,px,py,390,693);x.fillStyle='#ffffff';x.font='16px sans-serif';x.fillText('实际PTS '+Number(rows[i].seconds).toFixed(3)+'s',px+10,py+716)}return c.toDataURL().split(',')[1]})()`) as string,file=path.join(root,id+'-contact-'+offset/4+'.png');fs.writeFileSync(file,Buffer.from(png,'base64'));contacts.push(file)}
  const reopened=new VideoStudioStore(project.directory,sessionId).read(draft.id),document=store.readDocument(draft.id);assert.equal(document.schemaVersion,'2.9');assert.equal(reopened.exports.at(-1)!.artifactId,outputId);const documentPath=path.join(root,id+'.bmw.video.json');fs.writeFileSync(documentPath,JSON.stringify(document,null,2));const scene=reopened.scenes.find(s=>s.layers?.some(l=>l.science))!,review=await call({action:'video.studio',studioRequest:{operation:'review-export',draftId:draft.id,expectedRevision:reopened.revision,sceneId:scene.id,reviewOffset:0}});assert.ok(review.images.length>0)
  results.push({id,status:'passed',draftId:draft.id,revision:reopened.revision,duration,document:documentPath,chapters:chapters(id),output,outputSha256:await fingerprint(path.join(artifacts,outputId)),decode,audio,frames,contacts,review:review.result,visualReview:'requires-external-critical-frame-review',audioAuditioned:false});process.stderr.write('PASS '+id+' '+duration+'s editable scientific excerpt\n')
 }catch(error){exitCode=1;results.push({id,status:'failed',error:String(error)});console.error(id,error)}fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({complete:false,project,sessionId,results},null,2))}
 for(const source of sources)assert.equal(await fingerprint(source.file),source.sha256);fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({complete:exitCode===0,project,sessionId,sources,results,scope:'BMW native editable scientific excerpts; actual 720x1280/24fps MP4s; copied authorized public sources, disposable profile and mock keychain. Only displayed 75:25 / 37 /12km are cited; curve values, partitions and paths are explicitly illustrative. No paid runtime, original numerical reconstruction or audio audition.',languageModelCalls:0},null,2));console.log(JSON.stringify({root,exitCode}))
 }catch(error){exitCode=1;console.error(error)}finally{await bridge?.close();await runtime?.stop();window?.destroy();fs.rmSync(profile,{recursive:true,force:true});app.exit(exitCode)}}
void run()
