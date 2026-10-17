import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {QwenCredentialsStore} from '../src/qwen-credentials-store.js'
import type {CredentialEncryption} from '../src/qwen-credentials-store.js'
function fixture(t:import('node:test').TestContext){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-qwen-secret-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const file=path.join(root,'credentials.enc'),key=crypto.randomBytes(32)
  let available=true,failEncrypt=false,failDecrypt=false,backend='keychain'
  const encryption:CredentialEncryption={isEncryptionAvailable:()=>available,getSelectedStorageBackend:()=>backend,encryptString(text){if(failEncrypt)throw new Error('secret encryption failure');const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data])},decryptString(data){if(failDecrypt)throw new Error('secret decryption failure');const cipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8')}}
  return {file,root,encryption,store:new QwenCredentialsStore(file,encryption),available:(value:boolean)=>available=value,failEncrypt:(value:boolean)=>failEncrypt=value,failDecrypt:(value:boolean)=>failDecrypt=value,backend:(value:string)=>backend=value}
}
const credentials={apiKey:'fixture-private-key-keep-out-of-projections',workspaceId:'fixture-beijing-workspace'}
test('Qwen credentials persist encrypted with private permissions and only a Shell status projection',t=>{
  const f=fixture(t);assert.equal(f.store.status().state,'empty');assert.equal(fs.existsSync(f.file),false)
  const status=f.store.save(credentials),bytes=fs.readFileSync(f.file)
  assert.equal(status.configured,true);assert.equal(Object.hasOwn(status,'apiKey'),false)
  for(const secret of [credentials.apiKey,credentials.workspaceId])assert.equal(bytes.includes(Buffer.from(secret)),false)
  assert.equal(fs.statSync(f.file).mode&0o777,0o600)
  const restored=new QwenCredentialsStore(f.file,f.encryption);assert.deepEqual(restored.read(),credentials)
  restored.save({apiKey:'',workspaceId:'another-workspace'});assert.deepEqual(restored.read(),{...credentials,workspaceId:'another-workspace'})
  assert.equal(fs.readdirSync(f.root).length,1)
})
test('Qwen refuses weak encryption and preserves existing ciphertext on encryption/decryption failures',t=>{
  const f=fixture(t);f.store.save(credentials);const before=fs.readFileSync(f.file)
  f.failEncrypt(true);assert.throws(()=>f.store.save({...credentials,apiKey:'replacement'}),/加密失败/);assert.deepEqual(fs.readFileSync(f.file),before);f.failEncrypt(false)
  f.failDecrypt(true);assert.equal(f.store.status().state,'unreadable');assert.throws(()=>f.store.save(credentials),/原文件已保留/);assert.deepEqual(fs.readFileSync(f.file),before);f.failDecrypt(false)
  for(const backend of ['basic_text','keychain']){
    f.backend(backend);f.available(backend==='basic_text')
    assert.equal(f.store.status().state,'unavailable');assert.throws(()=>f.store.read(),/安全存储不可用/);assert.throws(()=>f.store.save(credentials),/不会以明文/);assert.deepEqual(fs.readFileSync(f.file),before)
  }
  f.store.clear();assert.equal(fs.existsSync(f.file),false)
})
test('Corrupt or linked Qwen ciphertext remains intact until explicit clear; secrets and arbitrary endpoints are rejected',t=>{
  const f=fixture(t);fs.writeFileSync(f.file,'corrupt encrypted bytes');assert.equal(f.store.status().state,'unreadable');assert.throws(()=>f.store.save(credentials));assert.equal(fs.readFileSync(f.file,'utf8'),'corrupt encrypted bytes')
  f.store.clear();f.store.save(credentials);const before=fs.readFileSync(f.file)
  for(const raw of [{...credentials,apiKey:'bad\nkey'},{...credentials,workspaceId:'evil.test/path'},{...credentials,endpoint:'https://evil.test'},{apiKey:'',workspaceId:'workspace'}]){
    if(raw.apiKey==='')continue // Blank preserves a previously stored Key.
    assert.throws(()=>f.store.save(raw));assert.deepEqual(fs.readFileSync(f.file),before)
  }
  const target=path.join(f.root,'preserved');fs.writeFileSync(target,'original');fs.rmSync(f.file);fs.symlinkSync(target,f.file)
  assert.equal(f.store.status().state,'unreadable');assert.throws(()=>f.store.save(credentials));assert.equal(fs.readFileSync(target,'utf8'),'original')
  f.store.clear();assert.equal(fs.readFileSync(target,'utf8'),'original');assert.throws(()=>f.store.save({apiKey:'',workspaceId:'workspace'}))
})
