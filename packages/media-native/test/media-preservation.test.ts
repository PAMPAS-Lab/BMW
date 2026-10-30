import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {parsePreservationPlaylist,preserveMedia} from '../src/media-preservation.js'
import {ArtifactJobIO} from '../src/artifact-job-io.js'
import {ARCHIVE_LIMITS} from '../src/archive-limits.js'
import {assertArchiveSegment} from '../src/media-archive-segment.js'

test('HLS preservation selects explicit media, resolves relative URLs, and rejects live/encrypted/ranged/gapped input',()=>{
 const url='https://video.example/path/master.m3u8',master=parsePreservationPlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",DEFAULT=YES,URI="../audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=200000,AUDIO="a"\nvideo.m3u8\n',url)
 assert.equal(master.variants[0]!.url,'https://video.example/path/video.m3u8');assert.equal(master.audio[0]!.url,'https://video.example/audio.m3u8')
 const vod='#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2.5,\nseg.m4s\n#EXT-X-ENDLIST\n',parsed=parsePreservationPlaylist(vod,url)
 assert.equal(parsed.duration,2.5);assert.equal(parsed.initialization,'https://video.example/path/init.mp4')
 for(const tag of ['#EXT-X-KEY:METHOD=AES-128,URI="key"','#EXT-X-BYTERANGE:4@0','#EXT-X-DISCONTINUITY','#EXT-X-GAP'])assert.throws(()=>parsePreservationPlaylist(vod.replace('#EXTINF:',tag+'\n#EXTINF:'),url),/unsupported|incomplete/)
 assert.throws(()=>parsePreservationPlaylist(vod.replace('#EXT-X-ENDLIST',''),url),/ENDLIST/)
 assert.throws(()=>parsePreservationPlaylist(vod.replace('seg.m4s','file:///private/video'),url),/HTTP/)
 assert.throws(()=>parsePreservationPlaylist(vod.replace('2.5','NaN'),url),/duration/)
})
test('HTTP preservation keeps exact delivery bytes and hashes, never claims the author original or full video range',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-preserve-http-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const data=Buffer.from('delivery response'),hash=crypto.createHash('sha256').update(data).digest('hex')
 const result=await preserveMedia({directory,url:'https://video.example/clip.mp4',pageUrl:'https://page.example/post',fetchImpl:async(_url,init)=>{assert.equal(init?.credentials,'include');assert.equal(init?.referrer,'https://page.example/post');return new Response(data,{headers:{'content-type':'video/mp4'}})}})
 assert.deepEqual(await fs.readFile(result.path),data);assert.equal(result.sha256,hash);assert.equal(result.preservation.uploadedOriginal,'unknown');assert.equal(result.preservation.reencoded,false);assert.equal(result.preservation.completeVod,false)
 const proof=JSON.parse(await fs.readFile(path.join(directory,result.preservation.proofArtifactId),'utf8'));assert.equal(proof.resources[0].sha256,hash)
})
test('Preservation fails closed and rolls back all owned resources on unsupported playlists, partial responses and cancellation',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-preserve-reject-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.writeFile(path.join(directory,'existing'),'keep')
 for(const text of ['#EXTM3U\n#EXTINF:1,\nseg.ts\n','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST'])await assert.rejects(preserveMedia({directory,url:'https://video.example/a.m3u8',pageUrl:'https://page.example',fetchImpl:async()=>new Response(text)}))
 await assert.rejects(preserveMedia({directory,url:'https://video.example/a.mp4',pageUrl:'https://page.example',fetchImpl:async()=>new Response('fragment',{status:206})}),/full HTTP 200/)
 const controller=new AbortController();await assert.rejects(preserveMedia({directory,url:'https://video.example/a.m3u8',pageUrl:'https://page.example',signal:controller.signal,fetchImpl:async()=>{controller.abort(new Error('cancel preservation'));return new Response('#EXTM3U\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST')}}),/cancel preservation/)
 assert.deepEqual(await fs.readdir(directory),['existing']);assert.equal(await fs.readFile(path.join(directory,'existing'),'utf8'),'keep')
})

