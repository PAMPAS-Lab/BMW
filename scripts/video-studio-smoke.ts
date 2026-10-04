import {captureRendererEvidence} from './renderer-evidence.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {app,BrowserWindow,ipcMain,session,webContents} from 'electron'
import type {WebContents} from 'electron'
import {VideoStudioRuntime} from '../packages/feature-video/src/studio-runtime.js'
import {newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import {VideoStudioStore} from '../packages/feature-video/src/studio-store.js'
import type {StudioKernel} from '../packages/feature-video/src/studio-service.js'
import {studioService} from '../packages/feature-video/src/studio-service.js'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {BrowserKernel} from '../packages/browser-capability/src/browser-kernel.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {GlobalSettingsStore} from '../packages/platform/src/global-settings-store.js'
import product from '../apps/bmw/product.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-studio-smoke-')),project={id:'studio-project',name:'Studio fixture',directory:path.join(temporary,'project')},artifacts=path.join(project.directory,'artifacts')
fs.mkdirSync(artifacts,{recursive:true});fs.mkdirSync(path.join(temporary,'profile'));app.setPath('userData',path.join(temporary,'profile'))
let host:BrowserWindow,studio:WebContents,runtime:VideoStudioRuntime,media:MediaController;let active=project,exitCode=0,mode='browser',currentSession='fixture-session'
let phase='initializing'
const timeout=setTimeout(()=>{console.error('Studio smoke timed out: '+phase);app.exit(1)},180_000)
async function waitFor<T>(condition:()=>Promise<T>,label:string):Promise<T>{phase=label;const end=Date.now()+20_000;while(Date.now()<end){const value=await condition();if(value)return value;await new Promise(resolve=>setTimeout(resolve,80))}throw new Error('Timed out: '+label)}
async function script<T>(code:string):Promise<T>{try{return await studio.executeJavaScript(code)}catch(error){console.error('Renderer script failed in '+phase+': '+code.slice(0,250));throw error}}
// This DOM/IPC workflow test supplies Chromium user activation for media playback.
async function click(id:string):Promise<void>{await studio.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`,true)}
async function run():Promise<void>{try{
  phase='Electron ready';await app.whenReady();const isolated=session.fromPartition('studio-smoke-'+process.pid)
  host=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false}});phase='Fixture renderer load';await host.loadURL('data:text/html,<title>Fixture</title>')
  const registry=new BrowserCapabilityRegistry(product)
  media=new MediaController({session:isolated,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:()=>{}})
  const kernel=new BrowserKernel({window:host,session:isolated,capabilityRegistry:registry,permissionStore:{hasAgentControl:()=>true},projectStore:{active:()=>active},artifactsDirectory:artifacts,sessionContinuity:undefined,settingsStore:new GlobalSettingsStore({filePath:path.join(temporary,'settings.json'),onState:undefined}),allowedActions:undefined,onState:undefined});kernel.setRecordingController(media)
  const studioExecute=(request:unknown,signal?:AbortSignal)=>studioService(kernel as unknown as StudioKernel).execute(request,signal,{projectId:active.id,sessionId:currentSession})
  const assistantPrompts:string[]=[]
  runtime=new VideoStudioRuntime();runtime.configure({browserKernel:kernel as unknown as StudioKernel,projectStore:{active:()=>active},getMainWindow:()=>host,getShellWebContents:()=>host.webContents,getTheme:()=> 'light',setWorkspaceMode:value=>{mode=value},getCurrentSessionId:()=>currentSession,isProjectChanging:()=>false,revealAgent:()=>{},getAgentRuntime:()=>({enqueuePrompt:async(sessionId:string,prompt:string)=>{assert.equal(sessionId,'fixture-session');assistantPrompts.push(prompt);return 'fixture-turn'}}),synchronizeAgentProject:async()=>({sessionId:'fixture-session'})});runtime.installIpc(ipcMain)
  const png=await host.webContents.executeJavaScript("(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#e52222';x.fillRect(0,0,320,180);return c.toDataURL('image/png').split(',')[1]})()") as string
  fs.writeFileSync(path.join(artifacts,'source.png'),Buffer.from(png,'base64'))
  const wav=Buffer.alloc(44+48000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(96000,40);for(let i=0;i<48000;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*Math.PI*2)*5000),44+i*2);fs.writeFileSync(path.join(artifacts,'voice.wav'),wav)
  const store=new VideoStudioStore(project.directory,'fixture-session');let draft=store.create('测试成片');draft.scenes.push(newStudioScene('first-scene','\u5f00\u573a'));draft.preparation.artifactIds=['voice.wav'];draft.width=640;draft.height=360;draft.fps=12;Object.assign(draft.scenes[0],{durationSeconds:2,narration:'本段脚本',imageArtifactId:'source.png',captions:[{startSeconds:.5,endSeconds:1.5,text:'手工字幕'}]});draft=store.update(draft.id,1,draft)
  draft=await studioExecute({operation:'attach',draftId:draft.id,expectedRevision:draft.revision,sceneId:draft.scenes[0].id,artifactId:'voice.wav',assetKind:'audio'}) as typeof draft
  phase='Studio renderer load';await runtime.openPanel('video-studio');app.focus({steal:true});host.focus();studio=webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/studio.html'))!
  assert.equal(BrowserWindow.getAllWindows().filter(window=>window!==media.window).length,1,'Studio shares the existing host window');assert.equal(mode,'studio')
  await script("(()=>{window.__audioContexts=[];window.__frameTicks=0;const Audio=window.AudioContext;window.AudioContext=class extends Audio{constructor(...args){super(...args);window.__audioContexts.push(this)}};const frame=()=>{window.__frameTicks++;requestAnimationFrame(frame)};requestAnimationFrame(frame)})()");
  const errors:string[]=[];studio.on('console-message',details=>{if(details.level==='error')errors.push(details.message)})
  await waitFor(()=>script("document.getElementById('scene-title').value==='开场'"),'Studio draft loading')
  assert.equal(await script("typeof window.require"),'undefined');assert.equal(await script("typeof window.process"),'undefined')
  assert.deepEqual(await script("[...document.querySelectorAll('#inspector-tabs [data-inspector]')].map(node=>node.dataset.inspector)"),['visual','voice','captions'])
  assert.equal(await script("document.getElementById('delivery-open').classList.contains('primary')"),false,'Delivery stays neutral before opening')
  await script("document.getElementById('scene-title').value='手动修改';document.getElementById('scene-title').dispatchEvent(new Event('change',{bubbles:true}))")
  await click('save');await waitFor(async()=>store.read(draft.id).scenes[0].title==='手动修改','GUI persists changes');draft=store.read(draft.id);await waitFor(()=>script("document.getElementById('status').textContent==='已保存 · v"+draft.revision+"'&&!document.getElementById('scene-title').disabled"),'GUI save settled')
  const originalExecute=kernel.execute.bind(kernel);let release:()=>void;let began:()=>void;let startedOperation=false
  const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{began=()=>{startedOperation=true;resolve()}})
  kernel.execute=async(request:unknown,options?:{actor?:string;signal?:AbortSignal})=>{if(options?.actor==='user'){began();await gate}return originalExecute(request,options)}
  await script("document.getElementById('scene-title').value='未保存修改';document.getElementById('scene-title').dispatchEvent(new Event('change',{bubbles:true}))")
  await waitFor(async()=>startedOperation,'GUI conflict operation entered');await started
  const agent=structuredClone(draft);agent.scenes[0].title='Agent 最新修改';await studioExecute({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft:agent})
  release();kernel.execute=originalExecute;await waitFor(()=>script("document.getElementById('status').textContent.includes('STUDIO_CONFLICT')"),'Conflict shown');assert.equal(await script("document.getElementById('scene-title').value"),'未保存修改')
  await script("window.confirm=()=>true;undefined");await click('reload');await waitFor(()=>script("document.getElementById('scene-title').value==='Agent 最新修改'"),'Conflict reload')
  await click('play');await waitFor(()=>script("Number(document.getElementById('seek').value)>.1"),'Audio-clock playback');console.log('PASS Studio audio-clock preview',await script("({time:Number(document.getElementById('seek').value),compositorFrames:window.__frameTicks})"));await click('play')
  await script("document.getElementById('seek').value='.8';document.getElementById('seek').dispatchEvent(new Event('input',{bubbles:true}))")
  await waitFor(()=>script("(()=>{const c=document.getElementById('preview'),p=c.getContext('2d').getImageData(320,180,1,1).data;return p[0]>150&&p[1]<70})()"),'Image canvas preview')
  await click('delivery-open');assert.equal(await script("document.getElementById('delivery-open').getAttribute('aria-pressed')==='true'&&!document.getElementById('delivery-panel').hidden"),true);await click('export');await waitFor(async()=>store.read(draft.id).exports.length>0,'Real MP4 export');const exported=store.read(draft.id).exports.at(-1)!
  assert.ok(fs.statSync(path.join(artifacts,exported.artifactId)).size>1000)
  await waitFor(()=>script("document.querySelector('#export-preview video')?.readyState>=2"),'Export playback loaded');const dimensions=await script<{width:number;height:number;duration:number}>("(()=>{const v=document.querySelector('#export-preview video');return {width:v.videoWidth,height:v.videoHeight,duration:v.duration}})()");assert.equal(dimensions.width,640);assert.equal(dimensions.height,360);assert.ok(Math.abs(dimensions.duration-2)<.2)
  const info=await media.processArtifact({action:'media.inspect',artifactId:exported.artifactId}) as {tracks:{codec:string}[]};assert.deepEqual(info.tracks.map(track=>track.codec).sort(),['aac','avc'])
  await click('settings-open');await script("(()=>{document.getElementById('studio-output-panel').open=true;for(const [id,value] of [['ratio','9:16'],['resolution','720p'],['style','clean-light'],['tts-voice','zh-CN-XiaoxiaoNeural'],['tts-rate','5']]){const node=document.getElementById('studio-output-'+id);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}))}document.getElementById('studio-output-watermark-enabled').checked=false;return true})()")
  await click('studio-output-apply');await waitFor(async()=>store.read(draft.id).height===1280,'Portrait parameters saved')
  await waitFor(()=>script("!document.getElementById('studio-output-apply').disabled"),'Configure settled')
  await script("document.getElementById('studio-output-template-name').value='竖屏测试';true");await click('studio-output-template-save')
  await waitFor(()=>script("document.getElementById('status').textContent.includes('模板已保存')"),'Template saved through GUI')
  const savedTemplate=await kernel.execute({action:'video.settings',settingsRequest:{operation:'read'}}) as {templates:{name:string;options:{style:string;tts:{voice:string;ratePercent:number}}}[]}
  assert.equal(savedTemplate.templates[0].name,'竖屏测试');assert.equal(savedTemplate.templates[0].options.style,'clean-light');assert.equal(savedTemplate.templates[0].options.tts.voice,'zh-CN-XiaoxiaoNeural');assert.equal(savedTemplate.templates[0].options.tts.ratePercent,5)
  await click('settings-close');await click('preview-refresh')
  await waitFor(()=>script("document.getElementById('preview').width===720&&document.getElementById('preview').height===1280"),'Portrait preview dimensions')
  await script("document.getElementById('seek').value='.8';document.getElementById('seek').dispatchEvent(new Event('input',{bubbles:true}));true")
  await waitFor(()=>script("(()=>{const p=document.getElementById('preview').getContext('2d').getImageData(5,5,1,1).data;return p[0]>240&&p[1]>240&&p[2]>240})()"),'Light portrait preview painted')
  await click('delivery-open');await click('export');await waitFor(async()=>store.read(draft.id).exports.length===2,'Portrait MP4 export')
  await waitFor(()=>script("document.querySelector('#export-preview video')?.videoHeight===1280"),'Independent portrait playback')
  assert.equal(await script("document.querySelector('#export-preview video').videoWidth"),720)
  const frameDifference=await script<number>("(async()=>{const video=document.querySelector('#export-preview video');await video.play();await new Promise(resolve=>setTimeout(resolve,100));video.pause();const actual=document.createElement('canvas');actual.width=720;actual.height=1280;const x=actual.getContext('2d');x.drawImage(video,0,0);const preview=document.getElementById('preview').getContext('2d');const a=x.getImageData(5,5,1,1).data,b=preview.getImageData(5,5,1,1).data;return Math.max(...[0,1,2].map(i=>Math.abs(a[i]-b[i])))})()")
  assert.ok(frameDifference<8,'Preview and MP4 share the selected light background')

  await waitFor(()=>script("document.querySelector('#export-preview video')?.readyState>=2&&!document.getElementById('export').disabled"),'First export and reuse state ready')
  const exportRevision=store.read(draft.id).revision,exportCount=store.read(draft.id).exports.length
  await click('export');await waitFor(()=>script("document.getElementById('status').textContent.includes('未重新制作')"),'MP4 reuse returns existing output')
  assert.equal(store.read(draft.id).revision,exportRevision);assert.equal(store.read(draft.id).exports.length,exportCount)
  await click('export-existing');await waitFor(()=>script("document.querySelector('#export-preview video')?.readyState>=2&&document.getElementById('status').textContent.includes('已有成片')"),'Existing MP4 opens without render')
  assert.equal(store.read(draft.id).exports.length,exportCount)
  await click('export-remake');await waitFor(async()=>store.read(draft.id).exports.length===exportCount+1,'Explicit remake creates a new completed output')
  await waitFor(()=>script("document.querySelector('#export-preview video')?.readyState>=2&&!document.getElementById('export').disabled"),'Remake playback ready')
  console.log('PASS Studio delivery: unchanged MP4 reused without revision/journal changes, existing download and explicit remake')

  // Distinct images prove that selection changes decoded pixels, not just labels.
  for(const [name,color] of [['blue.png','#2255e5'],['green.png','#22e555']] as const){
    const image=await host.webContents.executeJavaScript(`(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle=${JSON.stringify(color)};x.fillRect(0,0,320,180);return c.toDataURL('image/png').split(',')[1]})()`) as string
    fs.writeFileSync(path.join(artifacts,name),Buffer.from(image,'base64'))
  }

  for(const [name,color] of [['yellow.png','#e5cc22'],['other.png','#cc22e5']] as const){
    const image=await host.webContents.executeJavaScript(`(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle=${JSON.stringify(color)};x.fillRect(0,0,320,180);return c.toDataURL('image/png').split(',')[1]})()`) as string
    fs.writeFileSync(path.join(artifacts,name),Buffer.from(image,'base64'))
  }
  let otherDraft=store.create('Other video');otherDraft.scenes.push(newStudioScene('other-scene'));otherDraft.scenes[0].imageArtifactId='other.png';otherDraft=store.update(otherDraft.id,otherDraft.revision,otherDraft)
  const multiple=store.read(draft.id)
  for(const [id,title,image,duration] of [['second','Second scene','blue.png',1.25],['third','Third scene','green.png',1]] as const){
    multiple.scenes.push({...structuredClone(multiple.scenes[0]),id,title,imageArtifactId:image,durationSeconds:duration,narration:'',audioArtifactId:undefined,audioText:undefined,audioDurationSeconds:undefined,captions:undefined})
  }
  await studioExecute({operation:'update',draftId:multiple.id,expectedRevision:multiple.revision,draft:multiple})
  await waitFor(()=>script("document.querySelectorAll('#scene-list button').length===3"),'Multiple scenes loaded')
  async function selectedFrame(index:number,time:number,channel:number):Promise<void>{
    await waitFor(()=>script(`(()=>{const c=document.getElementById('preview'),p=c.getContext('2d').getImageData(360,640,1,1).data;return Math.abs(Number(document.getElementById('seek').value)-${time})<.001&&document.querySelectorAll('#scene-list button')[${index}].classList.contains('selected')&&document.getElementById('play').textContent==='播放'&&p[${channel}]>150&&p[${(channel+1)%3}]<100})()`),'Selected scene pixels and time')
  }
  // Start with an unprepared preview and rapidly choose different scenes.
  await script("document.querySelectorAll('#scene-list button')[1].click();document.querySelectorAll('#scene-list button')[0].click();document.querySelectorAll('#scene-list button')[2].click();true")
  await selectedFrame(2,3.25,1)
  await click('play');await waitFor(()=>script("Number(document.getElementById('seek').value)>3.35&&document.getElementById('play').textContent==='暂停'"),'Playback from selected scene')
  await script("document.querySelectorAll('#scene-list button')[1].click();true");await selectedFrame(1,2,2)
  await script("new Promise(resolve=>setTimeout(resolve,120))");assert.equal(await script("Number(document.getElementById('seek').value)"),2,'Scene selection pauses the previous audio clock')
  await script("document.querySelectorAll('#timeline button')[0].click();true");await selectedFrame(0,0,0)
  await script("document.querySelector('[data-stage=\"1\"]').click();true");await script("document.querySelectorAll('#scene-list button')[1].click();true")
  await script("document.querySelector('[data-stage=\"4\"]').click();true");await selectedFrame(1,2,2)
  await script("document.querySelectorAll('#scene-list button')[0].click();true");await selectedFrame(0,0,0)
  assert.deepEqual((await runtime.contextForSession('fixture-session',project.id)).text.includes('"sceneId":"'+multiple.scenes[0].id+'"'),true)
  console.log('PASS Studio scene navigation: unprepared rapid list selection, decoded scene pixels, exact cumulative time, playback pause, timeline backward seek and returning to preview')

  // The library uses actual decoded thumbnail pixels and native media controls.
  await script("document.querySelector('[data-stage=\"0\"]').click();true")
  await waitFor(()=>script("document.querySelector('[data-material-group=current] [data-asset-id=\"source.png\"] .material-thumb img')?.complete"),'Current image thumbnail')
  assert.equal(await script("document.querySelector('[data-material-group=current] [data-asset-id=\"voice.wav\"]')!==null"),true)
  assert.equal(await script("document.querySelector('[data-material-group=unused] [data-asset-id=\"yellow.png\"]')!==null"),true)
  assert.equal(await script("document.querySelector('[data-material-group=current] [data-asset-id=\"blue.png\"]')!==null"),true)
  for(const id of ['yellow.png','other.png',exported.artifactId]){await script(`document.querySelector('[data-asset-id="'+${JSON.stringify(id)}+'"]>button:last-child').click();true`);await waitFor(()=>script("!document.querySelector('[data-material-group=current] button').disabled"),'Preparation selection saved')}
  assert.equal((await runtime.contextForSession('fixture-session',project.id)).text.includes('"sceneId"'),false,'Preparation context has no current scene')
  await script("document.querySelector('[data-asset-id=\"source.png\"] .material-thumb').click();true")
  await waitFor(()=>script("document.querySelector('.material-preview-body img')?.naturalWidth===320"),'Full image preview')
  await script("document.querySelector('.material-preview-dialog .row button').click();true")
  await script("document.querySelector('[data-asset-id=\"voice.wav\"] .material-thumb').click();true")
  await waitFor(()=>script("document.querySelector('.material-preview-body audio')?.readyState>=1"),'Native audio preview controls')
  assert.equal(await script("document.querySelector('.material-preview-body audio').controls"),true)
  await script("document.querySelector('.material-preview-dialog .row button').click();true")
  await script(`document.querySelector('[data-asset-id="'+${JSON.stringify(exported.artifactId)}+'"] .material-thumb').scrollIntoView();true`)
  await waitFor(()=>script(`document.querySelector('[data-asset-id="'+${JSON.stringify(exported.artifactId)}+'"] .material-thumb img')?.complete`),'Decoded video thumbnail')
  const thumbRed=await script<boolean>(`(()=>{const img=document.querySelector('[data-asset-id="'+${JSON.stringify(exported.artifactId)}+'"] .material-thumb img'),c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.drawImage(img,0,0);const p=x.getImageData(160,90,1,1).data;return p[0]>150&&p[1]<100})()`)
  assert.equal(thumbRed,true,'MP4 thumbnail is the actual decoded red image')
  await script(`document.querySelector('[data-asset-id="'+${JSON.stringify(exported.artifactId)}+'"] .material-thumb').click();true`)
  await waitFor(()=>script("document.querySelector('.material-preview-body video')?.videoWidth===640"),'Native video preview')
  await script("document.querySelector('.material-preview-dialog .row button').click();document.querySelector('.center').scrollTop=0;true")
  async function dropAsset(id:string,target:string,foreign=false):Promise<void>{
    await script(`(()=>{const card=document.querySelector('[data-asset-id="'+${JSON.stringify(id)}+'"]'),data=new DataTransfer();card?.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));if(!card||${foreign})data.setData('application/x-bmw-studio-material',JSON.stringify({projectId:${foreign}?'foreign':${JSON.stringify(project.id)},artifactId:${JSON.stringify(id)}}));const target=document.querySelector(${JSON.stringify(target)});target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));return true})()`)
  }
  await script("document.querySelectorAll('#scene-list button')[0].click();true");await waitFor(()=>script("document.querySelector('[data-drop-slot=visual]')!==null"),'Scene selects matching materials');assert.equal(await script("document.querySelector('[data-asset-id=\"voice.wav\"]')===null"),true,'Matching excludes audio')
  assert.equal(await script("document.querySelector('[data-material-group=elsewhere] [data-asset-id=\"other.png\"]')!==null"),true)
  const beforeDrop=store.read(draft.id).revision
  await dropAsset('voice.wav','[data-drop-slot=visual]')
  await waitFor(()=>script("document.getElementById('status').textContent.includes('当前 Project')"),'Wrong-kind drop rejected')
  await dropAsset('yellow.png','[data-drop-slot=visual]',true)
  assert.equal(store.read(draft.id).revision,beforeDrop,'Rejected drops cannot write draft revisions')
  await dropAsset('yellow.png','[data-drop-slot=visual]')
  await waitFor(async()=>store.read(draft.id).scenes[0].imageArtifactId==='yellow.png','Image drop persists')
  await waitFor(()=>script("!document.getElementById('undo').disabled&&document.querySelector('[data-material-group=current] [data-asset-id=\"yellow.png\"]')!==null"),'Groups update after replacement')
  await click('undo');await waitFor(async()=>store.read(draft.id).scenes[0].imageArtifactId==='source.png','Image drop undo')
  await waitFor(()=>script("!document.getElementById('redo').disabled"),'Undo settled');await click('redo');await waitFor(async()=>store.read(draft.id).scenes[0].imageArtifactId==='yellow.png','Image drop redo')
  await waitFor(()=>script("!document.getElementById('undo').disabled"),'Redo settled');await click('undo');await waitFor(async()=>store.read(draft.id).scenes[0].imageArtifactId==='source.png','Restore original visual')
  await waitFor(()=>script("!document.getElementById('scene-title').disabled"),'Restore settled')
  await dropAsset('yellow.png','#scene-list button:nth-child(2)')
  await waitFor(async()=>store.read(draft.id).scenes[1].imageArtifactId==='yellow.png','Drop on another scene')
  assert.equal(store.read(draft.id).scenes[0].imageArtifactId,'source.png','Scene-row drop changes only its target')
  await waitFor(()=>script("!document.getElementById('undo').disabled"),'Row drop settled');await click('undo');await waitFor(async()=>store.read(draft.id).scenes[1].imageArtifactId==='blue.png','Row drop undo')
  await waitFor(()=>script("!document.getElementById('scene-title').disabled"),'Row undo settled')

  await dropAsset(exported.artifactId,'#scene-list button:nth-child(2)')
  await waitFor(async()=>store.read(draft.id).scenes[1].videoArtifactId===exported.artifactId,'Video drop binds measured source')
  assert.equal(store.read(draft.id).scenes[1].imageArtifactId,undefined)
  assert.ok(Math.abs(store.read(draft.id).scenes[1].sourceDurationSeconds!-2)<.2)
  await waitFor(()=>script("!document.getElementById('undo').disabled"),'Video drop settled');await click('undo');await waitFor(async()=>store.read(draft.id).scenes[1].imageArtifactId==='blue.png','Video drop undo restores image')
  await waitFor(()=>script("!document.getElementById('scene-title').disabled"),'Video undo settled')
  await script("document.querySelector('[data-stage=\"1\"]').click();document.querySelectorAll('#scene-list button')[1].click();true");await waitFor(()=>script("document.getElementById('script-current-title').textContent.includes('2 / 3')"),'Raw audio owning scene');await script("document.getElementById('script-raw-audio').value='voice.wav';document.getElementById('script-bind-audio').click();true")
  await waitFor(async()=>store.read(draft.id).scenes[1].audioArtifactId==='voice.wav','Audio drop uses measured duration')
  assert.equal(store.read(draft.id).scenes[1].durationSeconds,2)
  await waitFor(()=>script("!document.getElementById('undo').disabled"),'Audio drop settled');await click('undo');await waitFor(async()=>!store.read(draft.id).scenes[1].audioArtifactId,'Undo clears a newly attached voice')
  assert.equal(store.read(draft.id).scenes[1].durationSeconds,1.25)
  await waitFor(()=>script("!document.getElementById('scene-title').disabled"),'Audio undo settled')
  await script("document.querySelector('[data-stage=\"1\"]').click();document.querySelectorAll('#scene-list button')[0].click();true")
  await waitFor(()=>script("document.getElementById('script-current-title').textContent.includes('1 / 3')"),'Global script outline')
  assert.equal(await script("document.querySelector('.script-scene span').textContent"),'本段脚本')
  await script("document.getElementById('script-current').value='当前分镜改写';document.getElementById('script-current').dispatchEvent(new Event('input',{bubbles:true}));true")
  assert.equal(await script("document.querySelector('.script-scene.selected span').textContent"),'当前分镜改写','Live script input mirrors into the global outline')
  // Selection must flush still-focused input before changing its owning scene.
  await script("document.querySelectorAll('.script-scene')[1].click();true")
  await waitFor(()=>script("document.getElementById('script-current-title').textContent.includes('2 / 3')"),'Outline selects owning scene after saving input')
  assert.equal(store.read(draft.id).scenes[0].narration,'当前分镜改写');assert.equal(store.read(draft.id).scenes[1].narration,'')
  assert.equal(await script("document.getElementById('narration').value"),'')
  await script("document.querySelectorAll('#scene-list button')[0].click();true")
  await waitFor(()=>script("document.getElementById('script-current').value==='当前分镜改写'"),'Left scene list updates current script')
  assert.equal(await script("document.getElementById('script-current-note').textContent.includes('过期')"),true)
  await click('undo');await waitFor(async()=>store.read(draft.id).scenes[0].narration==='本段脚本','Script undo')
  await waitFor(()=>script("!document.getElementById('redo').disabled"),'Script undo settled');await click('redo');await waitFor(async()=>store.read(draft.id).scenes[0].narration==='当前分镜改写','Script redo')
  await waitFor(()=>script("!document.getElementById('undo').disabled"),'Script redo settled');await click('undo');await waitFor(async()=>store.read(draft.id).scenes[0].narration==='本段脚本','Restore original script')
  await waitFor(()=>script("!document.getElementById('scene-title').disabled"),'Script restore settled')
  const libraryProof=process.env.BMW_VALIDATION_DIR??'.bmw-runtime/studio-validation';fs.mkdirSync(libraryProof,{recursive:true})
  fs.writeFileSync(path.join(libraryProof,'studio-script.png'),(await captureRendererEvidence(studio)).toPNG())
  await script("document.querySelector('[data-stage=\"0\"]').click();true")
  await waitFor(()=>script("document.querySelector('[data-material-group=current] .material-thumb img')?.complete"),'Library restored thumbnail')
  fs.writeFileSync(path.join(libraryProof,'studio-materials.png'),(await captureRendererEvidence(studio)).toPNG())
  await script("document.querySelector('[data-stage=\"4\"]').click();true");await selectedFrame(0,0,0)
  console.log('PASS Studio library/scripts: real image/video thumbnails, native media preview, Project usage groups, drag slot and scene replacement, rejected foreign/kind drops, audio/image undo, global/current scripts, pending-input save and script undo')
  const proof=process.env.BMW_VALIDATION_DIR??'.bmw-runtime/studio-validation';const pngPreview=(await captureRendererEvidence(studio)).toPNG();fs.mkdirSync(proof,{recursive:true});fs.writeFileSync(path.join(proof,'studio-light.png'),pngPreview)
  await script("document.body.classList.add('dark');new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");assert.equal(await script("getComputedStyle(document.body).backgroundColor"),'rgb(24, 26, 29)');fs.writeFileSync(path.join(proof,'studio-dark.png'),(await captureRendererEvidence(studio)).toPNG())
  // Geometry is tested in real Chromium at wide, portrait and narrow workspace sizes.
  async function workbenchGeometry(width:number,height:number):Promise<void>{
    runtime.layout({x:0,y:0,width,height},true)
    await waitFor(()=>script(`innerWidth===${width}&&innerHeight===${height}`),'Workbench viewport resized')
    await script("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
    const boxes=await script<{canvas:{x:number;y:number;width:number;height:number};transport:{y:number;bottom:number};dock:{y:number;bottom:number};overflow:boolean}>("(()=>{const c=document.getElementById('canvas-surface').getBoundingClientRect(),t=document.getElementById('transport').getBoundingClientRect(),d=document.getElementById('timeline-dock').getBoundingClientRect();return {canvas:{x:c.x,y:c.y,width:c.width,height:c.height},transport:{y:t.y,bottom:t.bottom},dock:{y:d.y,bottom:d.bottom},overflow:document.body.scrollWidth>innerWidth}})()")
    assert.ok(boxes.canvas.width>90&&boxes.canvas.height>=110,JSON.stringify(boxes));assert.ok(boxes.transport.bottom<=boxes.dock.y+1);assert.ok(boxes.dock.bottom<=height);assert.equal(boxes.overflow,false)
    await script("document.getElementById('inspector-scroll').scrollTop=10000;true")
    const after=await script<{x:number;y:number}>("(()=>{const b=document.getElementById('canvas-surface').getBoundingClientRect();return {x:b.x,y:b.y}})()")
    assert.deepEqual(after,{x:boxes.canvas.x,y:boxes.canvas.y},'Inspector scrolling cannot displace the frame')
    fs.writeFileSync(path.join(proof,`studio-workbench-${width}.png`),(await captureRendererEvidence(studio)).toPNG())
  }
  await click('tab-visual');await selectedFrame(0,0,0)
  assert.equal(await script("document.getElementById('captions').closest('label').hidden"),true,'Legacy raw caption field remains hidden');await workbenchGeometry(1220,800);await workbenchGeometry(900,700);await workbenchGeometry(600,760);runtime.layout({x:0,y:102,width:900,height:700},true)
  await waitFor(()=>script("innerWidth===900"),'Workbench normal size restored')
  await script("document.getElementById('scene-title').focus();document.getElementById('scene-title').value='Inspector handoff';document.getElementById('scene-title').dispatchEvent(new Event('input',{bubbles:true}));true")
  await click('tab-voice');await waitFor(()=>script("document.getElementById('tab-voice').getAttribute('aria-selected')==='true'&&!document.getElementById('scene-title').disabled"),'Focused input survives inspector switch')
  assert.equal(store.read(draft.id).scenes[0].title,'Inspector handoff');await click('undo');await waitFor(()=>script("document.getElementById('scene-title').value==='Agent 最新修改'&&!document.getElementById('scene-title').disabled"),'Inspector edit is undoable')
  await click('tab-visual');await script("document.querySelector('#timeline-visuals [data-scene-index=\"1\"]').click();true");await selectedFrame(1,2,2)
  assert.equal(await script("document.getElementById('inspector-context').textContent.includes('2 / 3')"),true)
  await script("document.getElementById('seek').value='3.5';document.getElementById('seek').dispatchEvent(new Event('input',{bubbles:true}));true")
  await waitFor(()=>script("document.querySelectorAll('#scene-list button')[2].classList.contains('selected')&&document.getElementById('inspector-context').textContent.includes('3 / 3')"),'Scrub updates owning inspector')
  assert.match((await runtime.contextForSession('fixture-session',project.id)).text,/"sceneId":"third"/)
  await click('tab-captions');assert.equal(await script("Number(document.getElementById('seek').value)"),3.5,'Changing inspector preserves playhead');await click('settings-open');assert.equal(await script("!document.getElementById('music').closest('label').hidden"),true,'Music remains available from every inspector');await click('settings-close');await click('play');await script("document.querySelector('#timeline button[data-scene-index=\"0\"]').click();true");await selectedFrame(0,0,0)
  assert.equal(await script("document.getElementById('tab-visual').getAttribute('aria-selected')"),'true')
  assert.equal(await script("document.getElementById('cancel').hidden"),true,'Idle UI does not expose cancellation')
  console.log('PASS Workbench UI: persistent portrait frame/transport at 1220/900/600 widths, independent inspector scroll, focused-input tab save/undo, timed visual seek, scrub context synchronization and idle cancellation')
  await click('leave');await waitFor(async()=>mode==='browser','Return to browser');assert.equal(mode,'browser');assert.equal(host.isDestroyed(),false);assert.equal(studio.isDestroyed(),false);assert.deepEqual(await runtime.contextForSession('fixture-session',project.id),{text:''});await runtime.openPanel('video-studio');assert.equal(mode,'studio')
  await script("document.getElementById('scene-title').focus();document.getElementById('scene-title').value='未失焦输入';document.getElementById('scene-title').dispatchEvent(new Event('input',{bubbles:true}));true")
  const context=await runtime.contextForSession('fixture-session',project.id);assert.match(context.text,/未失焦输入/);assert.equal(store.read(draft.id).scenes[0].title,'未失焦输入');
  await runtime.setMode('browser');await runtime.openPanel('video-studio');await waitFor(()=>script("!document.getElementById('undo').disabled"),'Undo history retained across modes');await click('undo');await waitFor(()=>script("document.getElementById('scene-title').value==='Agent 最新修改'"),'Undo after mode switch');await waitFor(()=>script("!document.getElementById('redo').disabled"),'Undo save completes before redo');await click('redo');await waitFor(()=>script("document.getElementById('scene-title').value==='未失焦输入'"),'Redo after mode switch');assert.equal((await runtime.contextForSession('foreign-session',project.id)).text,'');
  await waitFor(()=>script("!document.getElementById('scene-title').disabled"),'Redo save completes before next edit')
  await script("document.getElementById('scene-title').value='跨项目未保存';document.getElementById('scene-title').dispatchEvent(new Event('change',{bubbles:true}))");active={...project,id:'other-project'};runtime.onProjectActivated();await assert.rejects(script(`window.bmwStudio.command(${JSON.stringify(project.id)},{operation:'list'})`),/no longer active/)
  active=project;runtime.onProjectActivated();await runtime.openPanel('video-studio');await waitFor(()=>script("document.getElementById('scene-title').value==='跨项目未保存'"),'Unsaved Project draft restore');assert.equal(await script("document.getElementById('scene-title').value"),'跨项目未保存');assert.deepEqual(errors,[],'Studio renderer errors');console.log('PASS Studio: isolated main-frame bridge, GUI save/Agent conflict, image preview, named template save, portrait/light preview and real H264/AAC export and Project-transition exclusion')

  // New preparation has no implicit scene. These are real renderer/IPC/CAS tests.
  await click('new-draft');await waitFor(()=>script("document.querySelector('[data-stage=\"0\"]').classList.contains('active')&&document.getElementById('draft-title').value==='新视频'"),'Empty preparation draft')
  let prepared=store.list().find(value=>value.title==='新视频')!;assert.equal(prepared.scenes.length,0);assert.equal(await script("document.getElementById('scene-navigation').hidden"),true)
  fs.writeFileSync(path.join(artifacts,'notes.md'),'<script>untrusted material</script>');await click('reload');await waitFor(()=>script("document.querySelector('[data-asset-id=\"notes.md\"] .material-thumb')!==null"),'Prepared text library refresh')
  const huge=Buffer.from(png,'base64');huge.writeUInt32BE(8192,16);huge.writeUInt32BE(8192,20);fs.writeFileSync(path.join(artifacts,'oversized.png'),huge)
  await click('reload');await waitFor(()=>script("document.querySelector('[data-asset-id=\"oversized.png\"] .material-thumb')!==null&&!document.getElementById('draft-title').disabled"),'Oversized material loaded')
  await script("window.__bitmapOriginal=window.createImageBitmap;window.__oversizedDecodes=0;window.createImageBitmap=async(...args)=>{const blob=args[0];if(blob instanceof Blob){const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.length>24&&bytes[0]===137&&new DataView(bytes.buffer).getUint32(16)===8192)window.__oversizedDecodes++}return window.__bitmapOriginal.apply(window,args)};document.querySelector('[data-asset-id=\"oversized.png\"] .material-thumb').click();true")
  await waitFor(()=>script("document.querySelector('.material-preview-body')?.textContent.includes('pixel limit')"),'Oversized image rejected before browser allocation')
  assert.equal(await script("window.__oversizedDecodes"),0);await script("document.querySelector('.material-preview-dialog .row button').click();window.createImageBitmap=window.__bitmapOriginal;true")
  await script("document.querySelector('[data-asset-id=\"notes.md\"] .material-thumb').click();true");await waitFor(()=>script("document.querySelector('.material-text')?.textContent==='<script>untrusted material</script>'"),'Text preview is literal')
  await script("document.querySelector('.material-preview-dialog .row button').click();document.querySelector('[data-asset-id=\"notes.md\"]>button:last-child').click();true");await waitFor(()=>script("!document.getElementById('draft-title').disabled"),'Prepared text saved')
  await script("document.getElementById('preparation-notes').value='Prepared content';document.getElementById('preparation-notes').dispatchEvent(new Event('input',{bubbles:true}));true");await click('save');await waitFor(()=>script("!document.getElementById('draft-title').disabled&&document.getElementById('status').textContent.startsWith('\u5df2\u4fdd\u5b58')"),'Prepared notes saved')
  await click('studio-script-assistant');await waitFor(async()=>assistantPrompts.length===1,'Script Assistant uses existing Project session');assert.match(assistantPrompts[0],/read-material/);assert.match(assistantPrompts[0],/Prepared content/);assert.equal(store.read(prepared.id).scenes.length,0,'Enqueue does not mutate draft')
  await script("document.getElementById('preparation-outline').value='Opening\\nConclusion';document.getElementById('preparation-outline').dispatchEvent(new Event('input',{bubbles:true}));true");await click('outline-to-scenes')
  await waitFor(()=>script("document.querySelectorAll('.script-scene').length===2&&!document.getElementById('draft-title').disabled"),'Outline starts scene script creation')
  prepared=store.read(prepared.id);assert.equal(prepared.preparation.notes,'Prepared content');assert.deepEqual(prepared.preparation.artifactIds,['notes.md']);assert.equal(prepared.scenes[0].visualBrief,'Opening')
  assert.equal(await script("document.querySelectorAll('[data-script-scene]')[0].dataset.scriptScene===document.querySelectorAll('[data-audio-scene]')[0].dataset.audioScene"),true,'Each script has its own audio row')
  // Stub only the speech provider to verify exact UI routing without network TTS.
  const narrate=media.narrate.bind(media),requested:string[]=[]
  media.narrate=async raw=>{const text=(raw as {text:string}).text;requested.push(text);const artifactId='generated-'+requested.length+'.wav';fs.copyFileSync(path.join(artifacts,'voice.wav'),path.join(artifacts,artifactId));return {artifactId,durationSeconds:1,provider:'local-matcha',voice:'local-zh-en',ratePercent:0,text,path:path.join(artifacts,artifactId),bytes:wav.length,type:'audio',contentType:'audio/wav'}}
  await script("document.getElementById('script-current').value='First script';document.getElementById('script-current').dispatchEvent(new Event('input',{bubbles:true}));true");await click('script-narrate')
  await waitFor(()=>script("document.getElementById('script-audio-status').textContent.includes('已就绪')&&!document.getElementById('draft-title').disabled"),'Script generates its paired voice')
  prepared=store.read(prepared.id);assert.deepEqual(requested,['First script']);assert.equal(prepared.scenes[0].audioText,'First script');assert.equal(prepared.scenes[1].audioArtifactId,undefined)
  await script("document.getElementById('script-current').value='Rewritten script';document.getElementById('script-current').dispatchEvent(new Event('input',{bubbles:true}));true");await click('script-narrate');await waitFor(()=>script("!document.getElementById('draft-title').disabled&&document.getElementById('script-audio-status').textContent.includes('已就绪')"),'Only rewritten voice regenerates')
  prepared=store.read(prepared.id);assert.deepEqual(requested,['First script','Rewritten script']);assert.equal(prepared.scenes[0].audioArtifactId,'generated-2.wav');assert.equal(prepared.scenes[1].audioArtifactId,undefined)
  await script("document.querySelector('[data-stage=\"4\"]').click();true");await waitFor(()=>script("document.getElementById('preview-empty').hidden"),'Prepared script preview')
  await click('tab-captions');await waitFor(()=>script("!document.getElementById('caption-panel').hidden"),'Caption inspector opened')
  const voiceBinding={id:prepared.scenes[0].audioArtifactId,text:prepared.scenes[0].audioText,duration:prepared.scenes[0].audioDurationSeconds}
  await script("document.getElementById('caption-text-0').value='字幕独立修正';document.getElementById('caption-text-0').dispatchEvent(new Event('input',{bubbles:true}));true");await click('save')
  await script("document.getElementById('caption-position').value='top';document.getElementById('caption-position').dispatchEvent(new Event('change',{bubbles:true}));true");await waitFor(()=>script("!document.getElementById('draft-title').disabled"),'Caption position saved')
  prepared=store.read(prepared.id);assert.equal(prepared.scenes[0].captions![0].text,'字幕独立修正');assert.equal(prepared.scenes[0].captionStyle!.position,'top');assert.deepEqual({id:prepared.scenes[0].audioArtifactId,text:prepared.scenes[0].audioText,duration:prepared.scenes[0].audioDurationSeconds},voiceBinding);assert.equal(requested.length,2,'Captions do not generate speech')
  fs.writeFileSync(path.join(libraryProof,'studio-captions.png'),(await captureRendererEvidence(studio)).toPNG())

  // Batch creation flushes focused input, skips current speech and exposes measured
  // issues through the same authenticated Studio command used by the model.
  await script("document.querySelector('[data-stage=\"1\"]').click();document.querySelectorAll('#scene-list button')[1].click();true")
  await waitFor(()=>script("document.getElementById('script-current-title').textContent.includes('2 / 2')"),'Batch scene selection')
  await script("document.getElementById('script-current').value='Second batch script';document.getElementById('script-current').dispatchEvent(new Event('input',{bubbles:true}));true")
  // Batch flushes focused edits before deriving which scenes need speech.
  await waitFor(()=>script("!document.getElementById('studio-narrate-pending').disabled"),'Pending batch button enabled')
  await click('studio-narrate-pending');await waitFor(()=>script("document.getElementById('status').textContent.includes('已制作 1 段旁白')"),'Batch narration settled')
  prepared=store.read(prepared.id);assert.deepEqual(requested,['First script','Rewritten script','Second batch script']);assert.equal(prepared.scenes[0].audioArtifactId,'generated-2.wav');assert.equal(prepared.scenes[1].audioText,'Second batch script')
  assert.equal(await script("document.getElementById('studio-narrate-pending').disabled"),true)
  const checkedRevision=prepared.revision;await click('studio-check');await waitFor(()=>script("document.getElementById('status').textContent.includes('制作检查发现问题')"),'Measured production issues')
  assert.equal(store.read(prepared.id).revision,checkedRevision,'Production check does not edit saved state')
  assert.equal(await script("document.getElementById('studio-production-summary').textContent.includes('已检查素材')"),true)
  await script("document.querySelector('#studio-issues button').click();true");await waitFor(()=>script("document.querySelectorAll('#scene-list button')[0].classList.contains('selected')"),'Issue selects its owning scene')
  const checked=await kernel.execute({action:'video.studio',studioRequest:{operation:'check',draftId:prepared.id,expectedRevision:prepared.revision}},{sessionOwner:{projectId:active.id,sessionId:currentSession}}) as {ready:boolean;issues:{sceneId:string;code:string}[]}
  assert.equal(checked.ready,false);assert.equal(checked.issues.filter(issue=>issue.code==='missing-visual').length,2)
  console.log('PASS Studio production controls: pending batch routes one script, retains current voice, disables completed batch, read-only measured report and scene issue navigation')
  for(const format of ['srt','vtt']){
    await click('studio-export-'+format);await waitFor(()=>script(`document.getElementById('status').textContent.includes('${format.toUpperCase()}')`),'Project '+format+' export')
    assert.equal(await script(`document.querySelector('#studio-subtitle-exports [data-format=\"${format}\"]')!==null`),true)
    const id=fs.readdirSync(artifacts).find(id=>id.endsWith('.'+format))!;assert.ok(id);const text=fs.readFileSync(path.join(artifacts,id),'utf8');assert.match(text,/字幕独立修正/);assert.match(text,/Second batch script/);assert.match(text,format==='srt'?/00:00:02,500/:/00:00:02\.500/);assert.equal(store.read(prepared.id).revision,checkedRevision)
  }
  const revisionBeforeMatch=prepared.revision
  prepared=await studioExecute({operation:'attach',draftId:prepared.id,expectedRevision:prepared.revision,sceneId:prepared.scenes[0].id,artifactId:'source.png',assetKind:'image'}) as typeof prepared
  await waitFor(()=>script("!document.getElementById('draft-title').disabled"),'Initial visual attach settled')
  await script("document.querySelector('[data-stage=\"3\"]').click();true")
  await waitFor(()=>script("document.getElementById('segment-asset')!==null"),'Visual segment editor')
  await script("[...document.querySelectorAll('#stage-content button')].find(b=>b.textContent.includes('匹配已有素材')).click();true")
  await waitFor(async()=>assistantPrompts.length===2,'Existing-material Assistant routing');assert.match(assistantPrompts[1],/Rewritten script/);assert.match(assistantPrompts[1],/revision|版本/);assert.ok(prepared.revision>revisionBeforeMatch)
  const beforeChoice=store.read(prepared.id).revision
  await script("document.querySelector('#segment-source-picker [data-choice-id=\"blue.png\"] .asset-choose').click();true")
  await waitFor(()=>script("document.getElementById('segment-asset').value==='blue.png'"),'Thumbnail picker selects segment source')
  await script("document.querySelector('#segment-source-picker [data-asset-view=list]').click();true")
  await waitFor(()=>script("document.querySelector('#segment-source-picker .material-grid').dataset.view==='list'&&document.getElementById('segment-asset').value==='blue.png'"),'Segment list keeps selected source')
  assert.equal(store.read(prepared.id).revision,beforeChoice,'Asset browsing does not change the draft')
  await click('segment-add')
  await waitFor(async()=>store.read(prepared.id).scenes[0].visualSegments?.length===2,'GUI appends second visual')
  prepared=store.read(prepared.id);assert.equal(prepared.scenes[0].audioArtifactId,'generated-2.wav');assert.equal(prepared.scenes[0].captions![0].text,'字幕独立修正');assert.equal(prepared.scenes[0].visualSegments![0].durationSeconds,1)
  await waitFor(()=>script("document.querySelectorAll('.visual-segment select').length===2&&!document.querySelectorAll('.visual-segment select')[1].disabled"),'Segment editor enabled')
  await script("const select=document.querySelectorAll('.visual-segment select')[1];select.value='fade';select.dispatchEvent(new Event('change',{bubbles:true}));true")
  await waitFor(async()=>store.read(prepared.id).scenes[0].visualSegments![1].transition==='fade','GUI fade saved')
  await waitFor(()=>script("!document.getElementById('segment-add').disabled"),'Segment edit fully settled')
  await script("document.querySelector('[data-segment-preview=\"blue.png\"] .material-thumb').click();true")
  await waitFor(()=>script("document.querySelector('.material-preview-dialog img')?.naturalWidth===320"),'Bound segment full image preview')
  await script("document.querySelector('.material-preview-dialog .row button').click();document.querySelector('#segment-source-picker [data-asset-view=icons]').click();true")
  await waitFor(()=>script("document.querySelector('#segment-source-picker .material-grid').dataset.view==='icons'"),'Shared icon view restored')
  fs.writeFileSync(path.join(libraryProof,'studio-segment-editor.png'),(await captureRendererEvidence(studio)).toPNG())
  prepared=store.read(prepared.id);prepared=await studioExecute({operation:'attach',draftId:prepared.id,expectedRevision:prepared.revision,sceneId:prepared.scenes[1].id,artifactId:'green.png',assetKind:'image'}) as typeof prepared
  await waitFor(()=>script("!document.getElementById('draft-title').disabled"),'Second visual attach settled')
  await script("document.querySelector('[data-stage=\"4\"]').click();true")
  await waitFor(()=>script("(()=>{const c=document.getElementById('preview'),p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return !document.getElementById('seek').disabled&&Number(document.getElementById('seek').max)===4&&p[0]>150&&p[2]<70})()"),'Segment preview prepared')
  async function segmentPixel(time:number):Promise<number[]>{
    await script(`document.getElementById('seek').value='${time}';document.getElementById('seek').dispatchEvent(new Event('input',{bubbles:true}));true`)
    await waitFor(()=>script(`Math.abs(Number(document.getElementById('seek').value)-${time})<.001`),'Segment seek')
    await new Promise(resolve=>setTimeout(resolve,150))
    return script("(()=>{const c=document.getElementById('preview');return [...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data]})()")
  }
  const red=await segmentPixel(.5),fading=await segmentPixel(1.05),blue=await segmentPixel(1.5);assert.ok(red[0]>150&&red[2]<70);assert.ok(blue[2]>150&&blue[0]<70);assert.ok(fading[2]<blue[2]-40,'Fade-in actually changes decoded pixels')
  await click('delivery-open');await click('export');await waitFor(async()=>store.read(prepared.id).exports.length===1,'Multisegment real MP4 export')
  const final=store.read(prepared.id).exports[0];assert.ok(final.verificationArtifactId)
  const report=JSON.parse(fs.readFileSync(path.join(artifacts,final.verificationArtifactId!),'utf8')) as {status:string;actualDurationSeconds:number;width:number;height:number;frames:number;tracks:{codec:string}[]}
  assert.equal(report.status,'passed');assert.ok(Math.abs(report.actualDurationSeconds-4)<.2);assert.equal(report.frames,4*prepared.fps);assert.deepEqual(report.tracks.map(track=>track.codec).sort(),['aac','avc'])
  await waitFor(()=>script("document.querySelector('#export-preview video')?.readyState>=2&&document.querySelectorAll('#export-preview a').length===2"),'Video and verification downloads')
  const actual=await script<number[]>("(async()=>{const v=document.querySelector('#export-preview video');await v.play();await new Promise(resolve=>setTimeout(resolve,100));v.pause();await new Promise(resolve=>{v.onseeked=resolve;v.currentTime=1.5});const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);return [...x.getImageData(c.width/2,c.height/2,1,1).data]})()")
  assert.ok(actual.slice(0,3).every((value,index)=>Math.abs(value-blue[index])<12),`Segment preview differs from exported MP4: ${blue} / ${actual}`)
  fs.writeFileSync(path.join(libraryProof,'studio-segments.png'),(await captureRendererEvidence(studio)).toPNG())
  console.log('PASS Studio additions: existing Assistant intents, Project SRT/VTT with unchanged revision, two visual segments with continuous voice/captions, visible fade, actual MP4 pixel parity and durable H264/AAC verification report')
  media.narrate=narrate
  // Original audio decodes from a real AAC video, shared by preview/export.
  const sound=await script<{muted:number;kept:number;tail:number;segmentPrefix:number;segmentKept:number;segmentTail:number}>(`(async()=>{
    const {Input,BufferSource,ALL_FORMATS}=await import('mediabunny'),{assertComposition}=await import('../../../media-native/src/composition-contract.js'),{mixCompositionAudio}=await import('../../../media-native/src/media/composition-audio.js');
    const data=await window.bmwStudio.read(${JSON.stringify(project.id)},${JSON.stringify(exported.artifactId)},0,${fs.statSync(path.join(artifacts,exported.artifactId)).size}),input=new Input({source:new BufferSource(data),formats:ALL_FORMATS}),assets=new Map([[${JSON.stringify(exported.artifactId)},{data,input}]]),context=new AudioContext({sampleRate:48000});
    const spec=keepSourceAudio=>assertComposition({title:'Source audio',music:false,scenes:[{title:'Original',durationSeconds:2,videoArtifactId:${JSON.stringify(exported.artifactId)},sourceStartSeconds:.5,playbackRate:2,sourceVolume:.5,keepSourceAudio}]});
    const rms=(samples,from,to)=>Math.sqrt(samples.slice(from,to).reduce((s,v)=>s+v*v,0)/(to-from)),muted=(await mixCompositionAudio(spec(false),assets,context)).mixed.getChannelData(0),kept=(await mixCompositionAudio(spec(true),assets,context)).mixed.getChannelData(0);
    const segmented=assertComposition({title:'Segment sound',music:false,scenes:[{title:'Pieces',durationSeconds:2,visualSegments:[{durationSeconds:.5,imageArtifactId:'source.png'},{durationSeconds:1.5,videoArtifactId:${JSON.stringify(exported.artifactId)},sourceStartSeconds:.5,playbackRate:2,sourceVolume:.5,keepSourceAudio:true}]}]}),samples=(await mixCompositionAudio(segmented,assets,context)).mixed.getChannelData(0);
    const result={muted:rms(muted,0,24000),kept:rms(kept,0,20000),tail:rms(kept,48000,96000),segmentPrefix:rms(samples,0,24000),segmentKept:rms(samples,24000,44000),segmentTail:rms(samples,72000,96000)};input.dispose();await context.close();return result
  })()`)
  assert.equal(sound.segmentPrefix,0);assert.ok(sound.segmentKept>.05);assert.equal(sound.segmentTail,0);
  assert.equal(sound.muted,0);assert.ok(sound.kept>.05);assert.equal(sound.tail,0,'Original audio stops when the selected source interval ends')
  console.log('PASS Studio workflow: zero-scene preparation, literal text material, pending notes/outline save, script/voice pairs, exact regeneration routing (stub provider), independent captions and real AAC original-sound trim/rate mix',sound)

  // Cover generation is independent of speech and video rendering, persists through draft switches.
  await click('studio-cover-open');await waitFor(()=>script("document.getElementById('cover-panel').open"),'Cover panel opened')
  assert.equal(await script("document.getElementById('studio-cover-open').getAttribute('aria-pressed')==='true'&&document.getElementById('delivery-open').getAttribute('aria-pressed')==='false'&&!document.getElementById('delivery-open').classList.contains('primary')&&!document.getElementById('cover-panel').hidden"),true,'Cover entry replaces delivery highlight')
  const covered=store.read(prepared.id),sceneSnapshot=JSON.stringify(covered.scenes),exportsSnapshot=JSON.stringify(covered.exports)
  await waitFor(()=>script("document.querySelector('#cover-source-picker [data-choice-id=\"blue.png\"] .material-thumb img')?.complete"),'Cover source decoded thumbnail')
  await script("document.querySelector('#cover-source-picker [data-choice-id=\"blue.png\"] .material-thumb').click();true")
  await waitFor(()=>script("document.querySelector('.material-preview-body img')?.naturalWidth===320"),'Cover source full preview')
  const coverPixel=await script<number[]>("(()=>{const img=document.querySelector('.material-preview-body img'),c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.drawImage(img,0,0);return [...x.getImageData(160,90,1,1).data]})()")
  assert.ok(coverPixel[2]>150&&coverPixel[0]<100,'Cover selection shows actual blue pixels')
  await script("document.querySelector('.material-preview-dialog .row button').click();document.querySelector('#cover-source-picker [data-asset-view=list]').click();true")
  await waitFor(()=>script("document.querySelector('#cover-source-picker .material-grid').dataset.view==='list'"),'Shared picker list mode')
  assert.equal(store.read(prepared.id).revision,covered.revision,'Display mode does not edit video')
  await script("document.querySelector('#cover-source-picker [data-asset-view=icons]').click();true")
  await waitFor(()=>script("document.querySelector('#cover-source-picker .material-grid').dataset.view==='icons'"),'Shared picker icon mode')

  await script("document.getElementById('cover-sourceArtifactId').value='blue.png';document.getElementById('cover-sourceArtifactId').dispatchEvent(new Event('change',{bubbles:true}));true")
  await waitFor(()=>script("!document.getElementById('cover-title').disabled"),'Cover source saved')
  await script("document.getElementById('cover-title').value='视频封面演示';document.getElementById('cover-title').dispatchEvent(new Event('input',{bubbles:true}));true")
  await click('cover-generate');await waitFor(()=>script("!document.getElementById('cover-download').hidden&&document.getElementById('cover-image').complete&&document.getElementById('cover-image').naturalWidth>0"),'Real cover preview and download')
  const withCover=store.read(prepared.id);assert.equal(withCover.cover!.title,'视频封面演示');assert.equal(withCover.coverExports!.length,1);assert.equal(JSON.stringify(withCover.scenes),sceneSnapshot);assert.equal(JSON.stringify(withCover.exports),exportsSnapshot);assert.equal(requested.length,3)
  assert.equal(await script("document.getElementById('cover-canvas').hidden"),false);assert.equal(await script("document.getElementById('timeline-dock').hidden"),true);assert.equal(await script("document.getElementById('transport').hidden"),true)
  assert.equal(await script("document.getElementById('cover-image').closest('#canvas-surface')!==null"),true,'Cover has independent central preview')
  await click('tab-visual');await waitFor(()=>script("document.getElementById('cover-canvas').hidden&&!document.getElementById('transport').hidden"),'Return from cover restores video workspace');await click('studio-cover-open')
  const coverProof=path.join(libraryProof,'studio-cover.png');fs.writeFileSync(coverProof,(await captureRendererEvidence(studio)).toPNG());fs.copyFileSync(path.join(artifacts,withCover.coverExports![0].artifactId),path.join(libraryProof,'exported-cover.png'))
  await click('new-draft');await waitFor(()=>script("document.querySelectorAll('#scene-list button').length===0&&!document.getElementById('studio-cover-open').disabled"),'New zero-scene draft for cover')
  await click('studio-cover-open')
  const beforeCoverTitle=await script<string>("document.getElementById('cover-title').value")
  await script("document.getElementById('cover-title').value='Cover undo';document.getElementById('cover-title').dispatchEvent(new Event('change',{bubbles:true}));true");await waitFor(()=>script("!document.getElementById('cover-title').disabled&&document.getElementById('cover-title').value==='Cover undo'"),'First cover edit saved');await click('undo');await waitFor(()=>script(`!document.getElementById('cover-title').disabled&&document.getElementById('cover-title').value===${JSON.stringify(beforeCoverTitle)}`),'First cover edit undo restored')
  const emptyId=await script<string>("document.getElementById('draft-select').value"),originalMusic=store.read(emptyId).music
  await click('settings-open');await script(`document.getElementById('music').checked=${!originalMusic};document.getElementById('music').dispatchEvent(new Event('input',{bubbles:true}));true`);await click('settings-close')
  await waitFor(async()=>store.read(emptyId).music===!originalMusic&&await script("!document.getElementById('settings-dialog').open&&!document.getElementById('music').disabled"),'Global settings save without a scene');assert.equal(store.read(emptyId).music,!originalMusic);await click('undo');await waitFor(()=>script(`!document.getElementById('music').disabled&&document.getElementById('music').checked===${originalMusic}`),'Global setting undo in empty draft');await waitFor(async()=>store.read(emptyId).music===originalMusic,'Global undo persisted')
  assert.equal(store.read(emptyId).music,originalMusic);await click('studio-cover-open');await click('cover-generate');await waitFor(()=>script("!document.getElementById('cover-download').hidden"),'Zero-scene cover exported');assert.equal(store.read(emptyId).scenes.length,0);assert.equal(store.read(emptyId).coverExports!.length,1)
  await script(`document.getElementById('draft-select').value=${JSON.stringify(prepared.id)};document.getElementById('draft-select').dispatchEvent(new Event('change',{bubbles:true}));true`)
  await waitFor(()=>script("document.getElementById('cover-title').value==='视频封面演示'&&!document.getElementById('cover-show').disabled"),'Cover settings survive draft switch');await click('studio-cover-open');await click('cover-show');await waitFor(()=>script("!document.getElementById('cover-download').hidden&&document.getElementById('cover-image').naturalWidth>0"),'Persisted cover previews again')
  console.log('PASS Studio cover UI: focused title flush, Project image, actual PNG preview/download, unchanged scenes/voice/video exports, zero-scene cover and restored settings/history')

  // Session transitions preserve a focused edit and restore isolated selections.
  const sessionAView=studio,selectedA=await script<string>("document.getElementById('draft-select').value")
  await script("document.getElementById('draft-title').value='Saved before Session switch';document.getElementById('draft-title').dispatchEvent(new Event('input',{bubbles:true}));true")
  await runtime.onSessionWillChange();assert.equal(store.read(selectedA).title,'Saved before Session switch')
  currentSession='second-session';await runtime.onSessionChanged()
  studio=webContents.getAllWebContents().find(contents=>contents!==sessionAView&&contents.getURL().endsWith('/studio.html'))!
  await waitFor(()=>script("!document.getElementById('empty-workspace').hidden&&document.getElementById('draft-select').options.length===0"),'Second Session empty state')
  assert.equal(await script("document.getElementById('delete-draft').disabled&&document.getElementById('draft-title').value===''") ,true)
  const denied=await sessionAView.executeJavaScript("window.bmwStudio.state().then(()=>false,error=>String(error))")
  assert.match(String(denied),/owning Studio|no longer active/)
  await assert.rejects(studioExecute({operation:'read',draftId:selectedA}),/STUDIO_SESSION_MISMATCH/)
  await click('empty-create');await waitFor(()=>script("document.getElementById('draft-select').options.length===1&&!document.getElementById('delete-draft').disabled"),'Second Session creates owned draft')
  const secondStore=new VideoStudioStore(project.directory,currentSession),secondDraft=secondStore.list()[0];assert.equal(secondDraft.ownerSessionId,currentSession)
  assert.ok(secondStore.assets(project.directory).some(asset=>asset.artifactId==='source.png'))
  await script("window.confirm=()=>false;true");await click('delete-draft');assert.equal(secondStore.list().length,1)
  await script("window.confirm=()=>true;true");await click('delete-draft')
  await waitFor(()=>script("!document.getElementById('empty-workspace').hidden&&document.getElementById('draft-select').options.length===0"),'Deleting last draft restores empty state')
  assert.equal(secondStore.list().length,0);assert.ok(fs.existsSync(path.join(artifacts,'source.png')));assert.ok(store.list().length>0)
  fs.writeFileSync(path.join(libraryProof,'studio-session-empty.png'),(await captureRendererEvidence(studio)).toPNG())
  await runtime.onSessionWillChange();currentSession='fixture-session';await runtime.onSessionChanged();studio=sessionAView
  await waitFor(()=>script("document.getElementById('draft-title').value==='Saved before Session switch'&&document.getElementById('empty-workspace').hidden"),'First Session restored')
  assert.equal(await script("document.getElementById('draft-select').value"),selectedA)
  console.log('PASS Studio Session binding: focused flush, independent views/selections, foreign IPC/actions denied, empty state, create/delete confirmation, last deletion empty, shared assets retained')
}catch(error){exitCode=1;console.error('Failed phase: '+phase);console.error(error);if(studio&&!studio.isDestroyed())console.error('Renderer diagnostics',await studio.executeJavaScript("({status:document.getElementById('status').textContent,time:document.getElementById('seek').value,play:document.getElementById('play').textContent,visibility:document.visibilityState,activation:navigator.userActivation.isActive,activated:navigator.userActivation.hasBeenActive,frames:window.__frameTicks,audio:window.__audioContexts.map(context=>({state:context.state,time:context.currentTime,sampleRate:context.sampleRate}))})"))}finally{clearTimeout(timeout);await runtime?.stop();media?.window?.destroy();host?.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.exit(exitCode)}}
void run()
