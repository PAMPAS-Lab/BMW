import {RecommendationStore} from './recommendation-store.js'
import {EventStore} from './event-store.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {BrowserFeatureHost,BrowserSessionOwner} from '@bmw-agent/browser-capability/host'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {assertImageInspection} from '@bmw-agent/media-native/image'
import {assertMediaInspection} from '@bmw-agent/media-native/port'
import {newsFresh,newsPublication} from './news-contract.js'
import type {NewsTopicCandidate,NewsTopic,NewsBatch} from './news-contract.js'
import {NewsJournal,newsFingerprint} from './news-store.js'
import {LibrarySources} from './library-sources.js'
export interface NewsResearchRequest {operation:'news-topics'|'propose-news-topics';expectedTopicRevision?:number;newsCandidates?:NewsTopicCandidate[];closeNewsTask?:boolean}
export class NewsResearchService {
 readonly journal:NewsJournal
 protected directory:string
 constructor(protected kernel:BrowserFeatureHost,protected owner:BrowserSessionOwner,protected now=()=>Date.now()){this.directory=fs.realpathSync(kernel.projectStore.active().directory);this.journal=new NewsJournal(this.directory,owner)}
 protected guard():void{if(this.kernel.projectStore.active().id!==this.owner.projectId||fs.realpathSync(this.kernel.projectStore.active().directory)!==this.directory)throw new Error('News Project changed.')}
 async verifyCandidate(c:NewsTopicCandidate,signal?:AbortSignal):Promise<NewsTopic>{return this.verify(c,signal)}
 protected async verify(c:NewsTopicCandidate,signal?:AbortSignal):Promise<NewsTopic>{
  this.guard();signal?.throwIfAborted();const body=await new LibrarySources(this.kernel).port().readBody(c.sourceId,c.acquisitionId,signal),a=body.acquisition
  if(a.result!=='observed'||a.access==='login-required'||a.scope.truncated||!a.author?.trim()||!a.publishedAt||!a.contentId||body.text.slice(c.quoteStart,c.quoteStart+c.quote.length)!==c.quote)throw new Error('NEWS_SOURCE: Original author, exact quote, complete observed body and publication date required.')
  const publishedAt=newsPublication(a.publishedAt,Date.parse(a.capturedAt)).publishedAt,media=a.media.find(m=>m.artifactId===c.previewArtifactId),available=media&&body.mediaAvailability.find(m=>m.mediaId===media.id)
  if(!media||!available?.available||!media.contentId)throw new Error('NEWS_PREVIEW: Acquire a verified preview from this original source first.')
  const io=await ArtifactJobIO.open(path.join(this.kernel.projectStore.active().directory,'artifacts'),{action:'media.inspect',artifactId:c.previewArtifactId})
  try{if(io.bytes>32*1024*1024)throw new Error('NEWS_PREVIEW: Preview exceeds 32 MiB.');const previewSha256=await io.fingerprint(signal);if(previewSha256!==media.contentId)throw new Error('NEWS_PREVIEW_STALE: Preview changed.');let durationSeconds:number|null=null
   if(c.mode==='image'){if(media.state!=='image-decoded')throw new Error('NEWS_PREVIEW: Image mode requires an acquired image.');assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:c.previewArtifactId},signal))}
   else{const inspected=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:c.previewArtifactId},signal));if(!inspected.tracks.some(t=>t.type==='video'&&t.canDecode)||inspected.durationSeconds<=0||inspected.durationSeconds>30)throw new Error('NEWS_PREVIEW: Video preview must decode and be at most 30 seconds.');if((c.format==='interview'||c.format==='speech')&&!inspected.tracks.some(t=>t.type==='audio'&&t.canDecode))throw new Error('NEWS_FORMAT: Interview/speech preview needs decodable original audio; choose graphic explicitly if only silent material is available.');durationSeconds=inspected.durationSeconds}
   if(await io.fingerprint(signal)!==previewSha256)throw new Error('NEWS_PREVIEW_STALE: Preview changed during inspection.');signal?.throwIfAborted();this.guard()
   return {candidate:c,facts:{url:body.source.url,author:a.author,publishedAt,contentSha256:a.contentId,previewSha256,durationSeconds,sourceRange:media.capture?{startSeconds:media.capture.sourceStartSeconds,endSeconds:media.capture.sourceEndSeconds}:media.deliveryRange?{startSeconds:media.deliveryRange.startSeconds,endSeconds:media.deliveryRange.endSeconds}:c.mode==='video'&&media.startSeconds!==null&&media.endSeconds!==null?{startSeconds:media.startSeconds,endSeconds:media.endSeconds}:null,checkedAt:new Date(this.now()).toISOString()}}
  }finally{await io.close()}
 }
 protected async currentTopic(t:NewsTopic,signal?:AbortSignal):Promise<string[]>{try{const now=await this.verify(t.candidate,signal);const {checkedAt:_old,...a}=t.facts,{checkedAt:_new,...b}=now.facts;return JSON.stringify(a)===JSON.stringify(b)?[]:['原文、日期或预览已变化，请重新推荐。']}catch(error){signal?.throwIfAborted();return [error instanceof Error?error.message:String(error)]}}
 protected admission(b:NewsBatch){return new RecommendationStore(this.directory,this.owner.projectId).admission(this.owner.sessionId,b)}
 protected assertSelectionFresh(b:NewsBatch,t:NewsTopic):void{const hours=this.admission(b)?.windowHours??72;try{const date=newsPublication(t.facts.publishedAt,this.now());if(date.earliest>=this.now()-hours*3600000&&date.latest<=this.now()&&date.earliest<=this.now())return}catch{}throw new Error('NEWS_EXPIRED: 原始发布时间不在当前'+hours+'小时策略窗口内。')}
 async selectionIssues(b:NewsBatch,t:NewsTopic,signal?:AbortSignal):Promise<string[]>{const admission=this.admission(b),issues=await this.currentTopic(t,signal),hours=admission?.windowHours??72;try{const date=newsPublication(t.facts.publishedAt,this.now());if(date.earliest<this.now()-hours*3600000||date.latest>this.now()||date.earliest>this.now())issues.push('原始发布时间不在当前'+hours+'小时策略窗口内。')}catch{issues.push('原始发布日期不可核对。')}if(admission){if(!this.kernel.libraryRecommendationValidity)issues.push('快照准入校验服务不可用。');else issues.push(...await this.kernel.libraryRecommendationValidity(admission,t,signal))}return issues}
 async topics(signal?:AbortSignal){const b=this.journal.read(),admission=this.admission(b),topics=[];for(const t of b.topics){const issues=admission&&b.selection?.topicId===t.candidate.id?await this.currentTopic(t,signal):await this.selectionIssues(b,t,signal);topics.push({...t,eligible:!issues.length,issues})}return {...b,topics,fingerprint:newsFingerprint(b.topics),asOf:new Date(this.now()).toISOString(),windowStart:new Date(this.now()-(admission?.windowHours??72)*3600000).toISOString(),...(admission?{recommendation:{snapshotId:admission.snapshotId,windowHours:admission.windowHours,acceptedShortage:admission.acceptedShortage}}:{}),awaitingSelection:!b.closed&&!b.selection,selectedDraftId:b.selection?.draftId??null}}
 async executeResearch(r:NewsResearchRequest,actor:'agent'|'user',signal?:AbortSignal):Promise<unknown>{
  signal?.throwIfAborted();this.guard();if(r.operation==='news-topics')return this.topics(signal)
  const previous=this.journal.read();if(previous.revision!==r.expectedTopicRevision)throw new Error('NEWS_CONFLICT: Reload topics and review the current version.')
  if(r.operation==='propose-news-topics'){
   if(previous.closed&&actor!=='user')throw new Error('NEWS_CLOSED: The user left this news task; start again from the material library.')
   if(r.closeNewsTask){if(actor!=='user')throw new Error('NEWS_USER_SELECTION_REQUIRED: Only the user may leave news research.');if(r.newsCandidates?.length)throw new Error('Close cannot replace topic cards.');this.journal.write(previous,{...previous,closed:true});return this.topics(signal)}
   if(previous.selection&&actor!=='user')throw new Error('NEWS_SELECTED: Only the user may start a different news task; preserve the selected draft.')
   const admission=this.admission(previous);if(admission&&(actor!=='user'||r.newsCandidates?.length))throw new Error('SNAPSHOT_LOCKED: Frozen recommendations cannot be replaced; start a new research batch.');
   const topics:NewsTopic[]=[];for(const c of r.newsCandidates??[]){const t=await this.verify(c,signal);if(!newsFresh(t.facts.publishedAt,this.now()))throw new Error('NEWS_EXPIRED: Original publication must be within the last 72 hours.');if(topics.some(p=>p.facts.contentSha256===t.facts.contentSha256||p.facts.url===t.facts.url))throw new Error('NEWS_DUPLICATE: Merge the original event.');topics.push(t)}
   signal?.throwIfAborted();this.guard();const nextId=admission||previous.selection||!previous.revision||actor==='user'&&(previous.closed||previous.topics.length>0)&&!topics.length?crypto.randomUUID():previous.id;const b:NewsBatch={version:1,id:nextId,revision:previous.revision,createdAt:nextId===previous.id?previous.createdAt:new Date(this.now()).toISOString(),topics};const saved=this.journal.write(previous,b);let eventWarning:string|undefined;try{const r=new EventStore(this.directory,this.owner.projectId).ingest(this.owner.sessionId,saved,'verified-proposal');if(r.issues.length)eventWarning=r.issues.join('; ')}catch(e){eventWarning='选题已保存，事件索引待维护：'+String(e)}return {...await this.topics(signal),...(eventWarning?{eventWarning}:{})}
  }
  throw new Error('Unknown news research operation.')
 }
}
