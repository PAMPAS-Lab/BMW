import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {analysisTargets,analysisCoverage,analysisChangeCandidates,assertAnalysisRequest,assertSourceAnalysis} from '../src/source-analysis-contract.js'
import {SourceAnalysisStore} from '../src/source-analysis-store.js'
import {SourceAnalysisService} from '../src/source-analysis-service.js'
import type {StudioKernel} from '../src/studio-service.js'
import {assertStudioRequest} from '../src/studio-contract.js'
import {mediaRecord} from '../../media-native/src/media-contract.js'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')
async function fixture(){const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bmw-source-analysis-'))),artifacts=path.join(directory,'artifacts');await fs.mkdir(artifacts);await fs.writeFile(path.join(artifacts,'source.mp4'),'fixture source');const scope={directory,projectId:'project',sessionId:'session',draftId:'draft'},store=new SourceAnalysisStore(scope);let n=0,mode='success',calls=0,duration=5
 const kernel={recordingController:{processArtifact:async(raw:unknown,signal?:AbortSignal)=>{signal?.throwIfAborted();const request=mediaRecord(raw);if(request.action==='media.inspect')return {type:'inspection',artifactId:'source.mp4',container:'MP4',contentType:'video/mp4',durationSeconds:duration,firstTimestampSeconds:0,tracks:[{id:1,type:'video',codec:'avc',canDecode:true,width:2,height:2,startSeconds:0,endSeconds:duration}]};assert.equal(request.action,'media.frames.sample');calls++;if(mode==='abort')throw new DOMException('Cancelled','AbortError');const times=request.timestampsSeconds as number[],frames=[];for(const [index,time]of times.entries()){const artifactId=`frame-${n++}.png`;await fs.writeFile(path.join(artifacts,artifactId),png);frames.push({artifactId,type:'screenshot',contentType:'image/png',outputIndex:index,requestedTimestampSeconds:time,timestampSeconds:Math.floor(time*25)/25,width:1,height:1})}return {type:'frame-set',sourceArtifactId:mode==='invalid'?'wrong.mp4':'source.mp4',frames}}}} as unknown as StudioKernel
 return {scope,store,artifacts,service:(actor:'agent'|'user'='agent',guard:()=>void=()=>{})=>new SourceAnalysisService(kernel,scope,guard,actor),setMode:(value:string)=>mode=value,setDuration:(value:number)=>duration=value,calls:()=>calls,close:()=>fs.rm(directory,{recursive:true,force:true})}}
