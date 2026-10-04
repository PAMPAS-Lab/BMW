import { dshConfiguration } from '../packages/harness-dsh/index.js'
import {BrowserFailureGuard} from '../packages/harness-dsh/dsh/plugins/browser-mcp/failure-guard.js'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {appendWorkspaceContext} from '../packages/harness-dsh/dsh/plugins/browser-mcp/workspace-context.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DshRuntime, DshHarnessPort } from '../packages/harness-dsh/index.js'
import product from '../apps/bmw/product.js'
import { createBridgeServer } from '../packages/browser-capability/src/bridge-server.js'
import { BrowserCapabilityRegistry } from '../packages/browser-capability/src/browser-capability-registry.js'

const root = path.resolve(import.meta.dirname, '..')
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-dsh-compatibility-')))
const products = [{ ...product, ...dshConfiguration }]
try {
  // Exercise the installed official assembly and its model/log snapshot renderer.
  const requireDsh=createRequire(fs.realpathSync(execFileSync('which',['dsh'],{encoding:'utf8'}).trim()))
  const {Context}=await import(requireDsh.resolve('@deepseek-ai/cordis'))
  const {SystemPrompt,renderContextSnapshot}=await import(requireDsh.resolve('@deepseek-ai/dsh-system-prompt'))
  const ctx=new Context(),prompt=new SystemPrompt(ctx,{includeRuntimeContext:true})
  prompt.section({name:'bmw-test-persona',order:0,complete:true,text:'BMW sole browser boundary'})
  ctx.on('system-prompt/assemble',async(_assembly:unknown,_context:unknown,next:()=>Promise<import('../packages/harness-dsh/dsh/plugins/browser-mcp/workspace-context.js').PromptAssembly>)=>appendWorkspaceContext(await next(),'Current draft fixture, selected scene 2, revision 7'))
  const assembly=await prompt.assemble();assert.deepEqual(assembly.sections,[{name:'bmw-test-persona',text:'BMW sole browser boundary'}]);assert.match(renderContextSnapshot(assembly),/selected scene 2, revision 7/)
  assert.match(fs.readFileSync(path.join(root,'packages/harness-dsh/dsh/preset/base/agent.cordis.yml'),'utf8'),/includeRuntimeContext: true/)
  const guard = new BrowserFailureGuard(), guardSession = {}
  const stopGuard = ctx.on('system-prompt/assemble', async (_assembly: unknown, _context: unknown, next: () => Promise<unknown>) => { guard.assertAvailable(guardSession); return next() })
  for(let i=0;i<3;i++)guard.observe(guardSession,new Error('BMW_BROWSER_TIMEOUT: media.screenshot/selector-layout'))
  await assert.rejects(prompt.assemble(), /BMW_BROWSER_UNAVAILABLE/)
  guard.reset(guardSession)
  await prompt.assemble()
  stopGuard()
  console.log('PASS installed official DSH assembly failure guard rejects after three infrastructure errors and resets for new turn')
  console.log('PASS installed official DSH assembly: complete BMW persona retains Studio data in model/log runtime snapshot')
  for (const product of products) {
    const workspace = path.join(temporary, product.id, 'workspace')
    fs.mkdirSync(workspace, { recursive: true })
    const bridge = await createBridgeServer({ async execute() { return {} } }, { toolDefinition: new BrowserCapabilityRegistry(product).toolDefinition(), resolveProject: (directory) => directory === workspace ? { id: 'smoke', directory } : undefined, activeProjectId: () => 'smoke' })
    const runtime = new DshRuntime({ ...product, productId: product.id, presetId: product.id,
      dshHome: path.join(temporary, product.id, 'home'), sourceDshHome: path.join(temporary, 'empty-source-home'),
      workspacePath: workspace, workspaceTitle: 'Compatibility smoke',
      mcpServerPath: path.join(root, 'packages/browser-capability/src/browser-mcp-server.js'),
      bridgeUrl: bridge.url, bridgeToken: bridge.token,
      onLog: ({ text }: { text: string }) => process.stderr.write(text) })
    try {
      const url = await runtime.start()
      assert.ok(new URL(url).searchParams.get('token'))
      const project = { directory: workspace, name: 'Compatibility smoke' }
      const active = await runtime.activateWorkspace(project)
      const sessionId = active.sessionId
      assert.ok(sessionId)
      const port=new DshHarnessPort(runtime)
      const normalized=await port.listProjectSessions({...project,id:'smoke',workspaceId:String(active.workspace.workspaceId),sessionId:String(sessionId)})
      assert.equal(normalized.selectedSessionId,sessionId)
      assert.equal(normalized.items[0].sessionId,sessionId)
      assert.equal((await port.health()).ready,true)
      assert.equal((await runtime.activateWorkspace(project)).sessionId, sessionId)
      await runtime.call('session.rename', { sessionId, title: 'Smoke renamed' })
      const list = await runtime.listProjectSessions(project, 'Smoke')
      assert.equal(list.items[0].title, 'Smoke renamed')
      const history = await runtime.call('session.history', { sessionId })
      assert.ok(Array.isArray(history.events))
      await assert.rejects(runtime.call('session.fork', { sessionId }), /no completed turn/)
      const fork = await runtime.createProjectSession(project)
      assert.ok(fork.sessionId)
      await runtime.call('session.cancel', { sessionId })
      await runtime.call('workspace.archiveSession', { sessionId: fork.sessionId })
      assert.equal((await runtime.listProjectSessions(project)).items.some((item) => item.sessionId === fork.sessionId), false)
      console.log(`PASS ${product.id}: authenticated startup, preset, session reuse/rename/search/history/empty-fork guard/cancel/archive`)
    } finally { runtime.stop(); await bridge.close() }
  }
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
