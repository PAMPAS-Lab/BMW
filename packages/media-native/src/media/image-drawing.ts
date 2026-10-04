import {assertDrawingBounds} from '../image-drawing-contract.js'
import type {DrawingShape} from '../image-drawing-contract.js'

/** Fixed Canvas primitives only: no HTML, SVG, remote assets or evaluated model code. */
export function paintDrawing(canvas:HTMLCanvasElement,shapes:readonly DrawingShape[]):void {
  assertDrawingBounds(shapes,canvas.width,canvas.height)
  const context=canvas.getContext('2d');if(!context)throw new Error('Image drawing canvas is unavailable.')
  for(const s of shapes){
    context.save()
    try{
      context.globalAlpha=s.opacity;context.strokeStyle=s.color;context.fillStyle=s.fill;context.lineWidth=s.lineWidth;context.lineCap='round';context.lineJoin='round'
      if(s.type==='redact'){context.globalAlpha=1;context.fillStyle=s.color;context.fillRect(Math.floor(s.x),Math.floor(s.y),Math.ceil(s.x+s.width)-Math.floor(s.x),Math.ceil(s.y+s.height)-Math.floor(s.y));continue}
      if(s.type==='text'){
        context.font=`${s.bold?'600':'400'} ${s.fontSize}px sans-serif`;context.textBaseline='top'
        const limit=s.maxWidth??canvas.width-s.x,lines:string[]=[]
        for(const paragraph of s.text.split('\n')){
          let line=''
          for(const character of paragraph){
            if(context.measureText(character).width>limit)throw new Error('Text does not fit its maxWidth; increase width or reduce fontSize.')
            if(line&&context.measureText(line+character).width>limit){lines.push(line);line=''}
            line+=character
          }
          lines.push(line)
        }
        const height=lines.length*s.fontSize*1.25
        if(s.y+height>canvas.height)throw new Error('Text does not fit the image height; move it or reduce fontSize.')
        if(s.background!=='none'){context.fillStyle=s.background;context.fillRect(s.x,s.y,Math.max(...lines.map(line=>context.measureText(line).width)),height)}
        context.fillStyle=s.color;lines.forEach((line,index)=>context.fillText(line,s.x,s.y+index*s.fontSize*1.25));continue
      }
      context.beginPath()
      if(s.type==='rect')context.rect(s.x,s.y,s.width,s.height)
      else if(s.type==='ellipse')context.ellipse(s.x+s.width/2,s.y+s.height/2,s.width/2,s.height/2,0,0,2*Math.PI)
      else if(s.type==='path'){context.moveTo(s.points[0].x,s.points[0].y);for(const p of s.points.slice(1))context.lineTo(p.x,p.y)}
      else if(s.type==='line'||s.type==='arrow'){
        context.moveTo(s.x1,s.y1);context.lineTo(s.x2,s.y2)
        if(s.type==='arrow'){
          const angle=Math.atan2(s.y2-s.y1,s.x2-s.x1),length=Math.min(Math.hypot(s.x2-s.x1,s.y2-s.y1)*.5,Math.max(10,s.lineWidth*3))
          context.moveTo(s.x2-length*Math.cos(angle-Math.PI/6),s.y2-length*Math.sin(angle-Math.PI/6));context.lineTo(s.x2,s.y2);context.lineTo(s.x2-length*Math.cos(angle+Math.PI/6),s.y2-length*Math.sin(angle+Math.PI/6))
        }
      }
      if(s.fill!=='none'&&(s.type==='rect'||s.type==='ellipse'))context.fill()
      context.stroke()
    }finally{context.restore()}
  }
}
