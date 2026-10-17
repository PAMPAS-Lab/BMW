import {COMPOSITION_LIMITS} from '../composition-limits.js'
import {scenePlaybackClock} from '../scene-playback-window.js'
import {layerFadeGain} from '../composition-layers.js'
import type {AudioLayer} from '../composition-layers.js'
import {sceneVisuals} from '../visual-segments.js'
import type {MediaComposition} from '../composition-contract.js'
import {compositionDuration,narrationWindows} from '../composition-contract.js'
import {AudioBufferSink} from 'mediabunny'
import type {Input,InputAudioTrack,WrappedAudioBuffer} from 'mediabunny'
import {mixSourceAudioChunk} from '../source-audio.js'
type AudioAssets=Map<string,{data:Uint8Array;input?:Input}>
interface VoiceMeasurement {duration:number;peak:number}
interface MixRange {startFrame:number;frames:number;voices:VoiceMeasurement[];decodeVoice:(id:string)=>Promise<AudioBuffer>;readSource:(key:string,track:InputAudioTrack,start:number,end:number,from:number,to:number,consume:(chunk:WrappedAudioBuffer)=>void)=>Promise<void>;check:()=>void}
/** Keep codec state across PCM windows. Restarting AAC at every window would
 * repeat decoder priming and produce a different waveform at each boundary. */
