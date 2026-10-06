import {requireCurrentAgentData} from '../packages/platform/src/agent-data-format.js'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { app, webContents } from 'electron'
import { assistantPagePath, assistantPreloadPath } from '@bmw-agent/agent-ui'
import { QoderBackend } from '@bmw-agent/harness-qoder'
import { query } from '@qodercn-ai/qodercn-agent-sdk'
import { CodexBackend } from '@bmw-agent/harness-codex'
import { DshBackend,DshRuntime } from '@bmw-agent/harness-dsh'
import { agentRecord } from '@bmw-agent/agent-contract'
import type { AssistantState } from '@bmw-agent/agent-contract'
import { createBmwApplication } from '../packages/platform/src/main.js'
import { ProjectStore } from '../packages/platform/src/project-store.js'
import { LayoutStore } from '../packages/platform/src/layout-store.js'
import { bmwProduct } from '../packages/product-bmw/index.js'

const driverId = process.env.BMW_NATIVE_DRIVER
if (driverId !== 'qoder-cn' && driverId !== 'codex'&&driverId!=='dsh') throw new Error('Explicit BMW_NATIVE_DRIVER=qoder-cn, codex or dsh is required for paid-model acceptance')
const codexModel=process.env.BMW_NATIVE_CODEX_MODEL??'gpt-5.5'
if(!['gpt-5.5','gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna'].includes(codexModel))throw new Error('Unverified native Codex acceptance model')
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-native-assistant-'))), profile = path.join(root, 'profile')
process.env.BMW_USER_DATA_DIR = profile
requireCurrentAgentData(process.env.BMW_USER_DATA_DIR)
const projects = new ProjectStore({ filePath: path.join(profile, 'projects.json'), projectsDirectory: path.join(root, 'projects'), initialWorkspacePath: path.join(root, 'workspace'), onState: undefined })
projects.completeInitialSetup({ name: 'Native ' + driverId + ' acceptance', homeUrl: '' })
new LayoutStore({ filePath: path.join(profile, 'layout-settings.json'), onState: undefined }).update({ configured: true, mode: 'sidebar' })
const nonce = 'BMW-' + crypto.randomBytes(4).toString('hex').toUpperCase(), memory = 'BMW-RESUME-' + crypto.randomBytes(4).toString('hex').toUpperCase()
const color = crypto.randomInt(2) === 0 ? { css: '#f00000', labels: ['红', 'red'] } : { css: '#008000', labels: ['绿', 'green'] }
const fixture = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>BMW visual fixture</title><style>body{background:white;color:black;font:32px sans-serif;padding:40px}.color{height:180px;width:280px;background:' + color.css + '}</style><h1>' + nonce + '</h1><div class="color"></div>') })
const calls: string[] = [], images: { action: string; count: number }[] = []
const qoderCalls = new Map<string, string>()
const dshSeen=new Set<string>(),dshCallActions=new Map<string,string>()
let draftOwner = '', draftRevision: unknown
const sourceRoot=path.resolve(import.meta.dirname,'..')
const evidence: Record<string, unknown> = { driverId, root, sourceRoot,
  nativeScriptSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot,'scripts/native-assistant-case.ts'))).digest('hex'),
  buildReceiptSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot,'.bmw-runtime/build-receipt.json'))).digest('hex'),
  ...(driverId==='codex'?{model:codexModel}:{}), paidInference: true, nativeDesktopProfileUsed: false }
