import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { BrowserWindow } from 'electron'
import { DATA_URL_BASE64_MARKER, MAX_CAPTURE_BYTES, safeCaptureFilename } from './capture-policy.js'

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const ARTIFACT_MIME_TYPES = Object.freeze({
  '.json': 'application/json', '.txt': 'text/plain', '.log': 'text/plain', '.md': 'text/markdown',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg'
})

export class MediaController {
  [key: string]: any

  constructor({ session, preloadPath, pagePath, artifactsDirectory, resolveArtifactsDirectory, onStatus }) {
    this.session = session
    this.preloadPath = preloadPath
    this.pagePath = pagePath
    this.artifactsDirectory = artifactsDirectory
    this.resolveArtifactsDirectory = resolveArtifactsDirectory
    this.onStatus = onStatus
    this.window = null
    this.target = null
    this.file = null
    this.stream = null
    this.metadata = null
    this.elementCapture = null
    this.comparisons = new Map()
  }

  configureDisplayMedia() {
    this.session.setDisplayMediaRequestHandler((_request, callback) => {
      if (!this.target) {
        callback({})
        return
      }
      callback({
        video: this.target.view.webContents.mainFrame,
        audio: this.target.view.webContents.mainFrame,
        enableLocalEcho: true
      })
    })
  }

  isCaptureActive(): boolean {
    return Boolean(this.file || this.elementCapture)
  }

  projectArtifactPath(filename) {
    const name = path.basename(String(filename || ''))
    if (!name || name !== filename || name === '.' || name === '..') throw new Error('Invalid BMW media artifact name.')
    const directory = this.resolveArtifactsDirectory?.() || this.artifactsDirectory
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    return path.join(directory, name)
  }

  saveProjectArtifact(filename, bytes) {
    const filePath = this.projectArtifactPath(filename)
    fs.writeFileSync(filePath, Buffer.from(bytes), { mode: 0o600 })
    return { artifactId: path.basename(filePath), path: filePath, bytes: fs.statSync(filePath).size }
  }

  hasProjectArtifact(filename) {
    return fs.existsSync(this.projectArtifactPath(filename))
  }

  readProjectArtifact(filename) {
    return fs.readFileSync(this.projectArtifactPath(filename))
  }

