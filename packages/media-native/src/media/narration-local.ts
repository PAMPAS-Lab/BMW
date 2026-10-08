import { assertNarration } from '../narration-contract.js'
import type { NarrationBridge } from '../narration-contract.js'
declare global { interface Window { bmwNarration: NarrationBridge } }
function wav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000 || samples.length < 1 || samples.length > sampleRate * 180) throw new Error('Invalid local TTS signal.')
  const data = new Uint8Array(44 + samples.length * 2), view = new DataView(data.buffer)
  const text = (offset: number, value: string) => { [...value].forEach((letter,index) => view.setUint8(offset + index,letter.charCodeAt(0))) }
  text(0,'RIFF');view.setUint32(4,data.length-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true)
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true)
  view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true)
  let peak=0
  samples.forEach((sample,index)=>{if(!Number.isFinite(sample))throw new Error('Local TTS returned invalid samples.');peak=Math.max(peak,Math.abs(sample));view.setInt16(44+index*2,Math.round(Math.max(-1,Math.min(1,sample))*32767),true)})
  if(peak<.001)throw new Error('Local TTS returned silent audio.')
  return data
}
window.bmwNarration.onCommand(value => {
  let worker: Worker | undefined
  try {
    const request=assertNarration(value.request)
    if(request.provider!=='local-matcha')throw new Error('Wrong local narration provider.')
    worker=new Worker('bmw-tts://runtime/sherpa-onnx-tts.worker.js')
    const jobWorker=worker
    jobWorker.onerror=event=>{window.bmwNarration.reply({token:value.token,error:event.message});jobWorker.terminate()}
    jobWorker.onmessage=(event:MessageEvent<unknown>)=>{
      try {
        const message=event.data as {type?:string;message?:string; samples?:Float32Array;sampleRate?:number}
        if(message.type==='sherpa-onnx-tts-ready')jobWorker.postMessage({type:'generate',text:request.text,sid:0,speed:1+request.ratePercent/100})
        if(message.type==='error')throw new Error(message.message??'Local TTS failed.')
        if(message.type==='sherpa-onnx-tts-result'){
          if(!(message.samples instanceof Float32Array))throw new Error('Missing local TTS PCM samples.')
          window.bmwNarration.reply({token:value.token,data:wav(message.samples,message.sampleRate!)})
          jobWorker.terminate()
        }
      } catch(error){window.bmwNarration.reply({token:value.token,error:error instanceof Error?error.message:String(error)});jobWorker.terminate()}
    }
  }catch(error){window.bmwNarration.reply({token:value.token,error:error instanceof Error?error.message:String(error)});worker?.terminate()}
})
