import crypto from 'node:crypto'
export type JsonRecord=Record<string,unknown>
function record(value:unknown):JsonRecord{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid history object');return value as JsonRecord}
/** Preserve textual inputs/outputs; omit credentials and replace large inline media with hashes. */
export function redactVideoCaseValue(value:unknown,secrets:string[]=[]):unknown{
 if(typeof value==='string'){
  let text=value;for(const secret of secrets)if(secret)text=text.replaceAll(secret,'[REDACTED]')
  text=text.replace(/([?&](?:token|api_key|key|authorization|signature)=)[^&\s]+/gi,'$1[REDACTED]')
  if(text.startsWith('data:image/')||text.length>16000&&/^[A-Za-z0-9+/=\r\n]+$/.test(text))return {inlineMediaOmitted:true,characters:text.length,sha256:crypto.createHash('sha256').update(text).digest('hex'),note:'Media files remain in the Project artifact manifest.'}
  return text
 }
 if(Array.isArray(value))return value.map(item=>redactVideoCaseValue(item,secrets))
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|credentials)$/i.test(key)?'[REDACTED]':redactVideoCaseValue(item,secrets)]))
 return value
}
interface HistoryPort{call(method:string,payload:JsonRecord):Promise<unknown>}
/** Read backwards until the earliest durable event, independently of the 200-message snapshot window. */
export async function readCompleteSessionHistory(port:HistoryPort,sessionId:string):Promise<JsonRecord[]>{
 const history=record(await port.call('session.history',{sessionId,maxMessages:200}))
 if(!Array.isArray(history.events)||!history.events.length)throw new Error('DSH returned empty history')
 const rows=history.events.map(record)
 const seq=(row:JsonRecord)=>{const value=record(row.event).seq;if(!Number.isSafeInteger(value)||Number(value)<0)throw new Error('Invalid event sequence');return Number(value)}
 const throughSeq=Math.max(...rows.map(seq))
 while(seq(rows[0])>0){
  const beforeSeq=seq(rows[0]),page=record(await port.call('session.page',{address:{kind:'session',sessionId},throughSeq,beforeSeq,maxMessages:200}))
  if(!Array.isArray(page.records))throw new Error('Missing history page')
  if(!page.records.length)break
  const older=page.records.map(record)
  if(older.some(row=>seq(row)>=beforeSeq))throw new Error('History pagination repeated or exceeded its cursor')
  rows.unshift(...older)
  if(page.hasMore===false)break
 }
 for(let index=1;index<rows.length;index++)if(seq(rows[index])!==seq(rows[index-1])+1)throw new Error('History export has a gap or duplicate')
 return rows
}
export function visibleReasoning(rows:JsonRecord[]):unknown[]{
 const found:unknown[]=[]
 const visit=(value:unknown,seq:unknown):void=>{
  if(Array.isArray(value)){value.forEach(item=>visit(item,seq));return}
  if(!value||typeof value!=='object')return
  const node=value as JsonRecord
  if(typeof node.type==='string'&&/thinking|reasoning/i.test(node.type))found.push({eventSeq:seq,content:node})
  for(const [key,item]of Object.entries(node)){
   if(/^(thinking|reasoning|reasoning_content|reasoningContent|reasoningSummary)$/i.test(key)&&typeof item==='string')found.push({eventSeq:seq,field:key,text:item})
   else if(key!=='type')visit(item,seq)
  }
 }
 for(const row of rows){const event=record(row.event);visit(event,event.seq)}
 return found
}
