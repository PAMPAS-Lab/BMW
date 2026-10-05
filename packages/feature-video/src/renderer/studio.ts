import {StudioSpeechLinksEditor} from './studio-speech-links-editor.js'
import {StudioSpeechEditor} from './studio-speech-editor.js'
import {StudioSourceEditor} from './studio-source-editor.js'
import type {SourceCitation} from '../../../media-native/src/source-contract.js'
import {assertFocusIntervals} from '../../../media-native/src/focus-contract.js'
import {StudioWorkbench} from './studio-workbench.js'
import type {InspectorMode} from './studio-workbench.js'
import {studioSceneIndex} from '../studio-timeline.js'
import {StudioCoverEditor} from './studio-cover-editor.js'
import {StudioVisualEditor} from './studio-visual-editor.js'
import {sceneVisuals,fitVisualSegments} from '../../../media-native/src/visual-segments.js'
import {VideoOptionsForm} from '../../../media-native/src/video-options-form.js'
import {normalizeVideoPreferences,optionsFromOutput} from '../../../media-native/src/video-options.js'
import {assertVideoDraft,audioGenerationLabel,sceneCoverage,draftReadiness,newStudioScene} from '../studio-contract.js'
import {StudioCaptionEditor} from './studio-caption-editor.js'
import type {VideoDraft,StudioScene,StudioState,StudioAsset,StudioReadiness} from '../studio-contract.js'
import {mediaRecord} from '../../../media-native/src/media-contract.js'
import {StudioPreview} from './studio-preview.js'
import {StudioMaterialsView} from './studio-materials-view.js'
const api=window.bmwStudio
function element<T extends HTMLElement>(id:string):T{const result=document.getElementById(id);if(!result)throw new Error('Missing Studio element '+id);return result as T}
const input=(id:string)=>element<HTMLInputElement>(id),area=(id:string)=>element<HTMLTextAreaElement>(id),select=(id:string)=>element<HTMLSelectElement>(id)
const outputForm=new VideoOptionsForm(element('studio-output-options'),'studio-output')
const status=element('status'),sceneList=element('scene-list'),stageContent=element('stage-content')
let state:StudioState,draft:VideoDraft|undefined,sceneIndex=0,stage=4,dirty=false,busy=false,invalidProject=false,previewDirty=true
let checked:StudioReadiness|undefined
let undo:VideoDraft[]=[],redo:VideoDraft[]=[],urls:string[]=[],exportURLs:string[]=[];let exportGeneration=0
let previewPreparation:Promise<void>|undefined,sceneSelection=0,previewPreparing=false
let currentOperation:string|undefined
const workbench=new StudioWorkbench()
const clone=<T>(value:T):T=>structuredClone(value)
function message(value:string):void{status.textContent=value}
function guarded(fn:()=>Promise<void>|void):()=>void{return ()=>{void Promise.resolve().then(fn).catch(error=>message(error instanceof Error?error.message:String(error)))}}
function scene():StudioScene{const value=draft?.scenes[sceneIndex];if(!value)throw new Error('请先在「脚本与旁白」创建分镜。');return value}
function editable():void{if(invalidProject)throw new Error('Project 已切换。请关闭此页，从当前 Project 重新打开。');if(busy||savePending)throw new Error('正在处理，请等待或取消。')}
function history():void{editable();if(!draft)return;undo.push(clone(draft));undo=undo.slice(-40);redo=[];dirty=true;previewDirty=true}
function format(time:number):string{return `${Math.floor(time/60).toString().padStart(2,'0')}:${Math.floor(time%60).toString().padStart(2,'0')}`}
async function bytes(id:string):Promise<Uint8Array>{const projectId=state.project.id;const asset=state.assets.find(asset=>asset.artifactId===id);if(!asset||asset.bytes>256*1024*1024)throw new Error('Asset is unavailable or too large for preview.');const result=new Uint8Array(asset.bytes);for(let offset=0;offset<result.length;offset+=1024*1024){if(invalidProject||state.project.id!==projectId)throw new Error('Project 已切换，预览已取消。');result.set(await api.read(projectId,id,offset,Math.min(1024*1024,result.length-offset)),offset)}return result}
const preview=new StudioPreview(element<HTMLCanvasElement>('preview'),bytes,(time,playing)=>{input('seek').value=String(time);element('time').textContent=`${format(time)} / ${format(preview.duration)}`;element('play').textContent=playing?'暂停':'播放';workbench.time(time);if(draft&&stage===4&&workbench.mode!=='cover'&&!previewPreparing&&!busy&&!savePending&&!pendingField&&!dirty){const next=studioSceneIndex(draft,time);if(next>=0&&next!==sceneIndex){sceneIndex=next;render()}}})
const materials=new StudioMaterialsView(()=>state&&draft?{state,draft,sceneId:draft.scenes[sceneIndex]?.id,stage,disabled:busy||invalidProject||Boolean(savePending)}:undefined,(project,id,offset,length)=>api.read(project,id,offset,length),attachAsset,collectAsset,message,()=>{guarded(async()=>{await flushEdits();renderStage()})()})
const sourceEditor=new StudioSourceEditor(element('studio-source-editor'),()=>state&&draft&&!invalidProject?{projectId:state.project.id,disabled:busy||Boolean(savePending),sourceIds:draft.preparation.sourceIds??[],scenes:draft.scenes,sceneId:draft.scenes[sceneIndex]?.id}:undefined,async request=>{await flushEdits();const result=await command({operation:'source',sourceRequest:request});if(request.operation==='acquire')await refresh();return result},async(id,selected)=>{await flushEdits();editable();if(!draft)return;history();const ids=draft.preparation.sourceIds??[];draft.preparation.sourceIds=selected?[...new Set([...ids,id])]:ids.filter(value=>value!==id);render();await save(false)},async(sceneId,citation:SourceCitation)=>{await flushEdits();editable();if(!draft)return;const target=draft.scenes.find(scene=>scene.id===sceneId);if(!target)throw new Error('选择一个当前草稿的分镜。');if((target.citations?.length??0)>=12)throw new Error('每个分镜最多十二条引用。');history();target.citations=[...(target.citations??[]),citation];draft.preparation.sourceIds=[...new Set([...(draft.preparation.sourceIds??[]),citation.sourceId])];render();await save(false)},async artifactId=>{const asset=state.assets.find(asset=>asset.artifactId===artifactId);if(!asset)throw new Error('来源素材已失效，请重新获取。');await materials.open(asset,undefined,true)},message)
const visualEditor=new StudioVisualEditor(()=>draft?.scenes[sceneIndex]?{scene:scene(),assets:state.assets,disabled:busy||invalidProject||Boolean(savePending)}:undefined,alterScene,(asset,id,index)=>attachAsset(asset,id,index),message,async index=>{
  await flushEdits();editable();if(!draft)throw new Error('请先选择草稿。');const project=state.project.id,id=draft.id,revision=draft.revision,sceneId=scene().id
  const result=mediaRecord(await command({operation:'suggest-focus',draftId:id,expectedRevision:revision,sceneId,...(index===undefined?{}:{segmentIndex:index})}))
  if(invalidProject||project!==state.project.id||id!==draft?.id||revision!==draft.revision||sceneId!==scene().id)throw new Error('当前草稿已切换。')
  return assertFocusIntervals(result.focusIntervals)
},id=>{pendingField=id})
const captions=new StudioCaptionEditor(()=>draft?.scenes[sceneIndex]?{draft,scene:scene(),index:sceneIndex,disabled:busy||invalidProject||Boolean(savePending)}:undefined,alterScene,id=>{pendingField=id},()=>pendingField,message)
const speechEditor=new StudioSpeechEditor(element('studio-speech-editor'),()=>draft?.scenes[sceneIndex]?{projectId:state.project.id,draft,scene:scene(),disabled:busy||invalidProject||Boolean(savePending)}:undefined,async(request,scope)=>{
  if(!draft||draft.revision!==scope.revision)throw new Error('STUDIO_CONFLICT: 草稿版本已变化，请重新加载句锚点。')
  await flushEdits(false);editable();if(!draft||invalidProject||state.project.id!==scope.projectId||draft.id!==scope.draftId||scene().id!==scope.sceneId||scene().narration!==scope.script||scene().audioArtifactId!==scope.audioArtifactId)throw new Error('句锚点所属脚本、音频或分镜已变化，请重新加载后校正。')
  // Use the captured revision; an external correction must conflict, not be adopted silently.
  const result=mediaRecord(await command({...request,draftId:draft.id,expectedRevision:draft.revision,sceneId:scope.sceneId}))
  if(result.draft){draft=assertVideoDraft(result.draft);dirty=false;previewDirty=true;undo=[];redo=[];await refresh();render()}
  return result
},bytes,enabled=>alterScene(value=>{value.speechCaptions=enabled}),message)
const speechLinksEditor=new StudioSpeechLinksEditor(element('studio-speech-links'),()=>draft?.scenes[sceneIndex]?{projectId:state.project.id,draft,scene:scene(),disabled:busy||invalidProject||Boolean(savePending)}:undefined,alterScene,message,id=>{pendingField=id})
const coverEditor=new StudioCoverEditor(()=>state&&draft?{projectId:state.project.id,draft,assets:state.assets,disabled:busy||invalidProject||Boolean(savePending)}:undefined,id=>{pendingField=id},()=>pendingField,async options=>{history();draft!.cover=options;renderStage();await save(false)},()=>operation('export-cover'),bytes,message)
async function prepare():Promise<void>{
  if(previewPreparation)await previewPreparation
  if(!draft||!previewDirty)return
  if(!draft.scenes.length)throw new Error('请先创建分镜，再预览视频。')
  const current=draft;previewPreparing=true
  for(const id of ['play','seek'])element<HTMLButtonElement>(id).disabled=true
  const pending=(async()=>{message('正在准备预览…');await preview.prepare(clone(current));if(draft!==current)return;previewDirty=false;input('seek').max=String(preview.duration);element('preview-empty').hidden=true;message(dirty?'有未保存修改':'草稿已保存')})()
  previewPreparation=pending
  try{await pending}finally{if(previewPreparation===pending)previewPreparation=undefined;previewPreparing=false;renderStage();for(const id of ['play','seek'])element<HTMLButtonElement>(id).disabled=busy||invalidProject||Boolean(savePending)||Boolean(previewPreparation)||!draft?.scenes.length}
}
async function selectScene(index:number):Promise<void>{
  const selection=++sceneSelection;await flushEdits();editable();if(selection!==sceneSelection||!draft||!draft.scenes[index])return
  const current=draft
  sceneIndex=index;if(stage===0)stage=3;if(stage===4&&['cover','delivery'].includes(workbench.mode))workbench.mode='visual';render()
  if(stage!==4||workbench.mode==='cover')return
  await prepare()
  if(selection!==sceneSelection||draft!==current||invalidProject)return
  await preview.seek(current.scenes.slice(0,index).reduce((sum,item)=>sum+item.durationSeconds,0))
}
function choose(value:VideoDraft|undefined):void{speechEditor.clear();coverEditor.clear();clearExport();element('studio-subtitle-exports').replaceChildren();sceneSelection++;const selectedId=draft?.id===value?.id?draft?.scenes[sceneIndex]?.id:undefined;draft=value?clone(value):undefined;sceneIndex=Math.max(0,draft?.scenes.findIndex(scene=>scene.id===selectedId)??0);if(draft&&!draft.scenes.length&&stage===4)stage=0;dirty=false;undo=[];redo=[];previewDirty=true;void preview.dispose();render()}
async function refresh(preserve=true):Promise<void>{const raw=mediaRecord(await api.state());state={sessionId:typeof raw.sessionId==='string'?raw.sessionId:undefined,project:mediaRecord(raw.project) as unknown as StudioState['project'],drafts:(raw.drafts as unknown[]).map(assertVideoDraft),assets:raw.assets as StudioAsset[],theme:raw.theme as StudioState['theme'],videoPreferences:normalizeVideoPreferences(raw.videoPreferences??{}),reusableExports:mediaRecord(raw.reusableExports??{}) as Record<string,string>};renderOutputTemplates();document.body.classList.toggle('dark',state.theme==='dark');element('project-name').textContent=state.project.name
  if(!preserve||!draft)choose(state.drafts.find(item=>item.id===draft?.id)??state.drafts[0]);else{renderSelect();renderStage()}
}
async function publishSelection():Promise<void>{if(invalidProject)return;if(!draft){await api.selection(null);return}const sceneId=stage===0?undefined:draft.scenes[sceneIndex]?.id;if(sceneId&&dirty&&!state.drafts.find(item=>item.id===draft.id)?.scenes.some(item=>item.id===sceneId))return;await api.selection({draftId:draft.id,...(sceneId?{sceneId}:{}),stage,revision:draft.revision,dirty}).catch(error=>message(String(error)))}
async function openInspector(mode:InspectorMode):Promise<void>{
  await flushEdits();editable();const time=Number(input('seek').value);preview.pause();stage=4;workbench.mode=mode;renderStage();void publishSelection()
  if(mode==='cover')await coverEditor.preview()
  else if(mode==='delivery'){const latest=draft?.exports.at(-1);if(latest)await showExport(latest.artifactId,latest.verificationArtifactId)}
  else if(draft?.scenes.length){await prepare();await preview.seek(time)}
}
async function seekTo(seconds:number,mode?:InspectorMode):Promise<void>{
  await flushEdits();editable();if(!draft?.scenes.length)return
  stage=4;if(mode)workbench.mode=mode;else if(workbench.mode==='cover')workbench.mode='visual'
  renderStage();await prepare();await preview.seek(seconds)
}
function renderWorkbenchAssets():void{
  const list=element('workbench-asset-list');list.replaceChildren();if(stage!==4||!draft)return
  const ids=new Set([...draft.preparation.artifactIds,...draft.scenes.flatMap(value=>[...sceneVisuals(value).flatMap(visual=>[visual.imageArtifactId,visual.videoArtifactId]),value.audioArtifactId])])
  materials.renderPicker(list,state.assets.filter(asset=>ids.has(asset.artifactId)),undefined)
}
function renderDeliveryHistory():void{
  const list=element('delivery-history');list.replaceChildren();if(!draft)return
  for(const output of [...draft.exports].reverse()){const node=button(`${state.reusableExports?.[draft.id]===output.artifactId?'当前可复用 · ':''}v${output.revision} · ${output.artifactId}`,()=>showExport(output.artifactId,output.verificationArtifactId));node.className='delivery-record';list.append(node)}
  if(!list.childElementCount)list.append(paragraph('尚无成片；封面可以独立制作。'))
}
function renderSelect():void{select('draft-select').replaceChildren(...state.drafts.map(value=>{const option=document.createElement('option');option.value=value.id;option.textContent=value.title;option.selected=value.id===draft?.id;return option}))}
function renderOutputTemplates():void{const presets=select('studio-output-template'),selected=presets.value;presets.replaceChildren(new Option('当前视频参数',''),...(state.videoPreferences?.templates??[]).map(item=>new Option(item.name,item.name)));presets.value=selected}
function render():void{
  renderSelect();sceneList.replaceChildren();if(!draft){input('draft-title').value='';renderStage();stageContent.replaceChildren();void publishSelection();return}
  outputForm.fill(optionsFromOutput(draft));element('studio-output-current').textContent=`当前 ${draft.width} × ${draft.height} · ${draft.fps} fps${draft.templateName?' · '+draft.templateName:''}`
  renderOutputTemplates();select('studio-output-template').value=''
  const canvas=element<HTMLCanvasElement>('preview');canvas.style.aspectRatio=String(draft.width/draft.height)
  draft.scenes.forEach((value,index)=>{const button=document.createElement('button');button.className='scene'+(index===sceneIndex?' selected':'');const title=document.createElement('div');title.textContent=`${String(index+1).padStart(2,'0')}  ${value.title}`;const detail=document.createElement('span');const coverage=sceneCoverage(value,draft?.tts);detail.textContent=`${value.durationSeconds.toFixed(1)}s · ${coverage.audioStale?'旁白待制作':value.audioArtifactId?'旁白已就绪':'无旁白'}${value.videoArtifactId&&coverage.gap>.05?' · 缺画面':''}`;button.append(title,detail);button.onclick=guarded(()=>selectScene(index));materials.bindDrop(button,value.id);sceneList.append(button)
  })
  input('music').checked=draft.music;input('draft-title').value=draft.title;if(!draft.scenes.length){renderStage();message(dirty?'有未保存修改':`已保存 · v${draft.revision}`);void publishSelection();return}
  const value=scene();input('scene-title').value=value.title;input('scene-label').value=value.label;area('narration').value=value.narration;area('visual-brief').value=value.visualBrief;area('sources').value=value.sources.join('\n');area('bullets').value=value.bullets.join('\n');input('duration').value=String(value.durationSeconds);input('source-start').value=String(value.sourceStartSeconds);input('rate').value=String(value.playbackRate);input('gain').value=String(value.voiceVolume??1);select('end-policy').value=value.endPolicy;select('layout').value=value.layout??'presentation';for(const id of ['source-start','rate','crop-x','crop-y','crop-width','crop-height'])input(id).disabled=busy||Boolean(savePending)||Boolean(value.visualSegments)
  const crop=value.crop??{x:0,y:0,width:1,height:1};for(const key of ['x','y','width','height'] as const)input('crop-'+key).value=String(crop[key]);area('captions').value=value.captions?.map(cue=>`${cue.startSeconds} | ${cue.endSeconds} | ${cue.text}`).join('\n')??''
  element('scene-citations').replaceChildren(...(value.citations??[]).map((citation,index)=>{const row=document.createElement('div'),text=document.createElement('p');text.textContent=(citation.kind==='fact'?'事实引用 · 待核查':'作者观点')+' · '+(citation.conflict==='conflicting'?'存在冲突':'待确认')+'：'+citation.claim+' · '+citation.quote;row.append(text,button('移除此引用',async()=>{await flushEdits();history();scene().citations?.splice(index,1);render();await save(false)}));return row}))
  const coverage=sceneCoverage(value,draft?.tts);element('coverage').textContent=`旁白 ${value.audioDurationSeconds?.toFixed(1)??'—'}s · 分镜 ${value.durationSeconds.toFixed(1)}s${value.videoArtifactId?` · 可用画面 ${coverage.available.toFixed(1)}s · 缺口 ${coverage.gap.toFixed(1)}s`:''}${coverage.audioStale?'\n脚本或音色/语速待生成旁白；已有音频不会自动更新。':''}`
  element<HTMLButtonElement>('undo').disabled=!undo.length||busy||Boolean(savePending);element<HTMLButtonElement>('redo').disabled=!redo.length||busy||Boolean(savePending);renderStage();message(dirty?'有未保存修改':`已保存 · v${draft.revision}`);void publishSelection()
}
function button(text:string,fn:()=>Promise<void>|void):HTMLButtonElement{const value=document.createElement('button');value.textContent=text;value.disabled=busy||invalidProject||Boolean(savePending);value.onclick=guarded(fn);return value}
function paragraph(text:string):HTMLElement{const value=document.createElement('p');value.textContent=text;return value}

