import {studioCompatibility,requireSimpleVideo} from '../studio-compatibility.js'
import {StudioReferenceEditor} from './studio-reference-editor.js'
import {studioReviewApplicable,studioReviewValueLabel} from '../studio-review.js'
import type {StudioReviewItem} from '../studio-review.js'
import {StudioPanels} from './studio-panels.js'
import {StudioMainEditor} from './studio-main-editor.js'
import {StudioLayerEditor} from './studio-layer-editor.js'
import {studioLayer} from '../studio-layer-edits.js'
import {StudioCards} from './studio-cards.js'
import {StudioCardTextEditor,cardTemplateScene,changeCardBullet} from './studio-card-text.js'
import {StudioWorkflow} from './studio-workflow.js'
import type {FeatureAssistantActivity} from '@bmw-agent/platform/feature-contract'
import {reviewSceneText} from '../../../media-native/src/media/composition-paint.js'
import {speechScene} from '../studio-speech-contract.js'
import {StudioOriginalSpeechEditor} from './studio-original-speech-editor.js'
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
import {assertVideoDraft,sameStudioDraftContent,audioGenerationLabel,sceneCoverage,draftReadiness,newStudioScene} from '../studio-contract.js'
import {StudioCaptionEditor} from './studio-caption-editor.js'
import type {VideoDraft,StudioScene,StudioState,StudioAsset,StudioReadiness} from '../studio-contract.js'
import {mediaRecord} from '../../../media-native/src/media-contract.js'
import {StudioPreview} from './studio-preview.js'
import {StudioMaterialsView} from './studio-materials-view.js'
const api=window.bmwStudio
function element<T extends HTMLElement>(id:string):T{const result=document.getElementById(id);if(!result)throw new Error('Missing Studio element '+id);return result as T}
const input=(id:string)=>element<HTMLInputElement>(id),area=(id:string)=>element<HTMLTextAreaElement>(id),select=(id:string)=>element<HTMLSelectElement>(id)
let pendingOutput:{projectId:string;draftId:string}|undefined,outputSaving:Promise<void>|undefined
function outputEdited():void{if(state&&draft&&!pendingOutput)pendingOutput={projectId:state.project.id,draftId:draft.id}}
const outputForm=new VideoOptionsForm(element('studio-output-options'),'studio-output',outputEdited)
element('studio-output-options').addEventListener('input',outputEdited)
const status=element('status'),sceneList=element('scene-list'),stageContent=element('stage-content')
let state:StudioState,draft:VideoDraft|undefined,sceneIndex=0,stage=4,dirty=false,busy=false,invalidProject=false,previewDirty=true
let checked:StudioReadiness|undefined
let undo:VideoDraft[]=[],redo:VideoDraft[]=[],urls:string[]=[],exportURLs:string[]=[];let exportGeneration=0
const historyProofs=new WeakMap<VideoDraft,string>()
let restorePending:{snapshot:VideoDraft;proof:string}|undefined
function captureHistory(value:VideoDraft):VideoDraft {
  const snapshot=clone(value),stored=state?.drafts.find(d=>d.id===value.id),proof=state?.snapshotProofs?.[value.id]
  if(stored&&proof&&/^[a-f0-9]{64}$/.test(proof)&&sameStudioDraftContent(value,stored))historyProofs.set(snapshot,proof)
  return snapshot
}
let previewPreparation:Promise<void>|undefined,sceneSelection=0,previewPreparing=false
let currentOperation:string|undefined
let productionActive=false,productionStopped=false,cancellationRequested=false,commandEpoch=0
let workspaceHidden=false,workspaceEpoch=0,externalRequested=false
let externalRefresh:Promise<void>|undefined
let viewChanging=false
let saveFailure:string|undefined
let stateRefresh:Promise<void>=Promise.resolve()
const workbench=new StudioWorkbench()
const workflow=new StudioWorkflow()
let materialAssistantPending=false
function renderMaterialAssistant():void{
 const own=workflow.activity?.projectId===state?.project.id&&workflow.activity?.sessionId===state?.sessionId?workflow.activity:undefined
 const blocked=materialAssistantPending||busy||invalidProject||viewChanging||Boolean(savePending)||!draft||Boolean(own&&['queued','running','waiting-user','waiting-approval','cancelling'].includes(own.status))
 for(const button of document.querySelectorAll('[data-materials-assistant]') as HTMLButtonElement[])button.disabled=blocked
 for(const summary of document.querySelectorAll('[data-materials-summary]') as HTMLElement[])summary.textContent=draft?`${draft.preparation.artifactIds.length} 项此次素材 · 结果保存在此视频中`:''
}
async function prepareMaterials():Promise<void>{
 if(materialAssistantPending)throw new Error('素材任务正在提交，请稍候。')
 const owner={projectId:state.project.id,sessionId:state.sessionId,draftId:draft?.id}
 if(!owner.draftId)throw new Error('请先创建视频草稿。')
 materialAssistantPending=true;renderMaterialAssistant()
 try{await flushEdits();editable();if(state.project.id!==owner.projectId||state.sessionId!==owner.sessionId||draft?.id!==owner.draftId)throw new Error('素材任务所属视频已切换。')
  const own=workflow.activity?.projectId===owner.projectId&&workflow.activity?.sessionId===owner.sessionId?workflow.activity:undefined
  if(own&&['queued','running','waiting-user','waiting-approval','cancelling'].includes(own.status))throw new Error('Assistant 正在处理当前任务，请完成或停止后再准备素材。')
  await api.assistant({projectId:owner.projectId,draftId:owner.draftId,expectedRevision:draft.revision,intent:'materials'});message('素材准备已交给同一 Assistant；实际成果会加入此次视频素材，分镜和脚本保留。')
 }finally{materialAssistantPending=false;renderMaterialAssistant()}
}
let advancedInspector:InspectorMode='visual'
let shownOutput:string|undefined
const clone=<T>(value:T):T=>structuredClone(value)
function message(value:string):void{status.textContent=value}
function guarded(fn:()=>Promise<void>|void):()=>void{return ()=>{void Promise.resolve().then(fn).catch(error=>message(error instanceof Error?error.message:String(error)))}}
function scene():StudioScene{const value=draft?.scenes[sceneIndex];if(!value)throw new Error('请先在「脚本与旁白」创建分镜。');return value}
function simpleReadOnly():boolean{return Boolean(draft&&workflow.view.mode==='simple'&&!studioCompatibility(draft).simpleEditable)}
function editable(modeChange=false):void{if(!modeChange&&draft&&workflow.view.mode==='simple')requireSimpleVideo(draft);if(viewChanging)throw new Error('正在切换编辑视图，请稍候。');if(invalidProject)throw new Error('Project 已切换。请关闭此页，从当前 Project 重新打开。');if(busy||savePending)throw new Error('正在处理，请等待或取消。')}
function history():void{editable();if(!draft)return;workflow.result='draft';undo.push(captureHistory(draft));undo=undo.slice(-40);redo=[];restorePending=undefined;dirty=true;previewDirty=true}
function format(time:number):string{return `${Math.floor(time/60).toString().padStart(2,'0')}:${Math.floor(time%60).toString().padStart(2,'0')}`}
async function bytes(id:string):Promise<Uint8Array>{const projectId=state.project.id;const asset=state.assets.find(asset=>asset.artifactId===id);if(!asset||asset.bytes>256*1024*1024)throw new Error('Asset is unavailable or too large for preview.');const result=new Uint8Array(asset.bytes);for(let offset=0;offset<result.length;offset+=1024*1024){if(invalidProject||state.project.id!==projectId)throw new Error('Project 已切换，预览已取消。');result.set(await api.read(projectId,id,offset,Math.min(1024*1024,result.length-offset)),offset)}return result}
const preview=new StudioPreview(element<HTMLCanvasElement>('preview'),bytes,(time,playing)=>{input('seek').value=String(time);element('time').textContent=`${format(time)} / ${format(preview.duration)}`;element('play').textContent=playing?'暂停':'播放';workbench.time(time);layerEditor.time();if(draft){const at=studioSceneIndex(draft,time),id=draft.scenes[at]?.id;for(const card of document.querySelectorAll('[data-card-id]') as HTMLElement[])card.classList.toggle('playing',playing&&card.dataset.cardId===id)}cardText.time()})
const cardText=new StudioCardTextEditor({
 state:()=>state&&draft&&draft.scenes[sceneIndex]?{projectId:state.project.id,sessionId:state.sessionId??null,draft,scene:scene(),active:workflow.view.mode==='simple'&&stage===4&&workflow.result==='draft'&&!['cover','delivery'].includes(workbench.mode),disabled:busy||invalidProject||viewChanging||Boolean(savePending)||simpleReadOnly(),previewReady:!previewDirty&&!previewPreparing}:undefined,
 bytes,painted:()=>draft?preview.text(draft):undefined,flush:()=>flushEdits(),pause:()=>preview.pause(),notify:message,
 select:async id=>{editable();const index=draft!.scenes.findIndex(scene=>scene.id===id);if(index<0)throw new Error('文字所属镜头已变化。');sceneIndex=index;renderStage();await publishSelection()},
 commit:async(owner,field,text,append)=>{
  const current=()=>{editable();if(!draft||state.project.id!==owner.projectId||(state.sessionId??null)!==owner.sessionId||draft.id!==owner.draftId||draft.revision!==owner.revision)throw new Error('STUDIO_CONFLICT: 标题卡文字版本已变化，输入保留。');const index=draft.scenes.findIndex(scene=>scene.id===owner.sceneId);if(index<0)throw new Error('文字所属镜头已删除。');return index}
  current();await flushEdits(true,false,true,true,true,true,false);const index=current(),next=clone(draft!),target=next.scenes[index]
  if(append){if(field.kind!=='bullet'||field.index!==target.bullets.length)throw new Error('新增要点所属位置已变化。');next.scenes[index]=changeCardBullet(target,{operation:'add',text})}else if(field.kind==='title')target.title=text;else{if(field.index<0||field.index>=target.bullets.length)throw new Error('画面要点已变化。');target.bullets[field.index]=text}
  const candidate=assertVideoDraft(next),context=document.createElement('canvas').getContext('2d')!
  const errors=reviewSceneText(context,speechScene(candidate.scenes[index]),candidate.width,candidate.height).filter(issue=>issue.severity==='error'&&issue.code==='text-overflow'&&issue.message.startsWith('第 '))
  if(errors.length)throw new Error(errors.map(issue=>issue.message).join('；'))
  const previous=draft,previousDirty=dirty,previousUndo=[...undo],previousRedo=[...redo],previousRestore=restorePending
  if(!sameStudioDraftContent(draft!,candidate)){history();draft=candidate;checked=undefined;reviewFrames=undefined}
  try{await save(false)}catch(error){if(draft===candidate){draft=previous;dirty=previousDirty;undo=previousUndo;redo=previousRedo;restorePending=previousRestore;render()}throw error}
  message(append?'要点已添加，可撤销；旁白与字幕保留。':'画面文字已保存，可撤销；旁白与字幕保留。')
 },
 remove:async(owner,bulletIndex)=>{
  const current=()=>{editable();if(!draft||state.project.id!==owner.projectId||(state.sessionId??null)!==owner.sessionId||draft.id!==owner.draftId||draft.revision!==owner.revision)throw new Error('STUDIO_CONFLICT: 要点所属草稿版本已变化，请重新加载后处理。');const index=draft.scenes.findIndex(scene=>scene.id===owner.sceneId);if(index<0)throw new Error('要点所属镜头已删除。');return index}
  current();await flushEdits(true,false,true,true,true,true,false);const index=current(),candidate=clone(draft!);candidate.scenes[index]=changeCardBullet(candidate.scenes[index],{operation:'remove',index:bulletIndex});assertVideoDraft(candidate)
  const previous=draft,previousDirty=dirty,previousUndo=[...undo],previousRedo=[...redo],previousRestore=restorePending
  history();draft=candidate;checked=undefined;reviewFrames=undefined
  try{await save(false)}catch(error){if(draft===candidate){draft=previous;dirty=previousDirty;undo=previousUndo;redo=previousRedo;restorePending=previousRestore;render()}throw error}
  message('要点已删除，可撤销；旁白与字幕保留。')
 },
 template:async(owner,kind)=>{
  const current=()=>{editable();if(!draft||state.project.id!==owner.projectId||(state.sessionId??null)!==owner.sessionId||draft.id!==owner.draftId||draft.revision!==owner.revision)throw new Error('STUDIO_CONFLICT: 版式所属草稿版本已变化，请重新打开版式选择。');const index=draft.scenes.findIndex(scene=>scene.id===owner.sceneId);if(index<0)throw new Error('版式所属镜头已删除。');return index}
  current();await flushEdits(true,false,true,true,true,true,false);const index=current(),candidate=clone(draft!);candidate.scenes[index]=cardTemplateScene(candidate.scenes[index],kind);assertVideoDraft(candidate)
  const errors=reviewSceneText(document.createElement('canvas').getContext('2d')!,speechScene(candidate.scenes[index]),candidate.width,candidate.height).filter(issue=>issue.severity==='error');if(errors.length)throw new Error(errors.map(issue=>issue.message).join('；'))
  const previous=draft,previousDirty=dirty,previousUndo=[...undo],previousRedo=[...redo],previousRestore=restorePending
  if(!sameStudioDraftContent(draft!,candidate)){history();draft=candidate;checked=undefined;reviewFrames=undefined}
  try{await save(false)}catch(error){if(draft===candidate){draft=previous;dirty=previousDirty;undo=previousUndo;redo=previousRedo;restorePending=previousRestore;render()}throw error}
  message('当前镜头版式已保存，可撤销；文字、旁白、字幕与素材保留。')
 },
 refresh:async()=>{if(draft?.scenes.length)await prepare()}
})
const materials=new StudioMaterialsView(()=>state&&draft?{state,draft,sceneId:draft.scenes[sceneIndex]?.id,stage,disabled:busy||invalidProject||viewChanging||Boolean(savePending)}:undefined,(project,id,offset,length)=>api.read(project,id,offset,length),attachAsset,collectAsset,message,()=>{guarded(async()=>{await flushEdits();renderStage()})()},async asset=>{await flushEdits();editable();await referenceEditor.open(asset)})
const sourceEditor=new StudioSourceEditor(element('studio-source-editor'),()=>state&&draft&&!invalidProject?{projectId:state.project.id,disabled:busy||viewChanging||Boolean(savePending),sourceIds:draft.preparation.sourceIds??[],scenes:draft.scenes,sceneId:draft.scenes[sceneIndex]?.id}:undefined,async request=>{await flushEdits();const result=await command({operation:'source',sourceRequest:request});if(request.operation==='acquire')await refresh();return result},async(id,selected)=>{await flushEdits();editable();if(!draft)return;history();const ids=draft.preparation.sourceIds??[];draft.preparation.sourceIds=selected?[...new Set([...ids,id])]:ids.filter(value=>value!==id);render();await save(false)},async(sceneId,citation:SourceCitation)=>{await flushEdits();editable();if(!draft)return;const target=draft.scenes.find(scene=>scene.id===sceneId);if(!target)throw new Error('选择一个当前草稿的分镜。');if((target.citations?.length??0)>=12)throw new Error('每个分镜最多十二条引用。');history();target.citations=[...(target.citations??[]),citation];draft.preparation.sourceIds=[...new Set([...(draft.preparation.sourceIds??[]),citation.sourceId])];render();await save(false)},async artifactId=>{const asset=state.assets.find(asset=>asset.artifactId===artifactId);if(!asset)throw new Error('来源素材已失效，请重新获取。');await materials.open(asset,undefined,true)},message)
const visualEditor=new StudioVisualEditor(()=>draft?.scenes[sceneIndex]?{scene:scene(),assets:state.assets,disabled:busy||invalidProject||viewChanging||Boolean(savePending)}:undefined,alterScene,(asset,id,index)=>attachAsset(asset,id,index),message,async index=>{
  await flushEdits();editable();if(!draft)throw new Error('请先选择草稿。');const project=state.project.id,id=draft.id,revision=draft.revision,sceneId=scene().id
  const result=mediaRecord(await command({operation:'suggest-focus',draftId:id,expectedRevision:revision,sceneId,...(index===undefined?{}:{segmentIndex:index})}))
  if(invalidProject||project!==state.project.id||id!==draft?.id||revision!==draft.revision||sceneId!==scene().id)throw new Error('当前草稿已切换。')
  return assertFocusIntervals(result.focusIntervals)
},id=>{pendingField=id})
const referenceEditor=new StudioReferenceEditor({state:()=>state&&draft?{projectId:state.project.id,sessionId:state.sessionId,draft,disabled:busy||invalidProject||viewChanging||Boolean(savePending)}:undefined,bytes,cancel:cancelOperation,notify:message,preview:async(asset,time)=>{await materials.open(asset,undefined,true,time)},ask:async referenceId=>{const owner={projectId:state.project.id,sessionId:state.sessionId,draftId:draft?.id};await flushEdits();editable();if(state.project.id!==owner.projectId||state.sessionId!==owner.sessionId||draft?.id!==owner.draftId)throw new Error('参考所属视频已变化。');if(!draft)throw new Error('请先选择视频。');await api.assistant({projectId:state.project.id,draftId:draft.id,expectedRevision:draft.revision,intent:'reference',referenceId});message('参考分析已交给当前 Assistant；请在素材预览的参考分析中查看结果。')},command:async(request,owner)=>{
 await flushEdits();editable();if(state.project.id!==owner.projectId||state.sessionId!==owner.sessionId||draft?.id!==owner.draftId||draft.revision!==request.expectedRevision)throw new Error('STUDIO_CONFLICT: 参考所属视频或版本已变化，请重新打开。')
 const previous=captureHistory(draft),result=mediaRecord(await command(request));if(result.draft){const next=assertVideoDraft(result.draft),same=sameStudioDraftContent(draft,next);if(!same){undo.push(previous);undo=undo.slice(-40);redo=[];restorePending=undefined;previewDirty=true;checked=undefined;reviewFrames=undefined;workflow.result='draft'}else if(!previewDirty&&!previewPreparing&&!preview.advanceRevision(draft,next,state.assets,state.assets))previewDirty=true;if(same&&reviewFrames?.id===next.id)reviewFrames.revision=next.revision;draft=next;dirty=false}
 await refresh();render();return result
}})
const originalSpeechEditor=new StudioOriginalSpeechEditor(element('source-speech-editor'),()=>draft?.scenes[sceneIndex]?{projectId:state.project.id,draft,scene:scene(),disabled:busy||invalidProject||viewChanging||Boolean(savePending)}:undefined,async(request,scope)=>{await flushEdits(true,true,request.operation!=='apply-source-captions');editable();if(!draft)throw new Error('请先选择草稿。');if(scope&&(scope.projectId!==state.project.id||scope.draftId!==draft.id||scope.sceneId!==scene().id||scope.revision!==draft.revision))throw new Error('STUDIO_CONFLICT: 草稿已变化，请重新加载草稿后读取原声结果。');const result=mediaRecord(await command({...request,draftId:draft.id,expectedRevision:draft.revision,sceneId:scene().id}));if(result.draft){draft=assertVideoDraft(result.draft);dirty=false;previewDirty=true;await refresh();render()}return result},bytes,message)
const captions=new StudioCaptionEditor(()=>draft?.scenes[sceneIndex]?{draft,scene:scene(),index:sceneIndex,disabled:busy||invalidProject||viewChanging||Boolean(savePending)}:undefined,alterScene,id=>{pendingField=id},()=>pendingField,message)
const speechEditor=new StudioSpeechEditor(element('studio-speech-editor'),()=>draft?.scenes[sceneIndex]?{projectId:state.project.id,draft,scene:scene(),disabled:busy||invalidProject||viewChanging||Boolean(savePending)}:undefined,async(request,scope)=>{
  if(!draft||draft.revision!==scope.revision)throw new Error('STUDIO_CONFLICT: 草稿版本已变化，请重新加载句锚点。')
  await flushEdits(false);editable();if(!draft||invalidProject||state.project.id!==scope.projectId||draft.id!==scope.draftId||scene().id!==scope.sceneId||scene().narration!==scope.script||scene().audioArtifactId!==scope.audioArtifactId)throw new Error('句锚点所属脚本、音频或分镜已变化，请重新加载后校正。')
  // Use the captured revision; an external correction must conflict, not be adopted silently.
  const result=mediaRecord(await command({...request,draftId:draft.id,expectedRevision:draft.revision,sceneId:scope.sceneId}))
  if(result.draft){draft=assertVideoDraft(result.draft);dirty=false;previewDirty=true;undo=[];redo=[];await refresh();render()}
  return result
},bytes,enabled=>alterScene(value=>{value.speechCaptions=enabled}),message)
const speechLinksEditor=new StudioSpeechLinksEditor(element('studio-speech-links'),()=>draft?.scenes[sceneIndex]?{projectId:state.project.id,draft,scene:scene(),disabled:busy||invalidProject||viewChanging||Boolean(savePending)}:undefined,alterScene,message,id=>{pendingField=id})
const coverEditor=new StudioCoverEditor(()=>state&&draft?{projectId:state.project.id,draft,assets:state.assets,disabled:busy||invalidProject||viewChanging||Boolean(savePending)}:undefined,id=>{pendingField=id},()=>pendingField,async options=>{history();draft!.cover=options;renderStage();await save(false)},()=>operation('export-cover'),bytes,message)
const layerEditor=new StudioLayerEditor({
  state:()=>state&&draft?{projectId:state.project.id,draft,sceneId:draft.scenes[sceneIndex]?.id,advanced:workflow.view.mode==='advanced'&&stage===4&&!['cover','delivery'].includes(workbench.mode),disabled:busy||invalidProject||viewChanging||Boolean(savePending),previewReady:!previewDirty&&!previewPreparing,time:Number(input('seek').value),assets:state.assets}:undefined,
  commit:async(owner,change)=>{if(invalidProject||state.project.id!==owner.projectId||draft?.id!==owner.draftId||draft.revision!==owner.revision)throw new Error('STUDIO_CONFLICT: 对象所属草稿或版本变化；保留输入，请重新加载后处理。');await flushEdits(true,false,true,false);editable();if(draft!.revision!==owner.revision)throw new Error('STUDIO_CONFLICT: 保存期间草稿版本变化。');const next=assertVideoDraft(change(clone(draft!)));history();draft=next;render();await save(false)},
  select:async ref=>{preview.pause();editable();mainEditor.clearSelection();if(ref.sceneId){const index=draft!.scenes.findIndex(scene=>scene.id===ref.sceneId);if(index<0)throw new Error('对象所属镜头已删除。');sceneIndex=index}stage=4;workbench.mode='layer';workflow.result='draft';renderStage();await publishSelection()},
  openScene:async id=>{const index=draft!.scenes.findIndex(scene=>scene.id===id);await selectScene(index);await openInspector('voice')},
  previewGeometry:(value,ref)=>preview.visualEdit(value,ref),pausePreview:()=>preview.pause(),openFilm:()=>openInspector('film'),
  splitMain:()=>mainEditor.split(),
  ask:async ref=>{await flushEdits();editable();const value=studioLayer(draft!,ref);await publishSelection();await publishStudioGeometry();await api.prefill('请调整视频「'+draft!.title+'」中的'+(ref.kind==='audio'?'音轨':'图层')+'「'+value.title+'」（对象 ID '+ref.id+'，'+(ref.sceneId?'镜头 ID '+ref.sceneId:'全片对象')+'）：');message('对象范围已填写；补充要求后发送。已有消息会保留。')},
  notify:message,bytes,refreshPreview:async()=>{if(draft?.scenes.length&&!draftReadiness(draft).issues.some(issue=>issue.code==='layer-range'))await prepare()}
})
const panels=new StudioPanels(()=>({active:workflow.view.mode==='advanced'&&stage===4&&Boolean(draft)&&workbench.mode!=='delivery',disabled:busy||invalidProject||viewChanging||Boolean(savePending)}),()=>flushEdits(),message)
const mainEditor=new StudioMainEditor({
 splitScene:async(owner,sceneId,splitSeconds)=>{
  if(invalidProject||state.project.id!==owner.projectId||draft?.id!==owner.draftId||draft.revision!==owner.revision)throw new Error('STUDIO_CONFLICT: 分割所属草稿或版本已变化。');
  await flushEdits(true,false,true,true,true,false);editable();if(draft!.revision!==owner.revision)throw new Error('STUDIO_CONFLICT: 保存期间版本变化。');
  const previous=captureHistory(draft!),result=mediaRecord(await command({operation:'split-scene',draftId:owner.draftId,expectedRevision:owner.revision,sceneId,splitSeconds})),next=assertVideoDraft(result.draft),selection=mediaRecord(result.selection);
  if(next.id!==owner.draftId||next.ownerSessionId!==draft!.ownerSessionId||selection.kind!=='scene'||typeof selection.sceneId!=='string'||!next.scenes.some(s=>s.id===selection.sceneId))throw new Error('无效的分割结果，请重新加载。');
  undo.push(previous);undo=undo.slice(-40);redo=[];restorePending=undefined;draft=next;dirty=false;previewDirty=true;workflow.result='draft';await refresh(true,false);render();
  return {draft:next,selection:{kind:'scene',sceneId:selection.sceneId}};
 },
 state:()=>state&&draft?{projectId:state.project.id,draft,sceneId:draft.scenes[sceneIndex]?.id,advanced:workflow.view.mode==='advanced'&&stage===4,disabled:busy||invalidProject||viewChanging||Boolean(savePending),blocked:Boolean(pendingField||pendingOutput||layerEditor.hasPending()),mode:workbench.mode,time:Number(input('seek').value)}:undefined,
 commit:async(owner,change)=>{if(invalidProject||state.project.id!==owner.projectId||draft?.id!==owner.draftId||draft.revision!==owner.revision)throw new Error('STUDIO_CONFLICT: 时间轴所属草稿或版本已变化；原输入保留。');await flushEdits(true,false,true,true,true,false);editable();if(draft!.revision!==owner.revision)throw new Error('STUDIO_CONFLICT: 保存期间版本变化。');const next=assertVideoDraft(change(clone(draft!)));history();draft=next;render();await save(false)},
 select:async(ref,seconds)=>{editable();const index=draft!.scenes.findIndex(s=>s.id===ref.sceneId);if(index<0)throw new Error('镜头已删除。');layerEditor.selection=undefined;sceneIndex=index;stage=4;workbench.mode=ref.kind==='voice'?'voice':ref.kind==='caption'?'captions':'visual';workflow.result='draft';if(seconds!==undefined)input('seek').value=String(seconds);render();await publishSelection()},
 refreshPreview:async()=>{if(draft?.scenes.length){const time=Number(input('seek').value);await prepare();await preview.seek(Math.min(time,Math.max(0,preview.duration-1/draft.fps)))}},pause:()=>preview.pause(),notify:message,changed:()=>setBusy(busy),
})
const cards=new StudioCards(()=>({state,draft,index:sceneIndex,simple:workflow.view.mode==='simple',stage,mode:workbench.mode,pending:Boolean(pendingField||pendingOutput||dirty||cardText.hasPending()||layerEditor.hasPending()),disabled:busy||invalidProject||viewChanging||Boolean(savePending)||Boolean(draft&&workflow.view.mode==='simple'&&!studioCompatibility(draft).simpleEditable)}),{
  select:selectScene,advanced:()=>changeView('advanced'),open:openInspector,pause:()=>preview.pause(),flush:()=>flushEdits(),notify:message,
  text:async()=>{await flushEdits();workflow.result='draft';renderStage();await cardText.openCard()},
  material:async matching=>{await flushEdits();editable();preview.pause();stage=matching?3:0;renderStage()},
  action:async id=>{if(id==='add-scene'){await addScene();stage=4;workbench.mode='visual';render();return}await mutateScene(id)},
  move:async(id,targetId,after,owner)=>{
    const assertOwner=()=>{if(invalidProject||state.project.id!==owner.projectId||(state.sessionId??null)!==owner.sessionId||draft?.id!==owner.draftId||draft.revision!==owner.revision||workflow.view.mode!=='simple')throw new Error('STUDIO_CONFLICT: 镜头调序所属草稿或版本已变化，请重新拖动。')}
    assertOwner();await flushEdits();assertOwner();editable();const from=draft!.scenes.findIndex(s=>s.id===id),target=draft!.scenes.findIndex(s=>s.id===targetId);if(from<0||target<0||from===target)return
    const to=target+(after?1:0)-(from<target?1:0);if(to===from)return
    history();const selected=scene().id,item=draft!.scenes.splice(from,1)[0];draft!.scenes.splice(to,0,item);sceneIndex=draft!.scenes.findIndex(s=>s.id===selected);render();await save(false);message('镜头顺序已更新，可撤销。')
  },
  ask:async id=>{await flushEdits();if(!draft)return;const value=draft.scenes.find(s=>s.id===id);if(!value)throw new Error('镜头已变化，请重新选择。');await api.prefill('请调整当前视频「'+draft.title+'」中的镜头「'+value.title+'」（镜头 ID '+value.id+'）：');message('已填写镜头范围，请补充要求后发送。')},
  thumbnail:(container,id)=>{const asset=state.assets.find(a=>a.artifactId===id);if(asset)materials.renderPicker(container,[asset],id)}
})
let reviewFrames:{id:string;revision:number;images:string[]}|undefined
function renderTextReview():void{
 renderReviewProposals()
 const issues=element('studio-review-issues'),frames=element('studio-review-frames');issues.replaceChildren();frames.replaceChildren();if(!draft){element('studio-review-status').textContent='';return}
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d')!;let count=0,errors=0,offset=0
 for(const [index,value]of draft.scenes.entries()){
  try{for(const issue of reviewSceneText(context,speechScene(value),draft.width,draft.height,value.audioDurationSeconds)){count++;if(issue.severity==='error')errors++;const seconds=offset+issue.seconds,node=button(value.title+'：'+issue.message,()=>seekTo(seconds));node.classList.add('production-issue');node.dataset.severity=issue.severity;issues.append(node)}}catch(error){errors++;issues.append(paragraph(error instanceof Error?error.message:String(error)))}
  const at=offset+Math.min(1,value.durationSeconds/2);const node=button(`${index+1} · ${value.title}`,()=>seekTo(at));if(reviewFrames?.id===draft.id&&reviewFrames.revision===draft.revision&&reviewFrames.images[index]){const image=document.createElement('img');image.src=reviewFrames.images[index];image.alt=value.title+'关键帧';image.style.width='120px';image.style.display='block';node.prepend(image)}frames.append(node);offset+=value.durationSeconds
 }
 element('studio-review-status').textContent=`当前草稿 v${draft.revision} · ${errors} 项需修正 · ${count-errors} 项审阅提示。点击分镜查看关键帧；这不代表内容事实已经核查。`
}
function renderReviewProposals():void {
 const container=element('studio-review-proposals'),opened=new Set([...container.querySelectorAll<HTMLDetailsElement>('details[open]')].map(n=>n.dataset.reviewId));container.replaceChildren()
 const launcher=element<HTMLButtonElement>('studio-review-assistant');launcher.disabled=busy||invalidProject||viewChanging||Boolean(savePending)||!draft?.scenes.length
 if(!draft?.reviewItems?.length){container.append(paragraph('暂无审阅建议。'));return}
 const labels={title:'镜头标题',narration:'旁白脚本',visualBrief:'画面说明',captionStyle:'字幕样式',captionDisplay:'字幕显示'},statuses={pending:'待处理',adopted:'已采纳',dismissed:'已忽略',undone:'已撤销'}
 for(const item of draft.reviewItems){
  const scene=draft.scenes.find(s=>s.id===item.sceneId),node=document.createElement('details');node.className='review-proposal';node.dataset.reviewId=item.id;node.open=opened.has(item.id)
  const reverting=item.status==='adopted',actionable=['pending','adopted'].includes(item.status),applicable=studioReviewApplicable(draft,item,reverting),summary=document.createElement('summary')
  summary.textContent=(scene?.title??'镜头已删除')+' · '+labels[item.field]+' · '+statuses[item.status]+(actionable&&!applicable?' · 内容已变化':'');node.append(summary)
  const evidence=paragraph((item.origin==='agent'?'Assistant 建议':'用户建议')+' · 基于 v'+item.revision+' · '+format(item.seconds)+'（镜头内）\n'+item.reason);evidence.className='review-reason';node.append(evidence)
  for(const [label,text]of [['修改前',studioReviewValueLabel(item,'before')],['建议修改为',studioReviewValueLabel(item,'after')]]){const block=document.createElement('div'),heading=document.createElement('strong'),content=document.createElement('p');heading.textContent=label;content.textContent=text||'（空）';block.className='review-diff';block.append(heading,content);node.append(block)}
  if(item.field==='captionStyle'||item.field==='captionDisplay')node.append(paragraph('仅改变此镜头字幕显示；字幕原文、译文、时间和已生成旁白保留。'))
  if(actionable&&!applicable)node.append(paragraph('此字段、镜头或定位时间已变化，请重新审阅。当前内容会保留。'))
  const row=document.createElement('div');row.className='row'
  if(scene){const locate=button('定位镜头',()=>locateReview(item));locate.dataset.reviewAction='locate';row.append(locate)}
  if(actionable){const operation=reverting?'undo-review':'adopt-review',action=button(reverting?'撤销这条修改':'采纳这条建议',()=>processReview(item.id,operation));action.dataset.reviewAction=reverting?'undo':'adopt';action.disabled=action.disabled||!applicable;row.append(action)}
  if(item.status==='pending'){const dismiss=button('忽略',()=>processReview(item.id,'dismiss-review'));dismiss.dataset.reviewAction='dismiss';row.append(dismiss)}
  node.append(row);container.append(node)
 }
}
async function locateReview(item:StudioReviewItem):Promise<void>{
 const owner={projectId:state.project.id,sessionId:state.sessionId,draftId:draft?.id};await flushEdits();editable()
 if(state.project.id!==owner.projectId||state.sessionId!==owner.sessionId||draft?.id!==owner.draftId)throw new Error('审阅所属视频已切换。')
 const index=draft.scenes.findIndex(s=>s.id===item.sceneId);if(index<0)throw new Error('此建议的镜头已删除。')
 await seekTo(draft.scenes.slice(0,index).reduce((sum,s)=>sum+s.durationSeconds,0)+Math.min(item.seconds,draft.scenes[index].durationSeconds-1/draft.fps),'visual');await publishSelection()
}
async function processReview(reviewId:string,operation:'adopt-review'|'dismiss-review'|'undo-review'):Promise<void>{
 const owner={projectId:state.project.id,sessionId:state.sessionId,draftId:draft?.id};await flushEdits();editable()
 if(state.project.id!==owner.projectId||state.sessionId!==owner.sessionId||draft?.id!==owner.draftId)throw new Error('审阅所属视频已切换。')
 const previous=draft,result=assertVideoDraft(await command({operation,draftId:draft.id,expectedRevision:draft.revision,reviewId}))
 const same=sameStudioDraftContent(previous,result);if(!same){preview.pause();previewDirty=true;workflow.result='draft';checked=undefined;reviewFrames=undefined}
 else{if(reviewFrames?.id===result.id)reviewFrames.revision=result.revision;if(!previewDirty&&!previewPreparing&&!preview.advanceRevision(previous,result,state.assets,state.assets))previewDirty=true}
 draft=result;dirty=false;await refresh();render();message(operation==='adopt-review'?'已采纳这一条建议；其他内容保留。':operation==='undo-review'?'已撤销这一条修改；期间的其他编辑保留。':'此建议已忽略，视频内容未改动。')
}
async function prepare():Promise<void>{
  if(previewPreparation)await previewPreparation
  if(!draft||!previewDirty)return
  if(!draft.scenes.length)throw new Error('请先创建分镜，再预览视频。')
  const current=draft,position=preview.duration?Number(input('seek').value):current.scenes.slice(0,sceneIndex).reduce((sum,scene)=>sum+scene.durationSeconds,0);previewPreparing=true
  for(const id of ['play','seek','timeline-split'])element<HTMLButtonElement>(id).disabled=true
  const pending=(async()=>{message('正在准备预览…');const ready=await preview.prepare(clone(current),position);if(!ready||draft!==current)return;previewDirty=false;if(stage===4&&workbench.mode!=='cover')render();input('seek').max=String(preview.duration);element('preview-empty').hidden=true;if(!pendingField&&!pendingOutput&&!cardText.hasPending()&&!mainEditor.hasPending()&&!layerEditor.hasPending())message(dirty?'有未保存修改':'已保存 · v'+draft.revision)})()
  previewPreparation=pending
  try{await pending}finally{if(previewPreparation===pending)previewPreparation=undefined;previewPreparing=false;renderStage();for(const id of ['play','seek'])element<HTMLButtonElement>(id).disabled=busy||invalidProject||viewChanging||Boolean(savePending)||Boolean(previewPreparation)||mainEditor.isApplying()||!draft?.scenes.length}
}
async function selectScene(index:number):Promise<void>{
  const selection=++sceneSelection;await flushEdits();editable();if(selection!==sceneSelection||!draft||!draft.scenes[index])return
  const current=draft
  layerEditor.selection=undefined;mainEditor.clearSelection();workflow.result='draft';sceneIndex=index;if(stage===0)stage=3;if(stage===4&&['cover','delivery','layer','film'].includes(workbench.mode))workbench.mode='visual';render()
  if(stage!==4||workbench.mode==='cover')return
  await prepare()
  if(selection!==sceneSelection||draft!==current||invalidProject)return
  await preview.seek(current.scenes.slice(0,index).reduce((sum,item)=>sum+item.durationSeconds,0))
}
function choose(value:VideoDraft|undefined):void{if(pendingOutput&&value?.id!==pendingOutput.draftId)throw new Error('请先应用全片参数，再切换视频。');cardText.discard();saveFailure=undefined;const initialCards=Boolean(value?.scenes.length&&!draft?.scenes.length),newResult=value?.id!==draft?.id||value?.exports.length!==draft?.exports.length;if(value?.id!==draft?.id)advancedInspector='visual';reviewFrames=undefined;originalSpeechEditor.clear();speechEditor.clear();coverEditor.clear();clearExport();element('studio-subtitle-exports').replaceChildren();sceneSelection++;const selectedId=draft?.id===value?.id?draft?.scenes[sceneIndex]?.id:undefined;draft=value?clone(value):undefined;if(newResult||initialCards){if(initialCards)cards.finishPreparation();workflow.result=workflow.view.mode==='simple'&&draft?.exports.length?'completed':'draft';if(draft?.scenes.length&&workflow.view.mode==='simple'){stage=4;workbench.mode='visual'}}sceneIndex=Math.max(0,draft?.scenes.findIndex(scene=>scene.id===selectedId)??0);if(draft&&!draft.scenes.length&&stage===4)stage=0;dirty=false;undo=[];redo=[];restorePending=undefined;previewDirty=true;element('preview-empty').hidden=false;input('seek').max='1';input('seek').value='0';void preview.dispose().catch(error=>message(String(error)));render();message(draft?'草稿已保存':state?.sessionId?'此对话还没有视频草稿':'请先选择对话')}
async function refresh(preserve=true,renderView=true):Promise<boolean>{
  const epoch=workspaceEpoch
  // Every caller waits for its own fresh snapshot after preceding reads. A GUI
  // command must not continue with old asset metadata when another read overlaps.
  const pending=stateRefresh.catch(()=>{}).then(async()=>{
    if(epoch!==workspaceEpoch||invalidProject||workspaceHidden)return false
    const raw=mediaRecord(await api.state())
    if(epoch!==workspaceEpoch||invalidProject||workspaceHidden)return false
    state={sessionId:typeof raw.sessionId==='string'?raw.sessionId:undefined,project:mediaRecord(raw.project) as unknown as StudioState['project'],drafts:(raw.drafts as unknown[]).map(assertVideoDraft),assets:raw.assets as StudioAsset[],theme:raw.theme as StudioState['theme'],videoPreferences:normalizeVideoPreferences(raw.videoPreferences??{}),reusableExports:mediaRecord(raw.reusableExports??{}) as Record<string,string>,snapshotProofs:mediaRecord(raw.snapshotProofs??{}) as Record<string,string>};workflow.hydrate(raw.view);workflow.activity=(raw.activity??null) as FeatureAssistantActivity|null;renderOutputTemplates();document.body.classList.toggle('dark',state.theme==='dark');element('project-name').textContent=state.project.name
  if(renderView){if(!preserve||!draft)choose(state.drafts.find(item=>item.id===draft?.id)??state.drafts[0]);else{renderSelect();renderStage()}}
    return true
  })
  stateRefresh=pending.then(()=>{},()=>{})
  return pending
}

