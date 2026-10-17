import type {VisualLayer} from '../../media-native/src/composition-layers.js'
import {COMPOSITION_LIMITS} from '../../media-native/src/composition-contract.js'
import {assertVideoEdit,sceneFields,layerFields} from './video-edit-contract.js'
import type {VideoEdit} from './video-edit-contract.js'
export {assertVideoEdit} from './video-edit-contract.js'
export type {VideoEdit,VideoEditCommand} from './video-edit-contract.js'
import {assertVideoDraft,newStudioScene} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'
import {finiteNumber} from '../../media-native/src/media-contract.js'
import {visualEffectsSchema} from '../../media-native/src/visual-effects.js'
import {addStudioCardStack,addStudioLayer,editStudioLayer,removeStudioLayer,splitStudioLayer,trimStudioLayer} from './studio-layer-edits.js'
import type {StudioLayerSelection} from './studio-layer-edits.js'
import {moveStudioMain,trimStudioMain,splitStudioMain,setStudioMainEffects,setStudioMainMuted} from './studio-main-edits.js'
import type {StudioMainSelection} from './studio-main-edits.js'
import {videoDocumentFromDraft,videoSeconds,videoTimeSchema} from './video-document.js'
import {studioDraftSchema} from './studio-schema.js'
import {visualLayersSchema,audioLayersSchema} from '../../media-native/src/composition-layers.js'
import {cardSpeechChoicesSchema,cardSpeechTargets} from './studio-card-speech.js'
import {speechBindingStale,speechScene} from './studio-speech-contract.js'
/** In-memory transaction; the owning service performs admission and one CAS write. */
export function applyVideoEdit(raw:VideoDraft,edit:VideoEdit,trustedCaptions=false):VideoDraft {
 let draft=assertVideoDraft(raw)
 for(const c of assertVideoEdit(edit).commands){
  if(c.op==='brief.set'){draft.preparation={...draft.preparation,...structuredClone(c.patch)};draft=assertVideoDraft(draft);continue}
  if(c.op==='scene.add'){
   if(draft.scenes.some(s=>s.id===c.scene.id))throw new Error('VIDEO_EDIT_SCENE: Duplicate scene identity.')
   const after=c.afterSceneId===undefined?draft.scenes.length-1:draft.scenes.findIndex(s=>s.id===c.afterSceneId);if(c.afterSceneId!==undefined&&after<0)throw new Error('VIDEO_EDIT_SCENE: Unknown insertion scene.')
   const {script,...content}=c.scene;draft.scenes.splice(after+1,0,{...newStudioScene(c.scene.id,c.scene.title),...content,...(script===undefined?{}:{narration:script})});draft=assertVideoDraft(draft);continue
  }
  if(c.op==='captions.set'||c.op==='card.set'||c.op==='card.bind'){
   const scene=draft.scenes.find(s=>s.id===c.sceneId);if(!scene)throw new Error('VIDEO_EDIT_SCENE: Unknown scene.')
   if(c.op==='captions.set'){
    if(scene.sourceCaptionBinding)throw new Error('VIDEO_EDIT_CAPTIONS: Detach original-source captions explicitly before replacing them.')
    const proposed=c.mode==='manual'?c.cues:[]
    if(!trustedCaptions&&scene.captions?.some(old=>old.translationOrigin==='user-edited'&&!proposed.some(cue=>cue.startSeconds===old.startSeconds&&cue.endSeconds===old.endSeconds&&cue.text===old.text&&cue.translationText===old.translationText)))throw new Error('STUDIO_TRANSLATION_EDITED: Preserve user-corrected caption translations.')
    if(c.mode==='sentences'){if(speechBindingStale(scene,scene.speechAnchors)||!scene.speechAnchors?.anchors.length)throw new Error('STUDIO_SPEECH_STALE: Sentence captions require current measured anchors.');delete scene.captions;scene.speechCaptions=true;speechScene(scene)}
    else {scene.speechCaptions=false;scene.captions=c.mode==='manual'?structuredClone(c.cues):[]}
   }else{
    if(c.op==='card.set')scene.cardSpec=structuredClone(c.cardSpec)
    if(c.links!==undefined){
     if(c.links.length&&(speechBindingStale(scene,scene.speechAnchors)||!scene.speechAnchors?.anchors.length))throw new Error('STUDIO_SPEECH_STALE: Card binding requires current measured anchors.')
     const targets=cardSpeechTargets(scene),cards=c.links.map(choice=>{const target=targets.find(t=>t.kind===choice.kind&&t.index===choice.index);if(!target)throw new Error('STUDIO_SPEECH_REFERENCE: Choose a current card target.');const {label,...identity}=target;return {...identity,anchorId:choice.anchorId}})
     scene.speechLinks={bullets:scene.speechLinks?.bullets??[],focus:scene.speechLinks?.focus??[],cards};speechScene(scene)
    }
   }
   draft=assertVideoDraft(draft);continue
  }
  if(c.op==='scene.set'){const scene=draft.scenes.find(s=>s.id===c.sceneId);if(!scene)throw new Error('VIDEO_EDIT_SCENE: Unknown scene.');const {script,...patch}=c.patch;Object.assign(scene,patch);if(script!==undefined)scene.narration=script;draft=assertVideoDraft(draft);continue}
  if(c.op==='scene.reorder'){if(c.sceneIds.length!==draft.scenes.length||new Set(c.sceneIds).size!==c.sceneIds.length||c.sceneIds.some(id=>!draft.scenes.some(s=>s.id===id)))throw new Error('VIDEO_EDIT_ORDER: Exact scene permutation required.');draft.scenes=c.sceneIds.map(id=>draft.scenes.find(s=>s.id===id)!);continue}
  if(c.op==='layer.add'){draft=(c.kind==='card-stack'?addStudioCardStack(draft,c.sceneId):addStudioLayer(draft,c.sceneId,c.kind,c.artifactId)).draft;continue}
  const doc=videoDocumentFromDraft(draft),track=doc.content.timeline.tracks.find(t=>t.clips.some(p=>p.id===c.clipId)),clip=track?.clips.find(p=>p.id===c.clipId)
  if(!track||!clip)throw new Error('VIDEO_EDIT_CLIP: Unknown clip; read the current revision and IDs.')
  const layer:StudioLayerSelection={id:String(clip.properties.sourceIdentity),kind:track.kind==='audio'?'audio':'visual',...(track.sceneId?{sceneId:track.sceneId}:{})}
  const isLayer=track.role==='overlay'||track.role==='audio'
  if(c.op==='layer.remove'){if(!isLayer)throw new Error('VIDEO_EDIT_KIND: layer.remove requires an independent object.');draft=removeStudioLayer(draft,layer);continue}
  if(c.op==='layer.set'){if(!isLayer)throw new Error('VIDEO_EDIT_KIND: layer.set requires an independent object.');draft=editStudioLayer(draft,layer,value=>{Object.assign(value,c.patch);if(layer.kind==='visual')for(const key of ['textTreatment','packaging','sourceCrop'] as const)if(c.patch[key]===null)delete (value as VisualLayer)[key]},Object.keys(c.patch).length===1&&c.patch.locked===false);continue}
  let offset=0;for(const scene of draft.scenes){if(scene.id===track.sceneId)break;offset+=scene.durationSeconds}
  const global='time' in c?finiteNumber(videoSeconds(c.time),'global edit time',0,COMPOSITION_LIMITS.seconds):0
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
const sceneAdd={...scenePatch,required:['id','title'],properties:{...scenePatch.properties,id:sceneId}}
const briefPatch={minProperties:1,...object(studioDraftSchema.properties.preparation.properties,[])}
const layerPatch={minProperties:1,...object(Object.fromEntries(layerFields.map(k=>{const schema={...visualLayersSchema.items.properties,...audioLayersSchema.items.properties}[k];return [k,['textTreatment','packaging','sourceCrop'].includes(k)?{anyOf:[schema,{type:'null'}]}:schema]})),[])}
export const videoEditSchema={ $schema:'https://json-schema.org/draft/2020-12/schema', $id:'https://bmw.local/schemas/video-edit/1', ...object({version:{const:1},commands:{type:'array',minItems:1,maxItems:32,items:{oneOf:[object({op:{const:'brief.set'},patch:briefPatch}),object({op:{const:'scene.add'},scene:sceneAdd,afterSceneId:sceneId},['op','scene']),object({op:{const:'captions.set'},sceneId,mode:{const:'manual'},cues:sceneProps.captions}),object({op:{const:'captions.set'},sceneId,mode:{enum:['sentences','off']}}),object({op:{const:'card.set'},sceneId,cardSpec:sceneProps.cardSpec,links:cardSpeechChoicesSchema},['op','sceneId','cardSpec']),object({op:{const:'card.bind'},sceneId,links:cardSpeechChoicesSchema}),object({op:{const:'scene.set'},sceneId,patch:scenePatch}),object({op:{const:'scene.reorder'},sceneIds:{type:'array',maxItems:COMPOSITION_LIMITS.scenes,uniqueItems:true,items:sceneId}}),...['clip.move','clip.split'].map(op=>object({op:{const:op},clipId:id,time:videoTimeSchema})),object({op:{const:'clip.trim'},clipId:id,edge:{enum:['start','end']},time:videoTimeSchema}),object({op:{const:'clip.effects'},clipId:id,effects:{anyOf:[visualEffectsSchema,{type:'null'}]}}),object({op:{const:'clip.mute'},clipId:id,muted:{type:'boolean'}}),object({op:{const:'layer.remove'},clipId:id}),object({op:{const:'layer.set'},clipId:id,patch:layerPatch}),object({op:{const:'layer.add'},kind:{enum:['text','rectangle','image','video','audio','diagram']},sceneId,artifactId:{type:'string'}},['op','kind']),object({op:{const:'layer.add'},kind:{const:'card-stack'},sceneId},['op','kind'])]}}})}
