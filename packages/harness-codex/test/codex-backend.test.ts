import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentDriverEvent, AgentRunRequest } from '@bmw-agent/agent-contract'
import { CodexBackend } from '../src/codex-backend.js'
import type { CodexRpc } from '../src/codex-rpc.js'

function fixture(model='gpt-5.4') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-codex-backend-'))
  const rollout=path.join(root,'rollout-fixture.jsonl');fs.writeFileSync(rollout,'');fs.truncateSync(rollout,9*1024*1024)
  const controller = new AbortController()
  const request: AgentRunRequest = { sessionId: 'bmw', externalSessionId: 'provider', runId: 'run', messageId: 'input', project: { id: 'project', name: 'Disposable', directory: root }, text: 'hello', context: 'owned context', signal: controller.signal }
  const listeners=new Set<(method:string,params:unknown)=>void>()
  const listener=(method:string,params:unknown)=>{for(const callback of [...listeners])callback(method,params)}
  let handler: ((method: string, params: unknown) => Promise<unknown>) | null = null
  let turn: (() => Promise<unknown>) | null = null
  let beforeTurn:(()=>void)|undefined
  let interruption: (() => Promise<unknown>) | null = null
  let ended = 0
  let authenticated=true,modelAvailable=true
  const calls: { method: string; params: unknown }[] = []
  const rpc: CodexRpc = {
    async call(method, params) {
      calls.push({ method, params })
      if(method==='config/read')return {config:{mcp_servers:{'foreign-node':{command:'unavailable',env:{TOKEN:'private-fixture'}},'foreign-computer':{url:'https://invalid.test'}}}}
      if(method==='account/read')return {account:authenticated?{type:'chatgpt'}:null,requiresOpenaiAuth:true}
      if(method==='model/list')return {data:modelAvailable?[{model,displayName:'Fixture model',description:'Official test catalog'}]:[],nextCursor:null}
      if (method === 'thread/resume' || method === 'thread/start') return { thread: { id: 'provider',path:rollout }, model }
      if(method==='thread/compact/start'){queueMicrotask(()=>listener('turn/completed',{threadId:'provider',turn:{id:'compact',status:'completed'}}));return {}}
      if (method === 'turn/start') { beforeTurn?.();listener?.('turn/started', { threadId: 'provider', turn: { id: 'turn' } }); return turn ? turn() : { turn: { id: 'turn' } } }
      if (method === 'turn/interrupt') return interruption ? interruption() : {}
      return {}
    },
    notify() {}, onNotification(value) { listeners.add(value); return () => { listeners.delete(value) } }, onRequest(value) { handler = value }, onFailure() {}, async close() { ended++ }
  }
  return { root, controller, request, calls, rpc, ended: () => ended,
    event(method: string, params: unknown) { listener?.(method, params) },
    tool(params: unknown) { return handler!('item/tool/call', params) },
    setBeforeTurn(value:()=>void){beforeTurn=value},
    setTurn(value: () => Promise<unknown>) { turn = value }, setInterruption(value: () => Promise<unknown>) { interruption = value }
    ,setAccount(ready:boolean,available=true){authenticated=ready;modelAvailable=available}
  }
}
const definition = { name: 'browser' as const, description: 'BMW', inputSchema: { type: 'object' } }
test('Codex resumes the same anchor with fresh input scope after an audit and preserves browser-only admission',async t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}))
 const backend=new CodexBackend({executable:'/disposable/codex',configDirectory:f.root,model:'gpt-5.4',catalogGate:{async verify(){}},rpcFactory:()=>f.rpc,connection:async()=>({definition,async execute(){return {result:{}}}})})
 const audit={...f.request,context:'Audit only for queued review input. Pinned target: fixture-film'}
 await backend.prepare(audit)
 const running=backend.run(audit,async()=>{});await new Promise(resolve=>setImmediate(resolve))
 f.event('turn/completed',{threadId:'provider',turn:{id:'turn',status:'completed'}});await running
 const rework={...f.request,runId:'rework',messageId:'rework-input',context:'Current Studio: user authorized title and subtitle rework'}
 await backend.prepare(rework)
 const resumed=f.calls.filter(row=>row.method==='thread/resume').map(row=>row.params as {threadId:string;developerInstructions:string;config:{features:{shell_tool:boolean}}})
 assert.equal(resumed.length,2);assert.ok(resumed.every(row=>row.threadId==='provider'))
 assert.match(resumed[0].developerInstructions,/Pinned target: fixture-film/)
 assert.match(resumed[1].developerInstructions,/Current Studio:/)
 assert.equal(resumed[1].config.features.shell_tool,false)
 const injected=f.calls.filter(row=>row.method==='thread/inject_items').map(row=>row.params as {threadId:string;items:{role:string;content:{text:string}[]}[]})
 assert.equal(injected.length,1);assert.ok(injected.every(row=>row.threadId==='provider'&&row.items[0].role==='developer'))
 assert.equal(f.calls.filter(row=>row.method==='thread/compact/start').length,1,'Legacy anchor compacts once, not every input')
 assert.match(injected[0].items[0].content[0].text,/Current Studio: user authorized title and subtitle rework/)
 assert.doesNotMatch(injected[0].items[0].content[0].text,/Pinned target: fixture-film/)
 const firstTurn=f.calls.findIndex(row=>row.method==='turn/start')
 assert.ok(f.calls.findIndex(row=>row.method==='thread/compact/start')<firstTurn)
 await backend.close()
})
test('GPT-6 uses the exact admitted startup catalog when resuming its native Session before dispatch',async t=>{
  const model='gpt-6.1-sol',f=fixture(model);t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}))
  const catalog=path.join(f.root,'admitted.json');let verified=false
  const backend=new CodexBackend({executable:'/disposable/codex',configDirectory:f.root,model,catalogGate:{async verify(){verified=true;return catalog}},rpcFactory:(_executable,_directory,_profile,_environment,modelCatalogPath)=>{
    assert.ok(verified);assert.equal(modelCatalogPath,catalog);return f.rpc
  },connection:async()=>({definition,async execute(){assert.fail('No tool before input')}})})
  await backend.prepare(f.request)
  const resumed=f.calls.find(row=>row.method==='thread/resume')?.params as {threadId:string;model:string;excludeTurns:boolean;config:{mcp_servers:Record<string,unknown>}}
  assert.equal(resumed.threadId,'provider');assert.equal(resumed.model,model)
  assert.equal(resumed.excludeTurns,true,'Resume must not hydrate accumulated tool image history into an oversized transport response')
  assert.deepEqual(resumed.config.mcp_servers,{'foreign-node':{enabled:false},'foreign-computer':{enabled:false}})
  assert.equal(f.calls.some(row=>row.method==='turn/start'),false);await backend.close();assert.ok(f.ended()>0)
})
test('GPT-6 never starts a native runtime without its admitted startup catalog',async t=>{
  const f=fixture('gpt-6-luna');t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}))
  const backend=new CodexBackend({executable:'/disposable/codex',configDirectory:f.root,model:'gpt-6-luna',catalogGate:{async verify(){}},rpcFactory:()=>{assert.fail('Unadmitted catalog must never launch')},connection:async()=>({definition,async execute(){assert.fail('No input')}})})
  await assert.rejects(backend.prepare(f.request),/catalog was not admitted/);assert.equal(f.calls.length,0);await backend.close()
})
test('Codex admits input after catalog verification, resumes the same provider and normalizes browser/image/message receipts', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }))
  let verified = false, executed = 0
  const backend = new CodexBackend({ executable: '/disposable/codex', configDirectory: f.root, model: 'gpt-5.4', catalogGate: { async verify() { verified = true } }, rpcFactory: () => { assert.equal(verified, true); return f.rpc }, connection: async () => ({ definition, async execute(args) { executed++; assert.equal(args.action, 'status'); return { result: { token: 'BMW' }, images: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] } } }) })
  await backend.prepare(f.request)
  assert.ok(f.calls.some(row => row.method === 'thread/resume'))
  assert.ok(!f.calls.some(row => row.method === 'turn/start'))
  const events: AgentDriverEvent[] = []
  const running = backend.run(f.request, async event => { events.push(event) })
  await new Promise(resolve => setImmediate(resolve))
  const output = await f.tool({ threadId: 'provider', turnId: 'turn', callId: 'call', tool: 'browser', namespace: null, arguments: { action: 'status' } })
  assert.equal(executed, 1)
  assert.deepEqual(output, { success: true, contentItems: [{ type: 'inputText', text: '{"token":"BMW"}' }, { type: 'inputImage', imageUrl: 'data:image/png;base64,aGVsbG8=' }] })
  f.event('item/agentMessage/delta', { threadId: 'provider', turnId: 'turn', itemId: 'message', delta: 'BMW' })
  f.event('item/completed', { threadId: 'provider', turnId: 'turn', item: { type: 'agentMessage', id: 'message', text: 'BMW answer' } })
  f.event('turn/completed', { threadId: 'provider', turn: { id: 'turn', status: 'completed' } })
  assert.equal((await running).outcome, 'success'); assert.ok(f.ended() > 0)
  assert.deepEqual(events.map(row => row.type), ['session.bound', 'input.accepted', 'tool.started', 'tool.completed', 'message.delta', 'message.completed', 'turn.completed'])
  assert.deepEqual(events[1], { type: 'input.accepted', receiptId: 'turn' })
  assert.deepEqual(events[3], {type:'tool.completed',callId:'run:call',success:true,message:'{"token":"BMW"}'})
  assert.ok(!JSON.stringify(events[3]).includes('aGVsbG8='),'History retains the JSON receipt without image base64')
  await backend.close()
})
test('Codex large escaped success receipts stay valid and bounded without truncating model output',async t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}))
 const result={text:'\u0001'.repeat(20000),artifactId:'fixture.png'}
 const backend=new CodexBackend({executable:'/disposable/codex',configDirectory:f.root,model:'gpt-5.4',catalogGate:{async verify(){}},rpcFactory:()=>f.rpc,connection:async()=>({definition,async execute(){return {result}}})})
 await backend.prepare(f.request);const events:AgentDriverEvent[]=[];const running=backend.run(f.request,async event=>{events.push(event)});await new Promise(resolve=>setImmediate(resolve))
 const output=await f.tool({threadId:'provider',turnId:'turn',callId:'large',tool:'browser',namespace:null,arguments:{action:'status'}}) as {contentItems:{text:string}[]}
 assert.equal(output.contentItems[0].text,JSON.stringify(result))
 const receipt=events.find(event=>event.type==='tool.completed');assert.ok(receipt?.type==='tool.completed');assert.ok(receipt.success);assert.ok(receipt.message.length<=16384);assert.equal((JSON.parse(receipt.message) as {resultTruncated:boolean}).resultTruncated,true)
 f.event('turn/completed',{threadId:'provider',turn:{id:'turn',status:'completed'}});await running;await backend.close()
})
test('Codex rechecks live authentication and model membership before creating or resuming a native Session',async t=>{
  for(const [authenticated,available]of [[false,true],[true,false]]){
    const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));f.setAccount(authenticated,available)
    const backend=new CodexBackend({executable:'/disposable/codex',configDirectory:f.root,model:'gpt-5.4',catalogGate:{async verify(){}},rpcFactory:()=>f.rpc,connection:async()=>({definition,async execute(){assert.fail('No browser input')}})})
    await assert.rejects(backend.prepare(f.request),/unavailable for the signed-in account/)
    assert.equal(f.calls.some(row=>['thread/start','thread/resume','turn/start'].includes(row.method)),false);assert.ok(f.ended()>0);await backend.close()
  }
})
test('Codex catalog failure never starts the provider or releases a user message', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }))
  const backend = new CodexBackend({ executable: '/disposable/codex', configDirectory: f.root, model: 'gpt-5.4', catalogGate: { async verify() { throw new Error('extra model tools') } }, rpcFactory: () => { throw new Error('must never launch') }, connection: async () => ({ definition, async execute() { throw new Error('must never execute') } }) })
  await assert.rejects(backend.prepare(f.request), /extra model tools/)
  assert.equal(f.calls.length, 0); await backend.close()
})
test('Codex rejects a foreign tool scope and waits for transport cleanup', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }))
  const backend = new CodexBackend({ executable: '/disposable/codex', configDirectory: f.root, model: 'gpt-5.4', catalogGate: { async verify() {} }, rpcFactory: () => f.rpc, connection: async () => ({ definition, async execute() { throw new Error('foreign request must not execute') } }) })
  await backend.prepare(f.request)
  const running = backend.run(f.request, async () => {}); void running.catch(() => {})
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(f.tool({ threadId: 'another-provider', turnId: 'turn', callId: 'call', tool: 'browser', arguments: { action: 'status' } }), /invalid scope/)
  await assert.rejects(running, /invalid scope/); assert.ok(f.ended() > 0)
  await backend.close()
})
test('Codex cancellation racing the input receipt sends one interrupt after the turn becomes known', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }))
  let release!: (value: unknown) => void
  f.setTurn(() => new Promise(resolve => { release = resolve }))
  const backend = new CodexBackend({ executable: '/disposable/codex', configDirectory: f.root, model: 'gpt-5.4', catalogGate: { async verify() {} }, rpcFactory: () => f.rpc, connection: async () => ({ definition, async execute() { throw new Error('no tools') } }) })
  f.setInterruption(async () => { f.event('turn/completed', { threadId: 'provider', turn: { id: 'turn', status: 'interrupted' } }); return {} })
  await backend.prepare(f.request)
  const running = backend.run(f.request, async () => {})
  await new Promise(resolve => setImmediate(resolve))
  f.controller.abort()
  release({ turn: { id: 'turn' } })
  assert.equal((await running).outcome, 'interrupted')
  assert.equal(f.calls.filter(row => row.method === 'turn/interrupt').length, 1)
  await backend.close()
})

