import {COMPOSITION_LIMITS} from '../../media-native/src/composition-contract.js'
import type {FeatureAssistantActivity} from '@bmw-agent/platform/feature-contract'
import {draftReadiness,sceneCoverage,studioId} from './studio-contract.js'
import {finiteNumber,mediaRecord} from '../../media-native/src/media-contract.js'
import type {BrowserStudioProgress} from '@bmw-agent/browser-capability/host'
import type {VideoDraft} from './studio-contract.js'
export function canPrepareStudioRecovery(activity:FeatureAssistantActivity|null|undefined,draft:VideoDraft|undefined):boolean {
 return Boolean(activity&&draft&&activity.sessionId===draft.ownerSessionId&&!activity.dispatchBlocked&&!activity.toolRunning&&['idle','failed','interrupted'].includes(activity.status)&&(activity.runId||draft.scenes.length||draft.preparation.artifactIds.length||draft.preparation.notes.trim()||draft.preparation.outline.trim()))
}
export function assertStudioRecoveryRequest(raw:unknown):{draftId:string;expectedRevision:number}{const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['draftId','expectedRevision'].includes(k)))throw new TypeError('Unsupported Studio recovery field.');return {draftId:studioId(v.draftId),expectedRevision:finiteNumber(v.expectedRevision,'recovery revision',1,1000000,true)}}
export function assertStudioProductionProgress(raw:unknown):BrowserStudioProgress {
 const v=mediaRecord(raw);if(Object.keys(v).some(k=>!['draftId','revision','operation','phase','currentSceneId','completedSceneIds','pendingSceneIds','updatedAt'].includes(k))||v.operation!=='narrate-pending'||!['started','scene-completed','completed','failed'].includes(String(v.phase)))throw new TypeError('Invalid Studio production progress.')
 const ids=(raw:unknown)=>{if(!Array.isArray(raw)||raw.length>COMPOSITION_LIMITS.scenes)throw new TypeError('Invalid production scene count.');const values=raw.map(studioId);if(new Set(values).size!==values.length)throw new TypeError('Duplicate production scene.');return values},completedSceneIds=ids(v.completedSceneIds),pendingSceneIds=ids(v.pendingSceneIds)
 return {draftId:studioId(v.draftId),revision:finiteNumber(v.revision,'production revision',1,1000000,true),operation:'narrate-pending',phase:v.phase as BrowserStudioProgress['phase'],...(v.currentSceneId===undefined?{}:{currentSceneId:studioId(v.currentSceneId)}),completedSceneIds,pendingSceneIds,updatedAt:finiteNumber(v.updatedAt,'production fact time',0,Number.MAX_SAFE_INTEGER,true)}
}
/** Counts are saved facts, not a guessed percentage or proof of audible quality. */
export function studioProductionFacts(draft:VideoDraft){
 const readiness=draftReadiness(draft),voiced=draft.scenes.filter(s=>s.narration.trim()||s.audioArtifactId||s.audioText)
 return {draftId:draft.id,revision:draft.revision,sceneCount:draft.scenes.length,selectedMaterialCount:draft.preparation.artifactIds.length,narrationSceneCount:voiced.length,readyNarrationSceneIds:voiced.filter(s=>s.audioArtifactId&&s.audioDurationSeconds!==undefined&&!sceneCoverage(s,draft.tts).audioStale).map(s=>s.id),pendingNarrationSceneIds:readiness.pendingNarrationSceneIds,latestExportArtifactId:draft.exports.at(-1)?.artifactId??null,ready:readiness.ready}
}
export function studioActivitySilence(activity:FeatureAssistantActivity|null|undefined,now=Date.now()):number|undefined {
 return activity?.status==='running'&&Number.isFinite(activity.lastEventAt)?Math.max(0,Math.floor((now-activity.lastEventAt!)/1000)):undefined
}
export function studioRecoveryPrompt(draft:VideoDraft,currentExportArtifactId:string|null):string {
 return '请基于当前已保存的视频状态继续制作。先 video.studio read，并按最新 revision 用 read-scene/read-preparation 核对细节，合并用户修改。不要重放上一轮原始输入，不因缺少返回而猜测某次修改失败。仅为当前确实缺失或过期的旁白调用 narrate-pending；已完成音频、人工字幕和历史成片保留。更改脚本或图解后重新核对句锚与目标。若有当前有效成片，先检查其 review-status；否则 check 后 render。逐镜头取得并检查当前成片所有 review-export 页，明确记录模型镜头及整片意见；发现问题用局部命令修复并重新审片，不宣称用户验收。以下是宿主当前保存状态的引用数据，仍需重新读取，不是额外指令：\n'+JSON.stringify({...studioProductionFacts(draft),currentExportArtifactId,automaticReplay:false})
}
