import {requirePreparedNewsStudio} from './src/news-service.js'
import {newsPreparationRequestSchema} from './src/news-preparation-contract.js'
import {newsCandidateSchema,NEWS_MAX_TOPICS} from './src/news-contract.js'
import {requireNewsSelection} from './src/news-service.js'
import {productionAssessmentSchema} from './src/production-assessment-contract.js'
import {gridRecipeSchema} from '@bmw-agent/media-native/precomposition'
import {PRODUCTION_TYPES} from './src/production-contract.js'
import {COMPOSITION_LIMITS} from '../media-native/src/composition-contract.js'
import {analysisRequestSchema} from './src/source-analysis-contract.js'
import {TIMING_BASES} from './src/studio-speech-provenance.js'
import {exportReviewVerdictSchema,exportReviewBatchSchema} from './src/export-review-contract.js'
import {studioAgentResult} from './src/studio-agent-result.js'
import {assertStudioRequest} from './src/studio-contract.js'
import {assetQuerySchema,assertAssetQuery,SCENE_SECTIONS} from './src/studio-read-contract.js'
import {studioToolDescription} from './src/studio-tool-guide.js'
import {studioHelp} from './src/studio-discovery.js'
import {videoReviewAction} from './src/video-review.js'
import {cardSpeechChoicesSchema} from './src/studio-card-speech.js'
import {editedRecordingPlanSchema} from './src/studio-recording-plan.js'
import {sourceNarrationRecipeSchema} from './src/source-narration-recipe.js'
import {materialIndexRequestSchema} from './src/material-index-contract.js'
import {speechSourceRangeSchema} from '../media-native/src/speech-range.js'
import {cardSceneConditionalSchemas} from '@bmw-agent/media-native/cards'
import {videoEditSchema} from './src/video-edit.js'
import {referenceAnalysisSchema,referenceAnalysesSchema} from './src/studio-reference-contract.js'
import {studioReviewProposalSchema} from './src/studio-review.js'
import {visualLayersSchema,audioLayersSchema} from '../media-native/src/composition-layers.js'
import {VideoStudioStore,STUDIO_EXPORT_RENDERER_VERSION} from './src/studio-store.js'
import {captureWorkExport,WorkExportStore} from '@bmw-agent/feature-library/exports'
import type {CapturedExport} from '@bmw-agent/feature-library/exports'
import crypto from 'node:crypto'
import {sentenceAnchorsSchema} from './src/studio-speech-contract.js'
import {sourceRequestSchema} from '@bmw-agent/media-native/sources'
import {focusIntervalsSchema} from '../media-native/src/focus-contract.js'
import {coverOptionsSchema} from '@bmw-agent/media-native/cover'
import {visualSegmentsSchema} from '../media-native/src/visual-segments.js'
import {assertMediaArtifactReceipt} from '@bmw-agent/media-native/port'
import type {FeatureModule} from '@bmw-agent/platform'
import { resolvedComposition, resolvedNarration, requireNarrationEnabled, videoSettingsAction } from './src/video-settings.js'
import { videoOptionProperties, videoOptionsSchema } from '../media-native/src/video-options.js'
import {CARD_TEMPLATES} from '../media-native/src/card-templates.js'
import {sourceAudioProperties} from '../media-native/src/composition-contract.js'
import { studioDraftSchema } from './src/studio-schema.js'
import { studioService } from './src/studio-service.js'
import {narrationOptionsSchema} from '../media-native/src/narration-contract.js'
import type { BrowserActionDefinition } from '../browser-capability/src/browser-schema.js'

