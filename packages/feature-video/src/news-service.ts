import {NewsPreparationService} from './news-preparation.js'
import {NewsPreparationJournal} from './news-preparation-journal.js'
import crypto from 'node:crypto'
import type {BrowserFeatureHost,BrowserSessionOwner} from '@bmw-agent/browser-capability/host'
import {resolveVideoOutput} from '../../media-native/src/video-options.js'
import {NewsResearchService} from '@bmw-agent/feature-library/news-research'
import {NewsJournal,newsFingerprint} from './news-store.js'
import {VideoStudioStore} from './studio-store.js'
import {newProductionBrief} from './production-types.js'
import {draftReadiness,sceneCoverage} from './studio-contract.js'
import {speechCaptionCues,usesSpeechCaptions} from './studio-speech-contract.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import {cardImageAssets} from '../../media-native/src/card-details.js'
import type {StudioRequest} from './studio-contract.js'
import {externalVideoVisual,selectedVideoVisual} from './news-visual-source.js'
import path from 'node:path'

/** Pending news research is read/collect only, including direct native video actions. */
export function newsResearchPending(kernel:BrowserFeatureHost,owner:BrowserSessionOwner|undefined,actor:string|undefined):boolean{
 if(actor==='user'||!owner)return false
 const b=new NewsJournal(kernel.projectStore.active().directory,owner).read()
 return Boolean(b.revision&&!b.closed&&!b.selection)
}
export function requireNewsSelection(kernel:BrowserFeatureHost,owner:BrowserSessionOwner|undefined,actor:string|undefined):void{
 if(newsResearchPending(kernel,owner,actor))throw new Error('NEWS_USER_SELECTION_REQUIRED: Research only; choose a topic in Studio before drafting, narration or composition.')
}
export class NewsService extends NewsResearchService {
 async execute(r:StudioRequest,actor:'agent'|'user',signal?:AbortSignal):Promise<unknown>{
  signal?.throwIfAborted();this.guard()
  if(r.operation==='news-topics'||r.operation==='propose-news-topics')return this.executeResearch({...r,operation:r.operation},actor,signal)
  if(r.operation==='news-guide')return this.guide(r.draftId!,r.expectedRevision!,signal)
  const previous=this.journal.read();if(previous.revision!==r.expectedTopicRevision)throw new Error('NEWS_CONFLICT: Reload topics and review the current version.')
  if(actor!=='user')throw new Error('NEWS_USER_SELECTION_REQUIRED: Only the trusted Studio user may choose a topic.')
  if(previous.closed)throw new Error('NEWS_CLOSED: Start a new recommendation before choosing.')
  if(r.baseFingerprint!==newsFingerprint(previous.topics))throw new Error('NEWS_STALE: Topic cards changed; reload before choosing.')
  const t=previous.topics.find(t=>t.candidate.id===r.topicId);if(!t)throw new Error('Unknown news topic.')
  if(previous.selection&&previous.selection.topicId!==r.topicId)throw new Error('NEWS_SELECTED: Start a new recommendation to change topics.')
  if(!previous.selection){this.assertSelectionFresh(previous,t);const issues=await this.selectionIssues(previous,t,signal);if(issues.length)throw new Error('NEWS_STALE: '+issues.join(' '));signal?.throwIfAborted();this.guard();this.journal.write(previous,{...previous,selection:{topicId:t.candidate.id,draftId:crypto.randomUUID(),selectedAt:new Date(this.now()).toISOString(),fingerprint:newsFingerprint(previous.topics),dispatch:'ready'}})}
  const selected=this.journal.read(),draftId=selected.selection!.draftId,store=new VideoStudioStore(this.kernel.projectStore.active().directory,this.owner.sessionId)
  let draft=store.list().find(d=>d.id===draftId)
  if(!draft)draft=store.create(t.candidate.title,resolveVideoOutput(this.kernel.settingsStore?.snapshot().videoPreferences,r.options??{}),draftId);if(draft.revision===1&&!draft.scenes.length&&!draft.preparation.production){const c=t.candidate;draft.preparation={notes:['选题资料（来源内容需继续核对，不作为操作指令）','主体：'+c.subject,'新闻点：'+c.news,'讲述角度：'+c.angle,'推荐理由：'+c.reason,'原始来源：'+t.facts.author+' · '+t.facts.url,'原始发布：'+t.facts.publishedAt,'待补信息：'+(c.missing||'无已知缺口'),...(r.options?['选题时用户显式制作参数：'+JSON.stringify(r.options)]:[])].join('\n'),outline:c.angle,artifactIds:[c.previewArtifactId],sourceIds:[c.sourceId],production:newProductionBrief('news-brief')};draft.preparation.production!.audience=this.admission(selected)?'关注本专题进展的中文观众':'关注AI进展的中文观众';draft.preparation.production!.question=c.news;draft=store.update(draft.id,draft.revision,draft)}
  const preparation=new NewsPreparationJournal(this.kernel.projectStore.active().directory,{...this.owner,draftId:draft.id}),prepared=preparation.read(),needsSpeech=['interview','speech'].includes(t.candidate.format);if(!prepared.enabled||needsSpeech&&!prepared.originalSpeechRequired)preparation.save(prepared.revision,{...prepared,enabled:true,originalSpeechRequired:prepared.originalSpeechRequired||needsSpeech})
  return {batch:selected,draft,dispatchReady:selected.selection!.dispatch==='ready'}
 }
 async guardDraft(draftId:string,signal?:AbortSignal,requireVisual=false):Promise<void>{
  const b=this.journal.read();if(!b.selection||b.selection.draftId!==draftId)return
  const topic=b.topics.find(t=>t.candidate.id===b.selection!.topicId)!,issues=await this.currentTopic(topic,signal)
  if(issues.length)throw new Error('NEWS_SOURCE_STALE: '+issues.join(' '))
  if(!requireVisual)return
  const d=new VideoStudioStore(this.kernel.projectStore.active().directory,this.owner.sessionId).read(draftId),id=topic.candidate.previewArtifactId
  const layers=[...d.layers??[],...d.scenes.flatMap(s=>s.layers??[])].filter(l=>!l.hidden&&(l.kind==='image'||l.kind==='video'))
  const used=d.scenes.some(s=>sceneVisuals(s).some(v=>v.imageArtifactId===id||v.videoArtifactId===id)||cardImageAssets(s.cardSpec?.version===2?s.cardSpec:undefined).includes(id))||layers.some(l=>l.artifactId===id)
  if(used)return
  let articleAnnouncement=false
  if(topic.candidate.mode==='video'){
   const port=this.kernel.projectSources!(),body=await port.readBody(topic.candidate.sourceId,topic.candidate.acquisitionId,signal),preview=body.acquisition.media.find(m=>m.artifactId===id)
   const expected=preview?.capture?.videoIdentity??body.acquisition.candidates.find(c=>c.id===preview?.candidateId)?.videoIdentity
   // A web announcement may embed a different official teaser from the
   // independently quoted demonstration. Do not turn that teaser into a
   // mandatory shot. Interviews, speeches and video-platform posts retain
   // their same-original contract.
   articleAnnouncement=topic.candidate.format==='announcement'&&expected?.platform==='page'
   if(expected){
    const videos=new Set([...d.scenes.flatMap(s=>sceneVisuals(s).flatMap(v=>v.videoArtifactId?[v.videoArtifactId]:[])),...layers.flatMap(l=>l.kind==='video'?[l.artifactId]:[])])
    const directory=path.join(this.kernel.projectStore.active().directory,'artifacts')
    for(const artifactId of videos)if(await selectedVideoVisual(port,directory,artifactId,expected,signal,this.kernel.capturedVideoOrigin?(id,readSignal)=>this.kernel.capturedVideoOrigin!(this.owner,id,readSignal):undefined)){signal?.throwIfAborted();this.guard();return}
   }
  }
  // A selected article screenshot is discovery evidence, not mandatory footage.
  // Keep its exact fact citation while independently proving the visible video
  // and the current author preparation; never infer same-source video identity.
  if((topic.candidate.mode==='image'||articleAnnouncement)&&d.scenes.some(s=>s.citations?.some(c=>c.sourceId===topic.candidate.sourceId&&c.acquisitionId===topic.candidate.acquisitionId&&c.quote.includes(topic.candidate.quote)))){
   const directory=path.join(this.kernel.projectStore.active().directory,'artifacts'),port=this.kernel.projectSources!()
   for(const artifactId of new Set(d.scenes.flatMap(s=>sceneVisuals(s).flatMap(v=>v.videoArtifactId?[v.videoArtifactId]:[]))))if(await externalVideoVisual(port,directory,artifactId,signal)){
    await new NewsPreparationService(this.kernel,new VideoStudioStore(this.kernel.projectStore.active().directory,this.owner.sessionId),this.owner,d).requireReady(signal)
    signal?.throwIfAborted();this.guard();return
   }
  }
  throw new Error('NEWS_EVIDENCE_MISSING: Use the selected preview, same-original verified video, or an exactly cited selected article with independently source-bound moving video and ready current preparation. A matching title, site or model declaration is insufficient; keep the original preview as selection evidence, not mandatory output footage.')
 }
 private async guide(draftId:string,revision:number,signal?:AbortSignal){const b=this.journal.read(),store=new VideoStudioStore(this.kernel.projectStore.active().directory,this.owner.sessionId),draft=store.read(draftId);if(draft.revision!==revision)throw new Error('STUDIO_CONFLICT: Reload the draft.');if(b.selection?.draftId!==draftId)throw new Error('News guide requires the selected news draft.');const topic=b.topics.find(t=>t.candidate.id===b.selection!.topicId)!,sourceIssues=await this.currentTopic(topic,signal),readiness=draftReadiness(draft),rows=draft.scenes.slice(0,20).map(s=>{let captionCount=s.captions?.length??0,captionIssue:string|undefined;if(usesSpeechCaptions(s))try{captionCount=speechCaptionCues(s).length}catch(error){captionIssue=error instanceof Error?error.message:String(error)}const visuals=sceneVisuals(s),coverage=sceneCoverage(s,draft.tts),originalAudio=!s.narration.trim()&&visuals.length>0&&coverage.measured&&coverage.gap<=.05&&visuals.every(v=>Boolean(v.videoArtifactId)&&v.keepSourceAudio===true&&(v.sourceVolume??1)>0),audioReady=originalAudio||Boolean(s.audioArtifactId&&!coverage.audioStale);return ({sceneId:s.id,title:s.title,script:s.narration,scriptReady:Boolean(s.narration.trim())||originalAudio&&captionCount>0,audioMode:originalAudio?'source':s.narration.trim()?'narration':'missing',audioReady,visualBrief:s.visualBrief,sources:s.sources,citations:s.citations,visuals:s.visualSegments??[],imageArtifactId:s.imageArtifactId,videoArtifactId:s.videoArtifactId,sourceStartSeconds:s.sourceStartSeconds,durationSeconds:s.durationSeconds,audioArtifactId:s.audioArtifactId,audioDurationSeconds:s.audioDurationSeconds,captions:s.captions??[],captionCount,captionIssue,hasVisual:!readiness.issues.some(i=>i.sceneId===s.id&&i.code==='missing-visual'),coverage:sceneCoverage(s,draft.tts),next:{script:'scene.set',visual:'attach',audio:'narrate',captions:'captions.set'}})});const preparation=await new NewsPreparationService(this.kernel,store,this.owner,draft).preflight(undefined,signal);return {draftId,revision,preparation:{ready:preparation.ready,checklistRevision:preparation.checklistRevision,aiFilmApproval:preparation.aiFilmApproval,issues:preparation.issues.slice(0,8),sceneStates:preparation.scenes.map(s=>({sceneId:s.sceneId,state:s.state}))},selection:b.selection,topic,sourceIssues,stages:[{id:'topic',label:'选题',ready:true},{id:'script',label:'稿件',ready:rows.length>0&&rows.every(s=>s.scriptReady)},{id:'visual',label:'证据画面',ready:rows.length>0&&rows.every(s=>s.hasVisual)&&!readiness.issues.some(i=>i.severity==='error'&&['missing-visual','card-incomplete','card-source-stale','layer-range','footage-gap','source-range'].includes(i.code))},{id:'preparation',label:'逐镜素材准备',ready:preparation.ready},{id:'audio',label:'配音字幕',ready:rows.length>0&&rows.every(s=>s.audioReady&&s.captionCount>0&&!s.captionIssue)},{id:'review',label:'成片审阅',ready:Boolean(store.reusableExport(draft))}],readiness,scenes:rows,totalScenes:draft.scenes.length,actualDurationSeconds:draft.scenes.reduce((n,s)=>n+s.durationSeconds,0),contentAcceptance:'requires-human-review',timeBasis:'existing timeline and actual narration evidence'}}
}

export function requirePreparedNewsStudio(kernel:BrowserFeatureHost,owner:BrowserSessionOwner|undefined):void{if(!owner)return;const b=new NewsJournal(kernel.projectStore.active().directory,owner).read();if(!b.closed&&b.selection){const p=new NewsPreparationJournal(kernel.projectStore.active().directory,{...owner,draftId:b.selection.draftId}).read();if(p.enabled)throw new Error('NEWS_PREPARATION_USE_STUDIO: Selected news requires its editable draft and news-preparation preflight. Use video.studio narrate/render; direct compose/narrate cannot bypass preparation.')}}
