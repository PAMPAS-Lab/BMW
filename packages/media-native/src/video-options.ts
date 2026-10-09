import {assertNarrationOptions,DEFAULT_NARRATION_OPTIONS,narrationOptionsSchema} from './narration-contract.js'
import type {NarrationOptions} from './narration-contract.js'
import { finiteNumber, mediaRecord } from './media-contract.js'

export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const
export const VIDEO_STYLES = ['bmw-dark', 'clean-light', 'minimal'] as const
export const WATERMARK_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export interface VideoWatermark { enabled: boolean; text: string; position: typeof WATERMARK_POSITIONS[number]; opacity: number; size: number }
export interface VideoOptions { cardLayout?:'standard'|'news';narrationPacing?:'standard'|'compact';aspectRatio: typeof VIDEO_RATIOS[number]; resolution: '720p'|'1080p'|'custom'; width?:number; height?:number; fps: number; music: boolean; style: typeof VIDEO_STYLES[number]; tts:NarrationOptions; watermark: VideoWatermark }
export type VideoOptionOverrides=Partial<Omit<VideoOptions,'watermark'|'tts'>>&{watermark?:Partial<VideoWatermark>;tts?:Partial<NarrationOptions>}
export interface VideoTemplate { name: string; options: VideoOptions }
export interface VideoPreferences { defaults: VideoOptions; templates: VideoTemplate[] }
export const DEFAULT_VIDEO_OPTIONS: Readonly<VideoOptions> = Object.freeze({ aspectRatio: '16:9', resolution: '720p', fps: 24, music: true, style: 'bmw-dark', tts:DEFAULT_NARRATION_OPTIONS, watermark: Object.freeze({enabled:true,text:'BMW / WEB STORIES',position:'bottom-left',opacity:1,size:14}) })
export const VIDEO_OPTION_KEYS = ['aspectRatio','resolution','fps','music','style','watermark','tts','cardLayout','narrationPacing'] as const
function closed(value: Record<string,unknown>, allowed: readonly string[]): void { if(Object.keys(value).some(key=>!allowed.includes(key)))throw new TypeError('Unsupported video setting.') }
export function templateName(raw:unknown):string { if(typeof raw!=='string'||!raw.trim()||raw.trim().length>40||/[\u0000-\u001f\u007f]/.test(raw))throw new TypeError('模板名称需为 1–40 个字符。');return raw.trim().normalize('NFC') }
export function assertWatermark(raw: unknown, base: VideoWatermark = DEFAULT_VIDEO_OPTIONS.watermark): VideoWatermark {
  const value=mediaRecord(raw);closed(value,['enabled','text','position','opacity','size'])
  const result={...base,...value}
  if(typeof result.enabled!=='boolean'||typeof result.text!=='string'||result.text.length>60||/[\u0000-\u001f\u007f]/.test(result.text)||!WATERMARK_POSITIONS.includes(result.position))throw new TypeError('水印文字最多 60 字，位置必须为四角之一。')
  if(result.enabled&&!result.text.trim())throw new TypeError('启用水印时请填写文字。')
  return {enabled:result.enabled,text:result.text,position:result.position,opacity:finiteNumber(result.opacity,'watermark opacity',.1,1),size:finiteNumber(result.size,'watermark size',10,32,true)}
}
export function assertVideoOptions(raw:unknown={},base:VideoOptions=structuredClone(DEFAULT_VIDEO_OPTIONS)):VideoOptions {
  const value=mediaRecord(raw);closed(value,[...VIDEO_OPTION_KEYS,'width','height'])
  const result={...base,...value}
  for(const key of ['cardLayout','narrationPacing'] as const)if(result[key]!==undefined&&!['standard',key==='cardLayout'?'news':'compact'].includes(result[key]))throw new TypeError('Unsupported layout or narration pacing.')
  if(result.cardLayout==='news'&&!['16:9','9:16'].includes(result.aspectRatio))throw new TypeError('News layout supports 16:9 and 9:16.')
  if(!VIDEO_RATIOS.includes(result.aspectRatio)||!['720p','1080p','custom'].includes(result.resolution)||!VIDEO_STYLES.includes(result.style)||typeof result.music!=='boolean')throw new TypeError('Invalid video ratio, resolution, style or music setting.')
  let dimensions:{}|{width:number;height:number}={}
  if(result.resolution==='custom'){const size=assertVideoDimensions(result.width,result.height);const [a,b]=result.aspectRatio.split(':').map(Number);if(Math.abs(size.width/size.height-a/b)>.01)throw new TypeError('Custom resolution must match aspectRatio.');dimensions=size}
  return {...dimensions,...(result.cardLayout===undefined?{}:{cardLayout:result.cardLayout}),...(result.narrationPacing===undefined?{}:{narrationPacing:result.narrationPacing}),aspectRatio:result.aspectRatio,resolution:result.resolution,fps:finiteNumber(result.fps,'fps',12,30,true),music:result.music,style:result.style,tts:assertNarrationOptions(value.tts??{},base.tts),watermark:assertWatermark(value.watermark??{},base.watermark)}
}
/** Validate individual override fields before resolving them against a template or draft. */
export function assertVideoOverrides(raw:unknown):VideoOptionOverrides {
  const value=mediaRecord(raw);closed(value,[...VIDEO_OPTION_KEYS,'width','height'])
  for(const key of ['cardLayout','narrationPacing'] as const)if(value[key]!==undefined&&(typeof value[key]!=='string'||!['standard',key==='cardLayout'?'news':'compact'].includes(value[key])))throw new TypeError('Unsupported layout or narration pacing.')
  if(value.aspectRatio!==undefined&&!VIDEO_RATIOS.includes(value.aspectRatio as VideoOptions['aspectRatio']))throw new TypeError('Invalid video ratio.')
  if(value.resolution!==undefined&&!['720p','1080p','custom'].includes(String(value.resolution)))throw new TypeError('Invalid video resolution.')
  if(value.style!==undefined&&!VIDEO_STYLES.includes(value.style as VideoOptions['style']))throw new TypeError('Invalid video style.')
  if(value.music!==undefined&&typeof value.music!=='boolean')throw new TypeError('Invalid music setting.')
  if(value.fps!==undefined)finiteNumber(value.fps,'fps',12,30,true)
  for(const [key,min] of [['width',320],['height',180]] as const)if(value[key]!==undefined){const size=finiteNumber(value[key],key,min,1920,true);if(size%2)throw new TypeError('Video dimensions must be even.')}
  if(value.tts!==undefined)assertNarrationOptions(value.tts)
  if(value.watermark!==undefined)assertWatermark(value.watermark,{...DEFAULT_VIDEO_OPTIONS.watermark,enabled:false})
  return structuredClone(value) as VideoOptionOverrides
}
export function normalizeVideoPreferences(raw:unknown={}):VideoPreferences {
  const value=mediaRecord(raw);closed(value,['defaults','templates'])
  const defaults=assertVideoOptions(value.defaults??{})
  if(!Array.isArray(value.templates??[])||(value.templates as unknown[]|undefined)?.length>32)throw new TypeError('最多保存 32 个视频模板。')
  const templates=((value.templates??[]) as unknown[]).map(raw=>{const item=mediaRecord(raw);closed(item,['name','options']);return {name:templateName(item.name),options:assertVideoOptions(item.options)}})
  if(new Set(templates.map(item=>item.name.toLocaleLowerCase())).size!==templates.length)throw new TypeError('视频模板名称不能重复。')
  return {defaults,templates}
}
export function videoDimensions(options:Pick<VideoOptions,'aspectRatio'|'resolution'|'width'|'height'>):{width:number;height:number} {
  if(options.resolution==='custom')return assertVideoDimensions(options.width,options.height)
  const short=options.resolution==='1080p'?1080:720
  const [a,b]=options.aspectRatio.split(':').map(Number)
  return a>=b?{width:short*a/b,height:short}:{width:short,height:short*b/a}
}
export function assertVideoDimensions(width:unknown,height:unknown):{width:number;height:number} {
  const w=finiteNumber(width,'width',320,1920,true),h=finiteNumber(height,'height',180,1920,true)
  if(w%2||h%2||w*h>1920*1080)throw new TypeError('Video dimensions must be even and at most 2,073,600 pixels.')
  if(!VIDEO_RATIOS.some(ratio=>{const [a,b]=ratio.split(':').map(Number);return Math.abs(w/h-a/b)<.01}))throw new TypeError('Supported video ratios: 16:9, 9:16, 1:1, 4:3, 3:4.')
  return {width:w,height:h}
}
export function resolveVideoOutput(rawPreferences:unknown,overrides:unknown={},name?:unknown,dimensions?:{width?:unknown;height?:unknown}):VideoOptions&{width:number;height:number;templateName?:string} {
  const preferences=normalizeVideoPreferences(rawPreferences??{}),patch={...mediaRecord(overrides)}
  let base=preferences.defaults,selected:string|undefined
  if(name!==undefined){selected=templateName(name);const preset=preferences.templates.find(item=>item.name.toLocaleLowerCase()===selected!.toLocaleLowerCase());if(!preset)throw new Error(`找不到视频模板「${selected}」，请先读取 video.settings 查看模板。`);base=preset.options;selected=preset.name}
  dimensions=dimensions??(patch.width!==undefined||patch.height!==undefined?{width:patch.width,height:patch.height}:undefined)
  if(dimensions?.width!==undefined&&dimensions.height!==undefined&&(patch.resolution??base.resolution)==='custom'){
    const size=assertVideoDimensions(dimensions.width,dimensions.height);patch.width=size.width;patch.height=size.height
    if(patch.aspectRatio===undefined)patch.aspectRatio=VIDEO_RATIOS.find(ratio=>{const [a,b]=ratio.split(':').map(Number);return Math.abs(size.width/size.height-a/b)<.01})
  }
  // A ratio change without new custom dimensions keeps the custom short edge.
  if(base.resolution==='custom'&&patch.aspectRatio!==undefined&&patch.aspectRatio!==base.aspectRatio&&patch.resolution===undefined&&patch.width===undefined&&patch.height===undefined&&dimensions?.width===undefined&&dimensions?.height===undefined){
    const ratio=String(patch.aspectRatio).split(':').map(Number),short=Math.max(320,Math.min(base.width!,base.height!))
    patch.width=Math.round((ratio[0]>=ratio[1]?short*ratio[0]/ratio[1]:short)/2)*2
    patch.height=Math.round((ratio[0]>=ratio[1]?short:short*ratio[1]/ratio[0])/2)*2
  }
  const options=assertVideoOptions(patch,base)
  let size=videoDimensions(options)
  if(dimensions?.width!==undefined||dimensions?.height!==undefined){
    if(dimensions.width===undefined||dimensions.height===undefined)throw new TypeError('Custom video size requires both width and height.')
    size=assertVideoDimensions(dimensions.width,dimensions.height)
    if(patch.aspectRatio!==undefined){const [a,b]=options.aspectRatio.split(':').map(Number);if(Math.abs(size.width/size.height-a/b)>.01)throw new TypeError('Explicit dimensions conflict with aspectRatio.')}
  }
  return {...options,...size,...(selected?{templateName:selected}:{})}
}
export function optionsFromOutput(value:{cardLayout?:VideoOptions['cardLayout'];narrationPacing?:VideoOptions['narrationPacing'];width:number;height:number;fps:number;music:boolean;style?:VideoOptions['style'];watermark?:VideoWatermark;tts?:NarrationOptions}):VideoOptions {
  const aspectRatio=VIDEO_RATIOS.find(ratio=>{const [a,b]=ratio.split(':').map(Number);return Math.abs(value.width/value.height-a/b)<.01})
  if(!aspectRatio)throw new TypeError('Unknown draft ratio.')
  const resolution=Math.min(value.width,value.height)>=1080?'1080p':'720p',preset=videoDimensions({aspectRatio,resolution})
  return assertVideoOptions({...((value.cardLayout===undefined)?{}:{cardLayout:value.cardLayout}),...((value.narrationPacing===undefined)?{}:{narrationPacing:value.narrationPacing}),aspectRatio,resolution:preset.width===value.width&&preset.height===value.height?resolution:'custom',width:value.width,height:value.height,fps:value.fps,music:value.music,style:value.style??'bmw-dark',watermark:value.watermark??{},tts:value.tts??{}})
}
export function saveVideoTemplate(raw:unknown,name:unknown,options:unknown):VideoPreferences {
  const preferences=normalizeVideoPreferences(raw),clean=templateName(name),value={name:clean,options:assertVideoOptions(options)},index=preferences.templates.findIndex(item=>item.name.toLocaleLowerCase()===clean.toLocaleLowerCase())
  if(index<0)preferences.templates.push(value);else preferences.templates[index]=value
  return normalizeVideoPreferences(preferences)
}
export const watermarkSchema={type:'object',additionalProperties:false,properties:{enabled:{type:'boolean'},text:{type:'string',maxLength:60},position:{type:'string',enum:WATERMARK_POSITIONS},opacity:{type:'number',minimum:.1,maximum:1},size:{type:'integer',minimum:10,maximum:32}}}
export const videoOptionProperties={cardLayout:{enum:['standard','news']},narrationPacing:{enum:['standard','compact']},aspectRatio:{type:'string',enum:VIDEO_RATIOS},resolution:{type:'string',enum:['720p','1080p','custom']},width:{type:'integer',minimum:320,maximum:1920},height:{type:'integer',minimum:180,maximum:1920},fps:{type:'integer',minimum:12,maximum:30},music:{type:'boolean'},style:{type:'string',enum:VIDEO_STYLES},watermark:watermarkSchema,tts:narrationOptionsSchema}
export const videoOptionsSchema={type:'object',additionalProperties:false,properties:videoOptionProperties}
