import {studioId} from './studio-contract.js'
import type {StudioScene} from './studio-contract.js'
import {mediaRecord,assertArtifactId} from '../../media-native/src/media-contract.js'
import {assertVisualEffects} from '../../media-native/src/visual-effects.js'
import type {VisualEffects} from '../../media-native/src/visual-effects.js'
import {videoSeconds} from './video-time.js'
import type {VideoTime} from './video-time.js'
export const sceneFields=['title','script','visualBrief','bullets','layout','captionStyle','captionDisplay','showSceneNumber','sceneTemplate','endPolicy'] as const
export const layerFields=['title','x','y','width','height','opacity','zIndex','hidden','locked','color','text','fontSize','volume','muted','fadeInSeconds','fadeOutSeconds','ducking','keyframes'] as const
export type VideoEditCommand=
 |{op:'scene.set';sceneId:string;patch:Partial<Pick<StudioScene,'title'|'visualBrief'|'bullets'|'layout'|'captionStyle'|'captionDisplay'|'showSceneNumber'|'sceneTemplate'|'endPolicy'>>&{script?:string}}
 |{op:'scene.reorder';sceneIds:string[]}
 |{op:'clip.move'|'clip.split';clipId:string;time:VideoTime}
 |{op:'clip.trim';clipId:string;edge:'start'|'end';time:VideoTime}
 |{op:'clip.effects';clipId:string;effects:VisualEffects|null}
 |{op:'clip.mute';clipId:string;muted:boolean}
 |{op:'layer.add';kind:'text'|'rectangle'|'image'|'video'|'audio';sceneId?:string;artifactId?:string}
 |{op:'layer.remove';clipId:string}
 |{op:'layer.set';clipId:string;patch:Record<string,unknown>}
export interface VideoEdit {version:1;commands:VideoEditCommand[]}
function closed(v:Record<string,unknown>,keys:readonly string[]):void{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('VIDEO_EDIT_FIELD: Unsupported edit field.')}
function clipId(raw:unknown):string{if(typeof raw!=='string'||!/^[a-zA-Z0-9_-]{1,256}$/.test(raw))throw new TypeError('VIDEO_EDIT_ID: Invalid clip ID.');return raw}
export function assertVideoEdit(raw:unknown):VideoEdit {
 const e=mediaRecord(raw);closed(e,['version','commands']);if(e.version!==1||!Array.isArray(e.commands)||!e.commands.length||e.commands.length>32)throw new TypeError('VIDEO_EDIT: One to 32 version-1 commands are required.')
 const commands=e.commands.map(raw=>{const c=mediaRecord(raw)
  switch(c.op){
   case 'scene.set':{closed(c,['op','sceneId','patch']);const patch=mediaRecord(c.patch);closed(patch,sceneFields);if(!Object.keys(patch).length)throw new TypeError('VIDEO_EDIT: Empty scene patch.');return {op:c.op,sceneId:studioId(c.sceneId),patch:structuredClone(patch)} as VideoEditCommand}
   case 'scene.reorder':closed(c,['op','sceneIds']);if(!Array.isArray(c.sceneIds)||c.sceneIds.length>24)throw new TypeError('VIDEO_EDIT: Invalid scene order.');return {op:c.op,sceneIds:c.sceneIds.map(studioId)}
   case 'clip.move':case 'clip.split':case 'clip.trim':{closed(c,['op','clipId','time',...(c.op==='clip.trim'?['edge']:[])]);videoSeconds(c.time as VideoTime);if(c.op==='clip.trim'&&!['start','end'].includes(String(c.edge)))throw new TypeError('VIDEO_EDIT: Invalid trim edge.');return {op:c.op,clipId:clipId(c.clipId),time:structuredClone(c.time),...(c.op==='clip.trim'?{edge:c.edge}:{})} as VideoEditCommand}
   case 'clip.effects':closed(c,['op','clipId','effects']);return {op:c.op,clipId:clipId(c.clipId),effects:c.effects===null?null:assertVisualEffects(c.effects)}
   case 'clip.mute':closed(c,['op','clipId','muted']);if(typeof c.muted!=='boolean')throw new TypeError('VIDEO_EDIT: Invalid mute.');return {op:c.op,clipId:clipId(c.clipId),muted:c.muted}
   case 'layer.remove':closed(c,['op','clipId']);return {op:c.op,clipId:clipId(c.clipId)}
   case 'layer.set':{closed(c,['op','clipId','patch']);const patch=mediaRecord(c.patch);closed(patch,layerFields);if(!Object.keys(patch).length)throw new TypeError('VIDEO_EDIT: Empty layer patch.');return {op:c.op,clipId:clipId(c.clipId),patch:structuredClone(patch)}}
   case 'layer.add':closed(c,['op','kind','sceneId','artifactId']);if(!['text','rectangle','image','video','audio'].includes(String(c.kind)))throw new TypeError('VIDEO_EDIT: Invalid layer kind.');return {op:c.op,kind:c.kind,...(c.sceneId===undefined?{}:{sceneId:studioId(c.sceneId)}),...(c.artifactId===undefined?{}:{artifactId:assertArtifactId(c.artifactId)})} as VideoEditCommand
   default:throw new TypeError('VIDEO_EDIT_OPERATION: Unsupported edit operation.')
  }
 })
 return {version:1,commands}
}
