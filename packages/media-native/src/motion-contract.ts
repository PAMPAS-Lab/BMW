import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'
export interface MotionRequest {action:'media.video.motion';artifactId:string;startSeconds:number;endSeconds:number;region:{x:number;y:number;width:number;height:number}}
export interface MotionStats {startSeconds:number;endSeconds:number;frameCount:number;coveredStartSeconds:number;coveredEndSeconds:number;maximumFrameHoldSeconds:number;maximumDecodeGapSeconds:number;maximumNearStaticSeconds:number;changedFramePairs:number;nearStaticRuns:{startSeconds:number;endSeconds:number}[]}
export interface MotionReport {method:'all-decoded-frames/64x64-RGB-mean-absolute-difference';threshold:0.5;region:MotionRequest['region'];windows:MotionStats[];semanticMotionVerified:false;audioAuditioned:false}
export function assertMotionRequest(raw:unknown):MotionRequest {
 const v=mediaRecord(raw);if(v.action!=='media.video.motion'||Object.keys(v).some(k=>!['action','artifactId','startSeconds','endSeconds','region','tabId'].includes(k)))throw new TypeError('Invalid motion request.')
 const startSeconds=finiteNumber(v.startSeconds,'motion start',0,1800),endSeconds=finiteNumber(v.endSeconds,'motion end',startSeconds+.001,Math.min(1800,startSeconds+180)),r=mediaRecord(v.region)
 if(Object.keys(r).some(k=>!['x','y','width','height'].includes(k)))throw new TypeError('Invalid motion region.')
 const x=finiteNumber(r.x,'region x',0,1),y=finiteNumber(r.y,'region y',0,1),width=finiteNumber(r.width,'region width',.01,1),height=finiteNumber(r.height,'region height',.01,1)
 if(x+width>1+1e-9||y+height>1+1e-9)throw new TypeError('Motion region exceeds image.')
 return {action:v.action,artifactId:assertArtifactId(v.artifactId),startSeconds,endSeconds,region:{x,y,width,height}}
}
export function assertMotionReport(raw:unknown,request:MotionRequest):MotionReport {
 const r=mediaRecord(raw);if(r.method!=='all-decoded-frames/64x64-RGB-mean-absolute-difference'||r.threshold!==.5||r.semanticMotionVerified!==false||r.audioAuditioned!==false||JSON.stringify(r.region)!==JSON.stringify(request.region)||!Array.isArray(r.windows)||r.windows.length!==2)throw new TypeError('Invalid motion evidence.')
 for(const [i,rawWindow]of r.windows.entries()){
  const w=mediaRecord(rawWindow),start=finiteNumber(w.startSeconds,'motion window start',0,1800),end=finiteNumber(w.endSeconds,'motion window end',start+.001,1800)
  if(start!==request.startSeconds||end!==(i?Math.min(request.endSeconds,start+3):request.endSeconds))throw new TypeError('Motion window mismatch.')
  const count=finiteNumber(w.frameCount,'motion frames',1,6000,true);finiteNumber(w.changedFramePairs,'changed pairs',0,count-1,true)
  // Frame timestamp addition can differ from the requested endpoint by a few
  // IEEE-754 units. Retain the decoded values; do not mask real coverage gaps.
  const precision=8*Number.EPSILON*Math.max(1,Math.abs(start),Math.abs(end))
  const first=finiteNumber(w.coveredStartSeconds,'motion coverage start',0,start+precision),last=finiteNumber(w.coveredEndSeconds,'motion coverage end',end-precision,1801)
  for(const k of ['maximumFrameHoldSeconds','maximumDecodeGapSeconds','maximumNearStaticSeconds'])finiteNumber(w[k],k,0,last-first)
  if(!Array.isArray(w.nearStaticRuns)||w.nearStaticRuns.length>32)throw new TypeError('Invalid motion intervals.')
  for(const row of w.nearStaticRuns){const s=mediaRecord(row),a=finiteNumber(s.startSeconds,'static start',start,end);finiteNumber(s.endSeconds,'static end',a,end)}
 }
 return raw as MotionReport
}
/** All frames contribute; low pixel change is a review flag, never a semantic certification. */
export class MotionAccumulator {
 private previous?:Uint8ClampedArray;private previousEnd=0;private runStart=0;private runEnd=0
 readonly stats:MotionStats
 constructor(start:number,end:number){this.stats={startSeconds:start,endSeconds:end,frameCount:0,coveredStartSeconds:Infinity,coveredEndSeconds:0,maximumFrameHoldSeconds:0,maximumDecodeGapSeconds:0,maximumNearStaticSeconds:0,changedFramePairs:0,nearStaticRuns:[]}}
 private finishRun(){const s=this.stats,d=this.runEnd-this.runStart;s.maximumNearStaticSeconds=Math.max(s.maximumNearStaticSeconds,d);if(d>=.25&&s.nearStaticRuns.length<32)s.nearStaticRuns.push({startSeconds:this.runStart,endSeconds:this.runEnd})}
 add(timestamp:number,duration:number,pixels:Uint8ClampedArray){
  const s=this.stats,a=Math.max(timestamp,s.startSeconds),b=Math.min(timestamp+duration,s.endSeconds);if(b<=a)return
  if(++s.frameCount>6000)throw new Error('Motion frame budget exceeded.')
  s.coveredStartSeconds=Math.min(s.coveredStartSeconds,timestamp);s.coveredEndSeconds=Math.max(s.coveredEndSeconds,timestamp+duration);s.maximumFrameHoldSeconds=Math.max(s.maximumFrameHoldSeconds,b-a)
  if(this.previous){s.maximumDecodeGapSeconds=Math.max(s.maximumDecodeGapSeconds,a-this.previousEnd);let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=Math.abs(pixels[i]-this.previous[i])+Math.abs(pixels[i+1]-this.previous[i+1])+Math.abs(pixels[i+2]-this.previous[i+2]);if(sum/(pixels.length/4*3)>.5){s.changedFramePairs++;this.finishRun();this.runStart=a}}
  else this.runStart=a
  this.runEnd=b;this.previousEnd=b;this.previous=new Uint8ClampedArray(pixels)
 }
 finish():MotionStats{this.finishRun();const s=this.stats;if(!s.frameCount||s.coveredStartSeconds>s.startSeconds+.000001||s.coveredEndSeconds<s.endSeconds-.000001)throw new Error('Motion analysis did not decode the complete requested interval.');return s}
}
