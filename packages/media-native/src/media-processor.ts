import fs from 'node:fs/promises'
import {assertCoverRenderRequest} from './media/processing.cover-contract.js'
import crypto from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, Session } from 'electron'
import { ArtifactJobIO } from './artifact-job-io.js'
import { assertNativeProcessingRequest, assertMediaWorkerResult, finiteNumber, mediaRecord, MEDIA_LIMITS } from './media-contract.js'
import type { MediaWorkerResult } from './media-contract.js'

interface ProcessorOptions { session: Session; pagePath: string; preloadPath: string; onStatus?: (value: Record<string, unknown>) => void }
/** Browser-only decoding/encoding. The private preload can only access this job's pinned artifacts. */
export class MediaProcessor {
  private active = false
  constructor(private options: ProcessorOptions) {}
  get busy(): boolean { return this.active }
  async process(raw: unknown, directory: string, signal?: AbortSignal) {
    const request = assertNativeProcessingRequest(raw)
    if (this.active) throw new Error('BMW media processing is already active.')
    signal?.throwIfAborted()
    this.active = true
    let io: ArtifactJobIO | undefined
    let window: BrowserWindow | undefined
    let timer: NodeJS.Timeout | undefined
    let abort: (() => void) | undefined
    let reply: ((event: IpcMainInvokeEvent, value: unknown) => void) | undefined
    let registered = false
    let ioTail: Promise<unknown> = Promise.resolve()
    const runIO = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = ioTail.then(operation)
      ioTail = result.catch(() => {})
      return result
    }
    try {
      if(request.action!=='media.encode.check')io = await ArtifactJobIO.open(directory, request)
      if((request.action==='media.image.inspect'||request.action==='media.image.annotate')&&io!.bytes>32*1024*1024)throw new Error('Image exceeds 32 MiB.')
      signal?.throwIfAborted()
      const token = crypto.randomUUID()
      window = new BrowserWindow({ show: false, webPreferences: { session: this.options.session,
        preload: this.options.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      const mediaWindow = window
      const jobIO = io
      const authorize = (event: IpcMainInvokeEvent, raw: unknown) => {
        const value = mediaRecord(raw)
        if (event.sender !== mediaWindow.webContents || event.senderFrame !== mediaWindow.webContents.mainFrame || value.token !== token) throw new Error('Media IPC is outside its owning job.')
        signal?.throwIfAborted()
        return value
      }
      ipcMain.handle('bmw-media-read', async (event, raw: unknown) => {
        const value = authorize(event, raw)
        return runIO(() => { authorize(event, raw); if(!jobIO)throw new Error('Encoder inspection has no input.'); return jobIO.read(value.offset, value.length) })
      })
      ipcMain.handle('bmw-media-write', async (event, raw: unknown) => {
        const value = authorize(event, raw)
        await runIO(() => { authorize(event, raw); if(!jobIO)throw new Error('Encoder inspection cannot write.'); return jobIO.write(value.outputIndex, value.position, value.data) })
      })
      registered = true
      mediaWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      mediaWindow.webContents.on('will-navigate', (event) => event.preventDefault())
      const pending = new Promise<MediaWorkerResult>((resolve, reject) => {
        abort = () => reject(signal?.reason instanceof Error ? signal.reason : new Error('Media processing cancelled.'))
        signal?.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => reject(new Error('Media processing exceeded its two-minute job limit.')), MEDIA_LIMITS.jobTimeoutMs)
        reply = (event, raw: unknown) => {
          try {
            const value = authorize(event, raw)
            if (value.progress !== undefined) {
              this.options.onStatus?.({ active: true, kind: 'processing', action: request.action, progress: finiteNumber(value.progress, 'progress', 0, 1) })
            } else if (typeof value.error === 'string') reject(new Error(value.error.slice(0, 2000)))
            else resolve(assertMediaWorkerResult(value.result, request))
          } catch (error) { if (event.sender === mediaWindow.webContents) reject(error) }
        }
        ipcMain.on('bmw-media-reply', reply)
        mediaWindow.once('closed', () => reject(new Error('Media processing window closed.')))
        mediaWindow.webContents.once('render-process-gone', () => reject(new Error('Media processing renderer exited.')))
      })
      // Attach rejection handling before loading the page (load failures/abort can race the result).
      void pending.catch(() => {})
      this.options.onStatus?.({ active: true, kind: 'processing', action: request.action, progress: 0 })
      await Promise.race([mediaWindow.loadFile(this.options.pagePath), pending])
      signal?.throwIfAborted()
      mediaWindow.webContents.send('bmw-media-process', { token, bytes: io?.bytes??0, request })
      const result = await pending
      signal?.throwIfAborted()
      const artifacts = io?await io.finish(result.kind === 'frames' ? result.frames.length : result.kind === 'conversion'||result.kind==='drawing' ? 1 : 0,result.kind==='drawing'?result:undefined):[]
      if(result.kind==='encoding')return result.info
      const base = { sourceArtifactId: 'artifactId' in request?request.artifactId:undefined, sourceBytes: io?.bytes??0, engine: 'mediabunny-webcodecs' }
      if(result.kind==='drawing')return {...base,...artifacts[0],type:'screenshot',contentType:'image/png',state:'completed',engine:'bmw-native-canvas',width:result.width,height:result.height,shapeCount:result.shapeCount}
      if(result.kind==='image')return {...base,...result.info}
      if (result.kind === 'inspection') return { ...base, ...result.info }
      if (result.kind === 'frames') return { ...base, type: 'frame-set', frames: result.frames.map((frame, index) => ({ ...frame, ...artifacts[index], type: 'screenshot', contentType: 'image/png' })) }
      return { ...base, ...artifacts[0], state: 'completed', type: result.contentType.startsWith('video/') ? 'video' : 'audio', contentType: result.contentType, range: result.range, tracks: result.tracks }
    } finally {
      if (timer) clearTimeout(timer)
      if (abort) signal?.removeEventListener('abort', abort)
      if (reply) ipcMain.removeListener('bmw-media-reply', reply)
      if (registered) { ipcMain.removeHandler('bmw-media-read'); ipcMain.removeHandler('bmw-media-write') }
      if (window && !window.isDestroyed()) window.destroy()
      await ioTail
      try { await io?.close() } finally { this.active = false }
      this.options.onStatus?.({ active: false, kind: 'processing', action: request.action })
    }
  }
}

/** Isolated still-image worker; source and output stay pinned to the active Project. */
export class CoverProcessor {
  private active=false
  constructor(private options:{session:Session;pagePath:string;preloadPath:string;onStatus?:(value:Record<string,unknown>)=>void}){}
  get busy():boolean{return this.active}
  async render(raw:unknown,directory:string,signal?:AbortSignal){
    const request=assertCoverRenderRequest(raw);signal?.throwIfAborted()
    if(this.active)throw new Error('Video cover generation is already active.')
    this.active=true
    let input:ArtifactJobIO|undefined,output:ArtifactJobIO|undefined,window:BrowserWindow|undefined,registered=false,completedPath:string|undefined
    let timer:NodeJS.Timeout|undefined,abort:(()=>void)|undefined,listener:((event:IpcMainInvokeEvent,value:unknown)=>void)|undefined
    let tail:Promise<unknown>=Promise.resolve()
    const queued=<T>(operation:()=>Promise<T>)=>{const result=tail.then(operation);tail=result.catch(()=>{});return result}
    try{
      if(request.options.sourceArtifactId){input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:request.options.sourceArtifactId});if(request.sourceKind==='image'&&input.bytes>32*1024*1024)throw new Error('Cover image exceeds 32 MiB.')}
      output=await ArtifactJobIO.open(directory,{action:'media.image.draw',width:request.width,height:request.height,background:request.options.background,shapes:[]})
      signal?.throwIfAborted()
      const jobInput=input,jobOutput=output,token=crypto.randomUUID()
      window=new BrowserWindow({show:false,webPreferences:{session:this.options.session,preload:this.options.preloadPath,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      const job=window
      const admit=(event:IpcMainInvokeEvent,raw:unknown)=>{const value=mediaRecord(raw);if(event.sender!==job.webContents||event.senderFrame!==job.webContents.mainFrame||value.token!==token)throw new Error('Cover IPC is outside its owning job.');signal?.throwIfAborted();return value}
      ipcMain.handle('bmw-cover-read',(event,raw:unknown)=>queued(async()=>{const value=admit(event,raw);if(!jobInput)throw new Error('Title-only covers have no input.');return jobInput.read(value.offset,value.length)}))
      ipcMain.handle('bmw-cover-write',(event,raw:unknown)=>queued(async()=>{const value=admit(event,raw);await jobOutput.write(0,value.position,value.data)}));registered=true
      job.webContents.setWindowOpenHandler(()=>({action:'deny'}));job.webContents.on('will-navigate',event=>event.preventDefault())
      const pending=new Promise<{width:number;height:number;actualTimestampSeconds?:number}>((resolve,reject)=>{
        abort=()=>reject(signal?.reason??new Error('Cover generation cancelled.'));signal?.addEventListener('abort',abort,{once:true})
        timer=setTimeout(()=>reject(new Error('Cover generation exceeded two minutes.')),MEDIA_LIMITS.jobTimeoutMs)
        listener=(event,raw:unknown)=>{try{const value=admit(event,raw);if(typeof value.error==='string'){reject(new Error(value.error.slice(0,2000)));return}
          const result=mediaRecord(value.result)
          if(result.width!==request.width||result.height!==request.height)throw new Error('Cover result dimensions mismatch.')
          const actualTimestampSeconds=request.sourceKind==='video'?finiteNumber(result.actualTimestampSeconds,'actual cover timestamp',0,request.options.timestampSeconds):undefined
          if(request.sourceKind!=='video'&&result.actualTimestampSeconds!==undefined)throw new Error('Unexpected cover video timestamp.')
          resolve({width:request.width,height:request.height,...(actualTimestampSeconds===undefined?{}:{actualTimestampSeconds})})
        }catch(error){if(event.sender===job.webContents)reject(error)}}
        ipcMain.on('bmw-cover-reply',listener);job.once('closed',()=>reject(new Error('Cover worker closed.')));job.webContents.once('render-process-gone',()=>reject(new Error('Cover worker exited.')))
      })
      void pending.catch(()=>{})
      this.options.onStatus?.({active:true,kind:'processing',action:'video.cover',progress:0})
      await Promise.race([job.loadFile(this.options.pagePath),pending]);signal?.throwIfAborted()
      job.webContents.send('bmw-cover-command',{token,bytes:input?.bytes??0,request})
      const result=await pending;signal?.throwIfAborted()
      const [artifact]=await output.finish(1,result);completedPath=artifact.path;signal?.throwIfAborted()
      return {...artifact,...result,type:'screenshot' as const,contentType:'image/png' as const,sourceArtifactId:request.options.sourceArtifactId,engine:'bmw-native-cover'}
    }catch(error){if(completedPath)await fs.rm(completedPath,{force:true});throw error}
    finally{
      if(timer)clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);if(listener)ipcMain.removeListener('bmw-cover-reply',listener)
      if(registered){ipcMain.removeHandler('bmw-cover-read');ipcMain.removeHandler('bmw-cover-write')}
      if(window&&!window.isDestroyed())window.destroy();await tail
      try{try{await input?.close()}finally{await output?.close()}}finally{this.active=false;this.options.onStatus?.({active:false,kind:'processing',action:'video.cover'})}
    }
  }
}
