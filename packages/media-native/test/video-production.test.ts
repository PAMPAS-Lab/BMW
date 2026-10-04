import {visualAtTime,fitVisualSegments} from '../src/visual-segments.js'
import {captionDocument} from '../src/caption-export.js'
import {exportProjectText} from '../src/text-export.js'
import {mixSourceAudioChunk} from '../src/source-audio.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertComposition, compositionAssets, compositionDuration, sceneAtTime, estimatedCaptionCues } from '../src/composition-contract.js'
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
  const style={fontSize:28,color:'#ffffff',background:'outline',position:'top',align:'left',offsetPercent:0};const raw={title:'Style',durationSeconds:4,narration:'One sentence. Another sentence.',audioArtifactId:'voice.wav',videoArtifactId:'clip.mp4',captionStyle:style,keepSourceAudio:true,sourceVolume:.5}
  const composition=assertComposition({title:'x',scenes:[raw]});assert.equal(composition.scenes[0].keepSourceAudio,true)
  const cues=estimatedCaptionCues(composition.scenes[0],640,360,2);assert.ok(cues.length);assert.equal(cues[0].startSeconds,.5);assert.equal(cues.at(-1)!.endSeconds,2.5)
  for(const changed of [{keepSourceAudio:'yes'},{sourceVolume:3},{captionStyle:{...style,color:'url(https://example.com)'}},{captionStyle:{...style,fontSize:65}},{captionStyle:{...style,fontUrl:'https://example.com'}}])assert.throws(()=>assertComposition({title:'x',scenes:[{...raw,...changed}]}))
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
