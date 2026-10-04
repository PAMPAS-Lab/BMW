import { dshConfiguration } from '../packages/harness-dsh/index.js'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import product from '../apps/bmw/product.js'
import { DshRuntime, resolveDshHome } from '../packages/harness-dsh/index.js'
import { BrowserKernel } from '../packages/browser-capability/src/browser-kernel.js'
import { BrowserCapabilityRegistry } from '../packages/browser-capability/src/browser-capability-registry.js'
import { createBridgeServer } from '../packages/browser-capability/src/bridge-server.js'

// Explicit opt-in: this integration check sends synthetic images to a paid model.
if (process.env.BMW_VISION_TEST !== '1') throw new Error('Set BMW_VISION_TEST=1 to authorize real DeepSeek vision requests.')
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'docs/vision-tests', new Date().toISOString().replace(/[:.]/g, '-'))
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bmw-vision-smoke-')))
const userData = path.join(temporary, 'user-data')
const workspace = path.join(temporary, 'project')
const sourceHome = path.join(temporary, 'credential-source')
for (const directory of [userData, workspace, sourceHome, output]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
app.setPath('userData', userData)
app.commandLine.appendSwitch('disable-gpu')
const sourceCredentials = path.join(resolveDshHome(), '.credentials.yaml')
if (!process.env.DEEPSEEK_API_KEY && !fs.existsSync(sourceCredentials)) throw new Error('No configured DeepSeek credential available.')
// Isolate legacy credential migration and refresh from the user's original store.
if (fs.existsSync(sourceCredentials)) fs.copyFileSync(sourceCredentials, path.join(sourceHome, '.credentials.yaml'))
if (fs.existsSync(path.join(sourceHome, '.credentials.yaml'))) fs.chmodSync(path.join(sourceHome, '.credentials.yaml'), 0o600)
const patch = path.join(temporary, 'vision.patch.yml')
fs.writeFileSync(patch, fs.readFileSync(dshConfiguration.patchPath, 'utf8') + '\n- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-flash\n    reasoningEffort: low\n- id: llm-deepseek\n  config:\n    baseURL: https://api.deepseek.com/anthropic\n    maxTokens: 4096\n    reasoningEffort: low\n', { mode: 0o600 })

interface Screenshot { type: string; path: string; width: number; height: number }
interface Expected { code: string; title: string; total: number; highest: string; difference: number; redPosition: string; blueCircles: number; greenTriangles: number }
interface HistoryEvent { type: string; data: Record<string, unknown> }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object in vision test')
  return value as Record<string, unknown>
}
function board(index: number): { html: string; expected: Expected } {
  const code = crypto.randomBytes(5).toString('hex').toUpperCase()
  const amounts = [crypto.randomInt(110, 190), crypto.randomInt(210, 290), crypto.randomInt(310, 390)]
  const bars = index === 0 ? [31, 73, 49] : [82, 36, 57]
  const expected: Expected = { code, title: '素材统计', total: amounts.reduce((a,b) => a+b,0), highest: index === 0 ? 'B' : 'A', difference: index === 0 ? 24 : 25, redPosition: index === 0 ? '左上' : '右下', blueCircles: index + 3, greenTriangles: 0 }
  return { expected, html: `<!doctype html><meta charset="utf-8"><title>Vision fixture</title><style>html,body{margin:0;background:white}canvas{display:block}</style><canvas id="board" width="1000" height="800"></canvas><script>
  const c=document.querySelector('canvas').getContext('2d');c.fillStyle='white';c.fillRect(0,0,1000,800);c.fillStyle='#142238';c.font='bold 32px sans-serif';c.fillText('素材统计',40,50);c.font='28px monospace';c.fillText('编号: ${code}',40,95);c.font='26px sans-serif';
  c.fillText('金额（元）',40,150);${amounts.map((amount,i)=>`c.fillText('素材 ${i+1}: ${amount}',40,${200+i*48});`).join('')}
  c.fillText('柱状图（单位：次）',440,150);const bars=${JSON.stringify(bars)};const labels=['A','B','C'];for(let i=0;i<3;i++){c.fillStyle=['#815ad7','#db9d22','#438c69'][i];c.fillRect(440+i*155,365-bars[i]*2,90,bars[i]*2);c.fillStyle='#142238';c.fillText(String(bars[i]),456+i*155,350-bars[i]*2);c.fillText(labels[i],476+i*155,405)}
  c.fillStyle='#142238';c.fillText('空间位置（左/右 × 上/下）',40,465);c.strokeStyle='#94a3b8';c.strokeRect(40,490,340,250);c.beginPath();c.moveTo(210,490);c.lineTo(210,740);c.moveTo(40,615);c.lineTo(380,615);c.stroke();c.fillStyle='#de3333';c.fillRect(${index===0?'88,525':'250,655'},75,55);
  c.fillStyle='#142238';c.fillText('图形计数',440,465);c.fillStyle='#267bdd';for(let i=0;i<${index+3};i++){c.beginPath();c.arc(480+i*95,550,28,0,Math.PI*2);c.fill()}c.fillStyle='#e4a72b';c.beginPath();c.moveTo(470,635);c.lineTo(440,685);c.lineTo(500,685);c.closePath();c.fill();c.fillStyle='#142238';c.font='22px sans-serif';c.fillText('请按可见内容回答，不要补全不存在的图形。',40,785)
  </script>` }
}
const prompt = '只调用唯一工具 browser 一次，参数 {"action":"media.screenshot","tabId":"vision-fixture","selector":"#board","filename":"vision.png"}。只根据返回的图片像素回答，不要读取 DOM、网页文本、文件或其他工具。返回一个 JSON 对象且不加其他说明，字段：code（编号的原文字符串，不含“编号:”）、title（左上中文标题）、total（三笔素材金额之和，数字）、highest（柱状图最高柱的字母）、difference（最高柱减去第二高柱的值，数字）、redPosition（红色矩形位于四格的“左上/右上/左下/右下”之一）、blueCircles（蓝色圆数量，数字）、greenTriangles（绿色三角形数量，数字）。看不清时填 null，禁止猜测。'
let window: BrowserWindow | undefined
let bridge: Awaited<ReturnType<typeof createBridgeServer>> | undefined
let runtime: DshRuntime | undefined
let activeCase = 0
const captures: { case: number; path: string; width: number; height: number }[] = []
const cases: Record<string, unknown>[] = []
const report: Record<string, unknown> = { date: new Date().toISOString(), requestedModel: 'deepseek-flash', provider: 'deepseek-official', harness: '0.2.0-rc.2', scope: 'Synthetic canvas -> BMW screenshot -> authenticated Bridge -> official MCP image handling -> DSH -> real DeepSeek; fresh Session per case', cases }
let exitCode = 0

