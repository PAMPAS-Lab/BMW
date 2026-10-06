import { BrowserFailureGuard } from './failure-guard.js'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import {appendWorkspaceContext} from './workspace-context.js'
import { browserRegistry } from './registry.js'
import type { Registry } from './registry.js'

interface AssemblyContext {agent?:{session?:{header?:{id?:unknown;cwd?:unknown}}}}
interface Assembly {contexts?:{name:string;text:string}[];[key:string]:unknown}
interface PluginContext {on(event:'session/event',listener:(session:object,event:{type:string})=>void):unknown; on(event:'system-prompt/assemble',listener:(assembly:unknown,context:AssemblyContext,next:()=>Promise<Assembly>)=>Promise<Assembly>):unknown; tools: Registry & {schemas(scope:object):{name:string}[]}; effect(callback: () => () => Promise<void>, label: string): unknown; [key: string]: unknown }
interface McpPlugin { Config: unknown; inject: string[]; apply(ctx: PluginContext, config: unknown): unknown }

// Resolve against the running DSH installation, never a second Harness copy.
const requireDsh = createRequire(realpathSync(process.argv[1]))
const upstream = await import(requireDsh.resolve('@deepseek-ai/dsh-mcp-client')) as McpPlugin
export const Config = upstream.Config
export const inject = upstream.inject

export async function apply(ctx: PluginContext, config: unknown) {
  const failureGuard = new BrowserFailureGuard()
  ctx.on('session/event', (session, event) => { if (event.type === 'turn/start') failureGuard.reset(session) })
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
  async function ensureBinding(agent:object,header:{id?:unknown;cwd?:unknown}):Promise<string> {
    if(disposed||typeof header?.id!=='string'||typeof header.cwd!=='string')throw new Error('BMW browser requires a live DSH Session')
    if(!process.env.BMW_SESSION_BINDING)throw new Error('DSH execution requires a Host Session lease')
    let binding=bindings.get(agent)
    if(!binding){binding=bridgeRequest('session/register',{sessionId:header.id,directory:header.cwd,driverId:'dsh'}).then(value=>{if(value.binding!==process.env.BMW_SESSION_BINDING)throw new Error('DSH Session differs from its Host lease');return value.binding});bindings.set(agent,binding);binding.catch(()=>{if(bindings.get(agent)===binding)bindings.delete(agent)})}
    return binding
  }
  // Official cooperative assembly writes this data to the durable request context.
  // Original user input and the sole browser tool catalog remain unchanged.
  ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{
    const agent=context.agent,header=agent?.session?.header
    if(agent?.session)failureGuard.assertAvailable(agent.session)
    const assembled=await next()
    if(!agent||!header)return assembled
    const catalog=ctx.tools.schemas(agent)
    if(catalog.length!==1||catalog[0].name!=='browser')throw new Error('BMW effective DSH model catalog must remain exactly browser before every model request')
    const value=await bridgeRequest('session/context',{binding:await ensureBinding(agent,header)})
    return appendWorkspaceContext(assembled,value.text)
  })
  const tools = browserRegistry(ctx.tools, async (args, execution) => {
    if (disposed) throw new Error('BMW browser Session has ended')
    const exec = execution as { agent?: { session?: { header?: { id?: unknown; cwd?: unknown } } }; signal?: AbortSignal }
    const agent = exec?.agent
    const header = agent?.session?.header
    if (!agent || typeof header?.id !== 'string' || typeof header.cwd !== 'string') throw new Error('BMW browser requires a live DSH Session')
    await ensureBinding(agent,header)
    if (disposed || exec.signal?.aborted) throw new Error('BMW browser Session was disposed or cancelled')
    failureGuard.assertAvailable(agent.session)
    if(typeof args==='object'&&args!==null&&Object.hasOwn(args,'__bmwSession'))throw new Error('DSH model cannot set BMW Session scope')
    return args
  }, (execution, error) => {
    const exec = execution as { agent?: { session?: object }; signal?: AbortSignal }
    if (exec.agent?.session) failureGuard.observe(exec.agent.session, error, exec.signal?.aborted === true)
  })
  const scoped = new Proxy(ctx, { get: (target, key, receiver) => key === 'tools' ? tools : Reflect.get(target, key, receiver) })
  return upstream.apply(scoped, config)
}
