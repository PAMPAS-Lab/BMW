import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import {Readable,Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {createWriteStream,constants} from 'node:fs'
import {LOCAL_ASR_ENGINE_VERSION,LOCAL_ASR_MODEL_REVISION,LOCAL_ASR_MODELS} from '../packages/media-native/src/local-asr-assets.js'
const root=path.resolve(import.meta.dirname,'../.bmw-runtime/local-asr/whisper.cpp',LOCAL_ASR_ENGINE_VERSION)
await fs.mkdir(root,{recursive:true,mode:0o700})
if(await fs.realpath(root)!==root)throw new Error('Local ASR cache must not use a symbolic link.')
const identity=await fs.stat(root)
async function guard(){const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.dev!==identity.dev||stat.ino!==identity.ino||await fs.realpath(root)!==root)throw new Error('Local ASR cache changed.')}
async function verify(file:string,expected:{bytes:number;sha256:string}){
 const input=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{const stat=await input.stat();if(!stat.isFile()||stat.size!==expected.bytes)throw new Error('Local ASR model size mismatch.');const hash=crypto.createHash('sha256');for(let offset=0;offset<stat.size;offset+=1024*1024){await guard();const bytes=Buffer.alloc(Math.min(1024*1024,stat.size-offset)),result=await input.read(bytes,0,bytes.length,offset);if(result.bytesRead!==bytes.length)throw new Error('Local ASR model changed.');hash.update(bytes)}if(hash.digest('hex')!==expected.sha256)throw new Error('Local ASR model SHA-256 mismatch.')}finally{await input.close()}
}
for(const [name,model] of Object.entries(LOCAL_ASR_MODELS)){
 const output=path.join(root,model.filename),url=`https://huggingface.co/ggerganov/whisper.cpp/resolve/${LOCAL_ASR_MODEL_REVISION}/${model.filename}`
 let missing=false;try{await fs.lstat(output)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')missing=true;else throw error}
 if(missing){
  const temporary=path.join(root,crypto.randomUUID()+'.download');let bytes=0,handle:Awaited<ReturnType<typeof fs.open>>|undefined
  try{
   console.log(`Downloading fixed multilingual ${name} model (${model.bytes} bytes).`)
   const response=await fetch(url,{signal:AbortSignal.timeout(1_800_000)});if(!response.ok||!response.body)throw new Error('Local ASR model download failed: HTTP '+response.status)
   const declared=Number(response.headers.get('content-length')??0);if(declared&&declared!==model.bytes)throw new Error('ASR model declared size mismatch.')
   const limited=new Transform({transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;callback(bytes>model.bytes?new Error('ASR model download byte budget exceeded.'):null,chunk)}})
   const reader=response.body.getReader();const chunks=async function*(){try{while(true){const chunk=await reader.read();if(chunk.done)return;yield chunk.value}}finally{reader.releaseLock()}}
   await pipeline(Readable.from(chunks()),limited,createWriteStream(temporary,{flags:'wx',mode:0o600}))
   await verify(temporary,model);handle=await fs.open(temporary,constants.O_RDWR|constants.O_NOFOLLOW);await handle.sync();await handle.close();handle=undefined;await guard()
   // Keep a concurrently-installed model; never overwrite it.
   try{await fs.link(temporary,output)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await verify(output,model)}
  }finally{await handle?.close();await guard();await fs.rm(temporary,{force:true})}
 }
 await verify(output,model);await guard()
 const provenance={provider:'whisper.cpp',engineVersion:LOCAL_ASR_ENGINE_VERSION,model:name,source:url,revision:LOCAL_ASR_MODEL_REVISION,sha256:model.sha256,bytes:model.bytes,license:'MIT',automaticTimingApproved:false}
 const receipt=path.join(root,name+'-provenance.json'),temporary=path.join(root,crypto.randomUUID()+'.json');await fs.writeFile(temporary,JSON.stringify(provenance,null,2)+'\n',{mode:0o600,flag:'wx'});try{await guard();await fs.rename(temporary,receipt)}finally{await guard();await fs.rm(temporary,{force:true})}
 console.log(`Verified ${name}: ${model.sha256}`)
}
console.log('Fixed ASR candidate models are ready. This does not prove alignment accuracy or install the native engine.')
