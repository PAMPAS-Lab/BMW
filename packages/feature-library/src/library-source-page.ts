import { finiteNumber, mediaRecord } from '@bmw-agent/media-native/contract'
import type { SourceCatalog } from '@bmw-agent/media-native/sources'
export interface LibrarySourcePage {
  section: 'text' | 'candidates' | 'media'
  offset: number
  limit: number
}
export function assertLibrarySourcePage(raw: unknown): LibrarySourcePage {
  const v = mediaRecord(raw ?? {})
  if (
    Object.keys(v).some(k => !['section', 'offset', 'limit'].includes(k)) ||
    (v.section !== undefined && !['text', 'candidates', 'media'].includes(String(v.section)))
  )
    throw new TypeError('Invalid source page.')
  return {
    section: (v.section ?? 'text') as LibrarySourcePage['section'],
    offset: finiteNumber(v.offset ?? 0, 'source page offset', 0, 1000000, true),
    limit: finiteNumber(v.limit ?? 10, 'source page size', 1, 20, true)
  }
}
export function librarySourceSummary(catalog: SourceCatalog, offset = 0, limit = 20) {
  return {
    complete: catalog.complete !== false,
    ...(catalog.complete === false
      ? {
          continuation: {
            action: 'library.streams',
            streamRequest: { operation: 'sources', projectId: catalog.projectId }
          }
        }
      : {}),
    ...(catalog.indexWarning ? { indexWarning: catalog.indexWarning } : {}),
    version: catalog.version,
    projectId: catalog.projectId,
    revision: catalog.revision,
    sourceCount: catalog.sources.length,
    sources: catalog.sources.slice(offset, offset + limit).map(s => ({
      id: s.id,
      url: s.url,
      acquisitionCount: s.acquisitions.length,
      latest: s.acquisitions.at(-1)
        ? {
            id: s.acquisitions.at(-1)!.id,
            title: s.acquisitions.at(-1)!.title,
            publishedAt: s.acquisitions.at(-1)!.publishedAt,
            capturedAt: s.acquisitions.at(-1)!.capturedAt
          }
        : null
    })),
    offset,
    nextOffset: offset + limit < catalog.sources.length ? offset + limit : null
  }
}
function textQuoteSpans(text: string, baseOffset: number) {
  const spans = [{ startCharacter: baseOffset, endCharacter: baseOffset + text.length, text }]
  if (!text.includes('\n')) return spans
  let pos = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length >= 20 && spans.length < 48) {
      const lead = line.indexOf(trimmed)
      const start = baseOffset + pos + lead
      spans.push({ startCharacter: start, endCharacter: start + trimmed.length, text: trimmed })
    }
    pos += line.length + 1
  }
  if (spans.length < 16) {
    const sentenceRegex = /[^\s][\s\S]{24,360}?[.!?。！？](?=\s|$)/g
    let match: RegExpExecArray | null
    while ((match = sentenceRegex.exec(text)) !== null && spans.length < 48) {
      const start = baseOffset + match.index,
        end = start + match[0].length
      if (!spans.some(s => s.startCharacter === start && s.endCharacter === end))
        spans.push({ startCharacter: start, endCharacter: end, text: match[0] })
    }
  }
  return spans
}
export function librarySourceRead(raw: unknown, page: LibrarySourcePage) {
  const v = mediaRecord(raw),
    source = mediaRecord(v.source),
    a = mediaRecord(v.acquisition),
    { candidates, media, ...acquisition } = a,
    section = page.section
  if (!Array.isArray(candidates) || !Array.isArray(media) || typeof v.text !== 'string')
    throw new Error('Invalid saved source read.')
  const rows = section === 'candidates' ? candidates : section === 'media' ? media : undefined,
    total = rows?.length ?? v.text.length,
    length = section === 'text' ? 4000 : page.limit,
    items = rows?.slice(page.offset, page.offset + length),
    text = section === 'text' ? v.text.slice(page.offset, page.offset + length) : undefined
  return {
    source: { id: source.id, url: source.url },
    acquisition,
    counts: { candidates: candidates.length, media: media.length, textCharacters: v.text.length },
    section,
    offset: page.offset,
    total,
    nextOffset: page.offset + length < total ? page.offset + length : null,
    ...(text === undefined
      ? {}
      : {
          text,
          quoteSpans: textQuoteSpans(text, page.offset),
          characterUnit: 'utf16'
        }),
    ...(section === 'candidates'
      ? { candidates: items }
      : section === 'media'
        ? {
            media: items,
            mediaAvailability: Array.isArray(v.mediaAvailability)
              ? v.mediaAvailability.filter(raw =>
                  items!.some(item => mediaRecord(item).id === mediaRecord(raw).mediaId)
                )
              : []
          }
        : {})
  }
}
export const librarySourcePageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    section: { enum: ['text', 'candidates', 'media'] },
    offset: { type: 'integer', minimum: 0, maximum: 1000000 },
    limit: { type: 'integer', minimum: 1, maximum: 20 }
  }
}
