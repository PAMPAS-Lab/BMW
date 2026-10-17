import crypto from 'node:crypto'
import {assertMediaInspection} from '../../media-native/src/media-port.js'
import {sceneCoverage} from './studio-contract.js'
import type {VideoDraft,StudioScene} from './studio-contract.js'
import type {StudioKernel} from './studio-service.js'
import {studioAudioHash,readSpeechEvidence} from './studio-speech.js'
import {speechBindingStale,speechScene} from './studio-speech-contract.js'
import {sceneTimingDiagnostics} from './studio-timing-diagnostics.js'
import type {TimingAudioFacts} from './studio-timing-diagnostics.js'
/** Read-only native verification. A changed file never inherits a saved timing
 * method merely because its Artifact ID and duration still look plausible. */
export async function diagnoseStudioTiming(kernel:StudioKernel,draft:VideoDraft,scene:StudioScene,directory:string,guard:()=>void,signal?:AbortSignal){
 const check=()=>{signal?.throwIfAborted();guard()},provenance=scene.speechAnchors?.timingProvenance,facts:TimingAudioFacts={audioState:scene.audioArtifactId?'unavailable':'missing',anchorState:scene.speechAnchors?'stale':'missing',provenanceState:provenance?.basis==='asr-reference'?'stale':provenance?'not-required':'unrecorded'}
 let verifiedAudioHash:string|undefined;check()
 if(scene.audioArtifactId)try{
  const before=await studioAudioHash(directory,scene.audioArtifactId,signal),info=assertMediaInspection(await kernel.recordingController.processArtifact({action:'media.inspect',artifactId:scene.audioArtifactId},signal));check()
  if(!info.tracks.some(t=>t.type==='audio'&&t.canDecode))throw new Error('Timing requires decodable voice.')
  const after=await studioAudioHash(directory,scene.audioArtifactId,signal);check()
  if(after!==before)facts.audioState='changed'
  else {
   facts.audioState='decoded';facts.actualDurationSeconds=info.durationSeconds;verifiedAudioHash=after
   const anchors=scene.speechAnchors
   if(anchors&&!speechBindingStale(scene,anchors)&&!sceneCoverage(scene,draft.tts).audioStale&&anchors.audioSha256===after&&anchors.scriptSha256===crypto.createHash('sha256').update(scene.narration).digest('hex')&&Math.abs(anchors.durationSeconds-info.durationSeconds)<.05){try{speechScene(scene);facts.anchorState='verified'}catch{facts.anchorState='stale'}}
   const provenance=anchors?.timingProvenance
   if(provenance?.basis==='asr-reference')try{const evidence=await readSpeechEvidence(directory,provenance.evidenceArtifactId,provenance.evidenceSha256,signal);facts.provenanceState=evidence.sourceArtifactId===scene.audioArtifactId&&evidence.sourceSha256===after&&evidence.timeDomain==='audio-file-seconds'&&Math.abs(evidence.durationSeconds-info.durationSeconds)<=.25?'verified':'stale'}catch{check();facts.provenanceState='stale'}
  }
 }catch{check();facts.audioState='unavailable'}
 if(verifiedAudioHash&&scene.audioArtifactId){try{if(await studioAudioHash(directory,scene.audioArtifactId,signal)!==verifiedAudioHash){facts.audioState='changed';facts.anchorState='stale';delete facts.actualDurationSeconds}}catch{check();facts.audioState='unavailable';facts.anchorState='stale';delete facts.actualDurationSeconds}}
 if(provenance?.basis==='asr-reference'&&(facts.audioState!=='decoded'||facts.anchorState!=='verified'))facts.provenanceState='stale'
 check();return {draftId:draft.id,revision:draft.revision,...sceneTimingDiagnostics(scene,facts)}
}