class AudioWindowReader {
 private iterator:ReturnType<AudioBufferSink['buffers']>
 private pending?:WrappedAudioBuffer
 private ended=false
 private lastTo=-Infinity
 constructor(private track:InputAudioTrack,private start:number,private end:number){this.iterator=new AudioBufferSink(track).buffers(start,end)}
 async read(from:number,to:number,consume:(chunk:WrappedAudioBuffer)=>void,check:()=>void){
  // The gain scan may already have consumed this interval. Comparing only request
  // starts loses audio on the first nonzero seek and forward overlapping windows.
  if(from<this.lastTo){await this.close();this.iterator=new AudioBufferSink(this.track).buffers(this.start,this.end);this.ended=false}
  this.lastTo=to
  while(!this.ended){check();if(!this.pending){const next=await this.iterator.next();if(next.done||!next.value){this.ended=true;break}this.pending=next.value}
   const chunk=this.pending
   if(chunk.timestamp>=to)return
   if(chunk.timestamp+chunk.duration>from)consume(chunk)
   if(chunk.timestamp+chunk.duration>=to)return
   this.pending=undefined
  }
 }
 async close(){await this.iterator.return();this.pending=undefined;this.lastTo=-Infinity}
}
/** The same measured voice mix is used by Studio playback and final export. */
export async function mixCompositionAudio(composition:MediaComposition,assets:AudioAssets,audioContext:AudioContext):Promise<{mixed:AudioBuffer;narrationDurations:number[];audioPeak:number}>{
    if(compositionDuration(composition)>180)throw new Error('Use bounded audio windows for compositions longer than three minutes.')
    return mixAudioRange(composition,assets,audioContext)
}
async function mixAudioRange(composition:MediaComposition,assets:AudioAssets,audioContext:AudioContext,range?:MixRange):Promise<{mixed:AudioBuffer;narrationDurations:number[];audioPeak:number}>{
    const duration=compositionDuration(composition)
    const startFrame=range?.startFrame??0,frameCount=range?.frames??Math.ceil(duration*48000),rangeStart=startFrame/48000,rangeEnd=(startFrame+frameCount)/48000
    const mixed = new AudioBuffer({ numberOfChannels: 2, length: frameCount, sampleRate: 48000 })
    const narrationDurations: number[] = []
    const footage:{segment:ReturnType<typeof sceneVisuals>[number];start:number;duration:number}[]=[]
    let start = 0
    for (const [sceneIndex,scene] of composition.scenes.entries()) {
      range?.check()
      let voice: AudioBuffer | undefined
      if (scene.audioArtifactId) {
        const asset = assets.get(scene.audioArtifactId)
        if (!asset) throw new Error('Narration asset has no audio track.')
        if(!range||start<rangeEnd&&start+scene.durationSeconds>rangeStart)voice=range?await range.decodeVoice(scene.audioArtifactId):await audioContext.decodeAudioData(asset.data.slice().buffer as ArrayBuffer)
      }
      const measured=range?.voices[sceneIndex],voiceDuration=measured?.duration??voice?.duration??0
      narrationDurations.push(voiceDuration)
      let peak = measured?.peak??.001
      if (voice&&!measured) for (let channel = 0; channel < voice.numberOfChannels; channel++) { for (const sample of voice.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample)) }
      const voiceWindows=voiceDuration?narrationWindows(scene,voiceDuration):[]
      const voiceGain = scene.voiceMuted?0:Math.min(3, .78 / peak) * (scene.voiceVolume ?? 1)
      const clock=scenePlaybackClock(scene,narrationDurations.length-1,composition.scenes.length)
      const frequencies = [[130.81,164.81,196],[110,130.81,164.81],[87.31,110,130.81],[98,123.47,146.83]][clock.musicIndex % 4]
      for (let channel = 0; channel < 2; channel++) {
        const target = mixed.getChannelData(channel), source = voice?.getChannelData(Math.min(channel, voice.numberOfChannels - 1))
        const begin = Math.max(startFrame,Math.round(start * 48000)), end = Math.min(startFrame+frameCount,Math.round((start + scene.durationSeconds) * 48000))
        let windowIndex=0
        for (let sample = begin; sample < end; sample++) {
          const local=sample/48000-start;while(windowIndex<voiceWindows.length&&local>=voiceWindows[windowIndex].startSeconds+voiceWindows[windowIndex].durationSeconds)windowIndex++;const timing=voiceWindows[windowIndex],inside=timing&&local>=timing.startSeconds&&local<timing.startSeconds+timing.durationSeconds
          const sourceIndex=inside&&voice?Math.max(0,(timing.sourceStartSeconds+(local-timing.startSeconds)*timing.playbackRate)*voice.sampleRate):-1,index=Math.floor(sourceIndex),fraction=sourceIndex-index
          const speech=source&&index>=0&&index<source.length?(source[index]*(1-fraction)+(source[Math.min(index+1,source.length-1)]??0)*fraction)*voiceGain:0
          const envelope = Math.max(0,Math.min(1, (clock.startSeconds+local) / 1.2, (clock.durationSeconds-clock.startSeconds-local) / 1.2))
          const music = composition.music ? frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * sample / 48000 + channel * .06), 0) / 3 * (speech ? .009 : .018) * envelope : 0
          target[sample-startFrame] = speech + music
        }
      }
      let visualStart=0
      const visuals=sceneVisuals(scene)
      for(const segment of visuals){
        if(segment.videoArtifactId&&segment.keepSourceAudio)footage.push({segment,start:start+visualStart,duration:segment.durationSeconds})
        visualStart+=segment.durationSeconds
      }
      start += scene.durationSeconds
    }
    // Coalesce unchanged original footage across scene boundaries as well as
    // visual cuts. Equal filenames alone never establish source continuity.
    for(let index=0;index<footage.length;index++){
      const first=footage[index];let last=first,span=first.duration
      while(index+1<footage.length){
        const next=footage[index+1],a=last.segment,b=next.segment
        if(a.videoArtifactId!==b.videoArtifactId||a.playbackRate!==b.playbackRate||(a.sourceVolume??1)!==(b.sourceVolume??1)||Math.abs(next.start-first.start-span)>.000001||Math.abs(a.sourceStartSeconds+last.duration*a.playbackRate-b.sourceStartSeconds)>.000001)break
        span+=next.duration;last=next;index++
      }
      const segment=first.segment,input=assets.get(segment.videoArtifactId!)?.input;if(!input)throw new Error('Source audio input is unavailable.')
      const track=await input.getPrimaryAudioTrack()
      if(track){
        if(!await track.canDecode())throw new Error('The selected footage audio cannot be decoded.')
        const sourceEnd=segment.sourceStartSeconds+span*segment.playbackRate
        const from=segment.sourceStartSeconds+Math.max(0,rangeStart-first.start)*segment.playbackRate,to=Math.min(sourceEnd,segment.sourceStartSeconds+(rangeEnd-first.start)*segment.playbackRate)
        if(to>from){const consume=(chunk:WrappedAudioBuffer)=>{range?.check();mixSourceAudioChunk([mixed.getChannelData(0),mixed.getChannelData(1)],chunk.buffer,chunk.timestamp,first.start,span,segment.sourceStartSeconds,segment.playbackRate,segment.sourceVolume??1,undefined,startFrame)};if(range)await range.readSource('footage-'+index,track,segment.sourceStartSeconds,sourceEnd,from,to,consume);else for await(const chunk of new AudioBufferSink(track).buffers(segment.sourceStartSeconds,sourceEnd))consume(chunk)}
      }
    }
    // Stream independent clips into the shared 48 kHz mix; never retain full decoded tracks.
    const tracks:{layer:AudioLayer;start:number}[]=(composition.audioTracks??[]).map(layer=>({layer,start:layer.startSeconds}))
    const voices:{start:number;end:number}[]=[];let sceneStart=0
    for(const [index,scene]of composition.scenes.entries()){
      tracks.push(...(scene.audioTracks??[]).map(layer=>({layer,start:sceneStart+layer.startSeconds})))
      if(narrationDurations[index]>0&&!scene.voiceMuted&&(scene.voiceVolume??1)>0)for(const timing of narrationWindows(scene,narrationDurations[index])){const range={start:sceneStart+timing.startSeconds,end:sceneStart+timing.startSeconds+timing.durationSeconds},previous=voices.at(-1);if(previous&&Math.abs(previous.end-range.start)<.000001)previous.end=range.end;else voices.push(range)}
      sceneStart+=scene.durationSeconds
    }
    const voiceAt=(time:number)=>{let lo=0,hi=voices.length;while(lo<hi){const mid=(lo+hi)>>>1;if(voices[mid].start<=time)lo=mid+1;else hi=mid}const range=voices[lo-1];return range&&time<range.end?range:undefined}
    const used=new Set<number>()
    for(const [index,{layer,start}]of tracks.entries()){
      if(used.has(index))continue;used.add(index)
      let span=layer.durationSeconds,last=layer
      // Contiguous unchanged cuts decode once: AAC priming must not recur at a cut.
      // Identity, original envelope, source clock and all gain policies must match.
      if(layer.fadeWindow)for(;;){
        const next=tracks.findIndex(({layer:candidate,start:at},i)=>!used.has(i)&&candidate.fadeWindow!==undefined&&candidate.fadeWindow.originId===layer.fadeWindow!.originId&&candidate.fadeWindow.durationSeconds===layer.fadeWindow!.durationSeconds&&candidate.artifactId===layer.artifactId&&candidate.playbackRate===layer.playbackRate&&candidate.volume===layer.volume&&candidate.muted===layer.muted&&candidate.ducking===layer.ducking&&candidate.fadeInSeconds===layer.fadeInSeconds&&candidate.fadeOutSeconds===layer.fadeOutSeconds&&Math.abs(at-start-span)<.000001&&Math.abs(last.sourceStartSeconds+last.durationSeconds*last.playbackRate-candidate.sourceStartSeconds)<.000001&&Math.abs(last.fadeWindow!.startSeconds+last.durationSeconds-candidate.fadeWindow.startSeconds)<.000001)
        if(next<0)break;used.add(next);last=tracks[next].layer;span+=last.durationSeconds
      }
      const track=await assets.get(layer.artifactId)?.input?.getPrimaryAudioTrack()
      if(!track||!await track.canDecode())throw new Error(`音轨 ${layer.title} 没有可解码的音频。`)
      const end=await track.computeDuration(),first=await track.getFirstTimestamp(),sourceEnd=layer.sourceStartSeconds+span*layer.playbackRate
      if(!Number.isFinite(end)||end<=0||end>1800||layer.sourceStartSeconds<first||sourceEnd>end+.001)throw new Error(`音轨 ${layer.title} 的源区间超过实际音频范围。`)
      if(layer.muted)continue
      const gainAt=(local:number)=>{
        const fade=layerFadeGain(layer,local)
        const time=start+local,voice=layer.ducking?voiceAt(time):undefined
        const duck=voice?1-.75*Math.max(0,Math.min(1,(time-voice.start)/.05,(voice.end-time)/.05)):1
        return fade*duck
      }
      const from=layer.sourceStartSeconds+Math.max(0,rangeStart-start)*layer.playbackRate,to=Math.min(sourceEnd,layer.sourceStartSeconds+(rangeEnd-start)*layer.playbackRate)
      if(to>from){const consume=(chunk:WrappedAudioBuffer)=>{range?.check();mixSourceAudioChunk([mixed.getChannelData(0),mixed.getChannelData(1)],chunk.buffer,chunk.timestamp,start,span,layer.sourceStartSeconds,layer.playbackRate,layer.volume,gainAt,startFrame)};if(range)await range.readSource('layer-'+index,track,layer.sourceStartSeconds,sourceEnd,from,to,consume);else for await(const chunk of new AudioBufferSink(track).buffers(layer.sourceStartSeconds,sourceEnd))consume(chunk)}
    }
    let audioPeak = 0
    for (let channel = 0; channel < 2; channel++) for (const sample of mixed.getChannelData(channel)) audioPeak = Math.max(audioPeak, Math.abs(sample))
    if (!range&&audioPeak > .94) { const gain = .94 / audioPeak; for (let channel = 0; channel < 2; channel++) { const samples = mixed.getChannelData(channel); for (let index = 0; index < samples.length; index++) samples[index] *= gain } audioPeak = .94 }
    return {mixed,narrationDurations,audioPeak}
}

