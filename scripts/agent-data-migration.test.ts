import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {planAgentDataMigration,applyAgentDataMigration} from './agent-data-migration.js'
import type {DshMigrationSource} from '@bmw-agent/harness-dsh/migration'
import {parseConversationState,parseAgentHistory} from '@bmw-agent/platform/agent-data'
import {requireCurrentAgentData,acquireAgentDataLock} from '../packages/platform/src/agent-data-format.js'
function save(file:string,value:unknown):void{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value)+'\n')}
function load(file:string):Record<string,unknown>{return JSON.parse(fs.readFileSync(file,'utf8'))}
function historyName(id:string):string{return crypto.createHash('sha256').update(id).digest('hex')+'.json'}
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-migration-test-')),profile=path.join(root,'profile'),active=path.join(root,'active'),archived=path.join(root,'archived')
  fs.mkdirSync(active);fs.mkdirSync(archived)
  const projects=[{id:'active',name:'Active',directory:active,homeUrl:'',tabState:{urls:[],activeUrl:null},createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',archivedAt:null,agentBindings:{dsh:{workspaceId:'native-active',sessionId:'old-dsh'}}},{id:'archived',name:'Archived',directory:archived,homeUrl:'',tabState:{urls:[],activeUrl:null},createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z',archivedAt:'2026-01-02T00:00:00.000Z',agentBindings:{dsh:{workspaceId:'native-removed',sessionId:'archived-dsh'}}}]
  save(path.join(profile,'projects.json'),{version:1,activeProjectId:'active',initialSetupPending:false,projects})
  save(path.join(profile,'global-settings.json'),{version:1,theme:'dark',agentSidebarVisible:true,edgeNarrationEnabled:false})
  save(path.join(profile,'agent-preferences.json'),{version:1,selections:[{projectId:'active',driverId:'codex'}],models:[{driverId:'codex',modelId:'gpt-6.1-sol'}]})
  const messages=[{id:'old-message',role:'assistant',text:'Saved BMW display history after import',createdAt:2,complete:true}]
  const sources:DshMigrationSource[]=[{projectId:'active',externalSessionId:'old-dsh',parentExternalSessionId:null,title:'Old',createdAt:1,updatedAt:2,archived:false,selected:true,throughSequence:2,messages:[{id:'native-message',role:'assistant',text:'Frozen native display',createdAt:2,complete:true}]},{projectId:'archived',externalSessionId:'archived-dsh',parentExternalSessionId:null,title:'Archived',createdAt:1,updatedAt:2,archived:false,selected:true,throughSequence:2,messages:[]}]
  const conversations=[{sessionId:'old-dsh',projectId:'active',driverId:'dsh',externalSessionId:'old-dsh',title:'Old',createdAt:1,updatedAt:2,archivedAt:null,parentSessionId:null,status:'idle'},{sessionId:'bmw-codex',projectId:'active',driverId:'codex',externalSessionId:'native-codex',title:'Codex',createdAt:1,updatedAt:2,archivedAt:null,parentSessionId:null,status:'idle'}]
  save(path.join(profile,'agent-conversations.json'),{version:1,revision:8,conversations,selections:[{projectId:'active',driverId:'dsh',sessionId:'old-dsh'},{projectId:'active',driverId:'codex',sessionId:'bmw-codex'}]})
  const {messages:_messages,...source}=sources[0]
  save(path.join(profile,'agent-history',historyName('old-dsh')),{version:1,sessionId:'old-dsh',revision:4,events:[],messages,interactions:[],receipts:[],legacyImport:{driverId:'dsh',externalSessionId:'old-dsh',throughSequence:2,source}})
  save(path.join(profile,'agent-history',historyName('bmw-codex')),{version:1,sessionId:'bmw-codex',revision:0,events:[],messages:[],interactions:[],receipts:[]})
  save(path.join(active,'video-studio','draft.json'),{id:'draft',ownerSessionId:'old-dsh',scenes:[]})
  fs.mkdirSync(path.join(active,'artifacts'));fs.writeFileSync(path.join(active,'artifacts','media.png'),'unchanged media')
  return {root,profile,active,archived,sources,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})}
}

