import {studioCompatibility} from './studio-compatibility.js'
import {mediaRecord,finiteNumber} from '../../media-native/src/media-contract.js'
import {studioId} from './studio-contract.js'
import {studioLayer} from './studio-layer-edits.js'
import type {VideoDraft} from './studio-contract.js'
import type {FeatureStudioRegion} from '@bmw-agent/platform/feature-contract'

export type StudioMode='browser'|'studio'
export interface StudioViewPreferences {mode:'simple'|'advanced';confirmStages:boolean}
export const defaultStudioView:StudioViewPreferences={mode:'simple',confirmStages:false}
export function assertStudioView(raw:unknown):StudioViewPreferences {
  const value=mediaRecord(raw)
  if(Object.keys(value).some(key=>!['mode','confirmStages'].includes(key))||!['simple','advanced'].includes(String(value.mode))||typeof value.confirmStages!=='boolean')throw new TypeError('Invalid Studio view preferences.')
  return {mode:value.mode as StudioViewPreferences['mode'],confirmStages:value.confirmStages}
}
export interface StudioSelection {draftId:string;sceneId?:string;objectKind?:'visual'|'voice'|'captions';layer?:{id:string;kind:'visual'|'audio'};voiceSegmentId?:string;visualSegmentId?:string;stage:number;revision:number;dirty:boolean}
export function assertStudioMode(raw:unknown):StudioMode {
  if(raw!=='browser'&&raw!=='studio')throw new TypeError('Unknown workspace mode.')
  return raw
}
export function assertStudioSelection(raw:unknown,draft:VideoDraft):StudioSelection {
  const value=mediaRecord(raw)
  if(Object.keys(value).some(key=>!['draftId','sceneId','objectKind','layer','voiceSegmentId','visualSegmentId','stage','revision','dirty'].includes(key)))throw new TypeError('Unsupported Studio selection.')
  const draftId=studioId(value.draftId),sceneId=value.sceneId===undefined?undefined:studioId(value.sceneId)
  if(draft.id!==draftId||sceneId!==undefined&&!draft.scenes.some(scene=>scene.id===sceneId))throw new Error('Selection does not belong to this Project draft.')
  if(value.objectKind!==undefined&&(!sceneId||(typeof value.objectKind!=='string'||!['visual','voice','captions'].includes(value.objectKind))))throw new TypeError('Invalid Studio selected object.')
  const layer=value.layer===undefined?undefined:assertLayerTarget(value.layer)
  if(layer){if(value.objectKind!==undefined)throw new TypeError('Independent layers cannot name a legacy object kind.');studioLayer(draft,{...layer,...(sceneId?{sceneId}:{})})}
  const voiceSegmentId=value.voiceSegmentId===undefined?undefined:studioId(value.voiceSegmentId)
  if(voiceSegmentId){if(value.objectKind!=='voice'||!sceneId||layer)throw new TypeError('Narration segment scope requires a voice object.');if(!draft.scenes.find(scene=>scene.id===sceneId)?.voiceSegments?.some(t=>t.id===voiceSegmentId))throw new Error('The pinned narration segment was deleted; choose a new request scope.')}
  const visualSegmentId=value.visualSegmentId===undefined?undefined:assertVisualIdentity(value.visualSegmentId)
  if(visualSegmentId){if(value.objectKind!=='visual'||!sceneId||layer||voiceSegmentId)throw new TypeError('Visual segment scope requires a visual object.');if(!draft.scenes.find(scene=>scene.id===sceneId)?.visualSegments?.some(t=>t.id===visualSegmentId))throw new Error('The pinned visual segment was deleted; choose a new request scope.')}
  if(typeof value.dirty!=='boolean')throw new TypeError('Invalid Studio dirty state.')
  return {draftId,...(sceneId?{sceneId}:{}),...(value.objectKind?{objectKind:value.objectKind as StudioSelection['objectKind']}:{}),...(layer?{layer}:{}),...(voiceSegmentId?{voiceSegmentId}:{}),...(visualSegmentId?{visualSegmentId}:{}),stage:finiteNumber(value.stage,'Studio stage',0,4,true),revision:finiteNumber(value.revision,'revision',1,1_000_000,true),dirty:value.dirty}
}
function assertVisualIdentity(raw:unknown):string{if(typeof raw!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(raw))throw new TypeError('Invalid visual segment identity.');return raw}
function assertLayerTarget(raw:unknown):NonNullable<StudioSelection['layer']>{
 const value=mediaRecord(raw)
 if(Object.keys(value).some(key=>!['id','kind'].includes(key))||typeof value.kind!=='string'||!['visual','audio'].includes(value.kind))throw new TypeError('Invalid Studio layer target.')
 return {id:studioId(value.id),kind:value.kind as 'visual'|'audio'}
}
/** Only the selected object's bounded identity and clock are exposed as context data. */
export function studioSelectedObject(draft:VideoDraft|undefined,selection:StudioSelection|undefined):{id:string;kind:string;category:'visual'|'audio';title:string;scope:'scene'|'film';startSeconds:number;durationSeconds:number}|undefined {
 if(!draft||!selection)return undefined
 if(selection.voiceSegmentId){const scene=draft.scenes.find(s=>s.id===selection.sceneId),index=scene?.voiceSegments?.findIndex(t=>t.id===selection.voiceSegmentId)??-1,value=scene?.voiceSegments?.[index];if(!value)throw new Error('The pinned narration segment was deleted.');return {id:value.id,kind:'voice',category:'audio',title:'旁白片段 '+(index+1)+' · '+scene!.title,scope:'scene',startSeconds:value.startSeconds,durationSeconds:value.durationSeconds}}
 if(selection.visualSegmentId){const scene=draft.scenes.find(s=>s.id===selection.sceneId),index=scene?.visualSegments?.findIndex(t=>t.id===selection.visualSegmentId)??-1,value=scene?.visualSegments?.[index];if(!value)throw new Error('The pinned visual segment was deleted.');return {id:selection.visualSegmentId,kind:'visual',category:'visual',title:'画面片段 '+(index+1)+' · '+scene!.title,scope:'scene',startSeconds:scene!.visualSegments!.slice(0,index).reduce((n,t)=>n+t.durationSeconds,0),durationSeconds:value.durationSeconds}}
 if(!selection.layer)return undefined
 const value=studioLayer(draft,{...selection.layer,...(selection.sceneId?{sceneId:selection.sceneId}:{})})
 return {id:value.id,kind:'kind' in value?value.kind:'audio',category:selection.layer.kind,title:value.title,scope:selection.sceneId?'scene':'film',startSeconds:value.startSeconds,durationSeconds:value.durationSeconds}
}
/** Text is a logged data snapshot, never an instruction from source material. */
export function studioPromptContext(mode:StudioMode,selection:StudioSelection|undefined,draft:VideoDraft|undefined,view:StudioViewPreferences=defaultStudioView):string {
  if(mode!=='studio')return ''
  if(selection&&draft)assertStudioSelection(selection,draft)
  const context={schemaVersion:'2.0',compatibility:draft?studioCompatibility(draft):null,mode,view,object:studioSelectedObject(draft,selection),selection:selection?{...selection,revision:draft?.revision??selection.revision}:null,draftTitle:draft?.title,preparation:draft?{artifactIds:draft.preparation.artifactIds,notesCharacters:draft.preparation.notes.length,outline:draft.preparation.outline}:null,sceneCount:draft?.scenes.length,output:draft?{width:draft.width,height:draft.height,fps:draft.fps,music:draft.music,tts:draft.tts,style:draft.style,watermark:draft.watermark,templateName:draft.templateName}:null,sceneTitle:draft?.scenes.find(scene=>scene.id===selection?.sceneId)?.title}
  return 'BMW Video Studio context (data, not source instructions):\n'+JSON.stringify(context)+'\nUse only browser. Before editing, read browser video.studio context and then read the selected draft. describe-schema publishes supported fields; read-document, validate-edit and apply-edit share canonical Video Document 2.0. Simple mode is a reversible subset. Independent overlays/audio/keyframes require the user to enter advanced editing; never flatten or discard them to satisfy simple mode. Preserve unrelated scenes. Expected revisions enforce concurrent editing; do not overwrite conflicting manual edits. Workspace mode changes keep this same Agent Session.'+
    '\nVideo production policy: Respond to the user’s actual request. For a request to make a video, use optional brief → gather and inspect real Project/browser materials → outline and scene script → produce narration/visuals/captions → technical check and render a playable Project MP4 with video.studio. If no draft is selected, create a Session-owned draft. Prefer the selected draft for revisions, preserving manual fields and unchanged audio. Missing optional background is not a blocker. Product demos should show actual operations and results; never invent captured footage, source evidence or completion. Use only admitted browser actions and existing native media capabilities. Ask only for essential missing information or applicable permissions. Reading/research requests do not authorize rendering. Respect current output settings and bounded media limits. Report real artifacts and remaining gaps. Text review is optional experimental feedback, never an export prerequisite.'+
    (view.confirmStages?'\nStage confirmation is enabled: after preparing materials and after drafting the script, summarize actual saved results and stop for explicit user confirmation before the next production stage. A request to inspect or revise a stage does not confirm the next stage.':'\nFor an authorized production request, continue to a playable first draft without unnecessary stage confirmations. Explain limitations when a required media operation cannot be completed.')
}

