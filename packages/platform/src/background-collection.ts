import type {BrowserKernel} from '@bmw-agent/browser-capability/kernel'
import type {BrowserExecutor} from '@bmw-agent/browser-capability/bridge'
import type {BrowserExecutionOptions} from '@bmw-agent/browser-capability/host'
/** Host-private action admission for a disposable, pinned collection browser. */
export class BackgroundCollectionScope {
 private calls=0
 private originals=0
 private closed=false
 private expires=Date.now()+10*60*1000
 readonly executor:BrowserExecutor
 constructor(readonly kernel:BrowserKernel,private check:()=>boolean,private beforeCall:()=>void=()=>{}){
  this.executor={execute:async(raw:unknown,options?:BrowserExecutionOptions)=>{
   if(!this.valid()||++this.calls>200)throw new Error('Background collection lease ended or exceeded its bounded call budget')
   this.beforeCall()
   const request=kernel.capabilityRegistry.assertRequest(raw) as {action:string;url?:string;sourceRequest?:{operation:string}}
   if(!['status','help','tabs.list','tabs.open','tabs.close','navigate','observe','library.sources','library.collecting','library.collection-batch'].includes(request.action))throw new Error('Action is unavailable in a background collection')
   if(['tabs.open','navigate'].includes(request.action)&&(!request.url||!/^https?:\/\//i.test(request.url)))throw new Error('Background navigation requires an explicit HTTP(S) URL')
   if(request.action==='library.sources'){
    if(!request.sourceRequest||!['list','read','collect'].includes(request.sourceRequest.operation))throw new Error('Background sources allow only list/read/collect')
    if(request.sourceRequest.operation==='collect'&&++this.originals>20)throw new Error('Background original observation budget exceeded')
   }
   const result:unknown=await kernel.execute(raw,options)
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
