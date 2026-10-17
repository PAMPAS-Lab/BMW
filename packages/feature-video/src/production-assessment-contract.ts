import {mediaRecord,finiteNumber,assertArtifactId} from '../../media-native/src/media-contract.js'
import {productionType} from './production-contract.js'
import type {ProductionType} from './production-contract.js'
export interface ProductionAssessment {checks:{id:string;status:'passed'|'needs-fix';notes:string}[];listening:'not-performed'|'passed'|'needs-fix';retellingAnswer:string;predictionAnswer:string;notes:string}
export interface ProductionAssessmentRecord extends ProductionAssessment {id:string;createdAt:string;origin:'user'|'agent';profileId:ProductionType;profileVersion:1;fingerprint:string;exportArtifactId:string}
const closed=(v:Record<string,unknown>,keys:readonly string[])=>{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('Unsupported production assessment field.')},text=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max||v.includes('\0'))throw new TypeError('Invalid assessment text.');return v}
export function assertProductionAssessment(raw:unknown):ProductionAssessment {
 const v=mediaRecord(raw);closed(v,['checks','listening','retellingAnswer','predictionAnswer','notes']);if(!Array.isArray(v.checks)||v.checks.length!==5||!['not-performed','passed','needs-fix'].includes(String(v.listening)))throw new TypeError('Record all five type checks and an explicit listening state.')
 const checks=v.checks.map(raw=>{const c=mediaRecord(raw);closed(c,['id','status','notes']);if(typeof c.id!=='string'||!/^check-[1-5]$/.test(c.id)||!['passed','needs-fix'].includes(String(c.status)))throw new TypeError('Invalid type check.');return {id:c.id,status:c.status as 'passed'|'needs-fix',notes:text(c.notes,500)}});if(new Set(checks.map(c=>c.id)).size!==5)throw new TypeError('Duplicate type check.')
 return {checks,listening:v.listening as ProductionAssessment['listening'],retellingAnswer:text(v.retellingAnswer,1000),predictionAnswer:text(v.predictionAnswer,1000),notes:text(v.notes,1000)}
}
export function assertAssessmentRecord(raw:unknown):ProductionAssessmentRecord {
 const v=mediaRecord(raw);closed(v,['checks','listening','retellingAnswer','predictionAnswer','notes','id','createdAt','origin','profileId','profileVersion','fingerprint','exportArtifactId']);if(typeof v.id!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(v.id)||typeof v.createdAt!=='string'||v.createdAt.length>40||!Number.isFinite(Date.parse(v.createdAt))||!['user','agent'].includes(String(v.origin))||v.profileVersion!==1||typeof v.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.fingerprint)||typeof v.exportArtifactId!=='string'||!/^[-\w.]{1,256}$/.test(v.exportArtifactId))throw new TypeError('Invalid production assessment record.')
 const {id,createdAt,origin,profileId,profileVersion,fingerprint,exportArtifactId,...assessment}=v
 return {...assertProductionAssessment(assessment),id:id as string,createdAt:createdAt as string,origin:origin as 'user'|'agent',profileId:productionType(profileId),profileVersion:1,fingerprint:fingerprint as string,exportArtifactId:assertArtifactId(exportArtifactId)}
}
export const assessmentRevision=(v:unknown)=>finiteNumber(v,'assessment revision',0,1000000,true)
const str=(maxLength:number)=>({type:'string',maxLength}),obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
export const productionAssessmentSchema=obj({checks:{type:'array',minItems:5,maxItems:5,items:obj({id:{type:'string',pattern:'^check-[1-5]$'},status:{enum:['passed','needs-fix']},notes:str(500)})},listening:{enum:['not-performed','passed','needs-fix']},retellingAnswer:str(1000),predictionAnswer:str(1000),notes:str(1000)})
