import {videoDocumentFromDraft,videoDraftFromDocument} from './video-document.js'
import type {VideoDocument} from './video-document.js'
import {assertReferenceRecords} from './studio-reference-contract.js'
import type {StudioReferenceRecord} from './studio-reference-contract.js'
import {assertStudioReviewItems} from './studio-review.js'
import type {StudioReviewItem} from './studio-review.js'
import {captureStudioSpeechOrigin,studioSpeechOriginClock} from './studio-speech-origin.js'
import {splitStudioScene} from './studio-scene-split.js'
import type {StudioMainResult} from './studio-main-edits.js'
import {assertComposition} from '../../media-native/src/composition-contract.js'
import {assertMediaArtifactReceipt} from '@bmw-agent/media-native/port'
import {compositionAssets} from '@bmw-agent/media-native/composition'
import type {VideoCoverOptions} from '@bmw-agent/media-native/cover'
import { finiteNumber, mediaRecord } from '../../media-native/src/media-contract.js'
import { resolveVideoOutput } from '../../media-native/src/video-options.js'
import type { VideoOptions } from '../../media-native/src/video-options.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {assertVideoDraft,draftComposition,studioId,studioText,sameStudioDraftContent} from './studio-contract.js'
import type {StudioSpeechCandidate,StudioSpeechAnchors} from './studio-speech-contract.js'
import {remapSourceSpeech,syncSourceCaptionEdits} from './studio-source-speech-contract.js'
import type {VideoDraft,StudioAsset} from './studio-contract.js'

