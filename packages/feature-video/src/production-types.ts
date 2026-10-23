import {initialCardSpec} from './studio-card-templates.js'
import type {CardTemplateId} from '../../media-native/src/card-templates.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
import type {VideoDraft} from './studio-contract.js'
import type {ProductionBrief,ProductionType,SemanticGoal} from './production-contract.js'
import {speechBindingStale,speechScene} from './studio-speech-contract.js'
import {cardSpeechTargets} from './studio-card-speech.js'
import {narrationSceneRanges} from '../../media-native/src/composition-contract.js'
export const productionProfiles=[
 {id:'news-brief',version:1,name:'新闻速递',duration:[30,150],durationGuidance:'普通快讯约45秒（目标≤60秒），重点事件约120秒（显式目标>60秒）；制作余量分别30–60秒和90–150秒。',aspectRatio:'9:16',roles:['事实钩子','原始证据','最小上下文','有据点评','边界与观察点'],checks:['一件事与主要变化','事实、原声与有据解读分开','证据作者与日期可读、相关真实视频承担主体信息','普通约45秒／重点约120秒、术语简释且无纯文字段落','人工试听与观众复述'],recipes:['source-reading','evidence-comment','boundary']},
 {id:'science-explainer',version:1,name:'综合科普',duration:[180,300],aspectRatio:'16:9',roles:['现象与问题','必要背景','机制分步','例子或对照','限制与回答'],checks:['问题可复述','三种必要材料','机制有贯穿例子','条件改变可预测','人工试听与观众复述'],recipes:['source-reading','mechanism-steps','comparison','boundary']},
 {id:'research-explainer',version:1,name:'学术解读',duration:[180,360],aspectRatio:'16:9',roles:['研究问题','基线与困难','贯穿例子','方法步骤','实验与对照','限制与复现入口'],checks:['论文作者与版本明确','主张/报告/复现/推断分开','变量与基线清楚','图表单位与条件齐全','人工试听与观众复述'],recipes:['source-reading','mechanism-steps','measurement','comparison','boundary']}
] as const
export const productionRecipes=[
 {id:'source-reading',version:2,name:'原文阅读',capabilities:['evidence/screenshot','evidence/translation'],visualBrief:'真实出处先给全貌，再放大关键区域；引用素材至少占约半屏，关键原句须可读。按说话节拍定位、强调、停读、返回，不在小窗里长时间不动。保留作者与版本；运动服务阅读，不用随机缩放代替证据。'},
 {id:'evidence-comment',version:2,name:'证据与点评',capabilities:['evidence/person-quote','points/three'],visualBrief:'先用可见冲突或悬念提问，再让原始证据占主要画面，最后给一个有据判断。原话、事实和点评分开；短标签跟随证据揭示，不连续朗读三点卡。每次切换要增加信息，不用装饰假装推进。'},
 {id:'mechanism-steps',version:2,name:'机制步骤',capabilities:['diagram/sequence','science/events'],visualBrief:'用同一可见对象贯穿输入、状态改变、工具调用和输出；对象移动、连线、代码行、记忆状态按旁白同步推进。先让观众观察，再指出变化，再解释原因。以数秒一个有意义节拍组织，每个状态留阅读时间；不把长旁白铺在一张静止流程图上，卡片只是可编辑骨架。'},
 {id:'measurement',version:2,name:'实验测量',capabilities:['science/measurement'],visualBrief:'先交代坐标和对照条件，再揭示基线与改进，最后指出一个可核对差别；保留来源、单位与轴域，不捏造数据。图表应占主要画面并给字幕留独立区域；用聚焦或阶段揭示引导观察，不整段停在密集表格上。独立测量不用比例条代替。'},
 {id:'comparison',version:2,name:'条件对照',capabilities:['comparison/two','demo/recording'],visualBrief:'用同一条件同一视角的真实素材或明确示意并排／前后对照；先显示保留量，再引入变化，再观察差别。让动作和局部细节承担解释，文字只标条件与未知项；不把两段长文字当作对照画面。'},
 {id:'boundary',version:2,name:'限制与回答',capabilities:['points/three'],visualBrief:'回到开头的真实画面或贯穿对象，用一个可见变化回答问题，再指出一个边界或后续观察信号。限制跟随证据出现，不用长时间静止三点总结代替收束；未核听、未复现和未知条件明确保留。'}
] as const
export function newProductionBrief(profileId:ProductionType):ProductionBrief {
 const profile=productionProfiles.find(p=>p.id===profileId)!
 return {version:1,profileId,profileVersion:1,audience:'',question:'',targetDurationSeconds:profileId==='news-brief'?45:profileId==='science-explainer'?240:300,sections:profile.roles.map((role,i)=>({id:'section-'+(i+1),role,objective:'',sceneIds:[],claimIds:[],materialRoles:[],observation:''})),works:[],relations:[],claims:[],goals:[],assetVersions:[]}
}
/** Metadata and empty visual slots only; no recipe replaces authored content or timing. */
export function productionProposal(draft:VideoDraft,typeId:ProductionType,recipeId?:string,sceneId?:string){
 const profile=productionProfiles.find(p=>p.id===typeId)!,current=draft.preparation.production
 if(current&&current.profileId!==typeId)throw new Error('PRODUCTION_REBIND: Edit the production worksheet explicitly before changing an adopted type.')
 const production=current??newProductionBrief(typeId),commands:import('./video-edit-contract.js').VideoEditCommand[]=[{op:'brief.set',patch:{production}}],keep=draft.scenes.map(s=>({sceneId:s.id,fields:['script','audio','captions','sources','layers','timing','visualBrief']})),replace:{sceneId:string;field:string;before:string;after:string}[]=[]
 if(recipeId){const recipe=productionRecipes.find(p=>p.id===recipeId);if(!recipe||!(profile.recipes as readonly string[]).includes(recipeId))throw new Error('Unknown recipe for this type.');const scene=draft.scenes.find(s=>s.id===sceneId);if(!scene)throw new Error('Choose a current recipe scene.');if(scene.visualBrief.trim())throw new Error('PRODUCTION_PRESERVE_EDIT: Visual brief already authored; retain it or explicitly clear the slot before adopting a recipe.');commands.push({op:'scene.set',sceneId:scene.id,patch:{visualBrief:recipe.visualBrief}});replace.push({sceneId:scene.id,field:'visualBrief',before:'',after:recipe.visualBrief});const mapping:Record<string,CardTemplateId>={'source-reading':'evidence/screenshot','evidence-comment':'evidence/person-quote','mechanism-steps':'diagram/sequence','comparison':'comparison/two','boundary':'points/three'},template=mapping[recipeId];if(template&&!scene.cardSpec&&!scene.sceneTemplate&&!scene.bullets.length&&!sceneVisuals(scene).length&&!scene.layers?.length&&!scene.speechLinks){commands.push({op:'card.set',sceneId:scene.id,cardSpec:initialCardSpec(scene,template)});replace.push({sceneId:scene.id,field:'cardSpec',before:'',after:template})}}
 return {profileId:typeId,profileVersion:1,recipeId:recipeId??null,recipeVersion:productionRecipes.find(r=>r.id===recipeId)?.version??null,keep,replace,edit:{version:1 as const,commands},adoption:'Explicit adopt-type with this revision and baseFingerprint; no queue or render is reserved.'}
}
export function semanticGoalBinding(draft:VideoDraft,goal:SemanticGoal):string|undefined{
 const scene=draft.scenes.find(s=>s.id===goal.sceneId),anchors=scene?.speechAnchors,anchor=anchors?.anchors.find(a=>a.id===goal.anchorId)
 if(!scene||!anchors||!anchor||speechBindingStale(scene,anchors))return undefined
 const target=goal.target==='card'?cardSpeechTargets(scene)[goal.targetIndex]:undefined,link=goal.target==='card'?scene.speechLinks?.cards?.find(l=>l.anchorId===goal.anchorId&&l.kind===target?.kind&&l.index===target.index&&l.target===target.target):scene.speechLinks?.focus[goal.targetIndex]
 if(!link||link.anchorId!==goal.anchorId)return undefined
 return JSON.stringify({sceneId:scene.id,scriptSha256:anchors.scriptSha256,audioSha256:anchors.audioSha256,audioArtifactId:anchors.audioArtifactId,anchor,link})
}
export function productionReview(draft:VideoDraft){
 const p=draft.preparation.production,profile=productionProfiles.find(row=>row.id===p?.profileId),issues:{code:string;id:string;message:string}[]=[],add=(code:string,id:string,message:string)=>issues.push({code,id,message}),duration=draft.scenes.reduce((n,s)=>n+s.durationSeconds,0)
 if(!p)return {state:'资料待补',revision:draft.revision,issues:[{code:'type-missing',id:draft.id,message:'Choose a versioned production type.'}],contentAccepted:false,humanListening:'not-recorded'}
 if(!p.audience.trim()||!p.question.trim())add('brief-missing',draft.id,'补充受众和主问题。')
 if(p.profileId==='news-brief'){const focus=p.targetDurationSeconds>60;if(duration<(focus?90:30)||duration>(focus?150:60))add('news-duration',draft.id,focus?'重点事件目标约120秒，制作余量90–150秒；核对目标与节奏。':'普通快讯目标约45秒，制作余量30–60秒；重点事件须显式设置约120秒目标。')}
 for(const section of p.sections){if(!section.objective||!section.observation||!section.sceneIds.length)add('section-incomplete',section.id,'填写段落目标、观察任务和镜头关联。');for(const id of section.sceneIds)if(!draft.scenes.some(s=>s.id===id))add('scene-stale',section.id,'关联镜头已移除。')}
 for(const claim of p.claims){const scene=draft.scenes.find(s=>s.id===claim.sceneId),work=p.works.find(w=>w.id===claim.workId)!;if(!scene)add('claim-scene-stale',claim.id,'主张对应镜头已移除。');if(claim.citationIndex!==undefined){const citation=scene?.citations?.[claim.citationIndex];if(!citation||citation.sourceId!==work.sourceId||citation.acquisitionId!==work.acquisitionId)add('claim-citation-stale',claim.id,'引文槽位已改变，请重新关联。')}else if(['fact','quote','author-claim','reported-result','replication'].includes(claim.kind))add('claim-evidence-missing',claim.id,'此类主张缺少原文引文槽位；存在来源不等于事实已核验。')}
 const goals=p.goals.map(goal=>{const scene=draft.scenes.find(s=>s.id===goal.sceneId),section=p.sections.find(s=>s.id===goal.sectionId),anchor=scene?.speechAnchors?.anchors.find(a=>a.id===goal.anchorId);let current=Boolean(goal.binding&&goal.binding===semanticGoalBinding(draft,goal)&&scene&&section?.sceneIds.includes(goal.sceneId)&&anchor&&!speechBindingStale(scene,scene.speechAnchors));if(current&&scene){try{speechScene(scene)}catch{current=false}if(goal.target==='card'){const target=cardSpeechTargets(scene)[goal.targetIndex];current=Boolean(target&&scene.speechLinks?.cards?.some(l=>l.anchorId===goal.anchorId&&l.kind===target.kind&&l.index===target.index&&l.target===target.target))}else current=Boolean(scene.speechLinks?.focus[goal.targetIndex]?.anchorId===goal.anchorId)}if(!current)add('goal-rebind',goal.id,'目标或句锚已变动，须显式重绑。');const {binding:_captured,...editableGoal}=goal;return {...editableGoal,state:current?'current':'rebind',ranges:current&&scene&&anchor?narrationSceneRanges(scene,anchor.startSeconds,anchor.endSeconds):[],timeBasis:'derived-from-existing-sentence-anchor'}})
 if(!p.works.length||!p.claims.length)add('evidence-missing',draft.id,'建立明确来源作品与主张。')
 return {state:issues.length?'资料待补':draft.exports.length?'成片待审':'稿件待审',revision:draft.revision,profile,issues,goals,checklist:profile!.checks.map(check=>({check,status:'requires-review'})),technicalAndContentSeparate:true,contentAccepted:false,humanListening:'not-recorded',viewerRetelling:'not-recorded'}
}
