import type {ProjectSourcePort,VideoIdentity} from '@bmw-agent/media-native/sources'
import {sourceBindings,sameVideoIdentity} from '@bmw-agent/media-native/sources'
import {mediaArtifactHash,readMediaDerivation,readNativeVideoOrigin} from '@bmw-agent/media-native/derivation'
import type {NativeVideoOrigin} from '@bmw-agent/media-native/derivation'

/** External video includes live footage, CG, animation and third-party AI films.
 * Only native source/hash/derivation evidence establishes external provenance. */
export async function externalVideoVisual(port:ProjectSourcePort,directory:string,artifactId:string,signal?:AbortSignal):Promise<boolean>{
 const seen=new Set<string>()
 async function visit(id:string,depth:number):Promise<boolean>{
  signal?.throwIfAborted();if(depth>8||seen.has(id))throw new Error('NEWS_MEDIA_LINEAGE: Cyclic or excessive external-video lineage.');seen.add(id)
  const origin=await readNativeVideoOrigin(directory,id,signal)
  if(origin&&(origin.videoIdentity.platform!=='page'||/^https?:\/\//i.test(origin.videoIdentity.targetId)))return true
  for(const binding of sourceBindings(port,id)){
   const body=await port.readBody(binding.source.id,binding.acquisition.id,signal)
   if(!/^https?:\/\//i.test(body.source.url))continue
   for(const media of body.acquisition.media.filter(m=>m.artifactId===id)){
    const candidate=body.acquisition.candidates.find(c=>c.id===media.candidateId)
    if(candidate&&['video','source'].includes(candidate.kind)&&['decoded-file','partial-preview'].includes(media.state)&&body.mediaAvailability.some(a=>a.mediaId===media.id&&a.available)&&media.contentId===await mediaArtifactHash(directory,id,signal))return true
   }
  }
  const derived=await readMediaDerivation(directory,id,signal)
  return derived?visit(derived.sourceArtifactId,depth+1):false
 }
 return visit(artifactId,0)
}

/** Resolve only Host-owned provenance. Same site/title/file extension never proves the same film. */
export async function selectedVideoVisual(port:ProjectSourcePort,directory:string,artifactId:string,expected:VideoIdentity,signal?:AbortSignal,historicalOrigin?:(artifactId:string,signal?:AbortSignal)=>Promise<NativeVideoOrigin|undefined>):Promise<boolean>{
 const seen=new Set<string>()
 async function visit(id:string,depth:number):Promise<boolean>{
  signal?.throwIfAborted();if(depth>8||seen.has(id))throw new Error('NEWS_MEDIA_LINEAGE: Cyclic or excessive conversion lineage.');seen.add(id)
  const origin=await readNativeVideoOrigin(directory,id,signal)
  if(origin)return sameVideoIdentity(origin.videoIdentity,expected)
  const historical=await historicalOrigin?.(id,signal)
  if(historical){if(historical.artifactId!==id||historical.sha256!==await mediaArtifactHash(directory,id,signal))throw new Error('NEWS_MEDIA_LINEAGE: Historical capture bytes changed.');return sameVideoIdentity(historical.videoIdentity,expected)}
  for(const binding of sourceBindings(port,id)){
   const body=await port.readBody(binding.source.id,binding.acquisition.id,signal)
   for(const media of body.acquisition.media.filter(m=>m.artifactId===id)){
    const identity=media.capture?.videoIdentity??body.acquisition.candidates.find(c=>c.id===media.candidateId)?.videoIdentity
    if(identity&&sameVideoIdentity(identity,expected)&&body.mediaAvailability.some(a=>a.mediaId===media.id&&a.available)&&media.contentId===await mediaArtifactHash(directory,id,signal))return true
   }
  }
  const derivation=await readMediaDerivation(directory,id,signal)
  return derivation?visit(derivation.sourceArtifactId,depth+1):false
 }
 return visit(artifactId,0)
}
