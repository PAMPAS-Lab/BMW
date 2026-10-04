import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EventEmitter} from 'node:events'
import test from 'node:test'
import type {TestContext} from 'node:test'
import {SessionContinuityManager} from '../src/session-continuity.js'
import {StateLoadError} from '../src/state-load.js'

class Cookies extends EventEmitter {
  values: Record<string, unknown>[] = []
  async get() {return structuredClone(this.values)}
  async set(value: Record<string, unknown>) {this.values.push({...value, domain: new URL(String(value.url)).hostname, hostOnly: true, session: true})}
}
function fixture(t: TestContext) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-continuity-state-'))
  const configPath=path.join(root,'continuity.json'),snapshotPath=path.join(root,'cookies.enc'),cookies=new Cookies()
  let encryptionAvailable=true, networkCalls=0
  const encrypt=(text:string)=>Buffer.from('fixture:'+text)
  const manager=new SessionContinuityManager({session:{cookies,flushStorageData(){},async fetch(){networkCalls++;throw new Error('Unexpected fixture network')}},
    safeStorage:{isEncryptionAvailable:()=>encryptionAvailable,encryptString:encrypt,decryptString(value:Buffer){if(!value.toString().startsWith('fixture:'))throw new Error('Fixture decryption failed');return value.toString().slice(8)}},configPath,snapshotPath,onState:undefined})
  const valid=()=>{fs.writeFileSync(configPath,JSON.stringify({sites:{}}));fs.writeFileSync(snapshotPath,encrypt(JSON.stringify({version:1,cookies:[]})))}
  const bytes=()=>[fs.readFileSync(configPath),fs.readFileSync(snapshotPath)]
  t.after(async()=>{await manager.stop().catch(()=>{});fs.rmSync(root,{recursive:true,force:true})})
  return {manager,cookies,configPath,snapshotPath,encrypt,valid,bytes,setEncryption:(value:boolean)=>{encryptionAvailable=value},networkCalls:()=>networkCalls}
}
test('Unreadable login configuration or ciphertext blocks background saves and leaves original bytes intact', async t => {
  for(const kind of ['config-json','config-shape','snapshot-decryption','snapshot-version','snapshot-cookie']){
    const f=fixture(t);f.valid()
    if(kind==='config-json')fs.writeFileSync(f.configPath,'{invalid existing config')
    if(kind==='config-shape')fs.writeFileSync(f.configPath,'{"sites":[]}')
    if(kind==='snapshot-decryption')fs.writeFileSync(f.snapshotPath,'preserved ciphertext')
    if(kind==='snapshot-version')fs.writeFileSync(f.snapshotPath,f.encrypt('{"version":999,"cookies":[]}'))
    if(kind==='snapshot-cookie')fs.writeFileSync(f.snapshotPath,f.encrypt('{"version":1,"cookies":[{}]}'))
    const original=f.bytes()
    assert.throws(()=>f.manager.load(),StateLoadError,kind)
    await assert.rejects(f.manager.initialize(),StateLoadError)
    await assert.rejects(f.manager.runKeepalives(),StateLoadError)
    await assert.rejects(f.manager.captureSnapshot(),StateLoadError)
    await assert.rejects(f.manager.setForUrl('https://one.example',true),StateLoadError)
    assert.throws(()=>f.manager.saveConfig(),StateLoadError)
    assert.throws(()=>f.manager.saveSnapshot(),StateLoadError)
    assert.deepEqual(f.bytes(),original);assert.equal(f.networkCalls(),0);assert.equal(f.cookies.listenerCount('changed'),0)
  }
})
test('Login-state read failures preserve both files and explicit repair/reload resumes initialization', async t => {
  const f=fixture(t);f.valid();const original=f.bytes(),read=fs.readFileSync
  t.mock.method(fs,'readFileSync',(file,...args)=>{if(String(file)===f.snapshotPath)throw Object.assign(new Error('fixture read failure'),{code:'ETIMEDOUT'});return Reflect.apply(read,fs,[file,...args])})
  assert.throws(()=>f.manager.load(),StateLoadError)
  t.mock.restoreAll();assert.deepEqual(f.bytes(),original)
  await assert.rejects(f.manager.captureSnapshot(),StateLoadError)
  f.manager.load();await f.manager.initialize()
  assert.equal(f.cookies.listenerCount('changed'),1)
  await f.manager.setForUrl('https://one.example',true)
  assert.equal(f.manager.status('https://one.example').enabled,true)
})
test('Encryption becoming available never replaces a snapshot that could not be decrypted', async t => {
  const f=fixture(t);f.valid();fs.writeFileSync(f.snapshotPath,'unreadable original ciphertext');const original=f.bytes()
  f.setEncryption(false);f.manager.load();await f.manager.initialize();assert.deepEqual(f.bytes(),original)
  await f.manager.runKeepalives();assert.deepEqual(f.bytes(),original)
  f.setEncryption(true);await assert.rejects(f.manager.setForUrl('https://one.example',true),StateLoadError)
  await assert.rejects(f.manager.captureSnapshot(),StateLoadError)
  await assert.rejects(f.manager.runKeepalives(),StateLoadError);assert.deepEqual(f.bytes(),original)
})
test('Valid legacy login configuration and encrypted cookies restore without rewriting files; missing files initialize safely', async t => {
  const f=fixture(t)
  f.manager.load();assert.equal(fs.existsSync(f.configPath),false);assert.equal(fs.existsSync(f.snapshotPath),false)
  fs.writeFileSync(f.configPath,JSON.stringify({sites:{'https://one.example':{keepalive:false}}}))
  fs.writeFileSync(f.snapshotPath,f.encrypt(JSON.stringify({version:1,cookies:[{origin:'https://one.example',name:'sid',value:'fixture-value',domain:'one.example',path:'/',hostOnly:true,session:true,secure:true,httpOnly:true,sameSite:'lax'}]})))
  const original=f.bytes();f.manager.load();await f.manager.initialize()
  assert.equal(f.cookies.values.length,1);assert.equal(f.cookies.values[0].name,'sid');assert.deepEqual(f.bytes(),original)
})

