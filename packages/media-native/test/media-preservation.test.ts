import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {parsePreservationPlaylist,preserveMedia} from '../src/media-preservation.js'

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
