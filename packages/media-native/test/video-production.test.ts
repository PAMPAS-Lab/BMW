import {assertVisualEffects,visualEffectFilter} from '../src/visual-effects.js'
import {scenePlaybackClock} from '../src/scene-playback-window.js'
import {assertVisualLayers,assertAudioLayers,activeVisualLayers,visualLayerBox,layerFadeGain,assertLayerFadeWindow} from '../src/composition-layers.js'
import {reviewSceneText,assertCompositionText} from '../src/media/composition-text.js'
import {assertVisualEffectWindow,assertFocusIntervals,focusFraming,visibleFocusIntervals} from '../src/focus-contract.js'
import {assertRecordingEvents,recordingEvents,suggestRecordingFocus} from '../src/recording-contract.js'
import {visualAtTime,fitVisualSegments} from '../src/visual-segments.js'
import {captionDocument} from '../src/caption-export.js'
import {exportProjectText} from '../src/text-export.js'
import {mixSourceAudioChunk} from '../src/source-audio.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertNarrationReceipt,assertComposition, compositionAssets, compositionDuration, sceneAtTime, estimatedCaptionCues } from '../src/composition-contract.js'
import { assertNarration } from '../src/narration-contract.js'
import { ArtifactJobIO } from '../src/artifact-job-io.js'
const scene = { title: '介绍', durationSeconds: 10, videoArtifactId: 'page.webm' }
test('seekable composition validates Project IDs, bounds and real narration assets', () => {
  const composition = assertComposition({title:'产品介绍',scenes:[scene,{...scene,title:'下一段',durationSeconds:20}]})
  assert.equal(compositionDuration(composition),30); assert.deepEqual(compositionAssets(composition),['page.webm'])
  assert.deepEqual(sceneAtTime(composition,10),{index:1,localSeconds:0,startSeconds:10})
  assert.throws(()=>sceneAtTime(composition,30),/outside/)
  for (const changed of [{videoArtifactId:'../outside.webm'},{videoArtifactId:'https://example.com/a'},{durationSeconds:NaN},{durationSeconds:Infinity},{zoom:2},{playbackRate:0},{crop:{x:.7,y:0,width:.6,height:1}},{narration:'假旁白'},{script:'alert(1)'}]) assert.throws(()=>assertComposition({title:'x',scenes:[{...scene,...changed}]}))
  assert.throws(()=>assertComposition({title:'x',scenes:Array.from({length:4},()=>({...scene,durationSeconds:60}))}),/three minutes/)
})
test('narration fixes provider and voices and rejects SSML control or arbitrary endpoints', () => {
  assert.equal(assertNarration({text:'你好，世界。'}).voice,'zh-CN-YunxiNeural')
  for (const input of [{text:''},{text:'x',voice:'unknown'},{text:'x',endpoint:'https://evil.test'},{text:'x',ratePercent:NaN},{text:'x',ratePercent:100},{text:'\u0000'}]) assert.throws(()=>assertNarration(input))
})
test('composition output handle rejects input reads and cleans partial output on cancellation', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-composition-io-'))
  try {
    const io=await ArtifactJobIO.createOutput(root)
    await assert.rejects(io.read(0,1),/no input/)
    await io.write(0,0,new Uint8Array([0,0,0,20,102,116,121,112,0,0,0,0]))
    await assert.rejects(io.write(1,0,new Uint8Array([1])),/output index/)
    await io.close(); assert.deepEqual(await fs.readdir(root),[])
  } finally {await fs.rm(root,{recursive:true,force:true})}
})

