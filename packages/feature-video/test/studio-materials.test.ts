import assert from 'node:assert/strict'
import test from 'node:test'
import {groupMaterials,parseMaterialDrop} from '../src/studio-materials.js'
import type {StudioAsset,VideoDraft} from '../src/studio-contract.js'
import {assertVideoDraft} from '../src/studio-contract.js'

function fixture(id:string):VideoDraft{return assertVideoDraft({version:1,id,revision:1,title:id,width:640,height:360,fps:12,music:false,updatedAt:'now',exports:[],scenes:[{id:'first',title:'First',durationSeconds:2,narration:'',imageArtifactId:'a.png',audioArtifactId:'voice.wav'},{id:'second',title:'Second',durationSeconds:2,narration:'',videoArtifactId:'b.mp4'}]})}
const assets:StudioAsset[]=[['a.png','image'],['b.mp4','video'],['voice.wav','audio'],['free.png','image'],['other.png','image']].map(([artifactId,kind])=>({artifactId,kind:kind as StudioAsset['kind'],bytes:100,modifiedAt:'now'}))
test('Studio material groups reflect live scene bindings and reuse across Project drafts',()=>{
  const current=fixture('current'),persisted=structuredClone(current),other=fixture('other');other.scenes[0].imageArtifactId='other.png'
  let groups=groupMaterials(assets,[persisted,other],current,'first')
  assert.deepEqual(groups.current.map(item=>item.asset.artifactId),['a.png','voice.wav']);assert.deepEqual(groups.unused.map(item=>item.asset.artifactId),['free.png']);assert.deepEqual(groups.elsewhere.map(item=>item.asset.artifactId),['b.mp4','other.png'])
  assert.equal(groups.current.find(item=>item.asset.artifactId==='voice.wav')!.usage.length,2)
  current.scenes[0].imageArtifactId='free.png';groups=groupMaterials(assets,[persisted,other],current,'first')
  assert.deepEqual(groups.current.map(item=>item.asset.artifactId),['voice.wav','free.png']);assert.deepEqual(groups.unused.map(item=>item.asset.artifactId),['a.png'],'Old persisted binding must not shadow the live draft')
  assert.equal(new Set(Object.values(groups).flat().map(item=>item.asset.artifactId)).size,assets.length)
})
test('Studio material drops admit only current Project assets matching the target slot',()=>{
  const raw=(projectId:string,artifactId:string)=>JSON.stringify({projectId,artifactId})
  assert.equal(parseMaterialDrop(raw('project','a.png'),'project',assets,'visual')?.artifactId,'a.png')
  assert.equal(parseMaterialDrop(raw('project','b.mp4'),'project',assets)?.kind,'video')
  assert.equal(parseMaterialDrop(raw('project','voice.wav'),'project',assets,'audio')?.kind,'audio')
  for(const data of ['null','[]','not json',raw('foreign','a.png'),raw('project','../a.png'),JSON.stringify({projectId:'project',artifactId:'a.png',path:'/outside'}),'x'.repeat(1025)])assert.equal(parseMaterialDrop(data,'project',assets),undefined)
  assert.equal(parseMaterialDrop(raw('project','voice.wav'),'project',assets,'visual'),undefined)
  assert.equal(parseMaterialDrop(raw('project','a.png'),'project',assets,'audio'),undefined)
})
