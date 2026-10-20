import path from 'node:path'
import { agentRecord } from '@bmw-agent/agent-contract'
import type { AgentRunResult } from '@bmw-agent/agent-contract'
import { workbuddySupportsProtocolVersion } from './workbuddy-model-catalog.js'

/** Process environment keys BMW forwards to the pinned CLI. Everything else is dropped. */
const inheritedKeys = ['PATH', 'TMPDIR', 'LANG', 'LC_ALL'] as const

export interface WorkbuddyEnvironmentInput {
  home: string
  apiKey: string | null
  internetEnvironment?: string
  parent?: NodeJS.ProcessEnv
}

/**
 * Build the child environment from an explicit allowlist.
 *
 * BMW must never inherit `CODEBUDDY_*` agent-context variables from its own
 * process: they redirect transcripts, sandbox brokers and gateway sessions into
 * the desktop product and make the standalone CLI unusable.
 */
export function workbuddyEnvironment(input: WorkbuddyEnvironmentInput): Record<string, string> {
  const parent = input.parent ?? process.env
  const env: Record<string, string> = {
    HOME: input.home,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TERM: 'dumb',
    ELECTRON_RUN_AS_NODE: '1',
  }
  for (const key of inheritedKeys) {
    const value = parent[key]
    if (typeof value === 'string' && value !== '') env[key] = value
  }
  if (input.apiKey !== null) env.CODEBUDDY_API_KEY = input.apiKey
  if (input.internetEnvironment !== undefined) env.CODEBUDDY_INTERNET_ENVIRONMENT = input.internetEnvironment
  return env
}

/**
 * `--setting-sources user` stops the project directory from contributing MCP
 * servers, so the only extra tool source is the server BMW declares in
 * `session/new`.
 *
 * The CLI's own catalogue stays switched on: `--tools` is applied to forwarded
 * MCP tools as well, so `--tools ""` silently removes `mcp__*` and the model can
 * never reach BMW's browser. BMW therefore admits a single tool through the
 * permission channel instead, which the CLI routes for every built-in.
 */
export function workbuddySpawnArgs(model: string): string[] {
  return ['--acp', '--setting-sources', 'user', '--model', model]
}

export interface WorkbuddyMcpServer {
  name: string
  command: string
  args: string[]
  env: { name: string; value: string }[]
}

export function workbuddyMcpServer(input: { node: string; serverPath: string; bridgeUrl: string; bridgeToken: string; binding: string }): WorkbuddyMcpServer {
  if (!path.isAbsolute(input.serverPath)) throw new Error('BMW bridge server requires a host-owned absolute path')
  return {
    name: 'bmw',
    command: input.node,
    args: [input.serverPath],
    env: [
      { name: 'BMW_BRIDGE_URL', value: input.bridgeUrl },
      { name: 'BMW_BRIDGE_TOKEN', value: input.bridgeToken },
      { name: 'BMW_SESSION_BINDING', value: input.binding },
      { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
    ],
  }
}

/** BMW declares no filesystem and no terminal capability: those tools cannot be proxied to us. */
export function workbuddyInitializeParams(): Record<string, unknown> {
  return {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, auth: { terminal: false } },
    clientInfo: { name: 'bmw_agent', title: 'BMW Assistant', version: '0.1.0' },
  }
}

export function workbuddySessionParams(directory: string, server: WorkbuddyMcpServer): Record<string, unknown> {
  return { cwd: directory, mcpServers: [{ type: 'stdio', ...server }] }
}

/**
 * The credential probe opens a session that can never call a tool. `mcpServers`
 * must still be present and empty: the official CLI rejects the request outright
 * when the field is omitted, which reads as "bad credentials" if BMW lets it through.
 */
export function workbuddyProbeSessionParams(directory: string): Record<string, unknown> {
  return { cwd: directory, mcpServers: [] }
}

export function workbuddyProtocolVersion(raw: unknown): number {
  const value = agentRecord(raw, 'WorkBuddy initialize result')
  if (typeof value.protocolVersion !== 'number' || !workbuddySupportsProtocolVersion(value.protocolVersion)) {
    throw new Error('BMW 尚未验证当前 WorkBuddy ACP 协议版本（' + String(value.protocolVersion) + '）；请更新 BMW 适配或指定已固定的官方 CLI。')
  }
  return value.protocolVersion
}

/** Login methods the agent advertises. BMW renders these instead of hard-coding a scheme. */
export function workbuddyAuthMethods(raw: unknown): { id: string; label: string }[] {
  const value = agentRecord(raw, 'WorkBuddy initialize result')
  if (!Array.isArray(value.authMethods)) return []
  return value.authMethods.slice(0, 20).map(rawMethod => {
    const method = agentRecord(rawMethod)
    if (typeof method.id !== 'string' || method.id.length > 64) throw new Error('Invalid WorkBuddy auth method')
    return { id: method.id, label: typeof method.name === 'string' ? method.name.slice(0, 200) : method.id }
  })
}

/** The only tool BMW's bridge MCP server exposes. */
const workbuddyBridgeTool = 'browser'

