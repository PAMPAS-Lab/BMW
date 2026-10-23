import assert from 'node:assert/strict'
import test from 'node:test'
import {assertSourcePreservationBasis} from '../src/library-sources.js'
import type {VideoIdentity} from '@bmw-agent/agent-contract/video-identity'
const youtube:VideoIdentity={version:1,platform:'youtube',targetId:'jNQXAC9IVRw',resourceId:'jNQXAC9IVRw'}
const complete={basis:'YouTube-SABR-encoded-tracks',reencoded:false,completeVod:true,completeSeparatedTracks:true}
test('Source acquisition accepts complete native SABR only for its already confirmed identical YouTube target',()=>{
 assert.equal(assertSourcePreservationBasis(complete,youtube,{...youtube}),'YouTube-SABR-encoded-tracks')
 assert.equal(assertSourcePreservationBasis({basis:'HTTP-delivery-bytes',reencoded:false},undefined,undefined),'HTTP-delivery-bytes')
 for(const proof of [{...complete,reencoded:true},{...complete,completeVod:false},{...complete,completeSeparatedTracks:false},{...complete,completeVod:undefined},{...complete,basis:'arbitrary-assertion'}])assert.throws(()=>assertSourcePreservationBasis(proof,youtube,youtube))
})
test('SABR source acquisition rejects absent, foreign, cross-platform or malformed delivery identities',()=>{
 const foreign:VideoIdentity={...youtube,targetId:'a9LDPn-MO4I',resourceId:'a9LDPn-MO4I'}
 for(const observed of [undefined,null,{},foreign,{...youtube,platform:'bilibili'},{...youtube,resourceId:'a9LDPn-MO4I'}])assert.throws(()=>assertSourcePreservationBasis(complete,youtube,observed))
 for(const expected of [undefined,{version:1,platform:'page',targetId:'https://example.com/',resourceId:'https://example.com/video.mp4'} as VideoIdentity])assert.throws(()=>assertSourcePreservationBasis(complete,expected,youtube))
})
