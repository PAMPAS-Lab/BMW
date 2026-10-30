import assert from 'node:assert/strict'
import test from 'node:test'
import {assemblePreservedVtt,parsePreservedVtt,vttTimestamp} from '../src/hls-subtitles.js'
const bytes=(s:string)=>Buffer.from(s,'utf8')
const segment=(s:string,index=0)=>({artifactId:'segment-'+index+'.vtt',data:bytes(s),elapsedSeconds:index*2,durationSeconds:2})
const header='WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:90000\n\n'
test('WebVTT preserves Unicode, identifiers, settings, whitespace and common STYLE/REGION/NOTE blocks',()=>{
 const source=bytes('WEBVTT\r\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:90000\r\n\r\nSTYLE\r\n::cue { color: lime }\r\n\r\nREGION\r\nid:r\r\n\r\nNOTE original\r\n\r\nid-1\r\n00:00.000 --> 00:01.000 align:start region:r\r\n测试 <v speaker>hello</v>  \r\n\r\n')
 const parsed=parsePreservedVtt(source)
 assert.equal(parsed.cues[0]!.text,'测试 <v speaker>hello</v>  ');assert.equal(parsed.cues[0]!.identifier,'id-1');assert.equal(parsed.cues[0]!.settings,'align:start region:r')
 const result=assemblePreservedVtt([{artifactId:'source.vtt',data:source,elapsedSeconds:0,durationSeconds:2}],{startSeconds:1,endSeconds:3})
 const output=parsePreservedVtt(result.data)
 assert.equal(output.timestampMap.explicit,false);assert.equal(output.cues[0]!.startSeconds,1);assert.equal(output.cues[0]!.endSeconds,2)
 assert.deepEqual(output.configuration,parsed.configuration);assert.deepEqual(output.notes,parsed.notes);assert.equal(output.cues[0]!.text,parsed.cues[0]!.text)
})
test('Timestamp map and 33-bit wrap align sidecars to file PTS; only exact cross-segment duplicates are removed',()=>{
 const cue='same\n00:00.000 --> 00:01.000\nOriginal text\n\n',a=segment(header+cue),b=segment(header+cue+'next\n00:02.000 --> 00:03.000\nLater text\n\n',1)
 const result=assemblePreservedVtt([a,b],{startSeconds:1,endSeconds:5}),parsed=parsePreservedVtt(result.data)
 assert.equal(assemblePreservedVtt([segment(header+cue+cue)],{startSeconds:1,endSeconds:5}).cueCount,2,'Repeated cues within an original segment stay intact.')
 assert.equal(result.occurrenceCount,3);assert.equal(result.cueCount,2);assert.equal(result.duplicatesRemoved,1)
 assert.deepEqual(parsed.cues.map(c=>[c.startSeconds,c.endSeconds]),[[1,2],[3,4]])
 const wrapped=assemblePreservedVtt([segment('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:'+String(2**33-90000)+'\n\n00:01.250 --> 00:01.750\nWrapped\n\n')],{startSeconds:0,endSeconds:2})
 assert.equal(wrapped.mappings[0]!.epoch,-1);assert.equal(parsePreservedVtt(wrapped.data).cues[0]!.startSeconds,.25)
 assert.equal(assemblePreservedVtt([segment('WEBVTT\n\n')],{startSeconds:0,endSeconds:2}).cueCount,0,'An advertised empty track remains explicit.')
})
test('Malformed UTF8, malformed/duplicate maps, invalid cues, changing styles and unsynchronized time domains fail closed',()=>{
 for(const text of ['garbage','WEBVTT\n\njunk\n\n','WEBVTT\n\n00:00.000 --> 00:00.000\nx\n\n','WEBVTT\n\n00:60.000 --> 01:02.000\nx\n\n','WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00.000,MPEGTS:0\nX-TIMESTAMP-MAP=LOCAL:00:00.000,MPEGTS:0\n\n','WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00.000,MPEGTS:8589934592\n\n'])assert.throws(()=>parsePreservedVtt(bytes(text)),/SUBTITLE_INVALID/)
 assert.throws(()=>parsePreservedVtt(Uint8Array.from([255,254,0])),/UTF-8/)
 assert.throws(()=>assemblePreservedVtt([segment(header+'00:00.000 --> 00:01.000\nx\n\n')],{startSeconds:10,endSeconds:20}),/timestamp map/)
 const first=segment('WEBVTT\n\nSTYLE\n::cue{color:red}\n\n00:00.000 --> 00:01.000\nx\n\n'),second=segment('WEBVTT\n\nSTYLE\n::cue{color:blue}\n\n00:02.000 --> 00:03.000\ny\n\n',1)
 assert.throws(()=>assemblePreservedVtt([first,second],{startSeconds:0,endSeconds:4}),/Changing subtitle/)
 assert.equal(vttTimestamp('01:02:03.456'),3723.456)
 assert.equal(vttTimestamp('00:06.940'),6.94)
 const decimal=assemblePreservedVtt([segment('WEBVTT\n\n00:06.940 --> 00:07.660\nDecimal clock\n\n')],{startSeconds:0,endSeconds:10});assert.equal(parsePreservedVtt(decimal.data).cues[0]!.startSeconds,6.94)
})
