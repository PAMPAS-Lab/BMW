import { finiteNumber, mediaRecord } from './media-contract.js'
export const NARRATION_PROVIDERS=['edge-readaloud','local-matcha'] as const
export const NARRATION_VOICES=['zh-CN-YunxiNeural','zh-CN-XiaoxiaoNeural','local-zh-en'] as const
export interface NarrationOptions {provider:typeof NARRATION_PROVIDERS[number];voice:typeof NARRATION_VOICES[number];ratePercent:number}
export const DEFAULT_NARRATION_OPTIONS:Readonly<NarrationOptions>=Object.freeze({provider:'edge-readaloud',voice:'zh-CN-YunxiNeural',ratePercent:0})
export interface NarrationRequest extends NarrationOptions {text:string}
/** Resolve a partial choice; changing provider also chooses its compatible default voice. */
export function assertNarrationOptions(raw:unknown={},base:NarrationOptions=DEFAULT_NARRATION_OPTIONS):NarrationOptions {
  const input=mediaRecord(raw)
  if(Object.keys(input).some(key=>!['voice','ratePercent','provider'].includes(key)))throw new TypeError('Unsupported TTS setting.')
  const provider=input.provider??(input.voice!==undefined?(input.voice==='local-zh-en'?'local-matcha':'edge-readaloud'):base.provider)
  if(provider!=='local-matcha'&&provider!=='edge-readaloud')throw new TypeError('Unsupported narration provider.')
  const voice=input.voice??(provider===base.provider?base.voice:provider==='local-matcha'?'local-zh-en':'zh-CN-YunxiNeural')
  if(provider==='local-matcha'?voice!=='local-zh-en':voice!=='zh-CN-XiaoxiaoNeural'&&voice!=='zh-CN-YunxiNeural')throw new TypeError('Unsupported narration voice/provider combination.')
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
