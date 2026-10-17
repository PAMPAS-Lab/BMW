import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {app,webContents} from 'electron'
import {DshBackend,DshRuntime} from '@bmw-agent/harness-dsh'
import {assistantPagePath,assistantPreloadPath} from '@bmw-agent/agent-ui'
import {agentRecord} from '@bmw-agent/agent-contract'
import type {AssistantState} from '@bmw-agent/agent-contract'
import {createBmwApplication} from '../packages/platform/src/main.js'
import {requireCurrentAgentData} from '../packages/platform/src/agent-data-format.js'
import {ProjectStore} from '../packages/platform/src/project-store.js'
import {LayoutStore} from '../packages/platform/src/layout-store.js'
import {bmwProduct} from '../packages/product-bmw/index.js'

const task=process.env.BMW_DSH_TASK_FILE,sourceHome=process.env.BMW_DSH_SOURCE_HOME
if(!task||!sourceHome||!path.isAbsolute(task)||!path.isAbsolute(sourceHome))throw new Error('Explicit authorized BMW_DSH_TASK_FILE and BMW_DSH_SOURCE_HOME required.')
const text=fs.readFileSync(task,'utf8');if(!text.trim()||text.length>60000)throw new Error('Invalid bounded production prompt.')
const resume=process.env.BMW_DSH_RESUME_ROOT,root=resume?fs.realpathSync(resume):path.resolve('.bmw-runtime/dsh-si',new Date().toISOString().replace(/[:.]/g,'-')),profile=path.join(root,'profile')
fs.mkdirSync(root,{recursive:true});process.env.BMW_USER_DATA_DIR=profile;requireCurrentAgentData(profile)
const projects=new ProjectStore({filePath:path.join(profile,'projects.json'),projectsDirectory:path.join(root,'projects'),initialWorkspacePath:path.join(root,'workspace'),onState:undefined})
if(!resume)projects.completeInitialSetup({name:'SI news / DSH Flash',homeUrl:''})
const inputs=process.env.BMW_DSH_INPUT_INDEX
if(inputs){const index:unknown=JSON.parse(fs.readFileSync(inputs,'utf8'));if(!Array.isArray(index)||index.length>32)throw new Error('Bounded explicit input index required.');const directory=path.join(projects.active().directory,'artifacts');fs.mkdirSync(directory,{recursive:true});for(const raw of index){const row=agentRecord(raw);if(typeof row.path!=='string'||!path.isAbsolute(row.path)||typeof row.artifactId!=='string'||!/^[A-Za-z0-9_.-]{1,200}$/.test(row.artifactId))throw new Error('Invalid source.');const stat=fs.lstatSync(row.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024*1024)throw new Error('Invalid source file.');fs.copyFileSync(row.path,path.join(directory,row.artifactId),fs.constants.COPYFILE_EXCL)}}
new LayoutStore({filePath:path.join(profile,'layout-settings.json'),onState:undefined}).update({configured:true,mode:'sidebar'})
const evidence:Record<string,unknown>={root,driver:'dsh',harness:execFileSync('dsh',['--version'],{encoding:'utf8'}).trim(),requestedModel:['deepseek-official','deepseek-flash'],paidInference:true,profile:'disposable',startedAt:new Date().toISOString()}
const seen=new Set<string>(),headers:Record<string,unknown>[]=[],calls:{name:string;input:Record<string,unknown>}[]=[]
createBmwApplication(bmwProduct,{pagePath:assistantPagePath,preloadPath:assistantPreloadPath,defaultDriverId:'dsh',createBackends(config){return [new DshBackend({userDataDirectory:config.userDataDirectory,sourceDshHome:sourceHome,connection:config.connection,controlConnection:config.controlConnection,getModel:()=>config.model('dsh'),setModel:id=>config.setModel('dsh',id),settingsProject:()=>projects.active(),project:id=>projects.get(id),runtimeFactory:options=>new class extends DshRuntime{
 override async call(method:string,payload:Record<string,unknown>={},options:{signal?:AbortSignal}={}):Promise<Awaited<ReturnType<DshRuntime['call']>>>{
  const reply=await super.call(method,payload,options)
  if(method==='session.history')for(const raw of Array.isArray(agentRecord(reply).events)?agentRecord(reply).events as unknown[]:[]){const event=agentRecord(agentRecord(raw).event),key=String(payload.sessionId)+':'+String(event.seq);if(seen.has(key))continue;seen.add(key);const data=agentRecord(event.data)
   if(event.type==='request/header'){const h=agentRecord(data.header),config=agentRecord(h.config);assert.ok(Array.isArray(h.tools));assert.deepEqual(h.tools.map(t=>agentRecord(t).name),['browser']);assert.equal(config.provider,'deepseek-official');assert.equal(config.model,'deepseek-flash');const header={provider:config.provider,model:config.model,tools:['browser']};headers.push(header);console.log(JSON.stringify({stage:'request-header',...header}))}
   if(event.type==='tool/call'){assert.equal(data.name,'browser');const input=agentRecord(JSON.parse(String(data.arguments)));calls.push({name:'browser',input});fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(calls.at(-1))+'\n');console.log(JSON.stringify({stage:'tool',number:calls.length,action:input.action,operation:agentRecord(input.studioRequest??{}).operation}))}
   if(event.type==='tool/result'){const message=agentRecord(data.message),parts=Array.isArray(message.content)?message.content.map(p=>agentRecord(p)):[];fs.appendFileSync(path.join(root,'responses.jsonl'),JSON.stringify({callId:message.toolCallId,text:parts.filter(p=>p.type==='text').map(p=>String(p.text)).join('\n'),images:parts.filter(p=>p.type==='image').length,isError:message.isError===true})+'\n')}
  }
  return reply
 }
 }(options)})]}})
