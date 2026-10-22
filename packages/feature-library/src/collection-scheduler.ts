import crypto from 'node:crypto'
import type {CollectionRuntimePort} from '@bmw-agent/platform/feature-contract'
import {CollectionScheduleStore} from './collection-schedule-store.js'
import {assertScheduleRequest} from './collection-schedule-contract.js'
import type {CollectionPlan,CollectionNotice,CollectionScheduleState} from './collection-schedule-contract.js'
import type {LibraryService} from './library-service.js'
import {RollingStore,RollingService} from './rolling-service.js'
import type {CollectionRun} from './rolling-contract.js'
export class CollectionAdmissionDeferred extends Error {}
const live=(run:CollectionRun)=>run.status==='uncertain'||run.status==='sent'
export function collectionBackoff(planId:string,failures:number):number{const jitter=parseInt(crypto.createHash('sha256').update(planId+':'+failures).digest('hex').slice(0,4),16)%60000;return Math.min(24*60*60*1000,5*60*1000*2**Math.min(12,Math.max(0,failures-1))+jitter)}
/** A bounded scheduler of official inputs, never an Agent/model loop. */
export class CollectionScheduler {
 private timer?:ReturnType<typeof setInterval>
 private deadlineTimer?:ReturnType<typeof setTimeout>
 private pending?:Promise<void>
 private stopped=false
 constructor(readonly store:CollectionScheduleStore,private library:LibraryService,private rolling:RollingService,private port:CollectionRuntimePort,private notice:(notice:CollectionNotice,plan:CollectionPlan)=>void=()=>{},private now=()=>Date.now(),private rollingForProject?:(projectId:string)=>RollingService){}
 owns(id:string):CollectionPlan|undefined{return this.store.read().plans.find(p=>p.cycle?.attempt?.runId===id)}
 start():void{if(this.timer)return;this.stopped=false;this.timer=setInterval(()=>{void this.tick().catch(error=>console.error('Collection scheduler suspended:',error))},30000);this.timer.unref();void this.tick().catch(error=>console.error('Collection scheduler suspended:',error))}
 async stop():Promise<void>{this.stopped=true;if(this.timer)clearInterval(this.timer);if(this.deadlineTimer)clearTimeout(this.deadlineTimer);this.timer=undefined;this.deadlineTimer=undefined;await this.pending}
 private stamp(){return new Date(this.now()).toISOString()}
 private health(state:CollectionScheduleState,plan:CollectionPlan,health:CollectionPlan['health'],message:string){const old=plan.health;plan.health=health;plan.message=message.slice(0,2000);if(old===health||health==='waiting'||health==='healthy'&&old!=='backoff'&&old!=='review')return;const notice:CollectionNotice={id:crypto.randomUUID(),planId:plan.id,at:this.stamp(),health,message:(plan.directionTitle+': '+plan.message).slice(0,2000),read:false};state.notices.push(notice);state.notices=state.notices.slice(-200)}
 private save(state:CollectionScheduleState){const before=new Set(this.store.read().notices.map(n=>n.id)),next=this.store.write(state);for(const n of next.notices)if(!before.has(n.id)){const plan=next.plans.find(p=>p.id===n.planId);if(plan?.notify)try{this.notice(n,plan)}catch{/* A notification cannot undo committed health state. */}}state.revision=next.revision;return state}
 private validate(plan:CollectionPlan){const project=this.library.project(plan.projectId);if(project.archivedAt)throw new Error('采集 Project 已归档');const direction=this.library.host.directions?.().directions.find(d=>d.id===plan.directionId);if(!direction||direction.status!=='following'||direction.collectionProjectId!==plan.projectId)throw new Error('方向已暂停或变更 Project；请显式修复计划');const store=new RollingStore(project.directory,project.id);for(const id of plan.subscriptionIds){const sub=store.entity(id,'subscription');if(sub.input.status!=='following'||!sub.input.directionIds.includes(plan.directionId))throw new Error('订阅已暂停或不再属于该方向')}return store}
 async execute(raw:unknown):Promise<CollectionScheduleState>{const r=assertScheduleRequest(raw);this.library.host.guard();let state=this.store.read();if(r.operation==='list')return state;if(this.pending)throw new Error('采集调度正在提交状态，请稍后重试');if(state.revision!==r.expectedRevision)throw new Error('COLLECTION_SCHEDULE_CONFLICT: Reload collection schedules.')
 if(r.operation==='create'||r.operation==='configure'){const previous=r.operation==='configure'?state.plans.find(p=>p.id===r.id):undefined;if(r.operation==='configure'&&(!previous||previous.cycle))throw new Error('先核对并结束旧轮次，再修改计划配置');if(!previous&&state.plans.length>=100)throw new Error('最多100个方向采集计划');const binding=this.port.binding();if(!binding||binding.projectId!==this.library.host.active().id)throw new Error('请先选择采集 Project、Session 和官方驱动');const plan:CollectionPlan={...binding,id:previous?.id??crypto.randomUUID(),directionId:String(r.directionId),directionTitle:this.library.host.directions?.().directions.find(d=>d.id===r.directionId)?.title??'',subscriptionIds:r.subscriptionIds as string[],intervalMinutes:Number(r.intervalMinutes),notify:r.notify as boolean,enabled:!previous,nextAt:this.stamp(),failures:0,health:'waiting',message:'等待空闲采集；应用关闭期间不运行',lastStartedAt:null,lastFinishedAt:null,cycle:null};this.validate(plan);if(state.plans.some(p=>p.directionId===plan.directionId&&p.id!==plan.id))throw new Error('该方向已有采集计划；请管理已有计划');if(previous)Object.assign(previous,plan);else state.plans.push(plan)
 }else if(r.operation==='read'){const notice=state.notices.find(n=>n.id===r.id);if(!notice)throw new Error('Unknown collection notice.');notice.read=true
 }else{const plan=state.plans.find(p=>p.id===r.id);if(!plan)throw new Error('Unknown collection plan.');if(r.operation==='recover'){
   if(plan.projectId!==this.library.host.active().id||this.port.binding()?.projectId!==plan.projectId)throw new Error('回到原 Project 后核对旧输入并恢复')
   if(!this.port.recoverable(plan))throw new Error('等待绑定资源实际清理完成后恢复')
   const attempt=plan.cycle?.attempt,project=this.library.project(plan.projectId),store=new RollingStore(project.directory,project.id),run=attempt?store.get(attempt.runId):undefined
   if(run?.kind==='run'&&run.dispatchId){const receipt=this.port.receipt(plan,run.dispatchId);if(!receipt.drained)throw new Error('实际清理尚未完成；请先停止任务或恢复隔离资源')}
   if(run?.kind==='run'&&live(run))store.commit([{...run,revision:run.revision+1,updatedAt:this.stamp(),status:'cancelled',note:'用户核对旧输入并确认清理后结束；不重投旧输入，不推进游标。'}],store.records.state().revision,'schedule-user-recovery')
   plan.cycle=null;plan.enabled=false;plan.nextAt=new Date(this.now()+plan.intervalMinutes*60000).toISOString();plan.failures=0;this.health(state,plan,'waiting','已核对旧轮次；需要显式启用才启动新的周期')
 }else if(r.operation==='bind'){if(plan.cycle)throw new Error('先核对并结束旧轮次');const binding=this.port.binding();if(!binding||binding.projectId!==plan.projectId)throw new Error('选择原 Project 内新的明确 Session / 驱动');Object.assign(plan,binding);plan.enabled=false;plan.failures=0;this.health(state,plan,'waiting','已显式更新绑定，启用后开始新的周期')}else{if(r.enabled===true){if(plan.health==='review')throw new Error('先核对不确定输入并恢复计划');this.validate(plan);if(this.port.binding()?.sessionId!==plan.sessionId||this.port.binding()?.driverId!==plan.driverId)throw new Error('请返回计划绑定的 Session / 驱动');plan.nextAt=this.stamp()}if(r.enabled!==undefined)plan.enabled=r.enabled as boolean;if(r.notify!==undefined)plan.notify=r.notify as boolean;if(!plan.enabled)plan.message='已暂停；正在执行的输入将等待真实清理后结束'}
 }const saved=this.save(state);if(r.operation==='update'&&r.enabled===false){await this.tick();return this.store.read()}return saved
 }
 tick(reconcileOnly=false):Promise<void>{if(this.pending)return this.pending;if(this.stopped)return Promise.resolve();const work=this.step(reconcileOnly);this.pending=work;void work.finally(()=>{if(this.pending===work)this.pending=undefined;this.armDeadline()}).catch(()=>{});return work}
 private armDeadline():void{if(this.deadlineTimer)clearTimeout(this.deadlineTimer);this.deadlineTimer=undefined;if(this.stopped)return;let deadline=Infinity;for(const plan of this.store.read().plans){if(plan.health==='review'||!plan.cycle?.attempt)continue;const project=this.library.project(plan.projectId),run=new RollingStore(project.directory,project.id).get(plan.cycle.attempt.runId);if(run?.kind==='run')deadline=Math.min(deadline,Date.parse(run.deadline))}if(Number.isFinite(deadline)){this.deadlineTimer=setTimeout(()=>{void this.tick().catch(error=>console.error('Collection deadline requires recovery:',error))},Math.max(100,deadline-this.now()));this.deadlineTimer.unref()}}
 private async reconcile(state:CollectionScheduleState,plan:CollectionPlan):Promise<boolean>{const attempt=plan.cycle?.attempt;if(!attempt)return false
 const project=this.library.project(plan.projectId),store=new RollingStore(project.directory,project.id),saved=store.get(attempt.runId)
 if(!saved){plan.cycle!.attempt=null;return true} // Ordering proves no Host input existed without a rolling receipt.
 if(saved.kind!=='run'||saved.sessionId!==plan.sessionId||saved.subscriptionId!==attempt.subscriptionId)throw new Error('采集收据绑定不一致')
 if(!saved.dispatchId){this.health(state,plan,'review','投递结果不确定；保留旧输入与材料，禁止自动重投，请核对恢复');return true}
 let receipt=this.port.receipt(plan,saved.dispatchId)
 if(receipt.state==='uncertain'||receipt.state==='missing'){this.health(state,plan,'review','官方输入收据未知或缺失；禁止自动重投，请核对并清理恢复');return true}
 let invalid:string|undefined;try{this.validate(plan)}catch(error){invalid=String(error)}
 if(receipt.state==='active'){
   if(invalid||!plan.enabled||this.now()>=Date.parse(saved.deadline)){await this.port.cancel(plan,saved.dispatchId);receipt=this.port.receipt(plan,saved.dispatchId)}
   if(!receipt.drained)return false
 }
 if(receipt.state==='uncertain'||receipt.state==='missing'){this.health(state,plan,'review','清理后输入结果仍不确定；禁止自动重投，请核对恢复');return true}
 if(!receipt.drained)return false
 let run=store.entity(saved.id,'run');const yielded=receipt.state==='interrupted'&&(this.now()<Date.parse(saved.deadline)||!plan.enabled)
 if(invalid){if(live(run))store.commit([{...run,revision:run.revision+1,updatedAt:this.stamp(),status:'cancelled',note:'配置失效，实际清理完成；保留资料及游标。'}],store.records.state().revision,'schedule-invalidated');this.health(state,plan,'review',invalid);return true}
 if(live(run)){run={...run,revision:run.revision+1,updatedAt:this.stamp(),status:yielded?'cancelled':'failed',note:receipt.state==='success'?'官方任务结束但缺少完整检查证据；保留旧游标。':'官方任务停止或失败并已完成实际清理；保留已采集资料和旧游标。'};store.commit([run],store.records.state().revision,'schedule-settled')}
 plan.lastFinishedAt=this.stamp();plan.cycle!.attempt=null
 if((run.status==='completed'||run.status==='no-new')&&receipt.state==='success'){
   plan.cycle!.remaining=plan.cycle!.remaining.filter(id=>id!==run.subscriptionId);if(!plan.failures||!plan.cycle!.remaining.length){plan.failures=0;this.health(state,plan,'healthy','采集检查正常 · '+run.status)}else plan.message='本轮已完成一个来源，其余来源仍待检查或重试'
   if(!plan.cycle!.remaining.length){plan.cycle=null;plan.nextAt=new Date(this.now()+plan.intervalMinutes*60000).toISOString()}
 }else if(yielded){
   // User priority is a delay, not a failed network check. Resume only as a new bounded run.
   plan.nextAt=new Date(this.now()+60000).toISOString();plan.message='已让行用户任务，真实清理完成；稍后从保留游标开启新的有限检查'
 }else{plan.cycle!.remaining=[...plan.cycle!.remaining.filter(id=>id!==run.subscriptionId),run.subscriptionId];plan.failures=Math.min(1000000,plan.failures+1);plan.nextAt=new Date(this.now()+collectionBackoff(plan.id,plan.failures)).toISOString();this.health(state,plan,'backoff',`采集${run.status}，连续 ${plan.failures} 次；保留游标，退避至 ${plan.nextAt}`)}return true
 }
 private async step(reconcileOnly=false):Promise<void>{let state=this.store.read();if(!state.plans.length)return
 // Reconcile at most 100 current attempts. No historical occurrence replay.
 for(const plan of state.plans)if(plan.cycle?.attempt&&plan.health!=='review')try{if(await this.reconcile(state,plan))state=this.save(state)}catch(error){this.health(state,plan,'review',String(error));state=this.save(state)}
 if(this.stopped||reconcileOnly)return
 const candidates=state.plans.filter(p=>p.enabled&&p.health!=='review'&&!p.cycle?.attempt&&Date.parse(p.nextAt)<=this.now()).sort((a,b)=>(a.lastStartedAt??'').localeCompare(b.lastStartedAt??'')||a.id.localeCompare(b.id))
 for(const plan of candidates){try{const store=this.validate(plan),reason=this.port.available(plan);if(reason){if(plan.message!==reason){plan.message=reason;state=this.save(state)}continue}if(store.records.state().sequence&&store.records.count('live')){if(plan.message!=='等待旧采集核对或清理'){plan.message='等待旧采集核对或清理';state=this.save(state)}continue}
   plan.cycle??={remaining:[...plan.subscriptionIds],attempt:null};const runId=crypto.randomUUID();plan.cycle.attempt={runId,subscriptionId:plan.cycle.remaining[0]};plan.lastStartedAt=this.stamp();plan.message='已持久化轮次，等待官方输入收据';state=this.save(state)
   try{await (this.rollingForProject?.(plan.projectId)??this.rolling).startScheduled(plan.projectId,plan.sessionId,plan.cycle!.remaining[0],runId)}catch(error){if(error instanceof CollectionAdmissionDeferred){const current=store.get(runId);if(current?.kind==='run'&&live(current)&&!current.dispatchId)store.commit([{...current,revision:current.revision+1,updatedAt:this.stamp(),status:'cancelled',note:'官方准入明确拒绝，未投递输入；等待空闲。'}],store.records.state().revision,'schedule-deferred');state=this.store.read();const p=state.plans.find(p=>p.id===plan.id)!;p.cycle!.attempt=null;p.message=error.message;this.save(state)}else{state=this.store.read();const p=state.plans.find(p=>p.id===plan.id)!;if(store.get(runId)){this.health(state,p,'review','投递中断，禁止自动重投：'+String(error))}else{p.cycle!.attempt=null;p.failures++;p.nextAt=new Date(this.now()+collectionBackoff(p.id,p.failures)).toISOString();this.health(state,p,'backoff','采集准备失败：'+String(error))}this.save(state)}}
   return // One new official input per tick, round-robin among due directions.
 }catch(error){this.health(state,plan,'review',String(error));state=this.save(state)}}
 }
}
