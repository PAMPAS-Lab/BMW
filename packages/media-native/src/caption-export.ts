import {estimatedCaptionCues} from './composition-contract.js'
import type {CompositionScene} from './composition-contract.js'
export function captionDocument(scenes:readonly (CompositionScene&{audioDurationSeconds?:number})[],width:number,height:number,format:'srt'|'vtt'):{text:string;cueCount:number;timing:'edited'|'estimated'|'mixed'} {
  if(format!=='srt'&&format!=='vtt')throw new Error('Unsupported caption format.')
  let start=0,edited=false,estimated=false
  const cues:{start:number;end:number;text:string}[]=[]
  for(const scene of scenes){
    const local=scene.captions??estimatedCaptionCues(scene,width,height,scene.audioDurationSeconds??0)
    if(local.length){if(scene.captions)edited=true;else estimated=true}
    for(const cue of local){
      const text=cue.text.replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()).filter(Boolean).join('\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      if(!text)continue
      const begin=Math.round((start+cue.startSeconds)*1000),end=Math.round((start+cue.endSeconds)*1000)
      if(end<=begin)throw new Error('Caption is shorter than the export millisecond precision.')
      cues.push({start:begin,end,text})
    }
    start+=scene.durationSeconds
  }
  if(!cues.length)throw new Error('No enabled nonempty captions to export.')
  const timestamp=(ms:number)=>`${Math.floor(ms/3600000).toString().padStart(2,'0')}:${(Math.floor(ms/60000)%60).toString().padStart(2,'0')}`+`:${(Math.floor(ms/1000)%60).toString().padStart(2,'0')}${format==='srt'?',':'.'}${(ms%1000).toString().padStart(3,'0')}`
  return {text:(format==='vtt'?'WEBVTT\n\n':'')+cues.map((cue,index)=>`${format==='srt'?index+1+'\n':''}${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join('\n'),cueCount:cues.length,timing:edited&&estimated?'mixed':estimated?'estimated':'edited'}
}
