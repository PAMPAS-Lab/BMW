import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaCapturePolicyInternals } from '../src/capture-policy.js'

test('browser-native video capture filenames remain Project-local WebM artifacts', () => {
  assert.equal(mediaCapturePolicyInternals.safeCaptureFilename('../../Arena: latest video.mp4'), 'Arena- latest video.mp4.webm')
  assert.equal(mediaCapturePolicyInternals.safeCaptureFilename('capture.webm'), 'capture.webm')
  assert.equal(mediaCapturePolicyInternals.safeCaptureFilename(''), 'captured-video.webm')
})

test('video chunk decoding ignores commas inside codec parameters', () => {
  const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
  const dataUrl = `data:video/webm;codecs=vp9,opus;base64,${webmHeader.toString('base64')}`
  const payload = mediaCapturePolicyInternals.base64PayloadFromDataUrl(dataUrl)
  assert.deepEqual(Buffer.from(payload, 'base64'), webmHeader)
})
