import type {VideoDraft} from './studio-contract.js'
export const AI_NEWS_EDITORIAL_REVIEW_POLICY='AI新闻速递面向对AI科技和全球最新变化感兴趣、能接受少量英文与术语、关注大公司大机构重要人物的观众。普通快讯约45秒，重点事件约120秒；核对稿件目标及实际时长，偏离须有编辑理由。以可核验事实和本人原声为主，少量明确归因的有据解读；必要术语首次出现用日常语言简释，不展开教程式实现细节。重要原声须语义完整、译文准确，不能把合成语音当本人发言。检查一件事的主要变化和具体影响／限制／观察点；愿景、宣布、试用、计划与实际交付分开。逐镜记录其他来源视频（实拍、CG、动画、AI生成影片均可引用）、截屏录屏、图解等实际区间及叙述相关性，判断相关来源视频是否承担主体信息；核来源身份、日期和生成属性标注，不将外部CG/AI视频排除或冒充现实证据，作者自行生成的视频须有用户批准，不能凭空编比例或用无关机房／机器人填充。资料片保持可核验日期，旧题修订不冒充今日新发布。缺素材或无法判断的部分明确标未完成／能力缺口。'
export const VIDEO_VISUAL_REVIEW_POLICY='禁止单纯静态文字展示作为独立段落，尤其不能用连续两张空旷标题卡收尾。文字必须有相关真实素材、证据图、对比、流程或时间线等视觉支撑；装饰边框、背景色、文字飞入、循环推拉不算信息支撑。截图／录屏应有聚焦放大与阅读节拍，图解须有可观察的关系或状态变化；模板名或文字方框不能证明视觉质量。检查信息密度、视觉层级、手机可读性、节奏及最后两镜的完成度；没有溢出和黑帧不等于制作质量通过。'
/** Structural risk only, never a claim to have understood rendered pixels. */
export function sparseClosingScenes(draft:VideoDraft):string[]{
 let start=0
 return draft.scenes.flatMap((s,i)=>{
  const end=start+s.durationSeconds,filmLayers=(draft.layers??[]).filter(l=>l.startSeconds<end&&l.startSeconds+l.durationSeconds>start);start=end
  const support=s.sceneTemplate?.kind==='comparison'&&s.bullets.length>=2||[...(s.layers??[]),...filmLayers].some(l=>!l.hidden&&l.opacity>0&&l.width*l.height>=.04&&['image','video','diagram'].includes(l.kind))
  return i>=Math.max(0,draft.scenes.length-2)&&s.durationSeconds>=3&&!support&&!s.imageArtifactId&&!s.videoArtifactId&&!s.visualSegments?.some(v=>v.imageArtifactId||v.videoArtifactId)&&(!s.cardSpec||s.cardSpec.templateId==='title/basic')?[s.id]:[]
 })
}
