import {finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import {assertCaptionStyle,captionStyleSchema} from '../../media-native/src/composition-contract.js'
import type {CaptionStyle} from '../../media-native/src/composition-contract.js'
import type {VideoDraft} from './studio-contract.js'
export type StudioReviewTextField='title'|'narration'|'visualBrief'
export type StudioReviewField=StudioReviewTextField|'captionStyle'|'captionDisplay'
type CaptionDisplay='original'|'translation'|'bilingual'
type ProposalBase={sceneId:string;reason:string;seconds:number}
export type StudioReviewProposal=ProposalBase&({field:StudioReviewTextField;before:string;after:string}|{field:'captionStyle';before:CaptionStyle|null;after:CaptionStyle|null}|{field:'captionDisplay';before:CaptionDisplay|null;after:CaptionDisplay|null})
export type StudioReviewItem=StudioReviewProposal&{id:string;revision:number;createdAt:string;origin:'user'|'agent';status:'pending'|'adopted'|'dismissed'|'undone'}
const fields={title:44,narration:1000,visualBrief:2000} as const
const displayValues=['original','translation','bilingual'] as const
function closed(v:Record<string,unknown>,keys:readonly string[]):void{if(Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError('Unsupported review property.')}
function text(raw:unknown,max:number):string{if(typeof raw!=='string'||raw.length>max||/[\u0000-\u0008]/u.test(raw))throw new TypeError('Invalid review text.');return raw}
function id(raw:unknown):string{const value=text(raw,80);if(!/^[a-zA-Z0-9-]{1,80}$/u.test(value))throw new TypeError('Invalid review identity.');return value}
const proposalKeys=['sceneId','field','before','after','reason','seconds']
function display(raw:unknown):CaptionDisplay|null{if(raw===null)return null;if(typeof raw!=='string'||!displayValues.includes(raw as CaptionDisplay))throw new TypeError('Invalid review subtitle display.');return raw as CaptionDisplay}
function style(raw:unknown):CaptionStyle|null{return raw===null?null:assertCaptionStyle(raw)}
function sameStyle(a:CaptionStyle|null,b:CaptionStyle|null):boolean{return a===null||b===null?a===b:(['fontSize','color','background','position','align','offsetPercent'] as const).every(key=>a[key]===b[key])}
export function assertStudioReviewProposal(raw:unknown):StudioReviewProposal {
 const v=mediaRecord(raw);closed(v,proposalKeys)
 const base={sceneId:id(v.sceneId),reason:text(v.reason,1000),seconds:finiteNumber(v.seconds,'review scene time',0,60)}
 if(!base.reason.trim())throw new TypeError('Review requires a concrete change and reason.')
 if(v.field==='captionStyle'){const before=style(v.before),after=style(v.after);if(sameStyle(before,after))throw new TypeError('Review requires a concrete change and reason.');return {...base,field:v.field,before,after}}
 if(v.field==='captionDisplay'){const before=display(v.before),after=display(v.after);if(before===after)throw new TypeError('Review requires a concrete change and reason.');return {...base,field:v.field,before,after}}
 if(typeof v.field!=='string'||!Object.hasOwn(fields,v.field))throw new TypeError('Unsupported review field.')
 const field=v.field as StudioReviewTextField,before=text(v.before,fields[field]),after=text(v.after,fields[field])
 if(before===after||field==='title'&&!after.trim())throw new TypeError('Review requires a concrete change and reason.')
 return {...base,field,before,after}
}
export function assertStudioReviewItems(raw:unknown):StudioReviewItem[] {
 if(!Array.isArray(raw)||raw.length>40)throw new TypeError('At most forty saved review items.')
 const items=raw.map(raw=>{const v=mediaRecord(raw);closed(v,[...proposalKeys,'id','revision','createdAt','origin','status']);if(!['user','agent'].includes(String(v.origin))||!['pending','adopted','dismissed','undone'].includes(String(v.status)))throw new TypeError('Invalid review provenance or status.');return {...assertStudioReviewProposal(Object.fromEntries(proposalKeys.map(k=>[k,v[k]]))),id:id(v.id),revision:finiteNumber(v.revision,'review revision',1,1_000_000,true),createdAt:text(v.createdAt,40),origin:v.origin as StudioReviewItem['origin'],status:v.status as StudioReviewItem['status']}})
 if(new Set(items.map(i=>i.id)).size!==items.length)throw new TypeError('Duplicate review identity.');return items
}
/** Suggestion rationale is authored evidence, not a verified fact or transcript. */
export function studioReviewApplicable(draft:VideoDraft,item:StudioReviewProposal,undo=false):boolean {
 const scene=draft.scenes.find(s=>s.id===item.sceneId);if(!scene||item.seconds>=scene.durationSeconds)return false
 if(item.field==='captionStyle')return sameStyle(scene.captionStyle??null,undo?item.after:item.before)
 if(item.field==='captionDisplay')return (scene.captionDisplay??null)===(undo?item.after:item.before)
 return scene[item.field]===(undo?item.after:item.before)
}
/** Only the service's explicit user-adoption path calls this after its CAS check. */
export function applyStudioReview(draft:VideoDraft,item:StudioReviewProposal,undo=false):void{
 if(!studioReviewApplicable(draft,item,undo))throw new Error('STUDIO_REVIEW_STALE: 目标字段已变化。')
 const scene=draft.scenes.find(s=>s.id===item.sceneId)!
 if(item.field==='captionStyle'){const value=undo?item.before:item.after;if(value===null)delete scene.captionStyle;else scene.captionStyle=structuredClone(value)}
 else if(item.field==='captionDisplay'){const value=undo?item.before:item.after;if(value===null)delete scene.captionDisplay;else scene.captionDisplay=value}
 else scene[item.field]=undo?item.before:item.after
}
export function studioReviewValueLabel(item:StudioReviewProposal,side:'before'|'after'):string {
 if(item.field==='captionStyle'){const v=item[side];return v===null?'使用默认字幕样式':`字号 ${v.fontSize}px · 颜色 ${v.color} · 背景 ${{none:'无',outline:'描边',box:'色块'}[v.background]} · 位置 ${{top:'顶部',center:'中部',bottom:'底部'}[v.position]} · 对齐 ${{left:'左',center:'中',right:'右'}[v.align]} · 偏移 ${v.offsetPercent}%`}
 if(item.field==='captionDisplay'){const v=item[side];return v===null?'默认双语显示':({original:'只显示原文',translation:'只显示译文',bilingual:'双语显示'}[v])}
 return item[side]||'（空）'
}
const string={type:'string'},identity={type:'string',pattern:'^[a-zA-Z0-9-]{1,80}$'},nullableStyle={anyOf:[captionStyleSchema,{type:'null'}]},nullableDisplay={anyOf:[{enum:displayValues},{type:'null'}]}
export const studioReviewProposalSchema={type:'object',additionalProperties:false,required:proposalKeys,properties:{sceneId:identity,field:{enum:['title','narration','visualBrief','captionStyle','captionDisplay']},before:{},after:{},reason:{...string,minLength:1,maxLength:1000},seconds:{type:'number',minimum:0,maximum:60}},oneOf:[{properties:{field:{enum:['title','narration','visualBrief']},before:{...string,maxLength:2000},after:{...string,maxLength:2000}}},{properties:{field:{const:'captionStyle'},before:nullableStyle,after:nullableStyle}},{properties:{field:{const:'captionDisplay'},before:nullableDisplay,after:nullableDisplay}}]}
export const studioReviewItemsSchema={type:'array',maxItems:40,items:{...studioReviewProposalSchema,required:[...proposalKeys,'id','revision','createdAt','origin','status'],properties:{...studioReviewProposalSchema.properties,id:identity,revision:{type:'integer',minimum:1,maximum:1_000_000},createdAt:{...string,maxLength:40},origin:{enum:['user','agent']},status:{enum:['pending','adopted','dismissed','undone']}}}}
