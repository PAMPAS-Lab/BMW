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
  const host=new AgentHost({conversations:new ConversationStore(path.join(root,'index.json')),history:new AgentHistoryStore(path.join(root,'history')),backends:[backend],currentProject:()=>({id:'p',name:'Fixture',directory:root}),context:async()=>'',drain:async()=>{}})
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
  const host=new AgentHost({conversations:new ConversationStore(path.join(root,'index.json')),history:new AgentHistoryStore(path.join(root,'history')),backends:[backend],currentProject:()=>({id:'p',name:'Fixture',directory:root}),context:async()=>'',drain:async()=>{}})
  const settings=new AgentSettingsController({host,backends:[backend],openExternal:async()=>{},onState:()=>{if(settings.snapshot()?.phase==='failed')changed()}})
  t.after(async()=>{await settings.close();await host.close();fs.rmSync(root,{recursive:true,force:true})})
  settings.start('fixture',{action:'refresh'});await terminal
  assert.equal(host.resourcesDisconnected,true);assert.equal(host.busy,true);assert.throws(()=>settings.start('fixture',{action:'refresh'}),/active BMW/)
  await host.recover();assert.equal(reads,1);assert.equal(drains,2);assert.equal(host.busy,false)
})
test('Model preferences survive Project selection writes and stay separate for every driver',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-model-preferences-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const file=path.join(root,'preferences.json'),store=new AgentPreferenceStore(file,'dsh')
  store.setModel('codex','model-c');store.setModel('qoder-cn','model-q');store.set('p','qoder-cn')
  const restored=new AgentPreferenceStore(file,'dsh');assert.equal(restored.model('codex'),'model-c');assert.equal(restored.model('qoder-cn'),'model-q');assert.equal(restored.get('p'),'qoder-cn')
})
