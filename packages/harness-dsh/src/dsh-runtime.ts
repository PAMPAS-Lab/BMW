import { spawn } from 'node:child_process'
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
  mcpServerPath?: string; clientPluginPath?: string; wvlClientPluginPath?: string; clientPluginId?: string
  bridgeUrl?: string; bridgeToken?: string
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

  constructor({ productId = 'bmw', presetId = 'bmw', patchPath, presetSourcePath, dshHome, sourceDshHome, workspacePath, workspaceTitle, mcpServerPath, clientPluginPath, wvlClientPluginPath, clientPluginId, bridgeUrl, bridgeToken, onLog, onStatus }: RuntimeOptions) {
    this.productId = productId
    this.presetId = presetId
    this.patchPath = patchPath
    this.presetSourcePath = presetSourcePath
    this.dshHome = dshHome
    this.sourceDshHome = sourceDshHome
    this.workspacePath = workspacePath
    this.workspaceTitle = workspaceTitle
    this.mcpServerPath = mcpServerPath
    this.clientPluginPath = clientPluginPath || wvlClientPluginPath
    this.clientPluginId = clientPluginId
    this.bridgeUrl = bridgeUrl
    this.bridgeToken = bridgeToken
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
    if (this.child) return this.launchUrl
    prepareProductDshHome({
      productHome: this.dshHome,
      sourceHome: this.sourceDshHome,
      presetId: this.presetId,
      presetSourceDirectory: this.presetSourcePath,
      clientPluginSourceDirectory: this.clientPluginPath ? path.dirname(this.clientPluginPath) : undefined,
      clientPluginId: this.clientPluginId,
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
      ...(this.clientPluginPath ? { BMW_DSH_WVL_CLIENT: path.join(this.dshHome, 'profiles', 'web', this.clientPluginId || 'bmw-wvl-client', 'index.js') } : {})
    }
    this.emitStatus({ state: 'starting', version: null, url: this.url })
    const presetPatch = path.join(this.dshHome, '.agent-presets', this.presetId, 'profile.patch.yml')
    const clientPatch = this.clientPluginPath ? ['--patch', path.join(this.dshHome, 'profiles', 'web', this.clientPluginId || 'bmw-wvl-client', 'profile.patch.yml')] : []
    this.child = spawn('dsh', ['web', '--patch', this.patchPath, '--patch', presetPatch, ...clientPatch, '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
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
    } catch (error) { this.stop(); throw error }
    this.emitStatus({ state: 'ready', url: this.url })
    return this.launchUrl
  }

  stop() {
    if (!this.child) return
    this.child.kill('SIGTERM')
    this.child = null
    this.authCookie = ''
    this.launchUrl = null
  }

  async call(method: string, payload: Record<string, unknown> = {}): Promise<DshValue> {
    if (!this.url || !this.child) throw new Error('DSH is not running.')
    if (method === 'workspace.list') {
      const snapshot = await remoteSnapshot(this.url, this.authCookie, 'workspace/follow', {})
      if (snapshot.type !== 'baseline') throw new Error('Invalid DSH workspace baseline.')
      const value = record(snapshot.value)
      if (!Array.isArray(value.items) || !Array.isArray(value.archivedSessionIds)) throw new Error('Invalid DSH workspace list.')
      return remoteValue(value)
    }
    if (method === 'session.history') {
      const snapshot = await remoteSnapshot(this.url, this.authCookie, 'session/follow', {
        request: { address: { kind: 'session', sessionId: payload.sessionId }, maxMessages: payload.maxMessages || 200 }
      })
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
        const page = await this.call('session.page', { address: { kind: 'session', sessionId: payload.sessionId }, throughSeq: snapshot.cursor, beforeSeq, maxMessages: 200 })
        if (!Array.isArray(page.records) || page.records.length === 0) throw new Error('DSH history pagination made no progress.')
        for (const row of page.records) {
          const event = record(record(row).event)
          if (typeof event.type !== 'string' || !Number.isSafeInteger(event.seq) || Number(event.seq) >= Number(beforeSeq)) throw new Error('Invalid DSH history page.')
        }
        records.unshift(...page.records as DshHistoryRow[])
        hasMore = page.hasMore === true
      }
      return { events: records }
    }
    return (await this.callWithReceipt(method, payload)).value
  }

  async callWithReceipt(method, payload = {}) {
    if (!this.url || !this.child) throw new Error('DSH is not running.')
    const rpcId = crypto.randomUUID()
    const wire = remoteRequest(method, payload, rpcId)
    const response = await fetch(`${this.url}/api/${wire.endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ type: 'client-request', rpcId, method: wire.endpoint, payload: wire.payload }),
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`DSH ${method} transport failed: HTTP ${response.status}`)
    const message = record(await response.json())
    if (message.rpcId !== rpcId) throw new Error(`DSH ${method} returned a mismatched rpcId.`)
    const result = record(message.result)
    if (result.ok !== true) throw new Error(String(record(result.error).message || `DSH ${method} failed.`))
    const value = wire.endpoint === 'commands/list' && Array.isArray(result.value) ? { items: result.value } : result.value
    return { rpcId, value: remoteValue(value) }
  }

  authHeaders(): Record<string, string> { return this.authCookie ? { cookie: this.authCookie } : {} }

  async ensureWorkspace(project) {
    const listed = await this.call('workspace.list', {})
    let workspace = listed.items.find((candidate) => candidate.workspaceId === project.dshWorkspaceId)
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
    const listed = await this.call('session.list', {})
    const session = listed.items.find((candidate) => candidate.sessionId === project.dshSessionId)
      || listed.items.filter((candidate) => candidate.cwd === workspace.path && candidate.origin !== 'subagent')
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
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
    const membership = new Set(currentWorkspace.sessionIds || [])
    const byId = new Map((sessions.items || []).map((item) => [item.sessionId, item]))
    let remoteMatches = null
    const normalizedQuery = String(query || '').trim()
    if (normalizedQuery) {
      const searched = await this.call('session.search', { query: normalizedQuery })
      remoteMatches = new Map((searched.items || []).map((item) => [item.sessionId, item.snippet]))
    }
    const items = (currentWorkspace.sessionIds || [])
      .map((sessionId) => byId.get(sessionId))
      .filter((item) => item && item.origin !== 'subagent' && !archived.has(item.sessionId))
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
      selectedSessionId: project.dshSessionId,
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