test('Selected source sound trims, retimes, scales mono and stops at its endpoint and scene boundary',()=>{
  const mono=Float32Array.from({length:48000},(_,index)=>index/48000),chunk={sampleRate:48000,numberOfChannels:1,length:mono.length,getChannelData:()=>mono}
  const output=[new Float32Array(3*48000),new Float32Array(3*48000)];mixSourceAudioChunk(output,chunk,0,1,1,.25,2,.5)
  assert.equal(output[0][47999],0);assert.ok(Math.abs(output[0][48000]-.125)<1e-6);assert.ok(Math.abs(output[0][54000]-.25)<1e-6);assert.equal(output[0][66000],0,'No repeated sound after the available .375 seconds');assert.deepEqual(output[0],output[1])
  const bounded=[new Float32Array(48000)];mixSourceAudioChunk(bounded,chunk,0,0,.2,0,1,1);assert.ok(bounded[0][9500]>.19);assert.equal(bounded[0][9600],0,'No bleed into following scene')
})
test('Caption and source audio contracts stay closed and captions estimate within scene-local time',()=>{
  const style={fontSize:28,color:'#ffffff',background:'outline',position:'top',align:'left',offsetPercent:0};const raw={title:'Style',durationSeconds:4,narration:'One sentence. Another sentence.',audioArtifactId:'voice.wav',videoArtifactId:'clip.mp4',captionStyle:style,voiceMuted:true,voiceVolume:.4,keepSourceAudio:true,sourceVolume:.5}
  const composition=assertComposition({title:'x',scenes:[raw]});assert.equal(composition.scenes[0].keepSourceAudio,true);assert.equal(composition.scenes[0].voiceMuted,true);assert.equal(composition.scenes[0].voiceVolume,.4)
  const cues=estimatedCaptionCues(composition.scenes[0],640,360,2);assert.ok(cues.length);assert.equal(cues[0].startSeconds,.5);assert.equal(cues.at(-1)!.endSeconds,2.5)
  for(const changed of [{voiceMuted:'yes'},{voiceMuted:1},{voiceMuted:null},{keepSourceAudio:'yes'},{sourceVolume:3},{captionStyle:{...style,color:'url(https://example.com)'}},{captionStyle:{...style,fontSize:65}},{captionStyle:{...style,fontUrl:'https://example.com'}}])assert.throws(()=>assertComposition({title:'x',scenes:[{...raw,...changed}]}))
})


test('Visual segments admit bounded clips, preserve scene time and expose deterministic fade boundaries',()=>{
 const composition=assertComposition({title:'Segments',scenes:[{title:'Continuous speech',durationSeconds:4,audioArtifactId:'voice.wav',narration:'Speech',visualSegments:[{imageArtifactId:'one.png',durationSeconds:2},{videoArtifactId:'two.mp4',durationSeconds:2,sourceStartSeconds:.5,playbackRate:2,transition:'fade',transitionSeconds:.5,keepSourceAudio:true}]}]})
 const scene=composition.scenes[0];assert.deepEqual(compositionAssets(composition),['one.png','two.mp4','voice.wav']);assert.equal(visualAtTime(scene,1)?.index,0);assert.equal(visualAtTime(scene,2)?.index,1);assert.equal(visualAtTime(scene,2)?.opacity,0);assert.equal(visualAtTime(scene,2.25)?.opacity,.5);assert.equal(visualAtTime(scene,1.75)?.opacity,.5)
 fitVisualSegments(scene.visualSegments!,6);assert.deepEqual(scene.visualSegments!.map(segment=>segment.durationSeconds),[3,3]);assert.equal(scene.audioArtifactId,'voice.wav')
 for(const changed of [{...scene,durationSeconds:7},{...scene,imageArtifactId:'extra.png'},{...scene,visualSegments:Array(9).fill({imageArtifactId:'one.png',durationSeconds:1})},{...scene,visualSegments:[{imageArtifactId:'../outside',durationSeconds:6}]},{...scene,visualSegments:[{imageArtifactId:'one.png',durationSeconds:6,transition:'html'}]}])assert.throws(()=>assertComposition({title:'Invalid',scenes:[changed]}))
})

