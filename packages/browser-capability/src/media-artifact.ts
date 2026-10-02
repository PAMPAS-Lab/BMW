import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MAX_MEDIA_BYTES = 512 * 1024 * 1024

const MIME_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/webm': '.webm',
  'application/vnd.apple.mpegurl': '.m3u8',
  'application/x-mpegurl': '.m3u8'
})

export interface MediaDownloadInput {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
  projectDirectory: string
  url: string
  filename?: string
  referrer?: string
  maximumBytes?: number
  now?: () => number
}

function safeSegment(value: string): string {
  const leaf = value.replace(/\\/g, '/').split('/').at(-1) || ''
  return leaf
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 140)
}

function extensionFor(contentType: string, sourceUrl: URL): string {
  const fromMime = MIME_EXTENSIONS[contentType]
  if (fromMime) return fromMime
  const extension = path.extname(decodeURIComponent(sourceUrl.pathname)).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.bin'
}

function isIsoBmffInitializationSegment(bytes: Buffer, contentType: string): boolean {
  if (!['video/mp4', 'audio/mp4'].includes(contentType) || bytes.length >= 64 * 1024) return false
  const signature = bytes.toString('latin1')
  const isDash = signature.includes('ftyp') && (signature.includes('dash') || signature.includes('cmf2'))
  const hasInitialization = signature.includes('moov')
  const hasMediaPayload = signature.includes('mdat') || signature.includes('moof')
  return isDash && hasInitialization && !hasMediaPayload
}

export function artifactFilename(input: string | undefined, contentType: string, sourceUrl: URL, timestamp: number): string {
  const extension = extensionFor(contentType, sourceUrl)
  const requested = safeSegment(String(input || ''))
  const sourceName = safeSegment(path.basename(decodeURIComponent(sourceUrl.pathname)))
  const candidate = requested || sourceName || 'media'
  const withExtension = /\.[a-z0-9]{1,8}$/i.test(candidate) ? candidate : `${candidate}${extension}`
  return `${timestamp}-${withExtension}`
}

export async function downloadMediaArtifact({
  fetchImpl,
  projectDirectory,
  url,
  filename,
  referrer,
  maximumBytes = MAX_MEDIA_BYTES,
  now = () => Date.now()
}: MediaDownloadInput) {
  const sourceUrl = new URL(String(url || ''))
  if (!['http:', 'https:'].includes(sourceUrl.protocol)) throw new Error('Media downloads require an HTTP(S) URL discovered by BMW.')
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new TypeError('Media download limit must be a positive safe integer.')

  const response = await fetchImpl(sourceUrl.toString(), {
    credentials: 'include',
    redirect: 'follow',
    referrer: referrer && /^https?:/i.test(referrer) ? referrer : undefined,
    headers: { accept: 'image/*,video/*,audio/*,application/octet-stream,*/*;q=0.8' }
  })
  if (!response.ok) throw new Error(`Media download returned HTTP ${response.status}.`)
  if (!response.body) throw new Error('Media download returned an empty response body.')

  const declaredBytes = Number(response.headers.get('content-length') || 0)
  if (declaredBytes > maximumBytes) throw new Error(`Media exceeds the BMW download limit of ${maximumBytes} bytes.`)
  const contentType = String(response.headers.get('content-type') || 'application/octet-stream').split(';', 1)[0].toLowerCase()
  const artifactsDirectory = path.join(projectDirectory, 'artifacts')
  fs.mkdirSync(artifactsDirectory, { recursive: true, mode: 0o700 })
  const artifactId = artifactFilename(filename, contentType, sourceUrl, now())
  const filePath = path.join(artifactsDirectory, artifactId)
  let bytes = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length
      if (bytes > maximumBytes) callback(new Error(`Media exceeds the BMW download limit of ${maximumBytes} bytes.`))
      else callback(null, chunk)
    }
  })
  try {
    await pipeline(Readable.fromWeb(response.body as any), limiter, fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 }))
    const probe = bytes < 64 * 1024 ? fs.readFileSync(filePath) : Buffer.alloc(0)
    if (probe.length && isIsoBmffInitializationSegment(probe, contentType)) {
      throw new Error('Media URL returned a DASH initialization segment, not a complete playable file. Use media.video.capture on the page video element.')
    }
  } catch (error) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    throw error
  }
  return {
    artifactId,
    type: contentType.startsWith('image/') ? 'image' : contentType.startsWith('video/') ? 'video' : contentType.startsWith('audio/') ? 'audio' : 'media',
    contentType,
    bytes,
    sourceUrl: response.url || sourceUrl.toString(),
    path: filePath
  }
}

export const mediaArtifactInternals = { MAX_MEDIA_BYTES, MIME_EXTENSIONS, safeSegment, extensionFor, isIsoBmffInitializationSegment }