  async #ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return
    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    await this.window.loadFile(this.pagePath)
  }

  async start(tab, request: { fps?: number; width?: number; height?: number } = {}) {
    if (this.file || this.elementCapture) throw new Error('A recording is already active')
    await this.#ensureWindow()
    this.window.hide()
    const artifactsDirectory = this.resolveArtifactsDirectory?.(tab) || this.artifactsDirectory
    fs.mkdirSync(artifactsDirectory, { recursive: true })
    this.target = tab
    const id = `recording-${Date.now()}`
    const filePath = path.join(artifactsDirectory, `${id}.webm`)
    this.file = filePath
    this.stream = fs.createWriteStream(filePath, { mode: 0o600 })
    this.metadata = { id, filePath, startedAt: Date.now(), tabId: tab.id, gpu: null }
    this.onStatus?.({ active: true, ...this.metadata })
    this.window.webContents.send('media-command', {
      type: 'start',
      fps: Math.min(Math.max(Number(request.fps) || 24, 1), 60),
      width: Number(request.width) || 1280,
      height: Number(request.height) || 720
    })
    return { recordingId: id, state: 'starting', tabId: tab.id }
  }

  acceptChunk(chunk) {
    if (!this.stream) return
    this.stream.write(Buffer.from(chunk))
  }

  updateState(state) {
    if (this.metadata && typeof state.gpu === 'boolean') this.metadata.gpu = state.gpu
    this.onStatus?.({ active: Boolean(this.file), ...this.metadata, ...state })
  }

  async stop() {
    if (this.elementCapture) {
      const capture = this.elementCapture
      await capture.webContents.executeJavaScript(`globalThis[${JSON.stringify(capture.key)}]?.stop('requested')`, true).catch(() => {})
      return { recordingId: capture.id, state: 'stopping' }
    }
    if (!this.file) return { state: 'idle' }
    this.window.webContents.send('media-command', { type: 'stop' })
    return { recordingId: this.metadata.id, state: 'stopping' }
  }

  finalize(summary = {}) {
    if (!this.stream || !this.file) return null
    const stream = this.stream
    const result = {
      artifactId: path.basename(this.file),
      type: 'recording',
      path: this.file,
      durationMs: Date.now() - this.metadata.startedAt,
      gpuProcessed: this.metadata.gpu,
      ...summary
    }
    stream.end()
    this.stream = null
    this.file = null
    this.target = null
    this.onStatus?.({ active: false, ...result })
    return result
  }

  async captureVideo(tab, request: {
    selector?: unknown
    index?: unknown
    filename?: unknown
    fromStart?: unknown
    maxDurationMs?: unknown
  } = {}) {
    if (this.file || this.elementCapture) throw new Error('A recording is already active')
    const selector = String(request.selector || '').trim()
    if (!selector) throw new Error('media.video.capture requires a video or content-card selector.')
    const index = Math.max(0, Math.floor(Number(request.index) || 0))
    const fromStart = request.fromStart !== false
    const maxDurationMs = Math.min(Math.max(Math.floor(Number(request.maxDurationMs) || 15 * 60_000), 1_000), 30 * 60_000)
    const artifactsDirectory = this.resolveArtifactsDirectory?.(tab) || this.artifactsDirectory
    fs.mkdirSync(artifactsDirectory, { recursive: true, mode: 0o700 })
    const filename = `${Date.now()}-${safeCaptureFilename(request.filename)}`
    const filePath = path.join(artifactsDirectory, filename)
    const id = `video-capture-${Date.now()}`
    const key = `__bmwVideoCapture_${crypto.randomUUID().replaceAll('-', '')}`
    const webContents = tab.view.webContents
    const stream = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
    this.elementCapture = { id, key, webContents, filePath }
    this.onStatus?.({ active: true, id, filePath, tabId: tab.id, state: 'starting', kind: 'video-element' })

    let bytes = 0
    let initialization: Record<string, unknown> | null = null
    let stopReason = 'unknown'
    const startedAt = Date.now()
    try {
      initialization = await webContents.executeJavaScript(`(async () => {
        const key = ${JSON.stringify(key)}
        if (globalThis[key]) throw new Error('BMW video capture state already exists.')
        const selector = ${JSON.stringify(selector)}
        const index = ${JSON.stringify(index)}
        const roots = Array.from(document.querySelectorAll(selector))
        const root = roots[index]
        if (!root) return { ok: false, reason: 'No element matched the capture selector and index.', matches: roots.length }
        const video = root instanceof HTMLVideoElement ? root : root.querySelector('video')
        if (!video) return { ok: false, reason: 'The selected element does not contain an HTML video element.', matches: roots.length }
        const captureStream = video.captureStream || video.mozCaptureStream
        if (typeof captureStream !== 'function') return { ok: false, reason: 'HTMLMediaElement.captureStream is unavailable in this Chromium build.' }
        const initial = {
          currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
          paused: video.paused,
          loop: video.loop,
          playbackRate: video.playbackRate
        }
        const state = {
          ready: Object.create(null), nextSequence: 0, nextPull: 0,
          pending: 0, done: false, error: '', reason: '', recorder: null,
          timer: 0, endedListener: null, initial, video
        }
        const restore = () => {
          clearTimeout(state.timer)
          if (state.endedListener) video.removeEventListener('ended', state.endedListener)
          video.loop = initial.loop
          video.playbackRate = initial.playbackRate
          try { if (Number.isFinite(initial.currentTime)) video.currentTime = initial.currentTime } catch {}
          if (initial.paused) video.pause()
          delete globalThis[key]
        }
        const stop = (reason = 'requested') => {
          if (state.done || !state.recorder || state.recorder.state === 'inactive') return false
          state.reason = reason
          state.recorder.stop()
          return true
        }
        const pull = () => {
          const chunks = []
          while (Object.hasOwn(state.ready, state.nextPull)) {
            chunks.push(state.ready[state.nextPull])
            delete state.ready[state.nextPull]
            state.nextPull += 1
          }
          return { chunks, pending: state.pending, done: state.done, error: state.error, reason: state.reason }
        }
        globalThis[key] = { stop, pull, restore }
        try {
          video.loop = false
          video.playbackRate = 1
          if (${JSON.stringify(fromStart)} && Number.isFinite(video.duration) && video.duration > 0 && video.currentTime > 0.05) {
            video.currentTime = 0
            await Promise.race([
              new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true })),
              new Promise((resolve) => setTimeout(resolve, 3000))
            ])
          }
          const mediaStream = captureStream.call(video)
          const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
          const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || ''
          const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined)
          state.recorder = recorder
          recorder.ondataavailable = (event) => {
            if (!event.data.size) return
            const sequence = state.nextSequence++
            state.pending += 1
            const reader = new FileReader()
            reader.onloadend = () => {
              const value = String(reader.result || '')
              const marker = ${JSON.stringify(DATA_URL_BASE64_MARKER)}
              const markerIndex = value.indexOf(marker)
              if (markerIndex < 0) state.error = 'Captured video chunk was not encoded as a Base64 Data URL.'
              else state.ready[sequence] = value.slice(markerIndex + marker.length)
              state.pending -= 1
            }
            reader.onerror = () => {
              state.error = reader.error?.message || 'Failed to encode a captured video chunk.'
              state.pending -= 1
            }
            reader.readAsDataURL(event.data)
          }
          recorder.onerror = (event) => {
            state.error = event.error?.message || 'Browser MediaRecorder failed.'
            state.reason = 'error'
          }
          recorder.onstop = () => { state.done = true }
          state.endedListener = () => stop('ended')
          video.addEventListener('ended', state.endedListener, { once: true })
          state.timer = setTimeout(() => stop('maximum-duration'), ${JSON.stringify(maxDurationMs)})
          recorder.start(1000)
          await video.play()
          return {
            ok: true, matches: roots.length, selectedIndex: index,
            mimeType: recorder.mimeType || mimeType || 'video/webm',
            duration: Number.isFinite(video.duration) ? video.duration : null,
            videoTracks: mediaStream.getVideoTracks().length,
            audioTracks: mediaStream.getAudioTracks().length,
            muted: video.muted
          }
        } catch (error) {
          state.error = error instanceof Error ? error.message : String(error)
          state.reason = 'initialization-error'
          state.done = true
          return { ok: false, reason: state.error, matches: roots.length }
        }
      })()`, true)
      if (!initialization?.ok) throw new Error(String(initialization?.reason || 'Browser video capture could not start.'))
      this.onStatus?.({ active: true, id, filePath, tabId: tab.id, state: 'recording', kind: 'video-element', ...initialization })

      while (true) {
        await delay(500)
        const packet = await webContents.executeJavaScript(`globalThis[${JSON.stringify(key)}]?.pull()`, true)
        if (!packet) throw new Error('The page navigated or removed the BMW video capture state.')
        for (const encoded of packet.chunks || []) {
          const chunk = Buffer.from(String(encoded), 'base64')
          bytes += chunk.length
          if (bytes > MAX_CAPTURE_BYTES) {
            await webContents.executeJavaScript(`globalThis[${JSON.stringify(key)}]?.stop('size-limit')`, true).catch(() => {})
            throw new Error(`Captured video exceeds the BMW limit of ${MAX_CAPTURE_BYTES} bytes.`)
          }
          if (!stream.write(chunk)) await once(stream, 'drain')
        }
        if (packet.error) throw new Error(String(packet.error))
        stopReason = String(packet.reason || stopReason)
        if (packet.done && Number(packet.pending || 0) === 0 && !(packet.chunks || []).length) break
      }
      stream.end()
      await once(stream, 'finish')
      if (bytes < 1_024) throw new Error('Browser video capture produced an empty or invalid recording.')
      const header = Buffer.alloc(4)
      const descriptor = fs.openSync(filePath, 'r')
      try { fs.readSync(descriptor, header, 0, header.length, 0) } finally { fs.closeSync(descriptor) }
      if (!header.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
        throw new Error('Browser video capture did not produce a valid WebM/EBML header.')
      }
      return {
        artifactId: path.basename(filePath),
        type: 'video',
        contentType: String(initialization.mimeType || 'video/webm'),
        bytes,
        path: filePath,
        durationMs: Date.now() - startedAt,
        sourceDurationSeconds: initialization.duration,
        videoTracks: initialization.videoTracks,
        audioTracks: initialization.audioTracks,
        complete: stopReason === 'ended',
        stopReason,
        tab: { id: tab.id, title: tab.title, url: tab.url }
      }
    } catch (error) {
      stream.destroy()
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      throw error
    } finally {
      await webContents.executeJavaScript(`globalThis[${JSON.stringify(key)}]?.restore()`, true).catch(() => {})
      this.elementCapture = null
      this.onStatus?.({ active: false, id, filePath, tabId: tab.id, state: 'idle', kind: 'video-element' })
    }
  }

  async compareImages(baselinePng, currentPng) {
    await this.#ensureWindow()
    const requestId = crypto.randomUUID()
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.comparisons.delete(requestId)
        reject(new Error('BMW visual comparison timed out.'))
      }, 30_000)
      timer.unref?.()
      this.comparisons.set(requestId, { resolve, reject, timer })
    })
    this.window.webContents.send('media-command', {
      type: 'compare', requestId,
      baseline: `data:image/png;base64,${Buffer.from(baselinePng).toString('base64')}`,
      current: `data:image/png;base64,${Buffer.from(currentPng).toString('base64')}`
    })
    return result
  }

  async showArtifact(filePath, { title = 'BMW Media' } = {}) {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw new Error('BMW media viewer requires a file.')
    if (stat.size > 50_000_000) throw new Error('BMW media viewer supports evidence up to 50 MB.')
    await this.#ensureWindow()
    const mimeType = ARTIFACT_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    const bytes = fs.readFileSync(filePath)
    this.window.setTitle(title)
    this.window.setSize(960, 720)
    this.window.webContents.send('media-command', {
      type: 'view',
      title,
      filename: path.basename(filePath),
      mimeType,
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
      text: /^(?:application\/json|text\/)/.test(mimeType) ? bytes.toString('utf8') : ''
    })
    this.window.show()
    this.window.focus()
    return { opened: true, filename: path.basename(filePath), mimeType, bytes: stat.size }
  }

  acceptComparison(value) {
    const pending = this.comparisons.get(value?.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.comparisons.delete(value.requestId)
    if (value.error) pending.reject(new Error(value.error))
    else pending.resolve(value.result)
  }
}
