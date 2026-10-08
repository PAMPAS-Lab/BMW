import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {speechSha} from '../../media-native/src/speech-contract.js'
import {sceneVisuals,visualPlaybackGroup} from '../../media-native/src/visual-segments.js'
import type {CaptionCue} from '../../media-native/src/composition-contract.js'
import type {StudioScene} from './studio-contract.js'
export interface SourceSpeechCandidate {sourceArtifactId:string;sourceSha256:string;evidenceArtifactId:string;evidenceSha256:string;durationSeconds:number;segmentIndex:number;createdAt:string}
export interface SourceCaptionRange {startSeconds:number;endSeconds:number}
export interface SourceCaptionBinding {sourceArtifactId:string;sourceSha256:string;segmentIndex:number;clock:string;origin:'user-edited'|'agent-edited';visualSegmentId?:string;sourceCues?:CaptionCue[];sourceRange?:SourceCaptionRange}
function closed(v:Record<string,unknown>,keys:string[]):void{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('Unsupported source speech property.')}
export function assertSourceCandidate(raw:unknown):SourceSpeechCandidate{const v=mediaRecord(raw);closed(v,['sourceArtifactId','sourceSha256','evidenceArtifactId','evidenceSha256','durationSeconds','segmentIndex','createdAt']);if(typeof v.createdAt!=='string'||v.createdAt.length>40||!Number.isFinite(Date.parse(v.createdAt)))throw new TypeError('Invalid source recognition date.');return {sourceArtifactId:assertArtifactId(v.sourceArtifactId),sourceSha256:speechSha(v.sourceSha256),evidenceArtifactId:assertArtifactId(v.evidenceArtifactId),evidenceSha256:speechSha(v.evidenceSha256),durationSeconds:finiteNumber(v.durationSeconds,'source speech duration',.01,180),segmentIndex:finiteNumber(v.segmentIndex,'source segment',0,7,true),createdAt:v.createdAt}}
export function assertSourceCaptionBinding(raw:unknown):SourceCaptionBinding{const v=mediaRecord(raw);closed(v,['sourceArtifactId','sourceSha256','segmentIndex','clock','origin','sourceCues','sourceRange','visualSegmentId']);if(typeof v.clock!=='string'||v.clock.length>1000||!['user-edited','agent-edited'].includes(String(v.origin)))throw new TypeError('Invalid source caption binding.');return {sourceArtifactId:assertArtifactId(v.sourceArtifactId),sourceSha256:speechSha(v.sourceSha256),segmentIndex:finiteNumber(v.segmentIndex,'source segment',0,7,true),clock:v.clock,origin:v.origin as SourceCaptionBinding['origin'],...(v.visualSegmentId===undefined?{}:{visualSegmentId:segmentIdentity(v.visualSegmentId)}),...boundSourceCues(v)}}
export function sourceCaptionClock(scene:StudioScene,index:number):string{const visuals=sceneVisuals(scene),v=visuals[index];if(!v?.videoArtifactId)throw new Error('原声字幕需要所选视频片段。');const group=visualPlaybackGroup(scene,index);return JSON.stringify({id:v.videoArtifactId,start:group.sourceStartSeconds,rate:group.playbackRate,duration:group.durationSeconds,offset:group.offset})}
export function sourceCaptionsStale(scene:StudioScene):boolean{try{return Boolean(scene.sourceCaptionBinding&&(scene.sourceCaptionBinding.clock!==sourceCaptionClock(scene,scene.sourceCaptionBinding.segmentIndex)||scene.sourceCaptionBinding.visualSegmentId!==undefined&&visualIdentity(scene,scene.sourceCaptionBinding.segmentIndex)!==scene.sourceCaptionBinding.visualSegmentId))}catch{return true}}
export function assertSourceCues(raw:unknown,duration=180):CaptionCue[]{if(!Array.isArray(raw)||!raw.length||raw.length>100)throw new TypeError('At most one hundred nonempty source cues.');let end=0;return raw.map(raw=>{const v=mediaRecord(raw);closed(v,['startSeconds','endSeconds','text']);const startSeconds=finiteNumber(v.startSeconds,'source cue start',end,duration),endSeconds=finiteNumber(v.endSeconds,'source cue end',startSeconds+.001,duration);if(typeof v.text!=='string'||!v.text.trim()||v.text.length>200||/[\u0000-\u0008]/.test(v.text))throw new TypeError('Invalid source cue text.');end=endSeconds;return {startSeconds,endSeconds,text:v.text}})}
/** Original-source seconds map through the chosen segment, with no narration offset. */
export function projectSourceCues(scene:StudioScene,index:number,cues:CaptionCue[]):CaptionCue[]{sourceCaptionClock(scene,index);const group=visualPlaybackGroup(scene,index),offset=group.offset,end=group.sourceStartSeconds+group.durationSeconds*group.playbackRate;return cues.flatMap(cue=>{const startSeconds=Math.max(cue.startSeconds,group.sourceStartSeconds),endSeconds=Math.min(cue.endSeconds,end);return endSeconds<=startSeconds?[]:[{text:cue.text,startSeconds:offset+(startSeconds-group.sourceStartSeconds)/group.playbackRate,endSeconds:offset+(endSeconds-group.sourceStartSeconds)/group.playbackRate}]})}
/** Host-only remapping preserves trusted evidence; GUI cannot supply a new binding. */
export function remapSourceSpeech(previous:StudioScene|undefined,next:StudioScene):void {
 next.sourceSpeech=previous?.sourceSpeech;next.sourceCaptionBinding=previous?.sourceCaptionBinding?structuredClone(previous.sourceCaptionBinding):undefined
 if(previous&&next.sourceCaptionBinding){const old=previous.visualSegments?.[next.sourceCaptionBinding.segmentIndex];if(old?.id)next.sourceCaptionBinding.visualSegmentId??=old.id}
 if(!previous)return
 const remap=(index:number):number=>{
  const before=sceneVisuals(previous),after=sceneVisuals(next),old=before[index];if(!old)return index
  const id=visualIdentity(previous,index)
  if(id){const match=after.findIndex(v=>'id' in v&&v.id===id&&v.videoArtifactId===old.videoArtifactId);return match>=0?visualPlaybackGroup(next,match).index:index}
  let clock:string;try{clock=sourceCaptionClock(previous,index)}catch{return index}
  const candidates=after.flatMap((v,i)=>{if(v.videoArtifactId!==old.videoArtifactId)return [];try{return sameSourceClock(sourceCaptionClock(next,i),clock)?[visualPlaybackGroup(next,i).index]:[]}catch{return []}}),unique=[...new Set(candidates)]
  return unique.length===1?unique[0]:index
 }
 if(next.sourceSpeech)next.sourceSpeech={...next.sourceSpeech,segmentIndex:remap(next.sourceSpeech.segmentIndex)}
 if(next.sourceCaptionBinding){const index=remap(next.sourceCaptionBinding.segmentIndex);next.sourceCaptionBinding={...next.sourceCaptionBinding,segmentIndex:index};
 // Only a host-approved restore may return to a legacy snapshot without clip identity.
 let matched=false;try{matched=Boolean(sourceCaptionClock(next,index))&&sceneVisuals(next)[index]?.videoArtifactId===next.sourceCaptionBinding.sourceArtifactId&&(!next.sourceCaptionBinding.visualSegmentId||visualIdentity(next,index)===next.sourceCaptionBinding.visualSegmentId)}catch{}if(matched)rebindSourceCaptions(previous,next,index)}
}
export const sourceCandidateSchema={type:'object',additionalProperties:false,required:['sourceArtifactId','sourceSha256','evidenceArtifactId','evidenceSha256','durationSeconds','segmentIndex','createdAt'],properties:{sourceArtifactId:{type:'string'},sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},evidenceArtifactId:{type:'string'},evidenceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},durationSeconds:{type:'number',minimum:.01,maximum:180},segmentIndex:{type:'integer',minimum:0,maximum:7},createdAt:{type:'string'}}}
export const sourceCaptionBindingSchema={type:'object',additionalProperties:false,required:['sourceArtifactId','sourceSha256','segmentIndex','clock','origin'],properties:{sourceArtifactId:{type:'string'},sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},segmentIndex:{type:'integer',minimum:0,maximum:7},clock:{type:'string',maxLength:1000},origin:{enum:['user-edited','agent-edited']},visualSegmentId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},sourceCues:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['startSeconds','endSeconds','text'],properties:{startSeconds:{type:'number',minimum:0,maximum:180},endSeconds:{type:'number',minimum:0,maximum:180},text:{type:'string',maxLength:200},translationText:{type:'string',maxLength:200},translationOrigin:{enum:['user-edited','agent-edited']}}}},sourceRange:{type:'object',additionalProperties:false,required:['startSeconds','endSeconds'],properties:{startSeconds:{type:'number',minimum:0,maximum:180},endSeconds:{type:'number',minimum:0,maximum:180}}}}}