test('SRT and VTT use global cumulative milliseconds, respect disabled captions and label estimated timing',()=>{
 const scenes=assertComposition({title:'Subtitles',scenes:[{title:'First',durationSeconds:2,captions:[{startSeconds:.5,endSeconds:1.5,text:'你好\n<script>literal</script>'}]},{title:'Second',durationSeconds:3,narration:'Second sentence.',audioArtifactId:'voice.wav'},{title:'Disabled',durationSeconds:1,narration:'No captions',audioArtifactId:'voice.wav',captions:[]}]}).scenes
 const srt=captionDocument(scenes,640,360,'srt');assert.equal(srt.timing,'mixed');assert.match(srt.text,/00:00:00,500 --> 00:00:01,500/);assert.match(srt.text,/00:00:02,500 --> 00:00:03,000/);assert.match(srt.text,/&lt;script&gt;/);assert.doesNotMatch(srt.text,/No captions/)
 const vtt=captionDocument(scenes,640,360,'vtt');assert.ok(vtt.text.startsWith('WEBVTT\n\n'));assert.match(vtt.text,/00:00:02\.500 --> 00:00:03\.000/)
 assert.throws(()=>captionDocument([{...scenes[0],captions:[]}],640,360,'srt'),/No enabled/)
})

test('Bounded Project text export cancels and removes its own output without replacing existing artifacts',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-text-export-'));try{
  await fs.writeFile(path.join(root,'existing.srt'),'Keep');const controller=new AbortController();let checks=0
  await assert.rejects(exportProjectText(root,'srt','Caption',controller.signal,()=>{if(++checks===2)throw new Error('STUDIO_CONFLICT')}),/STUDIO_CONFLICT/);assert.deepEqual(await fs.readdir(root),['existing.srt'])
  controller.abort(new Error('Cancelled'));await assert.rejects(exportProjectText(root,'vtt','Caption',controller.signal),/Cancelled/)
  const result=await exportProjectText(root,'vtt','WEBVTT\n\n');assert.equal(await fs.readFile(path.join(root,result.artifactId),'utf8'),'WEBVTT\n\n');assert.equal(await fs.readFile(path.join(root,'existing.srt'),'utf8'),'Keep')
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('Source focus retimes through trims and segments and keeps framing inside the original crop',()=>{
 const intervals=assertFocusIntervals([{startSeconds:4,endSeconds:8,x:.9,y:.1,zoom:4,emphasize:true}])
 const visual={videoArtifactId:'record.webm',sourceStartSeconds:2,playbackRate:2,focusIntervals:intervals,crop:{x:.2,y:.2,width:.6,height:.6}}
 assert.deepEqual(visibleFocusIntervals(visual,8).map(({start,end})=>({start,end})),[{start:1,end:3}])
 const frame=focusFraming(visual,2);assert.equal(frame.strength,1);assert.equal(frame.crop.width,.15);assert.equal(frame.crop.x,.65);assert.equal(frame.crop.y,.2)
 assert.deepEqual(focusFraming(visual,0).crop,visual.crop);assert.equal(focusFraming(visual,1).strength,0)
 const scene=assertComposition({title:'Focus',scenes:[{title:'x',durationSeconds:8,visualSegments:[{...visual,durationSeconds:8}]}]}).scenes[0]
 assert.deepEqual(scene.visualSegments![0].focusIntervals,intervals)
 for(const invalid of [[{...intervals[0],x:2}],[{...intervals[0],endSeconds:4}],[{...intervals[0],script:'paint()'}],[intervals[0],{...intervals[0],startSeconds:7}],Array(25).fill(intervals[0])])assert.throws(()=>assertFocusIntervals(invalid))
 assert.throws(()=>assertComposition({title:'x',scenes:[{...scene,focusIntervals:intervals}]}),/each visual segment/)
})
test('Recording evidence has a closed clock/coordinate domain, filters pre-roll and groups real and Agent clicks honestly',()=>{
 const event={epochMs:101000,kind:'click' as const,source:'page-event' as const,x:400,y:200,viewportWidth:800,viewportHeight:400,surfaceWidth:800,surfaceHeight:400,dpr:2,scrollX:0,scrollY:900}
 const record=recordingEvents('record.webm',{startedEpochMs:100000,width:1600,height:800},8,{events:[{...event,epochMs:99999},event,{...event,epochMs:101500,source:'agent-action'},{...event,epochMs:107000,x:700}],truncated:false,reason:'requested'},[{sourceEpochMs:101100,outputSeconds:1.1},{sourceEpochMs:101600,outputSeconds:1.6},{sourceEpochMs:107100,outputSeconds:7.1}])
 assert.equal(record.events.length,3);assert.equal(record.events[0].seconds,1.1);assert.equal(record.events[0].pageSeconds,1);assert.equal(record.events[0].timing,'measured-frame');assert.equal(record.events[1].source,'agent-action');assert.equal(record.events[0].dpr,2)
 const focus=suggestRecordingFocus(record);assert.equal(focus.length,2);assert.equal(focus[0].endSeconds,3.6);assert.equal(focus[0].zoom,1.5);assert.equal(focus[0].x,.5)
 assert.throws(()=>assertRecordingEvents(record,'other.webm'),/another video/)
 for(const raw of [{...record,events:[{...record.events[0],inputText:'secret'}]},{...record,events:[{...record.events[0],url:'https://site.test/?token=secret'}]},{...record,events:[{...record.events[0],seconds:9}]},{...record,events:[{...record.events[0],x:900}]},{...record,events:Array(5001).fill(record.events[0])}])assert.throws(()=>assertRecordingEvents(raw))
})

test('Title-card reveal has bounded scene-local times, exact bullet identity and no footage; legacy bullets stay immediate',()=>{
 const base={title:'板书',music:false,scenes:[{title:'推导',durationSeconds:4,bullets:['步骤一','步骤二'],bulletRevealSeconds:[.6,2]}]}
 assert.deepEqual(assertComposition(base).scenes[0].bulletRevealSeconds,[.6,2])
 for(const times of [[0],[-1,2],[0,4],[0,NaN],[0,Infinity]])assert.throws(()=>assertComposition({...base,scenes:[{...base.scenes[0],bulletRevealSeconds:times}]}))
 assert.throws(()=>assertComposition({...base,scenes:[{...base.scenes[0],imageArtifactId:'board.png'}]}),/no footage/)
 const {bulletRevealSeconds,...legacy}=base.scenes[0];assert.equal(assertComposition({...base,scenes:[legacy]}).scenes[0].bulletRevealSeconds,undefined)
})

test('Bilingual SRT and VTT select original, translation or both without changing timing',()=>{
 const composition=assertComposition({title:'字幕',scenes:[{title:'scene',durationSeconds:3,captions:[{startSeconds:0,endSeconds:2,text:'Hello world',translationText:'你好世界'}]}]})
 for(const mode of ['original','translation','bilingual'] as const){composition.scenes[0].captionDisplay=mode;const srt=captionDocument(composition.scenes,1280,720,'srt').text,vtt=captionDocument(composition.scenes,1280,720,'vtt').text;assert.ok(srt.includes('00:00:00,000 --> 00:00:02,000'));assert.equal(srt.includes('Hello world'),mode!=='translation');assert.equal(vtt.includes('你好世界'),mode!=='original')}
 assert.throws(()=>assertComposition({...composition,scenes:[{...composition.scenes[0],captionDisplay:'secret'}]}))
})
test('Fixed templates validate bounded colors/content and reject text overflow before encoding',()=>{
 const measure={font:'',measureText(text:string){const size=Number(/([0-9]+)px/.exec(this.font)?.[1]??24);return {width:text.length*size*.7}}}
 for(const kind of ['summary','comparison','screenshot'] as const){const composition=assertComposition({title:'template',width:540,height:720,scenes:[{title:'固定模板',durationSeconds:8,sceneTemplate:{kind,accentColor:'#22cc88'},bullets:kind==='summary'?['观点一','观点二','观点三']:kind==='comparison'?['方案一','方案二']:['截图说明'],...(kind==='screenshot'?{imageArtifactId:'source.png'}:{})}]});assertCompositionText(measure,composition);assert.equal(reviewSceneText(measure,composition.scenes[0],540,720).filter(i=>i.severity==='error').length,0)}
 for(const sceneTemplate of [{kind:'html',markup:'<b>x</b>'},{kind:'summary',accentColor:'url(x)'},{kind:'comparison',emphasisIndex:99}])assert.throws(()=>assertComposition({title:'bad',scenes:[{title:'s',durationSeconds:8,sceneTemplate}]}))
 const wrong=assertComposition({title:'wrong',scenes:[{title:'s',durationSeconds:8,sceneTemplate:{kind:'summary'},bullets:['only one']}]});assert.throws(()=>assertCompositionText(measure,wrong),/三点总结/)
 const overflowing=assertComposition({title:'overflow',width:360,height:640,scenes:[{title:'s',durationSeconds:8,captions:[{startSeconds:0,endSeconds:.3,text:'字幕'.repeat(90),translationText:'x'.repeat(190)}]}]});assert.throws(()=>assertCompositionText(measure,overflowing),/字幕/)
 const warnings=reviewSceneText(measure,{...wrong.scenes[0],sceneTemplate:undefined,captions:[{startSeconds:0,endSeconds:.1,text:'很密集的字幕内容'}],captionStyle:{fontSize:22,color:'#ffffff',background:'none',position:'center',align:'center',offsetPercent:0}},1280,720);assert.ok(warnings.some(i=>i.code==='caption-density'));assert.ok(warnings.some(i=>i.code==='text-overlap'))
})

const overlay={id:'pip',title:'画中画',kind:'image',artifactId:'picture.png',startSeconds:1,durationSeconds:2,x:.5,y:.2,width:.4,height:.4,color:'#ffffff'}
test('independent layers validate identities, Project references, ranges and video decoder overlap',()=>{
 const composition=assertComposition({title:'Layers',music:false,layers:[{...overlay,id:'global'}],audioTracks:[{id:'music',title:'配乐',artifactId:'music.wav',startSeconds:0,durationSeconds:4}],scenes:[{title:'One',durationSeconds:4,imageArtifactId:'base.png',layers:[overlay]}]})
 assert.deepEqual(compositionAssets(composition),['base.png','picture.png','music.wav'])
 assert.equal(activeVisualLayers(composition,composition.scenes[0],1.5,1.5).length,2)
 assert.equal(activeVisualLayers(composition,composition.scenes[0],.5,.5).length,0)
 assert.throws(()=>assertComposition({...composition,layers:[overlay]}),/Duplicate/)
 assert.throws(()=>assertVisualLayers([{...overlay,artifactId:'../elsewhere.png'}]),/artifactId/)
 assert.throws(()=>assertVisualLayers([{...overlay,script:'anything'}]),/Unsupported/)
 assert.throws(()=>assertVisualLayers([{...overlay,x:.9}]),/inside/)
 assert.throws(()=>assertAudioLayers([{id:'bad',title:'bad',artifactId:'http://example.com/music',startSeconds:0,durationSeconds:2}]),/artifactId/)
 assert.throws(()=>assertComposition({...composition,layers:[{...overlay,id:'range',durationSeconds:4}]}),/超过/)
 assert.throws(()=>assertComposition({title:'Too many decoders',scenes:[{title:'One',durationSeconds:4,layers:Array.from({length:5},(_,index)=>({...overlay,id:'video-'+index,kind:'video',artifactId:'clip.webm'}))}]}),/four simultaneous/)
 assertComposition({title:'Sequential decoders',scenes:[{title:'One',durationSeconds:4,layers:Array.from({length:5},(_,index)=>({...overlay,id:'video-'+index,kind:'video',artifactId:'clip.webm',startSeconds:index*.4,durationSeconds:.4}))}]})
})
test('explicit layer keyframes interpolate geometry and fading without changing base values',()=>{
 const layer=assertVisualLayers([{...overlay,opacity:.8,fadeInSeconds:1,fadeOutSeconds:1,keyframes:[{timeSeconds:0,x:0,y:.2,width:.4,height:.4,opacity:.4,easing:'linear'},{timeSeconds:2,x:.5,y:.2,width:.4,height:.4,opacity:1,easing:'ease-in-out'}]}])[0]
 const box=visualLayerBox(layer,1);assert.equal(box.x,.25);assert.equal(box.opacity,.7);assert.equal(layer.x,.5)
 assert.equal(visualLayerBox(layer,0).opacity,0);assert.ok(visualLayerBox(layer,1.8).opacity<.25)
 assert.throws(()=>assertVisualLayers([{...overlay,keyframes:layer.keyframes?.slice().reverse()}]),/increasing/)
 assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[{timeSeconds:1,x:0,y:0,width:1,height:1,opacity:1,easing:'javascript'}]}]),/two to twelve/)
})
test('streamed source audio supports bounded fade gain without samples outside the selected interval',()=>{
 const target=[new Float32Array(48000)],chunk={sampleRate:48000,numberOfChannels:1,length:48000,getChannelData:()=>new Float32Array(48000).fill(.8)}
 mixSourceAudioChunk(target,chunk,0,.25,.5,0,1,.5,time=>Math.min(1,time/.1,(.5-time)/.1))
 assert.equal(target[0][11999],0);assert.equal(target[0][12000],0);assert.ok(Math.abs(target[0][24000]-.4)<.00001);assert.equal(target[0][36000],0)
})

