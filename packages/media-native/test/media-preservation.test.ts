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
