import {assertVideoDraft,studioId} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'
import {studioDraftSchema} from './studio-schema.js'
import {mediaRecord} from '../../media-native/src/media-contract.js'
import {visualSegmentsSchema} from '../../media-native/src/visual-segments.js'
import type {VisualLayer,AudioLayer} from '../../media-native/src/composition-layers.js'

export {VIDEO_TIMEBASE,videoTime,videoSeconds,videoTimeSchema} from './video-time.js'
export type {VideoTime} from './video-time.js'
import {VIDEO_TIMEBASE,videoTime,videoSeconds,videoTimeSchema} from './video-time.js'
import type {VideoTime} from './video-time.js'
export interface VideoRegion {id:string;sceneId:string;start:VideoTime;duration:VideoTime}
export interface VideoClip {
 id:string;kind:'visual'|'voice'|'caption'|'visual-layer'|'audio-layer';sceneId?:string
 timing:{clock:'scene'|'timeline';start:VideoTime;duration?:VideoTime;end?:VideoTime}
 properties:Record<string,unknown>
 /** Codec identity, never a second editable timing or a compatibility certificate. */
 encoding?:'single'|'segments'|'window'|'auto'
}
export interface VideoTrack {id:string;kind:'visual'|'audio'|'caption';role:'primary'|'narration'|'caption'|'overlay'|'audio';sceneId?:string;clips:VideoClip[]}
export interface VideoDocument {
 format:'bmw.video';schemaVersion:'2.0';id:string;revision:number;owner:{sessionId?:string}
 content:{title:string;settings:Record<string,unknown>&{timebase:1000000;frameRate:{numerator:number;denominator:1}};brief:VideoDraft['preparation'];story:{scenes:Record<string,unknown>[]};timeline:{duration:VideoTime;regions:VideoRegion[];tracks:VideoTrack[]};cover?:VideoDraft['cover']}
 records:{updatedAt:string;exports:VideoDraft['exports'];coverExports?:VideoDraft['coverExports'];referenceRecords?:VideoDraft['referenceRecords'];reviewItems?:VideoDraft['reviewItems'];emptyContainers?:{sceneId?:string;field:'layers'|'audioTracks'}[];sceneEvidence:Record<string,unknown>[]}
}
const sceneFields=['id','title','label','visualBrief','sources','citations','bullets','endPolicy','layout','captionStyle','captionDisplay','showSceneNumber','sceneTemplate','speechCaptions','speechLinks','bulletRevealSeconds','voiceVolume','voiceMuted'] as const
const evidenceFields=['audioArtifactId','audioText','audioGeneration','audioDurationSeconds','speechPlaybackOrigin','sourceSpeech','sourceCaptionBinding','speechCandidate','speechAnchors','presentationWindow'] as const
const visualFields=['imageArtifactId','videoArtifactId','sourceStartSeconds','playbackRate','zoom','crop','keepSourceAudio','sourceVolume','effects','focusIntervals','effectWindow','transition','transitionSeconds','sourceDurationSeconds'] as const
const settingsFields=['width','height','music','tts','style','watermark','templateName'] as const
function pick(value:object,keys:readonly string[]):Record<string,unknown>{const v=value as Record<string,unknown>;return Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,structuredClone(v[k])]))}
function closed(v:Record<string,unknown>,keys:readonly string[]):void{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('VIDEO_SCHEMA_FIELD: 未支持的视频字段。')}
function identity(_sceneId:string,_kind:string,index:number):string{return String(index)}
function clipIdentity(sceneId:string|undefined,kind:string,id:string):string{return `${kind}-${sceneId?sceneId.length+'-'+sceneId:'global'}-${id}`}
export function videoDocumentFromDraft(raw:VideoDraft):VideoDocument {
 const d=assertVideoDraft(raw),regions:VideoRegion[]=[],tracks:VideoTrack[]=[],scenes:Record<string,unknown>[]=[],evidence:Record<string,unknown>[]=[],emptyContainers:NonNullable<VideoDocument['records']['emptyContainers']>=[];let offset=0
 const clip=(id:string,kind:VideoClip['kind'],start:number,duration:number,properties:Record<string,unknown>,sceneId?:string,encoding?:VideoClip['encoding']):VideoClip=>({id:clipIdentity(sceneId,kind,id),kind,...(sceneId?{sceneId}:{}),timing:{clock:sceneId?'scene':'timeline',start:videoTime(start),duration:videoTime(duration)},properties,...(encoding?{encoding}:{})})
 const track=(id:string,kind:VideoTrack['kind'],role:VideoTrack['role'],clips:VideoClip[],sceneId?:string)=>tracks.push({id,kind,role,...(sceneId?{sceneId}:{}),clips})
 const layers=(container:{layers?:VisualLayer[];audioTracks?:AudioLayer[]},sceneId?:string)=>{
  for(const field of ['layers','audioTracks'] as const)if(container[field]?.length===0)emptyContainers.push({...sceneId?{sceneId}:{},field})
  for(const layer of container.layers??[]){const {id,startSeconds,durationSeconds,...properties}=layer;track('track-'+id,'visual','overlay',[clip(id,'visual-layer',startSeconds,durationSeconds,{...properties,sourceIdentity:id},sceneId)],sceneId)}
  for(const layer of container.audioTracks??[]){const {id,startSeconds,durationSeconds,...properties}=layer;track('track-'+id,'audio','audio',[clip(id,'audio-layer',startSeconds,durationSeconds,{...properties,sourceIdentity:id},sceneId)],sceneId)}
 }
 for(const scene of d.scenes){
  regions.push({id:'region-'+scene.id,sceneId:scene.id,start:videoTime(offset),duration:videoTime(scene.durationSeconds)});offset+=scene.durationSeconds
  scenes.push({...pick(scene,sceneFields),script:scene.narration,...(scene.visualSegments?{visualDefaults:pick(scene,visualFields)}:{})})
  evidence.push({sceneId:scene.id,...pick(scene,evidenceFields),voiceEncoding:scene.voiceSegments!==undefined?'segments':scene.voiceTiming?'window':'auto'})
  let visualOffset=0
  const visuals=scene.visualSegments??[{...pick(scene,visualFields),durationSeconds:scene.durationSeconds}]
  track('primary-'+scene.id,'visual','primary',visuals.map((v,index)=>{const result=clip(v.id??identity(scene.id,'visual',index),'visual',visualOffset,v.durationSeconds,{...pick(v,visualFields),...(v.id?{sourceIdentity:v.id}:{})},scene.id,scene.visualSegments?'segments':'single');visualOffset+=v.durationSeconds;return result}),scene.id)
  const voices=scene.voiceSegments??(scene.voiceTiming?[scene.voiceTiming]:[])
  track('voice-'+scene.id,'audio','narration',voices.map((v,index)=>{const {startSeconds,durationSeconds,...properties}=v;return clip('id' in v?String(v.id):identity(scene.id,'voice',index),'voice',startSeconds,durationSeconds,{...properties},scene.id,scene.voiceSegments?'segments':'window')}),scene.id)
  if(scene.captions!==undefined)track('captions-'+scene.id,'caption','caption',scene.captions.map((v,index)=>{const {startSeconds,endSeconds,...properties}=v;const result=clip(identity(scene.id,'caption',index),'caption',startSeconds,endSeconds-startSeconds,properties,scene.id);delete result.timing.duration;result.timing.end=videoTime(endSeconds);return result}),scene.id)
  layers(scene,scene.id)
 }
 layers(d)
 return {format:'bmw.video',schemaVersion:'2.0',id:d.id,revision:d.revision,owner:{...(d.ownerSessionId?{sessionId:d.ownerSessionId}:{})},content:{title:d.title,settings:{...pick(d,settingsFields),timebase:VIDEO_TIMEBASE,frameRate:{numerator:d.fps,denominator:1}},brief:structuredClone(d.preparation),story:{scenes},timeline:{duration:videoTime(offset),regions,tracks},...(d.cover?{cover:structuredClone(d.cover)}:{})},records:{updatedAt:d.updatedAt,exports:structuredClone(d.exports),...(d.coverExports?{coverExports:structuredClone(d.coverExports)}:{}),...(d.referenceRecords?{referenceRecords:structuredClone(d.referenceRecords)}:{}),...(d.reviewItems?{reviewItems:structuredClone(d.reviewItems)}:{}),...(emptyContainers.length?{emptyContainers}:{}),sceneEvidence:evidence}}
}
export function videoDraftFromDocument(raw:unknown):VideoDraft {
 const d=mediaRecord(raw);closed(d,['format','schemaVersion','id','revision','owner','content','records'])
 if(d.format!=='bmw.video'||d.schemaVersion!=='2.0')throw new TypeError('VIDEO_SCHEMA_VERSION: 当前只支持 bmw.video 2.0。')
 const owner=mediaRecord(d.owner);closed(owner,['sessionId']);if(owner.sessionId!==undefined)studioId(owner.sessionId)
 const c=mediaRecord(d.content);if(c.brief===undefined)throw new TypeError('VIDEO_SCHEMA_REQUIRED: Missing brief.');closed(c,['title','settings','brief','story','timeline','cover'])
 const settings=mediaRecord(c.settings);if(['width','height','music'].some(k=>settings[k]===undefined))throw new TypeError('VIDEO_SCHEMA_REQUIRED: Missing output setting.');closed(settings,[...settingsFields,'timebase','frameRate']);if(settings.timebase!==VIDEO_TIMEBASE)throw new TypeError('VIDEO_TIMEBASE: Unsupported clock.')
 const fps=mediaRecord(settings.frameRate);closed(fps,['numerator','denominator']);if(fps.numerator===undefined||fps.denominator!==1)throw new TypeError('VIDEO_CAPABILITY: 当前帧率需为整数。')
 const story=mediaRecord(c.story);closed(story,['scenes']);if(!Array.isArray(story.scenes)||story.scenes.length>24)throw new TypeError('VIDEO_SCENES: 当前支持至多 24 个分镜。')
 const tl=mediaRecord(c.timeline);closed(tl,['duration','regions','tracks']);if(!Array.isArray(tl.regions)||tl.regions.length!==story.scenes.length||!Array.isArray(tl.tracks)||tl.tracks.length>150)throw new TypeError('VIDEO_TIMELINE: Invalid region/track budget.')
 const records=mediaRecord(d.records);closed(records,['updatedAt','exports','coverExports','referenceRecords','reviewItems','emptyContainers','sceneEvidence']);if(!Array.isArray(records.sceneEvidence)||records.sceneEvidence.length!==story.scenes.length)throw new TypeError('VIDEO_EVIDENCE: Invalid scene records.')
 const ids=new Set<string>(),trackIds=new Set<string>(),usedTracks=new Set<object>(),usedEvidence=new Set<unknown>();let offset=0
 const parseTime=(v:unknown)=>videoSeconds(v as VideoTime)
 const parseTrack=(raw:unknown):VideoTrack=>{
  const t=mediaRecord(raw);closed(t,['id','kind','role','sceneId','clips']);if(typeof t.id!=='string'||!t.id||t.id.length>256||trackIds.has(t.id))throw new TypeError('VIDEO_TRACK_ID: Duplicate/invalid track.');trackIds.add(t.id)
  if(!['visual','audio','caption'].includes(String(t.kind))||!['primary','narration','caption','overlay','audio'].includes(String(t.role))||!Array.isArray(t.clips)||t.clips.length>100)throw new TypeError('VIDEO_TRACK: Unsupported track.')
  if(t.sceneId!==undefined)studioId(t.sceneId)
  const roleKind={primary:'visual',narration:'audio',caption:'caption',overlay:'visual',audio:'audio'}[String(t.role)];if(t.kind!==roleKind)throw new TypeError('VIDEO_TRACK_KIND: Track role and kind disagree.')
  const expectedTrackId=t.role==='primary'?'primary-'+t.sceneId:t.role==='narration'?'voice-'+t.sceneId:t.role==='caption'?'captions-'+t.sceneId:t.clips.length===1?'track-'+mediaRecord(mediaRecord(t.clips[0]).properties).sourceIdentity:undefined;if(t.id!==expectedTrackId)throw new TypeError('VIDEO_TRACK_ID: Track has no reversible identity.')
  for(const [clipIndex,rawClip]of t.clips.entries()){const p=mediaRecord(rawClip);closed(p,['id','kind','sceneId','timing','properties','encoding']);if(typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,256}$/.test(p.id)||ids.has(p.id))throw new TypeError('VIDEO_CLIP_ID: Duplicate/invalid clip.');ids.add(p.id)
   const timing=mediaRecord(p.timing);closed(timing,['clock','start','duration','end']);const validInterval=p.kind==='caption'?timing.duration===undefined&&parseTime(timing.end)>parseTime(timing.start):timing.end===undefined&&parseTime(timing.duration)>0;if(timing.clock!==(t.sceneId?'scene':'timeline')||p.sceneId!==t.sceneId||!validInterval)throw new TypeError('VIDEO_CLOCK: Wrong clock or empty interval.');parseTime(timing.start);const properties=mediaRecord(p.properties);const legacyId=p.kind==='visual'?properties.sourceIdentity:p.kind==='voice'?properties.id:p.kind==='caption'?undefined:properties.sourceIdentity;if(p.id!==clipIdentity(t.sceneId as string|undefined,String(p.kind),String(legacyId??clipIndex)))throw new TypeError('VIDEO_CLIP_ID: Clip has no reversible identity.')
   if(p.encoding!==undefined&&!['visual','voice'].includes(String(p.kind)))throw new TypeError('VIDEO_ENCODING: Object has no codec mode.');
   if(p.encoding!==undefined&&!['single','segments','window','auto'].includes(String(p.encoding)))throw new TypeError('VIDEO_ENCODING: Unknown codec mode.')
   const role={primary:['visual','visual'],narration:['audio','voice'],caption:['caption','caption'],overlay:['visual','visual-layer'],audio:['audio','audio-layer']}[String(t.role)]
   if(role[0]!==t.kind||role[1]!==p.kind)throw new TypeError('VIDEO_TRACK_KIND: 轨道与对象类型不一致。')
  }
  return raw as VideoTrack
 }
 const tracks=tl.tracks.map(parseTrack)
 const forScene=(sceneId:string|undefined,role:VideoTrack['role'])=>tracks.filter(t=>t.sceneId===sceneId&&t.role===role).map(t=>{usedTracks.add(t);return t})
 const layers=(sceneId?:string)=>{
  const result:Record<string,unknown>={}
  for(const rawEmpty of emptyContainers as unknown[]){const e=mediaRecord(rawEmpty);if(e.sceneId===sceneId)result[String(e.field)]=[]}
  for(const [role,field] of [['overlay','layers'],['audio','audioTracks']] as const){const ts=forScene(sceneId,role);if(ts.length)result[field]=ts.map(t=>{if(t.clips.length!==1)throw new TypeError('VIDEO_LAYER: 当前每条独立对象轨道恰有一个片段。');const p=t.clips[0];closed(p.properties,[...(role==='overlay'?Object.keys(visualLayerProperties):Object.keys(audioLayerProperties)),'sourceIdentity']);const {sourceIdentity,...properties}=p.properties;studioId(sourceIdentity);if(p.id!==clipIdentity(sceneId,p.kind,String(sourceIdentity)))throw new TypeError('VIDEO_CLIP_ID: Layer identity mismatch.');return {...properties,id:sourceIdentity,startSeconds:parseTime(p.timing.start),durationSeconds:parseTime(p.timing.duration)}})}
  return result
 }
 const emptyContainers=records.emptyContainers??[];if(!Array.isArray(emptyContainers)||emptyContainers.length>50)throw new TypeError('VIDEO_CONTAINERS: Invalid empty containers.');const emptyIds=new Set<string>();for(const rawEmpty of emptyContainers as unknown[]){const e=mediaRecord(rawEmpty);closed(e,['sceneId','field']);if(e.sceneId!==undefined)studioId(e.sceneId);if(!['layers','audioTracks'].includes(String(e.field))||e.sceneId!==undefined&&!story.scenes.some(s=>mediaRecord(s).id===e.sceneId))throw new TypeError('VIDEO_CONTAINERS: Unknown container.');const key=String(e.sceneId)+':'+e.field;if(emptyIds.has(key)||tracks.some(t=>t.sceneId===e.sceneId&&t.role===(e.field==='layers'?'overlay':'audio')))throw new TypeError('VIDEO_CONTAINERS: Duplicate nonempty container.');emptyIds.add(key)}
 const scenes=tl.regions.map((rawRegion,index)=>{const regionSceneId=mediaRecord(rawRegion).sceneId;const rawScene=(story.scenes as unknown[]).find(s=>mediaRecord(s).id===regionSceneId);if(!rawScene)throw new TypeError('VIDEO_REGION_SCENE: Unknown scene.')
  const s=mediaRecord(rawScene);if(['id','title','script','visualBrief','sources','endPolicy'].some(k=>s[k]===undefined))throw new TypeError('VIDEO_SCHEMA_REQUIRED: Missing scene field.');closed(s,[...sceneFields,'script','visualDefaults']);const id=studioId(s.id);if(s.visualDefaults!==undefined)closed(mediaRecord(s.visualDefaults),visualFields)
  const r=mediaRecord(tl.regions[index]);closed(r,['id','sceneId','start','duration']);if(r.sceneId!==id||r.id!=='region-'+id||Math.abs(parseTime(r.start)-offset)>1e-9)throw new TypeError('VIDEO_CAPABILITY: 当前引擎要求连续、顺序、无重叠的分镜区间。')
  const durationSeconds=parseTime(r.duration);offset+=durationSeconds
  const evidence=(records.sceneEvidence as unknown[]).find(e=>mediaRecord(e).sceneId===id);if(!evidence||usedEvidence.has(evidence))throw new TypeError('VIDEO_EVIDENCE: Scene record mismatch.');usedEvidence.add(evidence)
  const ev=mediaRecord(evidence);closed(ev,['sceneId','voiceEncoding',...evidenceFields]);if(!['auto','window','segments'].includes(String(ev.voiceEncoding)))throw new TypeError('VIDEO_VOICE_ENCODING: Invalid mode.')
  const scene:Record<string,unknown>={...pick(s,sceneFields),...pick(ev,evidenceFields),...(s.visualDefaults===undefined?{}:mediaRecord(s.visualDefaults)),durationSeconds,narration:s.script,...layers(id)}
  const primaries=forScene(id,'primary');if(primaries.length!==1||!primaries[0].clips.length||primaries[0].clips.length>8)throw new TypeError('VIDEO_PRIMARY: One bounded primary sequence is required.')
  let visualOffset=0
  const visuals=primaries[0].clips.map(p=>{closed(p.properties,[...visualFields,'sourceIdentity']);if(p.properties.sourceIdentity!==undefined&&clipIdentity(id,p.kind,String(p.properties.sourceIdentity))!==p.id)throw new TypeError('VIDEO_CLIP_ID: Source identity must equal clip identity.');if(Math.abs(parseTime(p.timing.start)-visualOffset)>1e-9)throw new TypeError('VIDEO_PRIMARY_GAP: Primary clips must be continuous.');const duration=parseTime(p.timing.duration);visualOffset+=duration;return {...pick(p.properties,visualFields),...(p.properties.sourceIdentity?{id:p.properties.sourceIdentity}:{}),durationSeconds:duration}})
  if(Math.abs(visualOffset-durationSeconds)>1e-9)throw new TypeError('VIDEO_PRIMARY_RANGE: Clip/scene duration mismatch.')
  const encoding=primaries[0].clips[0].encoding;if(primaries[0].clips.some(p=>p.encoding!==encoding))throw new TypeError('VIDEO_ENCODING: Mixed primary modes.')
  if(encoding==='single'){if(s.visualDefaults!==undefined)throw new TypeError('VIDEO_VISUAL_DEFAULTS: Single visual has no inactive defaults.');if(visuals.length!==1)throw new TypeError('VIDEO_ENCODING: Single visual mode.');Object.assign(scene,pick(visuals[0],visualFields))}else if(encoding==='segments')scene.visualSegments=visuals;else throw new TypeError('VIDEO_ENCODING: Invalid primary mode.')
  const voices=forScene(id,'narration');if(voices.length!==1||voices[0].clips.length>8)throw new TypeError('VIDEO_NARRATION: One bounded narration sequence is required.')
  const vs=voices[0].clips.map(p=>{closed(p.properties,['id','sourceStartSeconds','playbackRate']);if(p.properties.id!==undefined&&clipIdentity(id,p.kind,String(p.properties.id))!==p.id)throw new TypeError('VIDEO_CLIP_ID: Voice identity must match.');if(p.encoding!==ev.voiceEncoding)throw new TypeError('VIDEO_VOICE_ENCODING: Voice modes must match.');return {...p.properties,startSeconds:parseTime(p.timing.start),durationSeconds:parseTime(p.timing.duration)}})
  if(ev.voiceEncoding==='segments')scene.voiceSegments=vs;else if(ev.voiceEncoding==='window'){if(vs.length!==1)throw new TypeError('VIDEO_NARRATION: Missing explicit voice interval.');scene.voiceTiming=vs[0]}else if(vs.length)throw new TypeError('VIDEO_NARRATION: Automatic voice does not persist another time interval.')
  const captions=forScene(id,'caption');if(captions.length>1)throw new TypeError('VIDEO_CAPTION: Duplicate caption track.')
  if(captions.length)scene.captions=captions[0].clips.map(p=>{closed(p.properties,['text','translationText','translationOrigin']);const startSeconds=parseTime(p.timing.start),endSeconds=parseTime(p.timing.end);return {...pick(p.properties,['text','translationText','translationOrigin']),startSeconds,endSeconds}})
  return scene
 })
 if(Math.abs(parseTime(tl.duration)-offset)>1e-9)throw new TypeError('VIDEO_TIMELINE_RANGE: 未映射的轨道或时间范围。')
 const global=layers()
 // Global tracks are consumed by layers() above; check after consuming them.
 if(usedTracks.size!==tracks.length)throw new TypeError('VIDEO_UNASSIGNED_TRACK: Unknown ownership.')
 return assertVideoDraft({version:1,id:studioId(d.id),revision:d.revision,...(owner.sessionId?{ownerSessionId:owner.sessionId}:{}),title:c.title,...pick(settings,settingsFields),fps:fps.numerator,preparation:c.brief,scenes,cover:c.cover,updatedAt:records.updatedAt,exports:records.exports,coverExports:records.coverExports,referenceRecords:records.referenceRecords,reviewItems:records.reviewItems,...global})
}
// Runtime fields are shared with the existing closed codecs; no generic payload escapes.
import {visualLayersSchema,audioLayersSchema} from '../../media-native/src/composition-layers.js'
const visualLayerProperties={...visualLayersSchema.items.properties};delete visualLayerProperties.id;delete visualLayerProperties.startSeconds;delete visualLayerProperties.durationSeconds
const audioLayerProperties={...audioLayersSchema.items.properties};delete audioLayerProperties.id;delete audioLayerProperties.startSeconds;delete audioLayerProperties.durationSeconds
export function assertVideoDocument(raw:unknown):VideoDocument {const draft=videoDraftFromDocument(raw),canonical=videoDocumentFromDraft(draft);if(JSON.stringify(raw).length>1024*1024)throw new Error('VIDEO_DOCUMENT_BUDGET: 视频文档超过 1 MiB。');return canonical}
export const videoDocumentFields={sceneFields,evidenceFields,visualFields,settingsFields}
type Schema=Record<string,unknown>
const objectSchema=(properties:Record<string,Schema>,required:string[]=Object.keys(properties)):Schema=>({type:'object',additionalProperties:false,properties,required})
const arraySchema=(items:Schema,maxItems:number,minItems=0):Schema=>({type:'array',items,minItems,maxItems})
const idSchema:Schema={type:'string',pattern:'^[a-zA-Z0-9_-]{1,256}$'}
const sceneSchema=studioDraftSchema.properties.scenes.items.properties as Record<string,Schema>
const fieldsSchema=(keys:readonly string[],source:Record<string,Schema>):Record<string,Schema>=>Object.fromEntries(keys.map(k=>{if(!source[k])throw new Error('Video schema field has no codec: '+k);return [k,source[k]]}))
const segmentProperties=visualSegmentsSchema.items.properties as Record<string,Schema>
const primaryProperties=fieldsSchema(visualFields,{...sceneSchema,...segmentProperties})
const timingSchema=objectSchema({clock:{enum:['scene','timeline']},start:videoTimeSchema,duration:videoTimeSchema},['clock','start','duration'])
const captionTimingSchema=objectSchema({clock:{const:'scene'},start:videoTimeSchema,end:videoTimeSchema})
const voiceProperties=objectSchema({id:idSchema,sourceStartSeconds:{type:'number',minimum:0,maximum:180},playbackRate:{type:'number',minimum:.25,maximum:2}},['sourceStartSeconds','playbackRate'])
const clipSchema=(kind:string,properties:Schema,encoding?:string[]):Schema=>objectSchema({id:idSchema,kind:{const:kind},sceneId:studioDraftSchema.properties.id,timing:kind==='caption'?captionTimingSchema:timingSchema,properties,...(encoding?{encoding:{enum:encoding}}:{})},['id','kind','timing','properties',...(encoding?['encoding']:[])])
export const videoClipSchema:Schema={oneOf:[clipSchema('visual',objectSchema({...primaryProperties,sourceIdentity:idSchema},[]),['single','segments']),clipSchema('voice',voiceProperties,['window','segments']),clipSchema('caption',objectSchema({text:{type:'string',maxLength:200},translationText:{type:'string',maxLength:200},translationOrigin:{enum:['user-edited','agent-edited']}},['text'])),clipSchema('visual-layer',objectSchema({...visualLayerProperties as Record<string,Schema>,sourceIdentity:studioDraftSchema.properties.id},['sourceIdentity','title','kind','x','y','width','height','color'])),clipSchema('audio-layer',objectSchema({...audioLayerProperties as Record<string,Schema>,sourceIdentity:studioDraftSchema.properties.id},['sourceIdentity','title','artifactId']))]}
export const videoDocumentTimelineSchema=objectSchema({duration:videoTimeSchema,regions:arraySchema(objectSchema({id:idSchema,sceneId:studioDraftSchema.properties.id,start:videoTimeSchema,duration:videoTimeSchema}),24),tracks:arraySchema(objectSchema({id:idSchema,kind:{enum:['visual','audio','caption']},role:{enum:['primary','narration','caption','overlay','audio']},sceneId:studioDraftSchema.properties.id,clips:arraySchema(videoClipSchema,100)},['id','kind','role','clips']),150)})
export const videoDocumentSchema:Schema={
 $schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://bmw.local/schemas/video-document/2.0',title:'BMW Video Document 2.0 — supported runtime subset',
 ...objectSchema({format:{const:'bmw.video'},schemaVersion:{const:'2.0'},id:studioDraftSchema.properties.id,revision:studioDraftSchema.properties.revision,owner:objectSchema({sessionId:studioDraftSchema.properties.id},[]),content:objectSchema({title:studioDraftSchema.properties.title,settings:objectSchema({...fieldsSchema(settingsFields,studioDraftSchema.properties),timebase:{const:1000000},frameRate:objectSchema({numerator:{type:'integer',minimum:12,maximum:30},denominator:{const:1}})},['width','height','music','timebase','frameRate']),brief:studioDraftSchema.properties.preparation,story:objectSchema({scenes:arraySchema(objectSchema({...fieldsSchema(sceneFields.filter(k=>k!=='bulletRevealSeconds'),sceneSchema),bulletRevealSeconds:{type:'array',maxItems:3,items:{type:'number',minimum:0,maximum:60}},script:{type:'string',maxLength:1000},visualDefaults:objectSchema(primaryProperties,[])},['id','title','script','visualBrief','sources','endPolicy']),24)}),timeline:videoDocumentTimelineSchema,cover:studioDraftSchema.properties.cover},['title','settings','brief','story','timeline']),records:{readOnly:true,...objectSchema({updatedAt:{type:'string',maxLength:40},exports:studioDraftSchema.properties.exports,coverExports:studioDraftSchema.properties.coverExports,referenceRecords:studioDraftSchema.properties.referenceRecords,reviewItems:studioDraftSchema.properties.reviewItems,emptyContainers:arraySchema(objectSchema({sceneId:studioDraftSchema.properties.id,field:{enum:['layers','audioTracks']}},['field']),50,1),sceneEvidence:arraySchema(objectSchema({sceneId:studioDraftSchema.properties.id,voiceEncoding:{enum:['auto','window','segments']},...fieldsSchema(evidenceFields,sceneSchema)},['sceneId','voiceEncoding']),24)},['updatedAt','exports','sceneEvidence'])}})
}
