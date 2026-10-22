import type {SourceCollection,SourceObservation} from '@bmw-agent/media-native/sources'
import type {SubscriptionInput} from './rolling-contract.js'
/** Fixed, auditable DOM scopes. Unknown templates remain on the manual path. */
export interface CollectionAdapter {entry:Omit<SourceCollection,'tabId'>;article:Omit<SourceCollection,'tabId'>;articleUrl(raw:string):string|null;entryOnly:boolean}
const exclude=['nav','aside','form','iframe','video','audio','[class*="newsletter"]','[class*="related"]','[class*="ad-slot"]']
export function normalizeCollectionUrl(raw:string):string {
 const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw new Error('Batch sources require public HTTPS URLs.');u.hash=''
 for(const key of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid|si|feature|themeRefresh|t)$/.test(key))u.searchParams.delete(key)
 if(/(^|\.)youtube\.com$/.test(u.hostname)&&u.pathname==='/watch'){const id=u.searchParams.get('v');u.search='';if(id)u.searchParams.set('v',id)}
 return u.href
}
export function collectionAdapter(input:SubscriptionInput):CollectionAdapter {
 const entry=new URL(input.url),host=entry.hostname.replace(/^www\./,''),article={bodySelector:'main',excludeSelectors:exclude,authorSelector:'a[rel="author"]',publishedSelector:'time'}
 const result=(selector:string,accept:(u:URL)=>boolean,articleScope:Omit<SourceCollection,'tabId'>=article,entryOnly=false):CollectionAdapter=>({entry:{bodySelector:selector},article:articleScope,entryOnly,articleUrl(raw){try{const url=normalizeCollectionUrl(new URL(raw,input.url).href),u=new URL(url);return accept(u)?url:null}catch{return null}}})
 if(input.platform==='x'){
  if(host!=='x.com'&&host!=='twitter.com')throw new Error('Unsupported X batch entry.')
  if(entry.pathname.startsWith('/explore'))return result('main',()=>false,{bodySelector:'main'},true)
  const account=entry.pathname.split('/').filter(Boolean)[0]
  if(!account||!/^[a-zA-Z0-9_]+$/.test(account))throw new Error('Unsupported X account entry; use manual collection.')
  return result('main',u=>['x.com','twitter.com'].includes(u.hostname)&&new RegExp('^/'+account+'/status/\\d+$','i').test(u.pathname),{bodySelector:'main',authorSelector:'article [data-testid="User-Name"]',publishedSelector:'article time'})
 }
 if(input.platform==='youtube'){
  if(!['youtube.com','m.youtube.com'].includes(host))throw new Error('Unsupported YouTube batch entry.')
  return result(entry.pathname==='/results'?'ytd-two-column-search-results-renderer':'ytd-browse',u=>['www.youtube.com','youtube.com','m.youtube.com'].includes(u.hostname)&&u.pathname==='/watch'&&Boolean(u.searchParams.get('v')),{bodySelector:'ytd-watch-metadata',authorSelector:'#owner #channel-name',publishedSelector:'#info-strings yt-formatted-string'})
 }
 if(host==='openai.com')return result('main',u=>u.hostname==='openai.com'&&/^\/(?:index|[a-z-]+\/index)\/[^/]+\/?$/.test(u.pathname))
 if(host==='blogs.nvidia.com')return result('main',u=>u.hostname===host&&/^\/blog\/[^/]+\/?$/.test(u.pathname))
 if(host==='huggingface.co')return result('main',u=>u.hostname===host&&/^\/blog\/(?!community(?:\/|$))(?!(?:zh|ja|ko|fr|de|es|pt|ru|ar|hi|it|tr|vi|uk)(?:\/)?$)[^/]+(?:\/[^/]+)?\/?$/.test(u.pathname))
 if(host==='techcrunch.com')return result('main',u=>u.hostname===host&&/^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/.test(u.pathname))
 if(host==='qbitai.com')return result('body',u=>u.hostname.replace(/^www\./,'')===host&&/^\/\d{4}\/\d{2}\/\d+\.html$/.test(u.pathname),{...article,bodySelector:'body'})
 throw new Error('This fixed source has no batch adapter; use the existing manual collection entry.')
}

/** Qbit's visible publication header paints author, civil date and clock as
 * separate lines, without a TIME element. Admit only the exact complete date
 * line beside the independently collected author; never infer a timezone. */
export function collectionArticleObservation(input:SubscriptionInput,observation:SourceObservation):SourceObservation {
 if(input.platform!=='web'||new URL(input.url).hostname.replace(/^www\./,'')!=='qbitai.com'||new URL(observation.url).hostname.replace(/^www\./,'')!=='qbitai.com'||observation.publishedAt||!observation.author||observation.result!=='observed'||observation.scope.status!=='observed'||observation.scope.truncated)return observation
 const lines=observation.text.split('\n').slice(0,10),matches=lines.flatMap((line,index)=>/^\d{4}-\d{2}-\d{2}$/.test(line)?[{line,index}]:[])
 if(matches.length!==1)return observation
 const {line,index}=matches[0];if(index<1||lines[index-1]!==observation.author||!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(lines[index+1]??''))return observation
 const day=new Date(line+'T00:00:00Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==line)return observation
 const startCharacter=lines.slice(0,index).reduce((offset,text)=>offset+text.length+1,0)
 return {...observation,publishedAt:line,metadataRanges:{...observation.metadataRanges,publishedAt:{startCharacter,endCharacter:startCharacter+line.length,quote:line}}}
}
