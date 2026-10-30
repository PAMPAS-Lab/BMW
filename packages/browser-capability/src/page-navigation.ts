import type {WebContents} from 'electron'
export interface NavigationProgress {committed:boolean;domReady:boolean;loadFinished:boolean;mainFrameErrorCode:number|null}
export interface NavigationTrace {phase:'stop'|'complete';reason:'dom-ready'|'load'|'deadline'|'cancelled'|'snapshot'|'failure';elapsedMs:number;progress?:NavigationProgress}
export type NavigationPage=Pick<WebContents,'loadURL'|'stop'|'close'|'isDestroyed'|'on'|'removeListener'>
/** Observe a site-owned continuation without submitting the input URL again.
 * Cancellation is owned by navigatePage: stop, await this real load, then close
 * if the renderer does not settle. No timer can turn a pending load into success. */
export function observeNativePageLoad(page:NavigationPage&Pick<WebContents,'isLoading'>,canComplete:()=>boolean=()=>true):Promise<void>{
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{page.removeListener('did-stop-loading',check);page.removeListener('did-navigate',check);page.removeListener('did-start-navigation',check);page.removeListener('destroyed',gone)}
  const gone=()=>{cleanup();reject(failure('BMW_BROWSER_PAGE_CHANGED','Site continuation renderer closed.'))}
  const check=()=>{try{if(page.isDestroyed()){gone();return}if(canComplete()&&!page.isLoading()){cleanup();resolve()}}catch(error){cleanup();reject(error)}}
  page.on('did-stop-loading',check);page.on('did-navigate',check);page.on('did-start-navigation',check);page.on('destroyed',gone);check()
 })
}
export interface DocumentTransfer {url:string;status:number;receivedBytes:number;lastDataAt:number;completed:boolean;failed:boolean}
/** Only an actively arriving, successful same-document HTML response gets a
 * bounded completion lease. Headers, stale bytes and unrelated requests do not
 * buy more time. The content predicate and eventual cleanup remain unchanged. */
export function documentReadGraceMs(transfer:DocumentTransfer|undefined,url:string,now:number,budgetMs:number):number{
 if(!transfer||transfer.url!==url||transfer.status!==200||transfer.completed||transfer.failed||transfer.receivedBytes<=0||transfer.lastDataAt>now||now-transfer.lastDataAt>Math.min(1000,budgetMs/4))return 0
 return Math.min(4000,budgetMs/2)
}
const failure=(code:string,message:string)=>Object.assign(new Error(code+': '+message),{code})
async function destroyed(page:NavigationPage,timeoutMs:number):Promise<boolean>{
 if(page.isDestroyed())return true
 return new Promise(resolve=>{let timer:NodeJS.Timeout;const done=()=>{clearTimeout(timer);page.removeListener('destroyed',closed);resolve(page.isDestroyed())},closed=()=>done();page.on('destroyed',closed);timer=setTimeout(done,timeoutMs);if(page.isDestroyed())done()})
}

/** A temporary page keeps its native load lease until a consistent content
 * snapshot has been captured. Only then may unrelated work be stopped. The
 * caller must still destroy the temporary surface before releasing its FIFO. */
export async function withNativePageRead<T>(page:NavigationPage,url:string,options:{signal?:AbortSignal;timeoutMs:number;ready:()=>Promise<boolean>;read:()=>Promise<T>;incomplete:(reason:Error)=>Promise<T>;trace?:(entry:NavigationTrace)=>void;documentTransfer?:()=>DocumentTransfer|undefined}):Promise<T>{
 const {signal,trace}=options,startedAt=Date.now();signal?.throwIfAborted()
 let committed=false,settled=false,loadFailure:unknown,captured=false
 const committedPage=()=>{committed=true}
 page.on('dom-ready',committedPage);page.on('did-navigate',committedPage)
 const load=Promise.resolve().then(()=>page.loadURL(url)).then(()=>{settled=true;committed=true;trace?.({phase:'complete',reason:'load',elapsedMs:Date.now()-startedAt})},error=>{settled=true;loadFailure=error})
 try{
  while(true){
   signal?.throwIfAborted()
   if(committed&&!page.isDestroyed()&&await options.ready()){
    const value=await options.read();captured=true;trace?.({phase:'complete',reason:'snapshot',elapsedMs:Date.now()-startedAt});return value
   }
   if(loadFailure)break
   const transfer=options.documentTransfer?.(),now=Date.now(),grace=documentReadGraceMs(transfer,url,now,options.timeoutMs)
   if(now-startedAt>=options.timeoutMs+grace)break
   await new Promise<void>(resolve=>setTimeout(resolve,100))
  }
  signal?.throwIfAborted()
  return await options.incomplete(loadFailure instanceof Error?loadFailure:failure('BMW_BROWSER_CONTENT_DEADLINE','No qualified content was observed within the native page budget.'))
 }finally{
  page.removeListener('dom-ready',committedPage);page.removeListener('did-navigate',committedPage)
  if(!settled&&!page.isDestroyed()){
   trace?.({phase:'stop',reason:signal?.aborted?'cancelled':captured?'snapshot':'deadline',elapsedMs:Date.now()-startedAt})
   try{page.stop()}catch{}
   let timer:NodeJS.Timeout|undefined;await Promise.race([load,new Promise<void>(resolve=>{timer=setTimeout(resolve,3000)})]);if(timer)clearTimeout(timer)
   if(!settled&&!page.isDestroyed())await closeNavigationPage(page,3000)
  }
 }
}
/** A failed stop is recovered only by actual destruction, never by racing a
 * still-running native navigation and releasing the Session FIFO early. */
