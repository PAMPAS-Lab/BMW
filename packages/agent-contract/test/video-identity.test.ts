import assert from 'node:assert/strict'
import test from 'node:test'
import {assertPageVideoTargets,assertVideoIdentity,selectVideoResource,selectVideoCaptureTarget,youtubeAudioFor,sameVideoSourcePage} from '../src/video-identity.js'
import type {VideoTarget,VideoResource} from '../src/video-identity.js'
const resource=(url:string,role:VideoResource['role'],audioGroup='default',defaultAudio=false,bitrate=100):VideoResource=>({url,role,audioGroup,defaultAudio,bitrate,durationSeconds:10})
const yt=():VideoTarget=>({identity:{version:1,platform:'youtube',targetId:'original',resourceId:'original'},playerUrl:'blob:https://www.youtube.com/player',videoIndex:0,durationSeconds:10,resources:[resource('https://r1.googlevideo.com/videoplayback?itag=137','video'),resource('https://r1.googlevideo.com/videoplayback?itag=140','audio','en',true)]})
test('Projection witness survives validation and cannot be represented as a false flat certification',()=>{
 const base={pageUrl:'https://www.youtube.com/watch?v=original',platform:'youtube',targets:[{...yt(),requiresProjection:true}],blocked:null}
 assert.equal(assertPageVideoTargets(base).targets[0]!.requiresProjection,true)
 assert.throws(()=>assertPageVideoTargets({...base,targets:[{...yt(),requiresProjection:false}]}),/Invalid player/)
 assert.equal(assertPageVideoTargets({...base,targets:[yt()]}).targets[0]!.requiresProjection,undefined)
})
test('Pinned YouTube page equality tolerates UI tracking only, retaining video, origin, path and content options',()=>{
 const identity={version:1 as const,platform:'youtube' as const,targetId:'abcdefghijk',resourceId:'abcdefghijk'},url='https://www.youtube.com/watch?v=abcdefghijk'
 for(const query of ['&themeRefresh=1','&feature=share&si=tracking','&utm_source=test#chapter'])assert.equal(sameVideoSourcePage(url,url+query,identity),true)
 assert.equal(sameVideoSourcePage(url+'&list=one&hl=en',url+'&themeRefresh=2&hl=en&list=one',identity),true)
 for(const current of [url+'&list=one',url+'&hl=es',url+'&v=other-video',url.replace('abcdefghijk','zyxwvutsrqp'),url.replace('/watch?v=','/shorts/'),url.replace('www.youtube.com','m.youtube.com'),url.replace('https:','http:'),url.replace('www.youtube.com','www.youtube.com.evil.example')])assert.equal(sameVideoSourcePage(url,current,identity),false,current)
 assert.equal(sameVideoSourcePage(url,url+'&themeRefresh=1'),false)
 assert.equal(sameVideoSourcePage(url,url+'&themeRefresh=1',{...identity,platform:'page'}),false)
 assert.equal(sameVideoSourcePage(url,url+'&themeRefresh=1',{...identity,targetId:'zyxwvutsrqp'}),false)
 assert.equal(sameVideoSourcePage('https://user@www.youtube.com/watch?v=abcdefghijk','https://user@www.youtube.com/watch?v=abcdefghijk',identity),false)
})
test('YouTube binds URL and both tracks to the same target, selects one default language and rejects foreign/ambiguous evidence',()=>{
 const target=yt(),state=assertPageVideoTargets({pageUrl:'https://www.youtube.com/watch?v=original',platform:'youtube',targets:[target],blocked:null})
 assert.equal(selectVideoResource(state,target.resources[0]!.url).identity.targetId,'original');assert.equal(youtubeAudioFor(target,target.resources[0]!.url)?.audioGroup,'en')
 target.resources.push(resource('https://r2.googlevideo.com/videoplayback?itag=251','audio','zh',false,1000));assert.equal(youtubeAudioFor(target,target.resources[0]!.url)?.audioGroup,'en')
 target.resources[2]!.defaultAudio=true;assert.throws(()=>youtubeAudioFor(target,target.resources[0]!.url),/unique default audio/)
 assert.throws(()=>youtubeAudioFor(target,target.resources[1]!.url),/isolated audio/)
 target.resources=target.resources.slice(0,1);assert.throws(()=>youtubeAudioFor(target,target.resources[0]!.url),/A unique default/)
 assert.throws(()=>assertPageVideoTargets({...state,pageUrl:'https://www.youtube.com/watch?v=other'}),/page target/)
 assert.throws(()=>assertPageVideoTargets({...state,targets:[{...yt(),resources:[resource('https://ads.example/videoplayback','video')]}]}),/Foreign/)
 assert.throws(()=>assertVideoIdentity({...target.identity,audioUrl:'https://ads.example/audio'}),/Invalid/)
})
test('X network resources require the original post media identity; replies, unrelated animations and changed identity fail closed',()=>{
 const target:VideoTarget={identity:{version:1,platform:'x',targetId:'123',resourceId:'456'},playerUrl:'blob:https://x.com/player',videoIndex:0,durationSeconds:10,resources:[]},state=assertPageVideoTargets({pageUrl:'https://x.com/author/status/123',platform:'x',targets:[target],blocked:null}),url='https://video.twimg.com/amplify_video/456/pl/playlist.m3u8'
 assert.equal(selectVideoResource(state,url).identity.resourceId,'456')
 for(const rejected of ['https://video.twimg.com/amplify_video/999/pl/playlist.m3u8','https://video.twimg.com.evil.example/amplify_video/456/a.mp4','https://abs.twimg.com/playback1.mp4'])assert.throws(()=>selectVideoResource(state,rejected),/UNBOUND/)
 assert.throws(()=>selectVideoResource(state,url,{...target.identity,resourceId:'999'}),/UNBOUND/)
 assert.throws(()=>selectVideoResource({...state,blocked:'Advertisement'},url),/UNAVAILABLE/)
 assert.throws(()=>selectVideoResource({...state,targets:[target,target]},url),/uniquely bound/)
})

