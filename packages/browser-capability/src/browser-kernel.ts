import {prepareVideoCapture} from './video-capture-ready.js'
import type {CapturePlayerState} from './video-capture-ready.js'
import {acquireVideoDelivery} from './video-acquisition.js'
import {textReadSummary,TextReadPageReader} from './text-read-pages.js'
import {discoveryAccountUrl,discoveryExpression,discoveryObservation} from './hotspot-discovery.js'
import {assertDiscoveryLeads} from '@bmw-agent/agent-contract/discovery'
import {collectPageSource} from './collect-page-source.js'
import {prepareSourceScreenshot} from './source-screenshot.js'
import {collectionPageReadyExpression,assertCollectionPageReady} from './collection-page-ready.js'
import type {CollectionPageReady} from './collection-page-ready.js'
import {navigatePage,closeNavigationPage,withNativePageRead} from './page-navigation.js'
import {sameVideoIdentity,resourceBelongsToTarget,selectVideoResource} from '@bmw-agent/agent-contract/video-identity'
import type {SourceCollection,ProjectSourcePort,SourceCaptureGuard,VideoTargetScope,TextReadDiagnostic,TextReadBatch,TextReadRow} from '@bmw-agent/media-native/sources'
import {readVideoTargets,prepareVideoTransfer} from './video-target.js'
import {registerYoutubeSabrPage,bindYoutubeSabrPage} from './youtube-sabr-observation.js'
import {assertPageScope,pageRangeExpression} from './page-scope.js'
import {assertPageTextFind,pageTextFindExpression} from './page-text-find.js'
import crypto from 'node:crypto'
import {PageRecordingEvents} from './page-recording-events.js'
import { readRendererPhase } from './renderer-read.js'
import { readScreenshotPhase } from './screenshot-read.js'
import { SessionOperations } from './session-operations.js'
import fs from 'node:fs'
import path from 'node:path'
import { nativeImage, WebContentsView, BrowserWindow, net } from 'electron'
import { assertBrowserRequest, BROWSER_ACTIONS, targetTabId } from './browser-schema.js'
import { agentTabsToClose, reusableTab, projectTabsToRestore, MAX_AGENT_TABS_PER_PROJECT } from './tab-policy.js'
import type {ProjectTabState} from './tab-policy.js'
import { downloadMediaArtifact } from './media-artifact.js'
import { createMediaSessionFetch } from './media-session-fetch.js'
import {preservationResult} from './preservation-result.js'
import {PagePlayback} from './page-playback.js'
import {withCollectionPagePool,collectionPageLinksExpression,collectionPageUrl,sameCollectionNavigation,textPageReadState,CollectionPageCleanupError,CollectionPageReadError} from './collection-page-pool.js'
import type {CollectionPagePoolOptions,CollectionPageVisit,CollectionPageResult,CollectionPageLink,CollectionPageRequest} from './collection-page-pool.js'
import type {ActiveProject} from './browser-host.js'

const PROJECT_BLANK_URL = 'about:blank'
function diagnosticUrl(raw:unknown):string{try{const url=new URL(String(raw));return ['https:','http:'].includes(url.protocol)?url.origin+url.pathname:''}catch{return ''}}
interface NavigationTab {id:string;projectId:string|null;view:WebContentsView;source?:string}
const SEMANTIC_CLASS_STATES = Object.freeze([
  'unread',
  'read',
  'selected',
  'active',
  'disabled',
  'checked',
  'flagged'
])
const SEMANTIC_ARIA_STATES = Object.freeze([
  'aria-checked',
  'aria-selected',
  'aria-expanded',
  'aria-current',
  'aria-disabled'
])

function normalizeUrl(input, settingsStore) {
  const value = String(input ?? '').trim()
  if (!value) return settingsStore?.newTabUrl() || 'https://www.google.com/'
  try {
    return new URL(value).toString()
  } catch {
    if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(value)) return `https://${value}`
    return settingsStore?.searchUrl(value) || `https://www.google.com/search?q=${encodeURIComponent(value)}`
  }
}

function safeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
}

export class BrowserKernel {
  [key: string]: any
  readonly detached:boolean
  beforeUserTask?:(input:unknown)=>void|Promise<void>

  constructor({ detached = false, window, session, permissionStore, sessionContinuity, projectStore, settingsStore, capabilityRegistry, allowedActions, artifactsDirectory, pageTheme = 'dark', onState, getCurrentSessionId = () => null, getSessionDriver = (_sessionId:string):string => {throw new Error('An explicit BMW Session driver is required')} }) {
    this.detached = detached
    if(detached)this.browserVisible=false
    this.getCurrentSessionId = getCurrentSessionId
    this.getSessionDriver = getSessionDriver
    this.window = window
    this.session = session
    this.permissionStore = permissionStore
    this.sessionContinuity = sessionContinuity
    this.projectStore = projectStore
    this.settingsStore = settingsStore
    this.capabilityRegistry = capabilityRegistry || null
    this.allowedActions = capabilityRegistry?.allowedActions || allowedActions || BROWSER_ACTIONS
    this.artifactsDirectory = artifactsDirectory
    this.pageTheme = pageTheme
    this.onState = onState
    this.tabs = new Map()
    this.activeTabId = null
    this.browserBounds = { x: 0, y: 64, width: 900, height: 700 }
    this.recordingController = null
    this.scheduledTaskManager = null
    this.tabStateTimer = null
    this.diagnostics = new Map()
  }

  setRecordingController(controller) {
    this.recordingController = controller
  }

  setScheduledTaskManager(manager) {
    this.scheduledTaskManager = manager
  }

  async initialize() {
    const project = this.projectStore?.active()
    if (project) return this.restoreProjectTabs(project)
    return this.openTab({ url: this.settingsStore?.newTabUrl(), foreground: true, source: 'user' })
  }

