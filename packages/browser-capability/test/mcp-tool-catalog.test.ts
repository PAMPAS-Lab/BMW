import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import crypto from 'node:crypto'
import {Ajv} from 'ajv'
import {compactToolSchema} from '../src/tool-schema-compaction.js'
import product from '../../../apps/bmw/product.js'
import { BrowserCapabilityRegistry } from '../src/browser-capability-registry.js'
import { browserToolCatalog } from '../src/tool-catalog.js'
import { createBridgeServer } from '../src/bridge-server.js'
import {assertStudioRequest} from '../../feature-video/src/studio-contract.js'

test('BMW MCP discovers exactly browser from the authenticated product catalog', async (t) => {
  const registry = new BrowserCapabilityRegistry(product)
  const definition = registry.toolDefinition()
  const bridge = await createBridgeServer({ async execute() { throw new Error('Catalog test cannot execute actions') } }, { toolDefinition: definition })
  t.after(() => bridge.close())
  assert.equal((await fetch(`${bridge.url}/tool`)).status, 401)
  const child = spawn(process.execPath, [path.resolve('packages/browser-capability/src/browser-mcp-server.js')], {
    env: { ...process.env, BMW_BRIDGE_URL: bridge.url, BMW_BRIDGE_TOKEN: bridge.token, BMW_SESSION_BINDING:'', BMW_CATALOG_ONLY:'1' }, stdio: ['pipe','pipe','pipe']
  })
  t.after(() => { child.kill() })
  // MCP messages are newline-delimited, not aligned to stdout chunks. The
  // effective catalog can cross pipe buffers and UTF-8 characters can be split.
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  t.after(() => lines.close())
  function response<T>(): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('MCP response deadline exceeded')), 10000)
      const closed = () => finish(new Error('MCP exited before a complete response'))
      const failed = (error: Error) => finish(error)
      const received = (line: string) => {
        try { finish(undefined, JSON.parse(line) as T) } catch (error) { finish(error as Error) }
      }
      function finish(error?: Error, result?: T) {
        clearTimeout(timeout)
        lines.off('line', received)
        lines.off('close', closed)
        child.off('error', failed)
        if (error) reject(error)
        else resolve(result as T)
      }
      lines.once('line', received)
      lines.once('close', closed)
      child.once('error', failed)
    })
  }
  const discovery = response<{ jsonrpc: string; id: number; result: { tools: unknown[] } }>()
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n')
  const result = await discovery
  assert.equal(result.jsonrpc, '2.0')
  assert.equal(result.id, 1)
  assert.deepEqual(result.result.tools, [definition])
  const denied = response<{ jsonrpc: string; id: number; error: { message: string } }>()
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'browser',arguments:{action:'status'}}})+'\n')
  const denial = await denied
  assert.equal(denial.jsonrpc, '2.0')
  assert.equal(denial.id, 2)
  assert.match(denial.error.message,/catalog-only connection cannot execute/)
  lines.close()
  assert.equal(registry.allowedActions.some((action) => action.startsWith('connector.')), false)
  assert.equal(product.featureIds.includes('feature-video'), true)
  assert.equal(registry.allowedActions.includes('experiment.plan.propose'), false)
  for(const name of ['media.image.inspect','media.image.annotate','media.image.draw'])assert.ok(registry.allowedActions.includes(name))
  const shapes=definition.inputSchema.properties.shapes
  assert.equal(shapes.maxItems,128)
  assert.equal(Object.hasOwn(definition.inputSchema.properties,'svg'),false)
  assert.match(definition.description,/media\.image\.annotate/)
})


test('MCP catalog admission rejects extra tools and malformed action boundaries', () => {
  const tool = new BrowserCapabilityRegistry(product).toolDefinition()
  assert.deepEqual(browserToolCatalog(tool), tool)
  assert.throws(() => browserToolCatalog({ ...tool, name: 'shell' }), /exactly browser/)
  assert.throws(() => browserToolCatalog({ ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: true } }), /input schema/)
  assert.throws(() => browserToolCatalog({ ...tool, inputSchema: { ...tool.inputSchema, properties: { action: { type: 'string', enum: [7] } } } }), /action enum/)
})

