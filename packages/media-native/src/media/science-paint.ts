import {paintResearchDiagram} from './research-diagram-paint.js'
import {scienceNumber,scienceState} from '../science-spec.js'
import type {ScienceSpec,SciencePoint} from '../science-spec.js'
import {COMPOSITION_FONT,fitText} from './composition-text.js'

interface Rect {x:number;y:number;width:number;height:number}
/** One finite diagram renderer shared by native export and Studio playback. */
export function paintScience(context:CanvasRenderingContext2D,spec:ScienceSpec,local:number,box:Rect,frameWidth:number,frameHeight:number):void {
 if(spec.version===2){paintResearchDiagram(context,spec,local,box,frameWidth,frameHeight);return}
 const state=scienceState(spec,local),scale=frameHeight/720,font=Math.max(12,16*scale,14*frameWidth/390),small=Math.max(12,12*scale,12*frameWidth/390),pad=font,ink=spec.theme==='dark'?'#edf5ff':'#14283c',muted=spec.theme==='dark'?'#b7c9df':'#41556a',background=spec.theme==='dark'?'#122039':'#f5f8fc',grid=spec.theme==='dark'?'#354860':'#c6d3e2'
 const fail=(detail='')=>{throw new Error('STUDIO_DIAGRAM_LAYOUT: '+spec.title+'：图解范围太小或标签过长；请放大对象、缩短标签或减少分项。'+(detail?' '+detail:''))}
 if(box.width<font*10||box.height<font*9)fail()
 const label=(text:string,x:number,y:number,width:number,size=font,maxLines=1,align:'left'|'center'|'right'='left')=>{
  const fitted=fitText(context,text,width,maxLines,size,maxLines*size*1.3)
  if(fitted.overflow||fitted.size<small-.01)fail('文字：'+text)
  context.font=`600 ${fitted.size}px ${COMPOSITION_FONT}`;context.textAlign=align;context.textBaseline='top'
  fitted.lines.forEach((line,i)=>context.fillText(line,x,y+i*fitted.size*1.3))
  return fitted.lines.length*fitted.size*1.3
 }
 const unit=(value:number)=>scienceNumber(value)+(spec.unit?' '+spec.unit:'')
 const path=(values:readonly SciencePoint[],map:(p:SciencePoint)=>SciencePoint,color:string,width:number)=>{if(!values.length)return;context.beginPath();const first=map(values[0]);context.moveTo(first.x,first.y);for(const value of values.slice(1)){const p=map(value);context.lineTo(p.x,p.y)}context.strokeStyle=color;context.lineWidth=width;context.lineJoin='round';context.lineCap='round';context.stroke()}
 const dot=(p:SciencePoint,color:string,radius=font*.18)=>{context.beginPath();context.arc(p.x,p.y,radius,0,Math.PI*2);context.fillStyle=color;context.fill()}
 context.save();try{
  context.beginPath();context.roundRect(box.x,box.y,box.width,box.height,font*.45);context.clip();context.fillStyle=background;context.fillRect(box.x,box.y,box.width,box.height)
  const left=box.x+pad,width=box.width-2*pad;context.fillStyle=ink
  const heading=label(spec.title,left,box.y+pad,width,font*1.2,2),noteFit=fitText(context,spec.note,width,4,small,small*5.2)
  if(noteFit.overflow||noteFit.size<small-.01)fail()
  const noteHeight=spec.note?noteFit.lines.length*noteFit.size*1.3:0,body:Rect={x:left,y:box.y+pad+heading+font*.45,width,height:box.height-2*pad-heading-font*.75-noteHeight}
  context.fillStyle=muted;if(spec.note)label(spec.note,left,box.y+box.height-pad-noteHeight,width,small,4)
  if(body.height<font*4)fail()
  context.fillStyle=ink
  if(spec.kind==='curve'&&state.kind==='curve'){
   const readout=label('x: '+scienceNumber(state.tip.x)+(spec.xUnit?' '+spec.xUnit:'')+'  ·  y: '+unit(state.tip.y),body.x,body.y,body.width,font,2),plot={x:body.x+font*3.6,y:body.y+readout+font*.5,width:body.width-font*4,height:body.height-readout-font*2.9}
   if(plot.width<font*3||plot.height<font*2)fail()
   const map=(p:SciencePoint)=>({x:plot.x+(p.x-spec.xDomain[0])/(spec.xDomain[1]-spec.xDomain[0])*plot.width,y:plot.y+(1-(p.y-spec.yDomain[0])/(spec.yDomain[1]-spec.yDomain[0]))*plot.height})
   for(const f of [0,.5,1]){const y=plot.y+(1-f)*plot.height;path([{x:plot.x,y},{x:plot.x+plot.width,y}],p=>p,grid,1);context.fillStyle=muted;label(scienceNumber(spec.yDomain[0]+(spec.yDomain[1]-spec.yDomain[0])*f),plot.x-font*.35,y-small*.55,font*3.2,small,1,'right')}
   path([{x:plot.x,y:plot.y},{x:plot.x,y:plot.y+plot.height},{x:plot.x+plot.width,y:plot.y+plot.height}],p=>p,muted,Math.max(1,font*.06));path(state.points,map,spec.color,Math.max(2,font*.12));if(spec.showDot)dot(map(state.tip),spec.color)
   context.fillStyle=muted;label(scienceNumber(spec.xDomain[0]),plot.x,plot.y+plot.height+font*.25,plot.width/2,small);label(scienceNumber(spec.xDomain[1]),plot.x+plot.width,plot.y+plot.height+font*.25,plot.width/2,small,1,'right');label(spec.xUnit,plot.x+plot.width/2,plot.y+plot.height+font*1.25,plot.width,small,1,'center')
  }else if(spec.kind==='ratio'&&state.kind==='ratio'){
   const readout=label('当前 '+unit(state.currentTotal)+' / '+unit(state.total),body.x,body.y,body.width,font,2),top=body.y+readout+font*.6,available=body.height-readout-font*.6,legendWidth=spec.mode==='bar'?body.width:body.width*.45
   const percent=(value:number)=>(value>0&&value<.001?'<0.001':scienceNumber(value))+'%',partValue=(p:typeof state.parts[number])=>(p.targetValue>=.001&&p.value>0&&p.value<.001?'<0.001':scienceNumber(p.value))+(spec.unit?' '+spec.unit:''),full=(p:typeof state.parts[number])=>p.label+' '+partValue(p)+' ('+percent(p.fraction*100)+')'
   // Reserve the dataset's display range before animation, so growing decimals
   // never switch a legend between one and two rows during playback.
   const stacked=state.parts.some(p=>{const digits=Math.max(1,Math.min(4,Math.floor(Math.log10(p.targetValue||1))+1)),maximum=p.targetValue===0?'0':p.targetValue<.001?'8.88e-888':'8'.repeat(digits)+'.888';return [maximum,'<0.001'].some(value=>{const text=p.label+' '+value+(spec.unit?' '+spec.unit:'')+' (88.888%)',fit=fitText(context,text,legendWidth-font*.55,1,font,font*1.3);return fit.overflow||fit.size<small-.01})}),legendStep=stacked?font*1.3+small*1.3+font*.3:font*1.55
   let legendX=body.x,legendY=top+font*2.1
   if(spec.mode==='bar'){
    if(available<font*2.1+state.parts.length*legendStep)fail()
    context.fillStyle=grid;context.fillRect(body.x,top,body.width,font)
    for(const p of state.parts){context.fillStyle=p.color;context.fillRect(body.x+p.start*body.width,top,(p.end-p.start)*body.width,font)}
   }else{
    if(available<state.parts.length*legendStep)fail()
    const radius=Math.min(body.width*.23,available*.44),cx=body.x+body.width*.25,cy=top+available/2;context.fillStyle=grid;context.beginPath();context.arc(cx,cy,radius,0,Math.PI*2);context.fill()
    for(const p of state.parts)if(p.end>p.start){context.beginPath();context.moveTo(cx,cy);context.arc(cx,cy,radius,p.start*Math.PI*2-Math.PI/2,p.end*Math.PI*2-Math.PI/2);context.closePath();context.fillStyle=p.color;context.fill()}
    if(spec.mode==='ring'){context.beginPath();context.arc(cx,cy,radius*.58,0,Math.PI*2);context.fillStyle=background;context.fill()}
    legendX=body.x+body.width*.55;legendY=top+(available-state.parts.length*legendStep)/2
   }
   for(const [i,p]of state.parts.entries()){
    const x=legendX+font*.55,y=legendY+i*legendStep;dot({x:legendX+font*.15,y:y+font*.55},p.color,font*.14);context.fillStyle=ink
    if(stacked){label(p.label,x,y,legendWidth-font*.55,font,1);context.fillStyle=muted;label(partValue(p)+' ('+percent(p.fraction*100)+')',x,y+font*1.3,legendWidth-font*.55,small,1)}else label(full(p),x,y,legendWidth-font*.55,font,1)
   }
  }else if(spec.kind==='flow'&&state.kind==='flow'){
   const readout=label((spec.mode==='drill'?'当前深度 ':'流动进度 ')+unit(state.value),body.x,body.y,body.width,font,2),plot={x:body.x+font*.5,y:body.y+readout+font*.6,width:body.width-font,height:body.height-readout-font*1.2},map=(p:SciencePoint)=>({x:plot.x+p.x*plot.width,y:plot.y+p.y*plot.height})
   if(plot.height<font*2)fail()
   path(spec.path,map,grid,Math.max(3,font*.24));path(state.points,map,spec.color,Math.max(2,font*.1));if(spec.mode==='drill')dot(map(state.tip),spec.color,font*.3);else for(const p of state.dots)dot(map(p),spec.color,font*.18)
   for(let i=1;i<spec.path.length;i++){const a=map(spec.path[i-1]),b=map(spec.path[i]),angle=Math.atan2(b.y-a.y,b.x-a.x),size=font*.24;path([{x:b.x-Math.cos(angle-.55)*size,y:b.y-Math.sin(angle-.55)*size},b,{x:b.x-Math.cos(angle+.55)*size,y:b.y-Math.sin(angle+.55)*size}],p=>p,muted,Math.max(1,font*.07))}
  }else if(spec.kind==='array'&&state.kind==='array'){
   const readout=label('总数 '+unit(state.total)+' · 重排 '+scienceNumber(state.progress*100)+'%',body.x,body.y,body.width,font,2),plot={x:body.x,y:body.y+readout+font*.5,width:body.width,height:body.height-readout-font*.5}
   for(const g of state.groups){const x=plot.x+g.x*plot.width,y=plot.y+g.y*plot.height,w=g.width*plot.width,h=g.height*plot.height;if(h<small*3.5)fail();context.strokeStyle=grid;context.lineWidth=1;context.strokeRect(x,y,w,h);context.fillStyle=ink;if(state.progress>=.9)label('目标 '+g.label+' '+unit(g.count),x+font*.2,y+font*.15,w-font*.4,small,1)}
   for(const item of state.items){const w=item.width*plot.width,h=item.height*plot.height,x=plot.x+item.x*plot.width-w/2,y=plot.y+item.y*plot.height-h/2;context.fillStyle=item.color;context.fillRect(x,y,w,h);if(Math.min(w,h)>=small*1.6){context.fillStyle='#102039';label(String(item.id),x+w/2,y+(h-small*1.3)/2,w,small,1,'center')}}
  }
 }finally{context.restore()}
}