test('Separated transfer refuses partial/missing audio, identity mismatch and truncated responses, retaining existing artifacts',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-preserve-pair-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.writeFile(path.join(directory,'existing'),'keep')
 const videoIdentity={version:1 as const,platform:'youtube' as const,targetId:'target',resourceId:'target'},base={directory,url:'https://r.googlevideo.com/video',pageUrl:'https://youtube.com/watch?v=target',videoIdentity,separated:{audioUrl:'https://r.googlevideo.com/audio',videoDurationSeconds:10,audioDurationSeconds:10,videoIdentity}}
 for(const mode of ['partial','missing','truncated','cancel'] as const){const cancel=new AbortController();await assert.rejects(preserveMedia({...base,signal:cancel.signal,fetchImpl:async url=>{if(url.endsWith('/video'))return new Response('video',{headers:{'content-type':'video/mp4'}});if(mode==='cancel')cancel.abort(new Error('cancel audio'));if(mode==='missing')throw new Error('missing audio');return new Response('audio',{status:mode==='partial'?206:200,headers:{'content-type':'audio/mp4',...(mode==='truncated'?{'content-length':'100'}:{})}})}}),/full HTTP 200|missing audio|Incomplete preserved|cancel audio/);assert.deepEqual(await fs.readdir(directory),['existing'])}
 await assert.rejects(preserveMedia({...base,separated:{...base.separated,videoIdentity:{...videoIdentity,targetId:'other'}},fetchImpl:async()=>{throw new Error('must not fetch')}}),/identity-bound/)
})

test('Failed preservation cleanup stays recoverable without following a replaced Project directory',async t=>{
 const {PreservationCleanupError}=await import('../src/media-preservation.js'),root=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-preserve-recovery-')),directory=path.join(root,'artifacts'),moved=path.join(root,'retained');t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(directory);await fs.writeFile(path.join(directory,'existing'),'keep')
 const videoIdentity={version:1 as const,platform:'youtube' as const,targetId:'target',resourceId:'target'}
 let failure:unknown
 try{await preserveMedia({directory,url:'https://r.googlevideo.com/video',pageUrl:'https://youtube.com/watch?v=target',videoIdentity,separated:{audioUrl:'https://r.googlevideo.com/audio',videoDurationSeconds:10,audioDurationSeconds:10,videoIdentity},fetchImpl:async url=>{if(url.endsWith('/audio')){await fs.rename(directory,moved);await fs.mkdir(directory)}return new Response('bytes',{headers:{'content-type':url.endsWith('/audio')?'audio/mp4':'video/mp4'}})}})}catch(error){failure=error}
 assert.ok(failure instanceof PreservationCleanupError);await assert.rejects(failure.recover(),/directory changed/);assert.deepEqual(await fs.readdir(directory),[])
 await fs.rmdir(directory);await fs.rename(moved,directory);await failure.recover();assert.deepEqual(await fs.readdir(directory),['existing']);assert.equal(await fs.readFile(path.join(directory,'existing'),'utf8'),'keep')
})

test('Long storage and bounded decoding have independent budgets and segment contracts',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-archive-budget-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}))
 const handle=await fs.open(path.join(directory,'long.mp4'),'wx');await handle.truncate(513*1024*1024);await handle.close()
 await assert.rejects(ArtifactJobIO.open(directory,{action:'media.convert',artifactId:'long.mp4',outputFormat:'mp4'}),/processing byte budget/)
 const archive=await ArtifactJobIO.openArchive(directory,'long.mp4');assert.equal(archive.bytes,513*1024*1024);await archive.close()
 assert.deepEqual(assertArchiveSegment({action:'media.segment',artifactId:'long.mp4',segmentRange:{startSeconds:4500,endSeconds:4680}}),{artifactId:'long.mp4',startSeconds:4500,endSeconds:4680})
 for(const segmentRange of [{startSeconds:0,endSeconds:1800},{startSeconds:0,endSeconds:0},{startSeconds:0,endSeconds:Infinity},{startSeconds:0,endSeconds:10,filename:'escape.mp4'}])assert.throws(()=>assertArchiveSegment({action:'media.segment',artifactId:'long.mp4',segmentRange}))
 const segments=Array.from({length:94},()=> '#EXTINF:60,\npart.ts\n').join(''),vod=parsePreservationPlaylist('#EXTM3U\n'+segments+'#EXT-X-ENDLIST','https://example.test/full.m3u8');assert.equal(vod.duration,5640)
 assert.throws(()=>parsePreservationPlaylist('#EXTM3U\n'+Array.from({length:361},()=> '#EXTINF:60,\npart.ts\n').join('')+'#EXT-X-ENDLIST','https://example.test/full.m3u8'),/archive contract/)
 assert.ok(ARCHIVE_LIMITS.timeoutMs>60_000)
})

