import {runRecordingWorkflowCase} from './recording-workflow-case.js'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {PageRecordingEvents} from '../packages/browser-capability/src/page-recording-events.js'
import {MAX_CAPTURE_BYTES} from '../packages/media-native/src/capture-policy.js'
import {assertRecordingEvents} from '../packages/media-native/src/recording-contract.js'
import { app, BrowserWindow, session, ipcMain } from 'electron'
import { BrowserKernel } from '../packages/browser-capability/src/browser-kernel.js'
import { MediaController } from '../packages/media-native/src/media-controller.js'

const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-media-smoke-')))
const userDataDirectory = path.join(temporaryRoot, 'user-data')
const projectDirectory = path.join(temporaryRoot, 'project')
fs.mkdirSync(userDataDirectory, { recursive: true, mode: 0o700 })
fs.mkdirSync(projectDirectory, { recursive: true, mode: 0o700 })
app.setPath('userData', userDataDirectory)
app.commandLine.appendSwitch('disable-gpu')
process.on('uncaughtException',error=>{process.stderr.write('[BMW media smoke] UNCAUGHT '+String(error.stack??error)+'\n');app.exit(1)})
process.on('unhandledRejection',reason=>{process.stderr.write('[BMW media smoke] UNHANDLED '+String(reason)+'\n');app.exit(1)})
app.once('will-finish-launching', () => process.stderr.write('[BMW media smoke] Electron will finish launching\n'))
app.once('ready', () => process.stderr.write('[BMW media smoke] Electron ready event\n'))

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const video = Buffer.from('BMW browser-native media smoke fixture')

interface MediaDiscovery { items: Array<{ url?: string }> }
interface ScreenshotArtifact { path: string; width: number; height: number }
interface DownloadArtifact { path: string; contentType: string; bytes: number }
interface CapturedArtifact extends DownloadArtifact { complete: boolean; stopReason: string; videoTracks: number }