test('Authenticated browser help describes contributed and core actions without a second tool or permissive aliases',()=>{
  const registry=new BrowserCapabilityRegistry(product)
  const index=registry.help() as {tool:string;actions:{action:string}[]}
  assert.equal(index.tool,'browser');assert.deepEqual(index.actions.map(row=>row.action),registry.allowedActions)
  for(const action of ['observe','media.video.capture','video.studio']){
    const help=registry.help(action) as {action:string;inputSchema:{properties:Record<string,unknown>;required:string[];additionalProperties:boolean}}
    assert.equal(help.action,action);assert.equal(help.inputSchema.additionalProperties,false);assert.ok(help.inputSchema.required.includes('action'));assert.deepEqual(Object.keys(help.inputSchema.properties),['action',...Object.keys(registry.definition(action)!.inputSchema.properties)])
  }
  assert.throws(()=>registry.help('page.read'),/supportedActions/)
  assert.throws(()=>registry.assertRequest({action:'video.studio',operation:'assets'}),/acceptedFields/)
  assert.match(registry.toolDefinition().description,/"action":"help"/)
})

test('Published browser schema separates canvas drawing, annotation and Studio arguments by action', () => {
  const registry=new BrowserCapabilityRegistry(product),schema=registry.inputSchema()
  const validate=new Ajv({strict:false}).compile(schema)
  const shapes=[{type:'text',x:20,y:20,text:'Diagram',color:'#172536'}]
  for(const input of [
    {action:'status'},
    {action:'media.image.draw',width:320,height:180,shapes},
    {action:'media.image.annotate',artifactId:'existing.png',shapes},
    {action:'video.studio',studioRequest:{operation:'narrate-pending',draftId:'draft',expectedRevision:2}}
  ])assert.equal(validate(input),true,JSON.stringify(validate.errors))
  for(const input of [
    {action:'media.image.draw',artifactId:'existing.png',shapes},
    {action:'media.image.draw',width:320,height:180,filename:'overwrite.png',shapes},
    {action:'media.image.draw',width:320,shapes},
    {action:'media.image.annotate',width:320,height:180,shapes},
    {action:'media.image.annotate',artifactId:'existing.png',width:320,shapes},
    {action:'status',artifactId:'existing.png'},
    {action:'video.studio',operation:'narrate-pending',draftId:'draft',expectedRevision:'2'},
    {action:'video.studio',studioRequest:{operation:'narrate-pending',draftId:'draft',expectedRevision:'2'}}
  ])assert.equal(validate(input),false,JSON.stringify(input))
  const branches=schema.oneOf as {description:string;properties:{action:{const:string}}}[]
  assert.deepEqual(branches.map(branch=>branch.properties.action.const),registry.allowedActions)
  assert.match(branches.find(branch=>branch.properties.action.const==='media.image.draw')!.description,/Requires width\/height/)
  assert.match(registry.toolDefinition().description,/do not pass artifactId or filename/)
})

