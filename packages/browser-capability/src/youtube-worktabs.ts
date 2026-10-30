import {SessionOperations} from './session-operations.js'

/** Preserve the site's own appearance bootstrap; emulating dark mode mid-load
 * can make the application replace its still-loading watch document. */
export function youtubeNativePageTheme(raw:string):boolean{try{const u=new URL(raw);return ['https:','http:'].includes(u.protocol)&&['www.youtube.com','youtube.com','m.youtube.com'].includes(u.hostname)}catch{return false}}

export interface YoutubeWatchAddress {url:string;origin:string;videoId:string;simple:boolean}
export function youtubeWatchAddress(raw:unknown):YoutubeWatchAddress|null {
 if(typeof raw!=='string'||raw.length>8192)return null
 try{const url=new URL(raw),id=url.searchParams.get('v');if(url.protocol!=='https:'||url.username||url.password||url.port||!['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname)||url.pathname!=='/watch'||url.searchParams.getAll('v').length!==1||!id||!/^[A-Za-z0-9_-]{11}$/.test(id))return null
  url.hash='';return {url:url.href,origin:url.origin,videoId:id,simple:[...url.searchParams.keys()].every(key=>['v','feature','si','pp','themeRefresh'].includes(key)||key.startsWith('utm_'))}
 }catch{return null}
}

/** Host-only residency and FIFO. Callbacks finish actual cleanup before return;
 * nested native work stays inside the existing lease, never re-enqueues itself. */
export class YoutubeWorkTabs {
 private readonly tabs=new Map<string,string>()
 private readonly queues=new Map<string,SessionOperations>()
 get(projectId:string):string|undefined{return this.tabs.get(projectId)}
 owns(tabId:string):boolean{return [...this.tabs.values()].includes(tabId)}
 assign(projectId:string,tabId:string):void {
  if(!projectId||!tabId||[...this.tabs].some(([owner,id])=>id===tabId&&owner!==projectId))throw new Error('YOUTUBE_WORKTAB_OWNER: A work tab belongs to exactly one Project.')
  this.tabs.set(projectId,tabId)
 }
 forget(tabId:string):void{for(const [project,id] of this.tabs)if(id===tabId)this.tabs.delete(project)}
 run<T>(projectId:string,admit:()=>void,work:()=>Promise<T>):Promise<T>{
  let queue=this.queues.get(projectId);if(!queue){queue=new SessionOperations();this.queues.set(projectId,queue)}
  return queue.run(admit,work)
 }
 busy(projectId:string):boolean{return this.queues.get(projectId)?.busy??false}
}
