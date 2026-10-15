/** Semantic labels are local to a paint call, never persisted on browser globals. */
export type CanvasPaintRole='caption'|'caption-background'|'attribution'|'footnote'|'watermark'|'counter'
const roles=new WeakMap<CanvasRenderingContext2D,CanvasPaintRole>()
export function canvasPaintRole(context:CanvasRenderingContext2D):CanvasPaintRole|undefined{return roles.get(context)}
export function withCanvasPaintRole(context:CanvasRenderingContext2D,role:CanvasPaintRole,paint:()=>void):void {
 const previous=roles.get(context);roles.set(context,role)
 try{paint()}finally{if(previous)roles.set(context,previous);else roles.delete(context)}
}