test('Studio operation and source suboperation discovery stays bounded and recovers opaque source enums without human contracts',()=>{
 const registry=new BrowserCapabilityRegistry(product),root=registry.help('video.studio') as {operations:string[]}
 assert.ok(JSON.stringify(root).length<6000);assert.ok(root.operations.includes('source'))
 for(const op of root.operations)assert.ok(JSON.stringify(registry.help('video.studio',{forOperation:op})).length<10000,op)
 const news=registry.help('video.studio',{forOperation:'propose-news-topics'}) as {inputSchema:unknown;omittedFields?:string[]}
 assert.ok(!news.omittedFields?.includes('newsCandidates'));assert.ok(JSON.stringify(news).length<10000)
 const newsSchema=JSON.stringify(news.inputSchema);for(const field of ['subjectKind','recordedAt','quoteStart','previewArtifactId','missing'])assert.ok(newsSchema.includes(field),field)
 const newsValidate=new Ajv({strict:false}).compile(news.inputSchema),candidate={id:'topic',eventKey:'event',subject:'机构',subjectKind:'organization',category:'academic',region:'CN',title:'研究',news:'变化',reason:'原因',angle:'角度',format:'speech',novelty:'new-release',recordedAt:null,missing:'',sourceId:'source',acquisitionId:'acq',quote:'原句',quoteStart:0,previewArtifactId:'clip.webm',mode:'video'},ten=Array.from({length:10},(_,n)=>({...candidate,id:'topic-'+n,eventKey:'event-'+n,acquisitionId:'acq-'+n}));assert.equal(newsValidate({action:'video.studio',studioRequest:{operation:'propose-news-topics',expectedTopicRevision:0,newsCandidates:ten}}),true);assert.equal(newsValidate({action:'video.studio',studioRequest:{operation:'propose-news-topics',expectedTopicRevision:0,newsCandidates:[...ten,candidate]}}),false);assert.equal(newsValidate({action:'video.studio',studioRequest:{operation:'propose-news-topics',expectedTopicRevision:0,newsCandidates:[{...candidate,missing:[]}]}}),false)
 const capture={operation:'source',sourceRequest:{operation:'acquire',expectedRevision:0,sourceId:'source',acquisitionId:'acq',candidateId:'candidate',method:'capture',videoSelector:'video',fromStart:false}}
 assert.equal(assertStudioRequest(capture).sourceRequest?.operation,'acquire');assert.throws(()=>assertStudioRequest({...capture,sourceRequest:{...capture.sourceRequest,fromStart:'false'}}),/boolean/);assert.throws(()=>assertStudioRequest({...capture,sourceRequest:{...capture.sourceRequest,method:'download'}}),/Capture options/)
 const help=registry.help('video.studio',{forOperation:'source',forSubOperation:'collect'}) as {inputSchema:unknown}
 const validate=new Ajv({strict:false}).compile(help.inputSchema)
 assert.equal(validate({action:'video.studio',studioRequest:{operation:'source',sourceRequest:{operation:'collect',expectedRevision:0,bodySelector:'article'}}}),true)
 assert.equal(validate({action:'video.studio',studioRequest:{operation:'source',sourceRequest:{operation:'collect',expectedRevision:0,bodySelector:'article',method:'capture'}}}),false)
 assert.throws(()=>assertStudioRequest({operation:'source',sourceRequest:{operation:'capture'}}),error=>{const e=JSON.parse((error as Error).message) as {executed:boolean;supportedSubOperations:string[];recovery:Record<string,string>};assert.equal(e.executed,false);assert.ok(e.supportedSubOperations.includes('acquire'));assert.deepEqual(e.recovery,{action:'help',forAction:'video.studio',forOperation:'source'});return true})
 assert.throws(()=>assertStudioRequest({operation:'source',sourceRequest:{operation:'list',url:'https://example.com'}}),/acceptedFields/)
 assert.throws(()=>registry.help('video.studio',{forOperation:'source',forSubOperation:'capture'}),/supportedSubOperations/)
 assert.deepEqual(registry.toolDefinition().name,'browser')
})

test('Source-frame model image admission rechecks the native PNG hash after service completion',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-source-image-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'artifacts'))
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),file=path.join(root,'artifacts','tail.png'),sha256=crypto.createHash('sha256').update(png).digest('hex');await fs.writeFile(file,png)
 let tamper=false
 const registry=new BrowserCapabilityRegistry(product),bridge=await createBridgeServer({async execute(){if(tamper)await fs.appendFile(file,'changed');return {frames:[{artifactId:'tail.png',path:file,type:'screenshot',sha256}]}}},{toolDefinition:registry.toolDefinition(),resolveProject:()=>({id:'source-project',directory:root}),activeProjectId:()=> 'source-project'})
 t.after(()=>bridge.close());const binding=bridge.registerSession('source-session',root),invoke=async()=>{const response=await fetch(bridge.url+'/execute',{method:'POST',headers:{authorization:'Bearer '+bridge.token,'content-type':'application/json'},body:JSON.stringify({binding,arguments:{action:'media.capture.frames.sample',artifactId:'video.webm',sourceTimestampsSeconds:[59.99]}})});return response.json() as Promise<{ok:boolean;images?:unknown[];error?:string}>}
 assert.equal((await invoke()).images?.length,1);tamper=true;const rejected=await invoke();assert.equal(rejected.ok,false);assert.match(rejected.error!,/PNG changed before image admission/)
})

