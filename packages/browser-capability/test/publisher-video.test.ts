import assert from 'node:assert/strict'
import test from 'node:test'
import {publisherVideoSite,publisherTarget} from '../src/publisher-video.js'
const cnbc='https://www.cnbc.com/video/2026/10/07/clip.html',fox='https://www.foxnews.com/video/6403817944112',asset='694940094001/6bb13dc4-51d4-439e-b983-fd9bbfb75423'
const cnbcWitness={publisher:'cnbc',pageUrl:cnbc,contentId:'7000426739',title:'A current original',durationSeconds:133.6,playerUrl:'blob:https://www.cnbc.com/current',videoIndex:0,mp4:'https://pdl-iphone-cnbc-com.akamaized.net/7000426739/version/clip.mp4',hls:'https://cnbcawsmpvod.akamaized.net/out/v1/current/master.m3u8',frameUrl:'',assetKey:''}
const foxWitness={publisher:'fox',pageUrl:fox,contentId:'6403817944112',title:'A current original',durationSeconds:104,playerUrl:'',videoIndex:-1,mp4:'http://vod.foxnews.com/media/v1/pmp4/static/clear/'+asset+'/0c96ac9b-0894-452a-80d3-b85098200c10/main.mp4',hls:'',frameUrl:'https://static.foxnews.com/static/orion/html/video/iframe/vod.html?v=null#uid=fnc-embed-1&url=www.foxnews.com%2Fvideo%2F6403817944112',assetKey:asset}
const frame={contentId:'6403817944112',durationSeconds:104.104,playerUrl:'blob:https://static.foxnews.com/current',hls:'https://manifest.prod.boltdns.net/manifest/v1/hls/v4/clear/'+asset+'/10s/master.m3u8?token=ephemeral',assetKey:asset,adInProgress:false}
test('Publisher resources bind exact CNBC ID and Fox parent/frame/content asset without exporting a frame capability',()=>{
 const c=publisherTarget(cnbc,cnbcWitness);assert.equal(c.identity.resourceId,'cnbc:7000426739');assert.equal(c.resources[0]?.role,'muxed');assert.equal(c.resources[1]?.role,'hls')
 const f=publisherTarget(fox,foxWitness,frame);assert.equal(f.identity.resourceId,'fox:6403817944112');assert.equal(f.videoIndex,-1);assert.equal(f.resources[1]?.url,frame.hls)
 assert.equal(publisherVideoSite('https://www.foxnews.com/video/6403817944112'),'fox')
 for(const url of ['http://www.cnbc.com/video/2026/10/07/clip.html','https://evil.cnbc.com/video/2026/10/07/clip.html','https://www.cnbc.com/video','https://www.foxnews.com/article','https://www.foxnews.com:8443/video/6403817944112'])assert.equal(publisherVideoSite(url),undefined)
})
test('Foreign publisher, ad, frame origin, parent reference, asset version and short replacement never bind',()=>{
 for(const override of [{pageUrl:cnbc+'?other=1'},{contentId:'7000000000'},{publisher:'fox'},{durationSeconds:NaN},{playerUrl:'file:///private/player'},{mp4:'https://foreign.example/7000426739/clip.mp4'},{hls:'https://ads.example/master.m3u8'},{videoIndex:1.5}])assert.throws(()=>publisherTarget(cnbc,{...cnbcWitness,...override}),/UNAVAILABLE|UNBOUND/)
 for(const override of [{adInProgress:true},{adInProgress:undefined},{contentId:'6403817944113'},{durationSeconds:15},{assetKey:asset.replace('6bb13','7bb13')},{hls:frame.hls.replace('6bb13','7bb13')},{playerUrl:'javascript:alert(1)'}])assert.throws(()=>publisherTarget(fox,foxWitness,{...frame,...override}),/UNAVAILABLE|UNBOUND/)
 for(const frameUrl of [foxWitness.frameUrl.replace('static.foxnews.com','ads.example'),foxWitness.frameUrl.replace('6403817944112','6403817944113'),foxWitness.frameUrl.replace('/vod.html','/other.html')])assert.throws(()=>publisherTarget(fox,{...foxWitness,frameUrl},frame),/UNAVAILABLE/)
 assert.throws(()=>publisherTarget(fox,{...foxWitness,videoIndex:0},frame),/UNAVAILABLE/)
})
const cnn='https://edition.cnn.com/2026/10/28/politics/video/obama-tease-trump-cheesecake-factory-digvid',cnnId='mecef3e95814a7c3788851d76c807e13bc6cf6e102',cnnMp4='https://clips-media-aka.warnermediacdn.com/cnn/clips/2026-10/2413539-234abbc2b3454154b092f7651e6ec9ea/mp4/obama-tease-trump-cheesecake-factory-2413539-1920x1080_8000k.mp4'
const cnnWitness={publisher:'cnn',pageUrl:cnn,contentId:cnnId,title:'Original CNN',durationSeconds:125,playerUrl:cnnMp4,videoIndex:-1,mp4:cnnMp4,hls:'',frameUrl:'',assetKey:'2413539',cnnCanonical:cnn.replace('edition.','www.'),cnnEmbed:'https://fave.api.cnn.io/v1/fav/?video='+cnnId+'&edition=international'}
test('CNN original declaration pins canonical path, public content ID and exact CDN asset independently of ad playback',()=>{
 assert.equal(publisherVideoSite(cnn),'cnn');const target=publisherTarget(cnn,cnnWitness);assert.equal(target.identity.resourceId,'cnn:'+cnnId);assert.equal(target.playerUrl,cnnMp4);assert.equal(target.videoIndex,-1);assert.equal(target.resources.length,1)
 for(const override of [{contentId:'me00000000000000000000000000000000'},{cnnCanonical:cnn.replace('edition.cnn.com','evil.example')},{cnnCanonical:cnn+'?video=other'},{cnnCanonical:cnn.replace('obama-tease-trump','unrelated')},{cnnEmbed:cnnWitness.cnnEmbed+'&video=other'},{cnnEmbed:cnnWitness.cnnEmbed.replace('fave.api.cnn.io','ads.example')},{mp4:cnnMp4.replace('clips-media-aka.warnermediacdn.com','ads.example')},{mp4:cnnMp4.replace('-2413539-1920','-9999999-1920')},{playerUrl:'blob:https://edition.cnn.com/advertisement'},{hls:'https://ads.example/master.m3u8'},{videoIndex:0},{assetKey:'9999999'}])assert.throws(()=>publisherTarget(cnn,{...cnnWitness,...override}),/UNAVAILABLE|UNBOUND/)
 assert.equal(publisherVideoSite('https://edition.cnn.com/videos'),undefined);assert.equal(publisherVideoSite(cnn.replace('edition.cnn.com','other.cnn.com')),undefined)
})
const yahoo='https://ca.finance.yahoo.com/video/ai-could-disrupt-every-industry-faster-than-expected-164139763.html',uuid='0c1b39db-70fa-4379-afbc-b24956ef2e03',yahooHls='https://video.media.yql.yahoo.com/v1/video/sapi/hlsstreams/'+uuid+'.m3u8?site=finance&region=US&lang=en-US&devtype=desktop'
const yahooWitness={publisher:'yahoo-finance',pageUrl:yahoo,contentId:uuid,title:'Original Yahoo',durationSeconds:137,playerUrl:yahooHls,videoIndex:-1,mp4:'',hls:yahooHls,frameUrl:'',assetKey:uuid,yahooCanonical:yahoo.replace('ca.finance','finance'),yahooEmbed:yahoo+'?format=embed'}
test('Yahoo original HLS pins UUID, canonical, embed and CDN declaration independently of ad playback',()=>{
 assert.equal(publisherVideoSite(yahoo),'yahoo-finance');const target=publisherTarget(yahoo,yahooWitness);assert.equal(target.identity.resourceId,'yahoo-finance:'+uuid);assert.equal(target.videoIndex,-1);assert.deepEqual(target.resources.map(r=>r.role),['hls'])
 for(const override of [{contentId:uuid.replace('0c1b','1c1b')},{assetKey:'other'},{yahooCanonical:yahoo+'/other'},{yahooCanonical:yahoo+'?other=1'},{yahooEmbed:yahoo.replace('ca.finance.yahoo.com','evil.example')},{yahooEmbed:yahoo+'?video=other'},{hls:yahooHls.replace(uuid,'00000000-0000-0000-0000-000000000000')},{hls:yahooHls+'&site=other'},{playerUrl:'blob:https://ca.finance.yahoo.com/ad'},{mp4:'https://ads.example/ad.mp4'},{videoIndex:0}])assert.throws(()=>publisherTarget(yahoo,{...yahooWitness,...override}),/UNAVAILABLE|UNBOUND/)
})

