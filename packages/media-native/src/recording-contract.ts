import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'
import type {FocusInterval} from './focus-contract.js'
export const RECORDING_EVENT_LIMIT=5000,RECORDING_EVENT_BYTES=2*1024*1024
export interface RecordingClock {startedEpochMs:number;width:number;height:number}
export interface PageRecordingEvent {epochMs:number;kind:'click'|'scroll'|'viewport'|'navigation';source:'page-event'|'agent-action'|'browser-lifecycle';x?:number;y?:number;viewportWidth:number;viewportHeight:number;surfaceWidth:number;surfaceHeight:number;dpr:number;scrollX:number;scrollY:number;url?:string}
/** Host-created observer, never model input. collect settles after listener cleanup. */
export interface RecordingEventSource {begin(clock:RecordingClock):void;collect(endEpochMs:number):Promise<{events:PageRecordingEvent[];truncated:boolean;reason:string}>;dispose():Promise<void>}
export interface RecordingFrameClock {sourceEpochMs:number;outputSeconds:number}
export interface RecordingEvents {version:1;artifactId:string;timeDomain:'recording-seconds';coordinateDomain:'viewport-css-pixels';mapping:'viewport-to-output';clock:RecordingClock;durationSeconds:number;sampleIntervalMs:100;pausePolicy:'unsupported';navigationPolicy:'continue';truncated:boolean;stopReason:string;frameClock:RecordingFrameClock[];frameClockTruncated:boolean;events:(Omit<PageRecordingEvent,'epochMs'>&{seconds:number;pageSeconds:number;timing:'measured-frame'|'wall-clock'})[]}
function closed(v:Record<string,unknown>,keys:string[]):void{if(Object.keys(v).some(key=>!keys.includes(key)))throw new Error('Unsupported recording event field.')}
export function recordingEvents(artifactId:string,clock:RecordingClock,durationSeconds:number,packet:{events:PageRecordingEvent[];truncated:boolean;reason:string},frameClock:RecordingFrameClock[]=[],frameClockTruncated=false):RecordingEvents{
  return assertRecordingEvents({version:1,artifactId,timeDomain:'recording-seconds',coordinateDomain:'viewport-css-pixels',mapping:'viewport-to-output',clock,durationSeconds,sampleIntervalMs:100,pausePolicy:'unsupported',navigationPolicy:'continue',truncated:packet.truncated,stopReason:packet.reason,frameClock,frameClockTruncated,events:packet.events.filter(event=>event.epochMs>=clock.startedEpochMs&&event.epochMs<=clock.startedEpochMs+durationSeconds*1000).map(event=>{const {epochMs,...rest}=event;const frame=frameClock.find(frame=>frame.sourceEpochMs>=epochMs);const pageSeconds=(epochMs-clock.startedEpochMs)/1000;return {...rest,pageSeconds,seconds:frame?.outputSeconds??pageSeconds,timing:frame?'measured-frame':'wall-clock'}}).sort((a,b)=>a.seconds-b.seconds)})
}
export function assertRecordingEvents(raw:unknown,expectedArtifactId?:string):RecordingEvents{
  const value=mediaRecord(raw);closed(value,['version','artifactId','timeDomain','coordinateDomain','mapping','clock','durationSeconds','sampleIntervalMs','pausePolicy','navigationPolicy','truncated','stopReason','events','frameClock','frameClockTruncated'])
  const artifactId=assertArtifactId(value.artifactId)
  if(expectedArtifactId&&artifactId!==expectedArtifactId)throw new Error('Recording events belong to another video.')
  if(value.version!==1||value.timeDomain!=='recording-seconds'||value.coordinateDomain!=='viewport-css-pixels'||value.mapping!=='viewport-to-output'||value.sampleIntervalMs!==100||value.pausePolicy!=='unsupported'||value.navigationPolicy!=='continue'||typeof value.truncated!=='boolean'||typeof value.frameClockTruncated!=='boolean'||typeof value.stopReason!=='string'||value.stopReason.length>80)throw new Error('Invalid recording event metadata.')
  const c=mediaRecord(value.clock);closed(c,['startedEpochMs','width','height']);const clock={startedEpochMs:finiteNumber(c.startedEpochMs,'recording epoch',0,Number.MAX_SAFE_INTEGER),width:finiteNumber(c.width,'recording width',1,16384,true),height:finiteNumber(c.height,'recording height',1,16384,true)},durationSeconds=finiteNumber(value.durationSeconds,'recording duration',.001,1800)
  const frameClock=assertRecordingFrameClock(value.frameClock,durationSeconds)
  if(!Array.isArray(value.events)||value.events.length>RECORDING_EVENT_LIMIT)throw new Error('Recording event budget exceeded.')
  const events=value.events.map(raw=>{const e=mediaRecord(raw);closed(e,['seconds','pageSeconds','timing','kind','source','x','y','viewportWidth','viewportHeight','surfaceWidth','surfaceHeight','dpr','scrollX','scrollY','url'])
    if(!['measured-frame','wall-clock'].includes(String(e.timing)))throw new Error('Invalid event timing provenance.')
    if(!['click','scroll','viewport','navigation'].includes(String(e.kind))||!['page-event','agent-action','browser-lifecycle'].includes(String(e.source)))throw new Error('Invalid recording event kind/source.')
    const event:RecordingEvents['events'][number]={pageSeconds:finiteNumber(e.pageSeconds,'page event time',0,durationSeconds),timing:e.timing as 'measured-frame'|'wall-clock',seconds:finiteNumber(e.seconds,'event time',0,durationSeconds),kind:e.kind as PageRecordingEvent['kind'],source:e.source as PageRecordingEvent['source'],surfaceWidth:finiteNumber(e.surfaceWidth,'native surface CSS width',1,65536),surfaceHeight:finiteNumber(e.surfaceHeight,'native surface CSS height',1,65536),viewportWidth:finiteNumber(e.viewportWidth,'viewport width',1,16384),viewportHeight:finiteNumber(e.viewportHeight,'viewport height',1,16384),dpr:finiteNumber(e.dpr,'DPR',.1,16),scrollX:finiteNumber(e.scrollX,'scroll x',0,10000000),scrollY:finiteNumber(e.scrollY,'scroll y',0,10000000)}
    if(event.kind==='click'){event.x=finiteNumber(e.x,'click x',0,event.viewportWidth);event.y=finiteNumber(e.y,'click y',0,event.viewportHeight)}else if(e.x!==undefined||e.y!==undefined)throw new Error('Only click events carry coordinates.')
    if(e.url!==undefined){if(typeof e.url!=='string'||e.url.length>2048)throw new Error('Invalid event URL.');const u=new URL(e.url);if(!['http:','https:','about:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new Error('Event URLs exclude credentials, queries and fragments.');event.url=e.url}
    const measured=frameClock.find(frame=>frame.sourceEpochMs>=clock.startedEpochMs+event.pageSeconds*1000)
    if(event.timing==='measured-frame'&&(!measured||Math.abs(measured.outputSeconds-event.seconds)>.0000001)||event.timing==='wall-clock'&&(measured||Math.abs(event.pageSeconds-event.seconds)>.0000001))throw new Error('Event timing lacks its declared frame evidence.')
    return event
  })
  if(events.some((e,i)=>i>0&&e.seconds<events[i-1].seconds))throw new Error('Events must be chronological.')
  return {version:1,artifactId,timeDomain:'recording-seconds',coordinateDomain:'viewport-css-pixels',mapping:'viewport-to-output',clock,durationSeconds,sampleIntervalMs:100,pausePolicy:'unsupported',navigationPolicy:'continue',truncated:value.truncated,stopReason:value.stopReason,frameClock,frameClockTruncated:value.frameClockTruncated,events}
}
/** Conservative deterministic click clusters: zoom capped at 1.5 to keep result context.
 * Suggestions are not measured cursor trajectories and do not replace manual edits. */
export function suggestRecordingFocus(record:RecordingEvents):FocusInterval[]{
  const groups:{start:number;end:number;x:number;y:number}[]=[]
  for(const event of record.events){if(event.kind!=='click'||event.timing!=='measured-frame')continue
    const x=event.x!/event.surfaceWidth,y=event.y!/event.surfaceHeight;if(x<0||x>1||y<0||y>1)continue
    const last=groups.at(-1),start=Math.max(0,event.seconds-.35),end=Math.min(record.durationSeconds,event.seconds+2)
    if(last&&start<last.end&&Math.hypot(x-last.x,y-last.y)<.15){last.end=end;continue}
    if(last&&start<last.end)last.end=start
    if(end-start>=.1)groups.push({start,end,x,y})
    if(groups.length===24)break
  }
  return groups.filter(g=>g.end-g.start>=.1).map(g=>({startSeconds:g.start,endSeconds:g.end,x:g.x,y:g.y,zoom:1.5,emphasize:true}))
}

export function assertRecordingFrameClock(raw:unknown,durationSeconds:number):RecordingFrameClock[]{
  if(!Array.isArray(raw)||raw.length>5000)throw new Error('Recording frame clock budget exceeded.')
  return raw.map((item,index)=>{const value=mediaRecord(item);closed(value,['sourceEpochMs','outputSeconds']);const result={sourceEpochMs:finiteNumber(value.sourceEpochMs,'source frame epoch',0,Number.MAX_SAFE_INTEGER),outputSeconds:finiteNumber(value.outputSeconds,'output frame seconds',0,durationSeconds)}
    if(index>0&&(result.sourceEpochMs<Number((raw[index-1] as RecordingFrameClock).sourceEpochMs)||result.outputSeconds<Number((raw[index-1] as RecordingFrameClock).outputSeconds)))throw new Error('Recording frame clocks must be chronological.')
    return result
  })
}
