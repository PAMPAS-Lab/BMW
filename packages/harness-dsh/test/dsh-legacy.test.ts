import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {dshLegacyMessages,readDshLegacySessions} from '../src/dsh-legacy.js'
import type {DshRuntime} from '../src/dsh-runtime.js'

function message(seq:number,type='user/message',source='user',text='Human prompt'){
  const value={content:[{type:'text',text},{type:'thinking',text:'Private reasoning'},{type:'image',data:'Private image bytes'}],source:{kind:source}}
  return {type:'event',event:{type,seq,time:seq+10,surfaceOp:'append',data:type==='assistant/message'?{message:value}:value}}
}
test('legacy display imports human/model text without context, summaries, private reasoning or pixels',()=>{
  const records=[message(1),message(2,'user/message','context','Injected instructions'),message(3,'assistant/message','model','Visible reply'),{...message(4,'assistant/message','model','Compaction summary'),event:{...message(4).event,type:'assistant/message',surfaceOp:{op:'replace',startSeq:1,endSeq:3},data:{message:{content:[{type:'text',text:'Compaction summary'}],source:{kind:'model'}}}}}]
  const result=dshLegacyMessages('old-session',records,4)
  assert.deepEqual(result.map(row=>[row.role,row.text]),[['user','Human prompt'],['assistant','Visible reply']])
  assert.deepEqual(dshLegacyMessages('old-session',records,4),result)
  assert.throws(()=>dshLegacyMessages('old-session',[message(2),message(1)],2),/not ordered/)
  assert.throws(()=>dshLegacyMessages('old-session',[message(2)],1),/frozen cursor/)
})
test('cold DSH migration reads all backward pages at one cursor and preserves archived/parent identities',async t=>{
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-dsh-legacy-')))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const signal=new AbortController().signal,calls:{method:string;payload:Record<string,unknown>}[]=[]
  const runtime={async call(method:string,payload:Record<string,unknown>,options:{signal:AbortSignal}){
    assert.equal(options.signal,signal);calls.push({method,payload})
    if(method==='workspace.list')return {items:[{workspaceId:'workspace',path:directory,sessionIds:['parent','child','subagent']}],archivedSessionIds:['archived']}
    if(method==='session.list')return {items:['parent','child','archived','subagent'].map(sessionId=>({sessionId,cwd:directory,updatedAt:20,running:false,...(sessionId==='subagent'?{origin:'subagent'}:{}),...(sessionId==='child'?{parentSessionId:'parent'}:{}),projections:{values:{title:sessionId+' title'}}}))}
    if(method==='session.history')return {header:{id:payload.sessionId,cwd:directory,createdAt:1,agentPreset:'bmw',...(payload.sessionId==='child'?{parentSession:'parent'}:{})},cursor:300,events:[message(300,'assistant/message','model','Latest reply')],hasMore:payload.sessionId==='child'}
    if(method==='session.page'){assert.equal(payload.throughSeq,300);assert.equal(payload.beforeSeq,300);return {records:[message(1)],hasMore:false}}
    assert.fail('Migration attempted a native mutation: '+method)
  }}as unknown as DshRuntime
  const result=await readDshLegacySessions(runtime,[{id:'project',name:'Disposable',directory,workspaceId:'workspace',sessionId:'child'}],'bmw',signal)
  assert.deepEqual(result.map(row=>row.externalSessionId),['parent','child','archived'])
  assert.equal(result[1].parentExternalSessionId,'parent');assert.equal(result[1].selected,true)
  assert.deepEqual(result[1].messages.map(row=>row.text),['Human prompt','Latest reply'])
  assert.equal(result[2].archived,true)
  assert.equal(calls.filter(row=>row.method==='session.page').length,1)
})
test('missing native bindings and pagination without progress fail instead of choosing another Session',async t=>{
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-dsh-legacy-')))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const project={id:'project',name:'Disposable',directory,workspaceId:'workspace',sessionId:'missing'}
  const runtime={async call(method:string){
    if(method==='workspace.list')return {items:[{workspaceId:'workspace',path:directory,sessionIds:['present']}],archivedSessionIds:[]}
    if(method==='session.list')return {items:[{sessionId:'present',cwd:directory,updatedAt:1,running:false}]}
    if(method==='session.history')return {header:{id:'present',createdAt:1,cwd:directory},cursor:2,events:[message(2)],hasMore:true}
    if(method==='session.page')return {records:[message(2)],hasMore:true}
    assert.fail('Unexpected native mutation')
  }}as unknown as DshRuntime
  await assert.rejects(readDshLegacySessions(runtime,[project],'bmw',new AbortController().signal),/Saved DSH Session is unavailable/)
  await assert.rejects(readDshLegacySessions(runtime,[{...project,sessionId:'present'}],'bmw',new AbortController().signal),/made no progress/)
})
