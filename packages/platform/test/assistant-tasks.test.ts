import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type {AgentBackend} from '@bmw-agent/agent-contract'
import {AgentHost} from '../src/agent-host.js'
import {AgentHistoryStore,parseAgentHistory} from '../src/agent-history-store.js'
import {ConversationStore} from '../src/conversation-store.js'
import {assistantTasks} from '../src/assistant-tasks.js'
test('Internal review queues behind its caller, persists trusted task metadata, deduplicates and waits for real cleanup',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-review-task-'))),conversations=new ConversationStore(path.join(root,'sessions.json')),history=new AgentHistoryStore(path.join(root,'history'),id=>conversations.get(id))
 let release!:()=>void,drain!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),clean=new Promise<void>(r=>drain=r),started=new Promise<void>(r=>entered=r),inputs:string[]=[]
 const backend:AgentBackend={description:{id:'fixture',label:'Isolated fixture',baseline:'fixture',capabilities:{streaming:true,images:true,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:true}},prepare:async()=>backend.description,run:async request=>{inputs.push(request.text);if(request.text==='caller'){entered();await held}else{assert.equal(request.context,'frozen review context');assert.throws(()=>host.enqueueTask(request.sessionId,'recursive','context',{kind:'video-review',key:'b'.repeat(64),payload:'{}',modelId:'fixture-model'}),/recursively/)}return {outcome:'success',message:''}},interrupt:async()=>release(),respond:async()=>{},close:async()=>{}}
 const host=new AgentHost({conversations,history,backends:[backend],currentProject:()=>({id:'p',name:'Isolated',directory:root}),context:async()=>'',model:()=> 'fixture-model',drain:async request=>{if(request.text!=='caller')await clean}})
 t.after(async()=>{release();drain();await host.close();fs.rmSync(root,{recursive:true,force:true})})
 const session=host.create('fixture'),owner={projectId:'p',sessionId:session.sessionId};let selected=owner
 const tasks=assistantTasks({host,history,conversations,model:()=> 'fixture-model',owner:()=>selected,changing:()=>false}),caller=host.enqueue(session.sessionId,'caller');await started
 const task={key:'a'.repeat(64),payload:'{"fingerprint":"fixture"}',text:'review',context:'frozen review context'},review=tasks.start(owner,task)
 assert.equal(review.state,'queued');assert.equal(history.snapshot(owner.sessionId).receipts[1].task?.payload,task.payload);assert.equal(tasks.start(owner,task).runId,review.runId);assert.deepEqual(inputs,['caller'])
 release();await host.wait(caller.runId);await new Promise(r=>setImmediate(r));assert.equal(tasks.read(owner,review.runId).drained,false);assert.deepEqual(inputs,['caller','review'])
 drain();await host.wait(review.runId);assert.equal(tasks.read(owner,review.runId).state,'success');assert.equal(tasks.read(owner,review.runId).drained,true)
 assert.equal(new AgentHistoryStore(path.join(root,'history'),id=>conversations.get(id)).snapshot(owner.sessionId).receipts[1].task?.modelId,'fixture-model')
 assert.throws(()=>tasks.read(owner,caller.runId),/Unknown internal/);selected={...owner,projectId:'foreign'};assert.throws(()=>tasks.read(owner,review.runId),/selected/);selected=owner
 const raw=history.snapshot(owner.sessionId);raw.receipts[1].task!.payload='x'.repeat(8193);assert.throws(()=>parseAgentHistory(raw,owner.sessionId),/Agent text/)
})
test('Internal review refuses unverified catalogs, changed models and uncertain delivery without replay',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-review-admission-'))),conversations=new ConversationStore(path.join(root,'sessions.json')),history=new AgentHistoryStore(path.join(root,'history'),id=>conversations.get(id));let calls=0,model='one'
 const backend:AgentBackend={description:{id:'fixture',label:'Fixture',baseline:'fixture',capabilities:{streaming:true,images:true,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:false}},prepare:async()=>backend.description,run:async()=>{calls++;throw new Error('uncertain transport')},interrupt:async()=>{},respond:async()=>{},close:async()=>{}}
 const host=new AgentHost({conversations,history,backends:[backend],currentProject:()=>({id:'p',name:'Fixture',directory:root}),context:async()=>'',model:()=>model,drain:async()=>{}});t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true})})
 const session=host.create('fixture'),owner={projectId:'p',sessionId:session.sessionId},tasks=assistantTasks({host,history,conversations,model:()=>model,owner:()=>owner,changing:()=>false}),request=(key:string)=>({key:key.repeat(64),payload:'{}',text:'audit',context:'audit'})
 const bad=tasks.start(owner,request('a'));assert.equal((await host.wait(bad.runId)).outcome,'failed');assert.equal(calls,0)
 backend.description.capabilities.browserOnly=true;const changed=tasks.start(owner,request('b'));model='two';assert.equal((await host.wait(changed.runId)).outcome,'failed');assert.equal(calls,0)
 const uncertain=tasks.start(owner,request('c'));await assert.rejects(host.wait(uncertain.runId),/uncertain/);assert.equal(tasks.read(owner,uncertain.runId).state,'uncertain');assert.equal(tasks.start(owner,request('c')).runId,uncertain.runId);assert.throws(()=>tasks.start(owner,request('d')),/uncertain/);assert.equal(calls,1)
})