function renderScript():void{
  if(!draft)return
  const disabled=busy||invalidProject||Boolean(savePending),current=draft.scenes[sceneIndex]
  element('script-overview-title').textContent=`全片脚本与旁白 · ${draft.scenes.length} 个分镜`
  element('script-outline').replaceChildren()
  if(!draft.scenes.length){element('script-outline').append(paragraph('素材已准备。现在可以新增分镜，逐段编写脚本并制作对应旁白。'),button('创建第一个分镜',addScene))}
  let start=0
  for(const [index,value] of draft.scenes.entries()){
    const end=start+value.durationSeconds,node=document.createElement('article');node.className='script-scene'+(index===sceneIndex?' selected':'');node.dataset.scriptScene=value.id
    node.onclick=event=>{if((event.target as HTMLElement).closest('button'))return;guarded(()=>selectScene(index))()}
    const choose=button('',()=>selectScene(index));choose.className='script-select';choose.setAttribute('aria-pressed',String(index===sceneIndex))
    const title=document.createElement('strong');title.textContent=`${String(index+1).padStart(2,'0')} ${value.title}`
    const timing=document.createElement('small');timing.textContent=`${format(start)}–${format(end)} · ${value.durationSeconds.toFixed(1)}s`
    const text=document.createElement('span');text.textContent=value.narration||'此分镜尚未填写脚本';choose.append(title,timing,text);node.append(choose)
    const voice=document.createElement('div');voice.className='script-voice';voice.dataset.audioScene=value.id
    const status=document.createElement('p');status.className='muted';status.textContent=value.audioArtifactId?`${sceneCoverage(value,draft?.tts).audioStale?'旁白已过期':'旁白已就绪'} · ${value.audioDurationSeconds?.toFixed(1)??'—'}s`:'此段尚未生成旁白'
    voice.append(status);if(value.audioArtifactId)voice.append(button('试听',()=>listenScene(value.id)))
    const generate=button(value.audioArtifactId?'重新生成旁白':'生成旁白',()=>narrateScene(value.id));generate.className='script-generate';generate.disabled=disabled||!value.narration.trim();voice.append(generate);node.append(voice);element('script-outline').append(node);start=end
  }
  element('script-current').closest('.script-editor')!.toggleAttribute('hidden',!current)
  if(!current)return
  element('script-current-title').textContent=`当前分镜 · ${sceneIndex+1} / ${draft.scenes.length} ${current.title}`
  if(pendingField!=='script-current'&&pendingField!=='narration')area('script-current').value=current.narration
  area('script-current').disabled=disabled;element<HTMLButtonElement>('script-save').disabled=disabled
  element('script-current-note').textContent=sceneCoverage(current,draft?.tts).audioStale?'脚本或音色/语速已变更，已有旁白已过期；点击「生成/重新生成旁白」只更新此段。':'修改脚本后自动保存，只有此段旁白需要重新生成。字幕内容在编辑与预览中单独修改。'
  element('script-audio-status').textContent=`${current.audioArtifactId?(sceneCoverage(current,draft?.tts).audioStale?'已有音频待重做':'旁白已就绪'):'尚未生成'} · ${current.audioDurationSeconds?.toFixed(1)??'—'}s · ${audioGenerationLabel(current)}`
  element('script-narrate').textContent=current.audioArtifactId?'重新生成此段旁白':'生成此段旁白';element<HTMLButtonElement>('script-narrate').disabled=disabled||!current.narration.trim()
  element<HTMLButtonElement>('script-listen').disabled=disabled||!current.audioArtifactId
  element<HTMLButtonElement>('script-remove-voice').disabled=disabled||!current.audioArtifactId&&!current.narration
  const raw=select('script-raw-audio');raw.replaceChildren(new Option('选择原始音频',''),...state.assets.filter(asset=>asset.kind==='audio'&&draft!.preparation.artifactIds.includes(asset.artifactId)).map(asset=>new Option(asset.artifactId,asset.artifactId)))
  if(state.assets.some(asset=>asset.artifactId===current.audioArtifactId&&draft!.preparation.artifactIds.includes(asset.artifactId)))raw.value=current.audioArtifactId!
  raw.disabled=disabled;element<HTMLButtonElement>('script-bind-audio').disabled=disabled
}
function renderStage():void{
  sourceEditor.render();element<HTMLButtonElement>('studio-export-citations').disabled=busy||invalidProject||Boolean(savePending)||!draft
  const hasScene=Boolean(draft?.scenes.length),disabled=busy||invalidProject||Boolean(savePending)
  element('empty-workspace').hidden=Boolean(draft)
  element('empty-workspace').querySelector('p')!.textContent=state?.sessionId?'点击「新视频」开始制作。视频草稿将绑定到当前对话。':'请先选择一个对话，再创建视频草稿。'
  for(const id of ['new-draft','empty-create'])element<HTMLButtonElement>(id).disabled=disabled||!state?.sessionId
  for(const id of ['draft-title','draft-select','delete-draft','save','settings-open','delivery-open','add-scene','duplicate','remove-scene','move-up','move-down'])element<HTMLButtonElement>(id).disabled=disabled||!draft
  document.querySelectorAll('[data-stage]').forEach(item=>{(item as HTMLButtonElement).disabled=disabled||!draft})
  input('scene-number').checked=!hasScene||scene().showSceneNumber!==false;input('scene-number').disabled=disabled||!hasScene
  if(hasScene)for(const id of ['source-start','rate','crop-x','crop-y','crop-width','crop-height'])input(id).disabled=disabled||Boolean(scene().visualSegments)
  if(stage>=3&&hasScene){input('keep-source-audio').checked=Boolean(scene().keepSourceAudio);input('source-volume').value=String(scene().sourceVolume??1);input('keep-source-audio').disabled=disabled||!scene().videoArtifactId;input('source-volume').disabled=disabled||!scene().videoArtifactId}
  document.querySelectorAll('[data-stage]').forEach(item=>{item.classList.toggle('active',Number((item as HTMLElement).dataset.stage)===stage);item.setAttribute('aria-pressed',String(Number((item as HTMLElement).dataset.stage)===stage))})
  element<HTMLButtonElement>('studio-cover-open').disabled=disabled||!draft
  coverEditor.render()
  element('scene-navigation').hidden=!draft||stage===0&&!hasScene
  element('preparation-workspace').hidden=!draft||stage!==0;element('script-workspace').hidden=!draft||stage!==1&&stage!==2
  for(const id of ['play','seek'])element<HTMLButtonElement>(id).disabled=disabled||Boolean(previewPreparation)||!hasScene
  element<HTMLButtonElement>('export').disabled=disabled||!hasScene
  const reusable=Boolean(draft&&state.reusableExports?.[draft.id]&&!dirty)
  element('export').textContent=reusable?'使用已有 MP4':'制作并导出 MP4'
  element<HTMLButtonElement>('export-existing').disabled=disabled||!draft?.exports.length
  element<HTMLButtonElement>('export-remake').disabled=disabled||!hasScene
  element('export-note').textContent=reusable?'视频与源素材未变化，可直接使用已有成片。':draft?.exports.length?'成片记录可直接查看和另存；制作当前修改请重新导出。':'制作完成后，可在此查看和另存成片。'
  const report=checked?.draftId===draft?.id&&checked?.revision===draft?.revision&&!dirty?checked:draft?draftReadiness(draft):undefined
  element<HTMLButtonElement>('studio-narrate-pending').disabled=disabled||!report?.pendingNarrationSceneIds.length
  element<HTMLButtonElement>('studio-check').disabled=disabled||!hasScene
  for(const id of ['studio-export-srt','studio-export-vtt'])element<HTMLButtonElement>(id).disabled=disabled||!hasScene
  element('studio-production-summary').textContent=report?`${draft!.scenes.length} 个分镜 · 总长 ${report.durationSeconds.toFixed(1)} 秒 · ${report.pendingNarrationSceneIds.length} 段旁白待制作${report===checked?' · 已检查素材与实测时长':' · 保存后可检查素材与实测时长'}`:''
  element('studio-issues').replaceChildren()
  for(const issue of report?.issues??[]){const node=issue.sceneId?button(issue.message,()=>selectScene(draft!.scenes.findIndex(scene=>scene.id===issue.sceneId))):paragraph(issue.message);node.classList.add('production-issue');node.dataset.severity=issue.severity;element('studio-issues').append(node)}
  element<HTMLButtonElement>('undo').disabled=disabled||!undo.length;element<HTMLButtonElement>('redo').disabled=disabled||!redo.length
  const notes=['准备此次视频的文字、图片、截图、原始音频和视频。先整理内容与大纲，再开始分镜。','从素材与大纲创作分镜。每段脚本与旁白一一对应，改稿后可重新生成此段音频。','逐段对照脚本试听旁白，检查是否过期以及实测长度；音频与脚本保持一一对应。','为分镜匹配此次准备的图片、截图和视频，旁白在脚本步骤管理。拖拽可以替换画面。','预览、独立编辑字幕内容/样式/位置并导出。修改字幕不会重新生成旁白。']
  element('stage-info').textContent=notes[stage];stageContent.replaceChildren();materials.suspend();workbench.render(draft,sceneIndex,stage,disabled,previewDirty);renderWorkbenchAssets();renderDeliveryHistory();if(!draft)return
  if(stage===0){
    if(pendingField!=='preparation-notes')area('preparation-notes').value=draft.preparation.notes
    if(pendingField!=='preparation-outline')area('preparation-outline').value=draft.preparation.outline
    element<HTMLButtonElement>('outline-to-scenes').disabled=disabled||hasScene||!draft.preparation.outline.trim()
    element<HTMLButtonElement>('studio-script-assistant').disabled=disabled
    stageContent.append(button('导入准备素材',async()=>{await flushEdits();editable();const result=mediaRecord(await api.importAsset(state.project.id));await refresh();if(result.artifactId){const asset=state.assets.find(item=>item.artifactId===result.artifactId);if(asset)await collectAsset(asset,true);message('素材已导入并加入此次视频。')}}))
    materials.render(stageContent,'preparation')
  }
  if(hasScene)speechEditor.render();else speechEditor.clear();speechLinksEditor.render()
  if(stage===1||stage===2)renderScript()
  if(stage===3){
    if(hasScene)visualEditor.render()
    if(hasScene){
      const coverage=sceneCoverage(scene(),draft?.tts);if(scene().videoArtifactId&&coverage.gap>.05)stageContent.append(paragraph(`画面缺口 ${coverage.gap.toFixed(1)} 秒。请补录或在分镜设置明确选择末帧定格。`))
      stageContent.append(button('让 Assistant 匹配已有素材',async()=>{await flushEdits();await api.assistant({projectId:state.project.id,draftId:draft!.id,sceneId:scene().id,expectedRevision:draft!.revision,intent:'match'});message('素材匹配任务已交给当前 Project 的 Assistant。')}))
      stageContent.append(button('让 Assistant 整理或补录此段',async()=>{await flushEdits();await api.assistant({projectId:state.project.id,draftId:draft!.id,sceneId:scene().id,expectedRevision:draft!.revision});message('补录任务已交给当前 Project 的 Agent Assistant。')}))
    }
    materials.render(stageContent,'matching')
  }
  if(stage===4&&hasScene){captions.render();visualEditor.render();renderScript()}
  if(stage===4&&workbench.mode==='cover')materials.renderPicker(element('cover-source-picker'),state.assets.filter(asset=>asset.kind==='image'||asset.kind==='video'),draft.cover?.sourceArtifactId,asset=>{select('cover-sourceArtifactId').value=asset.artifactId;select('cover-sourceArtifactId').dispatchEvent(new Event('change',{bubbles:true}))})
  if(stage>=3&&hasScene){const choice=select('segment-asset');materials.renderPicker(element('segment-source-picker'),state.assets.filter(asset=>asset.kind==='image'||asset.kind==='video'),choice.value,asset=>{choice.value=asset.artifactId;choice.dispatchEvent(new Event('change',{bubbles:true}));renderStage()});for(const row of (document.querySelectorAll('[data-segment-preview]') as HTMLElement[])){const asset=state.assets.find(asset=>asset.artifactId===row.dataset.segmentPreview);if(asset)materials.renderPicker(row,[asset],asset.artifactId)}}
  for(const clip of (document.querySelectorAll('#timeline-dock button') as HTMLButtonElement[]))clip.disabled=disabled
}
function setBusy(value:boolean):void{busy=value;element('cancel').hidden=!value||!['align-speech','read-speech','correct-speech','source','export-citations','render','narrate','narrate-pending','export-cover','export-captions','check'].includes(currentOperation??'');element('job-status').textContent=value?(currentOperation==='update'?'正在保存…':'作业处理中…'):'';for(const node of document.querySelectorAll('input,textarea,select,#save,#export,#new-draft,#delete-draft,#add-scene,#duplicate,#remove-scene,#move-up,#move-down,#undo,#redo,#studio-output-apply,#studio-output-template-save,#scene-list button') as (HTMLInputElement|HTMLButtonElement)[])node.disabled=value||invalidProject||Boolean(savePending);renderStage()}
async function command(request:unknown):Promise<unknown>{editable();currentOperation=String(mediaRecord(request).operation??'');setBusy(true);try{return await api.command(state.project.id,request)}finally{currentOperation=undefined;setBusy(false)}}
let savePending:Promise<void>|undefined
async function flushEdits(withSpeech=true,persist=true):Promise<void>{
  if(invalidProject)throw new Error('Studio Project is no longer active.')
  if(savePending)await savePending
  if(withSpeech)await speechEditor.flush()
  await visualEditor.flushFocus()
  await speechLinksEditor.flush()
  if(pendingField&&!busy){element(pendingField).dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve()}
  if(persist)await save(false)
}
async function attachAsset(asset:StudioAsset,sceneId:string,segmentIndex?:number):Promise<void>{
  if(asset.kind==='text')throw new Error('文字素材用于脚本准备，不能作为画面或旁白绑定。')
  await flushEdits();editable();if(!draft||!draft.scenes.some(scene=>scene.id===sceneId)||!state.assets.some(value=>value.artifactId===asset.artifactId))throw new Error('目标分镜或素材已变化，请重新选择。')
  const previous=clone(draft),project=state.project.id
  const result=await command({operation:'attach',draftId:draft.id,expectedRevision:draft.revision,sceneId,artifactId:asset.artifactId,assetKind:asset.kind,...(segmentIndex!==undefined?{segmentIndex}:{})})
  if(invalidProject||state.project.id!==project)return
  draft=assertVideoDraft(result);undo.push(previous);undo=undo.slice(-40);redo=[];dirty=false;previewDirty=true;await refresh();render();message('素材已绑定到分镜，可撤销此操作。')
}
async function collectAsset(asset:StudioAsset,selected:boolean):Promise<void>{
  await flushEdits();editable();if(!draft||!state.assets.some(value=>value.artifactId===asset.artifactId))throw new Error('素材已变化，请刷新。')
  if(!selected&&draft.scenes.some(value=>sceneVisuals(value).some(segment=>segment.imageArtifactId===asset.artifactId||segment.videoArtifactId===asset.artifactId)))throw new Error('此素材已用于分镜，请先在「匹配画面」替换或解除画面绑定。')
  const ids=draft.preparation.artifactIds;if(ids.includes(asset.artifactId)===selected)return
  history();draft.preparation.artifactIds=selected?[...ids,asset.artifactId]:ids.filter(id=>id!==asset.artifactId);render();await save(false)
}
async function alterScene(update:(value:StudioScene)=>void):Promise<void>{const owner=scene().id;await flushEdits(true,false);if(savePending)await savePending;editable();if(scene().id!==owner)throw new Error('当前分镜已切换。');const candidate=clone(scene());update(candidate);const next=assertVideoDraft({...draft!,scenes:draft!.scenes.map((value,index)=>index===sceneIndex?candidate:value)});history();draft=next;render();await save(false)}
async function narrateScene(id:string):Promise<void>{
  await flushEdits();editable();if(!draft||!draft.scenes.some(value=>value.id===id))throw new Error('分镜已变化，请重新选择。')
  const previous=clone(draft),result=mediaRecord(await command({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:id}))
  draft=assertVideoDraft(result.draft);undo.push(previous);undo=undo.slice(-40);redo=[];dirty=false;previewDirty=true;await refresh();render();message('此段旁白已重新生成，分镜长度已按实测音频更新。')
}
async function listenScene(id:string):Promise<void>{await flushEdits();const value=draft?.scenes.find(value=>value.id===id),asset=state.assets.find(asset=>asset.artifactId===value?.audioArtifactId);if(!asset)throw new Error('此段旁白素材不可用，请重新生成。');await materials.open(asset,undefined,true)}
async function addScene():Promise<void>{await flushEdits();editable();if(!draft)return;if(draft.scenes.length>=24)throw new Error('最多24个分镜。');history();draft.scenes.push(newStudioScene(crypto.randomUUID(),draft.scenes.length?'新分镜':'开场'));sceneIndex=draft.scenes.length-1;if(stage===0)stage=1;render();await save(false)}
async function save(clearHistory=true):Promise<void>{if(savePending)return savePending;if(!draft||!dirty)return;savePending=persistDraft(clearHistory);try{await savePending}finally{savePending=undefined;setBusy(busy);render()}}
async function persistDraft(clearHistory:boolean):Promise<void>{const snapshot=clone(draft);for(const value of snapshot.scenes)value.audioArtifactId=value.audioArtifactId;const result=await command({operation:'update',draftId:draft.id,expectedRevision:draft.revision,draft:snapshot});draft=assertVideoDraft(result);dirty=false;if(clearHistory){undo=[];redo=[]}await refresh();render();await publishSelection()}
async function operation(operation:string,fields:Record<string,unknown>={}):Promise<void>{await flushEdits();await save();if(!draft)return;const result=await command({operation,draftId:draft.id,expectedRevision:draft.revision,...fields}),value=mediaRecord(result);draft=assertVideoDraft(value.draft??result);dirty=false;if(operation!=='export-cover')previewDirty=true;if(operation==='render')workbench.mode='delivery';await refresh();render();if(operation==='render'){const output=mediaRecord(value.export);await showExport(String(output.artifactId),output.verificationArtifactId?String(output.verificationArtifactId):undefined);message(value.reused?'已使用已有 MP4，未重新制作。':'MP4 已导出到当前 Project 素材库。')}}
function clearExport():void{exportGeneration++;for(const video of element('export-preview').querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load()}element('export-preview').replaceChildren();exportURLs.forEach(url=>URL.revokeObjectURL(url));exportURLs=[]}
async function showExport(id:string,verificationArtifactId?:string):Promise<void>{
  clearExport();const attempt=exportGeneration,owner=draft?.id,project=state.project.id,title=draft?.title??'video'
  const data=await bytes(id),report=verificationArtifactId?await bytes(verificationArtifactId):undefined
  if(attempt!==exportGeneration||owner!==draft?.id||project!==state.project.id||invalidProject)return
  const url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'video/mp4'}));exportURLs.push(url)
  const video=document.createElement('video');video.controls=true;video.src=url;const link=document.createElement('a');link.href=url;link.download=title+'.mp4';link.textContent='另存成片 MP4';element('export-preview').replaceChildren(video,link)
  if(report){const reportURL=URL.createObjectURL(new Blob([report as Uint8Array<ArrayBuffer>],{type:'application/json'}));exportURLs.push(reportURL);const download=document.createElement('a');download.href=reportURL;download.download=title+'-验收报告.json';download.textContent='另存成片验收报告';element('export-preview').append(download)}
}

