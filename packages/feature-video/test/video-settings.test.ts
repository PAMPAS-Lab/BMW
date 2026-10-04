import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {GlobalSettingsStore} from '../../platform/src/global-settings-store.js'
import {resolvedComposition,videoSettingsAction} from '../src/video-settings.js'
import {VideoStudioService} from '../src/studio-service.js'
import type {StudioKernel} from '../src/studio-service.js'
import {newStudioScene} from '../src/studio-contract.js'
import type {VideoDraft} from '../src/studio-contract.js'
import {normalizeVideoPreferences} from '../../media-native/src/video-options.js'

test('video template settings persist without changing other settings and are reusable by name',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-video-settings-'))
  try{
    const filePath=path.join(dir,'settings.json'),store=new GlobalSettingsStore({filePath,onState:undefined})
    store.update({searchEngine:'bing'})
    const context={browserKernel:{settingsStore:store,projectStore:{active:()=>({id:'p',name:'P',directory:dir})},recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>({})},execute:async()=>({})}}
    await videoSettingsAction.execute(context,{action:'video.settings',settingsRequest:{operation:'save-template',name:'品牌竖屏',options:{aspectRatio:'9:16',style:'clean-light',watermark:{text:'品牌'}}}})
    const restored=new GlobalSettingsStore({filePath,onState:undefined});assert.equal(restored.snapshot().searchEngine,'bing')
    const composition=resolvedComposition({title:'演示',templateName:'品牌竖屏',watermark:{enabled:false},scenes:[{title:'第一幕',durationSeconds:1}]},restored.snapshot().videoPreferences)
    const custom=resolvedComposition({title:'自定义',resolution:'custom',width:640,height:640,scenes:[{title:'测试',durationSeconds:1}]},{})
    assert.deepEqual([custom.width,custom.height],[640,640])
    assert.equal(composition.height,1280);assert.equal(composition.watermark.enabled,false);assert.equal(composition.watermark.text,'品牌')
    await videoSettingsAction.execute(context,{action:'video.settings',settingsRequest:{operation:'delete-template',name:'品牌竖屏'}})
    assert.equal(normalizeVideoPreferences(store.snapshot().videoPreferences).templates.length,0)
    assert.equal(composition.watermark.text,'品牌')
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('Studio snapshots defaults and templates while visual-only configure retains custom size and CAS',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-video-draft-options-'))
  try{
    const settingsStore=new GlobalSettingsStore({filePath:path.join(dir,'settings.json'),onState:undefined})
    const kernel:StudioKernel={settingsStore,projectStore:{active:()=>({id:'p',name:'P',directory:dir})},recordingController:{compose:async()=>({}),narrate:async()=>({}),processArtifact:async()=>({})},execute:async()=>({})}
    const service=new FixtureVideoStudioService(kernel)
    settingsStore.update({videoPreferences:{defaults:{aspectRatio:'1:1',style:'minimal',watermark:{enabled:false}},templates:[]}})
    const draft=await service.execute({operation:'create',title:'方形'}) as VideoDraft
    assert.equal(draft.width,draft.height);assert.equal(draft.style,'minimal')
    settingsStore.update({videoPreferences:{defaults:{},templates:[]}})
    assert.equal((await service.execute({operation:'read',draftId:draft.id}) as VideoDraft).style,'minimal')
    draft.width=640;draft.height=360
    const saved=await service.execute({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}) as VideoDraft
    const modified=await service.execute({operation:'configure',draftId:saved.id,expectedRevision:saved.revision,options:{watermark:{enabled:false}}}) as VideoDraft
    assert.deepEqual([modified.width,modified.height],[640,360])
    await service.execute({operation:'save-template',draftId:modified.id,expectedRevision:modified.revision,templateName:'同款'})
    const ratioOnly=await service.execute({operation:'create',title:'仅改比例',templateName:'同款',options:{aspectRatio:'9:16'}}) as VideoDraft
    assert.deepEqual([ratioOnly.width,ratioOnly.height],[360,640])
    const same=await service.execute({operation:'create',title:'完全同款',templateName:'同款'}) as VideoDraft
    assert.deepEqual([same.width,same.height],[640,360])
    const created=await service.execute({operation:'create',title:'下一条',templateName:'同款',options:{aspectRatio:'9:16',resolution:'720p'}}) as VideoDraft
    const resized=await service.execute({operation:'configure',draftId:created.id,expectedRevision:created.revision,options:{resolution:'custom',width:540,height:960}}) as VideoDraft
    assert.deepEqual([resized.width,resized.height],[540,960])
    assert.equal(created.width,720);assert.equal(created.height,1280);assert.equal(created.watermark.enabled,false)
    await assert.rejects(service.execute({operation:'configure',draftId:modified.id,expectedRevision:1,options:{style:'clean-light'}}),/STUDIO_CONFLICT/)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

test('TTS resolves Edge male defaults named snapshots and explicit overrides while preserving opt-out',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-tts-settings-'))
  try{
    const store=new GlobalSettingsStore({filePath:path.join(dir,'settings.json'),onState:undefined})
    const {resolvedNarration}=await import('../src/video-settings.js'),{videoFeature}=await import('../index.js'),{BrowserCapabilityRegistry}=await import('../../browser-capability/src/browser-capability-registry.js')
    assert.equal(store.snapshot().edgeNarrationEnabled,true)
    assert.equal(resolvedNarration({text:'测试'},store.snapshot().videoPreferences).voice,'zh-CN-YunxiNeural')
    const context={browserKernel:{settingsStore:store,projectStore:{active:()=>({id:'p',name:'P',directory:dir})},recordingController:{narrate:async()=>({}),compose:async()=>({}),processArtifact:async()=>({})},execute:async()=>({})}}
    await videoSettingsAction.execute(context,{action:'video.settings',settingsRequest:{operation:'save-template',name:'离线',options:{tts:{provider:'local-matcha',ratePercent:-5}}}})
    assert.equal(resolvedNarration({text:'测试',templateName:'离线'},store.snapshot().videoPreferences).voice,'local-zh-en')
    const overridden=resolvedNarration({text:'测试',templateName:'离线',voice:'zh-CN-XiaoxiaoNeural',ratePercent:10},store.snapshot().videoPreferences)
    assert.equal(overridden.provider,'edge-readaloud');assert.equal(overridden.ratePercent,10)
    assert.throws(()=>resolvedNarration({text:'测试',provider:'local-matcha',voice:'zh-CN-YunxiNeural'},{}),/combination/)
    assert.throws(()=>resolvedNarration({text:'测试',endpoint:'https://other.test'},{}),/Unsupported/)
    let calls=0
    const registry=new BrowserCapabilityRegistry({id:'tts-test',name:'BMW',features:[videoFeature]})
    const host={browserKernel:{settingsStore:store,projectStore:{active:()=>({id:'p',name:'P',directory:dir})},execute:async()=>({}),recordingController:{compose:async()=>({}),processArtifact:async()=>({}),narrate:async(request:unknown)=>{calls++;return {...request as Record<string,unknown>,artifactId:"fixture.wav",durationSeconds:1}}}}}
    const execution=await registry.execute('video.narrate',host,{action:'video.narrate',narrationRequest:{text:'默认'}})
    assert.equal(execution.handled,true);const request=execution.value as {voice:string}
    assert.equal(request.voice,'zh-CN-YunxiNeural');assert.equal(registry.toolDefinition().name,'browser')
    store.update({edgeNarrationEnabled:false})
    await assert.rejects(registry.execute('video.narrate',host,{action:'video.narrate',narrationRequest:{text:'禁止'}}),/disabled/);assert.equal(calls,1)
    await registry.execute('video.narrate',host,{action:'video.narrate',narrationRequest:{text:'离线',templateName:'离线'}});assert.equal(calls,2)
    const restored=new GlobalSettingsStore({filePath:path.join(dir,'settings.json'),onState:undefined});assert.equal(restored.snapshot().edgeNarrationEnabled,false)
    assert.equal(resolvedNarration({text:'恢复',templateName:'离线'},restored.snapshot().videoPreferences).ratePercent,-5)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('Studio narration uses configurable TTS rather than fixed local speech and enforces the Edge gate',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-studio-tts-'))
  try{
    const settingsStore=new GlobalSettingsStore({filePath:path.join(dir,'settings.json'),onState:undefined}),calls:{provider:string;voice:string;ratePercent:number}[]=[]
    const kernel:StudioKernel={settingsStore,projectStore:{active:()=>({id:'p',name:'P',directory:dir})},execute:async()=>({}),recordingController:{narrate:async(raw:unknown)=>{const request=raw as {provider:string;voice:string;ratePercent:number};calls.push(request);return {artifactId:request.provider==='local-matcha'?'local.wav':'edge.mp3',durationSeconds:2.5}},compose:async()=>({}),processArtifact:async()=>({})}}
    const service=new FixtureVideoStudioService(kernel);let draft=await service.execute({operation:'create',title:'配音'}) as VideoDraft
    assert.equal(draft.tts.voice,'zh-CN-YunxiNeural');draft.scenes.push(newStudioScene('first-scene'));draft.scenes[0].narration='测试配音'
    draft=await service.execute({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft}) as VideoDraft
    const generated=await service.execute({operation:'narrate',draftId:draft.id,sceneId:draft.scenes[0].id,expectedRevision:draft.revision,voice:'zh-CN-XiaoxiaoNeural',ratePercent:8}) as {draft:VideoDraft}
    draft=generated.draft;assert.equal(calls[0].provider,'edge-readaloud');assert.equal(calls[0].voice,'zh-CN-XiaoxiaoNeural');assert.equal(calls[0].ratePercent,8)
    assert.equal(draft.tts.voice,'zh-CN-XiaoxiaoNeural');assert.equal(draft.scenes[0].audioArtifactId,'edge.mp3');assert.equal(draft.scenes[0].durationSeconds,3.5)
    settingsStore.update({edgeNarrationEnabled:false,videoPreferences:{defaults:{tts:{provider:'local-matcha'}},templates:[]}})
    await assert.rejects(service.execute({operation:'narrate',draftId:draft.id,sceneId:draft.scenes[0].id,expectedRevision:draft.revision}),/disabled/);assert.equal(calls.length,1)
    const local=await service.execute({operation:'narrate',draftId:draft.id,sceneId:draft.scenes[0].id,expectedRevision:draft.revision,provider:'local-matcha'}) as {draft:VideoDraft}
    assert.equal(calls[1].voice,'local-zh-en');assert.equal(local.draft.tts.provider,'local-matcha');assert.equal(local.draft.scenes[0].audioArtifactId,'local.wav')
    const {tts:omitted,...legacyUpdate}=local.draft;assert.equal(omitted.provider,'local-matcha')
    const updated=await service.execute({operation:'update',draftId:local.draft.id,expectedRevision:local.draft.revision,draft:legacyUpdate}) as VideoDraft
    assert.equal(updated.tts.provider,'local-matcha');assert.equal(updated.scenes[0].audioArtifactId,'local.wav')
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

function fixtureKernel(kernel:import('../src/studio-service.js').StudioKernel):import('../src/studio-service.js').StudioKernel{
 const process=kernel.recordingController.processArtifact.bind(kernel.recordingController)
 return {...kernel,recordingController:{...kernel.recordingController,processArtifact:async(raw,signal)=>{
 const request=raw as {action:string;width:number;height:number;fps:number};
 if(request.action==='media.encode.check')return {kind:'encoding',width:request.width,height:request.height,fps:request.fps,videoCodec:'avc',audioCodec:'aac',videoSupported:true,audioSupported:true};
 if(request.action==='media.image.inspect')return {kind:'image',contentType:'image/png',width:1,height:1,pixels:1,bytes:1,canDecode:true};
 return process(raw,signal)
 }}}
}
class OwnedVideoStudioService extends VideoStudioService {override execute(raw:unknown,signal?:AbortSignal,owner:import('@bmw-agent/browser-capability/host').BrowserSessionOwner={projectId:this.kernel.projectStore.active().id,sessionId:'fixture-session'}):Promise<unknown>{return super.execute(raw,signal,owner)}}
class FixtureVideoStudioService extends OwnedVideoStudioService {constructor(kernel:import('../src/studio-service.js').StudioKernel){super(fixtureKernel(kernel))}}