test('Whole-video sampling uses measured video range, reuses dense baseline points, bounds requests and never invents review',()=>{
 const base=analysisTargets(0,661.6,[]);assert.equal(base.length,1324);assert.equal(base.at(-1)!.requestedSeconds,661.5)
 const dense=analysisTargets(.04,1.04,[{startSeconds:.04,endSeconds:1.04,reason:'cut'}]);assert.equal(dense.length,8);assert.equal(new Set(dense.map(t=>t.requestedSeconds)).size,8)
 assert.throws(()=>analysisTargets(0,1801,[]));assert.throws(()=>analysisTargets(0,2,[{startSeconds:0,endSeconds:3,reason:'outside'}]));assert.throws(()=>assertAnalysisRequest({operation:'review',analysisId:'job',expectedRevision:1,indices:[0,0],note:'false'}));assert.throws(()=>assertAnalysisRequest({operation:'create',artifactId:'../source.mp4'}));assert.throws(()=>assertStudioRequest({operation:'analysis',draftId:'draft',expectedRevision:1,analysisRequest:{operation:'create',artifactId:'source.mp4',path:'/tmp/escape'}}));assert.equal(assertStudioRequest({operation:'analysis',draftId:'draft',expectedRevision:1,analysisRequest:{operation:'list'}}).operation,'analysis')
})
test('Analysis pages survive restart, densify without losing reviewed identities, export complete ledgers and reject changed evidence',async()=>{
 const f=await fixture();try{const created=mediaRecord(await f.service().execute({operation:'create',artifactId:'source.mp4'})),first=mediaRecord(created.analysis),id=String(first.id);let revision=Number(first.revision)
 const step=mediaRecord(await f.service().execute({operation:'step',analysisId:id,expectedRevision:revision,offset:0}));revision=Number(mediaRecord(step.analysis).revision);assert.equal((step.frames as unknown[]).length,8);assert.equal(mediaRecord(mediaRecord(step.analysis).coverage).reviewed,0)
 const review=mediaRecord(await f.service('user').execute({operation:'review',analysisId:id,expectedRevision:revision,indices:[0,1],note:'用户逐张核看：文档切换'}));revision=Number(mediaRecord(review.analysis).revision)
 await assert.rejects(f.service().execute({operation:'review',analysisId:id,expectedRevision:revision,indices:[0],note:'override user'}),/Preserve user/)
 const dense=mediaRecord(await f.service().execute({operation:'densify',analysisId:id,expectedRevision:revision,intervals:[{startSeconds:1,endSeconds:2,reason:'observed transition'}]}));revision=Number(mediaRecord(dense.analysis).revision)
 const old=await f.store.read(id);assert.equal(old!.frames[0].review!.origin,'user');assert.equal(analysisCoverage(old!).reviewed,2)
 const motion=structuredClone(old!);motion.intervals=[];motion.frames.forEach((frame,index)=>frame.lumaSignature=Array(64).fill(index%2?255:0));assert.equal(analysisChangeCandidates(motion).length,1);assert.match(analysisChangeCandidates(motion)[0].reason,/候选/);motion.frames=motion.frames.filter(f=>f.index%2===0);assert.deepEqual(analysisChangeCandidates(motion),[],'Missing baseline pages must not invent adjacent transition evidence')
 await f.service().execute({operation:'step',analysisId:id,expectedRevision:revision,offset:0});const resumed=await new SourceAnalysisStore(f.scope).read(id);assert.equal(resumed!.frames.length,16);assert.equal(analysisCoverage(resumed!).wholeVideo2fpsExtracted,true);assert.equal(analysisCoverage(resumed!).wholePlanReviewed,false)
 const exported=mediaRecord(await f.service().execute({operation:'export',analysisId:id,expectedRevision:resumed!.revision,offset:0}));const report=JSON.parse(await fs.readFile(path.join(f.artifacts,String(exported.artifactId)),'utf8'));assert.equal(report.frames.length,16);assert.equal(report.coverage.reviewed,2);assert.equal(report.nextOffset,null)
 const calls=f.calls();await f.service().execute({operation:'read',analysisId:id,expectedRevision:resumed!.revision,offset:8});assert.equal(f.calls(),calls,'Reading saved pages must not decode again')
 await fs.writeFile(path.join(f.artifacts,resumed!.frames[0].artifactId),'changed PNG');await assert.rejects(f.service().execute({operation:'read',analysisId:id,expectedRevision:resumed!.revision,offset:0}),/STALE/)
 await fs.writeFile(path.join(f.artifacts,'source.mp4'),'changed source');await assert.rejects(f.service().execute({operation:'step',analysisId:id,expectedRevision:resumed!.revision,offset:0}),/STALE/)
 }finally{await f.close()}
})
test('Failed analysis pages clean new files, require explicit retry, and cancellation preserves committed progress',async()=>{
 const f=await fixture();try{const created=mediaRecord(await f.service().execute({operation:'create',artifactId:'source.mp4'})),id=String(mediaRecord(created.analysis).id);f.setMode('invalid');await assert.rejects(f.service().execute({operation:'step',analysisId:id,expectedRevision:1,offset:0}),/receipt/);let job=(await f.store.read(id))!;assert.equal(job.failures.length,8);assert.equal(job.frames.length,0);assert.deepEqual(await fs.readdir(f.artifacts),['source.mp4'])
 f.setMode('success');await f.service().execute({operation:'step',analysisId:id,expectedRevision:job.revision,offset:0});job=(await f.store.read(id))!;assert.equal(job.frames.length,2)
 const failedPage=mediaRecord(await f.service().execute({operation:'read',analysisId:id,expectedRevision:job.revision,offset:0}));assert.deepEqual(failedPage.frames,[]);assert.equal(failedPage.nextOffset,8);assert.ok((failedPage.targets as {status:string;requestedSeconds:number}[]).every(t=>t.status==='failed'&&t.requestedSeconds<4))
 const followingPage=mediaRecord(await f.service().execute({operation:'read',analysisId:id,expectedRevision:job.revision,offset:8}));assert.equal((followingPage.frames as unknown[]).length,2);assert.equal(followingPage.nextOffset,null)
 const failedExport=mediaRecord(await f.service().execute({operation:'export',analysisId:id,expectedRevision:job.revision,offset:0})),failedReport=JSON.parse(await fs.readFile(path.join(f.artifacts,String(failedExport.artifactId)),'utf8'));assert.equal(failedReport.targets.filter((t:{status:string})=>t.status==='failed').length,8);assert.equal(failedReport.targets[8].requestedSeconds,4)
 const retry=mediaRecord(await f.service().execute({operation:'retry',analysisId:id,expectedRevision:job.revision,indices:job.failures.map(f=>f.index)}));await f.service().execute({operation:'step',analysisId:id,expectedRevision:Number(mediaRecord(retry.analysis).revision),offset:0});job=(await f.store.read(id))!;assert.equal(job.frames.length,10)
 const abort=new AbortController();abort.abort();await assert.rejects(f.service().execute({operation:'step',analysisId:id,expectedRevision:job.revision,offset:0},abort.signal));assert.deepEqual((await f.store.read(id))!.frames,job.frames);assert.equal((await f.store.read(id))!.failures.length,0)
 const foreign=new SourceAnalysisStore({...f.scope,sessionId:'foreign'});await assert.rejects(foreign.read(id),/another/);assert.throws(()=>assertSourceAnalysis({...job,sourceBytes:536870913},'project','session','draft'))
 }finally{await f.close()}
})
test('Analysis exports paginate by actual UTF8 bytes and retain every long Chinese review note',async()=>{
 const f=await fixture();try{f.setDuration(110);const created=mediaRecord(await f.service().execute({operation:'create',artifactId:'source.mp4'})),id=String(mediaRecord(created.analysis).id);let job=(await f.store.read(id))!
 while(analysisCoverage(job).pending){await f.service().execute({operation:'step',analysisId:id,expectedRevision:job.revision,offset:0});job=(await f.store.read(id))!}
 const note='中'.repeat(1200)
 for(let offset=0;offset<job.frames.length;offset+=8){await f.service().execute({operation:'review',analysisId:id,expectedRevision:job.revision,indices:job.frames.slice(offset,offset+8).map(f=>f.index),note});job=(await f.store.read(id))!}
 let offset=0,pages=0;const indices:number[]=[]
 do{const result=mediaRecord(await f.service().execute({operation:'export',analysisId:id,expectedRevision:job.revision,offset})),bytes=await fs.readFile(path.join(f.artifacts,String(result.artifactId))),report=JSON.parse(bytes.toString('utf8'));assert.ok(bytes.length<=512*1024);for(const frame of report.frames){assert.equal(frame.review.note,note);indices.push(frame.index)}pages++;if(result.reportPage===null)break;assert.ok(Number(result.reportPage)>offset);offset=Number(result.reportPage)}while(true)
 assert.ok(pages>1);assert.deepEqual(indices,Array.from({length:220},(_,i)=>i))
 const createdFailure=mediaRecord(await f.service().execute({operation:'create',artifactId:'source.mp4'})),failureId=String(mediaRecord(createdFailure.analysis).id),failureJob=(await f.store.read(failureId))!;failureJob.failures=Array.from({length:220},(_,index)=>({index,message:'故'.repeat(1000)}));const failed=await f.store.commit(failureJob,failureJob.revision,()=>{});offset=0;const failedIndices:number[]=[]
 do{const result=mediaRecord(await f.service().execute({operation:'export',analysisId:failureId,expectedRevision:failed.revision,offset})),bytes=await fs.readFile(path.join(f.artifacts,String(result.artifactId))),report=JSON.parse(bytes.toString('utf8'));assert.ok(bytes.length<=512*1024);assert.equal(report.frames.length,0);for(const target of report.targets){assert.equal(target.status,'failed');assert.equal(target.error,'故'.repeat(1000));failedIndices.push(target.index)}if(result.reportPage===null)break;assert.ok(Number(result.reportPage)>offset);offset=Number(result.reportPage)}while(true)
 assert.deepEqual(failedIndices,Array.from({length:220},(_,i)=>i))
 }finally{await f.close()}
})
test('Analysis CAS preserves competing edits and refuses symlinked storage',async()=>{
 const f=await fixture();try{const result=mediaRecord(await f.service().execute({operation:'create',artifactId:'source.mp4'})),id=String(mediaRecord(result.analysis).id),job=(await f.store.read(id))!;const results=await Promise.allSettled([f.store.commit(job,job.revision,()=>{}),f.store.commit(job,job.revision,()=>{})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1)
 const directory=path.join(f.scope.directory,'source-analysis','draft');await fs.rename(directory,directory+'-saved');await fs.symlink(directory+'-saved',directory);await assert.rejects(f.store.read(id),/owned/)
 }finally{await f.close()}
})