export async function closeNavigationPage(page:NavigationPage,timeoutMs=3000):Promise<void>{
 if(page.isDestroyed())return
 const gone=destroyed(page,timeoutMs);try{page.close({waitForBeforeUnload:false})}catch{}
 if(!await gone)throw failure('BMW_BROWSER_NAVIGATION_CLEANUP_FAILED','Page did not close; browser resources remain quarantined until explicit close recovery succeeds.')
}
export async function navigatePage(page:NavigationPage,url:string,signal?:AbortSignal,timeoutMs=25000,cleanupMs=3000,allowClose=true,earlyReady?:()=>Promise<boolean>,trace?:(entry:NavigationTrace)=>void,start?:()=>Promise<void>):Promise<void>{
 const startedAt=Date.now()
 signal?.throwIfAborted();if(page.isDestroyed())throw failure('BMW_BROWSER_RENDERER_GONE','Navigation target is closed.')
 let early=false,closed=false,domReady=false,canProbe=false,committed=false,loadFinished=false,mainFrameErrorCode:number|null=null,probe:Promise<void>|undefined,poll:NodeJS.Timeout|undefined
 const report=(phase:NavigationTrace['phase'],reason:NavigationTrace['reason'])=>trace?.({phase,reason,elapsedMs:Date.now()-startedAt,progress:{committed,domReady,loadFinished,mainFrameErrorCode}})
 const commit=()=>{committed=true;canProbe=true},loaded=()=>{loadFinished=true},failed=(_event:unknown,code:number,_description:string,_url:string,main:boolean)=>{if(main&&Number.isSafeInteger(code))mainFrameErrorCode=code}
 const dom=()=>{domReady=true;canProbe=true},checkEarly=()=>{if(closed||!canProbe||probe||!earlyReady)return;probe=(async()=>{try{if(await earlyReady()){if(!closed){early=true;release(undefined)}}}catch{/* A failed probe cannot certify readiness; original deadline remains. */}})().finally(()=>{probe=undefined})}
 let settled=false,cancelled:unknown,timer:NodeJS.Timeout|undefined,release:(reason:unknown)=>void=()=>{}
 const stopped=new Promise<unknown>(resolve=>{release=resolve}),abort=()=>{cancelled=signal?.reason??failure('BMW_BROWSER_CANCELLED','Navigation cancelled.');release(cancelled)}
 page.on('dom-ready',dom);page.on('did-navigate',commit);page.on('did-finish-load',loaded);page.on('did-fail-load',failed)
 if(earlyReady)poll=setInterval(checkEarly,150)
 signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{cancelled=failure('BMW_BROWSER_NAVIGATION_TIMEOUT','Navigation exceeded its native deadline.');release(cancelled)},timeoutMs)
 const pending=Promise.resolve().then(()=>{signal?.throwIfAborted();return start?start():page.loadURL(url)}).then(()=>{settled=true;return {ok:true as const}},(error:unknown)=>{settled=true;return {ok:false as const,error}})
 try{
  const outcome=await Promise.race([pending,stopped.then(reason=>({ok:false as const,error:reason}))])
  if(cancelled||early){report('stop',early?'dom-ready':signal?.aborted?'cancelled':'deadline');try{if(!page.isDestroyed())page.stop()}catch{}
   let cleanupTimer:NodeJS.Timeout|undefined;await Promise.race([pending,new Promise<void>(resolve=>{cleanupTimer=setTimeout(resolve,cleanupMs)})]);if(cleanupTimer)clearTimeout(cleanupTimer)
   if(!settled&&!page.isDestroyed()){if(!allowClose)throw failure('BMW_BROWSER_NAVIGATION_CLEANUP_FAILED','User page retained; explicit user close is required before browser work resumes.');await closeNavigationPage(page,cleanupMs)}
   if(cancelled)throw cancelled
   if(page.isDestroyed())throw failure('BMW_BROWSER_PAGE_CHANGED','Collection page closed before its DOM could be observed.')
   report('complete','dom-ready');return
  }
  if('error'in outcome){report('complete','failure');throw outcome.error}
  report('complete','load')
 }finally{closed=true;if(timer)clearTimeout(timer);if(poll)clearInterval(poll);page.removeListener('dom-ready',dom);page.removeListener('did-navigate',commit);page.removeListener('did-finish-load',loaded);page.removeListener('did-fail-load',failed);await probe;signal?.removeEventListener('abort',abort)}
}
