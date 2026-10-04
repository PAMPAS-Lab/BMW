import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
const version='1.13.8'
const name=`sherpa-onnx-wasm-simd-${version}-matcha-icefall-zh-en`
const digest='bf891447a28294e43b3925e35d52fec550bd7ff1dfa051fb3026da44655e22d6'
const root=path.resolve(import.meta.dirname,'../.bmw-runtime/local-tts',version)
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-tts-install-'))
try {
  console.log(`Installing fixed local Chinese/English TTS ${version} (128 MiB download). No text is sent to a service.`)
  const response=await fetch(`https://github.com/k2-fsa/sherpa-onnx/releases/download/v${version}/${name}.tar.bz2`,{signal:AbortSignal.timeout(600_000)})
  if(!response.ok)throw new Error(`TTS resource download failed: ${response.status}`)
  const data=new Uint8Array(await response.arrayBuffer())
  if(data.length!==133789706 || crypto.createHash('sha256').update(data).digest('hex')!==digest)throw new Error('TTS resource checksum mismatch.')
  const archive=path.join(temporary,'tts.tar.bz2');await fs.writeFile(archive,data)
  const entries=execFileSync('tar',['-tjf',archive],{encoding:'utf8'}).trim().split('\n')
  if(entries.some(entry=>!entry.startsWith(`./${name}/`)||entry.includes('../')))throw new Error('Invalid resource archive paths.')
  execFileSync('tar',['-xjf',archive,'-C',temporary])
  await fs.mkdir(root,{recursive:true,mode:0o700})
  for(const filename of ['sherpa-onnx-tts.js','sherpa-onnx-wasm-main-tts.js','sherpa-onnx-tts.worker.js','sherpa-onnx-wasm-main-tts.wasm','sherpa-onnx-wasm-main-tts.data'])await fs.copyFile(path.join(temporary,name,filename),path.join(root,filename))
  await fs.writeFile(path.join(root,'provenance.json'),JSON.stringify({version,source:`https://github.com/k2-fsa/sherpa-onnx/releases/tag/v${version}`,archiveSha256:digest,bytes:data.length},null,2)+'\n')
  console.log(`Local model ready: ${root}`)
}finally{await fs.rm(temporary,{recursive:true,force:true})}
