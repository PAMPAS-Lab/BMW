import crypto from 'node:crypto'

export const SUBTITLE_LIMITS=Object.freeze({tracks:32,bytes:32*1024*1024,segmentBytes:1024*1024,derivedBytes:16*1024*1024,cues:100000})
export interface PreservedVttCue {startSeconds:number;endSeconds:number;identifier:string;settings:string;text:string}
export interface PreservedVttSegment {header:string;configuration:string[];notes:string[];timestampMap:{localSeconds:number;mpegtsTicks:number;explicit:boolean};cues:PreservedVttCue[]}
export interface SubtitleSegmentInput {artifactId:string;data:Uint8Array;elapsedSeconds:number;durationSeconds:number}
const digest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const failure=(reason:string):never=>{throw new Error('MEDIA_PRESERVATION_SUBTITLE_INVALID: '+reason)}
export function vttTimestamp(value:string):number {
 const m=/^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value)
 if(!m)return failure('Malformed WebVTT timestamp.')
 const ms=Number(m[1]??0)*3600000+Number(m[2])*60000+Number(m[3])*1000+Number(m[4])
 if(!Number.isSafeInteger(ms))return failure('Nonfinite or imprecise WebVTT timestamp.')
 return ms/1000
}
/** Closed parser: no malformed cue, unsupported block or decoding replacement
 * can disappear while a complete subtitle track is being published. */
export function parsePreservedVtt(data:Uint8Array):PreservedVttSegment {
 if(data.length>SUBTITLE_LIMITS.derivedBytes)return failure('WebVTT byte budget exceeded.')
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{return failure('WebVTT must be valid UTF-8.')}
 if(text.includes('\0'))return failure('NUL in WebVTT.')
 text=text.replace(/\r\n?/g,'\n')
 const blocks=text.split(/\n[ \t]*\n/),headerLines=(blocks.shift()??'').split('\n')
 if(!/^WEBVTT(?:[ \t][^\n]*)?$/.test(headerLines[0]??'')||headerLines[0]!.includes('-->'))return failure('Missing WebVTT header.')
 let timestampMap:PreservedVttSegment['timestampMap']={localSeconds:0,mpegtsTicks:0,explicit:false}
 const retainedHeader=[headerLines[0]!]
 for(const line of headerLines.slice(1)){
  if(line.startsWith('X-TIMESTAMP-MAP=')){
   if(timestampMap.explicit)return failure('Duplicate timestamp map.')
   const fields=line.slice(16).split(','),local=fields.find(f=>f.startsWith('LOCAL:')),mpegts=fields.find(f=>f.startsWith('MPEGTS:'))
   if(fields.length!==2||!local||!mpegts||!/^\d+$/.test(mpegts.slice(7)))return failure('Malformed timestamp map.')
   const ticks=Number(mpegts.slice(7));if(!Number.isSafeInteger(ticks)||ticks<0||ticks>=2**33)return failure('MPEGTS timestamp outside 33-bit clock.')
   timestampMap={localSeconds:vttTimestamp(local.slice(6)),mpegtsTicks:ticks,explicit:true}
  }else{if(line.includes('-->'))return failure('Cue in WebVTT header.');retainedHeader.push(line)}
 }
 const cues:PreservedVttCue[]=[],configuration:string[]=[],notes:string[]=[]
 for(let block of blocks){
  if(!block.trim())continue
  block=block.replace(/\n+$/,'')
  if(/^NOTE(?:[ \t\n]|$)/.test(block)){notes.push(block);continue}
  if(/^(?:STYLE|REGION)(?:\n|$)/.test(block)){if(block.includes('-->'))return failure('Cue inside configuration block.');configuration.push(block);continue}
  const lines=block.split('\n'),at=lines[0]?.includes('-->')?0:1,line=lines[at]??''
  const m=/^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.*))?$/.exec(line)
  if(!m||at===1&&(!lines[0]||lines[0].includes('-->')))return failure('Malformed or unsupported subtitle block.')
  const startSeconds=vttTimestamp(m[1]!),endSeconds=vttTimestamp(m[2]!)
  if(endSeconds<=startSeconds||cues.length>=SUBTITLE_LIMITS.cues)return failure('Invalid cue range or cue budget exceeded.')
  const body=lines.slice(at+1).join('\n');if(body.includes('-->'))return failure('Unseparated cue or invalid cue text.')
  cues.push({startSeconds,endSeconds,identifier:at?lines[0]!: '',settings:m[3]??'',text:body})
 }
 return {header:retainedHeader.join('\n'),configuration,notes,timestampMap,cues}
}
const milliseconds=(n:number)=>Math.round(n*1000)
const timestamp=(n:number)=>{const ms=milliseconds(n),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;return [h,m,s].map(v=>String(v).padStart(2,'0')).join(':')+'.'+String(ms%1000).padStart(3,'0')}
/** Produce a standalone WebVTT in the preserved MP4 file's PTS domain.
 * Original segments remain separate immutable evidence. Exact repeated cues
 * across HLS boundaries are deduplicated only in this derived sidecar. */
