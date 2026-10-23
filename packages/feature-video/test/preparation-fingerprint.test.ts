import assert from 'node:assert/strict'
import test from 'node:test'
import {preparationSceneContent} from '../src/news-preparation.js'
import {productionHash} from '../src/production-impact.js'
import {newStudioScene} from '../src/studio-contract.js'
import type {StudioScene} from '../src/studio-contract.js'

const key=(scene:StudioScene)=>productionHash(preparationSceneContent(scene))
test('Preparation fingerprints ignore inspection and provenance metadata while retaining rendered caption and segment edits',()=>{
 const scene:StudioScene={...newStudioScene('observed'),durationSeconds:3,narration:'Verified words.',videoArtifactId:'clip.mp4',sourceDurationSeconds:3.003,keepSourceAudio:true,captions:[{startSeconds:0,endSeconds:2.5,text:'Verified words.',translationText:'已核实的原话。',translationOrigin:'agent-edited'}]}
 const baseline=key(scene),derived=structuredClone(scene)
 derived.sourceDurationSeconds=3;derived.audioDurationSeconds=2.6;derived.audioArtifactId='generated.wav';derived.audioGeneration={kind:'imported'};derived.captions![0].translationOrigin='user-edited'
 assert.equal(key(derived),baseline,'native measurements, generated output and ownership are not editorial changes')
 for(const alter of [
  (s:StudioScene)=>{s.captions![0].text='Changed words.'},
  (s:StudioScene)=>{s.captions![0].translationText='Changed claim.'},
  (s:StudioScene)=>{s.captions![0].endSeconds=2.4},
  (s:StudioScene)=>{s.sourceStartSeconds=.01},
  (s:StudioScene)=>{s.crop={x:.1,y:0,width:.9,height:1}},
  (s:StudioScene)=>{s.keepSourceAudio=false}
 ]){const changed=structuredClone(scene);alter(changed);assert.notEqual(key(changed),baseline)}
 const segmented:StudioScene={...scene,visualSegments:[{id:'a',durationSeconds:3,videoArtifactId:'clip.mp4',sourceStartSeconds:0,sourceDurationSeconds:3.003,playbackRate:1,zoom:1,keepSourceAudio:true,transition:'cut',transitionSeconds:.1}]}
 const segmentBaseline=key(segmented);segmented.visualSegments![0].sourceDurationSeconds=3;assert.equal(key(segmented),segmentBaseline,'explicit segments use the same derived-duration exclusion')
 segmented.visualSegments![0].sourceStartSeconds=.01;assert.notEqual(key(segmented),segmentBaseline)
})

test('Preparation fingerprints bind effective anchored captions and speech links without hashing evidence provenance',()=>{
 const narration='First. Second.',scene:StudioScene={...newStudioScene('speech'),narration,audioText:narration,audioArtifactId:'voice.wav',audioDurationSeconds:2,durationSeconds:4,speechCaptions:true,
  speechAnchors:{scriptText:narration,scriptSha256:productionHash(narration),audioArtifactId:'voice.wav',audioSha256:productionHash('controlled voice'),durationSeconds:2,createdAt:'2026-10-23T00:00:00Z',capturedRevision:1,timeDomain:'audio-file-seconds',origin:'agent-edited',anchors:[{id:'first',scriptStart:0,scriptEnd:6,startSeconds:.1,endSeconds:.8},{id:'second',scriptStart:7,scriptEnd:14,startSeconds:.9,endSeconds:1.7}]}}
 const baseline=key(scene),metadata=structuredClone(scene)
 metadata.speechAnchors!.createdAt='2026-10-23T01:00:00Z';metadata.speechAnchors!.capturedRevision=2;metadata.speechAnchors!.origin='user-edited'
 assert.equal(key(metadata),baseline,'evidence receipt metadata alone does not change the displayed words or timing')
 const captionEdit=structuredClone(scene);captionEdit.speechAnchors!.anchors[0].endSeconds=.75;assert.notEqual(key(captionEdit),baseline,'effective anchor-caption timing is real rendered content')
 const disabled=structuredClone(scene);disabled.speechCaptions=false;assert.notEqual(key(disabled),baseline,'disabling displayed anchor captions is an editorial change')
 const focus:StudioScene={...scene,speechCaptions:false,videoArtifactId:'clip.mp4',speechLinks:{bullets:[],focus:[{anchorId:'first',visualIndex:0,artifactId:'clip.mp4',x:.6,y:.4,zoom:2,emphasize:true}]}}
 const focusBaseline=key(focus),moved=structuredClone(focus);moved.speechLinks!.focus[0].x=.7;assert.notEqual(key(moved),focusBaseline,'effective linked source focus is part of the shot')
 const retimed=structuredClone(focus);retimed.speechAnchors!.anchors[0].endSeconds=.75;assert.notEqual(key(retimed),focusBaseline,'focus timing follows its explicit anchor')
 const bullet:StudioScene={...scene,speechCaptions:false,bullets:['First'],speechLinks:{bullets:[{anchorId:'first',bulletIndex:0,text:'First'}],focus:[]}}
 const bulletBaseline=key(bullet),later=structuredClone(bullet);later.speechLinks!.bullets[0].anchorId='second';assert.notEqual(key(later),bulletBaseline,'effective board reveal time cannot silently retain an old declaration')
 const broken=structuredClone(focus);broken.speechLinks!.focus[0].anchorId='missing';assert.throws(()=>key(broken),/STUDIO_SPEECH_REFERENCE/,'invalid anchor bindings fail explicitly instead of generating an apparently current fingerprint')
})