test('Only an explicit new start after interrupted cleanup gets a fresh input; uncertain and active receipts never replay',()=>{
 const owner={projectId:'project',sessionId:'session'},receipts:{runId:string;state:string;outcome:string|null;task:unknown}[]=[],active=new Set<string>();let enqueued=0
 const host={activeRunId:null,ownsRun:(id:string)=>active.has(id),enqueueTask:(_session:string,_text:string,_context:string,metadata:unknown)=>{const runId='review-'+(++enqueued);receipts.push({runId,state:'accepted',outcome:null,task:metadata});active.add(runId);return {runId}}} as unknown as AgentHost
 const tasks=assistantTasks({host,history:{snapshot:()=>({receipts})} as unknown as AgentHistoryStore,conversations:{get:()=>({...owner,driverId:'codex',archivedAt:null})} as unknown as ConversationStore,model:()=>null,owner:()=>owner,changing:()=>false}),request={key:'a'.repeat(64),payload:'{}',text:'Review actual exported MP4.',context:'Audit only.'}
 const first=tasks.start(owner,request);assert.equal(enqueued,1);assert.equal(tasks.start(owner,request).runId,first.runId)
 receipts[0].state='finished';receipts[0].outcome='interrupted'
 assert.equal(tasks.start(owner,request).runId,first.runId,'A still-owned cancelled run has not drained');assert.equal(enqueued,1)
 active.delete(first.runId)
 const second=tasks.start(owner,{...request,payload:'{"newBaseline":1}'});assert.notEqual(second.runId,first.runId);assert.equal(enqueued,2);assert.equal(tasks.find(owner,request.key)?.runId,second.runId);assert.equal(tasks.read(owner,first.runId).state,'interrupted')
 active.delete(second.runId);receipts[1].state='unknown'
 assert.equal(tasks.start(owner,request).runId,second.runId);assert.equal(enqueued,2,'Uncertain delivery is never replayed')
 receipts[1].state='finished';receipts[1].outcome='success'
 assert.equal(tasks.start(owner,request).runId,second.runId);assert.equal(enqueued,2,'Completed review still deduplicates')
 assert.equal(tasks.start(owner,{...request,restartIncompleteRunId:first.runId}).runId,second.runId,'A stale Host recovery identity cannot restart the latest completed task')
 const recovered=tasks.start(owner,{...request,restartIncompleteRunId:second.runId});assert.notEqual(recovered.runId,second.runId);assert.equal(enqueued,3)
 assert.equal(tasks.start(owner,{...request,restartIncompleteRunId:recovered.runId}).runId,recovered.runId,'Host recovery cannot restart active work')
})

test('Explicit review restart recovers a drained failure before provider acceptance but never replays accepted or uncertain delivery',()=>{
 const owner={projectId:'project',sessionId:'session'},receipts:{runId:string;state:string;outcome:string|null;providerReceiptId?:string|null;task:unknown}[]=[],active=new Set<string>();let enqueued=0
 const host={activeRunId:null,ownsRun:(id:string)=>active.has(id),enqueueTask:(_session:string,_text:string,_context:string,metadata:unknown)=>{const runId='review-'+(++enqueued);receipts.push({runId,state:'accepted',outcome:null,providerReceiptId:null,task:metadata});active.add(runId);return {runId}}} as unknown as AgentHost
 const tasks=assistantTasks({host,history:{snapshot:()=>({receipts})} as unknown as AgentHistoryStore,conversations:{get:()=>({...owner,driverId:'codex',archivedAt:null})} as unknown as ConversationStore,model:()=>null,owner:()=>owner,changing:()=>false}),request={key:'f'.repeat(64),payload:'{}',text:'Audit the same MP4.',context:'Independent audit.'}
 const first=tasks.start(owner,request);receipts[0].state='finished';receipts[0].outcome='failed'
 assert.equal(tasks.start(owner,request).runId,first.runId,'Failure is not retryable while native cleanup is owned')
 active.delete(first.runId)
 const second=tasks.start(owner,{...request,payload:'{"baseline":2}'})
 assert.notEqual(second.runId,first.runId,'An explicit start can recover confirmed failure before provider acceptance')
 assert.equal(enqueued,2);assert.equal(tasks.read(owner,first.runId).state,'failed');assert.equal(tasks.find(owner,request.key)?.runId,second.runId)
 active.delete(second.runId);receipts[1].state='finished';receipts[1].outcome='failed';receipts[1].providerReceiptId='official-receipt'
 assert.equal(tasks.start(owner,request).runId,second.runId,'Accepted delivery must not be replayed')
 delete receipts[1].providerReceiptId
 assert.equal(tasks.start(owner,request).runId,second.runId,'Legacy missing acceptance evidence is not confirmed failure before acceptance')
 receipts[1].providerReceiptId=null;receipts[1].state='unknown'
 assert.equal(tasks.start(owner,request).runId,second.runId,'Uncertain delivery remains blocked')
 receipts[1].state='finished';receipts[1].outcome='success'
 assert.equal(tasks.start(owner,request).runId,second.runId,'Completed audit remains deduplicated');assert.equal(enqueued,2)
})
