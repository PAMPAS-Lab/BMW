import {assertImageDrawingRequest,assertDrawingBounds,assertDrawingResult,DRAWING_LIMITS} from '../src/image-drawing-contract.js'
import {imageHeader,ImageDecodeBudget,DECODE_BUDGET,assertImageInspection} from '../src/image-contract.js'
import {assertNativeProcessingRequest,assertEncodingInspection} from '../src/media-contract.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ArtifactJobIO } from '../src/artifact-job-io.js'
import { assertMediaProcessRequest, assertMediaWorkerResult, assertPreservedMediaTracks, assertProcessableVideoTracks, MEDIA_LIMITS } from '../src/media-contract.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=', 'base64')
const sample = { action: 'media.frames.sample', artifactId: 'source.webm', timestampsSeconds: [1] } as const

test('media actions require artifact IDs and reject unbounded or ambiguous processing requests', () => {
  for (const artifactId of ['../source.webm', '/tmp/source.webm', 'https://example.com/video', 'C:\\video.webm', '..', '']) assert.throws(() => assertMediaProcessRequest({ action: 'media.inspect', artifactId }))
  for (const value of [NaN, Infinity, -1, 1801, '1']) assert.throws(() => assertMediaProcessRequest({ ...sample, timestampsSeconds: [value] }))
  assert.throws(() => assertMediaProcessRequest({ ...sample, timestampsSeconds: Array(9).fill(1) }))
  assert.throws(() => assertMediaProcessRequest({ ...sample, path: '/tmp/file' }))
  for (const extra of [{ outputFormat: 'avi' }, { trimStartSeconds: 2, trimEndSeconds: 1 }, { outputWidth: 1920 }, { outputWidth: 1919, outputHeight: 1080 }]) assert.throws(() => assertMediaProcessRequest({ action: 'media.convert', artifactId: 'source.webm', outputFormat: 'mp4', ...extra }))
  const request = assertMediaProcessRequest(sample)
  assert.equal(request.action, 'media.frames.sample')
  if (request.action === 'media.frames.sample') assert.deepEqual([request.maxWidth, request.maxHeight], [1280, 720])
})

test('media worker admission rejects missing frames, forged timestamps and unexpected output codecs', () => {
  const request = assertMediaProcessRequest(sample)
  const frame = { outputIndex: 0, requestedTimestampSeconds: 1, timestampSeconds: .98, durationSeconds: .04, width: 320, height: 180 }
  assert.equal(assertMediaWorkerResult({ kind: 'frames', frames: [frame] }, request).kind, 'frames')
  for (const frames of [[], [{ ...frame, timestampSeconds: 2 }], [{ ...frame, width: 2000 }], [{ ...frame, outputIndex: 1 }]]) assert.throws(() => assertMediaWorkerResult({ kind: 'frames', frames }, request))
  const convert = assertMediaProcessRequest({ action: 'media.convert', artifactId: 'source.webm', outputFormat: 'mp4' })
  assert.throws(() => assertMediaWorkerResult({ kind: 'conversion', contentType: 'video/mp4', range: { startSeconds: 100, endSeconds: 100 }, tracks: [{ type: 'video', codec: 'avc' }] }, convert))
  assert.throws(() => assertMediaWorkerResult({ kind: 'conversion', contentType: 'video/mp4', range: { startSeconds: 0, endSeconds: 1 }, tracks: [{ type: 'audio', codec: 'opus' }] }, convert))
})

async function fixture(t: test.TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmw-media-io-'))
  const artifacts = path.join(directory, 'artifacts')
  await fs.mkdir(artifacts)
  await fs.writeFile(path.join(artifacts, 'source.webm'), Buffer.from([1,2,3,4]))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { directory, artifacts }
}

test('media job I/O pins the Project input and rejects links, out-of-range reads and writes', async (t) => {
  const { directory, artifacts } = await fixture(t)
  await fs.writeFile(path.join(directory, 'outside.webm'), Buffer.from([9]))
  await fs.symlink(path.join(directory, 'outside.webm'), path.join(artifacts, 'link.webm'))
  await assert.rejects(ArtifactJobIO.open(artifacts, { action: 'media.inspect', artifactId: 'link.webm' }), /outside|symbolic/)
  const io = await ArtifactJobIO.open(artifacts, assertMediaProcessRequest(sample))
  t.after(() => io.close())
  assert.deepEqual(await io.read(1, 2), new Uint8Array([2,3]))
  await assert.rejects(io.read(2, 3))
  await assert.rejects(io.read(-1, 1))
  await assert.rejects(io.write(1, 0, png))
  await assert.rejects(io.write(0, MEDIA_LIMITS.frameBytes, png), /limit/)
  await assert.rejects(io.write(0, 0, new Uint8Array(MEDIA_LIMITS.chunkBytes + 1)), /chunk/)
})

