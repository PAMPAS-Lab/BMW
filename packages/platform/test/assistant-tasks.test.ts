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
