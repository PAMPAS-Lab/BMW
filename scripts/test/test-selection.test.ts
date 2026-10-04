import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import test from 'node:test'
import {API} from 'typescript/unstable/sync'
import {importsOf,readSourceGraph} from '../source-graph.js'
import {selectTests} from '../test-selection.js'
import {gitChanges,parseOptions} from '../test-runner.js'

test('Renderer read change selects its direct/consumer guarantees and background runtime without unrelated codecs or speech',()=>{
  const graph=readSourceGraph(process.cwd()),selection=selectTests(graph,['packages/browser-capability/src/renderer-read.ts']),ids=selection.selected.map(item=>item.test.id)
  for(const id of ['browser.renderer-read','browser.screenshot','browser.background','architecture.boundaries'])assert.ok(ids.includes(id),id)
  for(const id of ['video','localNarration','media.processing-runtime','desktop.settings','external.vision'])assert.equal(ids.includes(id),false,id)
  assert.equal(selection.full,false)
  assert.ok(selection.excluded.some(item=>item.id==='external.edge'&&item.reason.includes('opt-in')))
})
test('Public contract changes include consumers; deleted/unknown/config changes fail toward full offline coverage',()=>{
  const graph=readSourceGraph(process.cwd())
  const contract=selectTests(graph,['packages/browser-capability/src/browser-host.ts']).selected.map(item=>item.test.id)
  for(const id of ['browser.host-contract','api.types','video.boundary','driver','studio'])assert.ok(contract.includes(id),id)
  for(const file of ['packages/platform/src/deleted.ts','package-lock.json','scripts/test-selection.ts']){
    const selection=selectTests(graph,[file]);assert.equal(selection.full,true)
    assert.ok(selection.selected.some(item=>item.test.id==='desktop.native'))
    assert.equal(selection.selected.some(item=>item.test.optIn),false)
  }
  assert.throws(()=>selectTests(graph,['../BMWDev/file.ts']),/repository-relative/)
})
test('AST dependency analysis recognizes multiline aliases, exports and dynamic imports while ignoring comment/string decoys',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-graph-parser-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const file=path.join(root,'fixture.ts')
  fs.writeFileSync(file,`// import bogus from '../private.js'\nconst decoy="import('../also-private.js')";\nimport type {A} from './types.js';\nimport Default, {type A} from './mixed.js';\nimport {\n B as Alias\n} from './public.js';\nexport {C} from './exported.js';\nexport {type A} from './only-types.js';\nasync function load(){return import('./lazy.js')}\nasync function computed(name:string){return import(name)}\n`)
  const api=new API({cwd:root})
  try{const snapshot=api.updateSnapshot({openFiles:[file]});try{
    const source=snapshot.getDefaultProjectForFile(file)!.program.getSourceFile(file)!,result=importsOf(source)
    assert.deepEqual(result.edges.map(edge=>[edge.specifier,edge.typeOnly]),[['./types.js',true],['./mixed.js',false],['./public.js',false],['./exported.js',false],['./only-types.js',true],['./lazy.js',false]])
    assert.equal(result.computed,true)
  }finally{snapshot.dispose()}}finally{api.close()}
})
test('Git selection preserves both rename paths, staged/uncommitted deletions and untracked files',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-graph-git-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const git=(...args:string[])=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr)}
  git('init','-q');fs.writeFileSync(path.join(root,'before.ts'),'export const value=1\n');fs.writeFileSync(path.join(root,'deleted.ts'),'export const other=2\n');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture baseline')
  git('mv','before.ts','after.ts');fs.unlinkSync(path.join(root,'deleted.ts'));fs.writeFileSync(path.join(root,'untracked.ts'),'export const newValue=3\n')
  assert.deepEqual(gitChanges(root,'HEAD').sort(),['after.ts','before.ts','deleted.ts','untracked.ts'])
  assert.throws(()=>parseOptions(['--files','a.ts','--layer','unit']),/one scope/)
  assert.throws(()=>parseOptions(['--layer','external']),/opt-in-only/)
  assert.throws(()=>parseOptions(['--module','BMWDev']),/Unknown module/)
  assert.equal(parseOptions(['--files','a.ts','b.ts','--plan']).plan,true)
})

