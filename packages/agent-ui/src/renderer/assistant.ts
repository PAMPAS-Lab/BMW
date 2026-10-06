import type { AssistantCommand, AssistantState, AssistantUiPort } from '../../../agent-contract/index.js'
import {renderMessageContent} from './message-content.js'
import {createAgentSettingsView} from './agent-settings.js'
declare global { interface Window { bmwAssistant: AssistantUiPort; bmwSelectSession(sessionId: string): Promise<boolean>;bmwOpenAgentSettings():void } }
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const driver = element<HTMLSelectElement>('driver'), sessions = element<HTMLSelectElement>('sessions'), input = element<HTMLTextAreaElement>('input'), messages = element<HTMLElement>('messages'), error = element<HTMLElement>('error')
let state: AssistantState | null = null, changing = false
const settingsView=createAgentSettingsView(invoke,()=>{if(state)render(state)})
const statuses: Record<string, string> = { idle: '可以继续对话', queued: '等待执行', running: 'Agent 正在执行', 'waiting-user': '等待你的回复', 'waiting-approval': '等待批准', cancelling: '正在停止并清理任务', interrupted: '已停止，可以继续对话', failed: '本轮执行失败', disconnected: '连接中断，上一轮结果未确认；不会自动重发' }
const workspaceMode = element<HTMLSelectElement>('workspace-mode')
function renderContext(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const value = raw as Record<string, unknown>, selection = value.selection && typeof value.selection === 'object' ? value.selection as Record<string, unknown> : {}
  workspaceMode.value = value.mode === 'studio' ? 'studio' : 'browser'
  element('studio-context').textContent = value.mode === 'studio' ? (typeof value.draftTitle === 'string' ? value.draftTitle + ' · ' + (typeof value.sceneTitle === 'string' ? value.sceneTitle : '未选择分镜') + ' · v' + String(selection.revision ?? '') + (selection.dirty === true ? ' · 有未保存修改' : '') : '选择或创建草稿') : '同一会话 · 视频草稿保留'
}
function setOptions(select: HTMLSelectElement, entries: { id: string; text: string }[], selected: string | null): void {
  select.replaceChildren(...entries.map(row => { const option = document.createElement('option'); option.value = row.id; option.textContent = row.text; return option }))
  if (selected) select.value = selected
}
function render(next: AssistantState): void {
  state = next; element('project').textContent = next.project.name
  settingsView.render(next)
  document.documentElement.dataset.sessionId = next.selectedSessionId ?? ''
  setOptions(driver, next.drivers.map(row => ({ id: row.id, text: row.label })), next.driverId)
  setOptions(sessions, next.sessions.filter(row => row.driverId === next.driverId).map(row => ({ id: row.sessionId, text: row.title })), next.selectedSessionId)
  const session = next.sessions.find(row => row.sessionId === next.selectedSessionId)
  document.documentElement.dataset.status = session?.status ?? ''
  element('status').textContent = session ? statuses[session.status] : '新建会话后，可以在 BMW 中直接交互'
  if(next.settings?.phase==='working')element('status').textContent=next.settings.message
  else if(next.busy&&!next.activeRunId)element('status').textContent=next.resourcesDisconnected?'Agent 连接清理失败，请先恢复连接清理':'正在清理 Agent 连接，请稍候'
  if(!next.busy&&!settingsView.canSend())element('status').textContent=next.settings?.value?.authentication.state==='ready'?'请选择模型并确认':'请登录当前 Agent，或切换其他驱动'
  const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80
  messages.replaceChildren()
  if (!next.messages.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '对话、进度和结果显示在 BMW。\nAgent 使用当前 Project 的页面和媒体。'; messages.append(empty) }
  for (const message of next.messages) {
    const article = document.createElement('article'); article.className = 'message ' + message.role
    const label = document.createElement('small'); label.textContent = message.role === 'user' ? '你' : (next.drivers.find(row => row.id === next.driverId)?.label ?? 'Assistant') + (message.complete ? '' : ' · 正在回复')
    const text = document.createElement('div');text.className='message-content';renderMessageContent(text,message.text)
    article.append(label, text); messages.append(article)
  }
  for (const envelope of next.events.slice(-100)) {
    const event = envelope.event
    if (event.type === 'tool.started') { const tool = document.createElement('div'); tool.className = 'tool'; tool.textContent = 'browser · ' + event.action; messages.append(tool) }
    if (event.type === 'turn.completed' && event.outcome !== 'success' && event.message) { const tool = document.createElement('div'); tool.className = 'tool'; tool.textContent = event.message; messages.append(tool) }
    if (event.type === 'turn.disconnected') { const tool = document.createElement('div'); tool.className = 'tool'; tool.textContent = event.message; messages.append(tool) }
  }
  if (nearBottom) messages.scrollTop = messages.scrollHeight
  const interactions = element('interactions'); interactions.replaceChildren()
  for (const interaction of next.interactions) {
    const article = document.createElement('article'), text = document.createElement('p'); text.textContent = interaction.message; article.append(text)
    for (const choice of interaction.choices) { const button = document.createElement('button'); button.textContent = choice.label; button.onclick = () => { if (next.selectedSessionId && next.activeRunId) void invoke({ action: 'interaction.respond', sessionId: next.selectedSessionId, runId: next.activeRunId, interactionId: interaction.id, response: choice.id }) }; article.append(button) }
    interactions.append(article)
  }
  for (const id of ['create', 'archive', 'rename']) element<HTMLButtonElement>(id).disabled = changing || next.busy || (id !== 'create' && !session)
  driver.disabled = sessions.disabled = changing || next.busy
  workspaceMode.disabled = changing || next.busy
  element<HTMLButtonElement>('send').disabled = changing || !session||next.settings?.phase==='working'||!settingsView.canSend()
  element<HTMLButtonElement>('stop').disabled = changing || !next.activeRunId
  element('recover').hidden = !next.resourcesDisconnected
  element('queue').textContent = next.busy ? '发送新消息将加入 BMW 队列' : ''
}
async function invoke(command: AssistantCommand): Promise<boolean> {
  if (changing) return false
  changing = true; error.hidden = true
  try { render(await window.bmwAssistant.invoke(command)); return true }
  catch (caught: unknown) { error.textContent = caught instanceof Error ? caught.message.replace(/^Error invoking remote method 'bmw-assistant-command': (?:Error: )?/u,'') : '操作失败'; error.hidden = false; return false }
  finally { changing = false; if (state) render(state) }
}
driver.onchange = () => { void settingsView.selectDriver(driver.value) }
sessions.onchange = () => { void invoke({ action: 'session.select', sessionId: sessions.value }) }
element('create').onclick = () => { void invoke({ action: 'session.create' }) }
element('rename').onclick = () => { if (state?.selectedSessionId) { element<HTMLInputElement>('rename-title').value = state.sessions.find(row => row.sessionId === state!.selectedSessionId)?.title ?? ''; element<HTMLDialogElement>('rename-dialog').showModal() } }
element<HTMLDialogElement>('rename-dialog').onclose = () => { const dialog = element<HTMLDialogElement>('rename-dialog'), title = element<HTMLInputElement>('rename-title').value; if (dialog.returnValue === 'save' && state?.selectedSessionId && title.trim()) void invoke({ action: 'session.rename', sessionId: state.selectedSessionId, title }) }
element('archive').onclick = () => { if (state?.selectedSessionId) void invoke({ action: 'session.archive', sessionId: state.selectedSessionId }) }
element('stop').onclick = () => { if (state?.selectedSessionId) void invoke({ action: 'message.cancel', sessionId: state.selectedSessionId }) }
element('recover').onclick = () => { void invoke({ action: 'resources.recover' }) }
element<HTMLFormElement>('composer').onsubmit = event => { event.preventDefault(); if (state?.selectedSessionId && !state.busy && settingsView.canSend() && input.value.trim()) { const text = input.value; void invoke({ action: 'message.send', sessionId: state.selectedSessionId, text }).then(sent => { if (sent && input.value === text) input.value = '' }) } }
input.onkeydown = event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) element<HTMLFormElement>('composer').requestSubmit() }
window.bmwAssistant.onOpenSettings(()=>settingsView.open())
element('agent-settings-open').onclick=()=>settingsView.open()
window.bmwAssistant.subscribe(render)
window.bmwAssistant.onComposerContext(renderContext)
workspaceMode.onchange = () => { workspaceMode.disabled = true; void window.bmwAssistant.setWorkspaceMode(workspaceMode.value === 'studio' ? 'studio' : 'browser').then(renderContext).catch((caught: unknown) => { error.textContent = caught instanceof Error ? caught.message : '工作区模式切换失败'; error.hidden = false }).finally(() => { workspaceMode.disabled = state?.busy ?? false }) }
void window.bmwAssistant.composerContext().then(renderContext).catch(() => {})
void invoke({ action: 'snapshot' })
