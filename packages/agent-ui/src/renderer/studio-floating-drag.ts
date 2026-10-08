type Position={x:number;y:number}
type Owner={projectId:string;sessionId:string}
interface Snapshot {active:boolean;docked:boolean;position:Position;travel:Position;owner?:Owner}
interface Options {snapshot():Snapshot;send(value:{open:true;docked:false;position:Position;owner:Owner}):Promise<unknown>;error(error:unknown):void}
type Gesture={pointerId:number;screen:Position;position:Position;travel:Position;owner:Owner}
/** Coalesce native View moves, serialize IPC and pin its owner for the whole gesture. */
export class StudioFloatingDrag {
 private gesture?:Gesture
 private queued?:{position:Position;owner:Owner}
 private frame?:number
 private pending?:Promise<void>
 constructor(private header:HTMLElement,private options:Options){
  header.addEventListener('pointerdown',event=>{
   const s=options.snapshot();if(event.button!==0||this.gesture||!s.active||s.docked||!s.owner||(event.target as HTMLElement).closest('button,select,input,a'))return
   this.gesture={pointerId:event.pointerId,screen:{x:event.screenX,y:event.screenY},position:{...s.position},travel:{...s.travel},owner:{...s.owner}}
   event.preventDefault();header.setPointerCapture(event.pointerId)
  })
  header.addEventListener('pointermove',event=>{
   const g=this.gesture;if(!g||event.pointerId!==g.pointerId)return
   this.queued={position:this.position(g,event),owner:g.owner}
   if(this.frame===undefined)this.frame=requestAnimationFrame(()=>{this.frame=undefined;void this.pump()})
  })
  header.addEventListener('pointerup',event=>{
   const g=this.gesture;if(!g||event.pointerId!==g.pointerId)return
   this.queued={position:this.position(g,event),owner:g.owner};this.release();void this.pump()
  })
  header.addEventListener('pointercancel',()=>{void this.stop(true)})
  header.addEventListener('lostpointercapture',()=>{if(this.gesture)void this.stop(true)})
  window.addEventListener('blur',()=>{if(this.gesture)void this.stop(true)})
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.gesture){event.preventDefault();event.stopImmediatePropagation();void this.stop(true)}})
 }
 private position(g:Gesture,event:PointerEvent):Position {const clamp=(v:number)=>Math.max(0,Math.min(1,v));return {x:clamp(g.position.x+(event.screenX-g.screen.x)/(g.travel.x||1)),y:clamp(g.position.y+(event.screenY-g.screen.y)/(g.travel.y||1))}}
 private current(owner:Owner):boolean {const s=this.options.snapshot();return s.active&&!s.docked&&s.owner?.projectId===owner.projectId&&s.owner.sessionId===owner.sessionId}
 private release():void {const g=this.gesture;this.gesture=undefined;if(this.frame!==undefined){cancelAnimationFrame(this.frame);this.frame=undefined}if(g&&this.header.hasPointerCapture(g.pointerId))this.header.releasePointerCapture(g.pointerId)}
 update():void {if(this.gesture&&!this.current(this.gesture.owner))void this.stop(false);if(this.queued&&!this.current(this.queued.owner))this.queued=undefined}
 async stop(restore=false):Promise<void> {const g=this.gesture;this.release();this.queued=restore&&g&&this.current(g.owner)?{position:g.position,owner:g.owner}:undefined;await this.pump()}
 private pump():Promise<void> {
  if(this.pending)return this.pending
  const pending=(async()=>{while(this.queued){const move=this.queued;this.queued=undefined;if(!this.current(move.owner))continue;try{await this.options.send({open:true,docked:false,...move})}catch(error){this.queued=undefined;if(this.current(move.owner))this.options.error(error)}}})()
  this.pending=pending
  void pending.finally(()=>{if(this.pending===pending)this.pending=undefined;if(this.queued)void this.pump()})
  return pending
 }
}
