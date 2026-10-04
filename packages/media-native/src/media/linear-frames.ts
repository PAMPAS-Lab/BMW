import { CanvasSink } from 'mediabunny'
import type { CanvasSinkOptions, InputVideoTrack, WrappedCanvas } from 'mediabunny'
/** Match Chromium's BT.601 fallback for unlabelled VP8 while preserving explicit metadata. */
export async function normalizeBrowserVideoColor(track: InputVideoTrack): Promise<void> {
  if(await track.getCodec()!=='vp8')return
  const original=track.getDecoderConfig.bind(track)
  track.getDecoderConfig=async()=>{
    const config=await original()
    if(!config || config.colorSpace?.matrix)return config
    return {...config,colorSpace:{...config.colorSpace,matrix:'smpte170m',primaries:config.colorSpace?.primaries??'smpte170m',transfer:config.colorSpace?.transfer??'smpte170m',fullRange:config.colorSpace?.fullRange??false}}
  }
}
/** Monotonic frame access, including MediaRecorder WebM without a seek index.
 * Hold the latest presentation frame just as browser video playback does.
 * Only two decoded canvases are retained; never cache a whole recording.
 */
export class LinearFrameReader {
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown>
  private current: WrappedCanvas | undefined
  private next: WrappedCanvas | undefined
  private initialized = false
  private lastTime = -Infinity
  constructor(track: InputVideoTrack, options: CanvasSinkOptions = {}) { this.iterator = new CanvasSink(track, { ...options, poolSize: 2 }).canvases() }
  async get(timestamp: number): Promise<WrappedCanvas | null> {
    if(timestamp < this.lastTime)throw new Error('Linear frame reader requires monotonic timestamps.')
    this.lastTime = timestamp
    if(!this.initialized){this.next=(await this.iterator.next()).value || undefined;this.initialized=true}
    while(this.next && this.next.timestamp <= timestamp){this.current=this.next;this.next=(await this.iterator.next()).value || undefined}
    return this.current ?? null
  }
  async close(): Promise<void> { await this.iterator.return() }
}
