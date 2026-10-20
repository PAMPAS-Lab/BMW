import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { agentIdentifier, agentRecord } from '@bmw-agent/agent-contract'
import { createWorkbuddyAcp } from './workbuddy-acp.js'
import { workbuddyEnvironment, workbuddyInitializeParams, workbuddyMcpServer, workbuddyProtocolVersion, workbuddySessionParams, workbuddySpawnArgs } from './workbuddy-policy.js'
import { workbuddyPinnedCliVersion } from './workbuddy-model-catalog.js'

export interface WorkbuddyBrowserDefinition { name: 'browser'; description: string; inputSchema: Record<string, unknown> }
export interface WorkbuddyCatalogOptions {
  node: string; cli: string; model: string; workspace: string
  internetEnvironment: 'internal' | ''
  browser: WorkbuddyBrowserDefinition
  mcp: { node: string; serverPath: string; bridgeUrl: string; bridgeToken: string }
  signal: AbortSignal
  watchedFiles: string[]
  resume?: { sessionId: string; historyFile: string; relativeHistoryPath: string }
  timeoutMs?: number
}
export interface WorkbuddyAdmission { assertCurrent(): void }
export class WorkbuddyCleanupFailure extends Error {
  constructor(private readonly cleanup: () => Promise<void>) { super('WorkBuddy 清理未完成；资源已隔离，须恢复清理后才能继续') }
  async recover(): Promise<void> { await this.cleanup() }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
export function assertWorkbuddyWorkspace(workspace: string): void {
  if (!path.isAbsolute(workspace)) throw new Error('WorkBuddy Project must be absolute')
  for (let directory = workspace;; directory = path.dirname(directory)) {
    if (fs.existsSync(path.join(directory, '.codebuddy', 'models.json'))) throw new Error('WorkBuddy 不允许 Project 覆盖模型服务地址')
    if (path.dirname(directory) === directory) break
  }
}
export function copyWorkbuddyResume(home: string, resume?: WorkbuddyCatalogOptions['resume']): void {
  if (!resume) return
  agentIdentifier(resume.sessionId)
  if (!path.isAbsolute(resume.historyFile)) throw new Error('WorkBuddy native history must be absolute')
  const stat = fs.lstatSync(resume.historyFile)
  if (!/^[a-zA-Z0-9-]+$/.test(resume.sessionId) || !/^\.codebuddy\/projects\/[^/]+\/[a-zA-Z0-9-]+\.jsonl$/.test(resume.relativeHistoryPath) || !resume.relativeHistoryPath.endsWith('/' + resume.sessionId + '.jsonl') || !stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error('Invalid WorkBuddy immutable resume snapshot')
  const target = path.join(home, resume.relativeHistoryPath)
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  const temporary = target + '.' + randomUUID() + '.tmp'
  try { fs.copyFileSync(resume.historyFile, temporary, fs.constants.COPYFILE_EXCL); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, target) }
  finally { fs.rmSync(temporary, { force: true }) }
}
/** Observe the official loop's actual request at a sink that can never forward inference.
 * No caller text or real credential is accepted here. Each prepare obtains a fresh proof.
 */
export class WorkbuddyCatalogGate {
  async verify(options: WorkbuddyCatalogOptions): Promise<WorkbuddyAdmission> {
    if (process.platform === 'win32') throw new Error('WorkBuddy Windows 原生进程树清理尚未验证，当前不可用')
    options.signal.throwIfAborted(); assertWorkbuddyWorkspace(options.workspace)
    const runtimeRoot = path.dirname(path.dirname(options.cli))
    const manifest = agentRecord(JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'package.json'), 'utf8')))
    if (manifest.name !== '@tencent-ai/codebuddy-code' || manifest.version !== workbuddyPinnedCliVersion) throw new Error('Unverified WorkBuddy runtime')
    const files = [options.node, options.cli, path.join(runtimeRoot, 'package.json'), path.join(runtimeRoot, 'dist/codebuddy-headless.js'), path.join(runtimeRoot, 'product.json'), path.join(runtimeRoot, 'product.internal.json'), options.mcp.node, options.mcp.serverPath, ...options.watchedFiles, ...(options.resume ? [options.resume.historyFile] : [])]
    const scope = () => {
      assertWorkbuddyWorkspace(options.workspace)
      return hash(canonical({ files: files.map(file => ({ file, hash: fs.existsSync(file) ? hash(fs.readFileSync(file)) : null })), model: options.model, browser: options.browser, mcp: options.mcp, workspace: options.workspace, environment: options.internetEnvironment, resume: options.resume ?? null, args: workbuddySpawnArgs(options.model) }))
    }
    const before = scope()
    const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-workbuddy-catalog-')))
    const home = path.join(temporary, 'home'); fs.mkdirSync(home, { mode: 0o700 })
    let acp: ReturnType<typeof createWorkbuddyAcp> | undefined
    let settled = false, admitted = false, catalogError: Error | null = null
    let accept!: () => void, reject!: (error: Error) => void
    const captured = new Promise<void>((yes, no) => { accept = yes; reject = no }); void captured.catch(() => {})
    const fail = (error: Error) => { catalogError ??= error; if (!settled) { settled = true; reject(error) } }
    const expectedSchema = { ...structuredClone(options.browser.inputSchema), additionalProperties: true }
    const server = http.createServer(async (request, response) => {
      try {
        let body = ''
        for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('Catalog request exceeds budget') }
        if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) throw new Error('Unexpected catalog endpoint')
        let parsed: unknown
        try { parsed = JSON.parse(body) } catch { throw new Error('Invalid WorkBuddy catalog JSON') }
        const value = agentRecord(parsed)
        if (['functions', 'input', 'additional_tools', 'builtin_tools', 'web_search_options'].some(key => key in value) || (value.tools !== undefined && !Array.isArray(value.tools))) throw new Error('Unsupported catalog encoding')
        const tools = (value.tools ?? []) as unknown[]
        // Auxiliary requests without tools do not establish admission.
        if (tools.length) {
          if (tools.length !== 1 || value.model !== options.model) throw new Error('Effective catalog must contain exactly BMW browser')
          const tool = agentRecord(tools[0]), definition = agentRecord(tool.function)
          if (Object.keys(tool).some(key => !['type', 'function'].includes(key)) || Object.keys(definition).some(key => !['name', 'description', 'parameters', 'strict'].includes(key)) || tool.type !== 'function' || definition.name !== 'mcp__bmw__browser' || definition.description !== options.browser.description || canonical(definition.parameters) !== canonical(expectedSchema) || (definition.strict !== undefined && definition.strict !== false)) throw new Error('BMW browser catalog identity/schema mismatch')
          if (!settled) { settled = true; admitted = true; accept() }
        }
      } catch (error: unknown) { fail(error instanceof Error ? error : new Error('Invalid WorkBuddy catalog')) }
      finally { if (!response.destroyed) { response.writeHead(503, { 'content-type': 'application/json' }); response.end('{"error":{"message":"BMW catalog verification never forwards inference"}}') } }
    })
    let sessionId: string | undefined, timeout: ReturnType<typeof setTimeout> | undefined
    const abort = () => fail(new Error('WorkBuddy catalog verification cancelled'))
    let disposed = false
    const cleanup = async () => {
      if (disposed) return
      if (sessionId && acp) { try { acp.notify('session/cancel', { sessionId }) } catch {} }
      await acp?.close()
      server.closeAllConnections()
      if (server.listening) await new Promise<void>((yes, no) => server.close(error => error ? no(error) : yes()))
      fs.rmSync(temporary, { recursive: true, force: true }); disposed = true
    }
    try {
      copyWorkbuddyResume(home, options.resume)
      await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes) })
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local catalog endpoint')
      const env = workbuddyEnvironment({ home, apiKey: 'bmw-unused-local-catalog-fixture', internetEnvironment: options.internetEnvironment, parent: {} })
      env.CODEBUDDY_BASE_URL = 'http://127.0.0.1:' + address.port
      env.TMPDIR = temporary
      acp = createWorkbuddyAcp({ node: options.node, cli: options.cli, args: workbuddySpawnArgs(options.model), cwd: options.workspace, env })
      acp.onFailure(fail)
      acp.onRequest(async () => { fail(new Error('Catalog verification cannot execute tools')); throw new Error('Catalog verification cannot execute tools') })
      options.signal.addEventListener('abort', abort, { once: true }); if (options.signal.aborted) abort()
      timeout = setTimeout(() => fail(new Error('No authoritative WorkBuddy browser catalog was captured')), options.timeoutMs ?? 20000)
      const drive = (async () => {
        workbuddyProtocolVersion(await acp!.call('initialize', workbuddyInitializeParams()))
        const params = workbuddySessionParams(options.workspace, workbuddyMcpServer({ ...options.mcp, catalogOnly: true }))
        const session = agentRecord(await acp!.call(options.resume ? 'session/load' : 'session/new', { ...params, ...(options.resume ? { sessionId: options.resume.sessionId } : {}) }))
        sessionId = typeof session.sessionId === 'string' ? agentIdentifier(session.sessionId) : options.resume?.sessionId
        if (!sessionId || (options.resume && sessionId !== options.resume.sessionId)) throw new Error('Catalog resume identity mismatch')
        await acp!.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'BMW isolated catalog verification. No inference or execution is available.' }] })
        if (!admitted) fail(new Error('No authoritative WorkBuddy browser catalog was captured'))
      })()
      void drive.catch(error => { if (!admitted) fail(error instanceof Error ? error : new Error('Catalog verification failed')) })
      await captured; options.signal.throwIfAborted()
    } finally {
      if (timeout) clearTimeout(timeout)
      options.signal.removeEventListener('abort', abort)
      try { await cleanup() } catch { throw new WorkbuddyCleanupFailure(cleanup) }
    }
    if (catalogError) throw catalogError
    const proof: WorkbuddyAdmission = { assertCurrent() { options.signal.throwIfAborted(); if (scope() !== before) throw new Error('WorkBuddy configuration changed after catalog verification') } }
    proof.assertCurrent(); return proof
  }
}
