import {ProjectRecordStore} from '@bmw-agent/platform/record-store'
import {newsFingerprint} from './news-store.js'
import type {NewsBatch} from './news-contract.js'
import {assertRecommendation,recommendationSha,defaultRecommendationPolicy} from './recommendation-contract.js'
import type {RecommendationRecord,RecommendationPolicy,RecommendationAdmission} from './recommendation-contract.js'
export const recommendationKey=(kind:string,...parts:unknown[])=>kind+'-'+recommendationSha(parts)
export class RecommendationStore{
 readonly records:ProjectRecordStore<RecommendationRecord>
 constructor(directory:string,readonly projectId:string){this.records=new ProjectRecordStore(directory,projectId,'recommendations',assertRecommendation,()=>({fingerprint:recommendationSha(''),revision:0,records:[]}),r=>({text:r.kind==='snapshot'?r.scopeLabel:r.kind==='edition'||r.kind==='candidate'?r.entry.topic.candidate.title:'',terms:['kind:'+r.kind,...('snapshotId'in r?['snapshot:'+r.snapshotId]:[]),...('directionId'in r&&r.directionId?['direction:'+r.directionId]:[])]}))}
 get(id:string,sequence?:number){const state=this.records.state();if(!state.sequence||sequence===0)return;return sequence===undefined?this.records.get(id):this.records.getAt(id,sequence)}
 policy(directionId:string|null):RecommendationPolicy{const id=recommendationKey('policy',directionId),r=this.get(id);if(r){if(r.kind!=='policy')throw new Error('Invalid policy identity.');return r}return {version:1,id,revision:0,updatedAt:new Date(0).toISOString(),kind:'policy',directionId,input:defaultRecommendationPolicy()}}
 admission(sessionId:string,batch:NewsBatch):RecommendationAdmission|undefined{const r=this.get(recommendationKey('admission',sessionId,batch.id));if(!r)return;if(r.kind!=='admission'||r.sessionId!==sessionId||r.batchId!==batch.id||r.topicsFingerprint!==newsFingerprint(batch.topics)||r.topicsFingerprint!==newsFingerprint(r.items.map(e=>e.topic)))throw new Error('SNAPSHOT_BINDING: Frozen candidate admission does not match this news batch.');return r}
}
