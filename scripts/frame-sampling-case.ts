/** Opt-in native paging equivalence on an explicitly supplied local MP4 copy. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {app,session,BrowserWindow} from 'electron'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {mediaRecord} from '../packages/media-native/src/media-contract.js'

const supplied=process.env.BMW_FRAME_SAMPLING_SOURCE
if(!supplied)throw new Error('Set BMW_FRAME_SAMPLING_SOURCE to an explicitly authorized local MP4 fixture.')
const original=path.resolve(supplied),stat=fs.lstatSync(original)
if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024*1024||path.extname(original)!=='.mp4')throw new Error('Use a regular MP4 up to 512 MiB.')
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-frame-sampling-'))),artifacts=path.join(root,'project','artifacts'),destination=path.resolve('.bmw-runtime/frame-sampling',new Date().toISOString().replace(/[:.]/gu,'-'))
fs.mkdirSync(artifacts,{recursive:true});fs.mkdirSync(path.join(root,'profile'));app.setPath('userData',path.join(root,'profile'))
fs.copyFileSync(original,path.join(artifacts,'fixture.mp4'),fs.constants.COPYFILE_EXCL)
async function fingerprint(file:string){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex')}
async function run(){let exitCode=0
 let window:BrowserWindow|undefined
 try{await app.whenReady();const isolated=session.fromPartition('bmw-frame-sampling-'+process.pid);window=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false}});const sourceHash=await fingerprint(original),media=new MediaController({session:isolated,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:()=>{}})
  const info=mediaRecord(await media.processArtifact({action:'media.inspect',artifactId:'fixture.mp4'})),track=(info.tracks as unknown[]).map(mediaRecord).find(t=>t.type==='video')!
  const start=Number(track.startSeconds),end=Number(track.endSeconds),late=Math.min(end-.5,600.125)
  assert.ok(late>30,'Use a long fixture with multiple key packets.')
  const sample=async(times:number[])=>{const at=performance.now(),value=mediaRecord(await media.processArtifact({action:'media.frames.sample',artifactId:'fixture.mp4',timestampsSeconds:times,maxWidth:160,maxHeight:160}));return {seconds:(performance.now()-at)/1000,frames:(value.frames as unknown[]).map(mediaRecord)}}
  const baseline=await sample([Math.max(0,start),late]),page=await sample([late]),expected=baseline.frames[1],actual=page.frames[0]
  assert.equal(actual.timestampSeconds,expected.timestampSeconds);assert.equal(await fingerprint(String(actual.path)),await fingerprint(String(expected.path)))
  assert.equal(await fingerprint(original),sourceHash);assert.equal(await fingerprint(path.join(artifacts,'fixture.mp4')),sourceHash);assert.equal(media.isCaptureActive(),false)
  fs.mkdirSync(destination,{recursive:true});fs.copyFileSync(String(actual.path),path.join(destination,'late-frame.png'))
  fs.writeFileSync(path.join(destination,'result.json'),JSON.stringify({passed:true,sourceHash,bytes:stat.size,requestedSeconds:late,actualTimestampSeconds:actual.timestampSeconds,frameSha256:await fingerprint(String(actual.path)),fromStartSeconds:baseline.seconds,indexedPageSeconds:page.seconds,profile:'disposable with mock keychain',modelCalls:0,audioAuditioned:false},null,2));console.log('PASS indexed long-source page equals from-start pixels and PTS: '+destination)
 }catch(error){exitCode=1;console.error(error)}finally{window?.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(exitCode)}
}
void run()
