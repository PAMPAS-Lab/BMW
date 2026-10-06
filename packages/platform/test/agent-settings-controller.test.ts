import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type {AgentBackend,AgentDriverSettings} from '@bmw-agent/agent-contract'
import {AgentHost} from '../src/agent-host.js'
import {AgentSettingsController} from '../src/agent-settings-controller.js'
import {ConversationStore} from '../src/conversation-store.js'
import {AgentHistoryStore} from '../src/agent-history-store.js'
import {AgentPreferenceStore} from '../src/agent-preference-store.js'
const projection:AgentDriverSettings={authentication:{state:'ready',label:'Fixture authenticated'},models:[],selectedModel:null,loginMethods:[],canLogout:false}
test('Settings cancellation retains Host exclusion until actual cleanup and never exposes provider secret errors',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-agent-settings-'))
  let release!:()=>void,began!:()=>void,cleanupStarted!:()=>void
  const cleanup=new Promise<void>(yes=>{release=yes}),started=new Promise<void>(yes=>{began=yes}),draining=new Promise<void>(yes=>{cleanupStarted=yes})
  const backend:AgentBackend={description:{id:'fixture',label:'Fixture',baseline:'fixture',capabilities:{streaming:false,images:false,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:false}},prepare:async()=>{assert.fail('No model prepare')},run:async()=>{assert.fail('No model run')},interrupt:async()=>{},respond:async()=>{},close:async()=>{},settings:async(_request,context)=>{began();await new Promise<void>((_yes,no)=>{context.signal.addEventListener('abort',()=>no(new Error('fixture submitted secret')),{once:true})});return projection},drainSettings:async()=>{cleanupStarted();await cleanup}}
  const conversations=new ConversationStore(path.join(root,'index.json'))
  const host=new AgentHost({conversations,history:new AgentHistoryStore(path.join(root,'history'),sessionId=>conversations.get(sessionId)),backends:[backend],currentProject:()=>({id:'p',name:'Fixture',directory:root}),context:async()=>'',drain:async()=>{}})
  const settings=new AgentSettingsController({host,backends:[backend],onState:()=>{},openExternal:async()=>{assert.fail('No login URL')}})
  t.after(async()=>{release();await settings.close();await host.close();fs.rmSync(root,{recursive:true,force:true})})
  settings.start('fixture',{action:'refresh'});await started;assert.equal(host.busy,true);assert.throws(()=>host.create('fixture'),/maintenance/)
  const cancel=settings.cancel();await draining;assert.equal(host.busy,true);assert.equal(settings.snapshot()?.phase,'working')
  release();await cancel;assert.equal(host.busy,false);assert.equal(settings.snapshot()?.phase,'failed');assert.equal(JSON.stringify(settings.snapshot()).includes('submitted secret'),false)
})
test('Settings cleanup failure quarantines admission; recovery retries only cleanup',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-settings-quarantine-'));let reads=0,drains=0,changed!:()=>void
  const terminal=new Promise<void>(yes=>{changed=yes})
  const backend:AgentBackend={description:{id:'fixture',label:'Fixture',baseline:'fixture',capabilities:{streaming:false,images:false,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:false}},prepare:async()=>{assert.fail('No prepare')},run:async()=>{assert.fail('No run')},interrupt:async()=>{},respond:async()=>{},close:async()=>{},settings:async()=>{reads++;return projection},drainSettings:async()=>{if(++drains===1)throw new Error('Cleanup still active')}}
  const conversations=new ConversationStore(path.join(root,'index.json'))
  const host=new AgentHost({conversations,history:new AgentHistoryStore(path.join(root,'history'),sessionId=>conversations.get(sessionId)),backends:[backend],currentProject:()=>({id:'p',name:'Fixture',directory:root}),context:async()=>'',drain:async()=>{}})
  const settings=new AgentSettingsController({host,backends:[backend],openExternal:async()=>{},onState:()=>{if(settings.snapshot()?.phase==='failed')changed()}})
  t.after(async()=>{await settings.close();await host.close();fs.rmSync(root,{recursive:true,force:true})})
  settings.start('fixture',{action:'refresh'});await terminal
  assert.equal(host.resourcesDisconnected,true);assert.equal(host.busy,true);assert.throws(()=>settings.start('fixture',{action:'refresh'}),/连接清理失败/)
  settings.start('fixture',{action:'ensure'});assert.equal(host.resourcesDisconnected,true);assert.equal(reads,1,'Viewing a cached failure must not recover or bypass quarantine')
  await host.recover();assert.equal(reads,1);assert.equal(drains,2);assert.equal(host.busy,false)
})
test('Model preferences survive Project selection writes and stay separate for every driver',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-model-preferences-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const file=path.join(root,'preferences.json'),store=new AgentPreferenceStore(file,'dsh')
  store.setModel('codex','model-c');store.setModel('qoder-cn','model-q');store.set('p','qoder-cn')
  const restored=new AgentPreferenceStore(file,'dsh');assert.equal(restored.model('codex'),'model-c');assert.equal(restored.model('qoder-cn'),'model-q');assert.equal(restored.get('p'),'qoder-cn')
})

