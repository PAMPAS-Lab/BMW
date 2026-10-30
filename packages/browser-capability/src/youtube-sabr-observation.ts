import type {Session,WebContents,Event as ElectronEvent} from 'electron'
import {youtubeSabrUrl,YOUTUBE_SABR_REQUEST_BYTES,sameVideoSourcePage} from '@bmw-agent/agent-contract/video-identity'
import type {YoutubeSabrWitness} from '@bmw-agent/media-native/preservation'
import type {VideoTarget,VideoTargetScope} from '@bmw-agent/agent-contract/video-identity'
import {readRendererPhase} from './renderer-read.js'

interface Observation {pageId:number;pageUrl:string;url:string;body:Uint8Array;at:number}
const canonical=(value:string)=>{const url=new URL(value);url.hash='';return url.href}
const youtube=(value:string)=>{try{return ['www.youtube.com','youtube.com','m.youtube.com'].includes(new URL(value).hostname)}catch{return false}}
/** Player tracking/theme query changes do not change the video; nonce/config still bind the live player. */
const videoPageKey=(value:string)=>{try{const url=new URL(value),id=url.searchParams.get('v')??/^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1];if(!youtube(value)||!id||!/^[A-Za-z0-9_-]{11}$/.test(id))return canonical(value);return url.origin+'/watch?v='+id}catch{return ''}}
/** Only ephemeral media POSTs; never cookies, headers, storage, arbitrary request bodies or diagnostics. */
export class YoutubeSabrObservationStore {
 private observations:Observation[]=[]
 add(value:Observation):void {
  let url:URL;try{url=youtubeSabrUrl(value.url)}catch{return}
  if(!youtube(value.pageUrl)||url.searchParams.get('sabr')!=='1'||!url.searchParams.get('cpn')||!value.body.length||value.body.length>YOUTUBE_SABR_REQUEST_BYTES)return
  const now=Date.now();this.observations=this.observations.filter(item=>item.at>now-120000)
  const own=this.observations.filter(item=>item.pageId===value.pageId);if(own.length>=8)this.observations=this.observations.filter(item=>item!==own[0])
  this.observations.push({...value,pageUrl:videoPageKey(value.pageUrl),body:new Uint8Array(value.body)});if(this.observations.length>48)this.observations.shift()
 }
 find(pageId:number,pageUrl:string,cpn:string):Observation[]{return this.observations.filter(item=>item.pageId===pageId&&item.pageUrl===videoPageKey(pageUrl)&&item.at>Date.now()-120000&&new URL(item.url).searchParams.get('cpn')===cpn).reverse()}
 clear(pageId:number):void {this.observations=this.observations.filter(item=>item.pageId!==pageId)}
}
interface Observer {store:YoutubeSabrObservationStore;pages:Map<number,WebContents>}
const observers=new WeakMap<Session,Observer>()
/** Browser partition owns this one native hook; Studio/library partitions are independent. */
export function registerYoutubeSabrPage(session:Session,wc:WebContents):()=>void {
 let observer=observers.get(session)
 if(!observer){observer={store:new YoutubeSabrObservationStore(),pages:new Map()};observers.set(session,observer);const current=observer
  session.webRequest.onBeforeRequest({urls:['https://*.googlevideo.com/*']},(details,done)=>{
   try{const page=current.pages.get(details.webContentsId);if(details.method!=='POST'||!page||page.isDestroyed()||!youtube(page.getURL())||!details.uploadData?.length)return
    const chunks:Uint8Array[]=[];let bytes=0
    for(const item of details.uploadData){if(!item.bytes)return;bytes+=item.bytes.length;if(bytes>YOUTUBE_SABR_REQUEST_BYTES)return;chunks.push(item.bytes)}
    current.store.add({pageId:page.id,pageUrl:page.getURL(),url:details.url,body:Buffer.concat(chunks),at:Date.now()});
   }finally{done({cancel:false})}
  })
 }
 const current=observer;current.pages.set(wc.id,wc);let disposed=false,key=videoPageKey(wc.getURL())
 const clear=()=>{current.store.clear(wc.id)},navigation=(_event:ElectronEvent,url:string,inPlace:boolean,main:boolean)=>{if(main){const next=videoPageKey(url);if(!inPlace||next!==key)clear();key=next}}
 const dispose=()=>{if(disposed)return;disposed=true;current.pages.delete(wc.id);current.store.clear(wc.id);wc.removeListener('did-start-navigation',navigation);wc.removeListener('render-process-gone',clear);wc.removeListener('destroyed',dispose);if(!current.pages.size){session.webRequest.onBeforeRequest(null);observers.delete(session)}}
 wc.on('did-start-navigation',navigation);wc.on('render-process-gone',clear);wc.once('destroyed',dispose)
 return dispose
}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
/** A historical broadcast flag is not an active live stream. Require a fixed, fully seekable program and an actual past broadcast end. */
export function assertFiniteYoutubeProgram(raw:unknown,seconds:number,now=Date.now()):void {
 const value=record(raw),duration=value.duration,start=value.seekableStart,end=value.seekableEnd
 if(typeof value.liveContent!=='boolean'||value.liveNow!==false||value.upcoming!==false||typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||Math.abs(duration-seconds)>2||value.seekableRanges!==1||typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>0.25||end<duration-1||end>duration+1)throw new Error('YOUTUBE_FINITE_PROGRAM_REQUIRED: Wait for a finite, fully seekable original program; live, upcoming and incomplete rolling windows cannot be archived.')
 if(value.liveContent){const began=typeof value.broadcastStart==='string'?Date.parse(value.broadcastStart):NaN,ended=typeof value.broadcastEnd==='string'?Date.parse(value.broadcastEnd):NaN;if(!Number.isFinite(began)||!Number.isFinite(ended)||began<=0||ended<=began||ended>now)throw new Error('YOUTUBE_FINITE_PROGRAM_REQUIRED: A broadcast replay needs an explicit past start/end and a complete fixed playback window.')}
}
export async function bindYoutubeSabrPage(wc:WebContents,target:VideoTarget,requestUrl:string,scope:VideoTargetScope,signal?:AbortSignal):Promise<{delivery:YoutubeSabrWitness;refresh:(signal:AbortSignal)=>Promise<YoutubeSabrWitness>;check:(force?:boolean)=>Promise<void>}> {
 const pageUrl=canonical(wc.getURL()),id=target.identity.targetId,index=target.videoIndex
 const expression=`(()=>{const root=${scope.selector?`document.querySelectorAll(${JSON.stringify(scope.selector)})[${scope.index??0}]`:'document'},p=document.querySelector('#movie_player'),v=document.querySelectorAll('video')[${index}],r=p?.getPlayerResponse?.(),d=p?.getVideoData?.();if(!root||!v||!root.contains(v)||!p?.contains(v)||p.classList.contains('ad-showing')||d?.video_id!==${JSON.stringify(id)}||r?.videoDetails?.videoId!==${JSON.stringify(id)}||r?.playabilityStatus?.status!=='OK')return null;const b=r.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;return {cpn:d.cpn,url:r.streamingData?.serverAbrStreamingUrl,seconds:Number(r.videoDetails.lengthSeconds),program:{liveContent:r.videoDetails.isLiveContent===true,liveNow:d.isLive===true||b?.isLiveNow===true,upcoming:r.videoDetails.isUpcoming===true||d.isUpcoming===true,duration:v.duration,seekableRanges:v.seekable.length,seekableStart:v.seekable.length?v.seekable.start(0):null,seekableEnd:v.seekable.length?v.seekable.end(v.seekable.length-1):null,broadcastStart:b?.startTimestamp,broadcastEnd:b?.endTimestamp},config:r.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig,formats:r.streamingData?.adaptiveFormats}})()`
 const read=async(activeSignal=signal)=>{activeSignal?.throwIfAborted();if(wc.isDestroyed()||!sameVideoSourcePage(pageUrl,wc.getURL(),target.identity))throw new Error('VIDEO_IDENTITY_CHANGED: YouTube source page changed.');const raw=await readRendererPhase<unknown>(wc,'media.identity','youtube-sabr',()=>wc.mainFrame.executeJavaScript(expression,true),activeSignal);if(!sameVideoSourcePage(pageUrl,wc.getURL(),target.identity))throw new Error('VIDEO_IDENTITY_CHANGED: YouTube source page changed during observation.');if(!raw||JSON.stringify(raw).length>256*1024)throw new Error('YOUTUBE_SABR_WITNESS: The current original player is unavailable.');const value=record(raw);if(typeof value.cpn!=='string'||value.cpn.length>128||value.url!==requestUrl||value.seconds!==target.durationSeconds||typeof value.config!=='string')throw new Error('VIDEO_IDENTITY_CHANGED: YouTube player response changed.');assertFiniteYoutubeProgram(value.program,target.durationSeconds!);return value}
 const initial=await read()
 const witness=(current:Record<string,unknown>):YoutubeSabrWitness=>{
  const observations=observers.get(wc.session)?.store.find(wc.id,pageUrl,String(current.cpn))??[]
  for(const item of observations)if(youtubeSabrUrl(item.url).searchParams.get('id')===youtubeSabrUrl(requestUrl).searchParams.get('id'))return {videoIdentity:target.identity,streamUrl:item.url,requestBody:item.body,ustreamerConfig:current.config,durationSeconds:target.durationSeconds!,formats:current.formats}
  throw new Error('YOUTUBE_SABR_OBSERVATION_REQUIRED: Play the requested original video briefly, then list and preserve again; no same-player SABR request is available.')
 }
 const delivery=witness(initial)
 let last=0
 return {delivery,refresh:async(refreshSignal)=>{const active=AbortSignal.any([refreshSignal,...(signal?[signal]:[])]),current=await read(active);if(current.cpn!==initial.cpn||current.config!==initial.config)throw new Error('VIDEO_IDENTITY_CHANGED: YouTube playback session changed during attestation refresh.');return witness(current)},check:async(force=false)=>{signal?.throwIfAborted();if(!force&&Date.now()-last<250)return;const current=await read();if(current.cpn!==initial.cpn||current.config!==initial.config)throw new Error('VIDEO_IDENTITY_CHANGED: YouTube playback session changed during acquisition.');last=Date.now()}}
}