test('A correctly identified YouTube target without observed delivery refuses guessed SABR or another video',()=>{
 const target={...yt(),resources:[]},state=assertPageVideoTargets({pageUrl:'https://www.youtube.com/watch?v=original',platform:'youtube',targets:[target],blocked:null})
 assert.throws(()=>selectVideoResource(state,'https://r1.googlevideo.com/videoplayback?sabr=1'),/YOUTUBE_DIRECT_DELIVERY_UNAVAILABLE/)
 assert.equal(selectVideoResource(state,target.playerUrl).identity.targetId,'original','An explicitly selected blob capture still binds the target without claiming a direct delivery.')
})

test('Only a same-target YouTube response can advertise an explicit native SABR resource',()=>{
 const target=yt(),url='https://r1.googlevideo.com/videoplayback?id=current&sabr=1';target.resources=[resource(url,'sabr')]
 const state=assertPageVideoTargets({pageUrl:'https://www.youtube.com/watch?v=original',platform:'youtube',targets:[target],blocked:null})
 assert.equal(selectVideoResource(state,url).resources[0]!.role,'sabr');assert.equal(youtubeAudioFor(target,url),undefined)
 assert.throws(()=>selectVideoResource(state,url+'&guessed=1'),/UNBOUND/)
 assert.throws(()=>assertPageVideoTargets({...state,targets:[{...target,resources:[resource('https://evil.example/videoplayback?id=current','sabr')]}]}),/Foreign/)
})


test('Capture follows only the same pinned YouTube identity across delivery rotation; downloads remain exact',()=>{
 const target=yt(),state=assertPageVideoTargets({pageUrl:'https://www.youtube.com/watch?v=original',platform:'youtube',targets:[target],blocked:null}),old='blob:https://www.youtube.com/expired'
 assert.equal(selectVideoCaptureTarget(state,old,target.identity).identity.targetId,target.identity.targetId)
 assert.throws(()=>selectVideoResource(state,old,target.identity),/UNBOUND/)
 assert.throws(()=>selectVideoCaptureTarget({...state,targets:[]},old,target.identity),/CHANGED/)
 assert.throws(()=>selectVideoCaptureTarget({...state,targets:[target,target]},old,target.identity),/CHANGED/)
 assert.throws(()=>selectVideoCaptureTarget({...state,blocked:'Advertisement'},old,target.identity),/UNAVAILABLE/)
 assert.throws(()=>selectVideoCaptureTarget(state,old,{...target.identity,targetId:'other',resourceId:'other'}),/CHANGED/)
 const generic={...target,identity:{...target.identity,platform:'page' as const}}
 assert.throws(()=>selectVideoCaptureTarget({...state,platform:'page',targets:[generic]},old,generic.identity),/UNBOUND/)
})
