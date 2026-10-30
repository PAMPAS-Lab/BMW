import {setTimeout as delay} from 'node:timers/promises'
import type {WebContents} from 'electron'
import {readRendererPhase} from './renderer-read.js'
import {youtubeWatchAddress} from './youtube-worktabs.js'

export interface YoutubeSwitchResult {method:'same-video'|'in-page-link'|'in-page-search'|'site-navigation'|'site-history'|'unavailable';elapsedMs:number;retainedDocument:boolean}
/** Ordinary same-player quality/play operations after the site has initialized.
 * The website itself obtains verification; this never creates a token. */
export function primeYoutubePlayback(expectedId:string):{state:'playing'|'not-required'|'waiting'|'different-target'|'advertisement';quality?:string}{
 const p=document.getElementById('movie_player') as HTMLElement&{getVideoData?:()=>{video_id?:string};getPlayerResponse?:()=>{videoDetails?:{videoId?:string};streamingData?:{serverAbrStreamingUrl?:string}};getAvailableQualityLevels?:()=>unknown;getPlaybackQuality?:()=>string;setPlaybackQualityRange?:(a:string,b:string)=>void;setPlaybackQuality?:(a:string)=>void}|null,v=p?.querySelector('video'),data=p?.getVideoData?.(),response=p?.getPlayerResponse?.()
 if(!p||!v||!data||!response)return {state:'waiting'}
 if(data.video_id!==expectedId||response.videoDetails?.videoId!==expectedId)return {state:'different-target'}
 if(p.classList.contains('ad-showing')||p.classList.contains('ad-interrupting'))return {state:'advertisement'}
 if(!response.streamingData?.serverAbrStreamingUrl)return {state:'not-required'}
 const raw=p.getAvailableQualityLevels?.(),levels=Array.isArray(raw)?raw:[],current=p.getPlaybackQuality?.(),quality=['hd1080','hd720','large','medium','small','tiny'].find(q=>q!==current&&levels.includes(q))
 if(quality){p.setPlaybackQualityRange?.(quality,quality);p.setPlaybackQuality?.(quality)}
 v.muted=true;void v.play().catch(()=>{})
 return {state:'playing',...(quality?{quality}:{})}
}
/** The initial chunked watch document exposes a hidden placeholder input.
 * Do not stop loading that document before its actual navigation UI hydrates. */
export function youtubeNavigationSurfaceReady():boolean {
 const visible=(e:Element)=>{const s=getComputedStyle(e);return e.getClientRects().length>0&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0}
 for(const input of [...document.querySelectorAll('input[name="search_query"],yt-searchbox input,ytd-searchbox input')].slice(0,32)){
  if(!(input instanceof HTMLInputElement)||!['text','search'].includes(input.type)||input.disabled||!visible(input))continue
  const root=input.closest('yt-searchbox,ytd-searchbox')??input.closest('form'),button=root?.querySelector('#search-icon-legacy,button[type="submit"],button[aria-label="Search"],button[aria-label="搜索"],.ytSearchboxComponentSearchButton')
  if(button instanceof HTMLElement&&visible(button)&&(!(button instanceof HTMLButtonElement)||!button.disabled))return true
 }
 return false
}
/** Fixed site adapter. Only actual visible links and actual search controls;
 * never fabricated anchors, history replacement or private YouTube APIs. */
