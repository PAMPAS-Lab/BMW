import assert from 'node:assert/strict'
import test from 'node:test'
import { DshHarnessPort } from '../src/harness-port.js'
import { DshRuntime } from '../src/dsh-runtime.js'
test('DSH driver delegates lifecycle and prompt submission without exposing raw RPC',async()=>{
 const calls:unknown[]=[],runtime=new DshRuntime({})
 runtime.url='http://127.0.0.1:1234'
 runtime.start=async()=>{calls.push('start');return runtime.url}
 runtime.stopAndWait=async()=>{calls.push('stop')}
 runtime.enqueuePrompt=async(sessionId,text)=>{calls.push({sessionId,text});return '00000000-0000-0000-0000-000000000001'}
 const port=new DshHarnessPort(runtime)
 assert.equal(await port.start(),runtime.url)
 assert.equal(await port.enqueuePrompt('session-1','hello'),'00000000-0000-0000-0000-000000000001')
 assert.equal('call' in port,false)
 await port.stop()
 assert.deepEqual(calls,['start',{sessionId:'session-1',text:'hello'},'stop'])
})
test('DSH driver normalizes mutations, health and cancellation through official transport',async t=>{
 const saved=globalThis.fetch;t.after(()=>{globalThis.fetch=saved})
 globalThis.fetch=async()=>new Response('',{status:200})
 const calls:unknown[]=[],runtime=new DshRuntime({})
 runtime.child={};runtime.authCookie='dsh-auth=test';runtime.url='http://127.0.0.1:1234'
 runtime.call=async(method,payload)=>{calls.push({method,payload});return method==='session.fork'?{sessionId:'fork-1'}:{cancelled:true}}
 const port=new DshHarnessPort(runtime)
 assert.equal((await port.health()).ready,true)
 await port.renameSession('s','Title');assert.deepEqual(await port.forkSession('s'),{sessionId:'fork-1'})
 await port.archiveSession('s');await port.moveSession('w','s');await port.deleteWorkspace('w')
 assert.deepEqual(await port.cancelSession('s'),{cancelled:true})
 assert.deepEqual(calls,[{method:'session.rename',payload:{sessionId:'s',title:'Title'}},{method:'session.fork',payload:{sessionId:'s'}},
 {method:'workspace.archiveSession',payload:{sessionId:'s'}},{method:'workspace.insertSessionBefore',payload:{workspaceId:'w',sessionId:'s'}},
 {method:'workspace.delete',payload:{workspaceId:'w'}},{method:'session.cancel',payload:{sessionId:'s'}}])
 const events:unknown[]=[],off=port.subscribe(event=>events.push(event));runtime.publish('status',{state:'ready'});off();runtime.publish('status',{state:'stopped'})
 assert.deepEqual(events,[{type:'status',value:{state:'ready'}}])
})
test('DSH driver rejects malformed wire snapshots before the core receives them',async()=>{
 const runtime=new DshRuntime({}),port=new DshHarnessPort(runtime),project={id:'p',name:'P',directory:'/p'}
 runtime.ensureWorkspace=async()=>({workspaceId:'w',title:'P',path:'/p',sessionIds:[42]} as unknown as Awaited<ReturnType<DshRuntime['ensureWorkspace']>>)
 await assert.rejects(port.ensureWorkspace(project),/identifier/)
 runtime.listProjectSessions=async()=>({workspaceId:'w',selectedSessionId:null,membership:['s'],items:[{sessionId:'s',title:'S',updatedAt:'today'}]} as unknown as Awaited<ReturnType<DshRuntime['listProjectSessions']>>)
 await assert.rejects(port.listProjectSessions(project),/timestamp/)
})
