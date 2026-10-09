import crypto from 'node:crypto'
import {VideoStudioStore} from '../packages/feature-video/src/studio-store.js'
import {draftComposition,newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import type {VideoDraft} from '../packages/feature-video/src/studio-contract.js'
import {assertComposition} from '../packages/media-native/src/composition-contract.js'
import {DEFAULT_VIDEO_OPTIONS} from '../packages/media-native/src/video-options.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, session, ipcMain } from 'electron'
import { MediaController } from '../packages/media-native/src/media-controller.js'
import { BrowserKernel } from '../packages/browser-capability/src/browser-kernel.js'
import { BrowserCapabilityRegistry } from '../packages/browser-capability/src/browser-capability-registry.js'
import { createBridgeServer } from '../packages/browser-capability/src/bridge-server.js'
import {GlobalSettingsStore} from '../packages/platform/src/global-settings-store.js'
import product from '../apps/bmw/product.js'
const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-video-smoke-')))
const project={id:'video-smoke',name:'Isolated video smoke',directory:path.join(temporary,'project')}, artifacts=path.join(project.directory,'artifacts')
fs.mkdirSync(artifacts,{recursive:true}); fs.mkdirSync(path.join(temporary,'profile'));app.setPath('userData',path.join(temporary,'profile'))
let window:BrowserWindow|undefined, bridge:Awaited<ReturnType<typeof createBridgeServer>>|undefined, cancel:AbortController|undefined
let granted=true, exitCode=0
const timeout=setTimeout(()=>app.exit(1),300_000)
async function run():Promise<void>{
 try{
  await app.whenReady();const browserSession=session.fromPartition(`bmw-video-smoke-${process.pid}`)
  // Chromium tab capture on macOS requires a presented surface; hidden windows can encode black frames.
  window=new BrowserWindow({show:true,webPreferences:{session:browserSession,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  await window.loadURL('data:text/html,<title>Video fixture</title>')
  const registry=new BrowserCapabilityRegistry(product), media=new MediaController({session:browserSession,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:(value:{progress?:number})=>{if((value.progress??0)>0)cancel?.abort(new Error('E2E composition cancellation'))}})
  const kernel=new BrowserKernel({window,session:browserSession,capabilityRegistry:registry,permissionStore:{hasAgentControl:()=>granted},projectStore:{active:()=>project},artifactsDirectory:artifacts,sessionContinuity:undefined,settingsStore:new GlobalSettingsStore({filePath:path.join(temporary,'settings.json'),onState:undefined}),allowedActions:undefined,onState:undefined});kernel.setRecordingController(media)
  bridge=await createBridgeServer(kernel,{toolDefinition:registry.toolDefinition(),resolveProject:directory=>directory===project.directory?project:undefined,activeProjectId:()=>project.id})
  const headers={authorization:`Bearer ${bridge.token}`,'content-type':'application/json'}
  const binding=bridge.registerSession('video-smoke',project.directory)
  const execute=async(args:unknown)=>{const response=await fetch(`${bridge!.url}/execute`,{method:'POST',headers,body:JSON.stringify({binding,arguments:args})});const body=await response.json() as {error?:string;result:Record<string,unknown>;images:unknown[]};if(!response.ok)throw new Error(body.error);return body}
  // Two static tab captures exercise fresh native encoders and multi-cluster WebM without seek indexes.
  media.configureDisplayMedia()
  let completed:((value:unknown)=>void)=()=>{}
  ipcMain.on('media-chunk',(event,data:ArrayBuffer)=>{if(media.ownsCaptureSender(event))media.acceptChunk(data)})
  ipcMain.on('media-state',(event,value:unknown)=>{if(media.ownsCaptureSender(event))media.updateState(value)})
  ipcMain.on('media-finished',(event,value:unknown)=>{if(media.ownsCaptureSender(event))completed(media.finalize(value))})
  const staticTab={id:'static-page',projectId:project.id,source:'agent',title:'Static capture',url:'',view:{webContents:window.webContents}}
  kernel.tabs.set(staticTab.id,staticTab);kernel.activeTabId=staticTab.id
  const captured:string[]=[]
  for(const [index,color] of ['#ef1515','#15dd15'].entries()){
    await window.loadURL(`data:text/html,<style>html,body{margin:0;width:100%;height:100%;background:${encodeURIComponent(color)}}</style>`)
    const pending=new Promise<unknown>(resolve=>{completed=resolve})
    await execute({action:'media.record.start',tabId:staticTab.id,fps:24})
    await new Promise(resolve=>setTimeout(resolve,2800))
    await execute({action:'media.record.stop',tabId:staticTab.id})
    const shot=await pending as {artifactId:string;bytes:number}
    assert.ok(shot.bytes>1024);captured.push(shot.artifactId)
    const inspection=(await execute({action:'media.inspect',artifactId:shot.artifactId})).result
    assert.ok(Number(inspection.durationSeconds)>1.6)
    const frames=(await execute({action:'media.frames.sample',artifactId:shot.artifactId,timestampsSeconds:[1.6,.1]})).result.frames as {path:string;timestampSeconds:number}[]
    assert.ok(frames[0].timestampSeconds>1.4)
    for(const frame of frames){
      const pixel=await window.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src=${JSON.stringify('data:image/png;base64,'+fs.readFileSync(frame.path).toString('base64'))};await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]})()`) as number[]
      assert.ok(index===0?pixel[0]>180&&pixel[1]<60:pixel[1]>170&&pixel[0]<60,`Static recording pixels: ${pixel}`)
    }
  }
  media.window?.destroy()
  await window.loadURL('data:text/html,<title>Video fixture</title>')
  const bytes=await window.webContents.executeJavaScript(`(async()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='red';ctx.fillRect(0,0,320,180);const stream=canvas.captureStream(12);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start(250);const timer=setInterval(()=>{ctx.fillStyle='#ee0000';ctx.fillRect(0,0,320,180)},80);await new Promise(resolve=>setTimeout(resolve,1000));recorder.stop();await stopped;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]})()`) as number[]
  fs.writeFileSync(path.join(artifacts,'footage.webm'),Buffer.from(bytes))
  const wav=Buffer.alloc(44+48000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(96000,40)
  for(let index=0;index<48000;index++)wav.writeInt16LE(Math.round(Math.sin(index/48000*440*Math.PI*2)*7000),44+index*2)
  fs.writeFileSync(path.join(artifacts,'voice.wav'),wav)
  const composition={title:'产品介绍',width:640,height:360,fps:12,music:true,layers:[{id:'restricted-browser-layer',title:'Browser eased layer',kind:'rectangle',startSeconds:0,durationSeconds:2,x:.05,y:.05,width:.1,height:.1,color:'#22dd88',keyframes:[{timeSeconds:0,x:.05,y:.05,width:.1,height:.1,opacity:1,easing:'linear'},{timeSeconds:2,x:.6,y:.05,width:.1,height:.1,opacity:.6,easing:'ease-in-out',easingRange:[.2,.8]}]}],scenes:[{durationSeconds:3,title:'真实素材',label:'01 / START',crop:{x:.1,y:.1,width:.8,height:.8},playbackRate:.4,narration:'这是测试旁白。',videoArtifactId:'footage.webm',audioArtifactId:'voice.wav'},{durationSeconds:2,title:'关键收益',label:'02 / WHY',bullets:['可重复定位','浏览器原生导出']}]}
  const exported=(await execute({action:'video.compose',composition})).result
  const registration=exported.studioDraft as {id:string;revision:number;sceneCount:number};assert.ok(registration?.id)
  const studioStore=new VideoStudioStore(project.directory,'video-smoke'),editable=studioStore.read(registration.id)
  assert.deepEqual(editable.layers![0].keyframes![1].easingRange,[.2,.8],'Authenticated browser composition preserves the same restricted curve in its editable Studio draft')
  assert.equal(editable.ownerSessionId,'video-smoke');assert.deepEqual(draftComposition(editable),assertComposition(exported.composition));assert.equal(studioStore.reusableExport(editable)?.artifactId,exported.artifactId)
  const existing=(await execute({action:'video.studio',studioRequest:{operation:'render',draftId:editable.id,expectedRevision:editable.revision}})).result
  assert.equal(existing.reused,true);assert.equal((existing.export as {artifactId:string}).artifactId,exported.artifactId)
  console.log('PASS direct composition registers Session-owned editable Studio scenes and reuses the native completed MP4')
  let compact=studioStore.create('紧凑音频实测',{...DEFAULT_VIDEO_OPTIONS,aspectRatio:'16:9',resolution:'custom',width:640,height:360,fps:12,music:false,narrationPacing:'compact'})
  compact.scenes=[{...newStudioScene('compact-audio'),title:'实测音频',bullets:['保留原音频时长'],narration:'实际音轨',cardSpec:{version:1,templateId:'title/basic'}}]
  compact=studioStore.update(compact.id,compact.revision,compact)
  compact=(await execute({action:'video.studio',studioRequest:{operation:'attach',draftId:compact.id,expectedRevision:compact.revision,sceneId:'compact-audio',artifactId:'voice.wav',assetKind:'audio'}})).result as unknown as VideoDraft
  assert.equal(compact.scenes[0].audioDurationSeconds,1);assert.equal(compact.scenes[0].voiceTiming?.startSeconds,2/12);assert.equal(compact.scenes[0].durationSeconds,16/12)
  const compactOutput=(await execute({action:'video.studio',studioRequest:{operation:'render',draftId:compact.id,expectedRevision:compact.revision}})).result
  const compactExport=compactOutput.export as {artifactId:string};assert.ok(compactExport.artifactId)
  const compactAudio=(await execute({action:'media.inspect',artifactId:compactExport.artifactId})).result;assert.ok(Math.abs(Number(compactAudio.durationSeconds)-16/12)<.15)
  assert.deepEqual(studioStore.read(compact.id).scenes[0].audioGeneration?.autoTiming,compact.scenes[0].voiceTiming,'Native measured audio admits the host automatic timing receipt')
  console.log('PASS compact import: real WAV measurement, two-frame lead/tail, explicit source clock and native MP4 duration')
  assert.equal(exported.durationSeconds,5);assert.equal(exported.frames,60)
  assert.ok(Math.abs(Number(exported.actualDurationSeconds)-5)<.2)
  const inspected=(await execute({action:'media.inspect',artifactId:exported.artifactId})).result
  assert.deepEqual((inspected.tracks as {codec:string}[]).map(track=>track.codec).sort(),['aac','avc'])
  const sampled=await execute({action:'media.frames.sample',artifactId:exported.artifactId,timestampsSeconds:[1,2.8,4]})
  assert.equal(sampled.images.length,3)
  const playback=await window.webContents.executeJavaScript(`(async()=>{const v=document.createElement('video');v.muted=true;v.src=${JSON.stringify('data:video/mp4;base64,'+fs.readFileSync(String(exported.path)).toString('base64'))};await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject});await v.play();await new Promise(resolve=>setTimeout(resolve,120));v.pause();return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,time:v.currentTime}})()`) as {duration:number;width:number;height:number;time:number}
  assert.equal(playback.width,640);assert.equal(playback.height,360);assert.ok(playback.time>0)
  // Independently decode AAC and ensure a non-silent, unclipped signal reaches the final container.
  const audio=await window.webContents.executeJavaScript(`(async()=>{const context=new AudioContext();const bytes=Uint8Array.from(${JSON.stringify([...fs.readFileSync(String(exported.path))])});const buffer=await context.decodeAudioData(bytes.buffer);let peak=0,energy=0;for(const sample of buffer.getChannelData(0)){peak=Math.max(peak,Math.abs(sample));energy+=sample*sample}await context.close();return {peak,rms:Math.sqrt(energy/buffer.length),duration:buffer.duration}})()`) as {peak:number;rms:number;duration:number}
  assert.ok(audio.peak>.1 && audio.peak<1);assert.ok(audio.rms>.02)
  const segmented=(await execute({action:'video.compose',composition:{title:'Sequential real clips',width:640,height:360,fps:12,music:false,scenes:[{title:'Two shots',durationSeconds:4,visualSegments:[{videoArtifactId:captured[0],durationSeconds:2,sourceStartSeconds:.1},{videoArtifactId:captured[1],durationSeconds:2,sourceStartSeconds:.1,transition:'fade',transitionSeconds:.3}]}]}})).result
  assert.equal(segmented.frames,48);assert.ok(Math.abs(Number(segmented.actualDurationSeconds)-4)<.2);assert.ok(segmented.verificationArtifactId)
  const pieces=(await execute({action:'media.frames.sample',artifactId:segmented.artifactId,timestampsSeconds:[1.5,2.08334,2.5]})).result.frames as {path:string}[],pixels:number[][]=[]
  for(const piece of pieces)pixels.push(await window.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src=${JSON.stringify('data:image/png;base64,'+fs.readFileSync(piece.path).toString('base64'))};await image.decode();const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');x.drawImage(image,0,0);return [...x.getImageData(320,180,1,1).data]})()`) as number[])
  assert.ok(pixels[0][0]>150&&pixels[0][1]<70,'First real clip stays red');assert.ok(pixels[2][1]>150&&pixels[2][0]<70,'Second real clip switches to green');assert.ok(pixels[1][1]<pixels[2][1]-60,'Actual encoded fade has intermediate opacity')
  console.log('PASS two real Video segments: serial decoder switch, fixed four-second duration, frame/color/fade verification and durable receipt',pixels)
  const cardImage=await window.webContents.executeJavaScript("(()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');x.fillStyle='#ee3333';x.fillRect(0,0,640,360);x.fillStyle='white';x.font='32px sans-serif';x.fillText('Controlled source image',40,180);return c.toDataURL('image/png').split(',')[1]})()") as string
  fs.writeFileSync(path.join(artifacts,'card-source.png'),Buffer.from(cardImage,'base64'))
  const cards=[
   {title:'模板目录',bullets:['八类表达方式'],cardSpec:{version:1,templateId:'title/basic',motion:'fade-in'}},
   {title:'三个结论',bullets:['结构明确','内容有界','原生渲染'],cardSpec:{version:1,templateId:'points/three',motion:'reveal-items'}},
   {title:'两项对比',bullets:['文字模板','素材模板'],cardSpec:{version:1,templateId:'comparison/two'}},
   {title:'数字强调',bullets:['受控测试数值'],cardSpec:{version:1,templateId:'metric/hero',value:44,decimals:0,unit:'%',motion:'count-up'}},
   {title:'原文证据',bullets:['受控截图素材'],imageArtifactId:'card-source.png',cardSpec:{version:1,templateId:'evidence/screenshot'}},
   {title:'真实录屏',videoArtifactId:captured[0],cardSpec:{version:1,templateId:'demo/recording'}},
   {title:'静态图解',imageArtifactId:'card-source.png',cardSpec:{version:1,templateId:'diagram/image',motion:'slow-push'}},
   {title:'顺序素材',visualSegments:[{imageArtifactId:'card-source.png',durationSeconds:1},{videoArtifactId:captured[1],durationSeconds:1}],cardSpec:{version:1,templateId:'media/sequence'}}
  ].map(scene=>({...scene,durationSeconds:2}))
  for(const [width,height] of [[640,360],[360,640]])for(const cardLayout of ['standard','news'] as const){
   const output=(await execute({action:'video.compose',composition:{title:'八类卡片原生验收\n统一栏目标题',cardLayout,width,height,fps:12,music:false,watermark:{enabled:cardLayout==='news',text:'BMW',position:'top-right'},scenes:cards}})).result
   assert.equal(output.frames,192);assert.ok(Math.abs(Number(output.actualDurationSeconds)-16)<.2)
   const registered=output.studioDraft as {id:string};assert.deepEqual(studioStore.read(registered.id).scenes.map(s=>s.cardSpec?.templateId),cards.map(s=>s.cardSpec.templateId),'Native cards retain an editable Session-owned draft')
   assert.equal(studioStore.read(registered.id).cardLayout,cardLayout,'Global layout survives native composition registration')
   const samples=(await execute({action:'media.frames.sample',artifactId:output.artifactId,timestampsSeconds:cards.map((_,i)=>i*2+1.5)})).result.frames as {path:string}[]
   assert.equal(samples.length,8);for(const sample of samples)assert.ok(fs.statSync(sample.path).size>1000,'Each category produces a real decoded frame')
   if(process.env.BMW_VALIDATION_DIR){const name=`eight-cards-${cardLayout}-${width}x${height}`;fs.mkdirSync(process.env.BMW_VALIDATION_DIR,{recursive:true});fs.copyFileSync(String(output.path),path.join(process.env.BMW_VALIDATION_DIR,name+'.mp4'));samples.forEach((sample,i)=>fs.copyFileSync(sample.path,path.join(process.env.BMW_VALIDATION_DIR!,name+`-${i}.png`)))}
  }
  const source={artifactId:'card-source.png',sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(artifacts,'card-source.png'))).digest('hex')},rect={x:.1,y:.1,width:.4,height:.3},reading={mode:'sequence',targets:[{source,rect,name:'一处'},{source,rect:{x:.5,y:.5,width:.4,height:.3},name:'另一处'}],returnToWhole:true},quote={excerpt:'Controlled original quote.',translation:'明确标注的编辑译文',attribution:'受控测试来源 · 测试人物',display:'staged'}
  const detailedCards=[
    {title:'实际像素反白',imageArtifactId:source.artifactId,cardSpec:{version:2,templateId:'evidence/highlight',highlights:[{source,rects:[rect],name:'第一重点',style:'invert',startSeconds:0,endSeconds:4}]}},
    {title:'两处阅读',imageArtifactId:source.artifactId,cardSpec:{version:2,templateId:'evidence/reading',reading}},
    {title:'原文与译文',imageArtifactId:source.artifactId,cardSpec:{version:2,templateId:'evidence/translation',quote}},
    {title:'右侧人物引述',imageArtifactId:source.artifactId,cardSpec:{version:2,templateId:'evidence/person-quote',quote,person:{artifactId:source.artifactId,name:'测试人物',role:'合成测试素材',layout:'right'}}},
    {title:'角标人物引述',imageArtifactId:source.artifactId,cardSpec:{version:2,templateId:'evidence/person-quote',quote,person:{artifactId:source.artifactId,name:'测试人物',role:'合成测试素材',layout:'corner'}}},
    {title:'数字退回依据',imageArtifactId:source.artifactId,cardSpec:{version:2,templateId:'metric/backdrop',motion:'count-up',value:44,decimals:0,unit:'%',phase:'to-evidence',holdSeconds:1.2}},
    {title:'整句关键词',imageArtifactId:source.artifactId,cardSpec:{version:2,templateId:'title/emphasis',motion:'wipe'}},
    {title:'图解读图',imageArtifactId:source.artifactId,cardSpec:{version:2,templateId:'diagram/image',reading}},
    {title:'对象共同目标',cardSpec:{version:2,templateId:'diagram/to-target',motion:'reveal-items',objects:[{label:'对象一'},{label:'对象二'},{label:'对象三'}],target:{label:'共同目标'},relation:'条件下的关系'}},
    {title:'符号范围',cardSpec:{version:2,templateId:'diagram/range',range:{mode:'symbolic',axisLabel:'说明关系',regionLabel:'已达区域',thresholdLabels:['目标'],condition:'仅为示意，不代表实测进度'}}},
    {title:'真实数值范围',cardSpec:{version:2,templateId:'diagram/range',range:{mode:'numeric',axisLabel:'受控测试数值',minimum:0,maximum:100,start:0,end:44,thresholds:[60,80],unit:'%',condition:'合成测试数据，非产品性能'}}}
  ].map(scene=>({...scene,durationSeconds:4}))
  for(const [width,height]of [[640,360],[360,640]]){
    const output=(await execute({action:'video.compose',composition:{title:'新增变体 · 原生验收',cardLayout:'news',width,height,fps:12,music:false,watermark:{enabled:false},scenes:detailedCards}})).result
    assert.equal(output.frames,528);const samples: {path:string}[]=[]
    for(let start=0;start<detailedCards.length;start+=8)samples.push(...(await execute({action:'media.frames.sample',artifactId:output.artifactId,timestampsSeconds:detailedCards.slice(start,start+8).map((_,i)=>(start+i)*4+1.5)})).result.frames as {path:string}[])
    assert.equal(samples.length,detailedCards.length)
    const first=fs.readFileSync(samples[0].path).toString('base64'),pixel=await window.webContents.executeJavaScript('(async()=>{const image=new Image();image.src="data:image/png;base64,'+first+'";await image.decode();const c=document.createElement("canvas");c.width=image.width;c.height=image.height;const x=c.getContext("2d");x.drawImage(image,0,0);const W=720*'+width+'/'+height+',margin=W<600?24:48,scale=Math.min((W-margin*2)/640,362/360),dx=(W-640*scale)/2+.3*640*scale,dy=236+(362-360*scale)/2+.2*360*scale;return [...x.getImageData(Math.floor(dx*'+height+'/720),Math.floor(dy*'+height+'/720),1,1).data]})()') as number[]
    assert.ok(pixel[0]<65&&pixel[1]>150&&pixel[2]>150,'Original red source pixels actually invert to cyan: '+pixel.join(','))
    if(process.env.BMW_VALIDATION_DIR){fs.copyFileSync(String(output.path),path.join(process.env.BMW_VALIDATION_DIR,'detailed-'+width+'x'+height+'.mp4'));samples.forEach((sample,i)=>fs.copyFileSync(sample.path,path.join(process.env.BMW_VALIDATION_DIR!,'detailed-'+width+'x'+height+'-'+i+'.png')))}
  }
  const beforeStale=fs.readdirSync(artifacts).sort();await assert.rejects(execute({action:'video.compose',composition:{title:'stale',width:640,height:360,fps:12,music:false,scenes:[{...detailedCards[0],cardSpec:{...detailedCards[0].cardSpec,highlights:[{source:{...source,sha256:'0'.repeat(64)},rects:[rect],name:'stale',style:'invert',startSeconds:0,endSeconds:4}]}}]}}),/STALE/);assert.deepEqual(fs.readdirSync(artifacts).sort(),beforeStale)
  console.log('PASS detailed variants: both aspect ratios, actual inverted pixels, two reading targets, quote/translation, both person positions, count/backdrop, wipe, diagrams, numeric/symbolic range and stale-source rollback')
  console.log('PASS eight native card categories: landscape/portrait real MP4 decode and editable Session-owned persistence')
  await execute({action:'video.settings',settingsRequest:{operation:'save-template',name:'竖屏品牌',options:{aspectRatio:'9:16',resolution:'720p',fps:12,music:false,style:'clean-light',watermark:{text:'MARK',position:'top-right',size:32,opacity:1}}}})
  const optionsCase={title:'模板制作',templateName:'竖屏品牌',scenes:[{durationSeconds:1,title:'模板测试',label:'TEST'}]}
  const withMark=(await execute({action:'video.compose',composition:optionsCase})).result
  const withoutMark=(await execute({action:'video.compose',composition:{...optionsCase,watermark:{enabled:false}}})).result
  const decodePixels=async(output:Record<string,unknown>)=>window!.webContents.executeJavaScript(`(async()=>{const v=document.createElement('video');v.muted=true;v.src=${JSON.stringify('data:video/mp4;base64,'+fs.readFileSync(String(output.path)).toString('base64'))};await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject});await v.play();await new Promise(resolve=>setTimeout(resolve,100));v.pause();const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);return {width:v.videoWidth,height:v.videoHeight,background:[...x.getImageData(5,5,1,1).data],watermark:[...x.getImageData(400,0,290,75).data]}})()` ) as Promise<{width:number;height:number;background:number[];watermark:number[]}>
  const on=await decodePixels(withMark),off=await decodePixels(withoutMark)
  assert.deepEqual([on.width,on.height],[720,1280]);assert.ok(on.background.slice(0,3).every(value=>value>240),'Light template is rendered in the MP4: '+JSON.stringify({pixel:on.background,composition:withMark.composition}))
  let changedPixels=0;for(let i=0;i<on.watermark.length;i+=4)if(Math.abs(on.watermark[i]-off.watermark[i])>30)changedPixels++
  assert.ok(changedPixels>100,'Watermark enable/disable changes independently decoded video pixels')
  const square=(await execute({action:'video.compose',composition:{...optionsCase,aspectRatio:'1:1',resolution:'custom',width:480,height:480,style:'minimal',watermark:{enabled:false}}})).result
  const squarePixels=await window.webContents.executeJavaScript(`(async()=>{const v=document.createElement('video');v.src=${JSON.stringify('data:video/mp4;base64,'+fs.readFileSync(String(square.path)).toString('base64'))};await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject});v.muted=true;await v.play();await new Promise(resolve=>setTimeout(resolve,100));v.pause();const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.drawImage(v,0,0);return {width:v.videoWidth,height:v.videoHeight,pixel:[...x.getImageData(0,0,1,1).data]}})()`) as {width:number;height:number;pixel:number[]}
  assert.deepEqual([squarePixels.width,squarePixels.height],[480,480]);assert.ok(squarePixels.pixel.slice(0,3).every(value=>value<25),'Explicit minimal style overrides light template')
  await assert.rejects(execute({action:'video.compose',composition:{...optionsCase,templateName:'不存在'}}),/找不到/)
  granted=false;await assert.rejects(execute({action:'video.compose',composition}),/agent control/);granted=true
  const before=fs.readdirSync(artifacts).sort()
  await assert.rejects(execute({action:'video.compose',composition:{...composition,layers:[],scenes:[{...composition.scenes[0],durationSeconds:1}]}}),{name:'Error',message:'旁白实测音频的播放区间超过镜头；请延长镜头或明确修剪旁白。'})
  await assert.rejects(execute({action:'video.compose',composition:{...composition,scenes:[{...composition.scenes[0],videoArtifactId:'../outside.webm'}]}}),/artifactId/)
  await assert.rejects(execute({action:'video.compose',composition:{...composition,layers:[{...composition.layers[0],keyframes:[composition.layers[0].keyframes[0],{...composition.layers[0].keyframes[1],easingRange:[.8,.2]}]}]}}),/range/)
  assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
  cancel=new AbortController();await assert.rejects(kernel.execute({action:'video.compose',composition},{signal:cancel.signal}),/cancellation/);cancel=undefined
  assert.equal(media.isCaptureActive(),false);assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
  await execute({action:'media.inspect',artifactId:exported.artifactId})
  console.log(JSON.stringify({ok:true,soleTool:registry.toolDefinition().name,frames:60,duration:exported.actualDurationSeconds,playback,audio,templates:'portrait and custom square exported; explicit overrides and watermark pixels verified',cancellation:'clean',narrationOverflow:'rejected without truncation'}))
 }catch(error:unknown){console.error(error);exitCode=1}
 finally{clearTimeout(timeout);await bridge?.close();window?.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.exit(exitCode)}
}
void run()
