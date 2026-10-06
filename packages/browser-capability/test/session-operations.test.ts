import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bmwProduct } from '@bmw-agent/product-bmw'
import { BrowserCapabilityRegistry } from '../src/browser-capability-registry.js'
import { createBridgeServer } from '../src/bridge-server.js'
import { SessionOperations } from '../src/session-operations.js'

test('Session operations serialize, recheck admission and recover after failure', async () => {
  const operations = new SessionOperations()
  const order: string[] = []
  let release: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let live = true
  const first = operations.run(() => {}, async () => { order.push('start'); await gate; order.push('end') })
  const second = operations.run(() => { if (!live) throw new Error('released') }, async () => { order.push('wrong') })
  const rejected = assert.rejects(second, /released/)
  const third = operations.run(() => {}, async () => { order.push('next') })
  await Promise.resolve()
  assert.deepEqual(order, ['start'])
  assert.equal(operations.busy, true)
  live = false
  release()
  await Promise.all([first, rejected, third])
  await operations.drain()
  assert.deepEqual(order, ['start', 'end', 'next'])
  assert.equal(operations.busy, false)
})

test('Browser bridge pins Project identity, revokes queued Sessions and returns only owned PNG images', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmw-session-test-'))
  const artifacts = path.join(directory, 'artifacts')
  await fs.mkdir(artifacts)
  const file = path.join(artifacts, 'capture.png')
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=', 'base64')
  await fs.writeFile(file, bytes)
  let active = 'p'
  let imagePath = file
  let calls = 0
  let userOperationBusy = false
  let release: () => void
  let started: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const began = new Promise<void>((resolve) => { started = resolve })
  const bridge = await createBridgeServer({ get busy(){return userOperationBusy}, async execute(input) {
    calls++
    if ((input as { action: string }).action === 'wait') { started(); await gate; return {} }
    return { type: 'screenshot', path: imagePath }
  } }, { toolDefinition: new BrowserCapabilityRegistry(bmwProduct).toolDefinition(), resolveProject: (cwd) => cwd === directory ? { id: 'p', directory } : undefined, activeProjectId: () => active })
  t.after(async () => { await bridge.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const request = async (endpoint: string, body: unknown) => {
    const response = await fetch(`${bridge.url}/${endpoint}`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, value: await response.json() as { binding?: string; images?: { data: string }[]; error?: string } }
  }
  assert.equal((await request('session/register', { sessionId: 's', directory: '/' })).status, 400)
  const binding=bridge.registerSession('s',directory)
  bridge.attachProviderSession(binding,'fixture','native-s')
  assert.equal((await request('session/register',{sessionId:'native-s',driverId:'fixture',directory})).value.binding,binding)
  assert.equal((await request('execute', { action: 'status' })).status, 400)
  active = 'other'
  assert.equal((await request('execute', { binding, arguments: { action: 'media.screenshot' } })).status, 400)
  assert.equal(calls, 0)
  active = 'p'
  await bridge.changeProject(async () => {
    assert.equal(bridge.busy, true)
    assert.equal((await request('execute', { binding, arguments: { action: 'status' } })).status, 400)
  })
  assert.equal(bridge.busy, false)
  userOperationBusy=true
  assert.equal(bridge.busy,true)
  await assert.rejects(bridge.changeProject(async()=>{throw new Error('Must not enter')}),/browser is busy/)
  userOperationBusy=false
  assert.equal(bridge.changingProject,false)
  const image = await request('execute', { binding, arguments: { action: 'media.screenshot' } })
  assert.equal(image.value.images?.[0].data, bytes.toString('base64'))
  const child = spawn(process.execPath, [path.resolve('packages/browser-capability/src/browser-mcp-server.js')], {
    env: { ...process.env, BMW_PRODUCT_ID: 'bmw', BMW_BRIDGE_URL: bridge.url, BMW_BRIDGE_TOKEN: bridge.token, BMW_SESSION_BINDING:binding, BMW_CATALOG_ONLY:'' }, stdio: ['pipe', 'pipe', 'pipe']
  })
  t.after(() => { child.kill() })
  const lines = readline.createInterface({ input: child.stdout })
  const received = new Promise<{ result: { content: { type: string; data?: string }[]; structuredContent: { path: string } } }>((resolve, reject) => {
    lines.once('line', (line) => { try { resolve(JSON.parse(line)) } catch (error) { reject(error) } })
    child.once('error', reject)
  })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser', arguments: { action: 'media.screenshot' } } })}\n`)
  const wire = await received
  assert.deepEqual(wire.result.content.map((block) => block.type), ['text', 'image'])
  assert.equal(wire.result.content[1].data, bytes.toString('base64'))
  assert.equal(wire.result.structuredContent.path, file)
  child.kill()

  const outside = path.join(directory, 'outside.png')
  await fs.writeFile(outside, bytes)
  imagePath = outside
  assert.match((await request('execute', { binding, arguments: { action: 'media.screenshot' } })).value.error || '', /outside/)
  const running = request('execute', { binding, arguments: { action: 'wait' } })
  await began
  const queued = request('execute', { binding, arguments: { action: 'wait' } })
  const released = bridge.releaseSession(binding)
  release()
  await released
  assert.equal((await running).status, 400)
  assert.equal((await queued).status, 400)
  assert.equal((await request('execute', { binding, arguments: { action: 'status' } })).status, 400)
})


test('Browser bridge admits bounded Project frame sets and propagates active MCP cancellation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmw-frame-bridge-'))
  const artifacts = path.join(directory, 'artifacts')
  await fs.mkdir(artifacts)
  const file = path.join(artifacts, 'frame.png')
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=', 'base64')
  await fs.writeFile(file, bytes)
  let imagePath = file
  let cancelled: () => void
  const cancelledCall = new Promise<void>((resolve) => { cancelled = resolve })
  let began: () => void
  const started = new Promise<void>((resolve) => { began = resolve })
  const bridge = await createBridgeServer({ async execute(raw, { signal } = {}) {
    if ((raw as { action: string }).action === 'media.convert') {
      began()
      return new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () => { cancelled(); reject(new Error('cancelled')) }, { once: true }))
    }
    return { type: 'frame-set', frames: [{ type: 'screenshot', path: imagePath }, { type: 'screenshot', path: imagePath }] }
  } }, { toolDefinition: new BrowserCapabilityRegistry(bmwProduct).toolDefinition(), resolveProject: (cwd) => cwd === directory ? { id: 'p', directory } : undefined, activeProjectId: () => 'p' })
  t.after(async () => { await bridge.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const headers = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }
  const binding=bridge.registerSession('s',directory)
  const frames = () => fetch(`${bridge.url}/execute`, { method: 'POST', headers, body: JSON.stringify({ binding, arguments: { action: 'media.frames.sample' } }) })
  const admitted = await (await frames()).json() as { images: { data: string }[] }
  assert.deepEqual(admitted.images.map((image) => image.data), [bytes.toString('base64'), bytes.toString('base64')])
  imagePath = path.join(directory, 'outside.png')
  await fs.writeFile(imagePath, bytes)
  assert.equal((await frames()).status, 400)
  const controller = new AbortController()
  const call = fetch(`${bridge.url}/execute`, { method: 'POST', headers, body: JSON.stringify({ binding, arguments: { action: 'media.convert' } }), signal: controller.signal })
  const failed = assert.rejects(call)
  await started
  controller.abort()
  await failed
  await cancelledCall
})

test('Studio context bridge authenticates Session ownership and rechecks revocation after GUI flush',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-context-'));let active='p',release:()=>void,began:()=>void,delay=false
 const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{began=resolve})
 const bridge=await createBridgeServer({execute:async()=>({})},{resolveProject:cwd=>cwd===directory?{id:'p',directory}:undefined,activeProjectId:()=>active,sessionContext:async(sessionId,projectId)=>{assert.equal(sessionId,'s');assert.equal(projectId,'p');if(delay){began();await gate}return {text:'current draft'}}})
 t.after(async()=>{await bridge.close();await fs.rm(directory,{recursive:true,force:true})})
 const request=(endpoint:string,body:unknown,token=bridge.token)=>fetch(bridge.url+'/'+endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})
 assert.equal((await request('session/context',{},'wrong')).status,401);assert.equal((await request('session/context',{binding:'unknown'})).status,400)
 const binding=bridge.registerSession('s',directory);assert.deepEqual(await(await request('session/context',{binding})).json(),{text:'current draft'})
 active='other';assert.equal((await request('session/context',{binding})).status,400);active='p';delay=true;const pending=request('session/context',{binding});await started;await request('session/release',{binding});release();assert.equal((await pending).status,400)
})
