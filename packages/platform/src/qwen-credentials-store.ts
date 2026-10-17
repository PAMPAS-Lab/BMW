import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {assertQwenCredentials} from '@bmw-agent/media-native/narration'
import type {QwenNarrationCredentials} from '@bmw-agent/media-native/narration'

export interface CredentialEncryption {
  isEncryptionAvailable():boolean
  getSelectedStorageBackend?():string
  encryptString(value:string):Buffer
  decryptString(value:Buffer):string
}
export interface QwenCredentialStatus {available:boolean;configured:boolean;workspaceId:string;state:'empty'|'ready'|'unavailable'|'unreadable'}
/** Shell-only status; decrypted credentials are available only to the native media callback. */
export class QwenCredentialsStore {
  constructor(private filePath:string,private encryption:CredentialEncryption){}
  private available():boolean{return this.encryption.isEncryptionAvailable()&&this.encryption.getSelectedStorageBackend?.()!=='basic_text'}
  private bytes():Buffer|undefined {
    let info:fs.Stats
    try{info=fs.lstatSync(this.filePath)}catch(error:unknown){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw new Error('Qwen 凭据不可读，原文件已保留。')}
    if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024)throw new Error('Qwen 凭据不可读，原文件已保留。')
    return fs.readFileSync(this.filePath)
  }
  read():QwenNarrationCredentials {
    if(!this.available())throw new Error('系统安全存储不可用，无法读取或保存 Qwen 凭据。')
    const bytes=this.bytes()
    if(!bytes)throw new Error('请先在 BMW 设置中保存 Qwen API Key 和 Workspace ID。')
    try{
      const value:unknown=JSON.parse(this.encryption.decryptString(bytes))
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error()
      const {version,...credentials}=value as Record<string,unknown>
      if(version!==1)throw new Error()
      return assertQwenCredentials(credentials)
    }catch{throw new Error('Qwen 凭据无法解密或格式无效，原文件已保留。请恢复系统安全存储，或清除配置后重新保存。')}
  }
  status():QwenCredentialStatus {
    if(!this.available())return {available:false,configured:false,workspaceId:'',state:'unavailable'}
    try{
      if(!this.bytes())return {available:true,configured:false,workspaceId:'',state:'empty'}
      const credentials=this.read()
      return {available:true,configured:true,workspaceId:credentials.workspaceId,state:'ready'}
    }catch{return {available:true,configured:false,workspaceId:'',state:'unreadable'}}
  }
  save(raw:unknown):QwenCredentialStatus {
    if(!this.available())throw new Error('系统安全存储不可用，BMW 不会以明文保存 Qwen 凭据。')
    // Preserve unreadable existing bytes; replacement requires an explicit clear.
    const existing=this.bytes()?this.read():undefined
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid Qwen credential settings.')
    const value=raw as Record<string,unknown>
    const credentials=assertQwenCredentials({...value,apiKey:value.apiKey===''?existing?.apiKey:value.apiKey})
    let encrypted:Buffer
    try{encrypted=this.encryption.encryptString(JSON.stringify({version:1,...credentials}))}catch{throw new Error('Qwen 凭据加密失败，原配置已保留。')}
    if(encrypted.length===0||encrypted.length>32*1024)throw new Error('Qwen 凭据加密失败，原配置已保留。')
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true,mode:0o700})
    const temporary=this.filePath+'.'+crypto.randomUUID()+'.tmp'
    try{fs.writeFileSync(temporary,encrypted,{flag:'wx',mode:0o600});fs.renameSync(temporary,this.filePath)}
    catch{throw new Error('Qwen 凭据保存失败，原配置已保留。')}
    finally{fs.rmSync(temporary,{force:true})}
    return this.status()
  }
  clear():QwenCredentialStatus {
    // Explicit deletion also works when the OS key or encrypted file is unreadable.
    fs.rmSync(this.filePath,{force:true})
    return this.status()
  }
}
