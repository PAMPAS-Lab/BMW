import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ProductionAssessmentJournal,makeProductionAssessment,acceptedProductionAssessment} from '../src/production-assessment.js'
import {newProductionBrief} from '../src/production-types.js'
import {VideoStudioStore} from '../src/studio-store.js'
import {productionFacts} from '../src/production-impact.js'
import {assertStudioRequest} from '../src/studio-contract.js'
import type {ProductionAssessment} from '../src/production-assessment-contract.js'
const assessment:ProductionAssessment={checks:Array.from({length:5},(_,i)=>({id:'check-'+(i+1),status:'passed',notes:''})),listening:'passed',retellingAnswer:'用户记录的观众复述',predictionAnswer:'条件变化的预测',notes:'夹具声明，不代表真实核听'}
function fixture(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-assessment-')));fs.mkdirSync(path.join(root,'artifacts'));const store=new VideoStudioStore(root,'owner'),draft=store.create('Review');draft.preparation.production=newProductionBrief('research-explainer');return {root,draft:store.update(draft.id,draft.revision,draft),close:()=>fs.rmSync(root,{recursive:true,force:true})}}
test('Only trusted user-origin type assessments can declare listening and viewer understanding; Agent opinions remain separate',()=>{
 const f=fixture();try{const scope={fingerprint:'1'.repeat(64),exportArtifactId:'final.mp4'};assert.throws(()=>makeProductionAssessment(f.draft,assessment,scope,'agent'),/HUMAN_REQUIRED/);const agent=makeProductionAssessment(f.draft,{...assessment,checks:assessment.checks.map(c=>({...c,status:'needs-fix'})),listening:'not-performed',retellingAnswer:'',predictionAnswer:''},scope,'agent');assert.equal(acceptedProductionAssessment(agent,'research-explainer'),false)
 const user=makeProductionAssessment(f.draft,assessment,scope,'user');assert.equal(acceptedProductionAssessment(user,'research-explainer'),true);assert.equal(acceptedProductionAssessment({...user,predictionAnswer:''},'research-explainer'),false);assert.equal(acceptedProductionAssessment({...user,listening:'not-performed'},'news-brief'),false);assert.throws(()=>assertStudioRequest({operation:'record-production-review',draftId:f.draft.id,expectedRevision:f.draft.revision,baseFingerprint:scope.fingerprint,expectedAssessmentRevision:0,assessment,origin:'user'}))
 }finally{f.close()}
})
test('Type review journals enforce Project/Session ownership, independent CAS, bounded history and no symbolic links',()=>{
 const f=fixture();try{const owner={projectId:'project',sessionId:'owner',draftId:f.draft.id},journal=new ProductionAssessmentJournal(f.root,owner),record=makeProductionAssessment(f.draft,assessment,{fingerprint:'1'.repeat(64),exportArtifactId:'final.mp4'},'user');assert.deepEqual(journal.read(),{revision:0,records:[]});journal.append(0,record);assert.deepEqual(new ProductionAssessmentJournal(f.root,owner).read().records,[record]);assert.throws(()=>journal.append(0,record),/CONFLICT/);assert.throws(()=>new ProductionAssessmentJournal(f.root,{...owner,sessionId:'other'}).read(),/Foreign/)
 for(let i=1;i<=45;i++)journal.append(i,makeProductionAssessment(f.draft,{...assessment,checks:assessment.checks.map(c=>({...c,status:'needs-fix'})),listening:'not-performed',retellingAnswer:'',predictionAnswer:''},{fingerprint:'1'.repeat(64),exportArtifactId:'final.mp4'},'agent'));const snapshot=journal.read();assert.ok(snapshot.records.length<=40);assert.ok(snapshot.records.some(r=>r.id===record.id),'Latest human declaration survives repeated Agent notes')
 const file=path.join(f.root,'video-studio/type-reviews',f.draft.id+'.json'),original=fs.readFileSync(file);fs.renameSync(file,file+'.original');fs.symlinkSync(file+'.original',file);assert.throws(()=>journal.read(),/Invalid/);assert.deepEqual(fs.readFileSync(file+'.original'),original)
 }finally{f.close()}
})
test('Content review identity is stable across receipt revisions and changes with actual source bytes or authored questions',async()=>{
 const f=fixture();try{const directory=path.join(f.root,'artifacts');fs.writeFileSync(path.join(directory,'source.txt'),'source');f.draft.preparation.artifactIds=['source.txt'];const first=await productionFacts(f.draft,directory);f.draft.revision++;const receipt=await productionFacts(f.draft,directory);assert.equal(receipt.contentFingerprint,first.contentFingerprint);assert.notEqual(receipt.fingerprint,first.fingerprint);f.draft.preparation.production!.question='new question';assert.notEqual((await productionFacts(f.draft,directory)).contentFingerprint,first.contentFingerprint);fs.writeFileSync(path.join(directory,'source.txt'),'changed');assert.notEqual((await productionFacts(f.draft,directory)).contentFingerprint,receipt.contentFingerprint)
 }finally{f.close()}
})
