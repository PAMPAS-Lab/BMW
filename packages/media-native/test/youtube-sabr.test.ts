import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {CompositeBuffer,UmpWriter} from 'googlevideo/ump'
import {MediaHeader,UMPPartId,VideoPlaybackAbrRequest,NextRequestPolicy,StreamProtectionStatus} from 'googlevideo/protos'
import type {MediaHeader as Header} from 'googlevideo/protos'
import {concatenateChunks} from 'googlevideo/utils'
import {bindYoutubeSabrDelivery,selectYoutubeSabrFormats,YoutubeUmpValidator} from '../src/youtube-sabr.js'
import {preserveMedia,PreservationCleanupError} from '../src/media-preservation.js'

const identity={version:1 as const,platform:'youtube' as const,targetId:'abcdefghijk',resourceId:'abcdefghijk'}
const video={itag:137,lastModified:'123456789',xtags:'',mimeType:'video/mp4; codecs="avc1.640028"',bitrate:1000000,approxDurationMs:'1000',height:1080,width:1920}
const audio={itag:140,lastModified:'987654321',xtags:'',mimeType:'audio/mp4; codecs="mp4a.40.2"',bitrate:128000,approxDurationMs:'1000',audioTrack:{id:'en',audioIsDefault:true}}
const format=(f:typeof video|typeof audio)=>({itag:f.itag,lastModified:f.lastModified,xtags:f.xtags})
const config=Buffer.from('current page ustreamer configuration')
const request=VideoPlaybackAbrRequest.encode({initializationFormatIds:[],bufferedRanges:[],videoPlaybackUstreamerConfig:config,selectedAudioFormatIds:[format(audio)],selectedVideoFormatIds:[format(video)],selectedCaptionFormatIds:[],ssapPlaybackInfos:[],field1000:[],streamerContext:{clientInfo:{clientName:1,clientVersion:'fixture'},poToken:Buffer.from('ephemeral-attestation'),unsentSabrContexts:[],sabrContexts:[]}}).finish()
const witness={videoIdentity:identity,streamUrl:'https://r1.googlevideo.com/videoplayback?id=current&sabr=1&cpn=current-page',requestBody:request,ustreamerConfig:config.toString('base64url'),durationSeconds:1,formats:[video,audio]}
function delivery(){return bindYoutubeSabrDelivery(witness)}
function ump(parts:[number,Uint8Array][]):Uint8Array{const buffer=new CompositeBuffer(),writer=new UmpWriter(buffer);for(const [id,data]of parts)writer.write(id,data);return concatenateChunks(buffer.chunks)}
function segment(header:Partial<Header>={},payload=new Uint8Array([1,2,3])):[number,Uint8Array][]{const h:Header={headerId:1,videoId:identity.targetId,formatId:format(video),itag:video.itag,lmt:video.lastModified,segmentNum:1,segmentLengthBytes:String(payload.length),startMs:'0',durationMs:'1000',...header};return [[UMPPartId.MEDIA_HEADER,MediaHeader.encode(h).finish()],[UMPPartId.MEDIA,new Uint8Array([h.headerId??0,...payload])],[UMPPartId.MEDIA_END,new Uint8Array([h.headerId??0])]]}
function validator(){return new YoutubeUmpValidator(identity,selectYoutubeSabrFormats(delivery()))}