function send(response: http.ServerResponse, contentType: string, body: string | Buffer): void {
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

const server = http.createServer((request, response) => {
  if (request.url === '/image.png') return send(response, 'image/png', image)
  if (request.url === '/poster.png') return send(response, 'image/png', image)
  if (request.url === '/video.mp4') return send(response, 'video/mp4', video)
  return send(response, 'text/html; charset=utf-8', `<!doctype html>
    <meta charset="utf-8"><title>BMW Media Smoke</title>
    <style>body{margin:0;padding:32px;background:#101722;color:white;font:16px sans-serif}article{width:560px;padding:24px;border:1px solid #49c9a5;border-radius:16px}img,video{display:block;width:320px;height:180px;margin-top:16px;object-fit:cover;background:#243142}</style>
    <button id="record-step" style="position:fixed;left:20px;top:20px;width:100px;height:50px;z-index:10" onclick="document.querySelector('#record-marker').style.background='#ff0000'">实际步骤</button><div id="record-marker" style="position:fixed;right:0;top:0;width:64px;height:64px;background:#000000;z-index:10"></div><div style="height:1200px"></div>
    <article data-testid="tweet"><h1>Latest Arena post</h1><p>BMW selected-element capture fixture.</p><img src="/image.png" alt="fixture image"><aside class="recommendations">Promotion recommended navigation<img src="/recommended.png"></aside><img class="avatar" src="/avatar.png"><video poster="/poster.png" controls><source src="/video.mp4" type="video/mp4"></video><video id="capture-source" autoplay muted></video><canvas id="capture-canvas" width="320" height="180" hidden></canvas></article>
    <script>
      const canvas = document.querySelector('#capture-canvas')
      const context = canvas.getContext('2d', { alpha: false })
      let frame = 0
      setInterval(() => {
        context.fillStyle = frame++ % 2 ? '#49c9a5' : '#875cff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = 'white'
        context.font = '28px sans-serif'
        context.fillText('BMW ' + frame, 80, 100)
      }, 80)
      const source = document.querySelector('#capture-source')
      source.srcObject = canvas.captureStream(12)
      source.play()
    </script>`)
})

let window: BrowserWindow | null = null
let exitCode = 0

async function stage<T>(name: string, operation: Promise<T>, timeoutMs = 15_000): Promise<T> {
  process.stderr.write(`[BMW media smoke] ${name}\n`)
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`BMW media smoke timed out during ${name}.`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function run(): Promise<void> {
 try {
  await stage('start local fixture server', new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  }))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('BMW media smoke server did not bind a TCP port.')
  const url = `http://127.0.0.1:${address.port}/`
  await stage('wait for Electron', app.whenReady())
  const smokeSession = session.fromPartition(`persist:bmw-media-smoke-${process.pid}`)
  window = new BrowserWindow({
    show: false,
    width: 900,
    height: 760,
    webPreferences: { session: smokeSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling:false }
  })
  await stage('load fixture page', window.loadURL(url))
  const tab = {
    id: 'media-smoke-tab',
    title: 'BMW Media Smoke',
    url,
    view: { webContents: window.webContents }
  }
  const kernel = {
    diagnostics: new Map([[tab.id, { console: [], network: [], media: [], loadFailures: [] }]]),
    projectStore: { active: () => ({ id: 'media-smoke-project', directory: projectDirectory }) },
    session: smokeSession,
    artifactsDirectory: path.join(projectDirectory, 'artifacts'),
    serializeTab: () => ({ id: tab.id, title: tab.title, url: tab.url }),
    diagnosticsFor: BrowserKernel.prototype.diagnosticsFor
  }

  const discovered = await stage<MediaDiscovery>('discover post media', BrowserKernel.prototype.listMedia.call(kernel, tab, {
    selector: '[data-testid="tweet"]',
    index: 0,
    maxItems: 20,
    excludeSelectors:['.recommendations','.avatar']
  }) as Promise<MediaDiscovery>)
  if (!discovered.items.some((item) => item.url === `${url}image.png`)) throw new Error('BMW did not discover the post image.')
  if (!discovered.items.some((item) => item.url === `${url}video.mp4`)) throw new Error('BMW did not discover the post video source.')

  if(discovered.items.some(item=>/recommended|avatar/.test(item.url??'')))throw new Error('Scoped discovery mixed recommendation/avatar candidates into the body.')
  const range=await stage('observe confirmed body range',BrowserKernel.prototype.observe.call(kernel,tab,{selector:'[data-testid="tweet"]',excludeSelectors:['.recommendations','.avatar']})) as {text:string;range:{status:string;truncated:boolean;selector:string}}
  if(!range.text.includes('BMW selected-element')||/Promotion|recommended|实际步骤/.test(range.text)||range.range.status!=='observed')throw new Error('Body observation was not limited to its selected range.')
  const missing=await BrowserKernel.prototype.observe.call(kernel,tab,{selector:'#not-present'}) as {text:string;range:{status:string}}
  if(missing.text||missing.range.status!=='element-not-found')throw new Error('Missing body range fell back to whole-page text.')
  await window.webContents.executeJavaScript("document.querySelector('article').append(Object.assign(document.createElement('p'),{id:'long-body',textContent:'正文'.repeat(1000)}))")
  const truncated=await BrowserKernel.prototype.observe.call(kernel,tab,{selector:'#long-body',maxCharacters:1000}) as {text:string;range:{truncated:boolean}}
  if(!truncated.range.truncated||truncated.text.length!==1000)throw new Error('Body truncation lost its explicit character boundary.')
  await window.webContents.executeJavaScript("document.querySelector('#long-body').remove()")
  console.log('PASS body ranges: scoped text and DOM media, excluded recommendations/avatar, no missing-range fallback, explicit truncation; candidates are not downloaded evidence')

  const screenshot = await stage<ScreenshotArtifact>('capture selected post', BrowserKernel.prototype.screenshot.call(kernel, tab, {
    selector: '[data-testid="tweet"]',
    index: 0,
    filename: 'arena-latest-post.png'
  }) as Promise<ScreenshotArtifact>)
  if (!fs.statSync(screenshot.path).size || screenshot.width < 500 || screenshot.height < 300) {
    throw new Error('BMW selected-post screenshot was empty or unexpectedly small.')
  }

  const downloaded = await stage<DownloadArtifact>('download post video', BrowserKernel.prototype.downloadMedia.call(kernel, tab, {
    url: `${url}video.mp4`,
    filename: 'arena-latest-video.mp4'
  }) as Promise<DownloadArtifact>)
  if (!fs.readFileSync(downloaded.path).equals(video)) throw new Error('BMW downloaded video bytes did not match the browser resource.')

  const mediaController = new MediaController({
    session: smokeSession,
    preloadPath: path.resolve('packages/media-native/src/preload/media-preload.cjs'),
    pagePath: path.resolve('packages/media-native/src/media/media.html'),
    artifactsDirectory: path.join(projectDirectory, 'artifacts'),
    resolveArtifactsDirectory: () => path.join(projectDirectory, 'artifacts'),
    onStatus: () => {}
  })
  mediaController.configureDisplayMedia()
  // Page recording evidence uses native input delivered to an actual page, not
  // a post-hoc Agent log. Isolated Profile only; no production DSH/model claim.
  let completed:(value:unknown)=>void=()=>{},failed:(error:unknown)=>void=()=>{}
  const onChunk=(event:Electron.IpcMainEvent,data:ArrayBuffer)=>{if(mediaController.ownsCaptureSender(event))mediaController.acceptChunk(data)}
  const onState=(event:Electron.IpcMainEvent,value:unknown)=>{if(mediaController.ownsCaptureSender(event)){console.log('[BMW recording state]',JSON.stringify(value));mediaController.updateState(value)}}
  const onFinished=(event:Electron.IpcMainEvent,value:unknown)=>{if(mediaController.ownsCaptureSender(event))void mediaController.finalize(value).then(completed,failed)}
  ipcMain.on('media-chunk',onChunk);ipcMain.on('media-state',onState);ipcMain.on('media-finished',onFinished)
  const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
  const recordingEvidence:unknown[]=[]
  try{
    window.show();app.focus({steal:true});window.focus()
    for(const dpr of [1,2]){
      await window.loadURL(url)
      if(!window.webContents.debugger.isAttached())window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:dpr,mobile:false,dontSetVisibleSize:true})
      await wait(150)
      const source=await new PageRecordingEvents(window.webContents,()=>{void mediaController.stop().catch(()=>{})},()=>window!.getContentBounds()).prepare()
      const resultPromise=new Promise<unknown>((resolve,reject)=>{completed=resolve;failed=reject});void resultPromise.catch(()=>{})
      await mediaController.start(tab,{fps:24},source)
      for(let i=0;i<400&&!mediaController['recordingClock']&&mediaController.isCaptureActive();i++)await wait(25)
      if(!mediaController['recordingClock'])throw new Error('Recorder clock was never started.')
      await wait(400)
      window.webContents.sendInputEvent({type:'mouseDown',x:70,y:45,button:'left',clickCount:1})
      window.webContents.sendInputEvent({type:'mouseUp',x:70,y:45,button:'left',clickCount:1})
      await wait(450)
      const marker=await window.webContents.executeJavaScript("document.querySelector('#record-marker').style.background");if(marker!=='rgb(255, 0, 0)')throw new Error('Native click did not activate its task: '+marker)
      await window.webContents.executeJavaScript('scrollTo(0,350)')
      await wait(200)
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:760,height:560,deviceScaleFactor:dpr,mobile:false,dontSetVisibleSize:true})
      await wait(250)
      // Separate Agent action evidence; synthetic element.click must not be user input.
      Object.assign(tab,{recordingEvents:source})
      await BrowserKernel.prototype.click.call({},tab,{selector:'#record-step'})
      await wait(200)
      await window.loadURL(url+'next')
      await wait(300)
      window.webContents.sendInputEvent({type:'mouseDown',x:70,y:45,button:'left',clickCount:1})
      window.webContents.sendInputEvent({type:'mouseUp',x:70,y:45,button:'left',clickCount:1})
      await wait(300);await mediaController.stop()
      const result=await stage('finalize page recording '+dpr,resultPromise) as {artifactId:string;eventsArtifactId:string;path:string}
      const events=assertRecordingEvents(JSON.parse(fs.readFileSync(path.join(projectDirectory,'artifacts',result.eventsArtifactId),'utf8')),result.artifactId)
      const clicks=events.events.filter(e=>e.kind==='click');if(clicks.length!==3||clicks[0].source!=='page-event'||clicks[1].source!=='agent-action'||clicks[2].source!=='page-event')throw new Error('Real and Agent clicks were not recorded separately: '+JSON.stringify(events))
      if(!events.events.some(e=>e.kind==='scroll'&&e.scrollY>=350)||!events.events.some(e=>e.kind==='viewport'&&e.viewportWidth===760)||!events.events.some(e=>e.kind==='navigation'&&e.url===url+'next')||clicks.some(e=>e.dpr!==dpr))throw new Error('Recording missed scroll/viewport/navigation/DPR evidence.')
      const timing=clicks[0].seconds,times=Array.from({length:8},(_,i)=>Math.max(0,timing-.12+i*.04))
      const samples=await stage('independent recording timing decode',mediaController.processArtifact({action:'media.frames.sample',artifactId:result.artifactId,timestampsSeconds:times}))
      if(!('frames' in samples))throw new Error('Missing recording frames.')
      const observed=[] as {timestamp:number;red:number}[]
      for(const frame of samples.frames){
        const bytes=fs.readFileSync(path.join(projectDirectory,'artifacts',frame.artifactId)).toString('base64')
        const red=await mediaController.window.webContents.executeJavaScript(`(async()=>{const image=await createImageBitmap(await (await fetch('data:image/png;base64,${bytes}')).blob());const c=new OffscreenCanvas(image.width,image.height),x=c.getContext('2d');x.drawImage(image,0,0);const pixels=x.getImageData(0,0,c.width,c.height).data;let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>180&&pixels[i+1]<120&&pixels[i+2]<100)red++;image.close();return red})()`) as number
        observed.push({timestamp:frame.timestampSeconds,red})
        if(process.env.BMW_VALIDATION_DIR){fs.mkdirSync(process.env.BMW_VALIDATION_DIR,{recursive:true});fs.copyFileSync(path.join(projectDirectory,'artifacts',frame.artifactId),path.join(process.env.BMW_VALIDATION_DIR,`dpr-${dpr}-frame-${frame.outputIndex}.png`))}
      }
      const first=observed.find(frame=>frame.red>100),before=observed.some(frame=>frame.red<100&&frame.timestamp<timing)
      if(!first||!before||Math.abs(first.timestamp-timing)>.1)throw new Error('Event/video timing exceeds 100ms: '+JSON.stringify({timing,observed,start:events.clock.startedEpochMs}))
      recordingEvidence.push({dpr,artifactId:result.artifactId,eventCount:events.events.length,clicks,clock:events.clock,firstVisibleClickSeconds:first.timestamp,errorMs:Math.abs(first.timestamp-timing)*1000,frames:observed})
    }
    const resultPromise=new Promise<unknown>((resolve,reject)=>{completed=resolve;failed=reject});void resultPromise.catch(()=>{})
    const source=await new PageRecordingEvents(window.webContents,()=>{void mediaController.stop().catch(()=>{})},()=>window!.getContentBounds()).prepare()
    const started=await mediaController.start(tab,{fps:24},source);await wait(400);await mediaController.stop({discard:true});const discarded=await stage('cancel recording',resultPromise) as {state:string}
    if(discarded.state!=='cancelled'||fs.existsSync(path.join(projectDirectory,'artifacts',started.recordingId+'.webm')))throw new Error('Discard retained its new recording.')
    if(!recordingEvidence.length)throw new Error('Missing recording evidence.')
    const earlyResult=new Promise<unknown>((resolve,reject)=>{completed=resolve;failed=reject});void earlyResult.catch(()=>{})
    const earlySource=await new PageRecordingEvents(window.webContents,()=>{void mediaController.stop().catch(()=>{})},()=>window!.getContentBounds()).prepare()
    const earlyStart=await mediaController.start(tab,{fps:24},earlySource)
    await stage('discard while recording initializes',mediaController.stop({discard:true}) as Promise<unknown>)
    const early=await earlyResult as {state:string}
    if(early.state!=='cancelled'||mediaController.isCaptureActive()||fs.existsSync(path.join(projectDirectory,'artifacts',earlyStart.recordingId+'.webm')))throw new Error('Initialization discard left a recording or pending job.')
    const originals=(recordingEvidence as {artifactId:string}[]).map(e=>e.artifactId)
    const budgetResult=new Promise<unknown>((resolve,reject)=>{completed=resolve;failed=reject});void budgetResult.catch(()=>{})
    const budgetSource=await new PageRecordingEvents(window.webContents,()=>{void mediaController.stop().catch(()=>{})},()=>window!.getContentBounds()).prepare()
    const budgetStart=await mediaController.start(tab,{fps:24},budgetSource);await wait(350)
    mediaController['recordingBytes']=MAX_CAPTURE_BYTES;mediaController.acceptChunk(new Uint8Array([0]))
    try{await stage('recording byte budget rollback',budgetResult);throw new Error('Budget failure was not rejected.')}catch(error){if(!String(error).includes('byte budget'))throw error}
    if(fs.existsSync(path.join(projectDirectory,'artifacts',budgetStart.recordingId+'.webm'))||fs.existsSync(path.join(projectDirectory,'artifacts',budgetStart.recordingId+'.webm.events.json')))throw new Error('Budget failure retained new outputs.')
    const closingWindow=new BrowserWindow({show:false,width:640,height:480,webPreferences:{session:smokeSession,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
    try{
      await closingWindow.loadURL(url)
      const closingResult=new Promise<unknown>((resolve,reject)=>{completed=resolve;failed=reject});void closingResult.catch(()=>{})
      const closingTab={...tab,id:'closing-page',view:{webContents:closingWindow.webContents}},closingSource=await new PageRecordingEvents(closingWindow.webContents,()=>{void mediaController.stop().catch(()=>{})},()=>closingWindow.getContentBounds()).prepare()
      await mediaController.start(closingTab,{fps:24},closingSource);await wait(450);closingWindow.destroy()
      const closed=await stage('page close finalizes recording',closingResult) as {eventsArtifactId:string;artifactId:string}
      const trace=assertRecordingEvents(JSON.parse(fs.readFileSync(path.join(projectDirectory,'artifacts',closed.eventsArtifactId),'utf8')),closed.artifactId)
      if(!['page-closed','observer-detached'].includes(trace.stopReason))throw new Error('Closed page did not report its lifecycle stop reason.')
    }finally{if(!closingWindow.isDestroyed())closingWindow.destroy()}
    if(mediaController.isCaptureActive()||originals.some(id=>!fs.existsSync(path.join(projectDirectory,'artifacts',id))))throw new Error('Failure cleanup lost an original recording or retained a busy capture.')

    const evidenceDirectory=process.env.BMW_VALIDATION_DIR
    if(evidenceDirectory){fs.mkdirSync(evidenceDirectory,{recursive:true});fs.writeFileSync(path.join(evidenceDirectory,'recording-events.json'),JSON.stringify(recordingEvidence,null,2)+'\n');for(const evidence of recordingEvidence as {artifactId:string}[])for(const name of [evidence.artifactId,evidence.artifactId+'.events.json'])fs.copyFileSync(path.join(projectDirectory,'artifacts',name),path.join(evidenceDirectory,name))}
  const captured = await stage<CapturedArtifact>('capture page video stream', mediaController.captureVideo(tab, {
    selector: '#capture-source',
    filename: 'arena-stream.webm',
    fromStart: false,
    maxDurationMs: 1_500
  }) as Promise<CapturedArtifact>, 15_000)
  const capturedBytes = fs.readFileSync(captured.path)
  if(process.env.BMW_VALIDATION_DIR)fs.copyFileSync(captured.path,path.join(process.env.BMW_VALIDATION_DIR,'source-video-element.webm'))
  const hasWebmHeader = capturedBytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  if (!captured.contentType.startsWith('video/webm') || captured.bytes < 1_024 || captured.videoTracks !== 1 || !hasWebmHeader) {
    throw new Error(`BMW browser-native video capture did not produce a valid WebM stream: ${JSON.stringify(captured)}`)
  }

  const inspectedCapture = await stage('inspect actual BMW video Capture with Mediabunny', mediaController.processArtifact({ action: 'media.inspect', artifactId: path.basename(captured.path) }))
  if(process.env.BMW_VALIDATION_DIR)fs.writeFileSync(path.join(process.env.BMW_VALIDATION_DIR,'video-element-inspection.json'),JSON.stringify({captured,inspectedCapture},null,2)+'\n')
  if (!('durationSeconds' in inspectedCapture) || !('firstTimestampSeconds' in inspectedCapture) || inspectedCapture.durationSeconds <= 0) throw new Error('Captured video could not be parsed by the media foundation.')
  const sampledCapture = await stage('sample actual BMW video Capture', mediaController.processArtifact({ action: 'media.frames.sample', artifactId: path.basename(captured.path), timestampsSeconds: [Math.max(0, inspectedCapture.firstTimestampSeconds) + .1] }))
  if (!('frames' in sampledCapture) || sampledCapture.frames.length !== 1) throw new Error('Captured video could not be sampled by the media foundation.')

    await stage('three-step website workflow and Studio',runRecordingWorkflowCase({window,session:smokeSession,media:mediaController,projectDirectory,completion:(done,fail)=>{completed=done;failed=fail},proof:process.env.BMW_VALIDATION_DIR??path.resolve('.bmw-runtime/recording-workflow')}),150000)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    recordingEvidence,
    discoveredItems: discovered.items.length,
    screenshot: { width: screenshot.width, height: screenshot.height, bytes: fs.statSync(screenshot.path).size },
    download: { contentType: downloaded.contentType, bytes: downloaded.bytes },
    capture: { parsedDuration: inspectedCapture.durationSeconds, sampledFrames: sampledCapture.frames.length, contentType: captured.contentType, bytes: captured.bytes, complete: captured.complete, stopReason: captured.stopReason }
  })}\n`)
  }finally{ipcMain.removeListener('media-chunk',onChunk);ipcMain.removeListener('media-state',onState);ipcMain.removeListener('media-finished',onFinished);window.hide()}
 } catch (error) {
  exitCode = 1
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
 } finally {
  window?.destroy()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
  app.exit(exitCode)
 }
}

void run()
