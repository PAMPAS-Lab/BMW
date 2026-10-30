import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {app,session} from 'electron'
import {MediaController} from '../packages/media-native/src/media-controller.js'
import {defaultResearchDiagram} from '../packages/media-native/src/research-diagrams.js'
import {newStudioScene} from '../packages/feature-video/src/studio-contract.js'
import {VideoStudioStore} from '../packages/feature-video/src/studio-store.js'
import {NewsPreparationService} from '../packages/feature-video/src/news-preparation.js'
import type {StudioKernel} from '../packages/feature-video/src/studio-service.js'
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-native-diagram-'))),artifacts=path.join(root,'artifacts')
fs.mkdirSync(artifacts);fs.mkdirSync(path.join(root,'profile'));app.setPath('userData',path.join(root,'profile'))
app.on('window-all-closed',()=>{})
const timeout=setTimeout(()=>{console.error('Native diagram fixture timed out');app.exit(1)},120000)
void app.whenReady().then(async()=>{
 let code=0
 try{
  const media=new MediaController({session:session.fromPartition('diagram-fixture-'+process.pid),preloadPath:path.resolve('packages/media-native/src/preload/media-preload.cjs'),pagePath:path.resolve('packages/media-native/src/media/media.html'),artifactsDirectory:artifacts,resolveArtifactsDirectory:()=>artifacts,onStatus:()=>{}})
  const owner={projectId:'diagram-project',sessionId:'diagram-session'},store=new VideoStudioStore(root,owner.sessionId)
  let draft=store.create('原生机制准备');draft.width=720;draft.height=1280;draft.fps=24;draft.cardLayout='news-compact'
  const scene=newStudioScene('mechanism','机制图解');scene.durationSeconds=5;scene.label='机制图解｜隔离验证2026-10-28'
  const diagram=defaultResearchDiagram('events');if(diagram.kind!=='events')throw new Error('fixture');diagram.title='机制图解';diagram.elements.forEach((e,i)=>{e.text=['遮挡','腕摄','确认','挂货'][i]});
  scene.layers=[{id:'events',kind:'diagram',title:'Mechanism',startSeconds:0,durationSeconds:5,fadeInSeconds:0,fadeOutSeconds:0,x:.06,y:.26,width:.88,height:.28,opacity:1,zIndex:0,hidden:false,locked:false,color:'#ffffff',science:diagram}]
  draft.scenes=[scene];draft=store.update(draft.id,draft.revision,draft)
  const kernel:StudioKernel={projectStore:{active:()=>({id:owner.projectId,name:'Isolated diagram',directory:root})},execute:async()=>({}),recordingController:media}
  const service=()=>new NewsPreparationService(kernel,store,owner,store.read(draft.id))
  const result=await service().execute({operation:'prepare-diagram',sceneId:scene.id},'agent') as {evidence:{id:string;frames:{artifactId:string;sha256:string;seconds:number}[]}}
  assert.equal(result.evidence.frames.length,3);assert.ok(new Set(result.evidence.frames.map(f=>f.sha256)).size>=2);assert.equal(media.isCaptureActive(),false)
  const files=fs.readdirSync(artifacts);assert.equal(files.length,3,'Only three PNGs survive native preview; temporary MP4 and report removed')
  for(const frame of result.evidence.frames){const bytes=fs.readFileSync(path.join(artifacts,frame.artifactId));assert.equal(bytes.subarray(1,4).toString(),'PNG')}
  await service().execute({operation:'read-diagram',sceneId:scene.id},'agent')
  fs.appendFileSync(path.join(artifacts,result.evidence.frames[0].artifactId),'changed');await assert.rejects(service().execute({operation:'read-diagram',sceneId:scene.id},'agent'),/DIAGRAM_STALE/)
  console.log(JSON.stringify({status:'passed',root,evidence:result.evidence,scope:'Actual isolated native painter/encode/decode/PNG/private journal; no paid model or production profile.'}))
 }catch(error){console.error(error);code=1}finally{clearTimeout(timeout);app.exit(code)}
})
