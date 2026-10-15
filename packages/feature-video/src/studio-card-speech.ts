import {finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import type {CardCueKind} from '../../media-native/src/card-cues.js'
import type {StudioScene} from './studio-contract.js'
export interface CardSpeechTarget {kind:CardCueKind;index:number;templateId:string;target:string;label:string}
export type CardSpeechLink=Omit<CardSpeechTarget,'label'>&{anchorId:string}
export type CardSpeechChoice=Pick<CardSpeechLink,'kind'|'index'|'anchorId'>
export const cardSpeechChoicesSchema={type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['kind','index','anchorId'],properties:{kind:{enum:['reading','highlight','diagram','metric','keyword']},index:{type:'integer',minimum:0,maximum:3},anchorId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'}}}}
export function assertCardSpeechChoices(raw:unknown):CardSpeechChoice[]{if(!Array.isArray(raw)||raw.length>12)throw new TypeError('At most twelve card choices.');const seen=new Set<string>();return raw.map(raw=>{const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['kind','index','anchorId'].includes(k))||!['reading','highlight','diagram','metric','keyword'].includes(String(v.kind))||typeof v.anchorId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.anchorId))throw new TypeError('Invalid card choice.');const kind=v.kind as CardSpeechChoice['kind'],index=finiteNumber(v.index,'card index',0,3,true),key=kind+':'+index;if(seen.has(key))throw new TypeError('Duplicate card choice.');seen.add(key);return {kind,index,anchorId:v.anchorId}})}
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,value])=>value!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,canonical(value)])):v
/** Readable bounded snapshots bind exact slots, source hashes, rectangles and
 * labels, independent of caller object-key order. Changed slots stay stale. */
export function cardSpeechTargets(scene:StudioScene):CardSpeechTarget[]{
 const spec=scene.cardSpec;if(!spec||spec.version!==2)return []
 const targets:CardSpeechTarget[]=[],add=(kind:CardCueKind,index:number,target:unknown,label:string)=>targets.push({kind,index,templateId:spec.templateId,target:JSON.stringify(canonical(target)),label})
 if('reading'in spec)spec.reading?.targets.forEach((t,i)=>add('reading',i,{mode:spec.reading!.mode,returnToWhole:spec.reading!.returnToWhole,...t},'阅读 · '+t.name))
 if('highlights'in spec)spec.highlights?.forEach((h,i)=>{const {startSeconds,endSeconds,...identity}=h;add('highlight',i,identity,'重点 · '+h.name)})
 if(spec.templateId==='diagram/to-target')[...spec.objects,spec.target].forEach((n,i)=>add('diagram',i,n,(i===spec.objects.length?'目标 · ':'对象 · ')+n.label))
 if(spec.templateId==='diagram/sequence')spec.nodes.forEach((n,i)=>add('diagram',i,{...n,shape:spec.shape,footnote:spec.footnote},'步骤 '+(i+1)+' · '+n.label))
 if(spec.templateId==='metric/backdrop')add('metric',0,{value:spec.value,decimals:spec.decimals,unit:spec.unit,phase:spec.phase},'数字 · '+spec.value+spec.unit)
 if(spec.templateId==='title/emphasis')add('keyword',0,{title:scene.title,bullets:scene.bullets},'关键词 · '+scene.title)
 return targets
}
export function assertCardSpeechLinks(raw:unknown):CardSpeechLink[]{
 if(!Array.isArray(raw)||raw.length>12)throw new TypeError('At most twelve card speech references.')
 const used=new Set<string>()
 return raw.map(raw=>{const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['kind','index','templateId','target','anchorId'].includes(k))||!['reading','highlight','diagram','metric','keyword'].includes(String(v.kind))||typeof v.templateId!=='string'||v.templateId.length>40||typeof v.target!=='string'||!v.target.length||v.target.length>2048||typeof v.anchorId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.anchorId))throw new TypeError('Invalid card speech reference.');const index=finiteNumber(v.index,'card speech index',0,3,true),key=String(v.kind)+':'+index;if(used.has(key))throw new TypeError('Duplicate card speech target.');used.add(key);return {kind:v.kind as CardCueKind,index,templateId:v.templateId,target:v.target,anchorId:v.anchorId}})
}
export function remapCardSpeechLinks(scene:StudioScene):void {
 if(!scene.speechLinks?.cards)return
 const targets=cardSpeechTargets(scene)
 scene.speechLinks.cards=scene.speechLinks.cards.flatMap(link=>{const target=targets.find(t=>t.kind===link.kind&&t.templateId===link.templateId&&t.target===link.target);return target?[{...link,index:target.index}]:[]})
}
export const cardSpeechLinksSchema={type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['kind','index','templateId','target','anchorId'],properties:{kind:{enum:['reading','highlight','diagram','metric','keyword']},index:{type:'integer',minimum:0,maximum:3},templateId:{type:'string',maxLength:40},target:{type:'string',minLength:1,maxLength:2048},anchorId:{type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'}}}}
