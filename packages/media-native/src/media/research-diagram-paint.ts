import {eventState,measurementFraction} from '../research-diagrams.js'
import type {ResearchDiagram,EventElement} from '../research-diagrams.js'
import {COMPOSITION_FONT,fitText} from './composition-text.js'
interface Rect{x:number;y:number;width:number;height:number}
const axisText=(value:number)=>{if(value!==0&&(Math.abs(value)<.001||Math.abs(value)>=1e4)){const [n,e]=value.toExponential(1).split('e');return Number(n)+'e'+Number(e)}return String(Number(value.toPrecision(4)))}
export function paintResearchDiagram(ctx:CanvasRenderingContext2D,spec:ResearchDiagram,local:number,box:Rect,frameWidth:number,frameHeight:number):void {
 const font=Math.max(14,16*frameHeight/720,12*frameWidth/390),ink=spec.theme==='dark'?'#edf5ff':'#14283c',muted=spec.theme==='dark'?'#b7c9df':'#41556a',bg=spec.theme==='dark'?'#122039':'#f5f8fc'
 const fail=(detail='')=>{throw new Error('STUDIO_DIAGRAM_LAYOUT: '+spec.title+' — Research diagram needs more space or shorter labels. '+detail)}
 const label=(text:string,x:number,y:number,w:number,h:number,size=font)=>{const fit=fitText(ctx,text,w,Math.max(1,Math.floor(h/(size*1.3))),size,h);if(fit.overflow||fit.size<font*.82)fail('Text '+JSON.stringify(text)+'; available '+Math.round(w)+'x'+Math.round(h)+', minimum font '+Math.round(font*.82)+'; each text line needs at least '+Math.ceil(font*.82*1.3)+' px of available height after padding/memory bar. Enlarge the element height or split content into another diagram.');ctx.font=`600 ${fit.size}px ${COMPOSITION_FONT}`;ctx.textAlign='left';ctx.textBaseline='top';fit.lines.forEach((line,i)=>ctx.fillText(line,x,y+i*fit.size*1.3))}
 if(box.width<font*12||box.height<font*9)fail()
 ctx.save();try{
 ctx.beginPath();ctx.rect(box.x,box.y,box.width,box.height);ctx.clip();ctx.fillStyle=bg;ctx.fillRect(box.x,box.y,box.width,box.height);ctx.fillStyle=ink;label(spec.title,box.x+font,box.y+font,box.width-2*font,2*font,font*1.15)
 const body={x:box.x+font,y:box.y+font*3,width:box.width-font*2,height:box.height-font*6};ctx.fillStyle=muted;label(spec.note,box.x+font,box.y+box.height-font*2.5,box.width-font*2,font*2)
 if(spec.kind==='events'){
  const elements=eventState(spec,local)
  const draw=(element:EventElement,parent:Rect)=>{
   const r={x:parent.x+element.x*parent.width,y:parent.y+element.y*parent.height,width:element.width*parent.width,height:element.height*parent.height}
   ctx.save();try{ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();ctx.fillStyle=element.active&&!element.codeLines?element.color:spec.theme==='dark'?'#24364d':'#e1e8f0';ctx.fillRect(r.x,r.y,r.width,r.height);ctx.strokeStyle=element.color;ctx.lineWidth=element.active?3:1;ctx.strokeRect(r.x+1,r.y+1,r.width-2,r.height-2)
    if(element.kind==='group'){
     const children=elements.filter(e=>e.parentId===element.id)
     if(element.layout==='stack'){
      const panels=children.map(child=>{const pad=font*.35,width=r.width*child.width,fit=fitText(ctx,child.text,width-2*pad,8,font,8*font*1.3);if(fit.overflow)fail('Group '+element.id+' panel '+child.id+' needs a wider text area.');return {child,height:Math.max(font*2,(child.codeLines?child.codeLines.length+1:fit.lines.length)*font*1.3+2*pad+(child.kind==='memory'?font:0))}}),required=panels.length?font*.7+panels.reduce((sum,p)=>sum+p.height,0)+Math.max(0,panels.length-1)*font*.35:0
      if(required>r.height)fail('Group '+element.id+' stack requires '+Math.ceil(required)+' px but has '+Math.floor(r.height)+' px. Enlarge both the enclosing diagram layer and the group height, or split panels. Stack rows size from readable text; changing child.height does not shrink them.')
      let top=font*.35;for(const {child,height}of panels){draw({...child,y:top/r.height,height:height/r.height},r);top+=height+font*.35}
     }else for(const child of children)draw(child,r)
     return
    }
    const pad=font*.3;ctx.fillStyle=element.active?'#102039':ink
    if(element.codeLines){
     const lineHeight=font*1.3;if(r.height-2*pad<(element.codeLines.length+1)*lineHeight)fail('Code panel '+element.id+' has '+Math.floor(r.height-2*pad)+' px after padding; needs '+Math.ceil((element.codeLines.length+1)*lineHeight)+' px for one title row and '+element.codeLines.length+' code rows. Increase this panel height or split the code lines.')
     ctx.fillStyle=ink;label(element.text,r.x+pad,r.y+pad,r.width-pad*2,lineHeight)
     element.codeLines.forEach((line,i)=>{const top=r.y+pad+(i+1)*lineHeight;if(element.highlightLine===i+1){ctx.fillStyle=element.color;ctx.fillRect(r.x+pad,top,r.width-pad*2,lineHeight)}ctx.fillStyle=element.highlightLine===i+1?'#102039':ink;label((i+1)+' '+line,r.x+pad,top,r.width-pad*2,lineHeight)})
    }else label(element.text,r.x+pad,r.y+pad,r.width-pad*2,r.height-pad*2-(element.kind==='memory'?font:0))
    if(element.kind==='memory'){ctx.fillStyle=element.color;ctx.fillRect(r.x+pad,r.y+r.height-font*.8,(r.width-2*pad)*element.value,font*.5)}
   }finally{ctx.restore()}
  }
  for(const e of elements.filter(e=>!e.parentId))draw(e,body)
 }else{
  ctx.font=`600 ${font}px ${COMPOSITION_FONT}`
  const legend=spec.series.map(s=>({text:s.label+' · '+spec.unit,width:Math.ceil(ctx.measureText(s.label+' · '+spec.unit).width)+font})),legendRow=legend.reduce((n,s)=>n+s.width,0)<=body.width,legendHeight=(legendRow?1:spec.series.length)*font*1.45,plot={x:body.x+font*4,y:body.y+legendHeight+font*1.6,width:body.width-font*5,height:body.height-legendHeight-font*4.6}
  if(plot.width<font*5||plot.height<font*3)fail('Plot has '+Math.floor(plot.width)+'x'+Math.floor(plot.height)+' px after legend and axes; needs at least '+Math.ceil(font*5)+'x'+Math.ceil(font*3)+' px. Increase the diagram layer width/height; shortening the note does not change these axis/legend reservations.')
  let legendX=body.x;spec.series.forEach((s,i)=>{ctx.fillStyle=s.color;label(legend[i].text,legendRow?legendX:body.x,body.y+(legendRow?0:i*font*1.45),legendRow?legend[i].width:body.width,font*1.4);legendX+=legend[i].width})
  const x=(v:number)=>plot.x+measurementFraction(v,spec.xDomain,spec.xScale)*plot.width,y=(v:number)=>plot.y+(1-measurementFraction(v,spec.yDomain,spec.yScale))*plot.height
  ctx.strokeStyle=muted;ctx.lineWidth=1
  for(const f of [0,.5,1]){const value=spec.yScale==='log'?spec.yDomain[0]*Math.pow(spec.yDomain[1]/spec.yDomain[0],f):spec.yDomain[0]+(spec.yDomain[1]-spec.yDomain[0])*f,at=y(value);ctx.beginPath();ctx.moveTo(plot.x,at);ctx.lineTo(plot.x+plot.width,at);ctx.stroke();ctx.fillStyle=muted;label(axisText(value),body.x,at-font*.5,font*3.8,font*1.4)}
  ctx.fillStyle=muted;label(spec.yScale+' · '+spec.unit,plot.x,plot.y-font*1.3,plot.width,font*1.4)
  if(spec.mode==='grouped-bar'){
   const cell=plot.width/spec.categories.length,w=cell*.7/spec.series.length
   spec.categories.forEach((name,i)=>label(name,plot.x+i*cell,plot.y+plot.height+font*.3,cell*.95,font*1.5))
   for(const [i,s]of spec.series.entries())for(const p of s.points){const left=plot.x+(p.x+.15)*cell+i*w,top=y(p.y),zero=y(spec.baseline);ctx.fillStyle=s.color;ctx.fillRect(left,Math.min(top,zero),w*.85,Math.max(1,Math.abs(top-zero)))}
  }else{
   for(const s of spec.series)for(const p of s.points){ctx.beginPath();ctx.arc(x(p.x),y(p.y),font*.22,0,2*Math.PI);ctx.fillStyle=s.color;ctx.fill()}
   ctx.fillStyle=muted;label(axisText(spec.xDomain[0]),plot.x,plot.y+plot.height+font*.3,plot.width*.45,font*1.5);label(axisText(spec.xDomain[1]),plot.x+plot.width*.7,plot.y+plot.height+font*.3,plot.width*.3,font*1.5)
  }
  ctx.fillStyle=muted;label(spec.xUnit+' · '+spec.xScale,plot.x,plot.y+plot.height+font*1.7,plot.width,font*1.5)
 }
 }finally{ctx.restore()}
}
