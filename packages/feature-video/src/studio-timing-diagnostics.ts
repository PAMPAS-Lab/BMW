import {CONTEXT_READING} from '../../media-native/src/card-details.js'
import {narrationSceneRanges,scenePlaybackClock} from '../../media-native/src/composition-contract.js'
import {scriptSentences,speechBindingStale,speechScene} from './studio-speech-contract.js'
import {sceneCoverage} from './studio-contract.js'
import type {StudioScene} from './studio-contract.js'
import {cardSpeechTargets} from './studio-card-speech.js'
export const TIMING_LIMITS=Object.freeze({longSentenceUnits:56,longSentenceSeconds:9,readingUnitsPerSecond:9,minimumDetailSeconds:2,detailSecondsPerLine:1.2,longNodeSeconds:8,trailingHoldSeconds:4,issues:40})
export interface TimingAudioFacts {actualDurationSeconds?:number;audioState:'decoded'|'missing'|'unavailable'|'changed'|'saved-only';anchorState:'verified'|'stale'|'missing'|'saved-only';provenanceState:'verified'|'stale'|'not-required'|'unrecorded'}
export interface TimingDiagnosticIssue {code:'audio-not-current'|'timing-unrecorded'|'binding-stale'|'long-sentence'|'dense-sentence'|'uncovered-script'|'target-unbound'|'association-review'|'reading-window-short'|'reading-lines-missing'|'reading-partial-window'|'long-node-hold'|'diagram-window-overlap'|'trailing-hold';severity:'warning'|'info';message:string;seconds:number;anchorId?:string;targetIndex?:number}
const units=(text:string)=>Array.from(text.replace(/\s/g,'')).reduce((n,c)=>n+(/\p{Script=Han}/u.test(c)?1:.5),0)
/** Editorial heuristics over the same original clocks and card cues as the
 * painter. They never retime media, infer OCR or approve acoustic alignment. */
