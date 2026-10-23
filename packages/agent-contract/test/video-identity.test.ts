import assert from 'node:assert/strict'
import test from 'node:test'
import {assertPageVideoTargets,assertVideoIdentity,selectVideoResource,youtubeAudioFor} from '../src/video-identity.js'
import type {VideoTarget,VideoResource} from '../src/video-identity.js'
const resource=(url:string,role:VideoResource['role'],audioGroup='default',defaultAudio=false,bitrate=100):VideoResource=>({url,role,audioGroup,defaultAudio,bitrate,durationSeconds:10})
const yt=():VideoTarget=>({identity:{version:1,platform:'youtube',targetId:'original',resourceId:'original'},playerUrl:'blob:https://www.youtube.com/player',videoIndex:0,durationSeconds:10,resources:[resource('https://r1.googlevideo.com/videoplayback?itag=137','video'),resource('https://r1.googlevideo.com/videoplayback?itag=140','audio','en',true)]})
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
