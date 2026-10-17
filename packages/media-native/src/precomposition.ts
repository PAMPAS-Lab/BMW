import {assertGridRecipe,gridRowComposition,PRECOMPOSITION_RENDERER} from './precomposition-contract.js'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {assertArtifactId,finiteNumber,mediaRecord} from './media-contract.js'
import {ArtifactJobIO} from './artifact-job-io.js'
import type {MediaComposition} from './composition-contract.js'
import {assertMediaArtifactReceipt} from './media-port.js'
import {exportProjectText} from './text-export.js'
/** Sequential bounded native row jobs. A result is published only after all temporary blocks are removed. */
export class GridPrecomposer {
 private active=false
 private completed:{cacheKey:string;discard:()=>Promise<void>}|undefined
 private failedCleanup:(()=>Promise<void>)|undefined
 constructor(private compose:(composition:MediaComposition,signal?:AbortSignal)=>Promise<unknown>,private memorySnapshot?:()=>number){}
 get busy():boolean{return this.active||Boolean(this.failedCleanup)}
 async recoverCleanup():Promise<void>{if(this.failedCleanup){await this.failedCleanup();this.failedCleanup=undefined;this.active=false}}
 async discard(cacheKey:string):Promise<void>{if(this.busy||this.completed?.cacheKey!==cacheKey)throw new Error('No current owned proxy result to roll back.');const cleanup=this.completed.discard;this.completed=undefined;this.active=true;try{await cleanup();this.active=false}catch{this.failedCleanup=cleanup;throw new Error('Proxy rollback failed; media remains quarantined until media.record.stop succeeds.')}}
 async run(raw:unknown,directory:string,signal?:AbortSignal){
  if(this.busy)throw new Error('Proxy media is active or quarantined; recover cleanup first.')
  const recipe=assertGridRecipe(raw),rootIdentity=await fs.lstat(directory);if(rootIdentity.isSymbolicLink()||await fs.realpath(directory)!==directory)throw new Error('Invalid proxy Project directory.');this.active=true
  const created:string[]=[],temporary:string[]=[],sourceHandles:ArtifactJobIO[]=[],sourceFacts:{artifactId:string;sha256:string;bytes:number}[]=[],started=Date.now();let completed=false,bytes=0
  const remove=async(ids:readonly string[])=>{const dir=await fs.lstat(directory);if(dir.isSymbolicLink()||dir.dev!==rootIdentity.dev||dir.ino!==rootIdentity.ino||await fs.realpath(directory)!==directory)throw new Error('Proxy Project directory changed.');for(const id of ids)await fs.rm(path.join(directory,assertArtifactId(id)),{force:true})}
  let peakAppResidentBytes:number|null=null,memorySamplingUnavailable=false;const sampleMemory=()=>{if(this.memorySnapshot)try{const value=this.memorySnapshot();if(Number.isFinite(value)&&value>=0)peakAppResidentBytes=Math.max(peakAppResidentBytes??0,value);else memorySamplingUnavailable=true}catch{memorySamplingUnavailable=true}};sampleMemory();const memoryTimer=setInterval(sampleMemory,100)
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(()=>controller.abort(new Error('Grid proxy exceeded ten minutes.')),600000)
  const capture=async(raw:unknown,temp:boolean)=>{const receipt=assertMediaArtifactReceipt(raw,'composition');created.push(receipt.artifactId);if(temp)temporary.push(receipt.artifactId);if(receipt.verificationArtifactId){const id=assertArtifactId(receipt.verificationArtifactId);created.push(id);if(temp)temporary.push(id)}const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:receipt.artifactId});try{bytes+=input.bytes;if(bytes>256*1024*1024)throw new Error('Proxy disk budget exceeds 256 MiB.')}finally{await input.close()}return receipt}
  try{
   for(const id of new Set(recipe.inputs.map(i=>i.artifactId))){controller.signal.throwIfAborted();const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:id});sourceHandles.push(input);if(sourceFacts.reduce((n,f)=>n+f.bytes,0)+input.bytes>256*1024*1024)throw new Error('Grid source budget exceeds 256 MiB.');sourceFacts.push({artifactId:id,sha256:await input.fingerprint(controller.signal),bytes:input.bytes})}
   if(sourceFacts.reduce((n,f)=>n+f.bytes,0)>256*1024*1024)throw new Error('Grid source budget exceeds 256 MiB.')
   const proxies:string[]=[]
   for(let row=0;row<Math.pow(recipe.rows/Math.min(2,recipe.rows),2);row++){controller.signal.throwIfAborted();const c=gridRowComposition(recipe,row);if(!c.scenes[0].layers?.length)throw new Error('Each requested grid row requires an input.');proxies.push((await capture(await this.compose(c,controller.signal),true)).artifactId)}
   controller.signal.throwIfAborted();const output=await capture(await this.compose(gridRowComposition(recipe,0,proxies),controller.signal),false)
   for(const [i,input]of sourceHandles.entries())if(await input.fingerprint(controller.signal)!==sourceFacts[i].sha256)throw new Error('PRECOMPOSITION_STALE: Source changed during rendering.')
   const outputInput=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:output.artifactId});let outputSha256:string;try{outputSha256=await outputInput.fingerprint(controller.signal)}finally{await outputInput.close()}
   const cacheKey=crypto.createHash('sha256').update(JSON.stringify({recipe,sourceFacts,rendererVersion:PRECOMPOSITION_RENDERER})).digest('hex'),report={version:1,kind:'bmw.grid-proxy',recipe,sourceFacts,rendererVersion:PRECOMPOSITION_RENDERER,cacheKey,artifactId:output.artifactId,outputSha256,width:recipe.width,height:recipe.height,fps:recipe.fps,durationSeconds:recipe.durationSeconds,elapsedMs:Date.now()-started,hostProcessPeakResidentBytes:process.resourceUsage().maxRSS*1024,appSampledPeakResidentBytes:peakAppResidentBytes,memorySampleIntervalMs:100,memorySamplingUnavailable,memoryScope:'all BMW application processes; sampled peak, host high-water separately',diskBytes:bytes,audioPolicy:recipe.audio,internalObjectsEditable:false}
   const receipt=await exportProjectText(directory,'json',JSON.stringify(report,null,2)+'\n',controller.signal);created.push(receipt.artifactId)
   await remove(temporary);controller.signal.throwIfAborted();completed=true;this.completed={cacheKey,discard:()=>remove(created)}
   return {...output,width:recipe.width,height:recipe.height,fps:recipe.fps,durationSeconds:recipe.durationSeconds,recipeArtifactId:receipt.artifactId,cacheKey,metrics:report}
  }finally{
   clearTimeout(timer);clearInterval(memoryTimer);signal?.removeEventListener('abort',abort)
   const cleanup=async()=>{for(const input of sourceHandles)await input.close();if(!completed)await remove(created)}
   try{await cleanup();this.active=false}catch{completed=false;this.completed=undefined;this.failedCleanup=cleanup;throw new Error('Proxy cleanup failed; media is quarantined until media.record.stop succeeds.')}
  }
 }
}

