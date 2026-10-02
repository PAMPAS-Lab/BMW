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
