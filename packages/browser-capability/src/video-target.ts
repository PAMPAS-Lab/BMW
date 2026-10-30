import type {WebContents} from 'electron'
import {assertPageVideoTargets,inspectPageVideoTargets,selectVideoResource,youtubeAudioFor,sameVideoSourcePage} from '@bmw-agent/agent-contract/video-identity'
import type {PageVideoTargets,VideoIdentity,VideoTargetScope,SourceCaptureGuard,VideoTarget} from '@bmw-agent/media-native/sources'
import {readRendererPhase} from './renderer-read.js'
import {publisherVideoSite,readPublisherVideoTargets} from './publisher-video.js'

const pageUrl=(wc:WebContents)=>{const u=new URL(wc.getURL());u.hash='';return u.href}
export async function readVideoTargets(wc:WebContents,scope:VideoTargetScope={},signal?:AbortSignal):Promise<PageVideoTargets>{
 signal?.throwIfAborted()
 const before=pageUrl(wc)
 // Internal/about/data documents retain generic media discovery. They cannot
 // supply a public platform identity or a persisted source acquisition.
 if(!['http:','https:','file:'].includes(new URL(before).protocol))return {pageUrl:before,platform:'page',targets:[],blocked:null}
 const raw=publisherVideoSite(before)?await readPublisherVideoTargets(wc,before,scope,signal):await readRendererPhase<unknown>(wc,'media.identity','target',()=>wc.mainFrame.executeJavaScript(`(${inspectPageVideoTargets.toString()})(${JSON.stringify(scope)})`,true),signal)
 const result=assertPageVideoTargets(raw)
 const identity=result.platform==='youtube'&&result.targets.length===1?result.targets[0]!.identity:undefined
 if(!sameVideoSourcePage(before,result.pageUrl,identity)||!sameVideoSourcePage(before,pageUrl(wc),identity))throw new Error('VIDEO_IDENTITY_CHANGED: Page changed while binding the target.')
 return result
}
export interface VideoTransferAdmission {target?:VideoTarget;videoIdentity?:VideoIdentity;audio?:{url:string;durationSeconds:number};guard:()=>Promise<void>;finish:()=>Promise<void>}
/** All expected identities are made by the Host from a live page or saved source witness. */
export async function prepareVideoTransfer(wc:WebContents,url:string,signal?:AbortSignal,sourceGuard?:SourceCaptureGuard,allowImage=false):Promise<VideoTransferAdmission>{
 const before=pageUrl(wc),scope:VideoTargetScope=sourceGuard?.scope??{},state=await readVideoTargets(wc,scope,signal)
 if(sourceGuard&&!sameVideoSourcePage(sourceGuard.pageUrl,before,sourceGuard.videoIdentity))throw new Error('VIDEO_IDENTITY_CHANGED: Confirmed source page changed.')
 const image=allowImage&&await readRendererPhase<unknown>(wc,'media.identity','image',()=>wc.mainFrame.executeJavaScript(`(()=>{const root=${scope.selector?`document.querySelectorAll(${JSON.stringify(scope.selector)})[${scope.index??0}]`:'document'};return !!root&&[...(root instanceof HTMLImageElement?[root]:root.querySelectorAll('img'))].some(i=>i.complete&&i.naturalWidth>0&&(i.currentSrc===${JSON.stringify(url)}||i.src===${JSON.stringify(url)}))})()`,true),signal)
 const known=state.platform!=='page'||!!publisherVideoSite(before),bound=state.targets.some(t=>t.resources.some(r=>r.url===url))
 let target:VideoTarget|undefined
 if(!image&&(known||bound||sourceGuard?.videoIdentity))target=selectVideoResource(state,url,sourceGuard?.videoIdentity)
 if(!image&&state.blocked)throw new Error('VIDEO_IDENTITY_UNAVAILABLE: '+state.blocked)
 const audio=target?youtubeAudioFor(target,url):undefined
 let last=0
 const check=async(force=false)=>{
  signal?.throwIfAborted();if(wc.isDestroyed()||!sameVideoSourcePage(before,pageUrl(wc),target?.identity))throw new Error('VIDEO_IDENTITY_CHANGED: Source page closed or changed.')
  if(!force&&Date.now()-last<250)return
  const current=await readVideoTargets(wc,scope,signal)
  if(current.blocked&&!image)throw new Error('VIDEO_IDENTITY_CHANGED: '+current.blocked)
  if(target){const fresh=selectVideoResource(current,url,target.identity),paired=youtubeAudioFor(fresh,url);if(paired?.url!==audio?.url)throw new Error('VIDEO_IDENTITY_CHANGED: Selected audio track changed.')}
  last=Date.now()
 }
 return {target,videoIdentity:target?.identity,...(audio?{audio:{url:audio.url,durationSeconds:audio.durationSeconds??target!.durationSeconds!}}:{}),guard:()=>check(),finish:()=>check(true)}
}
