import {finiteNumber,mediaRecord} from './media-contract.js'
export interface SpeechSourceRange {startSeconds:number;endSeconds:number}
export function assertSpeechSourceRange(raw:unknown):SpeechSourceRange {
 const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['startSeconds','endSeconds'].includes(k)))throw new TypeError('Unsupported speech source range.')
 const startSeconds=finiteNumber(v.startSeconds,'speech source start',0,1800),endSeconds=finiteNumber(v.endSeconds,'speech source end',startSeconds+.01,1800)
 if(endSeconds-startSeconds>180)throw new TypeError('Speech source intervals are limited to 180 seconds.')
 return {startSeconds,endSeconds}
}
export function assertSpeechRangeEvidence(info:Record<string,unknown>,expected?:SpeechSourceRange):void {
 if(info.sourceRange===undefined){if(expected||info.sourceDurationSeconds!==undefined)throw new TypeError('Missing interval speech provenance.');return}
 const range=assertSpeechSourceRange(info.sourceRange),sourceDuration=finiteNumber(info.sourceDurationSeconds,'original speech source duration',.01,1800)
 if(range.endSeconds>sourceDuration+1/16000||Math.abs(range.endSeconds-range.startSeconds-Number(info.durationSeconds))>1/16000+1e-9||expected&&(range.startSeconds!==expected.startSeconds||range.endSeconds!==expected.endSeconds))throw new TypeError('Speech interval does not match actual normalized audio or requested source range.')
}
export const speechSourceRangeSchema={type:'object',additionalProperties:false,required:['startSeconds','endSeconds'],properties:{startSeconds:{type:'number',minimum:0,maximum:1800},endSeconds:{type:'number',minimum:.01,maximum:1800}}}