const compose: BrowserActionDefinition = {
  action: 'video.compose',
  description: 'Compose a narrated product/webpage introduction from current Project artifacts. Landscape/portrait/square MP4 with H.264/AAC; output params resolve explicit overrides > named template > Settings defaults, 1 to 96 scenes, maximum 720 seconds. Each scene has durationSeconds (1..60), title (44 chars), label, optional videoArtifactId/imageArtifactId/audioArtifactId, sourceStartSeconds, zoom for footage (1..1.5; title cards do not zoom), playbackRate (.25..2, retimes footage and any retained original audio), optional normalized crop {x,y,width,height} inside source (minimum .2 dimensions), narration and up to 3 bullets. Title cards may use bulletRevealSeconds (one local scene time per bullet); zero reveals immediately, later times reveal without shifting layout; footage cannot use title-card reveal. Narration requires a real audio artifact and must fit without truncation. voiceTiming describes one explicit playback interval; voiceSegments alternatively stores 0..8 ordered nonoverlapping pieces (an explicit empty array plays no narration and preserves the original audio) with stable id/startSeconds/sourceStartSeconds/durationSeconds/playbackRate, all referring to the same measured original audio. Never combine them. Footage audio defaults muted. keepSourceAudio=true retains and retimes its original audio, sourceVolume (0..2) controls its mix; sound ends at the source endpoint while the last footage frame may be held. Add title, animated framing, estimated sentence captions and optional original synthesized music. A scene may use a Project PNG/JPEG/WebP image instead of video. Optional captionStyle {fontSize:12..64,color:#RRGGBB,background:none/outline/box,position:top/center/bottom,align:left/center/right,offsetPercent:-30..30} edits subtitles independently of narration. Optional layout presentation/fullscreen, voiceVolume (0..2), and explicit captions [{startSeconds,endSeconds,text}] allow visual editing; captions are local scene times, ordered and nonoverlapping. No arbitrary HTML, scripts, URLs or paths. Completed compositions in an authenticated BMW Session automatically register a new editable Video Studio draft and the existing MP4, returning studioDraft {id,revision,title,sceneCount}; existing drafts are never overwritten. Direct bulletRevealSeconds cannot be losslessly represented as Studio speech anchors: these outputs remain standalone and return studioWarning. Prefer video.studio create/update/render for iterative editing and speech anchors. Read the returned Studio draft before changing it. Use media.inspect and media.frames.sample to review.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['composition'], properties: { composition: { type: 'object', properties: { ...videoOptionProperties, templateName:{type:'string',maxLength:40}, layers:visualLayersSchema,audioTracks:audioLayersSchema,title: {type:'string'}, width:{type:'integer'},height:{type:'integer'},fps:{type:'integer'},music:{type:'boolean'},scenes:{type:'array',minItems:1,maxItems:COMPOSITION_LIMITS.scenes,items:{type:'object',allOf:cardSceneConditionalSchemas,properties:{layers:visualLayersSchema,audioTracks:audioLayersSchema,bulletRevealSeconds:{type:'array',maxItems:3,items:{type:'number',minimum:0,maximum:60}},focusIntervals:focusIntervalsSchema,visualSegments:visualSegmentsSchema,...sourceAudioProperties,durationSeconds:{type:'number'},title:{type:'string'},label:{type:'string'},narration:{type:'string'},videoArtifactId:{type:'string'},imageArtifactId:{type:'string'},layout:{type:'string',enum:['presentation','fullscreen']},voiceVolume:{type:'number',minimum:0,maximum:2},captions:{type:'array',maxItems:100,items:{type:'object',properties:{startSeconds:{type:'number'},endSeconds:{type:'number'},text:{type:'string',maxLength:200},translationText:{type:'string',maxLength:200},translationOrigin:{enum:['user-edited','agent-edited']}},required:['startSeconds','endSeconds','text'],additionalProperties:false}},audioArtifactId:{type:'string'},sourceStartSeconds:{type:'number'},zoom:{type:'number'},playbackRate:{type:'number',minimum:.25,maximum:2},crop:{type:'object',properties:{x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'}},required:['x','y','width','height'],additionalProperties:false},bullets:{type:'array',items:{type:'string'}}},required:['durationSeconds','title'],additionalProperties:false}} }, required:['title','scenes'],additionalProperties:false } } },
  async execute(context, input) {
    if (Object.keys(input).some(key => !['action','composition'].includes(key))) throw new TypeError('Unsupported video.compose property.')
    const { browserKernel, signal } = context
    requireNewsSelection(browserKernel,context.sessionOwner,context.actor)
    requirePreparedNewsStudio(browserKernel,context.sessionOwner)
    if (!browserKernel.projectStore.active()?.directory) throw new Error('Video production requires an active BMW Project.')
    const project=browserKernel.projectStore.active(),owner=context.sessionOwner
    if(owner&&(owner.projectId!==project.id||!owner.sessionId))throw new Error('STUDIO_SESSION_REQUIRED: Composition requires its current Project Session.')
    const composition=resolvedComposition(input.composition,browserKernel.settingsStore?.snapshot().videoPreferences)
    let capture:CapturedExport|undefined,libraryWarning:string|undefined
    try{capture=await captureWorkExport(browserKernel,composition,signal,STUDIO_EXPORT_RENDERER_VERSION)}catch(error){signal?.throwIfAborted();libraryWarning='素材采用快照未记录：'+String(error)}
    signal?.throwIfAborted()
    const result=assertMediaArtifactReceipt(await browserKernel.recordingController.compose(composition,signal),'composition')
    signal?.throwIfAborted()
    if(browserKernel.projectStore.active().id!==project.id||browserKernel.projectStore.active().directory!==project.directory)throw new Error('Composition Project changed before draft registration.')
    const standalone=!owner||composition.scenes.some(scene=>scene.bulletRevealSeconds!==undefined),draftId=standalone?undefined:crypto.randomUUID()
    let prepared:ReturnType<WorkExportStore['prepare']>|undefined
    if(capture)try{prepared=new WorkExportStore(project.directory,project.id).prepare(await capture.record(result,owner?{sessionId:owner.sessionId,...(draftId?{draftId,revision:1}:{})}:undefined))}catch(error){signal?.throwIfAborted();libraryWarning='成品采用账本未完成：'+String(error)}
    try{
    signal?.throwIfAborted();if(browserKernel.projectStore.active().id!==project.id)throw new Error('Composition Project changed during export admission.')
    if(standalone){if(prepared)try{prepared.commit()}catch(error){libraryWarning='成品采用账本提交待核对：'+String(error)}return {...result,...(libraryWarning?{libraryWarning}:{}),...(owner?{studioWarning:'此成片使用直接板书揭示时标，尚不能无损转换为 Studio 语音锚点草稿。请用 video.studio 创建可编辑版本；原成片保留。'}:{})}}
    const draft=new VideoStudioStore(project.directory,owner!.sessionId).addComposition(composition,result,draftId)
    if(prepared)try{prepared.commit()}catch(error){libraryWarning='成品已保存，采用账本提交待核对：'+String(error)}
    browserKernel.videoStudioChanged?.(owner)
    return {...result,studioDraft:{id:draft.id,revision:draft.revision,title:draft.title,sceneCount:draft.scenes.length},...(libraryWarning?{libraryWarning}:{})}
    }catch(error){prepared?.discard();throw error}
  }
}
const narrate: BrowserActionDefinition = {
  action: 'video.narrate', description: 'Generate real Chinese narration with Settings defaults or a named video template. narrationRequest {text (1..1000), optional templateName, provider, voice, ratePercent}. Priority: explicit TTS fields > named template tts > video defaults. Default Edge male: edge-readaloud / zh-CN-YunxiNeural / 0%. Qwen: qwen-tts / wenhuaizhi_v3.1 (recommended news voice), also xuyanchu_v3.1 or xuyuyuan_v3.1 (female), or anmingyuan_v3.1 (clear, natural male narrator), huozhuoshi_v3.1 (clear male), longanlang_v3.1 (crisp male), longsanshu_v3.1 (steady male), fixed qwen-audio-3.1-tts-flash model, Beijing endpoint, 60s deadline, Project WAV. Requires separate Qwen online narration setting and securely saved credentials in BMW Settings; model cannot read or supply credentials. Other choices Edge female zh-CN-XiaoxiaoNeural, or local-matcha/local-zh-en. Rate -20..30%. Edge online narration is enabled by repository default, can be disabled in Video narration Settings, sends text to the fixed Microsoft speech.platform.bing.com endpoint and returns Project MP3. Local Matcha uses pinned Sherpa-ONNX WASM and Project WAV, blocks all network, requires setup:local-tts. Edge deadline 60s, local 180s. Failures return errors; no silent fallback or silent audio. No credentials, arbitrary endpoints, or host paths. video.compose only mixes existing real audioArtifactIds; tts metadata never changes an already generated recording.',
  inputSchema: {type:'object',additionalProperties:false,required:['narrationRequest'],properties:{narrationRequest:{type:'object',additionalProperties:false,required:['text'],properties:{...narrationOptionsSchema.properties,text:{type:'string',maxLength:1000},templateName:{type:'string',maxLength:40}}}}},
  async execute(context, input) {
    if (Object.keys(input).some(key => !['action','narrationRequest'].includes(key))) throw new TypeError('Unsupported video.narrate property.')
    const { browserKernel, signal } = context
    requireNewsSelection(browserKernel,context.sessionOwner,context.actor)
    requirePreparedNewsStudio(browserKernel,context.sessionOwner)
    if (!browserKernel.projectStore.active()?.directory) throw new Error('Narration requires an active BMW Project.')
    const request = resolvedNarration(input.narrationRequest,browserKernel.settingsStore?.snapshot().videoPreferences)
    requireNarrationEnabled(request,browserKernel.settingsStore)
    return assertMediaArtifactReceipt(await browserKernel.recordingController.narrate(request, signal))
  }
}

