import {assertArtifactId,mediaRecord} from '@bmw-agent/media-native/contract'
import {assertVideoIdentity} from '@bmw-agent/agent-contract/video-identity'
import {verifiedCaptureHash} from '@bmw-agent/media-native/derivation'
import type {NativeVideoOrigin} from '@bmw-agent/media-native/derivation'
import type {AgentHistory} from './agent-history-store.js'

/** Only the Host supplies its validated BMW journal; model text is never a receipt. */
export async function historicalCaptureOrigin(history:AgentHistory,owner:{projectId:string;sessionId:string},directory:string,artifactId:string,signal?:AbortSignal):Promise<NativeVideoOrigin|undefined>{
 signal?.throwIfAborted();assertArtifactId(artifactId)
 if(history.sessionId!==owner.sessionId||history.owner.projectId!==owner.projectId)throw new Error('Capture history Project/Session changed.')
 const starts=new Map<string,{runId:string;sequence:number}>(),accepted=new Set<string>()
 for(const row of history.events){
  signal?.throwIfAborted();const event=row.event
  if(event.type==='input.accepted')accepted.add(row.runId)
  if(event.type==='tool.started'&&event.name==='browser'&&event.action==='media.video.capture'&&accepted.has(row.runId))starts.set(event.callId,{runId:row.runId,sequence:row.sequence})
  if(event.type!=='tool.completed'||!event.success)continue
  const start=starts.get(event.callId)
  if(!start||start.runId!==row.runId||start.sequence>=row.sequence||!history.receipts.some(r=>r.runId===row.runId&&r.providerReceiptId!==null))continue
  let value:Record<string,unknown>
  try{value=mediaRecord(JSON.parse(event.message??''))}catch{continue}
  if(value.artifactId!==artifactId)continue
  const timeline=mediaRecord(value.captureTimeline)
  if(timeline.indexArtifactId!==artifactId+'.source.json'||value.type!=='video'||value.contentType!=='video/webm')continue
  const videoIdentity=assertVideoIdentity(value.videoIdentity),sha256=await verifiedCaptureHash(directory,artifactId,signal)
  if(!sha256)return undefined
  signal?.throwIfAborted();return {version:1,kind:'native-video-origin',artifactId,sha256,videoIdentity}
 }
 return undefined
}