test('Repeated settings refresh shares the native read through cleanup; mutations and other drivers stay excluded',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-settings-coalesce-'))
  let reads=0,drains=0,releaseRead!:()=>void,releaseCleanup!:()=>void,beganCleanup!:()=>void,finished!:()=>void
  const read=new Promise<void>(yes=>{releaseRead=yes}),cleanup=new Promise<void>(yes=>{releaseCleanup=yes}),draining=new Promise<void>(yes=>{beganCleanup=yes}),terminal=new Promise<void>(yes=>{finished=yes})
  const backend:AgentBackend={description:{id:'fixture',label:'Fixture',baseline:'fixture',capabilities:{streaming:false,images:false,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:false}},prepare:async()=>{assert.fail('No model prepare')},run:async()=>{assert.fail('No model run')},interrupt:async()=>{},respond:async()=>{},close:async()=>{},settings:async()=>{reads++;await read;return projection},drainSettings:async()=>{drains++;beganCleanup();await cleanup}}
  const conversations=new ConversationStore(path.join(root,'index.json'))
  const host=new AgentHost({conversations,history:new AgentHistoryStore(path.join(root,'history'),sessionId=>conversations.get(sessionId)),backends:[backend],currentProject:()=>({id:'p',name:'Fixture',directory:root}),context:async()=>'',drain:async()=>{}})
  const settings=new AgentSettingsController({host,backends:[backend],openExternal:async()=>{assert.fail('No login')},onState:()=>{if(settings.snapshot()?.phase==='idle')finished()}})
  t.after(async()=>{releaseRead();releaseCleanup();await settings.close();await host.close();fs.rmSync(root,{recursive:true,force:true})})
  settings.start('fixture',{action:'refresh'});settings.start('fixture',{action:'refresh'})
  assert.equal(reads,1);assert.equal(host.busy,true);assert.equal(settings.snapshot()?.phase,'working')
  assert.throws(()=>settings.start('fixture',{action:'model.select',modelId:'fixture-model'}),/正在处理 Agent 设置/)
  assert.throws(()=>settings.start('other',{action:'refresh'}),/正在处理 Agent 设置/)
  assert.throws(()=>settings.start('fixture',{action:'auth.logout'}),/正在处理 Agent 设置/)
  releaseRead();await draining
  settings.start('fixture',{action:'refresh'});assert.equal(reads,1);assert.equal(drains,1);assert.equal(host.busy,true)
  releaseCleanup();await terminal
  assert.equal(host.busy,false);assert.equal(settings.snapshot()?.phase,'idle')
  settings.start('fixture',{action:'refresh'});assert.equal(reads,2,'An idle reopen must start a fresh read')
  await settings.cancel();assert.equal(host.busy,false)
})


