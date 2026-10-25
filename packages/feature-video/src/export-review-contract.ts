import {mediaRecord} from '../../media-native/src/media-contract.js'
import {COMPOSITION_LIMITS} from '../../media-native/src/composition-contract.js'
export interface ExportReviewVerdict {exportFingerprint:string;scope:'scene'|'film';status:'passed'|'needs-fix';notes:string}
export function assertExportReviewVerdict(raw:unknown):ExportReviewVerdict {
 const v=mediaRecord(raw)
 if(Object.keys(v).some(k=>!['exportFingerprint','scope','status','notes'].includes(k))||typeof v.exportFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.exportFingerprint)||!['scene','film'].includes(String(v.scope))||!['passed','needs-fix'].includes(String(v.status))||typeof v.notes!=='string'||!v.notes.trim()||v.notes.length>600||v.notes.includes('\0'))throw new TypeError('STUDIO_EXPORT_REVIEW: Supply current fingerprint, scene/film scope, passed/needs-fix and concrete notes (1..600); actor is Host-owned.')
 return {exportFingerprint:v.exportFingerprint,scope:v.scope as ExportReviewVerdict['scope'],status:v.status as ExportReviewVerdict['status'],notes:v.notes}
}
export const exportReviewVerdictSchema={type:'object',additionalProperties:false,required:['exportFingerprint','scope','status','notes'],properties:{exportFingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},scope:{enum:['scene','film']},status:{enum:['passed','needs-fix']},notes:{type:'string',minLength:1,maxLength:600}}}
export interface ExportReviewBatch {exportFingerprint:string;scenes:{sceneId:string;status:ExportReviewVerdict['status'];notes:string}[];film:{status:ExportReviewVerdict['status'];notes:string}}
export function assertExportReviewBatch(raw:unknown):ExportReviewBatch {
 const v=mediaRecord(raw)
 if(Object.keys(v).some(k=>!['exportFingerprint','scenes','film'].includes(k))||!Array.isArray(v.scenes)||!v.scenes.length||v.scenes.length>COMPOSITION_LIMITS.scenes)throw new TypeError('Supply one complete bounded scene/film review batch.')
 const seen=new Set<string>(),scenes=v.scenes.map(raw=>{const s=mediaRecord(raw);if(Object.keys(s).some(k=>!['sceneId','status','notes'].includes(k))||typeof s.sceneId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(s.sceneId)||seen.has(s.sceneId))throw new TypeError('Invalid or duplicate batch scene.');seen.add(s.sceneId);const a=assertExportReviewVerdict({exportFingerprint:v.exportFingerprint,scope:'scene',status:s.status,notes:s.notes});return {sceneId:s.sceneId,status:a.status,notes:a.notes}})
 const f=mediaRecord(v.film);if(Object.keys(f).some(k=>!['status','notes'].includes(k)))throw new TypeError('Invalid batch film declaration.')
 const film=assertExportReviewVerdict({exportFingerprint:v.exportFingerprint,scope:'film',status:f.status,notes:f.notes})
 return {exportFingerprint:film.exportFingerprint,scenes,film:{status:film.status,notes:film.notes}}
}
const assessmentSchema={type:'object',additionalProperties:false,required:['status','notes'],properties:{status:{enum:['passed','needs-fix']},notes:{type:'string',minLength:1,maxLength:600}}}
export const exportReviewBatchSchema={type:'object',additionalProperties:false,required:['exportFingerprint','scenes','film'],properties:{exportFingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},scenes:{type:'array',minItems:1,maxItems:COMPOSITION_LIMITS.scenes,items:{...assessmentSchema,required:['sceneId','status','notes'],properties:{...assessmentSchema.properties,sceneId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'}}}},film:assessmentSchema}}
