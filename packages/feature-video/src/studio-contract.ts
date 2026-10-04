import {assertCoverOptions,assertCoverReceipt} from '../../media-native/src/media/processing.cover-contract.js'
import type {VideoCoverOptions} from '../../media-native/src/media/processing.cover-contract.js'
import {sceneVisuals,fitVisualSegments} from '../../media-native/src/visual-segments.js'
import {assertNarrationOptions,NARRATION_PROVIDERS,NARRATION_VOICES} from '../../media-native/src/narration-contract.js'
import type {NarrationOptions} from '../../media-native/src/narration-contract.js'
import { assertVideoOverrides, templateName } from '../../media-native/src/video-options.js'
import type { VideoOptions, VideoWatermark, VideoPreferences, VideoOptionOverrides } from '../../media-native/src/video-options.js'
import { assertArtifactId, finiteNumber, mediaRecord } from '../../media-native/src/media-contract.js'
import { assertComposition } from '../../media-native/src/composition-contract.js'
import type { MediaComposition, CompositionScene } from '../../media-native/src/composition-contract.js'

export type AudioGeneration = {kind:'tts'|'legacy';options:NarrationOptions}|{kind:'imported'}
export interface StudioScene extends CompositionScene {
  audioGeneration?:AudioGeneration
  id: string
  visualBrief: string
  sources: string[]
  audioText?: string
  audioDurationSeconds?: number
  sourceDurationSeconds?: number
  endPolicy: 'require-footage' | 'hold'
}
export interface CoverExport {artifactId:string;width:number;height:number;revision:number;createdAt:string;options:VideoCoverOptions;actualTimestampSeconds?:number}
export interface VideoDraft {
  version: 1; id: string; ownerSessionId?:string; revision: number; title: string
  width: number; height: number; fps: number; music: boolean
  tts?:NarrationOptions; style?:VideoOptions['style']; watermark?:VideoWatermark; templateName?:string
  scenes: StudioScene[]; updatedAt: string
  cover?:VideoCoverOptions; coverExports?:CoverExport[]
  preparation:StudioPreparation
  exports: {artifactId: string; verificationArtifactId?:string; fingerprint?:string; revision: number; createdAt: string; durationSeconds: number}[]
}
export interface StudioPreparation {notes:string;outline:string;artifactIds:string[]}
export interface StudioAsset {artifactId: string; bytes: number; kind: 'video'|'audio'|'image'|'text'; modifiedAt: string}
export interface StudioState {project: {id:string;name:string}; sessionId?:string; drafts: VideoDraft[]; assets: StudioAsset[]; theme:'light'|'dark';videoPreferences?:VideoPreferences;reusableExports?:Record<string,string>}
export interface StudioRequest {
  operation:'list'|'create'|'read'|'delete'|'update'|'narrate'|'narrate-pending'|'check'|'export-captions'|'export-cover'|'read-material'|'render'|'assets'|'inspect'|'attach'|'open'|'context'|'configure'|'save-template'
  templateName?:string; options?:VideoOptionOverrides
  draftId?: string; expectedRevision?: number; draft?: unknown; title?: string
  cover?:VideoCoverOptions
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
  if(Object.keys(value).some(key=>!keys.includes(key)))throw new TypeError('Unsupported Studio property.')
}
export function assertStudioRequest(raw:unknown):StudioRequest {
  const value=mediaRecord(raw)
  closed(value,['operation','draftId','expectedRevision','draft','title','sceneId','artifactId','assetKind','ratePercent','templateName','options','provider','voice','captionFormat','segmentIndex','cover','forceRender'])
  if(!['list','create','read','delete','update','narrate','narrate-pending','check','export-captions','export-cover','read-material','render','assets','inspect','attach','open','context','configure','save-template'].includes(String(value.operation)))throw new TypeError('Unknown Studio operation.')
  const result:StudioRequest={operation:value.operation as StudioRequest['operation']}
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
  if(['narrate-pending','check','delete'].includes(result.operation)){
    closed(value,['operation','draftId','expectedRevision'])
    if(!result.draftId||result.expectedRevision===undefined)throw new TypeError('This Studio operation requires draftId and expectedRevision.')
  }
  if(value.cover!==undefined){if(result.operation!=='export-cover')throw new TypeError('Cover options require export-cover.');result.cover=assertCoverOptions(value.cover)}
  if(result.operation==='export-cover'){closed(value,['operation','draftId','expectedRevision','cover']);if(!result.draftId||!result.expectedRevision)throw new TypeError('Cover export needs draftId and expectedRevision.')}
  if(value.captionFormat!==undefined){if(value.captionFormat!=='srt'&&value.captionFormat!=='vtt')throw new TypeError('Invalid caption format.');result.captionFormat=value.captionFormat}
  if(value.segmentIndex!==undefined)result.segmentIndex=finiteNumber(value.segmentIndex,'segment index',0,7,true)
  if(result.operation==='export-captions'){closed(value,['operation','draftId','expectedRevision','captionFormat']);if(!result.draftId||!result.expectedRevision||!result.captionFormat)throw new TypeError('Caption export needs draftId, expectedRevision and captionFormat.')}
  if(result.operation==='read-material'){closed(value,['operation','artifactId']);if(!result.artifactId)throw new TypeError('Material reading needs artifactId.')}
  if(value.forceRender!==undefined){if(result.operation!=='render'||typeof value.forceRender!=='boolean')throw new TypeError('forceRender requires render and a boolean.');result.forceRender=value.forceRender}
  if(value.draft!==undefined)result.draft=value.draft
  return result
}
const sceneKeys=['id','title','label','narration','visualBrief','sources','durationSeconds','videoArtifactId','imageArtifactId','audioArtifactId','audioText','audioGeneration','audioDurationSeconds','sourceDurationSeconds','sourceStartSeconds','zoom','playbackRate','crop','bullets','endPolicy','layout','voiceVolume','captions','keepSourceAudio','sourceVolume','captionStyle','visualSegments'] as const
export function newStudioScene(id:string,title='新分镜'):StudioScene{return assertStudioScene({id,title,label:'',narration:'',visualBrief:'',sources:[],durationSeconds:8,sourceStartSeconds:0,zoom:1,playbackRate:1,bullets:[],endPolicy:'require-footage'})}
export function assertPreparation(raw:unknown,scenes:StudioScene[]):StudioPreparation{
  const legacy=raw===undefined,value=mediaRecord(raw??{});closed(value,['notes','outline','artifactIds'])
  const artifacts=value.artifactIds??[];if(!Array.isArray(artifacts)||artifacts.length>1000)throw new TypeError('At most one thousand preparation artifacts.')
  const references=scenes.flatMap(scene=>[...sceneVisuals(scene).flatMap(segment=>[segment.imageArtifactId,segment.videoArtifactId]),...(legacy?[scene.audioArtifactId]:[])].filter((id):id is string=>Boolean(id)))
  const artifactIds=[...new Set([...artifacts.map(assertArtifactId),...references])];if(artifactIds.length>1000)throw new TypeError('At most one thousand preparation artifacts.')
  return {notes:studioText(value.notes??'','preparation notes',20000),outline:studioText(value.outline??'','preparation outline',10000),artifactIds}
}
export function assertStudioScene(raw:unknown):StudioScene {
  const value=mediaRecord(raw);closed(value,sceneKeys)
  const compositionScene={...value}
  for(const key of ['id','visualBrief','sources','audioText','audioGeneration','audioDurationSeconds','sourceDurationSeconds','endPolicy'])delete compositionScene[key]
  // A script is allowed to exist before a speech artifact is produced.
  const narration=studioText(value.narration??'','narration',1000)
  compositionScene.narration=''
  const scene=assertComposition({title:'Draft',music:false,scenes:[compositionScene]}).scenes[0]
  if(!Array.isArray(value.sources??[])||(value.sources as unknown[]|undefined)?.length>12)throw new TypeError('At most twelve source links per scene.')
  const sources=((value.sources??[]) as unknown[]).map(raw=>{
    const text=studioText(raw,'source URL',2048),url=new URL(text)
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new TypeError('Sources require public HTTP(S) URLs without credentials.')
    return url.toString()
  })
  if(value.endPolicy!==undefined&&!['require-footage','hold'].includes(String(value.endPolicy)))throw new TypeError('Invalid footage end policy.')
  const result:StudioScene={...scene,id:studioId(value.id),narration,visualBrief:studioText(value.visualBrief??'','visual brief',2000),sources,endPolicy:value.endPolicy==='hold'?'hold':'require-footage'}
  if(value.audioGeneration!==undefined){
    const generation=mediaRecord(value.audioGeneration)
    closed(generation,generation.kind==='imported'?['kind']:['kind','options'])
    if(generation.kind==='imported')result.audioGeneration={kind:'imported'}
    else if(generation.kind==='tts'||generation.kind==='legacy'){
      const options=mediaRecord(generation.options)
      if(['provider','voice','ratePercent'].some(key=>!Object.hasOwn(options,key)))throw new TypeError('Incomplete audio generation parameters.')
      result.audioGeneration={kind:generation.kind,options:assertNarrationOptions(options)}
    }
    else throw new TypeError('Invalid audio generation record.')
  }
  if(value.audioText!==undefined)result.audioText=studioText(value.audioText,'audio text',1000)
  if(value.audioDurationSeconds!==undefined)result.audioDurationSeconds=finiteNumber(value.audioDurationSeconds,'audio duration',.01,180)
  if(value.sourceDurationSeconds!==undefined)result.sourceDurationSeconds=finiteNumber(value.sourceDurationSeconds,'source duration',.01,1800)
  return result
}
export function assertVideoDraft(raw:unknown):VideoDraft {
  const value=mediaRecord(raw);closed(value,['version','id','ownerSessionId','revision','title','width','height','fps','music','style','watermark','templateName','tts','scenes','preparation','updatedAt','exports','cover','coverExports'])
  if(value.version!==1||!Array.isArray(value.scenes)||value.scenes.length>24)throw new TypeError('A Studio draft supports zero to twenty-four scenes.')
  const scenes=value.scenes.map(assertStudioScene)
  if(new Set(scenes.map(scene=>scene.id)).size!==scenes.length)throw new TypeError('Duplicate scene identity.')
  const settings=assertComposition({title:value.title,width:value.width,height:value.height,fps:value.fps,music:value.music,style:value.style,watermark:value.watermark,templateName:value.templateName,scenes:scenes.length?scenes.map(scene=>({title:scene.title,durationSeconds:scene.durationSeconds})):[{title:'Preparation',durationSeconds:1}]})
  if(!Array.isArray(value.exports)||value.exports.length>30)throw new TypeError('Invalid export history.')
  const exports=value.exports.map(raw=>{const item=mediaRecord(raw);closed(item,['artifactId','revision','createdAt','durationSeconds','verificationArtifactId','fingerprint']);if(item.fingerprint!==undefined&&(typeof item.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(item.fingerprint)))throw new TypeError('Invalid export fingerprint.');return {artifactId:assertArtifactId(item.artifactId),...(item.fingerprint?{fingerprint:String(item.fingerprint)}:{}),...(item.verificationArtifactId?{verificationArtifactId:assertArtifactId(item.verificationArtifactId)}:{}),revision:finiteNumber(item.revision,'export revision',1,1_000_000,true),createdAt:studioText(item.createdAt,'export date',40),durationSeconds:finiteNumber(item.durationSeconds,'export duration',1,181)}})
  const coverExports=value.coverExports??[]
  if(!Array.isArray(coverExports)||coverExports.length>30)throw new TypeError('Invalid cover export history.')
  const covers:CoverExport[]=coverExports.map(raw=>{const item=mediaRecord(raw);closed(item,['artifactId','width','height','revision','createdAt','options','actualTimestampSeconds']);const width=finiteNumber(item.width,'cover width',320,1920,true),height=finiteNumber(item.height,'cover height',180,1920,true)
    const receipt=assertCoverReceipt({...item,type:'screenshot',contentType:'image/png'},width,height)
    return {...receipt,revision:finiteNumber(item.revision,'cover revision',1,1_000_000,true),createdAt:studioText(item.createdAt,'cover date',40),options:assertCoverOptions(item.options),...(item.actualTimestampSeconds===undefined?{}:{actualTimestampSeconds:finiteNumber(item.actualTimestampSeconds,'actual cover timestamp',0,1800)})}
  })
  return {version:1,id:studioId(value.id),...(value.ownerSessionId===undefined?{}:{ownerSessionId:studioId(value.ownerSessionId)}),revision:finiteNumber(value.revision,'revision',1,1_000_000,true),title:settings.title,width:settings.width,height:settings.height,fps:settings.fps,music:settings.music,tts:assertNarrationOptions(value.tts??{}),style:settings.style,watermark:settings.watermark,...(settings.templateName?{templateName:settings.templateName}:{}),scenes,preparation:assertPreparation(value.preparation,scenes),cover:assertCoverOptions(value.cover??{title:settings.title}),coverExports:covers,updatedAt:studioText(value.updatedAt,'update date',40),exports}
}
export function sameNarrationOptions(a:NarrationOptions,b:NarrationOptions):boolean {
  return a.provider===b.provider&&a.voice===b.voice&&a.ratePercent===b.ratePercent
}
export function audioGenerationLabel(scene:StudioScene):string {
  const generation=scene.audioGeneration
  if(!scene.audioArtifactId)return '尚未生成'
  if(!generation||generation.kind==='legacy')return '参数未记录'
  if(generation.kind==='imported')return '导入/手动绑定音频'
  const labels:Record<string,string>={'zh-CN-YunxiNeural':'Edge 男声·云希','zh-CN-XiaoxiaoNeural':'Edge 女声·晓晓','local-zh-en':'本地中文/英文'}
  return `${labels[generation.options.voice]} · ${generation.options.ratePercent}%语速`
}
export function sceneCoverage(scene:StudioScene,tts?:NarrationOptions):{required:number;available:number;gap:number;audioStale:boolean} {
  const visuals=sceneVisuals(scene),availability=visuals.map(segment=>segment.imageArtifactId?segment.durationSeconds:Math.max(0,(segment.sourceDurationSeconds??0)-segment.sourceStartSeconds)/segment.playbackRate)
  const available=scene.visualSegments?availability.reduce((sum,seconds,index)=>sum+Math.min(seconds,visuals[index].durationSeconds),0):(availability[0]??0)
  return {required:scene.durationSeconds,available,gap:Math.max(0,scene.durationSeconds-available),audioStale:Boolean((scene.narration||scene.audioText)&&(!scene.audioArtifactId||scene.audioText!==scene.narration))||Boolean(scene.audioArtifactId&&tts&&scene.audioGeneration&&scene.audioGeneration.kind!=='imported'&&!sameNarrationOptions(scene.audioGeneration.options,tts))}
}
export interface StudioIssue {
  code:'empty-draft'|'narration-stale'|'audio-duration'|'footage-gap'|'source-range'|'missing-visual'|'held-frame'|'asset-unavailable'|'asset-budget'|'encoding-unavailable'
  severity:'error'|'warning'; segmentIndex?:number; message:string; sceneId?:string; artifactId?:string
}
export interface StudioReadiness {
  draftId:string; revision:number; ready:boolean; durationSeconds:number; pendingNarrationSceneIds:string[]
  scenes:{sceneId:string;startSeconds:number;endSeconds:number;availableSeconds:number;gapSeconds:number}[]
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
    if(scene.narration.trim()&&coverage.audioStale)pendingNarrationSceneIds.push(scene.id)
    if(coverage.audioStale)issue('narration-stale','旁白尚未生成、脚本已改动或音色/语速已变更')
    if(scene.audioArtifactId&&((scene.audioDurationSeconds??0)>scene.durationSeconds-1||!scene.audioDurationSeconds))issue('audio-duration','分镜必须容纳实测音频及 1 秒留白')
    for(const [segmentIndex,segment] of sceneVisuals(scene).entries()){
      if(!segment.videoArtifactId)continue
      const gap=Math.max(0,segment.durationSeconds-Math.max(0,(segment.sourceDurationSeconds??0)-segment.sourceStartSeconds)/segment.playbackRate),prefix=scene.visualSegments?`片段 ${segmentIndex+1}：`:''
      if(segment.sourceStartSeconds>=(segment.sourceDurationSeconds??0))issue('source-range',prefix+'素材起点必须早于视频结束；请调整起点或更换素材')
      else if(gap>.05){if(scene.endPolicy==='hold')issue('held-frame',prefix+`已选择末帧定格 ${gap.toFixed(1)} 秒`,'warning');else issue('footage-gap',prefix+`需补录 ${gap.toFixed(1)} 秒或明确选择定格`)}
    }
    if(!sceneVisuals(scene).length&&!scene.bullets.length)issue('missing-visual','需要画面素材或标题卡内容')
    const endSeconds=startSeconds+scene.durationSeconds
    scenes.push({sceneId:scene.id,startSeconds,endSeconds,availableSeconds:coverage.available,gapSeconds:coverage.gap});startSeconds=endSeconds
  }
  return {draftId:draft.id,revision:draft.revision,ready:!issues.some(issue=>issue.severity==='error'),durationSeconds:startSeconds,pendingNarrationSceneIds,scenes,issues}
}
export function narrationSceneDuration(scene:StudioScene,audioSeconds:number,fps:number):number {
  // Independent edited captions must survive a shorter regenerated recording.
  return Math.ceil(Math.max(audioSeconds+1,...(scene.captions??[]).map(cue=>cue.endSeconds))*fps)/fps
}
export function draftProblems(draft:VideoDraft):string[] {
  return draftReadiness(draft).issues.filter(issue=>issue.severity==='error').map(issue=>issue.message)
}
export function draftComposition(draft:VideoDraft):MediaComposition {
  const issues=draftProblems(draft);if(issues.length)throw new Error(issues.join('\n'))
  const scenes=draft.scenes.map(scene=>{const value={...scene} as unknown as Record<string,unknown>;for(const key of ['id','visualBrief','sources','audioText','audioGeneration','audioDurationSeconds','sourceDurationSeconds','endPolicy'])delete value[key];return value})
  return assertComposition({title:draft.title,width:draft.width,height:draft.height,fps:draft.fps,music:draft.music,tts:draft.tts,style:draft.style,watermark:draft.watermark,templateName:draft.templateName,scenes})
}
