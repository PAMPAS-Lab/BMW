import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import test from 'node:test'
import product from '../../../apps/bmw/product.js'
import { BrowserCapabilityRegistry } from '../src/browser-capability-registry.js'
import { createBridgeServer } from '../src/bridge-server.js'
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
test('managed provider registration resolves only an attached live Host lease and keeps the canonical BMW owner', async t => {
  const owners:unknown[]=[]
  const bridge=await createBridgeServer({async execute(_input,options){owners.push(options?.sessionOwner);return {ok:true}}},{resolveProject:directory=>directory==='/project'?{id:'p',directory}:undefined,activeProjectId:()=> 'p'})
  t.after(()=>bridge.close())
  const headers={authorization:'Bearer '+bridge.token,'content-type':'application/json'}
  const register=(sessionId:string,driverId='dsh')=>fetch(bridge.url+'/session/register',{method:'POST',headers,body:JSON.stringify({sessionId,driverId,directory:'/project'})})
  assert.equal((await register('native')).status,400)
  const binding=bridge.registerSession('stable-bmw','/project');bridge.attachProviderSession(binding,'dsh','native')
  assert.equal((await register('native','qoder-cn')).status,400)
  const response=await register('native');assert.equal(response.status,200);assert.equal((await response.json()).binding,binding)
  await fetch(bridge.url+'/execute',{method:'POST',headers,body:JSON.stringify({binding,arguments:{action:'status'}})})
  assert.deepEqual(owners,[{projectId:'p',sessionId:'stable-bmw'}])
  await bridge.releaseSession(binding);assert.equal((await register('native')).status,400)
})
test('Session lease revocation aborts its work but awaits actual cleanup before returning', { timeout: 5000 }, async t => {
  const started = deferred<void>(), aborted = deferred<void>(), cleanup = deferred<void>()
  const bridge = await createBridgeServer({ async execute(_input, { signal, sessionOwner } = {}) {
    assert.deepEqual(sessionOwner, { projectId: 'project', sessionId: 'bmw-session' })
    signal!.addEventListener('abort', () => aborted.resolve(), { once: true })
    started.resolve(); await cleanup.promise
    return {}
  } }, { resolveProject: directory => ({ id: 'project', directory }), activeProjectId: () => 'project' })
  t.after(() => bridge.close())
  const binding = bridge.registerSession('bmw-session', '/disposable-project')
  const headers = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }
  const call = fetch(bridge.url + '/execute', { method: 'POST', headers, body: JSON.stringify({ binding, arguments: { action: 'wait' } }) })
  await started.promise
  let released = false
  const release = bridge.releaseSession(binding).then(() => { released = true })
  await aborted.promise
  assert.equal(released, false); assert.equal(bridge.busy, true)
  const stale = await fetch(bridge.url + '/session/context', { method: 'POST', headers, body: JSON.stringify({ binding }) })
  assert.equal(stale.status, 400)
  cleanup.resolve(); await release
  assert.equal((await call).status, 400); assert.equal(bridge.busy, false)
})
test('Qoder/Codex MCP receives host scope from its private environment and rejects model scope substitution', { timeout: 5000 }, async t => {
  const owners: unknown[] = []
  const bridge = await createBridgeServer({ async execute(_input, options) { owners.push(options?.sessionOwner); return { title: 'scope verified' } } }, {
    toolDefinition: new BrowserCapabilityRegistry(product).toolDefinition(), resolveProject: directory => ({ id: 'project', directory }), activeProjectId: () => 'project'
  })
  t.after(() => bridge.close())
  const binding = bridge.registerSession('host-session', '/disposable-project')
  const child = spawn(process.execPath, [path.resolve('packages/browser-capability/src/browser-mcp-server.js')], { env: { ...process.env, BMW_BRIDGE_URL: bridge.url, BMW_BRIDGE_TOKEN: bridge.token, BMW_SESSION_BINDING: binding }, stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  const responses = new Map<number, (value: { result?: { content: unknown[] }; error?: { message: string } }) => void>()
  const lines = readline.createInterface({ input: child.stdout })
  lines.on('line', line => { const response = JSON.parse(line); responses.get(response.id)?.(response) })
  let counter = 0
  const call = (argumentsValue: unknown) => new Promise<{ result?: { content: unknown[] }; error?: { message: string } }>(resolve => {
    const id = ++counter; responses.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'browser', arguments: argumentsValue } }) + '\n')
  })
  assert.ok((await call({ action: 'status' })).result)
  assert.deepEqual(owners, [{ projectId: 'project', sessionId: 'host-session' }])
  assert.match((await call({ action: 'status', __bmwSession: 'injected' })).error!.message, /owned by the host/)
  assert.equal(owners.length, 1)
  await bridge.releaseSession(binding)
  assert.match((await call({ action: 'status' })).error!.message, /has ended/)
})
