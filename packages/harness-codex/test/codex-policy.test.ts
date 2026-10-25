import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { codexModelTools, codexThreadParameters, codexProtocolVersion, codexDisabledMcpServers } from '../src/codex-policy.js'
import type {CodexRpc} from '../src/codex-rpc.js'
import {codexBrowserModelCatalog,materializeCodexBrowserCatalog,refreshCodexBrowserCatalog,CodexCatalogRefreshCache} from '../src/codex-model-catalog.js'
test('Codex protocol admits verified patch versions and reports detected and supported versions',()=>{
  for(const version of ['0.160.0','0.160.1']){
    assert.equal(codexProtocolVersion('codex-cli '+version),version)
    assert.doesNotThrow(()=>codexBrowserModelCatalog({...officialCatalog(),client_version:version},'gpt-6.1-sol'))
  }
  for(const version of ['0.160.2','0.161.0','0.159.0','0.160.1-dev']){
    assert.throws(()=>codexProtocolVersion('codex-cli '+version),error=>error instanceof Error&&error.message.includes(version)&&error.message.includes('0.160.0、0.160.1'))
    assert.throws(()=>codexBrowserModelCatalog({...officialCatalog(),client_version:version},'gpt-6.1-sol'),/catalog/)
  }
  assert.throws(()=>codexProtocolVersion('other-cli 0.160.1'),/other-cli/)
})
test('Codex effective catalog reads Responses and Responses Lite additional_tools, including hidden extra namespaces', () => {
  assert.deepEqual(codexModelTools({ tools: [{ type: 'function', name: 'browser' }] }).map(row => row.name), ['browser'])
  const lite = { input: [{ type: 'message', content: [{ text: 'Only browser is allowed' }] }, { type: 'additional_tools', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'exec' }] }, { type: 'namespace', name: 'collaboration', tools: [{ type: 'function', name: 'spawn_agent' }] }] }] }
  assert.deepEqual(codexModelTools(lite).map(row => row.name), ['exec', 'spawn_agent'])
  assert.deepEqual(codexModelTools({ ...lite, tools: [{ type: 'function', name: 'browser' }] }).map(row => row.name), ['browser', 'exec', 'spawn_agent'])
  assert.throws(() => codexModelTools({ input: [{ type: 'additional_tools', tools: 'browser' }] }), /Invalid/)
})
test('Codex accepts a newer shared official model cache without admitting its CLI protocol or extra tools',()=>{
  const source={...officialCatalog(),client_version:'0.164.0'},before=structuredClone(source)
  const projected=codexBrowserModelCatalog(source,'gpt-6.1-sol')
  assert.deepEqual(source,before)
  assert.equal(projected.models[0].slug,'gpt-6.1-sol')
  assert.equal(projected.models[0].use_responses_lite,true)
  assert.equal(projected.models[0].tool_mode,undefined)
  assert.equal(projected.models[0].multi_agent_version,undefined)
  assert.deepEqual(projected.models[0].experimental_supported_tools,[])
  assert.throws(()=>codexProtocolVersion('codex-cli 0.164.0'),/0.164.0/)
  assert.throws(()=>codexBrowserModelCatalog({...source,client_version:'0.164.1'},'gpt-6.1-sol'),/0.164.1/)
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-codex-shared-cache-'))
  try{
    const bytes=JSON.stringify(source),file=path.join(root,'models_cache.json')
    fs.writeFileSync(file,bytes)
    const catalog=materializeCodexBrowserCatalog(root,'gpt-6.1-sol')
    assert.ok(catalog);assert.equal(fs.readFileSync(file,'utf8'),bytes)
    assert.deepEqual(JSON.parse(fs.readFileSync(catalog,'utf8')),projected)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('Codex reads the selected official CLI catalog without trusting or overwriting a foreign shared cache',async()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-codex-native-catalog-')))
  try{
    const cache=path.join(root,'models_cache.json'),stale='{"client_version":"0.153.4","models":[]}'
    fs.writeFileSync(cache,stale)
    const executable=path.join(root,'official-fixture.cts'),native=officialCatalog()
    fs.writeFileSync(executable,'#!'+process.execPath+'\nif(JSON.stringify(process.argv.slice(2))!==\'['+JSON.stringify('debug')+','+JSON.stringify('models')+']\'||process.env.CODEX_HOME!==process.cwd())process.exit(2);process.stdout.write('+JSON.stringify(JSON.stringify({models:native.models}))+');\n',{mode:0o700})
    const file=await refreshCodexBrowserCatalog(executable,root,'gpt-6.1-sol','0.160.1',new AbortController().signal)
    assert.ok(file)
    const projected=JSON.parse(fs.readFileSync(file,'utf8')) as {models:Record<string,unknown>[]}
    assert.equal(projected.models[0].slug,'gpt-6.1-sol');assert.equal(projected.models[0].use_responses_lite,true)
    assert.equal(projected.models[0].tool_mode,undefined);assert.deepEqual(projected.models[0].experimental_supported_tools,[])
    assert.equal(fs.readFileSync(cache,'utf8'),stale)
    await assert.rejects(refreshCodexBrowserCatalog(executable,root,'gpt-6.1-sol','0.153.4',new AbortController().signal),/Unverified/)
    fs.writeFileSync(executable,'#!'+process.execPath+'\nprocess.stdout.write(\'{"models":[]}\');\n',{mode:0o700})
    await assert.rejects(refreshCodexBrowserCatalog(executable,root,'gpt-6.1-sol','0.160.1',new AbortController().signal),/catalog/)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('Codex browser thread excludes environments, shell, MCP helpers and question tools before user input', () => {
  const params = codexThreadParameters('/disposable/project', 'gpt-5.5', { name: 'browser', description: 'BMW', inputSchema: { type: 'object' } }, 'context')
  assert.deepEqual(params.environments, [])
  const config = params.config as { features: Record<string, boolean>; tools: { experimental_request_user_input: { enabled: boolean } }; mcp_servers: unknown }
  assert.equal(config.features.shell_tool, false)
  assert.equal(config.features.multi_agent, false)
  assert.equal(config.tools.experimental_request_user_input.enabled, false)
  assert.deepEqual(config.mcp_servers, {})
})
test('Codex disables inherited MCP entries without carrying their commands or credentials into thread overrides',async()=>{
  const source={config:{mcp_servers:{node:{command:'foreign',env:{SECRET:'private'}},computer:{url:'https://invalid.test',enabled:true}}}},before=structuredClone(source)
  const rpc={async call(method:string,params:unknown){assert.equal(method,'config/read');assert.deepEqual(params,{includeLayers:false});return source}} as Pick<CodexRpc,'call'>
  const disabled=await codexDisabledMcpServers(rpc)
  assert.deepEqual(disabled,{node:{enabled:false},computer:{enabled:false}});assert.deepEqual(source,before)
  const params=codexThreadParameters('/disposable/project','gpt-6.1-sol',{name:'browser',description:'BMW',inputSchema:{type:'object'}},'',disabled)
  assert.deepEqual((params.config as {mcp_servers:unknown}).mcp_servers,disabled)
  assert.ok(!JSON.stringify(params).includes('private'));assert.ok(!JSON.stringify(params).includes('foreign'))
  await assert.rejects(codexDisabledMcpServers({async call(){return {config:{mcp_servers:[]}}}}),/Invalid Agent value/)
})

test('Codex discovery instructions derive action names from the admitted browser catalog and survive resume parameters',()=>{
  const definition={name:'browser' as const,description:'Catalog',inputSchema:{type:'object',properties:{action:{type:'string',enum:['status','help','observe','media.video.capture']}}}}
  const params=codexThreadParameters('/disposable/project','gpt-6.1-sol',definition,'Fresh Project context')
  assert.match(String(params.developerInstructions),/status, help, observe, media.video.capture/)
  assert.match(String(params.developerInstructions),/"action":"help","forAction":"EXACT_ACTION"/)
  assert.match(String(params.developerInstructions),/unknown fields are rejected before execution/)
  assert.match(String(params.developerInstructions),/limit stop is partial/)
  delete params.dynamicTools
  assert.match(String(params.developerInstructions),/Fresh Project context/)
  assert.ok(!String(codexThreadParameters('/disposable/project','gpt-6.1-sol',{...definition,inputSchema:{properties:{action:{enum:['status']}}}},'').developerInstructions).includes('"action":"help"'))
})

function officialCatalog(){return {client_version:'0.160.0',identity:{account:'private-account'},models:[
  ...['gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna'].map(slug=>({slug,tool_mode:'code_mode_only',multi_agent_version:'v2',multi_agent_reasoning_effort:'high',experimental_supported_tools:['clock','send_user_message_async'],use_responses_lite:true,context_window:400000,supported_reasoning_levels:[{effort:'high',description:'Native reasoning'}],input_modalities:['text','image'],model_messages:{instructions:'Native instructions'}})),
  {slug:'gpt-5.5',tool_mode:null,use_responses_lite:false},
  {slug:'gpt-6-future',tool_mode:'code_mode_only',experimental_supported_tools:['clock']}
]}}

test('Codex raw catalog cache avoids repeated refresh but rechecks fingerprints, projection integrity, expiry and cancellation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-catalog-cache-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 let clock=0,refreshes=0;const cache=new CodexCatalogRefreshCache(()=>clock,100),signal=new AbortController().signal,file=path.join(root,'projected.json')
 const refresh=async()=>{refreshes++;fs.writeFileSync(file,'verified-'+refreshes);return file}
 assert.equal(await cache.get('cli-config-model',refresh,signal),file)
 await cache.get('cli-config-model',refresh,signal);assert.equal(refreshes,1)
 fs.writeFileSync(file,'tampered');await cache.get('cli-config-model',refresh,signal);assert.equal(refreshes,2)
 await cache.get('changed-cli-config-model',refresh,signal);assert.equal(refreshes,3)
 clock=101;await cache.get('changed-cli-config-model',refresh,signal);assert.equal(refreshes,4)
 cache.clear();await cache.get('changed-cli-config-model',refresh,signal);assert.equal(refreshes,5)
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(cache.get('changed-cli-config-model',refresh,cancelled.signal));assert.equal(refreshes,5)
})
test('GPT-6 startup catalog changes only tool metadata and preserves native model capabilities and transport',()=>{
  const source=officialCatalog(),before=structuredClone(source),projected=codexBrowserModelCatalog(source,'gpt-6.1-sol')
  assert.deepEqual(source,before);assert.deepEqual(Object.keys(projected),['models'])
  for(let i=0;i<4;i++){
    const expected:Record<string,unknown>={...source.models[i],experimental_supported_tools:[]}
    delete expected.tool_mode;delete expected.multi_agent_version;delete expected.multi_agent_reasoning_effort
    assert.deepEqual(projected.models[i],expected)
  }
  assert.deepEqual(projected.models.slice(4),source.models.slice(4))
  for(const value of [{...source,client_version:'future'},{...source,models:[]},{...source,models:[...source.models,source.models[0]]},{...source,models:[{}]}])assert.throws(()=>codexBrowserModelCatalog(value,'gpt-6.1-sol'),/catalog/)
  assert.throws(()=>codexBrowserModelCatalog(source,'absent'),/absent/)
})
test('GPT-6 host catalog is immutable, content addressed and private without modifying the official model cache',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-codex-catalog-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const source=JSON.stringify(officialCatalog()),cache=path.join(root,'models_cache.json');fs.writeFileSync(cache,source)
  const file=materializeCodexBrowserCatalog(root,'gpt-6.1-sol');assert.ok(file)
  assert.equal(materializeCodexBrowserCatalog(root,'gpt-6-luna'),file);assert.equal(fs.readFileSync(cache,'utf8'),source)
  assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700)
  assert.equal(materializeCodexBrowserCatalog(root,'gpt-5.5'),undefined)
  fs.writeFileSync(file,'tampered');assert.throws(()=>materializeCodexBrowserCatalog(root,'gpt-6.1-sol'),/changed after publication/)
  fs.unlinkSync(file);fs.symlinkSync(cache,file);assert.throws(()=>materializeCodexBrowserCatalog(root,'gpt-6.1-sol'),/changed after publication/)
  fs.unlinkSync(cache);fs.symlinkSync(file,cache);assert.throws(()=>materializeCodexBrowserCatalog(root,'gpt-6.1-sol'),/official model catalog/)
})
