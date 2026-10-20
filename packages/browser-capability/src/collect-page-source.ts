import type {WebContents} from 'electron'
import type {SourceCollection,SourceObservation,SourceScope,SourceCandidate} from '@bmw-agent/media-native/sources'
import {assertPageScope,pageRangeExpression} from './page-scope.js'
import {readRendererPhase} from './renderer-read.js'
interface RangeReply {text:string;range:SourceScope;dateTime?:string|null}
interface MediaReply {items:Record<string,unknown>[];truncated:boolean;range:unknown}
const nonPublication=/\b(?:updated|modified|recorded|retrieved|accessed|reposted)\b|更新时间|更新于|录制|转载|抓取|采集/i
/** Keep a publisher's actual date precision. A narrow metadata element may
 * contain a byline or document number too; never choose between two dates. */
function publicationLine(value:{text:string;scope:SourceScope}):string|null{
 if(value.scope.status!=='observed'||value.scope.truncated||nonPublication.test(value.text))return null
 // Publishers may paint year, month/day and a local clock in separate nodes.
 // This narrow region proves the civil day, never its timezone or instant.
 const split=value.text.trim().match(/^(\d{4})\s*\n\s*(\d{1,2})\/(\d{1,2})(?:\s*\n\s*(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$/)
 if(split){const year=Number(split[1]),month=Number(split[2]),day=Number(split[3]);if(month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate())return split[1]+'-'+split[2].padStart(2,'0')+'-'+split[3].padStart(2,'0')}
 const date='(?:\\d{4}[-年/.]\\d{1,2}[-月/.]\\d{1,2}日?|[A-Za-z]+\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4})'
 if((value.text.match(new RegExp(date,'g'))??[]).length!==1)return null
 const label=/^(?:【(?:发布日期|发布时间|发文日期)】|(?:Published(?: on)?|Press release issued|Original issue date|发布日期|发布时间|发文日期)\s*[:：]?)\s*/i
 // Publishers may label the day with a weekday, a local clock and a timezone
 // abbreviation; the element still proves only that civil day.
 const weekday='(?:(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?\\.?,?\\s+)?',clock='\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?(?:\\s*[A-Z]{2,5})?'
 const exact=new RegExp('^(?:'+weekday+'(?:'+date+')(?:\\s+'+clock+')?|\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d(?::\\d\\d(?:\\.\\d+)?)?(?:Z|[+-]\\d\\d:\\d\\d))$','i')
 const lines=value.text.split(/\r?\n/).map(line=>line.trim().replace(label,'')),matches=lines.flatMap(line=>{if(exact.test(line))return [line];const release=line.match(new RegExp('(?:^|\\s)Release\\s*[:：]?\\s*('+date+')$','i'));return release?[release[1]]:[]})
 return matches.length===1&&matches[0].length<=80?matches[0]:null
}
/** One bounded page transaction, with navigation invalidation across all phases. */
export async function collectPageSource(wc:WebContents,request:SourceCollection,listMedia:(scope:Record<string,unknown>,signal?:AbortSignal)=>Promise<MediaReply>,signal?:AbortSignal):Promise<SourceObservation>{
 const body=assertPageScope({selector:request.bodySelector,index:request.index,excludeSelectors:request.excludeSelectors,maxCharacters:50000})
 const media=assertPageScope({selector:request.mediaSelector??request.bodySelector,index:request.mediaIndex??request.index,excludeSelectors:request.mediaExcludeSelectors??request.excludeSelectors,maxCharacters:1000})
 const url=wc.getURL(),controller=new AbortController();let navigated=false;const truncatedMetadata:string[]=[]
 const navigation=(_event:unknown,_url:string,inPlace:boolean,mainFrame:boolean)=>{if(mainFrame&&!inPlace){navigated=true;controller.abort(new Error('Source page navigated during collection.'))}}
 const cancelled=()=>controller.abort(signal?.reason)
 signal?.throwIfAborted();wc.on('did-start-navigation',navigation);signal?.addEventListener('abort',cancelled,{once:true})
 const initial=(scope:typeof body):SourceScope=>({selector:scope.selector!,index:scope.index,excludeSelectors:scope.excludeSelectors,characterUnit:'utf16',extraction:'visible-text-nodes',truncated:false,status:'failed'})
 const scope=(raw:unknown):SourceScope=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid source range reply.');const range=raw as SourceScope;return {selector:range.selector,index:range.index,excludeSelectors:range.excludeSelectors,characterUnit:range.characterUnit,extraction:range.extraction,truncated:range.truncated,status:range.status}}
 let result:SourceObservation={url,title:wc.getTitle().slice(0,500),author:null,publishedAt:null,scope:initial(body),text:'',mediaScope:initial(media),mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:'failed',error:null}
 const read=async(selector:string,index=0,maxCharacters=1000,excludeSelectors:string[]=[])=>{
  const input=assertPageScope({selector,index,maxCharacters,excludeSelectors})
  const value=await readRendererPhase<RangeReply>(wc,'source.collect','body',()=>wc.executeJavaScript(`(()=>{const {text,range}=${pageRangeExpression(input)};const el=${selector===request.publishedSelector?`document.querySelectorAll(${JSON.stringify(input.selector)})[${input.index}]`:'null'};return {text,range,dateTime:el?.tagName==='TIME'?(el.getAttribute('datetime')??'').slice(0,80):null}})()`,true),controller.signal)
  const dateTime=typeof value.dateTime==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(value.dateTime)&&Number.isFinite(Date.parse(value.dateTime))?value.dateTime:null
  return {text:value.text,scope:scope(value.range),dateTime}
 }
 const metadata=(value:{text:string;scope:SourceScope},name:string,max:number)=>{const text=value.text.trim();if(value.scope.truncated||text.length>max)truncatedMetadata.push(name);return text.slice(0,max)}
 try{
  if(wc.getTitle().length>500)truncatedMetadata.push('title')
  const observed=await read(body.selector!,body.index,body.maxCharacters,body.excludeSelectors);result.scope=observed.scope;result.text=observed.text
  if(request.authorSelector){const author=await read(request.authorSelector);result.author=metadata(author,'author',280)||null}
  if(request.publishedSelector){const published=await read(request.publishedSelector);result.publishedAt=published.scope.status==='observed'&&published.dateTime&&!nonPublication.test(published.text)?published.dateTime:publicationLine(published)??(metadata(published,'publishedAt',80)||null)}
  if(request.accessSelector){const access=await read(request.accessSelector);result.accessText=metadata(access,'accessText',500);if(/登录后(?:观看|播放)|请先登录.{0,12}(?:观看|播放)|login required|sign in to (?:watch|play)/i.test(result.accessText))result.access='login-required';else if(/试看|预览时长|\bpreview\b|\btrial\b/i.test(result.accessText))result.access='preview'}
  // Missing body must not fall back to whole-page recommendations.
  if(result.scope.status==='observed'){
   const found=await listMedia({selector:media.selector,index:media.index,excludeSelectors:media.excludeSelectors,maxItems:80},controller.signal);result.mediaScope=scope(found.range);result.mediaTruncated=found.truncated
   const identities=new Set<string>();const candidates:Omit<SourceCandidate,'id'>[]=[]
   for(const item of found.items){if(!['image','poster','video','source'].includes(String(item.kind))||typeof item.url!=='string')continue
    try{const address=new URL(item.url);if(address.username||address.password||!['http:','https:','blob:'].includes(address.protocol))continue;address.hash='';if(address.href.length>4096)continue
     const kind=item.kind as SourceCandidate['kind'],key=kind+':'+address.href;if(identities.has(key))continue;identities.add(key)
     const duration=typeof item.duration==='number'&&Number.isFinite(item.duration)&&item.duration>0&&item.duration<=86400?item.duration:null
     candidates.push({kind,url:address.href,durationSeconds:duration,role:kind==='image'?'body':kind==='poster'?'cover':'video'})
    }catch{/* Non-media/unsupported addresses remain discoveries, never artifacts. */}
   }
   result.candidates=candidates
  }
  if(navigated||wc.getURL()!==url)throw new Error('Source page changed during collection.')
  result.result=result.scope.status==='element-not-found'?'missing-range':result.access==='login-required'?'login-required':result.scope.truncated||result.mediaTruncated||truncatedMetadata.length>0?'truncated':'observed'
  if(truncatedMetadata.length)result.error='Metadata truncated: '+truncatedMetadata.join(', ')+'.'
  if(result.mediaScope.status==='element-not-found'){result.result='missing-range';result.error='The explicit media range was not found.'}
  return result
 }catch(error){signal?.throwIfAborted();if(!navigated&&error instanceof Error&&error.message==='element-not-found')return {...result,mediaScope:{...result.mediaScope,status:'element-not-found'},result:'missing-range',error:'The explicit media range was not found.',candidates:[]};return {...result,result:navigated||wc.getURL()!==url?'navigated':'failed',error:(error instanceof Error?error.message:String(error)).slice(0,2000),candidates:[]}}
 finally{wc.removeListener('did-start-navigation',navigation);signal?.removeEventListener('abort',cancelled)}
}