/** Production consumers must retain only a bounded number of returned windows. */
export interface CompositionAudioWindows {
 readonly frames:number;readonly windowFrames:number;readonly narrationDurations:number[];readonly audioPeak:number
 render(startFrame:number,frames:number):Promise<AudioBuffer>
 close():Promise<void>
}
/** Two-pass global gain; a four-second PCM window and at most one decoded voice
 * source (still limited to 180 seconds) are retained, never a full-film buffer.
 * Source and fade clocks remain absolute across windows and arbitrary seeks. */
export async function prepareCompositionAudio(composition:MediaComposition,assets:AudioAssets,audioContext:AudioContext,check:()=>void=()=>{}):Promise<CompositionAudioWindows>{
 const value=structuredClone(composition),duration=compositionDuration(value),frames=Math.ceil(duration*48000),windowFrames=COMPOSITION_LIMITS.audioWindowFrames
 if(!Number.isFinite(duration)||duration<=0||duration>COMPOSITION_LIMITS.seconds)throw new Error('Bounded audio supports finite compositions up to twelve minutes.')
 let cached:{id:string;buffer:AudioBuffer}|undefined,closed=false,tail:Promise<void>=Promise.resolve()
 const readers=new Map<string,AudioWindowReader>()
 const guard=()=>{check();if(closed)throw new Error('Audio window plan is closed.')}
 const decodeVoice=async(id:string)=>{guard();if(cached?.id!==id){cached=undefined;const asset=assets.get(id);if(!asset)throw new Error('Narration asset is unavailable.');const buffer=await audioContext.decodeAudioData(asset.data.slice().buffer as ArrayBuffer);guard();if(!Number.isFinite(buffer.duration)||buffer.duration<=0||buffer.duration>180)throw new Error('Narration source exceeds the 180-second audio budget.');cached={id,buffer}}return cached.buffer}
 const measurements=new Map<string,VoiceMeasurement>(),voices:VoiceMeasurement[]=[]
 try{
  for(const scene of value.scenes){guard();let measurement:VoiceMeasurement={duration:0,peak:.001};if(scene.audioArtifactId){measurement=measurements.get(scene.audioArtifactId)!;if(!measurement){const buffer=await decodeVoice(scene.audioArtifactId);let peak=.001;for(let c=0;c<buffer.numberOfChannels;c++)for(const sample of buffer.getChannelData(c))peak=Math.max(peak,Math.abs(sample));measurement={duration:buffer.duration,peak};measurements.set(scene.audioArtifactId,measurement)}narrationWindows(scene,measurement.duration)}voices.push(measurement)}
  const raw=async(startFrame:number,count:number)=>{const active=new Set<string>();try{return await mixAudioRange(value,assets,audioContext,{startFrame,frames:count,voices,decodeVoice,check:guard,readSource:async(key,track,start,end,from,to,consume)=>{active.add(key);let reader=readers.get(key);if(!reader){reader=new AudioWindowReader(track,start,end);readers.set(key,reader)}await reader.read(from,to,consume,guard)}})}finally{for(const [key,reader]of readers)if(!active.has(key)){await reader.close();readers.delete(key)}}}
  let peak=0
  for(let start=0;start<frames;start+=windowFrames){guard();const result=await raw(start,Math.min(windowFrames,frames-start));peak=Math.max(peak,result.audioPeak);await new Promise<void>(resolve=>setTimeout(resolve,0))}
  guard();const gain=peak>.94?.94/peak:1,narrationDurations=voices.map(v=>v.duration)
  return {frames,windowFrames,narrationDurations,audioPeak:Math.min(.94,peak),render(startFrame,count){
   const operation=tail.then(async()=>{guard();if(!Number.isSafeInteger(startFrame)||!Number.isSafeInteger(count)||startFrame<0||count<1||count>windowFrames||startFrame+count>frames)throw new Error('Audio window exceeds its PCM frame budget.');const {mixed}=await raw(startFrame,count);guard();if(gain!==1)for(let c=0;c<2;c++){const samples=mixed.getChannelData(c);for(let i=0;i<samples.length;i++)samples[i]*=gain}return mixed})
   tail=operation.then(()=>{},()=>{});return operation
  },async close(){closed=true;await tail;await Promise.all([...readers.values()].map(reader=>reader.close()));readers.clear();cached=undefined}}
 }catch(error){await Promise.all([...readers.values()].map(reader=>reader.close()));cached=undefined;throw error}
}