function visualIdentity(scene:StudioScene,index:number):string|undefined{return scene.visualSegments?.[index]?.id}
function segmentIdentity(value:unknown):string{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value))throw new TypeError('Invalid bound visual identity.');return value}
function boundSourceCues(v:Record<string,unknown>):Pick<SourceCaptionBinding,'sourceCues'|'sourceRange'> {
 if(v.sourceCues===undefined&&v.sourceRange===undefined)return {}
 const r=mediaRecord(v.sourceRange);closed(r,['startSeconds','endSeconds'])
 const sourceRange={startSeconds:finiteNumber(r.startSeconds,'reviewed source start',0,180),endSeconds:finiteNumber(r.endSeconds,'reviewed source end',0,180)}
 if(sourceRange.endSeconds<=sourceRange.startSeconds||!Array.isArray(v.sourceCues)||v.sourceCues.length>100)throw new TypeError('Invalid reviewed source caption range.')
 let end=sourceRange.startSeconds
 const sourceCues=v.sourceCues.map(raw=>{const c=mediaRecord(raw);closed(c,['startSeconds','endSeconds','text','translationText','translationOrigin']);const startSeconds=finiteNumber(c.startSeconds,'bound source cue start',end,sourceRange.endSeconds),endSeconds=finiteNumber(c.endSeconds,'bound source cue end',startSeconds+.001,sourceRange.endSeconds)
  const text=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u0008]/.test(value))throw new TypeError('Invalid bound source text.');return value}
  if(c.translationOrigin!==undefined&&!['user-edited','agent-edited'].includes(String(c.translationOrigin)))throw new TypeError('Invalid bound translation origin.')
  end=endSeconds;return {startSeconds,endSeconds,text:text(c.text),...(c.translationText===undefined?{}:{translationText:typeof c.translationText==='string'&&c.translationText===''?'':text(c.translationText)}),...(c.translationOrigin===undefined?{}:{translationOrigin:c.translationOrigin as CaptionCue['translationOrigin']})}
 });return {sourceRange,sourceCues}
}
function sameSourceClock(a:string,b:string):boolean {const x=JSON.parse(a) as SourceClock,y=JSON.parse(b) as SourceClock;return x.id===y.id&&x.start===y.start&&x.rate===y.rate&&x.duration===y.duration}
interface SourceClock {id:string;start:number;rate:number;duration:number;offset:number;limit?:number}
function clock(scene:StudioScene,index:number):SourceClock {return {...JSON.parse(sourceCaptionClock(scene,index)),limit:scene.durationSeconds} as SourceClock}
function project(cues:CaptionCue[],c:SourceClock):CaptionCue[] {
 const end=c.start+c.duration*c.rate
 return cues.flatMap(cue=>{const a=Math.max(cue.startSeconds,c.start),b=Math.min(cue.endSeconds,end);const bound=(time:number)=>Math.max(c.offset,Math.min(c.limit??c.offset+c.duration,c.offset+c.duration,time));return b<=a?[]:[{...cue,startSeconds:bound(c.offset+(a-c.start)/c.rate),endSeconds:bound(c.offset+(b-c.start)/c.rate)}]})
}
function sameCues(a:CaptionCue[]|undefined,b:CaptionCue[]|undefined):boolean {return JSON.stringify(a??[])===JSON.stringify(b??[])}
/** Merge explicit current-caption edits back into trusted original-source seconds.
 * Hidden reviewed cues remain; clipping never invents word timestamps. */
