import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-assistant-default-')))
console.log('Default Assistant evidence: '+root)
for(const phase of ['create','restore']){
  const result=spawnSync(process.execPath,['scripts/run-electron-script.js','scripts/assistant-default-case.js'],{
    cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,BMW_ASSISTANT_DEFAULT_ROOT:root,BMW_ASSISTANT_DEFAULT_PHASE:phase},stdio:'inherit',timeout:90000
  })
  assert.equal(result.error,undefined,'Default entry process must terminate: '+phase)
  assert.equal(result.status,0,'Default entry phase failed: '+phase)
}
console.log('PASS production entry: independent three-driver Sessions, scoped Studio, missing auth/install, fixed schedule binding and process restart')
