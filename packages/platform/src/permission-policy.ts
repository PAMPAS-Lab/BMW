const PROMPT_ONCE = new Set([
  'media',
  'camera',
  'microphone',
  'display-capture',
  'clipboard-read',
  'serial',
  'usb',
  'hid'
])

const ALLOW_WITHOUT_PROMPT = new Set([
  'fullscreen',
  'clipboard-sanitized-write'
])

/**
 * Browser pages do not get to turn ordinary browsing into a stream of native
 * permission dialogs. Only capabilities that unlock real devices or sensitive
 * data may ask once; ambient requests such as location and notifications are
 * denied quietly. BMW's own tab capture uses Electron's internal display
 * media handler and does not pass through this site policy.
 */
export function sitePermissionDisposition(permission) {
  if (ALLOW_WITHOUT_PROMPT.has(permission)) return 'allow'
  if (PROMPT_ONCE.has(permission)) return 'prompt-once'
  return 'deny'
}
