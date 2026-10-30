import type {BrowserSessionOwner} from '@bmw-agent/browser-capability/host'
import {sourceId} from '@bmw-agent/media-native/sources'
import {researchText} from './research-contract.js'
import {assertNewsCandidate,newsPublication} from './news-contract.js'
import type {NewsTopic,NewsTopicCandidate} from './news-contract.js'
import type {RollingStore} from './rolling-service.js'
import type {Lead,CollectionRun,Evidence,RollingRequest} from './rolling-contract.js'
import type {LibraryService} from './library-service.js'
import {watchFresh,watchExpired,VIDEO_WATCH_INTERVAL_MINUTES} from './video-watch-contract.js'
import type {VideoWatch} from './video-watch-contract.js'

export type VerifyWatchVideo=(candidate:NewsTopicCandidate,owner:BrowserSessionOwner,signal?:AbortSignal)=>Promise<NewsTopic>
export type ProposeWatchVideo=(candidate:NewsTopicCandidate,owner:BrowserSessionOwner,signal?:AbortSignal)=>Promise<unknown>
/** Persist proven expiry before a newly authorized source input; keep evidence/history. */
export function expireWaitingVideos(store:RollingStore,subscriptionId:string,now:number):void{
 if(!store.records.state().sequence)return
 const rows:Lead[]=[];let cursor:string|undefined
 do{const page=store.records.page({terms:['video-wait:'+subscriptionId],limit:50,cursor});for(const row of page.items)if(row.value.kind==='lead')rows.push(row.value);cursor=page.nextCursor??undefined}while(cursor&&rows.length<100)
 for(const lead of rows)if(watchExpired(lead.videoWatch,now))store.commit([{...lead,revision:lead.revision+1,updatedAt:new Date(now).toISOString(),videoWatch:{...lead.videoWatch,state:'expired',nextCheckAt:null}}],store.records.state().revision,'video-expired')
}
/** Bounded per-subscription work; no Host editorial judgment or model loop. */
export function waitingVideos(store:RollingStore,subscriptionId:string,now:number):Lead[]{
 if(!store.records.state().sequence)return []
 const leads:Lead[]=[];let cursor:string|undefined
 do{const page=store.records.page({terms:['video-wait:'+subscriptionId],limit:50,cursor});for(const row of page.items){const l=row.value;if(l.kind==='lead'&&l.status!=='dismissed'&&l.videoWatch?.state==='waiting'&&!watchExpired(l.videoWatch,now))leads.push(l)}cursor=page.nextCursor??undefined}while(cursor&&leads.length<100)
 return leads
}
export function dueVideos(store:RollingStore,subscriptionId:string,now:number):Lead[]{return waitingVideos(store,subscriptionId,now).filter(l=>Date.parse(l.videoWatch.nextCheckAt!)<=now).sort((a,b)=>a.videoWatch.nextCheckAt.localeCompare(b.videoWatch.nextCheckAt)||a.id.localeCompare(b.id)).slice(0,10)}
/** Ten current-run summaries remain bounded even after many followup sources. */
export function videoFollowupSummary(lead:Lead,now:number){
 const w=lead.videoWatch,pointer=(e:Evidence)=>({sourceId:e.sourceId,acquisitionId:e.acquisitionId,bodySha256:e.bodySha256,url:e.url.slice(0,200),urlTruncated:e.url.length>200})
 return {id:lead.id,revision:lead.revision,title:lead.title,missing:lead.missing.slice(0,200),missingTruncated:lead.missing.length>200,original:pointer(lead.evidence),videoWatch:{eventKey:w.eventKey,publishedAt:w.publishedAt,state:watchExpired(w,now)?'expired':w.state,nextCheckAt:w.nextCheckAt,checks:w.checks},evidenceCount:w.evidence.length,recentEvidence:w.evidence.slice(-3).map(pointer),evidenceOmitted:Math.max(0,w.evidence.length-3)}
}
export function videoPoolView(lead:Lead,now:number){return {...lead,videoState:watchExpired(lead.videoWatch,now)?'expired':watchFresh(lead.videoWatch,now)?lead.videoWatch.state:'date-pending',videoEligible:lead.status!=='dismissed'&&lead.videoWatch?.state==='ready'&&watchFresh(lead.videoWatch,now)}}

