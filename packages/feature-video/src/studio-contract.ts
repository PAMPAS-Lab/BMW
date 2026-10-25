import {assertNewsPreparationRequest} from './news-preparation-contract.js'
import type {NewsPreparationRequest} from './news-preparation-contract.js'
import {assertNewsCandidates,newsId} from './news-contract.js'
import type {NewsTopicCandidate} from './news-contract.js'
import {assertProductionAssessment,assessmentRevision} from './production-assessment-contract.js'
import type {ProductionAssessment} from './production-assessment-contract.js'
import {assertGridRecipe} from '../../media-native/src/precomposition-contract.js'
import type {GridRecipe} from '../../media-native/src/precomposition-contract.js'
import {productionType,assertProductionBrief} from './production-contract.js'
import type {ProductionBrief} from './production-contract.js'
import {COMPOSITION_LIMITS} from '../../media-native/src/composition-contract.js'
import {assertAnalysisRequest} from './source-analysis-contract.js'
import type {AnalysisRequest} from './source-analysis-contract.js'
import {TIMING_BASES} from './studio-speech-provenance.js'
import {studioRecovery,studioOperationSpec} from './studio-discovery.js'
import {assertCardSpeechChoices} from './studio-card-speech.js'
import type {CardSpeechChoice} from './studio-card-speech.js'
import {assertEditedRecordingPlan} from './studio-recording-plan.js'
import {assertSpeechSourceRange} from '../../media-native/src/speech-range.js'
import {assertDetailedReady} from '../../media-native/src/card-details.js'
import {CARD_TEMPLATES} from '../../media-native/src/card-templates.js'
import type {VideoEdit} from './video-edit-contract.js'
import {assertVideoEdit} from './video-edit-contract.js'
import {assertReferenceRecords,assertReferenceAnalysis,assertReferenceAnalyses} from './studio-reference-contract.js'
import type {StudioReferenceRecord,StudioReferenceAnalysis} from './studio-reference-contract.js'
import {assertStudioReviewProposal,assertStudioReviewItems} from './studio-review.js'
import type {StudioReviewProposal,StudioReviewItem} from './studio-review.js'
import {assertStudioSpeechOrigin} from './studio-speech-origin.js'
import type {StudioSpeechPlaybackOrigin} from './studio-speech-origin.js'
import {narrationWindows} from '../../media-native/src/composition-contract.js'
import {assertNarrationTiming} from '../../media-native/src/composition-contract.js'
import type {NarrationTiming} from '../../media-native/src/composition-contract.js'
import {assertVisualLayers,assertAudioLayers,layerProblems,assertLayerIdentities} from '../../media-native/src/composition-layers.js'
import type {LayerContainer} from '../../media-native/src/composition-layers.js'
import {assertSourceCandidate,assertSourceCaptionBinding,assertSourceCues,sourceCaptionsStale} from './studio-source-speech-contract.js'
import type {SourceSpeechCandidate,SourceCaptionBinding} from './studio-source-speech-contract.js'
import {assertSentenceAnchors,assertStudioSpeechCandidate,assertStudioSpeechAnchors,speechScene,usesStudioSpeech,assertStudioSpeechLinks} from './studio-speech-contract.js'
import type {SentenceAnchor,StudioSpeechCandidate,StudioSpeechAnchors,StudioSpeechLinks} from './studio-speech-contract.js'
import {assertSourceRequest,assertSourceCitation,sourceId} from '../../media-native/src/source-contract.js'
import type {SourceRequest,SourceCitation} from '../../media-native/src/source-contract.js'
import {assertCoverOptions,assertCoverReceipt} from '../../media-native/src/media/processing.cover-contract.js'
import type {VideoCoverOptions} from '../../media-native/src/media/processing.cover-contract.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import {assertNarrationOptions,NARRATION_PROVIDERS,NARRATION_VOICES} from '../../media-native/src/narration-contract.js'
import type {NarrationOptions} from '../../media-native/src/narration-contract.js'
import { assertVideoOverrides, templateName } from '../../media-native/src/video-options.js'
import type { VideoOptions, VideoWatermark, VideoPreferences, VideoOptionOverrides } from '../../media-native/src/video-options.js'
import { assertArtifactId, finiteNumber, mediaRecord } from '../../media-native/src/media-contract.js'
import { assertComposition } from '../../media-native/src/composition-contract.js'
import type { MediaComposition, CompositionScene } from '../../media-native/src/composition-contract.js'

export type AudioGeneration = ({kind:'tts'|'legacy';options:NarrationOptions}|{kind:'imported'})&{autoTiming?:NarrationTiming}
export interface StudioScene extends CompositionScene {
  narrationOptions?:NarrationOptions
  speechPlaybackOrigin?:StudioSpeechPlaybackOrigin
  sourceSpeech?:SourceSpeechCandidate
  sourceCaptionBinding?:SourceCaptionBinding
  speechLinks?:StudioSpeechLinks
  speechCandidate?:StudioSpeechCandidate
  speechAnchors?:StudioSpeechAnchors
  speechCaptions?:boolean
  audioGeneration?:AudioGeneration
  id: string
  visualBrief: string
  sources: string[]
  citations?:SourceCitation[]
  audioText?: string
  audioDurationSeconds?: number
  sourceDurationSeconds?: number
  endPolicy: 'require-footage' | 'hold'
}
export interface CoverExport {artifactId:string;width:number;height:number;revision:number;createdAt:string;options:VideoCoverOptions;actualTimestampSeconds?:number}
export interface VideoDraft extends LayerContainer {
  referenceRecords?:StudioReferenceRecord[]
  reviewItems?:StudioReviewItem[]
  version: 1; id: string; ownerSessionId?:string; revision: number; title: string
  width: number; height: number; fps: number; music: boolean
  cardLayout?:VideoOptions['cardLayout'];narrationPacing?:VideoOptions['narrationPacing'];tts?:NarrationOptions; style?:VideoOptions['style']; watermark?:VideoWatermark; templateName?:string
  scenes: StudioScene[]; updatedAt: string
  cover?:VideoCoverOptions; coverExports?:CoverExport[]
  preparation:StudioPreparation
  exports: {artifactId: string; verificationArtifactId?:string; fingerprint?:string; revision: number; createdAt: string; durationSeconds: number}[]
}
/** Journal receipts do not edit the canonical draft. Owner, sources and every
 * editable field remain part of this comparison; object key order is irrelevant. */
export function studioDraftContentKey(draft:VideoDraft):string {
  const {revision,updatedAt,exports,coverExports,reviewItems,referenceRecords,...content}=draft
  const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)])):value
  return JSON.stringify(ordered(content))
}
export function sameStudioDraftContent(previous:VideoDraft,next:VideoDraft):boolean{return studioDraftContentKey(previous)===studioDraftContentKey(next)}
export interface StudioPreparation {production?:ProductionBrief;notes:string;outline:string;artifactIds:string[];sourceIds?:string[]}
export interface StudioAsset {artifactId: string; bytes: number; kind: 'video'|'audio'|'image'|'text'; modifiedAt: string}
export interface StudioState {project: {id:string;name:string}; sessionId?:string; drafts: VideoDraft[]; assets: StudioAsset[]; theme:'light'|'dark';videoPreferences?:VideoPreferences;reusableExports?:Record<string,string>;snapshotProofs?:Record<string,string>}
import {assertSourceNarrationRecipe} from './source-narration-recipe.js'
import {assertMaterialIndexRequest} from './material-index-contract.js'
import type {MaterialIndexRequest} from './material-index-contract.js'
import {assertExportReviewVerdict} from './export-review-contract.js'
import {assertAssetQuery,SCENE_SECTIONS} from './studio-read-contract.js'
export interface StudioRequest {
  preparationRequest?:NewsPreparationRequest
  closeNewsTask?:boolean;newsCandidates?:NewsTopicCandidate[];expectedTopicRevision?:number;topicId?:string
  assessment?:ProductionAssessment;expectedAssessmentRevision?:number
  gridRecipe?:GridRecipe
  productionType?:import('./production-contract.js').ProductionType;recipeId?:string;baseFingerprint?:string;productionSection?:'brief'|'sections'|'works'|'relations'|'claims'|'goals'|'assetVersions'

