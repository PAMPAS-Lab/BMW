import {scenePlaybackClock} from '../scene-playback-window.js'
import {layerFadeGain} from '../composition-layers.js'
import type {AudioLayer} from '../composition-layers.js'
import {sceneVisuals} from '../visual-segments.js'
import type {MediaComposition} from '../composition-contract.js'
import {compositionDuration,narrationWindows} from '../composition-contract.js'
import {AudioBufferSink} from 'mediabunny'
import type {Input} from 'mediabunny'
import {mixSourceAudioChunk} from '../source-audio.js'
/** The same measured voice mix is used by Studio playback and final export. */
export async function mixCompositionAudio(composition:MediaComposition,assets:Map<string,{data:Uint8Array;input?:Input}>,audioContext:AudioContext):Promise<{mixed:AudioBuffer;narrationDurations:number[];audioPeak:number}>{
    const duration=compositionDuration(composition)
    const mixed = new AudioBuffer({ numberOfChannels: 2, length: Math.ceil(duration * 48000), sampleRate: 48000 })
    const narrationDurations: number[] = []
    const footage:{segment:ReturnType<typeof sceneVisuals>[number];start:number;duration:number}[]=[]
    let start = 0
    for (const scene of composition.scenes) {
      let voice: AudioBuffer | undefined
      if (scene.audioArtifactId) {
        const asset = assets.get(scene.audioArtifactId)
        if (!asset) throw new Error('Narration asset has no audio track.')
        voice = await audioContext.decodeAudioData(asset.data.slice().buffer as ArrayBuffer)
        narrationWindows(scene,voice.duration)
      }
      narrationDurations.push(voice?.duration ?? 0)
      let peak = .001
      if (voice) for (let channel = 0; channel < voice.numberOfChannels; channel++) { for (const sample of voice.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample)) }
      const voiceWindows=voice?narrationWindows(scene,voice.duration):[]
      const voiceGain = scene.voiceMuted?0:Math.min(3, .78 / peak) * (scene.voiceVolume ?? 1)
      const clock=scenePlaybackClock(scene,narrationDurations.length-1,composition.scenes.length)
      const frequencies = [[130.81,164.81,196],[110,130.81,164.81],[87.31,110,130.81],[98,123.47,146.83]][clock.musicIndex % 4]
      for (let channel = 0; channel < 2; channel++) {
        const target = mixed.getChannelData(channel), source = voice?.getChannelData(Math.min(channel, voice.numberOfChannels - 1))
        const begin = Math.round(start * 48000), end = Math.round((start + scene.durationSeconds) * 48000)
        let windowIndex=0
        for (let sample = begin; sample < end; sample++) {
          const local=sample/48000-start;while(windowIndex<voiceWindows.length&&local>=voiceWindows[windowIndex].startSeconds+voiceWindows[windowIndex].durationSeconds)windowIndex++;const timing=voiceWindows[windowIndex],inside=timing&&local>=timing.startSeconds&&local<timing.startSeconds+timing.durationSeconds
          const sourceIndex=inside&&voice?Math.max(0,(timing.sourceStartSeconds+(local-timing.startSeconds)*timing.playbackRate)*voice.sampleRate):-1,index=Math.floor(sourceIndex),fraction=sourceIndex-index
          const speech=source&&index>=0&&index<source.length?(source[index]*(1-fraction)+(source[Math.min(index+1,source.length-1)]??0)*fraction)*voiceGain:0
          const envelope = Math.max(0,Math.min(1, (clock.startSeconds+local) / 1.2, (clock.durationSeconds-clock.startSeconds-local) / 1.2))
          const music = composition.music ? frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * sample / 48000 + channel * .06), 0) / 3 * (speech ? .009 : .018) * envelope : 0
          target[sample] = speech + music
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
      const root='effectWindow' in first.segment?first.segment.effectWindow:undefined
      if(root)while(index+1<footage.length){
        const next=footage[index+1],a=last.segment,b=next.segment,wa='effectWindow' in a?a.effectWindow:undefined,wb='effectWindow' in b?b.effectWindow:undefined
        if(!wa||!wb||wa.originId!==wb.originId||wa.durationSeconds!==wb.durationSeconds||a.videoArtifactId!==b.videoArtifactId||a.playbackRate!==b.playbackRate||(a.sourceVolume??1)!==(b.sourceVolume??1)||Math.abs(next.start-first.start-span)>.000001||Math.abs(wa.startSeconds+last.duration-wb.startSeconds)>.000001||Math.abs(a.sourceStartSeconds+last.duration*a.playbackRate-b.sourceStartSeconds)>.000001)break
        span+=next.duration;last=next;index++
      }
      const segment=first.segment,input=assets.get(segment.videoArtifactId!)?.input;if(!input)throw new Error('Source audio input is unavailable.')
      const track=await input.getPrimaryAudioTrack()
      if(track){
        if(!await track.canDecode())throw new Error('The selected footage audio cannot be decoded.')
        const sourceEnd=segment.sourceStartSeconds+span*segment.playbackRate
        for await(const chunk of new AudioBufferSink(track).buffers(segment.sourceStartSeconds,sourceEnd))mixSourceAudioChunk([mixed.getChannelData(0),mixed.getChannelData(1)],chunk.buffer,chunk.timestamp,first.start,span,segment.sourceStartSeconds,segment.playbackRate,segment.sourceVolume??1)
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
      for await(const chunk of new AudioBufferSink(track).buffers(layer.sourceStartSeconds,sourceEnd))mixSourceAudioChunk([mixed.getChannelData(0),mixed.getChannelData(1)],chunk.buffer,chunk.timestamp,start,span,layer.sourceStartSeconds,layer.playbackRate,layer.volume,gainAt)
    }
    let audioPeak = 0
    for (let channel = 0; channel < 2; channel++) for (const sample of mixed.getChannelData(channel)) audioPeak = Math.max(audioPeak, Math.abs(sample))
    if (audioPeak > .94) { const gain = .94 / audioPeak; for (let channel = 0; channel < 2; channel++) { const samples = mixed.getChannelData(channel); for (let index = 0; index < samples.length; index++) samples[index] *= gain } audioPeak = .94 }
    return {mixed,narrationDurations,audioPeak}
}