function editedRoots(roots:CaptionCue[],c:SourceClock,previous:CaptionCue[],next:CaptionCue[]):CaptionCue[] {
 const visible=roots.flatMap((root,index)=>project([root],c).map(cue=>({root,index,cue}))),active=new Set(visible.map(v=>v.index)),kept=roots.filter((_,i)=>!active.has(i))
 const toSource=(time:number)=>c.start+(time-c.offset)*c.rate
 const replacement=next.map((cue,index)=>{
  const old=next.length===previous.length?visible[index]:visible.find(v=>v.cue.text===cue.text&&Math.abs(v.cue.startSeconds-cue.startSeconds)<.000001&&Math.abs(v.cue.endSeconds-cue.endSeconds)<.000001)
  return {...cue,startSeconds:old&&Math.abs(cue.startSeconds-old.cue.startSeconds)<.000001?old.root.startSeconds:toSource(cue.startSeconds),endSeconds:old&&Math.abs(cue.endSeconds-old.cue.endSeconds)<.000001?old.root.endSeconds:toSource(cue.endSeconds)}
 });return [...kept,...replacement].sort((a,b)=>a.startSeconds-b.startSeconds)
}
/** Closed trusted captions reproject only to the same identified Project source.
 * Combined unrelated caption/clock edits and unreviewed legacy extension fail. */
