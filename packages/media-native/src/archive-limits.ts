/** Encoded delivery storage is independent of bounded decoded processing. */
export const ARCHIVE_LIMITS=Object.freeze({bytes:4*1024*1024*1024,evidenceBytes:16*1024*1024,durationSeconds:6*60*60,segments:20000,packetsPerTrack:2_000_000,timeoutMs:20*60*1000,transferTimeoutMs:2*60*60*1000})
