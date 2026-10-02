import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { browserRegistry } from './registry.js'
import type { Registry } from './registry.js'

interface PluginContext { tools: Registry; effect(callback: () => () => Promise<void>, label: string): unknown; [key: string]: unknown }
interface McpPlugin { Config: unknown; inject: string[]; apply(ctx: PluginContext, config: unknown): unknown }

// Resolve against the running DSH installation, never a second Harness copy.
const requireDsh = createRequire(realpathSync(process.argv[1]))
const upstream = await import(requireDsh.resolve('@deepseek-ai/dsh-mcp-client')) as McpPlugin
export const Config = upstream.Config
export const inject = upstream.inject

export async function apply(ctx: PluginContext, config: unknown) {
  const bindings = new Map<object, Promise<string>>()
  let disposed = false
  const bridgeUrl = process.env.BMW_BRIDGE_URL
  const bridgeToken = process.env.BMW_BRIDGE_TOKEN
  async function bridgeRequest(endpoint: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${bridgeUrl}/${endpoint}`, {
      method: 'POST', headers: { authorization: `Bearer ${bridgeToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
    })
    const value: unknown = await response.json()
    if (!response.ok || typeof value !== 'object' || value === null) throw new Error('BMW Session bridge refused the lifecycle request')
    return value as Record<string, unknown>
  }
  ctx.effect(() => async () => {
    disposed = true
    await Promise.allSettled([...bindings.values()].map(async (binding) => bridgeRequest('session/release', { binding: await binding })))
  }, 'bmw-browser.session')
  const tools = browserRegistry(ctx.tools, async (args, execution) => {
    if (disposed) throw new Error('BMW browser Session has ended')
    const exec = execution as { agent?: { session?: { header?: { id?: unknown; cwd?: unknown } } }; signal?: AbortSignal }
    const agent = exec?.agent
    const header = agent?.session?.header
    if (!agent || typeof header?.id !== 'string' || typeof header.cwd !== 'string') throw new Error('BMW browser requires a live DSH Session')
    let binding = bindings.get(agent)
    if (!binding) {
      binding = bridgeRequest('session/register', { sessionId: header.id, directory: header.cwd }).then((value) => {
        if (typeof value.binding !== 'string') throw new Error('Invalid BMW Session binding')
        return value.binding
      })
      bindings.set(agent, binding)
      binding.catch(() => { if (bindings.get(agent) === binding) bindings.delete(agent) })
    }
    const token = await binding
    if (disposed || exec.signal?.aborted) throw new Error('BMW browser Session was disposed or cancelled')
    return { ...(typeof args === 'object' && args !== null ? args : {}), __bmwSession: token }
  })
  const scoped = new Proxy(ctx, { get: (target, key, receiver) => key === 'tools' ? tools : Reflect.get(target, key, receiver) })
  return upstream.apply(scoped, config)
}
