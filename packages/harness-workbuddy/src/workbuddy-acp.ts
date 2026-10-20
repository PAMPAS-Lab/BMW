import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { agentRecord } from '@bmw-agent/agent-contract'

export interface WorkbuddyAcp {
  call(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  notify(method: string, params: unknown): void
  /** Agent → client requests. BMW rejects everything it did not admit. */
  onRequest(listener: (method: string, params: unknown) => Promise<unknown>): void
  onNotification(listener: (method: string, params: unknown) => void): () => void
  onFailure(listener: (error: Error) => void): void
  close(): Promise<void>
}

export interface WorkbuddyAcpOptions {
  node: string
  cli: string
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
}

/**
 * A JSON-RPC code is protocol metadata. The agent's error *text* can carry
 * account detail, so diagnostics stop at the code.
 */
function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const code = (error as Record<string, unknown>).code
  return typeof code === 'number' && Number.isFinite(code) ? ' (code ' + code + ')' : ''
}

/**
 * Official ACP transport: newline-delimited JSON-RPC 2.0 over stdio.
 * Only the backend chooses callable methods; the transport never interprets them.
 */
export function createWorkbuddyAcp(options: WorkbuddyAcpOptions): WorkbuddyAcp {
  const child = spawn(options.node, [options.cli, ...options.args], {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const listeners = new Set<(method: string, params: unknown) => void>()
  let nextId = 0
  let closed = false
  let closing: Promise<void> | null = null
  let failure: Error | null = null
  let physicallyClosed = false
  const handlers = new Set<Promise<void>>()
  const groupAlive = () => { if (process.platform === 'win32' || !child.pid) return !physicallyClosed; try { process.kill(-child.pid, 0); return true } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error } }
  const terminateGroup = (signal: NodeJS.Signals) => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal) } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } }
  const processClosed = new Promise<void>(resolve => child.once('close', () => { physicallyClosed = true; resolve() }))
  let requestHandler: ((method: string, params: unknown) => Promise<unknown>) | null = null
  let failureHandler: ((error: Error) => void) | null = null

  const fail = (error: Error) => {
    failure ??= error
    for (const row of pending.values()) { clearTimeout(row.timer); row.reject(error) }
    pending.clear()
    if (!closed) failureHandler?.(error)
  }
  const write = (value: unknown) => {
    if (closed || failure || child.exitCode !== null || child.signalCode !== null) throw failure ?? new Error('WorkBuddy ACP session is closed')
    child.stdin.write(JSON.stringify(value) + '\n')
  }
  // Drain diagnostics without exposing account detail to the UI or logs.
  child.stderr.on('data', () => {})
  child.on('error', fail)
  child.stdin.on('error', fail)
  child.on('exit', () => { if (!closed) fail(new Error('WorkBuddy ACP process exited before transport cleanup')) })
  lines.on('line', line => {
    try {
      if (line.length > 32 * 1024 * 1024) throw new Error('WorkBuddy event exceeds its transport budget')
      const message = agentRecord(JSON.parse(line), 'WorkBuddy ACP message')
      if (typeof message.method === 'string') {
        if (typeof message.id === 'number' || typeof message.id === 'string') {
          const id = message.id
          const handler = (async () => {
            try {
              if (!requestHandler) throw new Error('BMW has not admitted WorkBuddy client requests')
              write({ jsonrpc: '2.0', id, result: await requestHandler(message.method as string, message.params) })
            } catch {
              try { write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'BMW rejected this Agent request' } }) } catch { /* Exit already owns transport failure. */ }
            }
          })()
          handlers.add(handler)
          void handler.finally(() => handlers.delete(handler))
        } else for (const listener of listeners) listener(message.method, message.params)
      } else if (typeof message.id === 'number') {
        const row = pending.get(message.id)
        if (row) {
          pending.delete(message.id)
          clearTimeout(row.timer)
          if (message.error) row.reject(new Error('WorkBuddy rejected an official protocol operation' + errorCode(message.error)))
          else row.resolve(message.result)
        }
      }
    } catch { fail(new Error('Invalid WorkBuddy transport event')) }
  })

  return {
    call(method, params, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('WorkBuddy protocol timeout: ' + method)) }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        try { write({ jsonrpc: '2.0', id, method, params }) } catch (error: unknown) { clearTimeout(timer); pending.delete(id); reject(error) }
      })
    },
    notify: (method, params) => write({ jsonrpc: '2.0', method, params }),
    onRequest(listener) { requestHandler = listener },
    onNotification(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    onFailure(listener) { failureHandler = listener; if (failure) listener(failure) },
    close() {
      if (closing) return closing
      closed = true
      fail(new Error('WorkBuddy transport closed'))
      closing = (async () => {
        if (!physicallyClosed) {
          const terminate = setTimeout(() => terminateGroup('SIGTERM'), 1000)
          const kill = setTimeout(() => terminateGroup('SIGKILL'), 3000)
          let timeout: ReturnType<typeof setTimeout> | undefined
          try {
            child.stdin.end()
            await Promise.race([processClosed, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('WorkBuddy CLI cleanup is pending')), 6000) })])
          } finally { clearTimeout(terminate); clearTimeout(kill); if (timeout) clearTimeout(timeout) }
        }
        if (groupAlive()) {
          terminateGroup('SIGTERM')
          const deadline = Date.now() + 5000
          while (groupAlive()) {
            if (Date.now() > deadline) throw new Error('WorkBuddy child process cleanup is pending')
            if (Date.now() > deadline - 3000) terminateGroup('SIGKILL')
            await new Promise(resolve => setTimeout(resolve, 25))
          }
        }
        await Promise.all([...handlers])
        lines.close(); listeners.clear()
      })()
      const owned = closing
      void owned.catch(() => { if (closing === owned) closing = null })
      return closing
    },
  }
}
