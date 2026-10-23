import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {Ajv2020} from 'ajv/dist/2020.js'
import {VideoStudioStore} from '../src/studio-store.js'
import {newStudioScene} from '../src/studio-contract.js'
import {prepareSceneReferences} from '../src/scene-reference-preparation.js'
import {referenceCoverageGap} from '../src/reference-coverage.js'
import {assertReferenceRecords,assertReferenceCapacity,REFERENCE_LIMITS} from '../src/studio-reference-contract.js'
import type {StudioReferenceRecord} from '../src/studio-reference-contract.js'
import {assertNewsPreparationRequest,newsPreparationRequestSchema} from '../src/news-preparation-contract.js'
import type {StudioKernel} from '../src/studio-service.js'
const sha=(b:string)=>crypto.createHash('sha256').update(b).digest('hex')
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-scene-references-'))),directory=path.join(root,'artifacts');fs.mkdirSync(directory)
 const owner={projectId:'p',sessionId:'s'},store=new VideoStudioStore(root,owner.sessionId);let draft=store.create('Current original draft'),sequence=0,frames=0,mode:'normal'|'early'|'cas'|'cancel'|'source'='normal',controller:AbortController|undefined
 for(const id of ['a','b','c','d','e'])fs.writeFileSync(path.join(directory,id+'.mp4'),'controlled '+id)
 const old:StudioReferenceRecord[]=Array.from({length:7},(_,index)=>{const sourceArtifactId=['a','b','c','d','e','a','a'][index]+'.mp4',times=index===5?[0,2.5,5,7.5,10.5]:index===6?[0,2.5,5,7.5,10.5,12]:[0,7,13.95];return {id:'old-'+index,sourceArtifactId,sourceSha256:sha('controlled '+sourceArtifactId[0]),sourceBytes:12,kind:'video',width:640,height:360,durationSeconds:20,createdAt:'2026-10-23T00:00:00Z',revision:1,videoRange:{startSeconds:0,endSeconds:20},frames:times.map((seconds,i)=>{const artifactId='old-'+index+'-'+i+'.png',bytes='old frame '+index+' '+i;fs.writeFileSync(path.join(directory,artifactId),bytes);return {artifactId,sha256:sha(bytes),width:640,height:360,seconds,requestedSeconds:seconds}}),analysis:{summary:'User observations retained.',observations:times.map((_,frameIndex)=>({frameIndex,description:'Old observed frame.',adaptation:'Old association.'}))},analysisOrigin:'user'}})
 draft.scenes=[['s1','a',0,10.5],['s2','b',4,12.5],['s3','c',3,7.8],['s5','e',2,12.8]].map(([id,asset,start,end])=>({...newStudioScene(String(id)),videoArtifactId:asset+'.mp4',sourceStartSeconds:Number(start),durationSeconds:Number(end)-Number(start)}));draft=store.update(draft.id,draft.revision,draft);draft=store.recordReference(draft.id,draft.revision,old)
 const kernel:StudioKernel={projectStore:{active:()=>({id:'p',name:'P',directory:root})},execute:async()=>({}),recordingController:{compose:async()=>{},narrate:async()=>{},processArtifact:async raw=>{const r=raw as {action:string;timestampsSeconds:number[];artifactId:string};if(r.action==='media.inspect')return {durationSeconds:20,tracks:[{type:'video',canDecode:true,width:640,height:360,startSeconds:0,endSeconds:20}]};if(r.action==='media.image.inspect')return {kind:'image',contentType:'image/png',width:640,height:360,pixels:640*360,bytes:20,canDecode:true};if(r.action==='media.frames.sample'){frames++;const value={type:'frame-set',sourceArtifactId:r.artifactId,frames:r.timestampsSeconds.map((time,outputIndex)=>{const artifactId='new-'+(++sequence)+'.png';fs.writeFileSync(path.join(directory,artifactId),'native '+r.artifactId+' '+time);return {artifactId,outputIndex,requestedTimestampSeconds:time,timestampSeconds:mode==='early'?Math.max(0,time-.4):Math.floor(time*24)/24,width:640,height:360,type:'screenshot',contentType:'image/png'}})};if(mode==='cas'){const current=store.read(draft.id);current.title='Concurrent GUI edit';store.update(current.id,current.revision,current)}if(mode==='source')fs.appendFileSync(path.join(directory,r.artifactId),'changed during native sampling');if(mode==='cancel')controller!.abort(new Error('scene-reference-cancel'));return value}throw new Error('Unexpected native action')}}}
 return {root,directory,owner,store,kernel,old,draft,frames:()=>frames,setMode:(value:typeof mode,c?:AbortController)=>{mode=value;controller=c},run:(signal?:AbortSignal)=>prepareSceneReferences(kernel,store,owner,store.read(draft.id),['s1','s2','s3','s5'],'agent',signal),close:()=>fs.rmSync(root,{recursive:true,force:true})}
}
test('Scene reference batch fixes four selected half-open intervals with one CAS, preserves seven prior records and reuses exact native evidence',async()=>{
 const f=fixture();try{const before=f.store.read(f.draft.id),files=new Map(fs.readdirSync(f.directory).map(id=>[id,fs.readFileSync(path.join(f.directory,id))])),result=await f.run(),after=f.store.read(f.draft.id)
  assert.equal(result.prepared,4);assert.equal(result.committed,true);assert.equal(after.revision,before.revision+1);assert.equal(after.referenceRecords!.length,11);assert.deepEqual(after.referenceRecords!.slice(0,7),f.old);assert.deepEqual(after.scenes,before.scenes)
  for(const [id,bytes]of files)assert.deepEqual(fs.readFileSync(path.join(f.directory,id)),bytes)
  assert.equal(after.referenceRecords!.slice(7).some(r=>r.analysis!==undefined),false,'Host never mints semantic observations')
  assert.deepEqual(after.referenceRecords!.slice(7).map(r=>r.frames.at(-1)!.requestedSeconds),[10.45,12.45,7.75,12.75])
  const count=f.frames(),reused=await f.run();assert.equal(reused.reused,4);assert.equal(reused.prepared,0);assert.equal(reused.committed,false);assert.equal(f.frames(),count);assert.deepEqual(f.store.read(f.draft.id),after)
 }finally{f.close()}
})
test('Reference endpoints use actual PTS and exclusive scene end, with structured windows instead of unchanged retries',async()=>{
 const range={sceneId:'s1',artifactId:'a.mp4',visualIndex:0,startSeconds:0,endExclusive:10.5}
 const gap=referenceCoverageGap(range,[{seconds:0},{seconds:5},{seconds:10.5}])!;assert.deepEqual(gap.missing,['end']);assert.equal(gap.endWindow.maximumExclusive,10.5);assert.deepEqual(gap.suggestedTimestampsSeconds,[0,5.25,10.45]);assert.equal(referenceCoverageGap(range,[{seconds:0},{seconds:5},{seconds:10.45}]),undefined)
 const f=fixture();try{f.setMode('early');const before=f.store.read(f.draft.id),files=fs.readdirSync(f.directory).sort();await assert.rejects(f.run(),error=>{assert.match(String(error),/SCENE_REFERENCE_COVERAGE/);assert.match(String(error),/maximumExclusive/);return true});assert.deepEqual(f.store.read(f.draft.id),before);assert.deepEqual(fs.readdirSync(f.directory).sort(),files)}finally{f.close()}
})
test('Scene reference batch refuses stale sources, cancellation and GUI CAS while preserving records and cleaning only its new PNGs',async()=>{
 for(const mode of ['cancel','cas','source'] as const){const f=fixture();try{const before=f.store.read(f.draft.id),files=fs.readdirSync(f.directory).sort(),controller=new AbortController();f.setMode(mode,controller);await assert.rejects(f.run(controller.signal),mode==='cancel'?/scene-reference-cancel/:mode==='source'?/STUDIO_REFERENCE_STALE/:/STUDIO_CONFLICT/);assert.deepEqual(f.store.read(f.draft.id).referenceRecords,before.referenceRecords);assert.deepEqual(fs.readdirSync(f.directory).sort(),files);assert.equal(f.store.read(f.draft.id).title,mode==='cas'?'Concurrent GUI edit':before.title)}finally{f.close()}}
 const f=fixture();try{await f.run();const current=f.store.read(f.draft.id),png=current.referenceRecords!.at(-1)!.frames[0].artifactId;fs.appendFileSync(path.join(f.directory,png),'tampered');await assert.rejects(f.run(),/STUDIO_REFERENCE_STALE/)}finally{f.close()}
})
test('Immutable reference history and source-group budgets are shared, backward compatible, bounded and closed to invented scene clocks',async()=>{
 const f=fixture();try{assert.equal(assertReferenceRecords(f.old).length,7);const records=Array.from({length:REFERENCE_LIMITS.records},(_,i)=>({...f.old[i%5],id:'history-'+i}));assert.equal(assertReferenceRecords(records).length,32);assert.throws(()=>assertReferenceCapacity(records,[],1),/STUDIO_REFERENCE_BUDGET/);assert.throws(()=>assertReferenceRecords([...records,{...f.old[0],id:'overflow'}]),/32/)
  const sources=Array.from({length:9},(_,i)=>({...f.old[0],id:'source-'+i,sourceArtifactId:'source-'+i+'.mp4'}));assert.throws(()=>assertReferenceRecords(sources),/SOURCE_BUDGET/)
  f.store.recordReference(f.draft.id,f.draft.revision,records);const calls=f.frames();await assert.rejects(f.run(),/STUDIO_REFERENCE_BUDGET/);assert.equal(f.frames(),calls)
  const request={operation:'prepare-scene-references',sceneIds:['s1','s2']};assert.deepEqual(assertNewsPreparationRequest(request),request);assert.equal(new Ajv2020({strict:false}).compile(newsPreparationRequestSchema)(request),true)
  for(const raw of [{...request,sceneIds:[]},{...request,sceneIds:['s1','s1']},{...request,timestampsSeconds:[10.5]},{...request,sourceStartSeconds:1},{...request,sceneIds:['../other']}])assert.throws(()=>assertNewsPreparationRequest(raw))
 }finally{f.close()}
})
