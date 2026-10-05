import {Output,AppendOnlyStreamTarget,WebMOutputFormat,CanvasSource,MediaStreamAudioTrackSource,canEncodeVideo} from 'mediabunny'

const bridge = window.bmwMedia
const video = document.querySelector('#source') as HTMLVideoElement
const viewer = document.querySelector('#viewer')
const viewerTitle = document.querySelector('#viewer-title')
const viewerMeta = document.querySelector('#viewer-meta')
const viewerContent = document.querySelector('#viewer-content')
let capture: {stop:()=>Promise<void>} | undefined
let starting=false
let pendingStop=false

// Capture the pixels inside the source-frame callback. A later timer must never
// pair newly presented pixels with an earlier callback's capture timestamp.
async function start(options:{fps?:number;width?:number;height?:number}) {
  const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:options.fps,max:options.fps}},audio:true})
  let output:Output|undefined,frameHandle:number|undefined,timer:ReturnType<typeof setTimeout>|undefined
  let stopping=false,tail:Promise<void>=Promise.resolve(),startedAt=0,sourceEpochMs:number|undefined
  let errorMessage:string|undefined
  const frameClock:{sourceEpochMs:number;outputSeconds:number}[]=[],pendingFrames=new Map<number,number>()
  let frameClockTruncated=false
  const surface=new OffscreenCanvas(1,1),context=surface.getContext('2d',{alpha:false})!
  const cleanup=()=>{
    if(timer!==undefined)clearTimeout(timer)
    if(frameHandle!==undefined)video.cancelVideoFrameCallback(frameHandle)
    stream.getTracks().forEach(track=>track.stop());video.srcObject=null;surface.width=0;surface.height=0
  }
  try {
    const fps=options.fps??24
    let width=0,height=0,firstFrameResolve:()=>void
    const firstFrame=new Promise<void>(resolve=>{firstFrameResolve=resolve})
    const observe=()=>{frameHandle=video.requestVideoFrameCallback((_now,metadata)=>{
      if(stopping)return
      if(!width){width=video.videoWidth||metadata.width;height=video.videoHeight||metadata.height;surface.width=width;surface.height=height}
      context.drawImage(video,0,0,width,height)
      sourceEpochMs=typeof metadata.captureTime==='number'&&Number.isFinite(metadata.captureTime)?performance.timeOrigin+metadata.captureTime:undefined
      firstFrameResolve();observe()
    })}
    // Install before play: static pages can present their only initial frame here.
    video.srcObject=stream;observe();await video.play()
    let firstFrameTimer:ReturnType<typeof setTimeout>
    try{await Promise.race([firstFrame,new Promise<never>((_resolve,reject)=>{firstFrameTimer=setTimeout(()=>reject(new Error('Recording source did not present a frame.')),5000)})])}finally{clearTimeout(firstFrameTimer!)}
    if(!width||!height||!Number.isFinite(fps)||fps<1||fps>60)throw new Error('Invalid recording dimensions or frame rate.')
    const codec=await canEncodeVideo('vp9',{width,height,frameRate:fps,bitrate:4_000_000})?'vp9':'vp8'
    if(!(await canEncodeVideo(codec,{width,height,frameRate:fps,bitrate:4_000_000})))throw new Error('Native recording encoder unavailable.')
    output=new Output({format:new WebMOutputFormat({appendOnly:true}),target:new AppendOnlyStreamTarget(new WritableStream<Uint8Array>({write(data){
      for(let offset=0;offset<data.byteLength;offset+=1024*1024)bridge.chunk(data.slice(offset,offset+1024*1024).buffer)
    }}))})
    const encoded=new CanvasSource(surface,{codec,bitrate:4_000_000,latencyMode:'realtime',onEncodedPacket(packet){
      const key=Math.round(packet.timestamp*1e6),epoch=pendingFrames.get(key);pendingFrames.delete(key)
      if(epoch===undefined||frameClock.at(-1)?.sourceEpochMs===epoch)return
      if(frameClock.length>=5000){frameClockTruncated=true;return}
      frameClock.push({sourceEpochMs:epoch,outputSeconds:packet.timestamp})
    }})
    output.addVideoTrack(encoded,{frameRate:fps})
    const audioTrack=stream.getAudioTracks()[0]
    let audio:MediaStreamAudioTrackSource|undefined,audioOffset:number|undefined
    if(audioTrack){audio=new MediaStreamAudioTrackSource(audioTrack,{codec:'opus',bitrate:128_000,transform:{process(sample){
      audioOffset??=(performance.timeOrigin+performance.now()-startedAt)/1000-sample.timestamp
      sample.setTimestamp(Math.max(0,sample.timestamp+audioOffset));return sample
    }}});output.addAudioTrack(audio)}
    startedAt=performance.timeOrigin+performance.now()
    await output.start()
    let lastTimestamp=-1
    const tick=async()=>{
      if(stopping)return
      const timestamp=(performance.timeOrigin+performance.now()-startedAt)/1000
      if(timestamp>lastTimestamp){
        lastTimestamp=timestamp
        // Bound pending encoder evidence; apply backpressure instead of silently
        // dropping frames or assigning wall-clock estimates a measured label.
        if(pendingFrames.size>=16)throw new Error('Recording encoder clock budget exceeded.')
        const key=Math.round(timestamp*1e6)
        if(sourceEpochMs!==undefined)pendingFrames.set(key,sourceEpochMs)
        await encoded.add(timestamp,1/fps)
      }
      if(!stopping)timer=setTimeout(schedule,1000/fps)
    }
    const schedule=()=>{tail=tick().catch(error=>{errorMessage=error instanceof Error?error.message:String(error);void stop()})}
    let stopPromise:Promise<void>|undefined
    const stop=():Promise<void>=>{
      if(stopPromise)return stopPromise
      stopping=true;if(timer!==undefined)clearTimeout(timer)
      const durationMs=performance.timeOrigin+performance.now()-startedAt
      stopPromise=(async()=>{
        try{await tail;await output!.finalize()}catch(error){errorMessage??=error instanceof Error?error.message:String(error);await output!.cancel().catch(()=>{})}
        finally{cleanup();capture=undefined;bridge.finished({frameClock,frameClockTruncated,mimeType:'video/webm',durationMs,...(errorMessage?{error:errorMessage}:{})})}
      })()
      return stopPromise
    }
    if(audio)void audio.errorPromise.catch(error=>{errorMessage=error instanceof Error?error.message:String(error);void stop()})
    capture={stop};stream.getVideoTracks()[0]?.addEventListener('ended',()=>{void stop()},{once:true})
    schedule()
    bridge.state({state:'recording',clock:{startedEpochMs:startedAt,width,height},gpu:false,width,height,mimeType:'video/webm'})
    if(pendingStop)void stop()
  }catch(error){cleanup();await output?.cancel().catch(()=>{});throw error}
}

