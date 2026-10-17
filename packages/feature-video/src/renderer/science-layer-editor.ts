import {researchEditorFields,readResearchEditorFields} from './research-diagram-editor.js'
import {assertScienceSpec,defaultScienceSpec} from '../../../media-native/src/science-spec.js'
import type {ScienceKind,ScienceSpec,SciencePoint} from '../../../media-native/src/science-spec.js'
import {finiteNumber} from '../../../media-native/src/media-contract.js'

export type ScienceFields=Record<string,string|number|boolean>
const palette=['#70d5ff','#75e2b7','#ffc56b','#cbacff','#ff9fbc','#8ca8ff','#b9df77','#e1bd90']
export function scienceEditorFields(spec:ScienceSpec):ScienceFields {
 const fields:ScienceFields={kind:spec.kind,title:spec.title,unit:spec.unit,note:spec.note,theme:spec.theme,durationSeconds:spec.durationSeconds,delaySeconds:spec.delaySeconds,offsetSeconds:spec.offsetSeconds}
 if(spec.version===2)return {...fields,...researchEditorFields(spec)}
 if(spec.kind==='curve')Object.assign(fields,{points:spec.points.map(p=>p.x+', '+p.y).join('\n'),xMin:spec.xDomain[0],xMax:spec.xDomain[1],yMin:spec.yDomain[0],yMax:spec.yDomain[1],xUnit:spec.xUnit,color:spec.color,showDot:spec.showDot})
 else if(spec.kind==='flow')Object.assign(fields,{path:spec.path.map(p=>p.x+', '+p.y).join('\n'),mode:spec.mode,dots:spec.dots,cycles:spec.cycles,valueStart:spec.valueStart,valueEnd:spec.valueEnd,color:spec.color})
 else if(spec.kind==='ratio'){fields.mode=spec.mode;fields.rowCount=spec.parts.length;spec.parts.forEach((p,i)=>Object.assign(fields,{['row-'+i+'-label']:p.label,['row-'+i+'-value']:p.value,['row-'+i+'-color']:p.color}))}
 else {fields.rowCount=spec.groups.length;spec.groups.forEach((g,i)=>Object.assign(fields,{['row-'+i+'-label']:g.label,['row-'+i+'-count']:g.count,['row-'+i+'-color']:g.color}))}
 return fields
}
function pointText(raw:unknown,max:number):SciencePoint[]{
 if(typeof raw!=='string'||raw.length>4096)throw new TypeError('坐标表超过输入范围。')
 const rows=raw.trim().split(/\r?\n/);if(rows.length<2||rows.length>max)throw new TypeError('坐标点数量超出范围。')
 return rows.map(row=>{const parts=row.split(',').map(s=>s.trim());if(parts.length!==2||parts.some(s=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(s)))throw new TypeError('每行填写两个坐标，以英文逗号分隔。');return {x:Number(parts[0]),y:Number(parts[1])}})
}
/** Form controls supply typed data, never a JSON/code execution surface. */
export function readScienceEditorFields(previous:ScienceSpec,fields:Record<string,unknown>):ScienceSpec {
 const kind=fields.kind;if(!['curve','ratio','flow','array','events','measurement'].includes(String(kind)))throw new TypeError('未知图解类型。')
 if(kind!==previous.kind){const defaults=defaultScienceSpec(kind as ScienceKind),next={...defaults,durationSeconds:previous.durationSeconds,delaySeconds:previous.delaySeconds,offsetSeconds:previous.offsetSeconds,theme:previous.theme};if(next.kind==='events'&&defaults.kind==='events')next.events=defaults.events.map(e=>({...e,atSeconds:previous.delaySeconds+e.atSeconds/defaults.durationSeconds*previous.durationSeconds}));return assertScienceSpec(next)}
 const base={version:previous.version,kind,title:fields.title,unit:fields.unit,note:fields.note,theme:fields.theme,durationSeconds:fields.durationSeconds,delaySeconds:fields.delaySeconds,offsetSeconds:fields.offsetSeconds}
 if(previous.version===2)return readResearchEditorFields(previous,base,fields)
 if(kind==='curve')return assertScienceSpec({...base,points:pointText(fields.points,64),xDomain:[fields.xMin,fields.xMax],yDomain:[fields.yMin,fields.yMax],xUnit:fields.xUnit,color:fields.color,showDot:fields.showDot})
 if(kind==='flow')return assertScienceSpec({...base,path:pointText(fields.path,32),mode:fields.mode,dots:fields.dots,cycles:fields.cycles,valueStart:fields.valueStart,valueEnd:fields.valueEnd,color:fields.color})
 const count=finiteNumber(fields.rowCount,'diagram row count',1,8,true),rows=Array.from({length:count},(_,i)=>({label:fields['row-'+i+'-label']??'分组'+(i+1),color:fields['row-'+i+'-color']??palette[i],...(kind==='ratio'?{value:fields['row-'+i+'-value']??1}:{count:fields['row-'+i+'-count']??1})}))
 return assertScienceSpec({...base,...(kind==='ratio'?{mode:fields.mode,parts:rows}:{groups:rows})})
}
/** These controls join the same pending-input/CAS transaction as ordinary layers. */
export function renderScienceEditor(parent:HTMLElement,spec:ScienceSpec):HTMLDetailsElement {
 const details=document.createElement('details'),summary=document.createElement('summary');details.id='layer-science';details.open=true;summary.textContent='科学图解 · 数据与时钟';details.append(summary);parent.append(details)
 const values=scienceEditorFields(spec)
 const field=(key:string,label:string,options?:{min?:number;max?:number;step?:number;choices?:[string,string][];rows?:number;readOnly?:boolean})=>{
  const row=document.createElement('label');row.textContent=label;let input:HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement
  if(options?.choices){const select=document.createElement('select');for(const [value,label]of options.choices)select.append(new Option(label,value));select.value=String(values[key]);input=select}
  else if(options?.rows){const area=document.createElement('textarea');area.rows=options.rows;area.maxLength=60000;area.value=String(values[key]);input=area}
  else {const control=document.createElement('input'),value=values[key];control.type=typeof value==='number'?'number':typeof value==='boolean'?'checkbox':key==='color'||key.endsWith('-color')?'color':'text';if(typeof value==='boolean')control.checked=value;else control.value=String(value);if(options?.min!==undefined)control.min=String(options.min);if(options?.max!==undefined)control.max=String(options.max);control.step=String(options?.step??.01);control.readOnly=Boolean(options?.readOnly);if(control.type==='text')control.maxLength=key==='title'?40:key==='note'?80:key==='unit'||key==='xUnit'?12:24;input=control}
  input.dataset.layerField='science-'+key;input.id='layer-science-'+key;row.append(input);details.append(row)
 }
 field('kind','图解类型',{choices:[['curve','曲线与沿线点'],['ratio','比例条 / 饼 / 环'],['flow','路径 / 钻井 / 流向'],['array','对象阵列分组'],['events','事件联动 / 分组面板'],['measurement','科研测量图表']]})
 const help=document.createElement('p');help.className='muted';help.textContent='切换类型采用该类型默认数据并保留原时钟，可撤销。图形、单位和读数由同一份数据派生；不提供手工读数覆盖。';details.append(help)
 field('title','图解标题');field('unit','数值单位');field('note','数据来源 / 示意说明');field('theme','底色',{choices:[['dark','深色'],['light','浅色']]});field('durationSeconds','动画时长（秒）',{min:.1,max:720});field('delaySeconds','动画延迟（秒）',{min:0,max:720});field('offsetSeconds','保留原时钟偏移（秒）',{min:0,max:720,readOnly:true})
 if(spec.version===2){
  if(spec.kind==='events'){field('elements','对象表：id|父ID|node/phase/memory/code/chat/group|文字|x|y|宽|高|颜色|值|激活|分组布局free/stack|代码行JSON数组（可空）|高亮行号0至8（可空）',{rows:8});field('events','事件表：事件ID|原时钟秒|目标ID|激活（可空）|值（可空）|文字（可空）|高亮行号（可空）',{rows:8})}
  else {field('mode','图表类型',{choices:[['grouped-bar','分组绝对值柱图'],['scatter','散点']]});for(const [key,label]of [['xMin','X最小值'],['xMax','X最大值'],['yMin','Y最小值'],['yMax','Y最大值'],['baseline','基线']] as const)field(key,label,{min:-1e9,max:1e9});field('xUnit','X轴单位');for(const key of ['xScale','yScale'])field(key,key,{choices:[['linear','线性'],['log','对数']]});field('categories','分类名称，以 | 分隔');field('series','测量表：序列ID|标签|颜色|明确来源|x|y（每点一行）',{rows:8})}
 }else if(spec.kind==='curve'){
  field('points','坐标数据（每行 x, y；2–64点）',{rows:6});for(const [key,label]of [['xMin','X最小值'],['xMax','X最大值'],['yMin','Y最小值'],['yMax','Y最大值']] as const)field(key,label,{min:-1e9,max:1e9});field('xUnit','X轴单位');field('color','曲线颜色');field('showDot','显示沿线点')
 }else if(spec.kind==='flow'){
  field('mode','路径模式',{choices:[['drill','钻井 / 路径生长'],['flow','流向粒子']]});field('path','归一化路径（每行 x, y；0–1，2–32点；钻井Y向下递增）',{rows:6});field('dots','粒子数',{min:1,max:24,step:1});field('cycles','流动周期数',{min:1,max:8,step:1});field('valueStart','初始读数',{min:-1e9,max:1e9});field('valueEnd','目标读数',{min:-1e9,max:1e9});field('color','路径颜色')
 }else {
  if(spec.kind==='ratio')field('mode','比例图样式',{choices:[['bar','比例条'],['pie','饼图'],['ring','环图']]})
  field('rowCount',spec.kind==='ratio'?'分项数（1–8）':'分组数（1–8，总数1–64）',{min:1,max:8,step:1})
  const count=spec.kind==='ratio'?spec.parts.length:spec.groups.length
  for(let i=0;i<count;i++){const heading=document.createElement('p');heading.textContent=(spec.kind==='ratio'?'分项 ':'分组 ')+(i+1);details.append(heading);field('row-'+i+'-label','名称');field('row-'+i+(spec.kind==='ratio'?'-value':'-count'),spec.kind==='ratio'?'数值':'对象数量',{min:0,max:spec.kind==='ratio'?1e9:64,step:spec.kind==='ratio'?.01:1});field('row-'+i+'-color','颜色')}
 }
 return details
}
