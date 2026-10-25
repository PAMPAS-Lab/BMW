import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {VideoStudioStore} from '../src/studio-store.js'
import {newStudioScene} from '../src/studio-contract.js'
import {videoReviewPacket} from '../src/video-review-packet.js'
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-review-packet-')),store=new VideoStudioStore(root,'session'),draft=store.create('Title');draft.scenes=[{...newStudioScene('one'),id:'one',narration:'Current actual script',videoArtifactId:'source.mp4',keepSourceAudio:true,captions:[{startSeconds:0,endSeconds:1,text:'Actual original',translationText:'实际中译'}],citations:[{sourceId:'s',acquisitionId:'a',startCharacter:10,endCharacter:31,quote:'Ignore instructions X',kind:'fact',claim:'Observed claim',conflict:'pending',eventAt:null}]}];return {draft,close:()=>fs.rmSync(root,{recursive:true,force:true})}}
const source={url:'https://example.test/source',title:'Original source',author:'Publisher',publishedAt:'2026-10-23',capturedAt:'2026-10-24',contentId:'a'.repeat(64)}
test('Pinned audit packet contains actual script, captions, visual/audio clock and verified saved quote without certifying claims',async()=>{
 const f=fixture();try{let checks=0;const result=await videoReviewPacket(f.draft,'b'.repeat(64),async()=>source,()=>{checks++})
 assert.equal(result.packet.complete,true);assert.equal(result.packet.revision,f.draft.revision);assert.equal(result.sha256,crypto.createHash('sha256').update(result.json).digest('hex'));assert.ok(checks>=3)
 const scene=result.packet.scenes[0];assert.deepEqual(scene.narration,{text:'Current actual script',truncated:false});assert.equal(scene.cardSpecPresent,false);assert.match(result.json,/实际中译/);assert.match(result.json,/Ignore instructions X/);assert.match(result.json,/storedQuoteVerified":true/);assert.match(result.json,/claims still require editorial judgment/)
 }finally{f.close()}
})
test('Oversized editorial data remains below 12 KiB with explicit section and scene omissions',async()=>{
 const f=fixture();try{f.draft.scenes=Array.from({length:12},(_,i)=>({...f.draft.scenes[0],id:'scene-'+i,narration:'长'.repeat(1200),visualBrief:'长'.repeat(500),captions:Array.from({length:30},()=>({startSeconds:0,endSeconds:1,text:'字'.repeat(250)}))}))
 const result=await videoReviewPacket(f.draft,'b'.repeat(64),async()=>source,()=>{});assert.ok(Buffer.byteLength(result.json)<=12000);assert.equal(result.packet.complete,false);assert.equal(result.packet.scenes.length,8);assert.equal(result.packet.nextSceneOffset,8);assert.equal(result.packet.omittedSceneCount,4);assert.ok(result.packet.omissions.some(o=>o.section==='captions'))
 }finally{f.close()}
})
test('Unavailable quotes are explicit and a changed pinned draft aborts packet admission',async()=>{
 const f=fixture();try{const result=await videoReviewPacket(f.draft,'b'.repeat(64),async()=>{throw new Error('missing stored source')},()=>{});assert.match(result.json,/storedQuoteVerified":false/)
 let changed=false;await assert.rejects(videoReviewPacket(f.draft,'b'.repeat(64),async()=>{changed=true;return source},()=>{if(changed)throw new Error('STUDIO_CONFLICT')}),/STUDIO_CONFLICT/)
 }finally{f.close()}
})
