import {CompositionLayerPainter} from './composition-layers-paint.js'
import {sceneVisuals,visualAtTime} from '../visual-segments.js'
import {decodeProjectImage} from './image-decoder.js'
import {ImageDecodeBudget} from '../image-contract.js'
import { Input, BlobSource, MP4, QTFF, WEBM, MATROSKA, MP3, WAVE, OGG, ADTS, FLAC, MPEG_TS, Output, StreamTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource, canEncodeVideo, canEncodeAudio } from 'mediabunny'
import type { StreamTargetChunk } from 'mediabunny'
import { assertComposition, compositionDuration, sceneAtTime,compositionImageIds } from '../composition-contract.js'
import type { CompositionBridge, CompositionCommand } from '../composition-contract.js'
import { LinearFrameReader, normalizeBrowserVideoColor } from './linear-frames.js'
import { MEDIA_LIMITS } from '../media-contract.js'
import { assertCompositionText,paintScene } from './composition-paint.js'
import { mixCompositionAudio } from './composition-audio.js'

declare global { interface Window { bmwComposition: CompositionBridge } }
const bridge = window.bmwComposition
async function bytes(command: CompositionCommand, index: number): Promise<Uint8Array> {
  const size = command.assets[index].bytes
  const data = new Uint8Array(size)
  for (let offset = 0; offset < size; offset += MEDIA_LIMITS.chunkBytes) data.set(await bridge.read(command.token, index, offset, Math.min(MEDIA_LIMITS.chunkBytes, size - offset)), offset)
  return data
}
async function write(token: string, chunk: StreamTargetChunk): Promise<void> {
  for (let offset = 0; offset < chunk.data.length; offset += MEDIA_LIMITS.chunkBytes) await bridge.write(token, chunk.position + offset, chunk.data.slice(offset, offset + MEDIA_LIMITS.chunkBytes))
}
async function compose(command: CompositionCommand): Promise<void> {
  const inputs: Input[] = []
  let output: Output | undefined
  let audioContext: AudioContext | undefined
  let layers:CompositionLayerPainter|undefined
  let reader:LinearFrameReader|undefined
  try {
    const composition = assertComposition(command.composition)
    const duration = compositionDuration(composition), fps = composition.fps
    if (!(await canEncodeVideo('avc', { width: composition.width, height: composition.height,frameRate:composition.fps,bitrate:5_000_000 })) || !(await canEncodeAudio('aac', { sampleRate: 48000, numberOfChannels: 2,bitrate:192_000 }))) throw new Error('H.264/AAC export is unavailable on this device.')
    await document.fonts.ready
    const imageBudget=new ImageDecodeBudget(),imageIds=compositionImageIds(composition)
    const assets = new Map<string, { input?: Input; data: Uint8Array; image?:HTMLCanvasElement }>()
    for (let index = 0; index < command.assets.length; index++) {
      const data = await bytes(command, index)
      if(imageIds.has(command.assets[index].artifactId)){
        const {image:canvas}=await decodeProjectImage(data,imageBudget)
        assets.set(command.assets[index].artifactId,{data,image:canvas});continue
      }
      const input = new Input({ formats: [MP4, QTFF, WEBM, MATROSKA, MP3, WAVE, OGG, ADTS, FLAC, MPEG_TS], source: new BlobSource(new Blob([data as Uint8Array<ArrayBuffer>])) })
      inputs.push(input); assets.set(command.assets[index].artifactId, { input, data })
    }
    layers=new CompositionLayerPainter(assets)
    audioContext = new AudioContext({ sampleRate: 48000 })
    const {mixed,narrationDurations,audioPeak}=await mixCompositionAudio(composition,assets,audioContext)
    const canvas = document.createElement('canvas'); canvas.width = composition.width; canvas.height = composition.height
    const context = canvas.getContext('2d', { alpha: false })!
    assertCompositionText(context,composition,narrationDurations)
    const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: 5_000_000 })
    const audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 })
    output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(new WritableStream<StreamTargetChunk>({ write: chunk => write(command.token, chunk) }), { chunked: true, chunkSize: MEDIA_LIMITS.chunkBytes }) })
    output.addVideoTrack(videoSource, { frameRate: fps }); output.addAudioTrack(audioSource)
    await output.start()
    // Interleave audio in small blocks, so encoding never buffers an entire audio track waiting for video.
    let audioOffset = 0, activeScene = -1
    const frames = Math.ceil(duration * fps)
    for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
      const time = frameIndex / fps, timing = sceneAtTime(composition, time), scene = composition.scenes[timing.index]
      const visual=visualAtTime(scene,timing.localSeconds),segment=visual?.segment??scene,visualKey=timing.index*8+(visual?.index??0)
      if (visualKey !== activeScene) {
        await reader?.close(); activeScene = visualKey; reader = undefined
        if (segment.videoArtifactId) {
          const asset = assets.get(segment.videoArtifactId), track = await asset?.input?.getPrimaryVideoTrack()
          if (!track || !(await track.canDecode())) throw new Error('Scene footage has no decodable video track.')
          await normalizeBrowserVideoColor(track)
          if ((await track.getDisplayWidth()) * (await track.getDisplayHeight()) > MEDIA_LIMITS.sourcePixels) throw new Error('Source footage exceeds decode resolution limit.')
          if (await track.canBeTransparent()) {
            // This producer deliberately rejects alpha-capable source footage.
            // Browser tab recordings are opaque; no transparent channel is discarded.
            const { EncodedPacketSink } = await import('mediabunny')
            for await (const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true})) if ((packet.sideData.alphaByteLength ?? 0) > 0) throw new Error('Transparent footage is not yet supported.')
          }
          const end = await track.computeDuration(), first = await track.getFirstTimestamp()
          if (!Number.isFinite(end) || end <= 0 || end > MEDIA_LIMITS.durationSeconds) throw new Error('Footage must be finite and at most 30 minutes.')
          if (segment.sourceStartSeconds < first || segment.sourceStartSeconds >= end) throw new Error('Scene source start is outside its footage.')
          reader = new LinearFrameReader(track, { width: 1600 })
        }
      }
      const sourceFrame = segment.imageArtifactId ? {canvas:assets.get(segment.imageArtifactId)!.image!} : reader ? await reader.get(segment.sourceStartSeconds + (visual?.localSeconds??timing.localSeconds) * segment.playbackRate) : null
      if (reader && !sourceFrame) throw new Error('Scene footage frame is unavailable.')
      context.save()
      paintScene(context, scene, sourceFrame, timing.localSeconds, scene.durationSeconds, timing.index, composition.scenes.length, narrationDurations[timing.index], composition); context.restore()
      await layers.paint(context,composition,scene,time,timing.localSeconds)
      await videoSource.add(time, Math.min(1 / fps, duration - time), { keyFrame: frameIndex % (fps * 2) === 0 })
      const audioEnd = Math.min(mixed.length, Math.ceil((time + 1 / fps) * 48000))
      if (audioEnd > audioOffset) {
        const block = new AudioBuffer({ numberOfChannels: 2, length: audioEnd - audioOffset, sampleRate: 48000 })
        for (let channel = 0; channel < 2; channel++) block.copyToChannel(mixed.getChannelData(channel).subarray(audioOffset, audioEnd), channel)
        await audioSource.add(block); audioOffset = audioEnd
      }
      if (frameIndex % fps === 0) bridge.reply({ token: command.token, progress: frameIndex / frames })
    }
    await reader?.close(); videoSource.close(); audioSource.close(); await output.finalize()
    bridge.reply({ token: command.token, result: { frames, durationSeconds: duration, width: composition.width, height: composition.height, audioPeak, narrationDurations, captions: 'explicit cues or estimated sentence timing; not word aligned', independentAudioTracks:(composition.audioTracks?.length??0)+composition.scenes.reduce((n,scene)=>n+(scene.audioTracks?.length??0),0),visualLayers:(composition.layers?.length??0)+composition.scenes.reduce((n,scene)=>n+(scene.layers?.length??0),0),sourceAudio: composition.scenes.some(scene=>sceneVisuals(scene).some(segment=>segment.keepSourceAudio))?'selected footage original audio mixed with source trim, speed and volume; no sound after source end':'footage muted; narration and original synthesized music bed mixed' } })
  } catch (error) {
    await output?.cancel().catch(() => {})
    bridge.reply({ token: command.token, error: error instanceof Error ? error.message : String(error) })
  } finally { await reader?.close();await layers?.dispose();inputs.forEach(input => input.dispose()); await audioContext?.close() }
}
bridge.onCommand(command => { void compose(command) })
