import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type {AgentBackend,AgentLegacySession} from '@bmw-agent/agent-contract'
import {AgentHost} from '../src/agent-host.js'
import {AgentHistoryStore} from '../src/agent-history-store.js'
import {ConversationStore} from '../src/conversation-store.js'
import {LegacyConversationMigration} from '../src/legacy-conversation-migration.js'
import {loadAssistantStores} from '../src/assistant-service.js'
import {StateLoadError} from '../src/state-load.js'

function source(externalSessionId='old-owner',parentExternalSessionId:string|null=null):AgentLegacySession {
  return {projectId:'project',externalSessionId,parentExternalSessionId,title:'Original conversation',createdAt:1,updatedAt:10,archived:false,selected:externalSessionId==='old-owner',throughSequence:9,messages:[{id:'display-'+externalSessionId,role:'user',text:'Existing human prompt',createdAt:2,complete:true}]}
}
function fixture(t:{after(callback:()=>Promise<void>):void},read:()=>Promise<AgentLegacySession[]>,drain:()=>Promise<void>=async()=>{}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-legacy-migration-'))
  const conversations=new ConversationStore(path.join(root,'sessions.json')),history=new AgentHistoryStore(path.join(root,'history'))
  const backend:AgentBackend={description:{id:'dsh',label:'DSH',baseline:'fixture',capabilities:{streaming:false,images:true,interrupt:true,steer:false,fork:false,approvals:false,nativeOpen:false,browserOnly:true}},prepare:async()=>{assert.fail('Migration must not prepare model input')},run:async()=>{assert.fail('Migration must not run the Agent')},interrupt:async()=>{},respond:async()=>{},close:async()=>{},readLegacySessions:read,drainLegacy:drain}
  const other:AgentBackend={...backend,description:{...backend.description,id:'codex'},readLegacySessions:undefined,drainLegacy:undefined}
  const host=new AgentHost({conversations,history,backends:[backend,other],currentProject:()=>({id:'project',name:'Disposable',directory:root}),context:async()=>'',drain:async()=>{}})
  const migration=new LegacyConversationMigration({host,conversations,history,backends:[backend,other],projects:()=>[{id:'project',name:'Disposable',directory:root,workspaceId:'old-workspace',sessionId:'old-owner'}],onState(){}})
  t.after(async()=>{await migration.close();await host.close();fs.rmSync(root,{recursive:true,force:true})})
  return {root,conversations,history,host,migration}
}
test('legacy history/ownership/lineage/archive survive migration and repeated startup without fabricated input receipts',async t=>{
  const parent=source('old-parent'),child=source('old-owner','old-parent'),archived={...source('old-archive'),archived:true}
  const f=fixture(t,async()=>[parent,child,archived])
  await f.migration.start()
  assert.equal(f.migration.snapshot()[0].state,'complete')
  assert.equal(f.conversations.get('old-owner').externalSessionId,'old-owner')
  assert.equal(f.conversations.get('old-owner').parentSessionId,'old-parent')
  assert.equal(f.conversations.get('old-owner').legacyImportPending,undefined)
  assert.equal(f.conversations.selected('project','dsh'),'old-owner')
  assert.ok(f.conversations.get('old-archive').archivedAt)
  assert.equal(f.history.snapshot('old-owner').receipts.length,0)
  assert.equal(f.history.snapshot('old-owner').messages[0].text,'Existing human prompt')
  const revision=f.history.snapshot('old-owner').revision
  await f.migration.retry('dsh')
  assert.equal(f.history.snapshot('old-owner').revision,revision)
  const reopened=new ConversationStore(path.join(f.root,'sessions.json'))
  assert.equal(reopened.get('old-owner').parentSessionId,'old-parent')
  assert.equal(new AgentHistoryStore(path.join(f.root,'history')).snapshot('old-owner').legacyImport?.throughSequence,9)
})
test('native read failure preserves the old owner and blocks only its input until explicit retry',async t=>{
  let available=false
  const f=fixture(t,async()=>{if(!available)throw new Error('Native history unavailable');return [source()]})
  await f.migration.start()
  assert.equal(f.migration.snapshot()[0].state,'failed')
  assert.equal(f.conversations.selected('project','dsh'),'old-owner')
  assert.equal(f.conversations.get('old-owner').legacyImportPending,true)
  assert.throws(()=>f.host.enqueue('old-owner','Must not be replayed'),/Restore this legacy/)
  assert.equal(f.history.snapshot('old-owner').receipts.length,0)
  assert.equal(f.host.create('codex').driverId,'codex')
  available=true;await f.migration.retry('dsh')
  assert.equal(f.conversations.get('old-owner').legacyImportPending,undefined)
})
test('crash between display-history commit and index completion finishes the original frozen import without overwriting it',async t=>{
  let newer=false
  const f=fixture(t,async()=>[newer?{...source(),title:'Later native title',throughSequence:12,messages:[{...source().messages[0],text:'Later native history'}]}:source()])
  const complete=f.conversations.completeLegacy.bind(f.conversations)
  f.conversations.completeLegacy=()=>{throw new Error('Simulated index write failure')}
  await f.migration.start()
  assert.equal(f.conversations.get('old-owner').legacyImportPending,true)
  assert.equal(f.history.snapshot('old-owner').legacyImport?.throughSequence,9)
  f.conversations.completeLegacy=complete;newer=true
  await f.migration.retry('dsh')
  assert.equal(f.conversations.get('old-owner').title,'Original conversation')
  assert.equal(f.history.snapshot('old-owner').messages[0].text,'Existing human prompt')
  assert.equal(f.history.snapshot('old-owner').legacyImport?.throughSequence,9)
})
test('native cleanup failure holds resource exclusion; recovery drains only and never reruns discovery or inputs',async t=>{
  let reads=0,drains=0
  const f=fixture(t,async()=>{reads++;return [source()]},async()=>{drains++;if(drains===1)throw new Error('Native cleanup failed')})
  await f.migration.start()
  assert.equal(f.host.busy,true);assert.equal(f.host.resourcesDisconnected,true)
  assert.throws(()=>f.host.create('codex'),/maintenance/)
  await assert.rejects(f.migration.retry('dsh'),/Finish native cleanup/)
  await f.host.recover()
  assert.equal(f.host.busy,false);assert.equal(f.host.resourcesDisconnected,false)
  assert.equal(reads,1);assert.equal(drains,2)
  assert.equal(f.history.snapshot('old-owner').receipts.length,0)
})
test('foreign or missing native records never replace the preserved saved Session',async t=>{
  let foreign=true
  const f=fixture(t,async()=>foreign?[{...source(),projectId:'foreign'}]:[])
  await f.migration.start()
  assert.equal(f.conversations.all().length,1)
  assert.equal(f.conversations.get('old-owner').projectId,'project')
  assert.equal(f.conversations.get('old-owner').legacyImportPending,true)
  foreign=false
  await assert.rejects(f.migration.retry('dsh'),/not returned/)
  assert.equal(f.conversations.all().length,1)
})
test('saved legacy source/binding mismatch blocks startup before interrupted-state recovery can write',async t=>{
  const f=fixture(t,async()=>[source()])
  await f.migration.start()
  const file=path.join(f.root,'sessions.json'),productionIndex=path.join(f.root,'agent-conversations.json')
  f.conversations.setStatus('old-owner','running')
  fs.copyFileSync(file,productionIndex)
  const historyFile=fs.readdirSync(path.join(f.root,'history')).find(name=>name.endsWith('.json'))!
  const fullPath=path.join(f.root,'history',historyFile),raw=JSON.parse(fs.readFileSync(fullPath,'utf8'))
  raw.legacyImport.source.projectId='foreign';fs.writeFileSync(fullPath,JSON.stringify(raw))
  fs.renameSync(path.join(f.root,'history'),path.join(f.root,'agent-history'))
  const before=fs.readFileSync(productionIndex,'utf8')
  assert.throws(()=>loadAssistantStores(f.root,'dsh'),StateLoadError)
  assert.equal(fs.readFileSync(productionIndex,'utf8'),before)
})
