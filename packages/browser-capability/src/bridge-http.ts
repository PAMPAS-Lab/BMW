import {Agent,fetch} from 'undici'
import type {RequestInit} from 'undici'

/** Private authenticated loopback transport. Each caller's finite AbortSignal owns the whole job deadline, including time before response headers. */
export function createBridgeHttp(base:string){
 const origin=new URL(base)
 if(origin.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('BMW Bridge must be a loopback HTTP origin')
 // Loopback setup is cheap; never reuse an idle socket for a non-idempotent
 // authenticated job. An idle-close race can lose the reply after execution.
 // A fresh connection avoids that race without replaying any browser action.
 const dispatcher=new Agent({headersTimeout:0,bodyTimeout:0,pipelining:0})
 return {request:(endpoint:'tool'|'execute',init:RequestInit&{signal:AbortSignal})=>fetch(new URL(endpoint,origin),{...init,redirect:'error',dispatcher}),close:()=>dispatcher.close()}
}
