import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
const root=process.cwd(),directory=process.env.BMW_VALIDATION_DIR??path.join(root,'.bmw-runtime','desktop-suite',new Date().toISOString().replace(/[:.]/g,'-'))
fs.mkdirSync(directory,{recursive:true})
interface Result {group:string;status:'passed'|'failed'|'not-run';exitCode?:number;log?:string;error?:string}
const results:Result[]=[]
async function run(group:string,restoreRoot?:string):Promise<Result>{
 const output=path.join(directory,group);fs.mkdirSync(output,{recursive:true})
 const log=path.join(output,'run.log'),stream=fs.createWriteStream(log)
 const env={...process.env,BMW_DESKTOP_GROUP:group,BMW_VALIDATION_DIR:output,...(group==='projects'?{BMW_DESKTOP_RESTART_MARKER:path.join(directory,'restart-root.txt')}:{}),...(restoreRoot?{BMW_DESKTOP_RESTORE_ROOT:restoreRoot}:{})}
 return new Promise(resolve=>{
  const child=spawn(process.execPath,[path.join(import.meta.dirname,'run-electron-script.js'),path.join(import.meta.dirname,'desktop-smoke.js')],{cwd:root,env,stdio:['ignore','pipe','pipe']})
  const timer=setTimeout(()=>child.kill('SIGTERM'),300_000)
  child.stdout.on('data',data=>{process.stdout.write(data);stream.write(data)})
  child.stderr.on('data',data=>{process.stderr.write(data);stream.write(data)})
  child.once('error',error=>{clearTimeout(timer);stream.end();resolve({group,status:'failed',error:error.message,log})})
  child.once('exit',(code,signal)=>{clearTimeout(timer);stream.end();resolve({group,status:code===0?'passed':'failed',exitCode:code??1,error:signal??undefined,log})})
 })
}
const argument=process.argv.slice(2)
if(argument.length&&!(argument.length===2&&argument[0]==='--groups'))throw new Error('Use --groups workspace,projects,settings,native')
const groups=argument.length?argument[1].split(','):['workspace','projects','settings','native']
if(!groups.length||new Set(groups).size!==groups.length||groups.some(group=>!['workspace','projects','settings','native'].includes(group)))throw new Error('Invalid desktop group selection')
for(const group of groups){
 console.log(`BMW desktop group: ${group}`)
 const result=await run(group);results.push(result)
 if(group==='projects'){
  const marker=path.join(directory,'restart-root.txt')
  if(result.status==='passed'&&fs.existsSync(marker)){
   const temporary=fs.readFileSync(marker,'utf8')
   try{const restart=await run('restore',temporary);results.push({...restart,group:'projects/restart'});if(restart.status!=='passed')result.status='failed'}
   finally{fs.rmSync(temporary,{recursive:true,force:true})}
  }else results.push({group:'projects/restart',status:'not-run',error:'Project prerequisites failed'})
 }
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({results,manualAcceptance:['Production keychain authorization','Production native desktop experience']},null,2))
}
process.exitCode=results.some(result=>result.status!=='passed')?1:0