test('Restricted easing admits only closed increasing domains and stays stable near curve endpoints',()=>{
 const frame={timeSeconds:0,x:0,y:0,width:.2,height:.2,opacity:.2,easing:'linear'},last={...frame,timeSeconds:2,x:.5,opacity:1,easing:'ease-in-out'}
 assert.throws(()=>assertVisualLayers([{...overlay,kind:['image']}]),/Unsupported/)
 for(const easing of [['linear'],['ease-in-out'],{toString:()=> 'linear'}])assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[frame,{...last,easing}]}]),/Unknown animation/)
 for(const range of [[0,0],[.7,.3],[-.1,.5],[0,1.1],[0,NaN],[0,Infinity],[0,1,.5],'0,1',{}])assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[frame,{...last,easingRange:range}]}]),/range/)
 assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[frame,{...last,easing:'linear',easingRange:[0,1]}]}]),/range/)
 assert.throws(()=>assertVisualLayers([{...overlay,keyframes:[frame,{...last,easingRange:[0,1],expression:'code'}]}]),/Unsupported/)
 for(const range of [[0,1],[.1,.9],[0,1e-8],[1-1e-8,1]]){
  const layer=assertVisualLayers([{...overlay,keyframes:[frame,{...last,easingRange:range}]}])[0]
  assert.equal(visualLayerBox(layer,0).x,0);assert.equal(visualLayerBox(layer,2).x,.5)
  let previous=-1;for(let i=0;i<=100;i++){const x=visualLayerBox(layer,i/50).x;assert.ok(Number.isFinite(x)&&x>=previous-1e-12&&x>=0&&x<=.5);previous=x}
  const fraction=visualLayerBox(layer,1).x/.5
  if(range[1]===1e-8)assert.ok(Math.abs(fraction-.25)<1e-7)
  if(range[0]===1-1e-8)assert.ok(Math.abs(fraction-.75)<1e-7)
 }
})


