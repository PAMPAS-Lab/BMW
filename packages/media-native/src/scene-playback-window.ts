import {finiteNumber,mediaRecord} from './media-contract.js'

/** Original presentation clock shared by split scene pieces; object clocks stay local. */
export interface ScenePlaybackWindow {originId:string;startSeconds:number;durationSeconds:number;musicIndex:number;sceneNumber:number;sceneCount:number}
export interface ScenePlaybackClock {durationSeconds:number;presentationWindow?:ScenePlaybackWindow}
const fields=['originId','startSeconds','durationSeconds','musicIndex','sceneNumber','sceneCount']
export const scenePlaybackWindowSchema={type:'object',additionalProperties:false,required:fields,properties:{originId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},startSeconds:{type:'number',minimum:0,maximum:60},durationSeconds:{type:'number',minimum:1,maximum:60},musicIndex:{type:'integer',minimum:1,maximum:24},sceneNumber:{type:'integer',minimum:1,maximum:24},sceneCount:{type:'integer',minimum:1,maximum:24}}}
export function assertScenePlaybackWindow(raw:unknown,sceneDuration:number):ScenePlaybackWindow {
 const v=mediaRecord(raw)
 if(Object.keys(v).some(key=>!fields.includes(key))||typeof v.originId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.originId))throw new TypeError('Invalid original scene clock.')
 const result:ScenePlaybackWindow={originId:v.originId,startSeconds:finiteNumber(v.startSeconds,'scene clock start',0,60),durationSeconds:finiteNumber(v.durationSeconds,'scene clock duration',1,60),musicIndex:finiteNumber(v.musicIndex,'scene music index',1,24,true),sceneNumber:finiteNumber(v.sceneNumber,'scene number',1,24,true),sceneCount:finiteNumber(v.sceneCount,'scene count',1,24,true)}
 if(!Number.isFinite(sceneDuration)||sceneDuration<1||sceneDuration>60||result.startSeconds+sceneDuration>result.durationSeconds+.000001||result.sceneNumber>result.sceneCount)throw new TypeError('Scene piece must fit its original presentation clock.')
 return result
}
/** Closed compositions validate once before playback; do not validate per audio sample. */
export function scenePlaybackClock(scene:ScenePlaybackClock,index:number,total:number):ScenePlaybackWindow {
 return scene.presentationWindow??{originId:'unsegmented',startSeconds:0,durationSeconds:scene.durationSeconds,musicIndex:index+1,sceneNumber:index+1,sceneCount:total}
}
