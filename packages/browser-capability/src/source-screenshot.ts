import crypto from 'node:crypto'
import type {WebContents} from 'electron'
import type {ProjectSourcePort,SourceScreenshotBinding} from '@bmw-agent/media-native/sources'
import type {ImageInspection} from '@bmw-agent/media-native/image'
import {assertPageScope,pageRangeExpression} from './page-scope.js'
import {readRendererPhase} from './renderer-read.js'
function record(raw:unknown):Record<string,unknown>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid screenshot record.');return raw as Record<string,unknown>}
function admitBinding(raw:unknown):SourceScreenshotBinding{const v=record(raw);if(Object.keys(v).some(k=>!['sourceId','acquisitionId','expectedRevision'].includes(k)))throw new TypeError('Unsupported source screenshot field.');if(typeof v.sourceId!=='string'||typeof v.acquisitionId!=='string'||![v.sourceId,v.acquisitionId].every(id=>/^[a-zA-Z0-9-]{1,80}$/.test(id))||typeof v.expectedRevision!=='number'||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0||v.expectedRevision>1000000)throw new TypeError('Invalid source screenshot binding.');return {sourceId:v.sourceId,acquisitionId:v.acquisitionId,expectedRevision:v.expectedRevision}}
function pageUrl(raw:string):string{const url=new URL(raw);url.hash='';return url.href}
/** Fast admission of the native CDP PNG before nativeImage allocates pixels.
 * Full container/header checks remain with the Project's media implementation. */
function checkPng(png:Buffer):{width:number;height:number}{if(png.length<24||png.length>32*1024*1024||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.toString('ascii',12,16)!=='IHDR')throw new Error('Source screenshot is not a bounded PNG.');const width=png.readUInt32BE(16),height=png.readUInt32BE(20);if(!width||!height||width*height>16_777_216)throw new Error('Source screenshot exceeds its pixel budget.');return {width,height}}

/** A model supplies identities only. Native URL, scoped text and decoded PNG
 * facts are checked around capture before the Project accepts any provenance. */
export async function prepareSourceScreenshot(port:ProjectSourcePort|undefined,wc:WebContents,raw:unknown,selector:unknown,index:unknown,signal?:AbortSignal){
 if(raw===undefined)return undefined
 if(!port?.recordScreenshot)throw new Error('SOURCE_SCREENSHOT_UNAVAILABLE: This Project cannot bind page captures.')
 const binding=admitBinding(raw),body=await port.readBody(binding.sourceId,binding.acquisitionId,signal),a=body.acquisition
 if(port.snapshot().revision!==binding.expectedRevision)throw new Error('SOURCE_CONFLICT: Reload the source catalog.')
 if(a.result!=='observed'||a.scope.truncated||!a.contentId||selector!==a.scope.selector||Number(index??0)!==a.scope.index)throw new Error('SOURCE_SCREENSHOT_SCOPE: Capture the exact collected body selector and index.')
 const originalUrl=body.source.url,projectId=port.snapshot().projectId,scope=a.scope,contentId=a.contentId
 const controller=new AbortController(),captureSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal,navigation=(_event:unknown,_url:string,_inPlace:boolean,mainFrame:boolean)=>{if(mainFrame)controller.abort(new Error('SOURCE_SCREENSHOT_NAVIGATED: Page navigated during capture.'))},gone=()=>controller.abort(new Error('SOURCE_SCREENSHOT_RENDERER_GONE: Capture page closed.'))
 wc.on('did-start-navigation',navigation);wc.on('destroyed',gone);wc.on('render-process-gone',gone)
 const dispose=()=>{wc.removeListener('did-start-navigation',navigation);wc.removeListener('destroyed',gone);wc.removeListener('render-process-gone',gone)}
 const verify=async()=>{
  captureSignal.throwIfAborted();if(pageUrl(wc.getURL())!==originalUrl||port.snapshot().projectId!==projectId)throw new Error('SOURCE_SCREENSHOT_STALE: Page or Project changed.')
  const input=assertPageScope({selector:scope.selector,index:scope.index,excludeSelectors:scope.excludeSelectors,maxCharacters:50000}),raw=record(await readRendererPhase(wc,'media.screenshot','source-body',()=>wc.executeJavaScript(pageRangeExpression(input),true),captureSignal)),r=record(raw.range)
  const actual={selector:r.selector,index:r.index,excludeSelectors:r.excludeSelectors,characterUnit:r.characterUnit,extraction:r.extraction,truncated:r.truncated,status:r.status}
  if(typeof raw.text!=='string'||raw.text.length>50000||JSON.stringify(actual)!==JSON.stringify(scope)||crypto.createHash('sha256').update(raw.text).digest('hex')!==contentId||pageUrl(wc.getURL())!==originalUrl)throw new Error('SOURCE_SCREENSHOT_STALE: Original scoped text changed; collect again.')
  captureSignal.throwIfAborted()
 }
 try{await verify()}catch(error){dispose();throw error}
 return {verify,signal:captureSignal,dispose,checkPng,record:async(artifactId:string,png:Buffer,decoded:{width:number;height:number})=>{
  await verify();const size=checkPng(png);if(decoded.width!==size.width||decoded.height!==size.height)throw new Error('Source screenshot decoded dimensions disagree.');const inspection:ImageInspection={kind:'image',contentType:'image/png',width:size.width,height:size.height,pixels:size.width*size.height,bytes:png.length,canDecode:true},contentId=crypto.createHash('sha256').update(png).digest('hex')
  const result=await port.recordScreenshot!({...binding,artifactId,inspection,contentId,pageUrl:originalUrl,scope,bodyContentId:a.contentId!,capturedAt:new Date().toISOString()},captureSignal)
  return {sourceId:result.sourceId,acquisitionId:result.acquisitionId,candidateId:result.candidateId,mediaId:result.mediaId,artifactId:result.artifactId,sourceRevision:result.catalog.revision}
 }}
}
