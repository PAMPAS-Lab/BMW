import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

export interface DshRow {
  workspaceId?: string; path?: string; title?: string; sessionIds?: string[]
  name?: string
  sessionId?: string; cwd?: string; updatedAt?: number; running?: boolean; blank?: boolean
  origin?: string; parentSessionId?: string; agentPreset?: string; snippet?: string
  projections?: { values?: Record<string, unknown> }
}
export interface DshHistoryRow {
  event: { type: string; data?: { source?: { rpcId?: string }; [key: string]: unknown } }
}
export interface DshValue {
  items?: DshRow[]; workspace?: DshRow; archivedSessionIds?: string[]
  sessionId?: string; events?: DshHistoryRow[]; hasMore?: boolean; [key: string]: unknown
}

export function remoteValue(value: unknown): DshValue {
  const result = record(value)
  if (result.items !== undefined) {
    if (!Array.isArray(result.items)) throw new Error('Invalid DSH items.')
    for (const item of result.items) validateRow(item)
  }
  if (result.workspace !== undefined) validateRow(result.workspace)
  if (result.archivedSessionIds !== undefined && (!Array.isArray(result.archivedSessionIds)
    || !result.archivedSessionIds.every((id) => typeof id === 'string'))) throw new Error('Invalid DSH archive set.')
  if (result.sessionId !== undefined && typeof result.sessionId !== 'string') throw new Error('Invalid DSH session identity.')
  return result as DshValue
}

function validateRow(value: unknown) {
  const row = record(value)
  for (const key of ['workspaceId', 'path', 'title', 'name', 'sessionId', 'cwd', 'origin', 'parentSessionId', 'agentPreset', 'snippet']) {
    if (row[key] !== undefined && row[key] !== null && typeof row[key] !== 'string') throw new Error(`Invalid DSH ${key}.`)
  }
  if (row.sessionIds !== undefined && (!Array.isArray(row.sessionIds) || !row.sessionIds.every((id) => typeof id === 'string'))) throw new Error('Invalid DSH membership.')
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid DSH object.')
  return value as Record<string, unknown>
}

export function launchUrl(line: string, origin: string): string | null {
  const match = /^dsh web: (https?:\/\/\S+)/.exec(line.trim())
  if (!match) return null
  try {
    const url = new URL(match[1])
    if (url.origin !== origin || url.pathname !== '/' || url.username || url.password
      || url.searchParams.getAll('token').length !== 1 || !url.searchParams.get('token')) return null
    return url.href
  } catch { return null }
}

/** Read a fresh opening snapshot and cancel its server-owned stream immediately. */
export function remoteSnapshot(origin: string, cookie: string, endpoint: string, args: Record<string, unknown>, timeoutMs = 30_000,signal?:AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const url = new URL('/api/remote.mux', origin)
  url.protocol = 'ws:'
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { cookie }, maxPayload: 16 * 1024 * 1024, handshakeTimeout: timeoutMs })
    const streamId = randomUUID()
    let settled = false
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort',abort)
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'cancel', streamId }))
        socket.close()
      } else socket.terminate()
      if (error) reject(error)
      else resolve(value!)
    }
    const timer = setTimeout(() => finish(new Error(`DSH ${endpoint} snapshot timed out.`)), timeoutMs)
    const abort=()=>finish(new Error('DSH history read cancelled'))
    signal?.addEventListener('abort',abort,{once:true})
    if(signal?.aborted)abort()
    socket.once('open', () => socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } })))
    socket.on('message', (bytes) => {
      try {
        const message = record(JSON.parse(bytes.toString()))
        if (message.streamId !== streamId) throw new Error('Mismatched DSH stream identity.')
        if (message.type === 'item') finish(undefined, record(message.value))
        else if (message.type === 'error') finish(new Error(String(record(message.error).message || 'DSH stream failed.')))
        else if (message.type === 'end') finish(new Error('DSH stream ended before its snapshot.'))
        else throw new Error('Invalid DSH stream frame.')
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
    socket.once('error', (error) => finish(error))
    socket.once('close', () => finish(new Error('DSH connection closed before its snapshot.')))
  })
}

export function remoteRequest(method: string, payload: Record<string, unknown>, requestId: string) {
  const endpoint = method.replace('.', '/')
  if (!/^[a-zA-Z][\w-]*\/[a-zA-Z][\w-]*$/.test(endpoint)) throw new Error('Invalid DSH method.')
  if (method.includes('/')) return { endpoint, payload }
  const request = method === 'session.prompt' ? { ...payload, requestId } : payload
  return { endpoint, payload: { args: { [method === 'session.list' ? '_request' : 'request']: request } } }
}