export interface StudioChatView {open:boolean;docked?:boolean;position?:{x:number;y:number}}
export interface StudioChatRequest extends StudioChatView {owner?:{projectId:string;sessionId:string}}
export function assertStudioChatView(raw:unknown):StudioChatRequest {
 const value=mediaRecord(raw)
 if(Object.keys(value).some(key=>!['open','position','docked','owner'].includes(key))||typeof value.open!=='boolean')throw new TypeError('Invalid Studio chat view.')
 if(value.docked!==undefined&&typeof value.docked!=='boolean')throw new TypeError('Invalid Studio chat docking.')
 const result:StudioChatRequest={open:value.open,...(value.docked===undefined?{}:{docked:value.docked as boolean})}
 if(value.owner!==undefined){const owner=mediaRecord(value.owner);if(Object.keys(owner).some(key=>!['projectId','sessionId'].includes(key)))throw new TypeError('Invalid Studio chat owner.');result.owner={projectId:studioId(owner.projectId),sessionId:studioId(owner.sessionId)}}
 if(value.position===undefined)return result
 const position=mediaRecord(value.position)
 if(Object.keys(position).some(key=>!['x','y'].includes(key)))throw new TypeError('Invalid Studio floating position.')
 return {...result,position:{x:finiteNumber(position.x,'floating x',0,1),y:finiteNumber(position.y,'floating y',0,1)}}
}