test('Visual effect clocks are finite closed bounded data with unique piece identities',()=>{
 const window={originId:'origin',startSeconds:.2,durationSeconds:2,fadeInSeconds:.3,fadeOutSeconds:.3}
 const composition=()=>({title:'Window',scenes:[{title:'One',durationSeconds:1,visualSegments:[{id:'piece',imageArtifactId:'image.png',durationSeconds:1,effectWindow:window}]}]})
 assertComposition(composition());assert.deepEqual(assertVisualEffectWindow(window),window)
 for(const extra of [{expression:'code'},{startSeconds:NaN},{durationSeconds:Infinity},{originId:['origin']},{startSeconds:2},{fadeInSeconds:2}])assert.throws(()=>assertVisualEffectWindow({...window,...extra}))
 assert.throws(()=>assertComposition({...composition(),scenes:[{...composition().scenes[0],visualSegments:[{...composition().scenes[0].visualSegments[0],durationSeconds:1,effectWindow:{...window,startSeconds:1.2}}]}]}),/exceeds/)
 assert.throws(()=>assertComposition({...composition(),scenes:[{...composition().scenes[0],durationSeconds:2,visualSegments:[...composition().scenes[0].visualSegments,...composition().scenes[0].visualSegments]}]}),/Duplicate visual/)
})