function hasLocalInput():boolean{return dirty||Boolean(pendingField||pendingOutput)||cardText.hasPending()||originalSpeechEditor.hasPending()||layerEditor.hasPending()||mainEditor.hasPending()}
async function reconcileExternal(previousAssets:StudioAsset[]):Promise<void>{
  const latest=draft?state.drafts.find(value=>value.id===draft!.id):state.drafts[0]
  if(hasLocalInput()){
    renderDeliveryHistory()
    if(saveFailure){message(saveFailure);return}
    message(latest?.exports.at(-1)?.artifactId!==draft?.exports.at(-1)?.artifactId?'后台有新成片，当前输入已保留；可在交付历史查看。保存时会检查版本。':'草稿有外部更新。当前输入已保留；保存时会检查版本，需要时重新加载合并。')
    return
  }
  if(!draft||!latest){choose(latest)}
  else if(latest.revision<draft.revision)return
  else if(latest.revision!==draft.revision){
    const previous=draft,selectedId=draft.scenes[sceneIndex]?.id,same=sameStudioDraftContent(previous,latest)
    const prepared=same&&!previewDirty&&!previewPreparing&&preview.advanceRevision(previous,latest,previousAssets,state.assets)
    if(!same){preview.pause();undo=[];redo=[];originalSpeechEditor.clear();speechEditor.clear();coverEditor.clear();clearExport();element('studio-subtitle-exports').replaceChildren();workflow.result='draft'}
    draft=clone(latest);sceneIndex=Math.max(0,draft.scenes.findIndex(value=>value.id===selectedId));checked=undefined;if(same&&reviewFrames?.id===draft.id)reviewFrames.revision=draft.revision;else reviewFrames=undefined
    if(!prepared)previewDirty=true
    if(workflow.view.mode==='simple'&&!previous.scenes.length&&draft.scenes.length){cards.finishPreparation();stage=4;workbench.mode='visual';workflow.result='draft'}
    const output=draft.exports.at(-1),newOutput=output&&output.artifactId!==previous.exports.at(-1)?.artifactId&&state.reusableExports?.[draft.id]===output.artifactId
    if(newOutput&&workflow.view.mode==='simple'&&stage===4&&workbench.mode==='visual'){preview.pause();workflow.result='completed'}
    render()
  }else{if(!previewDirty&&!previewPreparing&&!preview.advanceRevision(draft,latest,previousAssets,state.assets))previewDirty=true;renderSelect();renderStage()}
  if(!draft||workspaceHidden||invalidProject)return
  if(stage===4&&workbench.mode!=='cover'&&workflow.result==='draft'&&workbench.mode!=='delivery'&&draft.scenes.length)await prepare()
  else if(stage===4&&(workflow.result==='completed'||workbench.mode==='delivery')){const output=draft.exports.at(-1);if(output&&shownOutput!==output.artifactId)await showExport(output.artifactId,output.verificationArtifactId)}
}
/** Coalesce owned notifications. Busy operations drain first; no command is replayed. */
function requestExternalRefresh():void{
  externalRequested=true
  if(externalRefresh||busy||savePending||viewChanging||workspaceHidden||invalidProject)return
  const pending=(async()=>{
    while(externalRequested&&!busy&&!savePending&&!viewChanging&&!workspaceHidden&&!invalidProject){
      externalRequested=false
      const current=draft,previousAssets=state?.assets??[]
      if(!await refresh(true,false)){externalRequested=true;continue}
      if(busy||savePending||viewChanging){externalRequested=true;break}
      if(draft!==current){externalRequested=true;continue}
      await reconcileExternal(previousAssets)
    }
  })()
  externalRefresh=pending
  void pending.catch(error=>message(String(error))).finally(()=>{if(externalRefresh===pending)externalRefresh=undefined;if(externalRequested&&!workspaceHidden&&!invalidProject&&!busy&&!savePending&&!viewChanging)requestExternalRefresh()})
}