test('Wire schema factoring preserves full BMW validation, deterministic catalogs and unchanged native help contracts',()=>{
 const registry=new BrowserCapabilityRegistry(product),raw=registry.inputSchema(),before=JSON.stringify(raw),wire=registry.toolDefinition().inputSchema
 assert.ok(JSON.stringify(wire).length<before.length*.7,'Repeated full schemas must materially shrink on the wire')
 assert.equal(JSON.stringify(registry.inputSchema()),before,'Factoring must not mutate native action contracts')
 assert.deepEqual(registry.toolDefinition().inputSchema,wire,'Effective catalog must remain deterministic')
 const fullValidate=new Ajv({strict:false}).compile(raw),wireValidate=new Ajv({strict:false}).compile(wire)
 const requests=[{action:'status'},{action:'status',artifactId:'forbidden.png'},{action:'page.text.find',selector:'p',text:'Share your behavior'},
  {action:'library.sources',sourceRequest:{operation:'collect',expectedRevision:0,bodySelector:'p'}},
  {action:'library.sources',sourceRequest:{operation:'collect',expectedRevision:0,bodySelector:'p',callerCode:'forbidden'}},
  {action:'video.studio',studioRequest:{operation:'context'}},
  ...[1333333,-1].map(ticks=>({action:'video.studio',studioRequest:{operation:'apply-edit',draftId:'draft',expectedRevision:1,edit:{version:1,commands:[{op:'clip.trim',clipId:'clip',edge:'end',time:{ticks}}]}}})),
  {action:'video.studio',studioRequest:{operation:'apply-edit',edit:{version:1,commands:[{op:'clip.trim',clipId:'clip',edge:'end',time:{ticks:1,secret:true}}]}}},
  {action:'media.image.draw',width:320,height:180,shapes:[{type:'text',x:1,y:1,text:'Visible',color:'#172536'}]},
  {action:'media.image.draw',width:320,height:180,shapes:[{type:'script',text:'forbidden'}]},
  {action:'shell',command:'forbidden'}]
 for(const request of requests)assert.equal(wireValidate(request),fullValidate(request),JSON.stringify(request))
 assert.equal(wireValidate(requests[0]),true);assert.equal(wireValidate(requests[1]),false)
 const native=registry.help('video.studio',{forOperation:'describe-edit'}) as {inputSchema:unknown};assert.ok(native.inputSchema,'Exact native operation help remains available')
})

test('Factoring keeps embedded schema identifiers local, literal data intact, and existing references/vocabularies untouched',()=>{
 const shared={type:'object',additionalProperties:false,required:['value'],description:'Shared description '.repeat(30),properties:{value:{type:'integer',minimum:1,maximum:3}}}
 const inner={...shared,properties:{value:{const:'inner'}}},schema={type:'object',properties:{left:shared,right:shared,embedded:{$id:'https://bmw.local/test/embedded',type:'object',properties:{a:inner,b:inner}}}}
 const compact=compactToolSchema(schema) as Record<string,unknown>,rootDefs=compact.$defs as Record<string,unknown>,properties=compact.properties as Record<string,Record<string,unknown>>
 assert.ok(rootDefs&&properties.embedded.$defs);assert.equal(properties.embedded.$id,'https://bmw.local/test/embedded')
 const validate=new Ajv({strict:false}).compile(compact)
 assert.equal(validate({left:{value:1},right:{value:3},embedded:{a:{value:'inner'},b:{value:'inner'}}}),true)
 assert.equal(validate({left:{value:1},embedded:{a:{value:1}}}),false,'Nested references must not resolve to the outer resource')
 assert.equal(validate({left:{value:4}}),false);assert.deepEqual(compactToolSchema(compact),compact)
 const literal={type:'object',const:{$ref:'literal-data-not-a-schema',note:'x'.repeat(400)}},data=compactToolSchema({type:'object',properties:{one:literal,two:literal}}),dataValidate=new Ajv({strict:false}).compile(data)
 assert.equal(dataValidate({one:{$ref:'literal-data-not-a-schema',note:'x'.repeat(400)}}),true);assert.equal(dataValidate({one:{$ref:'different'}}),false)
 for(const opaque of [{$defs:{shared},properties:{one:{$ref:'#/$defs/shared'}},description:'existing references'}, {type:'object',customVocabulary:{validation:true},properties:{left:shared,right:shared}},{$anchor:'retained',properties:{left:shared,right:shared}},{$schema:'http://json-schema.org/draft-07/schema#',properties:{left:shared,right:shared}},{id:'legacy-id',properties:{left:shared,right:shared}},{$schema:'https://example.com/custom-dialect',properties:{left:shared,right:shared}},{$id:'#legacy-fragment',properties:{left:shared,right:shared}}])assert.deepEqual(compactToolSchema(opaque),opaque)
})

test('Published descriptions retain every action instruction once and preserve additional feature context',()=>{
 const registry=new BrowserCapabilityRegistry(product),definition=registry.toolDefinition(),branches=definition.inputSchema.oneOf as {description:string}[]
 const descriptions=branches.map(branch=>branch.description).join(' ')
 for(const action of registry.actions.values())assert.ok(descriptions.includes(action.description))
 for(const feature of product.features??[])if(feature.browserDescription&&descriptions.includes(feature.browserDescription))assert.equal(definition.description.includes(feature.browserDescription),false,'Exact duplicate overview belongs in schema branches, not repeated in tool prose')
 const extra=new BrowserCapabilityRegistry({id:'fixture',name:'Fixture',features:[{id:'extra',browserDescription:'Additional context with no corresponding action description.'}]}).toolDefinition()
 assert.match(extra.description,/Additional context with no corresponding action description/)
})
