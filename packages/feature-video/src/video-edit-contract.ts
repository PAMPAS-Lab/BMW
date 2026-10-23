import {assertCaptionTranslations} from './caption-translations.js'
import type {CaptionTranslation} from './caption-translations.js'
import {COMPOSITION_LIMITS} from '../../media-native/src/composition-contract.js'
import {studioId} from './studio-contract.js'
import type {StudioScene,StudioPreparation} from './studio-contract.js'
import {mediaRecord,assertArtifactId} from '../../media-native/src/media-contract.js'
import {assertVisualEffects} from '../../media-native/src/visual-effects.js'
import type {VisualEffects} from '../../media-native/src/visual-effects.js'
import {videoSeconds} from './video-time.js'
import type {VideoTime} from './video-time.js'
import {assertCardSpec} from '../../media-native/src/card-templates.js'
import type {CardSpec} from '../../media-native/src/card-templates.js'
import {assertComposition} from '../../media-native/src/composition-contract.js'
import type {CaptionCue} from '../../media-native/src/composition-contract.js'
import {assertCardSpeechChoices} from './studio-card-speech.js'
import type {CardSpeechChoice} from './studio-card-speech.js'
export const sceneFields=['title','label','script','visualBrief','bullets','layout','captionStyle','captionDisplay','showSceneNumber','sceneTemplate','endPolicy','citations','sources','durationSeconds'] as const
export type SceneContent=Partial<Pick<StudioScene,Exclude<typeof sceneFields[number],'script'>>>&{script?:string}
export const layerFields=['title','x','y','width','height','opacity','zIndex','hidden','locked','color','text','fontSize','textTreatment','packaging','sourceCrop','science','volume','muted','fadeInSeconds','fadeOutSeconds','ducking','keyframes'] as const
export type VideoEditCommand=
 |{op:'brief.set';patch:Partial<StudioPreparation>}
 |{op:'scene.add';scene:SceneContent&{id:string;title:string};afterSceneId?:string}
 |{op:'captions.set';sceneId:string;mode:'manual';cues:CaptionCue[]}
 |{op:'captions.set';sceneId:string;mode:'sentences'|'off'}
 |{op:'captions.translate';sceneId:string;translations:CaptionTranslation[]}
 |{op:'card.set';sceneId:string;cardSpec:CardSpec;links?:CardSpeechChoice[]}
 |{op:'card.bind';sceneId:string;links:CardSpeechChoice[]}
 |{op:'scene.set';sceneId:string;patch:SceneContent}
 |{op:'scene.reorder';sceneIds:string[]}
 |{op:'clip.move'|'clip.split';clipId:string;time:VideoTime}
 |{op:'clip.trim';clipId:string;edge:'start'|'end';time:VideoTime}
 |{op:'clip.effects';clipId:string;effects:VisualEffects|null}
 |{op:'clip.mute';clipId:string;muted:boolean}
 |{op:'layer.add';kind:'text'|'rectangle'|'image'|'video'|'audio'|'diagram'|'card-stack';sceneId?:string;artifactId?:string}
 |{op:'layer.remove';clipId:string}
 |{op:'layer.set';clipId:string;patch:Record<string,unknown>}
