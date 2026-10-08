import type {FeatureStudioPresentation,FeatureStudioRegion} from './feature-contract.js'
export interface StudioFloatingPosition {x:number;y:number}
export type StudioPresentation=FeatureStudioPresentation
export interface StudioRectangle {x:number;y:number;width:number;height:number}
/** Float in the measured canvas area; choose an unoccupied corner only before user positioning. */
export function studioFloatingBounds(width:number,height:number,position?:StudioFloatingPosition,region?:FeatureStudioRegion,docked=false,pinnedHeight?:number):{bounds:StudioRectangle;travel:StudioFloatingPosition;position:StudioFloatingPosition}{
 const viewportWidth=Math.max(1,Math.floor(width)),viewportHeight=Math.max(1,Math.floor(height))
 const top=Math.min(viewportHeight-1,Math.max(0,Math.round(region?region.top*viewportHeight:64)))
 const propertyBottom=Math.min(viewportHeight,Math.max(top+1,Math.round(region?region.bottom*viewportHeight:viewportHeight*.66)))
 const bottom=Math.min(propertyBottom,Math.max(top+1,Math.round((region?.floatBottom??propertyBottom/viewportHeight)*viewportHeight)))
 const propertyWidth=Math.min(viewportWidth,Math.max(1,Math.round(region?region.propertyWidth*viewportWidth:Math.min(280,viewportWidth))))
 if(docked)return {bounds:{x:viewportWidth-propertyWidth,y:top,width:propertyWidth,height:propertyBottom-top},travel:{x:0,y:0},position:{x:0,y:0}}
 const left=Math.min(viewportWidth-1,Math.max(0,Math.round((region?.resourceWidth??0)*viewportWidth)))
 const right=Math.max(left+1,viewportWidth-propertyWidth),freeWidth=right-left
 const margin=Math.min(12,Math.floor((Math.min(freeWidth,bottom-top)-1)/2))
 const w=Math.min(320,freeWidth-margin*2)
 let h=Math.min(Number.isFinite(pinnedHeight)?Math.max(240,Math.min(320,pinnedHeight!)):320,bottom-top-margin*2)
 const travel={x:Math.max(0,freeWidth-w-margin*2),y:Math.max(0,bottom-top-h-margin*2)}
 const ratio=(n:number)=>Number.isFinite(n)?Math.max(0,Math.min(1,n)):0
 const bounds=(p:StudioFloatingPosition):StudioRectangle=>({x:left+margin+Math.round(travel.x*ratio(p.x)),y:top+margin+Math.round(travel.y*ratio(p.y)),width:w,height:h})
 let chosen=position??{x:1,y:0}
 if(!position&&region?.avoid){
  const a={x:region.avoid.x*viewportWidth,y:region.avoid.y*viewportHeight,width:region.avoid.width*viewportWidth,height:region.avoid.height*viewportHeight}
  const overlap=(p:StudioFloatingPosition)=>{const b=bounds(p);return Math.max(0,Math.min(b.x+b.width,a.x+a.width+8)-Math.max(b.x,a.x-8))*Math.max(0,Math.min(b.y+b.height,a.y+a.height+8)-Math.max(b.y,a.y-8))}
  const corners=[{x:1,y:0},{x:0,y:0},{x:1,y:1},{x:0,y:1}]
  chosen=corners.sort((a,b)=>overlap(a)-overlap(b))[0]
  // A wide selection can occupy every normal-size corner. Keep the composer
  // usable, but use the largest clear height above/below it on automatic open.
  if(overlap(chosen)>0&&pinnedHeight===undefined){
   const normalHeight=h,clearHeights=[Math.floor(a.y-8-top-margin),Math.floor(bottom-margin-a.y-a.height-8)].filter(value=>value>=240&&value<normalHeight).sort((a,b)=>b-a)
   for(const height of clearHeights){h=height;travel.y=Math.max(0,bottom-top-h-margin*2);const corner=corners.find(p=>overlap(p)===0);if(corner){chosen=corner;break}h=normalHeight;travel.y=Math.max(0,bottom-top-h-margin*2)}
  }
 }
 const normalized={x:ratio(chosen.x),y:ratio(chosen.y)}
 return {bounds:bounds(normalized),travel,position:normalized}
}
