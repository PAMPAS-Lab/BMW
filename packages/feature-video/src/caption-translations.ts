import {finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import type {CaptionCue} from '../../media-native/src/composition-contract.js'
export interface CaptionTranslation {cueIndex:number;originalText:string;translationText:string}
/** Exact-text guards and the outer draft CAS protect both timing and GUI edits. */
export function assertCaptionTranslations(raw:unknown):CaptionTranslation[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>100)throw new TypeError('Caption translation needs one to one hundred current cues.')
 const indices=new Set<number>(),text=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u0008]/.test(value))throw new TypeError('Invalid caption translation text.');return value}
 return raw.map(raw=>{const c=mediaRecord(raw);if(Object.keys(c).some(k=>!['cueIndex','originalText','translationText'].includes(k)))throw new TypeError('Unsupported caption translation field.');const cueIndex=finiteNumber(c.cueIndex,'cue index',0,99,true);if(indices.has(cueIndex))throw new TypeError('Duplicate translated cue.');indices.add(cueIndex);return {cueIndex,originalText:text(c.originalText),translationText:text(c.translationText)}})
}
export function translateCaptionCues(cues:CaptionCue[]|undefined,translations:CaptionTranslation[],allowUserChanges=false):CaptionCue[]{
 if(!cues?.length)throw new Error('VIDEO_EDIT_CAPTIONS: Read current independent captions before translating.')
 const next=structuredClone(cues)
 for(const t of translations){const cue=next[t.cueIndex];if(!cue||cue.text!==t.originalText)throw new Error('STUDIO_CONFLICT: Caption original text changed; reload before translating.');if(!allowUserChanges&&cue.translationOrigin==='user-edited'&&cue.translationText!==t.translationText)throw new Error('STUDIO_TRANSLATION_EDITED: Preserve user-corrected translations; exclude them from the batch.');cue.translationText=t.translationText}
 return next
}
export const captionTranslationsSchema={type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,required:['cueIndex','originalText','translationText'],properties:{cueIndex:{type:'integer',minimum:0,maximum:99},originalText:{type:'string',minLength:1,maxLength:200},translationText:{type:'string',minLength:1,maxLength:200}}}}