  private restoringTabState = false
  private readonly suspendedResearchProjects=new Set<string>()
  private readonly playback=new PagePlayback()
  private browserVisible=true
  private capturePlaybackTabId:string|null=null
  private playbackAllowed(tab:NavigationTab):boolean{return tab.id===this.capturePlaybackTabId||this.browserVisible&&!this.restoringTabState&&!this.suspendedResearchProjects.has(tab.projectId??'')&&tab.id===this.activeTabId&&(!this.projectStore||tab.projectId===this.projectStore.active().id)}
  private async applyPlayback(tab:NavigationTab,allowed:boolean,forcePause=false):Promise<void>{
    if(this.deferredNavigation.has(tab.id)){tab.view.webContents.setAudioMuted(true);return}
    try{await this.playback.update(tab.view.webContents,allowed,forcePause)}catch(error){this.#addDiagnostic(tab.id,'media',{message:'Playback policy remains muted; retry on frame load: '+String(error),at:Date.now()})}
  }
  private refreshPlayback(tab:NavigationTab):Promise<void>{return this.applyPlayback(tab,this.playbackAllowed(tab))}
  setBrowserVisible(visible:boolean):void{
    if(this.browserVisible===visible)return
    this.browserVisible=visible
    for(const tab of this.tabs.values())void this.refreshPlayback(tab).catch(error=>this.#addDiagnostic(tab.id,'media',{message:String(error),at:Date.now()}))
  }

  private async restoreProjectTabs(project: { id: string; homeUrl?: string; tabState?: ProjectTabState }) {
    // Snapshot before loading: browser events must not persist a partially restored set.
    const saved=projectTabsToRestore(project.tabState),entries=saved.tabs
    const activeUrl = saved.activeUrl || project.homeUrl || PROJECT_BLANK_URL
    if (!entries.length || !entries.some(t=>t.url===activeUrl)) entries.push({url:activeUrl,source:'user'})
    clearTimeout(this.tabStateTimer)
    this.restoringTabState = true
    try {
      for(const {url,source} of entries){
        if([...this.tabs.values()].some(tab=>tab.projectId===project.id&&tab.url===url))continue
        await this.openTab({url,foreground:false,source,reuse:false},undefined,undefined,true)
      }
      const owned = [...this.tabs.values()].filter(tab => tab.projectId === project.id)
      const active = owned.find(tab => tab.url === activeUrl) || owned.at(-1)
      await this.showTab(active.id)
      this.suspendedResearchProjects.delete(project.id)
      return this.serializeTab(active)
    } finally {
      this.restoringTabState = false
      await Promise.all([...this.tabs.values()].map(tab=>this.refreshPlayback(tab)))
      this.emitState()
    }
  }

  setBounds(bounds) {
    this.browserBounds = bounds
    for (const tab of this.tabs.values()) tab.view.setBounds(bounds)
  }

  #wireTab(tab) {
    const wc = tab.view.webContents
    wc.on('did-navigate',(_event,_url,status)=>{if(this.collectionBodyScope)this.collectionHTTPStatus=status})
    registerYoutubeSabrPage(this.session,wc)
    this.diagnostics.set(tab.id, { console: [], network: [], media: [], loadFailures: [] })
    const emit = () => {
      if(wc.isDestroyed())return
      tab.title = wc.getTitle() || 'New tab'
      tab.url = wc.getURL() || tab.url
      tab.loading = wc.isLoading()
      this.emitState()
    }
    if(this.detached){
      const allowed=(url:string)=>/^https?:\/\//i.test(url)
      wc.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault()})
      wc.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault()})
    }
    wc.on('page-title-updated', emit)
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)
    wc.on('did-navigate', emit)
    wc.on('did-navigate-in-page', emit)
    wc.on('did-navigate', () => { void this.#applyPageTheme(tab) })
    wc.setAudioMuted(true)
    const enforcePlayback=()=>{void this.refreshPlayback(tab).catch(error=>this.#addDiagnostic(tab.id,'media',{message:String(error),at:Date.now()}))}
    wc.on('did-frame-finish-load',enforcePlayback)
    wc.on('media-started-playing',enforcePlayback)
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.#addDiagnostic(tab.id, 'loadFailures', { errorCode, errorDescription, url: validatedURL, isMainFrame, at: Date.now() })
    })
    wc.on('console-message', (details) => {
      const message = String(details?.message || '')
      this.#addDiagnostic(tab.id, 'console', {
        level: details?.level || 'info',
        message: message.slice(0, 2000),
        source: details?.sourceId || '',
        line: details?.lineNumber || 0,
        at: Date.now()
      })
    })
    wc.setWindowOpenHandler(({ url }) => {
      if(this.detached)return {action:'deny'}
      // Popups opened by research pages share their disposable ownership and FIFO.
      // A page event must not create unbounded, falsely user-owned renderers.
      void this.operations.run(()=>{if(this.projectStore&&this.projectStore.active().id!==tab.projectId)throw new Error('Popup Project changed.')},()=>this.openTab({url,foreground:true,source:tab.source==='agent'?'agent':'page',reuse:false})).catch(error=>this.#addDiagnostic(tab.id,'loadFailures',{message:error instanceof Error?error.message:String(error),at:Date.now()}))
      return { action: 'deny' }
    })
  }

  private readonly networkRequests=new WeakMap<import('electron').WebContents,Map<string,{url:string;resourceType:string}>>()
  private readonly documentTransfers=new WeakMap<import('electron').WebContents,import('./page-navigation.js').DocumentTransfer&{requestId:string}>()
  private readonly offscreenPaintFrames=new WeakMap<import('electron').WebContents,number>()
  private readonly deferredNavigation=new Map<string,string>()
  private async ensureTabLoaded(tab:NavigationTab,signal?:AbortSignal):Promise<void>{
    const url=this.deferredNavigation.get(tab.id)
    if(url)await this.navigateTab(tab,url,signal)
  }
  private collectionBodyScope?:import('./collection-page-pool.js').CollectionPageSource
  private collectionRestricted=false
  private collectionHTTPStatus=0
  private collectionNavigationTimeoutMs=25000
  private readonly navigationQuarantine=new Set<string>()
  private dropNavigationTab(tab:NavigationTab):void{
    if(!this.tabs.has(tab.id))return
    if(!this.window.isDestroyed()&&this.window.contentView.children.includes(tab.view))this.window.contentView.removeChildView(tab.view)
    this.tabs.delete(tab.id);this.deferredNavigation.delete(tab.id);this.diagnostics.delete(tab.id);this.navigationQuarantine.delete(tab.id)
    if(this.activeTabId===tab.id){this.activeTabId=null;const next=[...this.tabs.values()].find((t:NavigationTab)=>t.projectId===tab.projectId&&!t.view.webContents.isDestroyed());if(next)void this.showTab(next.id).catch(error=>this.#addDiagnostic(next.id,'media',{message:String(error),at:Date.now()}))}
    this.emitState();this.scheduleTabStateSave()
  }
  private async navigateTab(tab:NavigationTab,url:string,signal?:AbortSignal,timeoutMs=this.collectionNavigationTimeoutMs):Promise<void>{
    this.deferredNavigation.delete(tab.id)
    if(!tab.view.webContents.getURL())await navigatePage(tab.view.webContents,PROJECT_BLANK_URL,signal,3000,3000,tab.source==='agent')
    await readRendererPhase(tab.view.webContents,'page.diagnostics','network-observer',()=>this.#applyPageTheme(tab),signal,2000)
    const scope=this.collectionBodyScope??{bodySelector:'body'}
    let previous='',quietSince=0;const ready=async()=>{const value=await readRendererPhase<CollectionPageReady>(tab.view.webContents,'collection.pages','navigation-ready',async()=>assertCollectionPageReady(await tab.view.webContents.mainFrame.executeJavaScript(collectionPageReadyExpression(scope),true)),signal,1500);if(!sameCollectionNavigation(url,value.url)||(!value.ready&&!value.restricted)){previous='';return false}if(value.restricted||[401,403,429].includes(this.collectionHTTPStatus)){this.collectionRestricted=true;return true}if(value.text!==previous){previous=value.text;quietSince=Date.now();return false}return Date.now()-quietSince>=250}
    const videoAddress=new URL(url),youtubeTarget=['youtube.com','www.youtube.com','m.youtube.com'].includes(videoAddress.hostname)?videoAddress.searchParams.get('v'):null
    const videoReady=youtubeTarget?async()=>readRendererPhase<boolean>(tab.view.webContents,'navigate','youtube-player-ready',async()=>await tab.view.webContents.mainFrame.executeJavaScript(`(()=>{const p=document.getElementById('movie_player'),v=p?.querySelector('video'),d=typeof p?.getVideoData==='function'?p.getVideoData():null;return d?.video_id===${JSON.stringify(youtubeTarget)}&&!p.classList.contains('ad-showing')&&v?.videoWidth>0&&Number.isFinite(v.duration)&&v.duration>0})()`,true) as boolean,signal,1000):undefined
    try{await navigatePage(tab.view.webContents,url,signal,videoReady&&!this.collectionBodyScope?90000:timeoutMs,3000,tab.source==='agent',videoReady&&!this.collectionBodyScope?videoReady:this.collectionBodyScope&&!['x.com','twitter.com'].includes(new URL(url).hostname.replace(/^www\./,''))?ready:undefined,entry=>this.#addDiagnostic(tab.id,'network',{type:'navigation',url:diagnosticUrl(url),...entry,at:Date.now()}))}catch(error){if(tab.view.webContents.isDestroyed())this.dropNavigationTab(tab);else if(error instanceof Error&&'code'in error&&error.code==='BMW_BROWSER_NAVIGATION_CLEANUP_FAILED')this.navigationQuarantine.add(tab.id);throw error}
  }
  async openTab({ url, foreground = false, source = 'agent', reuse = true }: { url?: unknown; foreground?: boolean; source?: string; reuse?: boolean } = {},signal?:AbortSignal,navigationTimeoutMs?:number,deferNavigation=false) {
    if(this.navigationQuarantine.size)throw new Error('BMW_BROWSER_NAVIGATION_QUARANTINED: Explicit close recovery is required.')
    const projectId = this.projectStore?.active().id || null
    const targetUrl = normalizeUrl(url, this.settingsStore)
    if (source === 'agent') {
      const reusable = reusableTab([...this.tabs.values()], { projectId, targetUrl, reuse })
      if (reusable) {
        reusable.tab.lastUsedAt = Date.now()
        if (reusable.navigate) await this.navigateTab(reusable.tab,targetUrl,signal)
        else await this.ensureTabLoaded(reusable.tab,signal)
        if (foreground) await this.showTab(reusable.tab.id)
        else this.emitState()
        await this.enforceAgentTabLimit(projectId, reusable.tab.id)
        return { ...this.serializeTab(reusable.tab), reused: true, reuseReason: reusable.reason }
      }
    }
    if(source==='agent'&&this.recordingController?.isCaptureActive?.()&&[...this.tabs.values()].filter(tab=>tab.projectId===projectId&&tab.source==='agent').length>=MAX_AGENT_TABS_PER_PROJECT)throw new Error('Finish the current media job before reclaiming research tabs.')
    const id = crypto.randomUUID()
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: !this.detached,
        ...(this.detached?{disableDialogs:true}:{})
        ,...(this.detached?{offscreen:true}:{})
      }
    })
    view.setBounds(this.browserBounds)
    const tab = {
      id,
      view,
      projectId,
      title: 'New tab',
      url: targetUrl,
      loading: true,
      source,
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    }
    this.tabs.set(id, tab)
    if(this.detached){const contents=view.webContents;this.offscreenPaintFrames.set(contents,0);contents.on('paint',()=>{if(!contents.isDestroyed())this.offscreenPaintFrames.set(contents,(this.offscreenPaintFrames.get(contents)??0)+1)});contents.setFrameRate(10)}
    if(deferNavigation){this.deferredNavigation.set(id,targetUrl);tab.loading=false;tab.title=targetUrl}
    this.#wireTab(tab)
    view.setBackgroundColor(this.pageTheme === 'dark' ? '#0a0d12' : '#ffffff')
    if (foreground || !this.activeTabId) await this.showTab(id)
    else this.emitState()
    // Admission is bounded even if the next page fails its native load.
    if (source === 'agent') await this.enforceAgentTabLimit(projectId, id)
    if(!deferNavigation)await this.navigateTab(tab,targetUrl,signal,navigationTimeoutMs)
    return { ...this.serializeTab(tab), reused: false }
  }

  async #applyPageTheme(tab) {
    const wc = tab?.view?.webContents
    if (!wc || wc.isDestroyed()) return
    const dark = this.pageTheme === 'dark'
    try {
      tab.view.setBackgroundColor(dark ? '#0a0d12' : '#ffffff')
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      if (!tab.debuggerWired) {
        tab.debuggerWired = true
        const requests=new Map<string,{url:string;resourceType:string}>();this.networkRequests.set(wc,requests)
        wc.debugger.on('message', (_event, method, params) => {
          const requestId=String(params?.requestId??'')
          if(method==='Network.requestWillBeSent'&&params?.type==='Document'&&requestId)this.documentTransfers.set(wc,{requestId,url:diagnosticUrl(params?.request?.url),status:0,receivedBytes:0,lastDataAt:0,completed:false,failed:false})
          const transfer=this.documentTransfers.get(wc)
          if(transfer?.requestId===requestId){
            if(method==='Network.responseReceived')transfer.status=Number(params?.response?.status??0)
            if(method==='Network.dataReceived'&&Number(params?.dataLength)>0){transfer.receivedBytes=Math.min(50000000,transfer.receivedBytes+Number(params.dataLength));transfer.lastDataAt=Date.now()}
            if(method==='Network.loadingFinished')transfer.completed=true
            if(method==='Network.loadingFailed')transfer.failed=true
          }
          if(method==='Network.requestWillBeSent'&&requestId){const url=diagnosticUrl(params?.request?.url);if(url){requests.set(requestId,{url,resourceType:String(params?.type??'')});while(requests.size>200)requests.delete(requests.keys().next().value!)}}
          if(method==='Network.loadingFinished')requests.delete(requestId)
          if (method === 'Network.loadingFailed') {const request=requests.get(requestId);this.#addDiagnostic(tab.id, 'network', { type: 'failed',url:request?.url??diagnosticUrl(params?.url),resourceType:request?.resourceType??String(params?.type??''), errorText: String(params?.errorText??'').slice(0,500),requestId:requestId.slice(0,100),...(typeof params?.canceled==='boolean'?{canceled:params.canceled}:{}),...(typeof params?.blockedReason==='string'?{blockedReason:params.blockedReason.slice(0,100)}:{}), at: Date.now() });requests.delete(requestId)}
          if (method === 'Network.responseReceived' && (Number(params?.response?.status) >= 400||['Document','Script','Fetch','XHR'].includes(String(params?.type??'')))) {
            this.#addDiagnostic(tab.id, 'network', { type: 'response', url: diagnosticUrl(params?.response?.url),resourceType:String(params?.type??''), status: params?.response?.status, statusText: String(params?.response?.statusText??'').slice(0,200), at: Date.now() })
          }
          if (method === 'Network.responseReceived') {
            const resourceType = String(params?.type || '')
            const mimeType = String(params?.response?.mimeType || '')
            if (['Image', 'Media'].includes(resourceType) || /^(?:image|video|audio)\//i.test(mimeType)||/mpegurl/i.test(mimeType)||/\.m3u8(?:\?|$)/i.test(String(params?.response?.url??''))) {
              this.#addDiagnostic(tab.id, 'media', {
                url: params?.response?.url || '',
                mimeType,
                resourceType,
                status: params?.response?.status || 0,
                at: Date.now()
              })
            }
          }
        })
        await wc.debugger.sendCommand('Network.enable').catch(() => {})
      }
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
        media: '',
        features: [{ name: 'prefers-color-scheme', value: this.pageTheme }]
      })
      await wc.debugger.sendCommand('Emulation.setDefaultBackgroundColorOverride', {
        color: dark ? { r: 10, g: 13, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
      })
      await wc.debugger.sendCommand('Emulation.setAutoDarkModeOverride', { enabled: dark }).catch(() => {})
    } catch (error) {
      console.error(`Failed to apply BMW page theme to ${tab.url || 'new tab'}`, error)
    }
  }

  async setPageTheme(theme) {
    this.pageTheme = theme === 'light' ? 'light' : 'dark'
    await Promise.all([...this.tabs.values()].map((tab) => this.#applyPageTheme(tab)))
    return { theme: this.pageTheme, tabs: this.tabs.size }
  }

  async enforceAgentTabLimit(projectId, keepTabId) {
    const stale = agentTabsToClose([...this.tabs.values()], {
      projectId,
      activeTabId: this.activeTabId,
      keepTabId
    })
    for (const tab of stale) await this.closeTab(tab.id)
  }

  async showTab(tabId,signal?:AbortSignal) {
    const tab = this.requireTab(tabId)
    if(!this.restoringTabState)await this.ensureTabLoaded(tab,signal)
    if(this.detached){this.activeTabId=tab.id;if(!this.window.contentView.children.includes(tab.view))this.window.contentView.addChildView(tab.view);tab.view.setBounds({x:0,y:0,width:this.browserBounds.width,height:this.browserBounds.height});tab.view.setVisible(true);await this.applyPlayback(tab,false,true);return this.serializeTab(tab)}
    const previous = this.tabs.get(this.activeTabId)
    if (previous && previous.id !== tab.id){this.activeTabId=tab.id;await this.applyPlayback(previous,false);this.window.contentView.removeChildView(previous.view)}
    if (!this.window.contentView.children.includes(tab.view)) this.window.contentView.addChildView(tab.view)
    tab.view.setBounds(this.browserBounds)
    tab.view.setVisible(true)
    this.activeTabId = tab.id
    await this.refreshPlayback(tab)
    tab.lastUsedAt = Date.now()
    this.emitState()
    return this.serializeTab(tab)
  }

  private async destroyTab(tab:NavigationTab):Promise<void>{
    try{await closeNavigationPage(tab.view.webContents)}catch(error){this.navigationQuarantine.add(tab.id);throw error}
    if(!this.window.isDestroyed()&&this.window.contentView.children.includes(tab.view))this.window.contentView.removeChildView(tab.view)
    this.tabs.delete(tab.id);this.deferredNavigation.delete(tab.id);this.diagnostics.delete(tab.id);this.navigationQuarantine.delete(tab.id)
    if(this.activeTabId===tab.id)this.activeTabId=null
  }

  private readonly collectionPageLanes=new Set<BrowserKernel>()
  private readonly collectionSurfaces=new Map<BrowserKernel,{window:BrowserWindow;contents:import('electron').WebContents}>()
  private async disposeCollectionLane(kernel:BrowserKernel):Promise<void>{
    await kernel.closeDetached()
    const surface=this.collectionSurfaces.get(kernel)
    if(surface&&!surface.contents.isDestroyed())await closeNavigationPage(surface.contents,3000)
    if(surface&&!surface.window.isDestroyed())surface.window.destroy()
    if(surface&&(!surface.window.isDestroyed()||!surface.contents.isDestroyed()))throw new CollectionPageCleanupError('Collection surface did not close')
    this.collectionSurfaces.delete(kernel);this.collectionPageLanes.delete(kernel)
  }
  private collectionPagePoolRunning=false
  private collectionPagePoolQuarantined=false
  ownsCollectionWebContents(contents:import('electron').WebContents):boolean{return [...this.collectionPageLanes].some(kernel=>kernel.ownsWebContents(contents))}
  ownsWebContents(contents:import('electron').WebContents):boolean{return [...this.tabs.values()].some((tab:NavigationTab)=>tab.view.webContents===contents)||this.ownsCollectionWebContents(contents)}
  /** Revocation happens at Bridge first; actual renderer destruction is awaited. */
  async closeDetached():Promise<void>{
    if(!this.detached)throw new Error('Only disposable collection browsers may be closed here')
    await this.operations.drain()
    if(this.collectionPageLanes.size)throw new CollectionPageCleanupError('Collection pages require explicit cleanup recovery')
    for(const tab of [...this.tabs.values()])await this.destroyTab(tab)
  }
  async closeTab(tabId) {
    const tab = this.requireTab(tabId)
    if(this.recordingController?.isCaptureActive?.())throw new Error('Finish the current media job before closing a page.')
    const recovered=this.navigationQuarantine.has(tab.id)
    const wasActive = this.activeTabId === tabId
    await this.destroyTab(tab)
    if (wasActive) {
      this.activeTabId = null
      const projectId = this.projectStore?.active().id
      const next = [...this.tabs.values()]
        .filter((candidate) => !projectId || candidate.projectId === projectId)
        .sort((left, right) => Number(right.lastUsedAt || right.createdAt || 0) - Number(left.lastUsedAt || left.createdAt || 0))[0]
      if (next) await this.showTab(next.id)
      else await this.openTab({ url: PROJECT_BLANK_URL, foreground: true, source: 'user' })
    }
    this.emitState()
    this.scheduleTabStateSave()
    return { closed: tabId,...(recovered?{recovered:true}:{}) }
  }

  requireTab(tabId) {
    const resolved = tabId || this.activeTabId
    const tab = this.tabs.get(resolved)
    if (!tab) throw new Error(`Unknown tab: ${String(resolved)}`)
    const activeProjectId = this.projectStore?.active().id
    if (activeProjectId && tab.projectId !== activeProjectId) throw new Error('The requested tab belongs to another BMW project.')
    return tab
  }

  serializeTab(tab) {
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      loading: tab.loading,
      deferred: this.deferredNavigation.has(tab.id),
      active: tab.id === this.activeTabId,
      source: tab.source,
      projectId: tab.projectId
    }
  }

  state() {
    const active = this.tabs.get(this.activeTabId)
    const activeProject = this.projectStore?.active()
    return {
      activeTabId: this.activeTabId,
      tabs: [...this.tabs.values()]
        .filter((tab) => !activeProject || tab.projectId === activeProject.id)
        .map((tab) => this.serializeTab(tab)),
      agentControlGranted: this.permissionStore.hasAgentControl(),
      collection:{running:this.collectionPagePoolRunning,quarantined:this.collectionPagePoolQuarantined,surfaces:this.collectionSurfaces.size,pages:[...this.collectionPageLanes].reduce((count,kernel)=>count+kernel.tabs.size,0)},
      sessionContinuity: this.sessionContinuity?.status(active?.url) || null,
      activeProject: activeProject ? { id: activeProject.id, name: activeProject.name } : null
    }
  }

  activeUrl() {
    return this.tabs.get(this.activeTabId)?.url || ''
  }

  activePageMetadata() {
    const tab = this.requireTab(this.activeTabId)
    return { id: tab.id, title: tab.title, url: tab.url }
  }

  isActivePageWebContents(webContents) {
    return Boolean(webContents) && this.tabs.get(this.activeTabId)?.view.webContents === webContents
  }

  async saveActivePage(fullPath, saveType) {
    const tab = this.requireTab(this.activeTabId)
    await this.ensureTabLoaded(tab)
    await tab.view.webContents.savePage(fullPath, saveType)
    return { ...this.serializeTab(tab), fullPath, saveType }
  }

  emitState() {
    this.onState?.(this.state())
    this.scheduleTabStateSave()
  }

  scheduleTabStateSave() {
    if (this.detached || !this.projectStore || this.restoringTabState) return
    clearTimeout(this.tabStateTimer)
    this.tabStateTimer = setTimeout(() => {
      const project = this.projectStore.active()
      this.saveTabState(project.id)
    }, 500)
    this.tabStateTimer.unref?.()
  }

  saveTabState(projectId) {
    if (this.detached || !this.projectStore || !projectId) return
    const tabs = [...this.tabs.values()].filter((tab) => tab.projectId === projectId)
    const active = this.tabs.get(this.activeTabId)
    this.projectStore.updateTabState(projectId, {
      urls: tabs.map((tab) => tab.url),
      tabs:tabs.filter(tab=>/^https?:\/\//i.test(tab.url)).map(tab=>({url:tab.url,source:tab.source})),
      activeUrl: active?.projectId === projectId ? active.url : null
    })
  }

  /** Called under the Host Project-transition lock, before changing the active owner.
   * Save URLs/ownership first; only Agent renderers are released. User pages remain live. */
  async releaseProjectResearchTabs():Promise<void>{
    if(this.recordingController?.isCaptureActive?.())throw new Error('Finish the current media job before changing Projects.')
    const projectId=this.projectStore?.active().id
    if(!projectId)return
    this.saveTabState(projectId);clearTimeout(this.tabStateTimer);this.restoringTabState=true
    try{for(const tab of [...this.tabs.values()].filter(tab=>tab.projectId===projectId))await this.applyPlayback(tab,false);for(const tab of [...this.tabs.values()].filter(tab=>tab.projectId===projectId&&tab.source==='agent'))await this.destroyTab(tab);this.suspendedResearchProjects.add(projectId)}
    catch(error){this.onState?.(this.state());throw error}
    finally{this.restoringTabState=false}
  }

  async switchProject(project) {
    const previous = this.tabs.get(this.activeTabId)
    if (previous&&!this.suspendedResearchProjects.has(previous.projectId)) this.saveTabState(previous.projectId)
    if (previous){await this.applyPlayback(previous,false);this.window.contentView.removeChildView(previous.view)}
    this.activeTabId = null
    return this.restoreProjectTabs(project)
  }

  private readonly operations = new SessionOperations()
  get busy():boolean { return this.operations.busy||this.navigationQuarantine.size>0||this.collectionPagePoolRunning||this.collectionPagePoolQuarantined }

  /** Native Shell work shares FIFO and Project exclusion, without a model action. */
  async runUserMediaTask<T>(projectId:string,operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
    await this.beforeUserTask?.({action:'media.user-task'})
    return this.operations.run(()=>{
      signal?.throwIfAborted()
      if(this.collectionPagePoolQuarantined)throw new CollectionPageCleanupError('Collection page cleanup requires explicit recovery')
      if(this.navigationQuarantine.size)throw new Error('BMW_BROWSER_NAVIGATION_QUARANTINED: Explicit close recovery is required.')
      if(this.projectStore.active().id!==projectId)throw new Error('试听所属 Project 已改变，请重试。')
      if(this.recordingController.isCaptureActive())throw new Error('请等待当前媒体任务完成后再试听。')
    },operation)
  }

  async execute(rawRequest, { actor = 'agent', signal, sessionOwner }: { actor?: string; signal?: AbortSignal; sessionOwner?:import('./browser-host.js').BrowserSessionOwner } = {}) {
    if(actor==='user')await this.beforeUserTask?.(rawRequest)
    const owner=sessionOwner?{projectId:sessionOwner.projectId,sessionId:sessionOwner.sessionId}:undefined
    return this.operations.run(() => { signal?.throwIfAborted() }, () => this.executeAction(rawRequest, { actor, signal, sessionOwner:owner }))
  }

  private async executeAction(rawRequest, { actor = 'agent', signal, sessionOwner }: { actor?: string; signal?: AbortSignal; sessionOwner?:import('./browser-host.js').BrowserSessionOwner } = {}) {
    const request = this.capabilityRegistry?this.capabilityRegistry.assertRequest(rawRequest):assertBrowserRequest(rawRequest, this.allowedActions)
    if(this.collectionPagePoolQuarantined&&!['status','tabs.list','help'].includes(request.action))throw new CollectionPageCleanupError('Collection page cleanup requires explicit trusted recovery')
    if(this.navigationQuarantine.size&&!['status','tabs.list','help','tabs.close'].includes(request.action))throw new Error('BMW_BROWSER_NAVIGATION_QUARANTINED: Explicitly close the failed page before starting more work.')
    if (!this.permissionStore.hasAgentControl() && request.action !== 'status') {
      const error = new Error('BMW agent control has not been granted. Ask the user to click “Enable agent control” once in the product toolbar.')
      ;(error as Error & { code?: string }).code = 'PERMISSION_REQUIRED'
      throw error
    }

    if (request.action === 'status') return this.state()
    if (request.action === 'tabs.list') return this.state()
    if (request.action === 'help') return this.capabilityRegistry?this.capabilityRegistry.help(request.forAction,{forOperation:request.forOperation,forSubOperation:request.forSubOperation}):{actions:this.allowedActions}
    const contributed = await this.capabilityRegistry?.execute(request.action, { browserKernel: this, actor, signal, sessionOwner }, request)
    if (contributed?.handled) return contributed.value
    if (request.action === 'project.context') {
      const project = this.projectStore.active()
      return {
        project: { id: project.id, name: project.name, homeUrl: project.homeUrl },
        instructions: this.projectStore.readDocument(project.id, 'instructions').content.slice(0, 20_000),
        memory: this.projectStore.readDocument(project.id, 'memory').content.slice(0, 20_000),
        tasks: this.projectStore.readDocument(project.id, 'tasks').content.slice(0, 12_000)
      }
    }
    if (request.action === 'project.memory.append' || request.action === 'project.tasks.append') {
      if (typeof request.content !== 'string' || !request.content.trim()) throw new Error(`${request.action} requires non-empty content.`)
      const project = this.projectStore.active()
      const kind = request.action === 'project.memory.append' ? 'memory' : 'tasks'
      const result = this.projectStore.appendDocument(project.id, kind, request.content)
      return { projectId: project.id, kind, bytes: Buffer.byteLength(result.content, 'utf8') }
    }
    if (request.action.startsWith('schedule.')) {
      if (!this.scheduledTaskManager) throw new Error('BMW scheduled tasks are unavailable.')
      const project = this.projectStore.active()
      if (request.action === 'schedule.list') return this.scheduledTaskManager.list(project.id)
      if (request.action === 'schedule.create') {
        const sessionId=sessionOwner?.sessionId??this.getCurrentSessionId()
        return this.scheduledTaskManager.create({id:project.id,sessionId,driverId:this.getSessionDriver(sessionId)}, {
          name: request.scheduleName,
          prompt: request.schedulePrompt,
          time: request.scheduleTime,
          timeZone: request.scheduleTimeZone,
          enabled: request.scheduleEnabled
        })
      }
      const taskId = typeof request.scheduledTaskId === 'string' ? request.scheduledTaskId : ''
      if (!taskId) throw new Error(`${request.action} requires scheduledTaskId.`)
      if (request.action === 'schedule.update') {
        return this.scheduledTaskManager.update(project.id, taskId, {
          ...(request.scheduleName !== undefined ? { name: request.scheduleName } : {}),
          ...(request.schedulePrompt !== undefined ? { prompt: request.schedulePrompt } : {}),
          ...(request.scheduleTime !== undefined ? { time: request.scheduleTime } : {}),
          ...(request.scheduleTimeZone !== undefined ? { timeZone: request.scheduleTimeZone } : {}),
          ...(request.scheduleEnabled !== undefined ? { enabled: request.scheduleEnabled } : {})
        })
      }
      if (request.action === 'schedule.remove') return this.scheduledTaskManager.remove(project.id, taskId)
      if (request.action === 'schedule.run') return this.scheduledTaskManager.runNow(project.id, taskId)
    }
    if (request.action === 'tabs.open') {
      return this.openTab({
        url: request.url,
        foreground: request.foreground === true,
        source: actor === 'user' ? 'user' : 'agent',
        reuse: actor === 'agent' ? request.reuse !== false : false
      },signal)
    }
    if(request.action==='pages.read'||request.action==='pages.discover')return this.readTextPages(request.urls as string[],signal,request.action==='pages.discover')
    if(request.action==='pages.read-result')return this.readTextPageResult(request,signal,sessionOwner)
    if (request.action === 'tabs.show') return this.showTab(targetTabId(request),signal)
    if (request.action === 'tabs.close'){const id=targetTabId(request),tab=this.requireTab(id);if(this.navigationQuarantine.has(tab.id)&&tab.source!=='agent'&&actor!=='user')throw new Error('BMW_BROWSER_USER_RECOVERY_REQUIRED: Close the retained user page from BMW before continuing.');return this.closeTab(id)}

    if(request.action==='media.audio.preview'){
      if(!this.projectStore.active()?.directory||this.recordingController.isCaptureActive())throw new Error('Audio preview requires an idle active Project.')
      return this.recordingController.previewAudio(request,signal)
    }
    if (['media.inspect', 'media.segment', 'media.frames.sample','media.capture.frames.sample', 'media.convert','media.image.inspect','media.image.annotate','media.image.draw','media.audio.sample','media.speech.align'].includes(request.action)) {
      if (!this.projectStore.active()?.directory) throw new Error('Media processing requires an active BMW Project.')
      const {tabId:ignored,...mediaRequest}=request;void ignored
      return this.recordingController.processArtifact(mediaRequest, signal)
    }

    const tab = this.requireTab(targetTabId(request))
    tab.lastUsedAt = Date.now()
    const wc = tab.view.webContents
    if (request.action === 'navigate') {
      await this.navigateTab(tab,normalizeUrl(request.url, this.settingsStore),signal)
      return this.serializeTab(tab)
    }
    await this.ensureTabLoaded(tab,signal)
    if (request.action === 'back') {
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
      return this.serializeTab(tab)
    }
    if (request.action === 'forward') {
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
      return this.serializeTab(tab)
    }
    if (request.action === 'reload') {
      wc.reload()
      return this.serializeTab(tab)
    }
    if (request.action === 'wait') {
      const milliseconds = Math.min(Math.max(Number(request.milliseconds) || 500, 50), 10_000)
      await new Promise((resolve) => setTimeout(resolve, milliseconds))
      return { waited: milliseconds, tab: this.serializeTab(tab) }
    }
    if (request.action === 'key') return this.key(tab, request)
    if (request.action === 'hover') return this.hover(tab, request)
    if (request.action === 'observe') return this.observe(tab, request, signal)
    if (request.action === 'page.text.find') return {tab:this.serializeTab(tab),...await readRendererPhase<Record<string,unknown>>(tab.view.webContents,'page.text.find','dom',()=>tab.view.webContents.executeJavaScript(pageTextFindExpression(assertPageTextFind(request)),true),signal)}
    if (request.action === 'page.diagnostics') return this.pageDiagnostics(tab, request, signal)
    if (request.action === 'page.media.list') return this.listMedia(tab, request, signal)
    if (request.action === 'page.viewport.set') return this.setViewport(tab, request)
    if (request.action === 'click') return this.click(tab, request)
    if (request.action === 'type') return this.type(tab, request)
    if (request.action === 'media.screenshot') return this.screenshot(tab, request, signal)
    if (request.action === 'media.download') return this.downloadMedia(tab, request, signal)
    if(request.action==='media.preserve'){
      const observed=await this.listMedia(tab,{maxItems:200},signal)
      if(!observed.items.some((item:{url?:string})=>item.url===request.url))throw new Error('Preservation URL must be observed on this Project page with page.media.list.')
      return preservationResult(await this.preserveSource({url:String(request.url),pageUrl:new URL(tab.view.webContents.getURL()).href.split('#')[0],tabId:tab.id},signal))
    }
    if (request.action === 'media.video.capture') return this.captureSelectedVideo(tab, request, signal)
    if (request.action === 'media.record.start') {
      const source=await new PageRecordingEvents(tab.view.webContents,()=>{void this.recordingController.stop().catch(()=>{})},()=>tab.view.getBounds()).prepare()
      tab.recordingEvents=source
      try{return await this.recordingController.start(tab,request,source,signal)}catch(error){await source.dispose();delete tab.recordingEvents;throw error}
    }
    if (request.action === 'media.record.stop') return this.recordingController.stop(request)
    throw new Error(`Unimplemented browser action: ${request.action}`)
  }

  async observe(tab, request, signal?:AbortSignal) {
    const scope=assertPageScope(request)
    const result = await readRendererPhase<{title:string;url:string;text:string;interactive:unknown[];semantic:unknown[]}>(tab.view.webContents, 'observe', 'dom', () => tab.view.webContents.executeJavaScript(`(() => {
      const {root,exclude,text,range}=${pageRangeExpression(scope)}
      const isVisible = (element) => {
        if(element.closest(${JSON.stringify(['script','style','template','noscript','[hidden]','[aria-hidden="true"]',...scope.excludeSelectors].join(','))}))return false
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      }
      const classStates = ${JSON.stringify(SEMANTIC_CLASS_STATES)}
      const ariaStates = ${JSON.stringify(SEMANTIC_ARIA_STATES)}
      const interactive = [...(root?.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')??[])]
        .filter(isVisible)
        .slice(0, 160)
        .map((element, index) => ({
          index,
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute('type'),
          text: (element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 240),
          ariaLabel: element.getAttribute('aria-label'),
          href: element.href || null
        }))
      const semantic = [...(root?.querySelectorAll([
        'li',
        'tr',
        '[role]',
        '[aria-checked]',
        '[aria-selected]',
        '[aria-expanded]',
        '[aria-current]',
        '[aria-disabled]',
        '[data-state]',
        '[data-read]',
        '[data-unread]',
        ...classStates.map((state) => '.' + state)
      ].join(','))??[])]
        .filter(isVisible)
        .slice(0, 240)
        .map((element, index) => {
          const states = classStates.filter((state) => element.classList.contains(state))
          for (const property of ['checked', 'disabled', 'selected']) {
            if (element[property] === true && !states.includes(property)) states.push(property)
          }
          for (const attribute of ariaStates) {
            if (element.hasAttribute(attribute)) states.push(attribute + ':' + element.getAttribute(attribute))
          }
          for (const attribute of ['data-state', 'data-read', 'data-unread']) {
            if (element.hasAttribute(attribute)) states.push(attribute + ':' + element.getAttribute(attribute))
          }
          return {
            index,
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role'),
            text: (element.innerText || element.getAttribute('aria-label') || '')
              .trim()
              .replace(/\\s+/g, ' ')
              .slice(0, 500),
            states
          }
        })
      return {
        title: document.title,
        url: location.href,
        text,
        range,
        interactive,
        semantic
      }
    })()`, true), signal)
    return { tab: this.serializeTab(tab), ...result }
  }

  async click(tab, request) {
    const selector = typeof request.selector === 'string' ? request.selector : null
    const text = typeof request.text === 'string' ? request.text : null
    if (!selector && !text) throw new Error('click requires selector or text')
    const result = await tab.view.webContents.executeJavaScript(`(() => {
      const selector = ${JSON.stringify(selector)}
      const text = ${JSON.stringify(text)}
      const candidates = [...document.querySelectorAll('a,button,input,[role="button"],[role="link"],summary,label')]
      const element = selector ? document.querySelector(selector) : candidates.find((candidate) =>
        (candidate.innerText || candidate.value || candidate.getAttribute('aria-label') || '').trim().includes(text)
      )
      if (!element) return { ok: false, reason: 'element-not-found' }
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const rect=element.getBoundingClientRect();const recordingEvent={epochMs:performance.timeOrigin+performance.now(),kind:'click',source:'agent-action',x:Math.max(0,Math.min(innerWidth,rect.x+rect.width/2)),y:Math.max(0,Math.min(innerHeight,rect.y+rect.height/2)),viewportWidth:innerWidth,viewportHeight:innerHeight,dpr:devicePixelRatio,scrollX:Math.max(0,scrollX),scrollY:Math.max(0,scrollY)}
      element.click()
      return { recordingEvent, ok: true, tag: element.tagName.toLowerCase(), text: (element.innerText || element.value || '').trim().slice(0, 200) }
    })()`, true)
    if (!result.ok) throw new Error(result.reason)
    tab.recordingEvents?.agentClick(result.recordingEvent)
    delete result.recordingEvent
    return result
  }

  async type(tab, request) {
    if (typeof request.selector !== 'string' || typeof request.value !== 'string') {
      throw new Error('type requires selector and value')
    }
    const result = await tab.view.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(request.selector)})
      if (!element) return { ok: false, reason: 'element-not-found' }
      element.focus()
      const value = ${JSON.stringify(request.value)}
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      if (descriptor?.set) descriptor.set.call(element, value)
      else element.value = value
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, valueLength: value.length }
    })()`, true)
    if (!result.ok) throw new Error(result.reason)
    return result
  }

  #addDiagnostic(tabId, kind, value) {
    const state = this.diagnostics.get(tabId)
    if (!state || !Array.isArray(state[kind])) return
    state[kind].push(value)
    state[kind] = state[kind].slice(-200)
  }

  resetDiagnostics(tabId) {
    this.requireTab(tabId)
    this.diagnostics.set(tabId, { console: [], network: [], media: [], loadFailures: [] })
  }

  diagnosticsFor(tabId) {
    return structuredClone(this.diagnostics.get(tabId) || { console: [], network: [], media: [], loadFailures: [] })
  }

  projectSources?:()=>ProjectSourcePort
  capturedVideoOrigin?:import('./browser-host.js').BrowserFeatureHost['capturedVideoOrigin']
  sourcePages():{id:string;url:string;title:string}[]{return this.state().tabs.map(tab=>({id:tab.id,url:tab.url,title:tab.title}))}
  async downloadSource(request:{url:string;pageUrl:string;filename:string;tabId?:string;sourceGuard?:SourceCaptureGuard},signal?:AbortSignal):Promise<unknown>{
    const tab=this.requireTab(request.tabId),address=new URL(tab.view.webContents.getURL());address.hash=''
    if(address.href!==request.pageUrl)throw new Error('Source page changed; return to the observed page before acquiring media.')
    return this.downloadMedia(tab,{url:request.url,filename:request.filename,sourceGuard:request.sourceGuard},signal)
  }
  async preserveSource(request:{url:string;pageUrl:string;tabId?:string;sourceGuard?:SourceCaptureGuard},signal?:AbortSignal):Promise<unknown>{
    const tab=this.requireTab(request.tabId),project=this.projectStore.active(),address=new URL(tab.view.webContents.getURL());address.hash=''
    if(address.href!==request.pageUrl)throw new Error('Source page changed; return to the observed page before preserving media.')
    const admission=await prepareVideoTransfer(tab.view.webContents,request.url,signal,request.sourceGuard)
    const selected=admission.target?.resources.find(r=>r.url===request.url)
    const sabr=selected?.role==='sabr'?await bindYoutubeSabrPage(tab.view.webContents,admission.target!,request.url,request.sourceGuard?.scope??{},signal):undefined
    const guard=async(force=false)=>{signal?.throwIfAborted();if(this.projectStore.active().id!==project.id||!this.tabs.has(tab.id)||tab.view.webContents.isDestroyed()||new URL(tab.view.webContents.getURL()).href.split('#')[0]!==request.pageUrl)throw new Error('Source preservation page or Project changed.');await(force?admission.finish():admission.guard());await sabr?.check(force)}
    return {...await this.recordingController.preserveMedia({url:request.url,pageUrl:request.pageUrl,fetchImpl:await this.mediaFetchForTab(tab.id,signal),guard,signal,videoIdentity:admission.videoIdentity,...(sabr?{youtubeSabr:sabr.delivery,refreshYoutubeSabr:sabr.refresh}:{}),...(admission.audio?{separated:{audioUrl:admission.audio.url,audioDurationSeconds:admission.audio.durationSeconds,videoDurationSeconds:selected?.durationSeconds??admission.target!.durationSeconds!,videoIdentity:admission.videoIdentity!}}:{})}),tab:this.serializeTab(tab)}
  }
  async acquireSource(request:NonNullable<import('./browser-host.js').BrowserFeatureHost['acquireSource']> extends (request:infer R,...args:unknown[])=>unknown?R:never,signal?:AbortSignal){
    const tab=this.requireTab(request.tabId),projectId=this.projectStore.active().id
    const verify=async()=>{signal?.throwIfAborted();if(this.projectStore.active().id!==projectId)throw new Error('Source Project changed.');await this.verifySourceVideo({...request.sourceGuard,tabId:tab.id},signal)}
    await verify()
    const state=await readVideoTargets(tab.view.webContents,request.sourceGuard.scope,signal)
    const selected=selectVideoResource(state,request.sourceGuard.candidateUrl,request.sourceGuard.videoIdentity)
    return acquireVideoDelivery(selected,{
      verify,busy:()=>this.recordingController.isCaptureActive(),
      preserve:(url,jobSignal)=>this.preserveSource({url,pageUrl:request.sourceGuard.pageUrl,tabId:tab.id,sourceGuard:request.sourceGuard},jobSignal),
      capture:jobSignal=>this.captureSource(request,jobSignal),
      prepareCapture:async jobSignal=>{
        const previous=this.activeTabId
        await this.showTab(tab.id)
        try{return await prepareVideoCapture({
          read:async start=>{await verify();return readRendererPhase<CapturePlayerState>(tab.view.webContents,'library.sources','capture-buffer',async()=>await tab.view.webContents.mainFrame.executeJavaScript(`(()=>{const selector=${JSON.stringify(request.videoSelector)},index=${JSON.stringify(request.videoIndex??0)},start=${JSON.stringify(start)},video=document.querySelectorAll(selector)[index];if(!(video instanceof HTMLVideoElement))throw new Error('VIDEO_IDENTITY_UNBOUND: Missing confirmed player.');const player=['youtube.com','www.youtube.com','m.youtube.com'].includes(location.hostname)?document.getElementById('movie_player'):null,levels=player&&typeof player.getAvailableQualityLevels==='function'?player.getAvailableQualityLevels():[],requested=['hd1080','hd720','large','medium','small','tiny'].find(level=>levels.includes(level));if(start){video.pause();if(requested&&typeof player.setPlaybackQualityRange==='function')player.setPlaybackQualityRange(requested,requested);if(requested&&typeof player.setPlaybackQuality==='function')player.setPlaybackQuality(requested);${request.fromStart!==false?'if(video.currentTime>0)video.currentTime=0;':''}void video.play().catch(()=>{})}return {requested:requested??null,width:video.videoWidth,height:video.videoHeight,readyState:video.readyState,durationSeconds:Number.isFinite(video.duration)?video.duration:0,bufferedStartSeconds:video.buffered.length?video.buffered.start(0):null,bufferedEndSeconds:video.buffered.length?video.buffered.end(0):0}})()`,true) as CapturePlayerState,jobSignal,3000)},
          pause:async()=>{try{
            // Cleanup must still stop playback when preparation changed the
            // delivery URL/identity. Admission checks remain before every read
            // and before capture; never let them prevent bounded cleanup.
            if(this.projectStore.active().id!==projectId||tab.view.webContents.isDestroyed()||new URL(tab.view.webContents.getURL()).href.split('#')[0]!==request.sourceGuard.pageUrl)throw new Error('Prepared player page or Project changed.')
            const paused=await readRendererPhase<unknown>(tab.view.webContents,'library.sources','pause-prepared-player',()=>tab.view.webContents.mainFrame.executeJavaScript(`(()=>{const v=document.querySelectorAll(${JSON.stringify(request.videoSelector)})[${JSON.stringify(request.videoIndex??0)}];if(!(v instanceof HTMLVideoElement))return false;v.pause();return v.paused===true})()`,true),undefined,3000)
            if(paused!==true)throw new Error('Prepared player did not acknowledge paused state.')
          }catch(error){if(!tab.view.webContents.isDestroyed())this.navigationQuarantine.add(tab.id);throw new Error('MEDIA_CAPTURE_CLEANUP_FAILED: Prepared player pause could not be verified; close the quarantined page before further browser work.',{cause:error})}}
        },jobSignal)}finally{if(previous&&previous!==tab.id&&this.tabs.has(previous))await this.showTab(previous)}
      }

    },signal??new AbortController().signal)
  }
  async verifySourceVideo(request:SourceCaptureGuard&{tabId?:string},signal?:AbortSignal){
    const tab=this.requireTab(request.tabId),state=await readVideoTargets(tab.view.webContents,request.scope,signal)
    if(state.pageUrl!==request.pageUrl)throw new Error('VIDEO_IDENTITY_CHANGED: Source page changed before commit.')
    return selectVideoResource(state,request.candidateUrl,request.videoIdentity).identity
  }
  private async captureSelectedVideo(tab,request,signal?:AbortSignal){
    // Chromium does not deliver presentation callbacks to a detached tab view.
    // Admit only the existing Project page, temporarily display it, then restore
    // the user's selected page after the native job has fully drained.
    const previous=this.activeTabId,promoted=previous!==tab.id&&typeof tab.view.setVisible==='function'
    this.capturePlaybackTabId=tab.id
    try{
      if(promoted)await this.showTab(tab.id)
      else await this.refreshPlayback(tab)
      const state=await readVideoTargets(tab.view.webContents,{selector:request.selector,index:request.index??0,excludeSelectors:request.sourceGuard?.scope.excludeSelectors??[]},signal)
      const target=state.targets[0]
      if(state.blocked||state.targets.length!==1||!target||request.sourceGuard?.videoIdentity&&!sameVideoIdentity(request.sourceGuard.videoIdentity,target.identity))throw new Error('VIDEO_IDENTITY_UNBOUND: '+(state.blocked??'Select exactly the confirmed target video.'))
      if(request.sourceGuard)selectVideoResource(state,request.sourceGuard.candidateUrl,request.sourceGuard.videoIdentity)
      return await this.recordingController.captureVideo(tab,{...request,videoIdentity:target.identity,...(request.sourceGuard?{sourceGuard:{...request.sourceGuard,videoIdentity:target.identity}}:{})},signal)
    }finally{
      this.capturePlaybackTabId=null
      // Native capture cleanup has already drained. Unrelated frame policy
      // failures retain muting/diagnostics without masking the capture outcome.
      await this.applyPlayback(tab,this.playbackAllowed(tab),true)
      if(promoted&&this.activeTabId===tab.id&&previous&&this.tabs.has(previous)&&!this.recordingController.isCaptureActive())await this.showTab(previous)
    }
  }
  async captureSource(request:{sourceGuard:import('@bmw-agent/media-native/sources').SourceCaptureGuard;videoSelector:string;videoIndex?:number;fromStart?:boolean;maxDurationMs?:number;filename:string;tabId?:string},signal?:AbortSignal){
    const tab=this.requireTab(request.tabId)
    return this.captureSelectedVideo(tab,{selector:request.videoSelector,index:request.videoIndex??0,filename:request.filename,fromStart:request.fromStart??true,maxDurationMs:request.maxDurationMs,sourceGuard:request.sourceGuard},signal)
  }
  async collectSource(request:SourceCollection,signal?:AbortSignal){
    const tab=this.requireTab(request.tabId)
    return collectPageSource(tab.view.webContents,request,(scope,phaseSignal)=>this.listMedia(tab,scope,phaseSignal),signal)
  }

  private async textReadDiagnostic(tab:NavigationTab,requestedUrl:string,signal?:AbortSignal,discovery=false):Promise<TextReadDiagnostic>{
    const account=new URL(requestedUrl).pathname.split('/').filter(Boolean)[0]?.toLowerCase()??''
    let dom={url:tab.view.webContents.getURL()||'about:blank',title:'',documentReadyState:'unknown' as TextReadDiagnostic['documentReadyState'],bodyTextCharacters:0,visiblePosts:0,matchingPostLinks:0,contentState:'unknown' as TextReadDiagnostic['contentState']},rendererFailure:TextReadDiagnostic['rendererFailure']|undefined
    try{
      dom=await readRendererPhase<typeof dom>(tab.view.webContents,'collection.pages','content-state',async()=>await tab.view.webContents.mainFrame.executeJavaScript(`(()=>{const account=${JSON.stringify(account)},discovery=${discovery},visible=element=>{const rect=element.getBoundingClientRect(),style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&Number(style.opacity)!==0},body=discovery?(()=>{const walker=document.createTreeWalker(document.body??document.documentElement,NodeFilter.SHOW_TEXT);let text='',count=0;while(walker.nextNode()&&++count<=200&&text.length<500){const parent=walker.currentNode.parentElement;if(parent&&!parent.closest('script,style,noscript,template')&&visible(parent))text+=String(walker.currentNode.textContent??'').slice(0,500-text.length)}return text})():String(document.body?.innerText??'').slice(0,50000),visiblePosts=[...document.querySelectorAll('article,[data-testid="tweet"]')].slice(0,100).filter(element=>visible(element)&&String(discovery?element.textContent??'':element.innerText??'').slice(0,discovery?360:50000).trim()).length,matchingPostLinks=[...document.querySelectorAll('a[href]')].slice(0,2000).filter(element=>{if(!visible(element)||!element.closest('article,[data-testid="tweet"]'))return false;try{const url=new URL(element.href);return ['x.com','twitter.com'].includes(url.hostname)&&url.pathname.split('/')[1]?.toLowerCase()===account&&url.pathname.split('/')[2]==='status'&&/^\\d+$/.test(url.pathname.split('/')[3]??'')}catch{return false}}).length,title=String(document.title??'').slice(0,500),restricted=/^(?:please (?:log|sign) in to continue|you must (?:log|sign) in|verify you are human|请先登录|访问被拒绝|人机验证)/i.test(body.trim())||['/i/flow/login','/i/flow/signup','/account/access'].some(path=>location.pathname.startsWith(path)),contentState=restricted?'restricted':visiblePosts&&matchingPostLinks?'posts':/this account (?:doesn.t|does not) exist|account doesn.t exist/i.test(body)?'missing-account':/\\b0 posts\\b/i.test(body)?'empty-account':/something went wrong|try again|refresh/i.test(body)?'error':body.trim()?'header-only':'loading';return {url:location.href,title,documentReadyState:document.readyState,bodyTextCharacters:body.length,visiblePosts,matchingPostLinks,contentState}})()`,true) as typeof dom,signal,1000)
    }catch(error){signal?.throwIfAborted();rendererFailure={code:error instanceof Error&&'code'in error?String(error.code).slice(0,100):'BMW_RENDERER_READ_FAILED',message:String(error instanceof Error?error.message:error).slice(0,500)}}
    const log=this.diagnosticsFor(tab.id),network=log.network as {type:string;url?:string;resourceType?:string;status?:number;errorText?:string;canceled?:boolean;blockedReason?:string;requestId?:string;phase?:string;reason?:string;elapsedMs?:number;at:number}[]
    const main=network.filter(row=>row.type==='response'&&row.resourceType==='Document').at(-1)
    const result:TextReadDiagnostic={...dom,...(rendererFailure?{rendererFailure}:{}),url:diagnosticUrl(dom.url)||'about:blank',at:new Date().toISOString(),mainDocumentStatus:main?.status??null,
      navigation:network.filter(row=>row.type==='navigation'&&row.url===diagnosticUrl(requestedUrl)).slice(-8).map(row=>({phase:row.phase as 'stop'|'complete',reason:row.reason as TextReadDiagnostic['navigation'][number]['reason'],elapsedMs:row.elapsedMs??0,at:row.at})),
      network:network.filter(row=>row.type!=='navigation').slice(-30).map(row=>({type:row.type==='response'?'response' as const:'failed' as const,url:diagnosticUrl(row.url),resourceType:row.resourceType??'',...(row.status===undefined?{}:{status:row.status}),...(row.errorText?{errorText:row.errorText.slice(0,500)}:{}),...(row.canceled===undefined?{}:{canceled:row.canceled}),...(row.blockedReason?{blockedReason:row.blockedReason.slice(0,100)}:{}),...(row.requestId?{requestId:row.requestId.slice(0,100)}:{}),at:row.at})),
      pending:[...(this.networkRequests.get(tab.view.webContents)?.values()??[])].slice(-30)}
    const transfer=this.documentTransfers.get(tab.view.webContents)
    if(transfer&&transfer.url===diagnosticUrl(requestedUrl))result.documentTransfer={url:transfer.url,status:transfer.status,receivedBytes:transfer.receivedBytes,lastDataAt:transfer.lastDataAt,completed:transfer.completed,failed:transfer.failed}
    if([401,403,429].includes(result.mainDocumentStatus??0)&&result.contentState!=='posts')result.contentState='restricted'
    while(new TextEncoder().encode(JSON.stringify(result)).byteLength>11000&&(result.network.length||result.pending.length)){result.truncated=true;if(result.network.length)result.network.shift();else result.pending.shift()}
    return result
  }

  private async readSocialPage(input:CollectionPageRequest,signal:AbortSignal):Promise<CollectionPageResult>{
    const opened=await this.openTab({url:PROJECT_BLANK_URL,source:'agent',reuse:false},signal),tab=this.requireTab(opened.id)
    let diagnostic=await this.textReadDiagnostic(tab,input.url,signal,input.discovery)
    const snapshot=async(reason?:string):Promise<CollectionPageResult>=>{
      diagnostic=await this.textReadDiagnostic(tab,input.url,signal,input.discovery)
      if(input.discovery){
        const found=await readRendererPhase<{url:string;title:string;leads:unknown}>(tab.view.webContents,'collection.pages','discovery',()=>tab.view.webContents.mainFrame.executeJavaScript(discoveryExpression(input.url),true),signal,1500)
        const leads=assertDiscoveryLeads(found.leads,input.url)
        if(leads.length&&discoveryAccountUrl(found.url)!==discoveryAccountUrl(input.url))throw new Error('Discovery account changed during snapshot.')
        return {observation:discoveryObservation(found.url,found.title,leads),links:leads.map(lead=>({url:lead.url,text:lead.displayTime??''})),linksTruncated:false,leads,diagnostic,reason,...(diagnostic.contentState==='restricted'?{restricted:true}:{})}
      }
      const observation=await this.collectSource({...input.source,tabId:opened.id},signal)
      const found=await readRendererPhase<{url:string;text:string;links:CollectionPageLink[];linksTruncated:boolean}>(tab.view.webContents,'collection.pages','links',()=>tab.view.webContents.mainFrame.executeJavaScript(collectionPageLinksExpression(input.source),true),signal,1500)
      if(observation.url!==found.url||observation.text!==found.text)throw new Error('Source changed between text and link snapshot')
      if(!Array.isArray(found.links)||found.links.length>100||found.links.some(link=>typeof link.url!=='string'||typeof link.text!=='string'||link.text.length>320))throw new Error('Invalid bounded source links')
      const links=found.links.map(link=>({url:collectionPageUrl(link.url),text:link.text}));if(new Set(links.map(link=>link.url)).size!==links.length)throw new Error('Duplicate source links')
      return {observation,links,linksTruncated:found.linksTruncated,diagnostic,reason,...(diagnostic.contentState==='restricted'?{restricted:true}:{})}
    }
    try{
      const result=await withNativePageRead(tab.view.webContents,input.url,{signal,timeoutMs:this.collectionNavigationTimeoutMs,
        documentTransfer:()=>this.documentTransfers.get(tab.view.webContents),
        trace:entry=>this.#addDiagnostic(tab.id,'network',{type:'navigation',url:diagnosticUrl(input.url),...entry,at:Date.now()}),
        ready:async()=>{diagnostic=await this.textReadDiagnostic(tab,input.url,signal,input.discovery);return ['posts','restricted','missing-account','empty-account','error'].includes(diagnostic.contentState)},
        read:()=>snapshot(diagnostic.contentState==='posts'?'qualified-posts':diagnostic.contentState),
        incomplete:async reason=>{diagnostic=await this.textReadDiagnostic(tab,input.url,signal,input.discovery);if(!/^https?:/.test(tab.view.webContents.getURL()))throw new CollectionPageReadError(reason.message,diagnostic);return snapshot(diagnostic.contentState==='posts'?'qualified-posts':'account-content-deadline')}
      })
      const navigation=(this.diagnosticsFor(tab.id).network as {type:string;url?:string;phase:'stop'|'complete';reason:TextReadDiagnostic['navigation'][number]['reason'];elapsedMs:number;at:number}[]).filter(row=>row.type==='navigation'&&row.url===diagnosticUrl(input.url)).slice(-8).map(({phase,reason,elapsedMs,at})=>({phase,reason,elapsedMs,at}))
      if(result.diagnostic)result.diagnostic.navigation=navigation
      return result
    }catch(error){if(signal.aborted||error instanceof CollectionPageReadError||error instanceof Error&&'code'in error&&error.code==='BMW_BROWSER_NAVIGATION_CLEANUP_FAILED')throw error;throw new CollectionPageReadError(error instanceof Error?error.message:String(error),diagnostic)}
  }

  /** Private mechanical reads within one admitted browser action. Each lane has
   * its own hidden kernel; no mutation of foreground tabs or nested outer FIFO. */
  private async readTextPages(rawUrls:string[],signal?:AbortSignal,discovery=false){
    const urls=rawUrls.map(raw=>{if(discovery)return discoveryAccountUrl(raw);const url=collectionPageUrl(raw);if(new URL(url).protocol!=='https:')throw new Error('Text batches require explicit HTTPS pages.');return url})
    if(new Set(urls).size!==urls.length)throw new Error('Text batch URLs repeat after normalization.')
    const project={...this.projectStore.active()},port=this.projectSources?.()
    if(!port||(port.state?.()??port.snapshot()).projectId!==project.id||!port.writeTextBatch||!port.readTextBatch)throw new Error('Text batch requires the active Project durable source store.')
    const startedAt=Date.now(),deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new Error('BMW_TEXT_BATCH_DEADLINE')),180000)
    const combined=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal
    const rows:TextReadRow[]=urls.map((url,index)=>({index,url,state:'pending'}))
    const batch:TextReadBatch={version:1,id:crypto.randomUUID(),projectId:project.id,revision:0,startedAt:new Date(startedAt).toISOString(),finishedAt:null,cleanupState:'pending',rows,...(discovery?{mode:'discovery' as const}:{})}
    const write=port.writeTextBatch.bind(port);let receipt=await Promise.resolve().then(()=>write(batch)).catch(error=>{clearTimeout(timer);throw error}),writes=Promise.resolve(),storageError:unknown
    const checkpoint=async(final=false)=>{if(storageError)throw storageError;const snapshot=structuredClone(batch);snapshot.revision=receipt.revision+1;snapshot.finishedAt=final?new Date().toISOString():null;if(final)snapshot.cleanupState=this.collectionPageLanes.size===0&&!this.collectionPagePoolQuarantined?'complete':'quarantined';receipt=await write(snapshot,receipt.revision);batch.revision=snapshot.revision;batch.finishedAt=snapshot.finishedAt;batch.cleanupState=snapshot.cleanupState}
    const queueCheckpoint=()=>{const update=writes.then(()=>checkpoint());writes=update.catch(error=>{storageError=error;deadline.abort(error)});return update}
    const guard=()=>{signal?.throwIfAborted();if(this.projectStore.active().id!==project.id||!this.permissionStore.hasAgentControl())throw new Error('Text batch Project or permission changed.')}
    try{
      await this.collectPageBatch({concurrency:3,maxPages:urls.length,navigationTimeoutMs:8000,guard},async visit=>{
        await Promise.all(rows.map(async row=>{
          row.startedAt=new Date().toISOString()
          try{
            const read=await visit({url:row.url,source:{bodySelector:'body'},sourceKey:'page-'+row.index,...(discovery?{discovery:true}:{})})
            row.readFinishedAt=new Date().toISOString()
            const commit=writes.then(async()=>{combined.throwIfAborted();guard();return port.collect(read.observation,(port.state?.()??port.snapshot()).revision,combined)})
            writes=commit.then(()=>{},()=>{})
            const saved=await commit
            const address=new URL(row.url),account=address.pathname.split('/').filter(Boolean)[0],postLinks=['x.com','twitter.com'].includes(address.hostname)?read.links.filter(link=>{try{const url=new URL(link.url);return ['x.com','twitter.com'].includes(url.hostname)&&new RegExp('^/'+account+'/status/\\d+(?:/|$)','i').test(url.pathname)}catch{return false}}):[]
            const preferred=new Set(postLinks.map(link=>link.url)),links=[...postLinks,...read.links.filter(link=>!preferred.has(link.url))]
            const state=discovery?(read.restricted?'restricted':read.diagnostic?.contentState==='posts'&&read.leads?.length?'read':'incomplete'):textPageReadState(row.url,read)
            Object.assign(row,{sourceId:saved.sourceId,acquisitionId:saved.acquisitionId,observedUrl:read.observation.url,title:read.observation.title,publishedAt:read.observation.publishedAt,links,state,reason:state==='read'?'qualified-content':read.reason??(state==='restricted'?'access-restricted':'no-qualified-content'),...(read.diagnostic?{diagnostic:read.diagnostic}:{})})
            if(discovery)row.leads=read.leads??[]
          }catch(error){row.state=combined.aborted?'pending':'failed';row.reason=combined.aborted?'cancelled-or-batch-deadline':error instanceof CollectionPageReadError?'native-content-failed':'native-read-failed';row.error=error instanceof Error?error.message.slice(0,1000):'Text page failed';if(error instanceof CollectionPageReadError)row.diagnostic=error.diagnostic}
          finally{row.finishedAt=new Date().toISOString();await queueCheckpoint()}
        }))
      },combined)
    }catch(error){if(signal?.aborted||!deadline.signal.aborted||error instanceof CollectionPageCleanupError)throw error}
    finally{clearTimeout(timer);await writes;if(!storageError)await checkpoint(true)}
    if(storageError)throw storageError
    guard()
    return textReadSummary(batch,receipt)
  }

  private readonly textReadPages=new TextReadPageReader()
  private async readTextPageResult(request:Readonly<Record<string,unknown>>,signal?:AbortSignal,owner?:import('./browser-host.js').BrowserSessionOwner){
    const port=this.projectSources?.(),projectId=this.projectStore.active().id
    if(!port?.readTextBatch)throw new Error('Project text batch store is unavailable')
    const receipt={batchId:String(request.batchId??''),revision:Number(request.revision),sha256:String(request.sha256??'')},batch=await port.readTextBatch(receipt.batchId,receipt.revision,receipt.sha256)
    if(batch.projectId!==projectId)throw new Error('Foreign text batch Project')
    return this.textReadPages.read(owner?.sessionId??'host-user',batch,receipt,{section:request.section as 'rows'|'text'|'links'|'diagnostics'|'details'|'leads',rowIndex:request.rowIndex===undefined?undefined:Number(request.rowIndex),offset:Number(request.offset??0),limit:request.limit===undefined?undefined:Number(request.limit)},port,signal)
  }

  async collectPageBatch<T>(options:CollectionPagePoolOptions,work:(visit:CollectionPageVisit)=>Promise<T>,signal?:AbortSignal):Promise<T>{
    if(this.collectionPagePoolRunning||this.collectionPagePoolQuarantined)throw new CollectionPageCleanupError('A collection page batch is active or requires explicit cleanup recovery')
    const project:ActiveProject={...this.projectStore.active()}
    const guard=()=>{options.guard();signal?.throwIfAborted();const current=this.projectStore.active();if(current.id!==project.id||current.directory!==project.directory||!this.permissionStore.hasAgentControl())throw new Error('Collection page Project or permission lease changed')}
    guard();this.collectionPagePoolRunning=true
    try{return await withCollectionPagePool({...options,guard},()=>{
      const surface=new BrowserWindow({show:false,width:900,height:700,useContentSize:true,frame:false,paintWhenInitiallyHidden:true,webPreferences:{session:this.session,offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}})
      const kernel=new BrowserKernel({detached:true,window:surface,session:this.session,permissionStore:this.permissionStore,sessionContinuity:undefined,projectStore:{active:()=>project},settingsStore:this.settingsStore,capabilityRegistry:this.capabilityRegistry,allowedActions:this.allowedActions,artifactsDirectory:this.artifactsDirectory,pageTheme:this.pageTheme,onState:undefined,getCurrentSessionId:this.getCurrentSessionId,getSessionDriver:this.getSessionDriver})
      kernel.recordingController=this.recordingController
      kernel.collectionNavigationTimeoutMs=options.navigationTimeoutMs??25000
      this.collectionPageLanes.add(kernel);this.collectionSurfaces.set(kernel,{window:surface,contents:surface.webContents})
      let cleanupFailed=false
      return {visit:async(input,phaseSignal):Promise<CollectionPageResult>=>{
        try{
          if(['x.com','twitter.com'].includes(new URL(input.url).hostname)&&/^\/[a-zA-Z0-9_]{1,15}(?:\/?$|\/status\/\d+)/.test(new URL(input.url).pathname)&&!['home','explore','search','login','signup','settings','notifications','messages','i'].includes(new URL(input.url).pathname.split('/')[1].toLowerCase()))return await kernel.readSocialPage(input,phaseSignal)
          let recoveryDeadline:number|undefined;const settleExisting=async(wc:import('electron').WebContents)=>{const stableBy=recoveryDeadline??(recoveryDeadline=Date.now()+5000);let previous=wc.getURL(),quietSince=Date.now();while(Date.now()<stableBy){guard();phaseSignal.throwIfAborted();if(wc.isDestroyed()||!sameCollectionNavigation(input.url,wc.getURL()))throw new Error('Collection page identity changed during same-navigation recovery');const current=wc.getURL();if(wc.isLoading()||current!==previous){quietSince=Date.now();previous=current}else if(Date.now()-quietSince>=150)return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('Collection same-navigation recovery did not stabilize within five seconds')}
          kernel.collectionBodyScope=input.source;kernel.collectionRestricted=false;kernel.collectionHTTPStatus=0
          guard();let opened:{id:string}
          try{opened=await kernel.openTab({url:input.url,foreground:false,source:'agent',reuse:false},phaseSignal)}catch(error){
            const surviving=[...kernel.tabs.values()].at(-1) as NavigationTab|undefined,wc=surviving?.view.webContents
            if(!(error instanceof Error)||!wc||wc.isDestroyed()||!sameCollectionNavigation(input.url,wc.getURL()))throw error
            if([401,403,429].includes(kernel.collectionHTTPStatus)){kernel.collectionRestricted=true;opened={id:surviving.id}}
            else {if(!error.message.includes('ERR_ABORTED'))throw error;await settleExisting(wc);opened={id:surviving.id}}
          }
          const tab=kernel.requireTab(opened.id)
          const restriction=()=>readRendererPhase<CollectionPageReady>(tab.view.webContents,'collection.pages','restriction',async()=>assertCollectionPageReady(await tab.view.webContents.mainFrame.executeJavaScript(collectionPageReadyExpression(input.source),true)),phaseSignal,1500)
          let preflight:CollectionPageReady
          try{preflight=await restriction()}catch(error){if(!(error instanceof Error)||!('code'in error)||error.code!=='BMW_BROWSER_PAGE_CHANGED'||!sameCollectionNavigation(input.url,tab.view.webContents.getURL()))throw error;await settleExisting(tab.view.webContents);preflight=await restriction()}
          if(preflight.restricted||[401,403,429].includes(kernel.collectionHTTPStatus))kernel.collectionRestricted=true
          const waitForBody=()=>readRendererPhase<boolean>(tab.view.webContents,'collection.pages','ready',()=>tab.view.webContents.executeJavaScript(`(()=>new Promise(resolve=>{const selector=${JSON.stringify(input.source.bodySelector)},index=${JSON.stringify(input.source.index??0)};let timer,observer,checks=0,finished=false;const done=value=>{if(finished)return;finished=true;clearTimeout(timer);observer?.disconnect();resolve(value)},ready=()=>{if(++checks>200){done(false);return false}const root=document.querySelectorAll(selector)[index];if(!root||!root.getClientRects().length)return false;const nodes=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let count=0;while(nodes.nextNode()&&++count<=200){const node=nodes.currentNode,parent=node.parentElement,style=parent?getComputedStyle(parent):null;if(parent&&style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&parent.getClientRects().length&&!parent.closest('script,style,template,noscript,input,textarea,select,[hidden],[aria-hidden="true"]')&&String(node.textContent??'').slice(0,300).trim())return true}return false};if(ready()){done(true);return}observer=new MutationObserver(()=>{if(ready())done(true)});observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true});timer=setTimeout(()=>done(false),4000)}))()`,true),phaseSignal,4500)
          try{if(!kernel.collectionRestricted)await waitForBody()}catch(error){if(!(error instanceof Error)||!('code'in error)||error.code!=='BMW_BROWSER_PAGE_CHANGED'||!sameCollectionNavigation(input.url,tab.view.webContents.getURL()))throw error;await settleExisting(tab.view.webContents);await waitForBody()}
          const address=new URL(input.url),account=address.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/)?.[1]
          if(!kernel.collectionRestricted&&['x.com','twitter.com'].includes(address.hostname)&&account&&!['home','explore','search','login','signup','settings','notifications','messages','i'].includes(account.toLowerCase())){
            await readRendererPhase(tab.view.webContents,'collection.pages','account-posts',()=>tab.view.webContents.executeJavaScript(`(()=>new Promise(resolve=>{let timer,observer,done=false;const account=${JSON.stringify(account.toLowerCase())},finish=value=>{if(done)return;done=true;clearTimeout(timer);observer?.disconnect();resolve(value)},ready=()=>[...document.querySelectorAll('a[href]')].slice(0,2000).some(link=>{if(!link.getClientRects().length)return false;try{const url=new URL(link.href);return ['x.com','twitter.com'].includes(url.hostname)&&url.pathname.toLowerCase().startsWith('/'+account+'/status/')&&/^\\d+/.test(url.pathname.split('/')[3]??'')}catch{return false}});if(ready()){finish(true);return}observer=new MutationObserver(()=>{if(ready())finish(true)});observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});timer=setTimeout(()=>finish(false),4000)}))()`,true),phaseSignal,4500)
          }
          guard();phaseSignal.throwIfAborted()
          let observation=await kernel.collectSource({...input.source,...(kernel.collectionRestricted?{bodySelector:'body',index:0,excludeSelectors:[],authorSelector:undefined,publishedSelector:undefined}:{}),tabId:opened.id},phaseSignal)
          if(kernel.collectionRestricted)observation={...observation,access:'login-required',accessText:'Explicit access/challenge wall observed in the visible document',result:'login-required'}
          guard();phaseSignal.throwIfAborted()
          // One interrupted read may follow the publisher's own same-page
          // theme replacement. Re-read only the existing stable document;
          // never navigate again or replay an official/model input.
          if(observation.result==='navigated'&&sameCollectionNavigation(input.url,tab.view.webContents.getURL())){await settleExisting(tab.view.webContents);observation=await kernel.collectSource({...input.source,tabId:opened.id},phaseSignal);guard();phaseSignal.throwIfAborted()}
          if(!['observed','truncated'].includes(observation.result))return {observation,links:[],linksTruncated:false,...(kernel.collectionRestricted?{restricted:true}:{})}
          const found=await readRendererPhase<{url:string;text:string;links:CollectionPageLink[];linksTruncated:boolean}>(tab.view.webContents,'collection.pages','links',()=>tab.view.webContents.mainFrame.executeJavaScript(collectionPageLinksExpression(input.source),true),phaseSignal)
          guard();phaseSignal.throwIfAborted()
          if(found.url!==observation.url||tab.view.webContents.getURL()!==observation.url||found.text!==observation.text)throw new Error('Collection page changed between original and visible links')
          if(!Array.isArray(found.links)||found.links.length>100||typeof found.linksTruncated!=='boolean'||found.links.some(link=>typeof link.url!=='string'||typeof link.text!=='string'||link.text.length>320))throw new Error('Invalid bounded collection links')
          const links=found.links.map(link=>({url:collectionPageUrl(link.url),text:link.text}))
          if(new Set(links.map(link=>link.url)).size!==links.length)throw new Error('Collection links repeat a normalized URL')
          return {observation,links,linksTruncated:found.linksTruncated}
        }catch(error){
          if(error instanceof Error&&'code'in error&&error.code==='BMW_BROWSER_NAVIGATION_CLEANUP_FAILED'){cleanupFailed=true;const failure=new CollectionPageCleanupError('Collection navigation cleanup failed; explicit recovery required');Object.assign(failure,{cause:error});throw failure}
          throw error
        }finally{
          if(!cleanupFailed)try{await kernel.closeDetached()}catch(error){cleanupFailed=true;const failure=new CollectionPageCleanupError('Collection page did not close; explicit recovery required');Object.assign(failure,{cause:error});throw failure}
        }
      },close:async()=>{if(cleanupFailed)throw new CollectionPageCleanupError('Collection page cleanup is quarantined');await this.disposeCollectionLane(kernel)}}
    },work,signal)}finally{this.collectionPagePoolRunning=false;this.collectionPagePoolQuarantined=this.collectionPageLanes.size>0}
  }

  /** Only a trusted Host recovery path calls this; it never replays any input. */
  async recoverCollectionPages():Promise<void>{
    if(this.collectionPagePoolRunning)throw new Error('Wait for the active collection page batch to drain')
    const cleanup=await Promise.allSettled([...this.collectionPageLanes].map(kernel=>this.disposeCollectionLane(kernel)))
    this.collectionPagePoolQuarantined=this.collectionPageLanes.size>0
    if(cleanup.some(result=>result.status==='rejected'))throw new CollectionPageCleanupError('Collection page cleanup remains quarantined')
  }

  async listMedia(tab, request, signal?:AbortSignal) {
    const {selector,index,excludeSelectors}=assertPageScope(request)
    const maxItems = Math.min(Math.max(Math.floor(Number(request.maxItems) || 80), 1), 240)
    const result = await readRendererPhase<{ok:boolean;reason?:string;items:Record<string,unknown>[];matches:number;selectedIndex:number;text:string;range:unknown}>(tab.view.webContents, 'page.media.list', 'dom', () => tab.view.webContents.mainFrame.executeJavaScript(`(async () => {
      const selector = ${JSON.stringify(selector)}
      const {text:bodyText,range:bodyRange}=${pageRangeExpression(assertPageScope({...request,maxCharacters:5000}))}
      const index = ${index}
      const roots = selector ? [...document.querySelectorAll(selector)] : [document]
      const root = roots[index]
      if (!root) return { ok: false, reason: 'element-not-found', matches: roots.length }
      const absolute = (value) => {
        if (!value || /^blob:|^data:/i.test(value)) return value || ''
        try { return new URL(value, location.href).toString() } catch { return value }
      }
      const excluded=${JSON.stringify('script,style,template,noscript,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"]')}+${JSON.stringify(excludeSelectors.length?','+excludeSelectors.join(','):'')}
      document.querySelector(excluded)
      const descendants = (tag) => [
        ...(root instanceof Element && root.matches(tag) ? [root] : []),
        ...root.querySelectorAll(tag)
      ].filter(element=>!element.closest(excluded))
      const bestSrcset = (image) => {
        const candidates = String(image.srcset || '').split(',').map((part) => {
          const fields = part.trim().split(' ').filter(Boolean)
          const score = Number.parseFloat(fields[1] || '1')
          return fields[0] ? { url: absolute(fields[0]), score: Number.isFinite(score) ? score : 1 } : null
        }).filter(Boolean).sort((left, right) => right.score - left.score)
        return candidates[0]?.url || absolute(image.currentSrc || image.src)
      }
      const images = descendants('img').map((image) => ({
        kind: 'image',
        url: bestSrcset(image),
        displayedUrl: absolute(image.currentSrc || image.src),
        alt: image.alt || '',
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0
      }))
      const videos = descendants('video').map((video) => ({
        kind: 'video',
        url: absolute(video.currentSrc || video.src),
        poster: absolute(video.poster),
        duration: Number.isFinite(video.duration) ? video.duration : null,
        paused: video.paused
      }))
      const sources = descendants('source').map((source) => ({
        kind: 'source', url: absolute(source.src), mediaType: source.type || ''
      }))
      const performanceMedia = performance.getEntriesByType('resource').map((entry) => ({
        kind: 'resource',
        url: entry.name,
        initiatorType: entry.initiatorType || '',
        durationMs: Math.round(entry.duration || 0)
      })).filter((entry) => {
        if (/^(?:img|video|audio)$/i.test(entry.initiatorType)) return true
        try {
          const pathname = new URL(entry.url, location.href).pathname.toLowerCase()
          return ['.avif', '.gif', '.jpg', '.jpeg', '.png', '.webp', '.m3u8', '.mp4', '.mov', '.webm', '.m4a', '.mp3']
            .some((extension) => pathname.endsWith(extension))
        } catch { return false }
      })
      return {
        ok: true,
        matches: roots.length,
        selectedIndex: index,
        pageUrl: location.href,
        text: bodyText,
        range:bodyRange,
        items: [...images, ...videos, ...sources, ...(selector?[]:performanceMedia)]
      }
    })()`, true), signal)
    if (!result.ok) throw new Error(result.reason)
    const targetScope:VideoTargetScope={...(selector?{selector,index}:{}),excludeSelectors}
    const identities=await readVideoTargets(tab.view.webContents,targetScope,signal)
    const network=this.diagnosticsFor(tab.id).media.map((item) => ({kind:'network',...item}))
    // A scoped player may be MSE/blob. Only its exact resource witnesses or
    // original-post media ID may admit network delivery URLs into that range.
    const observed=selector?network.filter(item=>identities.targets.some(target=>resourceBelongsToTarget(target,String(item.url??'')))):network
    const targetResources=identities.targets.flatMap(target=>target.resources.filter(r=>r.role!=='audio').map(r=>({kind:'source',url:r.url,duration:r.durationSeconds,videoIdentity:target.identity})))
    const unique = new Map()
    for (const item of [...result.items, ...observed,...targetResources]) {
      const url = String(item.url || '')
      const poster = String(item.poster || '')
      const target=identities.targets.find(target=>resourceBelongsToTarget(target,url))
      const video=['video','source'].includes(String(item.kind))||item.kind==='network'&&(/^(?:video|audio)\//.test(String(item.mimeType??''))||/mpegurl|\.m3u8|\.mp4|videoplayback/.test(String(item.mimeType??'')+url))
      const audioOnly=target?.identity.platform==='youtube'&&target.resources.some(r=>r.url===url&&r.role==='audio')
      const kind=target&&video&&item.kind==='network'?'source':item.kind
      const sabr=target?.resources.some(resource=>resource.url===url&&resource.role==='sabr')
      if(url&&!audioOnly&&(!video||!identities.blocked&&(identities.platform==='page'||target)))unique.set(`${kind}:${url}`,{...item,kind,...(target?{videoIdentity:target.identity}:{}),downloadable:/^https?:/i.test(url)&&!sabr,...(sabr?{preservable:true,acquisition:'youtube-sabr',help:'Use media.preserve; both original encoded tracks are validated and merged.'}:{})})
      if (poster) unique.set(`poster:${poster}`, { kind: 'poster', url: poster, downloadable: /^https?:/i.test(poster) })
    }
    return {
      tab: this.serializeTab(tab),
      selector,
      matches: result.matches,
      selectedIndex: result.selectedIndex,
      text: result.text,
      range:result.range,
      scope:selector?'selected-element':'page',
      candidateOnly:true,
      videoIdentityStatus:identities.blocked??(identities.targets.length?'bound':'unavailable'),
      videoTargets:identities.targets.map(target=>({videoIdentity:target.identity,durationSeconds:target.durationSeconds,directResources:target.resources.filter(r=>r.role!=='audio'&&r.role!=='sabr').length,nativeSabr:target.resources.some(r=>r.role==='sabr'),...(target.identity.platform==='youtube'&&!target.resources.length?{deliveryIssue:'YOUTUBE_DIRECT_DELIVERY_UNAVAILABLE: no supported HTTP/HLS or same-player SABR delivery; signature-only formats cannot authorize acquisition.'}:{})})),
      truncated:unique.size>maxItems,
      items: [...unique.values()].slice(0, maxItems)
    }
  }

  async mediaFetchForTab(tabId: string, signal?: AbortSignal) {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error('Media source tab is unavailable.')
    const pageUrl = tab.url
    const policy: unknown = await readRendererPhase(tab.view.webContents,'media.fetch','referrer-policy',()=>tab.view.webContents.mainFrame.executeJavaScript('document.referrerPolicy'),signal)
    return createMediaSessionFetch(this.session,pageUrl,policy,net.request)
  }

  async downloadMedia(tab, request, signal?:AbortSignal) {
    if (typeof request.url !== 'string' || !request.url.trim()) throw new Error('media.download requires a media URL.')
    const project = this.projectStore?.active()
    if (!project?.directory) throw new Error('media.download requires an active BMW Project.')
    const admission=await prepareVideoTransfer(tab.view.webContents,request.url,signal,request.sourceGuard,true)
    if(admission.target?.resources.some(r=>r.url===request.url&&r.role==='sabr'))throw new Error('YOUTUBE_SABR_TRACKS: Use media.preserve for the target; UMP must be validated and both encoded tracks merged.')
    if(admission.audio)throw new Error('YOUTUBE_SEPARATED_TRACKS: Use media.preserve for the bound video; its default audio will be merged without reencoding.')
    const guard=async(force=false)=>{signal?.throwIfAborted();if(this.projectStore.active()?.id!==project.id||tab.view.webContents.isDestroyed())throw new Error('Media download Project or page changed.');await(force?admission.finish():admission.guard())}
    const artifact = await downloadMediaArtifact({
      fetchImpl: await this.mediaFetchForTab(tab.id,signal),
      projectDirectory: project.directory,
      url: request.url,
      filename: typeof request.filename === 'string' ? request.filename : undefined,
      signal,
      guard,
      referrer: tab.url
    })
    return { ...artifact,videoIdentity:admission.videoIdentity, tab: this.serializeTab(tab) }
  }

  async pageDiagnostics(tab, request: Readonly<Record<string, unknown>> & { maxCharacters?: number } = {}, signal?:AbortSignal) {
    const observation = await this.observe(tab, { maxCharacters: request.maxCharacters || 6000 }, signal)
    const performance = await readRendererPhase(tab.view.webContents, 'page.diagnostics', 'performance', () => tab.view.webContents.executeJavaScript(`(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      return {
        domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
        loadMs: navigation ? Math.round(navigation.loadEventEnd) : null,
        resourceCount: performance.getEntriesByType('resource').length,
        longTaskCount: performance.getEntriesByType('longtask').length,
        documentReadyState:document.readyState,
        bodyTextCharacters:String(document.body?.innerText??'').slice(0,50000).length,
        scriptCount:document.scripts.length,
        pendingStylesheets:[...document.querySelectorAll('link[rel="stylesheet"]')].slice(0,100).filter(link=>!link.disabled&&!link.sheet&&(!link.media||matchMedia(link.media).matches)).length
      }
    })()`, true), signal)
    let accessibility = []
    try {
      if (!tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.attach('1.3')
      const tree = await readRendererPhase<{nodes?:{ignored?:boolean;role?:{value?:string};name?:{value?:string};description?:{value?:string};properties?:{name:string;value?:{value?:boolean}}[]}[]}>(tab.view.webContents,'page.diagnostics','accessibility',()=>tab.view.webContents.debugger.sendCommand('Accessibility.getFullAXTree',{depth:5}),signal)
      accessibility = (tree.nodes || []).filter((node) => !node.ignored).slice(0, 240).map((node) => ({
        role: node.role?.value || '', name: node.name?.value || '', description: node.description?.value || '',
        disabled: node.properties?.find((property) => property.name === 'disabled')?.value?.value === true
      }))
    } catch (error:unknown) {
      if(signal?.aborted || (error instanceof Error && 'code' in error && String(error.code).startsWith('BMW_BROWSER_')))throw error
    }
    const screenshot=await this.screenshot(tab,{},signal)
    return { ...observation, screenshot, diagnostics: this.diagnosticsFor(tab.id),networkPending:[...(this.networkRequests.get(tab.view.webContents)?.values()??[])].slice(-30), performance, accessibility }
  }

  async assertPage(tab, request) {
    const assertion = request.assertion || request
    const type = String(assertion.type || '')
    let result
    if (type === 'console.noErrors') {
      const errors = this.diagnosticsFor(tab.id).console.filter((entry) => entry.level === 'error')
      result = { pass: errors.length === 0, actual: errors }
    } else if (type === 'network.noFailures') {
      const failures = this.diagnosticsFor(tab.id).network
      result = { pass: failures.length === 0, actual: failures }
    } else {
      result = await tab.view.webContents.executeJavaScript(`(() => {
        const assertion = ${JSON.stringify(assertion)}
        const element = assertion.selector ? document.querySelector(assertion.selector) : null
        const visible = (node) => {
          if (!node) return false
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        }
        if (assertion.type === 'url') return { pass: location.href.includes(assertion.value), actual: location.href }
        if (assertion.type === 'title') return { pass: document.title.includes(assertion.value), actual: document.title }
        if (assertion.type === 'exists') return { pass: Boolean(element), actual: Boolean(element) }
        if (assertion.type === 'visible') return { pass: visible(element), actual: visible(element) }
        if (assertion.type === 'text') {
          const actual = (element ? element.textContent : document.body?.innerText || '').trim()
          return { pass: actual.includes(assertion.value), actual: actual.slice(0, 2000) }
        }
        if (assertion.type === 'count') {
          const actual = document.querySelectorAll(assertion.selector).length
          return { pass: actual === Number(assertion.value), actual }
        }
        return { pass: false, actual: null, reason: 'unsupported-assertion' }
      })()`, true)
    }
    if (!result.pass) throw Object.assign(new Error(`Assertion ${type} failed${result.reason ? `: ${result.reason}` : ''}.`), { assertion, actual: result.actual })
    return { ok: true, assertion, actual: result.actual }
  }

  async setViewport(tab, request) {
    const width = Math.min(Math.max(Number(request.width) || 1280, 320), 3840)
    const height = Math.min(Math.max(Number(request.height) || 720, 320), 2160)
    const deviceScaleFactor = Math.min(Math.max(Number(request.deviceScaleFactor) || 1, 0.5), 4)
    if (!tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.attach('1.3')
    await tab.view.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor, mobile: request.mobile === true,
      // Emulate page layout for capture without resizing the native render view
      // beyond the workspace into Assistant or Shell surfaces.
      screenWidth: width, screenHeight: height, dontSetVisibleSize: true
    })
    return { width, height, deviceScaleFactor, mobile: request.mobile === true }
  }

  async clearViewport(tab) {
    if (!tab.view.webContents.debugger.isAttached()) return { cleared: false }
    await tab.view.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
    return { cleared: true }
  }

  async key(tab, request) {
    const keyCode = String(request.key || '')
    if (!keyCode) throw new Error('key requires a key value.')
    const modifiers = Array.isArray(request.modifiers) ? request.modifiers : []
    tab.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    tab.view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    return { ok: true, key: keyCode, modifiers }
  }

  async hover(tab, request) {
    if (typeof request.selector !== 'string') throw new Error('hover requires selector.')
    const result = await tab.view.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(request.selector)})
      if (!element) return { ok: false, reason: 'element-not-found' }
      element.scrollIntoView({ block: 'center', inline: 'center' })
      for (const type of ['pointerover', 'mouseover', 'mouseenter']) element.dispatchEvent(new MouseEvent(type, { bubbles: true }))
      return { ok: true }
    })()`, true)
    if (!result.ok) throw new Error(result.reason)
    return result
  }

  async screenshot(tab, request, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const sourceCapture=await prepareSourceScreenshot(request.sourceBinding===undefined?undefined:this.projectSources?.(),tab.view.webContents,request.sourceBinding,request.selector,request.index,signal)
    const captureSignal=sourceCapture?.signal??signal
    try{
    const artifactsDirectory = this.projectStore ? path.join(this.projectStore.active().directory, 'artifacts') : this.artifactsDirectory
    fs.mkdirSync(artifactsDirectory, { recursive: true })
    let image
    if (typeof request.selector === 'string' && request.selector.trim()) {
      const selector = request.selector.trim()
      const index = Math.min(Math.max(Math.floor(Number(request.index) || 0), 0), 10_000)
      const clip = await readScreenshotPhase<{ ok: boolean; matches: number; x: number; y: number; width: number; height: number }>(tab.view.webContents, 'selector-layout', () => tab.view.webContents.executeJavaScript(`(() => {
        const matches = [...document.querySelectorAll(${JSON.stringify(selector)})]
        const element = matches[${index}]
        if (!element) return { ok: false, matches: matches.length }
        // Read document coordinates without scrolling. CDP captures beyond the viewport.
        // Detached background views may never get rAF; this read forces layout directly.
        const rect = element.getBoundingClientRect()
        return {
          ok: rect.width > 0 && rect.height > 0,
          matches: matches.length,
          x: Math.max(0, rect.left + scrollX),
          y: Math.max(0, rect.top + scrollY),
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height)
        }
      })()`, true), captureSignal)
      if (!clip.ok) throw new Error(`Screenshot selector did not resolve to a visible element (${clip.matches || 0} matches).`)
      const wc = tab.view.webContents
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      const captured = await readScreenshotPhase<{ data: string }>(wc, 'capture-png', () => wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: sourceCapture?Math.min(1,1024/clip.width,8192/clip.height):1 }
      }), captureSignal)
      const png=Buffer.from(captured.data,'base64');sourceCapture?.checkPng(png)
      image = nativeImage.createFromBuffer(png)
    } else if (request.mode === 'fullpage') {
      const wc = tab.view.webContents
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      const captured = await readScreenshotPhase<{ data: string }>(wc, 'capture-png', () => wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true }), signal)
      image = nativeImage.createFromBuffer(Buffer.from(captured.data, 'base64'))
    } else {
      // Studio can hide the native View; capture the browser viewport without
      // depending on a visible compositor surface or changing page scroll.
      const wc = tab.view.webContents
      const clip = await readScreenshotPhase<{x:number;y:number;width:number;height:number}>(wc, 'viewport-layout', () => wc.executeJavaScript('({x:Math.max(0,scrollX),y:Math.max(0,scrollY),width:innerWidth,height:innerHeight})'), signal)
      if(![clip.x,clip.y,clip.width,clip.height].every(Number.isFinite)||clip.width<=0||clip.height<=0||clip.width>16384||clip.height>16384)throw new Error('Invalid screenshot viewport')
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      const captured = await readScreenshotPhase<{data:string}>(wc, 'capture-viewport', () => wc.debugger.sendCommand('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,fromSurface:true,clip:{...clip,scale:1}}), signal)
      image = nativeImage.createFromBuffer(Buffer.from(captured.data, 'base64'))
    }
    captureSignal?.throwIfAborted()
    if (image.isEmpty()) throw new Error('BMW_BROWSER_EMPTY_IMAGE: media.screenshot returned an empty PNG')
    if(sourceCapture)await sourceCapture.verify()
    const requestedName = typeof request.filename === 'string' ? safeFilename(request.filename) : ''
    const filename = `${Date.now()}-${requestedName || safeFilename(tab.title || 'page')}${(requestedName || '').toLowerCase().endsWith('.png') ? '' : '.png'}`
    const filePath = path.join(artifactsDirectory, filename)
    const png=image.toPNG(),identity=fs.statSync(artifactsDirectory)
    fs.writeFileSync(filePath,png,sourceCapture?{flag:'wx',mode:0o600}:undefined)
    let sourceBinding:Awaited<ReturnType<NonNullable<typeof sourceCapture>['record']>>|undefined
    try{if(sourceCapture)sourceBinding=await sourceCapture.record(filename,png,image.getSize())}catch(error){try{const current=fs.lstatSync(artifactsDirectory);if(!current.isSymbolicLink()&&current.dev===identity.dev&&current.ino===identity.ino)fs.rmSync(filePath,{force:true})}catch{}throw error}
    return {
      ...(sourceBinding?{sourceBinding}:{ }),
      artifactId: filename,
      type: 'screenshot',
      path: filePath,
      width: image.getSize().width,
      height: image.getSize().height,
      tab: this.serializeTab(tab),
      requestedMode: request.mode || 'viewport',
      selector: typeof request.selector === 'string' ? request.selector : null,
      index: typeof request.selector === 'string' ? Math.max(0, Math.floor(Number(request.index) || 0)) : null
    }
    }finally{sourceCapture?.dispose()}
  }
}
