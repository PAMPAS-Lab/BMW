const PAGE_SIZE = 20

/** Public browser receipt only. Internal acquisition keeps every resource for rollback. */
export function preservationResult(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native preservation result.')
 const source = value as Record<string, unknown>, result = {...source}
 if (Array.isArray(source.ownedArtifactIds)) {
  result.ownedArtifactIds = source.ownedArtifactIds.slice(0, PAGE_SIZE)
  result.ownedArtifactCount = source.ownedArtifactIds.length
  result.ownedArtifactsTruncated = source.ownedArtifactIds.length > PAGE_SIZE
 }
 if (source.preservation && typeof source.preservation === 'object' && !Array.isArray(source.preservation)) {
  const proof = source.preservation as Record<string, unknown>, summary = {...proof}
  if (Array.isArray(proof.resources)) {
   summary.resources = proof.resources.slice(0, PAGE_SIZE).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native preservation resource.')
    const resource = value as Record<string, unknown>
    return Object.fromEntries(['artifactId','sha256','bytes','role','durationSeconds','track'].filter(key => resource[key] !== undefined).map(key => [key, resource[key]]))
   })
   summary.resourceCount = proof.resources.length
   summary.resourcesTruncated = proof.resources.length > PAGE_SIZE
   summary.resourceScope = 'Bounded metadata preview; complete URLs and resource ledger remain in proofArtifactId.'
  }
  if(Array.isArray(proof.subtitleTracks)){
   summary.subtitleTracks=proof.subtitleTracks.slice(0,PAGE_SIZE).map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid native subtitle track.')
    const track=value as Record<string,unknown>
    return Object.fromEntries(['group','name','language','default','forced','artifactId','sha256','indexArtifactId','indexSha256','cueCount','occurrenceCount','duplicatesRemoved','timebase','format','delivery'].filter(key=>track[key]!==undefined).map(key=>[key,track[key]]))
   })
   summary.subtitleTrackCount=proof.subtitleTracks.length
   summary.subtitleTracksTruncated=proof.subtitleTracks.length>PAGE_SIZE
   summary.subtitleDelivery='External WebVTT sidecars in the MP4 file PTS domain; original segments and mapping indexes retained in the Project. Complete track list is in proofArtifactId.'
  }
  result.preservation = summary
 }
 return result
}
