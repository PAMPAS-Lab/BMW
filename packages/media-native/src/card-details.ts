import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'

export interface SourcePin {artifactId:string;sha256:string}
export interface SourceRect {x:number;y:number;width:number;height:number}
export interface ReadingTarget {source:SourcePin;rect:SourceRect;name:string}
export interface CardReading {mode:'whole-to-detail'|'detail-to-whole'|'sequence';targets:ReadingTarget[];returnToWhole:boolean}
export interface CardHighlight {source:SourcePin;name:string;rects:SourceRect[];style:'outline'|'fill'|'invert';startSeconds:number;endSeconds:number}
export interface EvidenceDetails {reading?:CardReading;highlights?:CardHighlight[]}
export interface QuoteDetails {excerpt:string;translation:string;attribution:string;display:'simultaneous'|'staged'}
export interface CardPerson {artifactId?:string;name:string;role:string;layout:'right'|'corner'}
export interface DiagramNode {label:string;imageArtifactId?:string}
export type CardRange={mode:'numeric';axisLabel:string;minimum:number;maximum:number;start:number;end:number;thresholds:number[];unit:string;condition:string}|{mode:'symbolic';axisLabel:string;regionLabel:string;thresholdLabels:string[];condition:string}
export type DetailedCardSpec=
 |({version:2;templateId:'evidence/reading'|'evidence/highlight'|'diagram/image';motion?:'none'}&EvidenceDetails)
 |({version:2;templateId:'evidence/translation';motion?:'none';quote:QuoteDetails}&EvidenceDetails)
 |({version:2;templateId:'evidence/person-quote';motion?:'none';quote:QuoteDetails;person:CardPerson}&EvidenceDetails)
 |{version:2;templateId:'metric/backdrop';motion?:'none'|'fade-in'|'count-up';value:number;decimals:0|1|2;unit:string;phase:'hold'|'to-evidence';holdSeconds:number}
 |{version:2;templateId:'title/emphasis';motion?:'none'|'fade-in'|'wipe'}
 |{version:2;templateId:'diagram/to-target';motion?:'none'|'reveal-items';objects:DiagramNode[];target:DiagramNode;relation:string}
 |{version:2;templateId:'diagram/range';motion?:'none';range:CardRange}

