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
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    CODEBUDDY_DISABLE_COMPILE_CACHE: '1',
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

/** Same fixed configuration for the isolated catalog probe and the live runtime. */
export function workbuddySpawnArgs(model: string): string[] {
  return ['--acp', '--setting-sources', '', '--model', model, '--tools', 'NoDefer(mcp__bmw__browser)', '--strict-mcp-config']
}

export interface WorkbuddyMcpServer {
  name: string
  command: string
  args: string[]
  env: { name: string; value: string }[]
}

export function workbuddyMcpServer(input: { node: string; serverPath: string; bridgeUrl: string; bridgeToken: string; binding?: string; catalogOnly?: boolean }): WorkbuddyMcpServer {
  if (!path.isAbsolute(input.serverPath)) throw new Error('BMW bridge server requires a host-owned absolute path')
  return {
    name: 'bmw',
    command: input.node,
    args: [input.serverPath],
    env: [
      { name: 'BMW_BRIDGE_URL', value: input.bridgeUrl },
      { name: 'BMW_BRIDGE_TOKEN', value: input.bridgeToken },
      ...(input.catalogOnly ? [{ name: 'BMW_CATALOG_ONLY', value: '1' }] : [{ name: 'BMW_SESSION_BINDING', value: input.binding ?? '' }]),
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

export function workbuddyProtocolVersion(raw: unknown): number {
  const value = agentRecord(raw, 'WorkBuddy initialize result')
  if (typeof value.protocolVersion !== 'number' || !workbuddySupportsProtocolVersion(value.protocolVersion)) {
    throw new Error('BMW 尚未验证当前 WorkBuddy ACP 协议版本（' + String(value.protocolVersion) + '）；请更新 BMW 适配或指定已固定的官方 CLI。')
  }
  return value.protocolVersion
}

/** Progress may carry a human title; only native metadata/name establishes identity. */
export function workbuddyUpdateToolName(update: unknown): string {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return ''
  const value = update as Record<string, unknown>
  const meta = value._meta
  const name = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>)['codebuddy.ai/toolName'] : undefined
  return typeof name === 'string' ? name : typeof value.name === 'string' ? value.name : ''
}
export function workbuddyIsBridgeTool(name: string): boolean { return name === 'browser' || name === 'mcp__bmw__browser' }
export function workbuddyAdmitsTool(update: unknown): boolean { return workbuddyIsBridgeTool(workbuddyUpdateToolName(update)) }

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
  const meta = value._meta && typeof value._meta === 'object' && !Array.isArray(value._meta) ? value._meta as Record<string, unknown> : {}
  const rawOutcome = meta['codebuddy.ai/outcome']
  const outcome = typeof rawOutcome === 'string' ? rawOutcome.toLowerCase() : rawOutcome
  if (typeof outcome === 'string' && outcome !== 'success' && outcome !== 'completed') return { outcome: outcome === 'cancelled' ? 'interrupted' : 'failed', message: 'WorkBuddy 服务未能完成本次任务；请检查 Key、模型权限或服务状态' }
  const reason = value.stopReason
  if (reason === 'end_turn') return { outcome: 'success', message: '' }
  if (reason === 'cancelled') return { outcome: 'interrupted', message: 'WorkBuddy stopped' }
  if (reason === 'max_tokens' || reason === 'max_turn_requests' || reason === 'refusal') {
    return { outcome: 'failed', message: 'WorkBuddy ended the turn early: ' + reason }
  }
  throw new Error('Invalid WorkBuddy stop reason')
}
