import crypto from 'node:crypto'
import {assertTextReadBatch,textReadId,textReadRevision,textReadHash} from '@bmw-agent/media-native/sources'
import type {TextReadBatch,TextReadBatchReceipt} from '@bmw-agent/media-native/sources'
import {ProjectRecordStore} from './project-record-store.js'

type Checkpoint={kind:'checkpoint';batch:TextReadBatch;sha256:string}
type Head={kind:'head';batchId:string;revision:number;sha256:string}
type Stored=Checkpoint|Head
const fingerprint=(value:TextReadBatch)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const checkpointKey=(id:string,revision:number)=>'checkpoint:'+id+':'+revision
const headKey=(id:string)=>'head:'+id
/** Native Project checkpoints, independent of model/context size and source body storage. */
export class TextReadBatchStore {
 private readonly records:ProjectRecordStore<Stored>
 constructor(directory:string,private readonly projectId:string){
  textReadId(projectId)
  this.records=new ProjectRecordStore(directory,projectId,'text-batches',raw=>this.decode(raw),()=>({fingerprint:crypto.createHash('sha256').update('').digest('hex'),revision:0,records:[]}),record=>record.kind==='head'?{text:record.batchId+' '+record.revision,terms:['kind:text-batch-head','batch:'+record.batchId]}:{text:[record.batch.id,...record.batch.rows.map(row=>[row.url.slice(0,500),row.state,row.sourceId??'',row.acquisitionId??''].join(' '))].join('\n'),terms:['kind:text-batch-checkpoint','batch:'+record.batch.id,...new Set(record.batch.rows.map(row=>'state:'+row.state))]})
 }
 private decode(raw:unknown):Stored {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid stored text-read record.')
  const value=raw as Record<string,unknown>
  if(value.kind==='head'){
   if(Object.keys(value).some(key=>!['kind','batchId','revision','sha256'].includes(key)))throw new TypeError('Unsupported stored text-read head field.')
   return {kind:'head',batchId:textReadId(value.batchId),revision:textReadRevision(value.revision),sha256:textReadHash(value.sha256)}
  }
  if(value.kind!=='checkpoint'||Object.keys(value).some(key=>!['kind','batch','sha256'].includes(key)))throw new TypeError('Invalid stored text-read checkpoint.')
  const batch=assertTextReadBatch(value.batch),sha256=textReadHash(value.sha256)
  if(batch.projectId!==this.projectId||fingerprint(batch)!==sha256)throw new Error('TEXT_BATCH_INTEGRITY: Checkpoint identity/fingerprint mismatch.')
  return {kind:'checkpoint',batch,sha256}
 }
 private get(key:string):Stored|undefined{return this.records.state().sequence?this.records.get(key):undefined}
 read(batchId:string,revision:number,sha256:string):TextReadBatch {
  const id=textReadId(batchId),version=textReadRevision(revision),hash=textReadHash(sha256),record=this.get(checkpointKey(id,version))
  if(record?.kind!=='checkpoint')throw new Error('TEXT_BATCH_NOT_FOUND: Fixed checkpoint is unavailable.')
  if(record.batch.id!==id||record.batch.projectId!==this.projectId||record.batch.revision!==version||record.sha256!==hash||fingerprint(record.batch)!==hash)throw new Error('TEXT_BATCH_INTEGRITY: Requested checkpoint fingerprint does not match.')
  return structuredClone(record.batch)
 }
 write(raw:TextReadBatch,expectedBatchRevision?:number):TextReadBatchReceipt {
  const batch=assertTextReadBatch(raw)
  if(batch.projectId!==this.projectId)throw new Error('TEXT_BATCH_PROJECT: Foreign Project checkpoint.')
  const current=this.get(headKey(batch.id)),head=current?.kind==='head'?current:undefined
  if(current&&!head)throw new Error('TEXT_BATCH_INTEGRITY: Invalid latest checkpoint pointer.')
  if(expectedBatchRevision===undefined){
   if(head||batch.revision!==0)throw new Error('TEXT_BATCH_CONFLICT: New batches start at revision zero; existing batches require CAS.')
  }else{
   const expected=textReadRevision(expectedBatchRevision)
   if(!head||head.revision!==expected||batch.revision!==expected+1)throw new Error('TEXT_BATCH_CONFLICT: Reload the current batch checkpoint.')
   const previous=this.read(head.batchId,head.revision,head.sha256)
   if(previous.mode!==batch.mode||previous.finishedAt!==null||previous.startedAt!==batch.startedAt||previous.rows.length!==batch.rows.length)throw new Error('TEXT_BATCH_CONFLICT: A completed batch or its original scope cannot be replaced.')
   for(let index=0;index<previous.rows.length;index++){
    const before=previous.rows[index],after=batch.rows[index]
    if(before.index!==after.index||before.url!==after.url||before.startedAt!==undefined&&before.startedAt!==after.startedAt||before.state!=='pending'&&JSON.stringify(before)!==JSON.stringify(after))throw new Error('TEXT_BATCH_CONFLICT: Preserve scope and already completed rows; never replay them.')
   }
  }
  if(this.get(checkpointKey(batch.id,batch.revision)))throw new Error('TEXT_BATCH_CONFLICT: Checkpoint revision already exists.')
  const sha256=fingerprint(batch),result=this.records.put([{key:checkpointKey(batch.id,batch.revision),value:{kind:'checkpoint',batch,sha256}},{key:headKey(batch.id),value:{kind:'head',batchId:batch.id,revision:batch.revision,sha256}}],this.records.state().revision)
  if(result.indexWarning)throw Object.assign(new Error('TEXT_BATCH_COMMITTED_INDEX_UNAVAILABLE: Authoritative checkpoint saved; do not replay.'),{receipt:{batchId:batch.id,revision:batch.revision,sha256}})
  return {batchId:batch.id,revision:batch.revision,sha256}
 }
}