test('SABR admission binds the actual binary POST configuration and formats to one finite YouTube target',()=>{
 const bound=delivery();assert.equal(bound.formats.length,2);assert.notEqual(bound.requestBody,request)
 assert.throws(()=>bindYoutubeSabrDelivery({...witness,ustreamerConfig:Buffer.from('different player').toString('base64')}),/configuration differ/)
 assert.throws(()=>bindYoutubeSabrDelivery({...witness,formats:[{...video,lastModified:'999'},audio]}),/outside this player/)
 for(const streamUrl of ['https://evil.example/videoplayback?id=x','http://r1.googlevideo.com/videoplayback?id=x','https://r1.googlevideo.com:123/videoplayback?id=x'])assert.throws(()=>bindYoutubeSabrDelivery({...witness,streamUrl}),/current Googlevideo/)
 assert.throws(()=>bindYoutubeSabrDelivery({...witness,requestBody:new Uint8Array(256*1024+1)}),/oversized/)
 assert.throws(()=>bindYoutubeSabrDelivery({...witness,videoIdentity:{...identity,resourceId:'foreign'}}),/finite target/)
})
test('Complete default-language format selection respects 1080p, archive and reserved-disk budgets',()=>{
 const bound=delivery();bound.formats.push({...bound.formats[0]!,itag:136,height:720,width:1280,bitrate:300000})
 assert.equal(selectYoutubeSabrFormats(bound).video.itag,137)
 assert.equal(selectYoutubeSabrFormats(bound,60000).video.itag,136)
 assert.throws(()=>selectYoutubeSabrFormats(bound,100),/No complete AVC\/AAC pair/)
 bound.formats.push({...bound.formats[1]!,itag:141,audioTrackId:'es',defaultAudio:true});assert.throws(()=>selectYoutubeSabrFormats(bound),/unique default/)
})
test('UMP validates fragmented media identity, exact segment length and complete separate tracks',async()=>{
 const parser=validator(),bytes=ump([...segment({isInitializationSegment:true,segmentNum:0}),...segment(),...segment({headerId:2,isInitializationSegment:true,segmentNum:0,formatId:format(audio),itag:audio.itag,lmt:audio.lastModified}),...segment({headerId:2,formatId:format(audio),itag:audio.itag,lmt:audio.lastModified})])
 for(let index=0;index<bytes.length;index+=7)await parser.reader.feed(bytes.subarray(index,index+7))
 const proof=parser.finish(1);assert.deepEqual(proof.formats.map(f=>f.segments),[1,1]);assert.ok(!JSON.stringify(proof).includes('ephemeral-attestation'));parser.dispose()
})
test('UMP rejects foreign video/version/track, truncated media and changed duplicate segments',async()=>{
 for(const header of [{videoId:'wrong-video'},{formatId:{...format(video),lastModified:'999999999'}},{itag:999},{segmentLengthBytes:'10'}]){
  const parser=validator();await assert.rejects(parser.reader.feed(ump(segment(header))),/FOREIGN|VERSION|PARTIAL/);parser.dispose()
 }
 const parser=validator();await parser.reader.feed(ump(segment()));await assert.rejects(parser.reader.feed(ump(segment({},new Uint8Array([9,8,7])))),/VERSION_CHANGED/);parser.dispose()
 const incomplete=validator();await incomplete.reader.feed(ump(segment().slice(0,-1)));assert.throws(()=>incomplete.finish(1),/PARTIAL/);incomplete.dispose()
})
test('First and last segments cannot hide a missing or overlapping middle interval',async()=>{
 for(const middle of [{segmentNum:3,startMs:'800',durationMs:'200'},{segmentNum:2,startMs:'200',durationMs:'800'}]){
  const parser=validator();await parser.reader.feed(ump([...segment({isInitializationSegment:true,segmentNum:0}),...segment({startMs:'0',durationMs:'400'}),...segment(middle),...segment({headerId:2,isInitializationSegment:true,segmentNum:0,formatId:format(audio),itag:audio.itag,lmt:audio.lastModified}),...segment({headerId:2,formatId:format(audio),itag:audio.itag,lmt:audio.lastModified})]));assert.throws(()=>parser.finish(1),/GAP/);parser.dispose()
 }
})
test('Cancellation terminates a protocol worker in server backoff and retains existing Project files',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-sabr-cancel-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.writeFile(path.join(directory,'existing'),'keep')
 const abort=new AbortController();let calls=0,drained=false,timer:ReturnType<typeof setTimeout>|undefined
 t.after(()=>{if(timer)clearTimeout(timer)})
 const fetchImpl=Object.assign(async()=>{calls++;timer=setTimeout(()=>abort.abort(new Error('fixture cancel while server waits')),80);const body=ump([[UMPPartId.NEXT_REQUEST_POLICY,NextRequestPolicy.encode({backoffTimeMs:120000}).finish()]]);return new Response(body as BodyInit,{headers:{'content-type':'application/vnd.yt-ump'}})},{waitForIdle:async()=>{await new Promise(resolve=>setTimeout(resolve,25));drained=true}})
 const start=performance.now()
 await assert.rejects(preserveMedia({directory,url:witness.streamUrl,pageUrl:'https://www.youtube.com/watch?v='+identity.targetId,videoIdentity:identity,youtubeSabr:delivery(),signal:abort.signal,fetchImpl}),/fixture cancel|closed|cancelled/)
 assert.equal(calls,1);assert.equal(drained,true);assert.ok(performance.now()-start<6000,'Does not leave the 120-second backoff worker alive');assert.deepEqual(await fs.readdir(directory),['existing'])
})


test('Bootstrap POSTs may omit preferred tracks, but initialization/buffered formats cannot name foreign versions',()=>{
 const boot=VideoPlaybackAbrRequest.decode(request);boot.selectedAudioFormatIds=[];boot.selectedVideoFormatIds=[]
 assert.equal(bindYoutubeSabrDelivery({...witness,requestBody:VideoPlaybackAbrRequest.encode(boot).finish()}).formats.length,2)
 boot.initializationFormatIds=[{...format(video),lastModified:'999'}]
 assert.throws(()=>bindYoutubeSabrDelivery({...witness,requestBody:VideoPlaybackAbrRequest.encode(boot).finish()}),/outside this player/)
 boot.initializationFormatIds=[];boot.bufferedRanges=[{formatId:{...format(audio),lastModified:'999'}}]
 assert.throws(()=>bindYoutubeSabrDelivery({...witness,requestBody:VideoPlaybackAbrRequest.encode(boot).finish()}),/outside this player/)
})


