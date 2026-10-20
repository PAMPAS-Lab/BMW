/** Bounded FIFO for the shared native decoding worker. Jobs retain admission
 * through their finally/IO cleanup; queued cancellation never starts a worker. */
export class MediaJobQueue {
 private tail:Promise<void>=Promise.resolve()
 private pending=0
 private failedCleanup:(()=>Promise<void>)|undefined
 private recovery:Promise<void>|undefined
 private generation=0
 get busy():boolean{return this.pending>0||Boolean(this.failedCleanup||this.recovery)}
 quarantineCleanup(cleanup:()=>Promise<void>):void{this.failedCleanup=cleanup;this.generation++}
 async recoverCleanup():Promise<void>{
  if(this.recovery)return this.recovery
  if(!this.failedCleanup)return
  const cleanup=this.failedCleanup
  this.recovery=(async()=>{await this.tail;await cleanup();if(this.failedCleanup===cleanup)this.failedCleanup=undefined})()
  try{await this.recovery}finally{this.recovery=undefined}
 }
 run<T>(operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted()
  if(this.failedCleanup||this.recovery)return Promise.reject(new Error('Native media cleanup failed; use media.stop to recover before submitting another job.'))
  if(this.pending>=16)return Promise.reject(new Error('Native media queue is full; wait for current jobs.'))
  this.pending++
  const generation=this.generation
  let entered=false,aborted=false
  let rejectQueued:(reason:unknown)=>void=()=>{}
  const cancelled=new Promise<never>((_resolve,reject)=>{rejectQueued=reject})
  const abort=()=>{if(!entered){aborted=true;rejectQueued(signal?.reason??new Error('Queued media job cancelled.'))}}
  signal?.addEventListener('abort',abort,{once:true})
  const job=this.tail.then(async()=>{if(aborted)throw signal?.reason??new Error('Queued media job cancelled.');signal?.throwIfAborted();if(this.failedCleanup||generation!==this.generation)throw new Error('Native media cleanup failed; queued job was not started.');entered=true;signal?.removeEventListener('abort',abort);return operation()})
  this.tail=job.then(()=>{},()=>{}).finally(()=>{this.pending--;signal?.removeEventListener('abort',abort)})
  return Promise.race([job,cancelled])
 }
}
