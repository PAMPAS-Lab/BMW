import {prepareShots} from './shot-preparation.js'
import path from 'node:path'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {assertMediaInspection} from '../../media-native/src/media-port.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import {cardImageAssets} from '../../media-native/src/card-details.js'
import {productionHash} from './production-impact.js'
import {NewsPreparationJournal} from './news-preparation-journal.js'
import {speechScene} from './studio-speech-contract.js'
import type {NewsPreparationRequest,NewsScenePreparation} from './news-preparation-contract.js'
import type {VideoDraft,StudioScene} from './studio-contract.js'
import type {VideoStudioStore} from './studio-store.js'
import type {StudioKernel} from './studio-service.js'
import {StudioSources} from './studio-sources.js'
import {NewsJournal} from './news-store.js'
import type {NewsPreparationState} from './news-preparation-journal.js'

interface Issue {sceneId?:string;code:string;message:string}
interface AssetFact {artifactId:string;sha256:string;kind:'image'|'video';durationSeconds?:number;startSeconds?:number;endSeconds?:number;audioStartSeconds?:number;audioEndSeconds?:number}
export class NewsPreparationService {
 readonly journal:NewsPreparationJournal
 constructor(private kernel:StudioKernel,private store:VideoStudioStore,private owner:{projectId:string;sessionId:string},private draft:VideoDraft){this.journal=new NewsPreparationJournal(kernel.projectStore.active().directory,{...owner,draftId:draft.id})}
 private effective(state:NewsPreparationState):NewsPreparationState {const news=new NewsJournal(this.kernel.projectStore.active().directory,this.owner).read(),selected=!news.closed&&news.selection?new NewsPreparationJournal(this.kernel.projectStore.active().directory,{...this.owner,draftId:news.selection.draftId}).read():undefined;return {...state,enabled:state.enabled||Boolean(selected?.enabled),originalSpeechRequired:state.originalSpeechRequired||Boolean(selected?.enabled&&selected.originalSpeechRequired)}}
 required():boolean{return this.draft.preparation.production?.profileId==='news-brief'||this.effective(this.journal.read()).enabled}
 private guard(signal?:AbortSignal){signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==this.owner.projectId||this.store.read(this.draft.id).revision!==this.draft.revision)throw new Error('NEWS_PREPARATION_STALE: Draft or Project changed during preparation.')}
 async execute(request:NewsPreparationRequest,actor:'user'|'agent',signal?:AbortSignal){
  this.guard(signal);if(request.operation==='prepare-shots')return prepareShots(this.kernel,this.store,this.owner,this.draft,request.shots,actor,signal,request.resumeId)
  const state=this.effective(this.journal.read())
  if(request.operation==='read')return {draftId:this.draft.id,revision:this.draft.revision,...state,required:this.required(),meaning:'Saved declarations, not current material verification. Use preflight for actual hashes and gaps.'}
  if(request.operation==='enable'){this.guard(signal);return this.journal.save(request.expectedChecklistRevision,{...state,enabled:true,originalSpeechRequired:state.originalSpeechRequired||request.originalSpeechRequired})}
  if(request.operation==='preflight')return this.preflight(state,signal)
  if(request.operation!=='record-scene'&&request.operation!=='record-scenes')throw new Error('Unknown preparation operation.')
  if(state.revision!==request.expectedChecklistRevision)throw new Error('NEWS_PREPARATION_CONFLICT: Reload checklist revision.')
  const declarations=request.operation==='record-scene'?[request.scene]:request.scenes
  // Validate every author-supplied observation against one current material snapshot.
  // No declaration is persisted until the complete bounded batch and final guard pass.
  const report=await this.preflight(state,signal),verifiedHashes=new Map<string,string>(),directory=path.join(this.kernel.projectStore.active().directory,'artifacts');let bytes=0
  const hash=async(id:string)=>{const cached=verifiedHashes.get(id);if(cached)return cached;const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{bytes+=io.bytes;if(bytes>512*1024*1024||verifiedHashes.size>=128)throw new Error('NEWS_PREPARATION_BUDGET: Observed batch exceeds 512 MiB /128 files.');const value=await io.fingerprint(signal);verifiedHashes.set(id,value);return value}finally{await io.close()}}
  for(const scene of declarations){
   this.guard(signal);const row=report.scenes.find(s=>s.sceneId===scene.sceneId)
   if(!row||row.fingerprint!==scene.fingerprint)throw this.blocked('NEWS_PREPARATION_STALE','Use the current scene fingerprint from preflight; do not retry the unchanged declaration.',state.revision,scene.sceneId)
   const previous=state.scenes.find(s=>s.sceneId===scene.sceneId)
   if(actor==='agent'&&previous?.origin==='user')throw new Error('NEWS_PREPARATION_USER_EDITED: Preserve the user preparation record; request a user correction instead of overwriting it.')
   const problems=await this.verifyDeclaration(scene,row.assets,signal,hash)
   if(problems.length)throw this.blocked('NEWS_PREPARATION_EVIDENCE',problems.join(' '),state.revision,scene.sceneId)
   for(const asset of row.assets)if(await hash(asset.artifactId)!==asset.sha256)throw new Error('NEWS_PREPARATION_STALE: Material changed while recording observations.')
  }
  for(const [id,expected]of verifiedHashes){const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{if(await io.fingerprint(signal)!==expected)throw new Error('NEWS_PREPARATION_STALE: Observed material changed before commit.')}finally{await io.close()}}
  const ids=new Set(declarations.map(s=>s.sceneId)),createdAt=new Date().toISOString(),next={...state,enabled:true,scenes:[...state.scenes.filter(s=>!ids.has(s.sceneId)),...declarations.map(scene=>({...scene,origin:actor,capturedRevision:this.draft.revision,createdAt}))]}
  this.guard(signal);return {draftId:this.draft.id,revision:this.draft.revision,recordedSceneIds:[...ids],checklist:this.journal.save(state.revision,next),authority:'agent/user-declared; not independent film review',automaticRetry:false}

 }
 private blocked(code:string,message:string,checklistRevision:number,sceneId:string){return new Error(code+': '+JSON.stringify({code,message,draftId:this.draft.id,revision:this.draft.revision,checklistRevision,sceneId,committed:false,automaticRetry:false,recovery:'Correct the specific editorial/evidence gap or report a deterministic blocker. Do not repeat unchanged record/check requests at the same revision/fingerprint.'}))}
 async requireReady(signal?:AbortSignal){if(!this.required())return;const report=await this.preflight(this.journal.read(),signal);if(!report.ready)throw new Error('NEWS_PREPARATION_REQUIRED: '+JSON.stringify({code:'NEWS_PREPARATION_REQUIRED',draftId:this.draft.id,revision:this.draft.revision,checklistRevision:report.checklistRevision,issues:report.issues.slice(0,8),sceneFingerprints:report.scenes.slice(0,8).map(s=>({sceneId:s.sceneId,fingerprint:s.fingerprint})),committed:false,automaticRetry:false,recovery:'Correct specific editorial/evidence gaps, then use preflight and record-scenes. If revision/fingerprints and errors are unchanged, stop and report the deterministic blocker; do not repeat record/check or create another draft to bypass it.'}))}
 async preflight(state=this.journal.read(),signal?:AbortSignal){
  this.guard(signal);state=this.effective(state);const directory=path.join(this.kernel.projectStore.active().directory,'artifacts'),hashes=new Map<string,string>(),facts=new Map<string,AssetFact>(),sources=new StudioSources(this.kernel),issues:Issue[]=[],rows:{sceneId:string;fingerprint:string;durationSeconds:number;sourceIntervals:{artifactId:string;startSeconds:number;endSeconds:number;kind:'image'|'video'}[];assets:AssetFact[];state:'missing'|'stale'|'unverified'|'verified-by-agent'|'verified-by-user';issues:Issue[]}[]=[];let bytes=0
  const hash=async(id:string)=>{let sha=hashes.get(id);if(sha)return sha;const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{bytes+=io.bytes;if(bytes>512*1024*1024||hashes.size>=128)throw new Error('NEWS_PREPARATION_BUDGET: Segment selected media before checking; 512 MiB /128 files.');sha=await io.fingerprint(signal);hashes.set(id,sha);return sha}finally{await io.close()}}
  for(const [index,scene]of this.draft.scenes.entries()){
   const sceneOffset=this.draft.scenes.slice(0,index).reduce((n,s)=>n+s.durationSeconds,0),globalMedia=(this.draft.layers??[]).filter(l=>!l.hidden&&(l.kind==='video'||l.kind==='image')&&l.startSeconds<sceneOffset+scene.durationSeconds&&l.startSeconds+l.durationSeconds>sceneOffset)
   const sceneIssues:Issue[]=[],add=(code:string,message:string)=>sceneIssues.push({sceneId:scene.id,code,message}),visuals=sceneVisuals(scene),ids=[...new Set([...visuals.flatMap(v=>[v.videoArtifactId,v.imageArtifactId]),...(scene.layers??[]).filter(l=>!l.hidden).map(l=>l.artifactId),...globalMedia.map(l=>l.artifactId),...cardImageAssets(scene.cardSpec?.version===2?scene.cardSpec:undefined)].filter((id):id is string=>Boolean(id)))],assets:AssetFact[]=[],citations:unknown[]=[]
   if(!scene.citations?.length)add('citation-missing','Bind exact current-draft citations before narration or render.')
   for(const citation of scene.citations??[])try{const c=await sources.citation(citation,signal);citations.push({citation:c.citation,url:c.url,title:c.title,author:c.author,publishedAt:c.publishedAt,eventAt:c.eventAt,eventTimeOrigin:c.eventTimeOrigin,contentId:c.contentId})}catch(error){signal?.throwIfAborted();add('citation-unavailable',error instanceof Error?error.message:String(error))}
   for(const artifactId of ids)try{
    let fact=facts.get(artifactId)
    if(!fact){const sha256=await hash(artifactId),video=visuals.some(v=>v.videoArtifactId===artifactId)||[...(scene.layers??[]),...globalMedia].some(l=>l.kind==='video'&&l.artifactId===artifactId)
     fact={artifactId,sha256,kind:video?'video':'image'}
     if(video){const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId},signal)),track=info.tracks.find(t=>t.type==='video'&&t.canDecode),audio=info.tracks.find(t=>t.type==='audio'&&t.canDecode);if(!track)throw new Error('No decodable video track.');Object.assign(fact,{durationSeconds:track.endSeconds??info.durationSeconds,startSeconds:Math.max(0,track.startSeconds??0),endSeconds:track.endSeconds??info.durationSeconds,...(audio?{audioStartSeconds:Math.max(0,audio.startSeconds??0),audioEndSeconds:audio.endSeconds??info.durationSeconds}:{})})}facts.set(artifactId,fact)
    }assets.push(fact)
   }catch(error){signal?.throwIfAborted();if(error instanceof Error&&error.message.startsWith('NEWS_PREPARATION_BUDGET'))throw error;add('asset-unavailable',`Actual material unavailable: ${artifactId}.`)}
   if(!assets.length)add('material-missing','A visual brief or text card is not prepared media.')
   for(const visual of visuals){const fact=assets.find(a=>a.artifactId===visual.videoArtifactId);if(fact&&(visual.sourceStartSeconds<(fact.startSeconds??0)-.001||visual.sourceStartSeconds+visual.durationSeconds*visual.playbackRate>(fact.endSeconds??0)+.001))add('source-range','Selected video does not cover its actual scene interval; a held frame is not moving footage.')}
   let content:ReturnType<typeof preparationSceneContent>|undefined
   try{content=preparationSceneContent(scene)}catch(error){signal?.throwIfAborted();add('render-projection-invalid','Current caption/focus/cue projection is unavailable: '+(error instanceof Error?error.message:String(error)).slice(0,1000))}
   // An invalid projection has no admissible 64-character scene fingerprint.
   // Read-only diagnostics stay available; recording and render remain blocked.
   const fingerprint=content?productionHash({draftId:this.draft.id,scene:content,settings:[this.draft.width,this.draft.height,this.draft.fps,this.draft.watermark,this.draft.layers],order:this.draft.scenes.map(s=>s.id),assets,citations}):'',saved=state.scenes.find(s=>s.sceneId===scene.id)
   let status:typeof rows[number]['state']=!content?'unverified':saved?saved.fingerprint===fingerprint?saved.origin==='user'?'verified-by-user':'verified-by-agent':'stale':'missing'
   if(!saved)add('checklist-missing','Record observed material/relevance/date/original-speech preparation for this scene.')
   else if(saved.fingerprint!==fingerprint)add('checklist-stale','Script, material, citation, range, framing or order changed; review the current preparation.')
   else {for(const message of await this.verifyDeclaration(saved,assets,signal,hash))add('evidence-unverified',message);if(sceneIssues.length)status='unverified'}
   if(sceneOffset<3||index>=this.draft.scenes.length-2){let covered=0;const required=Math.max(index>=this.draft.scenes.length-2?scene.durationSeconds:0,Math.max(0,Math.min(3-sceneOffset,scene.durationSeconds)))
    if(index===0&&this.draft.scenes.reduce((n,s)=>n+s.durationSeconds,0)<3)add('opening-short','Opening must contain three continuous seconds of real footage.')
    for(const v of visuals){const length=Math.min(v.durationSeconds,required-covered);if(length<=0)break;const declaration=saved?.materials.find(m=>m.artifactId===v.videoArtifactId);if(!v.videoArtifactId||declaration?.kind!=='real-footage')add('moving-footage-required',index===0?'Opening0–3s needs actual observed real footage.':'Final two scenes need relevant real moving primary footage.');covered+=length}
    if(covered<required-.001)add('moving-coverage','Primary footage does not cover the required opening/closing interval.')
   }
   issues.push(...sceneIssues);rows.push({sceneId:scene.id,fingerprint,durationSeconds:scene.durationSeconds,sourceIntervals:visuals.map(v=>({artifactId:(v.videoArtifactId??v.imageArtifactId)!,startSeconds:v.sourceStartSeconds,endSeconds:v.videoArtifactId?v.sourceStartSeconds+v.durationSeconds*v.playbackRate:v.sourceStartSeconds,kind:v.videoArtifactId?'video':'image'})),assets,state:status,issues:sceneIssues})
  }
  if(!rows.length)issues.push({code:'empty-draft',message:'Prepare actual scenes first.'})
  if(state.originalSpeechRequired&&!state.scenes.some(s=>s.originalSpeech.mode==='source'&&rows.some(r=>r.sceneId===s.sceneId&&r.fingerprint===s.fingerprint&&!r.issues.length)))issues.push({code:'original-speech-missing',message:'This story requires meaningful original speech and Chinese translation in the actual footage.'})
  this.guard(signal);for(const [id,expected]of hashes){const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{if(await io.fingerprint(signal)!==expected)throw new Error('NEWS_PREPARATION_STALE: Material changed while checking.')}finally{await io.close()}}
  this.guard(signal);return {draftId:this.draft.id,revision:this.draft.revision,checklistRevision:state.revision,required:this.required(),ready:issues.length===0,scenes:rows,issues,semanticAuthority:'Recorded model/user declarations tied to actual source/frames; no automatic truth/motion certification or final-film approval.',humanListening:'not-performed',requiresIndependentExportReview:true}
 }
 private async verifyDeclaration(scene:NewsScenePreparation,assets:AssetFact[],signal?:AbortSignal,hashInput?:(id:string)=>Promise<string>):Promise<string[]>{
  const issues:string[]=[],directory=path.join(this.kernel.projectStore.active().directory,'artifacts'),hash=hashInput??(async(id:string)=>{const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});try{return await io.fingerprint(signal)}finally{await io.close()}}),actual=this.draft.scenes.find(s=>s.id===scene.sceneId)!
  for(const asset of assets){const material=scene.materials.find(m=>m.artifactId===asset.artifactId);if(!material){issues.push(`Missing observation: ${asset.artifactId}.`);continue}const ref=this.draft.referenceRecords?.find(r=>r.id===material.referenceId)
   if(!ref||ref.sourceArtifactId!==asset.artifactId||ref.sourceSha256!==asset.sha256||ref.kind!==asset.kind||!ref.analysis||ref.analysis.observations.length!==ref.frames.length){issues.push(`Prepare/read/analyze actual reference frames for ${asset.artifactId}.`);continue}
   if(material.kind==='real-footage'&&(asset.kind!=='video'||ref.kind!=='video'||ref.frames.length<3||new Set(ref.frames.map(f=>f.sha256)).size<2))issues.push('A still or identical sampled frames cannot establish real moving footage.')
   for(const frame of ref.frames)if(await hash(frame.artifactId)!==frame.sha256)issues.push('Prepared reference frame changed; obtain fresh evidence.')
   if(material.kind==='real-footage')for(const v of sceneVisuals(actual).filter(v=>v.videoArtifactId===asset.artifactId)){const end=v.sourceStartSeconds+v.durationSeconds*v.playbackRate;if(!ref.frames.some(f=>f.seconds>=v.sourceStartSeconds-.1&&f.seconds<=v.sourceStartSeconds+.2)||!ref.frames.some(f=>f.seconds>=end-.25&&f.seconds<end))issues.push('Reference samples must cover the start and end of the selected source interval, not an unrelated part of the same file.')}
  }
  if(scene.materials.some(m=>!assets.some(a=>a.artifactId===m.artifactId)))issues.push('Checklist names media not actually attached to this scene.')
  const offset=this.draft.scenes.slice(0,this.draft.scenes.indexOf(actual)).reduce((n,s)=>n+s.durationSeconds,0)
  const footnote=actual.cardSpec&&'footnote'in actual.cardSpec&&typeof actual.cardSpec.footnote==='string'?actual.cardSpec.footnote:''
  const dateText=[actual.label??'',footnote,...(actual.layers??[]).filter(l=>l.kind==='text'&&!l.hidden&&l.opacity>0&&l.startSeconds<=0&&l.durationSeconds>=actual.durationSeconds).map(l=>l.text??''),...(this.draft.layers??[]).filter(l=>l.kind==='text'&&!l.hidden&&l.opacity>0&&l.startSeconds<=offset&&l.startSeconds+l.durationSeconds>=offset+actual.durationSeconds).map(l=>l.text??'')].join('\n')
  if(!dateText.includes(scene.dateLabel))issues.push('The declared source/date label must exist in the actual editable scene or film text; a note alone is not a visible label. Check its coverage and phone readability in the export.')
  if(scene.originalSpeech.mode==='source'&&!sceneVisuals(actual).some(v=>{const fact=assets.find(a=>a.artifactId===v.videoArtifactId);return v.videoArtifactId&&v.keepSourceAudio===true&&(v.sourceVolume??1)>0&&fact?.audioEndSeconds!==undefined&&Math.min(fact.audioEndSeconds,v.sourceStartSeconds+v.durationSeconds*v.playbackRate)>Math.max(fact.audioStartSeconds??0,v.sourceStartSeconds)}))issues.push('Original speech is declared but no enabled decodable source audio covers the actual primary footage interval.')
  return issues
 }
}
/** Audio generation/caption evidence can change after preparation; visual/script edits invalidate it. */
export function preparationSceneContent(scene:StudioScene){
 // Resolve the same anchor-driven captions, focus and cues used by preview/export.
 // Evidence receipt dates/ownership alone do not identify rendered content.
 const s=speechScene(scene)
 // A primary visual may be the scene object itself. Hash its editable visual
 // semantics, not derived inspection duration or generated audio/caption evidence.
 // Actual bytes and track bounds are separately pinned in preflight assets.
 const visuals=sceneVisuals(s).map(v=>({videoArtifactId:v.videoArtifactId,imageArtifactId:v.imageArtifactId,sourceStartSeconds:v.sourceStartSeconds,durationSeconds:v.durationSeconds,playbackRate:v.playbackRate,zoom:v.zoom,crop:v.crop,keepSourceAudio:v.keepSourceAudio,sourceVolume:v.sourceVolume,effects:v.effects,focusIntervals:v.focusIntervals,...('effectWindow'in v?{effectWindow:v.effectWindow}:{}),...('transition'in v?{transition:v.transition,transitionSeconds:v.transitionSeconds}:{})}))
 return {id:s.id,title:s.title,label:s.label,narration:s.narration,bullets:s.bullets,bulletRevealSeconds:s.bulletRevealSeconds,durationSeconds:s.durationSeconds,sources:s.sources,citations:s.citations,visuals,layers:s.layers,audioTracks:s.audioTracks,cardSpec:s.cardSpec,cardCues:s.cardCues,presentationWindow:s.presentationWindow,layout:s.layout,sceneTemplate:s.sceneTemplate,endPolicy:s.endPolicy,showSceneNumber:s.showSceneNumber,captions:s.captions?.map(c=>({startSeconds:c.startSeconds,endSeconds:c.endSeconds,text:c.text,translationText:c.translationText})),captionStyle:s.captionStyle,captionDisplay:s.captionDisplay,voiceTiming:s.voiceTiming,voiceSegments:s.voiceSegments,voiceMuted:s.voiceMuted,voiceVolume:s.voiceVolume}
}
