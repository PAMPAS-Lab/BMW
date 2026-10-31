type Outcome<T>={ok:true;value:T}|{ok:false;error:unknown}

/** Three in-flight segments, ordered adoption, and actual drain on every exit.
 * With the existing32MiB segment cap, buffers including the committing item
 * remain bounded by128MiB; no whole-program buffering or speculative retry. */
export async function* orderedPreservationTransfer<T,R>(items:readonly T[],produce:(item:T,index:number)=>Promise<R>,guard:()=>Promise<void>,abort:(error:unknown)=>void):AsyncGenerator<R> {
 const pending=new Map<number,Promise<Outcome<R>>>()
 let next=0,complete=false,failed=false,firstFailure:unknown
 const start=(index:number)=>{
  const promise=Promise.resolve().then(()=>produce(items[index]!,index)).then<Outcome<R>,Outcome<R>>(value=>({ok:true,value}),error=>{if(!failed){failed=true;firstFailure=error;abort(error)}return {ok:false,error}})
  pending.set(index,promise)
 }
 try{
  while(next<Math.min(3,items.length))start(next++)
  for(let index=0;index<items.length;index++){
   const result=await pending.get(index)!
   pending.delete(index)
   if(result.ok===false)throw failed?firstFailure:result.error
   await guard()
   yield result.value
   if(next<items.length){if(failed)throw firstFailure;await guard();start(next++)}
  }
  complete=true
 }finally{
  if(!complete)abort(new Error('HLS ordered transfer stopped before completion.'))
  await Promise.all([...pending.values()])
 }
}
