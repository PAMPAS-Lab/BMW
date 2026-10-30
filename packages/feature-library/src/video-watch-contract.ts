import {mediaRecord,finiteNumber} from '@bmw-agent/media-native/contract'
import {sourceId} from '@bmw-agent/media-native/sources'
import {closed,researchText} from './research-contract.js'
import {assertNewsCandidate,newsPublication} from './news-contract.js'
export {watchFresh,watchExpired} from './video-watch-policy.js'
import type {NewsTopic} from './news-contract.js'
import type {Evidence} from './rolling-contract.js'

export const VIDEO_WATCH_INTERVAL_MINUTES=120
export const VIDEO_CONTENT_KINDS=['live','cg','animation','ai-generated'] as const
export interface VideoWatch {
 eventKey:string;publishedAt:string;state:'waiting'|'ready'|'expired'|'paused'
 intervalMinutes:number;nextCheckAt:string|null;lastCheckedAt:string|null;lastRunId:string|null;checks:number
 evidence:Evidence[];topic:NewsTopic|null;contentKind:typeof VIDEO_CONTENT_KINDS[number]|null
}
export function assertVideoWatch(raw:unknown,evidence:(v:unknown)=>Evidence):VideoWatch {
 const v=mediaRecord(raw);closed(v,['eventKey','publishedAt','state','intervalMinutes','nextCheckAt','lastCheckedAt','lastRunId','checks','evidence','topic','contentKind'])
 if(!['waiting','ready','expired','paused'].includes(String(v.state)))throw new Error('Invalid video watch state.')
 if(v.state==='waiting'&&v.nextCheckAt===null||v.state!=='waiting'&&v.nextCheckAt!==null)throw new Error('Invalid video watch schedule.')
 const date=(x:unknown)=>{const s=researchText(x,80,true);if(!Number.isFinite(Date.parse(s)))throw new Error('Invalid video watch time.');return s}
 if(!Array.isArray(v.evidence)||v.evidence.length>20)throw new Error('Video watch evidence budget exceeded.')
 let topic:NewsTopic|null=null
 if(v.topic!==null){const t=mediaRecord(v.topic);closed(t,['candidate','facts']);const f=mediaRecord(t.facts);closed(f,['url','author','publishedAt','contentSha256','previewSha256','durationSeconds','sourceRange','checkedAt']);
  // Facts are written exclusively by the native verifier. Retain strict shape on disk.
  if(!/^[a-f0-9]{64}$/.test(String(f.contentSha256))||!/^[a-f0-9]{64}$/.test(String(f.previewSha256)))throw new Error('Invalid video watch fingerprint.')
  const durationSeconds=finiteNumber(f.durationSeconds,'preview duration',3,30)
  let sourceRange:NewsTopic['facts']['sourceRange']=null
  if(f.sourceRange!==null){const range=mediaRecord(f.sourceRange);closed(range,['startSeconds','endSeconds']);const startSeconds=finiteNumber(range.startSeconds,'source start',0,86400),endSeconds=finiteNumber(range.endSeconds,'source end',startSeconds,86400);sourceRange={startSeconds,endSeconds}}
  topic={candidate:assertNewsCandidate(t.candidate),facts:{url:researchText(f.url,2048,true),author:researchText(f.author,2000,true),publishedAt:newsPublication(f.publishedAt).publishedAt,contentSha256:String(f.contentSha256),previewSha256:String(f.previewSha256),durationSeconds,sourceRange,checkedAt:date(f.checkedAt)}}
 }
 if(v.contentKind!==null&&!VIDEO_CONTENT_KINDS.includes(v.contentKind as VideoWatch['contentKind']))throw new Error('Invalid video content kind.')
 if((topic===null)!==(v.contentKind===null)||v.state==='ready'&&!topic||topic&&(topic.candidate.mode!=='video'||topic.candidate.eventKey!==v.eventKey))throw new Error('Video watch requires a verified video for the same event.')
 return {eventKey:sourceId(v.eventKey),publishedAt:newsPublication(v.publishedAt).publishedAt,state:v.state as VideoWatch['state'],intervalMinutes:finiteNumber(v.intervalMinutes,'video check interval',15,1440,true),nextCheckAt:v.nextCheckAt===null?null:date(v.nextCheckAt),lastCheckedAt:v.lastCheckedAt===null?null:date(v.lastCheckedAt),lastRunId:v.lastRunId===null?null:sourceId(v.lastRunId),checks:finiteNumber(v.checks,'video checks',0,1000000,true),evidence:v.evidence.map(evidence),topic,contentKind:v.contentKind as VideoWatch['contentKind']}
}
