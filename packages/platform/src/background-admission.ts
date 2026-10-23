export type BackgroundWorkKind='collection'|'hourly'
export interface BackgroundResourceState {
 projectId:string;activeProjectId:string;projectChanging:boolean;browserBusy:boolean
 hostBusy:boolean;mediaBusy:boolean;scheduledBusy:boolean;agentControlGranted:boolean
}
/** Diagnostics cannot change receipt, FIFO admission or cleanup results. No task text or raw error is logged. */
export function backgroundDiagnostic(value:Record<string,unknown>):void {try{console.info('[BMW background]',JSON.stringify(value))}catch{/* A failed log sink never changes scheduler state. */}}
/** One official input at an idle boundary. Never cancels or preempts foreground work. */
export class BackgroundAdmission {
 private last:BackgroundWorkKind|undefined
 private waiting=new Map<BackgroundWorkKind,number>()
 private projectId:string|undefined
 constructor(private now=()=>Date.now(),private contenderLifetimeMs=90_000){}
 reason(kind:BackgroundWorkKind,state:BackgroundResourceState):string|null {
  if(this.projectId!==state.activeProjectId){this.waiting.clear();this.last=undefined;this.projectId=state.activeProjectId}
  if(!state.agentControlGranted)return 'agent-control-required'
  if(state.projectChanging)return 'project-transition'
  if(state.projectId!==state.activeProjectId)return 'different-project'
  this.waiting.set(kind,this.now())
  if(state.hostBusy)return 'agent-host-busy-or-cleanup'
  if(state.browserBusy)return 'browser-fifo-busy-or-quarantined'
  if(state.mediaBusy)return 'native-media-busy-or-cleanup'
  if(state.scheduledBusy)return 'scheduled-task-active'
  const other:BackgroundWorkKind=kind==='collection'?'hourly':'collection',seen=this.waiting.get(other)
  if(this.last===kind&&seen!==undefined&&this.now()-seen<this.contenderLifetimeMs)return 'fair-turn-'+other
  return null
 }
 admitted(kind:BackgroundWorkKind):void {this.last=kind;this.waiting.delete(kind)}
}
