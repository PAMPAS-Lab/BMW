import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {PermissionStore} from '../src/permission-store.js'

test('Agent grants/revocation and origin-specific allow/deny decisions survive reload without sharing mutable state', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'bmw-permissions-'));t.after(() => fs.rmSync(root,{recursive:true,force:true}))
  const file = path.join(root,'permissions.json'), store = new PermissionStore(file)
  assert.equal(store.hasAgentControl(), false)
  store.grantAgentControl();store.setSitePermission('https://one.example','media',true);store.setSitePermission('https://two.example','media',false)
  const restored = new PermissionStore(file)
  assert.equal(restored.hasAgentControl(),true)
  assert.equal(restored.getSitePermission('https://one.example','media'),true)
  assert.equal(restored.getSitePermission('https://two.example','media'),false)
  restored.snapshot().sites['https://one.example'].media = false
  assert.equal(restored.getSitePermission('https://one.example','media'),true)
  restored.revokeAgentControl();assert.equal(new PermissionStore(file).hasAgentControl(),false)
  assert.equal(new PermissionStore(file).getSitePermission('https://two.example','media'),false)
})
test('Permission persistence failure leaves the prior file and in-memory grant unchanged', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'bmw-permission-write-'));t.after(() => fs.rmSync(root,{recursive:true,force:true}))
  const file = path.join(root,'permissions.json'), store = new PermissionStore(file)
  store.setSitePermission('https://one.example','media',false)
  const original = fs.readFileSync(file)
  t.mock.method(fs,'renameSync',() => {throw new Error('fixture write failure')})
  assert.throws(() => store.grantAgentControl(), /fixture write failure/)
  assert.equal(store.hasAgentControl(),false);assert.deepEqual(fs.readFileSync(file),original)
})