test('Encryption becoming available restores valid saved cookies before a background capture can replace them',async t=>{
 const f=fixture(t)
 fs.writeFileSync(f.configPath,JSON.stringify({sites:{'https://one.example':{keepalive:false}}}))
 fs.writeFileSync(f.snapshotPath,f.encrypt(JSON.stringify({version:1,cookies:[{origin:'https://one.example',name:'sid',value:'preserved-late-cookie',domain:'one.example',path:'/',hostOnly:true,session:true,secure:true,httpOnly:true,sameSite:'lax'}]})))
 f.setEncryption(false);f.manager.load();await f.manager.initialize();assert.equal(f.cookies.values.length,0)
 f.setEncryption(true);await f.manager.captureSnapshot()
 assert.equal(f.cookies.values[0].value,'preserved-late-cookie')
 const snapshot=JSON.parse(fs.readFileSync(f.snapshotPath,'utf8').slice(8))
 assert.equal(snapshot.cookies[0].value,'preserved-late-cookie')
})

test('Periodic login maintenance handles late decryption failure without an unhandled rejection or write',async t=>{
 const f=fixture(t);f.valid();fs.writeFileSync(f.snapshotPath,'preserved unreadable encrypted snapshot')
 const original=f.bytes(),errors:string[]=[]
 t.mock.method(console,'error',(...args:unknown[])=>{errors.push(String(args[0]))})
 t.mock.timers.enable({apis:['setInterval']})
 f.setEncryption(false);f.manager.load();await f.manager.initialize();f.setEncryption(true)
 t.mock.timers.tick(60_000);await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(errors,['Failed to maintain saved login state']);assert.deepEqual(f.bytes(),original)
 await f.manager.stop();t.mock.timers.reset()
})
