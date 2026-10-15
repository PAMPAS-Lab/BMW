import {finiteNumber} from './media-contract.js'
import {assertRecordingEvents} from './recording-contract.js'
import type {RecordingEvents} from './recording-contract.js'
export interface RecordingPlanSegment {startSeconds:number;endSeconds:number;kind:'operation'|'wait-candidate'|'result-candidate'|'unclassified';rate:number;mute:boolean;eventIndices:number[];reason:string}
/** Only measured event clocks produce suggestions. Inactivity is a wait
 * candidate, never proof that a page is idle or that navigation succeeded. */
export function suggestRecordingPlan(raw:RecordingEvents,startSeconds:number,endSeconds:number):{segments:RecordingPlanSegment[];unmappedEvents:number;omittedActivityWindows:number;semanticVerification:false} {
 startSeconds=finiteNumber(startSeconds,'recording plan start',0,1800);endSeconds=finiteNumber(endSeconds,'recording plan end',startSeconds+.1,1800)
 const record=assertRecordingEvents(raw);if(endSeconds>record.durationSeconds+.000001)throw new Error('Recording plan exceeds measured recording duration.');const windows:{start:number;end:number;kind:'operation'|'result-candidate';indices:number[]}[]=[]
 let unmappedEvents=0
 for(const [index,e]of record.events.entries()){
  if(e.timing!=='measured-frame'){unmappedEvents++;continue}if(e.seconds<startSeconds||e.seconds>=endSeconds||e.kind==='viewport')continue
  const start=Math.max(startSeconds,e.seconds-.25),end=Math.min(endSeconds,e.seconds+1.5),kind=e.kind==='navigation'?'result-candidate' as const:'operation' as const,last=windows.at(-1)
  if(last&&start<=last.end&&last.kind===kind){last.end=Math.max(last.end,end);last.indices.push(index)}else if(last&&start<last.end){last.end=Math.max(last.end,end);last.indices.push(index);if(kind==='operation')last.kind=kind}else windows.push({start,end,kind,indices:[index]})
 }
 const chosen=windows.slice(0,3),segments:RecordingPlanSegment[]=[];let cursor=startSeconds
 const add=(start:number,end:number,kind:RecordingPlanSegment['kind'],indices:number[],reason:string)=>{if(end<=start)return;if(end-start<.1&&segments.length){const previous=segments.at(-1)!;previous.endSeconds=end;previous.eventIndices.push(...indices);return}segments.push({startSeconds:start,endSeconds:end,kind,rate:kind==='wait-candidate'?2:1,mute:kind==='wait-candidate',eventIndices:indices.slice(0,100),reason})}
 const mappedEnd=Math.min(endSeconds,record.frameClock.at(-1)?.outputSeconds??startSeconds)
 for(const w of chosen){const start=w.start-cursor<.1?cursor:Math.max(cursor,w.start);if(start>cursor){const wait=start-cursor>=3&&start<=mappedEnd&&!record.truncated&&!record.frameClockTruncated;add(cursor,start,wait?'wait-candidate':'unclassified',[],wait?'两次操作之间没有记录到页面事件；请检查是否可压缩，仍可能包含阅读或动画。':'此段没有足够事件证据，保留原速。')}const end=Math.max(start,Math.min(w.end,endSeconds));add(start,end,w.kind,w.indices,w.kind==='result-candidate'?'导航后的展示候选；请核对画面，导航不证明操作成功。':'实际点击或滚动附近的操作候选。');cursor=end}
 if(endSeconds>cursor)add(cursor,endSeconds,windows.length>chosen.length?'unclassified':chosen.length?'result-candidate':'unclassified',[],windows.length>chosen.length?'更多事件超出建议预算，保留原速并人工整理。':chosen.length?'最后操作后的展示候选；请核对实际结果和阅读时间。':'没有可用的实测事件，保留原速。')
 if(!segments.length)segments.push({startSeconds,endSeconds,kind:'unclassified',rate:1,mute:false,eventIndices:[],reason:'没有足够可分割事件，保留原速。'})
 return {segments,unmappedEvents,omittedActivityWindows:Math.max(0,windows.length-chosen.length),semanticVerification:false}
}
