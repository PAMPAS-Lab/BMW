import {normalizeSpeech} from './speech-normalize.js'
import {paintDrawing} from './image-drawing.js'
import {decodeProjectImage} from './image-decoder.js'
import {ImageDecodeBudget} from '../image-contract.js'
import { Input, CustomSource, MP4, QTFF, WEBM, MATROSKA, MP3, WAVE, OGG, ADTS, FLAC, MPEG_TS,
  VideoSampleSink,AudioSampleSink, EncodedPacketSink, Output, StreamTarget, Mp4OutputFormat, WebMOutputFormat, Conversion, canEncodeVideo, canEncodeAudio } from 'mediabunny'
import type { InputTrack, StreamTargetChunk } from 'mediabunny'
import { LinearFrameReader, normalizeBrowserVideoColor } from './linear-frames.js'
import { assertNativeProcessingRequest, assertPreservedMediaTracks, assertProcessableVideoTracks, MEDIA_LIMITS } from '../media-contract.js'
import type { MediaInfo, MediaTrackInfo, MediaWorkerResult, MediaProcessingBridge, MediaProcessingCommand, SampledFrame,FullMediaDecode } from '../media-contract.js'

declare global { interface Window { bmwMediaProcessing: MediaProcessingBridge } }
const bridge = window.bmwMediaProcessing
let running = false
async function info(input: Input): Promise<MediaInfo> {
  const tracks = await input.getTracks()
  if (!tracks.length || tracks.length > 16) throw new Error('Media must contain 1 to 16 tracks.')
  const details: MediaTrackInfo[] = []
  for (const track of tracks) {
    const item: MediaTrackInfo = { id: track.id, type: track.type, codec: await track.getCodec(), canDecode: await track.canDecode() }
    if (track.isVideoTrack()) Object.assign(item, { width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), rotation: await track.getRotation(), startSeconds:await track.getFirstTimestamp(),endSeconds:await track.computeDuration(),canBeTransparent: await track.canBeTransparent() })
    if(track.isVideoTrack()&&item.canBeTransparent){
      const codec=await track.getCodec();item.hasAlphaData=codec!=='vp8'&&codec!=='vp9'
      if(!item.hasAlphaData)for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true}))if((packet.sideData.alphaByteLength??0)>0){item.hasAlphaData=true;break}
    }
    if (track.isAudioTrack()) Object.assign(item, { channels: await track.getNumberOfChannels(), sampleRate: await track.getSampleRate() })
    details.push(item)
  }
  return { container: (await input.getFormat()).name, contentType: await input.getMimeType(),
    durationSeconds: await input.computeDuration(), firstTimestampSeconds: await input.getFirstTimestamp(), tracks: details }
}
async function png(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  const blob = canvas instanceof OffscreenCanvas ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG frame encoding failed.')), 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}
async function write(token: string, index: number, position: number, data: Uint8Array): Promise<void> {
  for (let offset = 0; offset < data.length; offset += MEDIA_LIMITS.chunkBytes) {
    await bridge.write(token, index, position + offset, data.slice(offset, offset + MEDIA_LIMITS.chunkBytes))
  }
}
async function processMedia(command: MediaProcessingCommand): Promise<void> {
  if (running) return
  running = true
  let input: Input | undefined
  let conversion: Conversion | undefined
  try {
    const request = assertNativeProcessingRequest(command.request)
    if(request.action==='media.encode.check'){
      const videoSupported=await canEncodeVideo('avc',{width:request.width,height:request.height,frameRate:request.fps,bitrate:5_000_000}),audioSupported=await canEncodeAudio('aac',{sampleRate:48000,numberOfChannels:2,bitrate:192_000})
      bridge.reply({token:command.token,result:{kind:'encoding',info:{kind:'encoding',width:request.width,height:request.height,fps:request.fps,videoCodec:'avc',audioCodec:'aac',videoSupported,audioSupported}}});return
    }
    if(request.action==='media.image.draw'||request.action==='media.image.annotate'){
      let canvas:HTMLCanvasElement
      if(request.action==='media.image.annotate'){
        const data=new Uint8Array(command.bytes)
        for(let at=0;at<data.length;at+=MEDIA_LIMITS.chunkBytes)data.set(await bridge.read(command.token,at,Math.min(MEDIA_LIMITS.chunkBytes,data.length-at)),at)
        canvas=(await decodeProjectImage(data,new ImageDecodeBudget())).image
      }else{
        canvas=document.createElement('canvas');canvas.width=request.width;canvas.height=request.height
        if(request.background!=='none'){const context=canvas.getContext('2d')!;context.fillStyle=request.background;context.fillRect(0,0,canvas.width,canvas.height)}
      }
      paintDrawing(canvas,request.shapes)
      const bytes=await png(canvas)
      if(bytes.length>MEDIA_LIMITS.frameBytes)throw new Error('Drawing PNG exceeds the 20 MiB image limit.')
      await write(command.token,0,0,bytes)
      bridge.reply({token:command.token,result:{kind:'drawing',width:canvas.width,height:canvas.height,shapeCount:request.shapes.length}});return
    }
    if(request.action==='media.image.inspect'){
      const data=new Uint8Array(command.bytes)
      for(let at=0;at<data.length;at+=MEDIA_LIMITS.chunkBytes)data.set(await bridge.read(command.token,at,Math.min(MEDIA_LIMITS.chunkBytes,data.length-at)),at)
      const decoded=await decodeProjectImage(data,new ImageDecodeBudget())
      bridge.reply({token:command.token,result:{kind:'image',info:decoded.info}});return
    }
    // Fixed local formats only. HLS/network sources cannot access browser cookies or fetch remote segments.
    input = new Input({ formats: [MP4, QTFF, WEBM, MATROSKA, MP3, WAVE, OGG, ADTS, FLAC, MPEG_TS], source: new CustomSource({
      getSize: () => command.bytes, maxCacheSize: 8 * MEDIA_LIMITS.chunkBytes, prefetchProfile: 'none',
      read: (start, end) => {
        let offset = start
        return new ReadableStream<Uint8Array>({ async pull(controller) {
          try {
            if (offset >= end) { controller.close(); return }
            const data = await bridge.read(command.token, offset, Math.min(MEDIA_LIMITS.chunkBytes, end - offset))
            controller.enqueue(new Uint8Array(data)); offset += data.length
          } catch (error) { controller.error(error) }
        } })
      }
    }) })
    for (const track of await input.getVideoTracks()) await normalizeBrowserVideoColor(track)
    const metadata = await info(input)
    let result: MediaWorkerResult
    if(request.action==='media.speech.normalize'){const normalized=await normalizeSpeech(input);await write(command.token,0,0,normalized.data);result={kind:'speech-pcm',info:normalized.info}}
    else if (request.action === 'media.inspect') result = { kind: 'inspection', info: metadata }
    else if(request.action==='media.decode.check'){
      if(!Number.isFinite(metadata.durationSeconds)||metadata.durationSeconds<=0||metadata.durationSeconds>MEDIA_LIMITS.durationSeconds)throw new Error('Full-file decode requires finite media up to thirty minutes.')
      assertProcessableVideoTracks(metadata.tracks)
      const tracks:FullMediaDecode['tracks']=[]
      for(const track of await input.getTracks()){
        if(!track.isVideoTrack()&&!track.isAudioTrack())continue
        if(!await track.canDecode())throw new Error('A source media track cannot be decoded.')
        let sampleCount=0,startSeconds=Infinity,endSeconds=-Infinity
        const samples=track.isVideoTrack()?new VideoSampleSink(track).samples():new AudioSampleSink(track).samples()
        for await(const sample of samples){try{if(++sampleCount>(track.isVideoTrack()?120000:250000))throw new Error('Full-file decode sample budget exceeded.');startSeconds=Math.min(startSeconds,sample.timestamp);endSeconds=Math.max(endSeconds,sample.timestamp+sample.duration)}finally{sample.close()}}
        if(!sampleCount)throw new Error('Source track decoded no samples.')
        tracks.push({id:track.id,type:track.type as 'video'|'audio',codec:(await track.getCodec())!,sampleCount,startSeconds,endSeconds})
      }
      if(!tracks.length)throw new Error('Source file has no decoded audio/video tracks.')
      result={kind:'decoding',info:{kind:'decoding',completeFile:true,container:metadata.container,contentType:metadata.contentType,durationSeconds:metadata.durationSeconds,firstTimestampSeconds:metadata.firstTimestampSeconds,tracks}}
    }
    else {
      if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0 || metadata.durationSeconds > MEDIA_LIMITS.durationSeconds) throw new Error('Media processing supports finite files up to 30 minutes.')
      assertProcessableVideoTracks(metadata.tracks)
      if (request.action === 'media.frames.sample') {
        const track = await input.getPrimaryVideoTrack()
        if (!track || !(await track.canDecode())) throw new Error('No decodable video track for frame sampling.')
        const first = await track.getFirstTimestamp()
        const end = await track.computeDuration()
        if (request.timestampsSeconds.some((time) => time < first || time >= end)) throw new Error('A requested timestamp is outside the video track.')
        const scale = Math.min(1, request.maxWidth / await track.getDisplayWidth(), request.maxHeight / await track.getDisplayHeight())
        const width = Math.max(1, Math.floor(await track.getDisplayWidth() * scale))
        const height = Math.max(1, Math.floor(await track.getDisplayHeight() * scale))
        const reader = new LinearFrameReader(track, { width, height, fit: 'contain' })
        const frames: SampledFrame[] = new Array(request.timestampsSeconds.length)
        try {
          const order = request.timestampsSeconds.map((time,index)=>({time,index})).sort((a,b)=>a.time-b.time)
          for (const {time,index} of order) {
            const frame = await reader.get(time)
            if (!frame) throw new Error('Requested video frame is unavailable.')
            await write(command.token,index,0,await png(frame.canvas))
            frames[index]={outputIndex:index,requestedTimestampSeconds:time,timestampSeconds:frame.timestamp,durationSeconds:frame.duration,width,height}
          }
        } finally { await reader.close() }
        result = { kind: 'frames', frames }
      } else {
        const start = request.trimStartSeconds ?? Math.max(0, metadata.firstTimestampSeconds)
        const end = request.trimEndSeconds ?? metadata.durationSeconds
        if (start < Math.max(0, metadata.firstTimestampSeconds) || start >= end || end > metadata.durationSeconds) throw new Error('Trim range is outside the media file.')
        const videoCodec = request.outputFormat === 'mp4' ? 'avc' : 'vp9'
        const audioCodec = request.outputFormat === 'mp4' ? 'aac' : 'opus'
        const allTracks = await input.getTracks()
        for (const track of allTracks) {
          if (!track.isVideoTrack() && !track.isAudioTrack()) throw new Error('Export cannot preserve this track type; no tracks were discarded.')
          if (!(await track.canDecode())) throw new Error(`Source track ${track.id} cannot be decoded.`)
          if (track.isVideoTrack() && !(await canEncodeVideo(videoCodec, { width: request.outputWidth ?? await track.getDisplayWidth(), height: request.outputHeight ?? await track.getDisplayHeight() }))) throw new Error(`This device cannot encode ${videoCodec} at the requested dimensions.`)
          if (track.isAudioTrack() && !(await canEncodeAudio(audioCodec, { sampleRate: await track.getSampleRate(), numberOfChannels: await track.getNumberOfChannels() }))) throw new Error(`This device cannot encode ${audioCodec}; audio was not discarded.`)
        }
        const output = new Output({ format: request.outputFormat === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
          target: new StreamTarget(new WritableStream<StreamTargetChunk>({ write: (chunk) => write(command.token, 0, chunk.position, chunk.data) }), { chunked: true, chunkSize: MEDIA_LIMITS.chunkBytes }) })
        conversion = await Conversion.init({ input, output, tracks: 'all', copy: false, showWarnings: false,
          trim: { start, end }, video: { codec: videoCodec, width: request.outputWidth, height: request.outputHeight, fit: 'contain' }, audio: { codec: audioCodec } })
        assertPreservedMediaTracks(allTracks.map((track) => track.id), conversion.utilizedTracks.map((track) => track.id), conversion.discardedTracks.map((item) => item.reason), conversion.isValid)
        conversion.onProgress = (progress) => bridge.reply({ token: command.token, progress })
        await conversion.execute()
        result = { kind: 'conversion', contentType: `${metadata.tracks.some((track) => track.type === 'video') ? 'video' : 'audio'}/${request.outputFormat}`,
          range: { startSeconds: start, endSeconds: end }, tracks: conversion.utilizedTracks.map((track: InputTrack) => ({ type: track.type, codec: track.isVideoTrack() ? videoCodec : audioCodec })) }
      }
    }
    bridge.reply({ token: command.token, result })
  } catch (error) {
    await conversion?.cancel().catch(() => {})
    bridge.reply({ token: command.token, error: error instanceof Error ? error.message : String(error) })
  } finally { input?.dispose(); running = false }
}
bridge.onCommand((command) => { void processMedia(command) })