bridge.onCommand((command) => {
  if(command.type==='start'&&!capture&&!starting){starting=true;pendingStop=false;void start(command).catch(error=>bridge.state({state:'error',message:error.message})).finally(()=>{starting=false})}
  if(command.type==='stop'){if(capture)void capture.stop();else if(starting)pendingStop=true}
  if (command.type === 'compare') compareImages(command)
    .then((result) => bridge.comparison({ requestId: command.requestId, result }))
    .catch((error) => bridge.comparison({ requestId: command.requestId, error: error.message }))
  if (command.type === 'view') showArtifact(command)
})

function showArtifact(command) {
  viewer.classList.remove('hidden')
  viewerTitle.textContent = command.title || command.filename || 'BMW Media'
  viewerMeta.textContent = command.filename || command.mimeType || ''
  let content
  if (command.text) {
    content = document.createElement('pre')
    if (command.mimeType === 'application/json') {
      try { content.textContent = JSON.stringify(JSON.parse(command.text), null, 2) } catch { content.textContent = command.text }
    } else content.textContent = command.text
  } else if (command.mimeType?.startsWith('image/')) {
    content = document.createElement('img')
    content.alt = command.filename || 'BMW media'
    content.src = command.dataUrl
  } else if (command.mimeType?.startsWith('video/')) {
    content = document.createElement('video')
    content.controls = true
    content.autoplay = true
    content.src = command.dataUrl
  } else if (command.mimeType?.startsWith('audio/')) {
    content = document.createElement('audio')
    content.controls = true
    content.autoplay = true
    content.src = command.dataUrl
  } else {
    content = document.createElement('pre')
    content.textContent = `BMW cannot preview ${command.mimeType || 'this file type'} yet.`
  }
  viewerContent.replaceChildren(content)
}

