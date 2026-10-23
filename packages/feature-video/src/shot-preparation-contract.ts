import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {assertSourceCitation,sourceCitationSchema} from '../../media-native/src/source-contract.js'
import type {SourceCitation} from '../../media-native/src/source-contract.js'
export interface PreparationShot {sceneId:string;title:string;narration:string;label:string;artifactId:string;sha256:string;startSeconds:number;endSeconds:number;keepSourceAudio:boolean;citations:SourceCitation[]}
const text=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008]/.test(v))throw new TypeError('Invalid shot text.');return v}
export function assertPreparationShots(raw:unknown):PreparationShot[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>8)throw new TypeError('Prepare one to eight explicit shots.')
 const shots=raw.map(raw=>{const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['sceneId','title','narration','label','artifactId','sha256','startSeconds','endSeconds','keepSourceAudio','citations'].includes(k))||typeof v.sceneId!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(v.sceneId)||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256)||typeof v.keepSourceAudio!=='boolean'||!Array.isArray(v.citations)||!v.citations.length||v.citations.length>12)throw new TypeError('Invalid explicit shot/source identity.')
 const startSeconds=finiteNumber(v.startSeconds,'shot source start',0,21600),endSeconds=finiteNumber(v.endSeconds,'shot source end',startSeconds+1,Math.min(21600,startSeconds+60))
 return {sceneId:v.sceneId,title:text(v.title,44),narration:text(v.narration,1000),label:text(v.label,44),artifactId:assertArtifactId(v.artifactId),sha256:v.sha256,startSeconds,endSeconds,keepSourceAudio:v.keepSourceAudio,citations:v.citations.map(assertSourceCitation)}
 })
 if(new Set(shots.map(s=>s.sceneId)).size!==shots.length||shots.reduce((n,s)=>n+s.endSeconds-s.startSeconds,0)>120)throw new TypeError('Duplicate shot identity or batch exceeds120 seconds.')
 return shots
}
const textSchema=(maxLength:number)=>({type:'string',maxLength}),time={type:'number',minimum:0,maximum:21600}
export const preparationShotsSchema={type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['sceneId','title','narration','label','artifactId','sha256','startSeconds','endSeconds','keepSourceAudio','citations'],properties:{sceneId:{type:'string',pattern:'^[A-Za-z0-9-]{1,80}$'},title:textSchema(44),narration:textSchema(1000),label:textSchema(44),artifactId:textSchema(180),sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},startSeconds:time,endSeconds:time,keepSourceAudio:{type:'boolean'},citations:{type:'array',minItems:1,maxItems:12,items:sourceCitationSchema}}}}