export class VideoWatchService {
 constructor(private library:LibraryService,private now:()=>number,private verify?:VerifyWatchVideo,private propose?:ProposeWatchVideo){}
 async execute(r:RollingRequest,store:RollingStore,actor:'agent'|'user',owner:BrowserSessionOwner|undefined,lease:(runId:string)=>CollectionRun,evidence:(r:RollingRequest)=>Promise<Evidence>,signal?:AbortSignal){
  const old=store.entity(sourceId(r.id),'lead'),state=store.records.state(),stamp=new Date(this.now()).toISOString()
  if(old.status==='dismissed')throw new Error('VIDEO_WATCH_DISMISSED: Restore this lead before following it.')
  if(r.operation==='propose-video'){
   const w=old.videoWatch
   if(actor!=='user'||!owner||owner.projectId!==r.projectId||!this.propose||!this.verify)throw new Error('VIDEO_WATCH_USER: Trusted current Session required.')
   if(r.expectedLeadRevision!==old.revision||!w||w.state!=='ready'||!watchFresh(w,this.now()))throw new Error('VIDEO_WATCH_EXPIRED: Reload a ready, fresh video candidate.')
   let current:NewsTopic
   try{current=await this.verify(w.topic.candidate,owner,signal)
    if(current.facts.contentSha256!==w.topic.facts.contentSha256||current.facts.previewSha256!==w.topic.facts.previewSha256)throw new Error('VIDEO_WATCH_STALE: Original or video changed.')
   }catch(error){
    signal?.throwIfAborted();this.library.host.guard()
    // New evidence will be searched in a future input; never replay this one.
    store.commit([{...old,revision:old.revision+1,updatedAt:stamp,missing:('视频重新核验失败，已回到待补池：'+String(error)).slice(0,2000),videoWatch:{...w,state:'waiting',nextCheckAt:new Date(this.now()+w.intervalMinutes*60000).toISOString(),topic:null,contentKind:null}}],state.revision,'video-stale',signal)
    throw new Error('VIDEO_WATCH_STALE: Video unavailable or changed; retained for the next periodic check. '+String(error))
   }
   this.library.host.guard();signal?.throwIfAborted();if(store.records.state().revision!==state.revision)throw new Error('VIDEO_WATCH_CONFLICT: Pool changed during verification.')
   return this.propose(current.candidate,owner,signal)
  }
  let run:CollectionRun|undefined
  if(actor==='agent'||r.operation==='update-video'){
   run=lease(sourceId(r.runId))
   if(run.subscriptionId!==old.subscriptionId||![...run.leadIds,...(run.videoLeadIds??[])].includes(old.id))throw new Error('VIDEO_WATCH_LEASE: Only this run’s new or due leads may be updated.')
  }else if(r.expectedLeadRevision!==old.revision)throw new Error('VIDEO_WATCH_CONFLICT: Reload the lead before editing.')
  let watch:VideoWatch
  let missing=old.missing
  if(r.operation==='watch-video'){
   if(actor==='agent'&&old.videoWatch)throw new Error('VIDEO_WATCH_EXISTS: Use update-video; do not reset the event or check clock.')
   const key=sourceId(r.eventKey)
   if(old.videoWatch&&old.videoWatch.eventKey!==key)throw new Error('VIDEO_WATCH_IDENTITY: Event identity is immutable.')
   if(state.sequence){const duplicate=store.records.page({terms:['video-event:'+key],limit:2}).items.find(e=>e.key!==old.id);if(duplicate)throw new Error('VIDEO_WATCH_DUPLICATE: Update existing event lead '+duplicate.key)}
   const body=await this.library.host.sources(r.projectId).readBody(old.evidence.sourceId,old.evidence.acquisitionId,signal)
   if(!body.acquisition.publishedAt||body.acquisition.contentId!==old.evidence.bodySha256||body.acquisition.result!=='observed'||body.acquisition.scope.truncated)throw new Error('VIDEO_WATCH_SOURCE: Verified original event date and body required.')
   if((!old.videoWatch||old.videoWatch.state==='paused'&&r.paused===false)&&state.sequence&&store.records.count('video-wait:'+old.subscriptionId)>=100)throw new Error('VIDEO_WATCH_BUDGET: Pause or review existing waiting events first.')
   watch=old.videoWatch?{...old.videoWatch}:{eventKey:key,publishedAt:newsPublication(body.acquisition.publishedAt,this.now()).publishedAt,state:'waiting',intervalMinutes:VIDEO_WATCH_INTERVAL_MINUTES,nextCheckAt:stamp,lastCheckedAt:null,lastRunId:null,checks:0,evidence:[],topic:null,contentKind:null}
   if(r.intervalMinutes!==undefined)watch.intervalMinutes=Number(r.intervalMinutes)
   if(r.paused===true){watch.state='paused';watch.nextCheckAt=null}
   else if(r.paused===false&&watch.state==='paused'){watch.state=watch.topic?'ready':'waiting';watch.nextCheckAt=watch.topic?null:stamp}
  }else{
   if(!old.videoWatch||old.videoWatch.state!=='waiting')throw new Error('VIDEO_WATCH_STATE: Only a waiting event may be checked.')
   if(old.videoWatch.lastRunId===run.id)throw new Error('VIDEO_WATCH_CHECKED: Already checked in this input; wait for the next period.')
   watch={...old.videoWatch,evidence:[...old.videoWatch.evidence],checks:old.videoWatch.checks+1,lastCheckedAt:stamp,lastRunId:run.id,nextCheckAt:new Date(this.now()+old.videoWatch.intervalMinutes*60000).toISOString()}
   missing=researchText(r.missing,2000)
   const supplied=['sourceId','acquisitionId','quote','quoteStart'].filter(k=>r[k]!==undefined)
   if(supplied.length&&supplied.length!==4)throw new Error('VIDEO_WATCH_EVIDENCE: Supply all four evidence fields.')
   if(supplied.length){const e=await evidence(r);if(!watch.evidence.some(v=>v.sourceId===e.sourceId&&v.acquisitionId===e.acquisitionId)){if(watch.evidence.length>=20)throw new Error('VIDEO_WATCH_BUDGET: Evidence history is full; retain it for editorial review.');watch.evidence.push(e)}}
   if((r.candidate!==undefined)!==(r.contentKind!==undefined))throw new Error('VIDEO_WATCH_VIDEO: Candidate and verified content kind must be supplied together.')
   if(r.candidate!==undefined){
    if(!watchFresh(watch,this.now()))throw new Error('VIDEO_WATCH_EXPIRED: Late footage cannot refresh the original event date.')
    const candidate=assertNewsCandidate(r.candidate)
    if(candidate.mode!=='video'||candidate.eventKey!==watch.eventKey||!watch.evidence.concat(old.evidence).some(e=>e.sourceId===candidate.sourceId&&e.acquisitionId===candidate.acquisitionId))throw new Error('VIDEO_WATCH_VIDEO: Same-event video with saved source evidence required.')
    if(!this.verify||!owner)throw new Error('VIDEO_WATCH_UNAVAILABLE: Native video verification unavailable.')
    const topic=await this.verify(candidate,owner,signal)
    if(topic.facts.durationSeconds===null||topic.facts.durationSeconds<3||topic.facts.durationSeconds>30)throw new Error('VIDEO_WATCH_VIDEO: Need 3–30 seconds of source-bound video.')
    watch.topic=topic;watch.contentKind=r.contentKind as VideoWatch['contentKind'];watch.state='ready';watch.nextCheckAt=null
   }
  }
  if(watchExpired(watch,this.now())){watch.state='expired';watch.nextCheckAt=null}
  signal?.throwIfAborted();this.library.host.guard();if(run)lease(run.id)
  const lead:Lead={...old,revision:old.revision+1,updatedAt:stamp,missing,videoWatch:watch}
  // Store CAS preserves GUI changes made while native verification was running.
  return store.commit([lead],state.revision,r.operation,signal)
 }
}
