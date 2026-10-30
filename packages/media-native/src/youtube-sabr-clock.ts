import {ARCHIVE_LIMITS} from './archive-limits.js'

export interface SabrReplayProgress {attempt:number;prefixBytes:number;replayedBytes:number}

/** Private, bounded Host/worker traffic: wire activity is not media admission. */
export function assertSabrReplayProgress(raw:unknown,previous?:SabrReplayProgress):SabrReplayProgress {
 const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{}
 const {attempt,prefixBytes,replayedBytes}=value
 if(typeof attempt!=='number'||!Number.isSafeInteger(attempt)||attempt<2||attempt>3||typeof prefixBytes!=='number'||!Number.isSafeInteger(prefixBytes)||prefixBytes<1||prefixBytes>ARCHIVE_LIMITS.bytes||typeof replayedBytes!=='number'||!Number.isSafeInteger(replayedBytes)||replayedBytes<1||replayedBytes>prefixBytes||previous&&(attempt<previous.attempt||prefixBytes<previous.prefixBytes||attempt===previous.attempt&&(prefixBytes!==previous.prefixBytes||replayedBytes<=previous.replayedBytes)))throw new Error('YOUTUBE_SABR_REPLAY_PROGRESS: Invalid or regressing native replay activity.')
 return {attempt,prefixBytes,replayedBytes}
}

/** Compatibility adapter for pinned googlevideo@5.0.0. Its public fetch hook
 * has no replay-activity hook, while its private 30s clock measures bytes seen
 * by the protocol parser. Refresh that same clock only for actual native replay
 * bytes. No timer or synthetic UMP data can keep an idle transport alive.
 * An incompatible dependency fails closed before issuing native requests. */
export function createSabrReplayIdleClock(stream:object):()=>void {
 const reset:unknown=Reflect.get(stream,'resetRequestTimeout')
 if(typeof reset!=='function')throw new Error('YOUTUBE_SABR_CLOCK_UNAVAILABLE: Pinned protocol request clock is unavailable.')
 return ()=>{Reflect.apply(reset,stream,[])}
}