/** Re-read a Project-owned recipe receipt and compare every source/output SHA.
 * A receipt is provenance data, never permission to bypass a new render's checks. */
export async function inspectGridProxy(directory:string,reportArtifactId:string,signal?:AbortSignal){
 const input=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:reportArtifactId});let report:Record<string,unknown>
 try{if(input.bytes>512*1024)throw new Error('Proxy report exceeds budget.');report=mediaRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await input.read(0,input.bytes))))}finally{await input.close()}
 if(report.version!==1||report.kind!=='bmw.grid-proxy'||report.rendererVersion!==PRECOMPOSITION_RENDERER||typeof report.cacheKey!=='string'||!/^[a-f0-9]{64}$/.test(report.cacheKey)||!Array.isArray(report.sourceFacts)||report.sourceFacts.length>16)throw new TypeError('Invalid proxy report.')
 const recipe=assertGridRecipe(report.recipe),outputId=assertArtifactId(report.artifactId),facts=report.sourceFacts.map(raw=>{const f=mediaRecord(raw);if(typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))throw new TypeError('Invalid proxy source SHA.');return {artifactId:assertArtifactId(f.artifactId),sha256:f.sha256,bytes:finiteNumber(f.bytes,'proxy source bytes',1,256*1024*1024,true)}})
 if(new Set(facts.map(f=>f.artifactId)).size!==facts.length||new Set(recipe.inputs.map(i=>i.artifactId)).size!==facts.length||recipe.inputs.some(i=>!facts.some(f=>f.artifactId===i.artifactId)))throw new TypeError('Proxy source facts do not match recipe.')
 if(crypto.createHash('sha256').update(JSON.stringify({recipe,sourceFacts:facts,rendererVersion:PRECOMPOSITION_RENDERER})).digest('hex')!==report.cacheKey)throw new TypeError('Proxy recipe identity mismatch.')
 if(typeof report.outputSha256!=='string'||!/^[a-f0-9]{64}$/.test(report.outputSha256))throw new TypeError('Invalid proxy output SHA.')
 const stale:{artifactId:string;reason:string}[]=[]
 for(const f of [...facts,{artifactId:outputId,sha256:report.outputSha256}]){signal?.throwIfAborted();let io:ArtifactJobIO|undefined;try{io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:f.artifactId});if(await io.fingerprint(signal)!==f.sha256)stale.push({artifactId:f.artifactId,reason:'content-changed'})}catch{signal?.throwIfAborted();stale.push({artifactId:f.artifactId,reason:'unavailable'})}finally{await io?.close()}}
 return {state:stale.length?'stale':'current',artifactId:outputId,recipeArtifactId:reportArtifactId,cacheKey:report.cacheKey,stale,recipe,automaticReuse:false}
}