async function publishSelection():Promise<void>{if(invalidProject)return;if(!draft){await api.selection(null);return}const ref=workbench.mode==='layer'?layerEditor.selection:undefined,sceneId=ref?ref.sceneId:stage===0||workbench.mode==='film'?undefined:draft.scenes[sceneIndex]?.id;if(sceneId&&dirty&&!state.drafts.find(item=>item.id===draft.id)?.scenes.some(item=>item.id===sceneId))return;await api.selection({draftId:draft.id,...(sceneId?{sceneId,...(['visual','voice','captions'].includes(workbench.mode)?{objectKind:workbench.mode}:{})}:{}),...(ref?{layer:{id:ref.id,kind:ref.kind}}:{}),...(workbench.mode==='voice'&&mainEditor.selection?.sceneId===sceneId&&mainEditor.selection.voiceSegmentId?{voiceSegmentId:mainEditor.selection.voiceSegmentId}:{}),...(workbench.mode==='visual'&&mainEditor.selection?.sceneId===sceneId&&mainEditor.selection?.kind==='visual'&&mainEditor.selection.visualSegmentId?{visualSegmentId:mainEditor.selection.visualSegmentId}:{}),stage,revision:draft.revision,dirty}).catch(error=>message(String(error)))}
async function openInspector(mode:InspectorMode):Promise<void>{
  await flushEdits();editable();const time=Number(input('seek').value);preview.pause();layerEditor.selection=undefined;stage=4;workbench.mode=mode;renderStage();void publishSelection()
  if(mode==='cover')await coverEditor.preview()
  else if(mode==='delivery'){const latest=draft?.exports.at(-1);if(latest)await showExport(latest.artifactId,latest.verificationArtifactId)}
  else if(draft?.scenes.length){await prepare();await preview.seek(time)}
}
async function seekTo(seconds:number,mode?:InspectorMode):Promise<void>{
  await flushEdits();editable();if(!draft?.scenes.length)return
  if(mode)layerEditor.selection=undefined;if(!layerEditor.selection)sceneIndex=studioSceneIndex(draft,seconds);workflow.result='draft';stage=4;if(mode)workbench.mode=mode;else if(workbench.mode==='cover')workbench.mode='visual'
  render();await prepare();await preview.seek(seconds)
}
function renderWorkbenchAssets():void{
  const list=element('workbench-asset-list');list.replaceChildren();if(stage!==4||!draft)return
  const ids=new Set([...draft.preparation.artifactIds,...(draft.layers??[]).map(l=>l.artifactId),...(draft.audioTracks??[]).map(l=>l.artifactId),...draft.scenes.flatMap(value=>[...sceneVisuals(value).flatMap(visual=>[visual.imageArtifactId,visual.videoArtifactId]),value.audioArtifactId,...(value.layers??[]).map(l=>l.artifactId),...(value.audioTracks??[]).map(l=>l.artifactId)])])
  materials.renderPicker(list,state.assets.filter(asset=>ids.has(asset.artifactId)),undefined)
}
function renderDeliveryHistory():void{
  const list=element('delivery-history');list.replaceChildren();if(!draft)return
  for(const output of [...(state.drafts.find(value=>value.id===draft!.id)?.exports??draft.exports)].reverse()){const node=button(`${state.reusableExports?.[draft.id]===output.artifactId?'当前可复用 · ':''}v${output.revision} · ${output.artifactId}`,()=>showExport(output.artifactId,output.verificationArtifactId));node.className='delivery-record';list.append(node)}
  if(!list.childElementCount)list.append(paragraph('尚无成片；封面可以独立制作。'))
}
function renderSelect():void{select('draft-select').replaceChildren(...state.drafts.map(value=>{const option=document.createElement('option');option.value=value.id;option.textContent=value.title;option.selected=value.id===draft?.id;return option}))}
function renderOutputTemplates():void{const presets=select('studio-output-template'),selected=presets.value;presets.replaceChildren(new Option('当前视频参数',''),...(state.videoPreferences?.templates??[]).map(item=>new Option(item.name,item.name)));presets.value=selected}
function visibleCoverage(value:StudioScene):ReturnType<typeof sceneCoverage>{
  const base=sceneCoverage(value,draft?.tts),measured=checked?.draftId===draft?.id&&checked.revision===draft?.revision&&!dirty?checked.scenes.find(item=>item.sceneId===value.id):undefined
  return measured?{...base,available:measured.availableSeconds,gap:measured.gapSeconds,measured:measured.measured}:base
}
function render():void{
  renderSelect();sceneList.replaceChildren();if(!draft){input('draft-title').value='';renderStage();stageContent.replaceChildren();void publishSelection();return}
  if(!pendingOutput)outputForm.fill(optionsFromOutput(draft));element('studio-output-current').textContent=`当前 ${draft.width} × ${draft.height} · ${draft.fps} fps${draft.templateName?' · '+draft.templateName:''}`
  if(!pendingOutput){renderOutputTemplates();select('studio-output-template').value=''}
  const canvas=element<HTMLCanvasElement>('preview');canvas.style.aspectRatio=String(draft.width/draft.height)
  draft.scenes.forEach((value,index)=>{const button=document.createElement('button');button.className='scene'+(index===sceneIndex?' selected':'');const title=document.createElement('div');title.textContent=`${String(index+1).padStart(2,'0')}  ${value.title}`;const detail=document.createElement('span');const coverage=visibleCoverage(value);detail.textContent=`${value.durationSeconds.toFixed(1)}s · ${coverage.audioStale?'旁白待制作':value.audioArtifactId?'旁白已就绪':'无旁白'}${!coverage.measured?' · 时长待测量':value.videoArtifactId&&coverage.gap>.05?' · 缺画面':''}`;button.append(title,detail);button.onclick=guarded(()=>selectScene(index));materials.bindDrop(button,value.id);sceneList.append(button)
  })
  input('music').checked=draft.music;input('draft-title').value=draft.title;if(!draft.scenes.length){renderStage();message(dirty?'有未保存修改':`已保存 · v${draft.revision}`);void publishSelection();return}
  const value=scene();input('scene-title').value=value.title;input('scene-label').value=value.label;area('narration').value=value.narration;area('visual-brief').value=value.visualBrief;area('sources').value=value.sources.join('\n');area('bullets').value=value.bullets.join('\n');input('duration').value=String(value.durationSeconds);input('source-start').value=String(value.sourceStartSeconds);input('rate').value=String(value.playbackRate);input('gain').value=String(value.voiceVolume??1);input('voice-muted').checked=Boolean(value.voiceMuted);select('end-policy').value=value.endPolicy;select('layout').value=value.layout??'presentation';for(const id of ['source-start','rate','crop-x','crop-y','crop-width','crop-height'])input(id).disabled=busy||viewChanging||Boolean(savePending)||Boolean(value.visualSegments)
  const crop=value.crop??{x:0,y:0,width:1,height:1};for(const key of ['x','y','width','height'] as const)input('crop-'+key).value=String(crop[key]);area('captions').value=value.captions?.map(cue=>`${cue.startSeconds} | ${cue.endSeconds} | ${cue.text}`).join('\n')??''
  element('scene-citations').replaceChildren(...(value.citations??[]).map((citation,index)=>{const row=document.createElement('div'),text=document.createElement('p');text.textContent=(citation.kind==='fact'?'事实引用 · 待核查':'作者观点')+' · '+(citation.conflict==='conflicting'?'存在冲突':'待确认')+'：'+citation.claim+' · '+citation.quote;row.append(text,button('移除此引用',async()=>{await flushEdits();history();scene().citations?.splice(index,1);render();await save(false)}));return row}))
  const coverage=visibleCoverage(value);element('coverage').textContent=`旁白 ${value.audioDurationSeconds?.toFixed(1)??'—'}s · 分镜 ${value.durationSeconds.toFixed(1)}s${value.videoArtifactId?` · 可用画面 ${coverage.measured?coverage.available.toFixed(1)+'s · 缺口 '+coverage.gap.toFixed(1)+'s':'待测量'}`:''}${coverage.audioStale?'\n脚本或音色/语速待生成旁白；已有音频不会自动更新。':''}`
  element<HTMLButtonElement>('undo').disabled=!undo.length||busy||viewChanging||Boolean(savePending)||mainEditor.isApplying();element<HTMLButtonElement>('redo').disabled=!redo.length||busy||viewChanging||Boolean(savePending)||mainEditor.isApplying();renderStage();message(dirty?'有未保存修改':`已保存 · v${draft.revision}`);void publishSelection()
}
function button(text:string,fn:()=>Promise<void>|void):HTMLButtonElement{const value=document.createElement('button');value.textContent=text;value.disabled=busy||invalidProject||viewChanging||Boolean(savePending);value.onclick=guarded(fn);return value}
function paragraph(text:string):HTMLElement{const value=document.createElement('p');value.textContent=text;return value}