test('Codex records bounded reasoning/compaction lifecycle and usage metadata without content or extra model tools',async t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const observed:unknown[]=[];f.request.observeRuntime=p=>{observed.push(p)}
 const backend=new CodexBackend({executable:'/disposable/codex',configDirectory:f.root,model:'gpt-5.4',catalogGate:{async verify(){}},rpcFactory:()=>f.rpc,connection:async()=>({definition,async execute(){assert.fail('No tool expected')}})})
 await backend.prepare(f.request);assert.deepEqual(observed.splice(0),[{phase:'compaction.started'},{phase:'compaction.completed'}]);const running=backend.run(f.request,async()=>{});await new Promise(resolve=>setImmediate(resolve))
 for(const type of ['reasoning','contextCompaction'])for(const method of ['item/started','item/completed'])f.event(method,{threadId:'provider',turnId:'turn',item:{type,id:type,content:['PRIVATE NOT LOGGED'],summary:['PRIVATE NOT LOGGED']}})
 f.event('thread/tokenUsage/updated',{threadId:'provider',turnId:'turn',tokenUsage:{last:{inputTokens:200,cachedInputTokens:150,outputTokens:30,reasoningOutputTokens:10}}})
 f.event('error',{threadId:'provider',turnId:'turn',willRetry:true,error:{message:'PRIVATE NOT LOGGED',additionalDetails:'PRIVATE NOT LOGGED'}})
 const retryCases:[unknown,Record<string,unknown>][]=[
  ['unauthorized',{failureCategory:'authentication'}],
  [{responseStreamDisconnected:{httpStatusCode:502,secret:'PRIVATE NOT LOGGED'}},{failureCategory:'stream',httpStatus:502}],
  [{httpConnectionFailed:{httpStatusCode:null}},{failureCategory:'connection'}],
  [{responseStreamConnectionFailed:{httpStatusCode:999}},{failureCategory:'connection'}],
  ['PRIVATE NOT LOGGED',{failureCategory:'other'}],
  [{unknown:'PRIVATE NOT LOGGED'},{failureCategory:'other'}]
 ]
 for(const [codexErrorInfo] of retryCases)f.event('error',{threadId:'provider',turnId:'turn',willRetry:true,error:{message:'PRIVATE NOT LOGGED',additionalDetails:'PRIVATE NOT LOGGED',codexErrorInfo}})
 f.event('turn/completed',{threadId:'provider',turn:{id:'turn',status:'completed'}});await running
 assert.equal(observed.length,6+retryCases.length);assert.equal(JSON.stringify(observed).includes('PRIVATE'),false);assert.deepEqual(observed[4],{phase:'usage',inputTokens:200,cachedInputTokens:150,outputTokens:30,reasoningTokens:10});assert.deepEqual(observed[5],{phase:'retry'});assert.deepEqual(observed.slice(6),retryCases.map(([,expected])=>({phase:'retry',...expected})));assert.equal(f.calls.filter(row=>row.method==='turn/start').length,1,'Retry observation must not submit another turn');await backend.close()
})

