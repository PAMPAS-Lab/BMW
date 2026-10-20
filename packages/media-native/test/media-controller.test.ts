import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EventEmitter} from 'node:events'
import type {WebContents} from 'electron'
import {VideoElementCapture} from '../src/video-element-capture.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaCapturePolicyInternals, isOwnedCaptureMessage } from '../src/capture-policy.js'
import {MediaJobQueue} from '../src/media-job-queue.js'

test('Shared decoding FIFO drains active cleanup, skips cancelled previews and survives failed jobs',async()=>{
 const queue=new MediaJobQueue(),events:string[]=[]
 let release:()=>void=()=>{},clean:()=>void=()=>{}
 const work=new Promise<void>(resolve=>release=resolve),cleanup=new Promise<void>(resolve=>clean=resolve)
 const active=queue.run(async()=>{events.push('active');try{await work;throw new Error('worker failed')}finally{events.push('cleanup');await cleanup;events.push('drained')}})
 const failed=assert.rejects(active,/worker failed/),controller=new AbortController()
 const preview=queue.run(async()=>{events.push('cancelled preview')},controller.signal),cancelled=assert.rejects(preview,/cancel queued preview/)
 const proposal=queue.run(async()=>{events.push('proposal');return 'verified'})
 await Promise.resolve();controller.abort(new Error('cancel queued preview'));await cancelled
 release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['active','cleanup']);assert.equal(queue.busy,true)
 clean();await failed;assert.equal(await proposal,'verified');await new Promise(resolve=>setImmediate(resolve));assert.equal(queue.busy,false);assert.deepEqual(events,['active','cleanup','drained','proposal'])
 const stopped=new AbortController();stopped.abort();assert.throws(()=>queue.run(async()=>{},stopped.signal),/abort/i)
})

test('Shared decoding cleanup failure quarantines queued work until explicit recovery succeeds',async()=>{
 const queue=new MediaJobQueue();let attempts=0,ran=false,allowCleanup=false
 const cleanup=async()=>{attempts++;if(!allowCleanup)throw new Error('IO still open')}
 const active=queue.run(async()=>{queue.quarantineCleanup(cleanup);throw new Error('cleanup failed')})
 const queued=queue.run(async()=>{ran=true})
 await Promise.all([assert.rejects(active,/cleanup failed/),assert.rejects(queued,/not started/)])
 assert.equal(queue.busy,true);assert.equal(ran,false)
 await assert.rejects(queue.run(async()=>{ran=true}),/media.stop/)
 await assert.rejects(queue.recoverCleanup(),/IO still open/);assert.equal(queue.busy,true)
 allowCleanup=true;await Promise.all([queue.recoverCleanup(),queue.recoverCleanup()])
 assert.equal(attempts,2);assert.equal(queue.busy,false)
 assert.equal(await queue.run(async()=>'new explicit job'),'new explicit job');assert.equal(ran,false)
})

test('Shared decoding FIFO bounds admission and preserves queued operation order without replay',async()=>{
 const queue=new MediaJobQueue(),projects:string[]=[];let release:()=>void=()=>{}
 const blocked=new Promise<void>(resolve=>release=resolve)
 const jobs=Array.from({length:16},(_,i)=>queue.run(async()=>{if(i===0)await blocked;projects.push('project-'+i)}))
 await assert.rejects(queue.run(async()=>{projects.push('overflow')}),/queue is full/)
 release();await Promise.all(jobs);assert.deepEqual(projects,Array.from({length:16},(_,i)=>'project-'+i))
})

test('browser-native video capture filenames remain Project-local WebM artifacts', () => {
  assert.equal(mediaCapturePolicyInternals.safeCaptureFilename('../../Arena: latest video.mp4'), 'Arena- latest video.mp4.webm')
  assert.equal(mediaCapturePolicyInternals.safeCaptureFilename('capture.webm'), 'capture.webm')
  assert.equal(mediaCapturePolicyInternals.safeCaptureFilename(''), 'captured-video.webm')
})

test('video chunk decoding ignores commas inside codec parameters', () => {
  const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
  const dataUrl = `data:video/webm;codecs=vp9,opus;base64,${webmHeader.toString('base64')}`
  const payload = mediaCapturePolicyInternals.base64PayloadFromDataUrl(dataUrl)
  assert.deepEqual(Buffer.from(payload, 'base64'), webmHeader)
})

test('capture IPC admits only the current media main frame',()=>{
  const mainFrame={},contents={mainFrame},window={webContents:contents,isDestroyed:()=>false}
  assert.equal(isOwnedCaptureMessage({sender:contents,senderFrame:mainFrame},window),true)
  assert.equal(isOwnedCaptureMessage({sender:{mainFrame},senderFrame:mainFrame},window),false)
  assert.equal(isOwnedCaptureMessage({sender:contents,senderFrame:{}},window),false)
  assert.equal(isOwnedCaptureMessage({sender:contents,senderFrame:mainFrame},{...window,isDestroyed:()=>true}),false)
  assert.equal(isOwnedCaptureMessage({sender:contents,senderFrame:mainFrame},null),false)
})

test('Selected-video cancellation drains late initialization and removes only its new file',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-video-cancel-'))),original=path.join(root,'original.webm');fs.writeFileSync(original,'preserved original')
 let started:()=>void,settle:(value:unknown)=>void,cancelled=false;const entered=new Promise<void>(resolve=>started=resolve),pending=new Promise<unknown>(resolve=>settle=resolve),events=new EventEmitter();Object.assign(events,{isDestroyed:()=>false,executeJavaScript:async(code:string)=>{if(code.includes('initializeRenderer')){started();return pending}if(code.includes('state.cancel')){cancelled=true;settle({ok:false,reason:'late cancelled initialization'})}return undefined}})
 const controller=new AbortController(),capture=new VideoElementCapture(events as unknown as WebContents,root,{selector:'video',maxDurationMs:1000},{id:'tab',title:'T',url:'https://example.com'}),running=capture.run(controller.signal),rejected=assert.rejects(running,/cancel selected video/);await entered;controller.abort(new Error('cancel selected video'));await rejected
 assert.equal(cancelled,true);assert.deepEqual(fs.readdirSync(root),['original.webm']);assert.equal(fs.readFileSync(original,'utf8'),'preserved original');assert.equal(events.eventNames().length,0);fs.rmSync(root,{recursive:true,force:true})
})
