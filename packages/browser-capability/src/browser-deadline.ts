/** Transport deadlines include queue time. Batch collection retains its bounded ten-minute lease. */
export function browserDeadlineMs(input: unknown): number {
  const args = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const action = typeof args.action === 'string' ? args.action : ''
  if(['navigate','tabs.open'].includes(action)&&typeof args.url==='string'){try{if(['youtube.com','www.youtube.com','m.youtube.com'].includes(new URL(args.url).hostname))return 200_000}catch{}}
  const source=args.sourceRequest
  if(action==='library.sources'&&source&&typeof source==='object'&&!Array.isArray(source)&&(source as Record<string,unknown>).operation==='acquire')return 1_860_000
  if(action==='pages.read'||action==='pages.discover')return 210_000
  const batch=args.collectionBatchRequest
  if(action==='library.collection-batch'&&batch&&typeof batch==='object'&&!Array.isArray(batch)&&(batch as Record<string,unknown>).operation==='collect')return 600_000
  if(['media.image.inspect','media.image.annotate','media.image.draw'].includes(action))return 300_000
  if(action==='media.preserve')return 7_260_000
  if(action==='media.speech.align')return 660_000
  if(action==='media.segment')return 1_260_000
  if (['media.video.capture', 'media.convert', 'media.frames.sample', 'video.compose', 'video.narrate', 'video.studio', 'tests.run'].includes(action)) return 1_800_000
  return 60_000
}
