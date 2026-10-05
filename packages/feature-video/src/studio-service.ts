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
import type { VideoSettingsStore } from './video-settings.js'
import path from 'node:path'
import {VideoStudioStore} from './studio-store.js'
import {assertStudioRequest,assertVideoDraft,draftComposition,draftReadiness,narrationSceneDuration,sceneCoverage,studioId} from './studio-contract.js'
import {mediaRecord,finiteNumber} from '../../media-native/src/media-contract.js'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import type {StudioRequest,VideoDraft,StudioReadiness} from './studio-contract.js'
export type {BrowserFeatureHost as StudioKernel} from '@bmw-agent/browser-capability/host'
import type {BrowserSessionOwner,BrowserFeatureHost as StudioKernel} from '@bmw-agent/browser-capability/host'

export class VideoStudioService {
  constructor(readonly kernel:StudioKernel){}
  async execute(raw:unknown,signal?:AbortSignal,owner?:BrowserSessionOwner,actor:'user'|'agent'='agent'):Promise<unknown>{
    if(!owner||owner.projectId!==this.kernel.projectStore.active().id)throw new Error('STUDIO_SESSION_REQUIRED: Video Studio 需要当前 Project 的对话身份。')
    studioId(owner.sessionId)
    const scope={projectId:owner.projectId,sessionId:owner.sessionId}
    const request=assertStudioRequest(raw),result=await this.perform(request,signal,scope,actor)
    if(['align-speech','correct-speech','create','delete','update','attach','narrate','narrate-pending','render','export-cover','configure','save-template'].includes(request.operation))this.kernel.videoStudioChanged?.(scope)
    return result
  }
  private async perform(raw:unknown,signal:AbortSignal|undefined,owner:BrowserSessionOwner,actor:'user'|'agent'='agent'):Promise<unknown>{
    const request=assertStudioRequest(raw),project=this.kernel.projectStore.active(),store=new VideoStudioStore(project.directory,owner.sessionId)
    if(project.id!==owner.projectId)throw new Error('Studio Project changed during operation.')
    signal?.throwIfAborted()
    const sources=new StudioSources(this.kernel)
    if(request.operation==='source')return sources.execute(request.sourceRequest,signal)
    if(request.operation==='open'){if(!this.kernel.videoStudioOpen)throw new Error('Studio UI is unavailable in this host.');return this.kernel.videoStudioOpen(owner)}
    if(request.operation==='context')return this.kernel.videoStudioContext?.(owner)??{mode:'browser',selection:null}
    if(request.operation==='list'){const drafts=store.list();return {project:{id:project.id,name:project.name},sessionId:owner.sessionId,drafts,reusableExports:Object.fromEntries(drafts.flatMap(draft=>{const output=store.reusableExport(draft);return output?[[draft.id,output.artifactId]]:[]})),videoPreferences:normalizeVideoPreferences(this.kernel.settingsStore?.snapshot().videoPreferences??{})}}
    if(request.operation==='assets')return {assets:store.assets(project.directory)}
    if(request.operation==='create')return store.create(request.title??'新视频',resolveVideoOutput(this.kernel.settingsStore?.snapshot().videoPreferences,request.options??{},request.templateName))
    if(request.operation==='read-material'){
      const asset=store.assets(project.directory).find(asset=>asset.artifactId===request.artifactId&&asset.kind==='text');if(!asset)throw new Error('Choose a Project text material.')
      const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:asset.artifactId})
      try{const bytes=await input.read(0,Math.min(input.bytes,256*1024));signal?.throwIfAborted();return {artifactId:asset.artifactId,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes,{stream:input.bytes>bytes.length}),truncated:input.bytes>bytes.length,bytes:input.bytes}}finally{await input.close()}
    }
    if(request.operation==='inspect'){
      const action=request.assetKind==='image'?'media.image.inspect':'media.inspect',result=await this.kernel.recordingController.processArtifact({action,artifactId:request.artifactId},signal)
      return action==='media.image.inspect'?assertImageInspection(result):assertMediaInspection(result)
    }
    const id=studioId(request.draftId)
    if(request.operation==='read')return store.read(id)
    if(request.operation==='delete')return store.delete(id,request.expectedRevision!)
    if(request.operation==='update'){
      const current=store.read(id);if(current.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 请使用当前草稿版本。')
      const raw=mediaRecord(request.draft),next=assertVideoDraft({...raw,preparation:raw.preparation??current.preparation})
      if(next.preparation.sourceIds?.length){const catalog=sources.port().snapshot();if(next.preparation.sourceIds.some(id=>!catalog.sources.some(source=>source.id===id)))throw new Error('Preparation source does not belong to this Project.')}
      for(const scene of next.scenes)for(const citation of scene.citations??[])await sources.citation(citation,signal)
      for(const artifactId of next.preparation.artifactIds.filter(value=>!current.preparation.artifactIds.includes(value))){signal?.throwIfAborted();const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId});await input.close()}
      if(next.cover?.sourceArtifactId&&next.cover.sourceArtifactId!==current.cover?.sourceArtifactId){const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:next.cover.sourceArtifactId});await input.close()}
      signal?.throwIfAborted()
      return store.update(id,request.expectedRevision,request.draft)
    }
    const draft=store.read(id)
    if(draft.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 请使用当前草稿版本。')
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
      draft.width=output.width;draft.height=output.height;draft.fps=output.fps;draft.music=output.music;draft.style=output.style;draft.tts=output.tts;draft.watermark=output.watermark
      if(output.templateName)draft.templateName=output.templateName;else delete draft.templateName
      return store.update(id,draft.revision,draft)
    }
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
        if(draft.scenes.some(usesStudioSpeech)){
          const scenes=[];let filmStartSeconds=0
          for(const scene of draft.scenes){scenes.push({sceneId:scene.id,filmStartSeconds,origin:usesSpeechCaptions(scene)?scene.speechAnchors!.origin:scene.captions===undefined?'estimated':'independently-edited',...(usesStudioSpeech(scene)?{binding:scene.speechAnchors,links:scene.speechLinks,cues:speechScene(scene).captions,bulletRevealSeconds:speechScene(scene).bulletRevealSeconds,focus:sceneVisuals(speechScene(scene)).map(v=>v.focusIntervals)}:{} )});filmStartSeconds+=scene.durationSeconds}
          provenanceArtifact=await exportProjectText(path.join(project.directory,'artifacts'),'json',JSON.stringify({version:1,draftId:draft.id,revision:draft.revision,captionArtifactId:result.artifactId,format:request.captionFormat,voiceOffsetSeconds:.5,timeDomain:'film-seconds',automaticTimingApproved:false,wordTimingAvailable:false,scenes},null,2)+'\n',signal,()=>this.assertRevision(store,draft))
        }
        await verifyStudioSpeech(draft,path.join(project.directory,'artifacts'),signal);signal?.throwIfAborted();this.assertRevision(store,draft)
        return {...result,draftId:draft.id,revision:draft.revision,type:'subtitles',format:request.captionFormat,contentType:request.captionFormat==='vtt'?'text/vtt':'application/x-subrip',cueCount:document.cueCount,timing:document.timing,...(provenanceArtifact?{provenanceArtifactId:provenanceArtifact.artifactId,sentenceTiming:'edited-audio-anchors'}:{})}
      }catch(error){for(const artifactId of [result.artifactId,provenanceArtifact?.artifactId].filter(Boolean))await fs.rm(path.join(project.directory,'artifacts',artifactId),{force:true});throw error}
    }
    if(request.operation==='narrate-pending'){
      let current=draft
      const pending=draftReadiness(current).pendingNarrationSceneIds,completedSceneIds:string[]=[]
      for(const sceneId of pending){
        signal?.throwIfAborted()
        // Each completed scene is durable. Cancellation/failure stops the remainder;
        // resuming skips current recordings and never replaces concurrent GUI edits.
        const result=await this.perform({operation:'narrate',draftId:id,expectedRevision:current.revision,sceneId},signal,owner) as {draft:VideoDraft}
        current=result.draft;completedSceneIds.push(sceneId);this.kernel.videoStudioChanged?.(owner!)
      }
      signal?.throwIfAborted();this.assertRevision(store,current)
      return {draft:current,completedSceneIds,skippedSceneIds:draft.scenes.filter(scene=>!pending.includes(scene.id)).map(scene=>scene.id)}
    }
    if(request.operation==='render'){
      await verifyStudioSpeech(draft,path.join(project.directory,'artifacts'),signal);this.assertRevision(store,draft)
      const cached=request.forceRender?undefined:store.reusableExport(draft)
      if(cached){signal?.throwIfAborted();this.assertRevision(store,draft);return {draft,export:{...cached,type:'video',contentType:'video/mp4'},reused:true}}
      await this.assertAssets(draft,project.directory,signal)
      signal?.throwIfAborted();this.assertRevision(store,draft)
      const composition=draftComposition(draft)
      const directory=path.join(project.directory,'artifacts'),root=await fs.realpath(directory),rootIdentity=await fs.lstat(directory),before=new Set(await fs.readdir(directory)),created=new Map<string,{dev:number;ino:number}>()
      const result=assertMediaArtifactReceipt(await this.kernel.recordingController.compose(composition,signal))
      let committed=false
      try{
        for(const artifactId of [result.artifactId,...(typeof result.verificationArtifactId==='string'?[result.verificationArtifactId]:[])])if(!before.has(artifactId)){const file=path.join(root,artifactId),stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(stat?.isFile()&&!stat.isSymbolicLink())created.set(file,{dev:stat.dev,ino:stat.ino})}
        signal?.throwIfAborted();if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Studio Project changed during export.');this.assertRevision(store,draft)
        await verifyStudioSpeech(draft,directory,signal);signal?.throwIfAborted();this.assertRevision(store,draft)
        const updated=store.addExport(id,draft.revision,{artifactId:String(result.artifactId),durationSeconds:finiteNumber(result.durationSeconds,'duration',1,180),...(result.verificationArtifactId?{verificationArtifactId:String(result.verificationArtifactId)}:{})})
        committed=true;return {draft:updated,export:result}
      }finally{if(!committed){const current=await fs.lstat(directory);if(current.dev!==rootIdentity.dev||current.ino!==rootIdentity.ino||current.isSymbolicLink()||await fs.realpath(directory)!==root)throw new Error('Export Project changed; cleanup refused.');for(const [file,identity] of created){const stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(stat?.dev===identity.dev&&stat.ino===identity.ino&&!stat.isSymbolicLink())await fs.unlink(file)}}}
    }
    const scene=draft.scenes.find(scene=>scene.id===request.sceneId)
    if(!scene)throw new Error('Unknown Studio scene.')
    if(['align-speech','read-speech','correct-speech'].includes(request.operation))return studioSpeechOperation(this.kernel,store,draft,scene,request,path.join(project.directory,'artifacts'),()=>{if(this.kernel.projectStore.active().id!==owner.projectId)throw new Error('Studio Project changed during speech operation.');this.assertRevision(store,draft)},actor,signal)
    if(request.operation==='suggest-focus'){
      const visual=request.segmentIndex===undefined?scene:scene.visualSegments?.[request.segmentIndex]
      if(!visual?.videoArtifactId)throw new Error('自动焦点需要录制视频；普通图片可手动添加焦点。')
      const artifactId=visual.videoArtifactId,eventsArtifactId=artifactId+'.events.json'
      const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:eventsArtifactId}).catch(()=>{throw new Error('此视频没有可用录制事件，自动建议不可用；可手动添加焦点。')})
      try{
        if(input.bytes>RECORDING_EVENT_BYTES)throw new Error('Recording event byte budget exceeded.')
        const data=await input.read(0,input.bytes);signal?.throwIfAborted();this.assertRevision(store,draft)
        const events=assertRecordingEvents(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)),artifactId)
        return {eventsArtifactId,events,focusIntervals:suggestRecordingFocus(events),draftId:draft.id,revision:draft.revision,manualEditsPreserved:true}
      }finally{await input.close()}
    }
    if(request.operation==='narrate'){
      if(!scene.narration.trim())throw new Error('Write the scene narration first.')
      const base=request.templateName?resolveVideoOutput(this.kernel.settingsStore?.snapshot().videoPreferences,{},request.templateName).tts:draft.tts
      const overrides={...(request.provider!==undefined?{provider:request.provider}:{}),...(request.voice!==undefined?{voice:request.voice}:{}),...(request.ratePercent!==undefined?{ratePercent:request.ratePercent}:{})}
      const tts=assertNarrationOptions(overrides,base);requireNarrationEnabled(tts,this.kernel.settingsStore)
      const result=assertMediaArtifactReceipt(await this.kernel.recordingController.narrate({text:scene.narration,...tts},signal))
      signal?.throwIfAborted()
      draft.tts=tts
      scene.audioGeneration={kind:'tts',options:tts};scene.audioArtifactId=String(result.artifactId);scene.audioText=scene.narration;scene.audioDurationSeconds=finiteNumber(result.durationSeconds,'audio duration',.01,180)
      scene.durationSeconds=narrationSceneDuration(scene,scene.audioDurationSeconds,draft.fps);if(scene.visualSegments)fitVisualSegments(scene.visualSegments,scene.durationSeconds)
      return {draft:store.update(id,draft.revision,draft,true),audio:result}
    }
    if(request.operation==='attach'){
      if(!request.artifactId||!request.assetKind)throw new Error('Choose an artifact and kind.')
      const input=await ArtifactJobIO.open(path.join(project.directory,'artifacts'),{action:'media.inspect',artifactId:request.artifactId});await input.close()
      if(request.segmentIndex!==undefined){
        if(request.assetKind==='audio')throw new Error('A visual segment cannot bind narration.')
        const previous:VisualSegment[]=sceneVisuals(scene).map(segment=>({focusIntervals:segment.focusIntervals,durationSeconds:segment.durationSeconds,imageArtifactId:segment.imageArtifactId,videoArtifactId:segment.videoArtifactId,sourceStartSeconds:segment.sourceStartSeconds,sourceDurationSeconds:segment.sourceDurationSeconds,playbackRate:segment.playbackRate,zoom:segment.zoom,crop:segment.crop,keepSourceAudio:segment.keepSourceAudio,sourceVolume:segment.sourceVolume,transition:'transition' in segment?segment.transition:'cut' as const,transitionSeconds:'transitionSeconds' in segment?segment.transitionSeconds:Math.min(.3,segment.durationSeconds/2)}))
        if(request.segmentIndex>previous.length||previous.length>=8&&request.segmentIndex===previous.length)throw new Error('Unknown or excessive visual segment.')
        const segment:VisualSegment={durationSeconds:scene.durationSeconds,sourceStartSeconds:0,playbackRate:1,zoom:1,transition:'cut' as const,transitionSeconds:.3}
        if(request.assetKind==='image'){assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:request.artifactId},signal));Object.assign(segment,{imageArtifactId:request.artifactId})}
        else{const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:request.artifactId},signal));if(!info.tracks.some(track=>track.type==='video'&&track.canDecode))throw new Error('Artifact has no decodable video.');Object.assign(segment,{videoArtifactId:request.artifactId,sourceDurationSeconds:info.durationSeconds})}
        const appending=request.segmentIndex===previous.length
        if(!appending)segment.durationSeconds=previous[request.segmentIndex].durationSeconds
        previous[request.segmentIndex]=segment;scene.visualSegments=previous
        // Appending evenly allocates the current scene, leaving source speeds intact.
        if(appending)for(const value of previous)value.durationSeconds=scene.durationSeconds/previous.length
        fitVisualSegments(previous,scene.durationSeconds);delete scene.focusIntervals;delete scene.videoArtifactId;delete scene.imageArtifactId;delete scene.sourceDurationSeconds
        signal?.throwIfAborted();return store.update(id,draft.revision,draft,true)
      }
      if(request.assetKind==='image'){assertImageInspection(await this.kernel.recordingController.processArtifact({action:'media.image.inspect',artifactId:request.artifactId},signal));scene.imageArtifactId=request.artifactId;delete scene.videoArtifactId;delete scene.sourceDurationSeconds}
      else {
        const info=assertMediaInspection(await this.kernel.recordingController.processArtifact({action:'media.inspect',artifactId:request.artifactId},signal))
        const tracks=info.tracks as {type:string;canDecode:boolean}[]
        if(!Array.isArray(tracks)||!tracks.some(track=>track.type===request.assetKind&&track.canDecode))throw new Error('Artifact has no decodable selected track.')
        const duration=finiteNumber(info.durationSeconds,'media duration',.01,1800)
        if(request.assetKind==='video'){scene.videoArtifactId=request.artifactId;scene.sourceDurationSeconds=duration;delete scene.imageArtifactId}
        else{scene.audioGeneration={kind:'imported'};scene.audioArtifactId=request.artifactId;scene.audioText=scene.narration;scene.audioDurationSeconds=duration;scene.durationSeconds=narrationSceneDuration(scene,duration,draft.fps);if(scene.visualSegments)fitVisualSegments(scene.visualSegments,scene.durationSeconds)}
      }
      if(request.assetKind!=='audio'){delete scene.visualSegments;delete scene.focusIntervals}
      signal?.throwIfAborted()
      return store.update(id,draft.revision,draft,true)
    }
    throw new Error('Unhandled Studio operation.')
  }
  private assertRevision(store:VideoStudioStore,draft:VideoDraft):void {
    if(store.read(draft.id).revision!==draft.revision)throw new Error('STUDIO_CONFLICT: 检查期间草稿已更新，请重新检查。')
  }
  private async checkDraft(draft:VideoDraft,projectDirectory:string,store:VideoStudioStore,signal?:AbortSignal):Promise<StudioReadiness&{checkedAssets:{artifactId:string;kind:string;verification:'decode'|'tracks';bytes:number;pixels?:number}[];encoding:ReturnType<typeof assertEncodingInspection>}> {
    const checkedAssets:{artifactId:string;kind:string;verification:'decode'|'tracks';bytes:number;pixels?:number}[]=[],failures:StudioReadiness['issues']=[]
    const inspected=new Map<string,Promise<{durationSeconds?:number}>>()
    for(const scene of draft.scenes){
    const references:{id?:string;kind:'video'|'image'|'audio';setDuration:(duration:number|undefined)=>void}[]=sceneVisuals(scene).flatMap(segment=>[
      {id:segment.videoArtifactId,kind:'video' as const,setDuration:(duration:number|undefined)=>{segment.sourceDurationSeconds=duration}},
      {id:segment.imageArtifactId,kind:'image' as const,setDuration:()=>{}}
    ])
    references.push({id:scene.audioArtifactId,kind:'audio',setDuration:duration=>{scene.audioDurationSeconds=duration}})
    for(const {id,kind,setDuration} of references){
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
          const durationSeconds=finiteNumber(info.durationSeconds,'actual duration',.01,1800)
          checkedAssets.push({artifactId:id,kind,verification:'tracks',bytes});return {durationSeconds}
        })();inspected.set(kind+':'+id,pending)
      }
      try{const info=await pending;setDuration(info.durationSeconds)}
      catch{signal?.throwIfAborted();failures.push({code:'asset-unavailable',severity:'error',sceneId:scene.id,artifactId:id,message:`${scene.title}：素材 ${id} 无法读取或不支持解码，请替换素材`})}
    }
    }
    signal?.throwIfAborted();this.assertRevision(store,draft)
    const report=draftReadiness(draft);report.issues.push(...failures)
    try{await verifyStudioSpeech(draft,path.join(projectDirectory,'artifacts'),signal)}catch(error){signal?.throwIfAborted();report.issues.push({code:'speech-anchors',severity:'error',message:error instanceof Error?error.message:String(error)})}
    if([...new Map(checkedAssets.map(asset=>[asset.artifactId,asset.bytes])).values()].reduce((sum,bytes)=>sum+bytes,0)>DECODE_BUDGET.assetBytes||checkedAssets.reduce((sum,asset)=>sum+(asset.pixels??0),0)>DECODE_BUDGET.imagePixels)report.issues.push({code:'asset-budget',severity:'error',message:'全片素材超过 256 MiB 或图片解码超过 32 百万像素，请减少素材。'})
    const encoding=assertEncodingInspection(await this.kernel.recordingController.processArtifact({action:'media.encode.check',width:draft.width,height:draft.height,fps:draft.fps},signal))
    signal?.throwIfAborted();this.assertRevision(store,draft)
    if(!encoding.videoSupported||!encoding.audioSupported)report.issues.push({code:'encoding-unavailable',severity:'error',message:'此设备不支持当前参数的 H.264/AAC 编码，请调整视频参数。'})
    report.ready=!report.issues.some(issue=>issue.severity==='error')
    return {...report,checkedAssets,encoding}
  }
  private async assertAssets(draft:VideoDraft,projectDirectory:string,signal?:AbortSignal):Promise<void>{
    const report=await this.checkDraft(draft,projectDirectory,new VideoStudioStore(projectDirectory),signal)
    const errors=report.issues.filter(issue=>issue.severity==='error')
    if(errors.length)throw new Error(errors.map(issue=>issue.message).join('\n'))
  }
}
const services=new WeakMap<object,VideoStudioService>()
export function studioService(kernel:StudioKernel):VideoStudioService {let service=services.get(kernel);if(!service){service=new VideoStudioService(kernel);services.set(kernel,service)}return service}
