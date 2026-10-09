import {assertVideoDraft} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'
export const SIMPLE_VIDEO_PROFILE='simple.cards/3'
export interface StudioCompatibility {profile:typeof SIMPLE_VIDEO_PROFILE;draftId:string;revision:number;simpleEditable:boolean;advancedEditable:true;blockingReasons:{code:string;objectId:string;path:string;message:string}[]}
/** Derived from content, never a persisted lock or a client-supplied certificate. */
export function studioCompatibility(raw:VideoDraft):StudioCompatibility {
 const draft=assertVideoDraft(raw),blockingReasons:StudioCompatibility['blockingReasons']=[]
 const inspect=(container:{layers?:VideoDraft['layers'];audioTracks?:VideoDraft['audioTracks']},path:string)=>{
  for(const layer of container.layers??[])blockingReasons.push({code:layer.keyframes?.length?'free-keyframes':'independent-overlay',objectId:layer.id,path:path+'.layers.'+layer.id,message:layer.keyframes?.length?'自由关键帧需要高级编辑。':'独立叠加对象需要高级编辑。'})
  for(const audio of container.audioTracks??[])blockingReasons.push({code:'independent-audio',objectId:audio.id,path:path+'.audioTracks.'+audio.id,message:'独立音轨需要高级编辑。'})
 }
 inspect(draft,'draft');for(const scene of draft.scenes)inspect(scene,'scene.'+scene.id)
 return {profile:SIMPLE_VIDEO_PROFILE,draftId:draft.id,revision:draft.revision,simpleEditable:blockingReasons.length===0,advancedEditable:true,blockingReasons}
}
export function requireSimpleVideo(draft:VideoDraft):void {
 const result=studioCompatibility(draft);if(!result.simpleEditable)throw new Error('STUDIO_ADVANCED_REQUIRED: '+result.blockingReasons[0].message+' 请保留高级编辑，或撤销／移除这些对象后再返回简洁模式。')
}
export function requireSimpleVideoEdit(current:VideoDraft,next:VideoDraft):void{requireSimpleVideo(current);requireSimpleVideo(next)}
