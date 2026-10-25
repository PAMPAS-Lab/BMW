import {assertPreparationShots,preparationShotsSchema} from './shot-preparation-contract.js'
import type {PreparationShot} from './shot-preparation-contract.js'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
export interface NewsScenePreparation {
 sceneId:string;fingerprint:string;intent:string;dateLabel:string
 materials:{artifactId:string;referenceId:string;kind:'real-footage'|'still'|'diagram';observation:string;relation:string}[]
 originalSpeech:{mode:'source'|'not-used';quote:string;translation:string;reason:string}
}
export type NewsPreparationRequest=
 |{operation:'read'|'preflight'}
 |{operation:'prepare-shots';shots:PreparationShot[];resumeId?:string}
 |{operation:'prepare-scene-references';sceneIds:string[]}
 |{operation:'enable';expectedChecklistRevision:number;originalSpeechRequired:boolean}
 |{operation:'record-scene';expectedChecklistRevision:number;scene:NewsScenePreparation}
 |{operation:'record-scenes';expectedChecklistRevision:number;scenes:NewsScenePreparation[]}
export const preparationId=(v:unknown):string=>{if(typeof v!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(v))throw new TypeError('Invalid preparation identity.');return v}
export const preparationHash=(v:unknown):string=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new TypeError('Invalid preparation fingerprint.');return v}
const text=(v:unknown,max:number,empty=false):string=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008]/u.test(v)||!empty&&!v.trim())throw new TypeError('Invalid preparation text.');return v}
const closed=(v:Record<string,unknown>,keys:string[])=>{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('Unsupported preparation field.')}
export function assertNewsScenePreparation(raw:unknown):NewsScenePreparation {
 const s=mediaRecord(raw);closed(s,['sceneId','fingerprint','intent','dateLabel','materials','originalSpeech'])
 if(!Array.isArray(s.materials)||!s.materials.length||s.materials.length>8)throw new TypeError('Preparation requires one to eight actual scene materials.')
 const materials=s.materials.map(raw=>{const m=mediaRecord(raw);closed(m,['artifactId','referenceId','kind','observation','relation']);if(!['real-footage','still','diagram'].includes(String(m.kind)))throw new TypeError('Unknown preparation material kind.');return {artifactId:assertArtifactId(m.artifactId),referenceId:preparationId(m.referenceId),kind:m.kind as NewsScenePreparation['materials'][number]['kind'],observation:text(m.observation,600),relation:text(m.relation,600)}})
 if(new Set(materials.map(m=>m.artifactId)).size!==materials.length)throw new TypeError('Duplicate prepared material.')
 const o=mediaRecord(s.originalSpeech);closed(o,['mode','quote','translation','reason']);if(!['source','not-used'].includes(String(o.mode)))throw new TypeError('Original speech mode must be source or not-used.')
 return {sceneId:preparationId(s.sceneId),fingerprint:preparationHash(s.fingerprint),intent:text(s.intent,600),dateLabel:text(s.dateLabel,160),materials,originalSpeech:{mode:o.mode as 'source'|'not-used',quote:text(o.quote,1000,o.mode!=='source'),translation:text(o.translation,1000,o.mode!=='source'),reason:text(o.reason,600,o.mode==='source')}}
}
export function assertNewsPreparationRequest(raw:unknown):NewsPreparationRequest {
 const r=mediaRecord(raw)
 if(r.operation==='read'||r.operation==='preflight'){closed(r,['operation']);return {operation:r.operation}}
 if(r.operation==='prepare-scene-references'){closed(r,['operation','sceneIds']);if(!Array.isArray(r.sceneIds)||!r.sceneIds.length||r.sceneIds.length>8)throw new TypeError('Select one to eight existing scenes.');const sceneIds=r.sceneIds.map(preparationId);if(new Set(sceneIds).size!==sceneIds.length)throw new TypeError('Duplicate selected scene.');return {operation:r.operation,sceneIds}}
 if(r.operation==='prepare-shots'){closed(r,['operation','shots','resumeId']);return {operation:r.operation,shots:assertPreparationShots(r.shots),...(r.resumeId===undefined?{}:{resumeId:preparationId(r.resumeId)})}}
 const expectedChecklistRevision=finiteNumber(r.expectedChecklistRevision,'checklist revision',0,1000000,true)
 if(r.operation==='enable'){closed(r,['operation','expectedChecklistRevision','originalSpeechRequired']);if(typeof r.originalSpeechRequired!=='boolean')throw new TypeError('Expected explicit original-speech policy.');return {operation:r.operation,expectedChecklistRevision,originalSpeechRequired:r.originalSpeechRequired}}
 if(r.operation==='record-scenes'){closed(r,['operation','expectedChecklistRevision','scenes']);if(!Array.isArray(r.scenes)||!r.scenes.length||r.scenes.length>8)throw new TypeError('Record one to eight observed scene declarations.');const scenes=r.scenes.map(assertNewsScenePreparation);if(new Set(scenes.map(s=>s.sceneId)).size!==scenes.length)throw new TypeError('Duplicate prepared scene.');return {operation:r.operation,expectedChecklistRevision,scenes}}
 if(r.operation==='record-scene'){closed(r,['operation','expectedChecklistRevision','scene']);return {operation:r.operation,expectedChecklistRevision,scene:assertNewsScenePreparation(r.scene)}}
 throw new TypeError('Unknown preparation operation.')
}
const str=(maxLength:number)=>({type:'string',minLength:1,maxLength}),obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),id={...str(80),pattern:'^[A-Za-z0-9-]{1,80}$'},revision={type:'integer',minimum:0,maximum:1000000}
export const newsScenePreparationSchema=obj({sceneId:id,fingerprint:{...str(64),pattern:'^[a-f0-9]{64}$'},intent:str(600),dateLabel:str(160),materials:{type:'array',minItems:1,maxItems:8,items:obj({artifactId:str(256),referenceId:id,kind:{enum:['real-footage','still','diagram']},observation:str(600),relation:str(600)})},originalSpeech:obj({mode:{enum:['source','not-used']},quote:{type:'string',maxLength:1000},translation:{type:'string',maxLength:1000},reason:{type:'string',maxLength:600}})})
export const newsPreparationRequestSchema={oneOf:[obj({operation:{const:'prepare-scene-references'},sceneIds:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:id}}),{type:'object',additionalProperties:false,required:['operation','shots'],properties:{operation:{const:'prepare-shots'},shots:preparationShotsSchema,resumeId:str(180)}},...['read','preflight'].map(operation=>obj({operation:{const:operation}})),obj({operation:{const:'enable'},expectedChecklistRevision:revision,originalSpeechRequired:{type:'boolean'}}),obj({operation:{const:'record-scene'},expectedChecklistRevision:revision,scene:newsScenePreparationSchema}),obj({operation:{const:'record-scenes'},expectedChecklistRevision:revision,scenes:{type:'array',minItems:1,maxItems:8,items:newsScenePreparationSchema}})]}