const fields=['scene-title','scene-label','narration','visual-brief','sources','bullets','duration','source-start','rate','gain','end-policy','layout','crop-x','crop-y','crop-width','crop-height','captions','music','draft-title']
let pendingField:string|undefined
// Keep pending input focused until the clicked action flushes it; blur must not
// disable or replace its target before the browser dispatches the click.
document.addEventListener('pointerdown',event=>{if(pendingField&&(event.target as HTMLElement).closest('button'))event.preventDefault()},true)
function mirrorScript(text:string):void{const node=document.querySelector('.script-scene.selected span');if(node)node.textContent=text||'此分镜尚未填写脚本';for(const button of document.querySelectorAll('#script-narrate,.script-scene.selected .script-generate') as HTMLButtonElement[])button.disabled=busy||invalidProject||Boolean(savePending)||!text.trim()
  if(draft)element<HTMLButtonElement>('studio-narrate-pending').disabled=busy||invalidProject||Boolean(savePending)||!(draftReadiness(draft).pendingNarrationSceneIds.some(id=>id!==scene().id)||(text.trim()&&sceneCoverage({...scene(),narration:text},draft.tts).audioStale))
}
area('script-current').addEventListener('input',()=>{pendingField='script-current';area('narration').value=area('script-current').value;mirrorScript(area('script-current').value)})
area('script-current').addEventListener('change',guarded(async()=>{if(!draft)return;if(pendingField==='script-current')pendingField=undefined;history();scene().narration=area('script-current').value;render();await save(false)}))
element('studio-cover-open').onclick=guarded(()=>openInspector('cover'))
element('delivery-open').onclick=guarded(()=>openInspector('delivery'))
element('preview-refresh').onclick=guarded(async()=>{await flushEdits();await prepare()})
element('settings-open').onclick=guarded(async()=>{await flushEdits();element<HTMLDialogElement>('settings-dialog').showModal()})
element('settings-close').onclick=guarded(async()=>{await flushEdits();element<HTMLDialogElement>('settings-dialog').close()})
for(const tab of (document.querySelectorAll('[data-inspector]') as HTMLButtonElement[]))tab.onclick=guarded(()=>openInspector(tab.dataset.inspector as InspectorMode))
element('timeline-dock').onclick=event=>{const target=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-seconds]');if(!target)return;guarded(()=>seekTo(Number(target.dataset.seconds),target.dataset.kind==='voice'?'voice':target.dataset.kind==='reveal'?'visual':target.dataset.kind==='caption'?'captions':'visual'))()}

