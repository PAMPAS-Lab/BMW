import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import type {ClientRequest} from 'electron'
import assert from 'node:assert/strict'
import test from 'node:test'
import {createMediaSessionFetch,mediaReferrer} from '../src/media-session-fetch.js'

test('media adapter reduces referrer and strips secrets across bounded redirects',async()=>{
  const calls: {url:string;headers:Headers}[]=[]
  const fetcher=createMediaSessionFetch({fetch:async(url,init)=>{
    calls.push({url:String(url),headers:new Headers(init?.headers)})
    return calls.length===1?new Response(null,{status:302,headers:{location:'https://cdn.example/clip'}}):new Response('ok')
  }},'https://user:pass@page.example/private?q=secret#fragment')
  await fetcher('https://page.example/start',{headers:{Authorization:'sensitive',Referer:'https://wrong.example/'}})
  assert.equal(calls[0].headers.get('referer'),'https://page.example/private?q=secret')
  assert.equal(calls[1].headers.get('referer'),'https://page.example/')
  assert.equal(calls[1].headers.get('authorization'),null)
  assert.equal(mediaReferrer('https://page.example/private',new URL('http://cdn.example/v'),'strict-origin-when-cross-origin'),'')
})

test('media adapter honors no-referrer and refuses non-web redirects and redirect loops',async()=>{
  let count=0
  const fetcher=createMediaSessionFetch({fetch:async(_url,init)=>{
    assert.equal(new Headers(init?.headers).get('referer'),null);count++
    return new Response(null,{status:302,headers:{location:'file:///private'}})
  }},'https://page.example/private','no-referrer')
  await assert.rejects(fetcher('https://cdn.example/v'),/HTTP\(S\)/)
  assert.equal(count,1)
  const loop=createMediaSessionFetch({fetch:async()=>new Response(null,{status:302,headers:{location:'/again'}})},'https://page.example/')
  await assert.rejects(loop('https://cdn.example/v'),/budget/)
})

test('Media POST keeps bounded SABR protobuf bytes and refuses arbitrary bodies, origins and redirect rewrites',async()=>{
 const body=new Uint8Array([0,128,255,1]),calls:RequestInit[]=[],page='https://www.youtube.com/watch?v=abcdefghijk',url='https://r1.googlevideo.com/videoplayback?id=current'
 const fetcher=createMediaSessionFetch({fetch:async(_url,init)=>{calls.push(init??{});return new Response('ump')}},page)
 await fetcher(url,{method:'POST',body,headers:{'content-type':'application/x-protobuf'}});assert.equal(new Headers(calls[0]!.headers).get('origin'),'https://www.youtube.com');assert.equal(calls[0]!.method,'POST');assert.deepEqual(calls[0]!.body,body);assert.equal(new Headers(calls[0]!.headers).get('referer'),'https://www.youtube.com/')
 for(const init of [{method:'DELETE'},{method:'POST',body:'arbitrary'},{method:'POST',body:new Uint8Array(256*1024+1),headers:{'content-type':'application/x-protobuf'}}])await assert.rejects(fetcher(url,init),/accepts GET|bounded|256 KiB/)
 await assert.rejects(fetcher('https://foreign.example/videoplayback',{method:'POST',body,headers:{'content-type':'application/x-protobuf'}}),/identity-bound/)
 const redirect=createMediaSessionFetch({fetch:async()=>new Response(null,{status:303,headers:{location:url}})},page)
 await assert.rejects(redirect(url,{method:'POST',body,headers:{'content-type':'application/x-protobuf'}}),/rewritten/)
 await fetcher.waitForIdle()
})


test('Native POST preserves binary data and close-before-response cannot release an unfinished response',async()=>{
 const bytes=new Uint8Array([0,128,255]),incoming=Object.assign(new PassThrough(),{headers:{'content-type':'application/vnd.yt-ump'},statusCode:200}),headers=new Map<string,string>();let sent:Buffer|undefined,method:string|undefined
 const request=Object.assign(new EventEmitter(),{setHeader:(key:string,value:string)=>headers.set(key,value),end:(body?:Buffer)=>{sent=body;queueMicrotask(()=>{request.emit('close');queueMicrotask(()=>request.emit('response',incoming))})},abort:()=>{request.emit('abort');request.emit('close')}})
 const fetcher=createMediaSessionFetch({fetch:async()=>{throw new Error('Native factory required')}},'https://www.youtube.com/watch?v=abcdefghijk','',options=>{method=options.method;return request as unknown as ClientRequest})
 const response=await fetcher('https://r1.googlevideo.com/videoplayback?id=fixture',{method:'POST',body:bytes,headers:{'content-type':'application/x-protobuf'}})
 assert.equal(method,'POST');assert.deepEqual(sent,Buffer.from(bytes));assert.equal(headers.get('referer'),'https://www.youtube.com/');assert.equal(headers.get('origin'),'https://www.youtube.com')
 let drained=false;const idle=fetcher.waitForIdle().then(()=>{drained=true});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(drained,false)
 incoming.end(Buffer.from([9,8,7]));assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([9,8,7]));await idle;assert.equal(drained,true)
})


test('Native cancellation still aborts a live response after outgoing close and waits for its destruction',async()=>{
 const incoming=Object.assign(new PassThrough(),{headers:{'content-type':'application/vnd.yt-ump'},statusCode:200});let aborted=false
 const request=Object.assign(new EventEmitter(),{setHeader:()=>{},end:()=>queueMicrotask(()=>{request.emit('close');request.emit('response',incoming)}),abort:()=>{aborted=true;request.emit('abort');request.emit('close')}})
 const fetcher=createMediaSessionFetch({fetch:async()=>new Response()},'https://www.youtube.com/watch?v=abcdefghijk','',()=>request as unknown as ClientRequest),signal=new AbortController()
 const response=await fetcher('https://r1.googlevideo.com/videoplayback?id=fixture',{signal:signal.signal}),body=response.arrayBuffer()
 signal.abort(new Error('cancel live response'));await assert.rejects(body,/cancel live response/);await fetcher.waitForIdle();assert.equal(aborted,true);assert.equal(incoming.destroyed,true)
})