const studio:BrowserActionDefinition={
  action:'video.studio',
  description:studioToolDescription,
  help:query=>studioHelp(studio.inputSchema.properties.studioRequest,query),
  inputSchema:{type:'object',additionalProperties:false,required:['studioRequest'],properties:{studioRequest:{type:'object',additionalProperties:false,required:['operation'],properties:{preparationRequest:newsPreparationRequestSchema,closeNewsTask:{type:'boolean'},newsCandidates:{type:'array',maxItems:NEWS_MAX_TOPICS,items:newsCandidateSchema},expectedTopicRevision:{type:'integer',minimum:0,maximum:1000000},topicId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},assessment:productionAssessmentSchema,expectedAssessmentRevision:{type:'integer',minimum:0,maximum:1000000},gridRecipe:gridRecipeSchema,productionType:{enum:PRODUCTION_TYPES},recipeId:{type:'string',pattern:'^[a-z-]{1,80}$'},baseFingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},productionSection:{enum:['brief','sections','works','relations','claims','goals','assetVersions']},timingSection:{enum:['overview','sentences','issues']},timingBasis:{enum:TIMING_BASES},exportReview:exportReviewVerdictSchema,exportReviewBatch:exportReviewBatchSchema,assetQuery:assetQuerySchema,pageOffset:{type:'integer',minimum:0,maximum:1000000},pageLimit:{type:'integer',minimum:1,maximum:20},section:{enum:SCENE_SECTIONS},briefSection:{enum:['notes','outline','artifacts','sources']},sourceSection:{enum:['text','candidates','media']},editOperation:{type:'string',pattern:'^[a-z]+\\.[a-z]+$'},editOperations:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:{type:'string',pattern:'^[a-z]+\\.[a-z]+$'},description:'Describe-edit only: batch exact command schemas; choose this or editOperation.'},cardLinks:cardSpeechChoicesSchema,recordingPlan:editedRecordingPlanSchema,recordingSourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},recordingEventsSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},sourceNarrationRecipe:sourceNarrationRecipeSchema,analysisRequest:analysisRequestSchema,materialRequest:materialIndexRequestSchema,edit:videoEditSchema,referenceId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},referenceAnalysis:referenceAnalysisSchema,referenceAnalyses:referenceAnalysesSchema,timestampsSeconds:{type:'array',minItems:1,maxItems:8,items:{type:'number',minimum:0,maximum:1800}},beforeNotes:{type:'string',maxLength:20000},reviewProposal:studioReviewProposalSchema,reviewId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},sourceRange:speechSourceRangeSchema,speechLanguage:{type:'string',enum:['zh','en','auto']},sourceCues:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,required:['startSeconds','endSeconds','text'],properties:{startSeconds:{type:'number'},endSeconds:{type:'number'},text:{type:'string',maxLength:200}}}},translations:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,required:['cueIndex','originalText','translationText'],properties:{cueIndex:{type:'integer',minimum:0,maximum:99},originalText:{type:'string',maxLength:200},translationText:{type:'string',maxLength:200}}}},speechModel:{type:'string',enum:['base','small']},anchors:sentenceAnchorsSchema,sourceRequest:sourceRequestSchema,reviewOffset:{type:'integer',minimum:0,maximum:16,description:'Review-export only: sample page offset, eight actual MP4 PNGs per request.'},forceRender:{type:'boolean',description:'Render only: explicitly remake even if an unchanged completed MP4 is available.'},snapshotProof:{type:'string',pattern:'^[a-f0-9]{64}$',description:'Restore only: approval returned by this host for the exact owned draft content; cannot approve new edits.'},splitSeconds:{type:'number',minimum:1,maximum:59,description:'Split-scene only: local scene cut, preserving at least one second on each side.'},cardTemplateId:{enum:CARD_TEMPLATES.map(item=>item.id)},operation:{type:'string',enum:['news-preparation','news-topics','propose-news-topics','select-news-topic','news-guide','record-production-review','precomposition-status','precompose','production-profiles','propose-type','adopt-type','production-read','production-review','plan-impact','analysis','diagnose-timing','review-status','record-export-review','read-scene','read-preparation','describe-edit','guide','estimate-speech','suggest-recording-plan','apply-recording-plan','narrate-local','apply-source-narration','validate-source-narration','materials','describe-template','describe-schema','read-document','compatibility','validate-edit','apply-edit','migrate-document','remove-reference','prepare-reference','read-reference','set-reference-analyses','set-reference-analysis','apply-reference-notes','propose-review','adopt-review','dismiss-review','undo-review','split-scene','restore','recognize-source','read-source-speech','apply-source-captions','detach-source-captions','set-caption-translations','align-speech','read-speech','correct-speech','source','export-citations','list','create','read','delete','update','narrate','narrate-pending','check','export-captions','export-cover','read-material','suggest-focus','review-export','render','assets','inspect','attach','open','context','configure','save-template']},cover:coverOptionsSchema,captionFormat:{type:'string',enum:['srt','vtt']},segmentIndex:{type:'integer',minimum:0,maximum:7},templateName:{type:'string',maxLength:40},options:videoOptionsSchema,draftId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},expectedRevision:{type:'integer',minimum:1},title:{type:'string',maxLength:80},sceneId:{type:'string'},artifactId:{type:'string'},assetKind:{type:'string',enum:['video','audio','image']},...narrationOptionsSchema.properties,draft:studioDraftSchema}}}},
  async execute(context,input){
    if(Object.keys(input).some(key=>!['action','studioRequest'].includes(key)))throw new TypeError('Unsupported video.studio property.')
    const {browserKernel,signal,sessionOwner,actor}=context
    const parsed=assertStudioRequest(input.studioRequest),request=actor!=='user'&&parsed.operation==='assets'&&!parsed.assetQuery?{...parsed,assetQuery:assertAssetQuery({})}:parsed
    const result=await studioService(browserKernel).execute(request,signal,sessionOwner,actor)
    return actor==='user'?result:studioAgentResult(request,result)
  }
}

function reviewScopedAction(definition:BrowserActionDefinition):BrowserActionDefinition {
 return {...definition,async execute(context,input){
  if(context.actor!=='user'&&context.sessionOwner&&context.browserKernel.videoReviewRun?.(context.sessionOwner)&&!['video.studio','video.review'].includes(definition.action))throw new Error('VIDEO_AUDIT_READ_ONLY: 内部审片不能合成、生成旁白或修改视频设置。')
  return definition.execute(context,input)
 }}
}
export const videoFeature = Object.freeze({ id:'feature-video',workspace:'studio',panels:['video-studio'],browserActions:Object.freeze([compose,narrate,studio,videoReviewAction,videoSettingsAction].map(reviewScopedAction)),actionNamespace:'video.',browserDescription:compose.description+' '+narrate.description+' '+studio.description+' '+videoReviewAction.description+' '+videoSettingsAction.description,main:Object.freeze({async activate(){const {VideoStudioRuntime}=await import('./src/studio-runtime.js');return new VideoStudioRuntime()}}) } satisfies FeatureModule)
