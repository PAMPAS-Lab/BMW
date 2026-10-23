import type { Session, ClientRequestConstructorOptions, ClientRequest } from 'electron'
import {Readable} from 'node:stream'

type RequestFactory = (options: ClientRequestConstructorOptions) => ClientRequest
type MediaFetch=((url:string,init?:RequestInit)=>Promise<Response>)&{waitForIdle:()=>Promise<void>}

function nativeResponse(session: Pick<Session,'fetch'>, factory: RequestFactory, url: string, init: RequestInit, pending:Set<Promise<void>>): Promise<Response> {
  return new Promise((resolve,reject)=>{
    const request=factory({session:session as Session,url,method:init.method??'GET',redirect:'manual',credentials:init.credentials??'include'})
    let release!:()=>void,closed=false,responseEnded=true,responseSeen=false,terminal=false,incomingStream:Readable|undefined
    const completion=new Promise<void>(done=>{release=done});pending.add(completion)
    const complete=()=>{if(closed&&responseEnded&&(responseSeen||terminal)){release();pending.delete(completion);init.signal?.removeEventListener('abort',abort)}}
    let settled=false,redirectResponse:Response|undefined
    const abort=()=>{terminal=true;request.abort();incomingStream?.destroy(init.signal?.reason instanceof Error?init.signal.reason:new Error('Media request aborted.'))}
    request.once('close',()=>{closed=true;complete();if(redirectResponse&&!settled){settled=true;resolve(redirectResponse)}})
    request.once('error',error=>{terminal=true;complete();if(!settled&&!redirectResponse){settled=true;reject(error)}})
    request.once('abort',()=>{terminal=true;complete();if(!settled){settled=true;if(redirectResponse)resolve(redirectResponse);else reject(init.signal?.reason??new Error('Media request aborted.'))}})
    request.on('redirect',(status,_method,location,responseHeaders)=>{
      const headers=new Headers()
      for(const [key,value]of Object.entries(responseHeaders))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):String(value))
      headers.set('location',location)
      redirectResponse=new Response(null,{status,headers})
      request.abort()
    })
    request.once('response',incoming=>{responseSeen=true;
      if(settled){const stream=incoming as unknown as Readable;responseEnded=false;stream.once('close',()=>{responseEnded=true;complete()});stream.destroy();return}
      const headers=new Headers()
      for(const [key,value]of Object.entries(incoming.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):String(value))
      settled=true
      const stream=incoming as unknown as Readable
      incomingStream=stream;responseEnded=false
      const ended=()=>{responseEnded=true;complete()};stream.once('end',ended);stream.once('close',ended);stream.once('aborted',ended)
      const body=[204,205,304].includes(incoming.statusCode)?null:Readable.toWeb(stream) as ReadableStream<Uint8Array>
      if(!body)stream.resume()
      const response=new Response(body,{status:incoming.statusCode,headers})
      Object.defineProperty(response,'url',{value:url})
      resolve(response)
    })
    for(const [key,value]of new Headers(init.headers))request.setHeader(key,value)
    if(init.signal?.aborted){abort();reject(init.signal.reason);return}
    init.signal?.addEventListener('abort',abort,{once:true})
    if(init.body instanceof Uint8Array)request.end(Buffer.from(init.body));else request.end()
  })
}

const policies = new Set<ReferrerPolicy>(['no-referrer','no-referrer-when-downgrade','origin','origin-when-cross-origin','same-origin','strict-origin','strict-origin-when-cross-origin','unsafe-url'])

/** Electron 44 Session.fetch does not forward RequestInit.referrer to net.request. */
export function mediaReferrer(source: string, target: URL, policy: ReferrerPolicy): string {
  let page: URL
  try { page = new URL(source) } catch { return '' }
  if (!['http:','https:'].includes(page.protocol)) return ''
  page.username = ''; page.password = ''; page.hash = ''
  const same = page.origin === target.origin
  const downgrade = page.protocol === 'https:' && target.protocol !== 'https:'
  if (policy === 'no-referrer' || (policy === 'same-origin' && !same)) return ''
  if (downgrade && ['strict-origin','strict-origin-when-cross-origin','no-referrer-when-downgrade'].includes(policy)) return ''
  if (['origin','strict-origin'].includes(policy) || (!same && ['origin-when-cross-origin','strict-origin-when-cross-origin'].includes(policy))) return page.origin + '/'
  return page.href
}

/** Host-only adapter: callers cannot supply a different page's Referer. */
export function createMediaSessionFetch(session: Pick<Session,'fetch'>, pageUrl: string, pagePolicy: unknown = '', requestFactory?:RequestFactory):MediaFetch {
  const policy: ReferrerPolicy = typeof pagePolicy === 'string' && policies.has(pagePolicy as ReferrerPolicy) ? pagePolicy as ReferrerPolicy : 'strict-origin-when-cross-origin'
  const pending=new Set<Promise<void>>()
  const fetcher=async (url: string, init: RequestInit = {}): Promise<Response> => {
    let target = new URL(url), source = pageUrl
    const headers = new Headers(init.headers)
    const method=(init.method??'GET').toUpperCase()
    if(method!=='GET'&&method!=='POST'||method==='GET'&&init.body)throw new Error('Media transport accepts GET or bounded SABR POST only.')
    for (let hop = 0; hop <= 5; hop++) {
      init.signal?.throwIfAborted()
      if (!['http:','https:'].includes(target.protocol) || target.username || target.password) throw new Error('Media redirects require HTTP(S) URLs without credentials.')
      if(method==='POST'&&(!['www.youtube.com','youtube.com','m.youtube.com'].includes(new URL(pageUrl).hostname)||target.protocol!=='https:'||!target.hostname.endsWith('.googlevideo.com')||target.port||target.pathname!=='/videoplayback'||!(init.body instanceof Uint8Array)||!init.body.byteLength||init.body.byteLength>256*1024||headers.get('content-type')!=='application/x-protobuf'))throw new Error('Media POST requires an identity-bound Googlevideo protobuf request within 256 KiB.')
      if(method==='POST')headers.set('Origin',new URL(pageUrl).origin)
      headers.delete('referer')
      const referer = mediaReferrer(source,target,policy)
      if (referer) headers.set('Referer',referer)
      const options={...init,method,headers,referrer:undefined,redirect:'manual' as const}
      const response = await (requestFactory?nativeResponse(session,requestFactory,target.href,options,pending):session.fetch(target.href,options))
      if (![301,302,303,307,308].includes(response.status) || init.redirect === 'manual') return response
      await response.body?.cancel()
      if(method==='POST'&&![307,308].includes(response.status))throw new Error('SABR POST cannot be rewritten by a redirect.')
      if (init.redirect === 'error' || hop === 5) throw new Error('Media redirect refused or redirect budget exceeded.')
      const location = response.headers.get('location')
      if (!location) throw new Error('Media redirect has no Location.')
      const next = new URL(location,target)
      // Do not restore a full path after a cross-origin/downgrade reduction.
      source = referer
      if (next.origin !== target.origin) { headers.delete('authorization'); headers.delete('cookie') }
      target = next
    }
    throw new Error('Media redirect budget exceeded.')
  }
  return Object.assign(fetcher,{waitForIdle:async()=>{if(!pending.size)return;let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.all([...pending]),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Media native transport cleanup has not completed.')),10000)})])}finally{if(timer)clearTimeout(timer)}}})
}
