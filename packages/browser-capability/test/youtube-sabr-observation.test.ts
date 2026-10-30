import assert from 'node:assert/strict'
import test from 'node:test'
import {EventEmitter} from 'node:events'
import vm from 'node:vm'
import type {Session,WebContents} from 'electron'
import {YoutubeSabrObservationStore,registerYoutubeSabrPage,bindYoutubeSabrPage,assertFiniteYoutubeProgram} from '../src/youtube-sabr-observation.js'
import {prepareVideoTransfer} from '../src/video-target.js'

test('SABR observations are private, bounded to registered page identity/session nonce, expire and clear on navigation',()=>{
 const store=new YoutubeSabrObservationStore(),base={pageId:1,pageUrl:'https://www.youtube.com/watch?v=abcdefghijk',url:'https://r1.googlevideo.com/videoplayback?id=current&sabr=1&cpn=one',body:new Uint8Array([1,2,3]),at:Date.now()}
 store.add({...base,pageUrl:base.pageUrl+'&themeRefresh=1'});assert.equal(store.find(1,base.pageUrl,'one').length,1);assert.equal(store.find(1,base.pageUrl+'&feature=share','one').length,1);assert.equal(store.find(2,base.pageUrl,'one').length,0);assert.equal(store.find(1,base.pageUrl,'reply').length,0);assert.equal(store.find(1,'https://www.youtube.com/watch?v=other','one').length,0)
 for(const pageUrl of ['https://evil.example/watch?v=abcdefghijk','https://youtube.com.evil.example/watch?v=abcdefghijk'])store.add({...base,pageUrl})
 store.add({...base,url:'https://evil.example/videoplayback?id=current&sabr=1&cpn=one'});store.add({...base,body:new Uint8Array(256*1024+1)})
 assert.equal(store.find(1,base.pageUrl,'one').length,1)
 for(let n=0;n<20;n++)store.add({...base,body:new Uint8Array([n+1])})
 assert.equal(store.find(1,base.pageUrl,'one').length,8)
 store.add({...base,pageId:3,at:Date.now()-121000});assert.equal(store.find(3,base.pageUrl,'one').length,0)
 store.clear(1);assert.equal(store.find(1,base.pageUrl,'one').length,0)
})


test('Same-video theme navigation retains the native witness; target changes and full reloads clear it',async()=>{
 type Hook=(details:{webContentsId:number;method:string;url:string;uploadData:{bytes:Buffer}[]},done:(result:{cancel:boolean})=>void)=>void
 let hook:Hook|undefined,url='https://www.youtube.com/watch?v=abcdefghijk'
 const session={webRequest:{onBeforeRequest:(_filter:unknown,listener?:Hook)=>{hook=listener}}} as unknown as Session
 const endpoint='https://r1.googlevideo.com/videoplayback?id=current&sabr=1',snapshot={cpn:'same-player',url:endpoint,seconds:1,config:'fixture',formats:[],program:{liveContent:false,liveNow:false,upcoming:false,duration:1,seekableRanges:1,seekableStart:0,seekableEnd:1}}
 const page=Object.assign(new EventEmitter(),{id:17,session,getURL:()=>url,isDestroyed:()=>false,mainFrame:{executeJavaScript:async()=>structuredClone(snapshot)}}) as unknown as WebContents
 const target={identity:{version:1 as const,platform:'youtube' as const,targetId:'abcdefghijk',resourceId:'abcdefghijk'},playerUrl:'blob:https://www.youtube.com/player',videoIndex:0,durationSeconds:1,resources:[]}
 const dispose=registerYoutubeSabrPage(session,page)
 const observe=()=>hook!({webContentsId:page.id,method:'POST',url:endpoint+'&cpn=same-player',uploadData:[{bytes:Buffer.from([1,2,3])}]},result=>assert.equal(result.cancel,false))
 observe();url+='&themeRefresh=1';page.emit('did-start-navigation',{},url,true,true)
 const binding=await bindYoutubeSabrPage(page,target,endpoint,{})
 assert.ok(binding.delivery)
 url+='&feature=share';page.emit('did-start-navigation',{},url,true,true)
 await binding.check(true);assert.ok(await binding.refresh(new AbortController().signal))
 snapshot.cpn='changed-player';await assert.rejects(binding.check(true),/IDENTITY_CHANGED/);snapshot.cpn='same-player'
 snapshot.config='changed-config';await assert.rejects(binding.check(true),/IDENTITY_CHANGED/);snapshot.config='fixture'
 snapshot.url=endpoint+'&changed=1';await assert.rejects(binding.check(true),/IDENTITY_CHANGED/);snapshot.url=endpoint
 url+='&list=changed';await assert.rejects(binding.check(true),/IDENTITY_CHANGED/)
 url='https://www.youtube.com/watch?v=other-video';page.emit('did-start-navigation',{},url,true,true)
 await assert.rejects(bindYoutubeSabrPage(page,target,endpoint,{}),/OBSERVATION_REQUIRED/)
 url='https://www.youtube.com/watch?v=abcdefghijk';observe();page.emit('did-start-navigation',{},url,false,true)
 await assert.rejects(bindYoutubeSabrPage(page,target,endpoint,{}),/OBSERVATION_REQUIRED/)
 dispose();assert.equal(hook,undefined)
})

