import {finiteNumber,mediaRecord} from './media-contract.js'
import type {CardSpec} from './card-templates.js'
export type CardCueKind='reading'|'highlight'|'diagram'|'metric'|'keyword'
/** Host-derived original presentation seconds. Studio persists references,
 * never this second editable timeline. */
export interface CardCue {kind:CardCueKind;index:number;startSeconds:number;endSeconds:number}
export function assertCardCues(raw:unknown):CardCue[]{
 if(!Array.isArray(raw)||raw.length>12)throw new TypeError('At most twelve derived card cues.')
 const used=new Set<string>()
 return raw.map(raw=>{const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['kind','index','startSeconds','endSeconds'].includes(k))||!['reading','highlight','diagram','metric','keyword'].includes(String(v.kind)))throw new TypeError('Unsupported derived card cue.');const kind=v.kind as CardCueKind,index=finiteNumber(v.index,'card target index',0,3,true),key=kind+':'+index,startSeconds=finiteNumber(v.startSeconds,'card cue start',0,60),endSeconds=finiteNumber(v.endSeconds,'card cue end',startSeconds+.001,60);if(used.has(key))throw new TypeError('Duplicate derived card cue.');used.add(key);return {kind,index,startSeconds,endSeconds}})
}
export function assertCardCueTargets(spec:CardSpec|undefined,cues:CardCue[]|undefined,duration:number):void {
 if(!cues?.length)return
 if(spec?.version!==2)throw new TypeError('Card cues require detailed cards.')
 for(const cue of cues){const count=cue.kind==='reading'&&'reading'in spec?spec.reading?.targets.length??0:cue.kind==='highlight'&&'highlights'in spec?spec.highlights?.length??0:cue.kind==='diagram'&&spec.templateId==='diagram/to-target'?spec.objects.length+1:cue.kind==='diagram'&&spec.templateId==='diagram/sequence'?spec.nodes.length:cue.kind==='metric'&&spec.templateId==='metric/backdrop'||cue.kind==='keyword'&&spec.templateId==='title/emphasis'?1:0;if(cue.index>=count||cue.endSeconds>duration)throw new TypeError('Card cue does not match its target or original presentation clock.')}
}
