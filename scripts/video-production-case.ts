import { dshConfiguration } from '../packages/harness-dsh/index.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { MediaController } from '../packages/media-native/src/media-controller.js'
import { BrowserKernel } from '../packages/browser-capability/src/browser-kernel.js'
import { BrowserCapabilityRegistry } from '../packages/browser-capability/src/browser-capability-registry.js'
import { createBridgeServer } from '../packages/browser-capability/src/bridge-server.js'
import product from '../apps/bmw/product.js'
import { DshRuntime, resolveDshHome } from '../packages/harness-dsh/index.js'
import type { MediaComposition } from '../packages/media-native/src/composition-contract.js'
if (process.env.BMW_VIDEO_CASE !== '1') throw new Error('Set BMW_VIDEO_CASE=1 for the real Arena/TTS/model production case.')
const root = path.resolve(import.meta.dirname, '..')
const workspace = path.join(root, '.bmw-runtime/video-cases/arena-2026-10-02')
const artifacts = path.join(workspace,'artifacts')
fs.mkdirSync(artifacts,{recursive:true,mode:0o700})
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'bmw-video-case-'))
fs.mkdirSync(path.join(temporary,'profile'))
app.setPath('userData',path.join(temporary,'profile'))
const mode = process.env.BMW_VIDEO_CASE_MODE ?? 'capture'
let window: BrowserWindow | undefined, bridge: Awaited<ReturnType<typeof createBridgeServer>> | undefined, runtime: DshRuntime | undefined
let exitCode = 0
const timeout = setTimeout(() => { console.error('Video case exceeded 20 minutes.'); app.exit(1) },1_200_000)
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object'); return value as Record<string,unknown> }
function save(name: string, value: unknown): void { fs.writeFileSync(path.join(workspace,name),JSON.stringify(value,null,2)+'\n') }
async function run(): Promise<void> {
 try {
  await app.whenReady()
  const browserSession = session.fromPartition(`bmw-video-case-${process.pid}`)
  if (process.env.HTTPS_PROXY) await browserSession.setProxy({proxyRules:process.env.HTTPS_PROXY})
  window = new BrowserWindow({show:mode.startsWith('capture'),width:1440,height:850,webPreferences:{session:browserSession,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  const project = {id:'arena-video-case',name:'Arena web introduction',directory:workspace}
  const registry = new BrowserCapabilityRegistry(product)
  const kernel = new BrowserKernel({window,session:browserSession,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>project},artifactsDirectory:artifacts,capabilityRegistry:registry,settingsStore:{snapshot:()=>({edgeNarrationEnabled:process.env.BMW_EDGE_TTS_CONSENT==='1'})},sessionContinuity:undefined,allowedActions:undefined,onState:undefined})
  const media = new MediaController({session:browserSession,preloadPath:path.join(root,'packages/media-native/src/preload/media-preload.cjs'),pagePath:path.join(root,'packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:(value:Record<string,unknown>)=>{if(value.progress!==undefined) console.log(`${value.action}: ${Math.round(Number(value.progress)*100)}%`)}})
  kernel.setRecordingController(media)
  bridge = await createBridgeServer({ async execute(input: unknown, options?: {signal?:AbortSignal}) {
    const args=record(input), result=await kernel.execute(input, options)
    if(args.action==='video.compose' && (mode==='review'||mode==='polish')) {
      const exportResult=record(result)
      const nextVersion=`v${Number((process.env.BMW_VIDEO_VERSION??'v1').slice(1))+1}`
      save(`export-${nextVersion}.json`,exportResult);save(`composition-${nextVersion}.json`,exportResult.composition)
    }
    return result
  } },{toolDefinition:registry.toolDefinition(),resolveProject:directory=>directory===workspace?project:undefined,activeProjectId:()=>project.id})
  const headers = {authorization:`Bearer ${bridge.token}`,'content-type':'application/json'}
  const binding=bridge.registerSession('arena-video-production',workspace)
  const calls: unknown[] = []
  const execute = async (args: unknown) => {
    const response=await fetch(`${bridge!.url}/execute`,{method:'POST',headers,body:JSON.stringify({binding,arguments:args})})
    const body=record(await response.json()); if(!response.ok) throw new Error(String(body.error))
    calls.push({arguments:args,result:body.result,images:Array.isArray(body.images)?body.images.length:0}); save(`${mode}-calls.json`,calls)
    return record(body.result)
  }
  if(mode==='capture'||mode==='capture-task'||mode==='capture-focus') {
    const tab={id:'arena-source',projectId:project.id,source:'agent',title:'Arena leaderboard',url:'https://arena.ai/leaderboard',view:{webContents:window.webContents}}
    kernel.tabs.set(tab.id,tab);kernel.activeTabId=tab.id
    const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
    const load = async (url: string) => {
      const loading = window!.loadURL(url).catch(error => console.log('Page load:',error.message))
      for(let attempt=0;attempt<90;attempt++) {
        await delay(1000)
        const visible = await window!.webContents.executeJavaScript('document.body?.innerText ?? ""') as string
        const ready = url.includes('webdev') ? /Code Arena[\s\S]*WebDev/.test(visible) : url.includes('pareto') ? /Pareto/.test(visible) && visible.length>1000 : /Measuring AI/.test(visible)
        if(ready){window!.webContents.stop();await delay(1000);return}
        if(/Something went wrong|verify you are human|Access denied/i.test(visible))throw new Error(`Arena data unavailable: ${url}`)
      }
      await loading
      throw new Error(`Arena page readiness exceeded 90 seconds: ${url}`)
    }
    await load(tab.url)
    const text=await window.webContents.executeJavaScript('document.body.innerText') as string
    fs.writeFileSync(path.join(workspace,'arena-overview-visible.txt'),text)
    console.log(text.slice(0,450))
    const screenshot=await execute({action:'media.screenshot',tabId:tab.id,filename:'arena-overview.png'})
    console.log('Arena screenshot:',screenshot.path)
    const links=await window.webContents.executeJavaScript('[...document.querySelectorAll("a[href]")].map(a=>({text:a.innerText,url:a.href})).filter(a=>a.url.includes("leaderboard"))')
    save('arena-links.json',links)
    if(/just a moment|verify you are human|access denied/i.test(text) || !/leaderboard/i.test(text)) throw new Error('Arena did not expose real leaderboard content; no mock footage substituted.')
    media.configureDisplayMedia()
    ipcMain.on('media-chunk',(event,data:ArrayBuffer)=>{if(media.ownsCaptureSender(event))media.acceptChunk(data)})
    ipcMain.on('media-state',(event,state:unknown)=>{if(media.ownsCaptureSender(event))media.updateState(state)})
    let finished:(value:unknown)=>void=()=>{}
    ipcMain.on('media-finished',(event,summary:unknown)=>{if(media.ownsCaptureSender(event))finished(media.finalize(summary))})
    const shots=[]
    for(const [index,url] of (mode==='capture-task'?['https://arena.ai/leaderboard']:mode==='capture-focus'?['https://arena.ai/leaderboard/code/webdev','https://arena.ai/leaderboard/agent/pareto']:['https://arena.ai/leaderboard','https://arena.ai/leaderboard/code/webdev','https://arena.ai/leaderboard/agent/pareto']).entries()) {
      await load(url); tab.url=window.webContents.getURL()
      const visible=await window.webContents.executeJavaScript('document.body.innerText') as string
      fs.writeFileSync(path.join(workspace,`${mode}-arena-${index}-visible.txt`),visible)
      if(/Something went wrong|just a moment|verify you are human/i.test(visible))throw new Error(`Arena source page failed: ${url}; no error page recorded as successful footage.`)
      await execute({action:'media.screenshot',tabId:tab.id,filename:`arena-${index}.png`})
      const pending=new Promise<unknown>(resolve=>{finished=resolve})
      await execute({action:'media.record.start',tabId:tab.id,fps:24}); await delay(2500)
      if(mode==='capture-task'){
        for(const text of ['Best Text Models','Best WebDev Models','Best Overall Agents']){
          await execute({action:'click',tabId:tab.id,text});await delay(4000)
          const content=await window.webContents.executeJavaScript('document.body.innerText') as string
          if(/Something went wrong|verify you are human/i.test(content))throw new Error('Task tab failed to expose Arena data.')
          fs.writeFileSync(path.join(workspace,`task-${text.replaceAll(' ','-')}-visible.txt`),content)
        }
      }else if(mode==='capture-focus'){await delay(6000)}else for(let step=0;step<4;step++){await window.webContents.executeJavaScript(`(() => { const candidates=[document.scrollingElement,...document.querySelectorAll('main, [data-radix-scroll-area-viewport], div')].filter(el=>el.scrollHeight>el.clientHeight+100 && el.clientHeight>300); const target=candidates.sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];target?.scrollBy({top:${step<2?180:-180},behavior:'smooth'}) })()`);await delay(1500)}
      await execute({action:'media.record.stop',tabId:tab.id}); const shot=record(await pending)
      const info=await execute({action:'media.inspect',artifactId:shot.artifactId})
      shots.push({...shot,url:tab.url,metadata:info});save(mode==='capture-task'?'task-recordings.json':mode==='capture-focus'?'focus-recordings.json':'recordings.json',shots)
    }
    console.log('Real Arena browser recordings captured:',workspace)
  } else if(mode==='diagnose') {
    const recordings=JSON.parse(fs.readFileSync(path.join(workspace,'recordings.json'),'utf8')) as {artifactId:string}[]
    for (const recording of recordings) for (const time of [.1,1,2,4,7]) {
      try { const frames=await execute({action:'media.frames.sample',artifactId:recording.artifactId,timestampsSeconds:[time]});console.log(recording.artifactId,time,'ok',JSON.stringify(frames.frames)) }
      catch(error:unknown){console.log(recording.artifactId,time,'ERROR',error instanceof Error?error.message:String(error))}
    }
  } else if(mode==='narrate') {
    const composition=JSON.parse(fs.readFileSync(path.join(workspace,'composition-v1.json'),'utf8')) as MediaComposition
    for(const [index,scene] of composition.scenes.entries()) {
      if(scene.audioArtifactId && fs.existsSync(path.join(artifacts,scene.audioArtifactId)))continue
      const audio=await execute({action:'video.narrate',narrationRequest:{text:scene.narration,provider:'local-matcha',voice:'local-zh-en',ratePercent:15}})
      console.log(`Narration ${index+1}: ${audio.durationSeconds}s`)
      scene.audioArtifactId=String(audio.artifactId)
      save('composition-v1.json',composition)
    }
  } else if(mode==='compose'||mode==='verify') {
    const version=process.env.BMW_VIDEO_VERSION??'v1'
    const composition=JSON.parse(fs.readFileSync(path.join(workspace,`composition-${version}.json`),'utf8')) as MediaComposition
    const result=mode==='verify'?record(JSON.parse(fs.readFileSync(path.join(workspace,`export-${version}.json`),'utf8'))):await execute({action:'video.compose',composition})
    save(`export-${version}.json`,result)
    console.log('Video exported:',result.path)
    const frames=await execute({action:'media.frames.sample',artifactId:result.artifactId,timestampsSeconds:[3,22,42,62,82,102,118]})
    save(`frames-${version}.json`,frames)
    await window.loadURL('data:text/html,<title>Independent MP4 playback</title>')
    const playback=await window.webContents.executeJavaScript(`(async()=>{const video=document.createElement('video');video.muted=true;video.src=${JSON.stringify('data:video/mp4;base64,'+fs.readFileSync(String(result.path)).toString('base64'))};await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject});await video.play();await new Promise(resolve=>setTimeout(resolve,300));video.pause();return {duration:video.duration,width:video.videoWidth,height:video.videoHeight,time:video.currentTime}})()`)
    save(`playback-${version}.json`,playback);assert.ok(Number(record(playback).time)>0)
    const audio=await window.webContents.executeJavaScript(`(async()=>{const context=new AudioContext();const response=await fetch(${JSON.stringify('data:video/mp4;base64,'+fs.readFileSync(String(result.path)).toString('base64'))});const decoded=await context.decodeAudioData(await response.arrayBuffer());let peak=0,energy=0;for(const sample of decoded.getChannelData(0)){peak=Math.max(peak,Math.abs(sample));energy+=sample*sample}await context.close();return {duration:decoded.duration,peak,rms:Math.sqrt(energy/decoded.length),channels:decoded.numberOfChannels}})()`)
    save(`audio-${version}.json`,audio);assert.ok(Number(record(audio).peak)>.1&&Number(record(audio).peak)<1);assert.ok(Number(record(audio).rms)>.01)

  } else if((mode==='review'||mode==='polish')) {
    const sourceHome=path.join(temporary,'credential-source');fs.mkdirSync(sourceHome)
    const credentials=path.join(resolveDshHome(),'.credentials.yaml')
    if(fs.existsSync(credentials))fs.copyFileSync(credentials,path.join(sourceHome,'.credentials.yaml'))
    const patch=path.join(temporary,'review.patch.yml')
    fs.writeFileSync(patch,fs.readFileSync(dshConfiguration.patchPath,'utf8')+'\n- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-flash\n    reasoningEffort: low\n- id: llm-deepseek\n  config:\n    baseURL: https://api.deepseek.com/anthropic\n    maxTokens: 8192\n    reasoningEffort: low\n',{mode:0o600})
    runtime=new DshRuntime({...dshConfiguration,productId:product.id,presetId:product.id,patchPath:patch,dshHome:path.join(temporary,'dsh-home'),sourceDshHome:sourceHome,workspacePath:workspace,workspaceTitle:'Arena video review',mcpServerPath:path.join(root,'packages/browser-capability/src/browser-mcp-server.js'),bridgeUrl:bridge.url,bridgeToken:bridge.token})
    await runtime.start()
    const created=record(await runtime.createProjectSession({directory:workspace,name:'Arena video review'}))
    const version=process.env.BMW_VIDEO_VERSION??'v1', result=JSON.parse(fs.readFileSync(path.join(workspace,`export-${version}.json`),'utf8')) as {artifactId:string;composition:MediaComposition}
    const prompt=`你是 BMW 视频审片 Agent。请用唯一工具 browser，先 media.inspect 检查 ${result.artifactId} 的时长和音视频轨，再 media.frames.sample 抽取 [3,22,42,62,82,102,118] 秒的图片。只能根据实际工具返回的图片评价视觉效果；音轨检查只证明存在，无法听音频，禁止假装已听过旁白。视频是 Arena leaderboard 中文入门介绍，目标约120秒。脚本/分镜如下：${JSON.stringify(result.composition)}。评估吸引力、文字可读性、屏幕录制真实性、字幕/画面匹配、结构节奏、信息准确性。请返回简短完整 JSON（不超过1200字，不要开场白）：score(0..10), strengths[], issues[{sceneIndex,problem,evidence,priority}], improvements[{sceneIndex,title?,label?,bullets?,zoom?,reason}], limitations[]。改进建议应能通过 video.compose 的分镜字段落实；不要声称只看7帧就验证了完整动态或音频。`
    const response=await runtime.promptAndWait(String(created.sessionId),prompt,{timeoutMs:240_000})
    const history=record(await runtime.call('session.history',{sessionId:created.sessionId}))
    const events=(history.events as unknown[]).map(row=>record(record(row).event))
    const headers=events.filter(event=>event.type==='request/header').map(event=>record(event.data))
    assert.ok(headers.length>0 && headers.every(header=>{const tools=record(header.header).tools;return Array.isArray(tools)&&tools.length===1&&record(tools[0]).name==='browser'}))
    const toolCalls=events.filter(event=>event.type==='tool/call').map(event=>record(event.data))
    assert.ok(toolCalls.some(call=>String(call.arguments).includes('media.frames.sample')||JSON.stringify(call.arguments).includes('media.frames.sample')))
    save(`review-${version}.json`,{date:new Date().toISOString(),model:'deepseek-flash',harness:'DSH',response,headers,toolCalls})
    console.log(response)
    if(['v1','v2','v3','v4'].includes(version)) {
      const nextVersion=`v${Number(version.slice(1))+1}`
      const plan=version!=='v1'?JSON.parse(fs.readFileSync(path.join(workspace,`composition-${nextVersion}-plan.json`),'utf8')):undefined
      const improvementPrompt=mode==='polish'?`请原样使用以下完整 composition 调用 browser video.compose，不得自行调整 crop、zoom 或其他参数。这一轮只修正上一版成本图横轴被裁切的问题：第六场改为给定取景并关闭放大，确保 Median cost per task 标题和 $5/$2/$1 等成本刻度完整入画，其余保持不变。分镜：${JSON.stringify(plan)}。实际生成后 media.inspect 并 media.frames.sample [102,108,111]，只根据图片检查横轴是否完整。返回简短 JSON {artifactId,appliedChanges,axisVisible,remainingIssues,limitations}，不要声称收听音频。`:`${plan ? '本轮补充了分类切换的真实录屏，并支持 crop（归一化矩形）与 playbackRate（只重定时静音画面）。结合你的评估，按以下修订分镜实际合成下一版，所有来源都是当前 Project 的实录资产。原始录制为2026.10.02，补录跨入10.03，以给定分镜label日期为准，不能改为网页数据更新日期。修订建议分镜：'+JSON.stringify(plan)+'。必须采用给定真实录屏、降速延续画面、可读取景和正确日期，表头与坐标轴均应完整。Rank Spread 是名次区间，Score 的加减范围是另外的字段，不可混淆；除非实际失败需要修正，请保留给定的 crop、playbackRate 和旁白。' : ''}请按你刚才基于实际图片提出的最高优先级建议，改进并实际生成第二版。必须调用 browser 的 video.compose，composition 使用刚才提供的完整分镜；保留120秒总时长、真实录屏和现有旁白音频（本轮不得重新生成旁白、不得更改旁白文本），允许改动 title、label、bullets、zoom、crop、playbackRate，允许调节现有视频 sourceStartSeconds 来避免字幕与内容冲突。每条重点建议都应体现在修改字段里；不要只写建议。完成后，调用 media.inspect 和 media.frames.sample [3,22,42,62,82,102,118] 复查你生成的 artifactId，返回简短完整 JSON（最多1500字，勿省略结尾）：artifactId, appliedChanges[{sceneIndex,field,before,after,reason}], beforeScore, afterScore, remainingIssues[], limitations[]。只有抽帧视觉评估，不要声称听过音频或看过完整动态。改进应提升信息可读性和开头吸引力，而非夸大当前名次。`
      const improved=await runtime.promptAndWait(String(created.sessionId),improvementPrompt,{timeoutMs:600_000})
      const improvedHistory=record(await runtime.call('session.history',{sessionId:created.sessionId}))
      const improvedEvents=(improvedHistory.events as unknown[]).map(row=>record(record(row).event))
      const improvedCalls=improvedEvents.filter(event=>event.type==='tool/call').map(event=>record(event.data))
      assert.ok(improvedCalls.some(call=>JSON.stringify(call.arguments).includes('video.compose')), 'BMW must actually render an improved video')
      assert.ok(fs.existsSync(path.join(workspace,`export-${nextVersion}.json`)))
      save(`improvement-${nextVersion}.json`,{date:new Date().toISOString(),model:'deepseek-flash',harness:'DSH',response:improved,toolCalls:improvedCalls})
      console.log(improved)
    }
  } else throw new Error('Unsupported video case mode.')
 } catch(error:unknown) {exitCode=1;console.error(error);save(`${mode}-error.json`,{error:error instanceof Error?error.message:String(error)})}
 finally {clearTimeout(timeout);runtime?.stop();await bridge?.close();window?.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.exit(exitCode)}
}
void run()
