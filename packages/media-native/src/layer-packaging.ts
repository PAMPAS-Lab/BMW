import {finiteNumber,mediaRecord} from './media-contract.js'

/** Finite entry treatments; no CSS, shaders, scripts or external resources. */
export interface LayerPackaging {
 introSeconds:number;offsetSeconds:number;flipAxis:'x'|'y';flipDegrees:number
 directionalBlurPixels:number;directionalBlurDegrees:number;radialBlur:number
 glitchPixels:number;glitchHertz:number
}
export const DEFAULT_LAYER_PACKAGING:Readonly<LayerPackaging>={introSeconds:.6,offsetSeconds:0,flipAxis:'y',flipDegrees:0,directionalBlurPixels:0,directionalBlurDegrees:0,radialBlur:0,glitchPixels:0,glitchHertz:12}
const ranges={introSeconds:[.05,8],offsetSeconds:[0,720],flipDegrees:[-85,85],directionalBlurPixels:[0,24],directionalBlurDegrees:[-180,180],radialBlur:[0,.15],glitchPixels:[0,12],glitchHertz:[1,24]} as const
export const layerPackagingSchema={type:'object',additionalProperties:false,properties:{flipAxis:{enum:['x','y']},...Object.fromEntries(Object.entries(ranges).map(([key,[minimum,maximum]])=>[key,{type:'number',minimum,maximum}]))}}
export function assertLayerPackaging(raw:unknown):LayerPackaging {
 const v=mediaRecord(raw),d=DEFAULT_LAYER_PACKAGING
 if(Object.keys(v).some(k=>!Object.hasOwn(d,k)))throw new TypeError('Unsupported layer packaging field.')
 const flipAxis=v.flipAxis===undefined?d.flipAxis:v.flipAxis;if(flipAxis!=='x'&&flipAxis!=='y')throw new TypeError('Invalid perspective flip axis.')
 return {flipAxis,...Object.fromEntries(Object.entries(ranges).map(([key,[min,max]])=>[key,finiteNumber(v[key]===undefined?d[key as keyof typeof ranges]:v[key],key,min,max)]))} as LayerPackaging
}
export interface PackagingState {strength:number;angle:number;directionX:number;directionY:number;radial:number;glitchShift:number;glitchBand:number}
/** Absolute source clock makes reverse seeks and repeated cuts independent of frame history. */
export function layerPackagingState(value:LayerPackaging,local:number):PackagingState {
 if(!Number.isFinite(local))throw new TypeError('Invalid packaging time.')
 const t=Math.round(Math.max(0,local+value.offsetSeconds)*1e6)/1e6,p=Math.max(0,Math.min(1,t/value.introSeconds)),strength=1-p*p*(3-2*p),direction=value.directionalBlurDegrees*Math.PI/180,tick=Math.floor(t*value.glitchHertz+1e-9)
 return {strength,angle:value.flipDegrees*strength*Math.PI/180,directionX:Math.cos(direction)*value.directionalBlurPixels*strength,directionY:Math.sin(direction)*value.directionalBlurPixels*strength,radial:value.radialBlur*strength,glitchShift:Math.round(value.glitchPixels*strength*((tick*17+13)%7-3)/3),glitchBand:(tick*13)%37}
}
/** Project a rotated plane with a fixed camera distance and no arbitrary 3D scene. */
export function packagingPoint(x:number,y:number,width:number,height:number,axis:'x'|'y',angle:number):{x:number;y:number}{
 const u=x-width/2,v=y-height/2,focal=2*Math.max(width,height),depth=(axis==='y'?-u:v)*Math.sin(angle),scale=focal/(focal+depth)
 return {x:width/2+u*(axis==='y'?Math.cos(angle):1)*scale,y:height/2+v*(axis==='x'?Math.cos(angle):1)*scale}
}
