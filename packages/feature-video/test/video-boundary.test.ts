import assert from 'node:assert/strict'
import test from 'node:test'
import { videoFeature } from '../index.js'
import { BrowserCapabilityRegistry } from '../../browser-capability/src/browser-capability-registry.js'

test('video actions remain feature-owned in one browser tool and require trusted narration consent', async () => {
  const registry = new BrowserCapabilityRegistry({id:'video-product',name:'BMW',features:[videoFeature]})
  assert.equal(registry.toolDefinition().name,'browser')
  assert.equal(registry.ownerOf('video.compose'),'feature-video')
  assert.equal(registry.ownerOf('video.narrate'),'feature-video')
  let calls = 0
  const context = {browserKernel:{projectStore:{active:()=>({id:'p',name:'P',directory:'/project'})},settingsStore:{snapshot:()=>({edgeNarrationEnabled:false}),update:()=>({})},execute:async()=>({}),recordingController:{compose:async()=>({}),processArtifact:async()=>({}),narrate:async()=>{calls++;return {} }}}}
  await assert.rejects(registry.execute('video.narrate',context,{action:'video.narrate',narrationRequest:{text:'你好',provider:'edge-readaloud'}}),/disabled/)
  assert.equal(calls,0)
})
