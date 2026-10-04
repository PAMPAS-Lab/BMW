import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {spawn,spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {architectureViolations,readSourceGraph} from './source-graph.js'
import {catalogViolations,selectTests} from './test-selection.js'
import {checkArchitectureDocument} from './architecture-document.js'
import {modules,ownerOf} from './module-catalog.js'
import {tests} from './test-catalog.js'
import type {TestLayer} from './test-catalog.js'
import type {Selection} from './test-selection.js'

const layers:readonly TestLayer[]=['unit','contract','boundary','integration','desktop','media','external','type']
export interface RunnerOptions {plan:boolean;all:boolean;files:string[];module?:string;base?:string;layers?:TestLayer[]}
export function parseOptions(args:readonly string[]):RunnerOptions{
  const result:RunnerOptions={plan:false,all:false,files:[]}
  for(let i=0;i<args.length;i++){
    const key=args[i]
    if(key==='--plan')result.plan=true
    else if(key==='--all')result.all=true
    else if(key==='--affected')continue
    else if(key==='--files'){
      const start=result.files.length
      while(args[i+1]&&!args[i+1].startsWith('--'))result.files.push(args[++i])
      if(result.files.length===start)throw new Error('--files needs repository-relative paths.')
    }else if(['--module','--base','--layer'].includes(key)){
      const value=args[++i];if(!value||value.startsWith('-'))throw new Error('Missing value for '+key)
      if(key==='--module'){if(!modules.some(module=>module.id===value))throw new Error('Unknown module: '+value);result.module=value}
      if(key==='--base')result.base=value
      if(key==='--layer'){const parsed=value.split(',') as TestLayer[];if(parsed.some(layer=>!layers.includes(layer)||layer==='external'))throw new Error('Unknown/opt-in-only test layer: '+value);result.layers=parsed}
    }else throw new Error('Unknown test option: '+key)
  }
  const scopes=[result.all,result.files.length>0,Boolean(result.module),Boolean(result.base),Boolean(result.layers)].filter(Boolean).length
  if(scopes>1)throw new Error('Use exactly one scope: --files, --module, --base, --layer or --all.')
  return result
}
function hash(file:string):string{return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}
export function gitChanges(root:string,base:string):string[]{
  const result=spawnSync('git',['diff','--name-status','-z','--find-renames',base,'--'],{cwd:root,encoding:'utf8'})
  if(result.status!==0)throw new Error(result.stderr||'Cannot inspect Git changes.')
  const values=result.stdout.split('\0').filter(Boolean),files:string[]=[]
  for(let i=0;i<values.length;){const status=values[i++];files.push(values[i++]);if(/^[RC]/.test(status))files.push(values[i++])}
  const untracked=spawnSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'})
  if(untracked.status!==0)throw new Error(untracked.stderr||'Cannot inspect untracked source.')
  return [...new Set([...files,...untracked.stdout.split('\0').filter(Boolean)])]
}
interface Result {id:string;layer:string;status:'passed'|'failed'|'not-run';durationMs?:number;exitCode?:number;reason?:string;log?:string}
export async function run(options:RunnerOptions,root=process.cwd()):Promise<number>{
  const graph=readSourceGraph(root),violations=[...architectureViolations(root,graph),...catalogViolations(graph)]
  if(violations.length)throw new Error(violations.join('\n'))
  checkArchitectureDocument(root,graph)
  const sources:Record<string,string>={}
  for(const file of [...graph.files,'package.json','package-lock.json','tsconfig.json',...['README.md','handoff.md','AGENTS.md','docs/FUNCTIONAL_SPEC.md','docs/ARCHITECTURE.md','docs/VERIFICATION.md']])sources[file]=hash(path.join(root,file))
  const baselineFile=path.join(root,'.bmw-runtime/test-baseline.json')
  let selection:Selection
  if(options.all||options.layers){
    selection={changed:[],full:options.all,fallbackReasons:[],selected:tests.filter(test=>!test.optIn&&(!options.layers||options.layers.includes(test.layer))).map(test=>({test,reasons:[options.all?'explicit full baseline':'explicit layer '+test.layer]})),excluded:tests.filter(test=>test.optIn||options.layers&&!options.layers.includes(test.layer)).map(test=>({id:test.id,reason:test.optIn?'External opt-in required':'Outside requested layer'}))}
  }else{
    let changed=options.files
    if(options.module)changed=graph.files.filter(file=>ownerOf(file)?.id===options.module&&!file.includes('/test/'))
    else if(options.base)changed=gitChanges(root,options.base)
    else if(!changed.length){
      if(fs.existsSync(baselineFile)){
        const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8')) as {sourceHashes:Record<string,string>}
        changed=[...new Set([...Object.keys(sources),...Object.keys(baseline.sourceHashes)])].filter(file=>sources[file]!==baseline.sourceHashes[file])
      }else changed=gitChanges(root,'HEAD')
    }
    selection=selectTests(graph,changed)
  }
  if(options.plan){console.log(JSON.stringify({scope:options,selection},null,2));return 0}
  // A direct invocation may not reuse stale generated output after a local edit.
  const receipt=JSON.parse(fs.readFileSync(path.join(root,'.bmw-runtime/build-receipt.json'),'utf8')) as {sources:Record<string,string>;outputs:Record<string,string>}
  for(const file of [...graph.files,'package.json','package-lock.json','tsconfig.json'])if(receipt.sources[file]!==sources[file])throw new Error('Fresh build required for '+file)
  for(const [file,expected]of Object.entries(receipt.outputs))if(hash(path.join(root,file))!==expected)throw new Error('Generated runtime changed since build: '+file)
  const directory=process.env.BMW_VALIDATION_DIR??path.join(root,'.bmw-runtime','classified-tests',new Date().toISOString().replace(/[:.]/g,'-'))
  fs.mkdirSync(directory,{recursive:true})
  const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8')) as {packages:Record<string,{version?:string}>}
  const dependencies=Object.fromEntries(Object.entries(lock.packages).filter(([key])=>['node_modules/typescript','node_modules/electron','node_modules/mediabunny','node_modules/ws'].includes(key)).map(([key,value])=>[key,value.version]))
  const results:Result[]=selection.excluded.map(item=>({id:item.id,layer:tests.find(test=>test.id===item.id)!.layer,status:'not-run',reason:item.reason}))
  results.push({id:'build',layer:'gate',status:'passed',reason:'Fresh compiler receipt verified against every authored source and emitted output'}, {id:'architecture',layer:'gate',status:'passed',reason:'Public module dependencies, interface guarantors and test classification checked'})
  const save=()=>fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({source:root,node:process.version,sourceHashes:sources,dependencies,scope:options,selection,results,manualAcceptance:['Production Profile/keychain and native desktop experience'],external:{paidModels:'not-run',edgeSpeech:'not-run'}},null,2)+'\n')
  async function execute(id:string,command:string[],env:Record<string,string>={},timeout=300_000):Promise<Result>{
    const log=path.join(directory,id+'.log'),stream=fs.createWriteStream(log),start=Date.now()
    console.log('BMW classified verification: '+id)
    const result=await new Promise<{code:number;reason?:string}>(resolve=>{
      const child=spawn(command[0],command.slice(1),{cwd:root,env:{...process.env,GOMEMLIMIT:'32MiB',GOGC:'1',GOMAXPROCS:'1',BMW_VALIDATION_DIR:path.join(directory,id),...env},stdio:['ignore','pipe','pipe']})
      const timer=setTimeout(()=>child.kill('SIGTERM'),timeout)
      child.stdout.on('data',data=>{stream.write(data);process.stdout.write(data)})
      child.stderr.on('data',data=>{stream.write(data);process.stderr.write(data)})
      child.once('error',error=>{clearTimeout(timer);stream.end();resolve({code:1,reason:error.message})})
      child.once('exit',(code,signal)=>{clearTimeout(timer);stream.end();resolve({code:code??1,reason:signal??undefined})})
    })
    return {id,layer:tests.find(test=>test.id===id)?.layer??'gate',status:result.code===0?'passed':'failed',exitCode:result.code,durationMs:Date.now()-start,reason:result.reason,log}
  }
  for(const [id,args]of [['source-policy',['--experimental-strip-types','scripts/check-source.ts']],['feature-inventory',['--experimental-strip-types','scripts/check-functional-spec.ts']]] as const){results.push(await execute(id,[process.execPath,...args]));save()}
  const failedGate=results.some(result=>result.layer==='gate'&&result.status==='failed')
  const desktop=selection.selected.filter(item=>item.test.runner==='desktop')
  for(const item of selection.selected.filter(item=>item.test.runner!=='desktop')){
    const test=item.test
    if(failedGate){results.push({id:test.id,layer:test.layer,status:'not-run',reason:'Source/document gate failed'});continue}
    if(test.runner==='type'){results.push({id:test.id,layer:test.layer,status:'passed',reason:'Fresh compiler emit checked positive and @ts-expect-error consumers'});continue}
    const emitted=test.file.replace(/\.ts$/,'.js')
    const command=test.runner==='node-test'?[process.execPath,'--test',emitted]:test.runner==='electron'?[process.execPath,'scripts/run-electron-script.js',emitted]:[process.execPath,emitted]
    results.push(await execute(test.id,command,{BMW_TTS_TEST_PROVIDER:'local-matcha',...test.env}));save()
  }
  if(desktop.length){
    if(failedGate)for(const item of desktop)results.push({id:item.test.id,layer:'desktop',status:'not-run',reason:'Source/document gate failed'})
    else{
      const aggregate=await execute('desktop-suite',[process.execPath,'scripts/desktop-suite.js','--groups',desktop.map(item=>item.test.group).join(',')],{},1_200_000)
      const file=path.join(directory,'desktop-suite/result.json')
      const groupResults=fs.existsSync(file)?(JSON.parse(fs.readFileSync(file,'utf8')) as {results: {group:string;status:'passed'|'failed'|'not-run';log?:string;error?:string}[]}).results:[]
      for(const item of desktop){const groups=groupResults.filter(group=>group.group===item.test.group||group.group===item.test.group+'/restart');results.push({id:item.test.id,layer:'desktop',status:groups.length&&groups.every(group=>group.status==='passed')?'passed':'failed',reason:groups.length?groups.map(group=>group.group+': '+group.status).join('; '):aggregate.reason??'Desktop process did not report',log:groups[0]?.log??aggregate.log})}
      results.push(aggregate);save()
    }
  }
  const changedDuringRun=Object.entries(sources).filter(([file,expected])=>!fs.existsSync(path.join(root,file))||hash(path.join(root,file))!==expected).map(([file])=>file)
  if(changedDuringRun.length)results.push({id:'source-integrity',layer:'gate',status:'failed',reason:'Sources changed during verification: '+changedDuringRun.join(', ')})
  save()
  const passed=results.filter(result=>result.status==='failed').length===0&&selection.selected.every(item=>results.some(result=>result.id===item.test.id&&result.status==='passed'))
  if(options.all&&passed)fs.writeFileSync(baselineFile,JSON.stringify({sourceHashes:sources,report:path.join(directory,'result.json')},null,2)+'\n')
  console.log('BMW verification report: '+path.join(directory,'result.json'))
  return passed?0:1
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  run(parseOptions(process.argv.slice(2))).then(code=>{process.exitCode=code}).catch((error:unknown)=>{console.error(error);process.exitCode=1})
}
