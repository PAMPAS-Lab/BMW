import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionOperations } from './session-operations.js'
import type { AddressInfo } from 'node:net'

interface BrowserExecutor {
  readonly busy?:boolean
  execute(input: unknown, options?: { signal?: AbortSignal; sessionOwner?:import('./browser-host.js').BrowserSessionOwner }): Promise<unknown>
}

interface ErrorWithCode extends Error {
  code?: string
}

function json(response: http.ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('Request body too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

interface Project { id: string; directory: string }
interface BridgeOptions { productId?: string; resolveProject?: (directory: string) => Project | undefined; activeProjectId?: () => string; toolDefinition?: unknown; hostManagedSessions?: boolean; sessionContext?:(sessionId:string,projectId:string)=>Promise<{text:string}>|{text:string} }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid browser bridge input')
  return value as Record<string, unknown>
}

export async function createBridgeServer(browserKernel: BrowserExecutor, { productId = 'bmw', resolveProject, activeProjectId, toolDefinition,hostManagedSessions=false,sessionContext }: BridgeOptions = {}) {
  const token = crypto.randomBytes(32).toString('hex')
  const operations = new SessionOperations()
  const bindings = new Map<string, { project: Project; sessionId: string }>()
  const activeCalls = new Map<AbortController, { binding: string; settled: Promise<unknown> }>()
  const providerBindings = new Map<string, string>()
  const providerKey = (driverId: string, sessionId: string, directory: string) => JSON.stringify([driverId,sessionId,directory])
  let closing = false
  let projectChanging = false
  function register(sessionId: string, directory: string): string {
    if (closing || projectChanging) throw new Error('BMW browser is changing or shutting down')
    if (!sessionId || sessionId.length > 4096 || /[\u0000-\u001f\u007f]/u.test(sessionId)) throw new Error('Invalid Agent Session identity')
    const project = resolveProject?.(directory)
    if (!project) throw new Error('Agent Session does not belong to an active BMW Project')
    const binding = crypto.randomBytes(32).toString('hex')
    bindings.set(binding, { project: { ...project }, sessionId })
    return binding
  }
  async function release(binding: string): Promise<void> {
    // Revoke admission first, then wait for actual kernel/worker cleanup.
    bindings.delete(binding)
    for(const [key,value]of providerBindings)if(value===binding)providerBindings.delete(key)
    const calls = [...activeCalls].filter(([, call]) => call.binding === binding)
    for (const [controller] of calls) controller.abort(new Error('BMW_BROWSER_CANCELLED: Session released'))
    await Promise.allSettled(calls.map(([, call]) => call.settled))
  }
  const server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { error: 'unauthorized' })
      return
    }
    if (request.method === 'GET' && request.url === '/tool') {
      if (!toolDefinition) { json(response, 503, { error: 'catalog-unavailable' }); return }
      json(response, 200, toolDefinition)
      return
    }
    if (request.method === 'GET' && request.url === '/health') {
      json(response, 200, { ok: true, product: productId })
      return
    }
    if (request.method !== 'POST' || !['/execute', '/session/register', '/session/release','/session/context'].includes(request.url || '')) {
      json(response, 404, { error: 'not-found' })
      return
    }
    try {
      const input = record(await readJson(request))
      if (closing) throw new Error('BMW browser bridge is shutting down')
      if (request.url === '/session/register') {
        if (typeof input.sessionId !== 'string' || !input.sessionId || typeof input.directory !== 'string') throw new Error('Invalid Agent Session identity')
        let binding:string
        if(hostManagedSessions){
          if(typeof input.driverId!=='string')throw new Error('BMW driver identity is required')
          const project=resolveProject?.(input.directory)
          const admitted=project?providerBindings.get(providerKey(input.driverId,input.sessionId,project.directory)):undefined
          if(!admitted||!bindings.has(admitted))throw new Error('Provider Session has no live BMW Host lease')
          binding=admitted
        }else binding=register(input.sessionId, input.directory)
        json(response, 200, { binding })
        return
      }
      if (typeof input.binding !== 'string') throw new Error('BMW browser requires a Session binding')
      if (request.url === '/session/release') {
        await release(input.binding)
        json(response, 200, { ok: true })
        return
      }
      const binding = input.binding
      if (projectChanging) throw new Error('BMW Project is changing; retry after activation finishes')
      const owner = bindings.get(binding)
      if (!owner) throw new Error('BMW browser Session has ended')
      if(request.url==='/session/context'){
        if(activeProjectId?.()!==owner.project.id)throw new Error('Activate the Session’s BMW Project before reading its context')
        const value=await sessionContext?.(owner.sessionId,owner.project.id)??{text:''}
        if(closing||projectChanging||bindings.get(binding)!==owner||activeProjectId?.()!==owner.project.id)throw new Error('Session context changed during admission')
        if(typeof value.text!=='string'||value.text.length>16_384)throw new Error('Invalid BMW context snapshot')
        json(response,200,value);return
      }
      let disconnected = false
      const cancellation = new AbortController()
      response.on('close', () => { disconnected = true; if (!response.writableEnded) cancellation.abort(new Error('Browser call cancelled.')) })
      const started = Date.now()
      const actionName = String(record(input.arguments).action || 'unknown')
      const work = operations.run(() => {
        if (closing || projectChanging || disconnected || bindings.get(binding) !== owner) throw new Error('BMW browser Session was released or cancelled')
        if (activeProjectId?.() !== owner.project.id) throw new Error('Activate the Session’s BMW Project before using browser')
      }, async () => {
        const result = await browserKernel.execute(input.arguments, { signal: cancellation.signal, sessionOwner:{projectId:owner.project.id,sessionId:owner.sessionId} })
        if (cancellation.signal.aborted || bindings.get(binding) !== owner || closing || projectChanging || activeProjectId?.() !== owner.project.id) throw new Error('BMW_BROWSER_CANCELLED: Session changed before its browser result drained')
        const images: { type: 'image'; mimeType: 'image/png'; data: string }[] = []
        const action = record(input.arguments).action
        if (action === 'media.screenshot' || action === 'page.diagnostics' || action === 'media.frames.sample'||action==='media.image.annotate'||action==='media.image.draw') {
          const value = record(result)
          const artifacts = action === 'page.diagnostics' ? [record(value.screenshot)] : action === 'media.frames.sample' ? value.frames : [value]
          if (!Array.isArray(artifacts) || artifacts.length < 1 || artifacts.length > 8) throw new Error('Invalid image artifact collection')
          let admittedBytes = 0
          for (const item of artifacts) {
            const artifact = record(item)
            if (artifact.type !== 'screenshot' || typeof artifact.path !== 'string') throw new Error('Invalid PNG artifact identity')
            const root = await fs.realpath(path.join(owner.project.directory, 'artifacts'))
            const file = await fs.realpath(artifact.path)
            if (path.dirname(file) !== root) throw new Error('Screenshot is outside its Project artifacts')
            const stat = await fs.stat(file)
            admittedBytes += stat.size
            if (!stat.isFile() || admittedBytes > 20 * 1024 * 1024) throw new Error('Screenshot exceeds image admission limit')
            const bytes = await fs.readFile(file)
            if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG screenshot')
            images.push({ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') })
          }
        }
        return { result, images }
      }).catch(error => {
        // Only operation identity and duration; never tokens, page content or arguments.
        console.warn(`[BMW browser] ${actionName} failed after ${Date.now() - started}ms: ${error && typeof error === 'object' && 'code' in error ? String(error.code) : 'BROWSER_ACTION_FAILED'}`)
        throw error
      }).finally(() => activeCalls.delete(cancellation))
      activeCalls.set(cancellation, { binding, settled: work })
      const value = await work
      json(response, 200, { ok: true, ...value })
    } catch (caught) {
      const error = caught as ErrorWithCode
      json(response, error.code === 'PERMISSION_REQUIRED' ? 403 : 400, {
        ok: false,
        error: error.message,
        code: error.code || 'BROWSER_ACTION_FAILED'
      })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return {
    server,
    get busy() { return operations.busy || projectChanging || browserKernel.busy === true },
    get changingProject() { return projectChanging },
    async changeProject<T>(operation: () => Promise<T>): Promise<T> {
      if (closing || projectChanging || operations.busy || browserKernel.busy === true) throw new Error('BMW browser is busy; Project changes resume when it finishes')
      projectChanging = true
      try { return await operation() } finally { projectChanging = false }
    },
    token,
    /** Host-private lease API. Models only receive the browser schema. */
    registerSession: register,
    attachProviderSession(binding: string, driverId: string, sessionId: string): void {
      const owner=bindings.get(binding)
      if(closing||projectChanging||!owner||!/^[a-z0-9-]{1,64}$/u.test(driverId)||!sessionId||sessionId.length>4096)throw new Error('Invalid provider Session lease attachment')
      const key=providerKey(driverId,sessionId,owner.project.directory),existing=providerBindings.get(key)
      if(existing&&existing!==binding)throw new Error('Provider Session already owns another live BMW lease')
      providerBindings.set(key,binding)
    },
    releaseSession: release,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      closing = true
      bindings.clear()
      providerBindings.clear()
      for (const call of activeCalls.keys()) call.abort(new Error('BMW_BROWSER_CANCELLED: bridge shutting down'))
      await operations.drain()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
