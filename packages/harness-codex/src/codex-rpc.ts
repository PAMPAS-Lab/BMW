import { spawn } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { agentRecord } from '@bmw-agent/agent-contract'

export interface CodexRpc {
  call(method: string, params: unknown): Promise<unknown>
  notify(method: string, params: unknown): void
  onNotification(listener: (method: string, params: unknown) => void): () => void
  onRequest(listener: (method: string, params: unknown) => Promise<unknown>): void
  onFailure(listener: (error: Error) => void): void
  close(): Promise<void>
}
/** Official App Server JSONL transport. Only the backend chooses callable methods. */
export function createCodexRpc(executable: string, directory: string, configDirectory: string, environment: Readonly<Record<string, string>> = {}, modelCatalogPath?:string): CodexRpc {
  if(modelCatalogPath!==undefined&&!path.isAbsolute(modelCatalogPath))throw new Error('Codex browser catalog requires a host-owned absolute path')
  const args=['app-server','--listen','stdio://']
  if(modelCatalogPath!==undefined)args.push('-c','model_catalog_json='+JSON.stringify(modelCatalogPath))
  const child = spawn(executable, args, { cwd: directory, env: { ...process.env, ...environment, CODEX_HOME: configDirectory }, stdio: ['pipe', 'pipe', 'pipe'] })
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const listeners = new Set<(method: string, params: unknown) => void>()
  let nextId = 0, closed = false, closing: Promise<void> | null = null, failure: Error | null = null
  let requestHandler: ((method: string, params: unknown) => Promise<unknown>) | null = null
  let failureHandler: ((error: Error) => void) | null = null
  const fail = (error: Error) => {
    failure ??= error
    for (const row of pending.values()) { clearTimeout(row.timer); row.reject(error) }
    pending.clear(); failureHandler?.(error)
  }
  const write = (value: unknown) => {
    if (closed || failure || child.exitCode !== null || child.signalCode !== null) throw failure ?? new Error('Codex App Server is closed')
    child.stdin.write(JSON.stringify(value) + '\n')
  }
  // Native diagnostics can contain account metadata. They are never model/UI logs.
  child.stderr.on('data', () => {})
  child.on('error', fail)
  child.stdin.on('error', fail)
  child.on('exit', () => { if (!closed) fail(new Error('Codex App Server exited before transport cleanup')) })
  lines.on('line', line => {
    try {
      if (line.length > 64 * 1024 * 1024) throw new Error('Codex event exceeds its transport budget')
      const message = agentRecord(JSON.parse(line), 'Codex JSON-RPC message')
      if (typeof message.method === 'string') {
        if (typeof message.id === 'number' || typeof message.id === 'string') {
          const id = message.id
          void (async () => {
            try {
              if (!requestHandler) throw new Error('BMW has not admitted Codex tool requests')
              const result = await requestHandler(message.method as string, message.params)
              write({ id, result })
            } catch {
              try { write({ id, error: { code: -32601, message: 'BMW rejected this Agent request' } }) } catch { /* Exit already owns transport failure. */ }
            }
          })()
        } else for (const listener of listeners) listener(message.method, message.params)
      } else if (typeof message.id === 'number') {
        const row = pending.get(message.id)
        if (row) {
          pending.delete(message.id); clearTimeout(row.timer)
          if (message.error) row.reject(new Error('Codex rejected an official protocol operation'))
          else row.resolve(message.result)
        }
      }
    } catch (error: unknown) { fail(error instanceof Error ? error : new Error('Invalid Codex transport event')) }
  })
  return {
    call(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex protocol timeout: ' + method)) }, 30000)
        pending.set(id, { resolve, reject, timer })
        try { write({ id, method, params }) } catch (error: unknown) { clearTimeout(timer); pending.delete(id); reject(error) }
      })
    },
    notify: (method, params) => write({ method, params }),
    onNotification(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    onRequest(listener) { requestHandler = listener },
    onFailure(listener) { failureHandler = listener; if (failure) listener(failure) },
    close() {
      if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve()
      if (closing) return closing
      closed = true; fail(new Error('Codex transport closed')); lines.close(); listeners.clear()
      closing = new Promise<void>((resolve, reject) => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
        const terminate = setTimeout(() => child.kill('SIGTERM'), 1000)
        const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
        const timeout = setTimeout(() => reject(new Error('Codex process did not exit during cleanup')), 10000)
        child.once('exit', () => { clearTimeout(terminate); clearTimeout(kill); clearTimeout(timeout); resolve() })
        child.stdin.end()
      })
      const owned=closing
      void owned.catch(()=>{if(closing===owned)closing=null})
      return closing
    }
  }
}
