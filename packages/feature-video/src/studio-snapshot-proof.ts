import crypto from 'node:crypto'
import {assertVideoDraft,studioDraftContentKey} from './studio-contract.js'
import type {VideoDraft} from './studio-contract.js'
interface Owner {projectId:string;sessionId:string}
/** Process-local approval of exact host-observed content. It grants no paths or file access. */
export class StudioSnapshotProof {
 private readonly key=crypto.randomBytes(32)
 private body(owner:Owner,draft:VideoDraft):string {
  if(draft.ownerSessionId!==owner.sessionId)throw new Error('STUDIO_SESSION_MISMATCH: 历史快照不属于当前对话。')
  const content=studioDraftContentKey(draft)
  if(Buffer.byteLength(content)>1024*1024)throw new Error('Studio snapshot exceeds its byte budget.')
  return JSON.stringify({version:1,projectId:owner.projectId,sessionId:owner.sessionId,content})
 }
 issue(owner:Owner,draft:VideoDraft):string{return crypto.createHmac('sha256',this.key).update(this.body(owner,assertVideoDraft(draft))).digest('hex')}
 verify(owner:Owner,draft:VideoDraft,proof:string):void {
  if(!/^[a-f0-9]{64}$/.test(proof)||!crypto.timingSafeEqual(Buffer.from(proof,'hex'),Buffer.from(this.issue(owner,draft),'hex')))throw new Error('STUDIO_SNAPSHOT_INVALID: 历史快照已变化或失效；当前输入保留，请重新加载。')
 }
}
