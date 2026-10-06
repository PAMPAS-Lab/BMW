import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'
import {LOCAL_ASR_ENGINE_VERSION,LOCAL_ASR_MODEL_REVISION,LOCAL_ASR_MODELS} from './local-asr-assets.js'
export const SPEECH_LIMITS=Object.freeze({durationSeconds:180,rawBytes:4*1024*1024,logBytes:1024*1024,segments:400,tokens:16000,jobTimeoutMs:600_000,pcmBytes:44+180*16000*2})
export type SpeechModel='base'|'small'
export interface SpeechRequest {action:'media.speech.align';artifactId:string;model:SpeechModel;language?:'zh'|'en'|'auto'}
export function assertSpeechRequest(raw:unknown):SpeechRequest {
 const value=mediaRecord(raw)
 if(value.action!=='media.speech.align'||Object.keys(value).some(key=>!['action','artifactId','model','language'].includes(key))||(value.model!==undefined&&value.model!=='base'&&value.model!=='small'))throw new TypeError('Speech alignment accepts a Project audio artifact and a fixed model only.')
 if(value.language!==undefined&&!['zh','en','auto'].includes(String(value.language)))throw new TypeError('Unsupported speech language.')
 return {...(value.language===undefined?{}:{language:value.language as 'zh'|'en'|'auto'}),action:'media.speech.align',artifactId:assertArtifactId(value.artifactId),model:value.model==='base'?'base':'small'}
}
export interface SpeechSegment {id:string;text:string;startSeconds:number;endSeconds:number;tokenMeanProbability:number|null;usable:boolean;warnings:('outside-audio'|'overlap'|'low-confidence')[]}
export interface SpeechEvidence {
 language?:'zh'|'en'|'auto'
 kind:'speech-evidence';provider:'whisper.cpp';engineVersion:string;model:SpeechModel;modelRevision:string;modelSha256:string;engineSha256:string
 sourceArtifactId:string;sourceSha256:string;normalizedArtifactId:string;normalizedSha256:string;rawArtifactId:string;rawSha256:string;logArtifactId:string;logSha256:string
 sampleRate:16000;channels:1;sampleType:'pcm-s16le';downmix:'channel-mean';normalization:SpeechNormalization
 timeDomain:'audio-file-seconds';durationSeconds:number;elapsedSeconds:number;createdAt:string;segments:SpeechSegment[]
 automaticTimingApproved:false;wordTimingAvailable:false
}
export interface SpeechNormalization {kind:'speech-pcm';sampleRate:16000;channels:1;sampleType:'pcm-s16le';frames:number;durationSeconds:number;inputSampleRate:number;inputChannels:number;decodedStartSeconds:number;decodedEndSeconds:number;clippedSamples:number;downmix:'channel-mean';discardedTailFrames?:number}
function closed(value:Record<string,unknown>,keys:readonly string[]){if(Object.keys(value).some(key=>!keys.includes(key)))throw new TypeError('Unsupported speech evidence property.')}
export function speechSha(value:unknown):string {if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new TypeError('Invalid speech SHA-256.');return value}
/** Preserve actual segment boundaries. Tokens are BPE units, never Chinese words/characters. */
export function whisperSegments(raw:unknown,durationSeconds:number,model:SpeechModel,language:'zh'|'en'|'auto'='zh'):SpeechSegment[] {
 finiteNumber(durationSeconds,'speech duration',.01,SPEECH_LIMITS.durationSeconds)
 const value=mediaRecord(raw),parameters=mediaRecord(value.params),metadata=mediaRecord(value.model)
 if(metadata.type!==model||metadata.multilingual!==true||parameters.translate!==false||(language==='auto'?!(typeof mediaRecord(value.result).language==='string'&&/^[a-z]{2,3}$/.test(String(mediaRecord(value.result).language))&&[language,mediaRecord(value.result).language].includes(parameters.language)):parameters.language!==language||mediaRecord(value.result).language!==language))throw new TypeError('ASR output disagrees with the fixed model/language invocation.')
 if(!Array.isArray(value.transcription)||!value.transcription.length||value.transcription.length>SPEECH_LIMITS.segments)throw new TypeError('Invalid ASR segment count.')
 let previousEnd=0,totalTokens=0,totalText=0
 return value.transcription.map((raw,index)=>{
  const segment=mediaRecord(raw),offsets=mediaRecord(segment.offsets)
  const start=finiteNumber(offsets.from,'ASR start milliseconds',0,(SPEECH_LIMITS.durationSeconds+30)*1000)/1000,end=finiteNumber(offsets.to,'ASR end milliseconds',0,(SPEECH_LIMITS.durationSeconds+30)*1000)/1000
  if(end<=start||typeof segment.text!=='string'||!segment.text.trim()||segment.text.length>4000)throw new TypeError('Invalid ASR segment text or boundary.')
  totalText+=segment.text.length;if(totalText>50000)throw new TypeError('ASR transcript exceeds its text budget.')
  if(!Array.isArray(segment.tokens)||(totalTokens+=segment.tokens.length)>SPEECH_LIMITS.tokens)throw new TypeError('ASR token budget exceeded.')
  const probabilities:number[]=[]
  for(const rawToken of segment.tokens){const token=mediaRecord(rawToken);if(typeof token.text!=='string'||token.text.length>200)throw new TypeError('Invalid ASR token.');const probability=finiteNumber(token.p,'ASR token probability',0,1);if(!/^\[.*\]$/.test(token.text))probabilities.push(probability)}
  const probability=probabilities.length?probabilities.reduce((sum,item)=>sum+item,0)/probabilities.length:null
  const warnings:SpeechSegment['warnings']=[]
  if(start>=durationSeconds||end>durationSeconds)warnings.push('outside-audio')
  if(start<previousEnd)warnings.push('overlap')
  if(probability===null||probability<.75)warnings.push('low-confidence')
  previousEnd=Math.max(previousEnd,end)
  return {id:'segment-'+(index+1),text:segment.text.trim(),startSeconds:start,endSeconds:end,tokenMeanProbability:probability,usable:warnings.length===0,warnings}
 })
}
export function assertSpeechEvidence(raw:unknown):SpeechEvidence {
 const value=mediaRecord(raw)
 closed(value,['kind','provider','engineVersion','model','modelRevision','modelSha256','engineSha256','sourceArtifactId','sourceSha256','normalizedArtifactId','normalizedSha256','rawArtifactId','rawSha256','logArtifactId','logSha256','sampleRate','channels','sampleType','downmix','normalization','timeDomain','durationSeconds','elapsedSeconds','createdAt','segments','automaticTimingApproved','wordTimingAvailable','language'])
 if(value.kind!=='speech-evidence'||value.provider!=='whisper.cpp'||value.engineVersion!==LOCAL_ASR_ENGINE_VERSION||value.modelRevision!==LOCAL_ASR_MODEL_REVISION||!['base','small'].includes(String(value.model))||value.modelSha256!==LOCAL_ASR_MODELS[value.model as SpeechModel].sha256||value.sampleRate!==16000||value.channels!==1||value.sampleType!=='pcm-s16le'||value.downmix!=='channel-mean'||value.timeDomain!=='audio-file-seconds'||value.automaticTimingApproved!==false||value.wordTimingAvailable!==false)throw new TypeError('Unapproved speech provider, time domain or automatic timing gate.')
 for(const key of ['sourceArtifactId','normalizedArtifactId','rawArtifactId','logArtifactId'] as const)assertArtifactId(value[key])
 for(const key of ['sourceSha256','normalizedSha256','rawSha256','logSha256','engineSha256'] as const)speechSha(value[key])
 if(value.language!==undefined&&!['zh','en','auto'].includes(String(value.language)))throw new TypeError('Invalid speech evidence language.')
 const duration=finiteNumber(value.durationSeconds,'speech duration',.01,SPEECH_LIMITS.durationSeconds)
 finiteNumber(value.elapsedSeconds,'ASR elapsed',0,SPEECH_LIMITS.jobTimeoutMs/1000)
 if(typeof value.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value.createdAt)||!Number.isFinite(Date.parse(value.createdAt)))throw new TypeError('Invalid speech capture time.')
 const normalization=mediaRecord(value.normalization)
 closed(normalization,['kind','sampleRate','channels','sampleType','frames','durationSeconds','inputSampleRate','inputChannels','decodedStartSeconds','decodedEndSeconds','clippedSamples','downmix','discardedTailFrames'])
 if(normalization.kind!=='speech-pcm'||normalization.sampleRate!==16000||normalization.channels!==1||normalization.sampleType!=='pcm-s16le'||normalization.downmix!=='channel-mean'||normalization.durationSeconds!==duration)throw new TypeError('Invalid speech normalization provenance.')
 finiteNumber(normalization.inputSampleRate,'input sample rate',8000,96000,true);finiteNumber(normalization.inputChannels,'input channels',1,8,true)
 const frames=finiteNumber(normalization.frames,'normalized frames',160,180*16000,true)
 finiteNumber(normalization.clippedSamples,'PCM saturation samples',0,frames,true)
 if(normalization.discardedTailFrames!==undefined)finiteNumber(normalization.discardedTailFrames,'discarded Opus padding frames',0,Math.ceil(Number(normalization.inputSampleRate)*.12)+2,true)
 if(duration!==frames/16000)throw new TypeError('Speech duration disagrees with actual normalized sample count.')
 const start=finiteNumber(normalization.decodedStartSeconds,'decoded audio start',0,180),end=finiteNumber(normalization.decodedEndSeconds,'decoded audio end',start+.000001,180)
 if(end>duration+1/16000)throw new TypeError('Decoded speech exceeds its normalized timeline.')
 if(!Array.isArray(value.segments)||!value.segments.length||value.segments.length>SPEECH_LIMITS.segments)throw new TypeError('Invalid speech segments.')
 let previousEnd=0
 for(const [index,raw] of value.segments.entries()){
  const item=mediaRecord(raw);closed(item,['id','text','startSeconds','endSeconds','tokenMeanProbability','usable','warnings'])
  if(item.id!=='segment-'+(index+1)||typeof item.text!=='string'||!item.text||item.text.length>4000||typeof item.usable!=='boolean'||!Array.isArray(item.warnings))throw new TypeError('Invalid speech segment identity.')
  const start=finiteNumber(item.startSeconds,'segment start',0,210),end=finiteNumber(item.endSeconds,'segment end',start+.000001,210),p=item.tokenMeanProbability===null?null:finiteNumber(item.tokenMeanProbability,'token probability',0,1)
  const warnings:SpeechSegment['warnings']=[];if(start>=duration||end>duration)warnings.push('outside-audio');if(start<previousEnd)warnings.push('overlap');if(p===null||p<.75)warnings.push('low-confidence');previousEnd=Math.max(previousEnd,end)
  if(JSON.stringify(item.warnings)!==JSON.stringify(warnings)||item.usable!==(warnings.length===0))throw new TypeError('Speech segment warnings or usability were altered.')
 }
 return value as unknown as SpeechEvidence
}
/** One source clock maps to scene and film clocks; out-of-trim anchors are explicitly unavailable. */
export function speechTimelineRange(startSeconds:number,endSeconds:number,options:{sourceStartSeconds:number;playbackRate:number;sceneOffsetSeconds:number;sceneDurationSeconds:number;filmStartSeconds:number}):{sceneStartSeconds:number;sceneEndSeconds:number;filmStartSeconds:number;filmEndSeconds:number}|null {
 finiteNumber(startSeconds,'anchor start',0,180);finiteNumber(endSeconds,'anchor end',startSeconds+.000001,180)
 const source=finiteNumber(options.sourceStartSeconds,'source start',0,180),rate=finiteNumber(options.playbackRate,'playback rate',.25,4),offset=finiteNumber(options.sceneOffsetSeconds,'scene offset',0,60),duration=finiteNumber(options.sceneDurationSeconds,'scene duration',1,60),film=finiteNumber(options.filmStartSeconds,'film start',0,180)
 const start=offset+(startSeconds-source)/rate,end=offset+(endSeconds-source)/rate
 if(start<offset||end>duration)return null
 return {sceneStartSeconds:start,sceneEndSeconds:end,filmStartSeconds:film+start,filmEndSeconds:film+end}
}

/** Opus decoders may return a full final packet beyond the container's exact end.
 * Admit only that bounded final packet, and keep the original source timeline. */
export function speechDecodedRange(start:number,finish:number,duration:number,rate:number,codec:string|null):{end:number;discardedTailFrames:number}{
 const tolerance=2/rate
 if(!Number.isFinite(start)||!Number.isFinite(finish)||start<0||finish<=start||start>=duration+tolerance||finish>duration+tolerance&&(codec!=='opus'||start>=duration||finish-start>.12+tolerance||finish-duration>.12+tolerance))throw new Error('Speech decoded samples exceed the source timeline.')
 return {end:Math.min(finish,duration),discardedTailFrames:Math.max(0,Math.round((finish-duration)*rate))}
}
