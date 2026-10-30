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
import {relayYoutubeSabrResponse} from '../src/youtube-sabr-response.js'
import crypto from 'node:crypto'
import {assertSabrReplayProgress,createSabrReplayIdleClock} from '../src/youtube-sabr-clock.js'

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

function interruptedResponse(prefix:Uint8Array):Response {
 let sent=false
 return new Response(new ReadableStream<Uint8Array>({pull(controller){if(!sent){sent=true;controller.enqueue(prefix)}else controller.error(new Error('net::ERR_INCOMPLETE_CHUNKED_ENCODING'))}},{highWaterMark:0}),{headers:{'content-type':'application/vnd.yt-ump'}})
}
test('Native replay activity is bounded, monotonic and cannot fabricate media or disable the pinned idle clock',()=>{
 let resets=0;const refresh=createSabrReplayIdleClock({resetRequestTimeout(){resets++}})
 const first=assertSabrReplayProgress({attempt:2,prefixBytes:100,replayedBytes:10});refresh();assert.equal(resets,1)
 assert.deepEqual(assertSabrReplayProgress({attempt:2,prefixBytes:100,replayedBytes:100},first),{attempt:2,prefixBytes:100,replayedBytes:100})
 assert.deepEqual(assertSabrReplayProgress({attempt:3,prefixBytes:110,replayedBytes:1},first),{attempt:3,prefixBytes:110,replayedBytes:1})
 for(const value of [{attempt:1,prefixBytes:100,replayedBytes:10},{attempt:4,prefixBytes:100,replayedBytes:10},{attempt:2,prefixBytes:0,replayedBytes:1},{attempt:2,prefixBytes:100,replayedBytes:101},{attempt:2,prefixBytes:100,replayedBytes:10},{attempt:2,prefixBytes:101,replayedBytes:11},{attempt:3,prefixBytes:99,replayedBytes:1},{attempt:2,prefixBytes:2**40,replayedBytes:1}])assert.throws(()=>assertSabrReplayProgress(value,first),/REPLAY_PROGRESS/)
 assert.throws(()=>createSabrReplayIdleClock({}),/CLOCK_UNAVAILABLE/);assert.equal(resets,1,'No synthetic heartbeat or invalid message refreshes the clock')
})

