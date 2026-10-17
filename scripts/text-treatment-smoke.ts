import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {app,BrowserWindow,session} from 'electron'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {assertComposition} from '../packages/media-native/src/composition-contract.js'
import {mediaRecord} from '../packages/media-native/src/media-contract.js'
import {assertVisualLayers} from '../packages/media-native/src/composition-layers.js'
import {sliceStudioLayer} from '../packages/feature-video/src/studio-layer-edits.js'

const profile=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-text-treatment-'))),root=path.resolve('.bmw-runtime/text-treatment',new Date().toISOString().replace(/[:.]/g,'-')),artifacts=path.join(root,'artifacts')
fs.mkdirSync(artifacts,{recursive:true});app.setPath('userData',profile)
let window:BrowserWindow|undefined,exitCode=0
const timer=setTimeout(()=>{console.error('Text treatment fixture timed out.');app.exit(1)},180000)
async function run(){try{
 await app.whenReady();const isolated=session.fromPartition('text-treatment-'+process.pid)
 window=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
 const base=pathToFileURL(path.resolve('packages/media-native/src/media')+path.sep).href,mediabunny=pathToFileURL(path.resolve('node_modules/mediabunny/dist/bundles/mediabunny.mjs')).href,fixture=path.join(profile,'fixture.html')
 fs.writeFileSync(fixture,'<!doctype html><base href="'+base+'"><script type="importmap">'+JSON.stringify({imports:{mediabunny}})+'</script>');await window.loadFile(fixture)
 const layer=assertVisualLayers([{id:'headline',title:'Editable bilingual headline',kind:'text',startSeconds:0,durationSeconds:6,x:.08,y:.25,width:.84,height:.45,color:'#ffffff',fontSize:38,text:'722篇论文\nOpenAI research 👩🏽‍🔬',textTreatment:{reveal:'grapheme',delaySeconds:.5,revealSeconds:3,lineStaggerSeconds:.5,strokeWidth:3,strokeColor:'#000000'}}])[0]
 const pieces=[sliceStudioLayer(layer,0,2.5,'left'),sliceStudioLayer(layer,2.5,6,'right')],times=[0,.5,1,2.499,2.5,3,4.5,5.5]
 const canvas=await window.webContents.executeJavaScript(`(async()=>{const {CompositionLayerPainter}=await import('./composition-layers-paint.js');const c=document.createElement('canvas');c.width=360;c.height=640;const ctx=c.getContext('2d'),painter=new CompositionLayerPainter(new Map()),times=${JSON.stringify(times)},single=${JSON.stringify([layer])},pieces=${JSON.stringify(pieces)};let maxDifference=0;const counts=[];try{for(const time of times){const frames=[];for(const layers of [single,pieces]){ctx.fillStyle='#182638';ctx.fillRect(0,0,c.width,c.height);await painter.paint(ctx,{layers},{},time,time);frames.push(ctx.getImageData(0,0,c.width,c.height).data)}let changed=0;for(let i=0;i<frames[0].length;i++){maxDifference=Math.max(maxDifference,Math.abs(frames[0][i]-frames[1][i]));if(i%4===0&&frames[0][i]>160)changed++}counts.push(changed)}return {maxDifference,counts}}finally{await painter.dispose()}})()`) as {maxDifference:number;counts:number[]}
 assert.equal(canvas.maxDifference,0);assert.equal(canvas.counts[0],0);assert.ok(canvas.counts[3]>canvas.counts[2]);assert.ok(canvas.counts.at(-1)!>canvas.counts[3])
 const media=new MediaController({session:isolated,preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:()=>{}}),exports:Record<string,unknown>[]=[],frameSets:string[][]=[]
 for(const [index,layers]of [[layer],pieces].entries()){
  const composition=assertComposition({title:'Text treatment',width:360,height:640,fps:12,music:false,watermark:{enabled:false},layers,scenes:[{title:'Text clock',durationSeconds:6,showSceneNumber:false}]}),output=await media.compose(composition)
  const decode=mediaRecord(await media.processArtifact({action:'media.decode.check',artifactId:output.artifactId}));assert.equal(decode.completeFile,true)
  const sampled=mediaRecord(await media.processArtifact({action:'media.frames.sample',artifactId:output.artifactId,timestampsSeconds:[.5,1.5,2.5,3.5,4.5,5.5],maxWidth:360,maxHeight:640})),frames=(sampled.frames as {path:string}[]).map(f=>f.path)
  assert.equal(frames.length,6);frameSets.push(frames);exports.push({index,output,decode,frames})
 }
 const imageSets=frameSets.map(set=>set.map(file=>'data:image/png;base64,'+fs.readFileSync(file).toString('base64')))
 const encoded=await window.webContents.executeJavaScript(`(async()=>{const sets=${JSON.stringify(imageSets)};const c=document.createElement('canvas');c.width=360;c.height=640;const ctx=c.getContext('2d');let maxDifference=0;for(let i=0;i<6;i++){const pixels=[];for(const set of sets){const image=new Image();image.src=set[i];await image.decode();ctx.drawImage(image,0,0);pixels.push(ctx.getImageData(0,0,360,640).data)}for(let j=0;j<pixels[0].length;j++)maxDifference=Math.max(maxDifference,Math.abs(pixels[0][j]-pixels[1][j]))}return {maxDifference}})()`) as {maxDifference:number}
 assert.equal(encoded.maxDifference,0)
 const result={complete:true,canvas,encoded,times,exports,audioAuditioned:false,scope:'Text treatment fixture only; not the stage-three news/PIP deliverables.'};fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log('PASS native text treatment '+JSON.stringify({root,canvas,encoded}))
 }catch(error){exitCode=1;console.error(error)}finally{clearTimeout(timer);window?.destroy();fs.rmSync(profile,{recursive:true,force:true});app.exit(exitCode)}}
void run()