export interface VideoEdit {version:1;commands:VideoEditCommand[]}
function closed(v:Record<string,unknown>,keys:readonly string[]):void{
 const unknown=Object.keys(v).filter(k=>!keys.includes(k));if(unknown.length)throw new TypeError(`VIDEO_EDIT_FIELD: Unsupported edit field: ${unknown.slice(0,8).map(k=>JSON.stringify(k.slice(0,80))).join(', ')}. Allowed fields: ${keys.join(', ')}. Use describe-edit for this command; do not retry guessed aliases.`)
}
function clipId(raw:unknown):string{if(typeof raw!=='string'||!/^[a-zA-Z0-9_-]{1,256}$/.test(raw))throw new TypeError('VIDEO_EDIT_ID: Invalid clip ID.');return raw}
export function assertVideoEdit(raw:unknown):VideoEdit {
 const e=mediaRecord(raw);closed(e,['version','commands']);if(e.version!==1||!Array.isArray(e.commands)||!e.commands.length||e.commands.length>32)throw new TypeError('VIDEO_EDIT: One to 32 version-1 commands are required.')
 const commands=e.commands.map(raw=>{const c=mediaRecord(raw)
  switch(c.op){
   case 'brief.set':{closed(c,['op','patch']);const patch=mediaRecord(c.patch);closed(patch,['production','notes','outline','artifactIds','sourceIds']);if(!Object.keys(patch).length)throw new TypeError('VIDEO_EDIT: Empty brief patch.');return {op:c.op,patch:structuredClone(patch)} as VideoEditCommand}
   case 'scene.add':{closed(c,['op','scene','afterSceneId']);const scene=mediaRecord(c.scene);closed(scene,['id',...sceneFields]);studioId(scene.id);if(typeof scene.title!=='string'||!scene.title.trim())throw new TypeError('VIDEO_EDIT_SCENE: A new scene needs a title.');return {op:c.op,scene:structuredClone(scene),...(c.afterSceneId===undefined?{}:{afterSceneId:studioId(c.afterSceneId)})} as VideoEditCommand}
   case 'captions.translate':closed(c,['op','sceneId','translations']);return {op:c.op,sceneId:studioId(c.sceneId),translations:assertCaptionTranslations(c.translations)}
   case 'captions.set':{
    if(!['manual','sentences','off'].includes(String(c.mode)))throw new TypeError('VIDEO_EDIT_CAPTIONS: Choose manual, sentences or off.')
    closed(c,['op','sceneId','mode',...(c.mode==='manual'?['cues']:[])])
    const base={op:'captions.set' as const,sceneId:studioId(c.sceneId)}
    if(c.mode==='manual'){if(!Array.isArray(c.cues))throw new TypeError('VIDEO_EDIT_CAPTIONS: Manual captions require cues.');const cues=assertComposition({title:'Caption edit',scenes:[{title:'Caption edit',durationSeconds:60,captions:c.cues}]}).scenes[0].captions!;return {...base,mode:'manual' as const,cues}}
    return {...base,mode:c.mode as 'sentences'|'off'}
   }
   case 'card.set':closed(c,['op','sceneId','cardSpec','links']);return {op:c.op,sceneId:studioId(c.sceneId),cardSpec:assertCardSpec(c.cardSpec),...(c.links===undefined?{}:{links:assertCardSpeechChoices(c.links)})}
   case 'card.bind':closed(c,['op','sceneId','links']);return {op:c.op,sceneId:studioId(c.sceneId),links:assertCardSpeechChoices(c.links)}
   case 'scene.set':{closed(c,['op','sceneId','patch']);const patch=mediaRecord(c.patch);closed(patch,sceneFields);if(!Object.keys(patch).length)throw new TypeError('VIDEO_EDIT: Empty scene patch.');return {op:c.op,sceneId:studioId(c.sceneId),patch:structuredClone(patch)} as VideoEditCommand}
   case 'scene.reorder':closed(c,['op','sceneIds']);if(!Array.isArray(c.sceneIds)||c.sceneIds.length>COMPOSITION_LIMITS.scenes)throw new TypeError('VIDEO_EDIT: Invalid scene order.');return {op:c.op,sceneIds:c.sceneIds.map(studioId)}
   case 'clip.move':case 'clip.split':case 'clip.trim':{closed(c,['op','clipId','time',...(c.op==='clip.trim'?['edge']:[])]);videoSeconds(c.time as VideoTime);if(c.op==='clip.trim'&&!['start','end'].includes(String(c.edge)))throw new TypeError('VIDEO_EDIT: Invalid trim edge.');return {op:c.op,clipId:clipId(c.clipId),time:structuredClone(c.time),...(c.op==='clip.trim'?{edge:c.edge}:{})} as VideoEditCommand}
   case 'clip.effects':closed(c,['op','clipId','effects']);return {op:c.op,clipId:clipId(c.clipId),effects:c.effects===null?null:assertVisualEffects(c.effects)}
   case 'clip.mute':closed(c,['op','clipId','muted']);if(typeof c.muted!=='boolean')throw new TypeError('VIDEO_EDIT: Invalid mute.');return {op:c.op,clipId:clipId(c.clipId),muted:c.muted}
   case 'layer.remove':closed(c,['op','clipId']);return {op:c.op,clipId:clipId(c.clipId)}
   case 'layer.set':{closed(c,['op','clipId','patch']);const patch=mediaRecord(c.patch);closed(patch,layerFields);if(!Object.keys(patch).length)throw new TypeError('VIDEO_EDIT: Empty layer patch.');return {op:c.op,clipId:clipId(c.clipId),patch:structuredClone(patch)}}
   case 'layer.add':closed(c,['op','kind','sceneId','artifactId']);if(!['text','rectangle','image','video','audio','diagram','card-stack'].includes(String(c.kind)))throw new TypeError('VIDEO_EDIT: Invalid layer kind.');if(c.kind==='card-stack'&&c.artifactId!==undefined)throw new TypeError('VIDEO_EDIT: Card stack does not accept a source artifact.');return {op:c.op,kind:c.kind,...(c.sceneId===undefined?{}:{sceneId:studioId(c.sceneId)}),...(c.artifactId===undefined?{}:{artifactId:assertArtifactId(c.artifactId)})} as VideoEditCommand
   default:throw new TypeError('VIDEO_EDIT_OPERATION: Unsupported edit operation.')
  }
 })
 return {version:1,commands}
}
