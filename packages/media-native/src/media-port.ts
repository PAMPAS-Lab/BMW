import {assertArtifactId, finiteNumber, mediaRecord} from './media-contract.js'
export interface MediaInspectionReply {durationSeconds: number; tracks: {type: 'audio' | 'video' | 'subtitle'; canDecode: boolean; width?:number; height?:number; hasAlphaData?:boolean}[]}

/** Host-only port. Unknown payloads are admitted by the native request validators.
 * Cancellation settles after output cleanup; consumers must admit unknown replies. */
export interface NativeMediaPort {
  narrate(request: unknown, signal?: AbortSignal): Promise<unknown>
  compose(request: unknown, signal?: AbortSignal): Promise<unknown>
  processArtifact(request: unknown, signal?: AbortSignal): Promise<unknown>
}
export interface MediaArtifactReceipt extends Record<string, unknown> {
  artifactId: string
  durationSeconds: number
}
export function assertMediaArtifactReceipt(raw: unknown): MediaArtifactReceipt {
  const value = mediaRecord(raw)
  assertArtifactId(value.artifactId)
  if(value.verificationArtifactId!==undefined)assertArtifactId(value.verificationArtifactId)
  finiteNumber(value.durationSeconds, 'artifact duration', .01, 180)
  return value as MediaArtifactReceipt
}
export function assertMediaInspection(raw: unknown): MediaInspectionReply {
  const value = mediaRecord(raw)
  finiteNumber(value.durationSeconds, 'media duration', .01, 1800)
  if (!Array.isArray(value.tracks) || !value.tracks.length || value.tracks.length>16 || value.tracks.some(raw => {
    const track = mediaRecord(raw)
    for(const key of ['width','height'] as const)if(track[key]!==undefined)finiteNumber(track[key],key,1,Number.MAX_SAFE_INTEGER,true)
    if(track.hasAlphaData!==undefined&&typeof track.hasAlphaData!=='boolean')throw new TypeError('Invalid native alpha metadata.')
    return !['audio', 'video', 'subtitle'].includes(String(track.type)) || typeof track.canDecode !== 'boolean'
  })) throw new TypeError('Invalid native media inspection reply.')
  return value as unknown as MediaInspectionReply
}