test('Codex retention ledger deduplicates scope across processes and accounts images without retaining payloads',async t=>{
 const {CodexContextLedger}=await import('../src/codex-context.js')
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}))
 const first=new CodexContextLedger(f.root,'project','bmw','provider')
 assert.equal(first.needsCompaction(true),true);assert.equal(first.needsCompaction(false),false)
 first.compacted();assert.equal(first.instructions('scope A','guide'),'guide\nscope A')
 first.acknowledged('scope A','guide',13)
 const second=new CodexContextLedger(f.root,'project','bmw','provider')
 assert.equal(second.instructions('scope A','guide'),null)
 assert.equal(second.instructions('scope B','guide'),'scope B')
 assert.equal(second.instructions('scope B','changed guide'),'changed guide\nscope B')
 second.imagesDelivered(Array.from({length:24},()=>({data:'private-image'})))
 assert.equal(new CodexContextLedger(f.root,'project','bmw','provider').needsCompaction(true),true)
 assert.equal(new CodexContextLedger(f.root,'other-project','bmw','provider').legacy,true)
 const files=fs.readdirSync(path.join(f.root,'bmw-context'))
 for(const file of files)assert.doesNotMatch(fs.readFileSync(path.join(f.root,'bmw-context',file),'utf8'),/private-image|scope A|changed guide/)
})
test('Codex compaction requires actual completion and respects cancellation without replay',async()=>{
 const {compactCodexContext}=await import('../src/codex-context.js')
 const listeners=new Set<(method:string,params:unknown)=>void>(),calls:string[]=[]
 const rpc:CodexRpc={async call(method){calls.push(method);return {}},notify(){},onNotification(callback){listeners.add(callback);return ()=>{listeners.delete(callback)}},onRequest(){},onFailure(){},async close(){}}
 const controller=new AbortController(),phases:string[]=[]
 const pending=compactCodexContext(rpc,'anchor',controller.signal,phase=>phases.push(phase))
 for(const listener of listeners)listener('turn/completed',{threadId:'other',turn:{status:'completed'}})
 controller.abort();await assert.rejects(pending,/cancelled/)
 assert.deepEqual(calls,['thread/compact/start']);assert.deepEqual(phases,['compaction.started']);assert.equal(listeners.size,0)
})