  analysisRequest?:AnalysisRequest
  timingSection?:'overview'|'sentences'|'issues'
  timingBasis?:import('./studio-speech-provenance.js').TimingBasis
  exportReview?:import('./export-review-contract.js').ExportReviewVerdict
  assetQuery?:import('./studio-read-contract.js').StudioAssetQuery
  pageOffset?:number;pageLimit?:number;section?:typeof SCENE_SECTIONS[number];sourceSection?:'text'|'candidates'|'media';briefSection?:'notes'|'outline'|'artifacts'|'sources';editOperation?:string;editOperations?:string[]
  recordingPlan?:import('./studio-recording-plan.js').EditedRecordingSegment[]
  recordingSourceSha256?:string;recordingEventsSha256?:string
  sourceNarrationRecipe?:import('./source-narration-recipe.js').SourceNarrationRecipe
  materialRequest?:MaterialIndexRequest
  sourceRange?:import('../../media-native/src/speech-range.js').SpeechSourceRange
  cardTemplateId?:import('../../media-native/src/card-templates.js').CardTemplateId
  edit?:VideoEdit
  referenceId?:string;referenceAnalysis?:StudioReferenceAnalysis;referenceAnalyses?:import('./studio-reference-contract.js').StudioReferenceAnalysisUpdate[];timestampsSeconds?:number[];beforeNotes?:string
  reviewProposal?:StudioReviewProposal;reviewId?:string
  sourceRequest?:SourceRequest
  speechLanguage?:'zh'|'en'|'auto';sourceCues?:import('../../media-native/src/composition-contract.js').CaptionCue[]
  translations?:{cueIndex:number;originalText:string;translationText:string}[]
  speechModel?:'base'|'small'; anchors?:SentenceAnchor[];cardLinks?:CardSpeechChoice[]
  snapshotProof?:string
  splitSeconds?:number
  operation:'news-preparation'|'news-topics'|'propose-news-topics'|'select-news-topic'|'news-guide'|'record-production-review'|'precomposition-status'|'precompose'|'production-profiles'|'propose-type'|'adopt-type'|'production-read'|'production-review'|'plan-impact'|'analysis'|'diagnose-timing'|'review-status'|'record-export-review'|'read-scene'|'read-preparation'|'describe-edit'|'guide'|'estimate-speech'|'suggest-recording-plan'|'apply-recording-plan'|'narrate-local'|'apply-source-narration'|'validate-source-narration'|'materials'|'describe-template'|'describe-schema'|'read-document'|'compatibility'|'validate-edit'|'apply-edit'|'migrate-document'|'remove-reference'|'prepare-reference'|'read-reference'|'set-reference-analyses'|'set-reference-analysis'|'apply-reference-notes'|'propose-review'|'adopt-review'|'dismiss-review'|'undo-review'|'split-scene'|'restore'|'recognize-source'|'read-source-speech'|'apply-source-captions'|'detach-source-captions'|'set-caption-translations'|'align-speech'|'read-speech'|'correct-speech'|'source'|'export-citations'|'list'|'create'|'read'|'delete'|'update'|'narrate'|'narrate-pending'|'check'|'export-captions'|'export-cover'|'read-material'|'suggest-focus'|'review-export'|'render'|'assets'|'inspect'|'attach'|'open'|'context'|'configure'|'save-template'
  templateName?:string; options?:VideoOptionOverrides
  draftId?: string; expectedRevision?: number; draft?: unknown; title?: string
  cover?:VideoCoverOptions
  reviewOffset?:number
  forceRender?:boolean
  captionFormat?:'srt'|'vtt'; segmentIndex?:number
  sceneId?: string; artifactId?: string; assetKind?: 'video'|'audio'|'image'; ratePercent?: number;provider?:NarrationOptions['provider'];voice?:NarrationOptions['voice']
}
export function studioText(raw:unknown,name:string,max:number):string {
  if(typeof raw!=='string'||raw.length>max||/[\u0000-\u0008]/.test(raw))throw new TypeError(`Invalid ${name}.`)
  return raw
}
export function studioId(raw:unknown):string {
  if(typeof raw!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(raw))throw new TypeError('Invalid Studio identity.')
  return raw
}
function closed(value:Record<string,unknown>,keys:readonly string[]):void {
  if(Object.keys(value).some(key=>!keys.includes(key)))throw new TypeError('Unsupported Studio property. Use video.studio / studioRequest.operation="guide" for exact operation fields.')
}
export function assertStudioRequest(raw:unknown):StudioRequest {
  try{
    const value=mediaRecord(raw),spec=studioOperationSpec(value.operation),parsed=parseStudioRequest(raw)
    if(spec){closed(value,['operation',...spec.required,...spec.optional]);const missing=spec.required.filter(key=>value[key]===undefined);if(missing.length)throw new TypeError('Studio operation requires '+missing.join(', ')+'.')}
    return parsed
  }catch(error){throw studioRecovery(raw,error)}
}
function parseStudioRequest(raw:unknown):StudioRequest {
  const value=mediaRecord(raw)
  closed(value,['preparationRequest','closeNewsTask','newsCandidates','expectedTopicRevision','topicId','assessment','expectedAssessmentRevision','gridRecipe','productionType','recipeId','baseFingerprint','productionSection','analysisRequest','timingSection','timingBasis','exportReview','briefSection','assetQuery','pageOffset','pageLimit','section','sourceSection','editOperation','editOperations','cardLinks','recordingPlan','recordingSourceSha256','recordingEventsSha256','sourceNarrationRecipe','materialRequest','cardTemplateId','edit','operation','draftId','expectedRevision','draft','title','sceneId','artifactId','assetKind','ratePercent','templateName','options','provider','voice','captionFormat','segmentIndex','cover','forceRender','reviewOffset','sourceRequest','speechModel','anchors','speechLanguage','sourceRange','sourceCues','translations','snapshotProof','splitSeconds','reviewProposal','reviewId','referenceId','referenceAnalysis','referenceAnalyses','timestampsSeconds','beforeNotes'])
  if(!['news-preparation','news-topics','propose-news-topics','select-news-topic','news-guide','record-production-review','precomposition-status','precompose','production-profiles','propose-type','adopt-type','production-read','production-review','plan-impact','analysis','diagnose-timing','review-status','record-export-review','read-scene','read-preparation','describe-edit','guide','estimate-speech','suggest-recording-plan','apply-recording-plan','narrate-local','apply-source-narration','validate-source-narration','materials','describe-template','describe-schema','read-document','compatibility','validate-edit','apply-edit','migrate-document','remove-reference','prepare-reference','read-reference','set-reference-analyses','set-reference-analysis','apply-reference-notes','propose-review','adopt-review','dismiss-review','undo-review','split-scene','restore','recognize-source','read-source-speech','apply-source-captions','detach-source-captions','set-caption-translations','align-speech','read-speech','correct-speech','source','export-citations','list','create','read','delete','update','narrate','narrate-pending','check','export-captions','export-cover','read-material','suggest-focus','review-export','render','assets','inspect','attach','open','context','configure','save-template'].includes(String(value.operation)))throw new TypeError('Unknown Studio operation. Use video.studio / studioRequest.operation="guide"; actual MP4 review is review-export.')
  const result:StudioRequest={operation:value.operation as StudioRequest['operation']}
  if(result.operation==='news-preparation')return {...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),preparationRequest:assertNewsPreparationRequest(value.preparationRequest),pageOffset:finiteNumber(value.pageOffset??0,'preparation offset',0,1000,true),pageLimit:finiteNumber(value.pageLimit??20,'preparation limit',1,20,true)}
  if(result.operation==='news-topics')return result
  if(result.operation==='news-guide')return {...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true)}
  if(result.operation==='propose-news-topics'){if(value.closeNewsTask!==undefined&&typeof value.closeNewsTask!=='boolean')throw new TypeError('Invalid close flag.');return {...result,...(value.closeNewsTask===undefined?{}:{closeNewsTask:value.closeNewsTask===true}),expectedTopicRevision:finiteNumber(value.expectedTopicRevision,'topic revision',0,1000000,true),newsCandidates:assertNewsCandidates(value.newsCandidates)}}
  if(result.operation==='select-news-topic'){if(typeof value.baseFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(value.baseFingerprint))throw new TypeError('Expected topic fingerprint.');return {...result,expectedTopicRevision:finiteNumber(value.expectedTopicRevision,'topic revision',0,1000000,true),topicId:newsId(value.topicId),baseFingerprint:value.baseFingerprint,...(value.options===undefined?{}:{options:assertVideoOverrides(value.options)})}}
  if(result.operation==='record-production-review'){if(typeof value.baseFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(value.baseFingerprint))throw new TypeError('Current type review fingerprint is required.');return {...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),baseFingerprint:value.baseFingerprint,expectedAssessmentRevision:assessmentRevision(value.expectedAssessmentRevision),assessment:assertProductionAssessment(value.assessment)}}
  if(result.operation==='precomposition-status')return {...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),artifactId:assertArtifactId(value.artifactId)}
  if(result.operation==='precompose')return {...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),gridRecipe:assertGridRecipe(value.gridRecipe)}
  if(result.operation==='production-profiles')return result
  if(['propose-type','adopt-type','production-read','production-review','plan-impact'].includes(result.operation)){
    const base={...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true)}
    if(value.baseFingerprint!==undefined&&(typeof value.baseFingerprint!=='string'||! /^[a-f0-9]{64}$/.test(value.baseFingerprint)))throw new TypeError('Expected production fingerprint.')
    if(result.operation==='propose-type'||result.operation==='adopt-type'){
      if(value.recipeId!==undefined&&(typeof value.recipeId!=='string'||! /^[a-z-]{1,80}$/.test(value.recipeId)))throw new TypeError('Invalid recipe identity.')
      if(result.operation==='adopt-type'&&value.baseFingerprint===undefined)throw new TypeError('Explicit adoption requires the reviewed fingerprint.')
      return {...base,productionType:productionType(value.productionType),...(value.recipeId===undefined?{}:{recipeId:value.recipeId as string}),...(value.sceneId===undefined?{}:{sceneId:studioId(value.sceneId)}),...(value.baseFingerprint===undefined?{}:{baseFingerprint:value.baseFingerprint as string})}
    }
    if(result.operation==='production-review')return base
    if(value.productionSection!==undefined&&!['brief','sections','works','relations','claims','goals','assetVersions'].includes(String(value.productionSection)))throw new TypeError('Unknown production section.')
    return {...base,...(value.productionSection===undefined?{}:{productionSection:value.productionSection as StudioRequest['productionSection']}),...(value.edit===undefined?{}:{edit:assertVideoEdit(value.edit)}),...(value.cover===undefined?{}:{cover:assertCoverOptions(value.cover)}),...(value.baseFingerprint===undefined?{}:{baseFingerprint:value.baseFingerprint as string}),pageOffset:finiteNumber(value.pageOffset??0,'page offset',0,1000,true),pageLimit:finiteNumber(value.pageLimit??20,'page limit',1,20,true)}
  }
  if(result.operation==='analysis'){closed(value,['operation','draftId','expectedRevision','analysisRequest']);return {operation:'analysis',draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),analysisRequest:assertAnalysisRequest(value.analysisRequest)}}
  if(value.analysisRequest!==undefined)throw new TypeError('analysisRequest requires analysis.');
  if(result.operation==='diagnose-timing'){
    closed(value,['operation','draftId','expectedRevision','sceneId','timingSection','pageOffset','pageLimit'])
    if(value.timingSection!==undefined&&!['overview','sentences','issues'].includes(String(value.timingSection)))throw new TypeError('Unknown timing section.')
    return {...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),sceneId:studioId(value.sceneId),timingSection:(value.timingSection??'overview') as StudioRequest['timingSection'],...(value.pageOffset===undefined?{}:{pageOffset:finiteNumber(value.pageOffset,'timing offset',0,100,true)}),...(value.pageLimit===undefined?{}:{pageLimit:finiteNumber(value.pageLimit,'timing limit',1,20,true)})}
  }
  if(value.timingSection!==undefined)throw new TypeError('timingSection requires diagnose-timing.')

  if(result.operation==='review-status'||result.operation==='record-export-review'){
    closed(value,['operation','draftId','expectedRevision',...(result.operation==='record-export-review'?['exportReview','sceneId']:['pageOffset','pageLimit'])])
    const scoped={...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true)}
    if(result.operation==='review-status')return {...scoped,...(value.pageOffset===undefined?{}:{pageOffset:finiteNumber(value.pageOffset,'review scene offset',0,COMPOSITION_LIMITS.scenes,true)}),...(value.pageLimit===undefined?{}:{pageLimit:finiteNumber(value.pageLimit,'review scene limit',1,20,true)})}
    const exportReview=assertExportReviewVerdict(value.exportReview)
    if(exportReview.scope==='film'&&value.sceneId!==undefined)throw new TypeError('Film review does not take sceneId.')
    return {...scoped,exportReview,...(exportReview.scope==='scene'?{sceneId:studioId(value.sceneId)}:{})}
  }
  if(value.exportReview!==undefined)throw new TypeError('exportReview requires record-export-review.')

  if(result.operation==='assets'){closed(value,['operation','assetQuery']);return {...result,...(value.assetQuery===undefined?{}:{assetQuery:assertAssetQuery(value.assetQuery)})}}
  if(value.assetQuery!==undefined)throw new TypeError('assetQuery requires assets.')
  if(['read','read-scene','read-preparation','list','source','read-material','estimate-speech','read-speech','read-source-speech'].includes(result.operation)){
    if(value.pageOffset!==undefined)result.pageOffset=finiteNumber(value.pageOffset,'page offset',0,1000000,true)
    if(value.pageLimit!==undefined)result.pageLimit=finiteNumber(value.pageLimit,'page limit',1,20,true)
  }else if(value.pageOffset!==undefined||value.pageLimit!==undefined)throw new TypeError('Paging requires a bounded read operation.')
  if(result.operation==='read-scene'){closed(value,['operation','draftId','expectedRevision','sceneId','section','pageOffset','pageLimit']);if(value.section!==undefined&&!SCENE_SECTIONS.includes(value.section as typeof SCENE_SECTIONS[number]))throw new TypeError('Unknown scene section.');return {...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),sceneId:studioId(value.sceneId),section:(value.section??'content') as typeof SCENE_SECTIONS[number]}}
  if(value.section!==undefined)throw new TypeError('section requires read-scene.')
  if(result.operation==='read-preparation'){closed(value,['operation','draftId','expectedRevision','briefSection','pageOffset','pageLimit']);if(value.briefSection!==undefined&&!['notes','outline','artifacts','sources'].includes(String(value.briefSection)))throw new TypeError('Unknown brief section.');return {...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),briefSection:(value.briefSection??'notes') as StudioRequest['briefSection']}}
  if(value.briefSection!==undefined)throw new TypeError('briefSection requires read-preparation.')
  if(result.operation==='describe-edit'){closed(value,['operation','editOperation','editOperations']);const valid=(v:unknown):v is string=>typeof v==='string'&&/^[a-z]+\.[a-z]+$/.test(v);if(value.editOperations!==undefined){if(value.editOperation!==undefined||!Array.isArray(value.editOperations)||value.editOperations.length<1||value.editOperations.length>8||!value.editOperations.every(valid)||new Set(value.editOperations).size!==value.editOperations.length)throw new TypeError('Choose one editOperation or one to eight unique editOperations.');return {...result,editOperations:value.editOperations}}if(!valid(value.editOperation))throw new TypeError('Choose one edit operation.');return {...result,editOperation:value.editOperation}}
  if(value.editOperation!==undefined||value.editOperations!==undefined)throw new TypeError('editOperation requires describe-edit.')
  if(result.operation==='list'){closed(value,['operation','pageOffset','pageLimit']);return result}

  if(['suggest-recording-plan','apply-recording-plan'].includes(result.operation)){closed(value,['operation','draftId','expectedRevision','sceneId',...(result.operation==='apply-recording-plan'?['recordingPlan','recordingSourceSha256','recordingEventsSha256']:[])]);const scoped={operation:result.operation,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),sceneId:studioId(value.sceneId)};if(result.operation==='suggest-recording-plan')return scoped;for(const key of ['recordingSourceSha256','recordingEventsSha256'])if(typeof value[key]!=='string'||! /^[a-f0-9]{64}$/.test(value[key] as string))throw new TypeError('Recording plan requires source/event fingerprints.');return {...scoped,recordingPlan:assertEditedRecordingPlan(value.recordingPlan),recordingSourceSha256:value.recordingSourceSha256 as string,recordingEventsSha256:value.recordingEventsSha256 as string}}
  if(value.recordingPlan!==undefined||value.recordingSourceSha256!==undefined||value.recordingEventsSha256!==undefined)throw new TypeError('Recording edits require apply-recording-plan.');
  if(['apply-source-narration','validate-source-narration'].includes(result.operation)){closed(value,['operation','draftId','expectedRevision','sceneId','sourceNarrationRecipe']);return {operation:result.operation,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),sceneId:studioId(value.sceneId),sourceNarrationRecipe:assertSourceNarrationRecipe(value.sourceNarrationRecipe)}}
  if(result.operation==='narrate-local'){closed(value,['operation','draftId','expectedRevision','sceneId']);return {operation:'narrate-local',draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1000000,true),sceneId:studioId(value.sceneId)}}
  if(value.sourceNarrationRecipe!==undefined)throw new TypeError('Source narration recipe requires its explicit operation.');
  if(result.operation==='materials'){closed(value,['operation','materialRequest']);return {operation:'materials',materialRequest:assertMaterialIndexRequest(value.materialRequest)}}
  if(value.materialRequest!==undefined)throw new TypeError('materialRequest requires materials.');
  if(result.operation==='guide'){closed(value,['operation']);return result}
  if(result.operation==='describe-schema'){closed(value,['operation']);return result}
  if(result.operation==='describe-template'){closed(value,['operation','cardTemplateId']);const definition=CARD_TEMPLATES.find(item=>item.id===value.cardTemplateId);if(!definition)throw new TypeError('CARD_TEMPLATE: Unknown template.');return {operation:'describe-template',cardTemplateId:definition.id}}
  if(value.cardTemplateId!==undefined)throw new TypeError('cardTemplateId requires describe-template.')
  if(['read-document','compatibility','migrate-document','validate-edit','apply-edit'].includes(result.operation)){
    const edits=result.operation==='validate-edit'||result.operation==='apply-edit'
    closed(value,['operation','draftId','expectedRevision',...(edits?['edit']:[])])
    return {...result,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1_000_000,true),...(edits?{edit:assertVideoEdit(value.edit)}:{})}
  }
  if(value.edit!==undefined)throw new TypeError('edit requires validate-edit or apply-edit.')
  if(result.operation==='set-reference-analyses'){
    closed(value,['operation','draftId','expectedRevision','referenceAnalyses'])
    return {operation:result.operation,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1_000_000,true),referenceAnalyses:assertReferenceAnalyses(value.referenceAnalyses)}
  }
  if(['remove-reference','prepare-reference','read-reference','set-reference-analyses','set-reference-analysis','apply-reference-notes'].includes(result.operation)){
    const prepare=result.operation==='prepare-reference',extra=prepare?['artifactId','assetKind','timestampsSeconds']:result.operation==='set-reference-analysis'?['referenceAnalysis']:result.operation==='apply-reference-notes'?['beforeNotes']:[]
    closed(value,['operation','draftId','expectedRevision',...extra,...(prepare?[]:['referenceId'])]);const base={operation:result.operation,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1_000_000,true)}
    if(prepare){if(!['image','video'].includes(String(value.assetKind)))throw new TypeError('Reference preparation needs image or video kind.');if(value.timestampsSeconds!==undefined&&(!Array.isArray(value.timestampsSeconds)||!value.timestampsSeconds.length||value.timestampsSeconds.length>8||value.assetKind!=='video'))throw new TypeError('Video reference needs one to eight optional frame times.');return {...base,artifactId:assertArtifactId(value.artifactId),assetKind:value.assetKind as 'image'|'video',...(value.timestampsSeconds===undefined?{}:{timestampsSeconds:(value.timestampsSeconds as unknown[]).map(t=>finiteNumber(t,'reference time',0,1800))})}}
    return {...base,referenceId:studioId(value.referenceId),...(result.operation==='set-reference-analysis'?{referenceAnalysis:assertReferenceAnalysis(value.referenceAnalysis)}:result.operation==='apply-reference-notes'?{beforeNotes:studioText(value.beforeNotes,'original preparation notes',20000)}:{})}
  }
  if(['referenceId','referenceAnalysis','referenceAnalyses','timestampsSeconds','beforeNotes'].some(k=>value[k]!==undefined))throw new TypeError('Reference fields require reference operations.')
  if(['propose-review','adopt-review','dismiss-review','undo-review'].includes(result.operation)){
    const propose=result.operation==='propose-review';closed(value,['operation','draftId','expectedRevision',propose?'reviewProposal':'reviewId'])
    return {operation:result.operation,draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1_000_000,true),...(propose?{reviewProposal:assertStudioReviewProposal(value.reviewProposal)}:{reviewId:studioId(value.reviewId)})}
  }
  if(value.reviewProposal!==undefined||value.reviewId!==undefined)throw new TypeError('Review fields require review operations.')
  if(result.operation==='split-scene'){
    closed(value,['operation','draftId','expectedRevision','sceneId','splitSeconds'])
    return {operation:'split-scene',draftId:studioId(value.draftId),expectedRevision:finiteNumber(value.expectedRevision,'revision',1,1_000_000,true),sceneId:studioId(value.sceneId),splitSeconds:finiteNumber(value.splitSeconds,'scene split',1,59)}
  }
  if(value.splitSeconds!==undefined)throw new TypeError('splitSeconds requires split-scene operation.')
  if(result.operation==='restore'){
    closed(value,['operation','draftId','expectedRevision','draft','snapshotProof'])
    const expectedRevision=finiteNumber(value.expectedRevision,'revision',1,1_000_000,true)
    if(typeof value.snapshotProof!=='string'||!/^[a-f0-9]{64}$/.test(value.snapshotProof))throw new TypeError('Invalid Studio snapshot proof.')
    return {operation:'restore',draftId:studioId(value.draftId),expectedRevision,draft:assertVideoDraft(value.draft),snapshotProof:value.snapshotProof}
  }
  if(value.snapshotProof!==undefined)throw new TypeError('snapshotProof requires restore operation.')
  if(result.operation==='source'){closed(value,['operation','sourceRequest','pageOffset','pageLimit','sourceSection']);result.sourceRequest=assertSourceRequest(value.sourceRequest);if(!['list','read'].includes(result.sourceRequest.operation)&&(value.pageOffset!==undefined||value.pageLimit!==undefined))throw new TypeError('Source paging requires list or read.');if(value.sourceSection!==undefined){if(result.sourceRequest.operation!=='read'||!['text','candidates','media'].includes(String(value.sourceSection)))throw new TypeError('Source section requires read.');result.sourceSection=value.sourceSection as StudioRequest['sourceSection']}return result}
  if(value.sourceSection!==undefined)throw new TypeError('sourceSection requires source read.')
  if(value.sourceRequest!==undefined)throw new TypeError('sourceRequest requires source operation.')
  for(const key of ['draftId','sceneId'] as const)if(value[key]!==undefined)result[key]=studioId(value[key])
  if(value.expectedRevision!==undefined)result.expectedRevision=finiteNumber(value.expectedRevision,'revision',1,1_000_000,true)
  if(value.title!==undefined)result.title=studioText(value.title,'title',80)
  if(value.artifactId!==undefined)result.artifactId=assertArtifactId(value.artifactId)
  if(value.assetKind!==undefined){if(!['video','audio','image'].includes(String(value.assetKind)))throw new TypeError('Invalid asset kind.');result.assetKind=value.assetKind as StudioRequest['assetKind']}
  if(value.provider!==undefined){if(!NARRATION_PROVIDERS.includes(value.provider as NarrationOptions['provider']))throw new TypeError('Unsupported narration provider.');result.provider=value.provider as NarrationOptions['provider']}
  if(value.voice!==undefined){if(!NARRATION_VOICES.includes(value.voice as NarrationOptions['voice']))throw new TypeError('Unsupported narration voice.');result.voice=value.voice as NarrationOptions['voice']}
  if(value.ratePercent!==undefined)result.ratePercent=finiteNumber(value.ratePercent,'speech rate',-20,30,true)
  if(value.templateName!==undefined)result.templateName=templateName(value.templateName)
  if(value.options!==undefined){const options=mediaRecord(value.options);result.options=assertVideoOverrides(options)}
  if(['export-citations','narrate-pending','check','delete'].includes(result.operation)){
    closed(value,['operation','draftId','expectedRevision'])
    if(!result.draftId||result.expectedRevision===undefined)throw new TypeError('This Studio operation requires draftId and expectedRevision.')
  }
  if(value.cover!==undefined){if(result.operation!=='export-cover')throw new TypeError('Cover options require export-cover.');result.cover=assertCoverOptions(value.cover)}
  if(result.operation==='export-cover'){closed(value,['operation','draftId','expectedRevision','cover']);if(!result.draftId||!result.expectedRevision)throw new TypeError('Cover export needs draftId and expectedRevision.')}
  if(value.captionFormat!==undefined){if(value.captionFormat!=='srt'&&value.captionFormat!=='vtt')throw new TypeError('Invalid caption format.');result.captionFormat=value.captionFormat}
  if(value.segmentIndex!==undefined)result.segmentIndex=finiteNumber(value.segmentIndex,'segment index',0,7,true)
  if(result.operation==='export-captions'){closed(value,['operation','draftId','expectedRevision','captionFormat']);if(!result.draftId||!result.expectedRevision||!result.captionFormat)throw new TypeError('Caption export needs draftId, expectedRevision and captionFormat.')}
  if(result.operation==='read-material'){closed(value,['operation','artifactId','pageOffset','pageLimit']);if(!result.artifactId)throw new TypeError('Material reading needs artifactId.')}
  if(value.forceRender!==undefined){if(result.operation!=='render'||typeof value.forceRender!=='boolean')throw new TypeError('forceRender requires render and a boolean.');result.forceRender=value.forceRender}
  if(result.operation==='review-export'){closed(value,['operation','draftId','expectedRevision','sceneId','reviewOffset']);if(!result.draftId||!result.expectedRevision||!result.sceneId)throw new TypeError('Export review requires owned draft, revision and scene.');if(value.reviewOffset!==undefined)result.reviewOffset=finiteNumber(value.reviewOffset,'review page offset',0,16,true)}
  if(value.reviewOffset!==undefined&&result.operation!=='review-export')throw new TypeError('reviewOffset requires review-export.');
  if(result.operation==='suggest-focus'){closed(value,['operation','draftId','expectedRevision','sceneId','segmentIndex']);if(!result.draftId||!result.expectedRevision||!result.sceneId)throw new TypeError('Focus suggestions need draftId, expectedRevision and sceneId.')}
  if(['estimate-speech','align-speech','read-speech','correct-speech'].includes(result.operation)){
    closed(value,['operation','draftId','expectedRevision','sceneId',...(['estimate-speech','read-speech'].includes(result.operation)?['pageOffset','pageLimit']:[]),...(result.operation==='align-speech'?['speechModel']:result.operation==='correct-speech'?['anchors','cardLinks','timingBasis']:[])])
    if(!result.draftId||!result.expectedRevision||!result.sceneId)throw new TypeError('Speech operations require draftId, expectedRevision and sceneId.')
  }
  if(value.speechModel!==undefined){if(!['align-speech','recognize-source'].includes(result.operation)||!['base','small'].includes(String(value.speechModel)))throw new TypeError('Speech model requires align-speech and a fixed model.');result.speechModel=value.speechModel as 'base'|'small'}
  if(value.cardLinks!==undefined){if(result.operation!=='correct-speech')throw new TypeError('cardLinks requires correct-speech.');result.cardLinks=assertCardSpeechChoices(value.cardLinks)}
  if(value.timingBasis!==undefined){if(result.operation!=='correct-speech'||!TIMING_BASES.includes(value.timingBasis as typeof TIMING_BASES[number]))throw new TypeError('timingBasis requires correct-speech and a supported timing basis.');result.timingBasis=value.timingBasis as typeof TIMING_BASES[number]}
  if(value.anchors!==undefined){if(result.operation!=='correct-speech')throw new TypeError('Sentence anchors require correct-speech.');result.anchors=assertSentenceAnchors(value.anchors)}
  if(result.operation==='correct-speech'&&result.anchors===undefined&&result.timingBasis!=='editorial-estimate')throw new TypeError('Sentence correction requires anchors.')
  if(['recognize-source','read-source-speech','apply-source-captions','detach-source-captions','set-caption-translations'].includes(result.operation)){
    const extra=result.operation==='recognize-source'?['segmentIndex','speechModel','speechLanguage','sourceRange']:result.operation==='apply-source-captions'?['sourceCues']:result.operation==='set-caption-translations'?['translations']:[];closed(value,['operation','draftId','expectedRevision','sceneId',...extra,...(result.operation==='read-source-speech'?['pageOffset','pageLimit']:[])]);if(!result.draftId||!result.expectedRevision||!result.sceneId)throw new TypeError('Source speech requires draft, revision and scene.')
  }
  if(value.sourceRange!==undefined){if(result.operation!=='recognize-source')throw new TypeError('sourceRange requires recognize-source.');result.sourceRange=assertSpeechSourceRange(value.sourceRange)}
  if(value.speechLanguage!==undefined){if(result.operation!=='recognize-source'||!['zh','en','auto'].includes(String(value.speechLanguage)))throw new TypeError('Unsupported source speech language.');result.speechLanguage=value.speechLanguage as 'zh'|'en'|'auto'}
  if(value.sourceCues!==undefined){if(result.operation!=='apply-source-captions')throw new TypeError('Source cues require apply-source-captions.');result.sourceCues=assertSourceCues(value.sourceCues)}
  if(result.operation==='apply-source-captions'&&!result.sourceCues)throw new TypeError('Review source cues before applying.')
  if(value.translations!==undefined){if(result.operation!=='set-caption-translations'||!Array.isArray(value.translations)||!value.translations.length||value.translations.length>100)throw new TypeError('Invalid caption translations.');const indices=new Set<number>();result.translations=value.translations.map(raw=>{const v=mediaRecord(raw);closed(v,['cueIndex','originalText','translationText']);const cueIndex=finiteNumber(v.cueIndex,'cue index',0,99,true);if(indices.has(cueIndex))throw new TypeError('Duplicate translated cue.');indices.add(cueIndex);return {cueIndex,originalText:studioText(v.originalText,'original caption',200),translationText:studioText(v.translationText,'caption translation',200)}})}
  if(result.operation==='set-caption-translations'&&!result.translations)throw new TypeError('Missing translations.')
  if(value.draft!==undefined)result.draft=value.draft
  return result
}
const sceneKeys=['narrationOptions','cardSpec','id','title','label','narration','visualBrief','sources','durationSeconds','videoArtifactId','imageArtifactId','audioArtifactId','audioText','audioGeneration','audioDurationSeconds','sourceDurationSeconds','sourceStartSeconds','zoom','playbackRate','crop','bullets','endPolicy','effects','layout','voiceVolume','voiceMuted','voiceTiming','voiceSegments','captions','keepSourceAudio','sourceVolume','captionStyle','visualSegments','focusIntervals','citations','speechCandidate','speechAnchors','speechCaptions','speechLinks','showSceneNumber','sceneTemplate','captionDisplay','sourceSpeech','sourceCaptionBinding','layers','audioTracks','presentationWindow','speechPlaybackOrigin'] as const
export function newStudioScene(id:string,title='新分镜'):StudioScene{return assertStudioScene({id,title,label:'',narration:'',visualBrief:'',sources:[],durationSeconds:8,sourceStartSeconds:0,zoom:1,playbackRate:1,bullets:[],endPolicy:'require-footage'})}
export function assertPreparation(raw:unknown,scenes:StudioScene[]):StudioPreparation{
  const legacy=raw===undefined,value=mediaRecord(raw??{});closed(value,['production','notes','outline','artifactIds','sourceIds'])
  const artifacts=value.artifactIds??[];if(!Array.isArray(artifacts)||artifacts.length>1000)throw new TypeError('At most one thousand preparation artifacts.')
  const references=scenes.flatMap(scene=>[...sceneVisuals(scene).flatMap(segment=>[segment.imageArtifactId,segment.videoArtifactId]),...(legacy?[scene.audioArtifactId]:[])].filter((id):id is string=>Boolean(id)))
  const artifactIds=[...new Set([...artifacts.map(assertArtifactId),...references])];if(artifactIds.length>1000)throw new TypeError('At most one thousand preparation artifacts.')
  const sources=value.sourceIds??[];if(!Array.isArray(sources)||sources.length>200)throw new TypeError('At most two hundred preparation sources.');const sourceIds=[...new Set(sources.map(sourceId))]
  return {...(value.production===undefined?{}:{production:assertProductionBrief(value.production)}),...(value.sourceIds===undefined?{}:{sourceIds}),notes:studioText(value.notes??'','preparation notes',20000),outline:studioText(value.outline??'','preparation outline',10000),artifactIds}
}
export function assertStudioScene(raw:unknown):StudioScene {
  const value=mediaRecord(raw);closed(value,sceneKeys)
  const compositionScene={...value}
  for(const key of ['narrationOptions','id','visualBrief','sources','citations','audioText','audioGeneration','audioDurationSeconds','sourceDurationSeconds','endPolicy','speechCandidate','speechAnchors','speechCaptions','speechLinks','sourceSpeech','sourceCaptionBinding','layers','audioTracks','speechPlaybackOrigin'])delete compositionScene[key]
  // A script is allowed to exist before a speech artifact is produced.
  const narration=studioText(value.narration??'','narration',1000)
  compositionScene.narration=''
  const sceneId=studioId(value.id)
  let scene:CompositionScene
  try{scene=assertComposition({title:'Draft',music:false,scenes:[compositionScene]}).scenes[0]}catch(error){throw new TypeError('STUDIO_SCENE '+sceneId+': '+(error instanceof Error?error.message:String(error)),{cause:error})}
  if(!Array.isArray(value.sources??[])||(value.sources as unknown[]|undefined)?.length>12)throw new TypeError('At most twelve source links per scene.')
  const sources=((value.sources??[]) as unknown[]).map(raw=>{
    const text=studioText(raw,'source URL',2048);let url:URL;try{url=new URL(text)}catch{throw new TypeError('STUDIO_SOURCE_URL '+sceneId+': sources accepts only HTTP(S) URLs; put notes in visualBrief or preparation.notes, and artifacts in preparation.artifactIds.')}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new TypeError('Sources require public HTTP(S) URLs without credentials.')
    return url.toString()
  })
  if(value.endPolicy!==undefined&&!['require-footage','hold'].includes(String(value.endPolicy)))throw new TypeError('Invalid footage end policy.')
  const result:StudioScene={...scene,id:studioId(value.id),narration,visualBrief:studioText(value.visualBrief??'','visual brief',2000),sources,endPolicy:value.endPolicy==='hold'?'hold':'require-footage'}
  if(value.layers!==undefined)result.layers=assertVisualLayers(value.layers)
  if(value.audioTracks!==undefined)result.audioTracks=assertAudioLayers(value.audioTracks)
  if(value.citations!==undefined){if(!Array.isArray(value.citations)||value.citations.length>12)throw new TypeError('At most twelve citations per scene.');result.citations=value.citations.map(assertSourceCitation)}
  if(value.audioGeneration!==undefined){
    const generation=mediaRecord(value.audioGeneration)
    closed(generation,generation.kind==='imported'?['kind','autoTiming']:['kind','options','autoTiming'])
    if(generation.kind==='imported')result.audioGeneration={kind:'imported'}
    else if(generation.kind==='tts'||generation.kind==='legacy'){
      const options=mediaRecord(generation.options)
      if(['provider','voice','ratePercent'].some(key=>!Object.hasOwn(options,key)))throw new TypeError('Incomplete audio generation parameters.')
      result.audioGeneration={kind:generation.kind,options:assertNarrationOptions(options)}
    }
    else throw new TypeError('Invalid audio generation record.')
    if(generation.autoTiming!==undefined)result.audioGeneration.autoTiming=assertNarrationTiming(generation.autoTiming)
  }
  if(value.narrationOptions!==undefined&&value.narrationOptions!==null)result.narrationOptions=assertNarrationOptions(value.narrationOptions)
  if(value.sourceSpeech!==undefined)result.sourceSpeech=assertSourceCandidate(value.sourceSpeech)
  if(value.sourceCaptionBinding!==undefined)result.sourceCaptionBinding=assertSourceCaptionBinding(value.sourceCaptionBinding)
  if(value.speechLinks!==undefined)result.speechLinks=assertStudioSpeechLinks(value.speechLinks)
  if(value.speechCandidate!==undefined)result.speechCandidate=assertStudioSpeechCandidate(value.speechCandidate)
  if(value.speechAnchors!==undefined)result.speechAnchors=assertStudioSpeechAnchors(value.speechAnchors)
  if(value.speechCaptions!==undefined){if(typeof value.speechCaptions!=='boolean')throw new TypeError('speechCaptions must be boolean.');result.speechCaptions=value.speechCaptions}
  if(value.audioText!==undefined)result.audioText=studioText(value.audioText,'audio text',1000)
  if(value.audioDurationSeconds!==undefined)result.audioDurationSeconds=finiteNumber(value.audioDurationSeconds,'audio duration',.01,180)
  if(value.sourceDurationSeconds!==undefined)result.sourceDurationSeconds=finiteNumber(value.sourceDurationSeconds,'source duration',.01,1800)
  if(value.speechPlaybackOrigin!==undefined)result.speechPlaybackOrigin=assertStudioSpeechOrigin(value.speechPlaybackOrigin,result)
  return result
}
export function assertVideoDraft(raw:unknown):VideoDraft {
  const value=mediaRecord(raw);closed(value,['cardLayout','narrationPacing','version','id','ownerSessionId','revision','title','width','height','fps','music','style','watermark','templateName','tts','scenes','preparation','updatedAt','exports','cover','coverExports','layers','audioTracks','reviewItems','referenceRecords'])
  if(value.version!==1||!Array.isArray(value.scenes)||value.scenes.length>COMPOSITION_LIMITS.scenes)throw new TypeError('A Studio draft supports zero to ninety-six scenes.')
  const scenes=value.scenes.map(assertStudioScene)
  if(new Set(scenes.map(scene=>scene.id)).size!==scenes.length)throw new TypeError('Duplicate scene identity.')
  const settings=assertComposition({title:value.title,cardLayout:value.cardLayout,narrationPacing:value.narrationPacing,width:value.width,height:value.height,fps:value.fps,music:value.music,style:value.style,watermark:value.watermark,templateName:value.templateName,scenes:scenes.length?scenes.map(scene=>({title:scene.title,durationSeconds:scene.durationSeconds})):[{title:'Preparation',durationSeconds:1}]})
  if(!Array.isArray(value.exports)||value.exports.length>30)throw new TypeError('Invalid export history.')
  const exports=value.exports.map(raw=>{const item=mediaRecord(raw);closed(item,['artifactId','revision','createdAt','durationSeconds','verificationArtifactId','fingerprint']);if(item.fingerprint!==undefined&&(typeof item.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(item.fingerprint)))throw new TypeError('Invalid export fingerprint.');return {artifactId:assertArtifactId(item.artifactId),...(item.fingerprint?{fingerprint:String(item.fingerprint)}:{}),...(item.verificationArtifactId?{verificationArtifactId:assertArtifactId(item.verificationArtifactId)}:{}),revision:finiteNumber(item.revision,'export revision',1,1_000_000,true),createdAt:studioText(item.createdAt,'export date',40),durationSeconds:finiteNumber(item.durationSeconds,'export duration',1,COMPOSITION_LIMITS.seconds+1)}})
  const coverExports=value.coverExports??[]
  if(!Array.isArray(coverExports)||coverExports.length>30)throw new TypeError('Invalid cover export history.')
  const covers:CoverExport[]=coverExports.map(raw=>{const item=mediaRecord(raw);closed(item,['artifactId','width','height','revision','createdAt','options','actualTimestampSeconds']);const width=finiteNumber(item.width,'cover width',320,1920,true),height=finiteNumber(item.height,'cover height',180,1920,true)
    const receipt=assertCoverReceipt({...item,type:'screenshot',contentType:'image/png'},width,height)
    return {...receipt,revision:finiteNumber(item.revision,'cover revision',1,1_000_000,true),createdAt:studioText(item.createdAt,'cover date',40),options:assertCoverOptions(item.options),...(item.actualTimestampSeconds===undefined?{}:{actualTimestampSeconds:finiteNumber(item.actualTimestampSeconds,'actual cover timestamp',0,1800)})}
  })
  const result:VideoDraft={...(value.referenceRecords===undefined?{}:{referenceRecords:assertReferenceRecords(value.referenceRecords)}),...(value.reviewItems===undefined?{}:{reviewItems:assertStudioReviewItems(value.reviewItems)}),version:1,id:studioId(value.id),...(value.ownerSessionId===undefined?{}:{ownerSessionId:studioId(value.ownerSessionId)}),revision:finiteNumber(value.revision,'revision',1,1_000_000,true),title:settings.title,...(settings.cardLayout===undefined?{}:{cardLayout:settings.cardLayout}),...(settings.narrationPacing===undefined?{}:{narrationPacing:settings.narrationPacing}),width:settings.width,height:settings.height,fps:settings.fps,music:settings.music,tts:assertNarrationOptions(value.tts??{}),style:settings.style,watermark:settings.watermark,...(settings.templateName?{templateName:settings.templateName}:{}),...(value.layers===undefined?{}:{layers:assertVisualLayers(value.layers)}),...(value.audioTracks===undefined?{}:{audioTracks:assertAudioLayers(value.audioTracks)}),scenes,preparation:assertPreparation(value.preparation,scenes),cover:assertCoverOptions(value.cover??{title:settings.title.replace(/[\r\n]+/g," ")}),coverExports:covers,updatedAt:studioText(value.updatedAt,'update date',40),exports}
  assertLayerIdentities(result);return result
}
export function sameNarrationOptions(a:NarrationOptions,b:NarrationOptions):boolean {
  return a.provider===b.provider&&a.voice===b.voice&&a.ratePercent===b.ratePercent
}
export function audioGenerationLabel(scene:StudioScene):string {
  const generation=scene.audioGeneration
  if(!scene.audioArtifactId)return '尚未生成'
  if(!generation||generation.kind==='legacy')return '参数未记录'
  if(generation.kind==='imported')return '导入/手动绑定音频'
  const labels:Record<string,string>={'zh-CN-YunxiNeural':'Edge 男声·云希','zh-CN-XiaoxiaoNeural':'Edge 女声·晓晓','local-zh-en':'本地中文/英文','wenhuaizhi_v3.1':'Qwen 女声·闻怀之','xuyanchu_v3.1':'Qwen 女声·许言初','xuyuyuan_v3.1':'Qwen 女声·许玉远','anmingyuan_v3.1':'Qwen 男声·安明远','huozhuoshi_v3.1':'Qwen 男声·霍拙石','longanlang_v3.1':'Qwen 男声·龙安朗','longsanshu_v3.1':'Qwen 男声·龙三叔'}
  return `${labels[generation.options.voice]} · ${generation.options.ratePercent}%语速`
}
export function sceneCoverage(scene:StudioScene,tts?:NarrationOptions):{required:number;available:number;gap:number;measured:boolean;audioStale:boolean} {
  const visuals=sceneVisuals(scene),availability=visuals.map(segment=>segment.imageArtifactId?segment.durationSeconds:Math.max(0,(segment.sourceDurationSeconds??0)-segment.sourceStartSeconds)/segment.playbackRate)
  const measured=visuals.every(segment=>!segment.videoArtifactId||segment.sourceDurationSeconds!==undefined)
  const available=scene.visualSegments?availability.reduce((sum,seconds,index)=>sum+Math.min(seconds,visuals[index].durationSeconds),0):(availability[0]??0)
  return {required:scene.durationSeconds,available,measured,gap:measured?Math.max(0,scene.durationSeconds-available):0,audioStale:Boolean((scene.narration||scene.audioText)&&(!scene.audioArtifactId||scene.audioText!==scene.narration))||Boolean(scene.audioArtifactId&&(scene.narrationOptions??tts)&&scene.audioGeneration&&scene.audioGeneration.kind!=='imported'&&!sameNarrationOptions(scene.audioGeneration.options,scene.narrationOptions??tts))}
}
export interface StudioIssue {
  code:'news-preparation'|'timing-advisory'|'card-incomplete'|'card-source-stale'|'layer-range'|'source-captions-stale'|'duration-unmeasured'|'speech-anchors'|'empty-draft'|'narration-stale'|'audio-duration'|'footage-gap'|'source-range'|'missing-visual'|'held-frame'|'asset-unavailable'|'asset-budget'|'encoding-unavailable'
  severity:'error'|'warning'; segmentIndex?:number; message:string; sceneId?:string; artifactId?:string
}
export interface StudioReadiness {
  draftId:string; revision:number; ready:boolean; durationSeconds:number; pendingNarrationSceneIds:string[]
  scenes:{sceneId:string;startSeconds:number;endSeconds:number;availableSeconds:number;gapSeconds:number;measured:boolean}[]
  issues:StudioIssue[]
}
/** Shared GUI/model checklist; measured checks augment this without editing the draft. */
export function draftReadiness(draft:VideoDraft):StudioReadiness {
  const issues:StudioIssue[]=[],pendingNarrationSceneIds:string[]=[],scenes:StudioReadiness['scenes']=[]
  if(!draft.scenes.length)issues.push({code:'empty-draft',severity:'error',message:'请在「脚本与旁白」中创建分镜，再匹配画面和导出。'})
  let startSeconds=0
  for(const scene of draft.scenes){
    const coverage=sceneCoverage(scene,draft.tts)
    const issue=(code:StudioIssue['code'],message:string,severity:StudioIssue['severity']='error')=>issues.push({code,severity,sceneId:scene.id,message:`${scene.title}：${message}`})
    if(scene.cardSpec?.version===2)try{assertDetailedReady(scene.cardSpec)}catch(error){issue('card-incomplete',error instanceof Error?error.message:String(error))}
    if(scene.cardSpec?.templateId==='metric/backdrop'&&scene.cardSpec.phase==='to-evidence'&&scene.cardSpec.holdSeconds+1.6>(scene.presentationWindow?.durationSeconds??scene.durationSeconds))issue('card-incomplete','请为数字退場后保留至少一秒依据阅读')
    if(sourceCaptionsStale(scene))issue('source-captions-stale','原声字幕的素材或剪裁/速度已改变，请重新应用或解除关联')
    if(usesStudioSpeech(scene)){try{speechScene(scene)}catch(error){issue('speech-anchors',error instanceof Error?error.message:String(error))}}
    if(scene.narration.trim()&&coverage.audioStale)pendingNarrationSceneIds.push(scene.id)
    if(coverage.audioStale)issue('narration-stale','旁白尚未生成、脚本已改动或音色/语速已变更')
    if(scene.audioArtifactId){if(scene.audioDurationSeconds===undefined)issue('duration-unmeasured','旁白时长待测量，请检查制作条件','warning');else{try{narrationWindows(scene,scene.audioDurationSeconds)}catch(error){issue('audio-duration',error instanceof Error?error.message:String(error))}}}
    for(const [segmentIndex,segment] of sceneVisuals(scene).entries()){
      if(!segment.videoArtifactId)continue
      if(segment.sourceDurationSeconds===undefined){issue('duration-unmeasured','视频时长待测量，请检查制作条件','warning');continue}
      const gap=Math.max(0,segment.durationSeconds-Math.max(0,(segment.sourceDurationSeconds??0)-segment.sourceStartSeconds)/segment.playbackRate),prefix=scene.visualSegments?`片段 ${segmentIndex+1}：`:''
      if(segment.sourceStartSeconds>=(segment.sourceDurationSeconds??0))issue('source-range',prefix+'素材起点必须早于视频结束；请调整起点或更换素材')
      else if(gap>.05){if(scene.endPolicy==='hold')issue('held-frame',prefix+`已选择末帧定格 ${gap.toFixed(1)} 秒`,'warning');else issue('footage-gap',prefix+`需补录 ${gap.toFixed(1)} 秒或明确选择定格`)}
    }
    const painted=(layer:NonNullable<VideoDraft['layers']>[number])=>!layer.hidden&&(layer.opacity>0||layer.keyframes?.some(frame=>frame.opacity>0))&&(layer.kind!=='text'||Boolean(layer.text?.trim()))
    const sceneEnd=startSeconds+scene.durationSeconds,hasLayer=scene.layers?.some(layer=>painted(layer)&&layer.startSeconds<scene.durationSeconds&&layer.startSeconds+layer.durationSeconds>0)||draft.layers?.some(layer=>painted(layer)&&layer.startSeconds<sceneEnd&&layer.startSeconds+layer.durationSeconds>startSeconds)
    if(!sceneVisuals(scene).length&&!scene.bullets.length&&!scene.cardSpec&&!hasLayer)issue('missing-visual','需要画面素材、可见独立图层或标题卡内容')
    const endSeconds=startSeconds+scene.durationSeconds
    scenes.push({sceneId:scene.id,startSeconds,endSeconds,availableSeconds:coverage.available,gapSeconds:coverage.gap,measured:coverage.measured});startSeconds=endSeconds
  }
  for(const message of layerProblems(draft,startSeconds))issues.push({code:'layer-range',severity:'error',message})
  for(const scene of draft.scenes)for(const message of layerProblems(scene,scene.durationSeconds))issues.push({code:'layer-range',severity:'error',sceneId:scene.id,message})
  return {draftId:draft.id,revision:draft.revision,ready:!issues.some(issue=>issue.severity==='error'),durationSeconds:startSeconds,pendingNarrationSceneIds,scenes,issues}
}
export function narrationSceneDuration(scene:StudioScene,audioSeconds:number,fps:number,tailFrames=0):number {
  // Independent edited captions must survive a shorter regenerated recording.
  const voice=scene.voiceTiming||scene.voiceSegments?Math.max(0,...narrationWindows({...scene,durationSeconds:60},audioSeconds).map(t=>t.startSeconds+t.durationSeconds)):audioSeconds+1
  if(scene.voiceTiming||scene.voiceSegments)narrationWindows({...scene,durationSeconds:60},audioSeconds)
  const window=scene.presentationWindow
  const card=scene.cardSpec?.version===2?scene.cardSpec:undefined
  const originalEnds=[...(card&&'highlights' in card?card.highlights??[]:[]).map(highlight=>highlight.endSeconds),...(card?.templateId==='metric/backdrop'&&card.phase==='to-evidence'?[card.holdSeconds+1.6]:[])]
  // Card clocks belong to the original presentation; split pieces retain their window.
  const cardEnds=window?originalEnds.map(end=>Math.max(0,Math.min(end,window.startSeconds+scene.durationSeconds)-window.startSeconds)):originalEnds
  return Math.ceil(Math.max(1,voice+tailFrames/fps,...cardEnds,...(scene.captions??[]).map(cue=>cue.endSeconds),...(scene.layers??[]).map(v=>v.startSeconds+v.durationSeconds),...(scene.audioTracks??[]).map(v=>v.startSeconds+v.durationSeconds))*fps-1e-7)/fps
}
/** Only a matching host snapshot is automatic. Any changed window or segment is a manual cut. */
export function applyNarrationPacing(scene:StudioScene,audioSeconds:number,fps:number,pacing:VideoOptions['narrationPacing']):NarrationTiming|undefined {
 finiteNumber(fps,'fps',12,30,true);finiteNumber(audioSeconds,'audio duration',.01,180)
 const previous=scene.audioGeneration?.autoTiming,automatic=Boolean(previous&&scene.voiceTiming&&(['startSeconds','sourceStartSeconds','durationSeconds','playbackRate'] as const).every(key=>scene.voiceTiming![key]===previous[key]))
 if(scene.voiceSegments!==undefined||scene.voiceTiming&&!automatic){scene.durationSeconds=Math.max(scene.durationSeconds,narrationSceneDuration(scene,audioSeconds,fps));return undefined}
 if(pacing==='compact'){
  if(audioSeconds<.1)throw new Error('STUDIO_NARRATION_PACING: 紧凑旁白至少需要 0.1 秒音频，请选择标准节奏。')
  const timing=assertNarrationTiming({startSeconds:2/fps,sourceStartSeconds:0,durationSeconds:audioSeconds,playbackRate:1})
  scene.voiceTiming=timing;delete scene.voiceSegments
  scene.durationSeconds=narrationSceneDuration(scene,audioSeconds,fps,2)
  return {...timing}
 }
 delete scene.voiceTiming;delete scene.voiceSegments
 scene.durationSeconds=narrationSceneDuration(scene,audioSeconds,fps)
 return undefined
}
export function draftProblems(draft:VideoDraft):string[] {
  return draftReadiness(draft).issues.filter(issue=>issue.severity==='error').map(issue=>issue.message)
}
export function draftComposition(draft:VideoDraft):MediaComposition {
  const issues=draftProblems(draft);if(issues.length)throw new Error(issues.join('\n'))
  const scenes=draft.scenes.map(scene=>{const value={...speechScene(scene)} as unknown as Record<string,unknown>;for(const key of ['narrationOptions','id','visualBrief','sources','citations','audioText','audioGeneration','audioDurationSeconds','sourceDurationSeconds','endPolicy','speechCandidate','speechAnchors','speechCaptions','speechLinks','sourceSpeech','sourceCaptionBinding','speechPlaybackOrigin'])delete value[key];return value})
  return assertComposition({title:draft.title,cardLayout:draft.cardLayout,narrationPacing:draft.narrationPacing,width:draft.width,height:draft.height,fps:draft.fps,music:draft.music,tts:draft.tts,style:draft.style,watermark:draft.watermark,templateName:draft.templateName,layers:draft.layers,audioTracks:draft.audioTracks,scenes})
}
