import type {BrowserKernel} from '@bmw-agent/browser-capability/kernel'
import type {BrowserExecutor} from '@bmw-agent/browser-capability/bridge'
import type {BrowserExecutionOptions} from '@bmw-agent/browser-capability/host'
const collectionActions=['status','help','tabs.list','tabs.open','tabs.close','navigate','observe','page.media.list','library.sources','library.collecting','library.collection-batch'] as const
const scopedOperations:Record<string,{field:string;operations:readonly string[]}>= {
 'library.sources':{field:'sourceRequest',operations:['list','read','collect']},
 'library.collecting':{field:'collectionRequest',operations:['read','save-lead','watch-video','update-video','finish']},
 'library.collection-batch':{field:'collectionBatchRequest',operations:['read','collect','submit','review']}
}
function record(value:unknown):Record<string,unknown>|undefined{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined}
/** Project only the exact operation branches, without changing the validator or widening admission. */
function scopedHelpSchema(value:unknown,operations:readonly string[]):unknown {
 if(Array.isArray(value))return value.map(item=>scopedHelpSchema(item,operations))
 const object=record(value);if(!object)return value
 return Object.fromEntries(Object.entries(object).map(([key,item])=>{
  if(key==='oneOf'&&Array.isArray(item))return [key,item.filter(branch=>{const operation=record(record(branch)?.properties)?.operation,constraint=record(operation);return typeof constraint?.const!=='string'||operations.includes(constraint.const)}).map(branch=>scopedHelpSchema(branch,operations))]
  if(key==='operation'){const constraint=record(item);if(Array.isArray(constraint?.enum))return [key,{...constraint,enum:constraint.enum.filter(operation=>typeof operation==='string'&&operations.includes(operation))}]}
  return [key,scopedHelpSchema(item,operations)]
 }))
}
/** Host-private action admission for a disposable, pinned collection browser. */
export class BackgroundCollectionScope {
 private calls=0
 private originals=0
 private previews=0
 private closed=false
 private expires=Date.now()+10*60*1000
 readonly executor:BrowserExecutor
 constructor(readonly kernel:BrowserKernel,private check:()=>boolean,private beforeCall:()=>void=()=>{}){
  this.executor={execute:async(raw:unknown,options?:BrowserExecutionOptions)=>{
   if(!this.valid()||++this.calls>200)throw new Error('Background collection lease ended or exceeded its bounded call budget')
   this.beforeCall()
   const request=kernel.capabilityRegistry.assertRequest(raw) as {action:string;url?:string;forAction?:string;forOperation?:string;sourceRequest?:{operation:string}}
   const video=Boolean(kernel.libraryCollecting),operations={...scopedOperations,...(video?{'library.sources':{field:'sourceRequest',operations:['list','read','collect','confirm','acquire']}}:{})}
   const actions=collectionActions.filter(action=>!['library.collecting','page.media.list'].includes(action)||video).filter(action=>action!=='library.collection-batch'||Boolean(kernel.libraryCollectionBatch))
   if(!actions.includes(request.action as typeof actions[number]))throw new Error('Action is unavailable in a background collection; use scoped help')
   const spec=operations[request.action]
   if(spec){const operation=record(record(raw)?.[spec.field])?.operation;if(typeof operation!=='string'||!spec.operations.includes(operation))throw new Error('Background '+request.action+' allows only '+spec.operations.join('/'))}
   if(request.action==='help'&&request.forAction&&!actions.includes(request.forAction as typeof actions[number]))throw new Error('Help target is unavailable in a background collection; use scoped help')
   if(request.action==='help'&&request.forAction&&request.forOperation&&operations[request.forAction]&&!operations[request.forAction].operations.includes(request.forOperation))throw new Error('Help operation is unavailable in a background collection')
   if(['tabs.open','navigate'].includes(request.action)&&(!request.url||!/^https?:\/\//i.test(request.url)))throw new Error('Background navigation requires an explicit HTTP(S) URL')
   if(request.action==='library.sources'){
    if(!request.sourceRequest||!operations['library.sources'].operations.includes(request.sourceRequest.operation))throw new Error('Background sources allow only list/read/collect')
    if(request.sourceRequest.operation==='acquire'){
     const source=record(record(raw)?.sourceRequest),preview=record(source?.preview),start=preview?.startSeconds,end=preview?.endSeconds
     if(source?.method!=='preserve'||typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<3||end-start>30)throw new Error('Background video requires preserve with an explicit 3–30 second preview; capture and full-only acquisition are unavailable')
     if(++this.previews>10)throw new Error('Background video preview budget exceeded')
    }
    if(request.sourceRequest.operation==='collect'&&++this.originals>20)throw new Error('Background original observation budget exceeded')
   }
   let result:unknown=await kernel.execute(raw,options)
   if(request.action==='help'){
    if(!request.forAction){const help=record(result);result={tool:'browser',scope:'background-collection',actions:Array.isArray(help?.actions)?help.actions.filter(item=>{const row=record(item);return typeof row?.action==='string'&&actions.includes(row.action as typeof actions[number])}).map(item=>{const row=record(item)!;return {...row,description:scopedOperations[String(row.action)]?'Bound to the current saved collection run; operations: '+scopedOperations[String(row.action)].operations.join('/') :row.description}}):[],next:{action:'help',forAction:'observe'}}}
    else if(operations[request.forAction]){result=scopedHelpSchema(result,operations[request.forAction].operations);const help=record(result);if(help)help.description='Background collection operations: '+operations[request.forAction].operations.join('/')+'; bound Project, Session and run are required.'}
   }
   if(!this.valid())throw new Error('Background collection ended before its result drained')
   return result
  }}
 }
 valid():boolean{return !this.closed&&Date.now()<this.expires&&this.check()}
 async close():Promise<void>{this.closed=true;await this.kernel.closeDetached()}
}

/** Passive library refreshes must not preempt a collection merely by rendering. */
export function passiveCollectionUserRead(raw:unknown):boolean {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false
 const value=raw as Record<string,unknown>,actions:Record<string,{field:string;operations:readonly string[]}>={
  'video.studio':{field:'studioRequest',operations:['list','read','assets','news-topics','news-guide']},
  'library.materials':{field:'libraryRequest',operations:['search','read']},
  'library.sources':{field:'sourceRequest',operations:['list','read']},
  'library.research':{field:'researchRequest',operations:['topics','directions','direction-topics','links']},
  'library.streams':{field:'streamRequest',operations:['sources','events']},
  'library.collecting':{field:'collectionRequest',operations:['presets','list','read']},
  'library.collection-batch':{field:'collectionBatchRequest',operations:['list','read']},
  'library.recommendations':{field:'recommendationRequest',operations:['policy','list','read']},
  'library.exports':{field:'exportsRequest',operations:['works','versions','uses','adoptions']}
 }
 const action=typeof value.action==='string'&&Object.hasOwn(actions,value.action)?actions[value.action]:undefined,request=action?value[action.field]:undefined
 return Boolean(action&&request&&typeof request==='object'&&!Array.isArray(request)&&action.operations.includes(String((request as Record<string,unknown>).operation)))
}