test('Closed independent fade windows admit short preserved pieces and reject invalid original clocks',()=>{
 const fadeWindow={originId:'original-fade',startSeconds:.2,durationSeconds:2},visual={id:'window-visual',title:'Window',kind:'rectangle',startSeconds:0,durationSeconds:.1,x:.1,y:.1,width:.2,height:.2,color:'#ffffff',fadeInSeconds:1,fadeOutSeconds:.5,fadeWindow}
 const v=assertVisualLayers([visual])[0],a=assertAudioLayers([{id:'window-audio',title:'Audio',artifactId:'tone.wav',startSeconds:0,durationSeconds:.1,fadeInSeconds:1,fadeOutSeconds:.5,fadeWindow}])[0]
 assert.ok(Math.abs(layerFadeGain(v,.05)-.25)<1e-12);assert.equal(visualLayerBox(v,.05).opacity,layerFadeGain(a,.05));assert.deepEqual(assertLayerFadeWindow(fadeWindow),fadeWindow)
 for(const extra of [{expression:'code'},{startSeconds:-1},{startSeconds:Infinity},{startSeconds:2},{durationSeconds:NaN},{originId:'../outside'},{originId:false}])assert.throws(()=>assertVisualLayers([{...visual,fadeWindow:{...fadeWindow,...extra}}]))
 assert.throws(()=>assertAudioLayers([{...a,fadeWindow:{...fadeWindow,startSeconds:1.95}}]),/超过保留/)
 assert.throws(()=>assertVisualLayers([{...visual,fadeInSeconds:1.01}]),/fade in/);assert.throws(()=>layerFadeGain(a,NaN),/Invalid fade/)
 assert.equal(assertVisualLayers([{...visual,fadeWindow:undefined,fadeInSeconds:.05,fadeOutSeconds:.05}])[0].fadeWindow,undefined)
 const composition=assertComposition({title:'Window schema',music:false,layers:[visual],audioTracks:[a],scenes:[{title:'Base',durationSeconds:2}]});assert.deepEqual(composition.layers![0].fadeWindow,fadeWindow)
})

