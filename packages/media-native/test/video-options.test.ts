import assert from 'node:assert/strict'
import test from 'node:test'
import {normalizeVideoPreferences,resolveVideoOutput,saveVideoTemplate,assertVideoDimensions,assertVideoOptions} from '../src/video-options.js'

test('video ratios map to bounded even landscape portrait and square resolutions',()=>{
  const dimensions={'16:9':[1920,1080],'9:16':[1080,1920],'1:1':[1080,1080],'4:3':[1440,1080],'3:4':[1080,1440]}
  for(const [aspectRatio,[width,height]] of Object.entries(dimensions)){const result=resolveVideoOutput({}, {aspectRatio,resolution:'1080p'});assert.deepEqual([result.width,result.height],[width,height]);assertVideoDimensions(width,height)}
  for(const [width,height] of [[1921,1080],[1920,1920],[500,500.1],[1080,1940],[1000,720]])assert.throws(()=>assertVideoDimensions(width,height))
})
test('explicit video overrides beat template snapshots and defaults with nested watermark merge',()=>{
  const prefs=saveVideoTemplate({defaults:{aspectRatio:'1:1'},templates:[]},'竖屏解读',{aspectRatio:'9:16',resolution:'1080p',style:'clean-light',watermark:{text:'创作者',opacity:.4}})
  const result=resolveVideoOutput(prefs,{resolution:'720p',watermark:{enabled:false}},'竖屏解读')
  assert.deepEqual([result.width,result.height],[720,1280]);assert.equal(result.style,'clean-light');assert.equal(result.watermark.text,'创作者');assert.equal(result.watermark.enabled,false);assert.equal(result.watermark.opacity,.4)
  prefs.defaults.style='minimal';assert.equal(resolveVideoOutput(prefs,{},'竖屏解读').style,'clean-light')
  assert.throws(()=>resolveVideoOutput(prefs,{},'missing'),/找不到/)
  assert.throws(()=>resolveVideoOutput(prefs,{aspectRatio:'9:16'},undefined,{width:640,height:360}),/conflict/)
})
test('video templates and styles reject duplicate names arbitrary controls and oversized watermarks',()=>{
  for(const value of [{style:'<script>'},{watermark:{path:'/tmp/logo'}},{fps:60},{watermark:{text:'x'.repeat(61)}},{watermark:{enabled:'false'}},{aspectRatio:'32:9'},{resolution:'4k'}])assert.throws(()=>assertVideoOptions(value))
  assert.throws(()=>normalizeVideoPreferences({templates:[{name:'Demo',options:{}},{name:'demo',options:{}}]}),/不能重复/)
  assert.throws(()=>saveVideoTemplate({},'\n',{}))
  const prefs=saveVideoTemplate(saveVideoTemplate({},'Demo',{}),'demo',{style:'minimal'});assert.equal(prefs.templates.length,1);assert.equal(prefs.templates[0].options.style,'minimal')
})
