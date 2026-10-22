import {finiteNumber,mediaRecord} from './media-contract.js'
export interface SourceMetadataRange {startCharacter:number;endCharacter:number;quote:string}
export interface SourceMetadataRanges {author?:SourceMetadataRange;publishedAt?:SourceMetadataRange}
/** Exact UTF16 witnesses in the acquisition's visible body, never supplied metadata values. */
export function assertSourceMetadataRanges(raw:unknown):SourceMetadataRanges{
 const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['author','publishedAt'].includes(k))||!Object.keys(v).length)throw new TypeError('Invalid source metadata ranges.')
 const result:SourceMetadataRanges={}
 for(const name of ['author','publishedAt'] as const)if(v[name]!==undefined){const r=mediaRecord(v[name]);if(Object.keys(r).some(k=>!['startCharacter','endCharacter','quote'].includes(k)))throw new TypeError('Invalid source metadata witness.');const startCharacter=finiteNumber(r.startCharacter,'metadata start',0,50000,true),endCharacter=finiteNumber(r.endCharacter,'metadata end',startCharacter+1,50000,true);if(typeof r.quote!=='string'||!r.quote.trim()||r.quote.length>(name==='author'?280:80)||r.quote.length!==endCharacter-startCharacter)throw new TypeError('Invalid source metadata quote.');result[name]={startCharacter,endCharacter,quote:r.quote}}
 if(!result.author&&!result.publishedAt)throw new TypeError('Empty source metadata ranges.');return result
}
export function verifySourceMetadataRanges(ranges:SourceMetadataRanges,metadata:{author:string|null;publishedAt:string|null;scope:{status:string;truncated:boolean}},text?:string):void{
 if(metadata.scope.status!=='observed'||metadata.scope.truncated)throw new Error('SOURCE_METADATA_RANGE: Requires a complete observed body.')
 for(const name of ['author','publishedAt'] as const){const r=ranges[name];if(!r)continue;if(metadata[name]!==r.quote.trim()||text!==undefined&&text.slice(r.startCharacter,r.endCharacter)!==r.quote)throw new Error('SOURCE_METADATA_RANGE: Metadata witness differs from the visible original; read and collect again.')
  if(name==='publishedAt'&&text!==undefined){const before=text.slice(0,r.startCharacter),after=text.slice(r.endCharacter),prefix=before.slice(before.lastIndexOf('\n')+1),suffix=after.split('\n')[0],previous=before.slice(0,before.lastIndexOf('\n')).trimEnd().split('\n').at(-1)??'';if(prefix.trim()||suffix.trim()||/\b(?:updated|modified|recorded|retrieved|accessed|reposted)\b|更新时间|更新于|录制|转载|抓取|采集/i.test(previous+'\n'+r.quote))throw new Error('SOURCE_METADATA_RANGE: Select the complete original publication-date line, not a cropped update/recording/repost date.')}
 }
}
