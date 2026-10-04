import type { WebContents } from 'electron'
import {readRendererPhase} from './renderer-read.js'

/** Screenshot compatibility wrapper; all read phases use the same cancellation guard. */
export function readScreenshotPhase<T>(wc:WebContents,phase:string,read:()=>Promise<T>,signal?:AbortSignal,timeoutMs=15_000):Promise<T>{
  return readRendererPhase(wc,'media.screenshot',phase,read,signal,timeoutMs)
}
