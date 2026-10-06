import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {VideoStudioStore} from '../src/studio-store.js'
import {draftComposition} from '../src/studio-contract.js'
import {assertComposition} from '../../media-native/src/composition-contract.js'
import type {BrowserActionContext} from '../../browser-capability/src/browser-host.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { videoFeature } from '../index.js'
import { BrowserCapabilityRegistry } from '../../browser-capability/src/browser-capability-registry.js'

test('video actions remain feature-owned in one browser tool and require trusted narration consent', async () => {
  const registry = new BrowserCapabilityRegistry({id:'video-product',name:'BMW',features:[videoFeature]})
  assert.equal(registry.toolDefinition().name,'browser')
  assert.equal(registry.ownerOf('video.compose'),'feature-video')
  assert.equal(registry.ownerOf('video.narrate'),'feature-video')
  let calls = 0
  const context = {browserKernel:{projectStore:{active:()=>({id:'p',name:'P',directory:'/project'})},settingsStore:{snapshot:()=>({edgeNarrationEnabled:false}),update:()=>({})},execute:async()=>({}),recordingController:{compose:async()=>({}),processArtifact:async()=>({}),narrate:async()=>{calls++;return {} }}}}
  await assert.rejects(registry.execute('video.narrate',context,{action:'video.narrate',narrationRequest:{text:'你好',provider:'edge-readaloud'}}),/disabled/)
  assert.equal(calls,0)
})

test('Session-owned direct composition registers an editable draft and existing export without changing other drafts',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-compose-studio-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'artifacts'))
 for(const name of ['voice.mp3','output.mp4','verify.json'])fs.writeFileSync(path.join(root,'artifacts',name),'fixture')
 const owner={projectId:'p',sessionId:'session'},store=new VideoStudioStore(root,owner.sessionId),other=store.create('User draft')
 const registry=new BrowserCapabilityRegistry({id:'video-product',name:'BMW',features:[videoFeature]});let measured:unknown,notifications=0
 const context:BrowserActionContext={sessionOwner:owner,browserKernel:{projectStore:{active:()=>({id:'p',name:'P',directory:root})},execute:async()=>({}),videoStudioChanged:scope=>{assert.deepEqual(scope,owner);notifications++},recordingController:{narrate:async()=>({}),processArtifact:async()=>({}),compose:async value=>{measured=value;return {artifactId:'output.mp4',durationSeconds:4,verificationArtifactId:'verify.json',narrationDurations:[2]}}}}}
 const input={action:'video.compose',composition:{title:'Editable result',music:false,scenes:[{title:'Story',durationSeconds:4,narration:'Actual script',audioArtifactId:'voice.mp3',bullets:['One','Two','Three'],sceneTemplate:{kind:'summary'}}]}}
 const result=(await registry.execute('video.compose',context,input)).value as {artifactId:string;studioDraft:{id:string;revision:number;sceneCount:number}}
 assert.equal(result.artifactId,'output.mp4');assert.equal(result.studioDraft.sceneCount,1);assert.equal(notifications,1)
 const draft=store.read(result.studioDraft.id);assert.equal(draft.ownerSessionId,owner.sessionId);assert.deepEqual(draftComposition(draft),assertComposition(measured));assert.equal(draft.scenes[0].audioDurationSeconds,2);assert.deepEqual(draft.scenes[0].audioGeneration,{kind:'imported'});assert.equal(store.reusableExport(draft)?.artifactId,'output.mp4');assert.deepEqual(store.read(other.id),other)
 assert.throws(()=>new VideoStudioStore(root,'foreign').read(draft.id),/SESSION_MISMATCH/)
 draft.scenes[0].title='Edited';const edited=store.update(draft.id,draft.revision,draft);assert.equal(store.reusableExport(edited),undefined)
})
test('Direct composition never registers cancelled, failed or foreign work; unsupported timing stays explicitly standalone',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-compose-admission-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'artifacts'))
 const registry=new BrowserCapabilityRegistry({id:'video-product',name:'BMW',features:[videoFeature]});let calls=0
 const context:BrowserActionContext={sessionOwner:{projectId:'p',sessionId:'session'},browserKernel:{projectStore:{active:()=>({id:'p',name:'P',directory:root})},execute:async()=>({}),recordingController:{narrate:async()=>({}),processArtifact:async()=>({}),compose:async()=>{calls++;throw new Error('Encoder failed')}}}}
 const input={action:'video.compose',composition:{title:'Output',music:false,scenes:[{title:'Title',durationSeconds:4}]}}
 await assert.rejects(registry.execute('video.compose',{...context,sessionOwner:{projectId:'foreign',sessionId:'session'}},input),/SESSION_REQUIRED/);assert.equal(calls,0)
 const controller=new AbortController();controller.abort(new Error('Cancelled'));await assert.rejects(registry.execute('video.compose',{...context,signal:controller.signal},input),/Cancelled/);assert.equal(calls,0)
 await assert.rejects(registry.execute('video.compose',context,input),/Encoder failed/);assert.equal(new VideoStudioStore(root,'session').list().length,0)
 context.browserKernel.recordingController.compose=async()=>({artifactId:'output.mp4',durationSeconds:4})
 const reveal={...input,composition:{...input.composition,scenes:[{title:'Title',durationSeconds:4,bullets:['One'],bulletRevealSeconds:[1]}]}}
 const result=(await registry.execute('video.compose',context,reveal)).value as {studioWarning:string;studioDraft?:unknown};assert.match(result.studioWarning,/语音锚点/);assert.equal(result.studioDraft,undefined);assert.equal(new VideoStudioStore(root,'session').list().length,0)
 const plain=(await registry.execute('video.compose',{...context,sessionOwner:undefined},input)).value as {studioDraft?:unknown};assert.equal(plain.studioDraft,undefined)
 const late=new AbortController();context.browserKernel.recordingController.compose=async()=>{late.abort(new Error('Late cancellation'));return {artifactId:'output.mp4',durationSeconds:4}}
 await assert.rejects(registry.execute('video.compose',{...context,signal:late.signal},input),/Late cancellation/);assert.equal(new VideoStudioStore(root,'session').list().length,0)
 context.browserKernel.recordingController.compose=async()=>{context.browserKernel.projectStore.active=()=>({id:'other',name:'Other',directory:root});return {artifactId:'output.mp4',durationSeconds:4}}
 await assert.rejects(registry.execute('video.compose',context,input),/Project changed/);assert.equal(new VideoStudioStore(root,'session').list().length,0)
})
