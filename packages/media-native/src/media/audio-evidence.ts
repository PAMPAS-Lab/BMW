import {AudioBufferSink} from 'mediabunny'
import type {Input} from 'mediabunny'
import type {AudioEvidence} from '../audio-evidence-contract.js'
/** Decode a bounded interval without gain, resampling or channel mixing. This does not perform perceptual listening. */
export async function sampleAudioEvidence(input:Input,startSeconds:number,endSeconds:number):Promise<{data:Uint8Array;info:AudioEvidence}>{
 const tracks=await input.getAudioTracks(),track=await input.getPrimaryAudioTrack();if(!track||tracks.length>15||!await track.canDecode())throw new Error('Audio evidence requires a decodable primary audio track within the fifteen-track archive contract; silence is not inferred from a missing track.')
 const sampleRate=await track.getSampleRate(),channels=await track.getNumberOfChannels(),end=await track.computeDuration(),first=await track.getFirstTimestamp()
 if(startSeconds<Math.max(0,first)||endSeconds>end||sampleRate<8000||sampleRate>96000||channels<1||channels>8)throw new Error('Audio evidence interval or native format is outside its bounded track.')
 const frames=Math.round((endSeconds-startSeconds)*sampleRate),data=new Uint8Array(44+frames*channels*2),view=new DataView(data.buffer),written=new Uint8Array(frames),values=new Float32Array(frames*channels)
 if(frames<1||frames*channels>8*96000*10)throw new Error('Audio evidence sample budget exceeded.')
 let decodedChunks=0,previousEnd=-Infinity
 for await(const chunk of new AudioBufferSink(track).buffers(startSeconds,endSeconds)){
  const buffer=chunk.buffer;if(++decodedChunks>3000||buffer.sampleRate!==sampleRate||buffer.numberOfChannels!==channels||chunk.timestamp<previousEnd-2/sampleRate)throw new Error('Audio decode changed format, overlapped, or exceeded its sample budget.')
  previousEnd=chunk.timestamp+buffer.duration;const offset=Math.round((chunk.timestamp-startSeconds)*sampleRate)
  for(let channel=0;channel<channels;channel++){const samples=buffer.getChannelData(channel);for(let i=0;i<samples.length;i++){const frame=offset+i;if(frame<0||frame>=frames)continue;const value=samples[i]!;if(!Number.isFinite(value))throw new Error('Audio contains nonfinite PCM.');values[frame*channels+channel]=value;if(!channel)written[frame]=1}}
 }
 if(!decodedChunks)throw new Error('Audio interval decoded no samples.')
 const text=(at:number,value:string)=>{for(let i=0;i<value.length;i++)data[at+i]=value.charCodeAt(i)}
 text(0,'RIFF');view.setUint32(4,data.length-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,data.length-44,true)
 let peak=0,sum=0,clippedSamples=0,missingFrames=0;const windows:AudioEvidence['windows']=[]
 for(let from=0;from<frames;from+=Math.round(sampleRate/10)){
  const to=Math.min(frames,from+Math.round(sampleRate/10));let windowSum=0,windowPeak=0
  for(let frame=from;frame<to;frame++){if(!written[frame])missingFrames++;for(let channel=0;channel<channels;channel++){const at=frame*channels+channel,value=values[at]!,absolute=Math.abs(value);if(absolute>1)clippedSamples++;peak=Math.max(peak,absolute);sum+=value*value;windowPeak=Math.max(windowPeak,absolute);windowSum+=value*value;const v=Math.max(-1,Math.min(1,value));view.setInt16(44+at*2,Math.round(v*(v<0?32768:32767)),true)}}
  windows.push({startSeconds:startSeconds+from/sampleRate,endSeconds:startSeconds+to/sampleRate,rms:Math.sqrt(windowSum/((to-from)*channels)),peak:windowPeak})
 }
 return {data,info:{inputAudioTrackId:track.id,inputAudioTrackCount:tracks.length,audioSelection:'primary-audio-track',startSeconds,endSeconds,sampleRate,channels,frames,peak,rms:Math.sqrt(sum/(frames*channels)),clippedSamples,missingFrames,windows,listeningStatus:'not-performed',processing:'native-rate-and-channels; PCM16 quantization; no gain/resampling',timebase:'input-file-PTS'}}
}
