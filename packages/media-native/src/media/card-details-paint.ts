import type {CardHighlight,CardReading,SourceRect,DetailedCardSpec} from '../card-details.js'
import {fitText,COMPOSITION_FONT,captionBacking} from './composition-text.js'
import {withCanvasPaintRole} from './canvas-paint-role.js'
import type {CardCue} from '../card-cues.js'
export interface CardArea {x:number;y:number;width:number;height:number}
const mix=(a:number,b:number,p:number)=>a+(b-a)*p
/** Fixed recipe: bounded zoom, 600 ms easing, explicit dwell. Original presentation clock survives cuts. */
export function readingCrop(reading:CardReading|undefined,artifactId:string|undefined,base:SourceRect,seconds:number,duration:number):SourceRect {
 if(!reading)return base
 const targets=reading.targets.filter(t=>t.source.artifactId===artifactId);if(!targets.length)return base
 const detail=(r:SourceRect):SourceRect=>{const width=Math.min(base.width,Math.max(base.width/4,r.width*1.16)),height=Math.min(base.height,Math.max(base.height/4,r.height*1.16));return {x:Math.max(base.x,Math.min(base.x+base.width-width,r.x+r.width/2-width/2)),y:Math.max(base.y,Math.min(base.y+base.height-height,r.y+r.height/2-height/2)),width,height}}
 const views=reading.mode==='detail-to-whole'?[detail(targets[0].rect),base]:[base,...targets.map(t=>detail(t.rect)),...(reading.returnToWhole?[base]:[])]
 const dwell=duration/views.length,index=Math.min(views.length-1,Math.max(0,Math.floor(seconds/dwell))),previous=views[Math.max(0,index-1)],next=views[index],p=index===0?1:Math.min(1,(seconds-index*dwell)/Math.min(.6,dwell/3)),smooth=p*p*(3-2*p)
 return {x:mix(previous.x,next.x,smooth),y:mix(previous.y,next.y,smooth),width:mix(previous.width,next.width,smooth),height:mix(previous.height,next.height,smooth)}
}
/** Anchored reading uses original scene presentation time even after a visual
 * split. Source rectangles remain exact; no inferred word timing is introduced. */