test('Profile settings cache reuses each driver across Projects, marks ages independently and never admits native work on view',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-settings-cache-'))
  let now=1000,projectId='p',reads=0,drains=0,configuration='initial'
  const make=(id:string):AgentBackend=>({description:{id,label:id,baseline:'fixture-v1',capabilities:{streaming:false,images:false,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:true}},prepare:async()=>{throw new Error('Fixture native authentication failed')},run:async()=>assert.fail('No released model input'),interrupt:async()=>{},respond:async()=>{},close:async()=>{},settings:async request=>{assert.notEqual(request.action,'ensure','Host cache requests never reach a provider');reads++;return {...projection,selectedModel:id}},drainSettings:async()=>{drains++}})
  const backends=[make('a'),make('b')],conversations=new ConversationStore(path.join(root,'sessions.json'))
  let settings!:AgentSettingsController
  const host=new AgentHost({conversations,history:new AgentHistoryStore(path.join(root,'history'),id=>conversations.get(id)),backends,currentProject:()=>({id:projectId,name:projectId,directory:root}),context:async()=>'',drain:async()=>{},onSettingsInvalidated:id=>settings.invalidate(id)})
  settings=new AgentSettingsController({host,backends,onState:()=>{},openExternal:async()=>{},now:()=>now,configurationKey:()=>configuration})
  t.after(async()=>{await settings.close();await host.close();fs.rmSync(root,{recursive:true,force:true})})
  const load=async(id:string,action:'ensure'|'refresh'='ensure')=>{settings.start(id,{action});for(let i=0;host.busy&&i<50;i++)await new Promise<void>(yes=>setImmediate(yes));assert.equal(host.busy,false)}
  assert.equal(settings.snapshot('a'),undefined)
  await load('a');await load('b');assert.equal(reads,2);assert.equal(drains,2)
  projectId='other';await load('a');assert.equal(reads,2,'Project selection does not duplicate Profile checks')
  assert.equal(settings.snapshot('a')?.value?.selectedModel,'a');assert.equal(settings.snapshot('b')?.value?.selectedModel,'b')
  const clone=settings.snapshot('a')!;clone.value!.authentication.state='required';assert.equal(settings.snapshot('a')?.value?.authentication.state,'ready')
  now+=5*60*1000
  await load('a');assert.equal(reads,2);assert.equal(settings.snapshot('a')?.cache?.authenticationStale,true);assert.equal(settings.snapshot('a')?.cache?.modelsStale,false)
  now+=25*60*1000
  await load('a');assert.equal(reads,2);assert.equal(settings.snapshot('a')?.cache?.modelsStale,true)
  let release!:()=>void
  const gate=new Promise<void>(yes=>{release=yes}),maintenance=host.maintain(()=>gate,async()=>{})
  settings.start('a',{action:'ensure'});assert.equal(reads,2,'Cached views require no maintenance admission')
  assert.throws(()=>settings.start('a',{action:'refresh'}),/任务尚未结束/)
  release();await maintenance
  await load('a','refresh');assert.equal(reads,3);assert.equal(settings.snapshot('a')?.cache?.authenticationStale,false)
  const session=host.create('a'),run=host.enqueue(session.sessionId,'Native check must still run')
  assert.equal((await host.wait(run.runId)).outcome,'failed')
  assert.equal(settings.snapshot('a')?.cache?.authenticationCheckedAt,null);assert.equal(settings.snapshot('a')?.cache?.modelsCheckedAt,null)
  settings.start('a',{action:'ensure'});assert.equal(reads,3,'Failure invalidation never polls or retries a task')
  assert.equal(settings.snapshot('b')?.cache?.authenticationCheckedAt,1000,'Failures invalidate only their owning driver')
  configuration='changed';assert.equal(settings.snapshot('a'),undefined);await load('a');assert.equal(reads,4)
  backends[0].description.baseline='fixture-v2';assert.equal(settings.snapshot('a'),undefined);await load('a');assert.equal(reads,5)
  await settings.close();assert.equal(settings.snapshot('a'),undefined)
  const fresh=new AgentSettingsController({host,backends,onState:()=>{},openExternal:async()=>{}});assert.equal(fresh.snapshot('a'),undefined,'A new Profile/controller cannot inherit cached authentication');await fresh.close()
})

