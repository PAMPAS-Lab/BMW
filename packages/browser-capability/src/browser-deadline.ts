/** Transport deadlines include queue time. Batch collection retains its bounded ten-minute lease. */
export function browserDeadlineMs(input: unknown): number {
  const args = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const action = typeof args.action === 'string' ? args.action : ''
  const batch=args.collectionBatchRequest
  if(action==='library.collection-batch'&&batch&&typeof batch==='object'&&!Array.isArray(batch)&&(batch as Record<string,unknown>).operation==='collect')return 600_000
  if(['media.image.inspect','media.image.annotate','media.image.draw'].includes(action))return 300_000
  if(action==='media.preserve')return 7_260_000
  if(action==='media.segment')return 1_260_000
  if (['media.video.capture', 'media.convert', 'media.frames.sample', 'video.compose', 'video.narrate', 'video.studio', 'tests.run'].includes(action)) return 1_800_000
  return 60_000
}
