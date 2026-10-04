interface State { failures: number; last: string }
/** Stop the official DSH turn before another model step after repeated bridge failures. */
export class BrowserFailureGuard {
  private readonly states = new WeakMap<object, State>()
  reset(session: object): void { this.states.delete(session) }
  observe(session: object, error?: unknown, cancelled = false): void {
    if (cancelled) return
    const message = error instanceof Error ? error.message : String(error ?? '')
    const infrastructure = /BMW_BROWSER_(TIMEOUT|TRANSPORT|RENDERER_GONE|EMPTY_IMAGE)|fetch failed/i.test(message)
    if (!infrastructure) { this.states.delete(session); return }
    const state = this.states.get(session) ?? { failures: 0, last: '' }
    state.failures++
    state.last = message.slice(0, 500)
    this.states.set(session, state)
  }
  assertAvailable(session: object): void {
    const state = this.states.get(session)
    if (state && state.failures >= 3) throw new Error(`BMW_BROWSER_UNAVAILABLE: browser infrastructure failed ${state.failures} consecutive times; this turn has stopped. Last error: ${state.last}`)
  }
}