test('Original presentation windows validate root bounds and preserve counters after repeated cuts',()=>{
 const origin={originId:'root-scene',startSeconds:2.52,durationSeconds:4,musicIndex:1,sceneNumber:1,sceneCount:2}
 const root={title:'Cut',durationSeconds:1.48,bullets:['A','B','C'],bulletRevealSeconds:[.2,1.7,2.9],presentationWindow:origin}
 const parsed=assertComposition({title:'Root clock',scenes:[root]}).scenes[0]
 assert.deepEqual(parsed.presentationWindow,origin);assert.deepEqual(parsed.bulletRevealSeconds,root.bulletRevealSeconds)
 assert.deepEqual(scenePlaybackClock(parsed,2,4),origin)
 const legacy=assertComposition({title:'Legacy',scenes:[scene]}).scenes[0]
 assert.deepEqual(scenePlaybackClock(legacy,2,4),{originId:'unsegmented',startSeconds:0,durationSeconds:10,musicIndex:3,sceneNumber:3,sceneCount:4})
 for(const change of [{originId:'../root'},{originId:['root']},{startSeconds:-1},{startSeconds:2.53},{startSeconds:'2.52'},{durationSeconds:61},{durationSeconds:NaN},{musicIndex:0},{musicIndex:1.5},{sceneNumber:3},{sceneCount:25},{sceneCount:'2'},{url:'https://example.test'},{shell:'run'}])assert.throws(()=>assertComposition({title:'Invalid',scenes:[{...root,presentationWindow:{...origin,...change}}]}))
 assert.throws(()=>assertComposition({title:'Invalid',scenes:[{...root,presentationWindow:null}]}))
 assert.throws(()=>assertComposition({title:'Invalid',scenes:[{...root,bulletRevealSeconds:[0,1,4]}]}),/bullet reveal/)
})

