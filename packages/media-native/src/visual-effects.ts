import {finiteNumber,mediaRecord} from './media-contract.js'
/** Numeric visual effects only: no caller CSS, URLs, shaders or executable data. */
export interface VisualEffects {brightness:number;contrast:number;saturation:number;blurPixels:number}
export const DEFAULT_VISUAL_EFFECTS:Readonly<VisualEffects>={brightness:1,contrast:1,saturation:1,blurPixels:0}
export const visualEffectsSchema={type:'object',additionalProperties:false,properties:{brightness:{type:'number',minimum:.25,maximum:2},contrast:{type:'number',minimum:0,maximum:2},saturation:{type:'number',minimum:0,maximum:2},blurPixels:{type:'number',minimum:0,maximum:12}}}
export function assertVisualEffects(raw:unknown):VisualEffects {
 const v=mediaRecord(raw)
 if(Object.keys(v).some(key=>!['brightness','contrast','saturation','blurPixels'].includes(key)))throw new TypeError('Unsupported visual effect.')
 return {brightness:finiteNumber(v.brightness===undefined?1:v.brightness,'brightness',.25,2),contrast:finiteNumber(v.contrast===undefined?1:v.contrast,'contrast',0,2),saturation:finiteNumber(v.saturation===undefined?1:v.saturation,'saturation',0,2),blurPixels:finiteNumber(v.blurPixels===undefined?0:v.blurPixels,'blur',0,12)}
}
export function hasVisualEffects(effects:VisualEffects):boolean{return effects.brightness!==1||effects.contrast!==1||effects.saturation!==1||effects.blurPixels!==0}
/** Both native painters use this fixed filter order and the same output-pixel blur. */
export function visualEffectFilter(effects?:VisualEffects):string {
 if(!effects||!hasVisualEffects(effects))return 'none'
 return `brightness(${effects.brightness}) contrast(${effects.contrast}) saturate(${effects.saturation}) blur(${effects.blurPixels}px)`
}