function renderScript():void{
  if(!draft)return
  area('script-current').readOnly=simpleReadOnly();area('narration').readOnly=simpleReadOnly();area('visual-brief').readOnly=simpleReadOnly();area('preparation-notes').readOnly=simpleReadOnly();area('preparation-outline').readOnly=simpleReadOnly()
  const disabled=busy||invalidProject||viewChanging||Boolean(savePending)||simpleReadOnly(),current=draft.scenes[sceneIndex]
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
    const visual=paragraph(value.visualBrief||'尚无画面说明');visual.className='storyboard-visual'
    const source=paragraph(value.sources.length?'来源：'+value.sources.join(' · '):'尚无来源链接');source.className='storyboard-source';node.append(visual,source)
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
  element('script-current-note').textContent=workflow.view.mode==='simple'?'修改会自动保存，并使此段旁白过期。可在右侧请 Assistant 更新此段，或进入高级编辑手动生成；字幕单独保留。':sceneCoverage(current,draft?.tts).audioStale?'脚本或音色/语速已变更，已有旁白已过期；点击「生成/重新生成旁白」只更新此段。':'修改脚本后自动保存，只有此段旁白需要重新生成。字幕内容在编辑与预览中单独修改。'
  element('script-audio-status').textContent=`${current.audioArtifactId?(sceneCoverage(current,draft?.tts).audioStale?'已有音频待重做':'旁白已就绪'):'尚未生成'} · ${current.audioDurationSeconds?.toFixed(1)??'—'}s · ${audioGenerationLabel(current)}`
  element('script-narrate').textContent=current.audioArtifactId?'重新生成此段旁白':'生成此段旁白';element<HTMLButtonElement>('script-narrate').disabled=disabled||!current.narration.trim()
  element<HTMLButtonElement>('script-listen').disabled=disabled||!current.audioArtifactId
  element<HTMLButtonElement>('script-remove-voice').disabled=disabled||!current.audioArtifactId&&!current.narration
  const raw=select('script-raw-audio');raw.replaceChildren(new Option('选择原始音频',''),...state.assets.filter(asset=>asset.kind==='audio'&&draft!.preparation.artifactIds.includes(asset.artifactId)).map(asset=>new Option(asset.artifactId,asset.artifactId)))
  if(state.assets.some(asset=>asset.artifactId===current.audioArtifactId&&draft!.preparation.artifactIds.includes(asset.artifactId)))raw.value=current.audioArtifactId!
  raw.disabled=disabled;element<HTMLButtonElement>('script-bind-audio').disabled=disabled
}
function renderStage():void{
  renderMaterialAssistant()
  const compatibility=draft?studioCompatibility(draft):undefined
  const toggle=element<HTMLButtonElement>('view-toggle');toggle.title=compatibility&&!compatibility.simpleEditable?compatibility.blockingReasons.map(r=>r.message).join(' ' )+' 撤销或移除后可返回卡片。':'';toggle.setAttribute('aria-label',workflow.view.mode==='advanced'&&!compatibility?.simpleEditable&&draft?'返回卡片不可用：'+toggle.title:workflow.view.mode==='advanced'?'返回卡片':'高级编辑')
  sourceEditor.render();element<HTMLButtonElement>('studio-export-citations').disabled=busy||invalidProject||viewChanging||Boolean(savePending)||!draft
  const hasScene=Boolean(draft?.scenes.length),disabled=busy||invalidProject||viewChanging||Boolean(savePending)||mainEditor.isApplying()
  element<HTMLButtonElement>('timeline-split').disabled=disabled||previewPreparing||Boolean(previewPreparation)||!hasScene
  element('timeline-split').textContent=workbench.mode==='layer'?'分割对象':mainEditor.selection?.kind==='scene'?'分割整镜头':mainEditor.selection?.kind==='voice'?'分割旁白':mainEditor.selection?.kind==='caption'?'分割字幕':'分割画面'
  input('timeline-position').disabled=disabled||Boolean(previewPreparation)||!hasScene
  element('empty-workspace').hidden=Boolean(draft)
  element('empty-workspace').querySelector('p')!.textContent=state?.sessionId?'在右侧描述目标，Assistant 会准备素材、编写脚本并制作可播放的初稿。':'请先在右侧选择一个对话，再开始制作视频。'
  for(const id of ['new-draft','empty-create'])element<HTMLButtonElement>(id).disabled=disabled||!state?.sessionId
  for(const id of ['draft-title','draft-select','delete-draft','save','settings-open','delivery-open','add-scene','duplicate','remove-scene','move-up','move-down'])element<HTMLButtonElement>(id).disabled=disabled||!draft
  document.querySelectorAll('[data-stage]').forEach(item=>{(item as HTMLButtonElement).disabled=disabled||!draft&&((item as HTMLElement).dataset.stage!=='0'||!state?.sessionId)})
  const template=hasScene?scene().sceneTemplate:undefined;select('scene-template').value=template?.kind??'';element('scene-template-options').hidden=!template;for(const [id,key,fallback] of [['template-accent','accentColor','#2369db'],['template-background','backgroundColor','#f8fafc'],['template-text','textColor','#172536']] as const)input(id).value=template?.[key]??fallback;select('template-emphasis').value=template?.emphasisIndex===undefined?'':String(template.emphasisIndex)
  input('scene-number').checked=!hasScene||scene().showSceneNumber!==false;input('scene-number').disabled=disabled||!hasScene
  if(hasScene)for(const id of ['source-start','rate','crop-x','crop-y','crop-width','crop-height'])input(id).disabled=disabled||Boolean(scene().visualSegments)
  input('voice-muted').disabled=disabled||!hasScene||!draft?.scenes[sceneIndex]?.audioArtifactId
  if(stage>=3&&hasScene){input('keep-source-audio').checked=Boolean(scene().keepSourceAudio);input('source-volume').value=String(scene().sourceVolume??1);input('keep-source-audio').disabled=disabled||!scene().videoArtifactId;input('source-volume').disabled=disabled||!scene().videoArtifactId}
  document.querySelectorAll('[data-stage]').forEach(item=>{item.classList.toggle('active',Number((item as HTMLElement).dataset.stage)===stage);item.setAttribute('aria-pressed',String(Number((item as HTMLElement).dataset.stage)===stage))})
  element<HTMLButtonElement>('studio-cover-open').disabled=disabled||!draft
  coverEditor.render()
  element('scene-navigation').hidden=!draft||stage===0&&!hasScene
  element('preparation-workspace').hidden=!draft||stage!==0;element('script-workspace').hidden=!draft||stage!==1&&stage!==2
  for(const id of ['play','seek'])element<HTMLButtonElement>(id).disabled=disabled||Boolean(previewPreparation)||!hasScene
  element<HTMLButtonElement>('export').disabled=disabled||!hasScene
  const reusable=Boolean(draft&&state.reusableExports?.[draft.id]&&!dirty)
  element('export').textContent=reusable?'导出已有视频':draft?.exports.length?'确认制作更新':'确认生成视频'
  element<HTMLButtonElement>('export-existing').disabled=disabled||!draft?.exports.length
  element<HTMLButtonElement>('export-remake').disabled=disabled||!hasScene
  element('export-note').textContent=reusable?'视频与源素材未变化，可直接使用已有成片。':draft?.exports.length?'成片记录可直接查看和另存；制作当前修改请重新导出。':'制作完成后，可在此查看和另存成片。'
  const report=checked?.draftId===draft?.id&&checked?.revision===draft?.revision&&!dirty?checked:draft?draftReadiness(draft):undefined
  const pendingNames=draft?.scenes.filter(scene=>report?.pendingNarrationSceneIds.includes(scene.id)).map((scene,index)=>scene.title||`镜头 ${index+1}`)??[]
  element('production-plan').textContent=reusable?'当前成片有效，直接打开 MP4 并另存。':pendingNames.length?`将更新 ${pendingNames.length} 段旁白，随后制作完整新视频；旧成片保留。`:'旁白保持有效；将检查素材并制作完整新视频，旧成片保留。'
  element('production-affected-scenes').hidden=reusable||!pendingNames.length;const affected=element('production-affected-list');affected.replaceChildren();for(const name of pendingNames){const item=document.createElement('li');item.textContent=name;affected.append(item)}
  element<HTMLButtonElement>('studio-narrate-pending').disabled=disabled||!report?.pendingNarrationSceneIds.length
  element<HTMLButtonElement>('studio-check').disabled=disabled||!hasScene
  for(const id of ['studio-export-srt','studio-export-vtt'])element<HTMLButtonElement>(id).disabled=disabled||!hasScene
  element('studio-production-summary').textContent=report?`${draft!.scenes.length} 个分镜 · 总长 ${report.durationSeconds.toFixed(1)} 秒 · ${report.pendingNarrationSceneIds.length} 段旁白待制作${report===checked?' · 已检查素材与实测时长':' · 保存后可检查素材与实测时长'}`:''
  renderTextReview()
  element('studio-issues').replaceChildren()
  for(const issue of report?.issues??[]){const node=issue.sceneId?button(issue.message,()=>selectScene(draft!.scenes.findIndex(scene=>scene.id===issue.sceneId))):paragraph(issue.message);node.classList.add('production-issue');node.dataset.severity=issue.severity;element('studio-issues').append(node)}
  element<HTMLButtonElement>('undo').disabled=disabled||!undo.length;element<HTMLButtonElement>('redo').disabled=disabled||!redo.length
  const notes=['准备此次视频的文字、图片、截图、原始音频和视频。先整理内容与大纲，再开始分镜。','从素材与大纲创作分镜。每段脚本与旁白一一对应，改稿后可重新生成此段音频。','逐段对照脚本试听旁白，检查是否过期以及实测长度；音频与脚本保持一一对应。','为分镜匹配此次准备的图片、截图和视频，旁白在脚本步骤管理。拖拽可以替换画面。','预览、独立编辑字幕内容/样式/位置并导出。修改字幕不会重新生成旁白。']
  element('stage-info').textContent=notes[stage];stageContent.replaceChildren();materials.suspend();workbench.render(draft,sceneIndex,stage,disabled,previewDirty,workflow.view.mode==='advanced');renderWorkbenchAssets();renderDeliveryHistory();workflow.render(state,draft,stage,workbench.mode,disabled);workbench.layoutTimeline(JSON.stringify([state.project.id,state.sessionId,draft?.id]),workflow.view.mode==='advanced'&&stage===4&&hasScene&&!['cover','delivery'].includes(workbench.mode),disabled);cards.render();cardText.render();panels.render();if(!draft){layerEditor.render();mainEditor.render();return}
  if(stage===0){
    if(pendingField!=='preparation-notes')area('preparation-notes').value=draft.preparation.notes
    if(pendingField!=='preparation-outline')area('preparation-outline').value=draft.preparation.outline
    element<HTMLButtonElement>('outline-to-scenes').disabled=disabled||hasScene||!draft.preparation.outline.trim()
    element<HTMLButtonElement>('studio-script-assistant').disabled=disabled
    element('studio-script-assistant').textContent=hasScene?'让 Assistant 完善脚本 ↗':'让 Assistant 生成卡片初稿 ↗'
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
  if(stage===4&&hasScene){captions.render();originalSpeechEditor.render();visualEditor.render();renderScript()}
  if(stage===4&&workbench.mode==='cover')materials.renderPicker(element('cover-source-picker'),state.assets.filter(asset=>asset.kind==='image'||asset.kind==='video'),draft.cover?.sourceArtifactId,asset=>{select('cover-sourceArtifactId').value=asset.artifactId;select('cover-sourceArtifactId').dispatchEvent(new Event('change',{bubbles:true}))})
  if(stage>=3&&hasScene){const choice=select('segment-asset');materials.renderPicker(element('segment-source-picker'),state.assets.filter(asset=>asset.kind==='image'||asset.kind==='video'),choice.value,asset=>{choice.value=asset.artifactId;choice.dispatchEvent(new Event('change',{bubbles:true}));renderStage()});for(const row of (document.querySelectorAll('[data-segment-preview]') as HTMLElement[])){const asset=state.assets.find(asset=>asset.artifactId===row.dataset.segmentPreview);if(asset)materials.renderPicker(row,[asset],asset.artifactId)}}
  workflow.render(state,draft,stage,workbench.mode,disabled);workbench.layoutTimeline(JSON.stringify([state.project.id,state.sessionId,draft?.id]),workflow.view.mode==='advanced'&&stage===4&&hasScene&&!['cover','delivery'].includes(workbench.mode),disabled);cards.render();cardText.render();layerEditor.render();mainEditor.render();panels.render()
  if(workflow.result==='completed'&&stage===4&&workbench.mode!=='cover'&&draft.exports.length){const latest=draft.exports.at(-1)!;if(shownOutput!==latest.artifactId)guarded(()=>showExport(latest.artifactId,latest.verificationArtifactId))()}
  for(const clip of (document.querySelectorAll('#timeline-dock .timeline-clip,#timeline-independent [data-track-menu]') as HTMLButtonElement[]))clip.disabled=disabled
  element<HTMLButtonElement>('timeline-split').disabled=disabled||previewPreparing||Boolean(previewPreparation)||!hasScene||layerEditor.selectionLocked()
}
function setBusy(value:boolean):void{busy=value||productionActive;const cancel=element<HTMLButtonElement>('cancel');cancel.hidden=!value||!['remove-reference','prepare-reference','read-reference','set-reference-analysis','apply-reference-notes','recognize-source','read-source-speech','apply-source-captions','align-speech','read-speech','correct-speech','source','export-citations','render','narrate','narrate-pending','export-cover','export-captions','check'].includes(currentOperation??'');cancel.disabled=cancellationRequested||invalidProject;cancel.textContent=cancellationRequested?'正在停止…':'取消作业';element('job-status').textContent=value?(cancellationRequested?'正在停止并清理…':currentOperation==='update'?'正在保存…':currentOperation==='narrate-pending'?'正在更新旁白…':currentOperation==='render'?'正在检查并制作成片…':'作业处理中…'):'';for(const node of document.querySelectorAll('input,textarea,select,#save,#export,#new-draft,#delete-draft,#add-scene,#duplicate,#remove-scene,#move-up,#move-down,#undo,#redo,#studio-output-apply,#studio-output-template-save,#scene-list button') as (HTMLInputElement|HTMLButtonElement)[])node.disabled=busy||invalidProject||viewChanging||Boolean(savePending)||mainEditor.isApplying();renderStage();if(!busy&&externalRequested)queueMicrotask(requestExternalRefresh)}
async function command(request:unknown,productionStep=false):Promise<unknown>{if(productionStep){if(!productionActive||invalidProject||savePending||currentOperation)throw new Error('视频制作上下文已变化，请重新检查。')}else editable();commandEpoch++;cancellationRequested=false;currentOperation=String(mediaRecord(request).operation??'');setBusy(true);try{return await api.command(state.project.id,request)}finally{currentOperation=undefined;cancellationRequested=false;setBusy(false)}}
let savePending:Promise<void>|undefined
async function flushEdits(withSpeech=true,persist=true,withSource=true,withLayers=true,withOutput=true,withMain=true,withCardText=true):Promise<void>{
  if(withCardText)await cardText.flush()
  if(withMain)await mainEditor.flush()
  if(withLayers)await layerEditor.flush()
  if(withSource)originalSpeechEditor.flush()
  if(invalidProject)throw new Error('Studio Project is no longer active.')
  if(savePending)await savePending
  if(withSpeech)await speechEditor.flush()
  await visualEditor.flushFocus()
  await speechLinksEditor.flush()
  if(pendingField&&!busy){element(pendingField).dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve()}
  if(persist){await save(false);if(withOutput)await applyOutput()}
}
async function attachAsset(asset:StudioAsset,sceneId:string,segmentIndex?:number):Promise<void>{
  if(asset.kind==='text')throw new Error('文字素材用于脚本准备，不能作为画面或旁白绑定。')
  await flushEdits();editable();if(!draft||!draft.scenes.some(scene=>scene.id===sceneId)||!state.assets.some(value=>value.artifactId===asset.artifactId))throw new Error('目标分镜或素材已变化，请重新选择。')
  const previous=captureHistory(draft),project=state.project.id
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
  const previous=captureHistory(draft),result=mediaRecord(await command({operation:'narrate',draftId:draft.id,expectedRevision:draft.revision,sceneId:id}))
  draft=assertVideoDraft(result.draft);undo.push(previous);undo=undo.slice(-40);redo=[];dirty=false;previewDirty=true;await refresh();render();message('此段旁白已重新生成，分镜长度已按实测音频更新。')
}
async function listenScene(id:string):Promise<void>{await flushEdits();const value=draft?.scenes.find(value=>value.id===id),asset=state.assets.find(asset=>asset.artifactId===value?.audioArtifactId);if(!asset)throw new Error('此段旁白素材不可用，请重新生成。');await materials.open(asset,undefined,true)}
async function addScene():Promise<void>{await flushEdits();editable();if(!draft)return;if(draft.scenes.length>=24)throw new Error('最多24个分镜。');history();draft.scenes.push(newStudioScene(crypto.randomUUID(),draft.scenes.length?'新分镜':'开场'));sceneIndex=draft.scenes.length-1;if(stage===0)stage=1;render();await save(false)}
async function save(clearHistory=true):Promise<void>{if(savePending)return savePending;if(!draft||!dirty)return;savePending=persistDraft(clearHistory);try{await savePending;saveFailure=undefined}catch(error){saveFailure=error instanceof Error?error.message:String(error);throw error}finally{savePending=undefined;setBusy(busy);render()}}
async function persistDraft(clearHistory:boolean):Promise<void>{const snapshot=clone(draft);for(const value of snapshot.scenes){value.audioArtifactId=value.audioArtifactId;value.voiceTiming=value.voiceTiming;value.voiceSegments=value.voiceSegments;value.voiceMuted=value.voiceMuted}const approved=restorePending?.snapshot===draft?restorePending.proof:undefined;const result=await command({operation:approved?'restore':'update',draftId:draft.id,expectedRevision:draft.revision,draft:snapshot,...(approved?{snapshotProof:approved}:{})});draft=assertVideoDraft(result);restorePending=undefined;dirty=false;if(clearHistory){undo=[];redo=[]}await refresh();render();await publishSelection()}
async function operation(operation:string,fields:Record<string,unknown>={}):Promise<void>{await flushEdits();await save();if(!draft)return;const result=await command({operation,draftId:draft.id,expectedRevision:draft.revision,...fields}),value=mediaRecord(result);draft=assertVideoDraft(value.draft??result);dirty=false;if(operation!=='export-cover')previewDirty=true;if(operation==='render')workbench.mode='delivery';await refresh();render();if(operation==='render'){const output=mediaRecord(value.export);await showExport(String(output.artifactId),output.verificationArtifactId?String(output.verificationArtifactId):undefined);message(value.reused?'已使用已有 MP4，未重新制作。':'MP4 已导出到当前 Project 素材库。')}}
/** One user-confirmed pipeline; native steps retain the existing CAS, cancellation and partial-result rules. */
async function cancelOperation():Promise<void>{if(!currentOperation||cancellationRequested)return;const epoch=commandEpoch;cancellationRequested=true;if(productionActive)productionStopped=true;setBusy(true);try{await api.cancel();if(commandEpoch===epoch&&cancellationRequested)message('已请求停止，正在等待作业清理。')}catch(error){if(commandEpoch===epoch&&currentOperation){cancellationRequested=false;setBusy(true)}throw error}}
async function produceVideo():Promise<void>{
  await flushEdits();await save();editable();if(!draft?.scenes.length)return
  const owner={projectId:state.project.id,sessionId:state.sessionId,draftId:draft.id}
  const assertOwner=():void=>{if(invalidProject||state.project.id!==owner.projectId||state.sessionId!==owner.sessionId||draft?.id!==owner.draftId)throw new Error('视频所属 Project、会话或草稿已变化。');if(productionStopped)throw new Error('视频制作已停止；已完成旁白保留。')}
  productionActive=true;productionStopped=false;preview.pause();setBusy(true)
  try{
    assertOwner()
    if(draftReadiness(draft).pendingNarrationSceneIds.length){
      const spoken=mediaRecord(await command({operation:'narrate-pending',draftId:draft.id,expectedRevision:draft.revision},true))
      assertOwner();draft=assertVideoDraft(spoken.draft);dirty=false;previewDirty=true
    }
    assertOwner()
    const rendered=mediaRecord(await command({operation:'render',draftId:draft.id,expectedRevision:draft.revision},true))
    assertOwner();draft=assertVideoDraft(rendered.draft);dirty=false;previewDirty=true;workbench.mode='delivery';stage=4
    await refresh();render()
    const output=mediaRecord(rendered.export);await showExport(String(output.artifactId),output.verificationArtifactId?String(output.verificationArtifactId):undefined)
    message(rendered.reused?'已使用已有 MP4，未重新制作。':'新视频已完成，旧成片保留；可播放或另存 MP4。')
  }catch(error){
    if(!invalidProject&&state.project.id===owner.projectId&&state.sessionId===owner.sessionId&&draft?.id===owner.draftId)await refresh(false)
    const remaining=draft?draftReadiness(draft).pendingNarrationSceneIds.length:0
    const detail=remaining?`还有 ${remaining} 段旁白待制作；再次确认制作将继续剩余内容。`:'再次确认制作可继续检查并生成成片。'
    const cause=(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method '[^']+':(?: Error:)?\s*/u,'')
    message(`${productionStopped?'制作已停止':'制作未完成'}，已保存的旁白与历史成片保留。${detail}${productionStopped?'':cause}`)
  }finally{productionActive=false;setBusy(false)}
}
function clearExport():void{shownOutput=undefined;exportGeneration++;for(const video of element('export-preview').querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load()}element('export-preview').replaceChildren();exportURLs.forEach(url=>URL.revokeObjectURL(url));exportURLs=[]}
async function showExport(id:string,verificationArtifactId?:string):Promise<void>{
  clearExport();shownOutput=id;const attempt=exportGeneration,owner=draft?.id,project=state.project.id,title=draft?.title??'video'
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
document.addEventListener('pointerdown',event=>{if((pendingField||cardText.hasPending())&&(event.target as HTMLElement).closest('button'))event.preventDefault()},true)
function mirrorScript(text:string):void{const node=document.querySelector('.script-scene.selected span');if(node)node.textContent=text||'此分镜尚未填写脚本';for(const button of document.querySelectorAll('#script-narrate,.script-scene.selected .script-generate') as HTMLButtonElement[])button.disabled=busy||invalidProject||viewChanging||Boolean(savePending)||!text.trim()
  if(draft)element<HTMLButtonElement>('studio-narrate-pending').disabled=busy||invalidProject||viewChanging||Boolean(savePending)||!(draftReadiness(draft).pendingNarrationSceneIds.some(id=>id!==scene().id)||(text.trim()&&sceneCoverage({...scene(),narration:text},draft.tts).audioStale))
}
area('script-current').addEventListener('focus',()=>preview.pause())
area('script-current').addEventListener('input',()=>{pendingField='script-current';element('delivery-open').textContent=draft?.exports.length?'制作更新':'生成视频';area('narration').value=area('script-current').value;mirrorScript(area('script-current').value)})
area('script-current').addEventListener('change',guarded(async()=>{if(!draft)return;if(pendingField==='script-current')pendingField=undefined;history();scene().narration=area('script-current').value;render();await save(false)}))
element('studio-cover-open').onclick=guarded(()=>openInspector('cover'))
element('delivery-open').onclick=guarded(()=>openInspector('delivery'))
element('studio-review-assistant').onclick=guarded(async()=>{await flushEdits();editable();if(!draft?.scenes.length)return;await api.assistant({projectId:state.project.id,draftId:draft.id,expectedRevision:draft.revision,intent:'review'});message('审阅任务已交给当前 Assistant；建议会出现在可选审阅区，由你逐项采纳。')})
element('studio-review-capture').onclick=guarded(async()=>{await flushEdits();editable();if(!draft?.scenes.length)return;await prepare();const current=draft,position=Number(input('seek').value),images:string[]=[];let offset=0;setBusy(true);try{for(const value of current.scenes){await preview.seek(offset+Math.min(value.durationSeconds/2,Math.max(.8,...(value.bulletRevealSeconds??[]))));if(draft!==current||invalidProject)throw new Error('STUDIO_CONFLICT: 审片期间草稿变化。');images.push(element<HTMLCanvasElement>('preview').toDataURL('image/png'));offset+=value.durationSeconds}reviewFrames={id:current.id,revision:current.revision,images};message('关键帧已生成，请逐帧检查内容与遮挡。')}finally{await preview.seek(position);setBusy(false);renderTextReview()}})
element('preview-refresh').onclick=guarded(async()=>{await flushEdits();await prepare()})
element('settings-open').onclick=guarded(async()=>{await flushEdits();element<HTMLDialogElement>('settings-dialog').showModal();renderStage()})
element('settings-close').onclick=guarded(async()=>{await flushEdits();element<HTMLDialogElement>('settings-dialog').close();renderStage()})
element('settings-dialog').addEventListener('close',()=>renderStage())
for(const tab of (document.querySelectorAll('[data-inspector]') as HTMLButtonElement[]))tab.onclick=guarded(()=>openInspector(tab.dataset.inspector as InspectorMode))
element('timeline-dock').onclick=event=>{const target=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-seconds]');if(!target||target.dataset.mainKind||target.closest('#timeline-independent'))return;guarded(()=>seekTo(Number(target.dataset.seconds),target.dataset.kind==='voice'?'voice':target.dataset.kind==='reveal'?'visual':target.dataset.kind==='caption'?'captions':'visual'))()}

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
  checked=result;render();stage=4;workbench.mode='delivery';renderStage();void publishSelection();message(result.ready?'制作检查通过；素材解码与设备编码均可用。':'制作检查发现问题；点击问题定位分镜。')
})
select('scene-template').onchange=guarded(()=>{pendingField=undefined;return alterScene(value=>{const kind=select('scene-template').value;if(!kind)delete value.sceneTemplate;else value.sceneTemplate={kind:kind as NonNullable<StudioScene['sceneTemplate']>['kind']}})})
for(const [id,key] of [['template-accent','accentColor'],['template-background','backgroundColor'],['template-text','textColor'],['template-emphasis','emphasisIndex']] as const)element(id).onchange=guarded(()=>{pendingField=undefined;return alterScene(value=>{if(!value.sceneTemplate)return;if(key==='emphasisIndex'){if(select(id).value==='')delete value.sceneTemplate.emphasisIndex;else value.sceneTemplate.emphasisIndex=Number(select(id).value)}else value.sceneTemplate[key]=input(id).value})})
for(const id of ['scene-template','template-accent','template-background','template-text','template-emphasis'])element(id).addEventListener('input',()=>{pendingField=id})
element('caption-translate').onclick=guarded(async()=>{await flushEdits();editable();if(!draft||!scene().captions?.length)throw new Error('请先生成或编辑独立字幕。');await api.assistant({projectId:state.project.id,draftId:draft.id,sceneId:scene().id,expectedRevision:draft.revision,intent:'translate'});message('翻译任务已交给当前会话，原文、时间和人工译文保留。')})
element('scene-number').onchange=guarded(()=>alterScene(value=>{value.showSceneNumber=input('scene-number').checked}))
element('script-remove-voice').onclick=guarded(()=>alterScene(value=>{value.narration='';for(const key of ['audioArtifactId','audioText','audioGeneration','audioDurationSeconds','voiceTiming','voiceSegments','speechCandidate','speechAnchors','speechCaptions','speechLinks','speechPlaybackOrigin'] as const)delete value[key]}))
element('script-narrate').onclick=guarded(()=>narrateScene(scene().id));element('script-listen').onclick=guarded(()=>listenScene(scene().id));element('script-bind-audio').onclick=guarded(async()=>{const asset=state.assets.find(item=>item.artifactId===select('script-raw-audio').value&&item.kind==='audio');if(!asset)throw new Error('请先选择已准备的原始音频。');await attachAsset(asset,scene().id)})
for(const id of fields)element(id).addEventListener('input',()=>{pendingField=id;if(id==='narration'){area('script-current').value=area('narration').value;mirrorScript(area('narration').value)}})
for(const id of fields)element(id).addEventListener('change',guarded(async()=>{if(!draft)return;if(id==='draft-title'){pendingField=undefined;history();draft.title=input('draft-title').value;render();await save(false);return}if(id==='music'){pendingField=undefined;history();draft.music=input('music').checked;render();await save(false);return}if(!draft.scenes.length)return;if(pendingField===id)pendingField=undefined;history();const value=scene();value.title=input('scene-title').value;value.label=input('scene-label').value;value.narration=area('narration').value;value.visualBrief=area('visual-brief').value;value.sources=area('sources').value.split('\n').map(value=>value.trim()).filter(Boolean);value.bullets=area('bullets').value.split('\n').filter(Boolean);value.durationSeconds=Number(input('duration').value);if(value.visualSegments)fitVisualSegments(value.visualSegments,value.durationSeconds);value.sourceStartSeconds=Number(input('source-start').value);value.playbackRate=Number(input('rate').value);value.voiceVolume=Number(input('gain').value);value.endPolicy=select('end-policy').value as StudioScene['endPolicy'];value.layout=select('layout').value as StudioScene['layout'];value.crop={x:Number(input('crop-x').value),y:Number(input('crop-y').value),width:Number(input('crop-width').value),height:Number(input('crop-height').value)};if(id==='captions'){const cues=area('captions').value.trim();if(cues)value.captions=cues.split('\n').map(line=>{const [start,end,...text]=line.split('|');return {startSeconds:Number(start),endSeconds:Number(end),text:text.join('|').trim()}});else delete value.captions;}draft.music=input('music').checked;draft.title=input('draft-title').value;render();await save(false)}))