test('Codex ignores a resumed previous-turn usage notification queued before current acceptance, without admitting foreign work',async t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const observed:unknown[]=[];f.request.observeRuntime=p=>observed.push(p)
 const backend=new CodexBackend({executable:'/disposable/codex',configDirectory:f.root,model:'gpt-5.4',catalogGate:{async verify(){}},rpcFactory:()=>f.rpc,connection:async()=>({definition,async execute(){assert.fail('No tool requested')}})})
 const usage={last:{inputTokens:5,cachedInputTokens:1,outputTokens:2,reasoningOutputTokens:0}}
 await backend.prepare(f.request);observed.length=0
 f.setBeforeTurn(()=>f.event('thread/tokenUsage/updated',{threadId:'provider',turnId:'previous-completed-turn',tokenUsage:usage}))
 const running=backend.run(f.request,async()=>{});await new Promise(resolve=>setImmediate(resolve))
 f.event('thread/tokenUsage/updated',{threadId:'provider',turnId:'turn',tokenUsage:usage})
 f.event('turn/completed',{threadId:'provider',turn:{id:'turn',status:'completed'}})
 assert.equal((await running).outcome,'success');assert.deepEqual(observed,[{phase:'usage',inputTokens:5,cachedInputTokens:1,outputTokens:2,reasoningTokens:0}])
 assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);await backend.close()
})
test('Codex still rejects foreign-thread usage and wrong-turn messages or completions',async t=>{
 for(const [method,params]of [
  ['thread/tokenUsage/updated',{threadId:'foreign',turnId:'previous',tokenUsage:{last:{inputTokens:1,cachedInputTokens:0,outputTokens:0,reasoningOutputTokens:0}}}],
  ['item/agentMessage/delta',{threadId:'provider',turnId:'previous',itemId:'foreign-message',delta:'must not be emitted'}],
  ['turn/completed',{threadId:'provider',turn:{id:'previous',status:'completed'}}]
 ] as const){
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));const messages:AgentDriverEvent[]=[]
  const backend=new CodexBackend({executable:'/disposable/codex',configDirectory:f.root,model:'gpt-5.4',catalogGate:{async verify(){}},rpcFactory:()=>f.rpc,connection:async()=>({definition,async execute(){assert.fail('No foreign work')}})})
  await backend.prepare(f.request);const running=backend.run(f.request,async e=>{messages.push(e)});await new Promise(resolve=>setImmediate(resolve));f.event(method,params)
  await assert.rejects(running,/another (?:provider Session|turn)/);assert.equal(messages.filter(e=>e.type==='message.delta').length,0);await backend.close()
 }
})
