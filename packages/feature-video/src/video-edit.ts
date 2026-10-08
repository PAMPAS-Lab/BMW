import {assertVideoEdit,sceneFields,layerFields} from './video-edit-contract.js'
import type {VideoEdit} from './video-edit-contract.js'
export {assertVideoEdit} from './video-edit-contract.js'
export type {VideoEdit,VideoEditCommand} from './video-edit-contract.js'
import {assertVideoDraft} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'
import {finiteNumber} from '../../media-native/src/media-contract.js'
import {visualEffectsSchema} from '../../media-native/src/visual-effects.js'
import {addStudioLayer,editStudioLayer,removeStudioLayer,splitStudioLayer,trimStudioLayer} from './studio-layer-edits.js'
import type {StudioLayerSelection} from './studio-layer-edits.js'
import {moveStudioMain,trimStudioMain,splitStudioMain,setStudioMainEffects,setStudioMainMuted} from './studio-main-edits.js'
import type {StudioMainSelection} from './studio-main-edits.js'
import {videoDocumentFromDraft,videoSeconds,videoTimeSchema} from './video-document.js'
import {studioDraftSchema} from './studio-schema.js'
import {visualLayersSchema,audioLayersSchema} from '../../media-native/src/composition-layers.js'
/** In-memory transaction; the owning service performs admission and one CAS write. */
export function applyVideoEdit(raw:VideoDraft,edit:VideoEdit):VideoDraft {
 let draft=assertVideoDraft(raw)
 for(const c of assertVideoEdit(edit).commands){
  if(c.op==='scene.set'){const scene=draft.scenes.find(s=>s.id===c.sceneId);if(!scene)throw new Error('VIDEO_EDIT_SCENE: Unknown scene.');const {script,...patch}=c.patch;Object.assign(scene,patch);if(script!==undefined)scene.narration=script;draft=assertVideoDraft(draft);continue}
  if(c.op==='scene.reorder'){if(c.sceneIds.length!==draft.scenes.length||new Set(c.sceneIds).size!==c.sceneIds.length||c.sceneIds.some(id=>!draft.scenes.some(s=>s.id===id)))throw new Error('VIDEO_EDIT_ORDER: Exact scene permutation required.');draft.scenes=c.sceneIds.map(id=>draft.scenes.find(s=>s.id===id)!);continue}
  if(c.op==='layer.add'){draft=addStudioLayer(draft,c.sceneId,c.kind,c.artifactId).draft;continue}
  const doc=videoDocumentFromDraft(draft),track=doc.content.timeline.tracks.find(t=>t.clips.some(p=>p.id===c.clipId)),clip=track?.clips.find(p=>p.id===c.clipId)
  if(!track||!clip)throw new Error('VIDEO_EDIT_CLIP: Unknown clip; read the current revision and IDs.')
  const layer:StudioLayerSelection={id:String(clip.properties.sourceIdentity),kind:track.kind==='audio'?'audio':'visual',...(track.sceneId?{sceneId:track.sceneId}:{})}
  const isLayer=track.role==='overlay'||track.role==='audio'
  if(c.op==='layer.remove'){if(!isLayer)throw new Error('VIDEO_EDIT_KIND: layer.remove requires an independent object.');draft=removeStudioLayer(draft,layer);continue}
  if(c.op==='layer.set'){if(!isLayer)throw new Error('VIDEO_EDIT_KIND: layer.set requires an independent object.');draft=editStudioLayer(draft,layer,value=>Object.assign(value,c.patch),Object.keys(c.patch).length===1&&c.patch.locked===false);continue}
  let offset=0;for(const scene of draft.scenes){if(scene.id===track.sceneId)break;offset+=scene.durationSeconds}
  const global='time' in c?finiteNumber(videoSeconds(c.time),'global edit time',0,180):0
  if(isLayer){
   if(c.op==='clip.effects')throw new Error('VIDEO_EDIT_CAPABILITY: Independent effects are not supported.')
   if(c.op==='clip.mute'){draft=editStudioLayer(draft,layer,value=>{if('muted' in value)value.muted=c.muted;else value.hidden=c.muted});continue}
   if(c.op==='clip.move'){draft=editStudioLayer(draft,layer,value=>{value.startSeconds=global-(track.sceneId?offset:0)});continue}
   if(c.op==='clip.trim'){draft=trimStudioLayer(draft,layer,c.edge,global-(track.sceneId?offset:0));continue}
   if(c.op==='clip.split'){draft=splitStudioLayer(draft,layer,global-(track.sceneId?offset:0));continue}
  }
  const ref:StudioMainSelection={sceneId:track.sceneId!,kind:clip.kind==='voice'?'voice':clip.kind==='caption'?'caption':'visual',index:track.clips.indexOf(clip),...(clip.kind==='visual'&&clip.properties.sourceIdentity?{visualSegmentId:String(clip.properties.sourceIdentity)}:{}),...(clip.kind==='voice'&&clip.properties.id?{voiceSegmentId:String(clip.properties.id)}:{})}
  if(c.op==='clip.effects')draft=setStudioMainEffects(draft,ref,c.effects??undefined).draft
  else if(c.op==='clip.mute')draft=setStudioMainMuted(draft,ref,c.muted).draft
  else if(c.op==='clip.move')draft=moveStudioMain(draft,ref,global).draft
  else if(c.op==='clip.trim')draft=trimStudioMain(draft,ref,c.edge,global).draft
  else if(c.op==='clip.split')draft=splitStudioMain(draft,ref,global).draft
 }
 return assertVideoDraft(draft)
}
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required})
const id={type:'string',pattern:'^[a-zA-Z0-9_-]{1,256}$'},sceneId=studioDraftSchema.properties.id
const sceneProps=studioDraftSchema.properties.scenes.items.properties
const scenePatch={minProperties:1,...object({...Object.fromEntries(sceneFields.filter(k=>k!=='script').map(k=>[k,sceneProps[k]])),script:{type:'string',maxLength:1000}},[])}
const layerPatch={minProperties:1,...object(Object.fromEntries(layerFields.map(k=>[k,{...visualLayersSchema.items.properties,...audioLayersSchema.items.properties}[k]])),[])}
export const videoEditSchema={ $schema:'https://json-schema.org/draft/2020-12/schema', $id:'https://bmw.local/schemas/video-edit/1', ...object({version:{const:1},commands:{type:'array',minItems:1,maxItems:32,items:{oneOf:[object({op:{const:'scene.set'},sceneId,patch:scenePatch}),object({op:{const:'scene.reorder'},sceneIds:{type:'array',maxItems:24,uniqueItems:true,items:sceneId}}),...['clip.move','clip.split'].map(op=>object({op:{const:op},clipId:id,time:videoTimeSchema})),object({op:{const:'clip.trim'},clipId:id,edge:{enum:['start','end']},time:videoTimeSchema}),object({op:{const:'clip.effects'},clipId:id,effects:{anyOf:[visualEffectsSchema,{type:'null'}]}}),object({op:{const:'clip.mute'},clipId:id,muted:{type:'boolean'}}),object({op:{const:'layer.remove'},clipId:id}),object({op:{const:'layer.set'},clipId:id,patch:layerPatch}),object({op:{const:'layer.add'},kind:{enum:['text','rectangle','image','video','audio']},sceneId,artifactId:{type:'string'}},['op','kind'])]}}})}
