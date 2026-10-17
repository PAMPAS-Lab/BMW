import {finiteNumber,mediaRecord} from './media-contract.js'
import {COMPOSITION_LIMITS} from './composition-limits.js'
import {estimatedCaptionCues} from './composition-contract.js'
import type {MediaComposition} from './composition-contract.js'
import {scenePlaybackClock} from './scene-playback-window.js'
import {sceneVisuals} from './visual-segments.js'
import {CONTEXT_READING} from './card-details.js'
import type {CanvasPaintRole} from './media/canvas-paint-role.js'

export const QUALITY_LIMITS=Object.freeze({sceneSamples:24,samples:576,issues:400,textsPerSample:256,phoneWidth:390,minimumPhoneText:12})
export interface QualitySample {sceneIndex:number;seconds:number;localSeconds:number;reasons:string[]}
export interface QualityPlan {samples:QualitySample[];omittedCandidates:number}
export interface PaintedText {text:string;x:number;y:number;width:number;height:number;fontPixels:number;role?:CanvasPaintRole;order?:number}
export interface PaintedBacking {x:number;y:number;width:number;height:number;order:number}
export interface QualityIssue {code:'text-outside-frame'|'phone-small-text'|'painted-text-overlap'|'long-static-hold'|'caption-background-overlap'|'caption-safe-area';severity:'error'|'warning';sceneIndex:number;seconds:number;message:string;text?:string}
export interface CompositionQuality {version:1;kind:'composition-quality';coverage:'critical-state-samples';phoneWidth:390;semanticVerification:'requires-visual-review';samples:QualitySample[];omittedCandidates:number;issues:QualityIssue[];omittedIssues:number;omittedTextObservations?:number}

/** Sample the same presentation/source clocks as the painter. Never describe a
 * bounded set of states as continuous or semantic verification. */
