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
  const controller = new AbortController()
  const request: AgentRunRequest = { sessionId: 'bmw', externalSessionId: 'provider', runId: 'run', messageId: 'input', project: { id: 'project', name: 'Disposable', directory: root }, text: 'hello', context: 'owned context', signal: controller.signal }
  let listener: ((method: string, params: unknown) => void) | null = null
  let handler: ((method: string, params: unknown) => Promise<unknown>) | null = null
  let turn: (() => Promise<unknown>) | null = null
  let interruption: (() => Promise<unknown>) | null = null
  let ended = 0
  let authenticated=true,modelAvailable=true
  const calls: { method: string; params: unknown }[] = []
  const rpc: CodexRpc = {
    async call(method, params) {
      calls.push({ method, params })
      if(method==='account/read')return {account:authenticated?{type:'chatgpt'}:null,requiresOpenaiAuth:true}
      if(method==='model/list')return {data:modelAvailable?[{model,displayName:'Fixture model',description:'Official test catalog'}]:[],nextCursor:null}
      if (method === 'thread/resume' || method === 'thread/start') return { thread: { id: 'provider' }, model }
      if (method === 'turn/start') { listener?.('turn/started', { threadId: 'provider', turn: { id: 'turn' } }); return turn ? turn() : { turn: { id: 'turn' } } }
      if (method === 'turn/interrupt') return interruption ? interruption() : {}
      return {}
    },
    notify() {}, onNotification(value) { listener = value; return () => { listener = null } }, onRequest(value) { handler = value }, onFailure() {}, async close() { ended++ }
  }
  return { root, controller, request, calls, rpc, ended: () => ended,
    event(method: string, params: unknown) { listener?.(method, params) },
    tool(params: unknown) { return handler!('item/tool/call', params) },
    setTurn(value: () => Promise<unknown>) { turn = value }, setInterruption(value: () => Promise<unknown>) { interruption = value }
    ,setAccount(ready:boolean,available=true){authenticated=ready;modelAvailable=available}
  }
}
const definition = { name: 'browser' as const, description: 'BMW', inputSchema: { type: 'object' } }
test('GPT-6 uses the exact admitted startup catalog when resuming its native Session before dispatch',async t=>{
  const model='gpt-6.1-sol',f=fixture(model);t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}))
  const catalog=path.join(f.root,'admitted.json');let verified=false
  const backend=new CodexBackend({executable:'/disposable/codex',configDirectory:f.root,model,catalogGate:{async verify(){verified=true;return catalog}},rpcFactory:(_executable,_directory,_profile,_environment,modelCatalogPath)=>{
    assert.ok(verified);assert.equal(modelCatalogPath,catalog);return f.rpc
  },connection:async()=>({definition,async execute(){assert.fail('No tool before input')}})})
  await backend.prepare(f.request)
  const resumed=f.calls.find(row=>row.method==='thread/resume')?.params as {threadId:string;model:string}
  assert.equal(resumed.threadId,'provider');assert.equal(resumed.model,model)
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
  await backend.close()
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
