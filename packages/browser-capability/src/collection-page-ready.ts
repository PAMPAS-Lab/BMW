import {assertPageScope,pageRangeExpression} from './page-scope.js'
import type {CollectionPageSource} from './collection-page-pool.js'
/** Fixed bounded visible scopes; article prose mentioning a login wall is not
 * itself an access wall. Unready/unstable text never certifies restriction. */
export function collectionPageReadyExpression(source:CollectionPageSource):string {
 const body=pageRangeExpression(assertPageScope({selector:'body',maxCharacters:1200})),selected=pageRangeExpression(assertPageScope({selector:source.bodySelector,index:source.index,excludeSelectors:source.excludeSelectors,maxCharacters:50000}))
 return `(()=>{const title=String(document.title??'').trim().slice(0,500),text=(${body}).text;const blocked=/^(?:just a moment(?:\\.{0,3})?$|access denied|403 forbidden|429 too many requests|verify you are human|please verify|attention required|请先登录|访问被拒绝|人机验证)/i.test(title)||/^(?:sign in to confirm you(?:'|’)re not a bot|please (?:log|sign) in to continue|you must (?:log|sign) in|verify you are human|请先登录|访问被拒绝|人机验证)/i.test(text);const selected=${selected},links=[...document.querySelectorAll('link[rel="stylesheet"]')],stylesReady=links.length<=100&&links.every(link=>link.disabled||link.sheet||link.media&&!matchMedia(link.media).matches);return {url:location.href,ready:document.readyState!=='loading'&&stylesReady&&Boolean(selected.text.trim()),restricted:blocked,text:blocked?title+'\\n'+text:selected.text.length+':'+selected.text.slice(0,600)+':'+selected.text.slice(-600)}})()`
}
export interface CollectionPageReady {url:string;ready:boolean;restricted:boolean;text:string}

export function assertCollectionPageReady(raw:unknown):CollectionPageReady {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid collection readiness reply')
 const v=raw as Record<string,unknown>
 if(Object.keys(v).some(k=>!['url','ready','restricted','text'].includes(k))||typeof v.url!=='string'||v.url.length>4096||typeof v.ready!=='boolean'||typeof v.restricted!=='boolean'||typeof v.text!=='string'||v.text.length>2000)throw new Error('Invalid collection readiness reply')
 return {url:v.url,ready:v.ready,restricted:v.restricted,text:v.text}
}
