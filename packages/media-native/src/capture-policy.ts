import path from 'node:path'

export const MAX_CAPTURE_BYTES = 512 * 1024 * 1024
export const DATA_URL_BASE64_MARKER = ';base64,'

export function base64PayloadFromDataUrl(value: unknown): string {
  const encoded = String(value || '')
  const markerIndex = encoded.indexOf(DATA_URL_BASE64_MARKER)
  if (markerIndex < 0) throw new Error('Captured video chunk was not encoded as a Base64 Data URL.')
  return encoded.slice(markerIndex + DATA_URL_BASE64_MARKER.length)
}

export function safeCaptureFilename(value: unknown): string {
  const requested = path.basename(String(value || '').normalize('NFKC'))
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 140)
  const candidate = requested || 'captured-video.webm'
  return candidate.toLowerCase().endsWith('.webm') ? candidate : `${candidate}.webm`
}

export const mediaCapturePolicyInternals = {
  MAX_CAPTURE_BYTES,
  DATA_URL_BASE64_MARKER,
  base64PayloadFromDataUrl,
  safeCaptureFilename
}