element('script-save').onclick=guarded(async()=>{await flushEdits();message('脚本已保存。')})
element('studio-narrate-pending').onclick=guarded(async()=>{
  await flushEdits();editable();if(!draft)return
  preview.pause()
  try{
    const result=mediaRecord(await command({operation:'narrate-pending',draftId:draft.id,expectedRevision:draft.revision}))
    draft=assertVideoDraft(result.draft);dirty=false;undo=[];redo=[];previewDirty=true;await refresh();render()
    message(`已制作 ${(result.completedSceneIds as string[]).length} 段旁白；请检查画面与试听。`)
  }catch(error){
    // A batch can have committed earlier scenes. Reload the durable revision even
    // when the last provider fails or the user cancels; no unsaved edits remain.
    await refresh(false);message(`批量制作已停止，已完成旁白保留。${error instanceof Error?error.message:String(error)}`)
  }
})
for(const [id,captionFormat] of [['studio-export-srt','srt'],['studio-export-vtt','vtt']] as const)element(id).onclick=guarded(async()=>{
  await flushEdits();editable();if(!draft)return
  const result=mediaRecord(await command({operation:'export-captions',draftId:draft.id,expectedRevision:draft.revision,captionFormat}))
  await refresh();const data=await bytes(String(result.artifactId)),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:String(result.contentType)}));urls.push(url)
  const link=document.createElement('a');link.href=url;link.download=draft.title+'.'+captionFormat;link.textContent='另存字幕 '+captionFormat.toUpperCase();link.dataset.format=captionFormat
  const container=element('studio-subtitle-exports'),previous=container.querySelector<HTMLAnchorElement>('[data-format="'+captionFormat+'"]')
  if(previous){URL.revokeObjectURL(previous.href);urls=urls.filter(url=>url!==previous.href);previous.remove()}container.append(link)
  if(result.provenanceArtifactId){const proof=await bytes(String(result.provenanceArtifactId)),proofURL=URL.createObjectURL(new Blob([proof as Uint8Array<ArrayBuffer>],{type:'application/json'}));urls.push(proofURL);const proofLink=document.createElement('a');proofLink.href=proofURL;proofLink.download=draft.title+'-'+captionFormat+'-timing.json';proofLink.textContent='句锚点时间来源 '+captionFormat.toUpperCase();proofLink.dataset.provenance=captionFormat;const old=container.querySelector<HTMLAnchorElement>('[data-provenance="'+captionFormat+'"]');if(old){URL.revokeObjectURL(old.href);urls=urls.filter(url=>url!==old.href);old.remove()}container.append(proofLink)}
  message(`${captionFormat.toUpperCase()} 已导出 ${result.cueCount} 条字幕，时间来源：${result.timing==='edited'?'手工编辑':result.timing==='mixed'?'手工与估算混合':'估算'}。`)
})
element('studio-check').onclick=guarded(async()=>{
  await flushEdits();editable();if(!draft)return
  const result=await command({operation:'check',draftId:draft.id,expectedRevision:draft.revision}) as StudioReadiness
  checked=result;stage=4;workbench.mode='delivery';renderStage();void publishSelection();message(result.ready?'制作检查通过；素材解码与设备编码均可用。':'制作检查发现问题；点击问题定位分镜。')
})
element('scene-number').onchange=guarded(()=>alterScene(value=>{value.showSceneNumber=input('scene-number').checked}))
element('script-remove-voice').onclick=guarded(()=>alterScene(value=>{value.narration='';for(const key of ['audioArtifactId','audioText','audioGeneration','audioDurationSeconds','speechCandidate','speechAnchors','speechCaptions','speechLinks'] as const)delete value[key]}))
element('script-narrate').onclick=guarded(()=>narrateScene(scene().id));element('script-listen').onclick=guarded(()=>listenScene(scene().id));element('script-bind-audio').onclick=guarded(async()=>{const asset=state.assets.find(item=>item.artifactId===select('script-raw-audio').value&&item.kind==='audio');if(!asset)throw new Error('请先选择已准备的原始音频。');await attachAsset(asset,scene().id)})
for(const id of fields)element(id).addEventListener('input',()=>{pendingField=id;if(id==='narration'){area('script-current').value=area('narration').value;mirrorScript(area('narration').value)}})
for(const id of fields)element(id).addEventListener('change',guarded(async()=>{if(!draft)return;if(id==='draft-title'){pendingField=undefined;history();draft.title=input('draft-title').value;render();await save(false);return}if(id==='music'){pendingField=undefined;history();draft.music=input('music').checked;render();await save(false);return}if(!draft.scenes.length)return;if(pendingField===id)pendingField=undefined;history();const value=scene();value.title=input('scene-title').value;value.label=input('scene-label').value;value.narration=area('narration').value;value.visualBrief=area('visual-brief').value;value.sources=area('sources').value.split('\n').map(value=>value.trim()).filter(Boolean);value.bullets=area('bullets').value.split('\n').filter(Boolean);value.durationSeconds=Number(input('duration').value);if(value.visualSegments)fitVisualSegments(value.visualSegments,value.durationSeconds);value.sourceStartSeconds=Number(input('source-start').value);value.playbackRate=Number(input('rate').value);value.voiceVolume=Number(input('gain').value);value.endPolicy=select('end-policy').value as StudioScene['endPolicy'];value.layout=select('layout').value as StudioScene['layout'];value.crop={x:Number(input('crop-x').value),y:Number(input('crop-y').value),width:Number(input('crop-width').value),height:Number(input('crop-height').value)};if(id==='captions'){const cues=area('captions').value.trim();if(cues)value.captions=cues.split('\n').map(line=>{const [start,end,...text]=line.split('|');return {startSeconds:Number(start),endSeconds:Number(end),text:text.join('|').trim()}});else delete value.captions;}draft.music=input('music').checked;draft.title=input('draft-title').value;render();await save(false)}))