test('Settings mutations replace cache after cleanup; partial failure and cancelled reads never publish fresh readiness',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-settings-cache-mutation-'))
  let authenticated=true,model='first',fail=false,hold=false,release!:()=>void,reads=0
  const backend:AgentBackend={description:{id:'fixture',label:'Fixture',baseline:'fixture',capabilities:{streaming:false,images:false,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:true}},prepare:async()=>assert.fail('No model input'),run:async()=>assert.fail('No model input'),interrupt:async()=>{},respond:async()=>{},close:async()=>{},settings:async request=>{
    reads++;if(request.action==='auth.logout')authenticated=false
    if(request.action==='auth.login')authenticated=true
    if(request.action==='model.select')model=request.modelId
    if(fail)throw new Error('Private credential diagnostic')
    return {...projection,authentication:{state:authenticated?'ready':'required',label:'Fixture'},selectedModel:model}
  },drainSettings:async()=>{if(hold)await new Promise<void>(yes=>{release=yes})}}
  const conversations=new ConversationStore(path.join(root,'sessions.json')),host=new AgentHost({conversations,history:new AgentHistoryStore(path.join(root,'history'),id=>conversations.get(id)),backends:[backend],currentProject:()=>({id:'p',name:'p',directory:root}),context:async()=>'',drain:async()=>{}})
  const settings=new AgentSettingsController({host,backends:[backend],onState:()=>{},openExternal:async()=>{},configurationKey:()=>model})
  t.after(async()=>{hold=false;release?.();await settings.close();await host.close();fs.rmSync(root,{recursive:true,force:true})})
  const load=async(request:Parameters<AgentSettingsController['start']>[1])=>{settings.start('fixture',request);for(let i=0;host.busy&&i<50;i++)await new Promise<void>(yes=>setImmediate(yes));assert.equal(host.busy,false)}
  await load({action:'ensure'});await load({action:'model.select',modelId:'second'});assert.equal(settings.snapshot('fixture')?.value?.selectedModel,'second')
  await load({action:'auth.logout'});assert.equal(settings.snapshot('fixture')?.value?.authentication.state,'required')
  await load({action:'auth.login',methodId:'fixture',values:{apiKey:'secret'}});assert.equal(settings.snapshot('fixture')?.value?.authentication.state,'ready')
  fail=true;await load({action:'auth.logout'});assert.equal(settings.snapshot('fixture')?.value,null)
  assert.equal(settings.snapshot('fixture')?.cache?.authenticationCheckedAt,null);assert.equal(JSON.stringify(settings.snapshot()).includes('credential diagnostic'),false)
  const attempts=reads;settings.start('fixture',{action:'ensure'});assert.equal(reads,attempts,'A failed mutation requires an explicit retry')
  fail=false;hold=true;settings.start('fixture',{action:'refresh'})
  for(let i=0;!release&&i<50;i++)await new Promise<void>(yes=>setImmediate(yes))
  assert.equal(host.busy,true);const cancelling=settings.cancel();release();await cancelling
  assert.equal(settings.snapshot('fixture')?.phase,'failed');assert.equal(settings.snapshot('fixture')?.cache?.authenticationCheckedAt,null,'A cancelled read cannot timestamp a discarded result')
  hold=false;await load({action:'refresh'});assert.equal(settings.snapshot('fixture')?.value?.authentication.state,'required')
})