async function until<T>(read:()=>Promise<T|null>,label:string,limit=120000):Promise<T>{const deadline=Date.now()+limit;while(Date.now()<deadline){const v=await read();if(v!==null)return v;await new Promise<void>(r=>setTimeout(r,200))}throw new Error('DSH production deadline: '+label)}
let code=0
const watchdog=setTimeout(()=>{code=1;evidence.error='Watchdog expired; native shutdown requested';app.quit()},35*60000)
void(async()=>{await app.whenReady();try{
 const assistant=await until(async()=>webContents.getAllWebContents().find(w=>w.getURL().endsWith('/assistant.html')&&!w.isLoading())??null,'Assistant load'),shell=await until(async()=>webContents.getAllWebContents().find(w=>w.getURL().endsWith('/shell.html')&&!w.isLoading())??null,'Shell load')
 const invoke=(value:unknown):Promise<AssistantState>=>assistant.executeJavaScript('window.bmwAssistant.invoke('+JSON.stringify(value)+')'),snapshot=()=>invoke({action:'snapshot'})
 await until(async()=>{const s=await snapshot();return s.selectedSessionId?s:null},'selected Session')
 await shell.executeJavaScript('window.bmw.setAgentControl(true)');await shell.executeJavaScript('window.bmw.openProductPanel("video-studio")')
 const studio=await until(async()=>webContents.getAllWebContents().find(w=>w.getURL().endsWith('/studio.html')&&!w.isLoading())??null,'Studio load');await studio.executeJavaScript('window.bmwStudio.view({mode:"advanced",confirmStages:false})')
 await invoke({action:'settings.run',driverId:'dsh',request:{action:'refresh'}})
 const settings=await until(async()=>{const s=await snapshot();return s.settings&&s.settings.phase!=='working'?s.settings:null},'official settings');assert.equal(settings.phase,'idle',settings.message);assert.equal(settings.value?.authentication.state,'ready')
 const selected=settings.value.models.find(m=>m.id===JSON.stringify(['deepseek-official','deepseek-flash']));assert.ok(selected,'Official Flash route missing');evidence.catalog=settings.value.models;evidence.selectedModel=selected
 await invoke({action:'settings.run',driverId:'dsh',request:{action:'model.select',modelId:selected.id}})
 const chosen=await until(async()=>{const s=await snapshot();return s.settings&&s.settings.phase!=='working'?s.settings:null},'model selection');assert.equal(chosen.phase,'idle',chosen.message);assert.equal(chosen.value?.selectedModel,selected.id)
 console.log(JSON.stringify({stage:'selected-model',model:selected.id,harness:evidence.harness,root}))
 if(process.env.BMW_DSH_CATALOG_ONLY!=='1'){
  const before=await snapshot(),sessionId=before.selectedSessionId;assert.ok(sessionId);evidence.sessionId=sessionId
  await invoke({action:'message.send',sessionId,text})
  const done=await until(async()=>{const s=await snapshot();return !s.busy&&s.events.some(e=>e.event.type==='turn.completed')?s:null},'official turn',31*60000);evidence.state=done
  assert.equal(done.sessions.find(s=>s.sessionId===sessionId)?.status,'idle');assert.ok(calls.length>0);assert.ok(headers.length>0);evidence.completed=true;evidence.effectiveTools=['browser'];evidence.requestHeaders=headers
  console.log(JSON.stringify({stage:'complete',calls:calls.length,reply:done.messages.filter(m=>m.role==='assistant').at(-1)?.text,root}))
 }
 }catch(error:unknown){code=1;evidence.error=error instanceof Error?error.message:String(error);console.error(evidence.error)}finally{clearTimeout(watchdog);evidence.finishedAt=new Date().toISOString();evidence.requestHeaders=headers;const data=JSON.stringify(evidence,null,2);fs.writeFileSync(path.join(root,'result.json'),data);fs.writeFileSync(path.join(root,'result-'+String(evidence.finishedAt).replace(/[:.]/g,'-')+'.json'),data);app.quit()}})()
app.once('will-quit',()=>app.exit(code))
