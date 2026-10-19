import {NewsService,requireNewsSelection,newsResearchPending} from './news-service.js'
import {ProductionAssessmentJournal,productionAssessmentSnapshot,makeProductionAssessment,acceptedProductionAssessment} from './production-assessment.js'
import {productionProfiles,productionRecipes,productionProposal,productionReview} from './production-types.js'
import {productionFacts,productionImpact,productionArtifactIds,productionHash} from './production-impact.js'
import {VIDEO_DOCUMENT_VERSION,VIDEO_DOCUMENT_VERSIONS} from './video-document-version.js'
import {COMPOSITION_LIMITS} from '../../media-native/src/composition-contract.js'
import {SourceAnalysisService} from './source-analysis-service.js'
import {diagnoseStudioTiming} from './studio-timing.js'
import {sceneTimingDiagnostics} from './studio-timing-diagnostics.js'
import {exportReviewState} from './studio-export-review-state.js'
import {suggestRecordingPlan} from '@bmw-agent/media-native/recording-plan'
import {recordingPlanDraft} from './studio-recording-plan.js'
import {cardImageAssets,cardSourcePins} from '../../media-native/src/card-details.js'
import {studioToolGuide} from './studio-tool-guide.js'
import {studioAssetPage} from './studio-asset-page.js'
import {studioSceneProjection} from './studio-agent-result.js'
import {studioPage} from './studio-read-contract.js'
import {CARD_TEMPLATES,cardTemplate,cardSpecSchema,cardContentContract,cardSceneConstraints} from '../../media-native/src/card-templates.js'
import {videoDocumentSchema,videoDocumentFromDraft} from './video-document.js'
import {applyVideoEdit,videoEditSchema} from './video-edit.js'
import {studioCompatibility,requireSimpleVideoEdit,requireSimpleVideo} from './studio-compatibility.js'
import {MaterialIndexService} from './material-index-service.js'
import {assertMaterialIndexRequest} from './material-index-contract.js'
import {sourceNarrationDraft} from './source-narration-recipe.js'
import {reviewStudioExport} from './studio-export-review.js'
import {referenceOperation} from './studio-reference.js'
import crypto from 'node:crypto'
import {studioReviewApplicable,applyStudioReview} from './studio-review.js'
import type {StudioReviewItem} from './studio-review.js'
import {StudioSnapshotProof} from './studio-snapshot-proof.js'
import {layerAssets} from '../../media-native/src/composition-layers.js'
import type {LayerContainer} from '../../media-native/src/composition-layers.js'
import {sourceSpeechOperation} from './studio-source-speech.js'
import {studioSpeechOperation,verifyStudioSpeech} from './studio-speech.js'
import {speechScene,usesSpeechCaptions,usesStudioSpeech} from './studio-speech-contract.js'
import {StudioSources} from './studio-sources.js'
import fs from 'node:fs/promises'
import {assertRecordingEvents,suggestRecordingFocus,RECORDING_EVENT_BYTES} from '@bmw-agent/media-native/recording'
import {assertCoverOptions,assertCoverRenderRequest,assertCoverReceipt} from '@bmw-agent/media-native/cover'
import type {VisualSegment} from '@bmw-agent/media-native/visuals'
import {sceneVisuals,fitVisualSegments} from '@bmw-agent/media-native/visuals'
import {assertImageInspection,DECODE_BUDGET} from '@bmw-agent/media-native/image'
import {assertEncodingInspection} from '@bmw-agent/media-native/contract'
import {captionDocument} from '@bmw-agent/media-native/captions'
import {exportProjectText} from '@bmw-agent/media-native/text-export'
import {assertMediaArtifactReceipt,assertMediaInspection} from '@bmw-agent/media-native/port'
import {assertNarrationOptions} from '../../media-native/src/narration-contract.js'
import {requireNarrationEnabled} from './video-settings.js'
import { normalizeVideoPreferences, resolveVideoOutput, optionsFromOutput, saveVideoTemplate } from '../../media-native/src/video-options.js'
import path from 'node:path'
import {VideoStudioStore} from './studio-store.js'
import {assertStudioRequest,assertVideoDraft,draftComposition,draftReadiness,applyNarrationPacing,sceneCoverage,studioId} from './studio-contract.js'
import {mediaRecord,finiteNumber,assertArtifactId} from '../../media-native/src/media-contract.js'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import type {VideoDraft,StudioReadiness,StudioRequest} from './studio-contract.js'
export type {BrowserFeatureHost as StudioKernel} from '@bmw-agent/browser-capability/host'
import type {BrowserSessionOwner,BrowserFeatureHost as StudioKernel} from '@bmw-agent/browser-capability/host'

const studioWrites:readonly StudioRequest['operation'][]=['propose-news-topics','select-news-topic','record-production-review','precompose','adopt-type','record-export-review','apply-recording-plan','narrate-local','apply-source-narration','materials','apply-edit','migrate-document','remove-reference','prepare-reference','set-reference-analysis','apply-reference-notes','propose-review','adopt-review','dismiss-review','undo-review','split-scene','restore','recognize-source','apply-source-captions','detach-source-captions','set-caption-translations','align-speech','correct-speech','create','delete','update','attach','narrate','narrate-pending','render','export-cover','configure','save-template']