export function sceneTimingDiagnostics(scene:StudioScene,audio:TimingAudioFacts={audioState:'saved-only',anchorState:'saved-only',provenanceState:'unrecorded'}){
 const issues:TimingDiagnosticIssue[]=[];let omittedIssues=0
 const add=(issue:TimingDiagnosticIssue)=>{if(issues.length<TIMING_LIMITS.issues)issues.push(issue);else omittedIssues++}
 const binding=scene.speechAnchors,recordCurrent=Boolean(binding&&!speechBindingStale(scene,binding)&&!sceneCoverage(scene).audioStale),anchors=recordCurrent?binding!.anchors:[],targets=cardSpeechTargets(scene),links=scene.speechLinks?.cards??[],clock=scenePlaybackClock(scene,0,1)
 const provenance=binding?.timingProvenance
 if(scene.narration.trim()&&(!scene.audioArtifactId||sceneCoverage(scene).audioStale||audio.audioState==='unavailable'||audio.audioState==='changed'))add({code:'audio-not-current',severity:'warning',message:'先为当前脚本生成或核对实际旁白，再判断句级节奏；旧音频时间不能替代当前脚本。',seconds:0})
 if(!provenance)add({code:'timing-unrecorded',severity:'info',message:binding?'已保存作者编辑锚点，具体时间方法未记录；不会推定为声学精确对齐。':'尚无句锚点；可在实测旁白上检查编辑估算或原始 ASR，再明确选择时间来源。',seconds:0})
 if(audio.anchorState==='stale'||audio.provenanceState==='stale')add({code:'binding-stale',severity:'warning',message:'锚点或时间来源证据与实际文件不一致；请核对当前音频并显式重新绑定。',seconds:0})
 let derived:StudioScene|undefined
 try{derived=speechScene(scene)}catch(error){add({code:'binding-stale',severity:'warning',message:(error instanceof Error?error.message:String(error)).slice(0,400),seconds:0})}
 const inputs:{id:string;scriptStart:number;scriptEnd:number;text:string;startSeconds?:number;endSeconds?:number}[]=anchors.length?anchors.map(a=>({...a,text:scene.narration.slice(a.scriptStart,a.scriptEnd)})):scriptSentences(scene.narration)
 const sentences=inputs.map(s=>{
  const timed=s.startSeconds!==undefined&&s.endSeconds!==undefined,sourceRanges=timed?narrationSceneRanges(scene.speechPlaybackOrigin??scene,s.startSeconds,s.endSeconds):[],ranges=sourceRanges.flatMap(r=>{const startSeconds=Math.max(0,r.start-clock.startSeconds),endSeconds=Math.min(scene.durationSeconds,r.end-clock.startSeconds);return endSeconds>startSeconds?[{startSeconds,endSeconds}]:[]}),visibleSeconds=ranges.reduce((n,r)=>n+r.endSeconds-r.startSeconds,0),span=timed?sourceRanges.reduce((n,r)=>n+r.end-r.start,0):undefined,first=ranges[0]?.startSeconds??0,textUnits=units(s.text)
  if(textUnits>TIMING_LIMITS.longSentenceUnits||span!==undefined&&span>TIMING_LIMITS.longSentenceSeconds)add({code:'long-sentence',severity:'warning',anchorId:s.id,seconds:first,message:'此句较长，建议按完整论点拆句，并在对应句上改变图解重点；保留原意和完整音频。'})
  if(span!==undefined&&span>0&&textUnits/span>TIMING_LIMITS.readingUnitsPerSecond)add({code:'dense-sentence',severity:'warning',anchorId:s.id,seconds:first,message:'此句的文字量相对时间较密；核对字幕分句和停读时间，不要只缩小字号。'})
  return {id:s.id,scriptStart:s.scriptStart,scriptEnd:s.scriptEnd,textPreview:s.text.slice(0,80),textCharacters:s.text.length,textUnits,...(timed?{audioStartSeconds:s.startSeconds,audioEndSeconds:s.endSeconds}:{}),sceneRanges:ranges,presentationSeconds:span??null,visibleSeconds,targets:links.filter(l=>l.anchorId===s.id).flatMap(l=>{const t=targets.find(t=>t.kind===l.kind&&t.index===l.index);return t?[{kind:t.kind,index:t.index,label:t.label.slice(0,120)}]:[]})}
 })
 if(anchors.length){let cursor=0,uncovered=0;for(const a of anchors){uncovered+=scene.narration.slice(cursor,a.scriptStart).trim().length;cursor=a.scriptEnd}uncovered+=scene.narration.slice(cursor).trim().length;if(uncovered)add({code:'uncovered-script',severity:'warning',seconds:0,message:`有 ${uncovered} 个脚本文字未进入已保存句锚；请核对是否遗漏，而不是凭顺序补时间。`})}
 const unbound=targets.filter(t=>!links.some(l=>l.kind===t.kind&&l.index===t.index&&l.target===t.target&&l.templateId===t.templateId))
 if(unbound.length)add({code:'target-unbound',severity:'warning',seconds:0,message:`有 ${unbound.length} 个当前卡片目标没有有效句关联；检查内容后用 card.bind 或 correct-speech 的 cardLinks 明确绑定。`})
 if(links.length)add({code:'association-review',severity:'info',seconds:0,message:'目标和句锚的身份关联不证明语义正确；逐句检查当前高亮是否确实对应讲解内容。'})
 const reading=scene.cardSpec?.version===2&&'reading'in scene.cardSpec?scene.cardSpec.reading:undefined,readingWindows:{targetIndex:number;lineCount?:number;windowSeconds:number;detailVisibleSeconds:number;recommendedDetailSeconds?:number;phases:{name:string;startSeconds:number;endSeconds:number;visibleSeconds:number}[]}[]=[]
 if(reading?.mode==='whole-to-detail'&&derived)for(const [index,target]of reading.targets.entries()){
  const cue=derived?.cardCues?.find(c=>c.kind==='reading'&&c.index===index),start=cue?.startSeconds??0,end=cue?.endSeconds??clock.durationSeconds,span=end-start
  if(!target.lineCount){add({code:'reading-lines-missing',severity:'warning',targetIndex:index,seconds:Math.max(0,start-clock.startSeconds),message:'手机阅读尚未填写实际原文行数；先看原图计数，不能把目标名称当作 OCR 文本。'});continue}
  const stops=[0,CONTEXT_READING.locate,CONTEXT_READING.zoom,CONTEXT_READING.detail,...(reading.returnToWhole?[CONTEXT_READING.return]:[]),1],names=['context','locate','zoom','detail',...(reading.returnToWhole?['return']:[])],phases=names.map((name,i)=>{const startSeconds=start+span*stops[i]-clock.startSeconds,endSeconds=start+span*stops[i+1]-clock.startSeconds;return {name,startSeconds,endSeconds,visibleSeconds:Math.max(0,Math.min(scene.durationSeconds,endSeconds)-Math.max(0,startSeconds))}}),detail=phases.find(p=>p.name==='detail')!,recommended=Math.max(TIMING_LIMITS.minimumDetailSeconds,target.lineCount*TIMING_LIMITS.detailSecondsPerLine),visible=phases.reduce((n,p)=>n+p.visibleSeconds,0)
  readingWindows.push({targetIndex:index,lineCount:target.lineCount,windowSeconds:span,detailVisibleSeconds:detail.visibleSeconds,recommendedDetailSeconds:recommended,phases})
  const partial=visible>0&&visible<span-.001
  if(partial)add({code:'reading-partial-window',severity:'info',targetIndex:index,seconds:0,message:'此分镜只展示原阅读流程的局部；连同相邻分镜核对完整全貌、定位、放大、停读和返回，不要重启原有动画。'})
  else if(visible>0&&detail.visibleSeconds<recommended)add({code:'reading-window-short',severity:'warning',targetIndex:index,seconds:Math.max(0,detail.startSeconds),message:`完整原句的静止停读约 ${detail.visibleSeconds.toFixed(1)} 秒，低于当前 ${target.lineCount} 行的编辑策略 ${recommended.toFixed(1)} 秒；延长对应讲解窗口或选更短完整原句。`})
  if(!partial&&reading.returnToWhole&&scene.durationSeconds-(end-clock.startSeconds)>TIMING_LIMITS.trailingHoldSeconds)add({code:'trailing-hold',severity:'warning',targetIndex:index,seconds:Math.max(0,end-clock.startSeconds),message:'阅读返回全貌后还有较长停留；可把后续解释拆到对应图解，避免循环放大来掩盖静止。'})
 }
 for(const cue of derived?.cardCues??[])if(cue.kind==='diagram'){const visible=Math.max(0,Math.min(scene.durationSeconds,cue.endSeconds-clock.startSeconds)-Math.max(0,cue.startSeconds-clock.startSeconds));if(visible>TIMING_LIMITS.longNodeSeconds)add({code:'long-node-hold',severity:'warning',targetIndex:cue.index,seconds:Math.max(0,cue.startSeconds-clock.startSeconds),message:'同一图解节点连续强调较久；按完整短句组织论点，保留全图与已核对的节点关联。'})}
 const diagramCues=derived?.cardCues?.filter(c=>c.kind==='diagram')??[]
 if(scene.cardSpec?.templateId==='diagram/sequence')for(let i=0;i<diagramCues.length;i++)for(let j=i+1;j<diagramCues.length;j++){const start=Math.max(clock.startSeconds,diagramCues[i].startSeconds,diagramCues[j].startSeconds),end=Math.min(clock.startSeconds+scene.durationSeconds,diagramCues[i].endSeconds,diagramCues[j].endSeconds);if(end-start>.001)add({code:'diagram-window-overlap',severity:'warning',seconds:start-clock.startSeconds,message:'两个图解节点的强调窗口相交；当前全图一次突出一个节点，请按完整论点拆句并核对对应关系。'})}
 if(diagramCues.length){const last=Math.max(...diagramCues.map(c=>c.endSeconds))-clock.startSeconds;if(scene.durationSeconds-last>TIMING_LIMITS.trailingHoldSeconds)add({code:'trailing-hold',severity:'warning',seconds:Math.max(0,last),message:'图解最后一个已关联句结束后仍有较长停留；核对后续讲解是否应拆句、关联节点或切换论点。'})}
 return {sceneId:scene.id,audio,timing:{basis:provenance?.basis??'unrecorded',origin:binding?.origin??null,anchorState:audio.anchorState,provenanceState:audio.provenanceState,timeDomain:'audio-file-seconds',acousticWordTimingApproved:false},sentenceCount:sentences.length,targetCount:targets.length,linkedTargetCount:targets.length-unbound.length,requiresAssociationReview:true,requiresVisualReview:true,thresholdAuthority:'editorial-heuristics-not-acoustic-accuracy',thresholds:TIMING_LIMITS,readingWindows,sentences,issues,omittedIssues}
}