test('media jobs roll back partial artifacts and commit only validated PNG outputs', async (t) => {
  const { artifacts } = await fixture(t)
  const request = assertMediaProcessRequest(sample)
  const interrupted = await ArtifactJobIO.open(artifacts, request)
  await interrupted.write(0, 0, png.subarray(0, 10))
  await interrupted.close()
  assert.deepEqual(await fs.readdir(artifacts), ['source.webm'])
  await assert.rejects(interrupted.read(0, 1), /ended/)
  const invalid = await ArtifactJobIO.open(artifacts, request)
  await invalid.write(0, 0, new Uint8Array([1,2,3]))
  await assert.rejects(invalid.finish(1), /PNG/)
  await invalid.close()
  const valid = await ArtifactJobIO.open(artifacts, request)
  await valid.write(0, 0, png)
  const [output] = await valid.finish(1)
  assert.equal(path.dirname(output.path), await fs.realpath(artifacts))
  assert.deepEqual(await fs.readFile(output.path), png)
  assert.equal(output.bytes, png.length)
  await valid.close()
  assert.equal((await fs.readdir(artifacts)).length, 2)
})

test('media export refuses missing audio, discarded tracks and duplicate track mappings', () => {
  assertPreservedMediaTracks([1,2], [1,2], [], true)
  assert.throws(() => assertPreservedMediaTracks([1,2], [1], [], true), /discard/)
  assert.throws(() => assertPreservedMediaTracks([1,2], [1,2], ['no_encodable_target_codec'], true), /no_encodable_target_codec/)
  assert.throws(() => assertPreservedMediaTracks([1,2], [1,1], [], true), /discard/)
  assert.throws(() => assertPreservedMediaTracks([1,2], [], [], false), /discard/)
})

test('media processing rejects transparent video instead of silently changing its colors or alpha', () => {
  const video = { id: 1, type: 'video' as const, codec: 'vp8', canDecode: true, width: 320, height: 180 }
  assertProcessableVideoTracks([video])
  assert.throws(() => assertProcessableVideoTracks([{ ...video, hasAlphaData: true }]), /Transparent/)
  assert.throws(() => assertProcessableVideoTracks([{ ...video, width: 8192, height: 8192 }]), /resolution/)
})


test('Image admission rejects non-raster, huge or animated headers before decode and bounds cumulative pixels',()=>{
 const png=Buffer.alloc(45);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(320,16);png.writeUInt32BE(180,20);png.write('IEND',37)
 assert.equal(imageHeader(png).pixels,57600)
 const huge=Buffer.from(png);huge.writeUInt32BE(8192,16);huge.writeUInt32BE(8192,20);assert.throws(()=>imageHeader(huge),/pixel limit/)
 const animated=Buffer.from(png);animated.write('acTL',37);assert.throws(()=>imageHeader(animated),/Animated/)
 for(const data of [new Uint8Array([1,2,3]),Buffer.from('<svg></svg>'),png.subarray(0,32)])assert.throws(()=>imageHeader(data))
 const budget=new ImageDecodeBudget();budget.reserve(DECODE_BUDGET.sourcePixels);budget.reserve(DECODE_BUDGET.sourcePixels);assert.throws(()=>budget.reserve(1),/shared/)
 assert.throws(()=>assertImageInspection({kind:'image',contentType:'image/png',width:320,height:180,pixels:1,bytes:45,canDecode:true}))
 assert.throws(()=>assertNativeProcessingRequest({action:'media.image.inspect',artifactId:'../photo.png'}));assert.throws(()=>assertNativeProcessingRequest({action:'media.encode.check',width:321,height:180,fps:24}))
 const request=assertNativeProcessingRequest({action:'media.encode.check',width:320,height:180,fps:24});assert.throws(()=>assertMediaWorkerResult({kind:'encoding',info:{kind:'encoding',width:640,height:180,fps:24,videoCodec:'avc',audioCodec:'aac',videoSupported:true,audioSupported:true}},request),/mismatch/)
 assert.throws(()=>assertEncodingInspection({kind:'encoding',width:320,height:180,fps:24,videoCodec:'avc',audioCodec:'aac',videoSupported:'yes',audioSupported:true}))
})


