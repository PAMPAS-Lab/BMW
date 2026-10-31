import assert from 'node:assert/strict'
import http from 'node:http'
import {once} from 'node:events'
import type {Socket} from 'node:net'
import test from 'node:test'
import {Agent,fetch,getGlobalDispatcher,setGlobalDispatcher} from 'undici'
import {createBridgeHttp} from '../src/bridge-http.js'

test('Private Bridge jobs bypass the global header/body timer but retain caller cancellation and closed loopback destinations',async()=>{
 const server=http.createServer((request,response)=>{const timer=setTimeout(()=>{response.writeHead(200,{'content-type':'application/json'});response.end('{"ok":true}')},1300);request.on('close',()=>{if(!request.complete)clearTimeout(timer)});response.on('close',()=>clearTimeout(timer))})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const address=server.address();if(!address||typeof address==='string')throw new Error('Expected loopback fixture')
 const base='http://127.0.0.1:'+address.port,previous=getGlobalDispatcher(),short=new Agent({headersTimeout:20,bodyTimeout:20}),client=createBridgeHttp(base)
 try{
  setGlobalDispatcher(short)
  await assert.rejects(fetch(base+'/tool',{signal:AbortSignal.timeout(3000)}),error=>error instanceof TypeError&&(error.cause as {code?:string})?.code==='UND_ERR_HEADERS_TIMEOUT')
  const result=await client.request('execute',{method:'POST',body:'{}',signal:AbortSignal.timeout(3000)});assert.deepEqual(await result.json(),{ok:true})
  const controller=new AbortController(),pending=client.request('execute',{method:'POST',body:'{}',signal:controller.signal});setTimeout(()=>controller.abort(),25)
  await assert.rejects(pending,error=>error instanceof Error&&error.name==='AbortError')
  for(const url of ['https://127.0.0.1:80','http://localhost:80','http://example.com','http://127.0.0.1:80/other','http://user:pass@127.0.0.1:80'])assert.throws(()=>createBridgeHttp(url),/loopback/)
 }finally{setGlobalDispatcher(previous);await client.close();await short.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})

test('Private Bridge transport never follows an authenticated redirect',async()=>{
 let received=0
 const destination=http.createServer((_request,response)=>{received++;response.end('unexpected')});destination.listen(0,'127.0.0.1');await once(destination,'listening');const address=destination.address();if(!address||typeof address==='string')throw new Error('Expected fixture')
 const server=http.createServer((_request,response)=>{response.writeHead(302,{location:'http://127.0.0.1:'+address.port+'/execute'});response.end()});server.listen(0,'127.0.0.1');await once(server,'listening');const source=server.address();if(!source||typeof source==='string')throw new Error('Expected fixture');const client=createBridgeHttp('http://127.0.0.1:'+source.port)
 try{await assert.rejects(client.request('execute',{method:'POST',headers:{authorization:'Bearer fixture-not-a-secret'},body:'{}',signal:AbortSignal.timeout(1000)}));assert.equal(received,0)}finally{await client.close();server.closeAllConnections();destination.closeAllConnections();await Promise.all([new Promise<void>(resolve=>server.close(()=>resolve())),new Promise<void>(resolve=>destination.close(()=>resolve()))])}
})

test('Private Bridge idle-close races retain every write reply without replaying an executed job',async()=>{
 const sockets=new Set<Socket>(),executions=new Map<string,number>()
 const server=http.createServer(async(request,response)=>{let body='';for await(const chunk of request)body+=chunk;const id=String(JSON.parse(body).id);executions.set(id,(executions.get(id)??0)+1);response.on('error',()=>{});response.end('{"ok":true}')})
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{})})
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('Expected loopback fixture')
 const client=createBridgeHttp('http://127.0.0.1:'+address.port)
 try{
  const call=async(id:string)=>{const result=await client.request('execute',{method:'POST',headers:{authorization:'Bearer fixture-not-a-secret'},body:JSON.stringify({id}),signal:AbortSignal.timeout(3000)});assert.deepEqual(await result.json(),{ok:true})}
  for(let i=0;i<20;i++){
   await call('warm-'+i);await new Promise<void>(resolve=>setImmediate(resolve))
   for(const socket of sockets)socket.end()
   await call('write-'+i)
   await new Promise<void>(resolve=>setTimeout(resolve,2))
  }
  assert.equal(executions.size,40)
  assert.ok([...executions.values()].every(count=>count===1),'Non-idempotent jobs must never be transparently replayed')
 }finally{await client.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
