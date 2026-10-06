import {assertImageDrawingRequest,assertDrawingResult} from './image-drawing-contract.js'
import type {ImageDrawingRequest,DrawingResult} from './image-drawing-contract.js'
import {assertImageInspection} from './image-contract.js'
/** Public, browser-native media contracts. No host path or codec choice is model-controlled. */
export const MEDIA_LIMITS = Object.freeze({
  inputBytes: 512 * 1024 * 1024, outputBytes: 512 * 1024 * 1024,
  frameBytes: 20 * 1024 * 1024, chunkBytes: 1024 * 1024,
  frames: 8, durationSeconds: 1800, sourcePixels: 16_777_216, jobTimeoutMs: 120_000
})
export type MediaProcessRequest =
  | ImageDrawingRequest
  | {action:'media.image.inspect';artifactId:string}
  | { action: 'media.inspect'; artifactId: string }
  | { action: 'media.frames.sample'; artifactId: string; timestampsSeconds: number[]; maxWidth: number; maxHeight: number }
  | { action: 'media.convert'; artifactId: string; outputFormat: 'mp4' | 'webm'; trimStartSeconds?: number; trimEndSeconds?: number; outputWidth?: number; outputHeight?: number }
export type NativeProcessingRequest=MediaProcessRequest|{action:'media.speech.normalize';artifactId:string}|{action:'media.decode.check';artifactId:string}|{action:'media.encode.check';width:number;height:number;fps:number}
export function assertNativeProcessingRequest(raw:unknown):NativeProcessingRequest {
  const value=mediaRecord(raw)
  if(value.action==='media.speech.normalize'){if(Object.keys(value).some(key=>!['action','artifactId'].includes(key)))throw new TypeError('Unsupported speech normalization property.');return {action:value.action,artifactId:assertArtifactId(value.artifactId)}}
  if(value.action==='media.decode.check'){if(Object.keys(value).some(key=>!['action','artifactId'].includes(key)))throw new TypeError('Unsupported full decode property.');return {action:'media.decode.check',artifactId:assertArtifactId(value.artifactId)}}
  if(value.action==='media.encode.check'){
    if(Object.keys(value).some(key=>!['action','width','height','fps'].includes(key)))throw new TypeError('Unsupported encoding property.')
    const width=finiteNumber(value.width,'width',320,1920,true),height=finiteNumber(value.height,'height',180,1920,true),fps=finiteNumber(value.fps,'fps',12,30,true)
    if(width%2||height%2)throw new TypeError('Encoding dimensions must be even.')
    return {action:value.action,width,height,fps}
  }
  return assertMediaProcessRequest(raw)
}
export interface EncodingInspection {kind:'encoding';width:number;height:number;fps:number;videoCodec:'avc';audioCodec:'aac';videoSupported:boolean;audioSupported:boolean}
export function assertEncodingInspection(raw:unknown):EncodingInspection {
  const value=mediaRecord(raw);assertNativeProcessingRequest({action:'media.encode.check',width:value.width,height:value.height,fps:value.fps})
  if(value.kind!=='encoding'||value.videoCodec!=='avc'||value.audioCodec!=='aac'||typeof value.videoSupported!=='boolean'||typeof value.audioSupported!=='boolean')throw new TypeError('Invalid encoding inspection.')
  return value as unknown as EncodingInspection
}
export interface MediaTrackInfo {
  id: number; type: 'video' | 'audio' | 'subtitle'; codec: string | null; canDecode: boolean
  width?: number; height?: number; rotation?: number; canBeTransparent?: boolean; hasAlphaData?: boolean; sampleRate?: number; channels?: number
}
export interface MediaInfo {
  container: string; contentType: string; durationSeconds: number; firstTimestampSeconds: number; tracks: MediaTrackInfo[]
}
export interface FullMediaDecode {kind:'decoding';completeFile:true;container:string;contentType:string;durationSeconds:number;firstTimestampSeconds:number;tracks:{id:number;type:'video'|'audio';codec:string;sampleCount:number;startSeconds:number;endSeconds:number}[]}
export function assertFullMediaDecode(raw:unknown):FullMediaDecode {
 const value=mediaRecord(raw)
 if(value.kind!=='decoding'||value.completeFile!==true||typeof value.container!=='string'||value.container.length>80||typeof value.contentType!=='string'||value.contentType.length>200||!Array.isArray(value.tracks)||!value.tracks.length||value.tracks.length>16)throw new TypeError('Invalid full-file decode evidence.')
 const duration=finiteNumber(value.durationSeconds,'decoded duration',.001,MEDIA_LIMITS.durationSeconds),first=finiteNumber(value.firstTimestampSeconds,'decoded first timestamp',-MEDIA_LIMITS.durationSeconds,MEDIA_LIMITS.durationSeconds),ids=new Set<number>()
 for(const raw of value.tracks){const track=mediaRecord(raw),id=finiteNumber(track.id,'decoded track',0,Number.MAX_SAFE_INTEGER,true);if(ids.has(id)||!['video','audio'].includes(String(track.type))||typeof track.codec!=='string'||!track.codec||track.codec.length>100)throw new TypeError('Invalid decoded track.');ids.add(id)
  finiteNumber(track.sampleCount,'decoded samples',1,track.type==='video'?120000:250000,true)
  const start=finiteNumber(track.startSeconds,'decoded start',-MEDIA_LIMITS.durationSeconds,MEDIA_LIMITS.durationSeconds),end=finiteNumber(track.endSeconds,'decoded end',start+.000001,MEDIA_LIMITS.durationSeconds+first)
  if(start<first-.25||end>first+duration+.25)throw new TypeError('Decoded samples exceed the file timeline.')
 }
 return value as unknown as FullMediaDecode
}
export interface SampledFrame {
  outputIndex: number; requestedTimestampSeconds: number; timestampSeconds: number; durationSeconds: number; width: number; height: number
}
export type MediaWorkerResult =
  | {kind:'speech-pcm';info:import('./speech-contract.js').SpeechNormalization}
  | DrawingResult
  | {kind:'image';info:import('./image-contract.js').ImageInspection}
  | {kind:'decoding';info:FullMediaDecode}
  | {kind:'encoding';info:EncodingInspection}
  | { kind: 'inspection'; info: MediaInfo }
  | { kind: 'frames'; frames: SampledFrame[] }
  | { kind: 'conversion'; contentType: string; range: { startSeconds: number; endSeconds: number }; tracks: { type: string; codec: string }[] }
