import type {VideoTarget,VideoResource} from '@bmw-agent/agent-contract/video-identity'

export interface VideoAcquisitionAttempt {method:'preserve';transport:VideoResource['role'];elapsedMs:number;status:'failed'|'completed';reason?:string}
export interface VideoAcquisitionPort {
 preserve(url:string,signal:AbortSignal):Promise<unknown>
 capture(signal:AbortSignal):Promise<unknown>
 verify(purpose:'preserve'|'capture'):Promise<void>
 busy():boolean
 prepareCapture(signal:AbortSignal):Promise<unknown>
}
/** A finite native job, not an Agent loop. Each observed delivery is attempted
 * once; fallback starts only after preservation has actually drained. */
export async function acquireVideoDelivery(target:VideoTarget,port:VideoAcquisitionPort,signal:AbortSignal,downloadBudgetMs=60000){
 signal.throwIfAborted()
 if(!Number.isInteger(downloadBudgetMs)||downloadBudgetMs<1||downloadBudgetMs>60000)throw new TypeError('Invalid native acquisition budget.')
 if(!Number.isFinite(target.durationSeconds)||!target.durationSeconds||target.durationSeconds>1800)throw new Error('MEDIA_ACQUIRE_FINITE: Use explicit archive preservation for long or unknown-duration sources.')
 const rank=(r:VideoResource)=>r.role==='sabr'?5:r.role==='hls'?4:r.role==='video'?3:r.role==='muxed'?2:0
 const resources=target.resources.filter(r=>r.role!=='audio').sort((a,b)=>rank(b)-rank(a)||b.bitrate-a.bitrate)
 const candidates=[...new Map(resources.map(r=>[r.url,r])).values()].slice(0,2),attempts:VideoAcquisitionAttempt[]=[],deadline=AbortSignal.timeout(downloadBudgetMs)
 for(const resource of candidates){
  signal.throwIfAborted();if(deadline.aborted)break
  const started=performance.now()
  try{
   await port.verify('preserve')
   const result=await port.preserve(resource.url,AbortSignal.any([signal,deadline]))
   attempts.push({method:'preserve',transport:resource.role,status:'completed',elapsedMs:Math.round(performance.now()-started)})
   return {method:'preserve' as const,result,acquisition:{policy:'download-first/capture-fallback' as const,reencoded:false,attempts}}
  }catch(error){
   signal.throwIfAborted()
   if(port.busy())throw new Error('MEDIA_ACQUIRE_CLEANUP_PENDING: Preservation still owns native resources; capture was not started.',{cause:error})
   const message=error instanceof Error?error.message:String(error)
   if(/VIDEO_IDENTITY_(?!UNBOUND)|SOURCE_CONFLICT|Project changed|source page.*changed|quarantin|cleanup/i.test(message))throw error
   const reason=/\b(?:YOUTUBE|BMW|MEDIA)_[A-Z_]+/.exec(message)?.[0]??(/\b403\b/.test(message)?'HTTP_403':deadline.aborted?'DOWNLOAD_BUDGET_EXHAUSTED':'DOWNLOAD_FAILED')
   attempts.push({method:'preserve',transport:resource.role,status:'failed',elapsedMs:Math.round(performance.now()-started),reason})
   if(/VIDEO_IDENTITY_UNBOUND/.test(message))break
  }
 }
 signal.throwIfAborted();await port.verify('capture')
 if(port.busy())throw new Error('MEDIA_ACQUIRE_CLEANUP_PENDING: Native resources have not drained.')
 try{
  const quality=await port.prepareCapture(signal)
  await port.verify('capture');const result=await port.capture(signal)
  return {method:'capture' as const,result,acquisition:{policy:'download-first/capture-fallback' as const,reencoded:true,attempts,quality}}
 }catch(error){
  // Keep the real preparation/capture failure and the bounded download reasons
  // together. Never include observed signed URLs in the diagnostic summary.
  const summary=attempts.map(a=>a.transport+':'+(a.reason??a.status)+':'+a.elapsedMs+'ms').join(', ')||'none'
  throw new Error((error instanceof Error?error.message:String(error))+' Download attempts: '+summary+'.',{cause:error})
 }
}
