import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { codexModelTools, codexThreadParameters, codexProtocolVersion } from '../src/codex-policy.js'
import {codexBrowserModelCatalog,materializeCodexBrowserCatalog} from '../src/codex-model-catalog.js'
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
test('Codex browser thread excludes environments, shell, MCP helpers and question tools before user input', () => {
  const params = codexThreadParameters('/disposable/project', 'gpt-5.5', { name: 'browser', description: 'BMW', inputSchema: { type: 'object' } }, 'context')
  assert.deepEqual(params.environments, [])
  const config = params.config as { features: Record<string, boolean>; tools: { experimental_request_user_input: { enabled: boolean } }; mcp_servers: unknown }
  assert.equal(config.features.shell_tool, false)
  assert.equal(config.features.multi_agent, false)
  assert.equal(config.tools.experimental_request_user_input.enabled, false)
  assert.deepEqual(config.mcp_servers, {})
})

function officialCatalog(){return {client_version:'0.160.0',identity:{account:'private-account'},models:[
  ...['gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna'].map(slug=>({slug,tool_mode:'code_mode_only',multi_agent_version:'v2',multi_agent_reasoning_effort:'high',experimental_supported_tools:['clock','send_user_message_async'],use_responses_lite:true,context_window:400000,supported_reasoning_levels:[{effort:'high',description:'Native reasoning'}],input_modalities:['text','image'],model_messages:{instructions:'Native instructions'}})),
  {slug:'gpt-5.5',tool_mode:null,use_responses_lite:false},
  {slug:'gpt-6-future',tool_mode:'code_mode_only',experimental_supported_tools:['clock']}
]}}
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
