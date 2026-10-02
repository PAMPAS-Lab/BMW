const bridge = window.bmwMedia
const video = document.querySelector('#source') as HTMLVideoElement
const canvas = document.querySelector('#output') as HTMLCanvasElement
const viewer = document.querySelector('#viewer')
const viewerTitle = document.querySelector('#viewer-title')
const viewerMeta = document.querySelector('#viewer-meta')
const viewerContent = document.querySelector('#viewer-content')
let sourceStream
let recorder
let stopRender
let startedAt

const shader = `
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var uvs = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  output.uv = uvs[index];
  return output;
}
@group(0) @binding(0) var sourceSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_external;
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(sourceTexture, sourceSampler, input.uv);
}`

async function createGpuPipeline(width, height) {
  if (!navigator.gpu) return null
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return null
  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu') as any
  const format = navigator.gpu.getPreferredCanvasFormat()
  canvas.width = width
  canvas.height = height
  context.configure({ device, format, alphaMode: 'opaque' })
  const module = device.createShaderModule({ code: shader })
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  let cancelled = false
  const render = () => {
    if (cancelled || video.readyState < 2) return
    const externalTexture = device.importExternalTexture({ source: video })
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: externalTexture }]
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }]
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    video.requestVideoFrameCallback(render)
  }
  video.requestVideoFrameCallback(render)
  return { stop: () => { cancelled = true }, stream: canvas.captureStream(), device }
}

async function start(options) {
  sourceStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: options.fps }, audio: true })
  video.srcObject = sourceStream
  await video.play()
  const width = video.videoWidth || options.width
  const height = video.videoHeight || options.height
  let outputStream = sourceStream
  let gpu = null
  try {
    gpu = await createGpuPipeline(width, height)
    if (gpu) {
      const tracks = [...gpu.stream.getVideoTracks(), ...sourceStream.getAudioTracks()]
      outputStream = new MediaStream(tracks)
      stopRender = gpu.stop
    }
  } catch (error) {
    console.error('WebGPU media pipeline unavailable', error)
  }
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || ''
  recorder = new MediaRecorder(outputStream, mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined)
  recorder.ondataavailable = async (event) => {
    if (event.data.size) bridge.chunk(await event.data.arrayBuffer())
  }
  recorder.onstop = () => {
    sourceStream?.getTracks().forEach((track) => track.stop())
    stopRender?.()
    bridge.finished({ mimeType: recorder.mimeType, durationMs: Date.now() - startedAt })
    recorder = null
    sourceStream = null
  }
  startedAt = Date.now()
  recorder.start(1000)
  bridge.state({ state: 'recording', gpu: Boolean(gpu), width, height, mimeType: recorder.mimeType })
}

bridge.onCommand((command) => {
  if (command.type === 'start' && !recorder) start(command).catch((error) => bridge.state({ state: 'error', message: error.message }))
  if (command.type === 'stop' && recorder && recorder.state !== 'inactive') recorder.stop()
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