for(const id of ['preparation-notes','preparation-outline']){
  area(id).addEventListener('input',()=>{pendingField=id;if(id==='preparation-outline')element<HTMLButtonElement>('outline-to-scenes').disabled=busy||invalidProject||Boolean(draft?.scenes.length)||!area(id).value.trim()})
  area(id).addEventListener('change',guarded(async()=>{if(!draft)return;pendingField=undefined;history();draft.preparation.notes=area('preparation-notes').value;draft.preparation.outline=area('preparation-outline').value;render();await save(false)}))
}
element('studio-script-assistant').onclick=guarded(async()=>{await flushEdits();editable();if(!draft)return;await api.assistant({projectId:state.project.id,draftId:draft.id,expectedRevision:draft.revision,intent:'script'});message('脚本辅助任务已交给当前 Project 的 Assistant。')})
element('outline-to-scenes').onclick=guarded(async()=>{await flushEdits();editable();if(!draft)return;if(draft.scenes.length)throw new Error('已有分镜，请在脚本页继续修改，避免覆盖。');const lines=draft.preparation.outline.split('\n').map(value=>value.trim()).filter(Boolean);if(!lines.length||lines.length>24)throw new Error('请提供1–24行大纲，每行创建一个分镜。');history();draft.scenes=lines.map((line,index)=>({...newStudioScene(crypto.randomUUID(),line.slice(0,44)||'分镜'+(index+1)),visualBrief:line.slice(0,2000)}));sceneIndex=0;stage=1;render();await save(false)})
for(const id of ['keep-source-audio','source-volume'])element(id).addEventListener('input',()=>{pendingField=id})
for(const id of ['keep-source-audio','source-volume'])element(id).addEventListener('change',guarded(async()=>{pendingField=undefined;const keep=input('keep-source-audio').checked,volume=Number(input('source-volume').value);await alterScene(value=>{value.keepSourceAudio=keep;value.sourceVolume=volume})}))