test('Ars original declaration pins canonical page and finite publisher asset',()=>{
 const page='https://arstechnica.com/video/watch/bina48-robot-talks-to-siri/',mp4='https://dp8hsntg6do36.cloudfront.net/56003d8861646d776f00000c/38d2c2ee-c75c-4f49-ab0a-babe88eb4030low.mp4'
 const witness={pageUrl:page,publisher:'ars',contentId:'bina48-robot-talks-to-siri',title:'Bina48 Robot Talks to Siri',durationSeconds:153,playerUrl:mp4,videoIndex:-1,mp4,hls:'',frameUrl:'',assetKey:new URL(mp4).pathname,arsCanonical:'https://www.arstechnica.com/video/watch/bina48-robot-talks-to-siri'}
 assert.equal(publisherVideoSite(page),'ars');const target=publisherTarget(page,witness);assert.equal(target.resources[0]?.url,mp4);assert.equal(target.videoIndex,-1)
 for(const override of [{arsCanonical:'https://arstechnica.com/video/watch/other'},{contentId:'other'},{mp4:mp4.replace('dp8hsntg6do36.cloudfront.net','attacker.example')},{assetKey:'/different'},{videoIndex:0},{hls:'https://attacker.example/video.m3u8'},{durationSeconds:0}])assert.throws(()=>publisherTarget(page,{...witness,...override}),/UNAVAILABLE|UNBOUND/)
})