test('Native narration receipts distinguish source duration from short and silent playback pieces',()=>{
 const source={title:'Piece',durationSeconds:1.2,audioArtifactId:'voice.wav',voiceSegments:[{id:'piece',startSeconds:0,sourceStartSeconds:1,durationSeconds:1,playbackRate:1}]}
 const scenes=assertComposition({title:'Receipt',scenes:[source,{...source,voiceSegments:[]},{title:'No voice',durationSeconds:1}]}).scenes
 assert.deepEqual(assertNarrationReceipt(scenes,[2,2,0]),[2,2,0])
 for(const value of [[0,2,0],[1.9,2,0],[2,2,1],[2,181,0],[2,'2',0],[2,NaN,0],[2,2],[2,2,0,0]])assert.throws(()=>assertNarrationReceipt(scenes,value))
 const legacy=assertComposition({title:'Receipt',scenes:[{title:'Legacy',durationSeconds:3,audioArtifactId:'voice.wav'}]}).scenes
 assert.deepEqual(assertNarrationReceipt(legacy,[2]),[2]);assert.throws(()=>assertNarrationReceipt(legacy,[2.01]),/播放区间/)
})

test('Visual effects are closed finite numbers shared by scene footage, segments and independent objects',()=>{
 const effects=assertVisualEffects({brightness:.7,contrast:1.2,saturation:0,blurPixels:8})
 assert.equal(visualEffectFilter(effects),'brightness(0.7) contrast(1.2) saturate(0) blur(8px)');assert.equal(visualEffectFilter(assertVisualEffects({})),'none')
 const input={title:'Effects',durationSeconds:2,imageArtifactId:'source.png',effects},composition=assertComposition({title:'Effects',scenes:[input]});assert.deepEqual(composition.scenes[0].effects,effects)
 const segmented=assertComposition({title:'Effects',scenes:[{title:'Parts',durationSeconds:2,visualSegments:[{durationSeconds:1,imageArtifactId:'source.png',effects},{durationSeconds:1,videoArtifactId:'source.mp4'}]}]});assert.deepEqual(segmented.scenes[0].visualSegments![0].effects,effects)
 const layer={id:'effects-object',title:'Object',kind:'rectangle',startSeconds:0,durationSeconds:2,x:.1,y:.1,width:.2,height:.2,color:'#00cc00',effects};assert.deepEqual(assertVisualLayers([layer])[0].effects,effects)
 for(const bad of [{brightness:0},{brightness:2.01},{contrast:-.1},{saturation:3},{blurPixels:13},{blurPixels:NaN},{brightness:Infinity},{saturation:null},{blurPixels:'8px'},{css:'url(file://outside)'},{filter:'contrast(1)'},null,[]]){assert.throws(()=>assertVisualEffects(bad));assert.throws(()=>assertComposition({title:'Invalid',scenes:[{...input,effects:bad}]}));assert.throws(()=>assertVisualLayers([{...layer,effects:bad}]))}
 assert.throws(()=>assertComposition({title:'Invalid',scenes:[{title:'No footage',durationSeconds:2,effects}]}),/footage/);assert.throws(()=>assertComposition({...segmented,scenes:[{...segmented.scenes[0],effects}]}),/visual segment/)
})