/** Project-local editable state. No renderer or model may choose a host path. */
export class VideoStudioStore {
  readonly directory:string
  constructor(projectDirectory:string,readonly ownerSessionId?:string,readonly editGuard?:(current:VideoDraft,next:VideoDraft)=>void){
    if(ownerSessionId!==undefined)studioId(ownerSessionId)
    const project=fs.realpathSync(projectDirectory),directory=path.join(project,'video-studio')
    fs.mkdirSync(directory,{recursive:true,mode:0o700})
    if(fs.realpathSync(directory)!==directory||fs.lstatSync(directory).isSymbolicLink())throw new Error('Studio state must stay inside its Project.')
    this.directory=directory
  }
  private file(id:unknown):string{return path.join(this.directory,studioId(id)+'.json')}
  private write(draft:VideoDraft,recovery=false):VideoDraft {
    if(!this.ownerSessionId||draft.ownerSessionId!==this.ownerSessionId)throw new Error('STUDIO_SESSION_REQUIRED: 草稿写入必须有所属对话。')
    const parsed=assertVideoDraft(draft),target=this.file(parsed.id)
    if(fs.existsSync(target)&&!recovery){const current=this.read(parsed.id);if(!sameStudioDraftContent(current,parsed))this.editGuard?.(current,parsed)}
    if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw new Error('Studio draft cannot be a symbolic link.')
    const document=videoDocumentFromDraft(parsed),projected=videoDraftFromDocument(document)
    const ordered=(v:unknown):unknown=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)])):v
    if(JSON.stringify(ordered(parsed))!==JSON.stringify(ordered(projected)))throw new Error('VIDEO_MIGRATION_LOSS: 视频映射遗漏字段，拒绝写入。')
    const encoded=JSON.stringify(document,null,2)+'\n';if(Buffer.byteLength(encoded)>1024*1024)throw new Error('VIDEO_DOCUMENT_BUDGET: 视频文档超过 1 MiB。')
    this.backupLegacy(parsed.id)
    const temporary=path.join(this.directory,crypto.randomUUID()+'.tmp')
    fs.writeFileSync(temporary,encoded,{mode:0o600,flag:'wx'})
    fs.renameSync(temporary,target);return parsed
  }
  list():VideoDraft[]{return fs.readdirSync(this.directory).filter(name=>/^[a-zA-Z0-9-]+\.json$/.test(name)).slice(0,100).map(name=>this.readFile(name.slice(0,-5))).filter(draft=>this.ownerSessionId===undefined||draft.ownerSessionId===this.ownerSessionId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
  read(id:unknown):VideoDraft {
    const draft=this.readFile(id)
    if(this.ownerSessionId!==undefined&&draft.ownerSessionId!==this.ownerSessionId)throw new Error('STUDIO_SESSION_MISMATCH: 草稿不属于当前对话。')
    return draft
  }
  private readFile(id:unknown):VideoDraft {
    const file=this.file(id),stat=fs.lstatSync(file)
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error('Invalid Studio draft file.')
    const raw=JSON.parse(fs.readFileSync(file,'utf8')),draft=raw.version===1?assertVideoDraft(raw):videoDraftFromDocument(raw)
    if(draft.id!==id)throw new Error('Studio draft identity mismatch.')
    return draft
  }
  readDocument(id:string):VideoDocument{return videoDocumentFromDraft(this.read(id))}
  private backupLegacy(id:string):void {
    const file=this.file(id);if(!fs.existsSync(file))return
    const raw=fs.readFileSync(file);if(JSON.parse(raw.toString('utf8')).version!==1)return
    const directory=path.join(this.directory,'schema-backups');fs.mkdirSync(directory,{recursive:true,mode:0o700})
    if(fs.lstatSync(directory).isSymbolicLink()||fs.realpathSync(directory)!==directory)throw new Error('Video schema backups must stay inside Project.')
    const backup=path.join(directory,id+'-v1-'+crypto.createHash('sha256').update(raw).digest('hex')+'.json')
    try{fs.writeFileSync(backup,raw,{mode:0o600,flag:'wx'})}catch(error){if(error.code!=='EEXIST'||fs.lstatSync(backup).isSymbolicLink()||!fs.readFileSync(backup).equals(raw))throw error}
  }
  migrateDocument(id:string,revision:number):{draft:VideoDraft;document:VideoDocument;migrated:boolean} {
    const draft=this.read(id);if(draft.revision!==revision)throw new Error('STUDIO_CONFLICT: 迁移需要当前版本。')
    const legacy=JSON.parse(fs.readFileSync(this.file(id),'utf8')).version===1
    if(legacy)this.write(draft)
    return {draft,document:this.readDocument(id),migrated:legacy}
  }
  create(title:unknown,options?:VideoOptions&{width:number;height:number;templateName?:string}):VideoDraft {
    if(!this.ownerSessionId)throw new Error('STUDIO_SESSION_REQUIRED: 创建草稿需要绑定对话。')
    if(fs.readdirSync(this.directory).filter(name=>/^[a-zA-Z0-9-]+\.json$/.test(name)).length>=100)throw new Error('A Project supports at most one hundred video drafts.')
    const output=options??resolveVideoOutput({})
    return this.write({version:1,id:crypto.randomUUID(),ownerSessionId:this.ownerSessionId,revision:1,title:studioText(title,'title',80)||'新视频',width:output.width,height:output.height,fps:output.fps,music:output.music,...(output.cardLayout===undefined?{}:{cardLayout:output.cardLayout}),...(output.narrationPacing===undefined?{}:{narrationPacing:output.narrationPacing}),tts:output.tts,style:output.style,watermark:output.watermark,...(output.templateName?{templateName:output.templateName}:{}),scenes:[],preparation:{notes:'',outline:'',artifactIds:[]},updatedAt:new Date().toISOString(),exports:[]})
  }
  /** Save a host-completed direct composition without overwriting any existing draft. */
  addComposition(raw:unknown,receipt:unknown):VideoDraft {
    if(!this.ownerSessionId)throw new Error('STUDIO_SESSION_REQUIRED: 成片草稿需要绑定对话。')
    const composition=assertComposition(raw),output=assertMediaArtifactReceipt(receipt)
    if(composition.scenes.some(scene=>scene.bulletRevealSeconds!==undefined))throw new Error('Direct bullet reveal timing cannot be imported into editable Studio anchors.')
    if(fs.readdirSync(this.directory).filter(name=>/^[a-zA-Z0-9-]+\.json$/.test(name)).length>=100)throw new Error('A Project supports at most one hundred video drafts.')
    const measured=output.narrationDurations
    if(measured!==undefined&&(!Array.isArray(measured)||measured.length!==composition.scenes.length))throw new Error('Invalid composition narration measurements.')
    const scenes=composition.scenes.map((scene,index)=>({...scene,id:crypto.randomUUID(),visualBrief:'',sources:[],endPolicy:'hold',...(scene.audioArtifactId?{audioText:scene.narration,audioGeneration:{kind:'imported'},...(Array.isArray(measured)?{audioDurationSeconds:finiteNumber(measured[index],'audio duration',.01,180)}:{})}:{})}))
    const createdAt=new Date().toISOString()
    const draft=assertVideoDraft({...composition,version:1,id:crypto.randomUUID(),ownerSessionId:this.ownerSessionId,revision:1,scenes,preparation:{notes:'由已完成的直接合成恢复。保留原分镜、音频、画面和成片；已有音频作为导入素材，未推断生成参数。直接合成的画面末帧停留策略已保留。',outline:'',artifactIds:compositionAssets(composition)},updatedAt:createdAt,exports:[]})
    const completed={artifactId:output.artifactId,durationSeconds:output.durationSeconds,...(typeof output.verificationArtifactId==='string'?{verificationArtifactId:output.verificationArtifactId}:{})}
    const fingerprint=this.exportFingerprint(draft,completed)
    // Admit the entire draft and completed export atomically: no empty draft on failure.
    draft.exports=[{...completed,...(fingerprint?{fingerprint}:{}),revision:1,createdAt}]
    return this.write(draft)
  }
  update(id:unknown,expectedRevision:unknown,raw:unknown,trustedAudio=false,trustedCaptions=false,reviewItems?:StudioReviewItem[],dryRun=false):VideoDraft {
    const current=this.read(id)
    if(current.revision!==expectedRevision)throw new Error('STUDIO_CONFLICT: 草稿已被其他编辑更新，请重新加载后合并修改。')
    const value=mediaRecord(raw)
    if(!this.ownerSessionId||!current.ownerSessionId)throw new Error('STUDIO_SESSION_REQUIRED: 编辑草稿需要绑定对话。')
    if(value.ownerSessionId!==undefined&&value.ownerSessionId!==current.ownerSessionId)throw new Error('STUDIO_SESSION_MISMATCH: 草稿所属对话不可修改。')
    const scenes=Array.isArray(value.scenes)?value.scenes.map(raw=>{const supplied=mediaRecord(raw),previous=current.scenes.find(scene=>scene.id===supplied.id)
      // Raw updates cannot mint or reset a host-derived presentation origin.
      const reset=trustedAudio&&previous?.presentationWindow&&supplied.audioArtifactId!==previous.audioArtifactId
      const window=reset?{...previous.presentationWindow!,originId:crypto.randomUUID(),startSeconds:0,durationSeconds:supplied.durationSeconds}:previous?.presentationWindow
      const input:Record<string,unknown>={...supplied,presentationWindow:window,speechPlaybackOrigin:previous&&(previous.audioArtifactId===supplied.audioArtifactId||!Object.hasOwn(supplied,'audioArtifactId')&&supplied.narration===previous.narration)?previous.speechPlaybackOrigin:undefined}
      if(previous?.audioArtifactId&&!Object.hasOwn(supplied,'audioArtifactId')&&supplied.narration===previous.narration){input.audioArtifactId=previous.audioArtifactId;input.audioText=previous.audioText;input.audioDurationSeconds=previous.audioDurationSeconds}
      if(previous&&!Object.hasOwn(input,'voiceSegments')&&!Object.hasOwn(input,'voiceTiming')&&(input.audioArtifactId===previous.audioArtifactId||!Object.hasOwn(input,'audioArtifactId')&&input.narration===previous.narration))return {...input,audioArtifactId:input.audioArtifactId??previous.audioArtifactId,voiceTiming:previous.voiceTiming,voiceSegments:previous.voiceSegments}
      return input
    }):value.scenes
    const next=assertVideoDraft({...value,cardLayout:value.cardLayout===undefined?current.cardLayout:value.cardLayout,narrationPacing:value.narrationPacing===undefined?current.narrationPacing:value.narrationPacing,scenes,ownerSessionId:current.ownerSessionId,preparation:value.preparation===undefined?current.preparation:value.preparation,tts:value.tts===undefined?current.tts:value.tts,cover:value.cover===undefined?current.cover:value.cover,layers:Object.hasOwn(value,'layers')?value.layers:current.layers,audioTracks:Object.hasOwn(value,'audioTracks')?value.audioTracks:current.audioTracks})
    if(next.id!==current.id||next.revision!==current.revision)throw new Error('Draft update must use its current identity and revision.')
    // Visual edits may omit generated speech metadata. Keep the measured binding
    // for the same scene/script; a rewritten script still needs new narration.
    for(const scene of next.scenes){
      const previous=current.scenes.find(value=>value.id===scene.id)
      for(const cue of scene.captions??[]){const old=previous?.captions?.find(old=>old.text===cue.text&&old.startSeconds===cue.startSeconds&&old.endSeconds===cue.endSeconds)??previous?.captions?.find(old=>old.text===cue.text);if(cue.translationText!==old?.translationText){if(!trustedCaptions&&old?.translationOrigin==='user-edited')throw new Error('STUDIO_TRANSLATION_EDITED: 保留用户校正的译文。');cue.translationOrigin=trustedCaptions?'user-edited':'agent-edited'}else cue.translationOrigin=old?.translationOrigin}
      scene.speechCandidate=previous?.speechCandidate;scene.speechAnchors=previous?.speechAnchors
      const inputScene=(value.scenes as Record<string,unknown>[]).find(item=>item.id===scene.id)
      if(!Object.hasOwn(inputScene,'voiceMuted'))scene.voiceMuted=previous?.voiceMuted
      if(!Object.hasOwn(inputScene,'layers'))scene.layers=previous?.layers
      if(!Object.hasOwn(inputScene,'audioTracks'))scene.audioTracks=previous?.audioTracks
      // Sandboxed GUI snapshots can explicitly carry undefined over structured IPC.
      // That clears a newly attached voice on undo; omitted model fields retain it.
      if(!scene.audioArtifactId&&!Object.hasOwn(inputScene,'audioArtifactId')&&previous?.audioArtifactId&&scene.narration===previous.narration){
        scene.audioArtifactId=previous.audioArtifactId;scene.audioText=previous.audioText;scene.audioDurationSeconds=previous.audioDurationSeconds
      }
      if(scene.audioArtifactId){
        if(previous?.audioArtifactId===scene.audioArtifactId){
          if(!trustedAudio){scene.audioText=previous.audioText;scene.audioDurationSeconds=previous.audioDurationSeconds}
          if(!trustedAudio||!scene.audioGeneration)scene.audioGeneration=previous.audioGeneration??{kind:'legacy',options:current.tts!}
        }else if(!trustedAudio){scene.audioGeneration={kind:'imported'}}
      }else{delete scene.audioGeneration;delete scene.audioText;delete scene.audioDurationSeconds}
      remapSourceSpeech(previous,scene)
    }
    // The export journal belongs to completed jobs, not editable input.
    next.referenceRecords=current.referenceRecords;next.reviewItems=reviewItems===undefined?current.reviewItems:assertStudioReviewItems(reviewItems);next.exports=current.exports;next.coverExports=current.coverExports
    this.editGuard?.(current,next)
    if(dryRun)return next
    next.revision++;next.updatedAt=new Date().toISOString()
    return this.write(next)
  }
  recordReference(id:string,expectedRevision:number,records:StudioReferenceRecord[]):VideoDraft {
    const current=this.read(id);if(current.revision!==expectedRevision)throw new Error('STUDIO_CONFLICT: 参考分析需要当前草稿版本。')
    current.referenceRecords=assertReferenceRecords(records);current.revision++;current.updatedAt=new Date().toISOString();return this.write(current)
  }
  /** Host-only journal admission; ordinary update/restore never mint review items. */
  recordReview(id:string,expectedRevision:number,items:StudioReviewItem[]):VideoDraft {
    const current=this.read(id);if(current.revision!==expectedRevision)throw new Error('STUDIO_CONFLICT: 审阅需要当前草稿版本。')
    current.reviewItems=assertStudioReviewItems(items);current.revision++;current.updatedAt=new Date().toISOString();return this.write(current)
  }
  splitScene(id:string,expectedRevision:number,sceneId:string,splitSeconds:number):StudioMainResult {
    const current=this.read(id)
    if(current.revision!==expectedRevision)throw new Error('STUDIO_CONFLICT: 分割需要当前草稿版本。')
    const result=splitStudioScene(current,sceneId,splitSeconds)
    result.draft.revision=current.revision+1;result.draft.updatedAt=new Date().toISOString()
    result.draft=this.write(result.draft);return result
  }
  /** Only the service's verified host snapshot route may restore trusted metadata. */
  restoreSnapshot(id:string,expectedRevision:number,snapshot:VideoDraft):VideoDraft {
    const current=this.read(id)
    if(current.revision!==expectedRevision)throw new Error('STUDIO_CONFLICT: 历史恢复需要当前草稿版本。')
    const restored=assertVideoDraft(snapshot)
    if(restored.id!==current.id||restored.ownerSessionId!==current.ownerSessionId||restored.ownerSessionId!==this.ownerSessionId)throw new Error('STUDIO_SESSION_MISMATCH: 历史快照的草稿或对话身份不同。')
    restored.referenceRecords=current.referenceRecords;restored.reviewItems=current.reviewItems;restored.exports=current.exports;restored.coverExports=current.coverExports;restored.revision=current.revision+1;restored.updatedAt=new Date().toISOString()
    return this.write(restored,true)
  }
  setSourceSpeech(id:string,revision:number,sceneId:string,change:(scene:VideoDraft['scenes'][number])=>void):VideoDraft{const current=this.read(id);if(current.revision!==revision)throw new Error('STUDIO_CONFLICT: 原声字幕期间草稿变化。');const scene=current.scenes.find(s=>s.id===sceneId);if(!scene)throw new Error('Unknown Studio scene.');const previous=structuredClone(scene);change(scene);syncSourceCaptionEdits(previous,scene);current.revision++;current.updatedAt=new Date().toISOString();return this.write(current)}
  setSpeech(id:string,expectedRevision:number,sceneId:string,kind:'candidate'|'anchors',record:StudioSpeechCandidate|StudioSpeechAnchors):VideoDraft {
    const current=this.read(id);if(current.revision!==expectedRevision)throw new Error('STUDIO_CONFLICT: 语音校正期间草稿已更新。')
    const scene=current.scenes.find(scene=>scene.id===sceneId);if(!scene)throw new Error('Unknown Studio scene.')
    if(kind==='candidate')scene.speechCandidate=record as StudioSpeechCandidate;else{scene.speechAnchors=record as StudioSpeechAnchors;if(scene.speechPlaybackOrigin&&studioSpeechOriginClock(scene)!==scene.speechPlaybackOrigin.clock){delete scene.speechPlaybackOrigin;scene.speechPlaybackOrigin=captureStudioSpeechOrigin(scene)}}
    current.revision++;current.updatedAt=new Date().toISOString();return this.write(current)
  }
  delete(id:string,expectedRevision:number):{deleted:string} {
    const current=this.read(id)
    if(!this.ownerSessionId||!current.ownerSessionId)throw new Error('STUDIO_SESSION_REQUIRED: 删除草稿需要绑定对话。')
    if(current.revision!==expectedRevision)throw new Error('STUDIO_CONFLICT: 草稿已更新，请重新加载后删除。')
    const directory=path.join(this.directory,'deleted');fs.mkdirSync(directory,{recursive:true,mode:0o700})
    if(fs.realpathSync(directory)!==directory||fs.lstatSync(directory).isSymbolicLink())throw new Error('Deleted drafts must stay inside their Project.')
    fs.renameSync(this.file(id),path.join(directory,id+'-'+crypto.randomUUID()+'.json'))
    return {deleted:id}
  }
  addExport(id:string,expectedRevision:number,result:{artifactId:string;durationSeconds:number;verificationArtifactId?:string}):VideoDraft {
    const current=this.read(id)
    if(current.revision!==expectedRevision)throw new Error('Export completed for an older draft; do not attach it to a newer version.')
    const fingerprint=this.exportFingerprint(current,result)
    current.exports=[...current.exports.slice(-29),{...result,...(fingerprint?{fingerprint}:{}),revision:expectedRevision,createdAt:new Date().toISOString()}]
    current.revision++;current.updatedAt=new Date().toISOString();return this.write(current)
  }
  reusableExport(draft:VideoDraft):VideoDraft['exports'][number]|undefined {
    return [...draft.exports].reverse().find(output=>output.fingerprint!==undefined&&output.fingerprint===this.exportFingerprint(draft,output))
  }
  private exportFingerprint(draft:VideoDraft,output:{artifactId:string;verificationArtifactId?:string}):string|undefined {
    try {
      const composition=draftComposition(draft),directory=path.join(path.dirname(this.directory),'artifacts')
      if(fs.realpathSync(directory)!==directory||fs.lstatSync(directory).isSymbolicLink())return undefined
      const ids=[...new Set([...compositionAssets(composition),output.artifactId,...(output.verificationArtifactId?[output.verificationArtifactId]:[])])].sort()
      const assets=ids.map(id=>{const stat=fs.lstatSync(path.join(directory,id),{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1n)throw new Error('Export material unavailable.');return [id,String(stat.size),String(stat.mtimeNs),String(stat.ctimeNs),String(stat.ino)]})
      const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)])):value
      return crypto.createHash('sha256').update(JSON.stringify(canonical({composition,assets}))).digest('hex')
    }catch{return undefined}
  }
  addCoverExport(id:string,expectedRevision:number,result:{artifactId:string;width:number;height:number;actualTimestampSeconds?:number},options:VideoCoverOptions):VideoDraft {
    const current=this.read(id)
    if(current.revision!==expectedRevision)throw new Error('STUDIO_CONFLICT: 封面制作期间草稿已变化，请重新生成。')
    current.cover=options;current.coverExports=[...(current.coverExports??[]).slice(-29),{...result,options,revision:expectedRevision,createdAt:new Date().toISOString()}]
    current.revision++;current.updatedAt=new Date().toISOString();return this.write(current)
  }
  assets(projectDirectory:string):StudioAsset[]{
    const expected=path.join(fs.realpathSync(projectDirectory),'artifacts'),directory=fs.realpathSync(expected)
    if(directory!==expected||fs.lstatSync(expected).isSymbolicLink())throw new Error('Assets must stay inside their Project.')
    return fs.readdirSync(directory).slice(0,1000).flatMap(artifactId=>{
      const suffix=path.extname(artifactId).toLowerCase(),kind:StudioAsset['kind']|undefined=['.png','.jpg','.jpeg','.webp'].includes(suffix)?'image':['.wav','.mp3','.ogg','.flac','.m4a'].includes(suffix)?'audio':['.mp4','.webm','.mov','.mkv'].includes(suffix)?'video':['.txt','.md','.srt','.vtt','.json'].includes(suffix)?'text':undefined
      if(!kind)return []
      const stat=fs.lstatSync(path.join(directory,artifactId));if(!stat.isFile()||stat.isSymbolicLink())return []
      return [{artifactId,bytes:stat.size,kind,modifiedAt:stat.mtime.toISOString()}]
    })
  }
}
