import type {WebContents} from 'electron'
export type NavigationPage=Pick<WebContents,'loadURL'|'stop'|'close'|'isDestroyed'|'on'|'removeListener'>
const failure=(code:string,message:string)=>Object.assign(new Error(code+': '+message),{code})
async function destroyed(page:NavigationPage,timeoutMs:number):Promise<boolean>{
 if(page.isDestroyed())return true
 return new Promise(resolve=>{let timer:NodeJS.Timeout;const done=()=>{clearTimeout(timer);page.removeListener('destroyed',closed);resolve(page.isDestroyed())},closed=()=>done();page.on('destroyed',closed);timer=setTimeout(done,timeoutMs);if(page.isDestroyed())done()})
}
/** A failed stop is recovered only by actual destruction, never by racing a
 * still-running native navigation and releasing the Session FIFO early. */
export async function closeNavigationPage(page:NavigationPage,timeoutMs=3000):Promise<void>{
 if(page.isDestroyed())return
 const gone=destroyed(page,timeoutMs);try{page.close({waitForBeforeUnload:false})}catch{}
 if(!await gone)throw failure('BMW_BROWSER_NAVIGATION_CLEANUP_FAILED','Page did not close; browser resources remain quarantined until explicit close recovery succeeds.')
}
export async function navigatePage(page:NavigationPage,url:string,signal?:AbortSignal,timeoutMs=25000,cleanupMs=3000,allowClose=true,earlyReady?:()=>Promise<boolean>):Promise<void>{
 signal?.throwIfAborted();if(page.isDestroyed())throw failure('BMW_BROWSER_RENDERER_GONE','Navigation target is closed.')
 let early=false,closed=false,domReady=false,probe:Promise<void>|undefined,poll:NodeJS.Timeout|undefined
 const dom=()=>{domReady=true},checkEarly=()=>{if(closed||!domReady||probe||!earlyReady)return;probe=(async()=>{try{if(await earlyReady()){if(!closed){early=true;release(undefined)}}}catch{/* A failed probe cannot certify readiness; original deadline remains. */}})().finally(()=>{probe=undefined})}
 let settled=false,cancelled:unknown,timer:NodeJS.Timeout|undefined,release:(reason:unknown)=>void=()=>{}
 const stopped=new Promise<unknown>(resolve=>{release=resolve}),abort=()=>{cancelled=signal?.reason??failure('BMW_BROWSER_CANCELLED','Navigation cancelled.');release(cancelled)}
 if(earlyReady){page.on('dom-ready',dom);page.on('did-navigate',dom);poll=setInterval(checkEarly,150)}
 signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{cancelled=failure('BMW_BROWSER_NAVIGATION_TIMEOUT','Navigation exceeded its native deadline.');release(cancelled)},timeoutMs)
 const pending=Promise.resolve().then(()=>{signal?.throwIfAborted();return page.loadURL(url)}).then(()=>{settled=true;return {ok:true as const}},(error:unknown)=>{settled=true;return {ok:false as const,error}})
 try{
  const outcome=await Promise.race([pending,stopped.then(reason=>({ok:false as const,error:reason}))])
  if(cancelled||early){try{if(!page.isDestroyed())page.stop()}catch{}
   let cleanupTimer:NodeJS.Timeout|undefined;await Promise.race([pending,new Promise<void>(resolve=>{cleanupTimer=setTimeout(resolve,cleanupMs)})]);if(cleanupTimer)clearTimeout(cleanupTimer)
   if(!settled&&!page.isDestroyed()){if(!allowClose)throw failure('BMW_BROWSER_NAVIGATION_CLEANUP_FAILED','User page retained; explicit user close is required before browser work resumes.');await closeNavigationPage(page,cleanupMs)}
   if(cancelled)throw cancelled
   if(page.isDestroyed())throw failure('BMW_BROWSER_PAGE_CHANGED','Collection page closed before its DOM could be observed.')
   return
  }
  if('error'in outcome)throw outcome.error
 }finally{closed=true;if(timer)clearTimeout(timer);if(poll)clearInterval(poll);if(earlyReady){page.removeListener('dom-ready',dom);page.removeListener('did-navigate',dom)};await probe;signal?.removeEventListener('abort',abort)}
}
