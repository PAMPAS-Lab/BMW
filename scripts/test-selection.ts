import path from 'node:path'
import {interfaces, implementationChecks, ownerOf} from './module-catalog.js'
import type {SourceGraph} from './source-graph.js'
import {tests} from './test-catalog.js'
import type {TestDefinition} from './test-catalog.js'

export interface Selection {changed: string[]; full: boolean; fallbackReasons: string[]; selected: {test: TestDefinition; reasons: string[]}[]; excluded: {id: string; reason: string}[]}
export function matchesWatch(file: string, watch: string): boolean {return file === watch || file.startsWith(watch)}
export function selectTests(graph: SourceGraph, changedInput: readonly string[]): Selection {
  const changed=[...new Set(changedInput.map(file=>path.posix.normalize(file.replaceAll('\\','/'))))].sort()
  if(changed.some(file=>file.startsWith('../')||path.posix.isAbsolute(file)))throw new Error('Changed files must be repository-relative paths.')
  const fallbackReasons: string[]=[],known=new Set(graph.files)
  for(const file of changed){
    if(['package.json','package-lock.json','tsconfig.json','AGENTS.md','apps/bmw/product.ts','scripts/module-catalog.ts','scripts/test-catalog.ts','scripts/source-graph.ts','scripts/test-selection.ts','scripts/test-runner.ts','scripts/run-electron-script.ts'].includes(file))fallbackReasons.push('Shared configuration/composition/selection changed: '+file)
    else if(!known.has(file)&&!/^docs\/|^(README|handoff|agent)\.md$/.test(file))fallbackReasons.push('Unknown/deleted source requires conservative coverage: '+file)
  }
  const touched=new Map(changed.map(file=>[file,'changed '+file]))
  let expanded=true
  while(expanded){expanded=false;for(const [file,edges]of Object.entries(graph.imports))if(!touched.has(file)){
    const dependency=edges.find(edge=>edge.target&&touched.has(edge.target))
    if(dependency?.target){touched.set(file,'imports '+dependency.target);expanded=true}
  }}
  // Validation helpers can be tracked automatically without widening a product
  // contract change through every runtime entry's product assembly imports.
  const helperTouched = new Map(changed.filter(file=>ownerOf(file)?.id==='validation').map(file=>[file,'validation helper changed '+file]))
  let helpersExpanded=true
  while(helpersExpanded){helpersExpanded=false;for(const [file,edges] of Object.entries(graph.imports))if(ownerOf(file)?.id==='validation'&&!helperTouched.has(file)){
    const dependency=edges.find(edge=>edge.target&&helperTouched.has(edge.target))
    if(dependency?.target){helperTouched.set(file,'validation helper dependency '+dependency.target);helpersExpanded=true}
  }}
  for(const file of graph.dynamicImports)if(touched.has(file)) {
    // Runtime entries are selected by declared behavior/implementation scope, not
    // by their setup imports. An unselected DSH smoke must not widen Browser edits.
    const runtimeEntry=ownerOf(file)?.id==='validation'&&tests.some(test=>test.file===file&&['node','electron','desktop'].includes(test.runner))
    if(!runtimeEntry||changed.includes(file))fallbackReasons.push('Computed module import cannot prove bounded impact: '+file)
  }
  const full=fallbackReasons.length>0,selected:Selection['selected']=[],excluded:Selection['excluded']=[]
  for(const test of tests){
    if(test.optIn){excluded.push({id:test.id,reason:'Explicit external opt-in required: '+test.optIn});continue}
    const reasons:string[]=[]
    if(full)reasons.push(...fallbackReasons)
    if(changed.includes(test.file))reasons.push('test entry changed')
    if(test.runner==='node-test'&&touched.has(test.file))reasons.push(touched.get(test.file)!)
    if(['electron','desktop','node'].includes(test.runner)&&helperTouched.has(test.file))reasons.push(helperTouched.get(test.file)!)
    for(const file of changed)if(test.watch?.some(watch=>matchesWatch(file,watch)))reasons.push('behavior/indirect dependency '+file)
    for(const contract of interfaces)if(contract.tests.includes(test.id)&&contract.files.some(file=>changed.includes(file)))reasons.push('interface guarantee '+contract.id)
    for(const implementation of implementationChecks)if(implementation.tests.includes(test.id)&&changed.some(file=>implementation.watch.some(watch=>matchesWatch(file,watch))))reasons.push('implementation/assembly guarantee '+implementation.id)
    if(test.layer==='boundary'&&changed.some(file=>ownerOf(file)))reasons.push('global module/tool safety boundary')
    if(test.runner==='type'&&changed.some(file=>/\.(ts|cts|mts|json)$/.test(file)))reasons.push('public API positive/negative compile contracts')
    if(reasons.length)selected.push({test,reasons:[...new Set(reasons)]})
    else excluded.push({id:test.id,reason:'Outside changed-file dependencies and declared behavior watches'})
  }
  return {changed,full,fallbackReasons:[...new Set(fallbackReasons)],selected,excluded}
}
export function catalogViolations(graph: SourceGraph): string[] {
  const failures:string[]=[],ids=new Set<string>()
  for(const test of tests){
    if(ids.has(test.id))failures.push('Duplicate test id: '+test.id)
    ids.add(test.id)
    if(!graph.files.includes(test.file))failures.push('Missing classified test: '+test.file)
    if(!test.modules.length)failures.push('Test has no module: '+test.id)
  }
  for(const file of graph.files.filter(file=>/\.test\.ts$|\.type-test\.ts$|(?:^|\/)[^/]+-smoke\.ts$/.test(file)))if(!tests.some(test=>test.file===file))failures.push('Unclassified automated test: '+file)
  for(const contract of interfaces){
    if(!contract.files.length||!contract.tests.length)failures.push('Interface has no implementation or guarantor: '+contract.id)
    for(const file of contract.files)if(!graph.files.includes(file))failures.push('Missing interface source: '+file)
    for(const test of contract.tests)if(!ids.has(test))failures.push('Missing interface guarantor: '+contract.id+' -> '+test)
  }
  for(const contract of interfaces.filter(contract=>['browser-model','agent-driver'].includes(contract.id)))for(const id of contract.tests) {
    if(tests.find(test=>test.id===id)?.modules.includes('harness-dsh'))failures.push('Provider-neutral interface requires a DSH-specific test: '+contract.id+' -> '+id)
  }
  for(const implementation of implementationChecks) {
    if(!implementation.watch.length||!implementation.tests.length)failures.push('Implementation check has no scope or guarantor: '+implementation.id)
    for(const id of implementation.contracts)if(!interfaces.some(contract=>contract.id===id))failures.push('Missing implementation contract: '+implementation.id+' -> '+id)
    for(const id of implementation.tests)if(!ids.has(id))failures.push('Missing implementation guarantor: '+implementation.id+' -> '+id)
  }
  return failures
}