test('MIT Brightcove original requires attached publisher frame and matching asset',()=>{
 const page='https://www.technologyreview.com/2023/05/03/1072589/video-geoffrey-hinton-google-ai-risk-ethics/',id='6326759990112',asset='6057955865001/daaec5fd-3d97-4971-bd85-f528dfbf9e9d',hls=`https://manifest.prod.boltdns.net/manifest/v2/hls/v7/clear/avc1_mp4a/${asset}/10s/master.m3u8?fastly_token=example`,frameUrl=`https://players.brightcove.net/6057955865001/XFAlB9SHg_default/index.html?videoId=${id}`
 const parent={pageUrl:page,publisher:'mit-tr',contentId:id,title:'Original',durationSeconds:120,playerUrl:'',videoIndex:-1,mp4:'',hls:'',frameUrl,assetKey:asset},frame={contentId:id,durationSeconds:120,assetKey:asset,playerUrl:hls,hls,adState:'clear'}
 assert.equal(publisherVideoSite(page),'mit-tr');assert.equal(publisherTarget(page,parent,frame).resources[0]?.url,hls)
 for(const override of [{contentId:'111'},{assetKey:asset.replace('daaec5fd','baaec5fd')},{adState:'active'},{hls:hls.replace('manifest.prod.boltdns.net','ads.example')},{durationSeconds:30}])assert.throws(()=>publisherTarget(page,parent,{...frame,...override}),/UNAVAILABLE|UNBOUND/)
 assert.throws(()=>publisherTarget(page,{...parent,frameUrl:frameUrl.replace('players.brightcove.net','evil.example')},frame),/UNAVAILABLE/)
})