element('leave').onclick=guarded(async()=>{await flushEdits();materials.suspend();previewDirty=true;await preview.dispose();await api.leave()});window.bmwStudioFlush=async()=>{await flushEdits();await publishSelection()};element('save').onclick=guarded(async()=>{await flushEdits();await save();undo=[];redo=[];render()});element('export').onclick=guarded(()=>operation('render'));element('export-remake').onclick=guarded(()=>operation('render',{forceRender:true}));element('export-existing').onclick=guarded(async()=>{await flushEdits();const latest=draft?.exports.at(-1);if(latest){await showExport(latest.artifactId,latest.verificationArtifactId);message('已打开已有成片，可直接另存 MP4。')}});element('cancel').onclick=guarded(async()=>{await api.cancel();message('已请求取消作业。')});element('play').onclick=guarded(async()=>{await prepare();await preview.play()});input('seek').oninput=guarded(()=>seekTo(Number(input('seek').value)));element('reload').onclick=guarded(async()=>{if(dirty&&!confirm('重新加载会放弃此页未保存修改，是否继续？'))return;await refresh(false)});element('assistant').onclick=guarded(async()=>{await api.assistant()})
select('studio-output-template').onchange=guarded(()=>{const preset=state.videoPreferences?.templates.find(item=>item.name===select('studio-output-template').value);if(preset)outputForm.fill(preset.options)})
element('studio-output-apply').onclick=guarded(async()=>{const options=outputForm.read(),templateName=select('studio-output-template').value;await operation('configure',{options,...(templateName?{templateName}:{})});previewDirty=true;message('视频参数已保存；更新预览可查看新画面。')})
element('studio-output-template-save').onclick=guarded(async()=>{await save();if(!draft)return;const name=input('studio-output-template-name').value;await command({operation:'save-template',draftId:draft.id,expectedRevision:draft.revision,templateName:name});await refresh();message('模板已保存，之后可以按名称制作视频。')})
element('empty-create').onclick=()=>element('new-draft').click();
element('delete-draft').onclick=guarded(async()=>{await flushEdits();await save();if(!draft||!confirm(`删除视频草稿「${draft.title}」？共用素材和已导出的文件会保留。`))return;await command({operation:'delete',draftId:draft.id,expectedRevision:draft.revision});choose(undefined);await refresh(false);message('草稿已删除，共用素材和导出文件已保留。')});
element('new-draft').onclick=guarded(async()=>{await flushEdits();await save();const result=assertVideoDraft(await command({operation:'create',title:'新视频'}));await refresh();stage=0;choose(result)});select('draft-select').onchange=guarded(async()=>{const id=select('draft-select').value;await flushEdits();await save();choose(state.drafts.find(value=>value.id===id)!)});
element('add-scene').onclick=guarded(addScene);element('duplicate').onclick=guarded(async()=>{await flushEdits();if(draft!.scenes.length>=24)throw new Error('最多 24 个分镜。');history();draft!.scenes.splice(sceneIndex+1,0,{...clone(scene()),id:crypto.randomUUID()});sceneIndex++;render();await save(false)});element('remove-scene').onclick=guarded(async()=>{await flushEdits();if(!draft?.scenes.length)return;history();draft.scenes.splice(sceneIndex,1);sceneIndex=Math.max(0,Math.min(sceneIndex,draft.scenes.length-1));if(!draft.scenes.length)await preview.dispose();render();await save(false)});for(const [id,direction] of [['move-up',-1],['move-down',1]] as const)element(id).onclick=guarded(async()=>{await flushEdits();const next=sceneIndex+direction;if(next<0||next>=draft!.scenes.length)return;history();[draft!.scenes[sceneIndex],draft!.scenes[next]]=[draft!.scenes[next],draft!.scenes[sceneIndex]];sceneIndex=next;render();await save(false)})
element('undo').onclick=guarded(async()=>{await flushEdits();editable();if(!undo.length||!draft)return;redo.push(clone(draft));const revision=draft.revision;draft=undo.pop()!;draft.revision=revision;sceneIndex=Math.max(0,Math.min(sceneIndex,draft.scenes.length-1));dirty=true;previewDirty=true;render();await save(false)});element('redo').onclick=guarded(async()=>{await flushEdits();editable();if(!redo.length||!draft)return;undo.push(clone(draft));const revision=draft.revision;draft=redo.pop()!;draft.revision=revision;sceneIndex=Math.max(0,Math.min(sceneIndex,draft.scenes.length-1));dirty=true;previewDirty=true;render();await save(false)})
for(const button of (document.querySelectorAll('[data-stage]') as HTMLButtonElement[]))button.onclick=guarded(async()=>{await flushEdits();stage=Number(button.dataset.stage);if(stage!==4){preview.pause();for(const media of document.querySelectorAll('audio,video') as HTMLMediaElement[])media.pause()}document.querySelectorAll('[data-stage]').forEach(item=>item.classList.toggle('active',item===button));renderStage();if(stage===4){if(workbench.mode==='cover')await coverEditor.preview();else await selectScene(sceneIndex)}else void publishSelection()})
api.onChange(value=>{const changed=mediaRecord(value);if(changed.workspaceHidden){materials.suspend();previewDirty=true;void preview.dispose();for(const audio of document.querySelectorAll('audio,video') as HTMLMediaElement[])audio.pause();return}if(changed.projectRestored){invalidProject=false;previewDirty=true;setBusy(false);void refresh(true).then(()=>{if(dirty)message('已恢复此 Project 的未保存草稿。');else{const latest=state.drafts.find(value=>value.id===draft?.id)??state.drafts[0];if(latest?.id!==draft?.id||latest?.revision!==draft?.revision)choose(latest);else render()}}).catch(error=>message(String(error)));return}if(changed.projectChanged){speechEditor.clear();coverEditor.clear();clearExport();materials.clear();invalidProject=true;previewDirty=true;setBusy(busy);void preview.dispose();message('Project 已切换，此页保留草稿，请重新打开 Video Studio。');renderStage();return}if(busy)return;void refresh(true).then(()=>{if(busy)return;if(dirty||pendingField)message('草稿有外部更新。保存时会检查版本；需要时重新加载合并。');else{const latest=state.drafts.find(value=>value.id===draft?.id)??state.drafts[0];if(latest?.id!==draft?.id||latest?.revision!==draft?.revision)choose(latest);else{renderSelect();renderStage()}}}).catch(error=>message(String(error)))})
api.onProgress(value=>{const record=mediaRecord(value);if(busy)message(`媒体作业进行中 ${typeof record.progress==='number'?Math.round(record.progress*100)+'%':''}`)})
window.addEventListener('beforeunload',event=>{if(dirty||pendingField){event.preventDefault();event.returnValue='未保存草稿'}});window.addEventListener('unload',()=>{coverEditor.clear();clearExport();materials.clear();urls.forEach(url=>URL.revokeObjectURL(url));void preview.dispose()});void refresh(false).catch(error=>message(String(error)))

element('studio-export-citations').onclick=guarded(async()=>{await flushEdits();editable();if(!draft)return;const result=mediaRecord(await command({operation:'export-citations',draftId:draft.id,expectedRevision:draft.revision}));await refresh();const data=await bytes(String(result.artifactId)),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'application/json'}));urls.push(url);const link=document.createElement('a');link.href=url;link.download=draft.title+'-citations.json';link.textContent='另存引用清单';const previous=element('studio-citation-export').querySelector<HTMLAnchorElement>('a');if(previous){URL.revokeObjectURL(previous.href);urls=urls.filter(value=>value!==previous.href);previous.remove()}element('studio-citation-export').append(link);message('已导出 '+result.citationCount+' 条原文引用；事实核查状态仍为待确认。')})
