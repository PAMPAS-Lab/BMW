import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
/** Bounded host-owned text outputs, never caller-selected paths or filenames. */
export async function exportProjectText(directory:string,extension:'srt'|'vtt'|'json',text:string,signal?:AbortSignal,guard?:()=>void):Promise<{artifactId:string;bytes:number}> {
  signal?.throwIfAborted();guard?.()
  const bytes=Buffer.from(text,'utf8');if(!bytes.length||bytes.length>512*1024)throw new Error('Text export exceeds 512 KiB.')
  const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Export directory must be owned by the Project.')
  const root=await fs.realpath(directory)
  const artifactId='video-'+crypto.randomUUID()+'.'+extension,file=path.join(root,artifactId)
  let created=false,completed=false
  try{
    const output=await fs.open(file,'wx',0o600);created=true
    try{await output.writeFile(bytes);await output.sync()}finally{await output.close()}
    signal?.throwIfAborted();guard?.();completed=true;return {artifactId,bytes:bytes.length}
  }finally{if(created&&!completed)await fs.rm(file,{force:true})}
}
