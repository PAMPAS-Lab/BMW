import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { artifactFilename, downloadMediaArtifact } from '../src/media-artifact.js'

test('media download writes a bounded Project artifact through the browser fetch adapter', async (t) => {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-media-artifact-'))
  t.after(() => fs.rmSync(projectDirectory, { recursive: true, force: true }))
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const artifact = await downloadMediaArtifact({
    projectDirectory,
    url: 'https://pbs.example/media/asset',
    filename: 'Latest post image',
    referrer: 'https://social.example/post/1',
    now: () => 1234,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '4' }
      })
    }
  })
  assert.equal(artifact.artifactId, '1234-Latest post image.jpg')
  assert.equal(artifact.type, 'image')
  assert.equal(artifact.bytes, 4)
  assert.deepEqual([...fs.readFileSync(artifact.path)], [1, 2, 3, 4])
  assert.equal(calls[0].init?.credentials, 'include')
  assert.equal(calls[0].init?.referrer, 'https://social.example/post/1')
})

test('media download rejects non-web URLs and responses beyond its byte limit', async () => {
  await assert.rejects(downloadMediaArtifact({
    projectDirectory: os.tmpdir(),
    url: 'file:///tmp/private.mov',
    fetchImpl: fetch
  }), /HTTP\(S\)/)
  await assert.rejects(downloadMediaArtifact({
    projectDirectory: os.tmpdir(),
    url: 'https://video.example/large.mp4',
    maximumBytes: 3,
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': '4' }
    })
  }), /download limit/)
})

test('artifact filenames remove path syntax and infer media extensions', () => {
  assert.equal(artifactFilename('../../latest:post', 'video/mp4', new URL('https://video.example/stream'), 99), '99-latest-post.mp4')
})

test('media download rejects and removes DASH initialization fragments', async (t) => {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-media-dash-init-'))
  t.after(() => fs.rmSync(projectDirectory, { recursive: true, force: true }))
  const initialization = Buffer.concat([
    Buffer.from([0, 0, 0, 32]),
    Buffer.from('ftypiso5iso6cmf2dash'),
    Buffer.from([0, 0, 0, 12]),
    Buffer.from('moov')
  ])
  await assert.rejects(downloadMediaArtifact({
    projectDirectory,
    url: 'https://video.example/vid/avc1/0/0/1920x1080/init.mp4',
    filename: 'not-a-full-video.mp4',
    fetchImpl: async () => new Response(initialization, {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': String(initialization.length) }
    })
  }), /DASH initialization segment/)
  assert.deepEqual(fs.readdirSync(path.join(projectDirectory, 'artifacts')), [])
})

test('media download cancellation aborts fetch and drains streaming writes before removing partial output', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-download-cancel-'))
  try {
    const controller=new AbortController();let entered:()=>void
    const started=new Promise<void>(resolve=>{entered=resolve})
    const pending=downloadMediaArtifact({projectDirectory:root,url:'https://example.com/clip.mp4',signal:controller.signal,fetchImpl:async(_url,init)=>{
      entered();return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}))
    }})
    const rejection=assert.rejects(pending,/cancel fetch/);await started;controller.abort(new Error('cancel fetch'));await rejection
    const streaming=new AbortController();let pulled:()=>void,cancelled=false
    const pull=new Promise<void>(resolve=>{pulled=resolve})
    const body=new ReadableStream<Uint8Array>({start(stream){stream.enqueue(new Uint8Array(4096));pulled()},cancel(){cancelled=true}})
    const write=downloadMediaArtifact({projectDirectory:root,url:'https://example.com/video.webm',signal:streaming.signal,fetchImpl:async()=>new Response(body,{headers:{'content-type':'video/webm'}})})
    const writeRejected=assert.rejects(write,/abort/i);await pull;await new Promise(resolve=>setTimeout(resolve,20));streaming.abort();await writeRejected
    assert.equal(cancelled,true);assert.deepEqual(fs.readdirSync(path.join(root,'artifacts')),[])
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})


test('failed media download never removes an existing artifact with the same filename', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-download-existing-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'artifacts'))
  const target = path.join(root, 'artifacts', '42-clip.mp4')
  const original = Buffer.from('preserved media')
  fs.writeFileSync(target, original)
  await assert.rejects(downloadMediaArtifact({
    projectDirectory: root, url: 'https://example.com/clip.mp4', now: () => 42,
    fetchImpl: async () => new Response(new Uint8Array(1024), { headers: { 'content-type': 'video/mp4' } })
  }), /EEXIST/)
  assert.deepEqual(fs.readFileSync(target), original)
})
