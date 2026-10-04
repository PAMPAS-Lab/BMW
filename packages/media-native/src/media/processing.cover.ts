import {Input,CustomSource,MP4,QTFF,WEBM,MATROSKA,MPEG_TS} from 'mediabunny'
import {MEDIA_LIMITS} from '../media-contract.js'
import {assertCoverRenderRequest} from './processing.cover-contract.js'
import type {CoverBridge,CoverCommand} from './processing.cover-contract.js'
import {ImageDecodeBudget} from '../image-contract.js'
import {decodeProjectImage} from './image-decoder.js'
import {normalizeBrowserVideoColor,LinearFrameReader} from './linear-frames.js'
import {paintCover} from './processing.cover-paint.js'
declare global {interface Window {bmwCover:CoverBridge}}
const bridge=window.bmwCover
async function render(command:CoverCommand):Promise<void>{
  let input:Input|undefined,reader:LinearFrameReader|undefined
  try{
    const request=assertCoverRenderRequest(command.request)
    let source:HTMLCanvasElement|OffscreenCanvas|undefined,actualTimestampSeconds:number|undefined
    if(request.sourceKind==='image'){
      const bytes=new Uint8Array(command.bytes)
      for(let at=0;at<bytes.length;at+=MEDIA_LIMITS.chunkBytes)bytes.set(await bridge.read(command.token,at,Math.min(MEDIA_LIMITS.chunkBytes,bytes.length-at)),at)
      source=(await decodeProjectImage(bytes,new ImageDecodeBudget())).image
    }else if(request.sourceKind==='video'){
      input=new Input({formats:[MP4,QTFF,WEBM,MATROSKA,MPEG_TS],source:new CustomSource({getSize:()=>command.bytes,maxCacheSize:4*MEDIA_LIMITS.chunkBytes,prefetchProfile:'none',read:(start,end)=>{let at=start;return new ReadableStream<Uint8Array>({async pull(controller){try{if(at>=end){controller.close();return}const data=await bridge.read(command.token,at,Math.min(end-at,MEDIA_LIMITS.chunkBytes));controller.enqueue(data);at+=data.length}catch(error){controller.error(error)}}})}})})
      const track=await input.getPrimaryVideoTrack();if(!track||!await track.canDecode())throw new Error('Cover source has no decodable video track.')
      if(await track.getDisplayWidth()*await track.getDisplayHeight()>MEDIA_LIMITS.sourcePixels)throw new Error('Cover video exceeds the decode pixel limit.')
      const first=await track.getFirstTimestamp(),duration=await track.computeDuration(),time=request.options.timestampSeconds
      if(!Number.isFinite(duration)||duration>1800||time<first||time>=duration)throw new Error('Cover timestamp is outside the actual video track.')
      await normalizeBrowserVideoColor(track)
      reader=new LinearFrameReader(track,{width:Math.min(request.width,1600)})
      const frame=await reader.get(time)
      if(!frame)throw new Error('Cover video frame is unavailable.');source=frame.canvas;actualTimestampSeconds=frame.timestamp
    }
    const canvas=document.createElement('canvas');canvas.width=request.width;canvas.height=request.height;paintCover(canvas,request.options,source)
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Cover PNG encoding failed.')),'image/png'))
    const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.length>MEDIA_LIMITS.frameBytes)throw new Error('Cover PNG exceeds 20 MiB.')
    for(let at=0;at<bytes.length;at+=MEDIA_LIMITS.chunkBytes)await bridge.write(command.token,at,bytes.slice(at,at+MEDIA_LIMITS.chunkBytes))
    bridge.reply({token:command.token,result:{width:request.width,height:request.height,...(actualTimestampSeconds===undefined?{}:{actualTimestampSeconds})}})
  }catch(error){bridge.reply({token:command.token,error:error instanceof Error?error.message:String(error)})}finally{try{await reader?.close()}finally{input?.dispose()}}
}
bridge.onCommand(command=>{void render(command)})
