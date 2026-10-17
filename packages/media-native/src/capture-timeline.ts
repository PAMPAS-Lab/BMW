import {finiteNumber,mediaRecord} from './media-contract.js'
export const CAPTURE_FRAME_LIMIT=120000,CAPTURE_INDEX_BYTES=32*1024*1024
export interface CaptureFrameMapping {sourceTimestampSeconds:number;endSourceSeconds:number;fileTimestampSeconds:number;fileDurationSeconds:number;presentedFrames:number;playbackRate:number;sourceWidth?:number;sourceHeight?:number}
export interface CapturePlaybackEvent {kind:'play'|'pause'|'ratechange';sourceSeconds:number;fileSeconds:number;rate:number}
export interface CaptureMappedIndex {
 version:2;sourceArtifactId:string;videoSha256:string;basis:'native-source-frame+encoded-packet+demuxed-PTS';fileTimestampMapping:'verified';
 sourceStartSeconds:number;sourceEndSeconds:number;durationAtStartSeconds:number|null;sourceDurationSeconds:number|null;
 status:'indexed';reason:null;frames:CaptureFrameMapping[];playbackEvents:CapturePlaybackEvent[]
}
const closed=(v:Record<string,unknown>,keys:string[])=>{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('Unsupported capture timeline field.')}
export function assertFrameMapping(raw:unknown):CaptureFrameMapping {
 const f=mediaRecord(raw);closed(f,['sourceTimestampSeconds','endSourceSeconds','fileTimestampSeconds','fileDurationSeconds','presentedFrames','playbackRate','sourceWidth','sourceHeight'])
 if((f.sourceWidth===undefined)!==(f.sourceHeight===undefined))throw new TypeError('Capture source dimensions must be paired.')
 const dimensions=f.sourceWidth===undefined?{}:{sourceWidth:finiteNumber(f.sourceWidth,'source width',1,8192,true),sourceHeight:finiteNumber(f.sourceHeight,'source height',1,8192,true)}
 const sourceTimestampSeconds=finiteNumber(f.sourceTimestampSeconds,'source PTS',0,86400)
 return {sourceTimestampSeconds,endSourceSeconds:finiteNumber(f.endSourceSeconds,'source end',sourceTimestampSeconds,86400),fileTimestampSeconds:finiteNumber(f.fileTimestampSeconds,'file PTS',0,1820),fileDurationSeconds:finiteNumber(f.fileDurationSeconds,'file duration',.000001,1820),presentedFrames:finiteNumber(f.presentedFrames,'presented frame counter',0,Number.MAX_SAFE_INTEGER,true),playbackRate:finiteNumber(f.playbackRate,'source playback rate',.0625,16),...dimensions}
}
export function assertPlaybackEvents(raw:unknown):CapturePlaybackEvent[]{
 if(!Array.isArray(raw)||raw.length>512)throw new TypeError('Capture playback event budget exceeded.')
 let previous=-1
 return raw.map(row=>{const e=mediaRecord(row);closed(e,['kind','sourceSeconds','fileSeconds','rate']);if(!['play','pause','ratechange'].includes(String(e.kind)))throw new TypeError('Unknown capture playback event.')
 const result={kind:e.kind as CapturePlaybackEvent['kind'],sourceSeconds:finiteNumber(e.sourceSeconds,'event source',0,86400),fileSeconds:finiteNumber(e.fileSeconds,'event file time',0,1820),rate:finiteNumber(e.rate,'event rate',.0625,16)}
 if(result.fileSeconds<previous)throw new TypeError('Capture events are not chronological.');previous=result.fileSeconds;return result})
}
export function assertMappedIndex(raw:unknown,artifactId:string):CaptureMappedIndex {
 const v=mediaRecord(raw);closed(v,['version','sourceArtifactId','videoSha256','basis','fileTimestampMapping','sourceStartSeconds','sourceEndSeconds','durationAtStartSeconds','sourceDurationSeconds','status','reason','frames','playbackEvents'])
 if(v.version!==2||v.sourceArtifactId!==artifactId||typeof v.videoSha256!=='string'||!/^([a-f0-9]{64})$/.test(v.videoSha256)||v.basis!=='native-source-frame+encoded-packet+demuxed-PTS'||v.fileTimestampMapping!=='verified'||v.status!=='indexed'||v.reason!==null||!Array.isArray(v.frames)||!v.frames.length||v.frames.length>CAPTURE_FRAME_LIMIT)throw new TypeError('Invalid mapped capture index.')
 const start=finiteNumber(v.sourceStartSeconds,'capture start',0,86400),end=finiteNumber(v.sourceEndSeconds,'capture end',start,86400)
 for(const k of ['durationAtStartSeconds','sourceDurationSeconds'])if(v[k]!==null)finiteNumber(v[k],k,.001,86400)
 const frames=v.frames.map(assertFrameMapping)
 for(const [i,f]of frames.entries()){
  const prior=frames[i-1]
  if(f.sourceTimestampSeconds<start-.000001||f.endSourceSeconds>end+.000001||prior&&(f.sourceTimestampSeconds<=prior.sourceTimestampSeconds||f.fileTimestampSeconds<=prior.fileTimestampSeconds||Math.abs(prior.endSourceSeconds-f.sourceTimestampSeconds)>.000001||Math.abs(prior.fileTimestampSeconds+prior.fileDurationSeconds-f.fileTimestampSeconds)>.0011))throw new TypeError('Capture frame mappings must be continuous and chronological.')
 }
 if(Math.abs(frames.at(-1)!.endSourceSeconds-end)>.000001)throw new TypeError('Capture mapping does not reach its frozen source endpoint.')
 return {...v,frames,playbackEvents:assertPlaybackEvents(v.playbackEvents)} as unknown as CaptureMappedIndex
}

export interface CapturePlaybackStep {sourceSeconds:number;pauseMs?:number;rate?:number}
export function assertPlaybackPlan(raw:unknown):CapturePlaybackStep[]{
 if(raw===undefined)return []
 if(!Array.isArray(raw)||raw.length>16)throw new TypeError('Capture playbackPlan supports at most 16 steps.')
 let prior=-1
 return raw.map(row=>{const value=mediaRecord(row);closed(value,['sourceSeconds','pauseMs','rate']);const sourceSeconds=finiteNumber(value.sourceSeconds,'plan source time',0,86400)
  if(sourceSeconds<=prior||value.pauseMs===undefined&&value.rate===undefined)throw new TypeError('Playback steps require an action and strictly increasing source times.');prior=sourceSeconds
  return {sourceSeconds,...(value.pauseMs===undefined?{}:{pauseMs:finiteNumber(value.pauseMs,'plan pause',1,10000,true)}),...(value.rate===undefined?{}:{rate:finiteNumber(value.rate,'plan rate',.25,4)})}
 })
}