export interface MediaProcessingCommand { token: string; bytes: number; request: NativeProcessingRequest }
export interface MediaProcessingBridge {
  onCommand(listener: (command: MediaProcessingCommand) => void): void
  read(token: string, offset: number, length: number): Promise<Uint8Array>
  write(token: string, outputIndex: number, position: number, data: Uint8Array): Promise<void>
  reply(value: unknown): void
}
export function mediaRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Media input must be an object.')
  return value as Record<string, unknown>
}
export function finiteNumber(value: unknown, name: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value))) {
    throw new TypeError(`${name} must be ${integer ? 'an integer' : 'a finite number'} between ${minimum} and ${maximum}.`)
  }
  return value
}
export function assertArtifactId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 180 || /[/\\:\u0000-\u001f]/.test(value) || value === '.' || value === '..') {
    throw new TypeError('Media requires a Project artifactId, never a path or URL.')
  }
  return value
}
export function assertMediaProcessRequest(value: unknown): MediaProcessRequest {
  const input = mediaRecord(value)
  if(input.action==='media.image.annotate'||input.action==='media.image.draw')return assertImageDrawingRequest(input)
  const artifactId = assertArtifactId(input.artifactId)
  const common = ['action', 'artifactId', 'tabId']
  if (input.tabId !== undefined && typeof input.tabId !== 'string') throw new TypeError('tabId must be a string.')
  const allowed = (input.action === 'media.inspect'||input.action==='media.image.inspect') ? common : input.action === 'media.frames.sample'
    ? [...common, 'timestampsSeconds', 'maxWidth', 'maxHeight']
    : input.action === 'media.convert' ? [...common, 'outputFormat', 'trimStartSeconds', 'trimEndSeconds', 'outputWidth', 'outputHeight'] : []
  if (!allowed.length || Object.keys(input).some((key) => !allowed.includes(key))) throw new TypeError('Unsupported media action or property.')
  if (input.action === 'media.inspect'||input.action==='media.image.inspect') return { action: input.action, artifactId }
  if (input.action === 'media.frames.sample') {
    if (!Array.isArray(input.timestampsSeconds) || input.timestampsSeconds.length < 1 || input.timestampsSeconds.length > MEDIA_LIMITS.frames) throw new TypeError('Request 1 to 8 frame timestamps.')
    return { action: input.action, artifactId,
      timestampsSeconds: input.timestampsSeconds.map((time) => finiteNumber(time, 'timestamp', 0, MEDIA_LIMITS.durationSeconds)),
      maxWidth: finiteNumber(input.maxWidth ?? 1280, 'maxWidth', 16, 1280, true),
      maxHeight: finiteNumber(input.maxHeight ?? 720, 'maxHeight', 16, 720, true) }
  }
  if (input.outputFormat !== 'mp4' && input.outputFormat !== 'webm') throw new TypeError('outputFormat must be mp4 or webm.')
  const result: Extract<MediaProcessRequest, { action: 'media.convert' }> = { action: 'media.convert', artifactId, outputFormat: input.outputFormat }
  for (const key of ['trimStartSeconds', 'trimEndSeconds'] as const) {
    if (input[key] !== undefined) result[key] = finiteNumber(input[key], key, 0, MEDIA_LIMITS.durationSeconds)
  }
  if (result.trimEndSeconds !== undefined && result.trimEndSeconds <= (result.trimStartSeconds ?? 0)) throw new TypeError('Trim end must be after trim start.')
  if ((input.outputWidth === undefined) !== (input.outputHeight === undefined)) throw new TypeError('Provide both outputWidth and outputHeight.')
  if (input.outputWidth !== undefined) {
    result.outputWidth = finiteNumber(input.outputWidth, 'outputWidth', 16, 3840, true)
    result.outputHeight = finiteNumber(input.outputHeight, 'outputHeight', 16, 2160, true)
    if (result.outputWidth % 2 || result.outputHeight % 2) throw new TypeError('Export dimensions must be even.')
  }
  return result
}
/** Validate the renderer result before admitting it to the host/MCP boundary. */
export function assertMediaWorkerResult(value: unknown, request: NativeProcessingRequest): MediaWorkerResult {
  const result = mediaRecord(value)
  if(request.action==='media.image.annotate'||request.action==='media.image.draw'){assertDrawingResult(result,request)}
  else if(request.action==='media.speech.normalize'&&result.kind==='speech-pcm'){
    const info=mediaRecord(result.info),frames=finiteNumber(info.frames,'speech samples',160,180*16000,true)
    if(Object.keys(info).some(key=>!['kind','sampleRate','channels','sampleType','frames','durationSeconds','inputSampleRate','inputChannels','decodedStartSeconds','decodedEndSeconds','clippedSamples','downmix','discardedTailFrames'].includes(key)))throw new TypeError('Unsupported speech normalization evidence.')
    if(info.kind!=='speech-pcm'||info.sampleRate!==16000||info.channels!==1||info.sampleType!=='pcm-s16le'||info.downmix!=='channel-mean'||info.durationSeconds!==frames/16000)throw new TypeError('Invalid normalized speech metadata.')
    finiteNumber(info.clippedSamples,'PCM saturation samples',0,frames,true)
    if(info.discardedTailFrames!==undefined)finiteNumber(info.discardedTailFrames,'discarded Opus padding frames',0,Math.ceil(Number(info.inputSampleRate)*.12)+2,true)
    finiteNumber(info.inputSampleRate,'speech input rate',8000,96000,true);finiteNumber(info.inputChannels,'speech input channels',1,8,true)
    const start=finiteNumber(info.decodedStartSeconds,'speech decode start',0,180),end=finiteNumber(info.decodedEndSeconds,'speech decode end',start+.000001,180)
    if(end>frames/16000+1/16000)throw new TypeError('Speech decode exceeds its sample timeline.')
  }
  else if(request.action==='media.image.inspect'&&result.kind==='image'){assertImageInspection(result.info)}
  else if(request.action==='media.decode.check'&&result.kind==='decoding')assertFullMediaDecode(result.info)
  else if(request.action==='media.encode.check'&&result.kind==='encoding'){
    const info=assertEncodingInspection(result.info)
    if(info.width!==request.width||info.height!==request.height||info.fps!==request.fps)throw new TypeError('Encoding reply dimensions mismatch.')
  }
  else if (request.action === 'media.inspect' && result.kind === 'inspection') {
    const info = mediaRecord(result.info)
    if (typeof info.container !== 'string' || typeof info.contentType !== 'string' || !Array.isArray(info.tracks) || info.tracks.length < 1 || info.tracks.length > 16) throw new TypeError('Invalid media track metadata.')
    finiteNumber(info.durationSeconds, 'duration', 0, Number.MAX_SAFE_INTEGER)
    finiteNumber(info.firstTimestampSeconds, 'first timestamp', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    for (const item of info.tracks) {
      const track = mediaRecord(item)
      finiteNumber(track.id, 'track id', 0, Number.MAX_SAFE_INTEGER, true)
      if (!['video', 'audio', 'subtitle'].includes(String(track.type)) || (track.codec !== null && typeof track.codec !== 'string') || typeof track.canDecode !== 'boolean') throw new TypeError('Invalid media track.')
      for (const key of ['width','height','sampleRate','channels'] as const) if (track[key] !== undefined) finiteNumber(track[key], key, 1, Number.MAX_SAFE_INTEGER, true)
      if(track.hasAlphaData!==undefined&&typeof track.hasAlphaData!=='boolean')throw new TypeError('Invalid alpha packet metadata.')
      if (track.canBeTransparent !== undefined && typeof track.canBeTransparent !== 'boolean') throw new TypeError('Invalid transparency metadata.')
      if (track.rotation !== undefined) finiteNumber(track.rotation, 'rotation', 0, 360)
    }
  } else if (request.action === 'media.frames.sample' && result.kind === 'frames') {
    if (!Array.isArray(result.frames) || result.frames.length !== request.timestampsSeconds.length) throw new TypeError('Missing sampled frames.')
    result.frames.forEach((item: unknown, index: number) => {
      const frame = mediaRecord(item)
      if (frame.outputIndex !== index || frame.requestedTimestampSeconds !== request.timestampsSeconds[index]) throw new TypeError('Frame identity mismatch.')
      finiteNumber(frame.timestampSeconds, 'frame timestamp', 0, request.timestampsSeconds[index])
      finiteNumber(frame.durationSeconds, 'frame duration', 0, MEDIA_LIMITS.durationSeconds)
      finiteNumber(frame.width, 'frame width', 1, request.maxWidth, true)
      finiteNumber(frame.height, 'frame height', 1, request.maxHeight, true)
    })
  } else if (request.action === 'media.convert' && result.kind === 'conversion') {
    if (!['video/' + request.outputFormat, 'audio/' + request.outputFormat].includes(String(result.contentType)) || !Array.isArray(result.tracks) || !result.tracks.length || result.tracks.length > 16) throw new TypeError('Invalid conversion tracks.')
    const range = mediaRecord(result.range)
    const start = finiteNumber(range.startSeconds, 'export start', 0, MEDIA_LIMITS.durationSeconds)
    const end = finiteNumber(range.endSeconds, 'export end', start, MEDIA_LIMITS.durationSeconds)
    if (end <= start || (request.trimStartSeconds !== undefined && start !== request.trimStartSeconds) || (request.trimEndSeconds !== undefined && end !== request.trimEndSeconds)) throw new TypeError('Unexpected export time range.')
    for (const item of result.tracks) {
      const track = mediaRecord(item)
      const expected = track.type === 'video' ? (request.outputFormat === 'mp4' ? 'avc' : 'vp9') : track.type === 'audio' ? (request.outputFormat === 'mp4' ? 'aac' : 'opus') : null
      if (!expected || track.codec !== expected) throw new TypeError('Unexpected output codec.')
    }
  } else throw new TypeError('Unexpected media worker result.')
  return value as MediaWorkerResult
}

/** A conversion is admissible only when every original track survives exactly once. */
export function assertPreservedMediaTracks(inputIds: readonly number[], utilizedIds: readonly number[], discardedReasons: readonly string[], isValid: boolean): void {
  if (!isValid || discardedReasons.length || inputIds.length !== utilizedIds.length || inputIds.some((id) => utilizedIds.filter((used) => used === id).length !== 1)) {
    throw new Error(`Export would discard tracks: ${discardedReasons.join(', ') || 'missing or duplicated input tracks'}.`)
  }
}

export function assertProcessableVideoTracks(tracks: readonly MediaTrackInfo[]): void {
  for (const track of tracks) {
    if (track.type !== 'video') continue
    if (track.hasAlphaData) throw new Error('Transparent video tracks are not yet supported for frame sampling or export; no alpha channel was silently discarded.')
    if ((track.width ?? 0) * (track.height ?? 0) > MEDIA_LIMITS.sourcePixels) throw new Error('Source video exceeds the decode resolution limit.')
  }
}

export function assertMediaInfo(raw:unknown):MediaInfo {const result=assertMediaWorkerResult({kind:'inspection',info:raw},{action:'media.inspect',artifactId:'inspection'});if(result.kind!=='inspection')throw new TypeError('Invalid media inspection.');return result.info}
