import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {app,webContents} from 'electron'
import {query} from '@qodercn-ai/qodercn-agent-sdk'
import {QoderBackend} from '@bmw-agent/harness-qoder'
import {assistantPagePath,assistantPreloadPath} from '@bmw-agent/agent-ui'
import {agentRecord} from '@bmw-agent/agent-contract'
import type {AssistantState} from '@bmw-agent/agent-contract'
import {createBmwApplication} from '../packages/platform/src/main.js'
import {requireCurrentAgentData} from '../packages/platform/src/agent-data-format.js'
import {ProjectStore} from '../packages/platform/src/project-store.js'
import {LayoutStore} from '../packages/platform/src/layout-store.js'
import {bmwProduct} from '../packages/product-bmw/index.js'

const taskFile=process.env.BMW_QODER_TASK_FILE,authSource=process.env.BMW_QODER_AUTH_DIRECTORY
if(!taskFile||!authSource||!path.isAbsolute(taskFile)||!path.isAbsolute(authSource))throw new Error('Explicit authorized BMW_QODER_TASK_FILE and BMW_QODER_AUTH_DIRECTORY are required.')
const text=fs.readFileSync(taskFile,'utf8');if(!text.trim()||text.length>60000)throw new Error('Invalid bounded production prompt.')
const root=process.env.BMW_QODER_RESUME_ROOT?fs.realpathSync(process.env.BMW_QODER_RESUME_ROOT):path.resolve('.bmw-runtime/p1-ak/qoder',new Date().toISOString().replace(/[:.]/g,'-')),isolated=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-qoder-production-'))),profile=path.join(root,'profile'),nativeConfig=path.join(isolated,'qoder-cn')
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(nativeConfig,{mode:0o700})
// User explicitly authorized the BMW account. Only official driver authentication
// enters this disposable native profile; no Project/history/preferences are copied.
fs.cpSync(path.join(authSource,'.auth'),path.join(nativeConfig,'.auth'),{recursive:true,dereference:false})
const previousNative=path.join(profile,'agent-drivers','qoder-cn','projects');if(fs.existsSync(previousNative))fs.cpSync(previousNative,path.join(nativeConfig,'projects'),{recursive:true})
process.env.BMW_USER_DATA_DIR=profile;requireCurrentAgentData(profile)
const projects=new ProjectStore({filePath:path.join(profile,'projects.json'),projectsDirectory:path.join(root,'projects'),initialWorkspacePath:path.join(root,'workspace'),onState:undefined});if(!process.env.BMW_QODER_RESUME_ROOT)projects.completeInitialSetup({name:'P1 / AK Qoder production',homeUrl:''})
const inputIndex=process.env.BMW_QODER_INPUT_INDEX
if(inputIndex){const index:unknown=JSON.parse(fs.readFileSync(inputIndex,'utf8'));if(!Array.isArray(index)||index.length>32)throw new Error('Bounded explicit input index required.');const artifacts=path.join(projects.active().directory,'artifacts');fs.mkdirSync(artifacts,{recursive:true});for(const raw of index){const r=agentRecord(raw);if(typeof r.path!=='string'||!path.isAbsolute(r.path)||typeof r.artifactId!=='string'||!/^[A-Za-z0-9_.-]{1,200}$/.test(r.artifactId))throw new Error('Invalid production input.');const stat=fs.lstatSync(r.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024*1024)throw new Error('Invalid production source file.');fs.copyFileSync(r.path,path.join(artifacts,r.artifactId),fs.constants.COPYFILE_EXCL)}}
new LayoutStore({filePath:path.join(profile,'layout-settings.json'),onState:undefined}).update({configured:true,mode:'sidebar'})
const evidence:Record<string,unknown>={root,driver:'qoder-cn',requestedModel:'DeepSeek-Flash',paidInference:true,profile:'disposable',nativeAudioAdmission:'not-proven',startedAt:new Date().toISOString()},calls:{name:string;input:unknown}[]=[],responses:unknown[]=[]
let initializedModel:string|undefined
createBmwApplication(bmwProduct,{pagePath:assistantPagePath,preloadPath:assistantPreloadPath,defaultDriverId:'qoder-cn',createBackends(config){return [new QoderBackend({configDirectory:nativeConfig,connection:config.connection,getModel:()=>config.model('qoder-cn'),setModel:model=>config.setModel('qoder-cn',model),settingsConnection:{...config.controlConnection,nodeExecutable:config.nodeExecutable},queryFactory(input){if(input.options.model)evidence.requestedRuntimeModel=input.options.model;const native=query(input);return {interrupt:()=>native.interrupt(),close:()=>native.close(),async *[Symbol.asyncIterator](){for await(const raw of native){const e=agentRecord(raw);if(e.type==='system'&&e.subtype==='init'){initializedModel=String(e.model??'');evidence.effectiveTools=e.tools;evidence.initializedModel=initializedModel}if(e.type==='assistant'||e.type==='user'){const content=agentRecord(e.message).content;if(Array.isArray(content))for(const rawBlock of content){const block=agentRecord(rawBlock);if(block.type==='tool_use'){calls.push({name:String(block.name),input:block.input});fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(calls.at(-1))+'\n');console.log(JSON.stringify({stage:'tool',number:calls.length,action:agentRecord(block.input).action,operation:agentRecord(agentRecord(block.input).studioRequest??{}).operation}))}if(block.type==='tool_result'){const parts=Array.isArray(block.content)?block.content.map(v=>agentRecord(v)):[],result={toolUseId:block.tool_use_id,text:typeof block.content==='string'?block.content:parts.filter(p=>p.type==='text').map(p=>String(p.text)).join('\n'),images:parts.filter(p=>p.type==='image').length};responses.push(result);fs.appendFileSync(path.join(root,'responses.jsonl'),JSON.stringify(result)+'\n')}}}yield raw}}}}})]}})
async function until<T>(read:()=>Promise<T|null>,label:string,limit=120000):Promise<T>{const deadline=Date.now()+limit;while(Date.now()<deadline){const value=await read();if(value!==null)return value;await new Promise<void>(r=>setTimeout(r,200))}throw new Error('Qoder production deadline: '+label)}
let code=0
const watchdog=setTimeout(()=>{fs.writeFileSync(path.join(root,'timeout.json'),JSON.stringify({calls:calls.length}));code=1;evidence.error='Production watchdog expired; interruption and native cleanup requested.';app.quit()},50*60000)
void (async()=>{await app.whenReady();try{
 const assistant=await until(async()=>webContents.getAllWebContents().find(w=>w.getURL().endsWith('/assistant.html')&&!w.isLoading())??null,'Assistant load'),shell=await until(async()=>webContents.getAllWebContents().find(w=>w.getURL().endsWith('/shell.html')&&!w.isLoading())??null,'Shell load')
 const invoke=async(value:unknown):Promise<AssistantState>=>assistant.executeJavaScript('window.bmwAssistant.invoke('+JSON.stringify(value)+')'),snapshot=()=>invoke({action:'snapshot'})
 await until(async()=>{const s=await snapshot();return s.selectedSessionId?s:null},'selected Session')
 await shell.executeJavaScript('window.bmw.setAgentControl(true)')
 await shell.executeJavaScript('window.bmw.openProductPanel("video-studio")')
 const studio=await until(async()=>webContents.getAllWebContents().find(w=>w.getURL().endsWith('/studio.html')&&!w.isLoading())??null,'Studio load')
 await studio.executeJavaScript('window.bmwStudio.view({mode:"advanced",confirmStages:false})')
 await invoke({action:'settings.run',driverId:'qoder-cn',request:{action:'refresh'}})
 const settings=await until(async()=>{const s=await snapshot();return s.settings&&s.settings.phase!=='working'?s.settings:null},'official model catalog')
 assert.equal(settings.phase,'idle',settings.message);assert.equal(settings.value?.authentication.state,'ready')
 const selected=settings.value.models.find(m=>/deepseek[-\s]?flash/i.test(m.label));if(!selected)throw new Error('The official enabled catalog has no DeepSeek-Flash; no model substitution permitted.')
 evidence.catalog=settings.value.models.map(({id,label,availability})=>({id,label,availability}));evidence.selectedModel=selected
 await invoke({action:'settings.run',driverId:'qoder-cn',request:{action:'model.select',modelId:selected.id}})
 const chosen=await until(async()=>{const s=await snapshot();return s.settings&&s.settings.phase!=='working'?s.settings:null},'model selection');assert.equal(chosen.phase,'idle',chosen.message);assert.equal(chosen.value?.selectedModel,selected.id)
 console.log(JSON.stringify({stage:'selected-model',model:selected.id,label:selected.label,root}))
 if(process.env.BMW_QODER_CATALOG_ONLY!=='1'){
 const before=await snapshot(),sessionId=before.selectedSessionId;assert.ok(sessionId);evidence.sessionId=sessionId
 await invoke({action:'message.send',sessionId,text})
 const done=await until(async()=>{const s=await snapshot();if(!s.busy&&(s.events.some(e=>e.event.type==='turn.completed')||s.sessions.some(row=>row.status==='disconnected')))return s;return null},'official production turn',45*60000)
 evidence.state=done;assert.equal(done.sessions.find(s=>s.sessionId===sessionId)?.status,'idle');assert.ok(calls.length>0);assert.ok(calls.every(c=>c.name==='browser'));evidence.completed=true;fs.writeFileSync(path.join(root,'assistant.png'),(await assistant.capturePage()).toPNG())
 console.log(JSON.stringify({stage:'complete',calls:calls.length,replies:done.messages.filter(m=>m.role==='assistant').map(m=>m.text),root}))
 }
 }catch(error:unknown){code=1;evidence.error=error instanceof Error?error.message:String(error);console.error(evidence.error)}finally{clearTimeout(watchdog);evidence.finishedAt=new Date().toISOString();const resultText=JSON.stringify(evidence,null,2);fs.writeFileSync(path.join(root,'result-'+String(evidence.finishedAt).replace(/[:.]/g,'-')+'.json'),resultText);fs.writeFileSync(path.join(root,'result.json'),resultText);console.log(JSON.stringify({evidence:path.join(root,'result.json')}));app.quit()}})()
app.once('will-quit',()=>{const nativeProjects=path.join(nativeConfig,'projects');if(fs.existsSync(nativeProjects)){const target=path.join(profile,'agent-drivers','qoder-cn','projects');fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(nativeProjects,target,{recursive:true})}fs.rmSync(isolated,{recursive:true,force:true});app.exit(code)})
