import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'

export const DRAWING_LIMITS=Object.freeze({shapes:128,points:4096,pathPoints:256,textCharacters:4096,canvasPixels:8_388_608,sourcePixels:16_777_216,maxDimension:16384})
export interface DrawingPoint {x:number;y:number}
export interface DrawingStyle {color:string;fill:string;lineWidth:number;opacity:number}
export type DrawingShape=DrawingStyle & (
  | {type:'rect'|'ellipse'|'redact';x:number;y:number;width:number;height:number}
  | {type:'line'|'arrow';x1:number;y1:number;x2:number;y2:number}
  | {type:'path';points:DrawingPoint[]}
  | {type:'text';x:number;y:number;text:string;fontSize:number;bold:boolean;maxWidth?:number;background:string}
)
export type ImageDrawingRequest=
  | {action:'media.image.annotate';artifactId:string;shapes:DrawingShape[]}
  | {action:'media.image.draw';width:number;height:number;background:string;shapes:DrawingShape[]}
export interface DrawingResult {kind:'drawing';width:number;height:number;shapeCount:number}
function keys(value:Record<string,unknown>,allowed:readonly string[]):void {
  if(Object.keys(value).some(key=>!allowed.includes(key)))throw new TypeError('Unsupported image drawing property.')
}
function color(value:unknown,fallback:string,allowNone=false):string {
  if(value===undefined)return fallback
  if(typeof value!=='string'||!(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)||(allowNone&&value==='none')))throw new TypeError('Drawing colors require #RRGGBB or #RRGGBBAA; fill/background may be none.')
  return value
}
export function assertImageDrawingRequest(raw:unknown):ImageDrawingRequest {
  const value=mediaRecord(raw),annotate=value.action==='media.image.annotate'
  if(!annotate&&value.action!=='media.image.draw')throw new TypeError('Unsupported image drawing action.')
  keys(value,annotate?['action','artifactId','shapes','tabId']:['action','width','height','background','shapes','tabId'])
  if(value.tabId!==undefined&&typeof value.tabId!=='string')throw new TypeError('tabId must be a string.')
  if(!Array.isArray(value.shapes)||value.shapes.length<1||value.shapes.length>DRAWING_LIMITS.shapes)throw new TypeError('Image drawing requires 1 to 128 shapes.')
  let points=0,characters=0
  const shapes:DrawingShape[]=value.shapes.map(raw=>{
    const item=mediaRecord(raw),type=item.type,common=['type','color','fill','lineWidth','opacity']
    const style:DrawingStyle={color:color(item.color,type==='redact'?'#000000':'#ff3b30'),fill:color(item.fill,'none',true),lineWidth:finiteNumber(item.lineWidth??4,'lineWidth',1,64),opacity:finiteNumber(item.opacity??1,'opacity',.05,1)}
    const coordinate=(name:string)=>finiteNumber(item[name],name,0,DRAWING_LIMITS.maxDimension)
    if(type==='rect'||type==='ellipse'||type==='redact'){
      keys(item,[...common,'x','y','width','height'])
      if(type==='redact'&&(style.opacity!==1||!/^#[0-9a-f]{6}$/i.test(style.color)||style.fill!=='none'))throw new TypeError('Redaction requires an opaque six-digit color with no fill override.')
      return {...style,type,x:coordinate('x'),y:coordinate('y'),width:finiteNumber(item.width,'shape width',1,DRAWING_LIMITS.maxDimension),height:finiteNumber(item.height,'shape height',1,DRAWING_LIMITS.maxDimension)}
    }
    if(type==='line'||type==='arrow'){
      keys(item,[...common,'x1','y1','x2','y2'])
      const x1=coordinate('x1'),y1=coordinate('y1'),x2=coordinate('x2'),y2=coordinate('y2')
      if(x1===x2&&y1===y2)throw new TypeError('Line endpoints must differ.')
      return {...style,type,x1,y1,x2,y2}
    }
    if(type==='path'){
      keys(item,[...common,'points'])
      if(!Array.isArray(item.points)||item.points.length<2||item.points.length>DRAWING_LIMITS.pathPoints)throw new TypeError('A path requires 2 to 256 points.')
      points+=item.points.length;if(points>DRAWING_LIMITS.points)throw new TypeError('Image drawing exceeds its shared point budget.')
      return {...style,type,points:item.points.map(raw=>{const p=mediaRecord(raw);keys(p,['x','y']);return {x:finiteNumber(p.x,'point x',0,DRAWING_LIMITS.maxDimension),y:finiteNumber(p.y,'point y',0,DRAWING_LIMITS.maxDimension)}})}
    }
    if(type==='text'){
      keys(item,[...common,'x','y','text','fontSize','bold','maxWidth','background'])
      if(typeof item.text!=='string'||!item.text.trim()||item.text.length>512||/[\u0000-\u0008\u000b-\u001f]/.test(item.text)||item.text.split('\n').length>16)throw new TypeError('Text requires 1 to 512 characters and at most 16 lines.')
      characters+=item.text.length;if(characters>DRAWING_LIMITS.textCharacters)throw new TypeError('Image drawing exceeds its shared text budget.')
      if(item.bold!==undefined&&typeof item.bold!=='boolean')throw new TypeError('bold must be boolean.')
      return {...style,type,x:coordinate('x'),y:coordinate('y'),text:item.text,fontSize:finiteNumber(item.fontSize??24,'fontSize',8,128),bold:item.bold===true,background:color(item.background,'none',true),...(item.maxWidth===undefined?{}:{maxWidth:finiteNumber(item.maxWidth,'text maxWidth',1,DRAWING_LIMITS.maxDimension)})}
    }
    throw new TypeError('Shapes support rect, ellipse, line, arrow, path, text and redact only.')
  })
  if(annotate)return {action:'media.image.annotate',artifactId:assertArtifactId(value.artifactId),shapes}
  const width=finiteNumber(value.width,'canvas width',32,4096,true),height=finiteNumber(value.height,'canvas height',32,4096,true)
  if(width*height>DRAWING_LIMITS.canvasPixels)throw new TypeError('Drawing canvas exceeds the 8 megapixel limit.')
  const request:ImageDrawingRequest={action:'media.image.draw',width,height,background:color(value.background,'#ffffff',true),shapes}
  assertDrawingBounds(shapes,width,height)
  return request
}
/** Coordinates are source-image pixels, never CSS viewport or normalized units. */
export function assertDrawingBounds(shapes:readonly DrawingShape[],width:number,height:number):void {
  const point=(x:number,y:number)=>{if(x<0||y<0||x>width||y>height)throw new TypeError('Drawing shape is outside the image. Use actual image pixel dimensions.')}
  for(const s of shapes){
    if(s.type==='rect'||s.type==='ellipse'||s.type==='redact'){point(s.x,s.y);point(s.x+s.width,s.y+s.height)}
    else if(s.type==='line'||s.type==='arrow'){point(s.x1,s.y1);point(s.x2,s.y2)}
    else if(s.type==='path')for(const p of s.points)point(p.x,p.y)
    else if(s.type==='text'){point(s.x,s.y);point(s.x+(s.maxWidth??1),s.y+s.fontSize)}
  }
}
export function assertDrawingResult(raw:unknown,request:ImageDrawingRequest):DrawingResult {
  const value=mediaRecord(raw);keys(value,['kind','width','height','shapeCount'])
  const width=finiteNumber(value.width,'drawing width',1,DRAWING_LIMITS.maxDimension,true),height=finiteNumber(value.height,'drawing height',1,DRAWING_LIMITS.maxDimension,true)
  if(value.kind!=='drawing'||width*height>DRAWING_LIMITS.sourcePixels||value.shapeCount!==request.shapes.length)throw new TypeError('Invalid drawing result.')
  if(request.action==='media.image.draw'&&(width!==request.width||height!==request.height))throw new TypeError('Drawing result dimensions mismatch.')
  assertDrawingBounds(request.shapes,width,height)
  return {kind:'drawing',width,height,shapeCount:request.shapes.length}
}
