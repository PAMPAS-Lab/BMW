import {sceneVisuals,visualAtTime} from '../visual-segments.js'
import type {MediaComposition} from '../composition-contract.js'
import {compositionDuration} from '../composition-contract.js'
import {AudioBufferSink} from 'mediabunny'
import type {Input} from 'mediabunny'
import {mixSourceAudioChunk} from '../source-audio.js'
/** The same measured voice mix is used by Studio playback and final export. */
export async function mixCompositionAudio(composition:MediaComposition,assets:Map<string,{data:Uint8Array;input?:Input}>,audioContext:AudioContext):Promise<{mixed:AudioBuffer;narrationDurations:number[];audioPeak:number}>{
    const duration=compositionDuration(composition)
    const mixed = new AudioBuffer({ numberOfChannels: 2, length: Math.ceil(duration * 48000), sampleRate: 48000 })
    const narrationDurations: number[] = []
    let start = 0
    for (const scene of composition.scenes) {
      let voice: AudioBuffer | undefined
      if (scene.audioArtifactId) {
        const asset = assets.get(scene.audioArtifactId)
        if (!asset) throw new Error('Narration asset has no audio track.')
        voice = await audioContext.decodeAudioData(asset.data.slice().buffer as ArrayBuffer)
        if (voice.duration > scene.durationSeconds - 1) throw new Error(`Narration exceeds scene duration: ${scene.title}; speech was not truncated.`)
      }
      narrationDurations.push(voice?.duration ?? 0)
      let peak = .001
      if (voice) for (let channel = 0; channel < voice.numberOfChannels; channel++) { for (const sample of voice.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample)) }
      const voiceGain = Math.min(3, .78 / peak) * (scene.voiceVolume ?? 1)
      const frequencies = [[130.81,164.81,196],[110,130.81,164.81],[87.31,110,130.81],[98,123.47,146.83]][narrationDurations.length % 4]
      for (let channel = 0; channel < 2; channel++) {
        const target = mixed.getChannelData(channel), source = voice?.getChannelData(Math.min(channel, voice.numberOfChannels - 1))
        const begin = Math.round(start * 48000), end = Math.round((start + scene.durationSeconds) * 48000)
        for (let sample = begin; sample < end; sample++) {
          const local = sample / 48000 - start, sourceIndex = Math.round((local - .5) * 48000)
          const speech = source && sourceIndex >= 0 && sourceIndex < source.length ? source[sourceIndex] * voiceGain : 0
          const envelope = Math.min(1, local / 1.2, (scene.durationSeconds - local) / 1.2)
          const music = composition.music ? frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * sample / 48000 + channel * .06), 0) / 3 * (speech ? .009 : .018) * envelope : 0
          target[sample] = speech + music
        }
      }
      let visualStart=0
      for(const segment of sceneVisuals(scene)){
      if(segment.videoArtifactId&&segment.keepSourceAudio){
        const input=assets.get(segment.videoArtifactId)?.input;if(!input)throw new Error('Source audio input is unavailable.')
        const track=await input.getPrimaryAudioTrack()
        if(track){
          if(!await track.canDecode())throw new Error('The selected footage audio cannot be decoded.')
          const sink=new AudioBufferSink(track),sourceEnd=segment.sourceStartSeconds+segment.durationSeconds*segment.playbackRate
          for await(const chunk of sink.buffers(segment.sourceStartSeconds,sourceEnd))mixSourceAudioChunk([mixed.getChannelData(0),mixed.getChannelData(1)],chunk.buffer,chunk.timestamp,start+visualStart,segment.durationSeconds,segment.sourceStartSeconds,segment.playbackRate,segment.sourceVolume??1)
        }
      }
      visualStart+=segment.durationSeconds
      }
      start += scene.durationSeconds
    }
    let audioPeak = 0
    for (let channel = 0; channel < 2; channel++) for (const sample of mixed.getChannelData(channel)) audioPeak = Math.max(audioPeak, Math.abs(sample))
    if (audioPeak > .94) { const gain = .94 / audioPeak; for (let channel = 0; channel < 2; channel++) { const samples = mixed.getChannelData(channel); for (let index = 0; index < samples.length; index++) samples[index] *= gain } audioPeak = .94 }
    return {mixed,narrationDurations,audioPeak}
}
