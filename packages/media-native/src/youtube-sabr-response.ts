import crypto from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import type {SabrReplayProgress} from './youtube-sabr-clock.js'

const transient=(error:unknown):boolean=>{
 if(!(error instanceof Error))return false
 const code='code' in error?String(error.code):'',cause=error.cause
 return /^(?:ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)$/.test(code)||/net::ERR_(?:INCOMPLETE_CHUNKED_ENCODING|CONNECTION_(?:RESET|CLOSED|ABORTED)|TIMED_OUT|NETWORK_CHANGED)|^(?:fetch failed|terminated|network error)$/i.test(error.message)||(cause!==undefined&&cause!==error&&cause instanceof Error&&/^(?:ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)$/.test('code' in cause?String(cause.code):''))
}
export interface YoutubeSabrResponseInput {
 fetch:()=>Promise<Response>
 signal:AbortSignal
 guard:()=>Promise<void>
 /** Includes retransmitted bytes in the transfer's existing global budget. */
 account:(bytes:number)=>void
 chunk:(bytes:Uint8Array)=>Promise<void>
 /** Real wire activity while an admitted prefix is withheld for verification. */
 replayProgress?:(progress:SabrReplayProgress)=>void
}
/** A failed POST may replay only its exact admitted byte prefix. Nothing from
 * the replay reaches either UMP parser until its entire prefix hash matches.
 * No offsets, signatures, new URLs or protocol state are guessed. */
export async function relayYoutubeSabrResponse(input:YoutubeSabrResponseInput):Promise<{bytes:number;sha256:string;attempts:number;replayedBytes:number}> {
 const hash=crypto.createHash('sha256');let length=0,replayedBytes=0
 for(let attempt=1;attempt<=3;attempt++){
  input.signal.throwIfAborted();await input.guard()
  const prefixLength=length,prefixHash=hash.copy().digest('hex'),replayHash=crypto.createHash('sha256');let replayed=0,lastReplayProgress=-Infinity,response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,networkError:unknown
  try{
   try{response=await input.fetch()}catch(error){if(!transient(error))throw error;networkError=error}
   if(response){
    input.signal.throwIfAborted();await input.guard()
    if([500,502,503,504].includes(response.status))networkError=new Error('YOUTUBE_SABR_HTTP: Temporary server response '+response.status+'.')
    else{
     if(response.status!==200||!response.body||response.headers.get('content-type')?.split(';')[0]!=='application/vnd.yt-ump')throw new Error('YOUTUBE_SABR_HTTP: Expected HTTP 200 UMP response; got '+response.status+'.')
     reader=response.body.getReader()
     while(true){
      input.signal.throwIfAborted();await input.guard()
      let item:ReadableStreamReadResult<Uint8Array>
      try{item=await reader.read()}catch(error){if(!transient(error))throw error;networkError=error;break}
      input.signal.throwIfAborted();await input.guard()
      if(item.done){if(replayed<prefixLength)throw new Error('YOUTUBE_SABR_REPLAY_CHANGED: Replayed response ended before its admitted prefix.');return {bytes:length,sha256:hash.digest('hex'),attempts:attempt,replayedBytes}}
      input.account(item.value.length)
      const skip=Math.min(item.value.length,prefixLength-replayed)
      if(skip){replayHash.update(item.value.subarray(0,skip));replayed+=skip;replayedBytes+=skip;if(replayed===prefixLength&&replayHash.digest('hex')!==prefixHash)throw new Error('YOUTUBE_SABR_REPLAY_CHANGED: Replayed response differs from its admitted prefix.');if(performance.now()-lastReplayProgress>=5000||replayed===prefixLength){input.replayProgress?.({attempt,prefixBytes:prefixLength,replayedBytes:replayed});lastReplayProgress=performance.now()}}
      const next=item.value.subarray(skip)
      if(next.length){await input.chunk(next);hash.update(next);length+=next.length}
     }
    }
   }
  }finally{
   // Cancel/release this body before retry; the owning transfer still awaits
   // actual native request/worker cleanup before releasing admission.
   if(reader){try{await reader.cancel()}catch{}finally{reader.releaseLock()}}
   else await response?.body?.cancel().catch(()=>{})
  }
  input.signal.throwIfAborted();await input.guard()
  if(attempt===3)throw networkError??new Error('YOUTUBE_SABR_HTTP: Native transport attempts exhausted.')
  try{await delay(250*attempt,undefined,{signal:input.signal})}catch(error){input.signal.throwIfAborted();throw error}
 }
 throw new Error('YOUTUBE_SABR_HTTP: Native transport attempts exhausted.')
}
