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
    {seq:3,type:'tool/result',data:{message:{toolCallId:'call',source:{kind:'tool',callId:'call'},content:[{type:'text',text:'Project PNG'},{type:'image',data:'native-pixels'}]}}},
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