createBmwApplication(bmwProduct,  { pagePath: assistantPagePath, preloadPath: assistantPreloadPath, defaultDriverId: driverId,
  createBackends(config) {
    const connection: typeof config.connection = async request => {
      const native = await config.connection(request), execute = native.execute
      return { ...native, async execute(args, signal) {
        const action = String(args.action); calls.push(action)
        if (!['status', 'tabs.open', 'media.screenshot', 'video.studio'].includes(action)) throw new Error('Visual acceptance permits screenshot evidence, not DOM reading')
        const reply = await execute(args, signal)
        images.push({ action, count: reply.images?.length ?? 0 })
        if (action === 'video.studio') { const draft = agentRecord(reply.result); draftOwner = String(draft.ownerSessionId ?? ''); draftRevision = draft.revision }
        return reply
      } }
    }
    if(driverId==='dsh')return [new DshBackend({userDataDirectory:config.userDataDirectory,project:projectId=>{
      const project=projects.get(projectId);return {id:project.id,name:project.name,directory:project.directory}
    },connection,runtimeFactory:options=>new class extends DshRuntime {
      override async call(method:string,payload:Record<string,unknown>={}):Promise<Awaited<ReturnType<DshRuntime['call']>>>{
        const reply=await super.call(method,payload)
        if(method==='session.history'){
          const rows=agentRecord(reply).events
          assert.ok(Array.isArray(rows))
          for(const raw of rows){
            const event=agentRecord(agentRecord(raw).event),key=String(payload.sessionId)+':'+String(event.seq)
            if(dshSeen.has(key))continue;dshSeen.add(key)
            const data=agentRecord(event.data)
            if(event.type==='tool/call'){
              assert.equal(data.name,'browser')
              const action=String(agentRecord(JSON.parse(String(data.arguments))).action)
              assert.ok(['status','tabs.open','media.screenshot','video.studio'].includes(action),'Visual acceptance rejects DOM/JS alternatives')
              calls.push(action);dshCallActions.set(String(data.callId),action)
            }
            if(event.type==='tool/result'){
              const message=agentRecord(data.message),action=dshCallActions.get(String(message.toolCallId))??''
              const parts=Array.isArray(message.content)?message.content.map(part=>agentRecord(part)):[]
              images.push({action,count:parts.filter(part=>part.type==='image').length})
              if(action==='video.studio'){
                const draft=agentRecord(JSON.parse(parts.filter(part=>part.type==='text').map(part=>String(part.text)).join('\n')))
                draftOwner=String(draft.ownerSessionId??'');draftRevision=draft.revision
              }
            }
          }
        }
        return reply
      }
    }(options)})]
    return driverId === 'qoder-cn' ? [new QoderBackend({ configDirectory: '/private/tmp/bmw-agent-trigger-20261005/qoder-cli-profile', connection, queryFactory(input) {
      const use = input.options.canUseTool
      const native = query({ ...input, options: { ...input.options, canUseTool: async (name, value, context) => {
        if (name === 'browser' && !['status', 'tabs.open', 'media.screenshot', 'video.studio'].includes(String(value.action))) return { behavior: 'deny', interrupt: true, message: 'Visual acceptance permits screenshot evidence, not DOM reading' }
        return use ? use(name, value, context) : { behavior: 'deny', interrupt: true, message: 'No permission callback' }
      } } })
      return { interrupt: () => native.interrupt(), close: () => native.close(), async *[Symbol.asyncIterator]() {
        try { for await (const raw of native) {
          const event = agentRecord(raw)
          if (event.type === 'assistant' || event.type === 'user') {
            const content = agentRecord(event.message).content
            if (Array.isArray(content)) for (const item of content) {
              const block = agentRecord(item)
              if (block.type === 'tool_use' && block.name === 'browser') { const action = String(agentRecord(block.input).action); calls.push(action); qoderCalls.set(String(block.id), action) }
              if (block.type === 'tool_result') {
                const action = qoderCalls.get(String(block.tool_use_id)) ?? '', parts = Array.isArray(block.content) ? block.content.map(part => agentRecord(part)) : []
                images.push({ action, count: parts.filter(part => part.type === 'image').length })
                if (action === 'video.studio') {
                  const text = typeof block.content === 'string' ? block.content : parts.filter(part => part.type === 'text').map(part => String(part.text)).join('\n')
                  const draft = agentRecord(JSON.parse(text)); draftOwner = String(draft.ownerSessionId ?? ''); draftRevision = draft.revision
                }
              }
            }
          }
          yield raw
        } } catch (error: unknown) { evidence.sdkError = error instanceof Error ? error.message : 'Unknown SDK failure'; throw error }
      } }
    } })]
      : [new CodexBackend({ executable: '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', configDirectory: '/private/tmp/bmw-agent-trigger-20261005/codex-bmw-profile', model: codexModel, connection })]
  }
})
async function waitFor<T>(read: () => Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) { const value = await read(); if (value !== null) return value; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('Native Assistant deadline: ' + label)
}
const watchdog = setTimeout(() => { console.error('Native Assistant watchdog expired'); app.exit(1) }, 180000)
let exitCode = 0
async function run(): Promise<void> {
  await app.whenReady()
  try {
    await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
    const address = fixture.address(); assert.ok(address && typeof address === 'object'); const url = 'http://127.0.0.1:' + address.port
    const assistant = await waitFor(async () => webContents.getAllWebContents().find(row => row.getURL().endsWith('/assistant.html') && !row.isLoading()) ?? null, 'BMW UI load')
    const shell = await waitFor(async () => webContents.getAllWebContents().find(row => row.getURL().endsWith('/shell.html') && !row.isLoading()) ?? null, 'Shell load')
    const snapshot = async (): Promise<AssistantState> => assistant.executeJavaScript('window.bmwAssistant.invoke({action:"snapshot"})')
    const initial = await waitFor(async () => { const state = await snapshot(); return state.selectedSessionId ? state : null }, 'visible blank Session')
    assert.equal(initial.sessions[0].externalSessionId, null)
    await shell.executeJavaScript('window.bmw.setAgentControl(true)')
    const prompt = '这是隔离 BMW 验收。只用 browser：先 tabs.open 打开 ' + url + '，再 media.screenshot 对该页截图。仅根据截图回复页面上的 BMW 校验码和色块的颜色，禁止读取 DOM、页面文本、执行 JS 或使用其他工具。再用 video.studio 的 studioRequest.operation=create 创建标题为“Native acceptance”的草稿。请记住续聊校验码 ' + memory + '，本轮不要回复续聊校验码。'
    await assistant.executeJavaScript('window.bmwAssistant.invoke(' + JSON.stringify({ action: 'message.send', sessionId: initial.selectedSessionId, text: prompt }) + ')')
    const complete = await waitFor(async () => { const state = await snapshot(); return !state.busy && (state.events.some(row => row.event.type === 'turn.completed') || state.sessions.some(row => row.status === 'disconnected')) ? state : null }, 'first native turn')
    evidence.first = complete
    console.log(JSON.stringify({ stage: 'first', status: complete.sessions[0].status, calls, images, replies: complete.messages.filter(row => row.role === 'assistant').map(row => row.text), diagnostics: complete.events.filter(row => row.event.type === 'turn.disconnected').map(row => row.event) }))
    assert.equal(complete.sessions[0].status, 'idle')
    assert.ok(images.some(row => row.action === 'media.screenshot' && row.count > 0), 'Real admitted PNG must reach the native Agent')
    const replies = complete.messages.filter(row => row.role === 'assistant').map(row => row.text).join('\n')
    assert.ok(replies.includes(nonce), 'The model must read the nonce only visible in the screenshot')
    assert.ok(color.labels.some(label => replies.toLowerCase().includes(label)), 'The model must identify the real screenshot color')
    assert.equal(draftOwner, initial.selectedSessionId); assert.ok(Number.isInteger(draftRevision))
    const external = complete.sessions[0].externalSessionId, before = complete.events.filter(row => row.event.type === 'turn.completed').length
    const callsBeforeResume=calls.length
    await assistant.executeJavaScript('window.bmwAssistant.invoke(' + JSON.stringify({ action: 'message.send', sessionId: initial.selectedSessionId, text: '请只回复上一轮我让你记住的续聊校验码，不调用工具。' }) + ')')
    const resumed = await waitFor(async () => { const state = await snapshot(); return !state.busy && (state.events.filter(row => row.event.type === 'turn.completed').length > before || state.sessions.some(row => row.status === 'disconnected')) ? state : null }, 'native resume')
    assert.equal(resumed.sessions[0].status, 'idle'); assert.equal(resumed.sessions[0].externalSessionId, external)
    assert.equal(resumed.messages.filter(row => row.role === 'assistant').at(-1)?.text.trim(), memory)
    assert.equal(calls.length,callsBeforeResume,'Resume must recover native context without a memory tool')
    evidence.resumed = resumed; evidence.passed = true; evidence.calls = calls; evidence.images = images; evidence.draftOwner = draftOwner
    await waitFor(async () => await assistant.executeJavaScript('document.documentElement.dataset.status==="idle"') ? true : null, 'idle UI publication')
    const screenshot = await assistant.capturePage(); fs.writeFileSync(path.join(root, 'assistant.png'), screenshot.toPNG())
    console.log(JSON.stringify({ stage: 'verified', driverId, sessionId: initial.selectedSessionId, providerId: external, realScreenshotRead: true, realStudioOwner: draftOwner, resumeVerified: true, root }))
  } catch (error: unknown) { exitCode = 1; evidence.error = error instanceof Error ? error.message : 'Unknown failure'; console.error(evidence.error) }
  finally { clearTimeout(watchdog); fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2)); fixture.closeAllConnections(); if (fixture.listening) await new Promise<void>(resolve => fixture.close(() => resolve())); console.log(JSON.stringify({ evidence: path.join(root, 'result.json') }));if(exitCode)app.exit(exitCode);else app.quit() }
}
void run()
