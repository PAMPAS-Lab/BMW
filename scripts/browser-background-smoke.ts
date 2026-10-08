import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, WebContentsView, nativeImage, screen, session } from 'electron'
import { BrowserKernel } from '../packages/browser-capability/src/browser-kernel.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-background-'))
app.setPath('userData', path.join(root, 'profile'))
app.commandLine.appendSwitch('disable-gpu')
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
let host: BrowserWindow | undefined
let view: WebContentsView | undefined
let code = 0
async function run(): Promise<void> {
try {
  const watchdog = setTimeout(() => { process.stderr.write('Background screenshot smoke exceeded 60s\n'); app.exit(1) }, 60_000)
  watchdog.unref()
  await app.whenReady()
  const isolated = session.fromPartition(`bmw-background-${process.pid}`)
  host = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true } })
  view = new WebContentsView({ webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  // This Agent view is never attached or foregrounded, as in the incident.
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent('<style>body{margin:0}article{width:560px;height:380px;background:rgb(49,170,119)}</style><article data-testid="tweet">Background post<img src="https://example.com/picture.png"></article>'))
  if (process.env.BMW_REPRODUCE_OLD_SCREENSHOT === '1') {
    let settled = false
    const pending = view.webContents.executeJavaScript(`(async () => {
      const element = document.querySelector('article[data-testid="tweet"]')
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return element.getBoundingClientRect().width
    })()`, true).finally(() => { settled = true }).catch(() => undefined)
    await pause(2000)
    const layout = await view.webContents.executeJavaScript('({width:document.querySelector("article").getBoundingClientRect().width,visibility:document.visibilityState})')
    assert.equal(layout.width, 560)
    assert.equal(settled, false, 'Old screenshot should reproduce suspended animation frame')
    process.stdout.write(JSON.stringify({ ok: true, reproduced: 'selector layout exists but old double-requestAnimationFrame screenshot remains pending after 2000ms', layout, bounds: view.getBounds() }) + '\n')
    view.webContents.close()
    view = undefined
    await Promise.race([pending, pause(1000)])
  } else {
    view.webContents.close()
    view = undefined
    const live = new BrowserKernel({ window: host, session: isolated, permissionStore: { hasAgentControl: () => true }, sessionContinuity: null, projectStore: null, settingsStore: null, capabilityRegistry: null, allowedActions: undefined, artifactsDirectory: root, onState: () => {} })
    const active = await live.openTab({ url: 'about:blank', foreground: true, source: 'user' })
    const fixtureUrl = 'data:text/html,' + encodeURIComponent('<style>body{margin:0}article{margin-top:1500px;width:560px;height:380px;background:rgb(49,170,119)}</style><article data-testid="tweet">Background post<img src="https://example.com/picture.png"></article>')
    const background = await live.openTab({ url: fixtureUrl, source: 'agent', reuse: false })
    view = live.tabs.get(background.id).view
    assert.equal(view.getBounds().width, 900)
    console.log('Background phase: detached selector screenshot')
    const artifact = await live.execute({ action: 'media.screenshot', tabId: background.id, selector: 'article[data-testid="tweet"]' })
    const scale = screen.getDisplayMatching(host.getBounds()).scaleFactor
    assert.equal(artifact.width, 560 * scale)
    assert.equal(artifact.height, 380 * scale)
    assert.ok(fs.statSync(artifact.path).size > 500)
    const pixels = nativeImage.createFromPath(artifact.path).toBitmap()
    assert.deepEqual([...pixels.subarray(pixels.length - 4, pixels.length)], [119, 170, 49, 255])
    assert.equal(await view.webContents.executeJavaScript('scrollY'), 0)
    assert.equal(live.activeTabId, active.id)
    assert.equal(host.contentView.children.includes(view), false)
    const discovered=await live.execute({action:'page.media.list',tabId:background.id,selector:'article[data-testid="tweet"]'})
    assert.ok(discovered.items.some(item=>item.url==='https://example.com/picture.png'))
    assert.equal(await view.webContents.executeJavaScript('scrollY'),0,'Media discovery must not scroll hidden pages')
    assert.equal(live.activeTabId,active.id)
    const observation=await live.execute({action:'observe',tabId:background.id});assert.match(observation.text,/Background post/)
    console.log('Background phase: diagnostics screenshot')
    const diagnostics=await live.execute({action:'page.diagnostics',tabId:background.id});assert.ok(diagnostics.screenshot.width>0)
    const wc = view.webContents, original = wc.executeJavaScript.bind(wc)
    let entered: () => void, complete: (value: unknown) => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const blocked = new Promise<unknown>(resolve => { complete = resolve })
    wc.executeJavaScript = () => { entered(); return blocked }
    const controller = new AbortController(), before = fs.readdirSync(root)
    const pending = live.execute({ action: 'media.screenshot', tabId: background.id, selector: 'article' }, { signal: controller.signal })
    const rejection = assert.rejects(pending, /cancelled/)
    const next = live.execute({ action: 'tabs.list' })
    await started
    controller.abort(new Error('fixture cancelled'))
    await rejection
    assert.equal((await next).activeTabId, active.id)
    complete({ ok: true, matches: 1, x: 0, y: 0, width: 560, height: 380 })
    await pause(0)
    assert.deepEqual(fs.readdirSync(root), before)
    wc.executeJavaScript = original
    for(const action of ['observe','page.media.list','page.diagnostics']){
      let enter:()=>void,finish:(value:unknown)=>void
      const entered=new Promise<void>(resolve=>{enter=resolve}),blockedRead=new Promise<unknown>(resolve=>{finish=resolve})
      wc.executeJavaScript=()=>{enter();return blockedRead}
      const cancel=new AbortController(),before=fs.readdirSync(root)
      const read=live.execute({action,tabId:background.id,selector:'article'},{signal:cancel.signal})
      const rejected=assert.rejects(read,/cancelled/),next=live.execute({action:'tabs.list'})
      await entered;cancel.abort(new Error('fixture cancelled'));await rejected;await next
      finish({ok:true,items:[],text:'late'});await pause(0);assert.deepEqual(fs.readdirSync(root),before)
      wc.executeJavaScript=original
    }
    console.log('Background phase: detached viewport screenshot')
    const viewport = await live.execute({ action: 'media.screenshot', tabId: background.id })
    assert.equal(viewport.width, 900 * scale)
    assert.equal(viewport.height, 700 * scale)
    // Oversized screenshot emulation must not enlarge the native browser surface
    // into the adjacent Assistant while retaining full emulated PNG capture.
    const page = live.tabs.get(active.id).view
    await page.webContents.loadURL('data:text/html,' + encodeURIComponent('<style>html,body{margin:0;background:#31aa77}</style><p>Viewport fixture</p>'))
    const adjacent = new WebContentsView({ webPreferences: { session: isolated, sandbox: true } })
    host.contentView.addChildView(adjacent)
    adjacent.setBounds({x:480,y:0,width:320,height:600})
    await adjacent.webContents.loadURL('data:text/html,' + encodeURIComponent('<style>html,body{margin:0;background:#aa3177}</style><p>Assistant fixture</p>'))
    host.setContentSize(800,600)
    live.setBounds({x:0,y:0,width:480,height:600})
    host.show()
    for (const [width,height] of [[1900,1000],[3840,2160],[640,360]]) {
      await live.execute({action:'page.viewport.set',tabId:active.id,width,height,deviceScaleFactor:1})
      assert.deepEqual(await page.webContents.executeJavaScript('({width:innerWidth,height:innerHeight})'),{width,height},'Requested screenshot layout is preserved')
      await pause(80)
      console.log('Background phase: native workspace capture',width,height)
      const surface = await page.webContents.capturePage()
      console.log('Background phase: native capture complete',surface.getSize())
      assert.deepEqual(surface.getSize(),{width:480*scale,height:600*scale},'Native capture retains the workspace pixel dimensions')
      console.log('Background phase: full emulated screenshot',width,height)
      const screenshot = await live.execute({action:'media.screenshot',tabId:active.id})
      assert.equal(screenshot.width,width);assert.equal(screenshot.height,height,'Full emulated screenshot extends beyond visible surface')
      live.showTab(background.id);live.showTab(active.id)
      live.setBounds({x:0,y:0,width:420,height:540})
      await pause(80)
      assert.deepEqual((await page.webContents.capturePage()).getSize(),{width:420*scale,height:540*scale},'Native capture follows workspace resizing after tab switching')
      live.setBounds({x:0,y:0,width:480,height:600})
    }
    await live.clearViewport(live.tabs.get(active.id))
    assert.deepEqual(await page.webContents.executeJavaScript('({width:innerWidth,height:innerHeight})'),{width:480,height:600})
    adjacent.webContents.close()
    console.log('PASS viewport emulation: 1900/3840/640px layouts and full PNGs retain native surface bounds through resize and tab switching')
    for (const item of live.tabs.values()) item.view.webContents.close()
    view = undefined
    process.stdout.write(JSON.stringify({ ok: true, backgroundElement: { width: artifact.width, height: artifact.height, exactPixel: true, offscreenWithoutScroll: true }, viewport: { width: viewport.width, height: viewport.height }, foregroundUnchanged: true, cancellationReleasesFIFO: true, lateResultNoArtifact: true }) + '\n')
  }
} catch (error) {
  code = 1
  process.stderr.write(String(error instanceof Error ? error.stack : error) + '\n')
} finally {
  if (view?.webContents && !view.webContents.isDestroyed()) view.webContents.close()
  host?.destroy()
  fs.rmSync(root, { recursive: true, force: true })
  app.exit(code)
}

}
void run()
