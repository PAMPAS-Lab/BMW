import crypto from 'node:crypto'
import {ProjectRecordStore} from '@bmw-agent/platform/record-store'
import {assertBatchRecord,liveBatch} from './collection-batch-contract.js'
import type {BatchRecord,CollectionBatch,CollectionCheckpoint} from './collection-batch-contract.js'
export const checkpointId=(subscriptionId:string)=>crypto.createHash('sha256').update('collection-checkpoint:'+subscriptionId).digest('hex')
export class CollectionBatchStore {
 readonly records:ProjectRecordStore<BatchRecord>
 constructor(directory:string,projectId:string){this.records=new ProjectRecordStore(directory,projectId,'collection-batches',assertBatchRecord,()=>({fingerprint:crypto.createHash('sha256').update('').digest('hex'),revision:0,records:[]}),r=>({text:r.kind==='batch'?r.message:r.subscriptionId,terms:['kind:'+r.kind,...(r.kind==='batch'&&liveBatch(r)?['live']:[])]}))}
 get(id:string):BatchRecord|undefined{return this.records.state().sequence?this.records.get(id):undefined}
 batch(id:string):CollectionBatch{const b=this.get(id);if(b?.kind!=='batch')throw new Error('Unknown collection batch.');return b}
 checkpoint(id:string):CollectionCheckpoint|undefined{const c=this.get(checkpointId(id));return c?.kind==='checkpoint'?c:undefined}
 save(items:BatchRecord[],signal?:AbortSignal){return this.records.put(items.map(raw=>{const value=assertBatchRecord(raw);return {key:value.id,value}}),this.records.state().revision,signal)}
 active():boolean{return Boolean(this.records.state().sequence&&this.records.count('live'))}
}
