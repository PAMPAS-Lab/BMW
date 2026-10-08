import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {app,BrowserWindow,session} from 'electron'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {assertComposition} from '../packages/media-native/src/composition-contract.js'
import type {CompositionScene,MediaComposition} from '../packages/media-native/src/composition-contract.js'
const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-scene-clock-')))
const artifacts=path.join(temporary,'artifacts');fs.mkdirSync(artifacts)
app.setPath('userData',path.join(temporary,'profile'))
let window:BrowserWindow|undefined,exitCode=0
const timeout=setTimeout(()=>app.exit(1),120000)
function voiceFixture():Buffer {
 const rate=48000,length=2*rate,result=Buffer.alloc(44+length*2)
 result.write('RIFF');result.writeUInt32LE(result.length-8,4);result.write('WAVEfmt ',8);result.writeUInt32LE(16,16);result.writeUInt16LE(1,20);result.writeUInt16LE(1,22);result.writeUInt32LE(rate,24);result.writeUInt32LE(rate*2,28);result.writeUInt16LE(2,32);result.writeUInt16LE(16,34);result.write('data',36);result.writeUInt32LE(length*2,40)
 for(let i=0;i<length;i++)result.writeInt16LE(Math.round(Math.sin(i/rate*2*Math.PI*333)*5000),44+i*2)
 return result
}
function pieces(original:MediaComposition):MediaComposition {
 const scene=original.scenes[0],cuts=[0,1.17,2.52,4]
 const children:CompositionScene[]=cuts.slice(0,-1).map((start,index)=>{
  const end=cuts[index+1],a=Math.max(start,1.3),b=Math.min(end,3.1)
  return {...structuredClone(scene),durationSeconds:end-start,voiceTiming:undefined,voiceSegments:b>a?[{id:'piece-'+index,startSeconds:a-start,sourceStartSeconds:a-1.3,durationSeconds:b-a,playbackRate:1}]:[],presentationWindow:{originId:'root',startSeconds:start,durationSeconds:4,musicIndex:1,sceneNumber:1,sceneCount:2},captions:scene.captions!.flatMap(cue=>{const from=Math.max(cue.startSeconds,start),to=Math.min(cue.endSeconds,end);return to>from?[{...cue,startSeconds:from-start,endSeconds:to-start}]:[]})}
 })
 return assertComposition({...original,scenes:[...children,{...original.scenes[1],presentationWindow:{originId:'second',startSeconds:0,durationSeconds:3,musicIndex:2,sceneNumber:2,sceneCount:2}}]})
}
async function run():Promise<void>{
 try{
  await app.whenReady()
  const browserSession=session.fromPartition('scene-clock-'+process.pid)
  window=new BrowserWindow({show:false,webPreferences:{session:browserSession,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  const mediaBase=pathToFileURL(path.resolve('packages/media-native/src/media')+path.sep).href,mediabunny=pathToFileURL(path.resolve('node_modules/mediabunny/dist/bundles/mediabunny.mjs')).href
  const fixture=path.join(temporary,'fixture.html')
  fs.writeFileSync(fixture,'<!doctype html><base href="'+mediaBase+'"><script type="importmap">'+JSON.stringify({imports:{mediabunny}})+'</script><title>Scene clock fixture</title>')
  await window.loadFile(fixture)
  const voice=voiceFixture();fs.writeFileSync(path.join(artifacts,'voice.wav'),voice)
  const original=assertComposition({title:'Original clock',width:640,height:360,fps:12,music:true,style:'clean-light',watermark:{enabled:false},scenes:[{title:'Original scene',label:'ROOT',durationSeconds:4,bullets:['A','B','C'],bulletRevealSeconds:[.2,1.7,2.9],narration:'Original voice.',audioArtifactId:'voice.wav',voiceTiming:{startSeconds:1.3,sourceStartSeconds:0,durationSeconds:1.8,playbackRate:1},captions:[{startSeconds:1,endSeconds:3.6,text:'Manual caption',translationText:'人工译文',translationOrigin:'user-edited'}]},{title:'Following scene',label:'NEXT',durationSeconds:3}]})
  const cut=pieces(original),times=[.1,.6,1.16,1.17,1.3,1.7,2.51,2.52,2.9,3.1,3.9,4.01,6.9]
  const metrics=await window.webContents.executeJavaScript(`(async()=>{
   const {mixCompositionAudio}=await import('./composition-audio.js'),{paintScene}=await import('./composition-paint.js'),{sceneAtTime}=await import('../composition-contract.js');
   const original=${JSON.stringify(original)},cut=${JSON.stringify(cut)},times=${JSON.stringify(times)},data=Uint8Array.from(atob(${JSON.stringify(voice.toString('base64'))}),c=>c.charCodeAt(0)),context=new AudioContext({sampleRate:48000}),assets=new Map([['voice.wav',{data}]]);
   try{const a=await mixCompositionAudio(original,assets,context),b=await mixCompositionAudio(cut,assets,context);let maxAudioDifference=0;
    for(let channel=0;channel<2;channel++){const left=a.mixed.getChannelData(channel),right=b.mixed.getChannelData(channel);for(let i=0;i<left.length;i++)maxAudioDifference=Math.max(maxAudioDifference,Math.abs(left[i]-right[i]));}
    const silent={...cut,music:false},voiceOnly=(await mixCompositionAudio(silent,assets,context)).mixed.getChannelData(0);let silentPrefixMaximum=0;for(let i=0;i<Math.floor(1.3*48000);i++)silentPrefixMaximum=Math.max(silentPrefixMaximum,Math.abs(voiceOnly[i]));
    let maxPixels=0;for(const t of times){const images=[];for(const composition of [original,cut]){const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d'),at=sceneAtTime(composition,t),scene=composition.scenes[at.index];paintScene(x,scene,null,at.localSeconds,scene.durationSeconds,at.index,composition.scenes.length,scene.audioArtifactId?2:0,composition);images.push(x.getImageData(0,0,640,360).data)}for(let i=0;i<images[0].length;i++)maxPixels=Math.max(maxPixels,Math.abs(images[0][i]-images[1][i]));}
    return {maxAudioDifference,maxPixels,silentPrefixMaximum,samples:a.mixed.length,channels:a.mixed.numberOfChannels,times};
   }finally{await context.close()}
  })()`) as {maxAudioDifference:number;maxPixels:number;silentPrefixMaximum:number;samples:number;channels:number;times:number[]}
  assert.ok(metrics.maxAudioDifference<.000003,JSON.stringify(metrics));assert.ok(metrics.maxPixels<=1,JSON.stringify(metrics));assert.equal(metrics.silentPrefixMaximum,0);assert.equal(metrics.samples,7*48000);assert.equal(metrics.channels,2)
  const media=new MediaController({session:browserSession,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:()=>{}})
  const outputs=[]
  for(const composition of [original,cut]){
   const output=await media.compose(composition);assert.equal(output.verification.status,'passed');assert.equal(media.isCaptureActive(),false);outputs.push(output)
  }
  const encoded=await window.webContents.executeJavaScript(`(async()=>{
   const {Input,BufferSource,ALL_FORMATS,CanvasSink,AudioBufferSink}=await import('mediabunny');const data=${JSON.stringify(outputs.map(output=>fs.readFileSync(output.path).toString('base64')))},inputs=data.map(v=>new Input({source:new BufferSource(Uint8Array.from(atob(v),c=>c.charCodeAt(0))),formats:ALL_FORMATS}));
   try{const tracks=await Promise.all(inputs.map(i=>i.getPrimaryVideoTrack())),audio=await Promise.all(inputs.map(i=>i.getPrimaryAudioTrack())),sinks=tracks.map(t=>new CanvasSink(t,{poolSize:1}));let maxMeanPixels=0;
    for(const time of ${JSON.stringify(times.filter(t=>t>1))}){const pixels=[];for(const sink of sinks){const frame=await sink.getCanvas(time);if(!frame)throw new Error('Missing encoded frame');const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');x.drawImage(frame.canvas,0,0);pixels.push(x.getImageData(0,0,640,360).data)}let sum=0;for(let i=0;i<pixels[0].length;i++)sum+=Math.abs(pixels[0][i]-pixels[1][i]);maxMeanPixels=Math.max(maxMeanPixels,sum/pixels[0].length);}
    const pcm=[];for(const track of audio){const samples=new Float32Array(7*48000);for await(const chunk of new AudioBufferSink(track).buffers(0,7)){const start=Math.round(chunk.timestamp*48000),values=chunk.buffer.getChannelData(0);for(let i=0;i<values.length;i++)if(start+i>=0&&start+i<samples.length)samples[start+i]=values[i]}pcm.push(samples)}let maxAudioDifference=0;for(let i=0;i<pcm[0].length;i++)maxAudioDifference=Math.max(maxAudioDifference,Math.abs(pcm[0][i]-pcm[1][i]));
    return {maxMeanPixels,maxAudioDifference,video:await Promise.all(tracks.map(async t=>({codec:t.codec,canDecode:await t.canDecode()}))),audio:await Promise.all(audio.map(async t=>({codec:t.codec,canDecode:await t.canDecode()})))};
   }finally{inputs.forEach(i=>i.dispose())}
  })()`) as {maxMeanPixels:number;maxAudioDifference:number;video:{codec:string;canDecode:boolean}[];audio:{codec:string;canDecode:boolean}[]}
  assert.ok(encoded.maxMeanPixels<1.5,JSON.stringify(encoded));assert.ok(encoded.maxAudioDifference<.002,JSON.stringify(encoded));assert.ok(encoded.video.every(t=>t.codec==='avc'&&t.canDecode));assert.ok(encoded.audio.every(t=>t.codec==='aac'&&t.canDecode))
  const report={status:'passed',scope:'Shared root title/reveal/counter/progress/music clock; three pre-partitioned scenes and explicit silent voice; native Canvas/PCM and two real MP4s. Does not prove host whole-scene splitting, source AAC cross-scene continuity or GUI acceptance.',metrics,encoded,verification:outputs.map(o=>o.verification)}
  if(process.env.BMW_SCENE_CLOCK_OUT){const destination=path.resolve(process.env.BMW_SCENE_CLOCK_OUT);fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'report.json'),JSON.stringify(report,null,2));for(const [index,output]of outputs.entries())fs.copyFileSync(output.path,path.join(destination,index===0?'original.mp4':'pieces.mp4'))}
  console.log('PASS original scene clock: silent prefix, native Canvas/PCM continuity, following scene counters/chord and real H264/AAC',JSON.stringify({metrics,encoded}))
 }catch(error){exitCode=1;console.error(error)}
 finally{clearTimeout(timeout);window?.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.exit(exitCode)}
}
void run()
