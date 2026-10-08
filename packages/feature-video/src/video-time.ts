import {mediaRecord,finiteNumber} from '../../media-native/src/media-contract.js'
/** One time authority, with a bounded migration residual preserving existing JS clocks exactly. */
export interface VideoTime {ticks:number;residualSeconds?:number}
export const VIDEO_TIMEBASE=1_000_000
// One picosecond covers floating subtraction at half-microsecond grid boundaries.
export const MAX_VIDEO_TIME_RESIDUAL=.000000500001
export function videoTime(seconds:number):VideoTime {
 if(!Number.isFinite(seconds)||seconds<0||seconds>1800)throw new TypeError('VIDEO_TIME_RANGE: 时间超出有限范围。')
 const ticks=Math.round(seconds*VIDEO_TIMEBASE),residualSeconds=seconds-ticks/VIDEO_TIMEBASE
 return {ticks,...(residualSeconds===0?{}:{residualSeconds})}
}
export function videoSeconds(value:VideoTime):number {
 const v=mediaRecord(value);if(Object.keys(v).some(k=>!['ticks','residualSeconds'].includes(k)))throw new TypeError('VIDEO_TIME_FIELD: Unsupported time property.')
 const ticks=finiteNumber(v.ticks,'video ticks',0,1800*VIDEO_TIMEBASE,true),residual=finiteNumber(v.residualSeconds??0,'migration residual',-MAX_VIDEO_TIME_RESIDUAL,MAX_VIDEO_TIME_RESIDUAL)
 const result=ticks/VIDEO_TIMEBASE+residual;if(result<0||result>1800)throw new TypeError('VIDEO_TIME_RANGE: Invalid time.');return result
}

const timeObject=(properties:Record<string,unknown>,required:string[])=>({type:'object',additionalProperties:false,properties,required})
export const videoTimeSchema=timeObject({ticks:{type:'integer',minimum:0,maximum:1800000000},residualSeconds:{type:'number',minimum:-MAX_VIDEO_TIME_RESIDUAL,maximum:MAX_VIDEO_TIME_RESIDUAL}},['ticks'])
