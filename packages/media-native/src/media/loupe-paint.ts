import type {FocusInterval} from '../focus-contract.js'
import type {SourceRect} from '../card-details.js'
interface Box {x:number;y:number;width:number;height:number}
/** A circular detail retains the full source context. Sampling uses a square in
 * source pixels, so text is magnified uniformly instead of stretched. */
export function paintLoupe(context:CanvasRenderingContext2D,source:HTMLCanvasElement|OffscreenCanvas,focus:FocusInterval,crop:SourceRect,area:Box,drawn:Box,strength:number):void {
 if(focus.mode!=='loupe'||strength<=0)return
 const radius=Math.min(area.width,area.height)*.2,corner=focus.loupeCorner??'top-right',x=corner.endsWith('right')?area.x+area.width-radius-8:area.x+radius+8,y=corner.startsWith('bottom')?area.y+area.height-radius-8:area.y+radius+8,scale=drawn.width/(source.width*crop.width),side=Math.min(crop.width*source.width,crop.height*source.height,2*radius/scale/focus.zoom),sx=Math.max(crop.x*source.width,Math.min((crop.x+crop.width)*source.width-side,focus.x*source.width-side/2)),sy=Math.max(crop.y*source.height,Math.min((crop.y+crop.height)*source.height-side,focus.y*source.height-side/2))
 context.save();context.globalAlpha*=strength;context.beginPath();context.arc(x,y,radius,0,Math.PI*2);context.clip();context.fillStyle='#151a22';context.fillRect(x-radius,y-radius,radius*2,radius*2);context.drawImage(source,sx,sy,side,side,x-radius,y-radius,radius*2,radius*2);context.restore();context.save();context.globalAlpha*=strength;context.strokeStyle='#ffcc33';context.lineWidth=3;context.beginPath();context.arc(x,y,radius,0,Math.PI*2);context.stroke();context.restore()
}