export function rebindSourceCaptions(previous:StudioScene,next:StudioScene,index:number):void {
 const binding=previous.sourceCaptionBinding;if(!binding||sourceCaptionsStale(previous))return
 const old=clock(previous,binding.segmentIndex),current=clock(next,index)
 if(old.id!==binding.sourceArtifactId||current.id!==binding.sourceArtifactId)return
 if((previous.captions??[]).some(cue=>cue.startSeconds<old.offset-.000001||cue.endSeconds>old.offset+old.duration+.000001)){if(sourceCaptionClock(previous,binding.segmentIndex)===sourceCaptionClock(next,index))return;throw new Error('STUDIO_SOURCE_REBIND_CONFLICT: 原字幕含独立时间范围，请先重新应用或解除原声关联。')}
 const sourceRange=binding.sourceRange??{startSeconds:old.start,endSeconds:old.start+old.duration*old.rate}
 if(current.start<sourceRange.startSeconds-.000001||current.start+current.duration*current.rate>sourceRange.endSeconds+.000001)throw new Error('STUDIO_SOURCE_CUES_REQUIRED: 新源区间超出已核对范围，请先重新应用原声字幕；原编辑保留。')
 const legacy=(previous.captions??[]).map(cue=>({...cue,startSeconds:old.start+(cue.startSeconds-old.offset)*old.rate,endSeconds:old.start+(cue.endSeconds-old.offset)*old.rate}))
 const roots=editedRoots(binding.sourceCues??legacy,old,project(binding.sourceCues??legacy,old),previous.captions??[])
 let updated=roots
 if(sourceCaptionClock(previous,binding.segmentIndex)!==sourceCaptionClock(next,index)){
  const expected=project(roots,current)
  if(!sameCues(next.captions,previous.captions)&&!sameCues(next.captions,expected))throw new Error('STUDIO_SOURCE_REBIND_CONFLICT: 请分别修改画面时间与字幕正文，避免混淆源时间；原编辑保留。')
  next.captions=expected
 }else if(!sameCues(next.captions,previous.captions))updated=editedRoots(roots,old,previous.captions??[],next.captions??[])
 next.sourceCaptionBinding=assertSourceCaptionBinding({...binding,segmentIndex:index,clock:sourceCaptionClock(next,index),sourceCues:updated,sourceRange,visualSegmentId:visualIdentity(next,index)})
}
/** Host-authored translation edits retain the same root cue record. */
export function syncSourceCaptionEdits(previous:StudioScene,next:StudioScene):void {
 const a=previous.sourceCaptionBinding,b=next.sourceCaptionBinding
 if(a&&b&&a.clock===b.clock&&a.sourceArtifactId===b.sourceArtifactId&&a.sourceSha256===b.sourceSha256&&sameCues(a.sourceCues,b.sourceCues)&&JSON.stringify(a.sourceRange)===JSON.stringify(b.sourceRange))rebindSourceCaptions(previous,next,b.segmentIndex)
}

