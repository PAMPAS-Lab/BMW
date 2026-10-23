import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {app,session} from 'electron'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {MediaProcessor} from '../packages/media-native/src/media-processor.js'
import {mediaRecord} from '../packages/media-native/src/media-contract.js'
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-decode-clock-'))),artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts);fs.mkdirSync(path.join(root,'profile'));app.setPath('userData',path.join(root,'profile'));app.on('window-all-closed',()=>{})
const timer=setTimeout(()=>app.exit(1),180000)
let code=0
async function run(){try{
 await app.whenReady();const isolated=session.fromPartition('bmw-decode-clock-'+process.pid),processor=new MediaProcessor({session:isolated,pagePath:path.resolve('packages/media-native/src/media/processing.html'),preloadPath:path.resolve('packages/media-native/src/preload/processing-preload.cjs')})
 const frameCount=48000*3,data=Buffer.alloc(44+frameCount*4);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(2,22);data.writeUInt32LE(48000,24);data.writeUInt32LE(192000,28);data.writeUInt16LE(4,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(frameCount*4,40);for(let i=0;i<frameCount;i++){const sample=Math.round(Math.sin(i/48000*440*2*Math.PI)*8192);data.writeInt16LE(sample,44+i*4);data.writeInt16LE(sample,46+i*4)}fs.writeFileSync(path.join(artifacts,'tone.wav'),data)
 const media=new MediaController({onStatus:undefined,session:isolated,pagePath:path.resolve('packages/media-native/src/media/media.html'),preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts})
 const composed=mediaRecord(await media.compose({title:'Isolated AAC clock fixture',width:640,height:360,fps:24,music:false,scenes:[{title:'Codec fixture',durationSeconds:4,audioArtifactId:'tone.wav',narration:''}]}))
 const candidates=[{artifactId:String(composed.artifactId),durationSeconds:Number(composed.durationSeconds)}]
 const fixture=process.env.BMW_SPEECH_REPRO_FILE
 if(fixture){const file=fs.realpathSync(fixture);if(!file.startsWith('/private/tmp/bmw-speech-repro-fixture/')||path.extname(file)!=='.mp4'||fs.statSync(file).size>512*1024*1024)throw new Error('Reproduction input must be a bounded isolated copied MP4.');fs.copyFileSync(file,path.join(artifacts,'copied-source.mp4'));const info=mediaRecord(await media.processArtifact({action:'media.inspect',artifactId:'copied-source.mp4'}));candidates.push({artifactId:'copied-source.mp4',durationSeconds:Number(info.durationSeconds)})}
 const results:unknown[]=[]
 for(const candidate of candidates)for(const startSeconds of [0,.1])try{
  const endSeconds=Math.min(candidate.durationSeconds,180),result=mediaRecord(await processor.process({action:'media.speech.normalize',artifactId:candidate.artifactId,sourceRange:{startSeconds,endSeconds}},artifacts)),normalization=mediaRecord(result.normalization);assert.equal(normalization.frames,Math.ceil((endSeconds-startSeconds)*16000));results.push({artifactId:candidate.artifactId,startSeconds,normalization,passed:true})
 }catch(error){code=1;results.push({artifactId:candidate.artifactId,startSeconds,passed:false,error:error instanceof Error?error.message:String(error)})}
 console.log(JSON.stringify({profile:'disposable',coverage:'Native AAC normalization and optional isolated copied-source reproduction; no ASR/model/film-review claim.',results}))
}catch(error){code=1;console.error(error)}finally{clearTimeout(timer);fs.rmSync(root,{recursive:true,force:true});app.exit(code)}}
void run()