const object=<T extends Record<string,unknown>>(required:readonly string[],properties:T)=>({type:'object',additionalProperties:false,required,properties})
const string=(maxLength:number)=>({type:'string',maxLength,pattern:'^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]*$'})
const number=(minimum:number,maximum:number)=>({type:'number',minimum,maximum})
const list=(items:unknown,minItems:number,maxItems:number)=>({type:'array',items,minItems,maxItems})
export const sourcePinSchema=object(['artifactId','sha256'],{artifactId:{type:'string',minLength:1,maxLength:180},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}})
export const sourceRectSchema=object(['x','y','width','height'],{x:number(0,1),y:number(0,1),width:number(.005,1),height:number(.005,1)})
const readingSchema=object(['mode','targets','returnToWhole'],{mode:{enum:['whole-to-detail','detail-to-whole','sequence']},targets:list(object(['source','rect','name'],{source:sourcePinSchema,rect:sourceRectSchema,name:string(32)}),1,3),returnToWhole:{type:'boolean'}})
const highlightSchema=object(['source','name','rects','style','startSeconds','endSeconds'],{source:sourcePinSchema,name:string(32),rects:list(sourceRectSchema,1,3),style:{enum:['outline','fill','invert']},startSeconds:number(0,60),endSeconds:number(.1,60)})
const quoteSchema=object(['excerpt','translation','attribution','display'],{excerpt:string(160),translation:string(160),attribution:string(240),display:{enum:['simultaneous','staged']}})
const nodeSchema=object(['label'],{label:string(32),imageArtifactId:{type:'string',minLength:1,maxLength:180}})
const rangeCommon={axisLabel:string(48),condition:string(100)}
const rangeSchema={oneOf:[object(['mode','axisLabel','minimum','maximum','start','end','thresholds','unit','condition'],{mode:{const:'numeric'},...rangeCommon,minimum:number(-1e9,1e9),maximum:number(-1e9,1e9),start:number(-1e9,1e9),end:number(-1e9,1e9),thresholds:list(number(-1e9,1e9),0,2),unit:string(8)}),object(['mode','axisLabel','regionLabel','thresholdLabels','condition'],{mode:{const:'symbolic'},...rangeCommon,regionLabel:string(48),thresholdLabels:list(string(32),0,2)})]}
const evidence=(max:number)=>({reading:readingSchema,highlights:list(highlightSchema,0,max)})
const detailed=(id:string,required:string[],properties:Record<string,unknown>,motions:string[]=['none'])=>object(['version','templateId',...required],{version:{const:2},templateId:{const:id},motion:{enum:motions},...properties})
export const detailedCardSchemas=[
 ...['evidence/reading','evidence/highlight','diagram/image'].map(id=>detailed(id,[],evidence(3))),
 detailed('evidence/translation',['quote'],{...evidence(1),quote:quoteSchema}),
 detailed('evidence/person-quote',['quote','person'],{...evidence(1),quote:quoteSchema,person:object(['name','role','layout'],{artifactId:{type:'string',minLength:1,maxLength:180},name:string(32),role:string(64),layout:{enum:['right','corner']}})}),
 detailed('metric/backdrop',['value','decimals','unit','phase','holdSeconds'],{value:number(0,999999999.99),decimals:{enum:[0,1,2]},unit:string(8),phase:{enum:['hold','to-evidence']},holdSeconds:number(1.2,30)},['none','fade-in','count-up']),
 detailed('title/emphasis',[],{},['none','fade-in','wipe']),
 detailed('diagram/to-target',['objects','target','relation'],{objects:list(nodeSchema,2,3),target:nodeSchema,relation:string(24)},['none','reveal-items']),
 detailed('diagram/range',['range'],{range:rangeSchema})
]
function closed(raw:unknown,fields:readonly string[]):Record<string,unknown>{const v=mediaRecord(raw);if(Object.keys(v).some(key=>!fields.includes(key)))throw new TypeError('CARD_DETAILS: 不接受额外字段。');return v}
function text(value:unknown,max:number):string{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new TypeError(`CARD_DETAILS: 文字最多 ${max} 字符。`);return value}
function choice<T extends string>(value:unknown,values:readonly T[]):T{if(!values.includes(value as T))throw new TypeError('CARD_DETAILS: 选项不支持。');return value as T}
function array<T>(value:unknown,min:number,max:number,parse:(raw:unknown)=>T):T[]{if(!Array.isArray(value)||value.length<min||value.length>max)throw new TypeError(`CARD_DETAILS: 数量必须为 ${min}–${max}。`);return value.map(parse)}
export function assertSourcePin(raw:unknown):SourcePin{const v=closed(raw,['artifactId','sha256']);if(typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))throw new TypeError('CARD_SOURCE: 需要真实源文件 SHA-256。');return {artifactId:assertArtifactId(v.artifactId),sha256:v.sha256}}
export function assertSourceRect(raw:unknown):SourceRect{const v=closed(raw,['x','y','width','height']),r={x:finiteNumber(v.x,'rect x',0,1),y:finiteNumber(v.y,'rect y',0,1),width:finiteNumber(v.width,'rect width',.005,1),height:finiteNumber(v.height,'rect height',.005,1)};if(r.x+r.width>1+1e-9||r.y+r.height>1+1e-9)throw new TypeError('CARD_RECT: 重点必须在源图内。');return r}
function reading(raw:unknown,max:number):CardReading{const v=closed(raw,['mode','targets','returnToWhole']),mode=choice(v.mode,['whole-to-detail','detail-to-whole','sequence'] as const);if(typeof v.returnToWhole!=='boolean')throw new TypeError('CARD_READING: 需要明确是否回到全貌。');const targets=array(v.targets,1,max,raw=>{const t=closed(raw,['source','rect','name']);return {source:assertSourcePin(t.source),rect:assertSourceRect(t.rect),name:text(t.name,32)}});if(mode!=='sequence'&&targets.length!==1)throw new TypeError('CARD_READING: 此方式只接受一个目标。');return {mode,targets,returnToWhole:v.returnToWhole}}
function highlight(raw:unknown):CardHighlight{const v=closed(raw,['source','name','rects','style','startSeconds','endSeconds']),startSeconds=finiteNumber(v.startSeconds,'highlight start',0,60),endSeconds=finiteNumber(v.endSeconds,'highlight end',startSeconds+.1,60);return {source:assertSourcePin(v.source),name:text(v.name,32),rects:array(v.rects,1,3,assertSourceRect),style:choice(v.style,['outline','fill','invert'] as const),startSeconds,endSeconds}}
function quote(raw:unknown):QuoteDetails{const v=closed(raw,['excerpt','translation','attribution','display']);return {excerpt:text(v.excerpt,160),translation:text(v.translation,160),attribution:text(v.attribution,240),display:choice(v.display,['simultaneous','staged'] as const)}}
function node(raw:unknown):DiagramNode{const v=closed(raw,['label','imageArtifactId']);return {label:text(v.label,32),...(v.imageArtifactId===undefined?{}:{imageArtifactId:assertArtifactId(v.imageArtifactId)})}}
function range(raw:unknown):CardRange{const v=mediaRecord(raw);if(v.mode==='numeric'){closed(v,['mode','axisLabel','minimum','maximum','start','end','thresholds','unit','condition']);const minimum=finiteNumber(v.minimum,'axis minimum',-1e9,1e9),maximum=finiteNumber(v.maximum,'axis maximum',minimum+1e-6,1e9),start=finiteNumber(v.start,'region start',minimum,maximum),end=finiteNumber(v.end,'region end',start+1e-6,maximum),thresholds=array(v.thresholds,0,2,t=>finiteNumber(t,'threshold',minimum,maximum));if(thresholds.some((t,i)=>i>0&&t<=thresholds[i-1]))throw new TypeError('CARD_RANGE: 阈值必须递增。');return {mode:'numeric',axisLabel:text(v.axisLabel,48),minimum,maximum,start,end,thresholds,unit:text(v.unit,8),condition:text(v.condition,100)}}closed(v,['mode','axisLabel','regionLabel','thresholdLabels','condition']);if(v.mode!=='symbolic')throw new TypeError('CARD_RANGE: 需要数值或符号模式。');return {mode:'symbolic',axisLabel:text(v.axisLabel,48),regionLabel:text(v.regionLabel,48),thresholdLabels:array(v.thresholdLabels,0,2,t=>text(t,32)),condition:text(v.condition,100)}}
export function assertDetailedCard(raw:unknown):DetailedCardSpec {
 const v=mediaRecord(raw),schema=detailedCardSchemas.find(s=>s.properties.templateId.const===v.templateId)
 if(!schema||v.version!==2)throw new TypeError('CARD_DETAILS: 模板版本不支持。')
 closed(v,Object.keys(schema.properties));const motion=v.motion===undefined?{}:{motion:choice(v.motion,(schema.properties.motion as {enum:string[]}).enum)}
 if(['evidence/reading','evidence/highlight','evidence/translation','evidence/person-quote','diagram/image'].includes(String(v.templateId))){
  const max=v.templateId==='evidence/translation'||v.templateId==='evidence/person-quote'?1:3
  const base={version:2 as const,...motion,...(v.reading===undefined?{}:{reading:reading(v.reading,max)}),...(v.highlights===undefined?{}:{highlights:array(v.highlights,0,max,highlight)})}
  if(base.highlights?.some((h,i)=>i>0&&h.startSeconds<base.highlights![i-1].endSeconds))throw new TypeError('CARD_HIGHLIGHT: 重点时段必须顺序且不重叠。')
  if(v.templateId==='evidence/person-quote'){const p=closed(v.person,['artifactId','name','role','layout']);return {...base,templateId:v.templateId,quote:quote(v.quote),person:{name:text(p.name,32),role:text(p.role,64),layout:choice(p.layout,['right','corner'] as const),...(p.artifactId===undefined?{}:{artifactId:assertArtifactId(p.artifactId)})}} as DetailedCardSpec}
  if(v.templateId==='evidence/translation')return {...base,templateId:v.templateId,quote:quote(v.quote)} as DetailedCardSpec
  return {...base,templateId:v.templateId} as DetailedCardSpec
 }
 if(v.templateId==='metric/backdrop'){const value=finiteNumber(v.value,'card value',0,999999999.99),decimals=finiteNumber(v.decimals,'decimals',0,2,true) as 0|1|2;if(Number(value.toFixed(decimals))!==value)throw new TypeError('CARD_METRIC: 小数位与数值不一致。');return {version:2,templateId:v.templateId,...motion,value,decimals,unit:text(v.unit,8),phase:choice(v.phase,['hold','to-evidence'] as const),holdSeconds:finiteNumber(v.holdSeconds,'hold',1.2,30)} as DetailedCardSpec}
 if(v.templateId==='title/emphasis')return {version:2,templateId:v.templateId,...motion} as DetailedCardSpec
 if(v.templateId==='diagram/to-target')return {version:2,templateId:v.templateId,...motion,objects:array(v.objects,2,3,node),target:node(v.target),relation:text(v.relation,24)} as DetailedCardSpec
 return {version:2,templateId:'diagram/range',...motion,range:range(v.range)} as DetailedCardSpec
}
export function cardImageAssets(spec:DetailedCardSpec|undefined):string[]{if(!spec)return [];if(spec.templateId==='evidence/person-quote')return spec.person.artifactId?[spec.person.artifactId]:[];if(spec.templateId==='diagram/to-target')return [...spec.objects,spec.target].flatMap(n=>n.imageArtifactId?[n.imageArtifactId]:[]);return []}
export function cardSourcePins(spec:DetailedCardSpec|undefined):SourcePin[]{return spec&&'reading'in spec||spec&&'highlights'in spec?[...(spec.reading?.targets.map(t=>t.source)??[]),...(spec.highlights?.map(h=>h.source)??[])]:[]}
/** Empty dedicated slots are editable draft state, never publishable placeholders. */
export function assertDetailedReady(spec:DetailedCardSpec):void {
 const fail=(message:string):never=>{throw new TypeError('CARD_INCOMPLETE: '+message)}
 if(spec.templateId==='evidence/reading'&&!spec.reading)fail('请指定阅读目标。')
 if(spec.templateId==='evidence/highlight'&&!spec.highlights?.length)fail('请指定原句重点。')
 if('quote'in spec&&(!spec.quote.excerpt.trim()||!spec.quote.attribution.trim()))fail('请填写可核对的原句与引述来源。')
 if('person'in spec&&(!spec.person.artifactId||!spec.person.name.trim()))fail('请填写人物图与姓名。')
 if(spec.templateId==='diagram/to-target'&&[...spec.objects,spec.target].some(n=>!n.label.trim()))fail('请填写所有对象与目标的标签。')
 if(spec.templateId==='diagram/range'&&(!spec.range.axisLabel.trim()||!spec.range.condition.trim()))fail('请填写轴含义与适用条件。')
}
/** Compare actual bytes, both in preview and worker, before any pixels are admitted. */
export async function verifyCardSources(specs:(DetailedCardSpec|undefined)[],bytes:(id:string)=>Uint8Array|undefined):Promise<void>{const pins=specs.flatMap(cardSourcePins),actual=new Map<string,string>();for(const pin of pins){let hash=actual.get(pin.artifactId);if(!hash){const data=bytes(pin.artifactId);if(!data)throw new Error('CARD_SOURCE_STALE: 重点的源图已移除，请重新确认。');hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('');actual.set(pin.artifactId,hash)}if(hash!==pin.sha256)throw new Error('CARD_SOURCE_STALE: 源图已变化，旧重点失效，请重新框选。')}}