async function imagePixels(dataUrl, targetSize?: { width?: number; height?: number }) {
  const blob = await (await fetch(dataUrl)).blob()
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
  const width = targetSize?.width || Math.max(1, Math.round(bitmap.width * scale))
  const height = targetSize?.height || Math.max(1, Math.round(bitmap.height * scale))
  const surface = new OffscreenCanvas(width, height)
  const context = surface.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return { width, height, pixels: context.getImageData(0, 0, width, height).data }
}

async function gpuDifference(left, right) {
  if (!navigator.gpu) return null
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return null
  const device = await adapter.requestDevice()
  const leftValues = new Uint32Array(left.pixels)
  const rightValues = new Uint32Array(right.pixels)
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const leftBuffer = device.createBuffer({ size: leftValues.byteLength, usage })
  const rightBuffer = device.createBuffer({ size: rightValues.byteLength, usage })
  device.queue.writeBuffer(leftBuffer, 0, leftValues)
  device.queue.writeBuffer(rightBuffer, 0, rightValues)
  const output = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
  const readback = device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const module = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read> left: array<u32>;
    @group(0) @binding(1) var<storage, read> right: array<u32>;
    @group(0) @binding(2) var<storage, read_write> result: array<atomic<u32>, 2>;
    @compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let index = id.x;
      if (index >= arrayLength(&left)) { return; }
      let a = left[index];
      let b = right[index];
      if (a != b) { atomicAdd(&result[0], 1u); }
      atomicAdd(&result[1], select(b - a, a - b, a >= b));
    }
  ` })
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: leftBuffer } },
      { binding: 1, resource: { buffer: rightBuffer } },
      { binding: 2, resource: { buffer: output } }
    ]
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(Math.ceil(leftValues.length / 256))
  pass.end()
  encoder.copyBufferToBuffer(output, 0, readback, 0, 8)
  device.queue.submit([encoder.finish()])
  await readback.mapAsync(GPUMapMode.READ)
  const values = new Uint32Array(readback.getMappedRange().slice(0))
  readback.unmap()
  return { changedChannels: values[0], absoluteDifference: values[1], gpuProcessed: true }
}

function cpuDifference(left, right) {
  let changedChannels = 0
  let absoluteDifference = 0
  for (let index = 0; index < left.pixels.length; index += 1) {
    const difference = Math.abs(left.pixels[index] - right.pixels[index])
    if (difference) changedChannels += 1
    absoluteDifference += difference
  }
  return { changedChannels, absoluteDifference, gpuProcessed: false }
}

async function compareImages(command) {
  const baseline = await imagePixels(command.baseline)
  const current = await imagePixels(command.current, baseline)
  const difference = await gpuDifference(baseline, current).catch(() => null) || cpuDifference(baseline, current)
  const channels = baseline.pixels.length
  return {
    width: baseline.width,
    height: baseline.height,
    changedChannelRatio: difference.changedChannels / channels,
    differenceRatio: difference.absoluteDifference / (channels * 255),
    ...difference
  }
}