test('A failed native drain quarantines only this acquisition until explicit cleanup recovery succeeds',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-sabr-quarantine-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.writeFile(path.join(directory,'existing'),'keep')
 const abort=new AbortController();let drains=0,timer:ReturnType<typeof setTimeout>|undefined;t.after(()=>{if(timer)clearTimeout(timer)})
 const fetchImpl=Object.assign(async()=>{timer=setTimeout(()=>abort.abort(new Error('fixture stop')),80);return new Response(ump([[UMPPartId.NEXT_REQUEST_POLICY,NextRequestPolicy.encode({backoffTimeMs:120000}).finish()]]) as BodyInit,{headers:{'content-type':'application/vnd.yt-ump'}})},{waitForIdle:async()=>{if(++drains===1)throw new Error('fixture native close pending')}})
 let failure:unknown
 try{await preserveMedia({directory,url:witness.streamUrl,pageUrl:'https://www.youtube.com/watch?v='+identity.targetId,videoIdentity:identity,youtubeSabr:delivery(),signal:abort.signal,fetchImpl})}catch(error){failure=error}
 assert.ok(failure instanceof PreservationCleanupError);assert.ok((await fs.readdir(directory)).some(name=>name.startsWith('preserved-')))
 await failure.recover();assert.equal(drains,2);assert.deepEqual(await fs.readdir(directory),['existing'])
})


test('A server attestation request may reuse only a newly observed same-player token, without persisting it',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-sabr-refresh-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}))
 const abort=new AbortController(),fresh=VideoPlaybackAbrRequest.decode(request);fresh.streamerContext!.poToken=Buffer.from('updated native browser attestation');let calls=0,refreshes=0,timer:ReturnType<typeof setTimeout>|undefined;t.after(()=>{if(timer)clearTimeout(timer)})
 const fetchImpl=async(_url:string,init?:RequestInit)=>{calls++;const sent=VideoPlaybackAbrRequest.decode(init!.body as Uint8Array)
  if(calls===1)return new Response(ump([[UMPPartId.STREAM_PROTECTION_STATUS,StreamProtectionStatus.encode({status:3,maxRetries:10}).finish()],[UMPPartId.NEXT_REQUEST_POLICY,NextRequestPolicy.encode({backoffTimeMs:10}).finish()]]) as BodyInit,{headers:{'content-type':'application/vnd.yt-ump'}})
  assert.deepEqual([...sent.streamerContext!.poToken!],[...fresh.streamerContext!.poToken!]);timer=setTimeout(()=>abort.abort(new Error('fixture refreshed stop')),30)
  return new Response(ump([[UMPPartId.NEXT_REQUEST_POLICY,NextRequestPolicy.encode({backoffTimeMs:120000}).finish()]]) as BodyInit,{headers:{'content-type':'application/vnd.yt-ump'}})
 }
 await assert.rejects(preserveMedia({directory,url:witness.streamUrl,pageUrl:'https://www.youtube.com/watch?v='+identity.targetId,videoIdentity:identity,youtubeSabr:delivery(),signal:abort.signal,fetchImpl,refreshYoutubeSabr:async()=>{refreshes++;return {...witness,requestBody:VideoPlaybackAbrRequest.encode(fresh).finish()}}}),/fixture refreshed stop|closed|cancelled/)
 assert.equal(calls,2);assert.equal(refreshes,1);assert.deepEqual(await fs.readdir(directory),[])
})
test('A server refresh cannot change the target or selected format version before another POST',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-sabr-refresh-foreign-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let calls=0
 const fetchImpl=async()=>{calls++;return new Response(ump([[UMPPartId.STREAM_PROTECTION_STATUS,StreamProtectionStatus.encode({status:3,maxRetries:10}).finish()],[UMPPartId.NEXT_REQUEST_POLICY,NextRequestPolicy.encode({backoffTimeMs:20}).finish()]]) as BodyInit,{headers:{'content-type':'application/vnd.yt-ump'}})}
 await assert.rejects(preserveMedia({directory,url:witness.streamUrl,pageUrl:'https://www.youtube.com/watch?v='+identity.targetId,videoIdentity:identity,youtubeSabr:delivery(),fetchImpl,refreshYoutubeSabr:async()=>({...witness,videoIdentity:{...identity,targetId:'foreign0000',resourceId:'foreign0000'}})}),/IDENTITY_CHANGED/)
 assert.equal(calls,1);assert.deepEqual(await fs.readdir(directory),[])
})


test('Native attestation refresh refuses a different playback nonce even for the same video',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-sabr-refresh-nonce-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let calls=0
 const fetchImpl=async()=>{calls++;return new Response(ump([[UMPPartId.STREAM_PROTECTION_STATUS,StreamProtectionStatus.encode({status:3,maxRetries:10}).finish()],[UMPPartId.NEXT_REQUEST_POLICY,NextRequestPolicy.encode({backoffTimeMs:20}).finish()]]) as BodyInit,{headers:{'content-type':'application/vnd.yt-ump'}})}
 await assert.rejects(preserveMedia({directory,url:witness.streamUrl,pageUrl:'https://www.youtube.com/watch?v='+identity.targetId,videoIdentity:identity,youtubeSabr:delivery(),fetchImpl,refreshYoutubeSabr:async()=>({...witness,streamUrl:witness.streamUrl.replace('current-page','different-page')})}),/IDENTITY_CHANGED/)
 assert.equal(calls,1);assert.deepEqual(await fs.readdir(directory),[])
})
