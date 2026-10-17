/** Shared publication contract for persisted documents, discovery and Agent context. */
export const VIDEO_DOCUMENT_VERSIONS = ['2.0','2.1','2.2','2.3','2.4','2.5','2.6','2.7','2.8','2.9'] as const
export type VideoDocumentVersion = typeof VIDEO_DOCUMENT_VERSIONS[number]
export const VIDEO_DOCUMENT_VERSION = VIDEO_DOCUMENT_VERSIONS[VIDEO_DOCUMENT_VERSIONS.length-1]!
