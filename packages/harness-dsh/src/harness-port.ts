export const BMW_DSH_BASELINE = '0.2.0-rc.2'

export class DshHarnessPort {
  [key: string]: any

  constructor(runtime) {
    this.runtime = runtime
  }

  get child() { return this.runtime.child }
  get url() { return this.runtime.url }

  start() { return this.runtime.start() }
  stop() { return this.runtime.stop() }
  call(method, payload) { return this.runtime.call(method, payload) }
  ensureWorkspace(project) { return this.runtime.ensureWorkspace(project) }
  activateWorkspace(project) { return this.runtime.activateWorkspace(project) }
  listProjectSessions(project, query) { return this.runtime.listProjectSessions(project, query) }
  createProjectSession(project) { return this.runtime.createProjectSession(project) }
  enqueuePrompt(sessionId, text) { return this.runtime.enqueuePrompt(sessionId, text) }
  waitForPromptReplies(sessionId, rpcId, options) { return this.runtime.waitForPromptReplies(sessionId, rpcId, options) }
  waitForPromptReply(sessionId, rpcId, options) { return this.runtime.waitForPromptReply(sessionId, rpcId, options) }
  promptAndWait(sessionId, text, options) { return this.runtime.promptAndWait(sessionId, text, options) }
  cancelSession(sessionId) { return this.runtime.call('session.cancel', { sessionId }) }
  subscribe(listener) {
    if (typeof this.runtime.subscribe !== 'function') return () => {}
    return this.runtime.subscribe(listener)
  }

  async health() {
    if (!this.runtime.child || !this.runtime.url) return { ready: false, url: this.runtime.url || null, baseline: BMW_DSH_BASELINE }
    try {
      const response = await fetch(this.runtime.url, { headers: this.runtime.authHeaders?.() || {}, signal: AbortSignal.timeout(5_000) })
      return { ready: response.ok, status: response.status, url: this.runtime.url, baseline: BMW_DSH_BASELINE }
    } catch (error) {
      return { ready: false, url: this.runtime.url, baseline: BMW_DSH_BASELINE, error: error.message }
    }
  }

  async capabilities(sessionId) {
    const result = {
      baseline: BMW_DSH_BASELINE,
      commands: false,
      wvlHostCommand: false,
      wvlClient: false,
      commandUi: false,
      conversationInputDock: false,
      warning: null
    }
    try {
      const commands = await this.call('commands/list', { args: { agentId: sessionId } })
      const items = commands?.items || commands || []
      result.commands = Array.isArray(items)
      result.wvlHostCommand = Array.isArray(items) && items.some((item) => item.name === 'wvl')
    } catch (error) {
      result.warning = `DSH command discovery is unavailable: ${error.message}`
    }
    try {
      const html = await (await fetch(this.url, { headers: this.runtime.authHeaders?.() || {}, signal: AbortSignal.timeout(5_000) })).text()
      result.wvlClient = html.includes('wvl-client')
    } catch (error) {
      result.warning ||= `DSH client capability discovery is unavailable: ${error.message}`
    }
    if (!result.wvlHostCommand || !result.wvlClient) {
      result.warning ||= 'Native WVL commands or cards are unavailable in this DSH build; natural-language Experiment Plan triggering remains available.'
    }
    return result
  }
}
