import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { BrowserWindow, ipcMain, session, protocol } from 'electron'
import type { IpcMainInvokeEvent, Session } from 'electron'
import { assertNarration } from './narration-contract.js'
import { LOCAL_TTS_ASSETS, LOCAL_TTS_VERSION } from './local-tts-assets.js'
import { mediaRecord } from './media-contract.js'
protocol.registerSchemesAsPrivileged([{ scheme: 'bmw-tts', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
export class NarrationProcessor {
  private active = false
  constructor(private options: { pagePath: string; preloadPath: string; onStatus?: (value: Record<string, unknown>) => void }) {}
  get busy(): boolean { return this.active }
  async narrate(raw: unknown, directory: string, signal?: AbortSignal) {
    const request = assertNarration(raw)
    signal?.throwIfAborted()
    if (this.active) throw new Error('Narration is already active.')
    this.active = true
    let window: BrowserWindow | undefined, timer: NodeJS.Timeout | undefined, abort: (() => void) | undefined
    let listener: ((event: IpcMainInvokeEvent, raw: unknown) => void) | undefined
    let outputPath: string | undefined
    let isolatedSession: Session | undefined
    try {
      const root = await fs.realpath(directory), token = crypto.randomUUID()
      // Separate nonpersistent Session; never alter the user's browsing headers/cookies.
      const isolated = isolatedSession = session.fromPartition(`bmw-narration-${token}`)
      const local = request.provider === 'local-matcha'
      if (local) {
        const modelDirectory = path.resolve(import.meta.dirname, '../../../.bmw-runtime/local-tts', LOCAL_TTS_VERSION)
        const content: Record<string, Uint8Array> = {}
        for (const [filename, hash] of Object.entries(LOCAL_TTS_ASSETS)) {
          const file = path.join(modelDirectory, filename)
          if (await fs.realpath(file).catch(() => '') !== file) throw new Error('Local TTS model is missing or linked. Run npm run setup:local-tts.')
          const data = await fs.readFile(file)
          if (crypto.createHash('sha256').update(data).digest('hex') !== hash) throw new Error('Local TTS resource integrity failed.')
          content[filename] = data
        }
        isolated.protocol.handle('bmw-tts', async (input) => {
          const url = new URL(input.url), filename = url.pathname.slice(1)
          if (url.hostname !== 'runtime' || filename.includes('/') || input.method !== 'GET') return new Response(null,{status:403})
          const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'"
          if (filename === 'index.html') return new Response('<!doctype html><meta charset="utf-8"><title>BMW Local Narration</title><script type="module" src="./narration-local.js"></script>',{headers:{'content-type':'text/html','content-security-policy':csp}})
          let data = content[filename]
          if (!data && ['narration-local.js','narration-contract.js','media-contract.js','image-contract.js','image-drawing-contract.js'].includes(filename)) data = await fs.readFile(path.join(path.dirname(this.options.pagePath),filename==='narration-local.js'?filename:'../'+filename))
          if (!data) return new Response(null,{status:404})
          return new Response(data as Uint8Array<ArrayBuffer>,{headers:{'content-type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.wasm')?'application/wasm':'application/octet-stream','content-security-policy':csp}})
        })
        isolated.webRequest.onBeforeRequest({ urls:['http://*/*','https://*/*','ws://*/*','wss://*/*'] }, (_details, callback) => callback({cancel:true}))
      }
      if (!local && process.env.HTTPS_PROXY) await isolated.setProxy({ proxyRules: process.env.HTTPS_PROXY })
      if (!local) isolated.webRequest.onBeforeSendHeaders({ urls: ['wss://speech.platform.bing.com/*'] }, (details, callback) => {
        callback({ requestHeaders: { ...details.requestHeaders, Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0' } })
      })
      window = new BrowserWindow({ show: false, webPreferences: { session: isolated, preload: this.options.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      const jobWindow = window
      jobWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      jobWindow.webContents.on('will-navigate', event => event.preventDefault())
      const pending = new Promise<Uint8Array>((resolve, reject) => {
        abort = () => reject(signal?.reason ?? new Error('Narration cancelled.')); signal?.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => reject(new Error('Narration exceeded its processing deadline.')), local ? 180_000 : 60_000)
        listener = (event, raw) => {
          if (event.sender !== jobWindow.webContents || event.senderFrame !== jobWindow.webContents.mainFrame) return
          try {
            const value = mediaRecord(raw)
            if (value.token !== token) throw new Error('Narration token mismatch.')
            if (typeof value.error === 'string') throw new Error(value.error.slice(0,2000))
            if (!(value.data instanceof Uint8Array) || value.data.length < 512 || value.data.length > 8 * 1024 * 1024) throw new Error('Invalid narration bytes.')
            resolve(value.data)
          } catch (error) { reject(error) }
        }
        ipcMain.on('bmw-narration-result', listener)
        jobWindow.once('closed', () => reject(new Error('Narration window closed.')))
        jobWindow.webContents.once('render-process-gone', () => reject(new Error('Narration renderer exited.')))
      })
      void pending.catch(() => {})
      this.options.onStatus?.({ active: true, kind: 'processing', action: 'video.narrate', progress: 0 })
      await Promise.race([local ? jobWindow.loadURL('bmw-tts://runtime/index.html') : jobWindow.loadFile(this.options.pagePath), pending]); signal?.throwIfAborted()
      jobWindow.webContents.send('bmw-narration-request', { token, request })
      const data = await pending; signal?.throwIfAborted()
      const artifactId = `narration-${token}.${local ? 'wav' : 'mp3'}`; outputPath = path.join(root, artifactId)
      await fs.writeFile(outputPath, data, { flag: 'wx', mode: 0o600 }); signal?.throwIfAborted()
      return { artifactId, path: outputPath, bytes: data.length, type: 'audio', contentType: local ? 'audio/wav' : 'audio/mpeg', ...request }
    } catch (error) { if (outputPath) await fs.rm(outputPath,{force:true}); throw error }
    finally {
      if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort',abort)
      if (listener) ipcMain.removeListener('bmw-narration-result',listener)
      window?.destroy()
      if (isolatedSession && await isolatedSession.protocol.isProtocolHandled('bmw-tts')) isolatedSession.protocol.unhandle('bmw-tts')
      isolatedSession?.webRequest.onBeforeRequest(null)
      isolatedSession?.webRequest.onBeforeSendHeaders(null)
      this.active = false; this.options.onStatus?.({ active: false, kind: 'processing', action: 'video.narrate' })
    }
  }
}