test('Explicit migration preserves display history, stable owners and native anchors including removed archived Workspaces',()=>{
  const f=fixture()
  try{
    const draft=fs.readFileSync(path.join(f.active,'video-studio','draft.json')),media=fs.readFileSync(path.join(f.active,'artifacts','media.png'))
    const plan=planAgentDataMigration(f.profile,f.sources)
    assert.equal(plan.report.importedSessions,1);assert.equal(plan.report.drafts,1)
    applyAgentDataMigration(plan,path.join(f.root,'backup'))
    const index=parseConversationState(load(path.join(f.profile,'agent-conversations.json')))
    assert.deepEqual(index.conversations.map(row=>row.sessionId),['old-dsh','bmw-codex','archived-dsh'])
    assert.equal(index.conversations[1].externalSessionId,'native-codex');assert.notEqual(index.conversations[2].archivedAt,null)
    const history=parseAgentHistory(load(path.join(f.profile,'agent-history',historyName('old-dsh'))),'old-dsh')
    assert.equal(history.messages[0].text,'Saved BMW display history after import');assert.deepEqual(history.receipts,[])
    assert.deepEqual(history.owner,{projectId:'active',driverId:'dsh',externalSessionId:'old-dsh'})
    assert.equal('legacyImport' in history,false)
    assert.deepEqual(fs.readFileSync(path.join(f.active,'video-studio','draft.json')),draft)
    assert.deepEqual(fs.readFileSync(path.join(f.active,'artifacts','media.png')),media)
    assert.deepEqual(load(path.join(f.profile,'agent-preferences.json')).models,[{driverId:'codex',modelId:'gpt-6.1-sol'}])
    requireCurrentAgentData(f.profile)
    assert.equal(planAgentDataMigration(f.profile,[]).report.alreadyCurrent,true)
    assert.equal(planAgentDataMigration(f.profile,[]).changes.size,0)
  }finally{f.cleanup()}
})

test('Migration rejects missing native anchors and foreign Studio ownership before any state writes',()=>{
  const f=fixture()
  try{
    const before=fs.readFileSync(path.join(f.profile,'projects.json'))
    assert.throws(()=>planAgentDataMigration(f.profile,[f.sources[0]]),/matching native history/)
    save(path.join(f.active,'video-studio','draft.json'),{id:'draft',ownerSessionId:'foreign',scenes:[]})
    assert.throws(()=>planAgentDataMigration(f.profile,f.sources),/Studio draft ownership/)
    assert.deepEqual(fs.readFileSync(path.join(f.profile,'projects.json')),before)
    assert.equal(fs.existsSync(path.join(f.profile,'agent-data-version.json')),false)
  }finally{f.cleanup()}
})

test('Failed multi-file migration restores original bytes and leaves the old Profile requiring explicit migration',()=>{
  const f=fixture()
  try{
    const plan=planAgentDataMigration(f.profile,f.sources),before=new Map([...plan.changes].map(([file,row])=>[file,row.before.content]))
    assert.throws(()=>applyAgentDataMigration(plan,path.join(f.root,'backup'),{afterWrite:(_file,index)=>{if(index===3)throw new Error('simulated write failure')}}),/original state restored/)
    for(const [file,content]of before)content?assert.deepEqual(fs.readFileSync(file),content):assert.equal(fs.existsSync(file),false)
    assert.equal(load(path.join(f.root,'backup','manifest.json')).status,'rolled-back')
    assert.throws(()=>requireCurrentAgentData(f.profile),/explicit migration/)
  }finally{f.cleanup()}
})

