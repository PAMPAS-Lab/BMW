import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {GridPrecomposer,inspectGridProxy} from '../src/precomposition.js'
import {assertGridRecipe,gridRowComposition} from '../src/precomposition-contract.js'
import {assertLayerComposition} from '../src/composition-layers.js'
const recipe={version:1,layout:'grid',rows:4,columns:4,width:1280,height:720,fps:12,durationSeconds:2,audio:'mute',inputs:Array.from({length:16},(_,i)=>({artifactId:'source-'+i+'.mp4',sourceStartSeconds:i,playbackRate:1}))}
function fixture(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-grid-')));for(const input of recipe.inputs)fs.writeFileSync(path.join(root,input.artifactId),'source-'+input.artifactId);return {root,close:()=>fs.rmSync(root,{recursive:true,force:true})}}
test('Sixteen-cell proxies use sequential four-decoder blocks with explicit source intervals, identity and audio policy',async()=>{
 const r=assertGridRecipe(recipe),f=fixture();let runs=0
 try{for(let row=0;row<4;row++){const c=gridRowComposition(r,row);assertLayerComposition(c);assert.equal(c.scenes[0].layers?.length,4);assert.equal(c.height,720);assert.equal(c.scenes[0].audioTracks?.length,0);assert.equal(c.scenes[0].layers?.[0].sourceStartSeconds,[0,2,8,10][row]);const crop={x:0,y:0,width:.25,height:.25},cropped=assertGridRecipe({...r,inputs:r.inputs.map(i=>({...i,sourceCrop:crop}))});assert.deepEqual(gridRowComposition(cropped,row).scenes[0].layers?.[0].sourceCrop,crop)}
 const native=new GridPrecomposer(async c=>{assertLayerComposition(c);const artifactId='output-'+(++runs)+'.mp4';fs.writeFileSync(path.join(f.root,artifactId),'native-output');return {artifactId,durationSeconds:2}}),output=await native.run(recipe,f.root);assert.equal(runs,5);assert.equal(output.fps,12);assert.equal(output.width,1280);assert.equal(output.height,720);assert.equal(output.durationSeconds,2);assert.equal(output.metrics.audioPolicy,'mute');assert.equal(native.busy,false);assert.equal(fs.readdirSync(f.root).filter(s=>s.startsWith('output-')).length,1)
 assert.equal((await inspectGridProxy(f.root,output.recipeArtifactId)).state,'current');fs.writeFileSync(path.join(f.root,recipe.inputs[7].artifactId),'changed');const stale=await inspectGridProxy(f.root,output.recipeArtifactId);assert.equal(stale.state,'stale');assert.equal(stale.stale[0].artifactId,recipe.inputs[7].artifactId);await native.discard(output.cacheKey);assert.equal(fs.existsSync(path.join(f.root,output.artifactId)),false);assert.equal(fs.existsSync(path.join(f.root,output.recipeArtifactId)),false);assert.equal(fs.existsSync(path.join(f.root,recipe.inputs[7].artifactId)),true)
 for(const bad of [{...recipe,rows:5},{...recipe,width:1920},{...recipe,durationSeconds:31},{...recipe,audio:'all'},{...recipe,inputs:[{...recipe.inputs[0],path:'/etc/passwd'}]},{...recipe,rows:3,columns:3}])assert.throws(()=>assertGridRecipe(bad))
 }finally{f.close()}
})
test('Proxy cancellation waits for owned native work and removes only intermediate/output artifacts; directory replacement quarantines cleanup',async()=>{
 const f=fixture(),controller=new AbortController();try{const before=fs.readdirSync(f.root).sort();let nativeFinished=false;const native=new GridPrecomposer(async()=>{fs.writeFileSync(path.join(f.root,'owned.mp4'),'partial native output');controller.abort(new Error('cancel-grid'));await new Promise<void>(r=>setTimeout(r,10));nativeFinished=true;return {artifactId:'owned.mp4',durationSeconds:2}});await assert.rejects(native.run(recipe,f.root,controller.signal),/cancel-grid/);assert.equal(nativeFinished,true);assert.equal(native.busy,false);assert.deepEqual(fs.readdirSync(f.root).sort(),before)
 const moved=f.root+'-saved',quarantined=new GridPrecomposer(async()=>{fs.renameSync(f.root,moved);fs.mkdirSync(f.root);return {artifactId:'missing.mp4',durationSeconds:2}})
 await assert.rejects(quarantined.run(recipe,f.root),/quarantined/);assert.equal(quarantined.busy,true);await assert.rejects(quarantined.recoverCleanup(),/directory changed/);fs.rmdirSync(f.root);fs.renameSync(moved,f.root);await quarantined.recoverCleanup();assert.equal(quarantined.busy,false)
 }finally{f.close()}
})
