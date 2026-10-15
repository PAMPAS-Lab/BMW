import {studioCompatibility} from '../studio-compatibility.js'
import {assertStudioView,defaultStudioView} from '../studio-context.js'
import type {StudioViewPreferences} from '../studio-context.js'
import type {FeatureAssistantActivity} from '@bmw-agent/platform/feature-contract'
import type {VideoDraft,StudioState} from '../studio-contract.js'
import {canPrepareStudioRecovery,studioProductionFacts,studioActivitySilence} from '../studio-production-progress.js'
import type {BrowserStudioProgress} from '@bmw-agent/browser-capability/host'
const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
const statuses:Record<string,string>={idle:'本轮对话已结束',queued:'Assistant 任务已排队',running:'Assistant 正在执行', 'waiting-user':'等待你的回复','waiting-approval':'等待批准',cancelling:'正在停止并清理',interrupted:'任务已停止',failed:'本轮执行失败',disconnected:'连接中断，结果尚未确认'}
const activityNames:Record<string,string>={'video.studio':'处理视频草稿','video.compose':'制作成片','video.narrate':'制作旁白','tabs.open':'打开资料页面','tabs.navigate':'浏览资料页面','media.screenshot':'采集页面截图','media.record.start':'录制页面','media.record.stop':'保存录制片段','media.inspect':'分析素材','media.download':'收集素材','media.image.inspect':'分析图片'}
/** View state only. Switching never clones, narrates or renders the draft. */
const advancedText=(mode:string)=>mode==='simple'?'此草稿需要高级编辑，卡片视图仅供查看。':'当前保留高级编辑。'
export class StudioWorkflow {
  view:StudioViewPreferences={...defaultStudioView}
  activity:FeatureAssistantActivity|null=null
  productionProgress?:BrowserStudioProgress
  result:'draft'|'completed'='draft'
  storyboard=false
  hydrate(raw:unknown):void {this.view=assertStudioView(raw??defaultStudioView)}
  render(state:StudioState,draft:VideoDraft|undefined,stage:number,mode:string,disabled:boolean):void {
    const own=this.activity?.projectId===state.project.id&&this.activity.sessionId===state.sessionId?this.activity:null
    const compatibility=draft?studioCompatibility(draft):undefined
    const notice=node('studio-compatibility');notice.hidden=!compatibility||compatibility.simpleEditable;notice.textContent=compatibility?.simpleEditable?'':(advancedText(this.view.mode))+compatibility?.blockingReasons.map(r=>r.message).join(' ')+' 撤销或移除后可返回卡片。'
    const advanced=this.view.mode==='advanced',editing=stage===4&&Boolean(draft),delivery=editing&&mode==='delivery',completed=editing&&!delivery&&mode!=='cover'&&this.result==='completed'&&Boolean(draft?.exports.length)
    document.body.dataset.result=completed?'completed':'draft';document.body.dataset.view=this.view.mode;document.body.dataset.surface=delivery?'delivery':stage===0?'materials':stage===1||stage===2?'script':'preview'
    node<HTMLButtonElement>('view-toggle').textContent=advanced&&!compatibility?.simpleEditable&&draft?'返回卡片（需先移除高级内容）':advanced?'← 返回卡片':'高级编辑';node('view-toggle').setAttribute('aria-pressed',String(advanced));node<HTMLButtonElement>('view-toggle').disabled=disabled
    node<HTMLInputElement>('confirm-stages').checked=this.view.confirmStages;node<HTMLInputElement>('confirm-stages').disabled=disabled
    node('workbench-assets').classList.toggle('advanced-resources',advanced)
    node('studio-chat-launcher').hidden=!advanced;node('studio-chat-status').textContent=own&&['running','waiting-user','waiting-approval','failed','disconnected'].includes(own.status)?statuses[own.status]:''
    const inspector=node('inspector');inspector.hidden=!advanced||stage<3||!draft||delivery
    node('studio-workspace').dataset.inspector=String(!inspector.hidden)
    const sceneParent=node('scene-strip'),navigation=node('scene-navigation');if(navigation.parentElement!==sceneParent)sceneParent.append(navigation)
    sceneParent.hidden=!advanced||!draft?.scenes.length||delivery
    node('workbench-assets').hidden=!advanced||!editing||delivery
    node('timeline-dock').hidden=!advanced||!editing||!draft?.scenes.length||delivery||mode==='cover'
    node('delivery-workspace').hidden=!delivery
    const panel=node('delivery-panel'),target=delivery?node('delivery-workspace'):node('inspector-scroll');if(panel.parentElement!==target)target.append(panel)
    panel.hidden=!delivery
    node('canvas-workspace').hidden=!editing||delivery
    node('completed-result').hidden=!completed
    const output=node('export-preview'),outputTarget=completed?node('completed-result'):node('delivery-output');if(!completed&&!delivery)for(const video of output.querySelectorAll('video'))video.pause();if(output.parentElement!==outputTarget)outputTarget.append(output)
    if(completed){node('canvas-surface').hidden=true;node('transport').hidden=true}
    else {node('canvas-surface').hidden=false}
    node('result-draft').setAttribute('aria-pressed',String(!completed));node('result-completed').setAttribute('aria-pressed',String(completed));node('result-completed').hidden=!draft?.exports.length
    const latest=draft?.exports.at(-1),current=Boolean(draft&&latest&&state.reusableExports?.[draft.id]===latest.artifactId)
    node('delivery-open').textContent=current?'导出视频':latest?'制作更新':'生成视频'
    if(completed){node('canvas-context').textContent='最近成片 · '+draft!.title;node('preview-status').textContent=current?'已完成 MP4':'草稿已有修改';node('preview-refresh').hidden=true}
    node('completed-result-note').textContent=latest?`${current?'当前可复用成片':'最近成片 · 当前草稿可能已有修改'} · ${latest.durationSeconds.toFixed(1)} 秒 · 草稿 v${latest.revision}。草稿预览与已导出的文件分别保留。`:''
    node('script-outline').dataset.view=this.storyboard?'storyboard':'reading';node('script-reading').setAttribute('aria-pressed',String(!this.storyboard));node('script-storyboard').setAttribute('aria-pressed',String(this.storyboard))
    this.renderTask(state,draft,disabled)
    for(const button of (document.querySelectorAll('[data-example]') as HTMLButtonElement[]))button.disabled=disabled||!state.sessionId
  }
  renderTask(state:StudioState,draft:VideoDraft|undefined,disabled:boolean,now=Date.now()):void {
    const own=this.activity?.projectId===state.project.id&&this.activity.sessionId===state.sessionId?this.activity:null,continuable=canPrepareStudioRecovery(own,draft),facts=draft?studioProductionFacts(draft):undefined,quiet=studioActivitySilence(own,now)
    node('studio-task').hidden=!own||!own.runId&&!continuable&&!['queued','running','waiting-user','waiting-approval','cancelling','disconnected','failed'].includes(own.status)
    node('task-title').textContent=own?own.dispatchBlocked&&['idle','failed','interrupted'].includes(own.status)?'等待资源清理结束':!own.runId&&continuable?'已保存制作进度':statuses[own.status]??'Assistant 会话状态已更新':''
    const progress=draft&&this.productionProgress&&this.productionProgress.draftId===draft.id&&this.productionProgress.revision>=draft.revision?this.productionProgress:undefined,progressAge=progress?Math.max(0,(now-progress.updatedAt)/1000):Infinity
    const phase=progress&&progressAge<300&&['started','scene-completed','failed'].includes(progress.phase)?`本次已保存 ${progress.completedSceneIds.length} 段旁白 · ${progress.pendingSceneIds.length} 段待制作 · 进度 v${progress.revision}${progress.phase==='failed'?' · 本次未完成':progress.currentSceneId?' · '+(draft?.scenes.find(s=>s.id===progress.currentSceneId)?.title??'当前镜头'):''}`:own?.status==='running'?(own.action&&own.toolRunning!==false?'正在'+(activityNames[own.action]??'执行当前操作'):own.toolRunning===false?'浏览器操作已结束，等待本轮后续事件':'等待本轮执行事件'):['failed','disconnected','interrupted'].includes(own?.status??'')?own?.message??'':''
    const saved=facts?`${facts.selectedMaterialCount} 项已选素材 · ${facts.sceneCount} 个分镜 · 已保存就绪旁白 ${facts.readyNarrationSceneIds.length}/${facts.narrationSceneCount} 段 · ${facts.pendingNarrationSceneIds.length} 段待制作${facts.latestExportArtifactId?' · 已有实际成片':' · 尚未导出成片'} · 草稿 v${facts.revision}`:'尚无视频草稿'
    const event=own?.lastEventAt!==undefined?`最后事件 ${new Date(own.lastEventAt).toLocaleTimeString()}${quiet===undefined?'':`（${quiet} 秒前）`}`:'尚无本轮事件时间',last=own?.lastToolCompletedAt!==undefined?`${own.lastToolSucceeded===false?'上次操作失败':'上次操作已结束'}${own.lastToolAction?'：'+(activityNames[own.lastToolAction]??own.lastToolAction):''}`:''
    node('task-detail').textContent=own?[phase,['failed','disconnected','interrupted'].includes(own.status)&&phase!==own.message?own.message??'':'',saved,event,last,quiet!==undefined&&quiet>=90&&progressAge>=90?'较长时间没有新事件；仅凭这一点不能认定任务停止，可查看对话或明确停止后核对成果。':'',own.status==='disconnected'?'连接或资源状态尚未恢复，不会自动重发。':continuable?'可准备基于最新保存状态的续做说明，确认发送后才执行。':this.view.confirmStages?'分阶段确认已开启；请在右侧查看成果并确认下一步。':''].filter(Boolean).join(' · '):''
    node('task-stop').hidden=!own||!['running','queued','waiting-user','waiting-approval','cancelling'].includes(own.status);node<HTMLButtonElement>('task-stop').disabled=own?.status==='cancelling'
    node('task-continue').hidden=!continuable;node<HTMLButtonElement>('task-continue').disabled=disabled||!continuable
  }

}
