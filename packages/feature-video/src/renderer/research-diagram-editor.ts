import {assertResearchDiagram} from '../../../media-native/src/research-diagrams.js'
import type {ResearchDiagram} from '../../../media-native/src/research-diagrams.js'
const cell=(value:unknown)=>String(value).replace(/\\/g,'\\\\').replace(/\|/g,'\\|')
function splitColumns(line:string):string[]{const result:string[]=[];let value='';for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='\\'&&(line[i+1]==='|'||line[i+1]==='\\'))value+=line[++i];else if(ch==='|'){result.push(value);value=''}else value+=ch}result.push(value);return result}
export function researchEditorFields(spec:ResearchDiagram):Record<string,string|number|boolean>{
 if(spec.kind==='events')return {elements:spec.elements.map(e=>[e.id,e.parentId??'',e.kind,e.text,e.x,e.y,e.width,e.height,e.color,e.value,e.active,e.layout??'',e.codeLines?JSON.stringify(e.codeLines):'',e.highlightLine??''].map(cell).join('|')).join('\n'),events:spec.events.flatMap(e=>e.changes.map(c=>[e.id,e.atSeconds,c.targetId,c.active??'',c.value??'',c.text??'',c.highlightLine??''].map(cell).join('|'))).join('\n')}
 return {mode:spec.mode,xMin:spec.xDomain[0],xMax:spec.xDomain[1],yMin:spec.yDomain[0],yMax:spec.yDomain[1],xScale:spec.xScale,yScale:spec.yScale,baseline:spec.baseline,xUnit:spec.xUnit,categories:spec.categories.map(cell).join('|'),series:spec.series.flatMap(s=>s.points.map(p=>[s.id,s.label,s.color,s.source,p.x,p.y].map(cell).join('|'))).join('\n')}
}
function rows(raw:unknown,columns:number,max:number):string[][]{
 if(typeof raw!=='string'||raw.length>60000)throw new TypeError('图解数据表超过预算。');if(!raw.trim())return []
 const result=raw.split(/\r?\n/).map(splitColumns);if(result.length>max||result.some(r=>r.length!==columns))throw new TypeError('图解表列数或行数不符。');return result
}
function number(s:string):number{if(!s.trim()||!Number.isFinite(Number(s)))throw new TypeError('图解表需要有限数值。');return Number(s)}
function boolean(s:string):boolean{if(s!=='true'&&s!=='false')throw new TypeError('状态须为 true 或 false。');return s==='true'}
export function readResearchEditorFields(spec:ResearchDiagram,base:Record<string,unknown>,fields:Record<string,unknown>):ResearchDiagram {
 if(spec.kind==='events'){
  const elements=rows(fields.elements,14,32).map(([id,parentId,kind,text,x,y,width,height,color,value,active,layout,codeLines,highlightLine])=>({id,...(parentId?{parentId}:{}),kind,text,x:number(x),y:number(y),width:number(width),height:number(height),color,value:number(value),active:boolean(active),...(layout?{layout}:{}),...(codeLines?{codeLines:JSON.parse(codeLines) as unknown}:{}),...(highlightLine?{highlightLine:number(highlightLine)}:{})})),events: {id:string;atSeconds:number;changes:Record<string,unknown>[]}[]=[]
  for(const [id,time,targetId,active,value,text,highlightLine]of rows(fields.events,7,512)){const atSeconds=number(time),existing=events.find(e=>e.id===id);if(existing&&existing.atSeconds!==atSeconds)throw new TypeError('同一事件的时间须一致。');const event=existing??{id,atSeconds,changes:[]};if(!existing)events.push(event);event.changes.push({targetId,...(active?{active:boolean(active)}:{}),...(value?{value:number(value)}:{}),...(text?{text}:{}),...(highlightLine?{highlightLine:number(highlightLine)}:{})})}
  return assertResearchDiagram({...base,version:2,elements,events})
 }
 const series:{id:string;label:string;color:string;source:string;points:{x:number;y:number}[]}[]=[]
 for(const [id,label,color,source,x,y]of rows(fields.series,6,128)){const existing=series.find(s=>s.id===id);if(existing&&(existing.label!==label||existing.color!==color||existing.source!==source))throw new TypeError('同一序列元数据须一致。');const entry=existing??{id,label,color,source,points:[]};if(!existing)series.push(entry);entry.points.push({x:number(x),y:number(y)})}
 return assertResearchDiagram({...base,version:2,mode:fields.mode,xDomain:[fields.xMin,fields.xMax],yDomain:[fields.yMin,fields.yMax],xScale:fields.xScale,yScale:fields.yScale,baseline:fields.baseline,xUnit:fields.xUnit,categories:typeof fields.categories==='string'&&fields.categories?splitColumns(fields.categories):[],series})
}
