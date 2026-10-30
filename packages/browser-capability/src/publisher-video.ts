import type {WebContents} from 'electron'
import type {PageVideoTargets,VideoTargetScope,VideoTarget} from '@bmw-agent/agent-contract/video-identity'
import {readRendererPhase} from './renderer-read.js'

export type PublisherVideoSite='cnbc'|'fox'|'cnn'|'yahoo-finance'
export function publisherVideoSite(address:string):PublisherVideoSite|undefined {
 try{const u=new URL(address);if(u.protocol!=='https:'||u.username||u.password||u.port)return
  if(['www.cnbc.com','cnbc.com'].includes(u.hostname)&&/^\/video\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.html$/.test(u.pathname))return 'cnbc'
  if(['www.cnn.com','edition.cnn.com','cnn.com'].includes(u.hostname)&&/^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9/-]+\/video\/[a-z0-9-]+$/.test(u.pathname))return 'cnn'
  if(['finance.yahoo.com','ca.finance.yahoo.com'].includes(u.hostname)&&/^\/video\/[a-z0-9-]+-\d{6,15}\.html\/?$/.test(u.pathname))return 'yahoo-finance'
  if(['www.foxnews.com','foxnews.com'].includes(u.hostname)&&/^\/video\/\d+$/.test(u.pathname))return 'fox'
 }catch{/* Not an admitted publisher video page. */}
}
interface ParentWitness {pageUrl:string;publisher:PublisherVideoSite;contentId:string;title:string;durationSeconds:number;playerUrl:string;videoIndex:number;mp4:string;hls:string;frameUrl:string;assetKey:string;cnnCanonical?:string;cnnEmbed?:string;yahooCanonical?:string;yahooEmbed?:string}
interface PublisherUnavailable {blocked:string}
interface FrameWitness {contentId:string;durationSeconds:number;playerUrl:string;hls:string;assetKey:string;adInProgress:false}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const text=(value:unknown,max=8192)=>typeof value==='string'&&value.length<=max?value:''
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=86400
const close=(a:number,b:number)=>Math.abs(a-b)<=Math.max(.5,b*.01)
function foxEmbedUrl(value:string,pageUrl:string,id:string):boolean {
 try{const u=new URL(value),page=new URL(pageUrl),hash=new URLSearchParams(u.hash.slice(1)),source=new URL('https://'+hash.get('url'))
  return value.length<=8192&&u.origin==='https://static.foxnews.com'&&!u.username&&!u.password&&!u.port&&u.pathname==='/static/orion/html/video/iframe/vod.html'&&/^[A-Za-z0-9_-]{1,100}$/.test(hash.get('uid')??'')&&source.origin===page.origin&&source.pathname==='/video/'+id&&!source.search&&!source.hash
 }catch{return false}
}
function cnnBinding(pageUrl:string,id:string,canonical:string,embed:string):boolean {
 try{const p=new URL(pageUrl),c=new URL(canonical),e=new URL(embed);return /^me[a-f0-9]{32,64}$/.test(id)&&publisherVideoSite(pageUrl)==='cnn'&&c.protocol==='https:'&&['www.cnn.com','edition.cnn.com','cnn.com'].includes(c.hostname)&&!c.username&&!c.password&&!c.port&&!c.search&&!c.hash&&c.pathname===p.pathname&&e.origin==='https://fave.api.cnn.io'&&e.pathname==='/v1/fav/'&&!e.username&&!e.password&&!e.port&&!e.hash&&e.searchParams.getAll('video').length===1&&e.searchParams.get('video')===id}catch{return false}
}
function yahooBinding(pageUrl:string,id:string,canonical:string,embed:string):boolean {
 try{const p=new URL(pageUrl),c=new URL(canonical),e=new URL(embed),path=(u:URL)=>u.pathname.replace(/\/$/,'')
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)&&publisherVideoSite(pageUrl)==='yahoo-finance'&&[c,e].every(u=>u.protocol==='https:'&&['finance.yahoo.com','ca.finance.yahoo.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&!u.hash&&path(u)===path(p))&&!c.search&&[...e.searchParams.keys()].every(k=>k==='format')&&e.searchParams.getAll('format').length<=1
 }catch{return false}
}
const delivery=(value:string,site:PublisherVideoSite,role:'mp4'|'hls',id:string,asset='')=>{
 try{const u=new URL(value);if(value.length>8192||u.username||u.password||u.port)return false
  if(site==='cnn'){const m=/^\/cnn\/clips\/\d{4}-\d{2}\/(\d+)-[a-f0-9]{32}\/mp4\/([a-z0-9_-]+)\.mp4$/.exec(u.pathname);return role==='mp4'&&u.protocol==='https:'&&u.hostname==='clips-media-aka.warnermediacdn.com'&&!!m&&m[1]===asset&&m[2]!.includes('-'+asset+'-')}
  if(site==='yahoo-finance')return role==='hls'&&u.origin==='https://video.media.yql.yahoo.com'&&u.pathname==='/v1/video/sapi/hlsstreams/'+id+'.m3u8'&&!u.hash&&[...u.searchParams.keys()].every(k=>['site','region','lang','devtype'].includes(k)&&u.searchParams.getAll(k).length===1&&(u.searchParams.get(k)?.length??0)<=128)
  if(site==='cnbc')return u.protocol==='https:'&&(role==='mp4'?u.hostname==='pdl-iphone-cnbc-com.akamaized.net'&&u.pathname.startsWith('/'+id+'/')&&u.pathname.endsWith('.mp4'):u.hostname==='cnbcawsmpvod.akamaized.net'&&u.pathname.startsWith('/out/v1/')&&u.pathname.endsWith('.m3u8'))
  const match=role==='mp4'?/^\/media\/v1\/pmp4\/static\/clear\/(\d+\/[a-f0-9-]{36})\/[a-f0-9-]{36}\/main\.mp4$/.exec(u.pathname):/^\/manifest\/v1\/hls\/v4\/clear\/(\d+\/[a-f0-9-]{36})\//.exec(u.pathname)
  return !!match&&match[1]===asset&&(role==='mp4'?['http:','https:'].includes(u.protocol)&&u.hostname==='vod.foxnews.com':u.protocol==='https:'&&u.hostname==='manifest.prod.boltdns.net'&&u.pathname.endsWith('.m3u8'))
 }catch{return false}
}
/** Strict Host validation of fixed renderer witnesses, never a network-first resolver. */
export function publisherTarget(pageUrl:string,parentRaw:unknown,frameRaw?:unknown):VideoTarget {
 const p=object(parentRaw),site=publisherVideoSite(pageUrl),id=text(p.contentId,80),duration=p.durationSeconds
 if(!site||p.publisher!==site||p.pageUrl!==pageUrl||(site==='cnn'?!/^me[a-f0-9]{32,64}$/.test(id):site==='yahoo-finance'?!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id):!/^\d{1,20}$/.test(id))||!finite(duration)||!text(p.title,1000)||!Number.isInteger(p.videoIndex)||Number(p.videoIndex)<-1||Number(p.videoIndex)>10000)throw new Error('VIDEO_IDENTITY_UNAVAILABLE: Publisher metadata does not identify one finite original.')
 const asset=text(p.assetKey,100),resources:VideoTarget['resources']=[]
 let playerUrl=text(p.playerUrl),seconds=Number(duration),hls=text(p.hls),index=Number(p.videoIndex)
 if(site==='cnn'&&(index!==-1||!cnnBinding(pageUrl,id,text(p.cnnCanonical),text(p.cnnEmbed))||p.playerUrl!==p.mp4||hls||p.frameUrl||!/^\d+$/.test(asset)))throw new Error('VIDEO_IDENTITY_UNAVAILABLE: Missing canonical CNN original declaration.');
 if(site==='yahoo-finance'&&(index!==-1||!yahooBinding(pageUrl,id,text(p.yahooCanonical),text(p.yahooEmbed))||p.playerUrl!==hls||p.mp4||p.frameUrl||asset!==id))throw new Error('VIDEO_IDENTITY_UNAVAILABLE: Missing canonical Yahoo Finance original declaration.')
 if(site==='fox'){
  if(id!==new URL(pageUrl).pathname.split('/').at(-1)||index!==-1||!/^\d+\/[a-f0-9-]{36}$/.test(asset)||!foxEmbedUrl(text(p.frameUrl),pageUrl,id))throw new Error('VIDEO_IDENTITY_UNAVAILABLE: Missing original Fox embed identity.')
  const f=object(frameRaw)
  if(f.contentId!==id||f.assetKey!==asset||f.adInProgress!==false||!finite(f.durationSeconds)||!close(Number(f.durationSeconds),seconds))throw new Error('VIDEO_IDENTITY_UNAVAILABLE: Fox frame is advertising, live, foreign or incomplete.')
  playerUrl=text(f.playerUrl);seconds=Number(f.durationSeconds);hls=text(f.hls)
 }
 try{const u=new URL(playerUrl);if(!['blob:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Invalid player')}catch{throw new Error('VIDEO_IDENTITY_UNAVAILABLE: Publisher player source is missing.')}
 for(const [url,role]of [[text(p.mp4),'mp4'],[hls,'hls']] as const){if(!url)continue;if(!delivery(url,site,role,id,asset))throw new Error('VIDEO_IDENTITY_UNBOUND: Foreign publisher delivery.');resources.push({url,role:role==='mp4'?'muxed':'hls',durationSeconds:seconds,bitrate:0,audioGroup:'default',defaultAudio:true})}
 if(!resources.length)throw new Error('VIDEO_IDENTITY_UNAVAILABLE: Publisher has no declared original delivery.')
 // The stable ID pins the original program. Signed delivery URLs remain exact
 // resource witnesses and are independently checked again on every guard read.
 return {identity:{version:1,platform:'page',targetId:pageUrl,resourceId:site+':'+id},playerUrl,videoIndex:index,durationSeconds:seconds,resources}
}

/** Fixed read-only main-frame program. Only documented player content getters,
 * public publisher metadata/JSON-LD and the selected visible DOM range. */
export function inspectPublisherParent(scope:VideoTargetScope={}):ParentWitness|PublisherUnavailable {
 let phase='page metadata';const unavailable=():PublisherUnavailable=>({blocked:phase})
 const rec=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{},win=window as unknown as Record<string,unknown>
 const visible=(e:Element)=>{let depth=0;if(!e.getClientRects().length)return false;for(let n:Element|null=e;n;n=n.parentElement){if(++depth>100)return false;const s=getComputedStyle(n);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)return false}return true}
 const url=(v:unknown)=>{try{if(typeof v!=='string'||!v||v.length>8192)return '';const u=new URL(v,location.href);return u.username||u.password||u.port||!['http:','https:','blob:'].includes(u.protocol)?'':u.href}catch{return ''}}
 const normalize=(s:unknown)=>typeof s==='string'?s.replace(/\s+/g,' ').trim():''
 const duration=(v:unknown)=>{if(typeof v!=='string')return 0;const m=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(v);return m?Number(m[1]??0)*3600+Number(m[2]??0)*60+Number(m[3]??0):0}
 const page=new URL(location.href);page.hash='';const root=scope.selector?document.querySelectorAll(scope.selector)[scope.index??0]:document;if(!root)return unavailable()
 const excluded=['[hidden]','[aria-hidden="true"]',...(scope.excludeSelectors??[])],allowed=(e:Element)=>root.contains(e)&&visible(e)&&!excluded.some(s=>e.closest(s))
 const heading=normalize(document.querySelector('h1')?.textContent);if(!heading)return unavailable()
 const objects:Record<string,unknown>[]=[];for(const s of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,16)){if((s.textContent??'').length>256*1024)continue;try{const j:unknown=JSON.parse(s.textContent??''),r=rec(j),items=Array.isArray(j)?j:Array.isArray(r['@graph'])?r['@graph']:[j];for(const item of items.slice(0,64)){const o=rec(item);if(o['@type']==='VideoObject'&&normalize(o.name)===heading)objects.push(o)}}catch{/* Invalid metadata cannot grant a resource. */}}
 const vids=[...document.querySelectorAll('video')]
 if(['finance.yahoo.com','ca.finance.yahoo.com'].includes(page.hostname)){
  phase='Yahoo Finance scoped canonical original declaration'
  const h1=document.querySelector('h1')
  if(objects.length!==1||!h1||!allowed(h1))return unavailable()
  const data=objects[0]!,id=typeof data.identifier==='string'?data.identifier:'',hls=url(data.contentUrl),yahooEmbed=url(data.embedUrl),yahooCanonical=url(document.querySelector('link[rel="canonical"]')?.getAttribute('href')),seconds=duration(data.duration)
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)||!hls||!yahooEmbed||!yahooCanonical||!seconds||seconds>86400)return unavailable()
  return {pageUrl:page.href,publisher:'yahoo-finance',contentId:id,title:heading,durationSeconds:seconds,playerUrl:hls,videoIndex:-1,mp4:'',hls,frameUrl:'',assetKey:id,yahooCanonical,yahooEmbed}
 }
 if(['www.cnbc.com','cnbc.com'].includes(page.hostname)){
  phase='CNBC canonical metadata/title';const meta=rec(win.__CNBC_META_DATA),id=String(meta.vcpsId??''),canonical=url(meta.url)
  if(!/^\d{1,20}$/.test(id)||meta.type!=='cnbcvideo'||canonical!==page.href||normalize(meta.title)!==heading)return unavailable()
  phase='CNBC visible scoped JW player';const players=vids.filter(v=>allowed(v)&&!!v.closest('.jwplayer'));if(players.length!==1)return unavailable();const v=players[0]!,container=v.closest('.jwplayer') as HTMLElement
  phase='CNBC ad state';if(container.classList.contains('jw-flag-ads')||container.classList.contains('jw-state-advertising'))return unavailable()
  phase='CNBC SDK container';const factory=win.jwplayer;if(typeof factory!=='function')return unavailable()
  const player=rec(Reflect.apply(factory,win,[container.id])),call=(name:string)=>typeof player[name]==='function'?Reflect.apply(player[name] as (...args:never[])=>unknown,player,[]):undefined
  if(call('getContainer')!==container)return unavailable()
  phase='CNBC playlist identity/duration';const item=rec(call('getPlaylistItem')),seconds=v.duration,itemSeconds=Number(item.duration??call('getDuration'))
  if(item.mediaid!=='cnbc_'+id||url(item.url)!==canonical||normalize(item.title)!==heading||!Number.isFinite(seconds)||seconds<=0||seconds>86400||!Number.isFinite(itemSeconds)||Math.abs(seconds-itemSeconds)>Math.max(.5,itemSeconds*.01))return unavailable()
  phase='CNBC SDK ad state';const ad=call('getAdState');if(ad!==undefined&&ad!==null&&ad!==''&&ad!==false&&ad!=='idle'&&ad!=='none')return unavailable()
  phase='CNBC selected HLS source identity';const sources=Array.isArray(item.sources)?item.sources.map(rec):[],hls=url(item.file),declared=sources.filter(s=>url(s.file)===hls&&s.mediaid===item.mediaid&&url(s.url)===canonical)
  if(!hls||declared.length!==1)return unavailable()
  phase='CNBC declared MP4 uniqueness';const mp4s=[...new Set(objects.filter(o=>Math.abs(duration(o.duration)-seconds)<=Math.max(.5,seconds*.01)).map(o=>url(o.contentUrl)).filter(Boolean))]
  if(mp4s.length>1)return unavailable()
  return {pageUrl:page.href,publisher:'cnbc',contentId:id,title:heading,durationSeconds:seconds,playerUrl:url(v.currentSrc||v.src),videoIndex:vids.indexOf(v),mp4:mp4s[0]??'',hls,frameUrl:'',assetKey:''}
 }
 if(['www.cnn.com','edition.cnn.com','cnn.com'].includes(page.hostname)){
  phase='CNN scoped public original declaration';if(objects.length!==1)return unavailable()
  // A declared original is independent of whatever advertisement is currently
  // playing. It never authorizes capture of that player (videoIndex remains -1).
  const originals=[...document.querySelectorAll('[data-component-name="video-resource"][data-video-id]')].slice(0,128).filter(e=>(allowed(e)||root instanceof Element&&e.contains(root)&&allowed(root))&&e.getAttribute('data-media-id')===e.getAttribute('data-video-id')&&e.getAttribute('data-canonical-url-path')===page.pathname&&normalize(e.getAttribute('data-headline'))===heading&&e.getAttribute('data-live')===''&&e.getAttribute('data-auth-type')===''&&e.getAttribute('data-content-type')==='mediasource-clip')
  const ids=[...new Set(originals.map(e=>e.getAttribute('data-video-id')))],canonicals=[...new Set(originals.map(e=>url(e.getAttribute('data-canonical-url'))))]
  if(ids.length!==1||canonicals.length!==1)return unavailable()
  const id=ids[0]??'',data=objects[0]!,mp4=url(data.contentUrl),cnnEmbed=url(data.embedUrl),cnnCanonical=canonicals[0]!,seconds=duration(data.duration)
  if(!/^me[a-f0-9]{32,64}$/.test(id)||!seconds||seconds>86400||!mp4||!cnnEmbed||!cnnCanonical)return unavailable()
  let assetKey='';try{assetKey=/^\/cnn\/clips\/\d{4}-\d{2}\/(\d+)-[a-f0-9]{32}\/mp4\//.exec(new URL(mp4).pathname)?.[1]??''}catch{return unavailable()}
  if(!assetKey)return unavailable()
  return {pageUrl:page.href,publisher:'cnn',contentId:id,title:heading,durationSeconds:seconds,playerUrl:mp4,videoIndex:-1,mp4,hls:'',frameUrl:'',assetKey,cnnCanonical,cnnEmbed}
 }
 if(!['www.foxnews.com','foxnews.com'].includes(page.hostname))return unavailable()
 const id=/^\/video\/(\d+)$/.exec(page.pathname)?.[1];if(!id)return unavailable()
 phase='Fox visible original wrapper/metadata';const wrappers=[...document.querySelectorAll('[data-widget-type="embed"][data-video-id]')].filter(e=>(allowed(e)||root instanceof HTMLIFrameElement&&e.contains(root)&&allowed(root))&&e.getAttribute('data-video-id')===id&&e.getAttribute('data-video-gated')==='false')
 if(wrappers.length!==1||objects.length!==1)return unavailable()
 phase='Fox scoped iframe';const wrapper=wrappers[0]!,frames=[...wrapper.querySelectorAll('iframe[src]')].filter(allowed) as HTMLIFrameElement[];if(frames.length!==1)return unavailable()
 phase='Fox parent/frame URL identity';const frameUrl=url(frames[0]!.src);let f:URL;try{f=new URL(frameUrl);const hash=new URLSearchParams(f.hash.slice(1)),parent=new URL('https://'+hash.get('url'));if(f.origin!=='https://static.foxnews.com'||f.pathname!=='/static/orion/html/video/iframe/vod.html'||hash.get('uid')!==wrapper.getAttribute('data-embed-uid')||parent.hostname!==page.hostname||parent.pathname!==page.pathname)return unavailable()}catch{return unavailable()}
 phase='Fox canonical metadata/duration';const data=objects[0]!,mp4=url(data.embedUrl),source=url(data.contentUrl),seconds=duration(data.duration);if(source!==page.href||!seconds||seconds>86400)return unavailable()
 phase='Fox declared MP4 asset';let assetKey='';try{assetKey=/^\/media\/v1\/pmp4\/static\/clear\/(\d+\/[a-f0-9-]{36})\//.exec(new URL(mp4).pathname)?.[1]??''}catch{return unavailable()}
 if(!assetKey)return unavailable()
 return {pageUrl:page.href,publisher:'fox',contentId:id,title:heading,durationSeconds:seconds,playerUrl:'',videoIndex:-1,mp4,hls:'',frameUrl,assetKey}
}

/** The only admitted child is the actual scoped Fox embed, never ad/reply frames. */
export function inspectFoxPlayer(contentId:string):FrameWitness|PublisherUnavailable {
 let phase='Fox SDK current player/ad/content identity';const unavailable=():PublisherUnavailable=>({blocked:phase})
 const rec=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{},win=window as unknown as Record<string,unknown>,amp=rec(win.amp),media=rec(amp.media),ads=rec(amp.ads),root=document.querySelector('#player[data-amp-guid]'),video=amp.mediaElement
 if(!root||root.getAttribute('data-amp-guid')!==contentId||amp.container!==root||!(video instanceof HTMLVideoElement)||!root.contains(video)||!video.getClientRects().length||media.guid!==contentId||media.isLive!==false||amp.isLive!==false||ads.inProgress!==false||root.classList.contains('amp-ad-break'))return unavailable()
 phase='Fox current program duration';const seconds=Number(media.duration),actual=video.duration;if(!Number.isFinite(seconds)||seconds<=0||seconds>86400||!Number.isFinite(actual)||Math.abs(seconds-actual)>Math.max(.5,seconds*.01))return unavailable()
 phase='Fox current poster asset';let assetKey='';try{const poster=new URL(String(media.poster),location.href);if(poster.hostname!=='a57.foxnews.com')return unavailable();assetKey=/\/static\/(\d+\/[a-f0-9-]{36})\//.exec(poster.pathname)?.[1]??''}catch{return unavailable()}if(!assetKey)return unavailable()
 phase='Fox current HLS source';const sources=Array.isArray(media.source)?media.source.map(rec):[],urls=[...new Set(sources.filter(s=>/mpegurl/i.test(String(s.type))).map(s=>typeof s.src==='string'?s.src:'').filter(Boolean))];if(urls.length!==1)return unavailable()
 return {contentId,durationSeconds:actual,playerUrl:video.currentSrc||video.src,hls:urls[0]!,assetKey,adInProgress:false}
}

export async function readPublisherVideoTargets(wc:WebContents,pageUrl:string,scope:VideoTargetScope,signal?:AbortSignal):Promise<PageVideoTargets>{
 const unavailable=(reason:string):PageVideoTargets=>({pageUrl,platform:'page',targets:[],blocked:'Publisher original unavailable: '+reason})
 const readParent=()=>readRendererPhase<unknown>(wc,'media.identity','publisher-parent',()=>wc.mainFrame.executeJavaScript(`(${inspectPublisherParent.toString()})(${JSON.stringify(scope)})`,true),signal)
 const raw=await readParent();if(!raw)return unavailable('no unique visible original metadata/player')
 const parent=object(raw);if(typeof parent.blocked==='string')return unavailable(parent.blocked);let frameRaw:unknown
 if(parent.publisher==='fox'){
  const frameUrl=text(parent.frameUrl);if(!foxEmbedUrl(frameUrl,pageUrl,text(parent.contentId,32)))return unavailable('foreign embed URL')
  const frames=wc.mainFrame.framesInSubtree.filter(f=>!f.detached&&f!==wc.mainFrame&&f.parent===wc.mainFrame&&f.url===frameUrl)
  if(frames.length!==1)return unavailable('no unique attached original embed')
  const frame=frames[0]!,token=frame.frameToken
  frameRaw=await readRendererPhase<unknown>(wc,'media.identity','publisher-frame',()=>frame.executeJavaScript(`(${inspectFoxPlayer.toString()})(${JSON.stringify(parent.contentId)})`,true),signal)
  const frameResult=object(frameRaw);if(typeof frameResult.blocked==='string')return unavailable(frameResult.blocked)
  const again=object(await readParent())
  if(frame.detached||frame.frameToken!==token||frame.url!==frameUrl||again.contentId!==parent.contentId||again.frameUrl!==frameUrl||again.mp4!==parent.mp4||again.assetKey!==parent.assetKey)return unavailable('embed changed during observation')
 }
 try{return {pageUrl,platform:'page',targets:[publisherTarget(pageUrl,raw,frameRaw)],blocked:null}}catch(error){return unavailable(error instanceof Error?error.message:'invalid publisher witness')}
}