for(const id of ['preparation-notes','preparation-outline']){
  area(id).addEventListener('input',()=>{pendingField=id;if(id==='preparation-outline')element<HTMLButtonElement>('outline-to-scenes').disabled=busy||invalidProject||Boolean(draft?.scenes.length)||!area(id).value.trim()})
  area(id).addEventListener('change',guarded(async()=>{if(!draft)return;pendingField=undefined;history();draft.preparation.notes=area('preparation-notes').value;draft.preparation.outline=area('preparation-outline').value;render();await save(false)}))
}
for(const button of document.querySelectorAll('[data-materials-assistant]') as HTMLButtonElement[])button.onclick=guarded(prepareMaterials)
element('studio-script-assistant').onclick=guarded(async()=>{await flushEdits();editable();if(!draft)return;await api.assistant({projectId:state.project.id,draftId:draft.id,expectedRevision:draft.revision,intent:'script'});message('脚本辅助任务已交给当前 Project 的 Assistant。')})
element('outline-to-scenes').onclick=guarded(async()=>{await flushEdits();editable();if(!draft)return;if(draft.scenes.length)throw new Error('已有分镜，请在脚本页继续修改，避免覆盖。');const lines=draft.preparation.outline.split('\n').map(value=>value.trim()).filter(Boolean);if(!lines.length||lines.length>24)throw new Error('请提供1–24行大纲，每行创建一个分镜。');history();draft.scenes=lines.map((line,index)=>({...newStudioScene(crypto.randomUUID(),line.slice(0,44)||'分镜'+(index+1)),visualBrief:line.slice(0,2000)}));sceneIndex=0;stage=1;render();await save(false)})
element('voice-muted').addEventListener('input',()=>{pendingField='voice-muted'})
element('voice-muted').addEventListener('change',guarded(async()=>{if(pendingField==='voice-muted')pendingField=undefined;const muted=input('voice-muted').checked;await alterScene(value=>{value.voiceMuted=muted})}))
for(const id of ['keep-source-audio','source-volume'])element(id).addEventListener('input',()=>{pendingField=id})
for(const id of ['keep-source-audio','source-volume'])element(id).addEventListener('change',guarded(async()=>{pendingField=undefined;const keep=input('keep-source-audio').checked,volume=Number(input('source-volume').value);await alterScene(value=>{value.keepSourceAudio=keep;value.sourceVolume=volume})}))

