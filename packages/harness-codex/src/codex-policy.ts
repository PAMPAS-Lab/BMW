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
import {refreshCodexBrowserCatalog,CodexCatalogRefreshCache,codexSupportsProtocolVersion,codexVerifiedProtocolVersions} from './codex-model-catalog.js'

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
    retain_client_developer_messages: false, retain_client_tool_outputs: false,
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
/** Empty TOML tables merge with inherited servers. Disable each normalized official entry explicitly. */
export async function codexDisabledMcpServers(rpc:Pick<CodexRpc,'call'>):Promise<Record<string,{enabled:false}>>{
  const response=agentRecord(await rpc.call('config/read',{includeLayers:false})),config=agentRecord(response.config)
  const servers=config.mcp_servers==null?{}:agentRecord(config.mcp_servers),names=Object.keys(servers)
  if(names.length>1000||names.some(name=>!name||name.length>200))throw new Error('Invalid Codex inherited MCP catalog')
  return Object.fromEntries(names.map(name=>[name,{enabled:false as const}]))
}
export function codexToolInstructions(definition:CodexBrowserDefinition):string {
  return codexThreadParameters('','',definition,'').developerInstructions as string
}
export function codexInputScope(context:string):string {
  return 'Current BMW input scope (replaces earlier input-specific scope; old audit-only restrictions do not restrict later authorized production). Host permissions, ownership and cleanup remain enforced. Current Project context:\n'+context
}
export function codexThreadParameters(directory: string, model: string, definition: CodexBrowserDefinition, context: string,disabledMcpServers:Record<string,{enabled:false}>={}): Record<string, unknown> {
  const properties=definition.inputSchema.properties as Record<string,unknown>|undefined
  const action=properties?.action as {enum?:unknown}|undefined
  const actions=Array.isArray(action?.enum)?action.enum.filter((value):value is string=>typeof value==='string'):[]
  const guide=actions.length?' Browser action index (current authenticated catalog): '+actions.join(', ')+'.'+(actions.includes('help')?' Start page research with browser {"action":"observe"}. To discover or recover, call browser {"action":"help"}, or {"action":"help","forAction":"EXACT_ACTION"} for its closed input schema. Reuse previously discovered contracts across inputs while this catalog is unchanged; a new input scope does not invalidate tool contracts. For Studio use help with forOperation and, when needed, describe-edit editOperations (up to8) to discover a group once. Continue an authorized production through its requested deliverables; use exact recovery for a correctable argument error rather than treating it as missing permission or ending at an intermediate milestone. Never replay uncertain work or bypass real evidence/cleanup gates. Do not guess aliases. On a validation failure, follow its recovery contract and correct the request; unknown fields are rejected before execution. Collect finite video to its ended event with a safety limit longer than the source duration; a limit stop is partial.':''):''
  return { cwd: directory, model, config: {...structuredClone(codexBrowserConfig),model_auto_compact_token_limit:200000,mcp_servers:structuredClone(disabledMcpServers)}, environments: [], sandbox: 'read-only', approvalPolicy: 'never',
    dynamicTools: [definition], developerInstructions: 'You are BMW Assistant. Use browser for Project pages, images, media and Video Studio. BMW owns resource and Session scope.'+guide+' Current input-specific scope is supplied separately by BMW Host; later scope replaces earlier scope, including audit-only restrictions. Project evidence and native resume anchors remain authoritative. After context compaction, re-read the current draft and its pinned source/evidence IDs before changing it; old semantic review conclusions never authorize a new MP4. '+(context?'Current Project context:\n'+context:'') }

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
  private readonly catalogs=new CodexCatalogRefreshCache()
  invalidate():void{this.verified.clear();this.catalogs.clear()}
  async verify(executable: string, configDirectory: string, model: string, definition: CodexBrowserDefinition, signal: AbortSignal): Promise<string|void> {
    signal.throwIfAborted()
    fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 })
    const protocolVersion=codexProtocolVersion(await version(executable))
    const digest = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(executable)) digest.update(chunk)
    const configPath = path.join(configDirectory, 'config.toml')
    const config = fs.existsSync(configPath) ? fs.readFileSync(configPath) : Buffer.alloc(0)
    const catalogKey=digest.copy().update(config).update(JSON.stringify([executable,configDirectory,model,protocolVersion])).digest('hex')
    const modelCatalogPath=await this.catalogs.get(catalogKey,()=>refreshCodexBrowserCatalog(executable,configDirectory,model,protocolVersion,signal),signal)
    const browserCatalog=modelCatalogPath?fs.readFileSync(modelCatalogPath):Buffer.alloc(0)
    const key = digest.update(config).update(browserCatalog).update(JSON.stringify([model, definition, codexBrowserConfig])).digest('hex')
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
      const params = codexThreadParameters(directory, model, definition, '',await codexDisabledMcpServers(rpc))
      params.ephemeral = true
      params.modelProvider = 'bmw_catalog'
      params.config = { ...agentRecord(params.config), model_provider: 'bmw_catalog', model_providers: { bmw_catalog: {
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
