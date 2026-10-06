import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {DshProjectBindings} from '../src/project-bindings.js'
test('DSH owns immutable native Workspace mappings while BMW Projects retain only their own identity',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-dsh-bindings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const file=path.join(root,'dsh-home','bmw-project-bindings.json'),project={id:'bmw-project',name:'Project',directory:root},bindings=new DshProjectBindings(file)
 assert.deepEqual(bindings.project(project),project);assert.equal(fs.existsSync(file),false)
 bindings.remember(project,'native-workspace')
 assert.equal(new DshProjectBindings(file).project(project).workspaceId,'native-workspace')
 assert.throws(()=>bindings.remember(project,'replacement'),/cannot replace/)
 const foreign=path.join(root,'foreign');fs.mkdirSync(foreign)
 assert.throws(()=>bindings.project({...project,directory:foreign}),/directory differs/)
 assert.equal('workspaceId' in project,false)
 const stale=new DshProjectBindings(file);bindings.remember({...project,id:'second'},'native-second')
 assert.throws(()=>stale.remember({...project,id:'third'},'native-third'),/another process/)
})
