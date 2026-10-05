import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EventEmitter} from 'node:events'
import type {WebContents} from 'electron'
import {VideoElementCapture} from '../src/video-element-capture.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaCapturePolicyInternals, isOwnedCaptureMessage } from '../src/capture-policy.js'

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