element('leave').onclick=guarded(async()=>{await flushEdits();referenceEditor.close();materials.suspend();previewDirty=true;await preview.dispose();await api.leave()});window.bmwStudioFlush=async()=>{await flushEdits();await publishSelection()};element('save').onclick=guarded(async()=>{await flushEdits();await save();undo=[];redo=[];render()});element('export').onclick=guarded(produceVideo);element('export-remake').onclick=guarded(()=>operation('render',{forceRender:true}));element('export-existing').onclick=guarded(async()=>{await flushEdits();const latest=draft?.exports.at(-1);if(latest){await showExport(latest.artifactId,latest.verificationArtifactId);message('已打开已有成片，可直接另存 MP4。')}});element('cancel').onclick=guarded(cancelOperation);element('play').onclick=guarded(async()=>{workflow.result='draft';renderStage();await prepare();await preview.play()});input('seek').oninput=guarded(()=>seekTo(Number(input('seek').value)));input('timeline-position').oninput=guarded(()=>seekTo(Number(input('timeline-position').value)));element('reload').onclick=guarded(async()=>{if(hasLocalInput()&&!confirm('重新加载会放弃此页未保存修改，是否继续？'))return;cardText.discard();pendingOutput=undefined;layerEditor.clear();mainEditor.discard();if(workbench.mode==='layer')workbench.mode='visual';await refresh(false)});element('assistant').onclick=guarded(async()=>{await api.assistant()})
select('studio-output-template').onchange=guarded(()=>{const preset=state.videoPreferences?.templates.find(item=>item.name===select('studio-output-template').value);if(preset){outputForm.fill(preset.options);outputEdited()}})
async function applyOutput():Promise<void>{
  if(outputSaving)return outputSaving
  if(!pendingOutput)return
  const owner=pendingOutput
  if(invalidProject||state.project.id!==owner.projectId||draft?.id!==owner.draftId)throw new Error('全片参数所属视频已变化；保留输入，请重新加载后处理。')
  const options=outputForm.read(),templateName=select('studio-output-template').value,previous=captureHistory(draft)
  const operation=(async()=>{const result=await command({operation:'configure',draftId:draft!.id,expectedRevision:draft!.revision,options,...(templateName?{templateName}:{})});draft=assertVideoDraft(result);pendingOutput=undefined;undo.push(previous);undo=undo.slice(-40);redo=[];dirty=false;previewDirty=true;await refresh();render();message('全片参数已保存，可撤销。')})()
  outputSaving=operation
  try{await operation}finally{if(outputSaving===operation)outputSaving=undefined}
}
element('studio-output-apply').onclick=guarded(async()=>{await flushEdits(true,true,true,true,false);outputEdited();await applyOutput()})
element('studio-output-template-save').onclick=guarded(async()=>{await save();if(!draft)return;const name=input('studio-output-template-name').value;await command({operation:'save-template',draftId:draft.id,expectedRevision:draft.revision,templateName:name});await refresh();message('模板已保存，之后可以按名称制作视频。')})
element('empty-create').onclick=()=>element('new-draft').click();
element('delete-draft').onclick=guarded(async()=>{await flushEdits();await save();if(!draft||!confirm(`删除视频草稿「${draft.title}」？共用素材和已导出的文件会保留。`))return;await command({operation:'delete',draftId:draft.id,expectedRevision:draft.revision});choose(undefined);await refresh(false);message('草稿已删除，共用素材和导出文件已保留。')});
async function createDraft():Promise<void>{await flushEdits();await save();const result=assertVideoDraft(await command({operation:'create',title:'新视频'}));await refresh();stage=0;choose(result)}
element('new-draft').onclick=guarded(createDraft);select('draft-select').onchange=guarded(async()=>{const id=select('draft-select').value;await flushEdits();await save();choose(state.drafts.find(value=>value.id===id)!)});
async function mutateScene(action:string):Promise<void>{
  await flushEdits();editable();if(!draft?.scenes.length)return
  if(action==='duplicate'){
    if(draft.scenes.length>=24)throw new Error('最多 24 个分镜。')
    history();const copied=clone(scene());copied.id=crypto.randomUUID();for(const layer of [...(copied.layers??[]),...(copied.audioTracks??[])])layer.id=crypto.randomUUID();draft.scenes.splice(sceneIndex+1,0,copied);sceneIndex++
  }else if(action==='remove-scene'){
    history();draft.scenes.splice(sceneIndex,1);sceneIndex=Math.max(0,Math.min(sceneIndex,draft.scenes.length-1));if(!draft.scenes.length)await preview.dispose()
  }else if(action==='move-up'||action==='move-down'){
    const next=sceneIndex+(action==='move-up'?-1:1);if(next<0||next>=draft.scenes.length)return
    history();[draft.scenes[sceneIndex],draft.scenes[next]]=[draft.scenes[next],draft.scenes[sceneIndex]];sceneIndex=next
  }else throw new Error('Unknown scene operation.')
  render();await save(false)
}
element('add-scene').onclick=guarded(addScene)
for(const id of ['duplicate','remove-scene','move-up','move-down'])element(id).onclick=guarded(()=>mutateScene(id))

