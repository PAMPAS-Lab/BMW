import type {DiscoveryLead,SourceObservation,TextReadBatch,TextReadBatchReceipt} from '@bmw-agent/media-native/sources'

export function discoveryAccountUrl(raw:string):string {
 const url=new URL(raw)
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||!['x.com','twitter.com'].includes(url.hostname)||!/^\/[a-zA-Z0-9_]{1,15}\/?$/.test(url.pathname)||['home','explore','search','login','signup','settings','notifications','messages','i','compose'].includes(url.pathname.split('/')[1].toLowerCase()))throw new Error('Discovery requires explicit public X account URLs.')
 return 'https://x.com/'+url.pathname.split('/')[1].toLowerCase()
}

// Compiled function is the fixed, native observer; no caller code is admitted.
// Read at most five rendered cards; never expand a post, scroll, or open a link.
function visiblePostLeads(account:string){
 const leads:DiscoveryLead[]=[],seen=new Set<string>()
 const visible=(element:Element)=>{let depth=0;for(let parent:Element|null=element;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(++depth>100||!parent.getClientRects().length||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0||style.contentVisibility==='hidden'||parent.matches('[hidden],[aria-hidden="true"]'))return false}return true}
 const elements:Element[]=Array.from(document.querySelectorAll('article,[data-testid="tweet"]'))
 for(const element of elements.slice(0,100)){
  if(!visible(element))continue
  let address:string|undefined,time:Element|undefined
  for(const anchor of Array.from(element.querySelectorAll('a[href]')).slice(0,100)){
   if(!visible(anchor))continue
   try{const url=new URL(anchor.getAttribute('href')!,location.href),parts=url.pathname.split('/').filter(Boolean)
    if(url.protocol!=='https:'||url.username||url.password||!['x.com','twitter.com'].includes(url.hostname)||parts.length!==3||parts[1]!=='status'||!/^\d+$/.test(parts[2]))continue
    if(parts[0].toLowerCase()!==account)break
    address='https://x.com/'+parts[0].toLowerCase()+'/status/'+parts[2];time=anchor.querySelector('time')??anchor
    break
   }catch{/* Non-post links cannot establish account coverage. */}
  }
  if(!address||seen.has(address))continue
  const body=element.querySelector('[data-testid="tweetText"]')??element
  if(!visible(body))continue
  const excerpt=(root:Element,max:number)=>{const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let text='',count=0,more=false;while(walker.nextNode()){if(++count>200){more=true;break}const parent=walker.currentNode.parentElement;if(!parent||parent.closest('script,style,template,noscript,input,textarea,select')||!visible(parent))continue;const part=String(walker.currentNode.textContent??'').trim();if(!part)continue;const next=text+(text?' ': '')+part;if(next.length>max){text=next.slice(0,max);more=true;break}text=next}return {text,more}}
  const extracted=excerpt(body,360),summary=extracted.text
  if(!summary)continue
  const card=excerpt(element,600).text,rawTime=time?.getAttribute('datetime'),publishedAt=rawTime&&/^\d{4}-\d\d-\d\dT/.test(rawTime)&&Number.isFinite(Date.parse(rawTime))?new Date(rawTime).toISOString():null
  seen.add(address);leads.push({url:address,summary,excerptTruncated:extracted.more||/显示更多|Show more/i.test(card),displayTime:time?.textContent?.trim().slice(0,80)||null,publishedAt,pinned:/已置顶|\bPinned\b/i.test(card)})
  if(leads.length===5)break
 }
 return {url:location.href,title:document.title.slice(0,240),leads}
}
export const discoveryExpression=(url:string)=>'('+visiblePostLeads.toString()+')('+JSON.stringify(new URL(discoveryAccountUrl(url)).pathname.slice(1))+')'

/** Explicit projection domain: never impersonates a complete article original. */
export function discoveryObservation(url:string,title:string,leads:DiscoveryLead[]):SourceObservation {
 const scope={selector:'article,[data-testid="tweet"]',index:0,excludeSelectors:[],characterUnit:'utf16' as const,extraction:'visible-post-excerpts' as const,truncated:true,status:leads.length?'observed' as const:'element-not-found' as const}
 return {url,title,author:null,publishedAt:null,scope,text:JSON.stringify({kind:'discovery-excerpts',fullTextRead:false,leads}),mediaScope:{...scope,status:'element-not-found'},mediaTruncated:false,candidates:[],access:'unknown',accessText:'',result:leads.length?'truncated':'missing-range',error:null}
}

/** One bounded account per page: explicit projection delivery, no diagnostic or
 * full-text delivery claim. Original checkpoint and diagnostic remain durable. */
export function discoveryPage(batch:TextReadBatch,receipt:TextReadBatchReceipt,offset:number){
 if(batch.mode!=='discovery'||!Number.isSafeInteger(offset)||offset<0||offset>batch.rows.length)throw new Error('Invalid discovery checkpoint or offset.')
 const row=batch.rows[offset],item=row?{index:row.index,url:row.url,state:row.state,reason:row.reason,sourceId:row.sourceId,acquisitionId:row.acquisitionId,leads:row.leads??[]}:null
 const result={projectId:batch.projectId,...receipt,section:'leads',offset,total:batch.rows.length,items:item?[item]:[],nextOffset:offset+1<batch.rows.length?offset+1:null,projection:'discovery-only',fullTextRead:false}
 if(JSON.stringify(result).length>6500)throw new Error('Discovery projection exceeded its response budget.')
 return result
}
