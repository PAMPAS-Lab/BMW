import {parentPort,workerData} from 'node:worker_threads'
import {SabrStream} from 'googlevideo/sabr-stream'
import {VideoPlaybackAbrRequest} from 'googlevideo/protos'
import {buildSabrFormat,Logger,LogLevel} from 'googlevideo/utils'
import {sabrBytePipe} from './youtube-sabr-pipe.js'
import type {YoutubeSabrDelivery,YoutubeSabrFormat} from './youtube-sabr.js'

const port=parentPort
if(!port)throw new Error('SABR protocol worker requires its bounded native parent.')
const input=workerData as {delivery:YoutubeSabrDelivery;video:YoutubeSabrFormat;audio:YoutubeSabrFormat;refreshAttestation?:boolean},decoded=VideoPlaybackAbrRequest.decode(input.delivery.requestBody)
const tokens=new Map<number,{resolve:(token:Uint8Array)=>void;reject:(error:Error)=>void}>();let activeToken=decoded.streamerContext?.poToken,refreshing:Promise<Uint8Array>|undefined
const pending=new Map<number,{resolve:(response:Response)=>void;reject:(error:Error)=>void;pipe?:ReturnType<typeof sabrBytePipe>;detach:()=>void}>(),acks=new Map<string,()=>void>();let sequence=0
const message=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
port.on('message',(raw:unknown)=>{const event=message(raw),id=Number(event.id),request=pending.get(id)
 if(event.type==='attestation'||event.type==='attestation-error'){const target=tokens.get(id);tokens.delete(id);if(target){if(event.type==='attestation'&&event.data instanceof Uint8Array&&event.data.length&&event.data.length<=16384)target.resolve(event.data);else target.reject(new Error('Same-player browser streaming verification could not be refreshed.'))}return}
 if(event.type==='output-ack'){const key=String(event.track),ack=acks.get(key);acks.delete(key);ack?.();return}
 if(!request)return
 if(event.type==='response'){if(request.pipe||!Number.isInteger(event.status)||!Array.isArray(event.headers)){request.reject(new Error('Malformed native SABR response.'));return}const pipe=sabrBytePipe(()=>port.postMessage({type:'response-ack',id}),()=>{port.postMessage({type:'fetch-abort',id})});request.pipe=pipe;request.resolve(new Response(pipe.stream,{status:Number(event.status),headers:event.headers as [string,string][]}))}
 else if(event.type==='response-data'&&event.data instanceof Uint8Array)request.pipe?.push(event.data)
 else if(event.type==='response-end'){request.pipe?.end();request.detach();pending.delete(id)}
 else if(event.type==='response-error'){const error=new Error(String(event.error??'Native SABR request failed.'));request.pipe?.fail(error);request.reject(error);request.detach();pending.delete(id)}
})
Logger.getInstance().setLogLevels(LogLevel.NONE)
const protocolFormat=(format:YoutubeSabrFormat)=>buildSabrFormat({...format,contentLength:format.contentLength===undefined?undefined:String(format.contentLength)})
const callbacks:{onMintPoToken?:()=>Promise<Uint8Array>}={}
const stream=new SabrStream({videoId:input.delivery.videoIdentity.targetId,formats:[protocolFormat(input.video),protocolFormat(input.audio)],serverAbrStreamingUrl:input.delivery.streamUrl,videoPlaybackUstreamerConfig:input.delivery.ustreamerConfig,clientInfo:decoded.streamerContext!.clientInfo!,callbacks,...(decoded.streamerContext?.poToken?.length?{poToken:Buffer.from(decoded.streamerContext.poToken).toString('base64')}:{ }),fetchFunction:async(url,init)=>{
 if(init?.method!=='POST'||!(init.body instanceof Uint8Array)||!init.body.byteLength||init.body.byteLength>256*1024)throw new Error('SABR worker requested unsupported transport.')
 if(refreshing)await refreshing
 const id=++sequence,request=VideoPlaybackAbrRequest.decode(init.body);if(request.streamerContext&&activeToken?.length)request.streamerContext.poToken=activeToken;const body=VideoPlaybackAbrRequest.encode(request).finish()
 return new Promise<Response>((resolve,reject)=>{const abort=()=>port.postMessage({type:'fetch-abort',id});pending.set(id,{resolve,reject,detach:()=>init.signal?.removeEventListener('abort',abort)});init.signal?.addEventListener('abort',abort,{once:true});port.postMessage({type:'fetch',id,url:String(url),body},[body.buffer])})
}})
const error=(value:unknown)=>{const text=value instanceof Error?value.message:String(value);port.postMessage({type:'error',message:text.replace(/https?:\/\/\S+/g,'[delivery]').slice(0,700)})}
stream.on('error',error)
const result=stream.start({videoFormat:input.video.itag,audioFormat:input.audio.itag,maxRetries:0,stallDetectionMs:15000,isPostLiveDvr:false})
// The observed browser token authorizes initialization. Enable refresh only for
// a later server protection request; initialization must not pretend to mint.
if(input.refreshAttestation)callbacks.onMintPoToken=()=>{if(refreshing)return refreshing;const id=++sequence;refreshing=new Promise<Uint8Array>((resolve,reject)=>{tokens.set(id,{resolve,reject});port.postMessage({type:'refresh-attestation',id})}).then(token=>{activeToken=token;return token}).finally(()=>{refreshing=undefined});return refreshing}

async function pump(track:'video'|'audio',source:ReadableStream<ArrayBufferView<ArrayBufferLike>>){for await(const chunk of source){const data=new Uint8Array(chunk.buffer,chunk.byteOffset,chunk.byteLength).slice();if(data.byteLength>32*1024*1024)throw new Error('SABR output chunk budget exceeded.');await new Promise<void>(resolve=>{acks.set(track,resolve);port!.postMessage({type:'output',track,data},[data.buffer])})}port!.postMessage({type:'output-end',track})}
Promise.all([pump('video',result.videoStream),pump('audio',result.audioStream)]).then(()=>port.postMessage({type:'finished'})).catch(error)
