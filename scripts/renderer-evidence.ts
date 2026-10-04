import {nativeImage} from 'electron'
import type {NativeImage,WebContents} from 'electron'
import {readScreenshotPhase} from '../packages/browser-capability/src/screenshot-read.js'

/** Screenshot evidence from the renderer; native View copies may have no surface
 * when another View covers them. This does not alter visibility, scroll or focus. */
export async function captureRendererEvidence(contents:WebContents):Promise<NativeImage>{
 const clip=await readScreenshotPhase<{x:number;y:number;width:number;height:number}>(contents,'evidence-layout',()=>contents.executeJavaScript('({x:Math.max(0,scrollX),y:Math.max(0,scrollY),width:innerWidth,height:innerHeight})'))
 if(![clip.x,clip.y,clip.width,clip.height].every(Number.isFinite)||clip.width<=0||clip.height<=0)throw new Error('Invalid evidence viewport')
 if(!contents.debugger.isAttached())contents.debugger.attach('1.3')
 const result=await readScreenshotPhase<{data:string}>(contents,'evidence-png',()=>contents.debugger.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{...clip,scale:1}}))
 const image=nativeImage.createFromBuffer(Buffer.from(result.data,'base64'))
 if(image.isEmpty())throw new Error('Empty renderer screenshot evidence')
 return image
}
