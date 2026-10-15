import {QUALITY_LIMITS} from '../composition-quality.js'
import type {PaintedText,PaintedBacking} from '../composition-quality.js'
import {canvasPaintRole} from './canvas-paint-role.js'
/** Observe every native label, including dedicated cards and independent text
 * layers. Pixels and drawing order are unchanged; restoration also covers errors. */
export async function traceCanvasText(context:CanvasRenderingContext2D,paint:()=>Promise<void>):Promise<{texts:PaintedText[];backings:PaintedBacking[];omittedTexts:number}> {
 const original=context.fillText,originalRect=context.fillRect,texts:PaintedText[]=[],backings:PaintedBacking[]=[];let omittedTexts=0,order=0
 context.fillRect=function(x:number,y:number,width:number,height:number):void {
  const currentOrder=order++
  if(canvasPaintRole(context)==='caption-background'&&context.globalAlpha>.1){
   if(backings.length>=QUALITY_LIMITS.textsPerSample)omittedTexts++;else{const m=context.getTransform(),points=[[x,y],[x+width,y],[x,y+height],[x+width,y+height]].map(([px,py])=>({x:m.a*px+m.c*py+m.e,y:m.b*px+m.d*py+m.f})),xs=points.map(p=>p.x),ys=points.map(p=>p.y);backings.push({x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys),order:currentOrder})}
  }
  originalRect.call(context,x,y,width,height)
 }
 context.fillText=function(text:string,x:number,y:number,maxWidth?:number):void {
  const currentOrder=order++
  if(text.trim()&&context.globalAlpha>.1){
   if(texts.length>=QUALITY_LIMITS.textsPerSample)omittedTexts++;else{
   const metrics=context.measureText(text),fontPixels=Number(/([0-9.]+)px/.exec(context.font)?.[1]??12),scale=maxWidth===undefined?1:Math.min(1,maxWidth/Math.max(1,metrics.width)),left=x-(metrics.actualBoundingBoxLeft??0)*scale,right=x+(metrics.actualBoundingBoxRight??metrics.width)*scale,top=y-(metrics.actualBoundingBoxAscent??fontPixels),bottom=y+(metrics.actualBoundingBoxDescent??fontPixels*.2),matrix=context.getTransform(),corners=[[left,top],[right,top],[left,bottom],[right,bottom]].map(([px,py])=>({x:matrix.a*px+matrix.c*py+matrix.e,y:matrix.b*px+matrix.d*py+matrix.f})),xs=corners.map(p=>p.x),ys=corners.map(p=>p.y)
   texts.push({text:text.slice(0,200),x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys),fontPixels:fontPixels*Math.hypot(matrix.c,matrix.d),order:currentOrder,...(canvasPaintRole(context)?{role:canvasPaintRole(context)}:{})})
   }
  }
  if(maxWidth===undefined)original.call(context,text,x,y);else original.call(context,text,x,y,maxWidth)
 }
 try{await paint();return {texts,backings,omittedTexts}}finally{context.fillText=original;context.fillRect=originalRect}
}
