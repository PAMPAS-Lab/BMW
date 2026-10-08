import {checkStudioSpeechOrigin} from './studio-speech-origin.js'
import {narrationSceneRanges} from '../../media-native/src/composition-contract.js'
import {assertArtifactId,finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {assertFocusIntervals,focusSourceTime} from '../../media-native/src/focus-contract.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import {speechSha} from '../../media-native/src/speech-contract.js'
import type {SpeechEvidence} from '../../media-native/src/speech-contract.js'
import type {StudioScene} from './studio-contract.js'
export interface SpeechBulletLink {anchorId:string;bulletIndex:number;text:string}
export interface SpeechFocusLink {anchorId:string;visualIndex:number;artifactId:string;x:number;y:number;zoom:number;emphasize:boolean}
export interface StudioSpeechLinks {bullets:SpeechBulletLink[];focus:SpeechFocusLink[]}
export interface SentenceAnchor {id:string;scriptStart:number;scriptEnd:number;startSeconds:number;endSeconds:number}
export interface SpeechBinding {scriptText:string;scriptSha256:string;audioArtifactId:string;audioSha256:string;durationSeconds:number;createdAt:string;capturedRevision:number;timeDomain:'audio-file-seconds'}
export interface StudioSpeechCandidate extends SpeechBinding {evidenceArtifactId:string;evidenceSha256:string}
export interface StudioSpeechAnchors extends SpeechBinding {origin:'user-edited'|'agent-edited';anchors:SentenceAnchor[]}
function closed(value:Record<string,unknown>,keys:readonly string[]){if(Object.keys(value).some(key=>!keys.includes(key)))throw new TypeError('Unsupported Studio speech property.')}
const bindingKeys=['scriptText','scriptSha256','audioArtifactId','audioSha256','durationSeconds','createdAt','capturedRevision','timeDomain']
function binding(value:Record<string,unknown>):SpeechBinding {
 if(typeof value.scriptText!=='string'||!value.scriptText.trim()||value.scriptText.length>1000||/[\u0000-\u0008]/.test(value.scriptText)||value.timeDomain!=='audio-file-seconds'||typeof value.createdAt!=='string'||value.createdAt.length>40||!Number.isFinite(Date.parse(value.createdAt)))throw new TypeError('Invalid Studio speech binding.')
 return {scriptText:value.scriptText,scriptSha256:speechSha(value.scriptSha256),audioArtifactId:assertArtifactId(value.audioArtifactId),audioSha256:speechSha(value.audioSha256),durationSeconds:finiteNumber(value.durationSeconds,'speech duration',.01,180),createdAt:value.createdAt,capturedRevision:finiteNumber(value.capturedRevision,'speech revision',1,1_000_000,true),timeDomain:'audio-file-seconds'}
}
export function assertSentenceAnchors(raw:unknown,script?:string,duration=180):SentenceAnchor[]{
 if(!Array.isArray(raw)||raw.length>100)throw new TypeError('At most one hundred sentence anchors.')
 const ids=new Set<string>();let previousEnd=0,previousCharacter=0
 return raw.map(raw=>{const v=mediaRecord(raw);closed(v,['id','scriptStart','scriptEnd','startSeconds','endSeconds'])
  if(typeof v.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.id)||ids.has(v.id))throw new TypeError('Invalid or duplicate sentence anchor identity.');ids.add(v.id)
  const scriptStart=finiteNumber(v.scriptStart,'script start UTF16',0,script?.length??1000,true),scriptEnd=finiteNumber(v.scriptEnd,'script end UTF16',scriptStart+1,script?.length??1000,true)
  const startSeconds=finiteNumber(v.startSeconds,'anchor start',previousEnd,duration),endSeconds=finiteNumber(v.endSeconds,'anchor end',startSeconds+.001,duration)
  if(scriptStart<previousCharacter||scriptEnd-scriptStart>200)throw new TypeError('Sentence spans must be ordered, nonoverlapping and at most 200 UTF16 units.')
  if(script){const split=(offset:number)=>offset>0&&offset<script.length&&/[\uD800-\uDBFF]/.test(script[offset-1])&&/[\uDC00-\uDFFF]/.test(script[offset]);if(split(scriptStart)||split(scriptEnd)||!script.slice(scriptStart,scriptEnd).trim())throw new TypeError('Sentence span splits a Unicode character or is empty.')}
  previousEnd=endSeconds;previousCharacter=scriptEnd;return {id:v.id,scriptStart,scriptEnd,startSeconds,endSeconds}
 })
}
export function assertStudioSpeechCandidate(raw:unknown):StudioSpeechCandidate {const v=mediaRecord(raw);closed(v,[...bindingKeys,'evidenceArtifactId','evidenceSha256']);return {...binding(v),evidenceArtifactId:assertArtifactId(v.evidenceArtifactId),evidenceSha256:speechSha(v.evidenceSha256)}}
export function assertStudioSpeechAnchors(raw:unknown):StudioSpeechAnchors {const v=mediaRecord(raw);closed(v,[...bindingKeys,'origin','anchors']);if(v.origin!=='user-edited'&&v.origin!=='agent-edited')throw new TypeError('Invalid sentence edit provenance.');const b=binding(v);return {...b,origin:v.origin,anchors:assertSentenceAnchors(v.anchors,b.scriptText,b.durationSeconds)}}
export function speechBindingStale(scene:StudioScene,value:SpeechBinding|undefined):boolean {return !value||value.scriptText!==scene.narration||value.audioArtifactId!==scene.audioArtifactId||scene.audioText!==scene.narration}
export function usesSpeechCaptions(scene:StudioScene):boolean{return scene.speechCaptions===true&&scene.captions===undefined}
/** Manual timestamps refer to the original voice file. Playback projects through explicit voice timing; visual speed does not retime it. */
export function speechCaptionCues(scene:StudioScene):NonNullable<StudioScene['captions']>{
 checkStudioSpeechOrigin(scene)
 const value=scene.speechAnchors
 if(speechBindingStale(scene,value)||!value?.anchors.length)throw new Error('STUDIO_SPEECH_STALE: 句锚点缺失或已过期，请重新校正或关闭锚点字幕。')
 const cues=value.anchors.flatMap(a=>narrationSceneRanges(scene,a.startSeconds,a.endSeconds).map(range=>({startSeconds:range.start,endSeconds:range.end,text:scene.narration.slice(a.scriptStart,a.scriptEnd)}))).sort((a,b)=>a.startSeconds-b.startSeconds)
 if(cues.length>100||cues.some(c=>c.endSeconds>scene.durationSeconds))throw new Error('STUDIO_SPEECH_RANGE: 句锚点超过镜头时间或字幕预算。')
 return cues
}
export function assertStudioSpeechLinks(raw:unknown):StudioSpeechLinks {
 const v=mediaRecord(raw);closed(v,['bullets','focus'])
 if(!Array.isArray(v.bullets)||v.bullets.length>3||!Array.isArray(v.focus)||v.focus.length>24)throw new TypeError('At most three bullet links and 24 focus links per scene.')
 const identity=(raw:unknown)=>{if(typeof raw!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(raw))throw new TypeError('Invalid speech anchor reference.');return raw},indices=new Set<number>(),targets=new Set<string>()
 const bullets=v.bullets.map(raw=>{const b=mediaRecord(raw);closed(b,['anchorId','bulletIndex','text']);const bulletIndex=finiteNumber(b.bulletIndex,'bullet index',0,2,true)
  if(indices.has(bulletIndex)||typeof b.text!=='string'||!b.text.trim()||b.text.length>64||/[\u0000-\u0008]/.test(b.text))throw new TypeError('Invalid or duplicate bullet reference.');indices.add(bulletIndex)
  return {anchorId:identity(b.anchorId),bulletIndex,text:b.text}
 })
 const focus=v.focus.map(raw=>{const f=mediaRecord(raw);closed(f,['anchorId','visualIndex','artifactId','x','y','zoom','emphasize']);const anchorId=identity(f.anchorId),visualIndex=finiteNumber(f.visualIndex,'visual index',0,7,true),key=anchorId+':'+visualIndex
  if(targets.has(key)||typeof f.emphasize!=='boolean')throw new TypeError('Invalid or duplicate focus reference.');targets.add(key)
  return {anchorId,visualIndex,artifactId:assertArtifactId(f.artifactId),x:finiteNumber(f.x,'focus x',0,1),y:finiteNumber(f.y,'focus y',0,1),zoom:finiteNumber(f.zoom,'focus zoom',1,4),emphasize:f.emphasize}
 })
 return {bullets,focus}
}
export function usesStudioSpeech(scene:StudioScene):boolean {return usesSpeechCaptions(scene)||Boolean(scene.speechLinks?.bullets.length||scene.speechLinks?.focus.length)}
/** One projection for GUI, preview and native export. References never adopt a changed target. */
export function speechScene(scene:StudioScene):StudioScene {
 if(!usesStudioSpeech(scene))return scene
 checkStudioSpeechOrigin(scene)
 const cues=usesSpeechCaptions(scene)?speechCaptionCues(scene):undefined,links=scene.speechLinks
 if(!links?.bullets.length&&!links?.focus.length)return {...scene,captions:cues}
 const binding=scene.speechAnchors
 if(speechBindingStale(scene,binding)||!binding?.anchors.length)throw new Error('STUDIO_SPEECH_STALE: 强调或板书引用的句锚点已过期，请重新校正或解除引用。')
 const range=(id:string,originalClock=false)=>{const anchor=binding.anchors.find(a=>a.id===id);if(!anchor)throw new Error('STUDIO_SPEECH_REFERENCE: 引用的句锚点已删除，请重新选择。');const origin=scene.speechPlaybackOrigin,offset=origin?scene.presentationWindow!.startSeconds:0,ranges=narrationSceneRanges(origin??scene,anchor.startSeconds,anchor.endSeconds);if(!ranges.length||ranges.some(r=>r.end>(origin?scene.presentationWindow!.durationSeconds:scene.durationSeconds)))throw new Error('STUDIO_SPEECH_RANGE: 引用的句锚点已不在播放片段内，请重新绑定或解除引用。');return originalClock?ranges:ranges.map(r=>({...r,start:r.start-offset,end:r.end-offset}))}
 const result={...scene,...(cues?{captions:cues}:{} )},visuals=sceneVisuals(scene)
 if(links.bullets.length){
  if(visuals.length)throw new Error('STUDIO_SPEECH_REFERENCE: 板书揭示用于无画面素材的标题卡，请解除画面或板书引用。')
  result.bulletRevealSeconds=scene.bullets.map(()=>0)
  for(const link of links.bullets){if(scene.bullets[link.bulletIndex]!==link.text)throw new Error('STUDIO_SPEECH_REFERENCE: 板书条目已修改或移除，请重新绑定。');result.bulletRevealSeconds[link.bulletIndex]=range(link.anchorId,true)[0].start}
 }
 if(links.focus.length){
  const projected=visuals.map(v=>({...v,focusIntervals:[...(v.focusIntervals??[])]}));let visualStart=0
  for(const [index,visual] of projected.entries()){
   for(const link of links.focus.filter(f=>f.visualIndex===index)){
    if(link.artifactId!==(visual.imageArtifactId??visual.videoArtifactId))throw new Error('STUDIO_SPEECH_REFERENCE: 强调画面已替换，请重新绑定素材。')
    for(const {start,end} of range(link.anchorId)){
    const window='effectWindow' in visual?visual.effectWindow:undefined,rootStart=visualStart-(window?.startSeconds??0),rootEnd=rootStart+(window?.durationSeconds??visual.durationSeconds)
    if(start<rootStart-.000001||end>rootEnd+.000001)throw new Error('STUDIO_SPEECH_RANGE: 句区间跨越画面边界，请调整分段或句锚点。')
    const crop=visual.crop??{x:0,y:0,width:1,height:1}
    if(link.x<crop.x||link.x>crop.x+crop.width||link.y<crop.y||link.y>crop.y+crop.height)throw new Error('STUDIO_SPEECH_RANGE: 强调目标位于当前裁切之外，请调整位置或裁切。')
    if(end<=visualStart||start>=visualStart+visual.durationSeconds)continue
    const rootVisual={...visual,effectWindow:undefined,sourceStartSeconds:visual.videoArtifactId?visual.sourceStartSeconds-(window?.startSeconds??0)*visual.playbackRate:0}
    visual.focusIntervals.push({startSeconds:focusSourceTime(rootVisual,start-rootStart),endSeconds:focusSourceTime(rootVisual,end-rootStart),x:link.x,y:link.y,zoom:link.zoom,emphasize:link.emphasize})
   }
   }
   visual.focusIntervals.sort((a,b)=>a.startSeconds-b.startSeconds)
   try{visual.focusIntervals=assertFocusIntervals(visual.focusIntervals)}catch(error){throw new Error('STUDIO_SPEECH_FOCUS: 强调与独立焦点重叠、超预算或源时间不足 100ms。'+(error instanceof Error?error.message:String(error)))}
   visualStart+=visual.durationSeconds
  }
  if(links.focus.some(f=>!projected[f.visualIndex]))throw new Error('STUDIO_SPEECH_REFERENCE: 引用的画面片段已移除，请重新绑定。')
  if(scene.visualSegments)result.visualSegments=scene.visualSegments.map((v,i)=>({...v,focusIntervals:projected[i].focusIntervals}))
  else result.focusIntervals=projected[0].focusIntervals
 }
 return result
}
export function scriptSentences(script:string):{id:string;scriptStart:number;scriptEnd:number;text:string}[]{
 const result:{id:string;scriptStart:number;scriptEnd:number;text:string}[]=[]
 for(const match of script.matchAll(/[^。！？!?\n]+[。！？!?]?/g)){let start=match.index!,end=start+match[0].length;while(start<end&&/\s/.test(script[start]))start++;while(end>start&&/\s/.test(script[end-1]))end--;if(end>start)result.push({id:'sentence-'+(result.length+1),scriptStart:start,scriptEnd:end,text:script.slice(start,end)})}
 return result
}
/** Never split an ASR paragraph or stretch its timestamps to fit script sentences. */
export function sentenceSuggestions(script:string,evidence:SpeechEvidence):{sentenceId:string;segmentId:string;startSeconds:number;endSeconds:number;tokenMeanProbability:number|null}[]{
 const normalized=(text:string)=>text.replace(/[\s。！？!?，,；;、]/g,'').toLocaleLowerCase(),sentences=scriptSentences(script)
 return sentences.flatMap(sentence=>{const matches=evidence.segments.filter(segment=>segment.usable&&normalized(segment.text)===normalized(sentence.text));if(matches.length!==1||sentences.filter(s=>normalized(s.text)===normalized(sentence.text)).length!==1)return [];const segment=matches[0];return [{sentenceId:sentence.id,segmentId:segment.id,startSeconds:segment.startSeconds,endSeconds:segment.endSeconds,tokenMeanProbability:segment.tokenMeanProbability}]})
}
const string={type:'string'},sha={type:'string',pattern:'^[a-f0-9]{64}$'}
export const sentenceAnchorsSchema={type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['id','scriptStart','scriptEnd','startSeconds','endSeconds'],properties:{id:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},scriptStart:{type:'integer',minimum:0,maximum:1000},scriptEnd:{type:'integer',minimum:1,maximum:1000},startSeconds:{type:'number',minimum:0,maximum:180},endSeconds:{type:'number',minimum:0,maximum:180}}}}
const properties={scriptText:{type:'string',maxLength:1000},scriptSha256:sha,audioArtifactId:string,audioSha256:sha,durationSeconds:{type:'number',minimum:.01,maximum:180},createdAt:string,capturedRevision:{type:'integer',minimum:1},timeDomain:{const:'audio-file-seconds'}}
export const studioSpeechCandidateSchema={type:'object',additionalProperties:false,required:[...bindingKeys,'evidenceArtifactId','evidenceSha256'],properties:{...properties,evidenceArtifactId:string,evidenceSha256:sha}}
export const studioSpeechAnchorsSchema={type:'object',additionalProperties:false,required:[...bindingKeys,'origin','anchors'],properties:{...properties,origin:{enum:['user-edited','agent-edited']},anchors:sentenceAnchorsSchema}}

const anchorReference={type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'}
export const studioSpeechLinksSchema={type:'object',additionalProperties:false,required:['bullets','focus'],properties:{
 bullets:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['anchorId','bulletIndex','text'],properties:{anchorId:anchorReference,bulletIndex:{type:'integer',minimum:0,maximum:2},text:{type:'string',minLength:1,maxLength:64}}}},
 focus:{type:'array',maxItems:24,items:{type:'object',additionalProperties:false,required:['anchorId','visualIndex','artifactId','x','y','zoom','emphasize'],properties:{anchorId:anchorReference,visualIndex:{type:'integer',minimum:0,maximum:7},artifactId:string,x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1},zoom:{type:'number',minimum:1,maximum:4},emphasize:{type:'boolean'}}}}
}}