export function compositionQualityPlan(composition:MediaComposition,durations?:number[]):QualityPlan {
 const samples:QualitySample[]=[];let offset=0,omittedCandidates=0
 for(const [sceneIndex,scene] of composition.scenes.entries()){
  const candidates=new Map<number,{reasons:Set<string>;priority:number}>(),duration=scene.durationSeconds,clock=scenePlaybackClock(scene,sceneIndex,composition.scenes.length)
  const add=(local:number,reason:string,priority=1)=>{if(local<0||local>=duration)return;const frame=Math.min(Math.ceil((offset+duration)*composition.fps)-1,Math.max(Math.ceil(offset*composition.fps),Math.round((offset+local)*composition.fps))),time=frame/composition.fps-offset;if(time<0||time>=duration)return;const item=candidates.get(frame)??{reasons:new Set<string>(),priority};item.reasons.add(reason);item.priority=Math.max(item.priority,priority);candidates.set(frame,item)}
  const edge=(local:number,reason:string,priority=2)=>{add(local-1/composition.fps,reason+'-before',priority);add(local,reason,priority);add(local+1/composition.fps,reason+'-after',priority)}
  add(0,'scene-start',5);add(Math.max(0,duration-1/composition.fps),'scene-end',5);add(duration/2,'scene-middle',3);add(Math.min(.8,duration/2),'entrance-complete',3)
  for(const cue of scene.captions??estimatedCaptionCues(scene,composition.width,composition.height,durations?.[sceneIndex]??duration-1)){edge(cue.startSeconds,'caption-start');edge(cue.endSeconds,'caption-end');add((cue.startSeconds+cue.endSeconds)/2,'caption-middle',2)}
  for(const seconds of scene.bulletRevealSeconds??[])edge(seconds-clock.startSeconds,'bullet-reveal',3)
  for(const cue of scene.cardCues??[]){edge(cue.startSeconds-clock.startSeconds,'card-speech-start',4);edge(cue.endSeconds-clock.startSeconds,'card-speech-end',4);add((cue.startSeconds+cue.endSeconds)/2-clock.startSeconds,'card-speech-middle',4)}
  const card=scene.cardSpec
  if(card?.version===2){
   if('reading'in card&&card.reading?.mode==='whole-to-detail'&&card.reading.targets[0]?.lineCount){const cue=scene.cardCues?.find(c=>c.kind==='reading'&&c.index===0),start=cue?.startSeconds??0,end=cue?.endSeconds??clock.durationSeconds,span=end-start;for(const [fraction,reason]of [[CONTEXT_READING.locate,'reading-locate'],[CONTEXT_READING.zoom,'reading-zoom'],[CONTEXT_READING.detail,'reading-detail'],...(card.reading.returnToWhole?[[CONTEXT_READING.return,'reading-return']] as [number,string][]:[])] as [number,string][]){edge(start+fraction*span-clock.startSeconds,reason,4)}add(start+CONTEXT_READING.hold*span-clock.startSeconds,'reading-detail-hold',4)}
   if('highlights'in card)for(const h of card.highlights??[]){edge(h.startSeconds-clock.startSeconds,'highlight-start',3);edge(h.endSeconds-clock.startSeconds,'highlight-end',3)}
   if('quote'in card&&card.quote.display!=='simultaneous')edge(clock.durationSeconds/2-clock.startSeconds,'translation-reveal',3)
   if(card.templateId==='metric/backdrop'&&card.phase==='to-evidence')edge(card.holdSeconds-clock.startSeconds,'metric-to-evidence',3)
   if(card.templateId==='diagram/to-target'&&card.motion==='reveal-items')card.objects.forEach((_,i)=>edge(i*Math.min(1.2,clock.durationSeconds/4)-clock.startSeconds,'diagram-reveal',3))
  }
  let visualOffset=0
  for(const visual of sceneVisuals(scene)){
   edge(visualOffset,'visual-cut',3)
   const effect='effectWindow'in visual?visual.effectWindow:undefined,base=effect?.startSeconds??(scene.visualSegments?0:clock.startSeconds),span=effect?.durationSeconds??(scene.visualSegments?visual.durationSeconds:clock.durationSeconds)
   if(card?.version===2&&'reading'in card&&card.reading){const n=card.reading.mode==='detail-to-whole'?2:1+card.reading.targets.filter(t=>t.source.artifactId===visual.imageArtifactId).length+(card.reading.returnToWhole?1:0);for(let i=1;i<n;i++){edge(visualOffset+i*span/n-base,'reading-transition',3);add(visualOffset+i*span/n+.6-base,'reading-detail',4)}}
   for(const f of visual.focusIntervals??[]){const sourceStart=visual.videoArtifactId?visual.sourceStartSeconds:base,rate=visual.videoArtifactId?visual.playbackRate:1;const start=visualOffset+(f.startSeconds-sourceStart)/rate,end=visualOffset+(f.endSeconds-sourceStart)/rate;edge(start,'focus-start',3);add((start+end)/2,'focus-peak',4);edge(end,'focus-end',3)}
   visualOffset+=visual.durationSeconds
  }
  for(const [container,base] of [[scene,0],[composition,-offset]] as const)for(const layer of container.layers??[]){
   if(layer.hidden)continue
   const start=layer.startSeconds+base,end=start+layer.durationSeconds,inside=(at:number,reason:string,priority=3)=>{if(at>=start&&at<end)add(at,reason,priority)}
   edge(start,'layer-start',3);edge(end,'layer-end',3);for(const key of layer.keyframes??[])add(start+key.timeSeconds,'layer-keyframe',3)
   if(layer.science){const s=layer.science,root=start-s.offsetSeconds+s.delaySeconds;inside(root,'science-start');inside(root+s.durationSeconds/2,'science-middle',4);inside(root+s.durationSeconds,'science-complete')}
   if(layer.packaging){const p=layer.packaging,root=start-p.offsetSeconds;inside(root,'packaging-start');inside(root+p.introSeconds/2,'packaging-middle',4);inside(root+p.introSeconds,'packaging-complete')}
   if(layer.textTreatment&&layer.textTreatment.reveal!=='none'){
    const t=layer.textTreatment,root=start-t.offsetSeconds+t.delaySeconds
    inside(root,'text-reveal-start');inside(root+t.revealSeconds/2,'text-reveal-clock-middle',4);inside(root+t.revealSeconds,'text-reveal-clock-end')
    // Actual line wrapping belongs to the painter. These explicit-newline
    // candidates are estimates, not a claim to find every glyph/line boundary.
    for(let i=1;i<Math.min(16,(layer.text??'').split('\n').length);i++)inside(root+i*t.lineStaggerSeconds,'text-explicit-line-clock')
   }
  }
  const quota=Math.min(QUALITY_LIMITS.sceneSamples,Math.floor(QUALITY_LIMITS.samples/Math.max(1,composition.scenes.length)))
  const chosen=[...candidates].sort((a,b)=>b[1].priority-a[1].priority||a[0]-b[0]).slice(0,quota).sort((a,b)=>a[0]-b[0]);omittedCandidates+=candidates.size-chosen.length
  samples.push(...chosen.map(([frame,item])=>({sceneIndex,seconds:frame/composition.fps,localSeconds:frame/composition.fps-offset,reasons:[...item.reasons]})));offset+=duration
 }
 return {samples,omittedCandidates}
}
export function paintedTextIssues(texts:PaintedText[],width:number,height:number,sample:QualitySample,backings:PaintedBacking[]=[]):QualityIssue[]{
 const issues:QualityIssue[]=[],add=(code:QualityIssue['code'],severity:QualityIssue['severity'],message:string,text:string)=>issues.push({code,severity,sceneIndex:sample.sceneIndex,seconds:sample.seconds,message,text:text.slice(0,200)})
 for(const t of texts){if(t.x<-.5||t.y<-.5||t.x+t.width>width+.5||t.y+t.height>height+.5)add('text-outside-frame','error','实际绘制文字超出画面边界，请调整位置或版式。',t.text);if(t.fontPixels*QUALITY_LIMITS.phoneWidth/width<QUALITY_LIMITS.minimumPhoneText)add('phone-small-text','warning','文字在 390px 宽手机预览中小于 12px，请放大或节选。',t.text)}
 for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){const a=texts[i],b=texts[j];if(a.text===b.text&&a.role===b.role)continue;const protectedRoles=['attribution','footnote','watermark','counter'],captionCollision=a.role==='caption'&&protectedRoles.includes(b.role)||b.role==='caption'&&protectedRoles.includes(a.role),intersection=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));if(intersection>(captionCollision ? .02 : .25)*Math.min(a.width*a.height,b.width*b.height))add('painted-text-overlap','warning','实际绘制的两处文字相交，请检查字幕或图层遮挡。',a.text+' / '+b.text)}
 const overlap=(a:PaintedBacking,b:Pick<PaintedBacking,'x'|'y'|'width'|'height'>)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
 for(const [i,b]of backings.entries()){
  if(b.x<0||b.x+b.width>width||b.y<height*56/720-.5||b.y+b.height>height*686/720+.5)add('caption-safe-area','warning','字幕背景超出安全区域，请检查标题、底部水印及整块字幕位置。','字幕背景')
  for(const t of texts){if(t.role==='caption'&&t.order!==undefined&&t.order>b.order)continue;if(overlap(b,t)>Math.max(1,t.width*t.height*.02))add('caption-background-overlap','warning',t.role==='caption'?'后绘制的字幕背景遮挡了已绘制字幕，请先绘制完整背景再绘制文字。':'字幕背景与其他文字区域相交，请检查署名、脚注或水印。',t.text)}
  for(const previous of backings.slice(0,i))if(overlap(b,previous)>1)add('caption-background-overlap','warning','字幕背景相叠，半透明底色会重复叠加，请使用完整字幕块背景。','字幕背景')
 }
 return issues
}
/** Pixel observations are sparse. This warns about apparent static holds, not
 * frozen decoder playback or a semantic judgement of pacing. */