element('undo').onclick=guarded(async()=>{await flushEdits();editable();if(!undo.length||!draft)return;redo.push(captureHistory(draft));const revision=draft.revision;draft=undo.pop()!;const proof=historyProofs.get(draft);restorePending=proof?{snapshot:draft,proof}:undefined;draft.revision=revision;sceneIndex=Math.max(0,Math.min(sceneIndex,draft.scenes.length-1));dirty=true;previewDirty=true;render();await save(false)});element('redo').onclick=guarded(async()=>{await flushEdits();editable();if(!redo.length||!draft)return;undo.push(captureHistory(draft));const revision=draft.revision;draft=redo.pop()!;const proof=historyProofs.get(draft);restorePending=proof?{snapshot:draft,proof}:undefined;draft.revision=revision;sceneIndex=Math.max(0,Math.min(sceneIndex,draft.scenes.length-1));dirty=true;previewDirty=true;render();await save(false)})
for(const button of (document.querySelectorAll('[data-stage]') as HTMLButtonElement[]))button.onclick=guarded(async()=>{await flushEdits();if(!draft&&button.dataset.stage==='0')await createDraft();stage=Number(button.dataset.stage);if(stage===4)workbench.mode='visual';if(stage!==4){preview.pause();for(const media of document.querySelectorAll('audio,video') as HTMLMediaElement[])media.pause()}document.querySelectorAll('[data-stage]').forEach(item=>item.classList.toggle('active',item===button));renderStage();if(stage===4){if(workbench.mode==='cover')await coverEditor.preview();else await selectScene(sceneIndex)}else void publishSelection()})
api.onChange(value=>{
  const changed=mediaRecord(value)
  if(changed.workspaceHidden){workspaceHidden=true;workspaceEpoch++;materials.suspend();previewDirty=true;void preview.dispose();for(const media of document.querySelectorAll('audio,video') as HTMLMediaElement[])media.pause();return}
  if(changed.projectChanged){workspaceEpoch++;originalSpeechEditor.clear();speechEditor.clear();coverEditor.clear();clearExport();materials.clear();referenceEditor.suspend();invalidProject=true;previewDirty=true;setBusy(busy);void preview.dispose();message('Project 已切换，此页保留草稿，请重新打开 Video Studio。');renderStage();return}
  if(typeof changed.projectId==='string'&&state&&changed.projectId!==state.project.id)return
  if(changed.projectRestored){workspaceEpoch++;workspaceHidden=false;invalidProject=false;previewDirty=true;setBusy(busy)}
  requestExternalRefresh()
})
api.onProgress(value=>{const record=mediaRecord(value);if(busy)element('job-status').textContent=`媒体作业进行中 ${typeof record.progress==='number'?Math.round(record.progress*100)+'%':''}`})
window.addEventListener('beforeunload',event=>{if(hasLocalInput()){event.preventDefault();event.returnValue='未保存草稿'}});window.addEventListener('unload',()=>{referenceEditor.suspend();originalSpeechEditor.clear();coverEditor.clear();clearExport();materials.clear();urls.forEach(url=>URL.revokeObjectURL(url));void preview.dispose()});void refresh(false).catch(error=>message(String(error)))

