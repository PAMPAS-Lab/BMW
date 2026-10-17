import assert from 'node:assert/strict'
import test from 'node:test'
import {createMediaSessionFetch,mediaReferrer} from '../src/media-session-fetch.js'

test('media adapter reduces referrer and strips secrets across bounded redirects',async()=>{
  const calls: {url:string;headers:Headers}[]=[]
  const fetcher=createMediaSessionFetch({fetch:async(url,init)=>{
    calls.push({url:String(url),headers:new Headers(init?.headers)})
    return calls.length===1?new Response(null,{status:302,headers:{location:'https://cdn.example/clip'}}):new Response('ok')
  }},'https://user:pass@page.example/private?q=secret#fragment')
  await fetcher('https://page.example/start',{headers:{Authorization:'sensitive',Referer:'https://wrong.example/'}})
  assert.equal(calls[0].headers.get('referer'),'https://page.example/private?q=secret')
  assert.equal(calls[1].headers.get('referer'),'https://page.example/')
  assert.equal(calls[1].headers.get('authorization'),null)
  assert.equal(mediaReferrer('https://page.example/private',new URL('http://cdn.example/v'),'strict-origin-when-cross-origin'),'')
})

test('media adapter honors no-referrer and refuses non-web redirects and redirect loops',async()=>{
  let count=0
  const fetcher=createMediaSessionFetch({fetch:async(_url,init)=>{
    assert.equal(new Headers(init?.headers).get('referer'),null);count++
    return new Response(null,{status:302,headers:{location:'file:///private'}})
  }},'https://page.example/private','no-referrer')
  await assert.rejects(fetcher('https://cdn.example/v'),/HTTP\(S\)/)
  assert.equal(count,1)
  const loop=createMediaSessionFetch({fetch:async()=>new Response(null,{status:302,headers:{location:'/again'}})},'https://page.example/')
  await assert.rejects(loop('https://cdn.example/v'),/budget/)
})
