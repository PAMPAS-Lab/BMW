import assert from 'node:assert/strict'
import test from 'node:test'
import {assertMediaArtifactReceipt,assertMediaInspection} from '../src/media-port.js'

test('Native media reply admission rejects host paths, fabricated durations and malformed tracks',()=>{
  const receipt={artifactId:'voice.wav',durationSeconds:2,voice:'local-zh-en'}
  assert.equal(assertMediaArtifactReceipt(receipt),receipt)
  for(const artifactId of ['/tmp/voice.wav','../voice.wav','https://example.com/audio'])assert.throws(()=>assertMediaArtifactReceipt({...receipt,artifactId}),/artifactId/)
  for(const durationSeconds of [NaN,Infinity,-1,181,'2'])assert.throws(()=>assertMediaArtifactReceipt({...receipt,durationSeconds}),/duration/)
  for(const extra of [{width:NaN},{height:-1},{width:'320'},{hasAlphaData:'yes'}])assert.throws(()=>assertMediaInspection({durationSeconds:3,tracks:[{type:'video',canDecode:true,...extra}]}))
  assert.equal(assertMediaInspection({durationSeconds:3,tracks:[{type:'audio',canDecode:true}]}).tracks[0].type,'audio')
  for(const tracks of [[],[{type:'shell',canDecode:true}],[{type:'audio',canDecode:'yes'}]])assert.throws(()=>assertMediaInspection({durationSeconds:3,tracks}),/inspection/)
})
