import {setTimeout as delay} from 'node:timers/promises'
/** Bound the requested window; progressive players need a short startup lead,
 * not the entire recording prebuffered. Native capture validates later progress. */
export function capturePreparationPolicy(maxDurationMs=29000){if(!Number.isInteger(maxDurationMs)||maxDurationMs<1000||maxDurationMs>1800000)throw new TypeError('Invalid capture window.');return {windowSeconds:Math.min(maxDurationMs,30000)/1000,qualityLevels:['hd720','hd1080','large','medium','small','tiny'] as const}}
export interface CapturePlayerState {width:number;height:number;readyState:number;durationSeconds:number;currentTimeSeconds?:number;bufferedStartSeconds:number|null;bufferedEndSeconds:number;requested:string|null}
export interface CaptureReadinessPort {read(start:boolean):Promise<CapturePlayerState>;pause():Promise<void>}
/** Warm a short source in the actual player before starting the recording clock.
 * Each read is bounded by the browser adapter; cleanup is awaited on every exit. */
export async function prepareVideoCapture(port:CaptureReadinessPort,signal:AbortSignal,budgetMs=30000,captureWindowSeconds=30){
 if(!Number.isFinite(captureWindowSeconds)||captureWindowSeconds<=0||captureWindowSeconds>30)throw new TypeError('Invalid capture preparation window.')
 const deadline=performance.now()+budgetMs,startupLeadSeconds=Math.min(captureWindowSeconds,3);let start=true
 try{
  while(true){
   signal.throwIfAborted();const initializing=start,state=await port.read(start);start=false
   const at=state.currentTimeSeconds??0
   if(!initializing&&Number.isFinite(at)&&at>=0&&state.width>0&&state.height>0&&state.readyState>=3&&Number.isFinite(state.durationSeconds)&&state.durationSeconds>at+.1&&state.bufferedStartSeconds!==null&&state.bufferedStartSeconds<=at+.1&&state.bufferedEndSeconds>=Math.min(state.durationSeconds,at+startupLeadSeconds)-.1)return {...state,reencoded:true,startupLeadSeconds,selection:state.requested?'requested-player-quality':'current-player'}
   if(performance.now()>=deadline)throw new Error(`MEDIA_CAPTURE_BUFFERING: The confirmed player did not buffer a usable startup interval within the preparation budget. position=${at}; buffered=${state.bufferedStartSeconds}–${state.bufferedEndSeconds}; duration=${state.durationSeconds}; readyState=${state.readyState}; size=${state.width}x${state.height}; requiredLead=${startupLeadSeconds}.`)
   await delay(Math.min(200,Math.max(1,deadline-performance.now())),undefined,{signal})
  }
 }finally{await port.pause()}
}

/** Fixed native player operation: normal play/visible skip only. An ad can
 * advance but can never certify the requested content as ready. */
export function advanceYoutubePlayer(expectedId:string):'ready'|'advertisement'|'waiting'|'different-target'{
 const player=document.getElementById('movie_player') as HTMLElement&{getVideoData?:()=>{video_id?:string};getPlayerResponse?:()=>{videoDetails?:{videoId?:string};playabilityStatus?:{status?:string}}}|null
 const video=player?.querySelector('video'),data=player?.getVideoData?.(),response=player?.getPlayerResponse?.()
 if(!player||!video||!data?.video_id||!response?.videoDetails?.videoId)return 'waiting'
 if(data.video_id!==expectedId||response.videoDetails.videoId!==expectedId)return 'different-target'
 if(player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting')){
  const skip=[...player.querySelectorAll('button.ytp-skip-ad-button,button.ytp-ad-skip-button,button.ytp-ad-skip-button-modern')].find(element=>{
   const style=getComputedStyle(element);return element instanceof HTMLButtonElement&&!element.disabled&&element.getClientRects().length>0&&style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0
  }) as HTMLButtonElement|undefined
  if(skip)skip.click()
  else if(video.paused)void video.play().catch(()=>{})
  return 'advertisement'
 }
 if(response.playabilityStatus?.status&&response.playabilityStatus.status!=='OK')return 'waiting'
 return video.videoWidth>0&&video.readyState>=2&&Number.isFinite(video.duration)&&video.duration>0?'ready':'waiting'
}