export function assemblePreservedVtt(segments:readonly SubtitleSegmentInput[],range:{startSeconds:number;endSeconds:number}){
 if(!segments.length||!Number.isFinite(range.startSeconds)||!Number.isFinite(range.endSeconds)||range.endSeconds<=range.startSeconds)return failure('Missing subtitle segments or audiovisual range.')
 const wrap=2**33/90000,seen=new Set<string>(),cues:PreservedVttCue[]=[],notes:string[]=[],mappings:{artifactId:string;elapsedSeconds:number;durationSeconds:number;timestampMap:PreservedVttSegment['timestampMap'];epoch:number;cueCount:number;cueSha256:string}[]=[]
 let header='',configuration:string[]=[],occurrences=0,bytes=0
 for(const [index,segment]of segments.entries()){
  if(!Number.isFinite(segment.elapsedSeconds)||segment.elapsedSeconds<0||!Number.isFinite(segment.durationSeconds)||segment.durationSeconds<=0)return failure('Invalid subtitle segment timing.')
  bytes+=segment.data.length;if(segment.data.length>SUBTITLE_LIMITS.segmentBytes||bytes>SUBTITLE_LIMITS.bytes)return failure('Subtitle input budget exceeded.')
  const parsed=parsePreservedVtt(segment.data)
  if(index===0){header=parsed.header;configuration=parsed.configuration}
  else if(parsed.header!==header||parsed.configuration.some(block=>!configuration.includes(block)))return failure('Changing subtitle style/region/header cannot be merged faithfully.')
  for(const note of parsed.notes)if(!notes.includes(note))notes.push(note)
  const base=parsed.timestampMap.mpegtsTicks/90000-parsed.timestampMap.localSeconds,first=parsed.cues[0]?.startSeconds??parsed.timestampMap.localSeconds
  const epoch=Math.round((range.startSeconds+segment.elapsedSeconds-first-base)/wrap)
  mappings.push({artifactId:segment.artifactId,elapsedSeconds:segment.elapsedSeconds,durationSeconds:segment.durationSeconds,timestampMap:parsed.timestampMap,epoch,cueCount:parsed.cues.length,cueSha256:digest(parsed.cues)})
  const segmentKeys=new Set<string>()
  for(const source of parsed.cues){
   if(++occurrences>SUBTITLE_LIMITS.cues)return failure('Subtitle cue budget exceeded.')
   const startSeconds=milliseconds(source.startSeconds+base+epoch*wrap)/1000,endSeconds=milliseconds(source.endSeconds+base+epoch*wrap)/1000
   if(startSeconds<0||startSeconds<range.startSeconds-.35||endSeconds>range.endSeconds+.35||endSeconds<=startSeconds)return failure('Subtitle timestamp map does not match the preserved audiovisual range.')
   const cue={...source,startSeconds,endSeconds},key=JSON.stringify(cue)
   if(!seen.has(key))cues.push(cue)
   segmentKeys.add(key)
  }
  for(const key of segmentKeys)seen.add(key)
 }
 cues.sort((a,b)=>a.startSeconds-b.startSeconds||a.endSeconds-b.endSeconds)
 const text=[header,...configuration,...notes,...cues.map(c=>(c.identifier?c.identifier+'\n':'')+timestamp(c.startSeconds)+' --> '+timestamp(c.endSeconds)+(c.settings?' '+c.settings:'')+'\n'+c.text)].join('\n\n')+'\n\n',data=Buffer.from(text,'utf8')
 if(data.length>SUBTITLE_LIMITS.derivedBytes)return failure('Merged subtitle budget exceeded.')
 const readback=parsePreservedVtt(data),cueSha256=digest(cues)
 if(readback.timestampMap.explicit||digest(readback.cues)!==cueSha256||readback.header!==header||digest(readback.configuration)!==digest(configuration)||digest(readback.notes)!==digest(notes))return failure('Standalone subtitle readback changed cues or configuration.')
 return {data,cueCount:cues.length,occurrenceCount:occurrences,duplicatesRemoved:occurrences-cues.length,cueSha256,configurationSha256:digest({header,configuration,notes}),mappings,timebase:'delivery-file-PTS' as const}
}
