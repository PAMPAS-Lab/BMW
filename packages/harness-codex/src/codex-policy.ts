import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { agentRecord } from '@bmw-agent/agent-contract'
import type { CodexRpc } from './codex-rpc.js'
import { createCodexRpc } from './codex-rpc.js'
import {materializeCodexBrowserCatalog,codexSupportsProtocolVersion,codexVerifiedProtocolVersions} from './codex-model-catalog.js'

export interface CodexBrowserDefinition { name: 'browser'; description: string; inputSchema: Record<string, unknown> }
/** Responses and Responses Lite carry the authoritative catalog differently. */
export function codexModelTools(raw: unknown): Record<string, unknown>[] {
  const value = agentRecord(raw), definitions: unknown[] = []
  if (Array.isArray(value.tools)) definitions.push(...value.tools)
  if (Array.isArray(value.input)) for (const rawItem of value.input) {
    const item = agentRecord(rawItem)
    if (item.type === 'additional_tools') {
      if (!Array.isArray(item.tools)) throw new Error('Invalid Codex additional tool catalog')
      definitions.push(...item.tools)
    }
  }
  return definitions.flatMap(rawTool => {
    const tool = agentRecord(rawTool)
    if (tool.type === 'namespace') {
      if (!Array.isArray(tool.tools)) throw new Error('Invalid Codex tool namespace')
      return tool.tools.map(inner => agentRecord(inner))
    }
    return [tool]
  })
}
/** Each public feature capable of adding tools is disabled in the owned runtime. */
export const codexBrowserConfig: Readonly<Record<string, unknown>> = Object.freeze({
  web_search: 'disabled', project_doc_max_bytes: 0,
  tools: { experimental_request_user_input: { enabled: false }, update_plan: { enabled: false } },
  features: {
    shell_tool: false, unified_exec: false, view_image: false, sleep_tool: false, code_mode: false, code_mode_only: false,
    multi_agent: false, multi_agent_v2: false, apps: false, plugins: false, hooks: false, memories: false, goals: false,
    current_time_reminder: false, token_budget: false, rollout_budget: false, deferred_executor: false, request_permissions_tool: false,
    image_generation: false, browser_use: false, browser_use_external: false, computer_use: false, skill_search: false,
    tool_suggest: false, workspace_dependencies: false, skill_mcp_dependency_install: false, recommended_plugins: false,
    default_mode_request_user_input: false, skip_host_skill_discovery: true
  },
  mcp_servers: {}
})
export async function initializeCodex(rpc: CodexRpc): Promise<void> {
  await rpc.call('initialize', { clientInfo: { name: 'bmw_agent', title: 'BMW Assistant', version: '0.1.0' }, capabilities: { experimentalApi: true } })
  rpc.notify('initialized', {})
}
export function codexThreadParameters(directory: string, model: string, definition: CodexBrowserDefinition, context: string): Record<string, unknown> {
  return { cwd: directory, model, config: structuredClone(codexBrowserConfig), environments: [], sandbox: 'read-only', approvalPolicy: 'never',
    dynamicTools: [definition], developerInstructions: 'You are BMW Assistant. Use browser for Project pages, images, media and Video Studio. BMW owns resource and Session scope. Current Project context:\n' + context }
}
export function codexProtocolVersion(output:string):string {
  const value=output.startsWith('codex-cli ')?output.slice('codex-cli '.length):undefined
  if(!codexSupportsProtocolVersion(value))throw new Error('BMW 尚未验证当前 Codex 版本（'+output+'）；已支持 App Server '+codexVerifiedProtocolVersions.join('、')+'。请更新 BMW 适配或指定已支持的官方 CLI。')
  return value
}
function version(executable: string): Promise<string> {
  return new Promise((resolve, reject) => execFile(executable, ['--version'], { timeout: 5000, maxBuffer: 4096 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())))
}
/** Capture the real model request before BMW releases any user input. Never forwards inference. */
export class CodexCatalogGate {
  private verified = new Set<string>()
  invalidate():void{this.verified.clear()}
  async verify(executable: string, configDirectory: string, model: string, definition: CodexBrowserDefinition, signal: AbortSignal): Promise<string|void> {
    signal.throwIfAborted()
    fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 })
    codexProtocolVersion(await version(executable))
    const digest = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(executable)) digest.update(chunk)
    const configPath = path.join(configDirectory, 'config.toml')
    const config = fs.existsSync(configPath) ? fs.readFileSync(configPath) : Buffer.alloc(0)
    const modelsPath = path.join(configDirectory, 'models_cache.json')
    const models = fs.existsSync(modelsPath) ? fs.readFileSync(modelsPath) : Buffer.alloc(0)
    const modelCatalogPath=materializeCodexBrowserCatalog(configDirectory,model)
    const browserCatalog=modelCatalogPath?fs.readFileSync(modelCatalogPath):Buffer.alloc(0)
    const key = digest.update(config).update(models).update(browserCatalog).update(JSON.stringify([model, definition, codexBrowserConfig])).digest('hex')
    if (this.verified.has(key)) return modelCatalogPath
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-codex-catalog-'))
    let accept!: () => void, decline!: (error: Error) => void, settled = false
    const captured = new Promise<void>((resolve, reject) => { accept = resolve; decline = reject })
    void captured.catch(() => {})
    const reject = (error: Error) => { if (!settled) { settled = true; decline(error) } }
    const server = http.createServer(async (request, response) => {
      try {
        let body = ''
        for await (const chunk of request) { body += chunk; if (body.length > 8 * 1024 * 1024) throw new Error('Codex catalog exceeds its budget') }
        if (request.method === 'POST' && body) {
          const value = agentRecord(JSON.parse(body))
          const tools = codexModelTools(value)
          if (value.model !== model || tools.length !== 1 || tools[0].name !== 'browser') throw new Error('Codex model catalog must contain exactly BMW browser; received: ' + tools.map(tool => String(tool.name ?? tool.type)).join(', '))
          if (!settled) { settled = true; accept() }
        }
      } catch (error: unknown) { reject(error instanceof Error ? error : new Error('Invalid Codex catalog')) }
      response.writeHead(503, { 'content-type': 'application/json' }).end('{"error":{"message":"BMW catalog preflight never runs inference"}}')
    })
    let rpc: CodexRpc | undefined
    const abort = () => reject(new Error('Codex catalog verification cancelled'))
    const timeout = setTimeout(() => reject(new Error('Codex catalog verification timed out')), 30000)
    signal.addEventListener('abort', abort, { once: true })
    try {
      await new Promise<void>((resolve, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', resolve) })
      const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1'
      // Reuse only the explicitly selected BMW CLI profile, so inherited MCP/config
      // and cached model metadata participate in the actual directory test.
      rpc = createCodexRpc(executable, directory, configDirectory, { BMW_CODEX_CATALOG_KEY: 'unused-local-fixture' },modelCatalogPath)
      rpc.onFailure(reject)
      await initializeCodex(rpc)
      const params = codexThreadParameters(directory, model, definition, '')
      params.ephemeral = true
      params.modelProvider = 'bmw_catalog'
      params.config = { ...codexBrowserConfig, model_provider: 'bmw_catalog', model_providers: { bmw_catalog: {
        name: 'BMW local catalog preflight', base_url: baseUrl, env_key: 'BMW_CODEX_CATALOG_KEY', wire_api: 'responses',
        requires_openai_auth: false, supports_websockets: false, request_max_retries: 0, stream_max_retries: 0
      } } }
      const started = agentRecord(await rpc.call('thread/start', params)), threadId = agentRecord(started.thread).id
      await rpc.call('turn/start', { threadId, input: [{ type: 'text', text: 'BMW local catalog verification. No inference is available.' }] })
      await captured; signal.throwIfAborted()
      this.verified.add(key)
      return modelCatalogPath
    } finally {
      signal.removeEventListener('abort', abort); clearTimeout(timeout)
      await rpc?.close()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
}
