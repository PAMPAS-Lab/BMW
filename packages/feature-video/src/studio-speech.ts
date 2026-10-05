import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {assertMediaInspection} from '@bmw-agent/media-native/port'
import {assertSpeechEvidence,SPEECH_LIMITS} from '@bmw-agent/media-native/speech'
import {exportProjectText} from '@bmw-agent/media-native/text-export'
import {assertSentenceAnchors,assertStudioSpeechCandidate,assertStudioSpeechAnchors,sentenceSuggestions,speechBindingStale,usesStudioSpeech,speechScene} from './studio-speech-contract.js'
import type {SpeechBinding} from './studio-speech-contract.js'
import {sceneCoverage} from './studio-contract.js'
import type {StudioScene,StudioRequest,VideoDraft} from './studio-contract.js'
import type {StudioKernel} from './studio-service.js'
import type {VideoStudioStore} from './studio-store.js'
const sha=(text:string)=>crypto.createHash('sha256').update(text).digest('hex')
export async function studioAudioHash(directory:string,id:string,signal?:AbortSignal):Promise<string>{if(await fs.realpath(directory)!==path.resolve(directory)||(await fs.lstat(directory)).isSymbolicLink())throw new Error('Speech artifacts must stay inside their Project.');const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{return await input.fingerprint(signal)}finally{await input.close()}}
async function readEvidence(directory:string,id:string,expectedSha:string,signal?:AbortSignal){
 const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id})
 try{if(input.bytes>SPEECH_LIMITS.rawBytes)throw new Error('Studio speech evidence exceeds 4 MiB.');if(await input.fingerprint(signal)!==expectedSha)throw new Error('Studio speech evidence changed.');const data=new Uint8Array(input.bytes);for(let offset=0;offset<data.length;offset+=1024*1024)data.set(await input.read(offset,Math.min(1024*1024,data.length-offset)),offset);if(crypto.createHash('sha256').update(data).digest('hex')!==expectedSha||await input.fingerprint(signal)!==expectedSha)throw new Error('Studio speech evidence changed while reading.');return assertSpeechEvidence(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(data)))}finally{await input.close()}
}
/** Called before reuse/render/export. A filename and saved duration are insufficient evidence. */
export async function verifyStudioSpeech(draft:VideoDraft,directory:string,signal?:AbortSignal):Promise<void>{
 const hashes=new Map<string,string>()
 for(const scene of draft.scenes){if(!usesStudioSpeech(scene))continue;speechScene(scene);const record=scene.speechAnchors
  if(speechBindingStale(scene,record)||!record?.anchors.length||sceneCoverage(scene,draft.tts).audioStale||sha(scene.narration)!==record.scriptSha256)throw new Error('STUDIO_SPEECH_STALE: 句锚点与当前脚本、旁白版本不一致。')
  let actual=hashes.get(record.audioArtifactId);if(!actual){actual=await studioAudioHash(directory,record.audioArtifactId,signal);hashes.set(record.audioArtifactId,actual)}
  if(actual!==record.audioSha256)throw new Error('STUDIO_SPEECH_STALE: 旁白文件已变化，旧句锚点不可使用。')
 }
}
export async function studioSpeechOperation(kernel:StudioKernel,store:VideoStudioStore,draft:VideoDraft,scene:StudioScene,request:StudioRequest,directory:string,guard:()=>void,actor:'user'|'agent',signal?:AbortSignal):Promise<unknown>{
 const check=()=>{signal?.throwIfAborted();guard()}
 if(request.operation==='read-speech'){
  check();const candidate=scene.speechCandidate
  if(!candidate)return {draftId:draft.id,revision:draft.revision,sceneId:scene.id,candidate:null,segments:[],suggestions:[],automaticTimingApproved:false,wordTimingAvailable:false}
  const evidence=await readEvidence(directory,candidate.evidenceArtifactId,candidate.evidenceSha256,signal)
  if(evidence.sourceArtifactId!==candidate.audioArtifactId||evidence.sourceSha256!==candidate.audioSha256||evidence.durationSeconds!==candidate.durationSeconds)throw new Error('Studio speech evidence binding disagrees.')
  const actual=await studioAudioHash(directory,candidate.audioArtifactId,signal),stale=speechBindingStale(scene,candidate)||actual!==candidate.audioSha256||sha(scene.narration)!==candidate.scriptSha256||sceneCoverage(scene,draft.tts).audioStale;check()
  return {draftId:draft.id,revision:draft.revision,sceneId:scene.id,candidate,evidence,stale,segments:evidence.segments,suggestions:stale?[]:sentenceSuggestions(candidate.scriptText,evidence),automaticTimingApproved:false,wordTimingAvailable:false}
 }
 if(!scene.narration.trim()||!scene.audioArtifactId||sceneCoverage(scene,draft.tts).audioStale)throw new Error('先为当前脚本生成或绑定有效旁白，再校正句锚点。')
 const audioSha256=await studioAudioHash(directory,scene.audioArtifactId,signal);check()
 const base=(durationSeconds:number):SpeechBinding=>({scriptText:scene.narration,scriptSha256:sha(scene.narration),audioArtifactId:scene.audioArtifactId!,audioSha256,durationSeconds,createdAt:new Date().toISOString(),capturedRevision:draft.revision,timeDomain:'audio-file-seconds'})
 if(request.operation==='correct-speech'){
  const info=assertMediaInspection(await kernel.recordingController.processArtifact({action:'media.inspect',artifactId:scene.audioArtifactId},signal));if(!info.tracks.some(t=>t.type==='audio'&&t.canDecode))throw new Error('句锚点需要可解码的旁白。')
  const anchors=assertSentenceAnchors(request.anchors,scene.narration,info.durationSeconds)
  if(anchors.some(a=>a.endSeconds+.5>scene.durationSeconds))throw new Error('分镜时长没有容纳句锚点与旁白起始留白。')
  if(await studioAudioHash(directory,scene.audioArtifactId,signal)!==audioSha256)throw new Error('STUDIO_SPEECH_STALE: 校正期间旁白文件变化。');check()
  const record=assertStudioSpeechAnchors({...base(info.durationSeconds),origin:actor==='user'?'user-edited':'agent-edited',anchors})
  return {draft:store.setSpeech(draft.id,draft.revision,scene.id,'anchors',record),anchors:record,automaticTimingApproved:false,wordTimingAvailable:false}
 }
 const root=await fs.realpath(directory),identity=await fs.lstat(directory),before=new Set(await fs.readdir(directory)),owned=new Map<string,{dev:number;ino:number}>();let committed=false
 if(root!==path.resolve(directory)||identity.isSymbolicLink())throw new Error('Studio speech artifacts require a canonical Project directory.')
 const own=async(id:string)=>{const file=path.join(root,id),stat=await fs.lstat(file);if(before.has(id)||stat.isSymbolicLink()||!stat.isFile())throw new Error('Studio speech output was not newly created.');owned.set(file,{dev:stat.dev,ino:stat.ino})}
 try{
  const evidence=assertSpeechEvidence(await kernel.recordingController.processArtifact({action:'media.speech.align',artifactId:scene.audioArtifactId,model:request.speechModel??'small'},signal))
  const outputs=[[evidence.normalizedArtifactId,evidence.normalizedSha256],[evidence.rawArtifactId,evidence.rawSha256],[evidence.logArtifactId,evidence.logSha256]]
  for(const [id] of outputs)await own(id)
  if(evidence.sourceArtifactId!==scene.audioArtifactId||evidence.sourceSha256!==audioSha256)throw new Error('Studio speech source changed during recognition.')
  for(const [id,expected] of outputs)if(await studioAudioHash(directory,id,signal)!==expected)throw new Error('Studio speech output hash disagrees.')
  if(await studioAudioHash(directory,scene.audioArtifactId,signal)!==audioSha256)throw new Error('STUDIO_SPEECH_STALE: 识别期间旁白文件变化。');check()
  const text=JSON.stringify(evidence,null,2)+'\n',output=await exportProjectText(directory,'json',text,signal,guard);await own(output.artifactId);check()
  const record=assertStudioSpeechCandidate({...base(evidence.durationSeconds),evidenceArtifactId:output.artifactId,evidenceSha256:sha(text)})
  const updated=store.setSpeech(draft.id,draft.revision,scene.id,'candidate',record);committed=true
  return {draft:updated,candidate:record,evidence,suggestions:sentenceSuggestions(scene.narration,evidence),manualEditsPreserved:true,automaticTimingApproved:false,wordTimingAvailable:false}
 }finally{if(!committed){const current=await fs.lstat(directory);if(current.dev!==identity.dev||current.ino!==identity.ino||current.isSymbolicLink())throw new Error('Project directory changed; speech rollback refused.');for(const [file,stat] of owned){const current=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(current?.dev===stat.dev&&current.ino===stat.ino&&!current.isSymbolicLink())await fs.unlink(file)}}}
}
