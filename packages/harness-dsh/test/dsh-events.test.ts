import assert from 'node:assert/strict'
import test from 'node:test'
import type {AgentDriverEvent} from '@bmw-agent/agent-contract'
import {DshEvents,dshBrowserCatalog} from '../src/dsh-events.js'
test('DSH pre-input admission uses the exact scoped model catalog and immutable Project identity',()=>{
  dshBrowserCatalog({sessionId:'native',directory:'/project',tools:[{name:'browser'}]},'native','/project')
  for(const patch of [{tools:[{name:'browser'},{name:'run_code'}]},{tools:[]},{sessionId:'other'},{directory:'/other'}])assert.throws(()=>dshBrowserCatalog({sessionId:'native',directory:'/project',tools:[{name:'browser'}],...patch},'native','/project'),/effective scoped/)
})
test('DSH durable events retain tool IDs and text without leaking image bytes or thinking',async()=>{
  const decoder=new DshEvents('run'),events:AgentDriverEvent[]=[]
  const emit=async(event:AgentDriverEvent)=>{events.push(event)}
  const rows=[
    {seq:1,type:'request/header',data:{header:{tools:[{name:'browser'}]}}},
    {seq:2,type:'tool/call',data:{callId:'call',name:'browser',arguments:'{"action":"media.screenshot"}'}},
    {seq:3,type:'tool/result',surfaceOp:'append',sourceEventSeqs:[2],data:{message:{toolCallId:'call',source:{kind:'tool',callId:'call'},content:[{type:'text',text:'Project PNG'},{type:'image',data:'native-pixels'}]}}},
    {seq:4,type:'assistant/message',data:{message:{content:[{type:'thinking',thinking:'private-reasoning'},{type:'text',text:'Visual result'}]}}},
    {seq:5,type:'turn/end',data:{reason:{kind:'completed'}}}
  ]
  for(const row of rows.slice(0,4))await decoder.receive(row,emit)
  await decoder.receive(rows[3],emit)
  assert.deepEqual(await decoder.receive(rows[4],emit),{outcome:'success',message:''})
  assert.deepEqual(events.map(row=>row.type),['tool.started','tool.completed','message.completed'])
  assert.equal(JSON.stringify(events).includes('native-pixels'),false);assert.equal(JSON.stringify(events).includes('private-reasoning'),false)
  const changed=new DshEvents('run')
  await assert.rejects(changed.receive({seq:1,type:'request/header',data:{header:{tools:[{name:'shell'}]}}},emit),/changed/)
  const foreign=new DshEvents('foreign')
  await foreign.receive(rows[1],emit)
  await assert.rejects(foreign.receive({seq:3,type:'tool/result',data:{message:{toolCallId:'call',source:{kind:'tool',callId:'other'},content:[]}}},emit),/changed its call identity/)
})

test('DSH official prune replacements do not complete or duplicate live browser calls',async()=>{
  const decoder=new DshEvents('run'),events:AgentDriverEvent[]=[]
  const emit=async(event:AgentDriverEvent)=>{events.push(event)}
  await decoder.receive({seq:100,type:'tool/call',data:{callId:'live',name:'browser',arguments:'{"action":"video.studio"}'}},emit)
  await decoder.receive({seq:101,type:'compaction/prune',data:{shadowedRange:{start:10,end:10},shadowedSeqs:[10],shadowedTokenCount:6000}},emit)
  const replacement={seq:102,type:'tool/result',surfaceOp:{op:'replace',startSeq:10,endSeq:10},sourceEventSeqs:[10],data:{message:{toolCallId:'old',source:{kind:'tool',callId:'old'},content:[{type:'text',text:'old pruned text'},{type:'image',data:'private-image'}]}}}
  await decoder.receive(replacement,emit)
  await decoder.receive(replacement,emit)
  assert.deepEqual(events.map(e=>e.type),['tool.started'])
  await decoder.receive({seq:103,type:'tool/result',surfaceOp:'append',sourceEventSeqs:[100],data:{message:{toolCallId:'live',source:{kind:'tool',callId:'live'},content:[{type:'text',text:'current result'}]}}},emit)
  assert.deepEqual(await decoder.receive({seq:104,type:'turn/end',data:{reason:{kind:'completed'}}},emit),{outcome:'success',message:''})
  assert.deepEqual(events.map(e=>e.type),['tool.started','tool.completed'])
  assert.equal(JSON.stringify(events).includes('old pruned text'),false)
  assert.equal(JSON.stringify(events).includes('private-image'),false)
})

test('DSH rejects orphan, mismatched and live-call prune replacements',async()=>{
  const emit=async()=>{},prune={seq:100,type:'compaction/prune',data:{shadowedRange:{start:10,end:10},shadowedSeqs:[10],shadowedTokenCount:100}}
  const replacement={seq:101,type:'tool/result',surfaceOp:{op:'replace',startSeq:10,endSeq:10},sourceEventSeqs:[10],data:{message:{toolCallId:'call',source:{kind:'tool',callId:'call'},content:[]}}}
  await assert.rejects(new DshEvents('orphan').receive(replacement,emit),/pruned tool-result replacement/)
  for(const patch of [{surfaceOp:{op:'replace',startSeq:11,endSeq:11}},{sourceEventSeqs:[11]},{seq:102}]){
    const decoder=new DshEvents('mismatch');await decoder.receive(prune,emit)
    await assert.rejects(decoder.receive({...replacement,...patch},emit),/prune/)
  }
  const live=new DshEvents('live')
  await live.receive({seq:99,type:'tool/call',data:{callId:'call',name:'browser',arguments:'{"action":"video.studio"}'}},emit)
  await live.receive(prune,emit)
  await assert.rejects(live.receive(replacement,emit),/pruned tool-result replacement/)
  await assert.rejects(new DshEvents('bad-price').receive({...prune,data:{...prune.data,shadowedSeqs:[11]}},emit),/prune provenance/)
})
