import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { assertArtifactId, finiteNumber, MEDIA_LIMITS } from './media-contract.js'
import type { MediaProcessRequest } from './media-contract.js'

/** A job owns one already-open input and a fixed set of exclusively-created Project outputs. */
export class ArtifactJobIO {
  private outputs = new Map<number, { handle: FileHandle; artifactId: string; path: string; bytes: number }>()
  private closed = false
  private token = crypto.randomUUID()
  private constructor(readonly root: string, private input: FileHandle | undefined, readonly bytes: number, readonly request: MediaProcessRequest|{action:'media.speech.normalize';artifactId:string},private rootIdentity?:{dev:number;ino:number}) {}
  static async open(directory: string, request: MediaProcessRequest|{action:'media.speech.normalize';artifactId:string}): Promise<ArtifactJobIO> {
    const root = await fs.realpath(directory),rootIdentity=await fs.stat(root)
    if(request.action==='media.image.draw')return new ArtifactJobIO(root,undefined,0,request,rootIdentity)
    const file = path.join(root, assertArtifactId(request.artifactId))
    const resolved = await fs.realpath(file)
    if (path.dirname(resolved) !== root || resolved !== file) throw new Error('Media input is outside its Project or is a symbolic link.')
    const input = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await input.stat()
      if (!stat.isFile() || stat.size < 1 || stat.size > MEDIA_LIMITS.inputBytes) throw new Error('Media input must be a nonempty Project file up to 512 MiB.')
      return new ArtifactJobIO(root, input, stat.size, request,rootIdentity)
    } catch (error) { await input.close(); throw error }
  }
  static async createOutput(directory: string): Promise<ArtifactJobIO> {
    return new ArtifactJobIO(await fs.realpath(directory), undefined, 0, { action: 'media.convert', artifactId: 'composition', outputFormat: 'mp4' })
  }
  async read(offset: unknown, length: unknown): Promise<Uint8Array> {
    if (this.closed || !this.input) throw new Error('Media job has ended or has no input.')
    const start = finiteNumber(offset, 'read offset', 0, this.bytes - 1, true)
    const size = finiteNumber(length, 'read size', 1, Math.min(MEDIA_LIMITS.chunkBytes, this.bytes - start), true)
    const data = Buffer.alloc(size)
    const { bytesRead } = await this.input.read(data, 0, size, start)
    if (bytesRead !== size) throw new Error('Media input changed or was truncated while reading.')
    return new Uint8Array(data)
  }
  async fingerprint(signal?:AbortSignal):Promise<string> {
    if(this.closed||!this.input)throw new Error('Media job has no live input.')
    const file=path.join(this.root,'artifactId' in this.request?this.request.artifactId:'')
    const before=await this.input.stat(),directory=await fs.lstat(this.root),current=await fs.lstat(file)
    if(directory.isSymbolicLink()||this.rootIdentity&&(directory.dev!==this.rootIdentity.dev||directory.ino!==this.rootIdentity.ino)||current.isSymbolicLink()||current.dev!==before.dev||current.ino!==before.ino||await fs.realpath(file)!==file)throw new Error('Media source identity or Project directory changed.')
    const hash=crypto.createHash('sha256')
    for(let offset=0;offset<this.bytes;offset+=MEDIA_LIMITS.chunkBytes){signal?.throwIfAborted();hash.update(await this.read(offset,Math.min(MEDIA_LIMITS.chunkBytes,this.bytes-offset)))}
    const stat=await this.input.stat(),after=await fs.lstat(file);if(!stat.isFile()||stat.size!==this.bytes||before.mtimeMs!==stat.mtimeMs||before.ctimeMs!==stat.ctimeMs||after.dev!==stat.dev||after.ino!==stat.ino||after.isSymbolicLink())throw new Error('Media input changed during hashing.')
    return hash.digest('hex')
  }
  async write(indexValue: unknown, positionValue: unknown, value: unknown): Promise<void> {
    if (this.closed || (this.request.action === 'media.inspect'||this.request.action==='media.image.inspect')) throw new Error('Media job cannot write.')
    const drawing=this.request.action==='media.image.draw'||this.request.action==='media.image.annotate'
    const frame = this.request.action === 'media.frames.sample'
    const index = finiteNumber(indexValue, 'output index', 0, frame ? this.request.timestampsSeconds.length - 1 : 0, true)
    const position = finiteNumber(positionValue, 'write position', 0, MEDIA_LIMITS.outputBytes, true)
    if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > MEDIA_LIMITS.chunkBytes) throw new TypeError('Invalid media output chunk.')
    const maximumBytes = frame||drawing ? MEDIA_LIMITS.frameBytes : MEDIA_LIMITS.outputBytes
    const nextSize = Math.max(this.outputs.get(index)?.bytes ?? 0, position + value.byteLength)
    const total = [...this.outputs].reduce((sum, [key, item]) => sum + (key === index ? 0 : item.bytes), nextSize)
    if (total > maximumBytes) throw new Error('Media output exceeds its byte limit.')
    let output = this.outputs.get(index)
    if (!output) {
      const suffix = this.request.action==='media.speech.normalize'?'speech.wav':frame ? `frame-${index + 1}.png` : drawing ? 'drawing.png' : this.request.action==='media.convert' ? `converted.${this.request.outputFormat}` : (()=>{throw new Error('Unsupported output request.')})()
      const artifactId = `media-${this.token}-${suffix}`
      const file = path.join(this.root, artifactId)
      output = { handle: await fs.open(file, 'wx+', 0o600), artifactId, path: file, bytes: 0 }
      this.outputs.set(index, output)
    }
    let written = 0
    while (written < value.byteLength) {
      const packet = await output.handle.write(value, written, value.byteLength - written, position + written)
      if (!packet.bytesWritten) throw new Error('Media output write made no progress.')
      written += packet.bytesWritten
    }
    output.bytes = nextSize
  }
  async finish(expectedOutputs: number,imageSize?:{width:number;height:number}): Promise<{ artifactId: string; path: string; bytes: number }[]> {
    if (this.closed || this.outputs.size !== expectedOutputs) throw new Error('Missing media output artifacts.')
    const artifacts: { artifactId: string; path: string; bytes: number }[] = []
    for (let index = 0; index < expectedOutputs; index++) {
      const output = this.outputs.get(index)
      if (!output || !output.bytes) throw new Error('Empty media output artifact.')
      await output.handle.sync()
      const header = Buffer.alloc(44)
      await output.handle.read(header, 0, 44, 0)
      const png = Buffer.from([137,80,78,71,13,10,26,10])
      if ((this.request.action === 'media.frames.sample'||this.request.action==='media.image.annotate'||this.request.action==='media.image.draw') && !header.subarray(0,8).equals(png)) throw new Error('Invalid PNG frame artifact.')
      if(imageSize&&(header.readUInt32BE(16)!==imageSize.width||header.readUInt32BE(20)!==imageSize.height))throw new Error('Drawing PNG dimensions disagree with its receipt.')
      if (this.request.action === 'media.convert' && (this.request.outputFormat === 'mp4' ? header.toString('ascii', 4, 8) !== 'ftyp' : !header.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))) throw new Error('Invalid converted media container.')
      if(this.request.action==='media.speech.normalize'&&(output.bytes>44+180*32000||header.toString('ascii',0,4)!=='RIFF'||header.toString('ascii',8,16)!=='WAVEfmt '||header.readUInt32LE(16)!==16||header.readUInt16LE(20)!==1||header.readUInt16LE(22)!==1||header.readUInt32LE(24)!==16000||header.readUInt32LE(28)!==32000||header.readUInt16LE(32)!==2||header.readUInt16LE(34)!==16||header.toString('ascii',36,40)!=='data'||header.readUInt32LE(40)!==output.bytes-44||header.readUInt32LE(4)!==output.bytes-8))throw new Error('Invalid normalized speech WAV.')
      artifacts.push({ artifactId: output.artifactId, path: output.path, bytes: output.bytes })
    }
    await this.close(false)
    return artifacts
  }
  async close(remove = true): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.input?.close()
    for (const output of this.outputs.values()) {
      await output.handle.close()
      if (remove) await fs.rm(output.path, { force: true })
    }
  }
}
