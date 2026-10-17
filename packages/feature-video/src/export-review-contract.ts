import {mediaRecord} from '../../media-native/src/media-contract.js'
export interface ExportReviewVerdict {exportFingerprint:string;scope:'scene'|'film';status:'passed'|'needs-fix';notes:string}
export function assertExportReviewVerdict(raw:unknown):ExportReviewVerdict {
 const v=mediaRecord(raw)
 if(Object.keys(v).some(k=>!['exportFingerprint','scope','status','notes'].includes(k))||typeof v.exportFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.exportFingerprint)||!['scene','film'].includes(String(v.scope))||!['passed','needs-fix'].includes(String(v.status))||typeof v.notes!=='string'||!v.notes.trim()||v.notes.length>600||v.notes.includes('\0'))throw new TypeError('STUDIO_EXPORT_REVIEW: Supply current fingerprint, scene/film scope, passed/needs-fix and concrete notes (1..600); actor is Host-owned.')
 return {exportFingerprint:v.exportFingerprint,scope:v.scope as ExportReviewVerdict['scope'],status:v.status as ExportReviewVerdict['status'],notes:v.notes}
}
export const exportReviewVerdictSchema={type:'object',additionalProperties:false,required:['exportFingerprint','scope','status','notes'],properties:{exportFingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},scope:{enum:['scene','film']},status:{enum:['passed','needs-fix']},notes:{type:'string',minLength:1,maxLength:600}}}
