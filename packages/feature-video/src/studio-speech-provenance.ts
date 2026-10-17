import {assertArtifactId,mediaRecord} from '../../media-native/src/media-contract.js'
import {speechSha} from '../../media-native/src/speech-contract.js'
export const TIMING_BASES=['editorial-estimate','manual-edit','asr-reference'] as const
export type TimingBasis=typeof TIMING_BASES[number]
export type SpeechTimingProvenance={basis:'editorial-estimate'|'manual-edit'}|{basis:'asr-reference';evidenceArtifactId:string;evidenceSha256:string}
export function assertSpeechTimingProvenance(raw:unknown):SpeechTimingProvenance {
 const v=mediaRecord(raw);if(!TIMING_BASES.includes(v.basis as TimingBasis)||Object.keys(v).some(k=>!(v.basis==='asr-reference'?['basis','evidenceArtifactId','evidenceSha256']:['basis']).includes(k)))throw new TypeError('Invalid speech timing provenance.')
 return v.basis==='asr-reference'?{basis:'asr-reference',evidenceArtifactId:assertArtifactId(v.evidenceArtifactId),evidenceSha256:speechSha(v.evidenceSha256)}:{basis:v.basis as 'editorial-estimate'|'manual-edit'}
}
export const speechTimingProvenanceSchema={oneOf:[{type:'object',additionalProperties:false,required:['basis'],properties:{basis:{enum:['editorial-estimate','manual-edit']}}},{type:'object',additionalProperties:false,required:['basis','evidenceArtifactId','evidenceSha256'],properties:{basis:{const:'asr-reference'},evidenceArtifactId:{type:'string'},evidenceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}}]}