test('Migration detects stale plans and rollback preserves a concurrent edit rather than overwriting it',()=>{
  const f=fixture()
  try{
    const plan=planAgentDataMigration(f.profile,f.sources),file=path.join(f.profile,'projects.json')
    const original=fs.readFileSync(file);fs.appendFileSync(file,' ')
    assert.throws(()=>applyAgentDataMigration(plan,path.join(f.root,'stale-backup')),/State changed/)
    assert.equal(fs.existsSync(path.join(f.root,'stale-backup')),false)
    fs.writeFileSync(file,original)
    assert.throws(()=>applyAgentDataMigration(plan,path.join(f.root,'backup'),{afterWrite:(written,index)=>{if(index===1)fs.writeFileSync(written,'concurrent edit');if(index===2)throw new Error('failed')}}),/concurrent changes preserved/)
    assert.equal(fs.readFileSync(file,'utf8'),'concurrent edit')
    assert.equal(load(path.join(f.root,'backup','manifest.json')).status,'rollback-conflict')
  }finally{f.cleanup()}
})

test('Current Profile creation and mutation locks never silently accept or initialize an old Profile',()=>{
  const f=fixture()
  try{
    assert.throws(()=>requireCurrentAgentData(f.profile),/explicit migration/)
    const release=acquireAgentDataLock(f.profile)
    assert.throws(()=>acquireAgentDataLock(f.profile),/Profile is in use/)
    release()
    const fresh=path.join(f.root,'fresh');requireCurrentAgentData(fresh)
    assert.deepEqual(load(path.join(fresh,'agent-data-version.json')),{version:2})
  }finally{f.cleanup()}
})

test('Explicit migration preserves native-only selection, infers schedule driver from BMW ownership and detaches credential links',()=>{
 const f=fixture()
 try{
  const index=load(path.join(f.profile,'agent-conversations.json'));index.selections=[];save(path.join(f.profile,'agent-conversations.json'),index)
  save(path.join(f.profile,'scheduled-tasks.json'),{version:1,tasks:[{id:'daily',projectId:'active',sessionId:'bmw-codex',name:'Daily',prompt:'Read only',enabled:true,schedule:{kind:'daily',time:'09:00',timeZone:'UTC'}}],runs:[]})
  const source=path.join(f.root,'source-credentials');fs.writeFileSync(source,'synthetic private credentials',{mode:0o600});fs.mkdirSync(path.join(f.profile,'dsh-home'))
  const credential=path.join(f.profile,'dsh-home','.credentials.yaml');fs.symlinkSync(source,credential)
  applyAgentDataMigration(planAgentDataMigration(f.profile,f.sources),path.join(f.root,'backup'))
  const next=parseConversationState(load(path.join(f.profile,'agent-conversations.json')))
  assert.ok(next.selections.some(row=>row.driverId==='dsh'&&row.sessionId==='old-dsh'))
  assert.equal((load(path.join(f.profile,'scheduled-tasks.json')).tasks as {driverId:string}[])[0].driverId,'codex')
  assert.equal(fs.lstatSync(credential).isSymbolicLink(),false);assert.equal(fs.statSync(credential).mode&0o777,0o600)
  fs.writeFileSync(credential,'synthetic new login');assert.equal(fs.readFileSync(source,'utf8'),'synthetic private credentials')
 }finally{f.cleanup()}
})

test('Migration refuses to overwrite an existing different harness Workspace mapping',()=>{
 const f=fixture()
 try{
  const file=path.join(f.profile,'dsh-home','bmw-project-bindings.json')
  save(file,{version:2,bindings:[{projectId:'active',workspaceId:'wrong-native',directory:f.active}]})
  const before=fs.readFileSync(file)
  assert.throws(()=>planAgentDataMigration(f.profile,f.sources),/Workspace mapping differs/)
  assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.existsSync(path.join(f.profile,'agent-data-version.json')),false)
 }finally{f.cleanup()}
})
