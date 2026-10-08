import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {assertSpeechEvidence} from '../../media-native/src/speech-contract.js'
import {exportProjectText} from '../../media-native/src/text-export.js'
import {sceneVisuals,visualPlaybackGroup} from '../../media-native/src/visual-segments.js'
import {assertSourceCues,projectSourceCues,sourceCaptionClock} from './studio-source-speech-contract.js'
import {studioAudioHash} from './studio-speech.js'
import type {StudioKernel} from './studio-service.js'
import type {VideoStudioStore} from './studio-store.js'
import type {VideoDraft,StudioScene,StudioRequest} from './studio-contract.js'
export async function sourceSpeechOperation(kernel:StudioKernel,store:VideoStudioStore,draft:VideoDraft,scene:StudioScene,request:StudioRequest,directory:string,guard:()=>void,actor:'user'|'agent',signal?:AbortSignal):Promise<unknown>{
 const check=()=>{signal?.throwIfAborted();guard()}
 if(request.operation==='set-caption-translations'){
  const cues=scene.captions;if(!cues?.length)throw new Error('请先生成或编辑独立字幕。');const skippedCueIndices:number[]=[]
  for(const t of request.translations!){const cue=cues[t.cueIndex];if(!cue||cue.text!==t.originalText)throw new Error('STUDIO_CONFLICT: 字幕原文已变化，请重新读取。');if(cue.translationOrigin==='user-edited'){skippedCueIndices.push(t.cueIndex);continue}cue.translationText=t.translationText;cue.translationOrigin=actor==='user'?'user-edited':'agent-edited'}
  check();return {draft:store.setSourceSpeech(draft.id,draft.revision,scene.id,s=>{s.captions=cues}),skippedCueIndices}
 }
 if(request.operation==='detach-source-captions'){check();return {draft:store.setSourceSpeech(draft.id,draft.revision,scene.id,s=>{delete s.sourceCaptionBinding})}}
 if(request.operation==='recognize-source'){
  const segmentIndex=request.segmentIndex??0,visual=sceneVisuals(scene)[segmentIndex];if(!visual?.videoArtifactId)throw new Error('请选择有原声的视频片段。');const id=visual.videoArtifactId,sha=await studioAudioHash(directory,id,signal),owned=new Map<string,{dev:number;ino:number}>(),root=await fs.realpath(directory),identity=await fs.lstat(directory),before=new Set(await fs.readdir(directory));let committed=false
  try{
   check();const evidence=assertSpeechEvidence(await kernel.recordingController.processArtifact({action:'media.speech.align',artifactId:id,model:request.speechModel??'base',language:request.speechLanguage??'auto'},signal))
   for(const [artifactId]of [[evidence.normalizedArtifactId,evidence.normalizedSha256],[evidence.rawArtifactId,evidence.rawSha256],[evidence.logArtifactId,evidence.logSha256]]){const stat=await fs.lstat(path.join(directory,artifactId));if(before.has(artifactId)||!stat.isFile()||stat.isSymbolicLink())throw new Error('Speech output is not newly owned.');owned.set(artifactId,{dev:stat.dev,ino:stat.ino})}
   for(const [artifactId,hash]of [[evidence.normalizedArtifactId,evidence.normalizedSha256],[evidence.rawArtifactId,evidence.rawSha256],[evidence.logArtifactId,evidence.logSha256]]){if(await studioAudioHash(directory,artifactId,signal)!==hash)throw new Error('Source speech evidence changed.')}
   if(evidence.sourceArtifactId!==id||evidence.sourceSha256!==sha||await studioAudioHash(directory,id,signal)!==sha)throw new Error('Original source changed during recognition.');check()
   const text=JSON.stringify(evidence,null,2)+'\n',output=await exportProjectText(directory,'json',text,signal,guard),stat=await fs.lstat(path.join(directory,output.artifactId));owned.set(output.artifactId,{dev:stat.dev,ino:stat.ino});check()
   const candidate={sourceArtifactId:id,sourceSha256:sha,evidenceArtifactId:output.artifactId,evidenceSha256:crypto.createHash('sha256').update(text).digest('hex'),durationSeconds:evidence.durationSeconds,segmentIndex,createdAt:new Date().toISOString()}
   const updated=store.setSourceSpeech(draft.id,draft.revision,scene.id,s=>{s.sourceSpeech=candidate});committed=true;return {draft:updated,candidate,evidence,manualCaptionsPreserved:true,automaticTimingApproved:false}
  }finally{if(!committed){const current=await fs.lstat(directory);if(current.dev!==identity.dev||current.ino!==identity.ino||await fs.realpath(directory)!==root)throw new Error('Source speech cleanup Project changed.');for(const [id,stat]of owned){const current=await fs.lstat(path.join(directory,id)).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(current?.dev===stat.dev&&current.ino===stat.ino&&!current.isSymbolicLink())await fs.unlink(path.join(directory,id))}}}
 }
 const candidate=scene.sourceSpeech;if(!candidate)throw new Error('请先识别当前视频原声。')
 const visual=sceneVisuals(scene)[candidate.segmentIndex],stale=visual?.videoArtifactId!==candidate.sourceArtifactId||await studioAudioHash(directory,candidate.sourceArtifactId,signal)!==candidate.sourceSha256
 const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:candidate.evidenceArtifactId});let evidence
 try{if(input.bytes>4*1024*1024||await input.fingerprint(signal)!==candidate.evidenceSha256)throw new Error('Original speech evidence changed.');const data=new Uint8Array(input.bytes);for(let offset=0;offset<data.length;offset+=1024*1024){check();data.set(await input.read(offset,Math.min(1024*1024,data.length-offset)),offset)}if(crypto.createHash('sha256').update(data).digest('hex')!==candidate.evidenceSha256)throw new Error('Original speech evidence changed during read.');evidence=assertSpeechEvidence(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(data)))}finally{await input.close()}
 if(evidence.sourceArtifactId!==candidate.sourceArtifactId||evidence.sourceSha256!==candidate.sourceSha256||evidence.durationSeconds!==candidate.durationSeconds)throw new Error('Original speech evidence does not match its source.');check()
 if(request.operation==='read-source-speech')return {candidate,evidence,stale,automaticTimingApproved:false}
 if(stale)throw new Error('STUDIO_SOURCE_SPEECH_STALE: 原视频已变化，请重新识别。')
 const cues=projectSourceCues(scene,candidate.segmentIndex,assertSourceCues(request.sourceCues,candidate.durationSeconds));if(!cues.length)throw new Error('没有字幕落在当前视频区间。')
 const clock=sourceCaptionClock(scene,candidate.segmentIndex),boundIndex=visualPlaybackGroup(scene,candidate.segmentIndex).index,boundVisual=scene.visualSegments?.[boundIndex];check()
 return {draft:store.setSourceSpeech(draft.id,draft.revision,scene.id,s=>{s.captions=cues;s.captionDisplay='bilingual';s.sourceCaptionBinding={sourceArtifactId:candidate.sourceArtifactId,sourceSha256:candidate.sourceSha256,segmentIndex:boundIndex,...(boundVisual?.id?{visualSegmentId:boundVisual.id}:{}),clock,origin:actor==='user'?'user-edited':'agent-edited',sourceCues:assertSourceCues(request.sourceCues,candidate.durationSeconds),sourceRange:{startSeconds:0,endSeconds:candidate.durationSeconds}}}),cueCount:cues.length,automaticTimingApproved:false}
}
