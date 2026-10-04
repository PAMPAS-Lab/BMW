import assert from 'node:assert/strict'
import test from 'node:test'
import {redactVideoCaseValue,readCompleteSessionHistory,visibleReasoning} from '../../../scripts/video-case-log.js'
test('video case export preserves prompts and observable reasoning while redacting credentials and inline media',()=>{
 const value={prompt:'原样指令',apiKey:'private',config:{maxTokens:8192},url:'https://example.test/?token=private',unknownField:'Bearer exact-secret',image:'data:image/png;base64,AAAA',response:{type:'thinking',thinking:'可见的推理内容'}}
 const redacted=redactVideoCaseValue(value,['exact-secret']) as Record<string,unknown>
 assert.equal(redacted.prompt,value.prompt);assert.equal(redacted.apiKey,'[REDACTED]');assert.deepEqual(redacted.config,value.config)
 assert.equal(redacted.url,'https://example.test/?token=[REDACTED]');assert.equal(redacted.unknownField,'Bearer [REDACTED]')
 assert.ok((redacted.image as {inlineMediaOmitted:boolean}).inlineMediaOmitted)
 assert.ok(visibleReasoning([{event:{seq:1,type:'assistant/message',data:value.response}}]).length>0)
})
test('video case export reads complete paginated history and rejects duplicate or missing event sequences',async()=>{
 const rows=Array.from({length:420},(_,seq)=>({event:{seq,type:seq===0?'session/create':'assistant/message',data:{text:String(seq)}}}))
 const calls:number[]=[]
 const history=await readCompleteSessionHistory({async call(method,payload){if(method==='session.history')return {events:rows.slice(220)};const before=Number(payload.beforeSeq);calls.push(before);return {records:rows.slice(Math.max(0,before-200),before),hasMore:before>200}}},'test-session')
 assert.deepEqual(calls,[220,20]);assert.deepEqual(history,rows)
 await assert.rejects(readCompleteSessionHistory({async call(method){return method==='session.history'?{events:rows.slice(1,3)}:{records:[rows[1]],hasMore:false}}},'test'),/cursor/)
 await assert.rejects(readCompleteSessionHistory({async call(){return {events:[rows[0],rows[2]]}}},'test'),/gap/)
})
