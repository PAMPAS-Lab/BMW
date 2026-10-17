import {assertVideoDraft,draftReadiness,sceneCoverage} from './studio-contract.js'
import type {VideoDraft,StudioRequest} from './studio-contract.js'
import {mediaRecord} from '../../media-native/src/media-contract.js'
import {cardSpeechTargets} from './studio-card-speech.js'
import {speechBindingStale} from './studio-speech-contract.js'
import {studioPage} from './studio-read-contract.js'
import {assertSourceCatalog} from '../../media-native/src/source-contract.js'
import {videoDocumentFromDraft,videoDraftFromDocument} from './video-document.js'
/** Exact, bounded original-text blocks. No inferred claim or quote authority. */
function sourceQuoteSpans(text:string,offset:number,end:number){
 const spans:{startCharacter:number;endCharacter:number;quote:string}[]=[];let start=offset
 if(start>0&&/[\uDC00-\uDFFF]/.test(text.charAt(start))&&/[\uD800-\uDBFF]/.test(text.charAt(start-1)))start++
 while(start<end&&spans.length<32){let stop=Math.min(end,start+160);if(stop<text.length&&/[\uD800-\uDBFF]/.test(text.charAt(stop-1))&&/[\uDC00-\uDFFF]/.test(text.charAt(stop)))stop--;if(stop<=start)break;spans.push({startCharacter:start,endCharacter:stop,quote:text.slice(start,stop)});start=stop}
 return spans
}
export function studioDraftSummary(raw:unknown,offset=0,limit=20){
 const d=assertVideoDraft(raw),readiness=draftReadiness(d)
 const {items:scenes,...scenePage}=studioPage(d.scenes.map(s=>({id:s.id,title:s.title,durationSeconds:s.durationSeconds,templateId:s.cardSpec?.templateId,audioArtifactId:s.audioArtifactId,audioStale:sceneCoverage(s,d.tts).audioStale,imageArtifactId:s.imageArtifactId,videoArtifactId:s.videoArtifactId})),offset,limit,6000)
 return {projection:'summary',id:d.id,ownerSessionId:d.ownerSessionId,revision:d.revision,title:d.title,updatedAt:d.updatedAt,width:d.width,height:d.height,fps:d.fps,music:d.music,style:d.style,cardLayout:d.cardLayout,narrationPacing:d.narrationPacing,sceneCount:d.scenes.length,durationSeconds:readiness.durationSeconds,ready:readiness.ready,pendingNarrationSceneIds:readiness.pendingNarrationSceneIds.slice(0,20),pendingNarrationCount:readiness.pendingNarrationSceneIds.length,omittedPendingNarrationScenes:Math.max(0,readiness.pendingNarrationSceneIds.length-20),issues:readiness.issues.slice(0,8),omittedIssues:Math.max(0,readiness.issues.length-8),scenes,scenePage,exports:d.exports.slice(-1),nextRead:'read with pageOffset/pageLimit follows scenePage.nextOffset; read-scene with sceneId, expectedRevision and section content/card/captions/speech/visuals/reviews; edit with apply-edit, never copy summary into update.'}
}
export function studioSceneProjection(d:VideoDraft,request:StudioRequest){
 if(d.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 请使用当前草稿版本。')
 const s=d.scenes.find(s=>s.id===request.sceneId);if(!s)throw new Error('Unknown Studio scene.')
 const section=request.section??'content',base={draftId:d.id,revision:d.revision,sceneId:s.id,section},offset=request.pageOffset??0,limit=request.pageLimit??10
 if(section==='content')return {...base,content:{title:s.title,narration:s.narration,visualBrief:s.visualBrief,bullets:s.bullets,label:s.label,layout:s.layout,captionStyle:s.captionStyle??null,captionDisplay:s.captionDisplay??null,showSceneNumber:s.showSceneNumber??null,sceneTemplate:s.sceneTemplate??null,endPolicy:s.endPolicy,durationSeconds:s.durationSeconds},audio:{artifactId:s.audioArtifactId??null,durationSeconds:s.audioDurationSeconds??null,stale:sceneCoverage(s,d.tts).audioStale},sourceCaptionBinding:Boolean(s.sourceCaptionBinding),userEditedCaptionTranslations:(s.captions??[]).some(c=>c.translationOrigin==='user-edited')}
 if(section==='card')return {...base,cardSpec:s.cardSpec??null,targets:cardSpeechTargets(s).map(({kind,index,label})=>({kind,index,label})),links:(s.speechLinks?.cards??[]).map(({kind,index,anchorId})=>({kind,index,anchorId})),anchorState:s.speechAnchors?speechBindingStale(s,s.speechAnchors)?'stale':'current':'missing',associationReviewRequired:true}
 if(section==='captions')return {...base,...studioPage((s.captions??[]).map((cue,index)=>({index,...cue})),offset,limit),speechCaptions:Boolean(s.speechCaptions),sourceBound:Boolean(s.sourceCaptionBinding),captionDisplay:s.captionDisplay??'original'}
 if(section==='speech')return {...base,scriptText:s.narration,audio:{artifactId:s.audioArtifactId??null,durationSeconds:s.audioDurationSeconds??null,stale:sceneCoverage(s,d.tts).audioStale},anchorState:s.speechAnchors?speechBindingStale(s,s.speechAnchors)?'stale':'current':'missing',origin:s.speechAnchors?.origin??null,timingBasis:s.speechAnchors?.timingProvenance?.basis??'unrecorded',timingEvidenceArtifactId:s.speechAnchors?.timingProvenance?.basis==='asr-reference'?s.speechAnchors.timingProvenance.evidenceArtifactId:null,timeDomain:'audio-file-seconds',automaticTimingApproved:false,...studioPage(s.speechAnchors?.anchors??[],offset,limit),links:{bullets:s.speechLinks?.bullets??[],focus:s.speechLinks?.focus??[],cards:(s.speechLinks?.cards??[]).map(({kind,index,anchorId})=>({kind,index,anchorId}))}}
 if(section==='reviews')return {...base,...studioPage((d.reviewItems??[]).filter(item=>item.sceneId===s.id),offset,Math.min(limit,5))}
 if(section==='sources')return {...base,sources:studioPage(s.sources,offset,limit),citations:studioPage(s.citations??[],offset,limit)}
 if(section==='timeline')return {...base,...studioPage(videoDocumentFromDraft(d).content.timeline.tracks.filter(t=>t.sceneId===s.id||!t.sceneId).flatMap(t=>t.clips.map(c=>({trackId:t.id,role:t.role,kind:c.kind,id:c.id,timing:c.timing,properties:c.properties}))),offset,limit)}
 return {...base,visual:{imageArtifactId:s.imageArtifactId??null,videoArtifactId:s.videoArtifactId??null,sourceStartSeconds:s.sourceStartSeconds,sourceDurationSeconds:s.sourceDurationSeconds,playbackRate:s.playbackRate,zoom:s.zoom,crop:s.crop,visualSegments:s.visualSegments??[],focusIntervals:s.focusIntervals??[]}}
}
/** Only the model browser adapter calls this. GUI and service callers retain full
 * documents. Completed mutations never fail just because the report is verbose. */
export function studioAgentResult(request:StudioRequest,raw:unknown):unknown {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw
 const value=mediaRecord(raw)
 if(request.operation==='diagnose-timing'){
  const {sentences,issues,...rest}=value,allIssues=Array.isArray(issues)?issues:[],section=request.timingSection??'overview'
  if(section==='overview')return {...rest,section,issues:allIssues.slice(0,8),issueCount:allIssues.length,omittedIssues:Number(value.omittedIssues??0)+Math.max(0,allIssues.length-8),nextRead:'diagnose-timing with timingSection sentences/issues and pageOffset/pageLimit for complete records.'}
  return {...rest,section,...studioPage(section==='sentences'&&Array.isArray(sentences)?sentences:allIssues,request.pageOffset??0,request.pageLimit??10,8000),issueCount:allIssues.length}
 }
 if((request.operation==='review-status'||request.operation==='record-export-review')&&Array.isArray(value.scenes)){
  const compact=(raw:unknown)=>{const a=mediaRecord(raw),{notes,...rest}=a;return {...rest,...(typeof notes==='string'?{notesPreview:notes.slice(0,160),notesCharacters:notes.length}:{})}},rows=value.scenes.map(raw=>{const s=mediaRecord(raw);return {...s,sceneId:s.sceneId,agent:compact(s.agent),user:compact(s.user)}}),selected=request.operation==='record-export-review'&&request.sceneId?rows.filter(s=>s.sceneId===request.sceneId):rows,{items,...page}=studioPage(selected,request.pageOffset??0,request.pageLimit??8,6000)
  return {...value,agent:compact(value.agent),user:compact(value.user),scenes:items,scenePage:page,notesCoverage:'Assessment notes are previews; the user view keeps complete declared notes.'}
 }
 if(value.version===1&&Array.isArray(value.scenes)&&value.preparation)return studioDraftSummary(value,request.operation==='read'?request.pageOffset??0:0,request.operation==='read'?request.pageLimit??20:20)
 if(request.operation==='describe-schema'){const {documentSchema:_document,editSchema:_edit,...summary}=value;return {...summary,schemaDiscovery:'Use describe-template for card fields and describe-edit for one edit command schema. Canonical document schemas are available to the GUI; model edits use bounded commands.'}}
 if(request.operation==='list'&&Array.isArray(value.drafts)){const {items,...page}=studioPage(value.drafts.map(draft=>studioDraftSummary(draft)),request.pageOffset??0,request.pageLimit??5,18000),ids=new Set(items.map(i=>i.id)),select=(v:unknown)=>v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([id])=>ids.has(id))):{};return {project:value.project,sessionId:value.sessionId,schemaVersion:value.schemaVersion,supportedDocumentVersions:value.supportedDocumentVersions,videoPreferences:value.videoPreferences,drafts:items,...page,compatibility:select(value.compatibility),snapshotProofs:select(value.snapshotProofs),reusableExports:select(value.reusableExports)}}
 if(request.operation==='read-document'){const {document,...rest}=value;return {...rest,draft:studioDraftSummary(videoDraftFromDocument(document)),documentDiscovery:'Read per-scene timeline for current clip IDs; content/card/captions sections expose editable fields without Host provenance.'}}
 if(request.operation==='source'&&request.sourceRequest?.operation==='read'){
  const text=String(value.text??''),offset=request.pageOffset??0,requestedEnd=Math.min(text.length,offset+4000),end=requestedEnd<text.length&&/[\uD800-\uDBFF]/.test(text.charAt(requestedEnd-1))&&/[\uDC00-\uDFFF]/.test(text.charAt(requestedEnd))?requestedEnd-1:requestedEnd,source=mediaRecord(value.source),acquisition=mediaRecord(value.acquisition)
  if(request.sourceSection==='candidates'){const candidates=Array.isArray(acquisition.candidates)?acquisition.candidates:[],confirmed=new Set(Array.isArray(acquisition.confirmedCandidateIds)?acquisition.confirmedCandidateIds:[]),rows=candidates.map(raw=>{const c=mediaRecord(raw);return {...c,confirmed:confirmed.has(c.id)}});return {sourceId:source.id,acquisitionId:acquisition.id,sourceSection:'candidates',...studioPage(rows,offset,request.pageLimit??10)}}
  if(request.sourceSection==='media'){const availability=Array.isArray(value.mediaAvailability)?value.mediaAvailability.map(mediaRecord):[],rows=(Array.isArray(acquisition.media)?acquisition.media:[]).map(raw=>{const m=mediaRecord(raw);return {id:m.id,candidateId:m.candidateId,state:m.state,artifactId:m.artifactId,contentId:m.contentId,bytes:m.bytes,startSeconds:m.startSeconds,endSeconds:m.endSeconds,availability:availability.find(a=>a.mediaId===m.id)}});return {sourceId:source.id,acquisitionId:acquisition.id,sourceSection:'media',...studioPage(rows,offset,request.pageLimit??10)}}
  const scope=acquisition.scope&&typeof acquisition.scope==='object'?mediaRecord(acquisition.scope):{}
  return {sourceId:source.id,url:source.url,acquisitionId:acquisition.id,title:acquisition.title,author:acquisition.author,capturedAt:acquisition.capturedAt,publishedAt:acquisition.publishedAt,eventAt:acquisition.eventAt,eventTimeOrigin:acquisition.eventTimeOrigin,access:acquisition.access,accessText:acquisition.accessText,error:acquisition.error,contentId:acquisition.contentId,scope:{selector:scope.selector,index:scope.index,extraction:scope.extraction,truncated:scope.truncated,status:scope.status},result:acquisition.result,text:text.slice(offset,end),quoteSpans:sourceQuoteSpans(text,offset,end),quoteGuidance:'Copy one returned quoteSpans block and its exact UTF16 bounds intact; add sourceId/acquisitionId and your explicit claim/kind. Blocks are not fact certification. Do not estimate character counts.',characterUnit:'utf16',offset,endCharacter:end,totalCharacters:text.length,nextOffset:end<text.length?end:null,untrustedSourceText:true,mediaDiscovery:'Use sourceSection candidates for confirmed candidates or media for acquired artifact identities and verified availability.'}
 }
 if(request.operation==='source'&&value.catalog){const c=assertSourceCatalog(value.catalog),rows=c.sources.flatMap(s=>s.acquisitions.map(a=>({sourceId:s.id,url:s.url,acquisitionId:a.id,title:a.title,author:a.author,capturedAt:a.capturedAt,publishedAt:a.publishedAt,eventAt:a.eventAt,eventTimeOrigin:a.eventTimeOrigin,access:a.access,result:a.result,originalTextArtifactId:a.originalTextArtifactId,candidateCount:a.candidates.length,mediaCount:a.media.length}))),{items,...page}=studioPage(rows,request.pageOffset??0,request.pageLimit??10);const {catalog:_catalog,pages:_pages,...rest}=value;return {...rest,catalog:{projectId:c.projectId,revision:c.revision,sources:items,...page},readOriginal:'source {operation:read,sourceId,acquisitionId}; text is in source storage, not read-material.'}}
 const result={...value}
 for(const key of ['draft','candidate'])if(result[key]&&typeof result[key]==='object'&&Array.isArray((result[key] as Record<string,unknown>).scenes))result[key]=studioDraftSummary(result[key])
 if(request.operation==='validate-edit'){delete result.document;result.editValidatedAgainstRevision=request.expectedRevision}
 if(request.operation==='read-material'){const text=String(value.text??''),offset=request.pageOffset??0,end=Math.min(text.length,offset+4000);return {...value,text:text.slice(offset,end),offset,endCharacter:end,readableCharacters:text.length,nextOffset:end<text.length?end:null,untrustedMaterialText:true}}
 if(request.operation==='check'&&Array.isArray(value.issues)){result.issues=value.issues.slice(0,12);result.omittedIssues=Math.max(0,value.issues.length-12)}
 if(['estimate-speech','read-speech','align-speech','correct-speech'].includes(request.operation)){
  if(Array.isArray(value.cardTargets))result.cardTargets=value.cardTargets.map(raw=>{const t=mediaRecord(raw);return {kind:t.kind,index:t.index,label:t.label}})
  if(value.binding){const b=mediaRecord(value.binding);result.binding={audioArtifactId:b.audioArtifactId,durationSeconds:b.durationSeconds,timeDomain:b.timeDomain}}
  if(request.operation==='correct-speech'){const a=mediaRecord(value.anchors);result.anchors={origin:a.origin,timeDomain:a.timeDomain,timingProvenance:a.timingProvenance??null,count:Array.isArray(a.anchors)?a.anchors.length:0,nextRead:'read-scene / speech'}}
  if(request.operation==='align-speech'){delete result.evidence;delete result.suggestions;const c=mediaRecord(value.candidate);result.candidate={evidenceArtifactId:c.evidenceArtifactId,origin:c.origin,durationSeconds:c.durationSeconds};result.nextRead='read-speech for paginated actual ASR evidence and editorial suggestions'}
  if(request.operation==='read-speech'){
   delete result.evidence;delete result.candidate;delete result.anchors
   const evidence=value.evidence&&typeof value.evidence==='object'?mediaRecord(value.evidence):{},candidate=value.candidate&&typeof value.candidate==='object'?mediaRecord(value.candidate):{}
   result.evidenceArtifactId=candidate.evidenceArtifactId??null;result.method=evidence.method??null
   const rows=Array.isArray(value.segments)?value.segments.map(raw=>{const s=mediaRecord(raw),text=String(s.text??'');return {id:s.id,startSeconds:s.startSeconds,endSeconds:s.endSeconds,text:text.slice(0,1000),textTruncated:text.length>1000,usable:s.usable,warnings:s.warnings,tokenMeanProbability:s.tokenMeanProbability}}):[]
   result.segments=studioPage(rows,request.pageOffset??0,request.pageLimit??10)
   result.suggestions=studioPage(Array.isArray(value.suggestions)?value.suggestions:[],request.pageOffset??0,request.pageLimit??10)
   result.currentAnchors='read-scene / speech';result.fullEvidence='read-material with evidenceArtifactId; retain original ASR and do not claim acoustic precision.'
  }
  if(request.operation==='estimate-speech'&&Array.isArray(value.anchors)){const page=studioPage(value.anchors,request.pageOffset??0,request.pageLimit??20);result.anchors=page.items;result.anchorPage={total:page.total,offset:page.offset,nextOffset:page.nextOffset}}
 }
 if(request.operation==='recognize-source'||request.operation==='read-source-speech'){
  const candidate=value.candidate&&typeof value.candidate==='object'?mediaRecord(value.candidate):{}
  delete result.evidence;result.candidate={sourceArtifactId:candidate.sourceArtifactId,evidenceArtifactId:candidate.evidenceArtifactId,sourceRange:candidate.sourceRange}
  if(request.operation==='recognize-source'){delete result.segments;result.nextRead='read-source-speech with pageOffset/pageLimit for bounded ASR segments'}
  else {const rows=(Array.isArray(value.segments)?value.segments:[]).map(raw=>{const s=mediaRecord(raw),text=String(s.text??'');return {...s,text:text.slice(0,1000),textTruncated:text.length>1000}});result.segments=studioPage(rows,request.pageOffset??0,request.pageLimit??10)}
 }
 if(request.operation==='render'&&value.export){const e=mediaRecord(value.export),q=e.quality&&typeof e.quality==='object'?mediaRecord(e.quality):undefined;result.export=Object.fromEntries(['artifactId','path','type','contentType','bytes','width','height','fps','durationSeconds','actualDurationSeconds','verificationArtifactId','fingerprint','createdAt','revision'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]));if(q)(result.export as Record<string,unknown>).quality={coverage:q.coverage,semanticVerification:q.semanticVerification,sampleCount:Array.isArray(q.samples)?q.samples.length:0,issueCount:Array.isArray(q.issues)?q.issues.length:0,omittedIssues:q.omittedIssues,reviewOperation:'review-export'}}
 return result
}
