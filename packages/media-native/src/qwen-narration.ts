import { QWEN_NARRATION_MODEL, assertNarration, assertQwenCredentials } from './narration-contract.js'
import { mediaRecord } from './media-contract.js'

export type NarrationFetch = (url:string, init:RequestInit)=>Promise<Response>
const MAX_AUDIO_BYTES=8*1024*1024
/** Native-only credentials: never sent through the renderer bridge or browser tool. */
export function qwenNarrationConfiguration(raw:unknown) {
  const {apiKey,workspaceId:workspace}=assertQwenCredentials(raw)
  return {apiKey,endpoint:`https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`}
}
export function qwenAudioUrl(raw:unknown):string {
  if(typeof raw!=='string'||raw.length>8192)throw new Error('Invalid Qwen audio URL.')
  let url:URL
  try{url=new URL(raw)}catch{throw new Error('Invalid Qwen audio URL.')}
  // Official responses may use HTTP OSS links; always retrieve over TLS, with no API key.
  if(!['https:','http:'].includes(url.protocol)||url.hostname!=='dashscope-result-bj.oss-cn-beijing.aliyuncs.com'||url.port||url.username||url.password||url.hash)throw new Error('Untrusted Qwen audio URL.')
  url.protocol='https:'
  return url.href
}
async function boundedBody(response:Response,maximum:number,signal:AbortSignal):Promise<Uint8Array> {
  const length=response.headers.get('content-length')
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maximum)){
    await response.body?.cancel();throw new Error('Qwen response exceeds its byte budget.')
  }
  const reader=response.body?.getReader()
  if(!reader)throw new Error('Empty Qwen response.')
  const chunks:Uint8Array[]=[];let size=0,complete=false
  try{
    for(;;){signal.throwIfAborted();const next=await reader.read();signal.throwIfAborted();if(next.done){complete=true;break}size+=next.value.length;if(size>maximum)throw new Error('Qwen response exceeds its byte budget.');chunks.push(next.value)}
  }finally{try{if(!complete)await reader.cancel()}finally{reader.releaseLock()}}
  const data=new Uint8Array(size);let offset=0
  for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length}
  return data
}
/** Fixed model, region and download origin; no retries after uncertain paid delivery. */
export async function synthesizeQwenNarration(raw:unknown,fetch:NarrationFetch,signal:AbortSignal,credentials:unknown):Promise<Uint8Array> {
  const request=assertNarration(raw)
  if(request.provider!=='qwen-tts')throw new TypeError('Qwen narration requires qwen-tts.')
  signal.throwIfAborted()
  const config=qwenNarrationConfiguration(credentials)
  const response=await fetch(config.endpoint,{method:'POST',redirect:'error',credentials:'omit',signal,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:QWEN_NARRATION_MODEL,input:{text:request.text,voice:request.voice,format:'wav',sample_rate:24000,rate:1+request.ratePercent/100,language_hints:['zh'],enable_ssml:false}})})
  if(!response.ok){await response.body?.cancel();throw new Error(`Qwen narration synthesis failed (HTTP ${response.status}). Check Beijing credentials and model access.`)}
  const bytes=await boundedBody(response,64*1024,signal)
  let value:Record<string,unknown>
  try{value=mediaRecord(JSON.parse(new TextDecoder().decode(bytes)))}catch{throw new Error('Invalid Qwen synthesis response.')}
  if(value.code!==undefined)throw new Error('Qwen narration synthesis failed. Check model access and quota.')
  const output=mediaRecord(value.output)
  if(output.finish_reason!=='stop')throw new Error('Qwen narration did not complete.')
  const url=qwenAudioUrl(mediaRecord(output.audio).url)
  const audio=await fetch(url,{method:'GET',redirect:'error',credentials:'omit',signal})
  if(!audio.ok){await audio.body?.cancel();throw new Error(`Qwen audio retrieval failed (HTTP ${audio.status}).`)}
  const data=await boundedBody(audio,MAX_AUDIO_BYTES,signal)
  if(data.length<512||new TextDecoder().decode(data.subarray(0,4))!=='RIFF'||new TextDecoder().decode(data.subarray(8,12))!=='WAVE')throw new Error('Invalid Qwen WAV audio.')
  return data
}
