import {AudioBufferSink} from 'mediabunny'
import type {Input} from 'mediabunny'
import type {SpeechNormalization} from '../speech-contract.js'
/** Fixed downmix and WebAudio resampling. Gaps retain silence; no gain or speed change; PCM16 saturation is reported. */
export async function normalizeSpeech(input:Input):Promise<{data:Uint8Array;info:SpeechNormalization}> {
 const tracks=await input.getAudioTracks()
 if(tracks.length!==1||!await tracks[0].canDecode())throw new Error('Speech normalization requires exactly one decodable audio track.')
 const track=tracks[0],rate=await track.getSampleRate(),channels=await track.getNumberOfChannels(),duration=await track.computeDuration()
 if(!Number.isSafeInteger(rate)||rate<8000||rate>96000||!Number.isSafeInteger(channels)||channels<1||channels>8||!Number.isFinite(duration)||duration<=0||duration>180)throw new Error('Speech input exceeds the 180-second audio budget.')
 const mono=new AudioBuffer({numberOfChannels:1,sampleRate:rate,length:Math.ceil(duration*rate)}),target=mono.getChannelData(0)
 let count=0,totalSamples=0,first=Infinity,end=0,previousEnd=0
 for await(const chunk of new AudioBufferSink(track).buffers()){
  const buffer=chunk.buffer,start=chunk.timestamp,finish=start+buffer.duration
  if(++count>30000||(totalSamples+=buffer.length*buffer.numberOfChannels)>32*1024*1024||buffer.sampleRate!==rate||buffer.numberOfChannels!==channels||!Number.isFinite(start)||start<0||start<previousEnd-2/rate||finish>duration+2/rate)throw new Error('Speech decode changed its clock/format or exceeded its sample budget.')
  first=Math.min(first,start);end=Math.max(end,finish);previousEnd=finish
  const begin=Math.round(start*rate)
  for(let channel=0;channel<channels;channel++){const samples=buffer.getChannelData(channel);for(let index=0;index<samples.length;index++){if(!Number.isFinite(samples[index]))throw new Error('Speech contains nonfinite audio samples.');if(begin+index<target.length)target[begin+index]+=samples[index]/channels}}
 }
 if(!count||end<=0)throw new Error('Speech track decoded no audio samples.')
 const frames=Math.ceil(end*16000)
 if(frames<160||frames>180*16000)throw new Error('Normalized speech exceeds its sample budget.')
 const context=new OfflineAudioContext(1,frames,16000),source=context.createBufferSource();source.buffer=mono;source.connect(context.destination);source.start()
 let clippedSamples=0
 const normalized=await context.startRendering(),samples=normalized.getChannelData(0),data=new Uint8Array(44+frames*2),view=new DataView(data.buffer)
 const text=(offset:number,value:string)=>{for(let index=0;index<value.length;index++)data[offset+index]=value.charCodeAt(index)}
 text(0,'RIFF');view.setUint32(4,data.length-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*2,true)
 for(let index=0;index<frames;index++){if(Math.abs(samples[index])>1)clippedSamples++;const sample=Math.max(-1,Math.min(1,samples[index]));view.setInt16(44+index*2,Math.round(sample*(sample<0?32768:32767)),true)}
 return {data,info:{kind:'speech-pcm',sampleRate:16000,channels:1,sampleType:'pcm-s16le',frames,durationSeconds:frames/16000,inputSampleRate:rate,inputChannels:channels,decodedStartSeconds:first,decodedEndSeconds:end,clippedSamples,downmix:'channel-mean'}}
}
