import {SpeechProcessor} from './speech-processor.js'
import {VideoElementCapture} from './video-element-capture.js'
import type {SourceCaptureGuard} from './source-contract.js'
import type {WebContents} from 'electron'
import {recordingEvents,assertRecordingFrameClock,RECORDING_EVENT_BYTES} from './recording-contract.js'
import type {RecordingClock,RecordingEventSource} from './recording-contract.js'
import {exportProjectText} from './text-export.js'
import type {NativeMediaPort} from './media-port.js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { BrowserWindow } from 'electron'
import { assertMediaInfo,assertNativeProcessingRequest, mediaRecord } from './media-contract.js'
import { NarrationProcessor } from './narration-processor.js'
import { CompositionProcessor } from './composition-processor.js'
import { MediaProcessor, CoverProcessor } from './media-processor.js'
import { MAX_CAPTURE_BYTES, isOwnedCaptureMessage } from './capture-policy.js'

const ARTIFACT_MIME_TYPES = Object.freeze({
  '.json': 'application/json', '.txt': 'text/plain', '.log': 'text/plain', '.md': 'text/markdown',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg'
})

export class MediaController implements NativeMediaPort {
  [key: string]: any
  private eventSource?:RecordingEventSource
  private recordingClock?:RecordingClock
  private recordingBytes=0
  private recordingDiscard=false
  private recordingStopReason='requested'
  private recordingTimer?:NodeJS.Timeout
  private captureFailure?:Error
  private finalizing?:Promise<unknown>
  private recordingCompletion?:Promise<unknown>
  private resolveRecording?:(result:unknown)=>void
  private rejectRecording?:(error:unknown)=>void
  private captureStreamError=(error:Error):void=>{this.captureFailure=error;void this.stop().catch(()=>{})}
  private coverProcessor: CoverProcessor
  private processor: MediaProcessor
  private composer: CompositionProcessor
  private speechProcessor:SpeechProcessor
  private narrator: NarrationProcessor

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
    this.narrator = new NarrationProcessor({ onStatus, pagePath: path.join(path.dirname(pagePath), 'narration.html'), preloadPath: path.join(path.dirname(preloadPath), 'narration-preload.cjs') })
    this.composer = new CompositionProcessor({ session, onStatus, pagePath: path.join(path.dirname(pagePath), 'composition.html'), preloadPath: path.join(path.dirname(preloadPath), 'composition-preload.cjs') })
    this.coverProcessor = new CoverProcessor({session,onStatus,pagePath:path.join(path.dirname(pagePath),'processing.cover.html'),preloadPath:path.join(path.dirname(preloadPath),'processing-preload.cjs')})
    this.processor = new MediaProcessor({ session, onStatus,
      pagePath: path.join(path.dirname(pagePath), 'processing.html'),
      preloadPath: path.join(path.dirname(preloadPath), 'processing-preload.cjs') })
    this.speechProcessor=new SpeechProcessor({onStatus,normalize:(raw,directory,signal)=>this.processor.process(raw,directory,signal)})
  }

  ownsCaptureSender(event:{sender:unknown;senderFrame:unknown}):boolean { return isOwnedCaptureMessage(event,this.window) }

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
    return Boolean(this.file || this.elementCapture || this.processor.busy || this.composer.busy || this.narrator.busy || this.coverProcessor.busy || this.speechProcessor.busy)
  }

  async narrate(raw: unknown, signal?: AbortSignal) {
    if (this.isCaptureActive()) throw new Error('Finish the current media job before narration.')
    const directory = this.resolveArtifactsDirectory?.() || this.artifactsDirectory
    const result = await this.narrator.narrate(raw, directory, signal)
    try {
      const inspection = assertMediaInfo(await this.processor.process({ action: 'media.inspect', artifactId: result.artifactId }, directory, signal))
      if (!('durationSeconds' in inspection) || !inspection.tracks.some(track => track.type === 'audio' && track.canDecode) || inspection.durationSeconds <= 0 || inspection.durationSeconds > 180) throw new Error('Narration returned no valid decodable speech track.')
      return { ...result, durationSeconds: inspection.durationSeconds }
    } catch (error) { await fs.promises.rm(result.path, {force:true}); throw error }
  }

  async compose(raw: unknown, signal?: AbortSignal) {
    if (this.isCaptureActive()) throw new Error('Finish the current recording or processing job before composing.')
    const directory = this.resolveArtifactsDirectory?.() || this.artifactsDirectory
    const result = await this.composer.compose(raw, directory, signal)
    try {
      const inspection = assertMediaInfo(await this.processor.process({ action: 'media.inspect', artifactId: result.artifactId }, directory, signal))
      if (!('durationSeconds' in inspection) || Math.abs(inspection.durationSeconds - result.durationSeconds) > .2 || inspection.tracks.filter(track => track.type === 'video' && track.codec === 'avc').length !== 1 || inspection.tracks.filter(track => track.type === 'audio' && track.codec === 'aac').length !== 1) throw new Error('Composed file failed actual duration/track verification.')
      const video=inspection.tracks.find(track=>track.type==='video'),audio=inspection.tracks.find(track=>track.type==='audio')
      if(video?.width!==result.composition.width||video.height!==result.composition.height||!video.canDecode||!audio?.canDecode||audio.sampleRate!==48000||audio.channels!==2)throw new Error('Composed file failed actual size/audio/decode verification.')
      const verification={status:'passed',artifactId:result.artifactId,expectedDurationSeconds:result.durationSeconds,actualDurationSeconds:inspection.durationSeconds,width:video.width,height:video.height,fps:result.composition.fps,tracks:inspection.tracks,frames:mediaRecord(result).frames,audioPeak:mediaRecord(result).audioPeak,narrationDurations:mediaRecord(result).narrationDurations}
      const report=await exportProjectText(directory,'json',JSON.stringify(verification,null,2)+'\n',signal)
      return { ...result, actualDurationSeconds: inspection.durationSeconds, tracks: inspection.tracks,verification,verificationArtifactId:report.artifactId }
    } catch (error) { await fs.promises.rm(result.path, { force: true }); throw error }
  }

  async processArtifact(raw: unknown, signal?: AbortSignal) {
    if(mediaRecord(raw).action==='media.speech.align'){if(this.isCaptureActive())throw new Error('Finish the current media job before speech alignment.');const directory=this.resolveArtifactsDirectory?.()||this.artifactsDirectory;return this.speechProcessor.align(raw,directory,signal)}
    if(mediaRecord(raw).action==='media.speech.normalize')throw new Error('Speech normalization is private to its owning alignment job.')
    if(mediaRecord(raw).action==='video.cover'){
      if(this.isCaptureActive())throw new Error('Finish the current media job before generating a cover.')
      const directory=this.resolveArtifactsDirectory?.()||this.artifactsDirectory
      const result=await this.coverProcessor.render(raw,directory,signal)
      try{
        const info=await this.processor.process({action:'media.image.inspect',artifactId:result.artifactId},directory,signal)
        if(!('width' in info)||info.width!==result.width||info.height!==result.height)throw new Error('Cover failed actual image verification.')
        signal?.throwIfAborted();return result
      }catch(error){await fs.promises.rm(result.path,{force:true});throw error}
    }
    const request = assertNativeProcessingRequest(raw)
    const directory = this.resolveArtifactsDirectory?.() || this.artifactsDirectory
    const result = await this.processor.process(request, directory, signal)
    if((request.action==='media.image.draw'||request.action==='media.image.annotate')&&'artifactId' in result&&'width' in result){
      try{
        const info=await this.processor.process({action:'media.image.inspect',artifactId:result.artifactId},directory,signal)
        if(!('width' in info)||info.width!==result.width||info.height!==result.height)throw new Error('Drawing failed actual image verification.')
        return result
      }catch(error){await fs.promises.rm(result.path,{force:true});throw error}
    }
    if (request.action !== 'media.convert' || !('artifactId' in result)||!('tracks' in result)||!('range' in result)) return result
    // Encoder priming/padding and frame boundaries can affect the actual duration.
    // Reparse the finalized container before exposing it as a completed export.
    try {
      const inspection = assertMediaInfo(await this.processor.process({ action: 'media.inspect', artifactId: result.artifactId }, directory, signal))
      if (!('durationSeconds' in inspection)) throw new Error('Export metadata verification failed.')
      const trackKeys = (tracks: readonly { type: string; codec: string | null }[]) => tracks.map((track) => `${track.type}:${track.codec}`).sort().join(',')
      if (trackKeys(inspection.tracks) !== trackKeys(result.tracks)) throw new Error('Exported file did not preserve its declared tracks.')
      const { range, ...artifact } = result
      return { ...artifact, requestedSourceRange: range, durationSeconds: inspection.durationSeconds,
        firstTimestampSeconds: inspection.firstTimestampSeconds, tracks: inspection.tracks }
    } catch (error) {
      await fs.promises.rm(result.path, { force: true })
      throw error
    }
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
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    await this.window.loadFile(this.pagePath)
  }

  async start(tab, request: { fps?: number; width?: number; height?: number } = {}, eventSource?:RecordingEventSource,signal?:AbortSignal) {
    signal?.throwIfAborted()
    if (this.isCaptureActive()) throw new Error('A media job is already active')
    // A fresh capture renderer prevents old WebGPU canvas/device and stopped streams
    // leaking into a subsequent tab recording.
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
    await this.#ensureWindow()
    signal?.throwIfAborted()
    this.window.hide()
    const artifactsDirectory = this.resolveArtifactsDirectory?.(tab) || this.artifactsDirectory
    fs.mkdirSync(artifactsDirectory, { recursive: true })
    if(fs.realpathSync(artifactsDirectory)!==path.resolve(artifactsDirectory)||fs.lstatSync(artifactsDirectory).isSymbolicLink())throw new Error('Recording artifacts must stay inside their Project.')
    this.target = tab
    const id = `recording-${crypto.randomUUID()}`
    this.recordingCompletion=new Promise<unknown>((resolve,reject)=>{this.resolveRecording=resolve;this.rejectRecording=reject});void this.recordingCompletion.catch(()=>{})
    this.eventSource=eventSource;this.recordingClock=undefined;this.recordingBytes=0;this.recordingDiscard=false;this.recordingStopReason='requested';this.captureFailure=undefined
    this.recordingTimer=setTimeout(()=>{this.recordingStopReason='maximum-duration';void this.stop().catch(()=>{})},1_799_000)
    const filePath = path.join(artifactsDirectory, `${id}.webm`)
    this.file = filePath
    this.stream = fs.createWriteStream(filePath, { mode: 0o600,flags:'wx' })
    this.stream.on('error',this.captureStreamError)
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
    this.recordingBytes+=chunk.byteLength
    if(this.recordingBytes>MAX_CAPTURE_BYTES){this.captureFailure=new Error('Recording byte budget exceeded.');void this.stop().catch(()=>{});return}
    this.stream.write(Buffer.from(chunk))
  }

  updateState(state) {
    if(state.state==='recording'&&state.clock&&!this.recordingClock){
      const clock=mediaRecord(state.clock)
      if([clock.startedEpochMs,clock.width,clock.height].every(value=>typeof value==='number'&&Number.isFinite(value))){this.recordingClock=clock as unknown as RecordingClock;this.eventSource?.begin(this.recordingClock)}
    }
    if(state.state==='error'&&this.file){this.captureFailure=new Error(String(state.message||'Recording could not start.'));void this.finalize({error:this.captureFailure.message}).catch(error=>this.onStatus?.({active:false,state:'error',message:error instanceof Error?error.message:String(error)}))}

    if (this.metadata && typeof state.gpu === 'boolean') this.metadata.gpu = state.gpu
    this.onStatus?.({ active: Boolean(this.file), ...this.metadata, ...state })
  }

  async stop(request:{discard?:boolean}={}) {
    if (this.elementCapture) {
      if(request.discard)throw new Error('discard cancels page recordings; selected-video jobs use their cancellation signal.')
      const capture = this.elementCapture
      return capture.stop()
    }
    if (!this.file) return { state: 'idle' }
    if(request.discard)this.recordingDiscard=true
    this.window.webContents.send('media-command', { type: 'stop' })
    return this.recordingCompletion??{ recordingId: this.metadata.id, state: 'stopping' }
  }

  async finalize(raw:unknown = {}):Promise<unknown> {
    if(this.finalizing)return this.finalizing
    this.finalizing=this.finalizeRecording(raw)
    try{const result=await this.finalizing;this.resolveRecording?.(result);return result}catch(error){this.rejectRecording?.(error);throw error}finally{this.finalizing=undefined;this.resolveRecording=undefined;this.rejectRecording=undefined;this.recordingCompletion=undefined}
  }
  private async finalizeRecording(raw:unknown) {
    const summary=mediaRecord(raw)
    if (!this.stream || !this.file) return null
    const stream = this.stream
    if(this.recordingTimer)clearTimeout(this.recordingTimer)
    const eventPath=this.file+'.events.json'
    const result = {
      artifactId: path.basename(this.file),
      type: 'recording',
      path: this.file,
      durationMs: Date.now() - this.metadata.startedAt,
      gpuProcessed: this.metadata.gpu,
      ...summary
    }
    try {
      if(stream.destroyed)throw this.captureFailure??new Error('Recording stream closed before finalization.')
      const finished = once(stream, 'finish')
      stream.end()
      await finished
      if(this.captureFailure)throw this.captureFailure
      const bytes = fs.statSync(result.path).size
      if (typeof summary.error==='string') throw new Error(summary.error)
      if (!bytes) throw new Error('Browser recording produced no media bytes.')
      const clock=this.recordingClock
      if(!clock)throw new Error('Recording did not establish its media clock.')
      const durationMs=Number(summary.durationMs)
      if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>1800000)throw new Error('Invalid recording duration.')
      const packet=await this.eventSource?.collect(clock.startedEpochMs+durationMs)
      if(this.recordingDiscard){await fs.promises.rm(result.path,{force:true});this.onStatus?.({active:false,state:'cancelled',recordingId:this.metadata.id});return {state:'cancelled',recordingId:this.metadata.id}}
      if(packet?.reason==='requested')packet.reason=this.recordingStopReason
      const events=packet?recordingEvents(result.artifactId,clock,durationMs/1000,packet,assertRecordingFrameClock(summary.frameClock??[],durationMs/1000),summary.frameClockTruncated===true):undefined
      if(events){const text=JSON.stringify(events,null,2)+'\n';if(Buffer.byteLength(text)>RECORDING_EVENT_BYTES)throw new Error('Recording event byte budget exceeded.');await fs.promises.writeFile(eventPath,text,{mode:0o600,flag:'wx'})}
      const completed={...result,state:'completed',durationMs,bytes,...(events?{eventsArtifactId:path.basename(eventPath),eventCount:events.events.length,eventsTruncated:events.truncated}:{})}
      this.onStatus?.({ active: false, ...completed })
      return completed
    } catch (error) { await Promise.all([fs.promises.rm(result.path,{force:true}),fs.promises.rm(eventPath,{force:true})]);throw error }
    finally { await this.eventSource?.dispose();this.eventSource=undefined;this.recordingClock=undefined;stream.removeListener('error',this.captureStreamError);this.stream = null; this.file = null; this.target = null }
  }

  async captureVideo(tab:{id:string;title:string;url:string;view:{webContents:WebContents}},request:{selector?:unknown;index?:unknown;filename?:unknown;fromStart?:unknown;maxDurationMs?:unknown;sourceGuard?:SourceCaptureGuard}={},signal?:AbortSignal){
    signal?.throwIfAborted();if(this.isCaptureActive())throw new Error('A media job is already active.')
    const directory=this.resolveArtifactsDirectory?.(tab)||this.artifactsDirectory;fs.mkdirSync(directory,{recursive:true,mode:0o700})
    const capture=new VideoElementCapture(tab.view.webContents,directory,request,{id:tab.id,title:tab.title,url:tab.url},value=>this.onStatus?.(value));this.elementCapture=capture
    try{return await capture.run(signal)}finally{if(this.elementCapture===capture)this.elementCapture=null}
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
