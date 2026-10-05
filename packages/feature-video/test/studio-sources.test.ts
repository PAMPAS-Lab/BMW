import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ProjectSourceStore} from '../../platform/src/project-source-store.js'
import {VideoStudioStore} from '../src/studio-store.js'
import {VideoStudioService} from '../src/studio-service.js'
import {newStudioScene,draftComposition} from '../src/studio-contract.js'
import {assertFullMediaDecode,assertNativeProcessingRequest} from '@bmw-agent/media-native/contract'
import type {VideoDraft} from '../src/studio-contract.js'
import type {BrowserFeatureHost} from '@bmw-agent/browser-capability/host'
const scope={selector:'article',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const}
function fixture(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-studio-source-'))),project={id:'p',name:'P',directory:root},sources=new ProjectSourceStore(root,'p'),store=new VideoStudioStore(root,'session-a'),kernel:BrowserFeatureHost={projectStore:{active:()=>project},projectSources:()=>sources,recordingController:{compose:async()=>({}),narrate:async()=>({}),processArtifact:async()=>({})},execute:async()=>{throw new Error('Recursive Browser FIFO execution forbidden')},collectSource:async()=>({url:'https://example.com',title:'Text',author:null,publishedAt:null,scope,text:'第一条事实。第二条作者观点。',mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null})},service=new VideoStudioService(kernel),owner={projectId:'p',sessionId:'session-a'};return {root,sources,store,kernel,service,owner,close:()=>fs.rmSync(root,{recursive:true,force:true})}}
test('Studio source evidence is Project-shared, while citation edits keep Session ownership/CAS and actual original UTF16 ranges',async()=>{const f=fixture();try{
 const collected=await f.service.execute({operation:'source',sourceRequest:{operation:'collect',bodySelector:'article',expectedRevision:0}},undefined,f.owner) as {sourceId:string;acquisitionId:string}
 const shared=await f.service.execute({operation:'source',sourceRequest:{operation:'list'}},undefined,{projectId:'p',sessionId:'session-b'}) as {catalog:{sources:unknown[]}};assert.equal(shared.catalog.sources.length,1)
 let draft=f.store.create('引用视频');draft.scenes=[{...newStudioScene('scene','事实'),bullets:['证据与观点']}];draft=f.store.update(draft.id,draft.revision,draft);const before=draftComposition(draft)
 const quote='第一条事实。',citation={sourceId:collected.sourceId,acquisitionId:collected.acquisitionId,startCharacter:0,endCharacter:quote.length,quote,kind:'fact',claim:'第一条陈述',conflict:'pending',eventAt:null};draft.scenes[0].citations=[citation as NonNullable<typeof draft.scenes[0]['citations']>[number]];draft.preparation.sourceIds=[collected.sourceId]
 const saved=await f.service.execute({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft},undefined,f.owner) as VideoDraft;assert.deepEqual(draftComposition(saved),before)
 const report=await f.service.execute({operation:'export-citations',draftId:saved.id,expectedRevision:saved.revision},undefined,f.owner) as {artifactId:string;citationCount:number};const content=JSON.parse(fs.readFileSync(path.join(f.root,'artifacts',report.artifactId),'utf8'));assert.equal(content.citations[0].citation.quote,quote);assert.equal(content.citations[0].publishedAt,null);assert.equal(content.citations[0].eventAt,null);assert.equal(content.factChecking,'pending')
 const invalid=structuredClone(saved);invalid.scenes[0].citations![0].quote='伪造的事实。';await assert.rejects(f.service.execute({operation:'update',draftId:saved.id,expectedRevision:saved.revision,draft:invalid},undefined,f.owner),/stored original/);assert.equal(f.store.read(saved.id).revision,saved.revision)
 await assert.rejects(f.service.execute({operation:'update',draftId:saved.id,expectedRevision:saved.revision,draft:saved},undefined,{projectId:'p',sessionId:'session-b'}),/STUDIO_SESSION_MISMATCH/)
 await assert.rejects(f.service.execute({operation:'source',sourceRequest:{operation:'list'}},undefined,{projectId:'other',sessionId:'session-a'}),/SESSION_REQUIRED/)
}finally{f.close()}})
test('Native full-file decode admission rejects empty/dropped track evidence and remains a private host action',()=>{
 const decoded={kind:'decoding',completeFile:true,container:'WebM',contentType:'video/webm',durationSeconds:2,firstTimestampSeconds:0,tracks:[{id:0,type:'video',codec:'vp8',sampleCount:48,startSeconds:0,endSeconds:2}]};assert.equal(assertFullMediaDecode(decoded).tracks[0].sampleCount,48)
 assert.throws(()=>assertFullMediaDecode({...decoded,completeFile:false}),/evidence/);assert.throws(()=>assertFullMediaDecode({...decoded,tracks:[{...decoded.tracks[0],sampleCount:0}]}),/samples/);assert.throws(()=>assertNativeProcessingRequest({action:'media.decode.check',artifactId:'file.mp4',url:'https://example.com'}),/Unsupported/)
})
