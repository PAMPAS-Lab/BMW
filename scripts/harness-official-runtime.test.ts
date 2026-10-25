import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {query,qodercliAuth} from '@qodercn-ai/qodercn-agent-sdk'
import type {SDKUserMessage} from '@qodercn-ai/qodercn-agent-sdk'
import product from '../apps/bmw/product.js'
import {BrowserCapabilityRegistry} from '../packages/browser-capability/src/browser-capability-registry.js'
import {createBridgeServer} from '../packages/browser-capability/src/bridge-server.js'
import {CodexCatalogGate} from '../packages/harness-codex/src/codex-policy.js'
import {bundledCodexExecutable} from '../packages/harness-codex/src/codex-installation.js'
import {qoderBrowserCatalog} from '../packages/harness-qoder/src/qoder-events.js'
import {agentRecord} from '../packages/agent-contract/index.js'

test('Pinned official Codex verifies only browser against a local rejecting sink before any real input', {timeout:180000},async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-official-codex-')))
 try{
  const cli=bundledCodexExecutable();assert.ok(cli)
  fs.writeFileSync(path.join(root,'config.toml'),'[mcp_servers.foreign]\ncommand="/nonexistent/bmw-disposable-fixture"\n')
  const definition=new BrowserCapabilityRegistry(product).toolDefinition(),gate=new CodexCatalogGate()
  for(const model of ['gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna','gpt-5.5'])await gate.verify(cli,root,model,definition,AbortSignal.timeout(40000))
  console.log('PASS Codex 0.164.0: actual catalog capture, five supported models; local 503 sink, no paid inference or production profile')
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('Pinned official Qoder SDK/Worker refuses a missing cold login before releasing input and drains cleanup', {timeout:60000},async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-official-qoder-'))),workspace=path.join(root,'workspace');fs.mkdirSync(workspace)
 let executions=0,release!:()=>void
 const bridge=await createBridgeServer({async execute(){executions++;throw new Error('No input was authorized in this cold catalog fixture')}},{toolDefinition:new BrowserCapabilityRegistry(product).toolDefinition(),resolveProject:directory=>directory===workspace?{id:'fixture',directory}:undefined,activeProjectId:()=> 'fixture'})
 const controller=new AbortController(),held=new Promise<void>(resolve=>{release=resolve})
 async function* prompt():AsyncIterable<SDKUserMessage>{await held}
 const native=query({prompt:prompt(),options:{cwd:workspace,auth:qodercliAuth(),env:{QODERCN_CONFIG_DIR:path.join(root,'profile'),ELECTRON_RUN_AS_NODE:'1'},abortController:controller,tools:[],allowedTools:['browser'],skills:[],plugins:[],settingSources:[],strictMcpConfig:true,persistSession:false,includePartialMessages:false,controlRequestTimeoutMs:15000,stderr:()=>{},mcpServers:{bmw:{type:'stdio',command:process.execPath,args:[path.resolve('packages/browser-capability/src/browser-mcp-server.js')],env:{BMW_BRIDGE_URL:bridge.url,BMW_BRIDGE_TOKEN:bridge.token,BMW_CATALOG_ONLY:'1',ELECTRON_RUN_AS_NODE:'1'},tools:[{name:'browser',exposedName:'browser',permission_policy:'always_allow',alwaysLoad:true}]}},canUseTool:async()=>({behavior:'deny',interrupt:true,message:'No fixture input is released'})}})
 const timer=setTimeout(()=>{controller.abort();release()},30000)
 try{
  let initialized=false;const observed:string[]=[]
  for await(const raw of native){const value=agentRecord(raw);observed.push(JSON.stringify({type:value.type,subtype:value.subtype,errors:value.errors}));if(value.type==='system'&&value.subtype==='init'){const catalog=qoderBrowserCatalog(value);assert.equal(catalog.runtimeVersion,'1.1.78');initialized=true;controller.abort();release();break}assert.ok(!['assistant','stream_event','user'].includes(String(value.type)),'Cold probe cannot release model work')}
  assert.equal(initialized,false,'A credential-free cold fixture must not become authenticated');assert.match(observed.join('\n'),/No qodercli login found/);assert.equal(executions,0)
  console.log('PASS Qoder SDK1.0.56 / Worker1.1.78: missing cold login refused, held input and cleanup; actual authenticated init catalog and paid service not covered')
 }finally{clearTimeout(timer);controller.abort();release();await native.close();await bridge.close();fs.rmSync(root,{recursive:true,force:true})}
})
