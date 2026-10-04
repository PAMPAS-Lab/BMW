import assert from 'node:assert/strict'
import test from 'node:test'
import {architectureViolations,readSourceGraph} from '../source-graph.js'
import type {SourceGraph} from '../source-graph.js'
import {catalogViolations} from '../test-selection.js'
import {interfaces} from '../module-catalog.js'
import {checkArchitectureDocument} from '../architecture-document.js'

test('Every authored module uses declared public interfaces, acyclic runtime dependencies and classified guarantors',()=>{
  const graph=readSourceGraph(process.cwd())
  assert.deepEqual(architectureViolations(process.cwd(),graph),[])
  assert.deepEqual(catalogViolations(graph),[])
  checkArchitectureDocument(process.cwd(),graph)
})
test('Dependency guard rejects private imports, driver leakage and privileged renderer imports even when the target exists',()=>{
  const graph=readSourceGraph(process.cwd())
  const mutated:SourceGraph={...graph,imports:{...graph.imports,'packages/feature-video/index.ts':[
    {specifier:'../platform/src/project-store.js',typeOnly:false,target:'packages/platform/src/project-store.ts'},
    {specifier:'../harness-dsh/index.js',typeOnly:false,target:'packages/harness-dsh/index.ts'}
  ],'packages/feature-video/src/renderer/studio.ts':[{specifier:'./helper.js',typeOnly:false,target:'packages/feature-video/src/studio-service.ts'}], 'packages/feature-video/src/studio-service.ts':[{specifier:'node:fs',typeOnly:false}]}}
  const violations=architectureViolations(process.cwd(),mutated).join('\n')
  assert.match(violations,/private cross-module import/)
  assert.match(violations,/forbidden runtime dependency feature-video -> harness-dsh/)
  assert.match(violations,/privileged renderer import/)
})
test('Unclassified tests and missing interface guarantors cannot silently lose coverage',()=>{
  const graph=readSourceGraph(process.cwd())
  assert.match(catalogViolations({...graph,files:[...graph.files,'packages/platform/test/new-interface.test.ts']}).join('\n'),/Unclassified/)
  assert.match(catalogViolations({...graph,files:graph.files.filter(file=>file!=='packages/platform/test/feature-contract.test.ts')}).join('\n'),/Missing classified test/)
  const browser=interfaces.find(contract=>contract.id==='browser-model')!,direct=browser.tests
  try {browser.tests=[...direct,'dsh'];assert.match(catalogViolations(graph).join('\n'),/Provider-neutral interface requires a DSH-specific test/)}
  finally {browser.tests=direct}
})

test('Architecture rejects production-to-test indirection, bare Node renderer imports and unbounded production loaders',()=>{
  const root=process.cwd(),graph=readSourceGraph(root),helper='packages/platform/test/leak-fixture.ts',entry='packages/platform/src/main.ts'
  const indirect:SourceGraph={...graph,files:[...graph.files,helper],imports:{...graph.imports,[entry]:[...graph.imports[entry],{specifier:'../test/leak-fixture.js',typeOnly:false,target:helper}],[helper]:[{specifier:'../../harness-dsh/index.js',typeOnly:false,target:'packages/harness-dsh/index.ts'}]}}
  assert.match(architectureViolations(root,indirect).join('\n'),/production import reaches test-only code/)
  for(const specifier of ['fs','fs/promises','node:fs','child_process','electron/renderer']){
    const renderer:SourceGraph={...graph,imports:{...graph.imports,'packages/feature-video/src/renderer/studio.ts':[{specifier,typeOnly:false}]}}
    assert.match(architectureViolations(root,renderer).join('\n'),/privileged renderer import/,specifier)
  }
  for(const file of [entry,'packages/harness-dsh/dsh/plugins/browser-mcp/index.ts'])assert.match(architectureViolations(root,{...graph,dynamicImports:[...graph.dynamicImports,file]}).join('\n'),/unbounded computed production module import/)
  assert.match(architectureViolations(root,{...graph,exports:{...graph.exports,platform:[...graph.exports.platform,helper]}}).join('\n'),/public entry exposes test code/)
  assert.equal(graph.dynamicImports.includes('packages/harness-dsh/dsh/plugins/browser-mcp/index.ts'),false,'The sole installed DSH loader is resolved from its fixed approved package literal')
  assert.ok(graph.imports['packages/harness-dsh/dsh/plugins/browser-mcp/index.ts'].some(edge=>edge.specifier==='@deepseek-ai/dsh-mcp-client'))
})