/** The CLI's dynamic-tool forwarder: it names the real tool in `rawInput.toolName`. */
const workbuddyForwardsTool = 'deferexecutetool'

/** The CLI's own catalogue lookup. It never touches the host and is never shown. */
const workbuddyDiscoveryTool = 'toolsearch'

function workbuddyLowerName(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value.toLowerCase() : null
}

/**
 * A tool name reaches BMW through three different channels: `_meta` on
 * permission prompts, `name`/`title` on progress updates. Read them in that
 * order — `_meta` is authoritative for the call that actually executes.
 */
export function workbuddyUpdateToolName(update: unknown): string {
  if (typeof update !== 'object' || update === null || Array.isArray(update)) return ''
  const value = update as Record<string, unknown>
  const meta = value._meta
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    const named = workbuddyLowerName((meta as Record<string, unknown>)['codebuddy.ai/toolName'])
    if (named) return named
  }
  return workbuddyLowerName(value.name) ?? workbuddyLowerName(value.title) ?? ''
}

/** `browser`, `mcp__bmw__browser` and `bmw/browser` all name BMW's own tool. */
export function workbuddyIsBridgeTool(name: string): boolean {
  if (name === workbuddyBridgeTool) return true
  return /^mcp__[a-z0-9_-]+__browser$/.test(name) || /^[a-z0-9_-]+[/.:]browser$/.test(name)
}

/** True only for a call that resolves to BMW's browser tool, directly or forwarded. */
export function workbuddyAdmitsTool(update: unknown): boolean {
  const name = workbuddyUpdateToolName(update)
  if (name !== workbuddyForwardsTool && name !== 'defer_execute_tool') return workbuddyIsBridgeTool(name)
  const raw = typeof update === 'object' && update !== null && !Array.isArray(update) ? (update as Record<string, unknown>).rawInput : undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const inner = (raw as Record<string, unknown>).toolName
  return typeof inner === 'string' && workbuddyIsBridgeTool(inner.toLowerCase())
}

/** Catalogue lookups stay hidden: they are not part of BMW's visible turn. */
export function workbuddyIsDiscoveryTool(update: unknown): boolean {
  return workbuddyUpdateToolName(update) === workbuddyDiscoveryTool
}

/**
 * A forwarded name only settles once it is complete. While the CLI streams the
 * bridge identity it passes through `m`, `mcp`, `mcp__bmw` and `mcp__bmw__`;
 * those prefixes are not a decision and must not be judged. BMW declares the
 * only MCP server as `bmw` with its single `browser` tool, so the settled name
 * is fixed. Anything else is settled, so a foreign name still reaches admission
 * and is rejected there rather than being waited on forever.
 */
const workbuddyForwardedIdentity = 'mcp__bmw__browser'

function workbuddySettledToolName(name: string): boolean {
  if (name !== workbuddyForwardedIdentity && workbuddyForwardedIdentity.startsWith(name)) return false
  if (/^[a-z0-9_-]+[/.:]$/.test(name)) return false
  return true
}

/**
 * Argument fragments stream *before* the tool that carries them. A forwarded call
 * is announced with an empty `rawInput` and only later names the real tool, so
 * admission cannot be decided until the arguments are complete.
 */
export function workbuddyArgumentsComplete(update: unknown): boolean {
  if (typeof update !== 'object' || update === null || Array.isArray(update)) return false
  const value = update as Record<string, unknown>
  const meta = value._meta
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    if ((meta as Record<string, unknown>)['codebuddy.ai/toolArgumentsComplete'] === true) return true
  }
  const raw = value.rawInput
  const input = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  // `tool_call` announces a complete `name`; only `tool_call_update` streams
  // argument fragments, so a bare call is already decidable.
  if (input === null) return value.sessionUpdate === 'tool_call'
  const outer = workbuddyUpdateToolName(value)
  if (outer === workbuddyForwardsTool || outer === 'defer_execute_tool') {
    const inner = workbuddyLowerName(input.toolName)
    return inner !== null && workbuddySettledToolName(inner)
  }
  return typeof input.action === 'string' && input.action !== ''
}

/** The only agent → client request BMW answers, and only for its own browser tool. */
export function workbuddyAdmitsClientRequest(method: string, params: unknown): boolean {
  if (method !== 'session/request_permission') return false
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return false
  const toolCall = (params as Record<string, unknown>).toolCall
  if (typeof toolCall !== 'object' || toolCall === null || Array.isArray(toolCall)) return false
  return workbuddyAdmitsTool(toolCall)
}

export function workbuddyStopOutcome(raw: unknown): AgentRunResult {
  const value = agentRecord(raw, 'WorkBuddy prompt response')
  const reason = value.stopReason
  if (reason === 'end_turn') return { outcome: 'success', message: '' }
  if (reason === 'cancelled') return { outcome: 'interrupted', message: 'WorkBuddy stopped' }
  if (reason === 'max_tokens' || reason === 'max_turn_requests' || reason === 'refusal') {
    return { outcome: 'failed', message: 'WorkBuddy ended the turn early: ' + reason }
  }
  throw new Error('Invalid WorkBuddy stop reason')
}
