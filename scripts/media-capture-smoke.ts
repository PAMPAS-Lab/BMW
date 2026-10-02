import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import { BrowserKernel } from '../packages/browser-capability/src/browser-kernel.js'
import { MediaController } from '../packages/media-native/src/media-controller.js'

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-media-smoke-'))
const userDataDirectory = path.join(temporaryRoot, 'user-data')
const projectDirectory = path.join(temporaryRoot, 'project')
fs.mkdirSync(userDataDirectory, { recursive: true, mode: 0o700 })
fs.mkdirSync(projectDirectory, { recursive: true, mode: 0o700 })
app.setPath('userData', userDataDirectory)
app.commandLine.appendSwitch('disable-gpu')
app.once('will-finish-launching', () => process.stderr.write('[BMW media smoke] Electron will finish launching\n'))
app.once('ready', () => process.stderr.write('[BMW media smoke] Electron ready event\n'))

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const video = Buffer.from('BMW browser-native media smoke fixture')

interface MediaDiscovery { items: Array<{ url?: string }> }
interface ScreenshotArtifact { path: string; width: number; height: number }
interface DownloadArtifact { path: string; contentType: string; bytes: number }
interface CapturedArtifact extends DownloadArtifact { complete: boolean; stopReason: string; videoTracks: number }

function send(response: http.ServerResponse, contentType: string, body: string | Buffer): void {
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

const server = http.createServer((request, response) => {
  if (request.url === '/image.png') return send(response, 'image/png', image)
  if (request.url === '/poster.png') return send(response, 'image/png', image)
  if (request.url === '/video.mp4') return send(response, 'video/mp4', video)
  return send(response, 'text/html; charset=utf-8', `<!doctype html>
    <meta charset="utf-8"><title>BMW Media Smoke</title>
    <style>body{margin:0;padding:32px;background:#101722;color:white;font:16px sans-serif}article{width:560px;padding:24px;border:1px solid #49c9a5;border-radius:16px}img,video{display:block;width:320px;height:180px;margin-top:16px;object-fit:cover;background:#243142}</style>
    <article data-testid="tweet"><h1>Latest Arena post</h1><p>BMW selected-element capture fixture.</p><img src="/image.png" alt="fixture image"><video poster="/poster.png" controls><source src="/video.mp4" type="video/mp4"></video><video id="capture-source" autoplay muted></video><canvas id="capture-canvas" width="320" height="180" hidden></canvas></article>
    <script>
      const canvas = document.querySelector('#capture-canvas')
      const context = canvas.getContext('2d')
      let frame = 0
      setInterval(() => {
        context.fillStyle = frame++ % 2 ? '#49c9a5' : '#875cff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = 'white'
        context.font = '28px sans-serif'
        context.fillText('BMW ' + frame, 80, 100)
      }, 80)
      const source = document.querySelector('#capture-source')
      source.srcObject = canvas.captureStream(12)
      source.play()
    </script>`)
})

let window: BrowserWindow | null = null
let exitCode = 0

async function stage<T>(name: string, operation: Promise<T>, timeoutMs = 15_000): Promise<T> {
  process.stderr.write(`[BMW media smoke] ${name}\n`)
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`BMW media smoke timed out during ${name}.`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function run(): Promise<void> {
 try {
  await stage('start local fixture server', new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  }))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('BMW media smoke server did not bind a TCP port.')
  const url = `http://127.0.0.1:${address.port}/`
  await stage('wait for Electron', app.whenReady())
  const smokeSession = session.fromPartition(`persist:bmw-media-smoke-${process.pid}`)
  window = new BrowserWindow({
    show: false,
    width: 900,
    height: 760,
    webPreferences: { session: smokeSession, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  await stage('load fixture page', window.loadURL(url))
  const tab = {
    id: 'media-smoke-tab',
    title: 'BMW Media Smoke',
    url,
    view: { webContents: window.webContents }
  }
  const kernel = {
    diagnostics: new Map([[tab.id, { console: [], network: [], media: [], loadFailures: [] }]]),
    projectStore: { active: () => ({ id: 'media-smoke-project', directory: projectDirectory }) },
    session: smokeSession,
    artifactsDirectory: path.join(projectDirectory, 'artifacts'),
    serializeTab: () => ({ id: tab.id, title: tab.title, url: tab.url }),
    diagnosticsFor: BrowserKernel.prototype.diagnosticsFor
  }

  const discovered = await stage<MediaDiscovery>('discover post media', BrowserKernel.prototype.listMedia.call(kernel, tab, {
    selector: '[data-testid="tweet"]',
    index: 0,
    maxItems: 20
  }) as Promise<MediaDiscovery>)
  if (!discovered.items.some((item) => item.url === `${url}image.png`)) throw new Error('BMW did not discover the post image.')
  if (!discovered.items.some((item) => item.url === `${url}video.mp4`)) throw new Error('BMW did not discover the post video source.')

  const screenshot = await stage<ScreenshotArtifact>('capture selected post', BrowserKernel.prototype.screenshot.call(kernel, tab, {
    selector: '[data-testid="tweet"]',
    index: 0,
    filename: 'arena-latest-post.png'
  }) as Promise<ScreenshotArtifact>)
  if (!fs.statSync(screenshot.path).size || screenshot.width < 500 || screenshot.height < 300) {
    throw new Error('BMW selected-post screenshot was empty or unexpectedly small.')
  }

  const downloaded = await stage<DownloadArtifact>('download post video', BrowserKernel.prototype.downloadMedia.call(kernel, tab, {
    url: `${url}video.mp4`,
    filename: 'arena-latest-video.mp4'
  }) as Promise<DownloadArtifact>)
  if (!fs.readFileSync(downloaded.path).equals(video)) throw new Error('BMW downloaded video bytes did not match the browser resource.')

  const mediaController = new MediaController({
    session: smokeSession,
    preloadPath: '',
    pagePath: '',
    artifactsDirectory: path.join(projectDirectory, 'artifacts'),
    resolveArtifactsDirectory: () => path.join(projectDirectory, 'artifacts'),
    onStatus: () => {}
  })
  const captured = await stage<CapturedArtifact>('capture page video stream', mediaController.captureVideo(tab, {
    selector: '#capture-source',
    filename: 'arena-stream.webm',
    fromStart: false,
    maxDurationMs: 1_500
  }) as Promise<CapturedArtifact>, 15_000)
  const capturedBytes = fs.readFileSync(captured.path)
  const hasWebmHeader = capturedBytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  if (!captured.contentType.startsWith('video/webm') || captured.bytes < 1_024 || captured.videoTracks !== 1 || !hasWebmHeader) {
    throw new Error(`BMW browser-native video capture did not produce a valid WebM stream: ${JSON.stringify(captured)}`)
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    discoveredItems: discovered.items.length,
    screenshot: { width: screenshot.width, height: screenshot.height, bytes: fs.statSync(screenshot.path).size },
    download: { contentType: downloaded.contentType, bytes: downloaded.bytes },
    capture: { contentType: captured.contentType, bytes: captured.bytes, complete: captured.complete, stopReason: captured.stopReason }
  })}\n`)
 } catch (error) {
  exitCode = 1
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
 } finally {
  window?.destroy()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
  app.exit(exitCode)
 }
}

void run()
