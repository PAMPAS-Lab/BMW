interface PanelState {active:boolean;disabled:boolean}
type Kind='resources'|'properties'
const node=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T
/** Responsive panels move the canonical DOM; they never duplicate fields or drafts. */
export class StudioPanels {
 private dialog=node<HTMLDialogElement>('studio-side-drawer')
 private current?:Kind
 private roots:{resources:HTMLElement;properties:HTMLElement}
 private homes=new Map<HTMLElement,Comment>()
 private previousFocus?:HTMLElement
 constructor(private state:()=>PanelState,private flush:()=>Promise<void>,private notify:(message:string)=>void){
  this.roots={resources:document.querySelector('#studio-workspace>.scenes')!,properties:node('inspector')}
  for(const root of Object.values(this.roots)){const marker=document.createComment('studio-panel-home');root.parentNode!.insertBefore(marker,root);this.homes.set(root,marker)}
  for(const [id,kind]of [['studio-resources-open','resources'],['studio-properties-open','properties']] as const)node(id).onclick=()=>this.run(()=>this.open(kind))
  node('studio-drawer-close').onclick=()=>this.run(()=>this.close())
  this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.run(()=>this.close())})
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.current&&!event.defaultPrevented){event.preventDefault();this.run(()=>this.close())}})
  window.addEventListener('resize',()=>this.render())
 }
 private run(fn:()=>Promise<void>):void {void fn().catch(error=>this.notify(error instanceof Error?error.message:String(error)))}
 private layout():'wide'|'medium'|'compact' {return innerWidth>=1100?'wide':innerWidth>=700?'medium':'compact'}
 private folded(kind:Kind):boolean {return kind==='resources'?this.layout()!=='wide':this.layout()==='compact'}
 render():void {
  const s=this.state();document.body.dataset.studioLayout=this.layout()
  for(const [kind,id]of [['resources','studio-resources-open'],['properties','studio-properties-open']] as const){const button=node<HTMLButtonElement>(id);button.hidden=!s.active||!this.folded(kind);button.disabled=s.disabled;button.setAttribute('aria-expanded',String(this.current===kind))}
  if(this.current&&(!s.active||!this.folded(this.current)))this.restore()
  if(this.current){const r=node('studio-workspace').getBoundingClientRect();this.dialog.style.top=`${r.top+8}px`;this.dialog.style.height=`${Math.max(1,r.height-16)}px`;this.dialog.style.minHeight='0';this.dialog.style.maxHeight=`${Math.max(1,r.height-16)}px`}
 }
 private restore():void {
  for(const [root,marker]of this.homes)if(root.parentNode!==marker.parentNode)marker.parentNode!.insertBefore(root,marker.nextSibling)
  this.current=undefined;document.body.dataset.studioDrawer='';if(this.dialog.open)this.dialog.close()
 }
 async open(kind:Kind):Promise<void> {
  await this.flush();if(!this.state().active||this.state().disabled||!this.folded(kind))return
  if(this.current===kind){await this.close();return}
  const focus=document.activeElement as HTMLElement;this.restore();this.previousFocus=focus;this.current=kind
  node('studio-drawer-title').textContent=kind==='resources'?'资源':'所选对象属性'
  node('studio-drawer-body').append(this.roots[kind]);document.body.dataset.studioDrawer=kind
  if(!this.dialog.open)this.dialog.show();this.render();node('studio-drawer-close').focus()
 }
 async close():Promise<void> {await this.flush();this.restore();this.render();if(this.previousFocus?.isConnected&&!this.previousFocus.hidden)this.previousFocus.focus()}
}
