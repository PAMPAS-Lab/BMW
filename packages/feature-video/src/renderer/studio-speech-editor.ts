import {sceneCoverage} from '../studio-contract.js'
import {assertSentenceAnchors,scriptSentences,speechBindingStale} from '../studio-speech-contract.js'
import type {SentenceAnchor} from '../studio-speech-contract.js'
import {mediaRecord} from '../../../media-native/src/media-contract.js'
import type {StudioScene,VideoDraft} from '../studio-contract.js'
type Context={projectId:string;draft:VideoDraft;scene:StudioScene;disabled:boolean}
/** Explicit listening/correction. Empty times stay empty; ASR probabilities are not timing accuracy. */
export class StudioSpeechEditor {
 private key='';private dirty=false;private saving?:Promise<void>;private audio?:HTMLAudioElement;private url?:string;private audioId=''
 private details?:HTMLDetailsElement;private rows?:HTMLElement;private note?:HTMLElement;private evidence?:HTMLElement;private scope?:{projectId:string;draftId:string;sceneId:string;script:string;audioArtifactId?:string;revision:number}
 constructor(private root:HTMLElement,private context:()=>Context|undefined,private command:(request:Record<string,unknown>,scope:{projectId:string;draftId:string;sceneId:string;script:string;audioArtifactId?:string;revision:number})=>Promise<unknown>,private load:(id:string)=>Promise<Uint8Array>,private captions:(enabled:boolean)=>Promise<void>,private message:(text:string)=>void){}
 private run(fn:()=>Promise<void>|void):void{void Promise.resolve().then(fn).catch(error=>this.message(error instanceof Error?error.message:String(error)))}
 private button(label:string,fn:()=>Promise<void>|void){const node=document.createElement('button');node.textContent=label;node.onclick=()=>this.run(fn);return node}
 private status(text:string){if(this.note)this.note.textContent=text;this.message(text)}
 clear():void{this.audio?.pause();if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;this.audio=undefined;this.audioId='';this.key='';this.dirty=false;this.scope=undefined;this.root.replaceChildren()}
 async flush():Promise<void>{if(this.saving)return this.saving;if(this.dirty)await this.save()}
 private async listen(seconds?:number):Promise<void>{const context=this.context(),scope=this.scope;if(!context||!scope||!scope.audioArtifactId)throw new Error('先生成或绑定旁白。')
  if(!this.audio||this.audioId!==scope.audioArtifactId){const bytes=await this.load(scope.audioArtifactId);const current=this.context();if(!current||current.projectId!==scope.projectId||current.draft.id!==scope.draftId||current.scene.id!==scope.sceneId||current.scene.audioArtifactId!==scope.audioArtifactId)throw new Error('句锚点所属分镜已切换。');if(this.url)URL.revokeObjectURL(this.url);this.url=URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));this.audio=new Audio(this.url);this.audio.controls=true;this.audio.preload='metadata';this.audioId=scope.audioArtifactId;this.root.querySelector('[data-speech-player]')!.replaceChildren(this.audio);await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('旁白解码超时。')),8000);this.audio!.onloadedmetadata=()=>{clearTimeout(timer);resolve()};this.audio!.onerror=()=>{clearTimeout(timer);reject(new Error('旁白无法试听。'))}})}
  if(seconds!==undefined)this.audio.currentTime=seconds;await this.audio.play()
 }
 private values():SentenceAnchor[]{const context=this.context();if(!context||!this.rows)throw new Error('请先选择分镜。');const result:SentenceAnchor[]=[]
  for(const row of this.rows.querySelectorAll<HTMLElement>('[data-sentence-id]')){const inputs=row.querySelectorAll<HTMLInputElement>('input');if(!inputs[0].value.trim()||!inputs[1].value.trim())throw new Error('请试听并填写每句开始、结束秒数，或删除不需要的句锚点。');result.push({id:row.dataset.sentenceId!,scriptStart:Number(row.dataset.scriptStart),scriptEnd:Number(row.dataset.scriptEnd),startSeconds:Number(inputs[0].value),endSeconds:Number(inputs[1].value)})}
  return assertSentenceAnchors(result,context.scene.narration,context.scene.audioDurationSeconds??180)
 }
 private async save():Promise<void>{if(this.saving)return this.saving;const scope=this.scope;if(!scope)throw new Error('句锚点所属分镜已切换。');const anchors=this.values()
  const pending=(async()=>{await this.command({operation:'correct-speech',anchors},scope);this.dirty=false;this.key='';this.render();this.status('句锚点已保存，时间来源为本次编辑；未认定自动对齐已达标。')})()
  this.saving=pending;try{await pending}finally{this.saving=undefined}
 }
 private showEvidence(raw:unknown):void{const result=mediaRecord(raw),segments=Array.isArray(result.segments)?result.segments:Array.isArray(mediaRecord(result.evidence??{}).segments)?mediaRecord(result.evidence).segments as unknown[]:[];if(!this.evidence)return;this.evidence.replaceChildren()
  const note=document.createElement('p');note.textContent=result.stale?'此候选已过期，仅供回溯，不能应用。':'原始识别片段（可合并多句）；概率不是边界精度，自动句/词同步尚未通过验收。';this.evidence.append(note)
  for(const raw of segments){const s=mediaRecord(raw),row=document.createElement('p');row.textContent=`${Number(s.startSeconds).toFixed(2)}–${Number(s.endSeconds).toFixed(2)}s · ${s.text} · token 概率 ${s.tokenMeanProbability===null?'未知':Number(s.tokenMeanProbability).toFixed(2)} · ${(Array.isArray(s.warnings)?s.warnings:[]).join(' / ')||'无结构警告'}`;this.evidence.append(row)}
 }
 render():void{const context=this.context();if(!context){this.clear();return}const {scene,draft}=context,key=JSON.stringify([context.projectId,draft.id,scene.id,scene.narration,scene.audioArtifactId,scene.speechCandidate,scene.speechAnchors,scene.speechCaptions])
  if(this.dirty&&this.scope&&(this.scope.projectId!==context.projectId||this.scope.draftId!==draft.id||this.scope.sceneId!==scene.id))return
  if(this.key===key||this.dirty){if(!this.dirty&&this.scope)this.scope.revision=draft.revision;for(const node of this.root.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select'))node.disabled=context.disabled;return}
  const wasOpen=this.details?.open??false;if(this.audioId!==scene.audioArtifactId||this.scope&&(this.scope.projectId!==context.projectId||this.scope.draftId!==draft.id||this.scope.sceneId!==scene.id))this.clear();this.key=key;this.scope={projectId:context.projectId,draftId:draft.id,sceneId:scene.id,script:scene.narration,audioArtifactId:scene.audioArtifactId,revision:draft.revision}
  this.root.replaceChildren();this.details=document.createElement('details');this.details.className='speech-editor advanced';this.details.open=wasOpen;const summary=document.createElement('summary');summary.textContent='语音句锚点 · 识别证据与校正';this.details.append(summary);this.root.append(this.details)
  this.note=document.createElement('p');this.note.className='muted';const binding=scene.speechAnchors;this.note.textContent=binding?`${speechBindingStale(scene,binding)||sceneCoverage(scene,draft.tts).audioStale?'校正已过期':'已保存句锚点'} · ${binding.origin==='user-edited'?'用户编辑':'Agent 编辑'} · 音频文件秒数；旁白在分镜 .5s 开始。`:'先试听，再填写句边界；空白时间不会被估算值代替。';this.details.append(this.note)
  const controls=document.createElement('div');controls.className='row';const model=document.createElement('select');model.setAttribute('aria-label','语音证据模型');model.append(new Option('small · 固定模型','small'),new Option('base · 固定模型','base'))
  controls.append(model,this.button('识别此段（保留校正）',async()=>{await this.flush();const result=await this.command({operation:'align-speech',speechModel:model.value},this.scope!);this.showEvidence(result);this.status('已保存原始语音证据，已有校正保留；仍需试听核对。')}),this.button('查看已有识别证据',async()=>{await this.flush();this.showEvidence(await this.command({operation:'read-speech'},this.scope!))}),this.button('试听 / 继续',()=>this.listen()));this.details.append(controls)
  const player=document.createElement('div');player.dataset.speechPlayer='';if(this.audio)player.append(this.audio);this.details.append(player)
  this.rows=document.createElement('div');this.details.append(this.rows)
  const current=binding&&!speechBindingStale(scene,binding)?binding.anchors:[]
  for(const sentence of scriptSentences(scene.narration)){const anchor=current.find(a=>a.scriptStart===sentence.scriptStart&&a.scriptEnd===sentence.scriptEnd);this.addRow(sentence,anchor)}
  if(current.some(a=>!scriptSentences(scene.narration).some(s=>s.scriptStart===a.scriptStart&&s.scriptEnd===a.scriptEnd))){this.rows.replaceChildren();for(const a of current)this.addRow({id:a.id,scriptStart:a.scriptStart,scriptEnd:a.scriptEnd,text:scene.narration.slice(a.scriptStart,a.scriptEnd)},a)}
  const actions=document.createElement('div');actions.className='row';actions.append(this.button('保存句锚点',()=>this.save()),this.button('恢复已保存校正',()=>{this.dirty=false;this.key='';this.render()}));this.details.append(actions)
  const caption=document.createElement('label');caption.className='checkbox';const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=Boolean(scene.speechCaptions);toggle.onchange=()=>this.run(async()=>{await this.flush();await this.captions(toggle.checked)});caption.append(toggle,'字幕使用句锚点（已有独立字幕优先保留）');this.details.append(caption)
  const explain=document.createElement('p');explain.className='muted';explain.textContent='脚本或音频变化后，旧锚点仅保留回溯。此处的校正不是十段音频验收的人工作为参照的标注。';this.details.append(explain)
  const evidenceDetails=document.createElement('details'),evidenceSummary=document.createElement('summary');evidenceSummary.textContent='原始识别片段与警告';this.evidence=document.createElement('div');evidenceDetails.append(evidenceSummary,this.evidence);this.details.append(evidenceDetails)
  for(const node of this.root.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select'))node.disabled=context.disabled
 }
 private addRow(sentence:{id:string;scriptStart:number;scriptEnd:number;text:string},anchor?:SentenceAnchor):void{const row=document.createElement('div');row.className='speech-row';row.dataset.sentenceId=anchor?.id??sentence.id;row.dataset.scriptStart=String(sentence.scriptStart);row.dataset.scriptEnd=String(sentence.scriptEnd);const text=document.createElement('p');text.textContent=sentence.text;row.append(text)
  for(const [key,label] of [['startSeconds','音频开始秒'],['endSeconds','音频结束秒']] as const){const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('input');input.type='number';input.min='0';input.max=String(this.context()?.scene.audioDurationSeconds??180);input.step='.01';input.value=anchor?String(anchor[key]):'';input.setAttribute('aria-label',label+' '+sentence.text);input.oninput=()=>{this.dirty=true};wrapper.append(input,this.button('取试听时间',()=>{if(!this.audio||!Number.isFinite(this.audio.duration))throw new Error('请先打开试听音频。');input.value=this.audio.currentTime.toFixed(2);this.dirty=true}));row.append(wrapper)}
  row.append(this.button('从此句开始试听',()=>{const start=row.querySelector('input')!.value;if(!start)throw new Error('先填写开始时间。');return this.listen(Number(start))}),this.button('删除此锚点',()=>{row.remove();this.dirty=true}));this.rows!.append(row)
 }
}
