import {sourceState,sourceBindings} from '@bmw-agent/media-native/sources'
import crypto from 'node:crypto'
import path from 'node:path'
import {assertComposition,compositionDuration,narrationWindows} from '@bmw-agent/media-native/composition'
import type {MediaComposition} from '@bmw-agent/media-native/composition'
import {sceneVisuals} from '@bmw-agent/media-native/visuals'
import {visualLayerBox} from '@bmw-agent/media-native/layers'
import type {LayerContainer} from '@bmw-agent/media-native/layers'
import {cardImageAssets} from '@bmw-agent/media-native/card-details'
import {ArtifactJobIO} from '@bmw-agent/media-native/artifact-io'
import {assertMediaInspection} from '@bmw-agent/media-native/port'
import type {MediaInspectionReply} from '@bmw-agent/media-native/port'
import type {BrowserFeatureHost} from '@bmw-agent/browser-capability/host'
import {LibraryStorage} from './library-storage.js'
import {committedMaterialOrigins} from './library-transfer.js'
import {assertWorkExport} from './export-contract.js'
import type {ExportUse,WorkExport,ExportSource} from './export-contract.js'
import {workExportId,WorkExportStore} from './export-store.js'

interface UsePlan {artifactId:string;role:ExportUse['role'];sceneIndex:number|null;clipId:string|null;start:number;end:number;sourceStart:number|null;rate:number;track?:'video'|'audio';hold?:boolean;optionalAudio?:boolean}
interface Asset {sha256:string;bytes:number;info?:MediaInspectionReply;sources:ExportSource[];origins:ExportUse['origins']}
export interface ExportOwner {draftId?:string;sessionId:string;revision?:number;sceneIds?:string[]}
export interface CapturedExport {record(output:{artifactId:string;durationSeconds:number},owner?:ExportOwner):Promise<WorkExport>}
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):v
export async function captureWorkExport(kernel:BrowserFeatureHost,raw:MediaComposition,signal:AbortSignal|undefined,rendererVersion:string):Promise<CapturedExport>{
 const composition=assertComposition(raw),project={...kernel.projectStore.active()},storage=new LibraryStorage(project.directory),directory=path.dirname(storage.file('artifacts/.boundary')),plans:UsePlan[]=[],assets=new Map<string,Asset>(),sourcePort=kernel.projectSources?.(),catalog=sourcePort?sourceState(sourcePort):undefined,total=compositionDuration(composition)
 const guard=()=>{signal?.throwIfAborted();storage.guard();if(kernel.projectStore.active().id!==project.id||kernel.projectStore.active().directory!==project.directory)throw new Error('Export capture Project changed.')}
 const hash=async(artifactId:string)=>{guard();const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId});try{return {sha256:await io.fingerprint(signal),bytes:io.bytes}}finally{await io.close()}}
 const container=(value:LayerContainer,offset:number,span:number,sceneIndex:number|null)=>{
  for(const layer of value.layers??[]){if(layer.hidden||!layer.artifactId)continue
   const cuts=[...new Set([0,layer.durationSeconds,...(layer.keyframes??[]).map(k=>k.timeSeconds)])].sort((a,b)=>a-b)
   for(let i=0;i<cuts.length-1;i++){const a=cuts[i],b=cuts[i+1];if(visualLayerBox(layer,(a+b)/2).opacity<=0)continue;const start=offset+layer.startSeconds+a,end=Math.min(offset+span,offset+layer.startSeconds+b);if(end<=start)continue
    plans.push({artifactId:layer.artifactId,role:'visual-layer',sceneIndex,clipId:layer.id,start,end,sourceStart:layer.kind==='video'?(layer.sourceStartSeconds??0)+a*(layer.playbackRate??1):null,rate:layer.playbackRate??1,...(layer.kind==='video'?{track:'video' as const}:{})})
   }
  }
  for(const layer of value.audioTracks??[]){if(layer.muted||layer.volume<=0)continue;const start=offset+layer.startSeconds,end=Math.min(offset+span,start+layer.durationSeconds);if(end>start)plans.push({artifactId:layer.artifactId,role:'audio-layer',sceneIndex,clipId:layer.id,start,end,sourceStart:layer.sourceStartSeconds,rate:layer.playbackRate,track:'audio'})}
 }
 let offset=0
 for(const [sceneIndex,scene]of composition.scenes.entries()){
  let visualStart=offset
  for(const segment of sceneVisuals(scene)){
   if(segment.videoArtifactId){plans.push({artifactId:segment.videoArtifactId,role:'main-video',sceneIndex,clipId:'id' in segment?segment.id??null:null,start:visualStart,end:visualStart+segment.durationSeconds,sourceStart:segment.sourceStartSeconds,rate:segment.playbackRate,track:'video',hold:true});if(segment.keepSourceAudio&&(segment.sourceVolume??1)>0)plans.push({artifactId:segment.videoArtifactId,role:'source-audio',sceneIndex,clipId:'id' in segment?segment.id??null:null,start:visualStart,end:visualStart+segment.durationSeconds,sourceStart:segment.sourceStartSeconds,rate:segment.playbackRate,track:'audio',optionalAudio:true})}
   else if(segment.imageArtifactId)plans.push({artifactId:segment.imageArtifactId,role:'main-image',sceneIndex,clipId:'id' in segment?segment.id??null:null,start:visualStart,end:visualStart+segment.durationSeconds,sourceStart:null,rate:1})
   visualStart+=segment.durationSeconds
  }
  for(const id of cardImageAssets(scene.cardSpec?.version===2?scene.cardSpec:undefined))plans.push({artifactId:id,role:'card-image',sceneIndex,clipId:null,start:offset,end:offset+scene.durationSeconds,sourceStart:null,rate:1})
  container(scene,offset,scene.durationSeconds,sceneIndex);offset+=scene.durationSeconds
 }
 container(composition,0,total,null)
 // Native narration measurement determines the default .5-second playback window.
 for(const scene of composition.scenes)if(scene.audioArtifactId&&!scene.voiceMuted&&(scene.voiceVolume??1)>0&&scene.voiceSegments?.length!==0&&!assets.has(scene.audioArtifactId)){const file=await hash(scene.audioArtifactId),info=assertMediaInspection(await kernel.recordingController.processArtifact({action:'media.inspect',artifactId:scene.audioArtifactId},signal));assets.set(scene.audioArtifactId,{...file,info,sources:[],origins:[]})}
 offset=0
 for(const [sceneIndex,scene]of composition.scenes.entries()){if(scene.audioArtifactId&&!scene.voiceMuted&&(scene.voiceVolume??1)>0&&scene.voiceSegments?.length!==0){const info=assets.get(scene.audioArtifactId)!.info!;for(const [i,w]of narrationWindows(scene,info.durationSeconds).entries())plans.push({artifactId:scene.audioArtifactId,role:'narration',sceneIndex,clipId:scene.voiceSegments?.[i]?.id??null,start:offset+w.startSeconds,end:offset+w.startSeconds+w.durationSeconds,sourceStart:w.sourceStartSeconds,rate:w.playbackRate,track:'audio'})}offset+=scene.durationSeconds}
 for(const plan of plans){guard();let asset=assets.get(plan.artifactId);if(!asset){asset={...await hash(plan.artifactId),sources:[],origins:[]};assets.set(plan.artifactId,asset)}if(plan.track&&!asset.info)asset.info=assertMediaInspection(await kernel.recordingController.processArtifact({action:'media.inspect',artifactId:plan.artifactId},signal))}
 for(const [id,asset]of assets){asset.origins=committedMaterialOrigins(storage,id,asset.sha256);for(const {source,acquisition}of sourcePort?sourceBindings(sourcePort,id):[]){const media=acquisition.media.find(m=>m.artifactId===id&&m.contentId===asset.sha256);if(media)asset.sources.push({sourceId:source.id,acquisitionId:acquisition.id,bodySha256:acquisition.contentId,url:source.url,captureRange:media.capture?{startSeconds:media.capture.sourceStartSeconds,endSeconds:media.capture.sourceEndSeconds}:media.deliveryRange?{startSeconds:media.deliveryRange.startSeconds,endSeconds:media.deliveryRange.endSeconds}:null})}}
 guard()
 return {async record(output,owner){
  guard();for(const [id,asset]of assets)if((await hash(id)).sha256!==asset.sha256)throw new Error('EXPORT_INPUT_CHANGED: A rendered material changed during export; adoption is unverified.')
  if(catalog&&(kernel.projectSources?sourceState(kernel.projectSources()).revision:undefined)!==catalog.revision)throw new Error('Export source catalog changed; adoption is unverified.')
  const uses:ExportUse[]=plans.flatMap(plan=>{const asset=assets.get(plan.artifactId)!;let start=plan.start,end=plan.end,sourceStart=plan.sourceStart,sourceEnd:number|null=null,hold:number|null=null
   if(plan.track){const track=asset.info!.tracks.find(t=>t.type===plan.track&&t.canDecode);if(!track){if(plan.optionalAudio)return [];throw new Error('Adopted material track is not decodable.')}
    const first=track.startSeconds??0,last=track.endSeconds??asset.info!.durationSeconds;if(plan.optionalAudio){if(sourceStart!>=last||sourceStart!+(end-start)*plan.rate<=first)return [];if(sourceStart!<first){start+=(first-sourceStart!)/plan.rate;sourceStart=first}}else if(sourceStart!<first-.001||sourceStart!>=last)throw new Error('Adopted source range unavailable.')
    sourceEnd=Math.min(last,sourceStart!+(end-start)*plan.rate);const decodedEnd=start+(sourceEnd-sourceStart!)/plan.rate
    if(decodedEnd<end-.000001){if(plan.hold)hold=decodedEnd;else if(plan.optionalAudio)end=decodedEnd;else throw new Error('Adopted source interval exceeds media endpoint.')}
   }
   return [{artifactId:plan.artifactId,sha256:asset.sha256,bytes:asset.bytes,role:plan.role,sceneIndex:plan.sceneIndex,clipId:plan.clipId??(plan.sceneIndex===null?null:owner?.sceneIds?.[plan.sceneIndex]??null),outputRange:{startSeconds:start,endSeconds:end},sourceRange:sourceEnd===null?null:{startSeconds:sourceStart!,endSeconds:sourceEnd},playbackRate:plan.rate,holdFromOutputSeconds:hold,sources:asset.sources,origins:asset.origins}]
  })
  const out=await hash(output.artifactId),workId=owner?.draftId??'direct-'+crypto.randomUUID();guard()
  return assertWorkExport({version:1,id:workExportId(project.id,workId,output.artifactId),projectId:project.id,workId,draftId:owner?.draftId??null,sessionId:owner?.sessionId??null,draftRevision:owner?.revision??null,title:composition.title,createdAt:new Date().toISOString(),rendererVersion,compositionSha256:crypto.createHash('sha256').update(JSON.stringify(canonical(composition))).digest('hex'),artifactId:output.artifactId,outputSha256:out.sha256,durationSeconds:output.durationSeconds,uses},project.id)
 }}
}
export {WorkExportStore}
