import {assertNarration,assertNarrationOptions} from '../../media-native/src/narration-contract.js'
import type {NarrationOptions,NarrationRequest} from '../../media-native/src/narration-contract.js'
import { mediaRecord } from '../../media-native/src/media-contract.js'
import { assertComposition } from '../../media-native/src/composition-contract.js'
import { normalizeVideoPreferences, resolveVideoOutput, saveVideoTemplate, assertVideoOptions, templateName, VIDEO_OPTION_KEYS, videoOptionsSchema } from '../../media-native/src/video-options.js'
import type { MediaComposition } from '../../media-native/src/composition-contract.js'
import type { BrowserActionDefinition } from '../../browser-capability/src/browser-schema.js'
export type {VideoSettingsPort as VideoSettingsStore} from '@bmw-agent/browser-capability/host'
import type {VideoSettingsPort as VideoSettingsStore} from '@bmw-agent/browser-capability/host'
export function resolvedComposition(raw:unknown,preferences:unknown):MediaComposition {
  const value=mediaRecord(raw),patch:Record<string,unknown>={}
  for(const key of VIDEO_OPTION_KEYS)if(value[key]!==undefined)patch[key]=value[key]
  if(value.resolution==='custom'){patch.width=value.width;patch.height=value.height}
  const output=resolveVideoOutput(preferences,patch,value.templateName,{width:value.width,height:value.height})
  const composition:Record<string,unknown>={...value,width:output.width,height:output.height,fps:output.fps,music:output.music,...(output.cardLayout===undefined?{}:{cardLayout:output.cardLayout}),...(output.narrationPacing===undefined?{}:{narrationPacing:output.narrationPacing}),style:output.style,watermark:output.watermark,tts:output.tts}
  delete composition.aspectRatio;delete composition.resolution
  return assertComposition(composition)
}
export function resolvedNarration(raw:unknown,preferences:unknown):NarrationRequest {
  const value=mediaRecord(raw)
  if(Object.keys(value).some(key=>!['text','provider','voice','ratePercent','templateName'].includes(key)))throw new TypeError('Unsupported narration property.')
  const {text,templateName,...options}=value,base=resolveVideoOutput(preferences,{},templateName).tts
  return assertNarration({text,...assertNarrationOptions(options,base)})
}
export function requireNarrationEnabled(options:NarrationOptions,store?:VideoSettingsStore):void {
  if(options.provider==='edge-readaloud'&&store?.snapshot().edgeNarrationEnabled!==true)throw new Error('Online narration is disabled. Enable Video narration in Settings or choose local-matcha.')
}
export const videoSettingsAction:BrowserActionDefinition={
  action:'video.settings',
  description:'Read or manage BMW video defaults and named parameter templates. settingsRequest.operation read returns defaults and available template names/options. save-template takes name and options; delete-template takes name; set-defaults takes partial options. Persist changes only when the user asks. Template parameters cover aspectRatio 16:9/9:16/1:1/4:3/3:4, resolution 720p/1080p (short edge) or custom with bounded even width/height, fps 12..30, music, style bmw-dark/clean-light/minimal, text watermark {enabled,text,position,opacity,size}, and tts {provider,voice,ratePercent}. TTS defaults to edge-readaloud/zh-CN-YunxiNeural (Edge male)/0%; alternatives Edge female zh-CN-XiaoxiaoNeural or local-matcha/local-zh-en. Explicit TTS overrides beat template then defaults; changing TTS does not replace existing audio, regenerate narration. Templates are parameter snapshots in this BMW profile; existing drafts stay unchanged. Generation priority: explicit per-video parameters > selected named template > defaults. Unknown templates fail, never silently fall back. Use composition.templateName for video.compose, or studioRequest.templateName and options with create/configure. No host paths or arbitrary CSS/HTML.',
  inputSchema:{type:'object',additionalProperties:false,required:['settingsRequest'],properties:{settingsRequest:{type:'object',additionalProperties:false,required:['operation'],properties:{operation:{type:'string',enum:['read','save-template','delete-template','set-defaults']},name:{type:'string',minLength:1,maxLength:40},options:videoOptionsSchema}}}},
  async execute(context,input){
    if(Object.keys(input).some(key=>!['action','settingsRequest'].includes(key)))throw new TypeError('Unsupported video.settings property.')
    const kernel=context.browserKernel
    const store=kernel.settingsStore,request=mediaRecord(input.settingsRequest)
    if(Object.keys(request).some(key=>!['operation','name','options'].includes(key)))throw new TypeError('Unsupported video settings request.')
    const preferences=normalizeVideoPreferences(store?.snapshot().videoPreferences??{})
    if(request.operation==='read')return preferences
    if(!store)throw new Error('Persistent video settings are unavailable in this host.')
    let next=preferences
    if(request.operation==='save-template')next=saveVideoTemplate(preferences,request.name,assertVideoOptions(request.options??{},preferences.defaults))
    else if(request.operation==='delete-template'){
      const name=templateName(request.name),index=preferences.templates.findIndex(item=>item.name.toLocaleLowerCase()===name.toLocaleLowerCase())
      if(index<0)throw new Error(`找不到视频模板「${name}」。`)
      next.templates.splice(index,1)
    }else if(request.operation==='set-defaults')next.defaults=assertVideoOptions(request.options??{},preferences.defaults)
    else throw new TypeError('Unknown video settings operation.')
    store.update({videoPreferences:next});kernel.videoStudioChanged?.();return next
  }
}