export class VideoStudioService {
  private readonly snapshots=new StudioSnapshotProof()
  constructor(readonly kernel:StudioKernel){}
  async execute(raw:unknown,signal?:AbortSignal,owner?:BrowserSessionOwner,actor:'user'|'agent'='agent'):Promise<unknown>{
    if(!owner||owner.projectId!==this.kernel.projectStore.active().id)throw new Error('STUDIO_SESSION_REQUIRED: Video Studio 需要当前 Project 的对话身份。')
    studioId(owner.sessionId)
    const scope={projectId:owner.projectId,sessionId:owner.sessionId}
    const request=assertStudioRequest(raw),result=await this.perform(request,signal,scope,actor)
    if(studioWrites.includes(request.operation))this.kernel.videoStudioChanged?.(scope)
    return result
  }
  private async perform(raw:unknown,signal:AbortSignal|undefined,owner:BrowserSessionOwner,actor:'user'|'agent'='agent'):Promise<unknown>{
    const request=assertStudioRequest(raw),project=this.kernel.projectStore.active(),context=this.kernel.videoStudioContext?.(owner) as {view?:{mode?:string}}|undefined,store=new VideoStudioStore(project.directory,owner.sessionId,(current,next)=>{const live=this.kernel.videoStudioContext?.(owner) as {view?:{mode?:string}}|undefined;if(live?.view?.mode!=='advanced')requireSimpleVideoEdit(current,next)})
    if(project.id!==owner.projectId)throw new Error('Studio Project changed during operation.')
    signal?.throwIfAborted()
    const sources=new StudioSources(this.kernel),news=new NewsService(this.kernel,owner)
    if(['news-topics','propose-news-topics','select-news-topic','news-guide'].includes(request.operation))return news.execute(request,actor,signal)
    if(request.operation==='materials'){
      const material=assertMaterialIndexRequest(request.materialRequest)
      if(material.operation==='set-metadata')requireNewsSelection(this.kernel,owner,actor)
      return new MaterialIndexService(this.kernel,owner,actor,newsResearchPending(this.kernel,owner,actor)).execute(material,signal)
    }
    if(studioWrites.includes(request.operation))requireNewsSelection(this.kernel,owner,actor)
    if(request.draftId&&['narrate','narrate-pending','narrate-local','render'].includes(request.operation))await news.guardDraft(request.draftId,signal,request.operation==='render'&&actor==='agent')
    if(request.operation==='production-profiles')return {profiles:productionProfiles,recipes:productionRecipes,guidanceVersion:1,permissions:'unchanged',externalSkills:false,disable:'Omit production metadata to stop using type guidance; authored scenes remain intact.'}
    if(request.operation==='guide')return studioToolGuide()
    if(request.operation==='describe-edit'){
      const branches=mediaRecord(mediaRecord(videoEditSchema.properties.commands).items).oneOf as unknown[],variants=branches.map(mediaRecord).filter(v=>mediaRecord(mediaRecord(v.properties).op).const===request.editOperation).map(v=>{const properties=mediaRecord(v.properties);return {...v,properties:{...properties,...('cardSpec'in properties?{cardSpec:{type:'object',description:'Use describe-template with the chosen cardTemplateId for its exact cardSpec schema.'}}:{})}}})
      if(!variants.length)throw new TypeError('VIDEO_EDIT_OPERATION: Unknown command. Use describe-schema for command names.')
      return {editOperation:request.editOperation,version:1,variants,cardSchemaOperation:'describe-template',transaction:'apply-edit with expectedRevision and edit {version:1,commands:[...]}; Host-owned evidence is never writable.'}
    }
    if(request.operation==='describe-schema')return {schemaVersion:VIDEO_DOCUMENT_VERSION,supportedDocumentVersions:[...VIDEO_DOCUMENT_VERSIONS],cardTemplates:CARD_TEMPLATES.filter(item=>item.id!=='points/list').map(({id,category,name,purpose})=>({id,category,name,purpose})),documentSchema:videoDocumentSchema,editSchema:videoEditSchema,capabilities:{profile:'simple.cards/3',frameRates:{minimum:12,maximum:30,denominator:1},maxScenes:COMPOSITION_LIMITS.scenes,maxDurationSeconds:COMPOSITION_LIMITS.seconds,maxVisualSegmentsPerScene:8,maxIndependentObjects:64,sequentialRegions:true,freeTimelineGaps:false,nestedSequences:false,aiAssetGeneration:false},authorization:{projectId:owner.projectId,sessionId:owner.sessionId,advancedEditing:context?.view?.mode==='advanced'},commands:['brief.set','scene.add','captions.set','card.set','card.bind','scene.set','scene.reorder','clip.move','clip.trim','clip.split','clip.effects','clip.mute','layer.add','layer.set','layer.remove']}
    if(request.operation==='describe-template')return {template:cardTemplate(request.cardTemplateId!),cardSpecSchema:{oneOf:cardSpecSchema.oneOf.filter(branch=>branch.properties.templateId.const===request.cardTemplateId)},contentContracts:cardSpecSchema.oneOf.filter(branch=>branch.properties.templateId.const===request.cardTemplateId).map(branch=>({ ...cardContentContract(request.cardTemplateId!,branch.properties.version.const as 1|2),sceneConstraints:cardSceneConstraints(request.cardTemplateId!,branch.properties.version.const as 1|2)})),visualBindings:{derivedScene:['imageArtifactId','videoArtifactId','visualSegments[].imageArtifactId','visualSegments[].videoArtifactId'],canonicalDocument:'timeline primary clips',sourcePinsAttachVisuals:false},variants:CARD_TEMPLATES.filter(item=>item.category===cardTemplate(request.cardTemplateId!).category).map(({id,name,purpose})=>({id,name,purpose})),defaults:{motion:'none'},supportedAspectRatios:['16:9','9:16'],limits:{title:44,bullet:64,maxVisualSegments:8,maxDurationSeconds:60},guidance:['Fill canonical scene fields named by slots; cardSpec stores bounded dedicated slots. Version 2 cards require document 2.2; source rectangles are pinned to actual artifact SHA-256.','Use real Project artifacts and source URLs; example labels are not factual evidence.','Plan one purpose per card, fetch missing assets, validate the draft, then inspect actual preview.','Do not delete extra bullets to fit a different template; use a list or split the card.','Recording focus is not a measured pointer trajectory.']};
    if(request.operation==='source')return sources.execute(request.sourceRequest,signal)
    if(request.operation==='open'){if(!this.kernel.videoStudioOpen)throw new Error('Studio UI is unavailable in this host.');return this.kernel.videoStudioOpen(owner)}
    if(request.operation==='context')return this.kernel.videoStudioContext?.(owner)??{mode:'browser',selection:null}
    if(request.operation==='list'){const drafts=store.list();return {project:{id:project.id,name:project.name},sessionId:owner.sessionId,drafts,compatibility:Object.fromEntries(drafts.map(d=>[d.id,studioCompatibility(d)])),schemaVersion:VIDEO_DOCUMENT_VERSION,supportedDocumentVersions:[...VIDEO_DOCUMENT_VERSIONS],snapshotProofs:Object.fromEntries(drafts.map(draft=>[draft.id,this.snapshots.issue(owner,draft)])),reusableExports:Object.fromEntries(drafts.flatMap(draft=>{const output=store.reusableExport(draft);return output?[[draft.id,output.artifactId]]:[]})),videoPreferences:normalizeVideoPreferences(this.kernel.settingsStore?.snapshot().videoPreferences??{})}}
    if(request.operation==='assets')return request.assetQuery?studioAssetPage(project.directory,request.assetQuery):{assets:store.assets(project.directory)}
    if(request.operation==='create')return store.create(request.title??'新视频',resolveVideoOutput(this.kernel.settingsStore?.snapshot().videoPreferences,request.options??{},request.templateName))
    if(request.operation==='read-material'){
      if(!/\.(?:txt|md|srt|vtt|json)$/i.test(request.artifactId!))throw new Error('Choose a Project text material. Stored web originals use source/list and source/read.')
      const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:request.artifactId!})
      try{const bytes=await input.read(0,Math.min(input.bytes,256*1024));signal?.throwIfAborted();return {artifactId:request.artifactId,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes,{stream:input.bytes>bytes.length}),truncated:input.bytes>bytes.length,bytes:input.bytes}}finally{await input.close()}
    }
    if(request.operation==='inspect'){
      if(request.assetKind!=='image')return assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:request.artifactId},signal))
      const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:request.artifactId!})
      try{const sha256=await input.fingerprint(signal),info=assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:request.artifactId},signal));if(await input.fingerprint(signal)!==sha256)throw new Error('CARD_SOURCE_STALE: Source changed during image inspection.');return {...info,source:{artifactId:request.artifactId!,sha256}}}finally{await input.close()}
    }
    const id=studioId(request.draftId)
    if(request.operation==='read')return store.read(id)
    if(request.operation==='read-scene')return studioSceneProjection(store.read(id),request)
    if(request.operation==='read-preparation'){
      const draft=store.read(id);if(draft.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 请使用当前草稿版本。')
      const section=request.briefSection??'notes',offset=request.pageOffset??0,base={draftId:id,revision:draft.revision,section}
      if(section==='artifacts'||section==='sources')return {...base,...studioPage(section==='artifacts'?draft.preparation.artifactIds:draft.preparation.sourceIds??[],offset,request.pageLimit??20)}
      const text=draft.preparation[section],end=Math.min(text.length,offset+4000);return {...base,text:text.slice(offset,end),offset,endCharacter:end,totalCharacters:text.length,nextOffset:end<text.length?end:null,untrustedMaterialNotes:true}
    }
    if(['read-document','compatibility','migrate-document'].includes(request.operation)){const draft=store.read(id);if(draft.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 请使用当前草稿版本。');if(request.operation==='compatibility')return studioCompatibility(draft);if(request.operation==='migrate-document')return store.migrateDocument(id,draft.revision);return {projectId:project.id,sessionId:owner.sessionId,document:store.readDocument(id),compatibility:studioCompatibility(draft)}}
    if(request.operation==='delete')return store.delete(id,request.expectedRevision!)
    if(request.operation==='restore'){
      const snapshot=assertVideoDraft(request.draft)
      this.snapshots.verify(owner,snapshot,request.snapshotProof!)
      if(context?.view?.mode!=='advanced')requireSimpleVideo(snapshot)
      signal?.throwIfAborted()
      return store.restoreSnapshot(id,request.expectedRevision!,snapshot)
    }
    if(['update','apply-edit','validate-edit'].includes(request.operation)){
      const current=store.read(id);if(current.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 请使用当前草稿版本。')
      const candidate=request.operation==='update'?request.draft:applyVideoEdit(current,request.edit!,actor==='user'),raw=mediaRecord(candidate),next=assertVideoDraft({...raw,preparation:raw.preparation??current.preparation})
      if(next.preparation.sourceIds?.length){const catalog=sources.port().snapshot();if(next.preparation.sourceIds.some(id=>!catalog.sources.some(source=>source.id===id)))throw new Error('Preparation source does not belong to this Project.')}
      for(const work of next.preparation.production?.works??[])await sources.port().readBody(work.sourceId,work.acquisitionId,signal)
      for(const artifactId of productionArtifactIds(next).filter(id=>!productionArtifactIds(current).includes(id))){const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId});await input.close()}
      for(const scene of next.scenes)for(const citation of scene.citations??[])await sources.citation(citation,signal)
      for(const artifactId of next.preparation.artifactIds.filter(value=>!current.preparation.artifactIds.includes(value))){signal?.throwIfAborted();const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId});await input.close()}
      if(next.cover?.sourceArtifactId&&next.cover.sourceArtifactId!==current.cover?.sourceArtifactId){const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:next.cover.sourceArtifactId});await input.close()}
      for(const artifactId of new Set([...layerAssets(next),...next.scenes.flatMap(layerAssets),...next.scenes.flatMap(s=>cardImageAssets(s.cardSpec?.version===2?s.cardSpec:undefined))])){
        signal?.throwIfAborted();const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId});await input.close()
      }
      if(next.preparation.production){
        const assets=next.preparation.production.assetVersions,assetHashes=new Map<string,string>();let assetBytes=0
        for(const asset of assets){const old=current.preparation.production?.assetVersions.find(a=>a.id===asset.id);if(old){asset.fingerprints=old.fingerprints;continue}const ids=[asset.artifactId,...asset.inputArtifactIds],hashes:string[]=[];for(const artifactId of ids){signal?.throwIfAborted();let sha256=assetHashes.get(artifactId);if(!sha256){if(assetHashes.size>=256)throw new Error('PRODUCTION_FACTS_BUDGET: At most 256 external asset identities per adoption.');const io=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId});try{assetBytes+=io.bytes;if(assetBytes>512*1024*1024)throw new Error('PRODUCTION_FACTS_BUDGET: External asset snapshots exceed 512 MiB.');sha256=await io.fingerprint(signal);assetHashes.set(artifactId,sha256)}finally{await io.close()}}hashes.push(sha256)}asset.fingerprints={output:hashes[0],inputs:asset.inputArtifactIds.map((artifactId,i)=>({artifactId,sha256:hashes[i+1]}))}}
        raw.preparation=next.preparation
      }
      const goalScenes=new Set((next.preparation.production?.goals??[]).filter(g=>!current.preparation.production?.goals.some(old=>old.id===g.id)).map(g=>g.sceneId));if(goalScenes.size)await verifyStudioSpeech({...next,scenes:next.scenes.filter(s=>goalScenes.has(s.id))},path.join(project.directory,'artifacts'),signal)
      if(request.edit){const bound=new Set(request.edit.commands.flatMap(c=>c.op==='card.bind'||c.op==='card.set'&&c.links!==undefined||c.op==='captions.set'&&c.mode==='sentences'?[c.sceneId]:[]));if(bound.size)await verifyStudioSpeech({...next,scenes:next.scenes.filter(s=>bound.has(s.id))},path.join(project.directory,'artifacts'),signal)}
      signal?.throwIfAborted()
      if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Studio Project changed before edit commit.')
      const updated=store.update(id,request.expectedRevision,candidate,false,actor==='user',undefined,request.operation==='validate-edit',true)
      return request.operation==='validate-edit'?{valid:true,draftId:id,revision:current.revision,compatibility:studioCompatibility(updated),document:videoDocumentFromDraft(updated),renderReadiness:draftReadiness(updated)}:updated
    }
    const draft=store.read(id)
    if(draft.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 请使用当前草稿版本。')
    if(request.operation==='precomposition-status'){if(!draft.preparation.artifactIds.includes(request.artifactId!))throw new Error('Choose a proxy report belonging to this draft.');const result=await this.kernel.recordingController.processArtifact({action:'media.precompose.inspect',artifactId:request.artifactId},signal);this.assertRevision(store,draft);if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Proxy Project changed.');return result}
    if(request.operation==='precompose'){
      const result=mediaRecord(await this.kernel.recordingController.processArtifact({action:'media.precompose',recipe:request.gridRecipe},signal)),artifactId=assertArtifactId(result.artifactId),recipeArtifactId=assertArtifactId(result.recipeArtifactId)
      try{assertMediaArtifactReceipt(result,'composition');if(typeof result.cacheKey!=='string'||!/^[a-f0-9]{64}$/.test(result.cacheKey)||result.width!==request.gridRecipe!.width||result.height!==request.gridRecipe!.height||result.fps!==request.gridRecipe!.fps||result.durationSeconds!==request.gridRecipe!.durationSeconds||productionHash(mediaRecord(result.metrics).recipe)!==productionHash(request.gridRecipe))throw new Error('Invalid native proxy receipt.');signal?.throwIfAborted();this.assertRevision(store,draft);if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Proxy Project changed.');draft.preparation.artifactIds.push(artifactId,recipeArtifactId);const updated=store.update(id,draft.revision,draft);return {...result,draft:updated,rebuild:'Read recipeArtifactId for the exact inputs, source hashes and explicit audio policy; source changes require a new precompose request.'}}
      catch(error){await this.kernel.recordingController.processArtifact({action:'media.precompose.discard',cacheKey:result.cacheKey});throw error}
    }
    if(request.operation==='production-read'){
      const production=draft.preparation.production,section=request.productionSection??'brief'
      if(!production)return {draftId:id,revision:draft.revision,production:null,next:'production-profiles then propose-type'}
      if(section==='brief'){const {sections,works,relations,claims,goals,assetVersions,...brief}=production;return {draftId:id,revision:draft.revision,brief,counts:{sections:sections.length,works:works.length,relations:relations.length,claims:claims.length,goals:goals.length,assetVersions:assetVersions.length}}}
      return {draftId:id,revision:draft.revision,section,...studioPage<unknown>(section==='goals'?production.goals.map(({binding,...goal})=>({...goal,bindingCaptured:Boolean(binding)})):production[section],request.pageOffset??0,request.pageLimit??20,32768)}
    }
    if(request.operation==='production-review'||request.operation==='record-production-review'){
      const review=productionReview(draft),sourceFacts=await this.productionSourceFacts(draft,sources,signal),directory=path.join(project.directory,'artifacts'),scope=await productionAssessmentSnapshot(draft,store,directory,sourceFacts,signal),journal=new ProductionAssessmentJournal(project.directory,{...owner,draftId:id})
      if(draft.preparation.production?.assetVersions.length){const facts=await productionFacts(draft,directory,signal);for(const asset of draft.preparation.production.assetVersions){const expected=asset.fingerprints;if(!expected||facts.facts.find(f=>f.artifactId===asset.artifactId)?.sha256!==expected.output||expected.inputs.some(p=>facts.facts.find(f=>f.artifactId===p.artifactId)?.sha256!==p.sha256)||expected.inputs.map(p=>p.artifactId).join('\n')!==asset.inputArtifactIds.join('\n'))review.issues.push({code:'external-asset-stale',id:asset.id,message:'外部素材输出或输入版本改变，须显式建立新版本。'})}}
      this.assertRevision(store,draft);if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Production Project changed.')
      if(request.operation==='record-production-review'){
        if(!scope.fingerprint||!scope.exportArtifactId||request.baseFingerprint!==scope.fingerprint)throw new Error('PRODUCTION_REVIEW_STALE: Review the current actual MP4 and content before recording.')
        const record=makeProductionAssessment(draft,request.assessment!,{fingerprint:scope.fingerprint,exportArtifactId:scope.exportArtifactId},actor)
        const checked=await productionAssessmentSnapshot(draft,store,directory,await this.productionSourceFacts(draft,sources,signal),signal);signal?.throwIfAborted();this.assertRevision(store,draft);if(this.kernel.projectStore.active().id!==owner.projectId||checked.fingerprint!==scope.fingerprint)throw new Error('PRODUCTION_REVIEW_STALE: Content or sources changed during assessment.')
        journal.append(request.expectedAssessmentRevision!,record)
      }
      const saved=journal.read(),current=saved.records.filter(r=>r.fingerprint===scope.fingerprint&&r.profileId===draft.preparation.production?.profileId),user=current.findLast(r=>r.origin==='user'),agent=current.findLast(r=>r.origin==='agent'),accepted=!review.issues.length&&acceptedProductionAssessment(user,draft.preparation.production?.profileId??'')
      return {...review,state:accepted?'已验收':review.issues.length?'资料待补':scope.exportArtifactId?'成片待审':draftReadiness(draft).ready?'可制作':'稿件待审',contentAccepted:accepted,humanListening:user?.listening??'not-performed',viewerRetelling:user?.retellingAnswer.trim()?'recorded':'not-recorded',fingerprint:scope.fingerprint,exportArtifactId:scope.exportArtifactId,assessmentRevision:saved.revision,assessments:{user:user??null,agent:agent??null},historicalAssessmentCount:saved.records.length-current.length,issues:review.issues.slice(0,20),issueCount:review.issues.length,goals:review.goals?.slice(0,20),goalCount:review.goals?.length??0,checks:review.checklist?.map((c,i)=>({id:'check-'+(i+1),...c,humanRequired:i===4})),assessmentMeaning:'User declarations for the current bytes/content, not Host semantic certification.'}
    }

    if(request.operation==='propose-type'||request.operation==='adopt-type'||request.operation==='plan-impact'){
      const directory=path.join(project.directory,'artifacts'),readSourceFacts=()=>this.productionSourceFacts(draft,sources,signal),sourceFacts=await readSourceFacts(),facts=await productionFacts(draft,directory,signal,sourceFacts)
      this.assertRevision(store,draft);if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Production Project changed.')
      if(request.operation==='plan-impact'){
        const candidate=request.edit?applyVideoEdit(draft,request.edit,actor==='user'):draft,next=request.cover?{...candidate,cover:request.cover}:candidate,items=productionImpact(draft,next,store.reusableExport(draft)?.artifactId)
        for(const fact of facts.facts.filter(f=>f.state==='unavailable'))items.unshift({id:fact.artifactId,kind:'source',decision:'review',reasons:['source-unavailable']})
        const stale=request.baseFingerprint!==undefined&&request.baseFingerprint!==facts.fingerprint
        return {draftId:id,revision:draft.revision,baseFingerprint:facts.fingerprint,rendererVersion:facts.rendererVersion,stale,staleReasons:stale?['revision-content-source-or-settings-changed']:[],...studioPage(items,request.pageOffset??0,request.pageLimit??20,12000),execution:'read-only; existing actions recheck owner, CAS, source facts and cleanup; no partial encoding reuse'}
      }
      const proposal=productionProposal(draft,request.productionType!,request.recipeId,request.sceneId)
      const proposalFingerprint=productionHash({base:facts.fingerprint,profile:proposal.profileId,profileVersion:proposal.profileVersion,recipe:proposal.recipeId,recipeVersion:proposal.recipeVersion,sceneId:request.sceneId,edit:proposal.edit})
      if(request.operation==='propose-type')return {...proposal,draftId:id,revision:draft.revision,baseFingerprint:proposalFingerprint}
      if(proposalFingerprint!==request.baseFingerprint)throw new Error('PRODUCTION_STALE: Recompute the proposal; revision, sources or settings changed.')
      const checked=await productionFacts(draft,directory,signal,await readSourceFacts());if(checked.fingerprint!==facts.fingerprint)throw new Error('PRODUCTION_STALE: Sources changed before adoption.')
      return this.perform({operation:'apply-edit',draftId:id,expectedRevision:draft.revision,edit:proposal.edit},signal,owner,actor)
    }
    if(request.operation==='analysis')return new SourceAnalysisService(this.kernel,{projectId:project.id,sessionId:owner.sessionId,draftId:draft.id,directory:project.directory},()=>{if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Analysis Project changed.');this.assertRevision(store,draft)},actor).execute(request.analysisRequest!,signal)
    if(['remove-reference','prepare-reference','read-reference','set-reference-analysis','apply-reference-notes'].includes(request.operation))return referenceOperation(this.kernel,store,draft,request,path.join(project.directory,'artifacts'),()=>{if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Reference Project changed.');this.assertRevision(store,draft)},actor,signal)
    if(['propose-review','adopt-review','dismiss-review','undo-review'].includes(request.operation)){
      const items=structuredClone(draft.reviewItems??[])
      if(request.operation==='propose-review'){
        const proposal=request.reviewProposal!,scene=draft.scenes.find(s=>s.id===proposal.sceneId)
        if(!scene||proposal.seconds>=scene.durationSeconds||!studioReviewApplicable(draft,proposal))throw new Error('STUDIO_REVIEW_STALE: 建议的镜头、时间或原字段已变化，请重新审阅。')
        if(items.length>=40)throw new Error('STUDIO_REVIEW_BUDGET: 此草稿已保存四十条审阅记录。')
        const item:StudioReviewItem={...proposal,id:crypto.randomUUID(),revision:draft.revision,createdAt:new Date().toISOString(),origin:actor,status:'pending'}
        items.push(item);signal?.throwIfAborted();return store.recordReview(id,draft.revision,items)
      }
      if(actor!=='user')throw new Error('STUDIO_REVIEW_USER_REQUIRED: 请由用户在审阅区逐项采纳、忽略或撤销建议。')
      const item=items.find(i=>i.id===request.reviewId);if(!item)throw new Error('Unknown Studio review item.')
      const reverting=request.operation==='undo-review'
      if(item.status!==(reverting?'adopted':'pending'))throw new Error('STUDIO_REVIEW_STATE: 此建议已处理，请刷新审阅列表。')
      if(request.operation==='dismiss-review'){item.status='dismissed';signal?.throwIfAborted();return store.recordReview(id,draft.revision,items)}
      if(!studioReviewApplicable(draft,item,reverting))throw new Error('STUDIO_REVIEW_STALE: 目标字段已被修改，请重新审阅；不会覆盖当前内容。')
      applyStudioReview(draft,item,reverting)
      item.status=reverting?'undone':'adopted';signal?.throwIfAborted()
      return store.update(id,draft.revision,draft,false,true,items)
    }
    if(request.operation==='split-scene'){
      const target=draft.scenes.find(scene=>scene.id===request.sceneId);if(!target)throw new Error('Unknown Studio scene.')
      await verifyStudioSpeech({...draft,scenes:[target]},path.join(project.directory,'artifacts'),signal)
      signal?.throwIfAborted()
      return store.splitScene(id,request.expectedRevision!,request.sceneId!,request.splitSeconds!)
    }
    if(request.operation==='export-citations'){
      const citations=[]
      for(const scene of draft.scenes)for(const citation of scene.citations??[])citations.push({sceneId:scene.id,sceneTitle:scene.title,...await sources.citation(citation,signal)})
      signal?.throwIfAborted();this.assertRevision(store,draft)
      const content={version:1,projectId:project.id,draftId:draft.id,revision:draft.revision,generatedAt:new Date().toISOString(),characterUnit:'utf16',factChecking:'pending',citations}
      const output=await exportProjectText(path.join(project.directory,'artifacts'),'json',JSON.stringify(content,null,2)+'\n',signal,()=>this.assertRevision(store,draft))
      return {...output,type:'citation-list',contentType:'application/json',citationCount:citations.length,factChecking:'pending'}
    }
    if(request.operation==='save-template'){
      if(!this.kernel.settingsStore)throw new Error('Persistent video settings are unavailable.')
      const preferences=saveVideoTemplate(this.kernel.settingsStore.snapshot().videoPreferences??{},request.templateName,optionsFromOutput(draft))
      this.kernel.settingsStore.update({videoPreferences:preferences});return {saved:request.templateName,videoPreferences:preferences}
    }
    if(request.operation==='configure'){
      const preferences=normalizeVideoPreferences(this.kernel.settingsStore?.snapshot().videoPreferences??{})
      if(!request.templateName)preferences.defaults=optionsFromOutput(draft)
      const retainDimensions=!request.templateName&&request.options?.aspectRatio===undefined&&request.options?.resolution===undefined&&request.options?.width===undefined&&request.options?.height===undefined
      const output=resolveVideoOutput(preferences,request.options??{},request.templateName,retainDimensions?{width:draft.width,height:draft.height}:undefined)
      draft.cardLayout=output.cardLayout;draft.narrationPacing=output.narrationPacing;draft.width=output.width;draft.height=output.height;draft.fps=output.fps;draft.music=output.music;draft.style=output.style;draft.tts=output.tts;draft.watermark=output.watermark
      if(output.templateName)draft.templateName=output.templateName;else delete draft.templateName
      return store.update(id,draft.revision,draft)
    }
    if(request.operation==='review-status'||request.operation==='record-export-review')return exportReviewState(store,draft,request,path.join(project.directory,'artifacts'),()=>{if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Export review Project changed.');this.assertRevision(store,draft)},actor,signal)
    if(request.operation==='review-export')return reviewStudioExport(this.kernel,store,draft,request,path.join(project.directory,'artifacts'),()=>{if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Export review Project changed.');this.assertRevision(store,draft)},signal)
    if(request.operation==='check')return this.checkDraft(draft,project.directory,store,signal)
    if(request.operation==='export-cover'){
      const options=assertCoverOptions(request.cover??draft.cover??{title:draft.title})
      const source=options.sourceArtifactId?store.assets(project.directory).find(asset=>asset.artifactId===options.sourceArtifactId):undefined
      if(options.sourceArtifactId&&(!source||source.kind!=='image'&&source.kind!=='video'))throw new Error('Choose a Project image or video for the cover.')
      const native=assertCoverRenderRequest({action:'video.cover',width:draft.width,height:draft.height,options,...(source?{sourceKind:source.kind}:{})})
      const result=mediaRecord(await this.kernel.recordingController.processArtifact(native,signal)),receipt=assertCoverReceipt(result,draft.width,draft.height)
      try{
        signal?.throwIfAborted();this.assertRevision(store,draft)
        const actualTimestampSeconds=result.actualTimestampSeconds===undefined?undefined:finiteNumber(result.actualTimestampSeconds,'actual cover timestamp',0,options.timestampSeconds)
        const updated=store.addCoverExport(id,draft.revision,{...receipt,...(actualTimestampSeconds===undefined?{}:{actualTimestampSeconds})},options)
        return {draft:updated,coverArtifact:result}
      }catch(error){await fs.rm(path.join(project.directory,'artifacts',receipt.artifactId),{force:true});throw error}
    }
    if(request.operation==='export-captions'){
      await verifyStudioSpeech(draft,path.join(project.directory,'artifacts'),signal)
      for(const scene of draft.scenes)if(scene.captions===undefined&&sceneCoverage(scene,draft.tts).audioStale)delete scene.audioDurationSeconds
      const inspected=new Map<string,number>()
      for(const scene of draft.scenes)if(scene.captions===undefined&&scene.audioArtifactId&&!sceneCoverage(scene,draft.tts).audioStale){
        signal?.throwIfAborted();let duration=inspected.get(scene.audioArtifactId)
        if(duration===undefined){const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:scene.audioArtifactId},signal));if(!info.tracks.some(track=>track.type==='audio'&&track.canDecode))throw new Error('Caption audio cannot be decoded.');duration=info.durationSeconds;inspected.set(scene.audioArtifactId,duration)}
        scene.audioDurationSeconds=duration
      }
      signal?.throwIfAborted();this.assertRevision(store,draft)
      const document=captionDocument(draft.scenes.map(speechScene),draft.width,draft.height,request.captionFormat!)
      const result=await exportProjectText(path.join(project.directory,'artifacts'),request.captionFormat!,document.text,signal,()=>this.assertRevision(store,draft))
      // SRT/VTT remain valid standard captions. A separate Project receipt records
      // per-scene clock, exact script span, manual/Agent origin and audio identity.
      let provenanceArtifact:{artifactId:string;bytes:number}|undefined
      try{
        if(draft.scenes.some(scene=>usesStudioSpeech(scene)||scene.voiceTiming||scene.voiceSegments||scene.sourceCaptionBinding||scene.captions?.some(cue=>cue.translationText))){
          const scenes=[];let filmStartSeconds=0
          for(const scene of draft.scenes){scenes.push({sceneId:scene.id,filmStartSeconds,voiceTiming:scene.voiceTiming,voiceSegments:scene.voiceSegments,sourceCaptionBinding:scene.sourceCaptionBinding,captionDisplay:scene.captionDisplay,translations:scene.captions?.map((cue,index)=>({index,origin:cue.translationOrigin})),origin:usesSpeechCaptions(scene)?scene.speechAnchors!.origin:scene.captions===undefined?'estimated':'independently-edited',...(usesStudioSpeech(scene)?{binding:scene.speechAnchors,links:scene.speechLinks,cues:speechScene(scene).captions,bulletRevealSeconds:speechScene(scene).bulletRevealSeconds,focus:sceneVisuals(speechScene(scene)).map(v=>v.focusIntervals)}:{} )});filmStartSeconds+=scene.durationSeconds}
          provenanceArtifact=await exportProjectText(path.join(project.directory,'artifacts'),'json',JSON.stringify({version:1,draftId:draft.id,revision:draft.revision,captionArtifactId:result.artifactId,format:request.captionFormat,voiceOffsetSeconds:.5,sourceOffsetSeconds:0,timeDomain:'film-seconds',automaticTimingApproved:false,wordTimingAvailable:false,scenes},null,2)+'\n',signal,()=>this.assertRevision(store,draft))
        }
        await verifyStudioSpeech(draft,path.join(project.directory,'artifacts'),signal);signal?.throwIfAborted();this.assertRevision(store,draft)
        return {...result,draftId:draft.id,revision:draft.revision,type:'subtitles',format:request.captionFormat,contentType:request.captionFormat==='vtt'?'text/vtt':'application/x-subrip',cueCount:document.cueCount,timing:document.timing,...(provenanceArtifact?{provenanceArtifactId:provenanceArtifact.artifactId,sentenceTiming:draft.scenes.some(scene=>scene.sourceCaptionBinding)?'edited-source-cues':draft.scenes.some(usesStudioSpeech)?'edited-audio-anchors':'independently-edited'}:{})}
      }catch(error){for(const artifactId of [result.artifactId,provenanceArtifact?.artifactId].filter(Boolean))await fs.rm(path.join(project.directory,'artifacts',artifactId),{force:true});throw error}
    }
    if(request.operation==='narrate-pending'){
      let current=draft
      const pending=draftReadiness(current).pendingNarrationSceneIds,completedSceneIds:string[]=[]
      let failedSceneId:string|undefined
      const publish=(phase:'started'|'scene-completed'|'completed'|'failed',currentSceneId?:string,saved=current)=>this.kernel.videoStudioChanged?.(owner,{draftId:id,revision:saved.revision,operation:'narrate-pending',phase,...(currentSceneId?{currentSceneId}:{}),completedSceneIds:[...completedSceneIds],pendingSceneIds:draftReadiness(saved).pendingNarrationSceneIds,updatedAt:Date.now()})
      try{
        for(const sceneId of pending){
          failedSceneId=sceneId;signal?.throwIfAborted();publish('started',sceneId)
          // Each scene commits separately; partial work is durable, never replayed.
          const result=await this.perform({operation:'narrate',draftId:id,expectedRevision:current.revision,sceneId},signal,owner) as {draft:VideoDraft}
          current=result.draft;completedSceneIds.push(sceneId);publish('scene-completed',sceneId)
        }
        failedSceneId=undefined;signal?.throwIfAborted();this.assertRevision(store,current);publish('completed')
      }catch(error){
        const latest=store.read(id)
        publish('failed',failedSceneId,latest)
        const progress={draftId:id,currentRevision:latest.revision,completedSceneIds,failedSceneId,pendingSceneIds:draftReadiness(latest).pendingNarrationSceneIds,requiresFreshRead:true,automaticReplay:false}
        throw new Error((error instanceof Error?error.message:String(error))+'; STUDIO_NARRATION_PROGRESS: '+JSON.stringify(progress),{cause:error})
      }
      return {draft:current,completedSceneIds,skippedSceneIds:draft.scenes.filter(scene=>!pending.includes(scene.id)).map(scene=>scene.id)}
    }
    if(request.operation==='render'){
      await verifyStudioSpeech(draft,path.join(project.directory,'artifacts'),signal);await this.verifyCardPins(draft,path.join(project.directory,'artifacts'),signal);this.assertRevision(store,draft)
      const cached=request.forceRender?undefined:store.reusableExport(draft)
      if(cached){signal?.throwIfAborted();this.assertRevision(store,draft);return {draft,export:{...cached,type:'video',contentType:'video/mp4'},reused:true}}
      await this.assertAssets(draft,project.directory,signal)
      signal?.throwIfAborted();this.assertRevision(store,draft)
      const composition=draftComposition(draft)
      const directory=path.join(project.directory,'artifacts'),root=await fs.realpath(directory),rootIdentity=await fs.lstat(directory),before=new Set(await fs.readdir(directory)),created=new Map<string,{dev:number;ino:number}>()
      const received=mediaRecord(await this.kernel.recordingController.compose(composition,signal))
      let committed=false
      try{
        for(const id of [received.artifactId,...(typeof received.verificationArtifactId==='string'?[received.verificationArtifactId]:[])]){const artifactId=assertArtifactId(id);if(!before.has(artifactId)){const file=path.join(root,artifactId),stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(stat?.isFile()&&!stat.isSymbolicLink())created.set(file,{dev:stat.dev,ino:stat.ino})}}
        const result=assertMediaArtifactReceipt(received,'composition')
        signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Studio Project changed during export.');this.assertRevision(store,draft)
        await verifyStudioSpeech(draft,directory,signal);await this.verifyCardPins(draft,directory,signal);signal?.throwIfAborted();this.assertRevision(store,draft)
        const updated=store.addExport(id,draft.revision,{artifactId:String(result.artifactId),durationSeconds:finiteNumber(result.durationSeconds,'duration',1,COMPOSITION_LIMITS.seconds),...(result.verificationArtifactId?{verificationArtifactId:String(result.verificationArtifactId)}:{})})
        committed=true;return {draft:updated,export:result}
      }finally{if(!committed){const current=await fs.lstat(directory);if(current.dev!==rootIdentity.dev||current.ino!==rootIdentity.ino||current.isSymbolicLink()||await fs.realpath(directory)!==root)throw new Error('Export Project changed; cleanup refused.');for(const [file,identity] of created){const stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(stat?.dev===identity.dev&&stat.ino===identity.ino&&!stat.isSymbolicLink())await fs.unlink(file)}}}
    }
    const scene=draft.scenes.find(scene=>scene.id===request.sceneId)
    if(!scene)throw new Error('Unknown Studio scene.')
    if(request.operation==='diagnose-timing')return diagnoseStudioTiming(this.kernel,draft,scene,path.join(project.directory,'artifacts'),()=>{if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Timing Project changed.');this.assertRevision(store,draft)},signal)
    if(['suggest-recording-plan','apply-recording-plan'].includes(request.operation)){
      if(!scene.videoArtifactId||scene.visualSegments)throw new Error('请选择尚未分割的原始录屏。')
      const directory=path.join(project.directory,'artifacts'),artifactId=scene.videoArtifactId,source=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId});let eventInput:ArtifactJobIO|undefined
      const guard=()=>{signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Recording Project changed.');this.assertRevision(store,draft)}
      try{
        eventInput=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:artifactId+'.events.json'})
        if(eventInput.bytes>RECORDING_EVENT_BYTES)throw new Error('Recording event byte budget exceeded.')
        const sourceSha256=await source.fingerprint(signal),eventsSha256=await eventInput.fingerprint(signal),events=assertRecordingEvents(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await eventInput.read(0,eventInput.bytes))),artifactId)
        if(events.videoSha256&&events.videoSha256!==sourceSha256)throw new Error('录屏文件已变化，旧事件记录不可使用。')
        const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId},signal)),track=info.tracks.find(t=>t.type==='video'&&t.canDecode),end=scene.sourceStartSeconds+scene.durationSeconds*scene.playbackRate
        if(!track||scene.sourceStartSeconds<Math.max(0,track.startSeconds??0)-.000001||end>(track.endSeconds??info.durationSeconds)+.000001)throw new Error('当前录屏区间超出实际视频帧范围。')
        guard();if(await source.fingerprint(signal)!==sourceSha256||await eventInput.fingerprint(signal)!==eventsSha256)throw new Error('录屏或事件记录已变化。')
        if(request.operation==='suggest-recording-plan')return {...suggestRecordingPlan(events,scene.sourceStartSeconds,end),draftId:id,revision:draft.revision,sourceSha256,eventsSha256,sourceBinding:events.videoSha256?'recorded-fingerprint':'legacy-unverified',stopReason:events.stopReason,truncated:events.truncated||events.frameClockTruncated,requiresVisualReview:true}
        if(request.recordingSourceSha256!==sourceSha256||request.recordingEventsSha256!==eventsSha256)throw new Error('录屏分段依据已变化，请重新读取建议。')
        const next=recordingPlanDraft(draft,scene.id,request.recordingPlan!)
        guard();return {draft:store.update(id,draft.revision,next,false,actor==='user'),sourceSha256,eventsSha256,segments:request.recordingPlan,semanticVerification:false}
      }finally{await eventInput?.close();await source.close()}
    }
    if(['apply-source-narration','validate-source-narration'].includes(request.operation)){
      const directory=path.join(project.directory,'artifacts'),recipe=request.sourceNarrationRecipe!
      if(!scene.videoArtifactId||!scene.audioArtifactId)throw new Error('请先绑定单段视频和当前脚本旁白。')
      await verifyStudioSpeech(draft,directory,signal)
      const identity=await fs.lstat(directory),source=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:scene.videoArtifactId});let audio:ArtifactJobIO|undefined,receipt:{artifactId:string;bytes:number}|undefined,receiptIdentity:{dev:number;ino:number}|undefined,committed=false
      const guard=()=>{signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Source narration Project changed.');this.assertRevision(store,draft)}
      try{
        audio=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:scene.audioArtifactId})
        const sourceSha256=await source.fingerprint(signal),audioSha256=await audio.fingerprint(signal),videoInfo=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:scene.videoArtifactId},signal)),audioInfo=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:scene.audioArtifactId},signal)),track=videoInfo.tracks.find(t=>t.type==='video'&&t.canDecode)
        if(!track||!videoInfo.tracks.some(t=>t.type==='audio'&&t.canDecode)||!audioInfo.tracks.some(t=>t.type==='audio'&&t.canDecode))throw new Error('配方需要可解码的视频原声与旁白。')
        if(recipe.captions==='original-then-voice'&&recipe.voiceCaptionTiming==='anchors'&&scene.speechAnchors?.audioSha256!==audioSha256)throw new Error('STUDIO_SPEECH_STALE: 请重新核听并校正当前旁白句锚点。')
        const projected=sourceNarrationDraft(draft,scene.id,recipe,{sourceStartSeconds:Math.max(0,track.startSeconds??0),sourceEndSeconds:track.endSeconds??videoInfo.durationSeconds,audioDurationSeconds:audioInfo.durationSeconds})
        guard();if(await source.fingerprint(signal)!==sourceSha256||await audio.fingerprint(signal)!==audioSha256)throw new Error('Source narration media changed during planning.')
        if(request.operation==='validate-source-narration')return {draftId:id,revision:draft.revision,candidate:projected.draft,readiness:draftReadiness(projected.draft),captionTiming:projected.captionTiming,changes:['continuous original video split at lead','source sound enabled only before switch','measured narration begins at switch',...(recipe.captions==='original-then-voice'?['explicit independent mixed captions; old source binding kept in provenance receipt']:[])]}
        receipt=await exportProjectText(directory,'json',JSON.stringify({version:1,kind:'source-narration-recipe',draftId:id,sceneId:scene.id,capturedRevision:draft.revision,actor,recipe,sourceArtifactId:scene.videoArtifactId,sourceSha256,audioArtifactId:scene.audioArtifactId,audioSha256,sourceCaptionSnapshot:projected.sourceCaptionSnapshot,voiceAnchors:recipe.voiceCaptionTiming==='anchors'?scene.speechAnchors:undefined,captionTiming:projected.captionTiming,automaticTimingApproved:false},null,2)+'\n',signal,guard);receiptIdentity=await fs.lstat(path.join(directory,receipt.artifactId))
        if(await source.fingerprint(signal)!==sourceSha256||await audio.fingerprint(signal)!==audioSha256)throw new Error('Source narration media changed before commit.');guard()
        const updated=store.commitSourceNarration(id,draft.revision,projected.draft);committed=true;return {draft:updated,provenanceArtifactId:receipt.artifactId,captionTiming:projected.captionTiming,automaticTimingApproved:false}
      }finally{await source.close();await audio?.close();if(!committed&&receipt&&receiptIdentity){const current=await fs.lstat(directory),file=await fs.lstat(path.join(directory,receipt.artifactId));if(current.dev!==identity.dev||current.ino!==identity.ino||current.isSymbolicLink())throw new Error('Source narration cleanup Project changed.');if(file.dev===receiptIdentity.dev&&file.ino===receiptIdentity.ino&&!file.isSymbolicLink())await fs.unlink(path.join(directory,receipt.artifactId))}}
    }
    if(['recognize-source','read-source-speech','apply-source-captions','detach-source-captions','set-caption-translations'].includes(request.operation))return sourceSpeechOperation(this.kernel,store,draft,scene,request,path.join(project.directory,'artifacts'),()=>{if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Studio Project changed during source speech.');this.assertRevision(store,draft)},actor,signal)
    if(['estimate-speech','align-speech','read-speech','correct-speech'].includes(request.operation))return studioSpeechOperation(this.kernel,store,draft,scene,request,path.join(project.directory,'artifacts'),()=>{if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Studio Project changed during speech operation.');this.assertRevision(store,draft)},actor,signal)
    if(request.operation==='suggest-focus'){
      const visual=request.segmentIndex===undefined?scene:scene.visualSegments?.[request.segmentIndex]
      if(!visual?.videoArtifactId)throw new Error('自动焦点需要录制视频；普通图片可手动添加焦点。')
      const artifactId=visual.videoArtifactId,eventsArtifactId=artifactId+'.events.json'
      const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:eventsArtifactId}).catch(()=>{throw new Error('此视频没有可用录制事件，自动建议不可用；可手动添加焦点。')})
      try{
        if(input.bytes>RECORDING_EVENT_BYTES)throw new Error('Recording event byte budget exceeded.')
        const data=await input.read(0,input.bytes);signal?.throwIfAborted();this.assertRevision(store,draft)
        const events=assertRecordingEvents(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)),artifactId)
        if(events.videoSha256){const video=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId});try{if(await video.fingerprint(signal)!==events.videoSha256)throw new Error('录屏文件已变化，旧焦点事件不可使用。')}finally{await video.close()}if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Focus Project changed.');this.assertRevision(store,draft)}
        return {sourceBinding:events.videoSha256?'recorded-fingerprint':'legacy-unverified',eventsArtifactId,events,focusIntervals:suggestRecordingFocus(events),draftId:draft.id,revision:draft.revision,manualEditsPreserved:true}
      }finally{await input.close()}
    }
    if(request.operation==='narrate'||request.operation==='narrate-local'){
      if(!scene.narration.trim())throw new Error('Write the scene narration first.')
      const local=request.operation==='narrate-local',base=request.templateName?resolveVideoOutput(this.kernel.settingsStore?.snapshot().videoPreferences,{},request.templateName).tts:scene.narrationOptions??draft.tts
      const overrides=local?{provider:'local-matcha' as const}:{...(request.provider!==undefined?{provider:request.provider}:{}),...(request.voice!==undefined?{voice:request.voice}:{}),...(request.ratePercent!==undefined?{ratePercent:request.ratePercent}:{})}
      const tts=assertNarrationOptions(overrides,base);requireNarrationEnabled(tts,this.kernel.settingsStore)
      const directory=path.join(project.directory,'artifacts');await fs.mkdir(directory,{recursive:true,mode:0o700});const identity=await fs.lstat(directory);if(!identity.isDirectory()||identity.isSymbolicLink())throw new Error('Narration Project directory must be native and owned.');const before=new Set(await fs.readdir(directory))
      const result=assertMediaArtifactReceipt(await this.kernel.recordingController.narrate({text:scene.narration,...tts},signal)),generated=path.join(directory,result.artifactId),output=await fs.lstat(generated).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});let committed=false
      try{
        signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Studio Project changed during narration.');this.assertRevision(store,draft)
        if(local)scene.narrationOptions=tts;else if(scene.narrationOptions)scene.narrationOptions=tts;else draft.tts=tts
        const duration=finiteNumber(result.durationSeconds,'audio duration',.01,180),autoTiming=applyNarrationPacing(scene,duration,draft.fps,draft.narrationPacing)
        scene.audioGeneration={kind:'tts',options:tts,...(autoTiming?{autoTiming}:{})};scene.audioArtifactId=String(result.artifactId);scene.audioText=scene.narration;scene.audioDurationSeconds=duration
        if(scene.visualSegments)fitVisualSegments(scene.visualSegments,scene.durationSeconds)
        const updated=store.update(id,draft.revision,draft,true);committed=true;return {draft:updated,audio:result}
      }finally{if(!committed&&output&&!before.has(result.artifactId)){const current=await fs.lstat(directory),file=await fs.lstat(generated).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(current.dev!==identity.dev||current.ino!==identity.ino||current.isSymbolicLink())throw new Error('Narration cleanup Project changed.');if(file?.dev===output.dev&&file.ino===output.ino&&!file.isSymbolicLink())await fs.unlink(generated)}}

    }
    if(request.operation==='attach'){
      if(!request.artifactId||!request.assetKind)throw new Error('Choose an artifact and kind.')
      const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:request.artifactId});await input.close()
      if(request.segmentIndex!==undefined){
        if(request.assetKind==='audio')throw new Error('A visual segment cannot bind narration.')
        const previous:VisualSegment[]=sceneVisuals(scene).map(segment=>({effects:segment.effects,...('id' in segment&&segment.id?{id:segment.id}:{}),focusIntervals:segment.focusIntervals,durationSeconds:segment.durationSeconds,imageArtifactId:segment.imageArtifactId,videoArtifactId:segment.videoArtifactId,sourceStartSeconds:segment.sourceStartSeconds,sourceDurationSeconds:segment.sourceDurationSeconds,playbackRate:segment.playbackRate,zoom:segment.zoom,crop:segment.crop,keepSourceAudio:segment.keepSourceAudio,sourceVolume:segment.sourceVolume,transition:'transition' in segment?segment.transition:'cut' as const,transitionSeconds:'transitionSeconds' in segment?segment.transitionSeconds:Math.min(.3,segment.durationSeconds/2)}))
        if(request.segmentIndex>previous.length||previous.length>=8&&request.segmentIndex===previous.length)throw new Error('Unknown or excessive visual segment.')
        const segment:VisualSegment={durationSeconds:scene.durationSeconds,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut' as const,transitionSeconds:.3}
        if(request.assetKind==='image'){assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:request.artifactId},signal));Object.assign(segment,{imageArtifactId:request.artifactId})}
        else{const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:request.artifactId},signal));if(!info.tracks.some(track=>track.type==='video'&&track.canDecode))throw new Error('Artifact has no decodable video.');const track=info.tracks.find(t=>t.type==='video'&&t.canDecode)!;Object.assign(segment,{videoArtifactId:request.artifactId,sourceStartSeconds:Math.max(0,track.startSeconds??0),sourceDurationSeconds:track.endSeconds??info.durationSeconds})}
        const appending=request.segmentIndex===previous.length
        if(!appending)segment.durationSeconds=previous[request.segmentIndex].durationSeconds
        previous[request.segmentIndex]=segment;scene.visualSegments=previous
        // Appending evenly allocates the current scene, leaving source speeds intact.
        if(appending)for(const value of previous)value.durationSeconds=scene.durationSeconds/previous.length
        fitVisualSegments(previous,scene.durationSeconds);delete scene.effects;delete scene.focusIntervals;delete scene.videoArtifactId;delete scene.imageArtifactId;delete scene.sourceDurationSeconds
        signal?.throwIfAborted();return store.update(id,draft.revision,draft,true)
      }
      if(request.assetKind==='image'){assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:request.artifactId},signal));scene.imageArtifactId=request.artifactId;delete scene.videoArtifactId;delete scene.sourceDurationSeconds}
      else {
        const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:request.artifactId},signal))
        const tracks=info.tracks as {type:string;canDecode:boolean}[]
        if(!Array.isArray(tracks)||!tracks.some(track=>track.type===request.assetKind&&track.canDecode))throw new Error('Artifact has no decodable selected track.')
        const duration=finiteNumber(info.durationSeconds,'media duration',.01,1800)
        if(request.assetKind==='video'){const track=info.tracks.find(t=>t.type==='video'&&t.canDecode)!;scene.videoArtifactId=request.artifactId;scene.sourceStartSeconds=Math.max(0,track.startSeconds??0);scene.sourceDurationSeconds=track.endSeconds??duration;delete scene.imageArtifactId}
        else{const autoTiming=applyNarrationPacing(scene,duration,draft.fps,draft.narrationPacing);scene.audioGeneration={kind:'imported',...(autoTiming?{autoTiming}:{})};scene.audioArtifactId=request.artifactId;scene.audioText=scene.narration;scene.audioDurationSeconds=duration;if(scene.visualSegments)fitVisualSegments(scene.visualSegments,scene.durationSeconds)}
      }
      if(request.assetKind!=='audio'){delete scene.visualSegments;delete scene.focusIntervals}
      signal?.throwIfAborted()
      return store.update(id,draft.revision,draft,true)
    }
    throw new Error('Unhandled Studio operation.')
  }
  private async productionSourceFacts(draft:VideoDraft,sources:StudioSources,signal?:AbortSignal){
    const rows:{sourceId:string;acquisitionId:string;contentId:string|null}[]=[],identities=[...(draft.preparation.production?.works??[]),...draft.scenes.flatMap(s=>s.citations??[])]
    for(const ref of identities){if(rows.some(r=>r.sourceId===ref.sourceId&&r.acquisitionId===ref.acquisitionId))continue;const body=await sources.port().readBody(ref.sourceId,ref.acquisitionId,signal);rows.push({sourceId:ref.sourceId,acquisitionId:ref.acquisitionId,contentId:body.acquisition.contentId})}return rows
  }
  private assertRevision(store:VideoStudioStore,draft:VideoDraft):void {
    if(store.read(draft.id).revision!==draft.revision)throw new Error('STUDIO_CONFLICT: 检查期间草稿已更新，请重新检查。')
  }
  private async checkDraft(draft:VideoDraft,projectDirectory:string,store:VideoStudioStore,signal?:AbortSignal):Promise<StudioReadiness&{checkedAssets:{artifactId:string;kind:string;verification:'decode'|'tracks';bytes:number;pixels?:number}[];encoding:ReturnType<typeof assertEncodingInspection>}> {
    const checkedAssets:{artifactId:string;kind:string;verification:'decode'|'tracks';bytes:number;pixels?:number}[]=[],failures:StudioReadiness['issues']=[]
    const inspected=new Map<string,Promise<{durationSeconds?:number;firstTimestampSeconds?:number}>>()
    type Reference={id?:string;kind:'video'|'image'|'audio';setDuration:(duration:number|undefined,first?:number)=>void}
    const layerReferences=(container:LayerContainer):Reference[]=>[
      ...(container.layers??[]).filter(layer=>layer.artifactId).map(layer=>({id:layer.artifactId,kind:layer.kind==='image'?'image' as const:'video' as const,setDuration:(duration:number|undefined,first?:number)=>{if(layer.kind==='video'&&first!==undefined&&(layer.sourceStartSeconds??0)<first-.000001)throw new Error('源区间起点早于实测视频首帧：'+layer.title);if(layer.kind==='video'&&((layer.sourceStartSeconds??0)+(layer.durationSeconds*(layer.playbackRate??1)))>(duration??0)+.001)throw new Error(`源区间超过实测视频范围：${layer.title}`)}})),
      ...(container.audioTracks??[]).map(layer=>({id:layer.artifactId,kind:'audio' as const,setDuration:(duration:number|undefined)=>{if(layer.sourceStartSeconds+layer.durationSeconds*layer.playbackRate>(duration??0)+.001)throw new Error(`源区间超过实测音频范围：${layer.title}`)}}))
    ]
    const groups:{title:string;id?:string;references:Reference[]}[]=draft.scenes.map(scene=>{
    const references:{id?:string;kind:'video'|'image'|'audio';setDuration:(duration:number|undefined)=>void}[]=sceneVisuals(scene).flatMap(segment=>[
      {id:segment.videoArtifactId,kind:'video' as const,setDuration:(duration:number|undefined,first?:number)=>{segment.sourceDurationSeconds=duration;if(first!==undefined&&segment.sourceStartSeconds<first-.000001)throw new Error('源区间起点早于实测视频首帧：'+segment.sourceStartSeconds+' < '+first)}},
      {id:segment.imageArtifactId,kind:'image' as const,setDuration:()=>{}}
    ])
    references.push(...cardImageAssets(scene.cardSpec?.version===2?scene.cardSpec:undefined).map(id=>({id,kind:'image' as const,setDuration:()=>{}})))
    references.push({id:scene.audioArtifactId,kind:'audio',setDuration:duration=>{scene.audioDurationSeconds=duration}},...layerReferences(scene))
    return {title:scene.title,id:scene.id,references}
    })
    groups.push({title:'全片图层',references:layerReferences(draft)})
    for(const scene of groups)for(const {id,kind,setDuration} of scene.references){
      if(!id)continue
      signal?.throwIfAborted()
      let pending=inspected.get(kind+':'+id)
      if(!pending){
        pending=(async()=>{
          const input=await ArtifactJobIO.open(path.join(projectDirectory,'artifacts'),{action:'media.inspect',artifactId:id});const bytes=input.bytes;await input.close()
          signal?.throwIfAborted()
          if(kind==='image'){const info=assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:id},signal));signal?.throwIfAborted();checkedAssets.push({artifactId:id,kind,verification:'decode',bytes,pixels:info.pixels});return {}}
          const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:id},signal))
          signal?.throwIfAborted()
          const track=info.tracks.find(track=>track.type===kind)
          if(!track?.canDecode)throw new Error('No decodable primary track.')
          if(kind==='video'&&(track.hasAlphaData||(track.width??0)*(track.height??0)>16_777_216))throw new Error('Unsupported video.')
          const durationSeconds=finiteNumber(track.endSeconds??info.durationSeconds,'actual duration',.01,1800),firstTimestampSeconds=kind==='video'?Math.max(0,track.startSeconds??0):undefined
          checkedAssets.push({artifactId:id,kind,verification:'tracks',bytes});return {durationSeconds,firstTimestampSeconds}
        })();inspected.set(kind+':'+id,pending)
      }
      try{const info=await pending;setDuration(info.durationSeconds,info.firstTimestampSeconds)}
      catch(error){signal?.throwIfAborted();const range=error instanceof Error&&error.message.startsWith('源区间');failures.push({code:range?'source-range':'asset-unavailable',severity:'error',sceneId:scene.id,artifactId:id,message:range?`${scene.title}：${error.message}`:`${scene.title}：素材 ${id} 无法读取或不支持解码，请替换素材`})}
    }
    try{await this.verifyCardPins(draft,path.join(projectDirectory,'artifacts'),signal)}catch(error){signal?.throwIfAborted();failures.push({code:'card-source-stale',severity:'error',message:error instanceof Error?error.message:String(error)})}
    signal?.throwIfAborted();this.assertRevision(store,draft)
    const report=draftReadiness(draft);report.issues.push(...failures)
    try{await verifyStudioSpeech(draft,path.join(projectDirectory,'artifacts'),signal)}catch(error){signal?.throwIfAborted();report.issues.push({code:'speech-anchors',severity:'error',message:error instanceof Error?error.message:String(error)})}
    if([...new Map(checkedAssets.map(asset=>[asset.artifactId,asset.bytes])).values()].reduce((sum,bytes)=>sum+bytes,0)>DECODE_BUDGET.assetBytes||checkedAssets.reduce((sum,asset)=>sum+(asset.pixels??0),0)>DECODE_BUDGET.imagePixels)report.issues.push({code:'asset-budget',severity:'error',message:'全片素材超过 256 MiB 或图片解码超过 32 百万像素，请减少素材。'})
    for(const scene of draft.scenes){const decoded=checkedAssets.some(a=>a.kind==='audio'&&a.artifactId===scene.audioArtifactId),diagnostics=sceneTimingDiagnostics(scene,{audioState:decoded?'decoded':scene.audioArtifactId?'unavailable':'missing',...(decoded?{actualDurationSeconds:scene.audioDurationSeconds}:{}),anchorState:scene.speechAnchors?'saved-only':'missing',provenanceState:scene.speechAnchors?.timingProvenance?'not-required':'unrecorded'});for(const issue of diagnostics.issues.filter(i=>i.severity==='warning').slice(0,3))report.issues.push({code:'timing-advisory',severity:'warning',sceneId:scene.id,message:scene.title+'：'+issue.message})}
    const encoding=assertEncodingInspection(await this.kernel.recordingController.processArtifact({action:'media.encode.check',width:draft.width,height:draft.height,fps:draft.fps},signal))
    signal?.throwIfAborted();this.assertRevision(store,draft)
    if(!encoding.videoSupported||!encoding.audioSupported)report.issues.push({code:'encoding-unavailable',severity:'error',message:'此设备不支持当前参数的 H.264/AAC 编码，请调整视频参数。'})
    report.ready=!report.issues.some(issue=>issue.severity==='error')
    return {...report,checkedAssets,encoding}
  }
  private async verifyCardPins(draft:VideoDraft,directory:string,signal?:AbortSignal):Promise<void>{
    const checked=new Map<string,string>();for(const scene of draft.scenes)for(const pin of cardSourcePins(scene.cardSpec?.version===2?scene.cardSpec:undefined)){
      let sha=checked.get(pin.artifactId);if(!sha){const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:pin.artifactId});try{sha=await input.fingerprint(signal);checked.set(pin.artifactId,sha)}finally{await input.close()}}
      if(sha!==pin.sha256)throw new Error('CARD_SOURCE_STALE: 源图已变化，旧重点失效，请重新框选。')
    }
  }
  private async assertAssets(draft:VideoDraft,projectDirectory:string,signal?:AbortSignal):Promise<void>{
    const report=await this.checkDraft(draft,projectDirectory,new VideoStudioStore(projectDirectory),signal)
    const errors=report.issues.filter(issue=>issue.severity==='error')
    if(errors.length)throw new Error(errors.map(issue=>issue.message).join('\n'))
  }
}
const services=new WeakMap<object,VideoStudioService>()
export function studioService(kernel:StudioKernel):VideoStudioService {let service=services.get(kernel);if(!service){service=new VideoStudioService(kernel);services.set(kernel,service)}return service}
