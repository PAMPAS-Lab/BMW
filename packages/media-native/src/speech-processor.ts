import fs from 'node:fs/promises'
import {constants} from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {spawn} from 'node:child_process'
import {performance} from 'node:perf_hooks'
import {mediaRecord,assertArtifactId} from './media-contract.js'
import {ArtifactJobIO} from './artifact-job-io.js'
import {assertSpeechRequest,assertSpeechEvidence,whisperSegments,SPEECH_LIMITS} from './speech-contract.js'
import type {SpeechEvidence,SpeechNormalization} from './speech-contract.js'
import {LOCAL_ASR_ENGINE_VERSION,LOCAL_ASR_MODEL_REVISION,LOCAL_ASR_MODELS} from './local-asr-assets.js'

/** Host-only fixed CLI execution; cancellation rejects only after the child and its pipes settle. */
export async function runSpeechProcess(executable:string,args:readonly string[],cwd:string,signal:AbortSignal,timeoutMs:number):Promise<{stdout:string;stderr:string}> {
 signal.throwIfAborted()
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,[...args],{cwd,shell:false,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:cwd}})
  const stdout:Buffer[]=[],stderr:Buffer[]=[]
  let bytes=0,failure:unknown,killTimer:NodeJS.Timeout|undefined
  const stop=(reason:unknown)=>{if(failure)return;failure=reason;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),2000)}
  const abort=()=>stop(signal.reason??new Error('Speech alignment cancelled.'))
  const timer=setTimeout(()=>stop(new Error('Speech engine exceeded its processing deadline.')),timeoutMs)
  const collect=(stream:'stdout'|'stderr',data:Buffer)=>{bytes+=data.length;if(bytes>SPEECH_LIMITS.logBytes){stop(new Error('Speech engine log exceeded 1 MiB.'));return}if(stream==='stdout')stdout.push(data);else stderr.push(data)}
  child.stdout.on('data',(data:Buffer)=>collect('stdout',data));child.stderr.on('data',(data:Buffer)=>collect('stderr',data))
  child.once('error',error=>{failure??=error})
  child.once('close',(code,termination)=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal.removeEventListener('abort',abort)
   if(failure)reject(failure);else if(code!==0)reject(new Error(`Speech engine failed (${code??termination}).`));else resolve({stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')})
  })
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
 })
}
async function enginePath():Promise<string> {
 if(process.platform!=='darwin'&&process.platform!=='linux')throw new Error('The fixed local speech engine is available on macOS/Linux only.')
 for(const directory of (process.env.PATH??'').split(path.delimiter)){
  if(!path.isAbsolute(directory))continue
  const candidate=path.join(directory,'whisper-cli')
  try{await fs.access(candidate,constants.X_OK);const resolved=await fs.realpath(candidate);if((await fs.stat(resolved)).isFile())return resolved}catch(error){if(!['ENOENT','ENOTDIR','EACCES'].includes((error as NodeJS.ErrnoException).code??''))throw error}
 }
 throw new Error('Install whisper.cpp 1.9.1 (whisper-cli) and the fixed local ASR models before alignment.')
}
async function fileHash(file:string,maximum:number,signal:AbortSignal):Promise<string> {
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{
  const before=await handle.stat();if(!before.isFile()||before.size<1||before.size>maximum)throw new Error('Speech resource exceeds its file budget.')
  const hash=crypto.createHash('sha256')
  for(let at=0;at<before.size;at+=1024*1024){signal.throwIfAborted();const bytes=Buffer.alloc(Math.min(1024*1024,before.size-at)),chunk=await handle.read(bytes,0,bytes.length,at);if(chunk.bytesRead!==bytes.length)throw new Error('Speech resource changed while hashing.');hash.update(bytes)}
  const after=await handle.stat(),current=await fs.lstat(file)
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||current.dev!==after.dev||current.ino!==after.ino||current.isSymbolicLink())throw new Error('Speech resource changed while hashing.')
  return hash.digest('hex')
 }finally{await handle.close()}
}
async function readBounded(file:string,maximum:number):Promise<Buffer> {
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>maximum)throw new Error('Speech evidence exceeds its file budget.');const bytes=Buffer.alloc(stat.size);const read=await handle.read(bytes,0,bytes.length,0);if(read.bytesRead!==bytes.length||(await handle.stat()).size!==stat.size)throw new Error('Speech evidence changed while reading.');return bytes}finally{await handle.close()}
}
interface SpeechProcessorOptions {
 normalize:(raw:unknown,directory:string,signal:AbortSignal)=>Promise<unknown>
 onStatus?:(value:Record<string,unknown>)=>void
}
/** No request can choose an executable, path, model URL, extra arguments or network access. */
export class SpeechProcessor {
 private active=false
 constructor(private options:SpeechProcessorOptions){}
 get busy(){return this.active}
 async align(raw:unknown,directory:string,callerSignal?:AbortSignal):Promise<SpeechEvidence> {
  const request=assertSpeechRequest(raw);callerSignal?.throwIfAborted();if(this.active)throw new Error('Speech alignment is already active.')
  this.active=true
  const signal=callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(SPEECH_LIMITS.jobTimeoutMs)]):AbortSignal.timeout(SPEECH_LIMITS.jobTimeoutMs)
  const start=performance.now(),token=crypto.randomUUID(),created=new Map<string,{dev:number;ino:number}>()
  let job:string|undefined,jobIdentity:{dev:number;ino:number}|undefined,projectRoot:string|undefined,projectIdentity:{dev:number;ino:number}|undefined,success=false,sourceIO:ArtifactJobIO|undefined
  const guard=async()=>{if(!projectRoot||!projectIdentity)throw new Error('Speech Project directory is unavailable.');const stat=await fs.lstat(projectRoot);if(!stat.isDirectory()||stat.dev!==projectIdentity.dev||stat.ino!==projectIdentity.ino||await fs.realpath(projectRoot)!==projectRoot)throw new Error('Speech Project directory changed.')}
  const removeCreated=async()=>{await guard();for(const [file,identity] of created){const stat=await fs.lstat(file).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error});if(stat?.dev===identity.dev&&stat.ino===identity.ino&&!stat.isSymbolicLink())await fs.unlink(file)}}
  const own=async(file:string)=>{await guard();const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Invalid speech output.');created.set(file,{dev:stat.dev,ino:stat.ino})}
  try{
   const resolved=await fs.realpath(directory),identity=await fs.lstat(directory)
   if(resolved!==path.resolve(directory)||!identity.isDirectory()||identity.isSymbolicLink())throw new Error('Speech artifacts must stay in their canonical Project directory.')
   projectRoot=resolved;projectIdentity=identity
   this.options.onStatus?.({active:true,kind:'processing',action:request.action,stage:'verifying'})
   job=path.join(resolved,'.speech-'+token);await fs.mkdir(job,{mode:0o700});jobIdentity=await fs.lstat(job)
   const executable=await enginePath(),engineSha256=await fileHash(executable,64*1024*1024,signal)
   const version=await runSpeechProcess(executable,['--version'],job,signal,20000)
   if(!new RegExp('(?:^|\\n)whisper\\.cpp version: '+LOCAL_ASR_ENGINE_VERSION.replaceAll('.','\\.')+'(?:\\r?\\n|$)').test(version.stdout+'\n'+version.stderr))throw new Error('Speech engine version differs from the fixed 1.9.1 baseline.')
   const model=LOCAL_ASR_MODELS[request.model],cache=path.resolve(import.meta.dirname,'../../../.bmw-runtime/local-asr/whisper.cpp',LOCAL_ASR_ENGINE_VERSION),modelFile=path.join(cache,model.filename)
   if(await fs.realpath(cache)!==cache||await fs.realpath(modelFile)!==modelFile||(await fs.lstat(modelFile)).size!==model.bytes||await fileHash(modelFile,model.bytes,signal)!==model.sha256)throw new Error('Fixed ASR model is missing, linked or has an invalid SHA-256. Run scripts/install-local-asr.ts.')
   await fs.link(modelFile,path.join(job,'model.bin'))
   sourceIO=await ArtifactJobIO.open(resolved,{action:'media.inspect',artifactId:request.artifactId})
   const sourceSha256=await sourceIO.fingerprint(signal)
   this.options.onStatus?.({active:true,kind:'processing',action:request.action,stage:'normalizing'})
   const normalized=mediaRecord(await this.options.normalize({action:'media.speech.normalize',artifactId:request.artifactId},resolved,signal)),normalizedArtifactId=assertArtifactId(normalized.artifactId),normalizedFile=path.join(resolved,normalizedArtifactId)
   // Record ownership before any cancellation/metadata check so failed jobs can roll back only their new output.
   await own(normalizedFile)
   if(normalized.sourceArtifactId!==request.artifactId||normalized.sourceSha256!==sourceSha256)throw new Error('Normalized speech belongs to another source version.')
   const normalization=mediaRecord(normalized.normalization) as unknown as SpeechNormalization
   const wav=await readBounded(normalizedFile,SPEECH_LIMITS.pcmBytes),normalizedSha256=crypto.createHash('sha256').update(wav).digest('hex')
   if(wav.length!==44+normalization.frames*2)throw new Error('Normalized speech sample count mismatch.')
   await fs.writeFile(path.join(job,'input.wav'),wav,{flag:'wx',mode:0o600});await guard();signal.throwIfAborted()
   this.options.onStatus?.({active:true,kind:'processing',action:request.action,stage:'recognizing'})
   const output=await runSpeechProcess(executable,['-m','model.bin','-f','input.wav','-l',request.language??'zh','-ng','-nf','-t','4','-bs','5','-bo','5','-tp','0','-tpi','0','-ojf','-of','result'],job,signal,SPEECH_LIMITS.jobTimeoutMs)
   const rawBytes=await readBounded(path.join(job,'result.json'),SPEECH_LIMITS.rawBytes),segments=whisperSegments(JSON.parse(rawBytes.toString('utf8')),normalization.durationSeconds,request.model,request.language??'zh')
   await guard();signal.throwIfAborted()
   if(await sourceIO.fingerprint(signal)!==sourceSha256||await fileHash(normalizedFile,SPEECH_LIMITS.pcmBytes,signal)!==normalizedSha256||await fileHash(path.join(job,'model.bin'),model.bytes,signal)!==model.sha256||await fileHash(executable,64*1024*1024,signal)!==engineSha256)throw new Error('Speech source, normalized audio, model or engine changed during alignment.')
   const rawArtifactId='speech-'+token+'-raw.json',rawFile=path.join(resolved,rawArtifactId),logArtifactId='speech-'+token+'-log.json',logFile=path.join(resolved,logArtifactId)
   const logBytes=Buffer.from(JSON.stringify({version:{stdout:version.stdout,stderr:version.stderr},recognition:output},null,2)+'\n')
   if(logBytes.length>SPEECH_LIMITS.rawBytes)throw new Error('Structured speech log exceeds 4 MiB.')
   for(const [file,bytes] of [[rawFile,rawBytes],[logFile,logBytes]] as const){await guard();const handle=await fs.open(file,'wx',0o600);try{await own(file);await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}}
   const result=assertSpeechEvidence({kind:'speech-evidence',...(request.language===undefined?{}:{language:request.language}),provider:'whisper.cpp',engineVersion:LOCAL_ASR_ENGINE_VERSION,model:request.model,modelRevision:LOCAL_ASR_MODEL_REVISION,modelSha256:model.sha256,engineSha256,sourceArtifactId:request.artifactId,sourceSha256,normalizedArtifactId,normalizedSha256,rawArtifactId,rawSha256:crypto.createHash('sha256').update(rawBytes).digest('hex'),logArtifactId,logSha256:crypto.createHash('sha256').update(logBytes).digest('hex'),normalization,sampleRate:16000,channels:1,sampleType:'pcm-s16le',downmix:'channel-mean',timeDomain:'audio-file-seconds',durationSeconds:normalization.durationSeconds,elapsedSeconds:(performance.now()-start)/1000,createdAt:new Date().toISOString(),segments,automaticTimingApproved:false,wordTimingAvailable:false})
   await guard();signal.throwIfAborted();success=true;return result
  }finally{
   try{await sourceIO?.close()}finally{
   try{
    if(projectRoot&&projectIdentity){await guard()
     if(!success||signal.aborted)await removeCreated()
     if(job&&jobIdentity){const stat=await fs.lstat(job);if(stat.dev!==jobIdentity.dev||stat.ino!==jobIdentity.ino||stat.isSymbolicLink())throw new Error('Speech job directory changed; cleanup refused.');await fs.rm(job,{recursive:true})}
     if(signal.aborted){await removeCreated();signal.throwIfAborted()}
    }
   }finally{this.active=false;this.options.onStatus?.({active:false,kind:'processing',action:request.action})}
   }
  }
 }
}
