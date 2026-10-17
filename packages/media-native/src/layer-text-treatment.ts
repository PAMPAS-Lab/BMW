import {finiteNumber,mediaRecord} from './media-contract.js'

/** Closed, seek-safe text timing. Offset preserves the original clock after cuts. */
export interface LayerTextTreatment {
 reveal:'none'|'grapheme'|'line'
 delaySeconds:number
 revealSeconds:number
 lineStaggerSeconds:number
 offsetSeconds:number
 strokeWidth:number
 strokeColor:string
}
export const DEFAULT_TEXT_TREATMENT:Readonly<LayerTextTreatment>={reveal:'none',delaySeconds:0,revealSeconds:1,lineStaggerSeconds:0,offsetSeconds:0,strokeWidth:0,strokeColor:'#000000'}
export const layerTextTreatmentSchema={type:'object',additionalProperties:false,properties:{reveal:{enum:['none','grapheme','line']},delaySeconds:{type:'number',minimum:0,maximum:720},revealSeconds:{type:'number',minimum:.01,maximum:720},lineStaggerSeconds:{type:'number',minimum:0,maximum:60},offsetSeconds:{type:'number',minimum:0,maximum:720},strokeWidth:{type:'number',minimum:0,maximum:8},strokeColor:{type:'string',pattern:'^#[a-fA-F0-9]{6}$'}}}
export function assertLayerTextTreatment(raw:unknown):LayerTextTreatment {
 const v=mediaRecord(raw),d=DEFAULT_TEXT_TREATMENT
 if(Object.keys(v).some(k=>!Object.hasOwn(d,k)))throw new TypeError('Unsupported text treatment field.')
 const reveal=(v.reveal===undefined?d.reveal:v.reveal),strokeColor=(v.strokeColor===undefined?d.strokeColor:v.strokeColor)
 if(!['none','grapheme','line'].includes(String(reveal)))throw new TypeError('Invalid text reveal.')
 if(typeof strokeColor!=='string'||!/^#[a-fA-F0-9]{6}$/.test(strokeColor))throw new TypeError('Text stroke requires opaque hex.')
 return {reveal:reveal as LayerTextTreatment['reveal'],delaySeconds:finiteNumber((v.delaySeconds===undefined?d.delaySeconds:v.delaySeconds),'text delay',0,720),revealSeconds:finiteNumber((v.revealSeconds===undefined?d.revealSeconds:v.revealSeconds),'text reveal duration',.01,720),lineStaggerSeconds:finiteNumber((v.lineStaggerSeconds===undefined?d.lineStaggerSeconds:v.lineStaggerSeconds),'text line stagger',0,60),offsetSeconds:finiteNumber((v.offsetSeconds===undefined?d.offsetSeconds:v.offsetSeconds),'text original clock',0,720),strokeWidth:finiteNumber((v.strokeWidth===undefined?d.strokeWidth:v.strokeWidth),'text stroke',0,8),strokeColor}
}
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'})
export const textGraphemes=(text:string):string[]=>Array.from(segmenter.segment(text),v=>v.segment)
/** Layout uses the complete lines first; hidden glyphs never change wrapping or size. */
export function revealedTextLines(lines:readonly string[],treatment:LayerTextTreatment|undefined,local:number):string[]{
 if(!treatment)return [...lines]
 const t=local+treatment.offsetSeconds-treatment.delaySeconds,parts=lines.map(textGraphemes),total=Math.max(1,parts.reduce((sum,line)=>sum+line.length,0));let preceding=0
 return parts.map((line,index)=>{
  const start=(treatment.reveal==='none'?0:index*treatment.lineStaggerSeconds)+(treatment.reveal==='grapheme'?preceding/total*treatment.revealSeconds:0)
  preceding+=line.length
  if(t<start)return ''
  if(treatment.reveal!=='grapheme')return line.join('')
  const duration=line.length/total*treatment.revealSeconds,progress=duration?Math.max(0,Math.min(1,(t-start)/duration)):1
  return line.slice(0,Math.min(line.length,Math.floor(progress*line.length+1e-9))).join('')
 })
}
