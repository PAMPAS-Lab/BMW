/** One outstanding binary chunk per direction; private worker protocol, never a model action. */
export function sabrBytePipe(ack:()=>void,cancel:(reason:unknown)=>Promise<void>|void){
 let output!:ReadableStreamDefaultController<Uint8Array>,pending:Uint8Array|undefined,ended=false,pull: (()=>void)|undefined
 const stream=new ReadableStream<Uint8Array>({start(controller){output=controller},pull(){if(pending){const chunk=pending;pending=undefined;output.enqueue(chunk);ack();return}if(ended){output.close();return}return new Promise<void>(resolve=>{pull=resolve})},cancel(reason){ended=true;pending=undefined;pull?.();pull=undefined;return cancel(reason)}},{highWaterMark:0})
 return {stream,push(chunk:Uint8Array){if(ended||pending||!chunk.byteLength||chunk.byteLength>32*1024*1024)throw new Error('YOUTUBE_SABR_PIPE: Invalid or unacknowledged binary chunk.');if(pull){const resolve=pull;pull=undefined;output.enqueue(chunk);ack();resolve()}else pending=chunk},end(){if(ended)return;ended=true;if(!pending){output.close();pull?.();pull=undefined}},fail(error:unknown){if(ended)return;ended=true;pending=undefined;output.error(error);pull?.();pull=undefined}}
}
