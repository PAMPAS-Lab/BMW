import assert from 'node:assert/strict'
import test from 'node:test'
import {assertSourcePreservationBasis,sourcePreservationArtifacts,sourceAcquisitionTab,sourceCaptureRecovery} from '../src/library-sources.js'
import type {VideoIdentity} from '@bmw-agent/agent-contract/video-identity'
const youtube:VideoIdentity={version:1,platform:'youtube',targetId:'jNQXAC9IVRw',resourceId:'jNQXAC9IVRw'}
const complete={basis:'YouTube-SABR-encoded-tracks',reencoded:false,completeVod:true,completeSeparatedTracks:true}
test('Archive download recovery returns one complete fresh-revision capture without repeating transfer or inventing preview offsets',()=>{
 const request={operation:'acquire' as const,expectedRevision:5,sourceId:'source',acquisitionId:'acq',candidateId:'video',method:'preserve' as const,preview:{startSeconds:60,endSeconds:85}},scope={selector:'video',index:1,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-text-nodes' as const,truncated:false,status:'observed' as const}
 const recovery=sourceCaptureRecovery(request,scope,6,'actual-tab','HTTP 403')!
 assert.deepEqual(recovery.sourceRequest,{operation:'acquire',expectedRevision:6,sourceId:'source',acquisitionId:'acq',candidateId:'video',method:'capture',tabId:'actual-tab',videoSelector:'video',videoIndex:1,fromStart:false,maxDurationMs:29000})
 for(const error of ['MEDIA_PRESERVATION_TRACKS_INCOMPLETE: subtitle unavailable','VIDEO_IDENTITY_CHANGED','SOURCE_CONFLICT','MEDIA_CAPTURE_CLEANUP_FAILED','login required','source page changed'])assert.equal(sourceCaptureRecovery(request,scope,6,'actual-tab',error),null)
 assert.equal(sourceCaptureRecovery({...request,method:'auto'},scope,6,'actual-tab','HTTP403'),null)
})
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

test('Acquisition resolves only its saved source rather than an unrelated active blank tab',()=>{
 const pages=[{id:'user',url:''},{id:'source',url:'https://example.org/story#player'}]
 assert.equal(sourceAcquisitionTab(pages,'https://example.org/story'),'source')
 assert.equal(sourceAcquisitionTab(pages,'https://example.org/story','source'),'source')
 assert.throws(()=>sourceAcquisitionTab(pages,'https://example.org/story','user'),/SOURCE_TAB_CHANGED/)
 assert.throws(()=>sourceAcquisitionTab([], 'https://example.org/story'),/SOURCE_TAB_UNAVAILABLE/)
 assert.throws(()=>sourceAcquisitionTab([...pages,{id:'duplicate',url:'https://example.org/story'}],'https://example.org/story'),/SOURCE_TAB_AMBIGUOUS/)
 assert.throws(()=>sourceAcquisitionTab(pages,''),/SOURCE_TAB_UNAVAILABLE/)
})
test('Confirmed YouTube native acquisition resolves tracking changes without admitting foreign or ambiguous source tabs',()=>{
 const original='https://www.youtube.com/watch?v='+youtube.targetId,pages=[{id:'user',url:'about:blank'},{id:'source',url:original+'&themeRefresh=2&feature=share'}]
 assert.equal(sourceAcquisitionTab(pages,original,undefined,youtube),'source')
 assert.equal(sourceAcquisitionTab(pages,original,'source',youtube),'source')
 assert.throws(()=>sourceAcquisitionTab(pages,original,'user',youtube),/SOURCE_TAB_CHANGED/)
 assert.throws(()=>sourceAcquisitionTab(pages,original),/SOURCE_TAB_UNAVAILABLE/)
 assert.throws(()=>sourceAcquisitionTab([{id:'source',url:original+'&list=changed'}],original,undefined,youtube),/SOURCE_TAB_UNAVAILABLE/)
 assert.throws(()=>sourceAcquisitionTab(pages,original,undefined,{...youtube,targetId:'a9LDPn-MO4I',resourceId:'a9LDPn-MO4I'}),/SOURCE_TAB_UNAVAILABLE/)
 assert.throws(()=>sourceAcquisitionTab([...pages,{id:'duplicate',url:original}],original,undefined,youtube),/SOURCE_TAB_AMBIGUOUS/)
})

test('Complete preservation rollback adopts large multi-track bundles and rejects foreign, duplicate or over-budget resources',()=>{
 const prefix='preserved-00000000-0000-4000-8000-000000000000-',created=prefix+'delivery.mp4',owned=[created,...Array.from({length:20150},(_,i)=>prefix+i+'-resource.bin')]
 assert.deepEqual(sourcePreservationArtifacts(created,owned),owned)
 for(const bad of [[...owned,created],[...owned,'preserved-11111111-1111-4111-8111-111111111111-file.bin'],owned.slice(1),Array.from({length:20257},(_,i)=>prefix+i+'-resource.bin')])assert.throws(()=>sourcePreservationArtifacts(created,bad),/Foreign|Invalid/)
})
