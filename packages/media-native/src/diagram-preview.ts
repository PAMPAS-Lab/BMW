import fs from 'node:fs/promises'
import path from 'node:path'
import {assertComposition,compositionAssets} from './composition-contract.js'
import type {MediaComposition} from './composition-contract.js'
import {assertArtifactId,mediaRecord} from './media-contract.js'
import type {NativeMediaPort} from './media-port.js'
import {ArtifactJobIO} from './artifact-job-io.js'

/** Host-selected, asset-free native scene only. The temporary native encode is
 * never a Studio export; only three PNGs survive. Uses the export painter. */
export async function nativeDiagramFrames(port:NativeMediaPort,raw:MediaComposition,directory:string,signal?:AbortSignal){
 const composition=assertComposition(raw),scene=composition.scenes[0]
 if(composition.scenes.length!==1||scene.durationSeconds>10||composition.width>1280||composition.height>1280||compositionAssets(composition).length||composition.layers?.length||composition.audioTracks?.length)throw new Error('DIAGRAM_PREVIEW_SCOPE: One asset-free scene, at most ten seconds /1280 pixels per side.')
 const times=[0,Math.floor(scene.durationSeconds*.5*composition.fps)/composition.fps,Math.floor((scene.durationSeconds-1/composition.fps)*composition.fps)/composition.fps]
 if(new Set(times).size!==3)throw new Error('DIAGRAM_PREVIEW_SCOPE: Three distinct actual frame times required.')
 const root=await fs.realpath(directory),identity=await fs.lstat(root),before=new Set(await fs.readdir(root)),owned=new Map<string,{dev:number;ino:number}>()
 const claim=async(id:string)=>{const stat=await fs.lstat(path.join(root,id));if(before.has(id)||stat.isSymbolicLink()||!stat.isFile())throw new Error('DIAGRAM_PREVIEW_OUTPUT: Output is not newly owned.');owned.set(id,{dev:stat.dev,ino:stat.ino})}
 const temporary:string[]=[],frames:{artifactId:string;sha256:string;seconds:number;width:number;height:number}[]=[]
 let committed=false
 try{
  signal?.throwIfAborted()
  const rendered=mediaRecord(await port.compose(composition,signal))
  temporary.push(assertArtifactId(rendered.artifactId));if(rendered.verificationArtifactId)temporary.push(assertArtifactId(rendered.verificationArtifactId))
  for(const id of temporary)await claim(id)
  const sample=mediaRecord(await port.processArtifact({action:'media.frames.sample',artifactId:temporary[0],timestampsSeconds:times,maxWidth:1280,maxHeight:720},signal))
  if(!Array.isArray(sample.frames)||sample.frames.length!==3)throw new Error('DIAGRAM_PREVIEW_OUTPUT: Expected three native PNGs.')
  for(const item of sample.frames)await claim(assertArtifactId(mediaRecord(item).artifactId))
  for(const [index,item]of sample.frames.entries()){
   const frame=mediaRecord(item),artifactId=assertArtifactId(frame.artifactId),io=await ArtifactJobIO.open(directory,{action:'media.inspect',artifactId})
   try{if(frame.type!=='screenshot'||frame.contentType!=='image/png'||frame.outputIndex!==index||frame.requestedTimestampSeconds!==times[index]||typeof frame.timestampSeconds!=='number'||Math.abs(frame.timestampSeconds-times[index])>1/composition.fps+.000001||typeof frame.width!=='number'||typeof frame.height!=='number'||frame.width<16||frame.height<16||frame.width>1280||frame.height>720||Math.abs(frame.width/frame.height-composition.width/composition.height)>.01||io.bytes>20*1024*1024)throw new Error('DIAGRAM_PREVIEW_OUTPUT: PNG identity, dimensions or clock mismatch.');frames.push({artifactId,sha256:await io.fingerprint(signal),seconds:frame.timestampSeconds,width:Number(frame.width),height:Number(frame.height)})}finally{await io.close()}
  }
  if(new Set(frames.map(f=>f.sha256)).size<2)throw new Error('DIAGRAM_PREVIEW_STATIC: Native sampled pictures are identical.')
  signal?.throwIfAborted();committed=true;return frames
 }finally{
  // Native processors settle their workers and handles before returning.
  const current=await fs.lstat(root);if(current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino||await fs.realpath(directory)!==root)throw new Error('DIAGRAM_PREVIEW_CLEANUP: Project artifact directory changed.')
  for(const [id,was]of owned){if(committed&&!temporary.includes(id))continue;const now=await fs.lstat(path.join(root,id)).catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(now&&now.dev===was.dev&&now.ino===was.ino&&!now.isSymbolicLink())await fs.unlink(path.join(root,id));else if(now)throw new Error('DIAGRAM_PREVIEW_CLEANUP: Output identity changed.')}
 }
}
