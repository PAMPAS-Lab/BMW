import path from 'node:path'
import {ARCHIVE_LIMITS} from './archive-limits.js'

/** Archive ledgers are private Project files, not model response payloads. */
export function encodePreservationEvidence(value:unknown):Buffer {
 const data=Buffer.from(JSON.stringify(value)+'\n')
 if(data.length>ARCHIVE_LIMITS.evidenceBytes)throw new Error('MEDIA_PRESERVATION_EVIDENCE_BUDGET: Evidence exceeds '+ARCHIVE_LIMITS.evidenceBytes+' bytes.')
 return data
}

/** Reject a ledger that cannot fit before transferring large AV segments.
 * Conservative names, sizes and envelope room include every declared track. */
export function assertPreservationEvidencePlan(directory:string,prefix:string,existing:readonly unknown[],items:readonly {url:string;track:string;durationSeconds?:number}[]):void {
 let estimated=1024*1024+Buffer.byteLength(JSON.stringify(existing))
 const artifactId=prefix+'-999999-subtitle-999-segment.vtt'
 for(const item of items){
  estimated+=Buffer.byteLength(JSON.stringify({artifactId,path:path.join(directory,artifactId),url:item.url,sha256:'0'.repeat(64),bytes:ARCHIVE_LIMITS.bytes,role:'initialization',track:item.track,durationSeconds:item.durationSeconds??ARCHIVE_LIMITS.durationSeconds}))+1
  if(estimated>ARCHIVE_LIMITS.evidenceBytes)throw new Error('MEDIA_PRESERVATION_EVIDENCE_BUDGET: Planned complete ledger exceeds '+ARCHIVE_LIMITS.evidenceBytes+' bytes before segment transfer.')
 }
}