async function run(): Promise<void> {
 try {
  await app.whenReady()
  const browserSession = session.fromPartition(`persist:bmw-vision-${process.pid}`)
  window = new BrowserWindow({ show: false, width: 1100, height: 950, webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const tab = { id: 'vision-fixture', title: 'Vision fixture', url: 'about:blank', view: { webContents: window.webContents } }
  const kernel = { projectStore: { active: () => ({ id: 'vision-project', directory: workspace }) }, artifactsDirectory: path.join(workspace,'artifacts'), serializeTab: () => ({ id: tab.id, title: tab.title, url: tab.url }) }
  bridge = await createBridgeServer({ async execute(value: unknown) {
    const input=record(value)
    if(input.action !== 'media.screenshot' || input.tabId !== tab.id) throw new Error('Vision fixture permits only its screenshot action')
    const screenshot = await BrowserKernel.prototype.screenshot.call(kernel, tab, { selector: '#board', filename: 'vision.png' }) as Screenshot
    const file=path.join(output, `case-${activeCase+1}.png`)
    fs.copyFileSync(screenshot.path,file)
    captures.push({ case: activeCase+1, path: path.basename(file), width:screenshot.width, height:screenshot.height })
    console.log(`Vision case ${activeCase+1}: actual browser screenshot ${screenshot.width}x${screenshot.height}`)
    return screenshot
  } }, { toolDefinition: new BrowserCapabilityRegistry(product).toolDefinition(), resolveProject: directory => directory===workspace ? { id:'vision-project',directory:workspace } : undefined, activeProjectId: () => 'vision-project' })
  runtime = new DshRuntime({ ...dshConfiguration, productId:product.id, presetId:product.id, patchPath:patch, dshHome:path.join(temporary,'dsh-home'), sourceDshHome:sourceHome, workspacePath:workspace, workspaceTitle:'Synthetic visual validation', mcpServerPath:path.join(root,'packages/browser-capability/src/browser-mcp-server.js'), bridgeUrl:bridge.url, bridgeToken:bridge.token })
  await runtime.start()
  for (activeCase=0;activeCase<2;activeCase++) {
    const fixture=board(activeCase)
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(fixture.html))
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    assert.equal(await window.webContents.executeJavaScript("(() => { const pixels=document.querySelector('canvas').getContext('2d').getImageData(480,550,1,1).data; return pixels[2]>150 && pixels[0]<80 })()"),true,'Fixture must finish drawing before sending it to the model')
    const created=record(await runtime.createProjectSession({ directory:workspace,name:'Synthetic visual validation' }))
    assert.equal(typeof created.sessionId,'string')
    const sessionId=String(created.sessionId)
    const started=Date.now()
    console.log(`Vision case ${activeCase+1}: requesting real deepseek-flash through DSH`)
    const response=await runtime.promptAndWait(sessionId,prompt,{timeoutMs:180_000})
    const history=record(await runtime.call('session.history',{sessionId}))
    assert.ok(Array.isArray(history.events))
    const events=(history.events as unknown[]).map(row => record(record(row).event) as unknown as HistoryEvent)
    const headers=events.filter(event => event.type==='request/header').map(event => event.data)
    const toolCalls=events.filter(event => event.type==='tool/call').map(event => ({name:event.data.name, arguments:event.data.arguments}))
    const usage=events.filter(event => event.type==='assistant/message').map(event => event.data.usage).filter(Boolean)
    fs.writeFileSync(path.join(output,`case-${activeCase+1}-receipt.json`),JSON.stringify({response,headers,toolCalls,usage},null,2)+'\n')
    const text=response.match(/\{[\s\S]*\}/)?.[0]
    const actual=text ? record(JSON.parse(text)) : {}
    const checks=Object.entries(fixture.expected).map(([field,expected])=>({field,expected,actual:actual[field]??null,passed:actual[field]===expected}))
    const modelConfirmed=headers.some(header=>{const config=record(record(header.header).config);return config.model==='deepseek-flash' && config.provider==='deepseek-official'})
    const catalogConfirmed=headers.length>0 && headers.every(header => { const tools=record(header.header).tools; return Array.isArray(tools) && tools.length===1 && record(tools[0]).name==='browser' })
    const toolConfirmed=toolCalls.length===1 && toolCalls[0].name==='browser' && captures.filter(capture=>capture.case===activeCase+1).length===1
    cases.push({ case:activeCase+1, elapsedMs:Date.now()-started, response, headers, toolCalls, usage, checks, modelConfirmed, catalogConfirmed, toolConfirmed, passed:checks.every(check=>check.passed)&&modelConfirmed&&catalogConfirmed&&toolConfirmed })
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({...report,captures},null,2)+'\n')
    console.log(`Vision case ${activeCase+1}: ${checks.filter(check=>check.passed).length}/${checks.length} visual checks; model=${modelConfirmed}; sole catalog=${catalogConfirmed}; browser image=${toolConfirmed}`)
    await runtime.call('session.cancel',{sessionId})
  }
  assert.ok(cases.every(result=>result.passed), 'One or more visual checks failed; inspect report.json')
  report.ok=true
 } catch(error: unknown) {
  exitCode=1
  report.ok=false
  report.error=error instanceof Error ? error.message : String(error)
  console.error(report.error)
 } finally {
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({...report,captures},null,2)+'\n')
  console.log(`Vision report: ${path.join(output,'report.json')}`)
  runtime?.stop()
  await bridge?.close()
  window?.destroy()
  fs.rmSync(temporary,{recursive:true,force:true})
  app.exit(exitCode)
 }
}
void run()
