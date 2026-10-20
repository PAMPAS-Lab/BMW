import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
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
  })
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const listeners = new Set<(method: string, params: unknown) => void>()
  let nextId = 0
  let closed = false
  let closing: Promise<void> | null = null
  let failure: Error | null = null
  let requestHandler: ((method: string, params: unknown) => Promise<unknown>) | null = null
  let failureHandler: ((error: Error) => void) | null = null

  const fail = (error: Error) => {
    failure ??= error
    for (const row of pending.values()) { clearTimeout(row.timer); row.reject(error) }
    pending.clear()
    failureHandler?.(error)
  }
  const write = (value: unknown) => {
    if (closed || failure || child.exitCode !== null || child.signalCode !== null) throw failure ?? new Error('WorkBuddy ACP session is closed')
    child.stdin.write(JSON.stringify(value) + '\n')
  }
  // Native diagnostics can contain account metadata. They are never model/UI logs,
  // so they are dropped unless an operator explicitly asks for a local tap file.
  const stderrTap = process.env.BMW_ACP_STDERR_LOG
  child.stderr.on('data', (chunk: Buffer) => { if (stderrTap) { try { appendFileSync(stderrTap, chunk) } catch {} } })
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
          void (async () => {
            try {
              if (!requestHandler) throw new Error('BMW has not admitted WorkBuddy client requests')
              write({ jsonrpc: '2.0', id, result: await requestHandler(message.method as string, message.params) })
            } catch {
              try { write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'BMW rejected this Agent request' } }) } catch { /* Exit already owns transport failure. */ }
            }
          })()
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
    } catch (error: unknown) { fail(error instanceof Error ? error : new Error('Invalid WorkBuddy transport event')) }
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
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
      if (closing) return closing
      closed = true
      fail(new Error('WorkBuddy transport closed'))
      lines.close()
      listeners.clear()
      closing = new Promise<void>((resolve, reject) => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
        const terminate = setTimeout(() => child.kill('SIGTERM'), 1000)
        const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
        const timeout = setTimeout(() => reject(new Error('WorkBuddy CLI did not exit during cleanup')), 10000)
        child.once('exit', () => { clearTimeout(terminate); clearTimeout(kill); clearTimeout(timeout); resolve() })
        child.stdin.end()
      })
      const owned = closing
      void owned.catch(() => { if (closing === owned) closing = null })
      return closing
    },
  }
}
