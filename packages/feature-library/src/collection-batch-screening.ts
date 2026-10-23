import type {SourceAcquisition} from '@bmw-agent/media-native/sources'
import type {BatchOriginal} from './collection-batch-contract.js'
export type BatchScreen={decision:'review'|'skip'|'pending';reason:string}
/** Strict publication intervals: a civil day may be anywhere in UTC−14…UTC+14.
 * Unknown/relative/locale dates never acquire an invented timezone. */
export function publicationInterval(value:string):[number,number]|null {
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
  const day=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==value)return null
  return [day-14*3600000,day+38*3600000-1]
 }
 const english=/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?) (\d{1,2}), (\d{4})$/.exec(value)
 if(english){const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(english[1].slice(0,3))+1;return publicationInterval(english[3]+'-'+String(month).padStart(2,'0')+'-'+english[2].padStart(2,'0'))}
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null
 const civil=value.slice(0,10);if(!publicationInterval(civil))return null
 const time=Date.parse(value);return Number.isFinite(time)?[time,time]:null
}
export function screenBatchOriginal(createdAt:string,original:BatchOriginal,acquisition:SourceAcquisition,body:string,trend=false):BatchScreen {
 if(!original.complete||acquisition.scope?.truncated||acquisition.result!=='observed')return {decision:'pending',reason:'incomplete-original'}
 if(trend)return {decision:'review',reason:'unverified-trend-observation'}
 const date=acquisition.publishedAt,interval=date?publicationInterval(date):null,witness=acquisition.metadataRanges?.publishedAt
 // Civil dates need a visible body witness. Explicit native selector timestamps
 // retain their offset; relative or yearless selector text remains unverified.
 if(!date||!interval||!(witness?body.slice(witness.startCharacter,witness.endCharacter)===date:interval[0]===interval[1]||body.slice(0,800).includes(date)))return {decision:'pending',reason:'publication-date-unverified'}
 const to=Date.parse(createdAt),from=to-72*3600000
 if(interval[1]<from||interval[0]>to)return {decision:'skip',reason:'proven-outside-72h-window'}
 if(interval[0]<from||interval[1]>to)return {decision:'pending',reason:'publication-timezone-boundary'}
 return {decision:'review',reason:'publication-within-72h-window'}
}
