import assert from 'node:assert/strict'
import test from 'node:test'
import {preservationResult} from '../src/preservation-result.js'

test('Long archive browser receipts remain bounded without losing the complete internal rollback ledger', () => {
 const resources = Array.from({length:20000}, (_,index) => ({artifactId:`segment-${index}.ts`, sha256:'a'.repeat(64), url:'https://example.com/'+('a'.repeat(8000)),path:'/host/private/path'}))
 const ownedArtifactIds = resources.map(item => item.artifactId)
 const source = {artifactId:'complete.mp4', sha256:'b'.repeat(64), ownedArtifactIds, preservation:{resources, proofArtifactId:'complete-proof.json', completeVod:true}}
 const result = preservationResult(source)
 assert.equal((result.ownedArtifactIds as unknown[]).length,20)
 assert.equal(result.ownedArtifactCount,20000)
 assert.equal(result.ownedArtifactsTruncated,true)
 const proof = result.preservation as Record<string,unknown>
 assert.equal((proof.resources as unknown[]).length,20)
 assert.equal(proof.resourceCount,20000)
 assert.equal(proof.resourcesTruncated,true)
 assert.equal(proof.proofArtifactId,'complete-proof.json')
 assert.equal(proof.completeVod,true)
 assert.equal('url' in (proof.resources as Record<string,unknown>[])[0]!,false)
 assert.equal('path' in (proof.resources as Record<string,unknown>[])[0]!,false)
 assert.ok(JSON.stringify(result).length < 6000)
 assert.equal(source.ownedArtifactIds.length,20000)
 assert.equal(source.preservation.resources.length,20000)
 assert.notEqual(result.ownedArtifactIds,source.ownedArtifactIds)
 assert.notEqual(proof,source.preservation)
})

test('Short native receipts retain every resource and malformed results are refused', () => {
 const result = preservationResult({ownedArtifactIds:['original.mp4'], preservation:{resources:[{artifactId:'original.mp4'}]}})
 assert.deepEqual(result.ownedArtifactIds,['original.mp4'])
 assert.equal(result.ownedArtifactsTruncated,false)
 assert.equal((result.preservation as Record<string,unknown>).resourcesTruncated,false)
 for (const value of [null,[],false,'result']) assert.throws(() => preservationResult(value), /Invalid native/)
})
test('Subtitle receipt preview is explicit and bounded without mutating the complete native bundle',()=>{
 const tracks=Array.from({length:32},(_,i)=>({artifactId:'captions-'+i+'.vtt',sha256:'a'.repeat(64),language:'en',delivery:'external-sidecar',secret:'not-public',mappings:[{url:'https://private.example/token'}]}))
 const native={preservation:{subtitleTracks:tracks,completeSubtitles:true}},result=preservationResult(native).preservation as Record<string,unknown>
 assert.equal((result.subtitleTracks as unknown[]).length,20);assert.equal(result.subtitleTrackCount,32);assert.equal(result.subtitleTracksTruncated,true);assert.equal(result.completeSubtitles,true)
 assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('secret'));assert.equal(native.preservation.subtitleTracks.length,32)
})
