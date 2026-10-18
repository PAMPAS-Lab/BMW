import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {navigatePage,closeNavigationPage} from '../src/page-navigation.js'
import type {NavigationPage} from '../src/page-navigation.js'
import {SessionOperations} from '../src/session-operations.js'
function fixture(stopSettles=true,closeDestroys=true){
 const events=new EventEmitter(),steps:string[]=[];let gone=false,rejectLoad:(reason:unknown)=>void=()=>{},resolveLoad:()=>void=()=>{}
 const pending=new Promise<void>((resolve,reject)=>{resolveLoad=resolve;rejectLoad=reject}),page=Object.assign(events,{isDestroyed:()=>gone,loadURL:async()=>{steps.push('load');return pending},stop:()=>{steps.push('stop');if(stopSettles)rejectLoad(new Error('ERR_ABORTED'))},close:()=>{steps.push('close');if(closeDestroys){gone=true;events.emit('destroyed')}}}) as unknown as NavigationPage
 return {page,events,steps,resolveLoad,allowClose:()=>{closeDestroys=true}}
}
test('Navigation deadline stops and drains the real pending operation before the FIFO admits another action',async()=>{
 const f=fixture(),queue=new SessionOperations(),first=queue.run(()=>{},()=>navigatePage(f.page,'https://example.org',undefined,5,5)),failed=assert.rejects(first,/NAVIGATION_TIMEOUT/),next=queue.run(()=>{},async()=>{assert.deepEqual(f.steps,['load','stop']);f.steps.push('next')});await failed;await next;await queue.drain();assert.equal(queue.busy,false);assert.equal(f.events.eventNames().length,0)
})
test('Cancellation whose stop never settles closes the actual page before returning, with no late continuation',async()=>{
 const f=fixture(false),controller=new AbortController(),pending=navigatePage(f.page,'https://example.org',controller.signal,1000,5),failed=assert.rejects(pending,/explicit cancel/);await new Promise(resolve=>setImmediate(resolve));controller.abort(new Error('explicit cancel'));await failed;assert.equal(f.page.isDestroyed(),true);assert.deepEqual(f.steps,['load','stop','close']);f.resolveLoad();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.events.eventNames().length,0)
})
test('Failed native close reports quarantine and only a later explicit close with destruction recovers',async()=>{
 const f=fixture(false,false);await assert.rejects(navigatePage(f.page,'https://example.org',undefined,5,5),/CLEANUP_FAILED/);assert.equal(f.page.isDestroyed(),false);f.allowClose();await closeNavigationPage(f.page,10);assert.equal(f.page.isDestroyed(),true);assert.equal(f.events.eventNames().length,0)
})
test('A user-owned page is retained after failed stop until explicit close recovery',async()=>{
 const f=fixture(false,true);await assert.rejects(navigatePage(f.page,'https://example.org',undefined,5,5,false),/CLEANUP_FAILED/);assert.deepEqual(f.steps,['load','stop']);assert.equal(f.page.isDestroyed(),false);await closeNavigationPage(f.page,10);assert.equal(f.page.isDestroyed(),true)
})
test('Already cancelled navigation never starts native loading and an ordinary load error does not leave listeners',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(navigatePage(f.page,'https://example.org',controller.signal));assert.deepEqual(f.steps,[]);const error=new Error('network failed'),events=new EventEmitter(),page=Object.assign(events,{isDestroyed:()=>false,loadURL:async()=>{throw error},stop:()=>{throw new Error('unnecessary stop')},close:()=>{}}) as unknown as NavigationPage;await assert.rejects(navigatePage(page,'https://example.org'),e=>e===error);assert.equal(events.eventNames().length,0)
})