export class StaticHoldObserver {
 private previous?:{sample:QualitySample;pixels:Uint8ClampedArray};private start=0;private reported=false
 observe(sample:QualitySample,pixels:Uint8ClampedArray):QualityIssue|undefined {
  const previous=this.previous;this.previous={sample,pixels:new Uint8ClampedArray(pixels)}
  if(!previous||previous.sample.sceneIndex!==sample.sceneIndex||previous.pixels.length!==pixels.length){this.start=sample.seconds;this.reported=false;return}
  let difference=0;for(let i=0;i<pixels.length;i+=4)difference+=Math.abs(pixels[i]-previous.pixels[i])+Math.abs(pixels[i+1]-previous.pixels[i+1])+Math.abs(pixels[i+2]-previous.pixels[i+2])
  if(difference/(pixels.length/4*3)>1){this.start=sample.seconds;this.reported=false;return}
  if(!this.reported&&sample.seconds-this.start>=8){this.reported=true;return {code:'long-static-hold',severity:'warning',sceneIndex:sample.sceneIndex,seconds:sample.seconds,message:'抽样的主要画面区域连续八秒变化很少，请检查讲解节奏；这不证明中间每帧静止。'}}
 }
}
export function assertCompositionQuality(raw:unknown):CompositionQuality {
 const v=mediaRecord(raw)
 if(Object.keys(v).some(k=>!['version','kind','coverage','phoneWidth','semanticVerification','samples','omittedCandidates','issues','omittedIssues','omittedTextObservations'].includes(k))||v.version!==1||v.kind!=='composition-quality'||v.coverage!=='critical-state-samples'||v.phoneWidth!==390||v.semanticVerification!=='requires-visual-review'||!Array.isArray(v.samples)||v.samples.length>QUALITY_LIMITS.samples||!Array.isArray(v.issues)||v.issues.length>QUALITY_LIMITS.issues)throw new TypeError('Invalid composition quality report.')
 const samples=v.samples.map(raw=>{const s=mediaRecord(raw);if(Object.keys(s).some(k=>!['sceneIndex','seconds','localSeconds','reasons'].includes(k))||!Array.isArray(s.reasons)||!s.reasons.length||s.reasons.length>32||s.reasons.some(r=>typeof r!=='string'||!/^[a-z-]{1,50}$/.test(r)))throw new TypeError('Invalid quality sample.');return {sceneIndex:finiteNumber(s.sceneIndex,'quality scene',0,COMPOSITION_LIMITS.scenes-1,true),seconds:finiteNumber(s.seconds,'quality film time',0,COMPOSITION_LIMITS.seconds),localSeconds:finiteNumber(s.localSeconds,'quality local time',0,60),reasons:s.reasons as string[]}})
 const issues=v.issues.map(raw=>{const i=mediaRecord(raw);if(Object.keys(i).some(k=>!['code','severity','sceneIndex','seconds','message','text'].includes(k))||!['text-outside-frame','phone-small-text','painted-text-overlap','long-static-hold','caption-background-overlap','caption-safe-area'].includes(String(i.code))||!['error','warning'].includes(String(i.severity))||typeof i.message!=='string'||i.message.length>500||i.text!==undefined&&(typeof i.text!=='string'||i.text.length>200))throw new TypeError('Invalid quality issue.');return {...i,sceneIndex:finiteNumber(i.sceneIndex,'quality scene',0,COMPOSITION_LIMITS.scenes-1,true),seconds:finiteNumber(i.seconds,'quality issue time',0,COMPOSITION_LIMITS.seconds)} as unknown as QualityIssue})
 return {version:1,kind:'composition-quality',coverage:'critical-state-samples',phoneWidth:390,semanticVerification:'requires-visual-review',samples,omittedCandidates:finiteNumber(v.omittedCandidates,'omitted candidates',0,100000,true),issues,omittedIssues:finiteNumber(v.omittedIssues,'omitted issues',0,100000000,true),...(v.omittedTextObservations===undefined?{}:{omittedTextObservations:finiteNumber(v.omittedTextObservations,'omitted text observations',0,100000000,true)})}
}