test('Browser interfaces use the neutral model-side driver fixture while DSH integration follows implementation and assembly scope',()=>{
  const graph=readSourceGraph(process.cwd())
  const ids=(files:string[])=>selectTests(graph,files).selected.map(item=>item.test.id)
  for(const file of ['browser-schema','tool-catalog','bridge-server','browser-mcp-server']) {
    const selected=ids(['packages/browser-capability/src/'+file+'.ts'])
    assert.ok(selected.includes('driver'),file)
    assert.equal(selected.includes('dsh'),false,file)
    assert.equal(selected.some(id=>id.startsWith('dsh.')),false,file)
  }
  for(const file of ['packages/agent-contract/index.ts','packages/harness-dsh/src/dsh-client.ts','apps/bmw/product.ts'])assert.ok(ids([file]).includes('dsh'),file)
  assert.ok(ids(['packages/browser-capability/src/bridge-server.ts','packages/harness-dsh/src/dsh-client.ts']).includes('dsh'))
  assert.equal(selectTests(graph,['scripts/dsh-compatibility-smoke.ts']).full,true,'Direct edits of computed-import entries remain conservative')
  assert.equal(selectTests({...graph,dynamicImports:[...graph.dynamicImports,'packages/platform/src/main.ts']},['packages/browser-capability/src/browser-schema.ts']).full,true,'Affected production computed imports still require full coverage')
  const concrete=selectTests(graph,['packages/harness-dsh/src/dsh-client.ts']).selected.find(item=>item.test.id==='dsh')!
  assert.ok(concrete.reasons.includes('implementation/assembly guarantee bmw-dsh-assembly'))
})

test('Runtime validation helper changes select every dependent entry without pulling concrete DSH into Browser contracts',()=>{
  const graph=readSourceGraph(process.cwd()),selection=selectTests(graph,['scripts/renderer-evidence.ts']),ids=selection.selected.map(item=>item.test.id)
  for(const id of ['studio','desktop.workspace','desktop.projects','desktop.settings','desktop.native'])assert.ok(ids.includes(id),id)
  assert.equal(selection.full,false);assert.equal(ids.includes('dsh'),false)
  assert.ok(selection.selected.find(item=>item.test.id==='studio')!.reasons.some(reason=>reason.includes('validation helper dependency')))
  const helper='scripts/evidence-base-fixture.ts',indirect={...graph,files:[...graph.files,helper],imports:{...graph.imports,'scripts/renderer-evidence.ts':[{specifier:'./evidence-base-fixture.js',typeOnly:false,target:helper}]}}
  const transitive=selectTests(indirect,[helper]).selected.map(item=>item.test.id)
  assert.ok(transitive.includes('studio'));assert.ok(transitive.includes('desktop.native'))
  const permissions=selectTests(graph,['packages/platform/src/permission-store.ts']).selected.map(item=>item.test.id)
  for(const id of ['platform.permission-store','platform.state','driver','startup.permissions.retry','startup.permissions.exit'])assert.ok(permissions.includes(id),id)
})


test('Image decoding and visual segment contracts select their actual Studio and native runtime checks',()=>{
 const graph=readSourceGraph(process.cwd())
 for(const file of ['packages/media-native/src/image-contract.ts','packages/media-native/src/media/image-decoder.ts']){
  const selection=selectTests(graph,[file]),ids=selection.selected.map(item=>item.test.id);assert.equal(selection.full,false)
  for(const id of ['studio','video','media.processing-runtime'])assert.ok(ids.includes(id),file+' '+id)
  if(file.endsWith('/image-contract.ts'))assert.ok(ids.includes('localNarration'))
  assert.equal(ids.includes('dsh'),false)
 }
 for(const file of ['packages/media-native/src/visual-segments.ts','packages/media-native/src/text-export.ts','packages/media-native/src/caption-export.ts']){
  const ids=selectTests(graph,[file]).selected.map(item=>item.test.id);assert.ok(ids.includes('studio'),file);assert.ok(ids.includes('video'),file)
 }
})

test('Drawing implementation and public image actions select native pixel checks and model-side MCP coverage',()=>{
 const graph=readSourceGraph(process.cwd())
 for(const file of ['packages/media-native/src/image-drawing-contract.ts','packages/media-native/src/media/image-drawing.ts','packages/browser-capability/src/browser-schema.ts']){
  const ids=selectTests(graph,[file]).selected.map(item=>item.test.id)
  assert.ok(ids.includes('media.processing-runtime'),file)
  if(file.endsWith('/browser-schema.ts'))assert.ok(ids.includes('driver'),file)
  assert.equal(ids.includes('dsh'),false,file)
 }
})


test('Studio cover changes remain affected-only while retaining native/runtime and safety checks',()=>{
 const graph=readSourceGraph(process.cwd()),selection=selectTests(graph,['packages/feature-video/src/studio-service.ts','packages/feature-video/src/renderer/studio-cover-editor.ts','packages/media-native/src/media-controller.ts','packages/media-native/src/media/processing.cover.ts']),ids=selection.selected.map(item=>item.test.id)
 assert.equal(selection.full,false);assert.deepEqual(selection.fallbackReasons,[])
 for(const id of ['studio','video','media.processing-runtime','video.studio','api.types','architecture.boundaries'])assert.ok(ids.includes(id),id)
 for(const id of ['dsh','desktop.settings','desktop.projects','desktop.native','startup-recovery'])assert.equal(ids.includes(id),false,id)
 const paint=selectTests(graph,['packages/media-native/src/media/processing.cover-paint.ts']);assert.equal(paint.full,false);assert.ok(paint.selected.some(item=>item.test.id==='media.processing-runtime'))
})
