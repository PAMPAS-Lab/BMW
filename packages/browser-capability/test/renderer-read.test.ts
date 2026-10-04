import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import test from 'node:test'
import type {WebContents} from 'electron'
import {readRendererPhase} from '../src/renderer-read.js'
import {SessionOperations} from '../src/session-operations.js'
function page(){const events=new EventEmitter();Object.assign(events,{isDestroyed:()=>false});return {events,wc:events as unknown as WebContents}}
test('Renderer read cancellation releases FIFO and ignores late DOM and diagnostic results',async()=>{
 for(const action of ['observe','page.media.list','page.diagnostics']){
  const {events,wc}=page(),queue=new SessionOperations(),controller=new AbortController()
  let complete:(value:string)=>void,enter:()=>void
  const started=new Promise<void>(resolve=>{enter=resolve}),blocked=new Promise<string>(resolve=>{complete=resolve})
  let admitted=0
  const active=queue.run(()=>{},async()=>{const value=await readRendererPhase(wc,action,'dom',()=>{enter();return blocked},controller.signal);admitted++;return value})
  const rejected=assert.rejects(active,/cancelled/),next=queue.run(()=>{},async()=>true)
  await started;controller.abort(new Error('cancelled'));await rejected;assert.equal(await next,true)
  complete('late result');await new Promise(resolve=>setImmediate(resolve));assert.equal(admitted,0);assert.equal(events.eventNames().length,0)
 }
})
test('Renderer reads bound deadlines and reject navigation, renderer loss and pre-cancellation',async()=>{
 const {events,wc}=page(),never=()=>new Promise<string>(()=>{})
 await assert.rejects(readRendererPhase(wc,'observe','dom',never,undefined,10),/BMW_BROWSER_TIMEOUT: observe\/dom/)
 assert.equal(events.eventNames().length,0)
 for(const event of ['destroyed','render-process-gone','did-start-navigation']){
  const pending=readRendererPhase(wc,'page.media.list','dom',never)
  const rejected=assert.rejects(pending,event==='did-start-navigation'?/PAGE_CHANGED/:/RENDERER_GONE/)
  events.emit(event,{},'https://example.com',false,true);await rejected;assert.equal(events.eventNames().length,0)
 }
 const controller=new AbortController();controller.abort(new Error('cancelled before read'));let started=false
 await assert.rejects(readRendererPhase(wc,'observe','dom',async()=>{started=true;return ''},controller.signal),/cancelled before/);assert.equal(started,false)
})
