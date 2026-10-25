import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {prepareNewsDelivery} from '../src/news-delivery.js'
import {VideoStudioStore} from '../src/studio-store.js'
import {newStudioScene,draftComposition} from '../src/studio-contract.js'
import {compositionQualityPlan} from '../../media-native/src/composition-quality.js'
import {currentExportReview} from '../src/studio-export-review-state.js'

test('Operator delivery packages only fresh pinned independent passes; rejects queued, changed frames/output and existing destinations',async()=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-delivery-fixture-'))),project=path.join(temp,'project'),artifacts=path.join(project,'artifacts');fs.mkdirSync(artifacts,{recursive:true})
 const hash=(v:string)=>crypto.createHash('sha256').update(v).digest('hex')
 try{
  const store=new VideoStudioStore(project,'session');let d=store.create('Fixture news');d.scenes=[{...newStudioScene('one'),videoArtifactId:'source.mp4',narration:'',captions:[{startSeconds:0,endSeconds:2,text:'测试'}]}];d.preparation.outline='完整原话：fixture speech\n完整中译：夹具原声';d=store.update(d.id,d.revision,d)
  fs.writeFileSync(path.join(artifacts,'source.mp4'),'fixture source');fs.writeFileSync(path.join(artifacts,'film.mp4'),'fixture output')
  const quality={version:1,kind:'composition-quality',coverage:'critical-state-samples',phoneWidth:390,semanticVerification:'requires-visual-review',...compositionQualityPlan(draftComposition(d)),issues:[],omittedIssues:0};fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({status:'passed',artifactId:'film.mp4',width:d.width,height:d.height,quality}));d=store.addExport(d.id,d.revision,{artifactId:'film.mp4',verificationArtifactId:'report.json',durationSeconds:8})
  const context=await currentExportReview(store,d,artifacts,()=>{}),samples=quality.samples.map((s,index)=>{const artifactId=`frame-${index}.png`;fs.writeFileSync(path.join(artifacts,artifactId),'fixture image');return {index,seconds:s.seconds,artifactId,sha256:hash('fixture image')}})
  context.journal.recordFrames(context.snapshot,'one',samples);const valid=new Map([['one',new Set(samples.map(s=>s.index))]])
  for(const scope of ['scene','film'] as const)context.journal.recordVerdict(context.snapshot,{exportFingerprint:context.snapshot.fingerprint,scope,status:'passed',notes:'Isolated fixture; no sensory or paid-model coverage.'},scope==='scene'?'one':undefined,'agent',valid,'review-run')
  const target={policy:4,draftId:d.id,revision:d.revision,artifactId:'film.mp4',fingerprint:context.snapshot.fingerprint,sha256:hash('fixture output'),baseline:0},receipt={runId:'review-run',state:'finished',outcome:'success',task:{kind:'video-review',payload:JSON.stringify(target)}},history=path.join(temp,'history.json'),write=()=>fs.writeFileSync(history,JSON.stringify({sessionId:'session',owner:{projectId:'project'},receipts:[receipt]}));write()
  const input={projectDirectory:project,historyFile:history,draftId:d.id,runId:'review-run',outputDirectory:path.join(temp,'delivery')},result=await prepareNewsDelivery(input);assert.equal(result.sha256,target.sha256);assert.equal(result.humanListening,'pending');assert.match(fs.readFileSync(path.join(input.outputDirectory,'script.txt'),'utf8'),/fixture speech/);assert.equal(fs.readFileSync(path.join(input.outputDirectory,'film.mp4'),'utf8'),'fixture output');console.log('Isolated delivery packaging ms:',result.packagingElapsedMs)
  await assert.rejects(prepareNewsDelivery(input),/already exists/);receipt.state='queued';write();await assert.rejects(prepareNewsDelivery({...input,outputDirectory:path.join(temp,'queued')}),/finished/);receipt.state='finished';write()
  fs.writeFileSync(path.join(artifacts,samples[0].artifactId),'changed');await assert.rejects(prepareNewsDelivery({...input,outputDirectory:path.join(temp,'changed')}),/frames/);fs.writeFileSync(path.join(artifacts,samples[0].artifactId),'fixture image')
  target.sha256='a'.repeat(64);receipt.task.payload=JSON.stringify(target);write();await assert.rejects(prepareNewsDelivery({...input,outputDirectory:path.join(temp,'forged')}),/Host-pinned/)
  await assert.rejects(prepareNewsDelivery({...input,outputDirectory:path.join(project,'nested')}),/outside/)
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
})