test('HTTP archive writes incrementally before EOF and rolls back a truncated stream',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-archive-stream-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let chunk=0,sawPartialFile=false
 const data=Buffer.alloc(128*1024,7),hash=crypto.createHash('sha256');for(let i=0;i<8;i++)hash.update(data)
 const result=await preserveMedia({directory,url:'https://example.test/full.mp4',pageUrl:'https://example.test/page',fetchImpl:async()=>new Response(new ReadableStream({async pull(c){if(chunk++<8){if(chunk>2){const files=await fs.readdir(directory);sawPartialFile||=files.length>0&&(await fs.stat(path.join(directory,files[0]!))).size>0}c.enqueue(data)}else c.close()}}),{headers:{'content-type':'video/mp4','content-length':String(8*data.length)}})})
 assert.equal(sawPartialFile,true);assert.equal(result.bytes,8*data.length);assert.equal(result.sha256,hash.digest('hex'))
 const before=await fs.readdir(directory)
 await assert.rejects(preserveMedia({directory,url:'https://example.test/partial.mp4',pageUrl:'https://example.test/page',fetchImpl:async()=>new Response(data,{headers:{'content-type':'video/mp4','content-length':String(data.length+1)}})}),/Incomplete preserved response/)
 assert.deepEqual(await fs.readdir(directory),before)
})

test('Bound complete programs require full synchronized AV coverage and refuse a shorter ad or missing original audio',async()=>{
 const {assertPreservedProgram}=await import('../src/media-preservation.js'),program={durationSeconds:104.1,requireAudio:true},video={type:'video' as const,startSeconds:0,endSeconds:104.1},audio={type:'audio' as const,startSeconds:0,endSeconds:104.12}
 assert.doesNotThrow(()=>assertPreservedProgram(program,[video,audio]))
 for(const tracks of [[video],[{...video,endSeconds:15},{...audio,endSeconds:15}],[video,{...audio,startSeconds:2,endSeconds:106.12}],[{...video,endSeconds:Infinity},audio]])assert.throws(()=>assertPreservedProgram(program,tracks),/PROGRAM_INCOMPLETE/)
})
test('Packet verification preserves every NAL and raw AAC payload while rejecting malformed framing, interior PTS drift and changed bytes',async()=>{
 const {preservationPacketParts,assertPreservedPacket}=await import('../src/preservation-packets.js'),avc={codec:'avc1.42001e'},annex=Uint8Array.from([0,0,0,1,9,240,0,0,1,6,10,0,0,0,1,101,4,5]),mp4=Uint8Array.from([0,0,0,2,9,240,0,0,0,2,6,10,0,0,0,3,101,4,5]),source={data:annex,timestamp:12.5,duration:1/30},actual={data:mp4,timestamp:12.5,duration:1/30}
 assert.deepEqual(Buffer.concat(preservationPacketParts(annex,'avc',avc).map(p=>Buffer.from(p))),Buffer.from(mp4));assert.doesNotThrow(()=>assertPreservedPacket(source,actual,'avc',avc,false))
 for(const p of [{...actual,timestamp:12.51},{...actual,data:mp4.subarray(0,-1)},{...actual,data:Uint8Array.from([...mp4.subarray(0,-1),6])}])assert.throws(()=>assertPreservedPacket(source,p,'avc',avc,false),/PACKET_PTS_CHANGED|PACKET_PAYLOAD_CHANGED/)
 assert.throws(()=>preservationPacketParts(Uint8Array.from([2,0,0,1,101]),'avc',avc),/Annex/);assert.throws(()=>preservationPacketParts(Uint8Array.from([0,0,1,0,0,1]),'hevc',{codec:'hvc1'}),/Empty|Invalid/)
 const aac={codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2},adts=Uint8Array.from([255,241,76,128,1,95,252,1,2,3]),audio={data:adts,timestamp:1,duration:1024/48000},raw={...audio,data:Uint8Array.from([1,2,3])}
 assert.doesNotThrow(()=>assertPreservedPacket(audio,raw,'aac',aac,true));assert.throws(()=>assertPreservedPacket(audio,{...raw,duration:.1},'aac',aac,true),/PTS_CHANGED/)
 for(const data of [adts.subarray(0,8),Uint8Array.from([255,241,76,128,1,95,253,1,2,3])])assert.throws(()=>preservationPacketParts(data,'aac',aac),/ADTS/)
 assert.throws(()=>preservationPacketParts(adts,'aac',{...aac,sampleRate:44100}),/configuration/)
})
test('Bounded packet index detects interior timing and boundary changes; digest distinguishes equal concatenated bytes',async()=>{
 const {PreservationPacketTimeline,hashPreservationPacket}=await import('../src/preservation-packets.js'),index=new PreservationPacketTimeline()
 for(let i=0;i<4100;i++)index.add({timestamp:i/30,duration:1/30},3)
 index.check(4096,{timestamp:4096/30,duration:1/30,data:new Uint8Array(3)},false)
 assert.throws(()=>index.check(2000,{timestamp:2000/30+.01,duration:1/30,data:new Uint8Array(3)},false),/PTS_CHANGED/)
 assert.throws(()=>index.check(2000,{timestamp:2000/30,duration:1/30,data:new Uint8Array(2)},false),/PAYLOAD_CHANGED/)
 assert.throws(()=>index.check(4100,{timestamp:0,duration:1/30,data:new Uint8Array(3)},false),/added/)
 assert.throws(()=>index.add({timestamp:NaN,duration:0},3),/Invalid/)
 const digest=(packets:number[][])=>{const hash=crypto.createHash('sha256');for(const p of packets)hashPreservationPacket(hash,[Uint8Array.from(p)]);return hash.digest('hex')}
 assert.notEqual(digest([[1,2],[3]]),digest([[1],[2,3]]))
})

