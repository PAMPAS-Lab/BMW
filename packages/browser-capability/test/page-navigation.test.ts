import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {navigatePage,closeNavigationPage,withNativePageRead,documentReadGraceMs} from '../src/page-navigation.js'
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

test('Collection DOM readiness stops and drains asset loading, while ordinary navigation still waits for load',async()=>{
 const phases:import('../src/page-navigation.js').NavigationTrace[]=[];const f=fixture(),operation=navigatePage(f.page,'https://example.org',undefined,2000,5,true,async()=>true,entry=>phases.push(entry))
 await new Promise(resolve=>setImmediate(resolve));f.events.emit('dom-ready');await operation
 assert.deepEqual(phases.map(({phase,reason})=>({phase,reason})),[{phase:'stop',reason:'dom-ready'},{phase:'complete',reason:'dom-ready'}]);assert.deepEqual(f.steps,['load','stop']);assert.equal(f.page.isDestroyed(),false);assert.equal(f.events.eventNames().length,0)
 const ordinary=fixture();let finished=false;const pending=navigatePage(ordinary.page,'https://example.org',undefined,2000).then(()=>{finished=true});ordinary.events.emit('dom-ready');await new Promise(resolve=>setTimeout(resolve,180));assert.equal(finished,false);ordinary.resolveLoad();await pending;assert.deepEqual(ordinary.steps,['load'])
})
test('A collection ready probe cannot release a still-running native navigation or leave late renderer work',async()=>{
 const f=fixture(false),operation=navigatePage(f.page,'https://example.org',undefined,2000,5,true,async()=>true)
 await new Promise(resolve=>setImmediate(resolve));f.events.emit('dom-ready');await assert.rejects(operation,/PAGE_CHANGED/);assert.equal(f.page.isDestroyed(),true);assert.deepEqual(f.steps,['load','stop','close']);assert.equal(f.events.eventNames().length,0)
})


test('Temporary content lease captures real content before stopping an unrelated pending load',async()=>{
 const f=fixture(),phases:string[]=[],operation=withNativePageRead(f.page,'https://example.org',{timeoutMs:1000,ready:async()=>true,read:async()=>{f.steps.push('captured');return 'verified post'},incomplete:async()=>{throw new Error('unexpected incomplete')},trace:entry=>phases.push(entry.phase+':'+entry.reason)})
 await new Promise(resolve=>setImmediate(resolve));f.events.emit('dom-ready');assert.equal(await operation,'verified post');assert.deepEqual(f.steps,['load','captured','stop']);assert.deepEqual(phases,['complete:snapshot','stop:snapshot']);assert.equal(f.events.eventNames().length,0)
})
test('Temporary content lease records negative evidence before deadline cleanup and never upgrades an empty shell',async()=>{
 const f=fixture(),operation=withNativePageRead(f.page,'https://example.org',{timeoutMs:5,ready:async()=>false,read:async()=>{throw new Error('empty shell cannot be read')},incomplete:async()=>{f.steps.push('negative evidence');return {state:'incomplete'}}})
 await new Promise(resolve=>setImmediate(resolve));f.events.emit('dom-ready');assert.deepEqual(await operation,{state:'incomplete'});assert.deepEqual(f.steps,['load','negative evidence','stop']);assert.equal(f.events.eventNames().length,0)
})

test('Only successful same-document receiving bytes can extend a read; headers, stale progress, errors and other URLs never do',()=>{
 const good={url:'https://x.com/fixture',status:200,receivedBytes:1000,lastDataAt:9900,completed:false,failed:false}
 assert.equal(documentReadGraceMs(good,good.url,10000,8000),4000)
 for(const patch of [{status:403},{receivedBytes:0},{lastDataAt:8000},{lastDataAt:11000},{completed:true},{failed:true},{url:'https://x.com/another'}])assert.equal(documentReadGraceMs({...good,...patch},good.url,10000,8000),0)
})
test('Content lease lets active document bytes finish but keeps a hard cap and cancellation, without accepting an empty shell',async()=>{
 const activeTransfer=()=>{const before=Date.now();while(Date.now()===before){/* Deliberately cross a clock tick while reading the transfer snapshot. */}return {url:'https://x.com/fixture',status:200,receivedBytes:100,lastDataAt:Date.now(),completed:false,failed:false}}
 const f=fixture(),start=Date.now();setTimeout(()=>f.events.emit('did-navigate'),0)
 const value=await withNativePageRead(f.page,'https://x.com/fixture',{timeoutMs:500,documentTransfer:activeTransfer,ready:async()=>Date.now()-start>=600,read:async()=>{f.steps.push('qualified real post');return 'post'},incomplete:async()=>{throw new Error('Active transfer should finish')}})
 assert.equal(value,'post');assert.ok(Date.now()-start>=600);assert.deepEqual(f.steps,['load','qualified real post','stop'])
 const held=fixture(),heldStart=Date.now();setTimeout(()=>held.events.emit('did-navigate'),0)
 assert.equal(await withNativePageRead(held.page,'https://x.com/fixture',{timeoutMs:500,documentTransfer:activeTransfer,ready:async()=>false,read:async()=>{throw new Error('No posts')},incomplete:async()=> 'incomplete'}),'incomplete')
 assert.ok(Date.now()-heldStart>=750&&Date.now()-heldStart<1500)
 const cancel=fixture(),controller=new AbortController();setTimeout(()=>{cancel.events.emit('did-navigate');controller.abort(new Error('cancel active transfer'))},20)
 await assert.rejects(withNativePageRead(cancel.page,'https://x.com/fixture',{signal:controller.signal,timeoutMs:500,documentTransfer:()=>({url:'https://x.com/fixture',status:200,receivedBytes:100,lastDataAt:Date.now(),completed:false,failed:false}),ready:async()=>false,read:async()=> 'bad',incomplete:async()=> 'bad'}),/cancel active transfer/)
 assert.deepEqual(cancel.steps,['load','stop'])
})
