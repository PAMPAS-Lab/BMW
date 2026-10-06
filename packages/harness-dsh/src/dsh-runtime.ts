import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import { prepareProductDshHome } from './dsh-preset.js'
import { launchUrl, record, remoteRequest, remoteSnapshot, remoteValue } from './dsh-transport.js'
import type { DshValue, DshHistoryRow } from './dsh-transport.js'

interface RuntimeOptions {
  productId?: string; presetId?: string; patchPath?: string; presetSourcePath?: string
  dshHome?: string; sourceDshHome?: string; workspacePath?: string; workspaceTitle?: string
  mcpServerPath?: string
  bridgeUrl?: string; bridgeToken?: string
  controlFilePath?: string
  sessionBinding?:string
  catalogOnly?:boolean
  onLog?: (entry: { stream: string; text: string }) => void
  onStatus?: (entry: Record<string, unknown>) => void
}

async function reservePort() {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function waitUntilReady(url, child, getLaunchUrl: () => string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let cookie = ''
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`DSH exited with code ${child.exitCode}`)
    try {
      const response = await fetch(cookie ? url : getLaunchUrl(), {
        redirect: 'manual', headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(5_000)
      })
      if (response.status === 303) cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
      else if (response.ok && cookie) return cookie
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for DSH Web UI')
}

function eventText(event) {
  const content = event?.type === 'assistant/message' ? event.data?.message?.content : event?.data?.content
  if (!Array.isArray(content)) return ''
  return content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('')
}

function sessionTitle(session) {
  const title = session?.projections?.values?.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  if (session?.blank) return 'New session'
  return session?.sessionId || 'Session'
}

export class DshRuntime {
  [key: string]: any
  private stoppingChild:ChildProcess|null=null

  constructor({ productId = 'bmw', presetId = 'bmw', patchPath, presetSourcePath, dshHome, sourceDshHome, workspacePath, workspaceTitle, mcpServerPath, bridgeUrl, bridgeToken, controlFilePath,sessionBinding,catalogOnly, onLog, onStatus }: RuntimeOptions) {
    this.productId = productId
    this.presetId = presetId
    this.patchPath = patchPath
    this.presetSourcePath = presetSourcePath
    this.dshHome = dshHome
    this.sourceDshHome = sourceDshHome
    this.workspacePath = workspacePath
    this.workspaceTitle = workspaceTitle
    this.mcpServerPath = mcpServerPath
    this.bridgeUrl = bridgeUrl
    this.bridgeToken = bridgeToken
    this.controlFilePath = controlFilePath
    this.sessionBinding=sessionBinding
    this.catalogOnly=catalogOnly===true
    this.onLog = onLog
    this.onStatus = onStatus
    this.child = null
    this.url = null
    this.launchUrl = null
    this.authCookie = ''
    this.listeners = new Set()
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('DSH event subscriber must be a function.')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(type, value) {
    for (const listener of this.listeners) {
      try {
        listener({ type, value })
      } catch (error) {
        console.error('BMW DSH runtime subscriber failed', error)
      }
    }
  }

  emitStatus(value) {
    this.onStatus?.(value)
    this.publish('status', value)
  }

  emitLog(value) {
    this.onLog?.(value)
    this.publish('log', value)
  }

  async start() {
    if(this.stoppingChild&&this.stoppingChild.exitCode===null&&this.stoppingChild.signalCode===null)throw new Error('DSH is still stopping')
    if (this.child) return this.launchUrl
    prepareProductDshHome({
      productHome: this.dshHome,
      sourceHome: this.sourceDshHome,
      presetId: this.presetId,
      presetSourceDirectory: this.presetSourcePath,
      workspacePath: this.workspacePath,
      workspaceTitle: this.workspaceTitle

    })
    const port = await reservePort()
    this.url = `http://127.0.0.1:${port}`
    this.launchUrl = this.url
    this.authCookie = ''
    const env = {
      ...process.env,
      DSH_HOME: this.dshHome,
      BMW_BRIDGE_URL: this.bridgeUrl,
      BMW_BRIDGE_TOKEN: this.bridgeToken,
      BMW_MCP_SERVER: this.mcpServerPath,
      BMW_PRODUCT_ID: this.productId,
      BMW_SESSION_BINDING:this.sessionBinding??'',
      BMW_CATALOG_ONLY:this.catalogOnly?'1':'',
      ...(this.controlFilePath ? { BMW_DSH_CONTROL_FILE: this.controlFilePath, BMW_AGENT_DRIVER: 'dsh' } : {})
    }
    this.emitStatus({ state: 'starting', version: null, url: this.url })
    const presetPatch = path.join(this.dshHome, '.agent-presets', this.presetId, 'profile.patch.yml')
    const controlArgs: string[] = []
    if(this.controlFilePath){
      fs.rmSync(this.controlFilePath,{force:true})
      const controlPatch=path.join(this.dshHome,'bmw-driver-control.patch.yml')
      fs.writeFileSync(controlPatch,'- insert:\n    - id: bmw-driver-control\n      name: '+JSON.stringify(path.resolve(import.meta.dirname,'../dsh/driver-control.js'))+'\n',{mode:0o600})
      controlArgs.push('--patch',controlPatch)
    }
    this.child = spawn('dsh', ['web', '--patch', this.patchPath, '--patch', presetPatch, ...controlArgs, '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    let pending = ''
    this.child.stdout.on('data', (text: string) => {
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() || ''
      for (const line of lines) {
        const authenticated = launchUrl(line, this.url)
        if (authenticated) this.launchUrl = authenticated
        this.emitLog({ stream: 'stdout', text: `${line.replace(/([?&]token=)[^\s&)]+/g, '$1[redacted]')}\n` })
      }
    })
    this.child.stderr.on('data', (text) => this.emitLog({ stream: 'stderr', text }))
    const child = this.child
    this.child.once('exit', (code, signal) => {
      this.emitStatus({ state: 'stopped', code, signal, url: this.url })
      if (this.child === child) this.child = null
    })
    try {
      this.authCookie = await waitUntilReady(this.url, this.child, () => this.launchUrl)
    } catch (error) { await this.stopAndWait(); throw error }
    this.emitStatus({ state: 'ready', url: this.url })
    return this.launchUrl
  }

  stop() {
    if (!this.child) return
    this.stoppingChild=this.child
    this.child.kill('SIGTERM')
    this.child = null
    this.authCookie = ''
    this.launchUrl = null
  }

  async stopAndWait(): Promise<void> {
    const child:ChildProcess|null=this.child??this.stoppingChild
    if(!child)return
    this.stoppingChild=child
    let onExit!:()=>void,onError!:(error:Error)=>void
    const exited=new Promise<void>((resolve,reject)=>{
      if(child.exitCode!==null||child.signalCode!==null)resolve()
      else{
        onExit=()=>resolve()
        onError=error=>{if(child.pid===undefined)resolve();else reject(error)}
        child.once('exit',onExit);child.once('error',onError)
      }
    })
    this.stop()
    const kill=setTimeout(()=>child.kill('SIGKILL'),5000)
    let timeout:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([exited,new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('DSH process did not stop before cleanup deadline')),10000)})])}
    finally{
      clearTimeout(kill);if(timeout)clearTimeout(timeout)
      if(onExit)child.removeListener('exit',onExit);if(onError)child.removeListener('error',onError)
      if(child.exitCode!==null||child.signalCode!==null||child.pid===undefined)this.stoppingChild=null
    }
  }

  async call(method: string, payload: Record<string, unknown> = {},options:{signal?:AbortSignal}={}): Promise<DshValue> {
    options.signal?.throwIfAborted()
    if (!this.url || !this.child || !this.authCookie) throw new Error('DSH is not ready.')
    if (method === 'workspace.list') {
      const snapshot = await remoteSnapshot(this.url, this.authCookie, 'workspace/follow', {},30000,options.signal)
      if (snapshot.type !== 'baseline') throw new Error('Invalid DSH workspace baseline.')
      const value = record(snapshot.value)
      if (!Array.isArray(value.items) || !Array.isArray(value.archivedSessionIds)) throw new Error('Invalid DSH workspace list.')
      return remoteValue(value)
    }
    if (method === 'session.history') {
      const snapshot = await remoteSnapshot(this.url, this.authCookie, 'session/follow', {
        request: { address: { kind: 'session', sessionId: payload.sessionId }, maxMessages: payload.maxMessages || 200 }
      },30000,options.signal)
      if (snapshot.type !== 'snapshot' || !Array.isArray(snapshot.records)) throw new Error('Invalid DSH session snapshot.')
      for (const row of snapshot.records) {
        const event = record(record(row).event)
        if (typeof event.type !== 'string') throw new Error('Invalid DSH session event.')
      }
      const records = snapshot.records as DshHistoryRow[]
      let hasMore = snapshot.hasMore === true
      while (hasMore && typeof payload.rpcId === 'string'
        && !records.some(({ event }) => event.data?.source?.rpcId === payload.rpcId)) {
        const beforeSeq = record(records[0]?.event).seq
        if (!Number.isSafeInteger(beforeSeq) || !Number.isSafeInteger(snapshot.cursor)) throw new Error('Invalid DSH history cursor.')
        const page = await this.call('session.page', { address: { kind: 'session', sessionId: payload.sessionId }, throughSeq: snapshot.cursor, beforeSeq, maxMessages: 200 },options)
        if (!Array.isArray(page.records) || page.records.length === 0) throw new Error('DSH history pagination made no progress.')
        for (const row of page.records) {
          const event = record(record(row).event)
          if (typeof event.type !== 'string' || !Number.isSafeInteger(event.seq) || Number(event.seq) >= Number(beforeSeq)) throw new Error('Invalid DSH history page.')
        }
        records.unshift(...page.records as DshHistoryRow[])
        hasMore = page.hasMore === true
      }
      return { events: records,header:snapshot.header,cursor:snapshot.cursor,hasMore }
    }
    return (await this.callWithReceipt(method, payload,options)).value
  }

  async callWithReceipt(method, payload = {},options:{signal?:AbortSignal}={}) {
    if (!this.url || !this.child || !this.authCookie) throw new Error('DSH is not ready.')
    const rpcId = crypto.randomUUID()
    const wire = remoteRequest(method, payload, rpcId)
    const response = await fetch(`${this.url}/api/${wire.endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ type: 'client-request', rpcId, method: wire.endpoint, payload: wire.payload }),
      signal: options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(30_000)]):AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`DSH ${method} transport failed: HTTP ${response.status}`)
    const message = record(await response.json())
    if (message.rpcId !== rpcId) throw new Error(`DSH ${method} returned a mismatched rpcId.`)
    const result = record(message.result)
    if (result.ok !== true) throw new Error(String(record(result.error).message || `DSH ${method} failed.`))
    const value = wire.endpoint === 'commands/list' && Array.isArray(result.value) ? { items: result.value } : result.value
    if(wire.endpoint==='credentials/set'||wire.endpoint==='credentials/unset'){
      if(value!==undefined&&value!==null)throw new Error('Invalid DSH credential write acknowledgment')
      return {rpcId,value:{}}
    }
    return { rpcId, value: remoteValue(value) }
  }

  authHeaders(): Record<string, string> { return this.authCookie ? { cookie: this.authCookie } : {} }

  async ensureWorkspace(project) {
    const listed = await this.call('workspace.list', {})
    if(project.workspaceId&&!listed.items.some(candidate=>candidate.workspaceId===project.workspaceId))throw new Error('Saved DSH Workspace is unavailable; repair its mapping explicitly')
    let workspace = listed.items.find((candidate) => candidate.workspaceId === project.workspaceId)
      || listed.items.find((candidate) => candidate.path === (fs.existsSync(project.directory) ? fs.realpathSync(project.directory) : project.directory))
    if (!workspace) {
      const created = await this.call('workspace.create', { path: project.directory })
      workspace = created.workspace
    }
    if (workspace.title !== project.name) {
      const renamed = await this.call('workspace.rename', { workspaceId: workspace.workspaceId, title: project.name })
      workspace = renamed.workspace
    }
    return workspace
  }

  async activateWorkspace(project) {
    const workspace = await this.ensureWorkspace(project)
    const [listed, workspaces] = await Promise.all([this.call('session.list', {}), this.call('workspace.list', {})])
    const current = workspaces.items.find(item => item.workspaceId === workspace.workspaceId) || workspace
    const archived = new Set(workspaces.archivedSessionIds || [])
    const candidates = listed.items.filter(candidate => (current.sessionIds || []).includes(candidate.sessionId)
      && candidate.cwd === workspace.path && candidate.origin !== 'subagent' && !archived.has(candidate.sessionId)
      && (candidate.agentPreset == null || candidate.agentPreset === this.presetId))
    const session = candidates.find(candidate => candidate.sessionId === project.sessionId)
      || candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0]
      || await this.call('session.create', { workspaceId: workspace.workspaceId, agentPreset: this.presetId })
    return { workspace, sessionId: session.sessionId }
  }

  async listProjectSessions(project, query = '') {
    const workspace = await this.ensureWorkspace(project)
    const [sessions, workspaces] = await Promise.all([
      this.call('session.list', {}),
      this.call('workspace.list', {})
    ])
    const currentWorkspace = workspaces.items.find((item) => item.workspaceId === workspace.workspaceId) || workspace
    const archived = new Set(workspaces.archivedSessionIds || [])

    const byId = new Map((sessions.items || []).map((item) => [item.sessionId, item]))
    let remoteMatches = null
    const normalizedQuery = String(query || '').trim()
    if (normalizedQuery) {
      const searched = await this.call('session.search', { query: normalizedQuery })
      remoteMatches = new Map((searched.items || []).map((item) => [item.sessionId, item.snippet]))
    }
    const eligible = (currentWorkspace.sessionIds || [])
      .map((sessionId) => byId.get(sessionId))
      .filter((item) => item && item.cwd === workspace.path && item.origin !== 'subagent' && !archived.has(item.sessionId) && (item.agentPreset == null || item.agentPreset === this.presetId))
    const membership = new Set(eligible.map(item => item.sessionId))
    const items = eligible
      .map((item) => ({
        sessionId: item.sessionId,
        title: sessionTitle(item),
        updatedAt: item.updatedAt,
        running: item.running === true,
        blank: item.blank === true,
        parentSessionId: item.parentSessionId || null,
        agentPreset: item.agentPreset || null,
        snippet: remoteMatches?.get(item.sessionId) || ''
      }))
      .filter((item) => !normalizedQuery
        || item.title.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase())
        || remoteMatches?.has(item.sessionId))
    return {
      workspaceId: workspace.workspaceId,
      selectedSessionId: project.sessionId,
      items,
      hasMore: false,
      membership: [...membership]
    }
  }

  async createProjectSession(project) {
    const workspace = await this.ensureWorkspace(project)
    return this.call('session.create', { workspaceId: workspace.workspaceId, agentPreset: this.presetId })
  }

  async enqueuePrompt(sessionId, text) {
    const receipt = await this.callWithReceipt('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
    return receipt.rpcId
  }

  async waitForPromptReplies(sessionId, rpcId, { timeoutMs = 30 * 60_000, pollIntervalMs = 750 } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const history = await this.call('session.history', { sessionId, maxMessages: 200, rpcId })
      const entries = history.events || []
      const userIndex = entries.findIndex(({ event }) => event?.type === 'user/message' && event.data?.source?.rpcId === rpcId)
      if (userIndex >= 0) {
        const after = entries.slice(userIndex + 1)
        const turnEndIndex = after.findIndex(({ event }) => event?.type === 'turn/end')
        if (turnEndIndex >= 0) {
          const replies = after.slice(0, turnEndIndex + 1)
            .filter(({ event }) => event?.type === 'assistant/message')
            .map(({ event }) => eventText(event).trim())
            .filter(Boolean)
          if (replies.length) return replies
          throw new Error('DSH completed the requested turn without a text response.')
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }
    throw new Error('DSH did not complete the requested turn before the reply timeout.')
  }

  async waitForPromptReply(sessionId, rpcId, options) {
    return (await this.waitForPromptReplies(sessionId, rpcId, options)).join('\n\n')
  }

  async promptAndWait(sessionId, text, options) {
    const rpcId = await this.enqueuePrompt(sessionId, text)
    return this.waitForPromptReply(sessionId, rpcId, options)
  }
}