export interface SourceScenePartition {scene:StudioScene;from:number;to:number;visualIndices:number[]}
/** Trusted whole-scene partition. Reviewed roots and hidden cues retain their
 * original source range; independent out-of-group captions stay independent. */
export function partitionSourceSpeech(previous:StudioScene,children:SourceScenePartition[]):void {
 const binding=previous.sourceCaptionBinding,candidate=previous.sourceSpeech
 if(binding&&sourceCaptionsStale(previous))throw new Error('STUDIO_SOURCE_SPEECH_STALE: 原声字幕绑定已过期，请先处理后再分割。')
 let roots:CaptionCue[]=[],sourceRange:SourceCaptionRange|undefined,old:SourceClock|undefined,independent:CaptionCue[]=[]
 if(binding){
  old=clock(previous,binding.segmentIndex);sourceRange=binding.sourceRange??{startSeconds:old.start,endSeconds:old.start+old.duration*old.rate}
  if(old.id!==binding.sourceArtifactId)throw new Error('STUDIO_SOURCE_SPEECH_STALE: 原声素材身份已变化。')
  const inside:CaptionCue[]=[]
  for(const cue of previous.captions??[]){if(cue.startSeconds>=old.offset-.000001&&cue.endSeconds<=old.offset+old.duration+.000001)inside.push(cue);else if(cue.endSeconds<=old.offset+.000001||cue.startSeconds>=old.offset+old.duration-.000001)independent.push(cue);else throw new Error('STUDIO_SOURCE_REBIND_CONFLICT: 独立字幕跨越原声片段边界，请先明确字幕关联。')}
  const legacy=inside.map(cue=>({...cue,startSeconds:old!.start+(cue.startSeconds-old!.offset)*old!.rate,endSeconds:old!.start+(cue.endSeconds-old!.offset)*old!.rate}))
  roots=editedRoots(binding.sourceCues??legacy,old,project(binding.sourceCues??legacy,old),inside)
 }
 const membership=(index:number,child:SourceScenePartition):number|undefined=>{
  const group=visualPlaybackGroup(previous,index),oldIndex=child.visualIndices.findIndex(i=>i>=group.index&&i<=group.endIndex)
  return oldIndex<0?undefined:visualPlaybackGroup(child.scene,oldIndex).index
 }
 for(const child of children){
  const scene=child.scene;delete scene.sourceSpeech;delete scene.sourceCaptionBinding
  if(candidate){const index=membership(candidate.segmentIndex,child);if(index!==undefined){if(sceneVisuals(scene)[index]?.videoArtifactId!==candidate.sourceArtifactId)throw new Error('STUDIO_SOURCE_SPEECH_STALE: 识别素材身份已变化。');scene.sourceSpeech={...candidate,segmentIndex:index}}}
  if(!binding)continue
  const index=membership(binding.segmentIndex,child)
  const other=independent.flatMap(cue=>{const a=Math.max(child.from,cue.startSeconds),b=Math.min(child.to,cue.endSeconds);return b>a?[{...cue,startSeconds:a-child.from,endSeconds:b-child.from}]:[]})
  if(index===undefined){scene.captions=other;continue}
  const current=clock(scene,index)
  if(current.id!==binding.sourceArtifactId||current.start<sourceRange!.startSeconds-.000001||current.start+current.duration*current.rate>sourceRange!.endSeconds+.000001)throw new Error('STUDIO_SOURCE_CUES_REQUIRED: 分割不能扩展已核对的原声范围。')
  const cues=[...project(roots,current),...other].sort((a,b)=>a.startSeconds-b.startSeconds)
  if(cues.length>100||cues.some((c,i)=>i>0&&c.startSeconds<cues[i-1].endSeconds-.000001))throw new Error('STUDIO_SOURCE_REBIND_CONFLICT: 分割后字幕交叠或超过一百条。')
  scene.captions=cues;scene.sourceCaptionBinding=assertSourceCaptionBinding({...binding,segmentIndex:index,clock:sourceCaptionClock(scene,index),visualSegmentId:visualIdentity(scene,index),sourceCues:roots,sourceRange})
 }
}