test('Real protocol worker survives a progressing prefix replay beyond 30s, while an actually idle response still times out',{concurrency:true,timeout:50000},async t=>{
 await Promise.all([true,false].map(replay=>t.test(replay?'slow verified replay preserves parser state until explicit cancellation':'no wire activity retains the 30-second protocol deadline',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-sabr-replay-idle-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.writeFile(path.join(directory,'existing'),'keep')
  const whole=ump([[UMPPartId.NEXT_REQUEST_POLICY,NextRequestPolicy.encode({backoffTimeMs:120000}).finish()]]),prefix=whole.subarray(0,4),abort=new AbortController(),started=performance.now();let calls=0,drained=false,replayFinished=false
  assert.ok(whole.length>4)
  const deadline=setTimeout(()=>abort.abort(new Error(replay?'fixture cancel after progressing replay':'fixture no-progress fallback')),replay?36000:45000);t.after(()=>clearTimeout(deadline))
  const fetchImpl=Object.assign(async(_url:string,init?:RequestInit)=>{
   calls++;if(replay&&calls===1)return interruptedResponse(prefix)
   const signal=init?.signal;let stop=()=>{}
   const body=new ReadableStream<Uint8Array>({start(controller){const timers:ReturnType<typeof setTimeout>[]=[];let ended=false;const cleanup=()=>{timers.forEach(clearTimeout);signal?.removeEventListener('abort',cancel)};const cancel=()=>{if(ended)return;ended=true;cleanup();controller.error(signal?.reason??new Error('Request aborted'))};stop=()=>{ended=true;cleanup()};signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return}
    if(!replay){controller.enqueue(prefix);return}
    for(let i=0;i<4;i++)timers.push(setTimeout(()=>{if(ended)return;controller.enqueue(prefix.subarray(i,i+1));if(i===3){controller.enqueue(whole.subarray(4));replayFinished=true;ended=true;cleanup();controller.close()}},i*11000))
   },cancel(){stop()}},{highWaterMark:0})
   return new Response(body,{headers:{'content-type':'application/vnd.yt-ump'}})
  },{waitForIdle:async()=>{await new Promise(resolve=>setTimeout(resolve,25));drained=true}})
  await assert.rejects(preserveMedia({directory,url:witness.streamUrl,pageUrl:'https://www.youtube.com/watch?v=abcdefghijk',youtubeSabr:witness,videoIdentity:identity,fetchImpl,signal:abort.signal}),replay?/fixture cancel after progressing replay/:/YOUTUBE_SABR_PROTOCOL:.*aborted|Request timed out/)
  clearTimeout(deadline);assert.equal(calls,replay?2:1);assert.equal(replayFinished,replay);assert.equal(drained,true);assert.deepEqual(await fs.readdir(directory),['existing'])
  assert.ok(performance.now()-started>=29000);if(!replay)assert.ok(performance.now()-started<40000,'An idle connection must not be extended by a timer heartbeat')
 })))
})
test('Replay wire activity cadence uses a monotonic clock even when the wall clock does not advance',async t=>{
 t.mock.method(Date,'now',()=>10000000)
 const prefix=new Uint8Array([1,2,3]),progress:number[]=[],chunks:Uint8Array[]=[];let calls=0
 const proof=await relayYoutubeSabrResponse({signal:new AbortController().signal,guard:async()=>{},account:()=>{},fetch:async()=>++calls===1?interruptedResponse(prefix):new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(prefix.subarray(0,1));setTimeout(()=>controller.enqueue(prefix.subarray(1,2)),5200);setTimeout(()=>{controller.enqueue(new Uint8Array([3,4]));controller.close()},5600)}}),{headers:{'content-type':'application/vnd.yt-ump'}}),replayProgress:p=>progress.push(p.replayedBytes),chunk:async chunk=>{chunks.push(chunk)}})
 assert.deepEqual(progress,[1,2,3]);assert.deepEqual(Buffer.concat(chunks),Buffer.from([1,2,3,4]));assert.equal(proof.replayedBytes,3)
})
test('Interrupted UMP POST replays an identical prefix without duplicating either encoded track or resetting parser state',async()=>{
 const bytes=ump([...segment({isInitializationSegment:true,segmentNum:0}),...segment(),...segment({headerId:2,isInitializationSegment:true,segmentNum:0,formatId:format(audio),itag:audio.itag,lmt:audio.lastModified}),...segment({headerId:2,formatId:format(audio),itag:audio.itag,lmt:audio.lastModified})]),prefix=bytes.subarray(0,Math.floor(bytes.length/2)),parser=validator(),chunks:Uint8Array[]=[]
 let calls=0,wire=0
 try{
  const proof=await relayYoutubeSabrResponse({signal:new AbortController().signal,guard:async()=>{},account:n=>{wire+=n},fetch:async()=>{calls++;if(calls===1)return interruptedResponse(prefix);return new Response(new ReadableStream<Uint8Array>({start(controller){for(let at=0;at<bytes.length;at+=7)controller.enqueue(bytes.subarray(at,at+7));controller.close()}}),{headers:{'content-type':'application/vnd.yt-ump'}})},chunk:async chunk=>{chunks.push(chunk);await parser.reader.feed(chunk)}})
  assert.deepEqual(Buffer.concat(chunks),Buffer.from(bytes));assert.equal(proof.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(proof.bytes,bytes.length);assert.equal(proof.attempts,2);assert.equal(proof.replayedBytes,prefix.length);assert.equal(wire,bytes.length+prefix.length)
  assert.deepEqual(parser.finish(1).formats.map(f=>f.segments),[1,1])
 }finally{parser.dispose()}
})
test('A changed or shortened replay prefix fails before any replacement bytes reach the UMP parser',async()=>{
 for(const replacement of [new Uint8Array([1,9,3,4,5]),new Uint8Array([1,2])]){
  let calls=0;const chunks:Uint8Array[]=[]
  await assert.rejects(relayYoutubeSabrResponse({signal:new AbortController().signal,guard:async()=>{},account:()=>{},fetch:async()=>++calls===1?interruptedResponse(new Uint8Array([1,2,3])):new Response(replacement,{headers:{'content-type':'application/vnd.yt-ump'}}),chunk:async chunk=>{chunks.push(chunk)}}),/REPLAY_CHANGED/)
  assert.equal(calls,2);assert.deepEqual(Buffer.concat(chunks),Buffer.from([1,2,3]))
 }
})
test('SABR transport retries only bounded network/server failures and retains cancellation, budget and identity errors',async()=>{
 let calls=0
 await assert.rejects(relayYoutubeSabrResponse({signal:new AbortController().signal,guard:async()=>{},account:()=>{},fetch:async()=>{calls++;throw new TypeError('fetch failed')},chunk:async()=>{}}),/fetch failed/);assert.equal(calls,3)
 for(const status of [403,429]){calls=0;await assert.rejects(relayYoutubeSabrResponse({signal:new AbortController().signal,guard:async()=>{},account:()=>{},fetch:async()=>{calls++;return new Response(null,{status})},chunk:async()=>{}}),/Expected HTTP 200/);assert.equal(calls,1)}
 calls=0;const abort=new AbortController();const timer=setTimeout(()=>abort.abort(new Error('fixture cancelled during retry')),30)
 await assert.rejects(relayYoutubeSabrResponse({signal:abort.signal,guard:async()=>{},account:()=>{},fetch:async()=>{calls++;throw new TypeError('fetch failed')},chunk:async()=>{}}),/fixture cancelled during retry/);clearTimeout(timer);assert.equal(calls,1)
 for(const kind of ['identity','budget','parser']){
  calls=0;const fail=()=>{throw new Error(kind+' rejected')}
  await assert.rejects(relayYoutubeSabrResponse({signal:new AbortController().signal,guard:async()=>{if(kind==='identity'&&calls)fail()},account:()=>{if(kind==='budget')fail()},fetch:async()=>{calls++;return interruptedResponse(new Uint8Array([1]))},chunk:async()=>{if(kind==='parser')fail()}}),new RegExp(kind+' rejected'));assert.equal(calls,1)
 }
})
test('SABR server failures release their response body before retry and never replay parser or budget failures',async()=>{
 let calls=0,cancelled=false
 const proof=await relayYoutubeSabrResponse({signal:new AbortController().signal,guard:async()=>{},account:()=>{},fetch:async()=>{calls++;if(calls===1)return new Response(new ReadableStream({cancel(){cancelled=true}}),{status:503});assert.equal(cancelled,true);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'application/vnd.yt-ump'}})},chunk:async()=>{}})
 assert.equal(proof.attempts,2);assert.equal(calls,2)
})
test('A changed native POST replay drains the actual protocol worker and removes both partial tracks without touching existing media',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-sabr-replay-rollback-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.writeFile(path.join(directory,'existing'),'keep')
 const prefix=ump([[UMPPartId.NEXT_REQUEST_POLICY,NextRequestPolicy.encode({backoffTimeMs:10}).finish()]]).subarray(0,3);let calls=0,drained=false
 const fetchImpl=Object.assign(async()=>{calls++;if(calls===1)return interruptedResponse(prefix);const changed=new Uint8Array(prefix);changed[0]^=1;return new Response(changed,{headers:{'content-type':'application/vnd.yt-ump'}})},{waitForIdle:async()=>{drained=true}})
 await assert.rejects(preserveMedia({directory,url:witness.streamUrl,pageUrl:'https://www.youtube.com/watch?v='+identity.targetId,videoIdentity:identity,youtubeSabr:delivery(),fetchImpl}),/REPLAY_CHANGED/)
 assert.equal(calls,2);assert.equal(drained,true);assert.deepEqual(await fs.readdir(directory),['existing'])
})

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
 await failure.recover();assert.deepEqual(await fs.readdir(directory),['existing'])
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
