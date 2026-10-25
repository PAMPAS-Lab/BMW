import {setTimeout as delay} from 'node:timers/promises'
export interface CapturePlayerState {width:number;height:number;readyState:number;durationSeconds:number;bufferedStartSeconds:number|null;bufferedEndSeconds:number;requested:string|null}
export interface CaptureReadinessPort {read(start:boolean):Promise<CapturePlayerState>;pause():Promise<void>}
/** Warm a short source in the actual player before starting the recording clock.
 * Each read is bounded by the browser adapter; cleanup is awaited on every exit. */
export async function prepareVideoCapture(port:CaptureReadinessPort,signal:AbortSignal,budgetMs=30000){
 const deadline=performance.now()+budgetMs;let start=true
 try{
  while(true){
   signal.throwIfAborted();const initializing=start,state=await port.read(start);start=false
   if(!initializing&&state.width>0&&state.height>0&&state.readyState>=3&&Number.isFinite(state.durationSeconds)&&state.durationSeconds>0&&state.bufferedStartSeconds!==null&&state.bufferedStartSeconds<=.1&&state.bufferedEndSeconds>=Math.min(state.durationSeconds,30)-.1)return {...state,reencoded:true,selection:state.requested?'requested-player-quality':'current-player'}
   if(performance.now()>=deadline)throw new Error('MEDIA_CAPTURE_BUFFERING: The confirmed player did not buffer a usable source interval within the preparation budget.')
   await delay(Math.min(200,Math.max(1,deadline-performance.now())),undefined,{signal})
  }
 }finally{await port.pause()}
}
