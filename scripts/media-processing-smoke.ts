import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import { MediaController } from '../packages/media-native/src/media-controller.js'
import { BrowserKernel } from '../packages/browser-capability/src/browser-kernel.js'
import { BrowserCapabilityRegistry } from '../packages/browser-capability/src/browser-capability-registry.js'
import { createBridgeServer } from '../packages/browser-capability/src/bridge-server.js'
import { bmwProduct } from '@bmw-agent/product-bmw'
import type { MediaInfo } from '../packages/media-native/src/media-contract.js'
import {mediaRecord} from '../packages/media-native/src/media-contract.js'
import {createServer} from 'node:http'
import crypto from 'node:crypto'
import {Input,BufferSource,MP4,Output,BufferTarget,Mp4OutputFormat,Conversion} from 'mediabunny'

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-media-processing-')))
const project = { id: 'media-job-project', name:'Isolated media fixture', directory: path.join(root, 'project') }
const artifacts = path.join(project.directory, 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
fs.mkdirSync(path.join(root, 'profile'))
app.setPath('userData', path.join(root, 'profile'))
interface Frame { artifactId: string; path: string; timestampSeconds: number; width: number; height: number }
interface Frames { frames: Frame[] }
interface Converted { durationSeconds: number; artifactId: string; path: string; bytes: number; tracks: { type: string; codec: string }[] }
async function stage<T>(name: string, operation: () => Promise<T>): Promise<T> {
  process.stderr.write(`[BMW media processing] ${name}\n`)
  return operation()
}
let source: BrowserWindow | undefined
let bridge: Awaited<ReturnType<typeof createBridgeServer>> | undefined
let cancelOnProgress: AbortController | undefined
let cancelImage: AbortController | undefined
let cancelCover: AbortController | undefined
let cancelDrawing: AbortController | undefined
let granted = true
let exitCode = 0
const timeout = setTimeout(() => { process.stderr.write('Media processing smoke exceeded 150 seconds.\n'); app.exit(1) }, 150_000)

async function run(): Promise<void> {
try {
  await app.whenReady()
  const browserSession = session.fromPartition(`bmw-media-processing-${process.pid}`)
  source = new BrowserWindow({ show: false, webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  fs.writeFileSync(path.join(root,'fixture.html'),'<title>BMW media fixture</title>');await source.loadFile(path.join(root,'fixture.html'))
  const media = new MediaController({ session: browserSession,
    preloadPath: path.resolve('packages/media-native/src/preload/media-preload.cjs'),
    pagePath: path.resolve('packages/media-native/src/media/media.html'), artifactsDirectory: artifacts,
    resolveArtifactsDirectory: () => artifacts, onStatus: (value: { progress?: number; action?: string; active?: boolean }) => { if(value.active&&value.action==='video.cover')cancelCover?.abort(new Error('Cover cancellation')); if(value.active&&(value.action==='media.image.draw'||value.action==='media.image.annotate'))cancelDrawing?.abort(new Error('Drawing cancellation')); if(value.active&&value.action==='media.image.inspect')cancelImage?.abort(new Error('Image cancellation')); if ((value.progress ?? 0) > 0) cancelOnProgress?.abort(new Error('E2E cancellation')) } })
  const registry = new BrowserCapabilityRegistry(bmwProduct)
  const fixtureCodec = process.env.BMW_MEDIA_FIXTURE_CODEC === 'vp9' ? 'vp9' : 'vp8'
  const kernel = new BrowserKernel({ window: source, session: browserSession, capabilityRegistry: registry,
    permissionStore: { hasAgentControl: () => granted }, projectStore: { active: () => project }, artifactsDirectory: artifacts,
    sessionContinuity: undefined, settingsStore: undefined, allowedActions: undefined, onState: undefined })
  kernel.setRecordingController(media)
  bridge = await createBridgeServer(kernel, { toolDefinition: registry.toolDefinition(), resolveProject: (directory) => directory === project.directory ? project : undefined, activeProjectId: () => project.id })
  const headers = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }
  const binding=bridge.registerSession('media-job-session',project.directory)
  const bridgeCall = async (args: unknown) => {
    const response = await fetch(`${bridge!.url}/execute`, { method: 'POST', headers, body: JSON.stringify({ binding, arguments: args }) })
    const result = await response.json() as { result: unknown; images: { mimeType: string; data: string }[]; error?: string }
    if (!response.ok) throw new Error(result.error)
    return result
  }
  await stage('decode actual PNG/JPEG/WebP; reject corrupt pixels and oversized headers; cancel and recover without writes', async()=>{
    for(const [extension,type] of [['png','image/png'],['jpg','image/jpeg'],['webp','image/webp']] as const){
      const base64=await source!.webContents.executeJavaScript(`(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;c.getContext('2d').fillRect(0,0,320,180);return c.toDataURL(${JSON.stringify(type)}).split(',')[1]})()`) as string
      fs.writeFileSync(path.join(artifacts,'image.'+extension),Buffer.from(base64,'base64'))
      const before=fs.readdirSync(artifacts).sort(),info=await media.processArtifact({action:'media.image.inspect',artifactId:'image.'+extension}) as {width:number;height:number;pixels:number;canDecode:boolean;contentType:string}
      assert.equal(info.width,320);assert.equal(info.height,180);assert.equal(info.pixels,57600);assert.equal(info.canDecode,true);assert.equal(info.contentType,type);assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
    }
    const png=fs.readFileSync(path.join(artifacts,'image.png')),huge=Buffer.from(png);huge.writeUInt32BE(8192,16);huge.writeUInt32BE(8192,20);fs.writeFileSync(path.join(artifacts,'huge.png'),huge)
    await assert.rejects(media.processArtifact({action:'media.image.inspect',artifactId:'huge.png'}),/pixel|size|dimension|limit/i)
    // Valid admitted header with no compressed pixels must fail real decoding.
    const invalid=Buffer.concat([png.subarray(0,33),png.subarray(png.length-12)]);fs.writeFileSync(path.join(artifacts,'invalid.png'),invalid)
    await assert.rejects(media.processArtifact({action:'media.image.inspect',artifactId:'invalid.png'}),/decode|source|image/i)
    const before=fs.readdirSync(artifacts).sort();cancelImage=new AbortController()
    await assert.rejects(media.processArtifact({action:'media.image.inspect',artifactId:'image.png'},cancelImage.signal),/Image cancellation/);cancelImage=undefined
    assert.equal(media.isCaptureActive(),false);assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
    await media.processArtifact({action:'media.image.inspect',artifactId:'image.png'})
    const encoding=await media.processArtifact({action:'media.encode.check',width:640,height:360,fps:12}) as {kind:string;videoSupported:boolean;audioSupported:boolean}
    assert.equal(encoding.kind,'encoding');assert.equal(encoding.videoSupported,true);assert.equal(encoding.audioSupported,true);assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
  })
  await stage('native image annotation and drawing: all primitives, actual pixels, originals, transparency, errors and cancellation',async()=>{
    const original=fs.readFileSync(path.join(artifacts,'image.png'))
    const measured=(await bridgeCall({action:'media.image.inspect',artifactId:'image.png'})).result as {width:number;height:number}
    assert.equal(measured.width,320);assert.equal(measured.height,180)
    const shapes=[
      {type:'rect',x:10,y:10,width:80,height:60,color:'#ff0000',lineWidth:4},
      {type:'ellipse',x:110,y:10,width:40,height:40,color:'#00ff00',fill:'#00ff00'},
      {type:'arrow',x1:20,y1:100,x2:100,y2:100,color:'#0000ff',lineWidth:4},
      {type:'line',x1:200,y1:100,x2:300,y2:100,color:'#ff00ff'},
      {type:'path',points:[{x:120,y:110},{x:150,y:125},{x:180,y:110}],color:'#ff8800'},
      {type:'text',x:170,y:15,text:'BMW 标注',fontSize:20,bold:true,maxWidth:140,color:'#000000',background:'#ffffff'},
      {type:'redact',x:20,y:140,width:100,height:20,color:'#ffffff'}
    ]
    const annotated=await bridgeCall({action:'media.image.annotate',artifactId:'image.png',shapes})
    const receipt=annotated.result as {artifactId:string;path:string;width:number;height:number;shapeCount:number;sourceArtifactId:string}
    assert.equal(receipt.sourceArtifactId,'image.png');assert.equal(receipt.width,320);assert.equal(receipt.height,180);assert.equal(receipt.shapeCount,7)
    assert.equal(annotated.images.length,1);assert.equal(annotated.images[0].data,fs.readFileSync(receipt.path).toString('base64'));assert.deepEqual(fs.readFileSync(path.join(artifacts,'image.png')),original)
    const pixels=await source!.webContents.executeJavaScript(`(async()=>{
      const i=new Image();i.src=${JSON.stringify('data:image/png;base64,'+annotated.images[0].data)};await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);
      const points=[[10,30],[130,30],[60,100],[250,100],[150,125],[60,150],[300,170],[50,40]],samples=points.map(p=>[...x.getImageData(...p,1,1).data]);
      const text=x.getImageData(170,15,140,25).data;let ink=0;for(let at=0;at<text.length;at+=4)if(text[at]<80&&text[at+1]<80&&text[at+2]<80)ink++;
      const head=x.getImageData(87,91,13,18).data;let arrowInk=0;for(let at=0;at<head.length;at+=4)if(head[at+2]>200)arrowInk++;
      return {samples,ink,arrowInk}
    })()`) as {samples:number[][];ink:number;arrowInk:number}
    const expected=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,0,255,255],[255,136,0,255],[255,255,255,255],[0,0,0,255],[0,0,0,255]]
    assert.deepEqual(pixels.samples,expected);assert.ok(pixels.ink>100);assert.ok(pixels.arrowInk>40)
    const drawing=await bridgeCall({action:'media.image.draw',width:640,height:360,background:'#f4f7fa',shapes:[
      {type:'text',x:240,y:25,text:'BMW 绘图',fontSize:28,bold:true,color:'#254b3c'},
      {type:'rect',x:60,y:110,width:180,height:90,color:'#2865af',fill:'#e8f1ff',lineWidth:3},
      {type:'text',x:85,y:138,text:'截图 / 图片',fontSize:22,color:'#2865af',maxWidth:140},
      {type:'arrow',x1:252,y1:155,x2:385,y2:155,color:'#486376',lineWidth:5},
      {type:'ellipse',x:400,y:110,width:180,height:90,color:'#318255',fill:'#e8f5ed',lineWidth:3},
      {type:'text',x:430,y:138,text:'标注结果',fontSize:22,color:'#318255',maxWidth:120},
      {type:'text',x:110,y:260,text:'框选 · 箭头 · 文字 · 路径 · 遮盖',fontSize:22,color:'#486376',maxWidth:440}
    ]})
    const proof=process.env.BMW_VALIDATION_DIR??'.bmw-runtime/image-drawing-validation';fs.mkdirSync(proof,{recursive:true})
    fs.writeFileSync(path.join(proof,'native-annotations.png'),fs.readFileSync(receipt.path));fs.writeFileSync(path.join(proof,'native-drawing.png'),Buffer.from(drawing.images[0].data,'base64'))
    const transparent=await bridgeCall({action:'media.image.draw',width:64,height:64,background:'none',shapes:[{type:'rect',x:10,y:10,width:20,height:20,color:'#00ff00',fill:'#00ff00'}]})
    const alpha=await source!.webContents.executeJavaScript(`(async()=>{const i=new Image();i.src=${JSON.stringify('data:image/png;base64,'+transparent.images[0].data)};await i.decode();const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.drawImage(i,0,0);return [[...x.getImageData(0,0,1,1).data],[...x.getImageData(20,20,1,1).data]]})()`) as number[][]
    assert.deepEqual(alpha,[[0,0,0,0],[0,255,0,255]])
    // Exercise actual JPEG/WebP image inputs, not just PNG headers.
    for(const id of ['image.jpg','image.webp']){
      const edited=await bridgeCall({action:'media.image.annotate',artifactId:id,shapes:[shapes[0]]});assert.equal(edited.images.length,1)
    }
    const before=fs.readdirSync(artifacts).sort()
    for(const request of [
      {action:'media.image.annotate',artifactId:'../image.png',shapes},
      {action:'media.image.annotate',artifactId:'huge.png',shapes},
      {action:'media.image.annotate',artifactId:'invalid.png',shapes},
      {action:'media.image.annotate',artifactId:'image.png',shapes:[{type:'rect',x:319,y:0,width:20,height:20}]},
      {action:'media.image.draw',width:64,height:64,shapes:[{type:'text',x:0,y:40,text:'too many lines\nsecond line',fontSize:24}]},
      {action:'media.image.draw',width:64,height:64,shapes:[{type:'text',x:0,y:0,text:'BMW',maxWidth:1}]},
      {action:'media.image.draw',width:64,height:64,shapes:[{type:'redact',x:1,y:1,width:20,height:20,opacity:.2}]}
    ])await assert.rejects(bridgeCall(request))
    fs.symlinkSync(path.join(artifacts,'image.png'),path.join(artifacts,'image-link.png'))
    await assert.rejects(bridgeCall({action:'media.image.annotate',artifactId:'image-link.png',shapes}),/symbolic/);fs.unlinkSync(path.join(artifacts,'image-link.png'))
    assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
    granted=false;await assert.rejects(bridgeCall({action:'media.image.draw',width:64,height:64,shapes:[shapes[0]]}),/agent control/);granted=true
    cancelDrawing=new AbortController()
    await assert.rejects(media.processArtifact({action:'media.image.annotate',artifactId:'image.png',shapes},cancelDrawing.signal),/Drawing cancellation/);cancelDrawing=undefined
    assert.deepEqual(fs.readdirSync(artifacts).sort(),before);assert.equal(media.isCaptureActive(),false)
    // Cancel AFTER finalized drawing, during independent image verification: remove only the new PNG.
    cancelImage=new AbortController()
    await assert.rejects(media.processArtifact({action:'media.image.draw',width:320,height:180,shapes:[shapes[0]]},cancelImage.signal),/Image cancellation/);cancelImage=undefined
    assert.deepEqual(fs.readdirSync(artifacts).sort(),before);assert.deepEqual(fs.readFileSync(path.join(artifacts,'image.png')),original)
    assert.equal(media.isCaptureActive(),false)
    await bridgeCall({action:'media.image.draw',width:320,height:180,shapes:[shapes[0]]})
    console.log('PASS native Canvas: actual marks/text/arrow pixels, new PNG receipt/model image, unchanged originals, JPEG/WebP, transparency, failed jobs and finalized-output cancellation cleanup')
  })
  const artifactId = 'synthetic-av.webm'
  const bytes = await stage('generate timed red/green/blue WebM with an Opus audio track', () => source!.webContents.executeJavaScript(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;document.body.append(canvas)
    const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = 'red'; ctx.fillRect(0,0,320,180)
    const audio = new AudioContext({ sampleRate: 48000 }); await audio.resume()
    const destination = audio.createMediaStreamDestination(); const oscillator = audio.createOscillator(); const gain = audio.createGain()
    gain.gain.value = .1; oscillator.connect(gain); gain.connect(destination); oscillator.start()
    const stream = canvas.captureStream(0); stream.addTrack(destination.stream.getAudioTracks()[0])
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=${fixtureCodec},opus' })
    const chunks = []; recorder.ondataavailable = (event) => { if(event.data.size) chunks.push(event.data) }
    const stopped = new Promise((resolve,reject) => { recorder.onstop = resolve; recorder.onerror = reject })
    recorder.start(250); const started = performance.now();stream.getVideoTracks()[0].requestFrame()
    const render = setInterval(() => { const time = performance.now() - started; ctx.fillStyle = time < 700 ? 'red' : time < 1400 ? '#00ff00' : 'blue'; ctx.fillRect(0,0,320,180);stream.getVideoTracks()[0].requestFrame() }, 40)
    await new Promise(resolve => setTimeout(resolve, 2200)); recorder.stop(); await stopped; clearInterval(render)
    oscillator.stop(); stream.getTracks().forEach(track => track.stop()); await audio.close();canvas.remove();if(!chunks.length)throw new Error('Fixture recorder emitted no encoded AV chunks')
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
  })()`, true) as Promise<number[]>)
  fs.writeFileSync(path.join(artifacts, artifactId), Buffer.from(bytes), { mode: 0o600 })
  const inspection = await stage('inspect through authenticated Bridge with no browser tab', () => bridgeCall({ action: 'media.inspect', artifactId }))
  const info = inspection.result as MediaInfo
  assert.ok(info.durationSeconds > 2 && info.durationSeconds < 3)
  assert.deepEqual(info.tracks.map((track) => track.type).sort(), ['audio', 'video'])
  assert.equal(info.tracks.find((track) => track.type === 'video')?.width, 320)
  assert.equal(info.tracks.find((track) => track.type === 'audio')?.codec, 'opus')
  const framesResult = await stage('sample timestamped frames and admit actual PNGs through Bridge', () => bridgeCall({ action: 'media.frames.sample', artifactId, timestampsSeconds: [.3, 1, 1.7], maxWidth: 160, maxHeight: 90 }))
  const frames = (framesResult.result as Frames).frames
  assert.equal(framesResult.images.length, 3)
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    assert.equal(frame.width, 160); assert.equal(frame.height, 90)
    assert.ok(Math.abs(frame.timestampSeconds - [.3,1,1.7][index]) < .12)
    assert.equal(framesResult.images[index].data, fs.readFileSync(frame.path).toString('base64'))
    const pixel = await source.webContents.executeJavaScript(`(async () => { const img = new Image(); img.src = ${JSON.stringify('data:image/png;base64,' + framesResult.images[index].data)}; await img.decode(); const c = document.createElement('canvas'); c.width = 160; c.height = 90; const ctx = c.getContext('2d'); ctx.drawImage(img,0,0); return [...ctx.getImageData(80,45,1,1).data] })()` ) as number[]
    assert.ok(pixel[index] > 180 && pixel[(index + 1) % 3] < 30 && pixel[(index + 2) % 3] < 30, `Unexpected frame color ${pixel}`)
    const referencePixel = await source.webContents.executeJavaScript(`(async () => {
      const video = document.createElement('video'); video.muted=true; document.body.append(video); video.src = ${JSON.stringify('data:video/webm;base64,' + Buffer.from(bytes).toString('base64'))}
      await new Promise((resolve,reject) => { video.onloadeddata = resolve; video.onerror = reject })
      // loadeddata/seeked can precede presentation in a hidden Chromium window.
      // Read the reference only after Chromium has presented the requested frame.
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Initial reference frame presentation timed out')),3000);video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve()});void video.play().catch(reject)})
      video.pause()
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Seek reference frame presentation timed out')),3000);video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve()});video.currentTime=${frame.timestampSeconds + .001}})
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90
      const context = canvas.getContext('2d'); context.drawImage(video,0,0,160,90)
      const result=[...context.getImageData(80,45,1,1).data];video.remove();return result
    })()`) as number[]
    assert.ok(pixel.every((channel, position) => Math.abs(channel - referencePixel[position]) <= 8), `Frame differs from Chromium playback: ${pixel} vs ${referencePixel}`)
  }
  await stage('persist whole-video analysis pages, dense intervals and declared review through authenticated Bridge',async()=>{
    const draft=mediaRecord((await bridgeCall({action:'video.studio',studioRequest:{operation:'create',title:'Source analysis fixture'}})).result),draftId=String(draft.id),draftRevision=Number(draft.revision)
    const call=(analysisRequest:Record<string,unknown>)=>bridgeCall({action:'video.studio',studioRequest:{operation:'analysis',draftId,expectedRevision:draftRevision,analysisRequest}})
    let value=mediaRecord((await call({operation:'create',artifactId})).result),job=mediaRecord(value.analysis),analysisId=String(job.id),revision=Number(job.revision)
    const first=await call({operation:'step',analysisId,expectedRevision:revision});value=mediaRecord(first.result);job=mediaRecord(value.analysis);revision=Number(job.revision);const sampled=(value.frames as unknown[]).map(mediaRecord);assert.equal(sampled.length,Math.ceil((Number(job.endSeconds)-Number(job.startSeconds))*2));assert.equal(first.images.length,sampled.length);assert.equal(mediaRecord(job.coverage).reviewed,0)
    assert.ok(sampled.every(f=>Array.isArray(f.lumaSignature)&&f.lumaSignature.length===64));assert.ok((job.changeCandidates as unknown[]).length>0,'Color changes must produce candidate regions, not semantic approval')
    value=mediaRecord((await call({operation:'review',analysisId,expectedRevision:revision,indices:[0],note:'Fixture declaration only; runtime verifies sampled PNG admission, not semantic quality.'})).result);revision=Number(mediaRecord(value.analysis).revision)
    value=mediaRecord((await call({operation:'densify',analysisId,expectedRevision:revision,intervals:[{startSeconds:.5,endSeconds:1.5,reason:'Fixture colors change'}]})).result);revision=Number(mediaRecord(value.analysis).revision)
    value=mediaRecord((await call({operation:'step',analysisId,expectedRevision:revision})).result);revision=Number(mediaRecord(value.analysis).revision);assert.equal(mediaRecord(mediaRecord(value.analysis).coverage).reviewed,1)
    const done=await call({operation:'step',analysisId,expectedRevision:revision});assert.equal(done.images.length,0);assert.equal((mediaRecord(done.result).frames as unknown[]).length,0)
    const read=await call({operation:'read',analysisId,expectedRevision:revision,offset:0});assert.equal(read.images.length,8)
    const report=mediaRecord((await call({operation:'export',analysisId,expectedRevision:revision,offset:0})).result);const ledger=JSON.parse(fs.readFileSync(path.join(artifacts,String(report.artifactId)),'utf8'));assert.equal(ledger.coverage.wholeVideo2fpsExtracted,true);assert.equal(ledger.coverage.wholePlanReviewed,false);assert.equal(ledger.coverage.audioAuditioned,false)
    const cancellationJob=mediaRecord(mediaRecord((await call({operation:'create',artifactId})).result).analysis),cancelId=String(cancellationJob.id),before=fs.readdirSync(artifacts).sort(),cancellation=new AbortController(),nativeProcess=media.processArtifact.bind(media)
    media.processArtifact=async(request:unknown,signal?:AbortSignal)=>{const result=await nativeProcess(request,signal);if(mediaRecord(request).action==='media.frames.sample')cancellation.abort(new Error('Analysis finalized-output cancellation'));return result}
    try{await assert.rejects(kernel.execute({action:'video.studio',studioRequest:{operation:'analysis',draftId,expectedRevision:draftRevision,analysisRequest:{operation:'step',analysisId:cancelId,expectedRevision:Number(cancellationJob.revision)}}},{signal:cancellation.signal,sessionOwner:{projectId:project.id,sessionId:'media-job-session'}}),/cancellation/i)}finally{media.processArtifact=nativeProcess}
    assert.equal(media.isCaptureActive(),false);assert.deepEqual(fs.readdirSync(artifacts).sort(),before);const all=mediaRecord((await call({operation:'list'})).result),retained=(all.analyses as Record<string,unknown>[]).find(j=>j.id===cancelId)!;assert.equal(mediaRecord(retained.coverage).extracted,0);assert.equal(mediaRecord(retained.coverage).failed,0)
  })
  await stage('reject permission denial, outside IDs, corrupt files and out-of-range timestamps', async () => {
    granted = false
    await assert.rejects(bridgeCall({ action: 'media.inspect', artifactId }), /agent control/)
    granted = true
    await assert.rejects(bridgeCall({ action: 'media.inspect', artifactId: '../outside.webm' }), /artifactId/)
    fs.writeFileSync(path.join(artifacts, 'corrupt.webm'), 'not a video')
    await assert.rejects(bridgeCall({ action: 'media.inspect', artifactId: 'corrupt.webm' }))
    const before = fs.readdirSync(artifacts).sort()
    await assert.rejects(bridgeCall({ action: 'media.frames.sample', artifactId, timestampsSeconds: [100] }), /outside/)
    assert.deepEqual(fs.readdirSync(artifacts).sort(), before)
  })
  await stage('reject genuine transparent WebM without emitting shifted frames or discarding alpha', async () => {
    const transparentBytes = await source!.webContents.executeJavaScript(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgba(255,0,0,.5)'; ctx.fillRect(0,0,64,64)
      const stream = canvas.captureStream(10); const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
      const chunks = []; recorder.ondataavailable = event => chunks.push(event.data)
      const stopped = new Promise(resolve => recorder.onstop = resolve); recorder.start()
      const timer = setInterval(() => { ctx.clearRect(0,0,64,64); ctx.fillRect(0,0,64,64) }, 50)
      await new Promise(resolve => setTimeout(resolve,500)); recorder.stop(); await stopped; clearInterval(timer); stream.getTracks().forEach(track => track.stop())
      return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
    })()`) as number[]
    fs.writeFileSync(path.join(artifacts, 'transparent.webm'), Buffer.from(transparentBytes))
    const transparent = await kernel.execute({ action: 'media.inspect', artifactId: 'transparent.webm' }) as MediaInfo
    assert.equal(transparent.tracks[0].canBeTransparent, true);assert.equal(transparent.tracks[0].hasAlphaData,true)
    const before = fs.readdirSync(artifacts).sort()
    await assert.rejects(kernel.execute({ action: 'media.frames.sample', artifactId: 'transparent.webm', timestampsSeconds: [.1] }), /Transparent/)
    await assert.rejects(kernel.execute({ action: 'media.convert', artifactId: 'transparent.webm', outputFormat: 'mp4' }), /Transparent/)
    assert.deepEqual(fs.readdirSync(artifacts).sort(), before)
  })
  await stage('real cover PNG: image/portrait/video frame/text, exact pixels and cancellation rollback',async()=>{
    const original=fs.readFileSync(path.join(artifacts,'image.png')),originalVideo=fs.readFileSync(path.join(artifacts,artifactId))
    const create=async(options:Record<string,unknown>,width=640,height=360,sourceKind?:'image'|'video')=>media.processArtifact({action:'video.cover',width,height,options,...(sourceKind?{sourceKind}:{})}) as Promise<{artifactId:string;path:string;width:number;height:number;actualTimestampSeconds?:number}>
    const sample=async(file:string,x:number,y:number)=>source!.webContents.executeJavaScript(`(async()=>{const i=new Image();i.src=${JSON.stringify('data:image/png;base64,'+fs.readFileSync(file).toString('base64'))};await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return {width:i.width,height:i.height,pixel:[...ctx.getImageData(${x},${y},1,1).data],ink:[...ctx.getImageData(20,Math.floor(i.height*.72),Math.min(300,i.width-20),Math.floor(i.height*.2)).data].filter((v,n)=>n%4!==3&&v>220).length}})()`) as Promise<{width:number;height:number;pixel:number[];ink:number}>
    for(const suffix of ['png','jpg','webp']){const image=await create({sourceArtifactId:'image.'+suffix,title:'视频封面',subtitle:'原始截图保留完整',background:'#102030',textColor:'#ffffff'},640,360,'image');const pixels=await sample(image.path,320,80);assert.equal(pixels.width,640);assert.equal(pixels.height,360);assert.deepEqual(pixels.pixel,[0,0,0,255]);assert.ok(pixels.ink>100)}
    const portrait=await create({sourceArtifactId:'image.png',title:'竖版封面',subtitle:'保留完整画面',position:'top'},720,1280,'image');assert.equal(portrait.width,720);assert.equal(portrait.height,1280)
    const text=await create({title:'独立文字封面',subtitle:'没有分镜也可以制作',background:'#102030'});assert.deepEqual((await sample(text.path,20,20)).pixel,[16,32,48,255])
    const frame=await create({sourceArtifactId:artifactId,timestampSeconds:1,title:'视频帧封面'},640,360,'video'),pixels=await sample(frame.path,320,80);assert.ok(pixels.pixel[1]>180&&pixels.pixel[0]<30&&pixels.pixel[2]<30);assert.ok(frame.actualTimestampSeconds!<=1&&frame.actualTimestampSeconds!>.8)
    const proof=process.env.BMW_VALIDATION_DIR??'.bmw-runtime/cover-validation';fs.mkdirSync(proof,{recursive:true});fs.copyFileSync(frame.path,path.join(proof,'video-cover.png'));fs.copyFileSync(portrait.path,path.join(proof,'portrait-cover.png'))
    const before=fs.readdirSync(artifacts).sort()
    for(const [id,kind,time] of [['invalid.png','image',0],['huge.png','image',0],[artifactId,'video',100]] as const)await assert.rejects(create({sourceArtifactId:id,timestampSeconds:time,title:'Invalid'},640,360,kind))
    fs.symlinkSync(path.join(artifacts,'image.png'),path.join(artifacts,'cover-link.png'));await assert.rejects(create({sourceArtifactId:'cover-link.png'},640,360,'image'),/symbolic/);fs.unlinkSync(path.join(artifacts,'cover-link.png'))
    cancelCover=new AbortController();await assert.rejects(media.processArtifact({action:'video.cover',width:640,height:360,options:{title:'Cancelled'}},cancelCover.signal),/Cover cancellation/);cancelCover=undefined
    cancelImage=new AbortController();await assert.rejects(media.processArtifact({action:'video.cover',width:640,height:360,options:{title:'Finalized but cancelled'}},cancelImage.signal),/Image cancellation/);cancelImage=undefined
    assert.deepEqual(fs.readdirSync(artifacts).sort(),before);assert.equal(media.isCaptureActive(),false);assert.deepEqual(fs.readFileSync(path.join(artifacts,'image.png')),original);assert.deepEqual(fs.readFileSync(path.join(artifacts,artifactId)),originalVideo)
    await create({title:'Recovered'});console.log('PASS cover actual source pixels, multilingual text, image formats, portrait/top layout, video presentation timestamp, errors, symlinks and cancellation after finalization')
  })
  const converted = await stage('export precise resized MP4 while preserving audio', () => kernel.execute({ action: 'media.convert', artifactId, outputFormat: 'mp4', trimStartSeconds: .25, trimEndSeconds: 1.75, outputWidth: 160, outputHeight: 90 })) as Converted
  assert.deepEqual(converted.tracks.map((track) => track.codec).sort(), ['aac','avc'])
  const exportedInfo = await stage('independently inspect MP4 output tracks and actual duration', () => kernel.execute({ action: 'media.inspect', artifactId: converted.artifactId })) as MediaInfo
  assert.ok(Math.abs(exportedInfo.durationSeconds - 1.5) < .12)
  assert.equal(converted.durationSeconds, exportedInfo.durationSeconds)
  assert.equal(exportedInfo.tracks.find((track) => track.type === 'video')?.width, 160)
  assert.deepEqual(exportedInfo.tracks.map((track) => track.codec).sort(), ['aac','avc'])
  await stage('indexed MP4 late-page sampling preserves from-start pixels and presentation timestamps',async()=>{
    const sample=async(id:string,times:number[])=>{const reply=await bridgeCall({action:'media.frames.sample',artifactId:id,timestampsSeconds:times,maxWidth:160,maxHeight:90});return {frames:(reply.result as Frames).frames,images:reply.images}}
    for(const id of [artifactId,converted.artifactId]){
      const times=id===artifactId?[.3,1,1.7]:[0,.7,1.3],sequential=await sample(id,times),tail=await sample(id,[times[2]])
      assert.equal(tail.frames[0].timestampSeconds,sequential.frames[2].timestampSeconds)
      assert.equal(tail.images[0].data,sequential.images[2].data,'A separate late page must match decoding from the beginning, including unindexed recordings.')
    }
  })
  const playback = await stage('independently load exported MP4 in Chromium HTMLVideoElement', () => source!.webContents.executeJavaScript(`(async () => {
    const video = document.createElement('video'); video.muted = true; video.src = ${JSON.stringify('data:video/mp4;base64,' + fs.readFileSync(converted.path).toString('base64'))}
    await new Promise((resolve,reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('Exported MP4 is not playable')) })
    await video.play(); await new Promise(resolve => setTimeout(resolve,120)); video.pause(); return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, time: video.currentTime }
  })()`) as Promise<{ width: number; height: number; duration: number; time: number }>)
  assert.equal(playback.width, 160); assert.equal(playback.height, 90); assert.ok(playback.time > 0)
  await stage('preserve observed HLS delivery bytes, remux encoded packets without loss and verify every track/range',async()=>{
    const input=new Input({formats:[MP4],source:new BufferSource(fs.readFileSync(converted.path))}),target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat({fastStart:'fragmented',minimumFragmentDuration:.4}),target})
    try{const conversion=await Conversion.init({input,output,tracks:'all',copy:{mode:'forced'}});assert.equal(conversion.discardedTracks.length,0);await conversion.execute()}finally{input.dispose()}
    const data=Buffer.from(target.buffer!);let offset=0,split=-1
    while(offset<data.length){const size=data.readUInt32BE(offset),type=data.toString('ascii',offset+4,offset+8);assert.ok(size>=8);if(type==='moof'){split=offset;break}offset+=size}assert.ok(split>0)
    const init=data.subarray(0,split),segment=data.subarray(split),duration=exportedInfo.durationSeconds
    const bodies:Record<string,{data:Buffer;type:string}>={
      '/master.m3u8':{type:'application/vnd.apple.mpegurl',data:Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nvideo.m3u8\n')},
      '/video.m3u8':{type:'application/vnd.apple.mpegurl',data:Buffer.from('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:'+duration+',\nsegment.m4s\n#EXT-X-ENDLIST\n')},
      '/init.mp4':{type:'video/mp4',data:init},'/segment.m4s':{type:'video/mp4',data:segment}
    }
    const server=createServer((request,response)=>{const body=bodies[request.url??''];if(!body){response.writeHead(404).end();return}response.writeHead(200,{'content-type':body.type,'content-length':body.data.length});response.end(body.data)})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const url='http://127.0.0.1:'+address.port+'/master.m3u8',id='preserve-fixture'
    await source!.webContents.executeJavaScript(`(()=>{const s=document.createElement('source');s.id='preserve-source';s.src=${JSON.stringify(url)};document.body.append(s)})()`)
    kernel.tabs.set(id,{id,title:'HLS preservation fixture',url:source!.webContents.getURL(),projectId:project.id,view:{webContents:source!.webContents}});kernel.activeTabId=id
    try{
      await assert.rejects(bridgeCall({action:'media.preserve',url:url.replace('master','unobserved')}),/must be observed/)
      const result=(await bridgeCall({action:'media.preserve',url})).result as {artifactId:string;sha256:string;tracks:{type:string;packets:number}[];preservation:{reencoded:boolean;completeVod:boolean;uploadedOriginal:string;resources:{artifactId:string;url:string;sha256:string}[];proofArtifactId:string}}
      assert.equal(result.preservation.reencoded,false);assert.equal(result.preservation.completeVod,true);assert.equal(result.preservation.uploadedOriginal,'unknown');assert.deepEqual(result.tracks.map(t=>t.type).sort(),['audio','video']);assert.ok(result.tracks.every(t=>t.packets>0))
      for(const resource of result.preservation.resources){const expected=bodies[new URL(resource.url).pathname]!.data,actual=fs.readFileSync(path.join(artifacts,resource.artifactId));assert.deepEqual(actual,expected);assert.equal(crypto.createHash('sha256').update(actual).digest('hex'),resource.sha256)}
      const decoded=await media.processArtifact({action:'media.decode.check',artifactId:result.artifactId}) as {completeFile:boolean;tracks:{type:string;sampleCount:number}[]};assert.equal(decoded.completeFile,true);assert.deepEqual(decoded.tracks.map(t=>t.type).sort(),['audio','video']);assert.ok(decoded.tracks.every(t=>t.sampleCount>0))
      const tail=(await bridgeCall({action:'media.frames.sample',artifactId:result.artifactId,timestampsSeconds:[1.2]}));assert.equal(tail.images.length,1)
      const proof=process.env.BMW_VALIDATION_DIR??'.bmw-runtime/media-preservation-validation';fs.mkdirSync(proof,{recursive:true});fs.copyFileSync(path.join(artifacts,result.preservation.proofArtifactId),path.join(proof,'preserved-delivery.json'))
    }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));kernel.tabs.delete(id);kernel.activeTabId=null;await source!.webContents.executeJavaScript(`document.querySelector('#preserve-source').remove()`)}
  })
  await stage('bounded native-rate stereo audition WAV, hashes, PCM metrics, no model-listening claim, no autoplay and failed-range rollback',async()=>{
    // MediaRecorder's first audio PTS can lag its video track on a busy host.
    // Select a real one-second interval, rather than asserting samples exist before it.
    const audioTrack=info.tracks.find(track=>track.type==='audio')!,audioStart=Math.max(.2,audioTrack.startSeconds??0)
    assert.ok(audioStart+1<=(audioTrack.endSeconds??0),'Fixture must contain a complete one-second audio interval.')
    const reply=await bridgeCall({action:'media.audio.sample',artifactId,startSeconds:audioStart,endSeconds:audioStart+1}),audio=reply.result as {artifactId:string;path:string;sha256:string;sourceSha256:string;evidence:{sampleRate:number;channels:number;frames:number;peak:number;rms:number;missingFrames:number;listeningStatus:string};perceptualReview:{status:string}}
    assert.equal(audio.evidence.sampleRate,48000);assert.equal(audio.evidence.channels,2);assert.equal(audio.evidence.frames,48000);assert.ok(audio.evidence.peak>.04&&audio.evidence.peak<.15);assert.ok(audio.evidence.rms>.02&&audio.evidence.rms<.1);assert.equal(audio.evidence.missingFrames,0);assert.equal(audio.evidence.listeningStatus,'not-performed');assert.equal(audio.perceptualReview.status,'not-performed');assert.equal(reply.images.length,0)
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(audio.path)).digest('hex'),audio.sha256);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(artifacts,artifactId))).digest('hex'),audio.sourceSha256)
    const preview=(await bridgeCall({action:'media.audio.preview',artifactId:audio.artifactId})).result as {autoplay:boolean;listeningStatus:string};assert.equal(preview.autoplay,false);assert.equal(preview.listeningStatus,'not-performed')
    const viewer=BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('BMW 音频试听'));assert.ok(viewer);assert.equal(await viewer.webContents.executeJavaScript(`document.querySelector('audio').autoplay`),false);viewer.destroy()
    const before=fs.readdirSync(artifacts).sort();await assert.rejects(bridgeCall({action:'media.audio.sample',artifactId,startSeconds:0,endSeconds:11}),/audio end/);await assert.rejects(bridgeCall({action:'media.audio.sample',artifactId:converted.artifactId,startSeconds:1,endSeconds:2}),/outside/);assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
  })
  await stage('actual adaptive canvas stream keeps mapped capture through resolution/aspect changes',async()=>{
    const id='adaptive-fixture';await source!.webContents.executeJavaScript(`(async()=>{const c=document.createElement('canvas');c.id='adaptive-canvas';c.width=320;c.height=180;document.body.append(c);const v=document.createElement('video');v.id='adaptive-video';v.muted=true;document.body.append(v);v.srcObject=c.captureStream(30);let count=0;globalThis.adaptiveTimer=setInterval(()=>{if(count===10){c.width=640;c.height=360}if(count===25){c.width=320;c.height=320}const x=c.getContext('2d');x.fillStyle=count<20?'red':'blue';x.fillRect(0,0,c.width,c.height);count++},30);await v.play();await new Promise(r=>setTimeout(r,100))})()`)
    kernel.tabs.set(id,{id,title:'Adaptive fixture',url:source!.webContents.getURL(),projectId:project.id,view:{webContents:source!.webContents}});kernel.activeTabId=id
    try{
      const result=(await bridgeCall({action:'media.video.capture',selector:'#adaptive-video',fromStart:false,maxDurationMs:1600})).result as {artifactId:string;complete:boolean;stopReason:string;captureTimeline:{sourceResolutionChanges:{width:number;height:number}[]}}
      assert.equal(result.complete,false);assert.equal(result.stopReason,'maximum-duration');assert.deepEqual(result.captureTimeline.sourceResolutionChanges.map(r=>[r.width,r.height]),[[320,180],[640,360],[320,320]])
      const decoded=await media.processArtifact({action:'media.decode.check',artifactId:result.artifactId}) as {completeFile:boolean};assert.equal(decoded.completeFile,true)
      const index=JSON.parse(fs.readFileSync(path.join(artifacts,result.artifactId+'.source.json'),'utf8'));assert.ok(index.frames.every((f:{sourceWidth?:number;sourceHeight?:number})=>f.sourceWidth&&f.sourceHeight))
      const last=index.frames.at(-1),sample=(await bridgeCall({action:'media.capture.frames.sample',artifactId:result.artifactId,sourceTimestampsSeconds:[last.sourceTimestampSeconds]})).result as Frames;assert.equal(sample.frames[0]!.width,320);assert.equal(sample.frames[0]!.height,180)
      const pixels=await source!.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src=${JSON.stringify('data:image/png;base64,'+fs.readFileSync(sample.frames[0]!.path).toString('base64'))};await image.decode();const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.drawImage(image,0,0);return [[...x.getImageData(160,90,1,1).data],[...x.getImageData(10,10,1,1).data]]})()`) as number[][]
      assert.ok(pixels[0]![2]!>180&&pixels[0]![0]!<30,'Adaptive final frame must retain blue content');assert.ok(pixels[1]!.slice(0,3).every(c=>c<15),'Aspect change must have explicit black letterboxing')
    }finally{kernel.tabs.delete(id);kernel.activeTabId=null;await source!.webContents.executeJavaScript(`clearInterval(globalThis.adaptiveTimer);const v=document.querySelector('#adaptive-video');v.srcObject.getTracks().forEach(t=>t.stop());v.remove();document.querySelector('#adaptive-canvas').remove()`)}
  })
  await stage('finite AV capture freezes EOF before page replay, verifies first/last pixels and rejects guessed fields through Bridge',async()=>{
    source!.showInactive()
    const before=fs.readdirSync(artifacts).sort()
    await assert.rejects(bridgeCall({action:'page.read'}),/supportedActions/)
    const help=(await bridgeCall({action:'help',forAction:'media.video.capture'})).result as {inputSchema:{properties:Record<string,unknown>}}
    assert.ok(Object.hasOwn(help.inputSchema.properties,'selector'));assert.ok(!Object.hasOwn(help.inputSchema.properties,'sourceEndSeconds'))
    await assert.rejects(bridgeCall({action:'media.video.capture',selector:'video',sourceEndSeconds:1.5}),/BMW_BROWSER_ARGUMENTS_INVALID/)
    assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
    const fixtureUrl='data:video/mp4;base64,'+fs.readFileSync(converted.path).toString('base64')
    const duration=await source!.webContents.executeJavaScript(`(async()=>{
      const v=document.createElement('video');v.id='finite-capture';v.muted=true;v.src=${JSON.stringify(fixtureUrl)};document.body.append(v);
      await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject});v.currentTime=.2;await new Promise(resolve=>v.onseeked=resolve);
      globalThis.fixtureEnded=0;globalThis.fixtureReplay=e=>{if(e.target===v){globalThis.fixtureEnded++;v.currentTime=0;void v.play()}};window.addEventListener('ended',globalThis.fixtureReplay,true);
      v.loop=true;v.playbackRate=.75;await v.play();return v.duration;
    })()`,true) as number
    const id='finite-capture-tab';kernel.tabs.set(id,{id,projectId:project.id,title:'Finite AV fixture',url:source!.webContents.getURL(),source:'agent',view:{webContents:source!.webContents}});kernel.activeTabId=id
    try{
      const captured=(await bridgeCall({action:'media.video.capture',tabId:id,selector:'#finite-capture',fromStart:true,maxDurationMs:7000,playbackPlan:[{sourceSeconds:.4,pauseMs:700,rate:.5},{sourceSeconds:1.2,rate:2}]})).result as {artifactId:string;path:string;complete:boolean;stopReason:string;sourceStartSeconds:number;sourceEndSeconds:number}
      assert.equal(captured.complete,true);assert.equal(captured.stopReason,'ended');assert.equal(captured.sourceStartSeconds,0);assert.ok(Math.abs(captured.sourceEndSeconds-duration)<.001)
      const decoded=await media.processArtifact({action:'media.decode.check',artifactId:captured.artifactId}) as {completeFile:boolean;tracks:{type:string;endSeconds:number}[]}
      assert.equal(decoded.completeFile,true);assert.deepEqual(decoded.tracks.map(track=>track.type).sort(),['audio','video']);assert.ok(decoded.tracks.every(track=>track.endSeconds>duration+.4))
      const inspected=(await bridgeCall({action:'media.inspect',artifactId:captured.artifactId})).result as MediaInfo&{captureTimeline:{status:string;sourceEndSeconds:number;fileTimestampMapping:string;playbackEvents:{kind:string;sourceSeconds:number;fileSeconds:number;rate:number}[]}}
      assert.equal(inspected.captureTimeline.status,'indexed');assert.equal(inspected.captureTimeline.fileTimestampMapping,'verified');assert.ok(inspected.durationSeconds-duration>.4,'A playback stall must separate source and file clocks')
      assert.ok(inspected.captureTimeline.playbackEvents.some(e=>e.kind==='pause'));assert.ok(inspected.captureTimeline.playbackEvents.some(e=>e.kind==='ratechange'&&e.rate===.5));assert.ok(inspected.captureTimeline.playbackEvents.some(e=>e.kind==='ratechange'&&e.rate===2))
      const sourceTail=await bridgeCall({action:'media.capture.frames.sample',artifactId:captured.artifactId,sourceTimestampsSeconds:[duration-.1,duration-.001]})
      const nativeFrames=(sourceTail.result as {frames:{path:string;sourceTimestampSeconds:number;sourceDistanceSeconds:number;fileTimestampSeconds:number}[]}).frames
      assert.equal(sourceTail.images.length,2)
      for(const frame of nativeFrames){assert.ok(frame.sourceDistanceSeconds>=0&&frame.sourceDistanceSeconds<.2);assert.ok(frame.sourceTimestampSeconds>duration-.25);assert.ok(frame.fileTimestampSeconds>frame.sourceTimestampSeconds+.4)
        const pixel=await source!.webContents.executeJavaScript(`(async()=>{const i=new Image();i.src=${JSON.stringify('data:image/png;base64,'+fs.readFileSync(frame.path).toString('base64'))};await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return [...x.getImageData(40,30,1,1).data]})()`) as number[]
        assert.ok(pixel[2]>180&&pixel[0]<30,'Source-tail PNG must be the real terminal blue, despite the recording clock stall: '+pixel)
      }
      const middle=await bridgeCall({action:'media.capture.frames.sample',artifactId:captured.artifactId,sourceTimestampsSeconds:[duration*.35,duration*.52,duration*.71]});assert.equal(middle.images.length,3)
      const middleFrames=(middle.result as {frames:{sourceTimestampSeconds:number;fileTimestampSeconds:number;sourceDistanceSeconds:number;path:string}[]}).frames
      assert.ok(middleFrames.every(f=>f.sourceDistanceSeconds>=0&&f.sourceDistanceSeconds<.12&&f.fileTimestampSeconds>f.sourceTimestampSeconds+.4),JSON.stringify(middleFrames))
      const originals=(await bridgeCall({action:'media.frames.sample',artifactId:converted.artifactId,timestampsSeconds:middleFrames.map(f=>f.sourceTimestampSeconds+.000002)})).result as Frames
      for(const [i,frame]of middleFrames.entries()){
        const pixels=await source!.webContents.executeJavaScript(`(async()=>{const values=[];for(const data of ${JSON.stringify([fs.readFileSync(frame.path).toString('base64'),fs.readFileSync(originals.frames[i]!.path).toString('base64')])}){const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);values.push([...x.getImageData(40,30,1,1).data])}return values})()`) as number[][]
        assert.ok(pixels[0]!.slice(0,3).every((value,j)=>Math.abs(value-pixels[1]![j]!)<12),'Mapped middle pixels must match the independently decoded original source: '+JSON.stringify(pixels))
      }
      await assert.rejects(bridgeCall({action:'media.capture.frames.sample',artifactId:captured.artifactId,sourceTimestampsSeconds:[duration+.1]}),/CAPTURE_SOURCE_TIME_UNINDEXED/)
      const videoTrack=inspected.tracks.find(track=>track.type==='video')!;process.stderr.write('Mapped AV tracks '+JSON.stringify(inspected.tracks)+'\n');const sampled=await bridgeCall({action:'media.frames.sample',artifactId:captured.artifactId,timestampsSeconds:[videoTrack.startSeconds!+.001,videoTrack.endSeconds!-.05]})
      const frameList=(sampled.result as Frames).frames;assert.equal(frameList.length,2)
      for(const [index,frame]of frameList.entries()){
        const pixel=await source!.webContents.executeJavaScript(`(async()=>{const i=new Image();i.src=${JSON.stringify('data:image/png;base64,'+fs.readFileSync(frame.path).toString('base64'))};await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return [...x.getImageData(40,30,1,1).data]})()`) as number[]
        assert.ok(index===0?pixel[0]>180&&pixel[2]<30:pixel[2]>180&&pixel[0]<30,'Capture must preserve the actual opening red and terminal blue frames: '+pixel)
      }
      const restored=await source!.webContents.executeJavaScript(`(()=>{const v=document.querySelector('#finite-capture');return {ended:globalThis.fixtureEnded,loop:v.loop,rate:v.playbackRate,paused:v.paused,globals:Object.keys(globalThis).filter(k=>k.startsWith('__bmwMediaCapture_'))}})()`) as {ended:number;loop:boolean;rate:number;paused:boolean;globals:string[]}
      assert.ok(restored.ended>=1);assert.equal(restored.loop,true);assert.equal(restored.rate,.75);assert.equal(restored.paused,false);assert.deepEqual(restored.globals,[]);assert.equal(media.isCaptureActive(),false)
      const proof=process.env.BMW_VALIDATION_DIR??'.bmw-runtime/video-capture-eof';fs.mkdirSync(proof,{recursive:true});fs.copyFileSync(captured.path,path.join(proof,'finite-eof.webm'));fs.writeFileSync(path.join(proof,'finite-eof.json'),JSON.stringify({captured,decoded,inspected,restored,nativeFrames,middleFrames},null,2)+'\n')
      const beforeCancel=fs.readdirSync(artifacts).sort(),cancelCapture=new AbortController();setTimeout(()=>cancelCapture.abort(new Error('Mapping capture cancellation during pause')),500)
      await assert.rejects(media.captureVideo({id,title:'Cancel during pause',url:source!.webContents.getURL(),view:{webContents:source!.webContents}},{selector:'#finite-capture',playbackPlan:[{sourceSeconds:.1,pauseMs:5000}]},cancelCapture.signal),/cancellation/)
      assert.equal(media.isCaptureActive(),false);assert.deepEqual(fs.readdirSync(artifacts).sort(),beforeCancel)
      const clean=await source!.webContents.executeJavaScript(`Object.keys(globalThis).filter(k=>k.startsWith('__bmwMediaCapture_'))`);assert.deepEqual(clean,[])

    }finally{await source!.webContents.executeJavaScript(`window.removeEventListener('ended',globalThis.fixtureReplay,true);document.querySelector('#finite-capture').remove();delete globalThis.fixtureReplay;delete globalThis.fixtureEnded`);kernel.tabs.delete(id);kernel.activeTabId=null}
  })
  const webm = await stage('export VP9/Opus WebM and verify both tracks', () => kernel.execute({ action: 'media.convert', artifactId, outputFormat: 'webm', trimStartSeconds: .25, trimEndSeconds: 1.75 })) as Converted
  const webmInfo = await kernel.execute({ action: 'media.inspect', artifactId: webm.artifactId }) as MediaInfo
  assert.deepEqual(webmInfo.tracks.map((track) => track.codec).sort(), ['opus','vp9'])
  await stage('cancel active conversion and verify no partial artifacts or busy state remain', async () => {
    const before = fs.readdirSync(artifacts).sort()
    cancelOnProgress = new AbortController()
    const signal = cancelOnProgress.signal
    await assert.rejects(kernel.execute({ action: 'media.convert', artifactId, outputFormat: 'mp4', outputWidth: 1920, outputHeight: 1080 }, { signal }), /cancellation/)
    cancelOnProgress = undefined
    assert.equal(media.isCaptureActive(), false)
    assert.deepEqual(fs.readdirSync(artifacts).sort(), before)
    await kernel.execute({ action: 'media.inspect', artifactId })
  })
  process.stdout.write(JSON.stringify({ ok: true, engine: 'mediabunny-1.61.0-webcodecs', inputDuration: info.durationSeconds, tracks: info.tracks.map((track) => track.codec), frames: frames.map((frame) => ({ timestamp: frame.timestampSeconds, width: frame.width, height: frame.height })), mp4: { bytes: converted.bytes, duration: exportedInfo.durationSeconds, codecs: exportedInfo.tracks.map((track) => track.codec), playback }, webm: { bytes: webm.bytes, codecs: webmInfo.tracks.map((track) => track.codec) }, cancellation: 'partial outputs removed' }) + '\n')
} catch (error) {
  exitCode = 1
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n')
} finally {
  clearTimeout(timeout)
  await bridge?.close()
  source?.destroy()
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  fs.rmSync(root, { recursive: true, force: true })
  app.exit(exitCode)
}

}
void run()
