import assert from 'node:assert/strict'
import test from 'node:test'
import { browserDeadlineMs } from '../src/browser-deadline.js'

test('Only bounded batch collect receives its ten-minute transport budget; reads, admission and malformed requests retain the default',()=>{
 assert.equal(browserDeadlineMs({action:'pages.read'}),210_000)
 assert.equal(browserDeadlineMs({action:'pages.discover'}),210_000)
 assert.equal(browserDeadlineMs({action:'library.collection-batch',collectionBatchRequest:{operation:'collect'}}),600_000)
 for(const operation of ['read','start','submit','list','cancel','recover','unknown'])assert.equal(browserDeadlineMs({action:'library.collection-batch',collectionBatchRequest:{operation}}),60_000)
 for(const collectionBatchRequest of [null,[],{},'collect'])assert.equal(browserDeadlineMs({action:'library.collection-batch',collectionBatchRequest}),60_000)
 assert.equal(browserDeadlineMs({action:'navigate',collectionBatchRequest:{operation:'collect'}}),60_000)
})

test('browser requests are finite while media jobs retain their long budget', () => {
  assert.equal(browserDeadlineMs({action:'media.preserve'}),7_260_000)
  assert.equal(browserDeadlineMs({action:'media.segment'}),1_260_000)
  for(const action of ['media.image.inspect','media.image.annotate','media.image.draw'])assert.equal(browserDeadlineMs({action}),300_000)
  for (const action of ['status', 'tabs.list', 'media.screenshot', 'navigate']) assert.equal(browserDeadlineMs({ action }), 60_000)
  for (const action of ['media.video.capture', 'media.convert', 'video.compose', 'video.narrate', 'video.studio']) assert.equal(browserDeadlineMs({ action }), 1_800_000)
})

test('Source acquisition budget includes bounded download, capture, cleanup and decode',()=>{assert.equal(browserDeadlineMs({action:'library.sources',sourceRequest:{operation:'acquire',method:'auto'}}),1_860_000);assert.equal(browserDeadlineMs({action:'library.sources',sourceRequest:{operation:'read'}}),60_000)})

test('YouTube player navigation allows bounded initialization while unrelated hosts keep the normal budget',()=>{for(const action of ['navigate','tabs.open']){assert.equal(browserDeadlineMs({action,url:'https://www.youtube.com/watch?v=zHBrUVyQJWc'}),100_000);assert.equal(browserDeadlineMs({action,url:'https://youtube.com.evil.test/watch?v=zHBrUVyQJWc'}),60_000)}})

test('Bounded local speech gets processing plus cleanup transport time',()=>{assert.equal(browserDeadlineMs({action:'media.speech.align'}),660_000)})
