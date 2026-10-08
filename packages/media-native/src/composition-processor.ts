import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { BrowserWindow, ipcMain } from 'electron'
import type { Session, IpcMainInvokeEvent } from 'electron'
import { ArtifactJobIO } from './artifact-job-io.js'
import { assertNarrationReceipt,assertComposition, compositionAssets, compositionDuration } from './composition-contract.js'
import { finiteNumber, mediaRecord } from './media-contract.js'

/** Bounded multi-asset browser job. Renderer receives only pinned Project handles. */
export class CompositionProcessor {
  private active = false
  constructor(private options: { session: Session; pagePath: string; preloadPath: string; onStatus?: (value: Record<string, unknown>) => void }) {}
  get busy(): boolean { return this.active }
  async compose(raw: unknown, directory: string, signal?: AbortSignal) {
    const composition = assertComposition(raw)
    signal?.throwIfAborted()
    if (this.active) throw new Error('Video production is already active.')
    this.active = true
    const inputs: ArtifactJobIO[] = []
    let output: ArtifactJobIO | undefined
    let window: BrowserWindow | undefined
    let timer: NodeJS.Timeout | undefined
    let abort: (() => void) | undefined
    let listener: ((event: IpcMainInvokeEvent, value: unknown) => void) | undefined
    let registered = false
    let ioTail: Promise<unknown> = Promise.resolve()
    const queued = <T>(operation: () => Promise<T>) => { const result = ioTail.then(operation); ioTail = result.catch(() => {}); return result }
    let completedPath: string | undefined
    try {
      for (const artifactId of compositionAssets(composition)) inputs.push(await ArtifactJobIO.open(directory, { action: 'media.inspect', artifactId }))
      if (inputs.reduce((sum, input) => sum + input.bytes, 0) > 256 * 1024 * 1024) throw new Error('Composition source assets exceed 256 MiB.')
      output = await ArtifactJobIO.createOutput(directory)
      const jobOutput = output
      const token = crypto.randomUUID()
      window = new BrowserWindow({ show: false, webPreferences: { session: this.options.session, preload: this.options.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      const jobWindow = window
      const authorize = (event: IpcMainInvokeEvent, raw: unknown) => {
        const value = mediaRecord(raw)
        if (event.sender !== jobWindow.webContents || event.senderFrame !== jobWindow.webContents.mainFrame || value.token !== token) throw new Error('Composition IPC is outside its owning job.')
        signal?.throwIfAborted()
        return value
      }
      ipcMain.handle('bmw-composition-read', (event, raw: unknown) => queued(async () => {
        const value = authorize(event, raw)
        const index = finiteNumber(value.assetIndex, 'asset index', 0, inputs.length - 1, true)
        return inputs[index].read(value.offset, value.length)
      }))
      ipcMain.handle('bmw-composition-write', (event, raw: unknown) => queued(async () => {
        const value = authorize(event, raw); await jobOutput.write(0, value.position, value.data)
      }))
      registered = true
      jobWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      jobWindow.webContents.on('will-navigate', event => event.preventDefault())
      const pending = new Promise<Record<string, unknown>>((resolve, reject) => {
        abort = () => reject(signal?.reason ?? new Error('Composition cancelled.'))
        signal?.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => reject(new Error('Composition exceeded its ten-minute processing limit.')), 600_000)
        listener = (event, raw: unknown) => {
          try {
            const value = authorize(event, raw)
            if (value.progress !== undefined) this.options.onStatus?.({ active: true, kind: 'processing', action: 'video.compose', progress: finiteNumber(value.progress, 'progress', 0, 1) })
            else if (typeof value.error === 'string') reject(new Error(value.error.slice(0, 2000)))
            else {
              const result = mediaRecord(value.result)
              if (result.frames !== Math.ceil(compositionDuration(composition) * composition.fps) || result.durationSeconds !== compositionDuration(composition) || result.width !== composition.width || result.height !== composition.height) throw new Error('Composition result does not match its manifest.')
              finiteNumber(result.audioPeak, 'audio peak', 0, 1)
              assertNarrationReceipt(composition.scenes,result.narrationDurations)
              resolve(result)
            }
          } catch (error) { if (event.sender === jobWindow.webContents) reject(error) }
        }
        ipcMain.on('bmw-composition-reply', listener)
        jobWindow.once('closed', () => reject(new Error('Composition window closed.')))
        jobWindow.webContents.once('render-process-gone', () => reject(new Error('Composition renderer exited.')))
      })
      void pending.catch(() => {})
      this.options.onStatus?.({ active: true, kind: 'processing', action: 'video.compose', progress: 0 })
      await Promise.race([jobWindow.loadFile(this.options.pagePath), pending])
      signal?.throwIfAborted()
      jobWindow.webContents.send('bmw-composition-process', { token, composition, assets: inputs.map(input => ({ artifactId: 'artifactId' in input.request?input.request.artifactId:(()=>{throw new Error('Composition asset must have an input.')})(), bytes: input.bytes })) })
      const receipt = await pending
      signal?.throwIfAborted()
      const [artifact] = await jobOutput.finish(1)
      completedPath = artifact.path
      return { ...artifact, type: 'video', contentType: 'video/mp4', state: 'completed', engine: 'bmw-seekable-canvas-mediabunny', ...receipt, durationSeconds: compositionDuration(composition), composition }
    } catch (error) { if (completedPath) await fs.rm(completedPath, { force: true }); throw error }
    finally {
      if (timer) clearTimeout(timer)
      if (abort) signal?.removeEventListener('abort', abort)
      if (listener) ipcMain.removeListener('bmw-composition-reply', listener)
      if (registered) { ipcMain.removeHandler('bmw-composition-read'); ipcMain.removeHandler('bmw-composition-write') }
      window?.destroy()
      await ioTail
      await Promise.allSettled([...inputs.map(input => input.close()), output?.close()])
      this.active = false
      this.options.onStatus?.({ active: false, kind: 'processing', action: 'video.compose' })
    }
  }
}
