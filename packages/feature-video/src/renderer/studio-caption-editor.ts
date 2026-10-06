import {speechCaptionCues,usesSpeechCaptions} from '../studio-speech-contract.js'
import {estimatedCaptionCues} from '../../../media-native/src/composition-contract.js'
import type {CaptionStyle} from '../../../media-native/src/composition-contract.js'
import type {VideoDraft,StudioScene} from '../studio-contract.js'

type Context={draft:VideoDraft;scene:StudioScene;index:number;disabled:boolean}
const styleFields=['caption-font-size','caption-color','caption-background','caption-position','caption-align','caption-offset']
function element<T extends HTMLElement>(id:string):T{return document.getElementById(id) as T}
export class StudioCaptionEditor {
  constructor(private context:()=>Context|undefined,private edit:(update:(scene:StudioScene)=>void)=>Promise<void>,private pending:(id?:string)=>void,private pendingId:()=>string|undefined,private message:(text:string)=>void){
    for(const id of styleFields){const node=element<HTMLInputElement|HTMLSelectElement>(id);node.addEventListener('input',()=>this.pending(id));node.addEventListener('change',()=>{this.pending();const style=this.readStyle();this.run(()=>this.edit(scene=>{scene.captionStyle=style}))})}
    element<HTMLSelectElement>('caption-display').onchange=()=>this.run(()=>this.edit(scene=>{scene.captionDisplay=element<HTMLSelectElement>('caption-display').value as StudioScene['captionDisplay']}))
    element('caption-reset-style').onclick=()=>this.run(()=>this.edit(scene=>{delete scene.captionStyle}))
    element('caption-disable').onclick=()=>this.run(()=>this.edit(scene=>{scene.captions=[]}))
    element('caption-estimate').onclick=()=>this.run(()=>this.edit(scene=>{const {draft}=this.context()!;scene.captions=estimatedCaptionCues(scene,draft.width,draft.height,scene.audioDurationSeconds??scene.durationSeconds-1)}))
    element('caption-add').onclick=()=>this.run(()=>this.edit(scene=>{const cues=this.cues(scene),startSeconds=cues.at(-1)?.endSeconds??0;if(cues.length>=100||startSeconds>=scene.durationSeconds)throw new Error('请先为新增字幕留出时间区间（最多100条）。');scene.captions=[...cues,{startSeconds,endSeconds:Math.min(scene.durationSeconds,startSeconds+2),text:'新字幕'}]}))
  }
  private run(fn:()=>Promise<void>):void{void Promise.resolve().then(fn).catch(error=>this.message(error instanceof Error?error.message:String(error)))}
  private cues(scene:StudioScene):NonNullable<StudioScene['captions']>{const {draft}=this.context()!;return structuredClone(scene.captions??(usesSpeechCaptions(scene)?speechCaptionCues(scene):undefined)??estimatedCaptionCues(scene,draft.width,draft.height,scene.audioDurationSeconds??scene.durationSeconds-1))}
  private readStyle():CaptionStyle{return {fontSize:Number(element<HTMLInputElement>('caption-font-size').value),color:element<HTMLInputElement>('caption-color').value,background:element<HTMLSelectElement>('caption-background').value as CaptionStyle['background'],position:element<HTMLSelectElement>('caption-position').value as CaptionStyle['position'],align:element<HTMLSelectElement>('caption-align').value as CaptionStyle['align'],offsetPercent:Number(element<HTMLInputElement>('caption-offset').value)}}
  render():void{
    const context=this.context();if(!context)return
    const {draft,scene,index,disabled}=context
    element<HTMLSelectElement>('caption-display').value=scene.captionDisplay??'bilingual'
    element('caption-scene-title').textContent=`当前分镜 · ${index+1} ${scene.title}`
    element('caption-mode').textContent=scene.captions===undefined&&usesSpeechCaptions(scene)?'当前使用校正的音频句锚点（人工/Agent 编辑，未认定自动对齐达标）；独立编辑后保留独立字幕。':scene.captions===undefined?'当前使用按脚本与旁白长度估算的字幕。编辑任一条后，保存为独立字幕。':scene.captions.length?'当前使用独立字幕；修改内容不影响旁白。':'此分镜字幕已关闭。'
    for(const button of document.querySelectorAll('#caption-panel button,#caption-panel input,#caption-panel select,#caption-panel textarea') as (HTMLButtonElement|HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement)[])button.disabled=disabled
    if(this.pendingId()?.startsWith('caption-'))return
    const style:CaptionStyle=scene.captionStyle??{fontSize:720*draft.width/draft.height<600?22:28,color:draft.style==='clean-light'?'#172536':'#ffffff',background:'none',position:'bottom',align:'center',offsetPercent:0}
    for(const [id,value] of [['caption-font-size',style.fontSize],['caption-color',style.color],['caption-background',style.background],['caption-position',style.position],['caption-align',style.align],['caption-offset',style.offsetPercent]] as const)element<HTMLInputElement|HTMLSelectElement>(id).value=String(value)
    let visibleCues:NonNullable<StudioScene['captions']>=[];try{visibleCues=this.cues(scene)}catch(error){element('caption-mode').textContent=error instanceof Error?error.message:String(error)}
    element('caption-list').replaceChildren(...visibleCues.map((cue,cueIndex)=>{
      const row=document.createElement('div');row.className='caption-row';row.dataset.captionIndex=String(cueIndex)
      for(const [key,label] of [['startSeconds','开始秒'],['endSeconds','结束秒'],['text','原文'],['translationText','译文']] as const){
        const wrapper=document.createElement('label');wrapper.textContent=label;const isText=key==='text'||key==='translationText',node=isText?document.createElement('textarea'):document.createElement('input');node.id=`caption-${isText?key==='text'?'text':'translation':key==='startSeconds'?'start':'end'}-${cueIndex}`;node.value=String(cue[key]??'');node.disabled=disabled
        if(node instanceof HTMLInputElement){node.type='number';node.min='0';node.max=String(scene.durationSeconds);node.step='0.01'}else{node.rows=2;node.maxLength=200}
        node.addEventListener('input',()=>this.pending(node.id));node.addEventListener('change',()=>{this.pending();const value=isText?node.value:Number(node.value);this.run(()=>this.edit(scene=>{const cues=this.cues(scene);if(!cues[cueIndex])throw new Error('字幕已变化，请重新选择。');if(key==='text'||key==='translationText')cues[cueIndex][key]=String(value);else cues[cueIndex][key]=Number(value);scene.captions=cues}))});wrapper.append(node);row.append(wrapper)
      }
      const remove=document.createElement('button');remove.textContent='删除';remove.disabled=disabled;remove.onclick=()=>this.run(()=>this.edit(scene=>{const cues=this.cues(scene);cues.splice(cueIndex,1);scene.captions=cues}));row.append(remove);return row
    }))
  }
}