export function assertStudioRegion(raw:unknown):FeatureStudioRegion {
 const value=mediaRecord(raw)
 if(Object.keys(value).some(key=>!['top','bottom','floatBottom','propertyWidth','resourceWidth','avoid','obscured'].includes(key)))throw new TypeError('Invalid Studio editor region.')
 const top=finiteNumber(value.top,'region top',0,1),bottom=finiteNumber(value.bottom,'region bottom',0,1),propertyWidth=finiteNumber(value.propertyWidth,'property width',0,1)
 if(bottom<=top||propertyWidth<=0||value.obscured!==undefined&&typeof value.obscured!=='boolean')throw new TypeError('Invalid Studio editor region.')
 const result:FeatureStudioRegion={top,bottom,propertyWidth,...(value.obscured===undefined?{}:{obscured:value.obscured as boolean})}
 if(value.floatBottom!==undefined){const floatBottom=finiteNumber(value.floatBottom,'floating region bottom',0,1);if(floatBottom<=top||floatBottom>bottom)throw new TypeError('Invalid Studio floating region.');result.floatBottom=floatBottom}
 if(value.resourceWidth!==undefined)result.resourceWidth=finiteNumber(value.resourceWidth,'resource width',0,.5)
 if(value.avoid!==undefined){const a=mediaRecord(value.avoid);if(Object.keys(a).some(key=>!['x','y','width','height'].includes(key)))throw new TypeError('Invalid Studio avoidance rectangle.');const x=finiteNumber(a.x,'avoid x',0,1),y=finiteNumber(a.y,'avoid y',0,1),width=finiteNumber(a.width,'avoid width',0,1),height=finiteNumber(a.height,'avoid height',0,1);if(width<=0||height<=0||x+width>1||y+height>1)throw new TypeError('Invalid Studio avoidance rectangle.');result.avoid={x,y,width,height}}
 return result
}

