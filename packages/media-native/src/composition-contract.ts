import {assertFocusIntervals} from './focus-contract.js'
import type {FocusInterval} from './focus-contract.js'
import {assertVisualSegments,sceneVisuals} from './visual-segments.js'
import type {VisualSegment} from './visual-segments.js'
import {assertNarrationOptions} from './narration-contract.js'
import type {NarrationOptions} from './narration-contract.js'
import { assertVideoDimensions, assertWatermark, VIDEO_STYLES, templateName } from './video-options.js'
import type { VideoOptions, VideoWatermark } from './video-options.js'
import { assertArtifactId, finiteNumber, mediaRecord } from './media-contract.js'

/** Closed, seekable composition: no model HTML, script, network URL or host path. */
export interface CompositionScene {
  sceneTemplate?:SceneTemplate
  captionDisplay?:'original'|'translation'|'bilingual'
  showSceneNumber?:boolean
  bulletRevealSeconds?:number[]
  focusIntervals?:FocusInterval[]
  visualSegments?:VisualSegment[]
  durationSeconds: number; title: string; label: string; narration: string
  videoArtifactId?: string; imageArtifactId?: string; audioArtifactId?: string;
  layout?: 'presentation' | 'fullscreen'; voiceVolume?: number; captions?: CaptionCue[]; sourceStartSeconds: number
  zoom: number; playbackRate: number; crop?: {x:number;y:number;width:number;height:number}; bullets: string[]
  keepSourceAudio?:boolean; sourceVolume?:number; captionStyle?:CaptionStyle
}
export interface CaptionCue {startSeconds:number;endSeconds:number;text:string;translationText?:string;translationOrigin?:'user-edited'|'agent-edited'}
export interface SceneTemplate {kind:'summary'|'comparison'|'screenshot';accentColor?:string;backgroundColor?:string;textColor?:string;emphasisIndex?:number}
export const sceneTemplateSchema={type:'object',additionalProperties:false,required:['kind'],properties:{kind:{enum:['summary','comparison','screenshot']},accentColor:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},backgroundColor:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},textColor:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},emphasisIndex:{type:'integer',minimum:0,maximum:2}}}
export function assertSceneTemplate(raw:unknown):SceneTemplate{const v=mediaRecord(raw);keys(v,['kind','accentColor','backgroundColor','textColor','emphasisIndex']);if(!['summary','comparison','screenshot'].includes(String(v.kind)))throw new TypeError('Unsupported scene template.');const result:SceneTemplate={kind:v.kind as SceneTemplate['kind']};for(const k of ['accentColor','backgroundColor','textColor'] as const)if(v[k]!==undefined){if(typeof v[k]!=='string'||!/^#[0-9a-fA-F]{6}$/.test(v[k]))throw new TypeError('Template colors require opaque hex.');result[k]=v[k]}if(v.emphasisIndex!==undefined)result.emphasisIndex=finiteNumber(v.emphasisIndex,'emphasis index',0,2,true);return result}
export function captionText(cue:CaptionCue,mode:CompositionScene['captionDisplay']='bilingual'):string{return mode==='original'?cue.text:mode==='translation'?(cue.translationText??''):cue.translationText?cue.text+'\n'+cue.translationText:cue.text}
export interface CaptionStyle {fontSize:number;color:string;background:'none'|'outline'|'box';position:'top'|'center'|'bottom';align:'left'|'center'|'right';offsetPercent:number}
export const captionStyleSchema={type:'object',additionalProperties:false,required:['fontSize','color','background','position','align','offsetPercent'],properties:{fontSize:{type:'number',minimum:12,maximum:64},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},background:{type:'string',enum:['none','outline','box']},position:{type:'string',enum:['top','center','bottom']},align:{type:'string',enum:['left','center','right']},offsetPercent:{type:'number',minimum:-30,maximum:30}}}
export const sourceAudioProperties={sceneTemplate:sceneTemplateSchema,captionDisplay:{enum:['original','translation','bilingual']},showSceneNumber:{type:'boolean'},keepSourceAudio:{type:'boolean'},sourceVolume:{type:'number',minimum:0,maximum:2},captionStyle:captionStyleSchema}
export function assertCaptionStyle(raw:unknown):CaptionStyle {
  const value=mediaRecord(raw);keys(value,['fontSize','color','background','position','align','offsetPercent'])
  if(typeof value.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value.color)||!['none','outline','box'].includes(String(value.background))||!['top','center','bottom'].includes(String(value.position))||!['left','center','right'].includes(String(value.align)))throw new TypeError('Invalid caption style.')
  return {fontSize:finiteNumber(value.fontSize,'caption font size',12,64),color:value.color,background:value.background as CaptionStyle['background'],position:value.position as CaptionStyle['position'],align:value.align as CaptionStyle['align'],offsetPercent:finiteNumber(value.offsetPercent,'caption offset',-30,30)}
}
export interface MediaComposition {
  title: string; width: number; height: number; fps: number; music: boolean
  tts?:NarrationOptions; style?: VideoOptions['style']; watermark?: VideoWatermark; templateName?: string
  scenes: CompositionScene[]
}
export interface CompositionCommand { token: string; composition: MediaComposition; assets: { artifactId: string; bytes: number }[] }
export interface CompositionBridge {
  onCommand(listener: (value: CompositionCommand) => void): void
  read(token: string, assetIndex: number, offset: number, length: number): Promise<Uint8Array>
  write(token: string, position: number, data: Uint8Array): Promise<void>
  reply(value: unknown): void
}
function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008]/.test(value)) throw new TypeError(`Invalid ${name}.`)
  return value
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError('Unsupported composition property.')
}
export function assertComposition(raw: unknown): MediaComposition {
  const value = mediaRecord(raw)
  keys(value, ['title','width','height','fps','music','style','watermark','templateName','tts','scenes'])
  if (!Array.isArray(value.scenes) || !value.scenes.length || value.scenes.length > 24) throw new TypeError('A composition needs 1 to 24 scenes.')
  if (value.music !== undefined && typeof value.music !== 'boolean') throw new TypeError('music must be boolean.')
  const result: MediaComposition = {
    title: text(value.title, 'title', 80), width: finiteNumber(value.width ?? 1280, 'width', 320, 1920, true),
    height: finiteNumber(value.height ?? 720, 'height', 180, 1920, true), fps: finiteNumber(value.fps ?? 24, 'fps', 12, 30, true),
    music: value.music === undefined ? true : value.music as boolean, scenes: value.scenes.map((rawScene: unknown) => {
      const scene = mediaRecord(rawScene)
      keys(scene,['durationSeconds','title','label','narration','videoArtifactId','imageArtifactId','audioArtifactId','layout','voiceVolume','captions','sourceStartSeconds','zoom','playbackRate','crop','bullets','keepSourceAudio','sourceVolume','captionStyle','visualSegments','focusIntervals','bulletRevealSeconds','showSceneNumber','sceneTemplate','captionDisplay'])
      if (!Array.isArray(scene.bullets ?? []) || (scene.bullets as unknown[] | undefined)?.length > 3) throw new TypeError('At most three scene bullets.')
      const parsed: CompositionScene = {
        durationSeconds: finiteNumber(scene.durationSeconds, 'scene duration', 1, 60),
        title: text(scene.title, 'scene title', 44), label: text(scene.label ?? '', 'scene label', 44),
        narration: text(scene.narration ?? '', 'narration', 1000), sourceStartSeconds: finiteNumber(scene.sourceStartSeconds ?? 0, 'source start', 0, 1800),
        zoom: finiteNumber(scene.zoom ?? 1, 'zoom', 1, 1.5), playbackRate: finiteNumber(scene.playbackRate ?? 1,'playbackRate',.25,2), bullets: ((scene.bullets ?? []) as unknown[]).map(item => text(item, 'bullet', 64))
      }
      if(scene.crop!==undefined){
        const crop=mediaRecord(scene.crop);keys(crop,['x','y','width','height'])
        parsed.crop={x:finiteNumber(crop.x,'crop x',0,.8),y:finiteNumber(crop.y,'crop y',0,.8),width:finiteNumber(crop.width,'crop width',.2,1),height:finiteNumber(crop.height,'crop height',.2,1)}
        if(parsed.crop.x+parsed.crop.width>1 || parsed.crop.y+parsed.crop.height>1)throw new TypeError('Crop must be inside the source frame.')
      }
      if(scene.layout!==undefined){if(!['presentation','fullscreen'].includes(String(scene.layout)))throw new TypeError('Unknown scene layout.');parsed.layout=scene.layout as CompositionScene['layout']}
      if(scene.sceneTemplate!==undefined)parsed.sceneTemplate=assertSceneTemplate(scene.sceneTemplate)
      if(scene.captionDisplay!==undefined){if(!['original','translation','bilingual'].includes(String(scene.captionDisplay)))throw new TypeError('Unsupported caption display.');parsed.captionDisplay=scene.captionDisplay as CompositionScene['captionDisplay']}
      if(scene.showSceneNumber!==undefined){if(typeof scene.showSceneNumber!=='boolean')throw new TypeError('showSceneNumber must be boolean.');parsed.showSceneNumber=scene.showSceneNumber}
      if(scene.voiceVolume!==undefined)parsed.voiceVolume=finiteNumber(scene.voiceVolume,'voice volume',0,2)
      if(scene.keepSourceAudio!==undefined){if(typeof scene.keepSourceAudio!=='boolean')throw new TypeError('keepSourceAudio must be boolean.');parsed.keepSourceAudio=scene.keepSourceAudio}
      if(scene.sourceVolume!==undefined)parsed.sourceVolume=finiteNumber(scene.sourceVolume,'source audio volume',0,2)
      if(scene.focusIntervals!==undefined)parsed.focusIntervals=assertFocusIntervals(scene.focusIntervals)
      if(scene.captionStyle!==undefined)parsed.captionStyle=assertCaptionStyle(scene.captionStyle)
      if(scene.captions!==undefined){
        if(!Array.isArray(scene.captions)||scene.captions.length>100)throw new TypeError('At most one hundred caption cues per scene.')
        parsed.captions=scene.captions.map(raw=>{const cue=mediaRecord(raw);keys(cue,['startSeconds','endSeconds','text','translationText','translationOrigin']);if(cue.translationOrigin!==undefined&&!['user-edited','agent-edited'].includes(String(cue.translationOrigin)))throw new TypeError('Invalid translation origin.');const startSeconds=finiteNumber(cue.startSeconds,'caption start',0,parsed.durationSeconds),endSeconds=finiteNumber(cue.endSeconds,'caption end',0,parsed.durationSeconds);if(endSeconds<=startSeconds)throw new TypeError('Caption end must follow start.');return {startSeconds,endSeconds,text:text(cue.text,'caption',200),...(cue.translationText===undefined?{}:{translationText:text(cue.translationText,'caption translation',200)}),...(cue.translationOrigin===undefined?{}:{translationOrigin:cue.translationOrigin as 'user-edited'|'agent-edited'})}})
        if(parsed.captions.some((cue,index)=>index>0&&cue.startSeconds<parsed.captions![index-1].endSeconds))throw new TypeError('Caption cues must be ordered and nonoverlapping.')
      }
      if(scene.videoArtifactId&&scene.imageArtifactId)throw new TypeError('Choose a video or image, not both.')
      for (const key of ['videoArtifactId','imageArtifactId','audioArtifactId'] as const) if (scene[key] !== undefined) parsed[key] = assertArtifactId(scene[key])
      if (parsed.narration && !parsed.audioArtifactId) throw new TypeError('Narrated scenes require an audio artifact; text is never treated as synthesized speech.')
      if(scene.visualSegments!==undefined){
        if(parsed.focusIntervals?.length)throw new Error('Segmented scenes keep focus on each visual segment.')
        if(parsed.videoArtifactId||parsed.imageArtifactId)throw new Error('Choose scene-level footage or visual segments.')
        parsed.visualSegments=assertVisualSegments(scene.visualSegments,parsed.durationSeconds)
      }
      if(scene.bulletRevealSeconds!==undefined){
        if(!Array.isArray(scene.bulletRevealSeconds)||scene.bulletRevealSeconds.length!==parsed.bullets.length||sceneVisuals(parsed).length)throw new TypeError('Bullet reveal requires one time per title-card bullet and no footage.')
        parsed.bulletRevealSeconds=scene.bulletRevealSeconds.map(time=>finiteNumber(time,'bullet reveal',0,parsed.durationSeconds-.001))
      }
      return parsed
    })
  }
  assertVideoDimensions(result.width,result.height)
  if(value.style!==undefined&&!VIDEO_STYLES.includes(value.style as VideoOptions['style']))throw new TypeError('Invalid video style.')
  result.style=(value.style??'bmw-dark') as VideoOptions['style']
  result.tts=assertNarrationOptions(value.tts??{})
  result.watermark=assertWatermark(value.watermark??{})
  if(value.templateName!==undefined)result.templateName=templateName(value.templateName)
  if (compositionDuration(result) > 180) throw new TypeError('Composition exceeds three minutes.')
  return result
}
export function compositionDuration(value: MediaComposition): number { return value.scenes.reduce((total, scene) => total + scene.durationSeconds, 0) }
export function compositionAssets(value: MediaComposition): string[] { return [...new Set(value.scenes.flatMap(scene => [...sceneVisuals(scene).flatMap(segment=>[segment.videoArtifactId,segment.imageArtifactId]),scene.audioArtifactId].filter((id): id is string => Boolean(id))))] }
export function captionSentences(scene:CompositionScene,width=1280,height=720):string[]{
  const W=720*width/height,margin=W<600?24:48,size=scene.captionStyle?.fontSize??(W<600?22:28),maximum=Math.max(12,Math.min(48,Math.floor((W-margin*2)/size)*2))
  return Array.from(scene.narration.match(/[^。！？!?；;，,]+[。！？!?；;，,]?/g)??[]).flatMap(sentence=>Array.from(sentence).reduce<string[]>((chunks,char,i)=>{const part=Math.floor(i/maximum);chunks[part]=(chunks[part]??'')+char;return chunks},[]))
}
export function estimatedCaptionCues(scene:CompositionScene,width=1280,height=720,narrationDuration=scene.durationSeconds-1):NonNullable<CompositionScene['captions']>{
  const sentences=captionSentences(scene,width,height),length=sentences.reduce((sum,item)=>sum+item.length,0),duration=Math.min(scene.durationSeconds-.5,Math.max(.5,narrationDuration))
  let offset=.5
  return sentences.map(text=>{const startSeconds=offset;offset+=duration*text.length/Math.max(1,length);return {startSeconds,endSeconds:Math.min(scene.durationSeconds,offset),text}}).filter(cue=>cue.endSeconds>cue.startSeconds)
}
/** Time is computed from frame index, never a wall clock; the last source frame is held explicitly. */
export function sceneAtTime(value: MediaComposition, seconds: number): { index: number; localSeconds: number; startSeconds: number } {
  let startSeconds = 0
  for (let index = 0; index < value.scenes.length; index++) {
    if (seconds < startSeconds + value.scenes[index].durationSeconds) return { index, localSeconds: Math.max(0, seconds - startSeconds), startSeconds }
    startSeconds += value.scenes[index].durationSeconds
  }
  throw new RangeError('Frame time is outside the composition.')
}
