import fs from 'node:fs/promises'
import path from 'node:path'
import {ArtifactJobIO} from '../../media-native/src/artifact-job-io.js'
import {mediaRecord,assertArtifactId} from '../../media-native/src/media-contract.js'
import {captionDocument} from '../../media-native/src/caption-export.js'
import {VideoStudioStore} from './studio-store.js'
import {draftComposition,studioId} from './studio-contract.js'
import {sparseClosingScenes} from './video-review-policy.js'
import {currentExportReview} from './studio-export-review-state.js'

export interface NewsDeliveryInput {projectDirectory:string;historyFile:string;draftId:string;runId:string;outputDirectory:string}
const json=async(file:string)=>{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>16*1024*1024)throw new Error('Delivery JSON must be a bounded regular file.');return mediaRecord(JSON.parse(await fs.readFile(file,'utf8')))}
/** Operator-only file preparation. No model/tool registration, network, settings
 * writes, new review, rendering or source-profile mutation. */
export async function prepareNewsDelivery(input:NewsDeliveryInput){
 const started=performance.now(),project=path.resolve(input.projectDirectory),output=path.resolve(input.outputDirectory)
 if(await fs.realpath(project)!==project||output===project||output.startsWith(project+path.sep))throw new Error('Delivery output must be outside the canonical source Project.')
 const parent=path.dirname(output);if(await fs.realpath(parent)!==parent)throw new Error('Delivery destination parent must be canonical.')
 const history=await json(input.historyFile),sessionId=studioId(history.sessionId),owner=mediaRecord(history.owner),runId=studioId(input.runId),draftId=studioId(input.draftId)
 if(!Array.isArray(history.receipts))throw new Error('Missing official review receipts.')
 const receipt=history.receipts.map(mediaRecord).find(r=>r.runId===runId),task=mediaRecord(receipt?.task)
 if(!receipt||receipt.state!=='finished'||receipt.outcome!=='success'||task.kind!=='video-review'||typeof task.payload!=='string')throw new Error('Review must be finished successfully, not queued or draining.')
 const target=mediaRecord(JSON.parse(task.payload)),store=new VideoStudioStore(project,sessionId),draft=store.read(draftId)
 if(owner.projectId!==path.basename(project)||target.draftId!==draftId||target.revision!==draft.revision)throw new Error('Delivery owner or current draft target changed.')
 const directory=path.join(project,'artifacts'),guard=()=>{const current=store.read(draftId);if(current.revision!==draft.revision||store.reusableExport(current)?.fingerprint!==target.fingerprint)throw new Error('Delivery draft/export changed.')}
 const context=await currentExportReview(store,draft,directory,guard),snapshot=context.journal.current(context.snapshot)
 if(target.artifactId!==snapshot.artifactId||target.fingerprint!==snapshot.fingerprint||context.technicalStatus!=='passed'||sparseClosingScenes(draft).length>0)throw new Error('Current native output/technical report does not match the review.')
 const fresh=(v:unknown)=>{const r=mediaRecord(v);return r.status==='passed'&&r.runId===runId&&typeof r.sequence==='number'&&typeof target.baseline==='number'&&r.sequence>target.baseline}
 if(!fresh(snapshot.agent)||!snapshot.scenes.length||snapshot.scenes.some(s=>!fresh(s.agent)||s.frames.length!==s.totalSamples||new Set(s.frames.map(f=>f.index)).size!==s.totalSamples))throw new Error('Fresh independent scene/film pass and complete frames are required.')
 let frameBytes=0
 for(const scene of snapshot.scenes)for(const frame of scene.frames){const io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId:frame.artifactId});try{frameBytes+=io.bytes;if(frame.index<0||frame.index>=scene.totalSamples||frameBytes>256*1024*1024||await io.fingerprint()!==frame.sha256)throw new Error('Review frames are missing, changed or over budget.')}finally{await io.close()}}
 const artifactId=assertArtifactId(snapshot.artifactId),io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId});let sha256:string
 try{sha256=await io.fingerprint()}finally{await io.close()}
 if(typeof target.sha256!=='string'||target.sha256!==sha256)throw new Error('Delivery requires the Host-pinned MP4 SHA; legacy reviews need explicit evidence recovery, never guessed approval.')
 const composition=draftComposition(draft),captions=captionDocument(composition.scenes,draft.width,draft.height,'srt'),script:string[]=[draft.title,'当前成片时间轴（秒）'];let offset=0
 for(const s of composition.scenes){script.push(`\n[${offset.toFixed(3)}–${(offset+s.durationSeconds).toFixed(3)}] ${s.title}`,s.narration??'',...(s.captions??[]).map(c=>`${c.text}${c.translationText?' ／ '+c.translationText:''}`));offset+=s.durationSeconds}
 script.push('\n作者原声原文/中译与出处说明（原文保留；其中早期计划时间不替代上面的最终时间轴）：',draft.preparation.outline??'',draft.preparation.notes??'')
 const staging=await fs.mkdtemp(path.join(parent,'.news-delivery-'));let committed=false
 try{
  await fs.copyFile(path.join(directory,artifactId),path.join(staging,'film.mp4'))
  const copy=await ArtifactJobIO.open(staging,{action:'media.inspect',artifactId:'film.mp4'});let copySha:string;try{copySha=await copy.fingerprint()}finally{await copy.close()}if(copySha!==sha256)throw new Error('Export changed while copying.')
  await fs.writeFile(path.join(staging,'script.txt'),script.filter(Boolean).join('\n'));await fs.writeFile(path.join(staging,'captions.srt'),captions.text)
  await fs.writeFile(path.join(staging,'sources.json'),JSON.stringify(draft.scenes.map(s=>({sceneId:s.id,sources:s.sources,citations:s.citations})),null,2))
  const manifest={version:1,projectId:owner.projectId,sessionId,draftId,revision:draft.revision,runId,artifactId,sha256,fingerprint:snapshot.fingerprint,sceneCount:snapshot.scenes.length,frameCount:snapshot.scenes.reduce((n,s)=>n+s.totalSamples,0),humanListening:'pending',userAcceptance:'pending',durationSeconds:offset,technicalReport:context.output.verificationArtifactId,review:receipt,packagingElapsedMs:performance.now()-started,scope:'Existing native outputs only; no new production or sensory approval.'}
  await fs.writeFile(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2));guard()
  // rename must never replace an existing deliverable directory.
  try{await fs.lstat(output);throw new Error('Delivery output already exists; use a new directory.')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  await fs.rename(staging,output);committed=true;return {...manifest,outputDirectory:output}
 }finally{if(!committed)await fs.rm(staging,{recursive:true,force:true})}
}
