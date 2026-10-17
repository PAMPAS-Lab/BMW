import { finiteNumber, mediaRecord } from './media-contract.js'
export const NARRATION_PROVIDERS=['edge-readaloud','local-matcha','qwen-tts'] as const
export const NARRATION_VOICES=['zh-CN-YunxiNeural','zh-CN-XiaoxiaoNeural','local-zh-en','wenhuaizhi_v3.1','xuyanchu_v3.1','xuyuyuan_v3.1','anmingyuan_v3.1'] as const
export const QWEN_NARRATION_MODEL='qwen-audio-3.1-tts-flash'
export const DEFAULT_QWEN_VOICE='wenhuaizhi_v3.1'
export const QWEN_NARRATION_VOICES=['wenhuaizhi_v3.1','xuyanchu_v3.1','xuyuyuan_v3.1','anmingyuan_v3.1'] as const
export function narrationVoiceProvider(voice:unknown):NarrationOptions['provider'] {
  if(voice==='local-zh-en')return 'local-matcha'
  if(QWEN_NARRATION_VOICES.some(value=>value===voice))return 'qwen-tts'
  if(voice==='zh-CN-YunxiNeural'||voice==='zh-CN-XiaoxiaoNeural')return 'edge-readaloud'
  throw new TypeError('Unsupported narration voice/provider combination.')
}
export interface NarrationOptions {provider:typeof NARRATION_PROVIDERS[number];voice:typeof NARRATION_VOICES[number];ratePercent:number}
export const DEFAULT_NARRATION_OPTIONS:Readonly<NarrationOptions>=Object.freeze({provider:'edge-readaloud',voice:'zh-CN-YunxiNeural',ratePercent:0})
export interface NarrationRequest extends NarrationOptions {text:string}
/** Resolve a partial choice; changing provider also chooses its compatible default voice. */
export function assertNarrationOptions(raw:unknown={},base:NarrationOptions=DEFAULT_NARRATION_OPTIONS):NarrationOptions {
  const input=mediaRecord(raw)
  if(Object.keys(input).some(key=>!['voice','ratePercent','provider'].includes(key)))throw new TypeError('Unsupported TTS setting.')
  const provider=input.provider??(input.voice!==undefined?narrationVoiceProvider(input.voice):base.provider)
  if(provider!=='local-matcha'&&provider!=='edge-readaloud'&&provider!=='qwen-tts')throw new TypeError('Unsupported narration provider.')
  const voice=input.voice??(provider===base.provider?base.voice:provider==='local-matcha'?'local-zh-en':provider==='qwen-tts'?DEFAULT_QWEN_VOICE:'zh-CN-YunxiNeural')
  if(narrationVoiceProvider(voice)!==provider)throw new TypeError('Unsupported narration voice/provider combination.')
  return {provider,voice:voice as NarrationOptions['voice'],ratePercent:finiteNumber(input.ratePercent??base.ratePercent,'ratePercent',-20,30,true)}
}
/** Closed TTS request; online execution additionally obeys the BMW settings gate. */
export function assertNarration(value: unknown): NarrationRequest {
  const input=mediaRecord(value)
  if(Object.keys(input).some(key=>!['text','voice','ratePercent','provider'].includes(key)))throw new TypeError('Unsupported narration property.')
  if(typeof input.text!=='string'||!input.text.trim()||input.text.length>1000||/[\u0000-\u001f]/.test(input.text))throw new TypeError('Narration needs 1 to 1000 plain-text characters.')
  const {text,...options}=input
  return {text:text as string,...assertNarrationOptions(options)}
}
export const narrationOptionsSchema={type:'object',additionalProperties:false,properties:{provider:{type:'string',enum:NARRATION_PROVIDERS},voice:{type:'string',enum:NARRATION_VOICES},ratePercent:{type:'integer',minimum:-20,maximum:30}}}

export interface NarrationBridge { onCommand(listener: (value: {token:string;request:NarrationRequest}) => void): void; reply(value:unknown):void }

/** Host configuration only; never part of a narration/model request or settings projection. */
export interface QwenNarrationCredentials {apiKey:string;workspaceId:string}
export function assertQwenCredentials(raw:unknown):QwenNarrationCredentials {
  const value=mediaRecord(raw)
  if(Object.keys(value).some(key=>!['apiKey','workspaceId'].includes(key)))throw new TypeError('Invalid Qwen credential settings.')
  if(typeof value.apiKey!=='string'||!value.apiKey.trim()||value.apiKey.trim().length>4096||/[^\x21-\x7e]/.test(value.apiKey.trim()))throw new TypeError('请填写有效的 Qwen API Key。')
  if(typeof value.workspaceId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(value.workspaceId.trim()))throw new TypeError('请填写北京地域的 Workspace ID。')
  return {apiKey:value.apiKey.trim(),workspaceId:value.workspaceId.trim()}
}
