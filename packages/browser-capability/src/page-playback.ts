import type {WebContents} from 'electron'
import {readRendererPhase} from './renderer-read.js'

/** Host-owned media lifecycle, including cross-origin player frames. No page is
 * resumed on activation. Native muting takes effect before renderer work. */
export class PagePlayback {
 private readonly pending=new WeakMap<WebContents,Promise<void>>()
 private readonly latest=new WeakMap<WebContents,number>()
 private sequence=0
 update(page:WebContents,allowed:boolean,forcePause=false,stayMuted=false):Promise<void>{
  if(page.isDestroyed())return Promise.resolve()
  page.setAudioMuted(true)
  const sequence=++this.sequence
  this.latest.set(page,sequence)
  const previous=this.pending.get(page)??Promise.resolve()
  const work=previous.catch(()=>{}).then(async()=>{
   if(page.isDestroyed()||!page.getURL())return
   const frames=page.mainFrame.framesInSubtree
   if(frames.length>128)throw new Error('Page playback frame budget exceeded; page remains muted.')
   await readRendererPhase(page,'page.playback','pause',async()=>{
    const results=await Promise.allSettled(frames.filter(frame=>!frame.isDestroyed()&&!frame.detached).map(async frame=>{const url=frame.url;try{await frame.executeJavaScript(`(()=>{
     const key='__bmwPlaybackPolicy',prior=globalThis[key];
     if(prior&&prior.sequence>${sequence})return;
     const state=prior||{sequence:0,allowed:false};state.sequence=${sequence};state.allowed=${allowed};
     if(!prior){globalThis[key]=state;document.addEventListener('play',event=>{if(!state.allowed&&event.target instanceof HTMLMediaElement)event.target.pause()},true)}
     if(!state.allowed||${forcePause})for(const media of document.querySelectorAll('audio,video'))media.pause();
    })()`,false)}catch(error){if(frame.isDestroyed()||frame.detached||frame.url!==url)return;throw error}}))
    const failure=results.find(result=>result.status==='rejected')
    if(failure?.status==='rejected')throw failure.reason
   },undefined,3000)
   if(allowed&&!page.isDestroyed()&&this.latest.get(page)===sequence)page.setAudioMuted(stayMuted)
  }).catch(error=>{if(!page.isDestroyed())page.setAudioMuted(true);throw error})
  this.pending.set(page,work)
  return work
 }
}