test('Declared HLS subtitles and all audio groups stay explicit; malformed declarations and incomplete captions roll back',async t=>{
 const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",URI="a.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="b",NAME="English alternate",LANGUAGE="en",URI="b.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",LANGUAGE="en",URI="sub.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English US",LANGUAGE="en-US",URI="sub.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="a",SUBTITLES="s"\nvideo.m3u8\n',base='https://example.test/master.m3u8',parsed=parsePreservationPlaylist(master,base)
 assert.equal(parsed.audio.length,2);assert.deepEqual(parsed.subtitles.map(s=>s.language),['en','en-US']);assert.equal(parsed.variants[0]!.subtitlesGroup,'s')
 for(const text of [master.replace('TYPE=SUBTITLES','TYPE=CLOSED-CAPTIONS'),master.replace('URI="sub.m3u8"','DEFAULT=MAYBE,URI="sub.m3u8"'),master.replace('NAME="English US",LANGUAGE="en-US"','NAME="English",LANGUAGE="en"'),master.replace('BANDWIDTH=1000','BANDWIDTH=1000,BANDWIDTH=2000')])assert.throws(()=>parsePreservationPlaylist(text,base),/Unsupported|Malformed|Duplicate/)
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-subtitle-rollback-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.writeFile(path.join(directory,'existing'),'keep')
 for(const mode of ['missing','utf8','map','truncated','cancel','identity','not-hls'] as const){
  const cancel=new AbortController();let changed=false,drained=false
  const fetchImpl=Object.assign(async(url:string)=>{
   const key=new URL(url).pathname
   if(key==='/master.m3u8')return new Response(mode==='not-hls'?'video':master,{headers:{'content-type':mode==='not-hls'?'video/mp4':'application/vnd.apple.mpegurl'}})
   if(key.endsWith('.m3u8'))return new Response('#EXTM3U\n#EXTINF:1,\nfirst.vtt\n#EXTINF:1,\nlast.vtt\n#EXT-X-ENDLIST\n')
   if(key==='/first.vtt')return new Response('WEBVTT\n\n00:00.000 --> 00:00.500\nFirst\n\n')
   assert.equal(key,'/last.vtt','Subtitle validation precedes large AV transfers')
   if(mode==='missing')return new Response(null,{status:404})
   if(mode==='cancel')cancel.abort(new Error('cancel final subtitle'))
   if(mode==='identity')changed=true
   return new Response(mode==='utf8'?Uint8Array.from([255,254]):mode==='map'?'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00.000,MPEGTS:bad\n\n':'WEBVTT\n\n',{headers:mode==='truncated'?{'content-length':'200'}:{}})
  },{waitForIdle:async()=>{drained=true}})
  await assert.rejects(preserveMedia({directory,url:base,pageUrl:'https://example.test/program',expectedTransport:'hls',signal:cancel.signal,guard:async()=>{if(changed)throw new Error('VIDEO_IDENTITY_CHANGED')},fetchImpl}),mode==='identity'?/VIDEO_IDENTITY_CHANGED/:mode==='cancel'?/cancel final subtitle/:/MEDIA_PRESERVATION_TRACKS_INCOMPLETE/)
  assert.equal(drained,true);assert.deepEqual(await fs.readdir(directory),['existing'])
 }
})
