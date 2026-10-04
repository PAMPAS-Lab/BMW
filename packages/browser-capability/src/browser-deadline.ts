/** Transport deadlines include queue time. Long media jobs retain their existing budget. */
export function browserDeadlineMs(input: unknown): number {
  const args = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const action = typeof args.action === 'string' ? args.action : ''
  if(['media.image.inspect','media.image.annotate','media.image.draw'].includes(action))return 300_000
  if (['media.video.capture', 'media.convert', 'media.frames.sample', 'video.compose', 'video.narrate', 'video.studio', 'tests.run'].includes(action)) return 1_800_000
  return 60_000
}
