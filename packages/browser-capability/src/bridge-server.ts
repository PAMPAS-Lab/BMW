import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionOperations } from './session-operations.js'
import type { AddressInfo } from 'node:net'

interface BrowserExecutor {
  execute(input: unknown): Promise<unknown>
}

interface ErrorWithCode extends Error {
  code?: string
}

function json(response: http.ServerResponse, status: number, value: unknown): void {
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
interface BridgeOptions { productId?: string; resolveProject?: (directory: string) => Project | undefined; activeProjectId?: () => string; toolDefinition?: unknown }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid browser bridge input')
  return value as Record<string, unknown>
}

export async function createBridgeServer(browserKernel: BrowserExecutor, { productId = 'bmw', resolveProject, activeProjectId, toolDefinition }: BridgeOptions = {}) {
  const token = crypto.randomBytes(32).toString('hex')
  const operations = new SessionOperations()
  const bindings = new Map<string, { project: Project; sessionId: string }>()
  let closing = false
  let projectChanging = false
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
    if (request.method !== 'POST' || !['/execute', '/session/register', '/session/release'].includes(request.url || '')) {
      json(response, 404, { error: 'not-found' })
      return
    }
    try {
      const input = record(await readJson(request))
      if (closing) throw new Error('BMW browser bridge is shutting down')
      if (request.url === '/session/register') {
        if (typeof input.sessionId !== 'string' || !input.sessionId || typeof input.directory !== 'string') throw new Error('Invalid DSH Session identity')
        const project = resolveProject?.(input.directory)
        if (!project) throw new Error('DSH Session does not belong to an active BMW Project')
        const binding = crypto.randomBytes(32).toString('hex')
        bindings.set(binding, { project, sessionId: input.sessionId })
        json(response, 200, { binding })
        return
      }
      if (typeof input.binding !== 'string') throw new Error('BMW browser requires a Session binding')
      if (request.url === '/session/release') {
        bindings.delete(input.binding)
        json(response, 200, { ok: true })
        return
      }
      const binding = input.binding
      if (projectChanging) throw new Error('BMW Project is changing; retry after activation finishes')
      const owner = bindings.get(binding)
      if (!owner) throw new Error('BMW browser Session has ended')
      let disconnected = false
      response.on('close', () => { disconnected = true })
      const value = await operations.run(() => {
        if (closing || projectChanging || disconnected || bindings.get(binding) !== owner) throw new Error('BMW browser Session was released or cancelled')
        if (activeProjectId?.() !== owner.project.id) throw new Error('Activate the Session’s BMW Project before using browser')
      }, async () => {
        const result = await browserKernel.execute(input.arguments)
        const images: { type: 'image'; mimeType: 'image/png'; data: string }[] = []
        const action = record(input.arguments).action
        if (action === 'media.screenshot' || action === 'page.diagnostics') {
          const value = record(result)
          const artifact = action === 'page.diagnostics' ? record(value.screenshot) : value
          if (artifact.type === 'screenshot' && typeof artifact.path === 'string') {
            const root = await fs.realpath(path.join(owner.project.directory, 'artifacts'))
            const file = await fs.realpath(artifact.path)
            if (path.dirname(file) !== root) throw new Error('Screenshot is outside its Project artifacts')
            const stat = await fs.stat(file)
            if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Screenshot exceeds image admission limit')
            const bytes = await fs.readFile(file)
            if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG screenshot')
            images.push({ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') })
          }
        }
        return { result, images }
      })
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
    get busy() { return operations.busy || projectChanging },
    async changeProject<T>(operation: () => Promise<T>): Promise<T> {
      if (closing || projectChanging || operations.busy) throw new Error('BMW browser is busy; Project changes resume when it finishes')
      projectChanging = true
      try { return await operation() } finally { projectChanging = false }
    },
    token,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      closing = true
      bindings.clear()
      await operations.drain()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
