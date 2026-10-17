import {assertResearchDiagram,researchDiagramSchemas,eventState,defaultResearchDiagram} from './research-diagrams.js'
import type {ResearchDiagram,EventElement,MeasurementDiagram} from './research-diagrams.js'
import {finiteNumber,mediaRecord} from './media-contract.js'

export type ScienceKind='curve'|'ratio'|'flow'|'array'|'events'|'measurement'
export interface SciencePoint {x:number;y:number}
interface ScienceBase {version:1;title:string;unit:string;note:string;theme:'dark'|'light';durationSeconds:number;delaySeconds:number;offsetSeconds:number}
export interface ScienceCurve extends ScienceBase {kind:'curve';points:SciencePoint[];xDomain:[number,number];yDomain:[number,number];xUnit:string;color:string;showDot:boolean}
export interface SciencePart {label:string;value:number;color:string}
export interface ScienceRatio extends ScienceBase {kind:'ratio';mode:'bar'|'pie'|'ring';parts:SciencePart[]}
export interface ScienceFlow extends ScienceBase {kind:'flow';mode:'drill'|'flow';path:SciencePoint[];dots:number;cycles:number;valueStart:number;valueEnd:number;color:string}
export interface ScienceGroup {label:string;count:number;color:string}
export interface ScienceArray extends ScienceBase {kind:'array';groups:ScienceGroup[]}
export type ScienceSpec=ScienceCurve|ScienceRatio|ScienceFlow|ScienceArray|ResearchDiagram
const commonFields=['version','kind','title','unit','note','theme','durationSeconds','delaySeconds','offsetSeconds']
const closed=(v:Record<string,unknown>,fields:readonly string[])=>{if(Object.keys(v).some(k=>!fields.includes(k)))throw new TypeError('Unsupported scientific diagram field.')}
function text(raw:unknown,max:number,label:string):string{if(typeof raw!=='string'||raw.length>max||/[\u0000-\u001f\u007f]/.test(raw))throw new TypeError('Invalid '+label+'.');return raw}
const color=(raw:unknown)=>{if(typeof raw!=='string'||!/^#[a-fA-F0-9]{6}$/.test(raw))throw new TypeError('Diagram color requires opaque RGB hex.');return raw}
const number=(raw:unknown,label:string)=>finiteNumber(raw,label,-1e9,1e9)
function domain(raw:unknown,label:string):[number,number]{if(!Array.isArray(raw)||raw.length!==2)throw new TypeError('A diagram domain requires two numbers.');const a=number(raw[0],label),b=number(raw[1],label);if(a>=b)throw new TypeError('Diagram domain must increase.');return [a,b]}
function points(raw:unknown,max:number,normalized=false):SciencePoint[]{
 if(!Array.isArray(raw)||raw.length<2||raw.length>max)throw new TypeError('Invalid bounded diagram point list.')
 return raw.map(raw=>{const p=mediaRecord(raw);closed(p,['x','y']);return {x:finiteNumber(p.x,'diagram x',normalized?0:-1e9,normalized?1:1e9),y:finiteNumber(p.y,'diagram y',normalized?0:-1e9,normalized?1:1e9)}})
}
/** Data only. No expression, formatter callback, arbitrary layout program or URL. */
export function assertScienceSpec(raw:unknown):ScienceSpec {
 const v=mediaRecord(raw)
 if(v.version===2)return assertResearchDiagram(v)
 if(v.version!==1||!['curve','ratio','flow','array'].includes(String(v.kind)))throw new TypeError('Unsupported scientific diagram version/kind.')
 const theme=v.theme===undefined?'dark':v.theme;if(theme!=='dark'&&theme!=='light')throw new TypeError('Unknown diagram theme.')
 const base:ScienceBase={version:1,title:text(v.title,40,'diagram title'),unit:text(v.unit,12,'diagram unit'),note:text(v.note===undefined?'':v.note,80,'diagram note'),theme,durationSeconds:finiteNumber(v.durationSeconds,'diagram animation duration',.1,720),delaySeconds:finiteNumber(v.delaySeconds===undefined?0:v.delaySeconds,'diagram delay',0,720),offsetSeconds:finiteNumber(v.offsetSeconds===undefined?0:v.offsetSeconds,'diagram original clock',0,720)}
 if(v.kind==='curve'){
  closed(v,[...commonFields,'points','xDomain','yDomain','xUnit','color','showDot']);const values=points(v.points,64),xDomain=domain(v.xDomain,'x domain'),yDomain=domain(v.yDomain,'y domain'),showDot=v.showDot===undefined?true:v.showDot
  if(typeof showDot!=='boolean')throw new TypeError('Invalid curve dot flag.')
  if(values.some((p,i)=>p.x<xDomain[0]||p.x>xDomain[1]||p.y<yDomain[0]||p.y>yDomain[1]||i>0&&p.x<=values[i-1].x))throw new TypeError('Curve points require increasing x and must fit both data domains.')
  return {...base,kind:'curve',points:values,xDomain,yDomain,xUnit:text(v.xUnit,12,'x unit'),color:color(v.color),showDot}
 }
 if(v.kind==='ratio'){
  closed(v,[...commonFields,'mode','parts']);if(!['bar','pie','ring'].includes(String(v.mode))||!Array.isArray(v.parts)||!v.parts.length||v.parts.length>8)throw new TypeError('Invalid ratio mode or bounded parts.')
  const parts=v.parts.map(raw=>{const p=mediaRecord(raw);closed(p,['label','value','color']);return {label:text(p.label,24,'part label'),value:finiteNumber(p.value,'part value',0,1e9),color:color(p.color)}})
  if(!parts.some(p=>p.value>0))throw new TypeError('Ratio requires a positive total.')
  return {...base,kind:'ratio',mode:v.mode as ScienceRatio['mode'],parts}
 }
 if(v.kind==='flow'){
  closed(v,[...commonFields,'mode','path','dots','cycles','valueStart','valueEnd','color']);if(v.mode!=='drill'&&v.mode!=='flow')throw new TypeError('Invalid path/flow mode.')
  const path=points(v.path,32,true)
  if(path.some((p,i)=>i>0&&Math.hypot(p.x-path[i-1].x,p.y-path[i-1].y)<1e-6))throw new TypeError('Flow path requires distinct adjacent points.')
  if(v.mode==='drill'&&(path.at(-1)!.y<=path[0].y||path.some((p,i)=>i>0&&p.y<path[i-1].y)))throw new TypeError('Drilling depth requires a downward path with nondecreasing y.')
  return {...base,kind:'flow',mode:v.mode,path,dots:finiteNumber(v.dots,'flow dots',1,24,true),cycles:finiteNumber(v.cycles===undefined?2:v.cycles,'flow cycles',1,8,true),valueStart:number(v.valueStart,'start readout'),valueEnd:number(v.valueEnd,'end readout'),color:color(v.color)}
 }
 closed(v,[...commonFields,'groups']);if(!Array.isArray(v.groups)||!v.groups.length||v.groups.length>8)throw new TypeError('Array requires one to eight groups.')
 const groups=v.groups.map(raw=>{const g=mediaRecord(raw);closed(g,['label','count','color']);return {label:text(g.label,24,'group label'),count:finiteNumber(g.count,'group count',0,64,true),color:color(g.color)}}),total=groups.reduce((n,g)=>n+g.count,0)
 if(total<1||total>64)throw new TypeError('Array total must be one to sixty-four objects.')
 return {...base,kind:'array',groups}
}
type Schema=Record<string,unknown>
const numeric=(min:number,max:number,integer=false):Schema=>({type:integer?'integer':'number',minimum:min,maximum:max}),string=(max:number):Schema=>({type:'string',maxLength:max,pattern:'^[^\\u0000-\\u001f\\u007f]*$'}),rgb={type:'string',pattern:'^#[a-fA-F0-9]{6}$'},object=(properties:Record<string,unknown>,required=Object.keys(properties)):Schema=>({type:'object',additionalProperties:false,properties,required}),list=(items:Schema,minItems:number,maxItems:number):Schema=>({type:'array',items,minItems,maxItems})
const dataNumber=numeric(-1e9,1e9),dataPoint=object({x:dataNumber,y:dataNumber}),normalizedPoint=object({x:numeric(0,1),y:numeric(0,1)}),dataDomain=list(dataNumber,2,2),common={version:{const:1},title:string(40),unit:string(12),note:string(80),theme:{enum:['dark','light']},durationSeconds:numeric(.1,720),delaySeconds:numeric(0,720),offsetSeconds:numeric(0,720)}
const required=['version','kind','title','unit','durationSeconds']
export const scienceSpecSchema={oneOf:[...researchDiagramSchemas,object({...common,kind:{const:'curve'},points:list(dataPoint,2,64),xDomain:dataDomain,yDomain:dataDomain,xUnit:string(12),color:rgb,showDot:{type:'boolean'}},[...required,'points','xDomain','yDomain','xUnit','color']),object({...common,kind:{const:'ratio'},mode:{enum:['bar','pie','ring']},parts:list(object({label:string(24),value:numeric(0,1e9),color:rgb}),1,8)},[...required,'mode','parts']),object({...common,kind:{const:'flow'},mode:{enum:['drill','flow']},path:list(normalizedPoint,2,32),dots:numeric(1,24,true),cycles:numeric(1,8,true),valueStart:dataNumber,valueEnd:dataNumber,color:rgb},[...required,'mode','path','dots','valueStart','valueEnd','color']),object({...common,kind:{const:'array'},groups:list(object({label:string(24),count:numeric(0,64,true),color:rgb}),1,8)},[...required,'groups'])]}
/** Animation is a pure function of the retained source clock, including reverse seeks. */
export function scienceProgress(spec:ScienceSpec,local:number):number {
 if(!Number.isFinite(local))throw new TypeError('Invalid scientific diagram time.')
 const elapsed=Math.round((local+spec.offsetSeconds-spec.delaySeconds)*1e6)/1e6
 return Math.max(0,Math.min(1,elapsed/spec.durationSeconds))
}
function prefixAt(values:readonly SciencePoint[],progress:number,byX=false):{points:SciencePoint[];tip:SciencePoint}{
 const spans=values.slice(1).map((p,i)=>byX?p.x-values[i].x:Math.hypot(p.x-values[i].x,p.y-values[i].y)),target=spans.reduce((a,b)=>a+b,0)*progress,result=[{...values[0]}];let walked=0
 for(let i=0;i<spans.length;i++){
  if(target>=walked+spans[i]){result.push({...values[i+1]});walked+=spans[i];continue}
  const fraction=Math.max(0,Math.min(1,(target-walked)/spans[i])),a=values[i],b=values[i+1],tip={x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction};if(fraction>0)result.push(tip);return {points:result,tip}
 }
 return {points:result,tip:{...values.at(-1)!}}
}
export interface ScienceArrayBox {x:number;y:number;width:number;height:number}
export type ScienceState=
 |{kind:'events';progress:number;elements:EventElement[]}
 |{kind:'measurement';progress:number;series:MeasurementDiagram['series']}
 |{kind:'curve';progress:number;points:SciencePoint[];tip:SciencePoint}
 |{kind:'ratio';progress:number;total:number;currentTotal:number;parts:(SciencePart&{targetValue:number;fraction:number;start:number;end:number})[]}
 |{kind:'flow';progress:number;points:SciencePoint[];tip:SciencePoint;dots:SciencePoint[];value:number}
 |{kind:'array';progress:number;total:number;groups:(ScienceGroup&ScienceArrayBox)[];items:(ScienceArrayBox&{id:number;group:number;color:string})[]}
export function scienceState(spec:ScienceSpec,local:number):ScienceState {
 const progress=scienceProgress(spec,local)
 if(spec.kind==='events')return {kind:'events',progress,elements:eventState(spec,local)}
 if(spec.kind==='measurement')return {kind:'measurement',progress,series:spec.series}
 if(spec.kind==='curve')return {kind:'curve',progress,...prefixAt(spec.points,progress,true)}
 if(spec.kind==='ratio'){
  const total=spec.parts.reduce((n,p)=>n+p.value,0);let start=0
  const parts=spec.parts.map(p=>{const fraction=p.value/total*progress,end=start+fraction,part={...p,targetValue:p.value,value:p.value*progress,fraction,start,end};start=end;return part})
  return {kind:'ratio',progress,total,currentTotal:parts.reduce((n,p)=>n+p.value,0),parts}
 }
 if(spec.kind==='flow'){
  const trace=prefixAt(spec.path,progress),fraction=spec.mode==='drill'?(trace.tip.y-spec.path[0].y)/(spec.path.at(-1)!.y-spec.path[0].y):progress
  return {kind:'flow',progress,...trace,dots:spec.mode==='drill'?[]:Array.from({length:spec.dots},(_,i)=>prefixAt(spec.path,(progress*spec.cycles+i/spec.dots)%1).tip),value:spec.valueStart+(spec.valueEnd-spec.valueStart)*fraction}
 }
 const total=spec.groups.reduce((n,g)=>n+g.count,0),columns=Math.ceil(Math.sqrt(total)),rows=Math.ceil(total/columns),groupColumns=Math.ceil(Math.sqrt(spec.groups.length)),groupRows=Math.ceil(spec.groups.length/groupColumns),groups=spec.groups.map((g,i)=>({...g,x:(i%groupColumns+.03)/groupColumns,y:(Math.floor(i/groupColumns)+.03)/groupRows,width:.94/groupColumns,height:.94/groupRows})),items:Extract<ScienceState,{kind:'array'}>['items']=[]
 for(const [group,g]of groups.entries())for(let j=0;j<g.count;j++){
  const index=items.length,c=Math.max(1,Math.ceil(Math.sqrt(g.count))),r=Math.ceil(g.count/c),from={x:(index%columns+.5)/columns,y:(Math.floor(index/columns)+.5)/rows,width:.72/columns,height:.72/rows},to={x:g.x+(.1+.8*(j%c+.5)/c)*g.width,y:g.y+(.45+.5*(Math.floor(j/c)+.5)/r)*g.height,width:.65/c*g.width,height:.4/r*g.height},mix=(key:keyof ScienceArrayBox)=>from[key]+(to[key]-from[key])*progress
  items.push({id:index+1,group,color:g.color,x:mix('x'),y:mix('y'),width:mix('width'),height:mix('height')})
 }
 return {kind:'array',progress,total,groups,items}
}
export function defaultScienceSpec(kind:ScienceKind):ScienceSpec {
 if(kind==='events'||kind==='measurement')return defaultResearchDiagram(kind)
 const common={version:1 as const,title:'',unit:'',note:'示意数据，非原片实验读数',theme:'dark' as const,durationSeconds:3,delaySeconds:0,offsetSeconds:0}
 if(kind==='curve')return {...common,kind,title:'曲线生长与沿线点',unit:'示意值',xUnit:'阶段',xDomain:[0,1],yDomain:[0,1],points:[{x:0,y:0},{x:.2,y:.15},{x:.5,y:.65},{x:.8,y:.82},{x:1,y:1}],color:'#70d5ff',showDot:true}
 if(kind==='ratio')return {...common,kind,title:'动态比例',unit:'个',mode:'ring',parts:[{label:'甲',value:45,color:'#70d5ff'},{label:'乙',value:35,color:'#75e2b7'},{label:'丙',value:20,color:'#ffc56b'}]}
 if(kind==='flow')return {...common,kind,title:'路径与流向',unit:'%',mode:'flow',path:[{x:.15,y:.08},{x:.15,y:.75},{x:.7,y:.75},{x:.7,y:.95}],dots:12,cycles:2,valueStart:0,valueEnd:100,color:'#70d5ff'}
 return {...common,kind,title:'对象阵列重排',unit:'个',groups:[{label:'第一组',count:12,color:'#70d5ff'},{label:'第二组',count:9,color:'#75e2b7'},{label:'第三组',count:8,color:'#ffc56b'},{label:'第四组',count:8,color:'#cbacff'}]}
}
export function scienceNumber(value:number):string {const n=Math.abs(value);return n!==0&&(n<.001||n>=1e4)?value.toExponential(2):String(Number(value.toFixed(3)))}