export function youtubeSwitchAction(targetUrl:string,searchResultsOnly=false,forceSearch=false):'link'|'search'|'home'|'waiting'|'unavailable' {
 const target=new URL(targetUrl),id=target.searchParams.get('v'),visible=(element:Element)=>{const style=getComputedStyle(element);return element.getClientRects().length>0&&style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0}
 if(location.origin!==target.origin||!id||!/^[A-Za-z0-9_-]{11}$/.test(id))return 'unavailable'
 // Unlisted videos have a playable watch page but no search result. Leave
 // through the site's actual visible home link; the Host can then return only
 // to this operation's captured, same-target history entry.
 if(forceSearch){const p=document.getElementById('movie_player') as HTMLElement&{getVideoData?:()=>{video_id?:string};getPlayerResponse?:()=>{videoDetails?:{videoId?:string};microformat?:{playerMicroformatRenderer?:{isUnlisted?:boolean}}}}|null,r=p?.getPlayerResponse?.()
  if(p?.getVideoData?.()?.video_id===id&&r?.videoDetails?.videoId===id&&r.microformat?.playerMicroformatRenderer?.isUnlisted===true){
   if(p.classList.contains('ad-showing')||p.classList.contains('ad-interrupting'))return 'waiting'
   for(const a of document.querySelectorAll('ytd-topbar-logo-renderer a[href],a#logo[href]'))if(a instanceof HTMLAnchorElement&&visible(a)&&(!a.target||a.target==='_self')){const u=new URL(a.href);if(u.origin===target.origin&&u.pathname==='/'&&!u.search&&!u.hash){a.click();return 'home'}}
   return 'unavailable'
  }
 }
 if(searchResultsOnly&&(location.pathname!=='/results'||new URL(location.href).searchParams.get('search_query')!==id))return 'waiting'
 if(!forceSearch)for(const link of [...document.querySelectorAll('a[href]')].slice(0,2000)){
  if(!(link instanceof HTMLAnchorElement)||!visible(link)||link.target&&link.target!=='_self'||link.closest('[hidden],[aria-hidden="true"],.ad-showing,.ad-interrupting,ytd-ad-slot-renderer,ytd-promoted-video-renderer')||searchResultsOnly&&link.closest('#movie_player,ytd-miniplayer'))continue
  try{const address=new URL(link.href);if(address.origin===target.origin&&address.pathname==='/watch'&&address.searchParams.getAll('v').length===1&&address.searchParams.get('v')===id&&[...address.searchParams.keys()].every(key=>['v','pp','feature','si'].includes(key)||key.startsWith('utm_'))){link.click();return 'link'}}catch{/* A malformed site link cannot authorize a route. */}
 }
 if(searchResultsOnly)return 'waiting'
 const input=[...document.querySelectorAll('input[name="search_query"],yt-searchbox input,ytd-searchbox input')].find(element=>element instanceof HTMLInputElement&&['text','search'].includes(element.type)&&!element.disabled&&visible(element)) as HTMLInputElement|undefined
 const root=input?.closest('yt-searchbox,ytd-searchbox')??input?.closest('form'),button=root?.querySelector('#search-icon-legacy,button[type="submit"],button[aria-label="Search"],button[aria-label="搜索"],.ytSearchboxComponentSearchButton')
 if(!input||!root||!(button instanceof HTMLElement)||!visible(button)||button instanceof HTMLButtonElement&&button.disabled)return 'unavailable'
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)return 'unavailable'
 setter.call(input,id);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));button.click();return 'search'
}
export function youtubeSwitchReady(targetUrl:string):boolean {
 const target=new URL(targetUrl),actual=new URL(location.href),id=target.searchParams.get('v'),player=document.getElementById('movie_player') as HTMLElement&{getVideoData?:()=>{video_id?:string;cpn?:string};getPlayerResponse?:()=>{videoDetails?:{videoId?:string}}}|null,data=player?.getVideoData?.()
 return actual.origin===target.origin&&actual.pathname==='/watch'&&actual.searchParams.getAll('v').length===1&&actual.searchParams.get('v')===id&&[...actual.searchParams.keys()].every(key=>['v','pp','feature','si','themeRefresh'].includes(key)||key.startsWith('utm_'))&&data?.video_id===id&&player?.getPlayerResponse?.()?.videoDetails?.videoId===id
}
export async function switchYoutubeVideo(wc:WebContents,url:string,signal:AbortSignal,budgetMs=30000,activateSameVideo=false):Promise<YoutubeSwitchResult>{
 const target=youtubeWatchAddress(url),current=youtubeWatchAddress(wc.getURL()),start=performance.now(),deadline=start+budgetMs
 if(!target?.simple||!current||current.origin!==target.origin)return {method:'unavailable',elapsedMs:0,retainedDocument:false}
 const read=<T>(name:string,expression:string)=>readRendererPhase<T>(wc,'navigate',name,async()=>await wc.mainFrame.executeJavaScript(expression,true) as T,signal,Math.min(2000,Math.max(1,deadline-performance.now())))
 let documentChanged=false;const navigation=(_event:unknown,_url:string,inPlace:boolean,main:boolean)=>{if(main&&!inPlace)documentChanged=true}
 wc.on('did-start-navigation',navigation)
 try{
  if(!activateSameVideo&&current.videoId===target.videoId&&current.simple&&await read<boolean>('youtube-current',`(${youtubeSwitchReady.toString()})(${JSON.stringify(url)})`))return {method:'same-video',elapsedMs:Math.round(performance.now()-start),retainedDocument:true}
  const historyIndex=wc.navigationHistory.getActiveIndex()
  const action=await read<ReturnType<typeof youtubeSwitchAction>>('youtube-switch',`(${youtubeSwitchAction.toString()})(${JSON.stringify(url)},false,${JSON.stringify(activateSameVideo)})`)
  if(action==='unavailable'||action==='waiting')return {method:'unavailable',elapsedMs:Math.round(performance.now()-start),retainedDocument:false}
  if(action==='home'){
   let returned=false
   while(performance.now()<deadline){
    signal.throwIfAborted()
    if(!returned){const actual=new URL(wc.getURL()),entry=wc.navigationHistory.getEntryAtIndex(historyIndex),prior=entry?youtubeWatchAddress(entry.url):undefined
     if(actual.origin!==target.origin)return {method:'unavailable',elapsedMs:Math.round(performance.now()-start),retainedDocument:false}
     if(actual.pathname==='/'){
      if(wc.navigationHistory.getActiveIndex()!==historyIndex+1||!prior?.simple||prior.origin!==target.origin||prior.videoId!==target.videoId)return {method:'unavailable',elapsedMs:Math.round(performance.now()-start),retainedDocument:false}
      wc.navigationHistory.goBack();returned=true
     }
    }else if(await read<boolean>('youtube-history-ready',`(${youtubeSwitchReady.toString()})(${JSON.stringify(url)})`))return {method:'site-history',elapsedMs:Math.round(performance.now()-start),retainedDocument:!documentChanged}
    await delay(Math.min(150,Math.max(1,deadline-performance.now())),undefined,{signal})
   }
   return {method:'unavailable',elapsedMs:Math.round(performance.now()-start),retainedDocument:false}
  }
  let clicked=action==='link'
  while(performance.now()<deadline){
   signal.throwIfAborted()
   if(!clicked)clicked=await read<ReturnType<typeof youtubeSwitchAction>>('youtube-search-result',`(${youtubeSwitchAction.toString()})(${JSON.stringify(url)},true)`)==='link'
   if(clicked&&await read<boolean>('youtube-switch-ready',`(${youtubeSwitchReady.toString()})(${JSON.stringify(url)})`))return {method:documentChanged?'site-navigation':action==='search'?'in-page-search':'in-page-link',elapsedMs:Math.round(performance.now()-start),retainedDocument:!documentChanged}
   await delay(Math.min(150,Math.max(1,deadline-performance.now())),undefined,{signal})
  }
  return {method:'unavailable',elapsedMs:Math.round(performance.now()-start),retainedDocument:false}
 }finally{wc.removeListener('did-start-navigation',navigation)}
}