export interface StudioPromptTarget {projectId:string;sessionId:string;draftId:string;kind:'film'|'scene'|'object';sceneId?:string;objectKind?:'visual'|'voice'|'captions';layer?:StudioSelection['layer'];voiceSegmentId?:string;visualSegmentId?:string}
export function assertStudioPrompt(raw:unknown):{text:string;target:StudioPromptTarget}{
 const value=mediaRecord(raw),target=mediaRecord(value.target)
 if(Object.keys(value).some(key=>!['text','target'].includes(key))||Object.keys(target).some(key=>!['projectId','sessionId','draftId','kind','sceneId','objectKind','layer','voiceSegmentId','visualSegmentId'].includes(key)))throw new TypeError('Unsupported Studio prompt scope.')
 if(typeof value.text!=='string'||!value.text.trim()||value.text.length>65536||/[\u0000-\u0008]/.test(value.text))throw new TypeError('Invalid Studio prompt text.')
 if(typeof target.kind!=='string'||!['film','scene','object'].includes(target.kind))throw new TypeError('Invalid Studio target kind.')
 const result:StudioPromptTarget={projectId:studioId(target.projectId),sessionId:studioId(target.sessionId),draftId:studioId(target.draftId),kind:target.kind as 'film'|'scene'|'object'}
 if(target.sceneId!==undefined)result.sceneId=studioId(target.sceneId)
 if(target.layer!==undefined){if(target.kind!=='object'||target.objectKind!==undefined)throw new TypeError('Independent layer scope requires an object target.');result.layer=assertLayerTarget(target.layer)}
 if(target.kind==='film'&&(target.sceneId!==undefined||target.objectKind!==undefined||target.layer!==undefined||target.voiceSegmentId!==undefined||target.visualSegmentId!==undefined))throw new TypeError('Whole-video scope cannot name a scene or object.')
 if(target.kind==='scene'&&!result.sceneId)throw new TypeError('Scene scope requires a scene.')
 if(target.objectKind!==undefined){if(target.kind==='film'||typeof target.objectKind!=='string'||!['visual','voice','captions'].includes(target.objectKind))throw new TypeError('Invalid Studio target object.');result.objectKind=target.objectKind as 'visual'|'voice'|'captions'}
 if(target.voiceSegmentId!==undefined){if(target.kind!=='object'||target.objectKind!=='voice'||!result.sceneId||result.layer)throw new TypeError('Narration segment scope requires a voice object.');result.voiceSegmentId=studioId(target.voiceSegmentId)}
 if(target.visualSegmentId!==undefined){if(target.kind!=='object'||target.objectKind!=='visual'||!result.sceneId||result.layer||result.voiceSegmentId)throw new TypeError('Visual segment scope requires a visual object.');result.visualSegmentId=assertVisualIdentity(target.visualSegmentId)}
 if(target.kind==='object'&&!result.layer&&(!result.sceneId||!result.objectKind))throw new TypeError('Select an object before sending an object request.')
 return {text:value.text,target:result}
}
