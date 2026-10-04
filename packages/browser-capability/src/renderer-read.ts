import type { WebContents } from 'electron'

/** Bound a renderer read, without letting its late completion resume artifact writes. */
export function readRendererPhase<T>(wc: WebContents, action: string, phase: string, read: () => Promise<T>, signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let finished = false
    let timer: NodeJS.Timeout | undefined
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      wc.removeListener('destroyed', destroyed)
      wc.removeListener('render-process-gone', destroyed)
      wc.removeListener('did-start-navigation', navigation)
    }
    const end = (error?: unknown, value?: T) => {
      if (finished) return
      finished = true
      cleanup()
      if (error) reject(error)
      else resolve(value as T)
    }
    const failure = (code: string, detail: string) => Object.assign(new Error(`${code}: ${action}/${phase}: ${detail}`), { code })
    const abort = () => end(signal?.reason || failure('BMW_BROWSER_CANCELLED', 'request cancelled'))
    const destroyed = () => end(failure('BMW_BROWSER_RENDERER_GONE', 'page renderer closed or failed'))
    const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) end(failure('BMW_BROWSER_PAGE_CHANGED', 'page navigated during read'))
    }
    if (signal?.aborted) { abort(); return }
    if (wc.isDestroyed()) { destroyed(); return }
    signal?.addEventListener('abort', abort, { once: true })
    wc.on('destroyed', destroyed)
    wc.on('render-process-gone', destroyed)
    wc.on('did-start-navigation', navigation)
    timer = setTimeout(() => end(failure('BMW_BROWSER_TIMEOUT', `no result within ${timeoutMs}ms`)), timeoutMs)
    try { Promise.resolve(read()).then(value => end(undefined, value), error => end(error)) } catch (error) { end(error) }
  })
}
