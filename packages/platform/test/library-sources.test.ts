import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {librarySourcePort,collectionSourcePort} from '../src/library-sources.js'
test('Foreign and archived Project discovery never creates source directories or repairs missing resources',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-library-readonly-')))
 try{
  const project={id:'archived',directory:root},readonly=librarySourcePort(project,false)
  assert.equal(readonly.snapshot().revision,0);assert.deepEqual(fs.readdirSync(root),[]);assert.throws(()=>readonly.confirm({operation:'confirm',sourceId:'s',acquisitionId:'a',candidateIds:[],expectedRevision:0}),/read-only/);await assert.rejects(readonly.readBody('s','a'),/not found/)
  fs.mkdirSync(path.join(root,'sources'));assert.throws(()=>librarySourcePort(project,false));assert.equal(fs.existsSync(path.join(root,'artifacts')),false)
  const writable=librarySourcePort(project,true);assert.equal(writable.snapshot().revision,0);assert.ok(fs.existsSync(path.join(root,'artifacts')))
  fs.writeFileSync(path.join(root,'sources/catalog.json'),'{broken');assert.throws(()=>librarySourcePort(project,false).snapshot());assert.equal(fs.readFileSync(path.join(root,'sources/catalog.json'),'utf8'),'{broken')
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('Pinned collection lookup avoids catalog windows and a lost lease rolls back asynchronous source admission',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bmw-library-lease-'))),project={id:'p',directory:root};let valid=true
 try{const port=collectionSourcePort(project,()=>{if(!valid)throw new Error('Collection lease expired')});const scope={selector:'main',index:0,excludeSelectors:[],characterUnit:'utf16',extraction:'visible-text-nodes',truncated:false,status:'observed'},observation={url:'https://example.com/ai',title:'Original',author:null,publishedAt:null,text:'Original AI announcement body',scope,mediaScope:scope,mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'observed',error:null}
  const first=await port.collect(observation,0);assert.ok(port.lookup?.(first.sourceId,first.acquisitionId));assert.equal(port.hasSource?.(first.sourceId),true)
  const revision=port.state!().revision,files=fs.readdirSync(path.join(root,'artifacts')).sort(),pending=port.collect({...observation,url:'https://example.com/new',text:'New original must roll back after its pinned lease ends'},revision);valid=false
  await assert.rejects(pending,/lease expired/);assert.throws(()=>port.lookup?.(first.sourceId,first.acquisitionId),/lease expired/);valid=true
  assert.equal(port.state!().revision,revision);assert.deepEqual(fs.readdirSync(path.join(root,'artifacts')).sort(),files);assert.ok(port.lookup?.(first.sourceId,first.acquisitionId))
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