export function speechReadingCrop(reading:CardReading,artifactId:string|undefined,base:SourceRect,seconds:number,cues:CardCue[]):SourceRect {
 const windows=cues.filter(c=>c.kind==='reading'&&reading.targets[c.index]?.source.artifactId===artifactId).sort((a,b)=>a.startSeconds-b.startSeconds)
 const detail=(index:number):SourceRect=>{const r=reading.targets[index].rect,width=Math.min(base.width,Math.max(base.width/4,r.width*1.16)),height=Math.min(base.height,Math.max(base.height/4,r.height*1.16));return {x:Math.max(base.x,Math.min(base.x+base.width-width,r.x+r.width/2-width/2)),y:Math.max(base.y,Math.min(base.y+base.height-height,r.y+r.height/2-height/2)),width,height}}
 const interpolate=(a:SourceRect,b:SourceRect,p:number):SourceRect=>{const q=Math.max(0,Math.min(1,p)),s=q*q*(3-2*q);return {x:mix(a.x,b.x,s),y:mix(a.y,b.y,s),width:mix(a.width,b.width,s),height:mix(a.height,b.height,s)}}
 let previous=base
 for(const cue of windows){if(seconds<cue.startSeconds)return previous;const next=detail(cue.index),transition=Math.min(.6,(cue.endSeconds-cue.startSeconds)/3);if(seconds<cue.startSeconds+transition)return interpolate(previous,next,(seconds-cue.startSeconds)/transition);if(seconds<cue.endSeconds)return next;if(reading.returnToWhole||reading.mode==='detail-to-whole'){if(seconds<cue.endSeconds+transition)return interpolate(next,base,(seconds-cue.endSeconds)/transition);previous=base}else previous=next}
 return previous
}
/** All three treatments operate on the already drawn source pixels in exactly the same transform. */
export function paintHighlights(context:CanvasRenderingContext2D,highlights:CardHighlight[]|undefined,artifactId:string|undefined,time:number,crop:SourceRect,draw:CardArea,cues?:CardCue[]):void {
 for(const [index,target]of (highlights??[]).entries()){const cue=cues?.find(c=>c.kind==='highlight'&&c.index===index);if(target.source.artifactId!==artifactId||time<(cue?.startSeconds??target.startSeconds)||time>=(cue?.endSeconds??target.endSeconds))continue
  for(const rect of target.rects){const box={x:draw.x+(rect.x-crop.x)/crop.width*draw.width,y:draw.y+(rect.y-crop.y)/crop.height*draw.height,width:rect.width/crop.width*draw.width,height:rect.height/crop.height*draw.height};context.save();context.globalAlpha=1
   if(target.style==='invert'){context.globalCompositeOperation='difference';context.fillStyle='#ffffff';context.fillRect(box.x,box.y,box.width,box.height)}
   else if(target.style==='fill'){context.fillStyle='#ffcc334d';context.fillRect(box.x,box.y,box.width,box.height)}
   else{context.strokeStyle='#ffcc33';context.lineWidth=2;context.strokeRect(box.x,box.y,box.width,box.height)}context.restore()
  }
 }
}
export function detailedVisualArea(spec:DetailedCardSpec|undefined,area:CardArea):CardArea{
 if(!spec)return area
 if(spec.templateId==='evidence/translation')return {...area,height:spec.reading?.mode==='whole-to-detail'&&spec.reading.targets[0]?.lineCount?240:150}
 if(spec.templateId==='evidence/person-quote')return {...area,width:spec.person.layout==='right'?area.width*.62:area.width,height:150}
 return area
}
export interface DetailedTextBox {kind:'quote'|'translation'|'attribution'|'person-name'|'person-role'|'diagram-node'|'diagram-relation'|'range-axis'|'range-condition';index:number;x:number;y:number;width:number;height:number}
export interface DetailedCardPalette {ink:string;muted:string;accent:string;panel:string;connection:string;mark:string;rangeFill:string}
export function detailedTextFits(context:import('./composition-text.js').TextMeasure,spec:DetailedCardSpec,W:number):boolean {
 const margin=W<600?24:48,width=W-margin*2,slots:{text:string;width:number;height:number;size:number;rows:number}[]=[]
 const add=(text:string,w:number,h:number,size:number,rows:number)=>slots.push({text,width:w,height:h,size,rows})
 if('quote'in spec){const w=spec.templateId==='evidence/person-quote'&&spec.person.layout==='right'?width*.62:width;add(spec.quote.excerpt,w,83,W<600?19:26,3);add(spec.quote.translation,w,80,W<600?19:26,3);add(spec.quote.attribution,width,28,13,1);if('person'in spec){const w=width*(spec.person.layout==='right'?.34:.25);add(spec.person.name,w,50,W<600?18:24,2);add(spec.person.role,w,70,W<600?14:18,3)}}
 if(spec.templateId==='diagram/to-target'){const w=W<600?width*.43:width/(spec.objects.length+1.2);for(const node of [...spec.objects,spec.target])add(node.label,w-16,node.imageArtifactId?28:68,W<600?20:26,node.imageArtifactId?1:3);add(spec.relation,width,38,20,1)}
 if(spec.templateId==='diagram/sequence'){spec.nodes.forEach((n,i)=>add(n.label,width*(spec.shape==='funnel'?1-i*.12:1)-32,76,W<600?22:28,3));add(spec.footnote+(spec.shape==='funnel'?' · 图宽非比例':''),width,50,16,2)}
 if(spec.templateId==='diagram/range'){add(spec.range.axisLabel,width,62,28,2);add(spec.range.condition,width,65,19,3)}
 return slots.every(s=>!fitText(context,s.text,s.width,s.rows,s.size,s.height).overflow)
}
export function paintDetailedCard(context:CanvasRenderingContext2D,spec:DetailedCardSpec,W:number,time:number,duration:number,assets:ReadonlyMap<string,{image?:HTMLCanvasElement}>|undefined,palette:DetailedCardPalette,onText?:(box:DetailedTextBox)=>void,cues?:CardCue[]):void {
 const margin=W<600?24:48,width=W-margin*2
 const draw=(text:string,area:CardArea,size:number,kind?:DetailedTextBox['kind'],index=0,rows=3,color=palette.ink)=>{
  const fitted=fitText(context,text,area.width,rows,size,area.height);if(fitted.overflow)throw new Error('STUDIO_TEXT_LAYOUT: 专用槽文字放不下，请缩短内容。')
  context.fillStyle=color;context.font=`600 ${fitted.size}px ${COMPOSITION_FONT}`
  fitted.lines.forEach((line,row)=>context.fillText(line,area.x,area.y+fitted.size+row*fitted.size*1.3))
  if(kind&&text)onText?.({kind,index,x:area.x/W,y:area.y/720,width:area.width/W,height:Math.max(fitted.size*1.3,fitted.lines.length*fitted.size*1.3)/720})
 }
 if('quote'in spec){
  const person='person'in spec?spec.person:undefined,right=person?.layout==='right',quoteWidth=right?width*.62:width
  const phoneQuote=spec.templateId==='evidence/translation'&&spec.reading?.mode!=='whole-to-detail'&&spec.reading?.targets.some(t=>t.lineCount!==undefined),quoteTop=phoneQuote?326:398
  const showTranslation=spec.quote.display==='simultaneous'||time>=duration/2
  draw(spec.quote.excerpt,{x:margin,y:quoteTop,width:quoteWidth,height:83},W<600?19:26,'quote',0,3)
  if(showTranslation&&spec.quote.translation){draw('译文',{x:margin,y:quoteTop+90,width:quoteWidth,height:20},14,undefined,0,1,palette.accent);draw(spec.quote.translation,{x:margin,y:quoteTop+113,width:quoteWidth,height:80},W<600?19:26,'translation',0,3)}
  withCanvasPaintRole(context,'attribution',()=>draw(spec.quote.attribution,{x:margin,y:quoteTop+204,width,height:28},13,'attribution',0,1,palette.muted))
  if(person){const image=person.artifactId?assets?.get(person.artifactId)?.image:undefined,area={x:W-margin-(right?width*.34:width*.25),y:236,width:width*(right?.34:.25),height:right?252:132};context.save();context.beginPath();context.roundRect(area.x,area.y,area.width,area.height,12);context.clip();context.fillStyle=palette.panel;context.fillRect(area.x,area.y,area.width,area.height)
   if(image){const scale=Math.min(area.width/image.width,area.height/image.height);context.drawImage(image,area.x+(area.width-image.width*scale)/2,area.y+(area.height-image.height*scale)/2,image.width*scale,image.height*scale)}context.restore()
   draw(person.name,{x:area.x,y:area.y+area.height+8,width:area.width,height:50},W<600?18:24,'person-name',0,2)
   draw(person.role,{x:area.x,y:area.y+area.height+58,width:area.width,height:70},W<600?14:18,'person-role',0,3,palette.muted)
  }
 }
 if(spec.templateId==='diagram/to-target'){
  const vertical=W<600,nodeWidth=vertical?width*.43:width/(spec.objects.length+1.2),targetArea={x:vertical?W-margin-nodeWidth:(W-nodeWidth)/2,y:vertical?355:482,width:nodeWidth,height:110}
  const node=(n:typeof spec.target,area:CardArea,index:number)=>{context.fillStyle=palette.panel;context.beginPath();context.roundRect(area.x,area.y,area.width,area.height,12);context.fill();const image=n.imageArtifactId?assets?.get(n.imageArtifactId)?.image:undefined;if(image){const scale=Math.min((area.width-12)/image.width,(area.height-40)/image.height);context.drawImage(image,area.x+(area.width-image.width*scale)/2,area.y+4,image.width*scale,image.height*scale)}draw(n.label,{x:area.x+8,y:area.y+(image?area.height-32:14),width:area.width-16,height:image?28:area.height-24},W<600?20:26,'diagram-node',index,image?1:3)}
  spec.objects.forEach((n,i)=>{const cue=cues?.find(c=>c.kind==='diagram'&&c.index===i);if(cue?time<cue.startSeconds:spec.motion==='reveal-items'&&time<i*Math.min(1.2,duration/4))return;const area={x:vertical?margin:margin+i*(width-nodeWidth)/(spec.objects.length-1),y:vertical?252+i*112:268,width:nodeWidth,height:92};node(n,area,i);const targetCue=cues?.find(c=>c.kind==='diagram'&&c.index===spec.objects.length);if(targetCue&&time<targetCue.startSeconds)return;const x1=vertical?area.x+area.width:area.x+area.width/2,y1=vertical?area.y+area.height/2:area.y+area.height,x2=vertical?targetArea.x:targetArea.x+targetArea.width/2,y2=vertical?targetArea.y+targetArea.height/2:targetArea.y;context.strokeStyle=palette.connection;context.lineWidth=2;context.beginPath();context.moveTo(x1,y1);context.lineTo(x2,y2);context.stroke();const angle=Math.atan2(y2-y1,x2-x1);context.beginPath();context.moveTo(x2,y2);context.lineTo(x2-10*Math.cos(angle-.4),y2-10*Math.sin(angle-.4));context.moveTo(x2,y2);context.lineTo(x2-10*Math.cos(angle+.4),y2-10*Math.sin(angle+.4));context.stroke()});const targetCue=cues?.find(c=>c.kind==='diagram'&&c.index===spec.objects.length);if(!targetCue||time>=targetCue.startSeconds)node(spec.target,targetArea,spec.objects.length);draw(spec.relation,{x:margin,y:580,width,height:38},20,'diagram-relation',0,1,palette.accent)
 }
 if(spec.templateId==='diagram/sequence'){
  const top=142,gap=18,nodeHeight=Math.min(94,(408-gap*(spec.nodes.length-1))/spec.nodes.length)
  const activeCue=cues?.find(c=>c.kind==='diagram'&&time>=c.startSeconds&&time<c.endSeconds),hasCues=cues?.some(c=>c.kind==='diagram')
  const active=activeCue?.index??(!hasCues&&spec.motion==='reveal-items'?Math.min(spec.nodes.length-1,Math.floor(Math.max(0,time)/(duration/spec.nodes.length))):-1)
  spec.nodes.forEach((n,i)=>{
   const w=width*(spec.shape==='funnel'?1-i*.12:1),x=(W-w)/2,y=top+i*(nodeHeight+gap),selected=i===active
   context.save();context.fillStyle=selected?palette.accent:palette.panel;context.beginPath();context.roundRect(x,y,w,nodeHeight,12);context.fill();context.strokeStyle=selected?palette.accent:palette.connection;context.lineWidth=selected?3:1;context.stroke()
   const activeInk=captionBacking(palette.accent).box.startsWith('#ffffff')?'#ffffff':'#172536'
   draw(n.label,{x:x+16,y:y+8,width:w-32,height:nodeHeight-16},W<600?22:28,'diagram-node',i,3,selected?activeInk:palette.ink)
   context.restore()
   if(i<spec.nodes.length-1){const cy=y+nodeHeight+3;context.strokeStyle=palette.connection;context.lineWidth=2;context.beginPath();context.moveTo(W/2,cy);context.lineTo(W/2,cy+gap-6);context.lineTo(W/2-4,cy+gap-10);context.moveTo(W/2,cy+gap-6);context.lineTo(W/2+4,cy+gap-10);context.stroke()}
  })
  withCanvasPaintRole(context,'footnote',()=>draw(spec.footnote+(spec.shape==='funnel'?' · 图宽非比例':''),{x:margin,y:568,width,height:50},16,'diagram-relation',0,2,palette.muted))
 }
 if(spec.templateId==='diagram/range'){
  const r=spec.range,left=margin+12,right=W-margin-12,y=420,map=(n:number)=>r.mode==='numeric'?left+(n-r.minimum)/(r.maximum-r.minimum)*(right-left):left
  draw(r.axisLabel,{x:margin,y:265,width,height:62},28,'range-axis',0,2)
  context.strokeStyle=palette.muted;context.lineWidth=2;context.beginPath();context.moveTo(left,y);context.lineTo(right,y);context.stroke();context.fillStyle=palette.rangeFill;const a=r.mode==='numeric'?map(r.start):left,b=r.mode==='numeric'?map(r.end):left+(right-left)*.55;context.fillRect(a,y-18,b-a,16)
  const thresholds=r.mode==='numeric'?r.thresholds.map(t=>({x:map(t),label:String(t)+r.unit})):r.thresholdLabels.map((label,i)=>({x:left+(right-left)*(i+1)/(r.thresholdLabels.length+1),label}))
  let previousRight=-Infinity
  for(const t of thresholds){const x=Math.max(left,Math.min(right-100,t.x-50)),labelY=r.mode==='numeric'&&x<previousRight?y+78:y+28;previousRight=x+100;context.strokeStyle=palette.mark;context.beginPath();context.moveTo(t.x,y-34);context.lineTo(t.x,y+18);context.stroke();draw(t.label,{x,y:labelY,width:100,height:50},16,undefined,0,2)}
  if(r.mode==='numeric'){draw(String(r.minimum)+r.unit,{x:left,y:365,width:120,height:30},16,undefined,0,1);draw(String(r.maximum)+r.unit,{x:Math.max(left,right-120),y:365,width:120,height:30},16,undefined,0,1)}else draw(r.regionLabel+' · 示意 / 非比例',{x:margin,y:510,width,height:45},20,undefined,0,2,palette.accent)
  draw(r.condition,{x:margin,y:560,width,height:65},19,'range-condition',0,3)
 }
}