test('Image drawing admits bounded primitives and rejects executable, outside, transparent-redaction and aggregate inputs',()=>{
 const draw={action:'media.image.draw',width:320,height:180,shapes:[{type:'rect',x:10,y:10,width:30,height:20}]}
 const admitted=assertImageDrawingRequest(draw);assert.equal(admitted.action,'media.image.draw')
 if(admitted.action==='media.image.draw')assert.equal(admitted.background,'#ffffff')
 for(const extra of [{html:'<canvas>'},{svg:'<svg/>'},{path:'/tmp/output.png'},{filename:'overwrite.png'},{url:'https://example.com'},{width:4096,height:4096},{width:NaN},{width:3},{shapes:[]},{shapes:Array(129).fill(draw.shapes[0])},{shapes:[{...draw.shapes[0],x:310}]},{shapes:[{...draw.shapes[0],color:'red'}]},{shapes:[{...draw.shapes[0],image:'https://example.com'}]}])assert.throws(()=>assertImageDrawingRequest({...draw,...extra}))
 const annotate={action:'media.image.annotate',artifactId:'original.png',shapes:[{type:'arrow',x1:10,y1:20,x2:80,y2:70}]}
 for(const artifactId of ['../image.png','/tmp/image.png','https://example.com/image.png'])assert.throws(()=>assertImageDrawingRequest({...annotate,artifactId}))
 for(const opacity of [.5,0])assert.throws(()=>assertImageDrawingRequest({...annotate,shapes:[{type:'redact',x:1,y:1,width:20,height:20,opacity}]}))
 assert.throws(()=>assertImageDrawingRequest({...annotate,shapes:[{type:'redact',x:1,y:1,width:20,height:20,color:'#00000080'}]}))
 assert.throws(()=>assertImageDrawingRequest({...annotate,shapes:[{type:'line',x1:1,y1:1,x2:1,y2:1}]}))
 const path={type:'path',points:Array.from({length:256},(_,i)=>({x:i,y:20}))}
 assert.throws(()=>assertImageDrawingRequest({...draw,shapes:Array(17).fill(path)}),/point budget/)
 assert.throws(()=>assertImageDrawingRequest({...draw,shapes:[{...path,points:Array(257).fill({x:0,y:0})}]}),/256/)
 assert.throws(()=>assertImageDrawingRequest({...draw,shapes:Array(9).fill({type:'text',x:0,y:0,text:'x'.repeat(512)})}),/text budget/)
 assert.throws(()=>assertImageDrawingRequest({...draw,shapes:[{type:'text',x:0,y:0,text:'x',bold:'true'}]}))
 assert.equal(DRAWING_LIMITS.canvasPixels,8_388_608)
 const request=assertImageDrawingRequest(annotate);assertDrawingResult({kind:'drawing',width:320,height:180,shapeCount:1},request)
 assert.throws(()=>assertDrawingBounds(request.shapes,64,64),/outside/)
 assert.throws(()=>assertDrawingResult({kind:'drawing',width:320,height:180,shapeCount:0},request),/result/)
 assert.throws(()=>assertDrawingResult({kind:'drawing',width:640,height:360,shapeCount:1},admitted),/mismatch/)
 assert.throws(()=>assertMediaWorkerResult({kind:'inspection'},request))
 assert.equal(assertMediaProcessRequest({...annotate,tabId:'ignored-project-tab'}).action,'media.image.annotate')
 assert.equal(assertNativeProcessingRequest({action:'media.image.inspect',artifactId:'original.png',tabId:'ignored-project-tab'}).action,'media.image.inspect')
})

test('Drawing output IO has no input, bounds PNG writes and rolls back failed dimensions without changing existing images',async t=>{
 const {artifacts}=await fixture(t);await fs.writeFile(path.join(artifacts,'original.png'),png)
 const request=assertImageDrawingRequest({action:'media.image.draw',width:64,height:64,shapes:[{type:'ellipse',x:5,y:5,width:20,height:20}]})
 const io=await ArtifactJobIO.open(artifacts,request)
 await assert.rejects(io.read(0,1),/no input/)
 await assert.rejects(io.write(1,0,png));await assert.rejects(io.write(0,MEDIA_LIMITS.frameBytes,png),/limit/)
 await io.write(0,0,png);await assert.rejects(io.finish(1,{width:64,height:64}),/dimensions/);await io.close()
 assert.deepEqual((await fs.readdir(artifacts)).sort(),['original.png','source.webm']);assert.deepEqual(await fs.readFile(path.join(artifacts,'original.png')),png)
 const annotation=await ArtifactJobIO.open(artifacts,assertImageDrawingRequest({action:'media.image.annotate',artifactId:'original.png',shapes:[{type:'rect',x:0,y:0,width:1,height:1}]}))
 await annotation.write(0,0,png);const [output]=await annotation.finish(1,{width:1,height:1})
 assert.notEqual(output.artifactId,'original.png');assert.deepEqual(await fs.readFile(path.join(artifacts,'original.png')),png)
})