test('Transfer admission keeps exact SABR resources and audio while ignoring only pinned-page tracking changes',async()=>{
 const original='https://www.youtube.com/watch?v=abcdefghijk',endpoint='https://r1.googlevideo.com/videoplayback?id=current&sabr=1'
 let url=original,resource=endpoint,blocked:string|null=null
 const identity={version:1 as const,platform:'youtube' as const,targetId:'abcdefghijk',resourceId:'abcdefghijk'}
 const page=Object.assign(new EventEmitter(),{getURL:()=>url,isDestroyed:()=>false,mainFrame:{executeJavaScript:async()=>({pageUrl:url,platform:'youtube',blocked,targets:[{identity,playerUrl:'blob:https://www.youtube.com/player',videoIndex:0,durationSeconds:1,resources:[{url:resource,role:'sabr',durationSeconds:1,bitrate:0,audioGroup:'',defaultAudio:false}]}]})}}) as unknown as WebContents
 const admission=await prepareVideoTransfer(page,endpoint)
 url+='&themeRefresh=2';await admission.finish()
 resource=endpoint+'&rotated=1';await assert.rejects(admission.finish(),/UNBOUND/);resource=endpoint
 blocked='Advertisement';await assert.rejects(admission.finish(),/IDENTITY_CHANGED/);blocked=null
 url=original+'&hl=es';await assert.rejects(admission.finish(),/IDENTITY_CHANGED/)
 url=original.replace('abcdefghijk','zyxwvutsrqp');await assert.rejects(admission.finish(),/IDENTITY_CHANGED/)
})

test('Finite completed broadcasts require a past end and a complete seekable window; active and incomplete streams remain refused',()=>{
 const program={liveContent:true,liveNow:false,upcoming:false,duration:5637.701,seekableRanges:1,seekableStart:0,seekableEnd:5637.701,broadcastStart:'2026-10-21T12:00:00Z',broadcastEnd:'2026-10-21T13:34:00Z'},now=Date.parse('2026-10-22T00:00:00Z')
 assert.doesNotThrow(()=>assertFiniteYoutubeProgram(program,5637,now))
 assert.doesNotThrow(()=>assertFiniteYoutubeProgram({...program,liveContent:false,broadcastStart:undefined,broadcastEnd:undefined},5637,now))
 for(const patch of [{liveNow:true},{upcoming:true},{duration:Infinity},{duration:0},{duration:5600},{seekableRanges:0},{seekableRanges:2},{seekableStart:40},{seekableEnd:2800},{broadcastEnd:undefined},{broadcastEnd:'invalid'},{broadcastEnd:'2026-10-23T00:00:00Z'},{broadcastStart:'2026-10-21T14:00:00Z'}])assert.throws(()=>assertFiniteYoutubeProgram({...program,...patch},5637,now),/FINITE_PROGRAM_REQUIRED/)
})

test('The actual bounded player observation admits an ended replay and rechecks rolling/live state before retaining its witness',async()=>{
 type Hook=(details:{webContentsId:number;method:string;url:string;uploadData:{bytes:Buffer}[]},done:(result:{cancel:boolean})=>void)=>void
 let hook:Hook|undefined,liveNow=false,seekableStart=0
 const session={webRequest:{onBeforeRequest:(_filter:unknown,listener?:Hook)=>{hook=listener}}} as unknown as Session
 const endpoint='https://r1.googlevideo.com/videoplayback?id=current&sabr=1',identity={version:1 as const,platform:'youtube' as const,targetId:'abcdefghijk',resourceId:'abcdefghijk'},target={identity,playerUrl:'blob:https://www.youtube.com/player',videoIndex:0,durationSeconds:94,resources:[]}
 const video={duration:94,seekable:{length:1,start:()=>seekableStart,end:()=>94}},player={contains:(value:unknown)=>value===video,classList:{contains:()=>false},getVideoData:()=>({video_id:identity.targetId,cpn:'same-player',isLive:liveNow}),getPlayerResponse:()=>({videoDetails:{videoId:identity.targetId,lengthSeconds:'94',isLiveContent:true},playabilityStatus:{status:'OK'},microformat:{playerMicroformatRenderer:{liveBroadcastDetails:{isLiveNow:liveNow,startTimestamp:'2020-01-01T00:00:00Z',endTimestamp:'2020-01-01T00:01:34Z'}}},streamingData:{serverAbrStreamingUrl:endpoint,adaptiveFormats:[]},playerConfig:{mediaCommonConfig:{mediaUstreamerRequestConfig:{videoPlaybackUstreamerConfig:'fixture'}}}})}
 const document={contains:(value:unknown)=>value===video,querySelector:()=>player,querySelectorAll:()=>[video]}
 const page=Object.assign(new EventEmitter(),{id:18,session,getURL:()=>'https://www.youtube.com/watch?v=abcdefghijk',isDestroyed:()=>false,mainFrame:{executeJavaScript:async(expression:string)=>vm.runInNewContext(expression,{document},{timeout:1000}) as unknown}}) as unknown as WebContents
 const dispose=registerYoutubeSabrPage(session,page)
 try{hook!({webContentsId:page.id,method:'POST',url:endpoint+'&cpn=same-player',uploadData:[{bytes:Buffer.from([1,2,3])}]},()=>{});const binding=await bindYoutubeSabrPage(page,target,endpoint,{});assert.deepEqual(binding.delivery.videoIdentity,identity);seekableStart=40;await assert.rejects(binding.check(true),/FINITE_PROGRAM_REQUIRED/);seekableStart=0;liveNow=true;await assert.rejects(bindYoutubeSabrPage(page,target,endpoint,{}),/FINITE_PROGRAM_REQUIRED/)}finally{dispose()}
})
