import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {app,BrowserWindow,session} from 'electron'
import {videoFeature} from '../packages/feature-video/index.js'
import {GlobalSettingsStore} from '../packages/platform/src/global-settings-store.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {MediaController} from '../packages/media-native/src/media-controller.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-narration-smoke-'))
const artifacts=path.join(temporary,'artifacts');fs.mkdirSync(artifacts);fs.mkdirSync(path.join(temporary,'profile'));app.setPath('userData',path.join(temporary,'profile'))
app.on('window-all-closed',()=>{})
let attempts=0,exitCode=0,cancel:AbortController|undefined,probe:Promise<unknown>|undefined
const server=http.createServer((_request,response)=>{attempts++;response.end('Network must be blocked')})
const timeout=setTimeout(()=>app.exit(1),240_000)
async function run():Promise<void>{
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));await app.whenReady()
  const address=server.address();if(!address||typeof address==='string')throw new Error('Probe server failed')
  const controller=new MediaController({getQwenCredentials:()=>({apiKey:'fixture-native-secret',workspaceId:'fixture-workspace'}),session:session.fromPartition(`bmw-tts-smoke-${process.pid}`),preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:(value:{action?:string;active?:boolean})=>{
    if(value.action==='video.narrate'&&value.active&&process.env.BMW_TTS_TEST_PROVIDER!=='qwen-fixture'){
      const window=BrowserWindow.getAllWindows().find(item=>!item.isDestroyed())
      assert.ok(window)
      if(cancel){setTimeout(()=>cancel?.abort(new Error('TTS cancellation')),50);return}
      probe=new Promise(resolve=>window.webContents.once('did-finish-load',()=>{void window.webContents.executeJavaScript(`fetch('http://127.0.0.1:${address.port}/probe').then(()=>({blocked:false})).catch(()=>({blocked:true}))`).then(resolve)}))
    }
  }})
  if(process.env.BMW_TTS_TEST_PROVIDER==='qwen-fixture'){
    let synthesis=0,downloads=0,cleanupFail=false,mode:'success'|'failure'|'cancel'='success'
    const wav=Buffer.alloc(44+24000*2*2)
    wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40)
    for(let index=0;index<48000;index++)wav.writeInt16LE(Math.round(Math.sin(index/24000*2*Math.PI*440)*10000),44+index*2)
    app.on('session-created',isolated=>{
      if(isolated.isPersistent())return
      const closeConnections=isolated.closeAllConnections.bind(isolated)
      isolated.closeAllConnections=async()=>{if(cleanupFail)throw new Error('Fixture cleanup failure');await closeConnections()}
      isolated.protocol.handle('https',async request=>{
        const url=new URL(request.url)
        if(url.hostname==='fixture-workspace.cn-beijing.maas.aliyuncs.com'){
          synthesis++;assert.equal(request.headers.get('authorization'),'Bearer fixture-native-secret')
          const body=await request.json() as {model:string;input:{voice:string;rate:number}}
          assert.equal(body.model,'qwen-audio-3.1-tts-flash');assert.ok(['anmingyuan_v3.1','huozhuoshi_v3.1','longanlang_v3.1','longsanshu_v3.1'].includes(body.input.voice));assert.equal(body.input.rate,1)
          if(mode==='failure')return new Response('fixture-native-secret',{status:403})
          if(mode==='cancel')cancel?.abort(new Error('Qwen fixture cancellation'))
          return Response.json({output:{finish_reason:'stop',audio:{url:'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/pre/fixture.wav'}}})
        }
        if(url.hostname==='dashscope-result-bj.oss-cn-beijing.aliyuncs.com'){
          downloads++;assert.equal(request.headers.get('authorization'),null);assert.equal(request.headers.get('cookie'),null)
          return new Response(wav,{headers:{'content-type':'audio/wav'}})
        }
        throw new Error('Unexpected Qwen fixture network origin')
      })
    })
    const settingsStore=new GlobalSettingsStore({filePath:path.join(temporary,'settings.json'),onState:undefined})
    settingsStore.update({qwenNarrationEnabled:true})
    const registry=new BrowserCapabilityRegistry({id:'qwen-fixture',name:'BMW',features:[videoFeature]})
    const host={browserKernel:{projectStore:{active:()=>({id:'fixture',name:'Fixture',directory:temporary})},settingsStore,recordingController:controller,execute:async()=>({})}}
    const generated=await registry.execute('video.narrate',host,{action:'video.narrate',narrationRequest:{text:'今日新闻速递。',provider:'qwen-tts',voice:'anmingyuan_v3.1'}})
    const result=generated.value as {voice:string;contentType:string;durationSeconds:number;path:string}
    assert.equal(result.voice,'anmingyuan_v3.1');assert.equal(result.contentType,'audio/wav');assert.equal(result.durationSeconds,2);assert.deepEqual(fs.readFileSync(result.path),wav);assert.equal(controller.isCaptureActive(),false)
    for(const voice of ['huozhuoshi_v3.1','longanlang_v3.1','longsanshu_v3.1'] as const){const next=await registry.execute('video.narrate',host,{action:'video.narrate',narrationRequest:{text:'今日新闻速递。',provider:'qwen-tts',voice}});assert.equal((next.value as {voice:string}).voice,voice)}
    const before=fs.readdirSync(artifacts).sort();mode='failure'
    await assert.rejects(controller.narrate({text:'失败',provider:'qwen-tts',voice:'anmingyuan_v3.1'}),error=>error instanceof Error&&!error.message.includes('fixture-native-secret'))
    assert.equal(controller.isCaptureActive(),false);assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
    mode='cancel';cancel=new AbortController()
    await assert.rejects(controller.narrate({text:'取消',provider:'qwen-tts',voice:'anmingyuan_v3.1'},cancel.signal),/Qwen fixture cancellation/);cancel=undefined
    assert.equal(controller.isCaptureActive(),false);assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
    mode='success';cleanupFail=true
    await assert.rejects(controller.narrate({text:'清理失败',provider:'qwen-tts',voice:'anmingyuan_v3.1'}),/quarantined/)
    assert.equal(controller.isCaptureActive(),true);assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
    await assert.rejects(controller.narrate({text:'不可自动重放',provider:'qwen-tts'}),/Finish the current media job/)
    await assert.rejects(controller.stop(),/Fixture cleanup failure/);assert.equal(controller.isCaptureActive(),true)
    cleanupFail=false;await controller.stop();assert.equal(controller.isCaptureActive(),false)
    const audition=await controller.auditionQwen('anmingyuan_v3.1');assert.equal(audition.durationSeconds,2);assert.ok(audition.audioDataUrl.startsWith('data:audio/wav;base64,'));assert.deepEqual(fs.readdirSync(artifacts).sort(),before)
    assert.equal(synthesis,8);assert.equal(downloads,6)
    console.log(JSON.stringify({ok:true,provider:'qwen-tts',voice:result.voice,duration:result.durationSeconds,synthesis,downloads,cancellation:'clean',cleanupRecovery:true,coverage:'isolated HTTP protocol fixtures; no paid model or listening coverage'}));return
  }
  if(process.env.BMW_TTS_TEST_PROVIDER==='edge'){
    const settingsStore=new GlobalSettingsStore({filePath:path.join(temporary,'settings.json'),onState:undefined}),registry=new BrowserCapabilityRegistry({id:'tts-fixture',name:'BMW',features:[videoFeature]})
    const execution=await registry.execute('video.narrate',{browserKernel:{projectStore:{active:()=>({directory:temporary})},settingsStore,recordingController:controller}},{action:'video.narrate',narrationRequest:{text:'这是 BMW 默认男声配音验证。'}})
    assert.equal(execution.handled,true);const result=execution.value as {path:string;provider:string;voice:string;contentType:string;durationSeconds:number}
    assert.equal(registry.toolDefinition().name,'browser');assert.equal(result.provider,'edge-readaloud');assert.equal(result.voice,'zh-CN-YunxiNeural');assert.equal(result.contentType,'audio/mpeg');assert.ok(result.durationSeconds>1)
    const decoder=new BrowserWindow({show:false,webPreferences:{session:session.fromPartition('edge-decode-'+process.pid),sandbox:true,contextIsolation:true,nodeIntegration:false}});await decoder.loadURL('data:text/html,<title>Edge decode fixture</title>')
    const levels=await decoder.webContents.executeJavaScript(`(async()=>{const context=new AudioContext(),data=Uint8Array.from(${JSON.stringify([...fs.readFileSync(result.path)])}),audio=await context.decodeAudioData(data.buffer);let peak=0,energy=0;for(const sample of audio.getChannelData(0)){peak=Math.max(peak,Math.abs(sample));energy+=sample*sample}await context.close();return {peak,rms:Math.sqrt(energy/audio.length),duration:audio.duration}})()`) as {peak:number;rms:number;duration:number}
    assert.ok(levels.peak>.1&&levels.peak<=1);assert.ok(levels.rms>.01)
    console.log(JSON.stringify({ok:true,provider:result.provider,voice:result.voice,contentType:result.contentType,independentAudio:levels,repositoryDefaultEnabled:settingsStore.snapshot().edgeNarrationEnabled}));return
  }
  const result=await controller.narrate({provider:'local-matcha',voice:'local-zh-en',text:'欢迎来到 BMW。让浏览器画面和中文解说，变成清晰的视频。',ratePercent:15})
  assert.equal(result.provider,'local-matcha');assert.equal(result.contentType,'audio/wav');assert.ok(result.durationSeconds>1)
  assert.deepEqual(await probe,{blocked:true});assert.equal(attempts,0)
  const bytes=fs.readFileSync(result.path);assert.equal(bytes.toString('ascii',0,4),'RIFF')
  let peak=0,energy=0;for(let i=44;i+1<bytes.length;i+=2){const sample=bytes.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(sample));energy+=sample*sample}
  const rms=Math.sqrt(energy/((bytes.length-44)/2));assert.ok(peak>.1&&peak<1);assert.ok(rms>.01)
  const before=fs.readdirSync(artifacts).sort();cancel=new AbortController()
  await assert.rejects(controller.narrate({provider:'local-matcha',voice:'local-zh-en',text:'这次生成应被取消，不应留下半成品。'},cancel.signal),/TTS cancellation/);cancel=undefined
  assert.deepEqual(fs.readdirSync(artifacts).sort(),before);assert.equal(controller.isCaptureActive(),false)
  console.log(JSON.stringify({ok:true,provider:result.provider,duration:result.durationSeconds,peak,rms,networkRequests:attempts,cancellation:'clean',model:'Sherpa-ONNX 1.13.8 Matcha zh/en'}))
 }catch(error:unknown){exitCode=1;console.error(error)}
 finally{clearTimeout(timeout);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));for(const window of BrowserWindow.getAllWindows())window.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.exit(exitCode)}
}
void run()
