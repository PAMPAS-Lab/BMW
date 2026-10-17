import {layerPackagingState,packagingPoint} from '../layer-packaging.js'
import type {LayerPackaging} from '../layer-packaging.js'

type Point={x:number;y:number}
/** Affine triangles approximate one perspective plane using a fixed sixteen-strip mesh. */
function triangle(context:CanvasRenderingContext2D,source:HTMLCanvasElement,a:Point,b:Point,c:Point,A:Point,B:Point,C:Point):void{
 const dx=b.x-a.x,dy=b.y-a.y,ex=c.x-a.x,ey=c.y-a.y,det=dx*ey-ex*dy
 if(Math.abs(det)<1e-9)return
 const m11=((B.x-A.x)*ey-(C.x-A.x)*dy)/det,m21=((C.x-A.x)*dx-(B.x-A.x)*ex)/det,m12=((B.y-A.y)*ey-(C.y-A.y)*dy)/det,m22=((C.y-A.y)*dx-(B.y-A.y)*ex)/det
 context.save();context.beginPath();context.moveTo(A.x,A.y);context.lineTo(B.x,B.y);context.lineTo(C.x,C.y);context.closePath();context.clip();context.transform(m11,m12,m21,m22,A.x-m11*a.x-m21*a.y,A.y-m12*a.x-m22*a.y);context.drawImage(source,0,0);context.restore()
}
/** Two reusable bounded surfaces per painter, released on disposal; no per-frame media cache. */
export class LayerPackagingPainter {
 private surfaces:HTMLCanvasElement[]=[]
 private surface(index:number,width:number,height:number):HTMLCanvasElement{
  const canvas=this.surfaces[index]??(this.surfaces[index]=document.createElement('canvas'))
  // RGB channel shifts read pixels. Choose the readback surface up front rather
  // than allowing Chromium to migrate it between GPU/CPU mid-animation.
  canvas.getContext('2d',{willReadFrequently:true})
  // Reset the bitmap and context state, including any former accumulation blend mode.
  canvas.width=width;canvas.height=height;return canvas
 }
 paint(context:CanvasRenderingContext2D,box:{x:number;y:number;width:number;height:number;opacity:number},value:LayerPackaging|undefined,local:number,draw:(context:CanvasRenderingContext2D,x:number,y:number)=>void):boolean{
  if(!value)return false
  const state=layerPackagingState(value,local)
  if(state.strength<=0||!value.flipDegrees&&!value.directionalBlurPixels&&!value.radialBlur&&!value.glitchPixels)return false
  const pad=Math.ceil(40+Math.max(box.width,box.height)*value.radialBlur),width=Math.ceil(box.width)+pad*2,height=Math.ceil(box.height)+pad*2
  let source=this.surface(0,width,height),target=this.surface(1,width,height)
  draw(source.getContext('2d')!,pad,pad)
  const accumulate=(paint:(context:CanvasRenderingContext2D,index:number)=>void)=>{const out=target.getContext('2d')!;out.clearRect(0,0,width,height);out.globalCompositeOperation='lighter';out.globalAlpha=.2;for(let i=0;i<5;i++)paint(out,i);out.globalAlpha=1;out.globalCompositeOperation='source-over';[source,target]=[target,source]}
  if(value.directionalBlurPixels)accumulate((out,i)=>out.drawImage(source,(i-2)/2*state.directionX,(i-2)/2*state.directionY))
  if(value.radialBlur)accumulate((out,i)=>{const scale=1+state.radial*i/4;out.drawImage(source,(1-scale)*width/2,(1-scale)*height/2,width*scale,height*scale)})
  if(state.glitchShift){
   const out=source.getContext('2d')!,image=out.getImageData(0,0,width,height),original=new Uint8ClampedArray(image.data)
   for(let y=0;y<height;y++)if((y+state.glitchBand)%37<9)for(let x=0;x<width;x++){const at=(y*width+x)*4,red=(y*width+Math.max(0,Math.min(width-1,x+state.glitchShift)))*4,blue=(y*width+Math.max(0,Math.min(width-1,x-state.glitchShift)))*4;image.data[at]=original[red];image.data[at+2]=original[blue+2]}
   out.putImageData(image,0,0)
  }
  context.save();try{
   context.globalAlpha=box.opacity;context.translate(box.x-pad,box.y-pad)
   if(!state.angle)context.drawImage(source,0,0)
   else for(let i=0;i<16;i++){
    const a=value.flipAxis==='y'?{x:width*i/16,y:0}:{x:0,y:height*i/16},b=value.flipAxis==='y'?{x:width*(i+1)/16,y:0}:{x:width,y:height*i/16},c=value.flipAxis==='y'?{x:width*(i+1)/16,y:height}:{x:width,y:height*(i+1)/16},d=value.flipAxis==='y'?{x:width*i/16,y:height}:{x:0,y:height*(i+1)/16},project=(p:Point)=>packagingPoint(p.x,p.y,width,height,value.flipAxis,state.angle),A=project(a),B=project(b),C=project(c),D=project(d)
    triangle(context,source,a,b,c,A,B,C);triangle(context,source,a,c,d,A,C,D)
   }
  }finally{context.restore()}
  return true
 }
 dispose():void{for(const canvas of this.surfaces){canvas.width=1;canvas.height=1}this.surfaces=[]}
}