element('studio-export-citations').onclick=guarded(async()=>{await flushEdits();editable();if(!draft)return;const result=mediaRecord(await command({operation:'export-citations',draftId:draft.id,expectedRevision:draft.revision}));await refresh();const data=await bytes(String(result.artifactId)),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'application/json'}));urls.push(url);const link=document.createElement('a');link.href=url;link.download=draft.title+'-citations.json';link.textContent='另存引用清单';const previous=element('studio-citation-export').querySelector<HTMLAnchorElement>('a');if(previous){URL.revokeObjectURL(previous.href);urls=urls.filter(value=>value!==previous.href);previous.remove()}element('studio-citation-export').append(link);message('已导出 '+result.citationCount+' 条原文引用；事实核查状态仍为待确认。')})

async function changeView(mode:'simple'|'advanced'):Promise<void>{
  const position=Number(input('seek').value);await flushEdits();editable(true);if(mode==='simple'&&draft)requireSimpleVideo(draft);await save();await publishSelection();const entering=workflow.view.mode!==mode;preview.pause()
  if(workflow.view.mode==='advanced')advancedInspector=workbench.mode
  viewChanging=true;setBusy(busy)
  try{
  const next={...workflow.view,mode};await api.view(next);workflow.view=next
  if(entering&&mode==='advanced')workflow.result='draft'
  if(draft?.scenes.length){stage=4;if(mode==='simple')workbench.mode='visual';else workbench.mode=layerEditor.selection?'layer':advancedInspector}
  renderStage();await publishSelection()
  if(entering&&mode==='advanced'){studioGeometryKey='';await publishStudioGeometry();await api.chat({open:true})}
  if(stage===4&&draft?.scenes.length&&workflow.result==='draft'){await prepare();await preview.seek(position)}
  }finally{viewChanging=false;setBusy(busy)}
}
element('view-toggle').onclick=guarded(()=>changeView(workflow.view.mode==='simple'?'advanced':'simple'))
input('confirm-stages').onchange=guarded(async()=>{const confirmStages=input('confirm-stages').checked;await flushEdits();const next={...workflow.view,confirmStages};await api.view(next);workflow.view=next;renderStage()})
for(const button of (document.querySelectorAll('[data-example]') as HTMLButtonElement[]))button.onclick=guarded(()=>api.prefill(button.dataset.example!).then(()=>message('示例已填写到右侧；修改后发送。')))
for(const [id,storyboard] of [['script-reading',false],['script-storyboard',true]] as const)element(id).onclick=guarded(async()=>{await flushEdits();workflow.storyboard=storyboard;renderStage()})
element('task-stop').onclick=guarded(async()=>{element<HTMLButtonElement>('task-stop').disabled=true;try{await api.cancelTask();message('Assistant 已停止并完成清理；请在右侧继续。')}finally{workflow.render(state,draft,stage,workbench.mode,busy||invalidProject||viewChanging||Boolean(savePending))}})
api.onTask(value=>{workflow.activity=value as FeatureAssistantActivity|null;if(state){workflow.render(state,draft,stage,workbench.mode,busy||invalidProject||viewChanging||Boolean(savePending));renderMaterialAssistant()}})
element('result-draft').onclick=guarded(async()=>{await flushEdits();stage=4;workbench.mode='visual';workflow.result='draft';renderStage();await publishSelection();await prepare()})
element('result-completed').onclick=guarded(async()=>{await flushEdits();preview.pause();stage=4;workbench.mode='visual';workflow.result='completed';renderStage();await publishSelection();const latest=draft?.exports.at(-1);if(latest&&shownOutput!==latest.artifactId)await showExport(latest.artifactId,latest.verificationArtifactId)})
element('delivery-cover').onclick=guarded(async()=>{await changeView('advanced');await openInspector('cover')})

element('studio-chat-launcher').onclick=guarded(async()=>{await publishStudioGeometry();await api.chat({open:true})})

let studioGeometryScheduled=false,studioGeometryKey=''
let studioGeometryPending:Promise<unknown>|undefined
function measureStudioGeometry():void{
 if(studioGeometryScheduled)return;studioGeometryScheduled=true
 setTimeout(()=>{studioGeometryScheduled=false;void publishStudioGeometry().catch(()=>{})})
}
async function publishStudioGeometry():Promise<void>{
 if(!state?.sessionId||invalidProject||workflow.view.mode!=='advanced')return
  const upper=element('studio-workspace').getBoundingClientRect(),inspector=element('inspector').getBoundingClientRect()
  const width=window.innerWidth,height=window.innerHeight
  const propertyArea=inspector.width&&inspector.height?inspector:upper
  const selected=document.querySelector('.canvas-layer-selection:not([hidden])')?.getBoundingClientRect(),resources=document.querySelector('#studio-workspace>.scenes')?.getBoundingClientRect(),transport=element('transport').getBoundingClientRect()
  const top=Math.max(0,propertyArea.top/height),bottom=Math.min(1,propertyArea.bottom/height),floatBottom=Math.min(bottom,(transport.top-8)/height)
  const avoid=selected&&selected.width>0&&selected.height>0?{x:Math.max(0,selected.left)/width,y:Math.max(0,selected.top)/height,width:Math.max(0,Math.min(width,selected.right)-Math.max(0,selected.left))/width,height:Math.max(0,Math.min(height,selected.bottom)-Math.max(0,selected.top))/height}:undefined
  const region={top,bottom,...(transport.height>0&&floatBottom>top?{floatBottom}:{}),propertyWidth:width<700?Math.min(360,width-24)/width:Math.max(.01,Math.min(.5,(inspector.width||260)/width)),resourceWidth:Math.min(.5,(resources?.width??0)/width),...(avoid&&avoid.width>0&&avoid.height>0?{avoid}:{}),obscured:Boolean(document.querySelector('dialog[open],#studio-more[open],#studio-track-menu:not([hidden])'))}
  if(region.bottom<=region.top)return
  const key=JSON.stringify([state.project.id,state.sessionId,region]);if(key===studioGeometryKey){await studioGeometryPending;return}studioGeometryKey=key
  const pending=api.geometry(region);studioGeometryPending=pending
  try{await pending}catch(error){if(studioGeometryKey===key)studioGeometryKey='';throw error}finally{if(studioGeometryPending===pending)studioGeometryPending=undefined}
}
window.addEventListener('resize',measureStudioGeometry)
window.addEventListener('studio-layout-resized',()=>{panels.render();measureStudioGeometry()})
const studioGeometryObserver=new ResizeObserver(measureStudioGeometry)
for(const id of ['studio-workspace','inspector','transport'])studioGeometryObserver.observe(element(id))
new MutationObserver(measureStudioGeometry).observe(document.body,{attributes:true,attributeFilter:['data-view','data-studio-layout','data-studio-drawer'],subtree:false})
new MutationObserver(measureStudioGeometry).observe(element('canvas-surface'),{attributes:true,attributeFilter:['hidden','style'],childList:true,subtree:true})
for(const dialog of document.querySelectorAll('dialog,#studio-more,#studio-track-menu'))new MutationObserver(measureStudioGeometry).observe(dialog,{attributes:true,attributeFilter:['open','hidden']})
api.onChat(raw=>{const value=mediaRecord(raw);document.body.dataset.chatOpen=String(value.open===true);document.body.dataset.chatDocked=String(value.docked===true);measureStudioGeometry()})
