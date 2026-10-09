import {assertStudioScene} from './studio-contract.js'
import type {StudioScene} from './studio-contract.js'
import {assertCardSpec,cardTemplate} from '../../media-native/src/card-templates.js'
import type {CardSpec,CardTemplateId} from '../../media-native/src/card-templates.js'
import {sceneVisuals} from '../../media-native/src/visual-segments.js'
export type CardTemplateChoice=CardTemplateId|NonNullable<StudioScene['sceneTemplate']>['kind']|''
export function currentCardTemplate(scene:StudioScene):CardTemplateChoice{return scene.cardSpec?.templateId??scene.sceneTemplate?.kind??''}
export function cardTemplateName(choice:CardTemplateChoice):string {
 return choice.includes('/')?cardTemplate(choice as CardTemplateId).name:choice==='summary'?'三点总结':choice==='comparison'?'两项对比':choice==='screenshot'?'画面解读':'要点列表'
}
export function initialCardSpec(scene:StudioScene,id:CardTemplateId):CardSpec {
 if(scene.cardSpec?.templateId===id)return scene.cardSpec
 const definition=cardTemplate(id)
 if(id==='metric/hero'||id==='metric/backdrop'){const metric=scene.cardSpec&&'value'in scene.cardSpec?scene.cardSpec:{value:0,decimals:0 as const,unit:''};return id==='metric/hero'?{version:1,templateId:id,value:metric.value,decimals:metric.decimals,unit:metric.unit}:{version:2,templateId:id,value:metric.value,decimals:metric.decimals,unit:metric.unit,phase:'hold',holdSeconds:2}}
 const quote={excerpt:'',translation:'',attribution:'',display:'simultaneous' as const}
 if(id==='evidence/translation')return {version:2,templateId:id,quote}
 if(id==='evidence/person-quote')return {version:2,templateId:id,quote,person:{name:'',role:'',layout:'right'}}
 if(id==='diagram/to-target')return {version:2,templateId:id,objects:[{label:scene.bullets[0]??''},{label:scene.bullets[1]??''},...(scene.bullets[2]?[{label:scene.bullets[2]}]:[])],target:{label:''},relation:''}
 if(id==='diagram/range')return {version:2,templateId:id,range:{mode:'symbolic',axisLabel:'',regionLabel:'',thresholdLabels:[],condition:''}}
 return assertCardSpec({version:definition.version,templateId:id})
}
export interface CardConversion {scene:StudioScene;notices:string[]}
/** Explicit preview/confirmation conversion. Assets remain in Project preparation; no hidden scene backup. */
export function planCardTemplate(scene:StudioScene,choice:CardTemplateChoice,spec?:CardSpec):CardConversion {
 const next=structuredClone(scene),notices:string[]=[]
 if(!choice.includes('/')){
  delete next.cardSpec
  if(choice)next.sceneTemplate={...next.sceneTemplate,kind:choice as NonNullable<StudioScene['sceneTemplate']>['kind']};else delete next.sceneTemplate
  if(scene.cardSpec)notices.push('转换为兼容版式；新模板的数字或动效将不显示，可撤销。')
 }else{
  const id=choice as CardTemplateId
  if(spec&&spec.templateId!==id)throw new Error('CARD_TEMPLATE: 模板参数不属于所选模板。')
  next.cardSpec=assertCardSpec(spec??initialCardSpec(scene,id))
  if(scene.cardSpec?.version===2&&scene.cardSpec.templateId!==id)notices.push('当前变体的阅读重点、译文、人物或结构槽将不显示；原文件保留，可撤销。')
  if(['diagram/to-target','diagram/range'].includes(id)&&next.bullets.length){if(id==='diagram/range')throw new Error('范围关系使用专用槽；请先保留原说明再确认移除要点。');next.bullets=[];delete next.bulletRevealSeconds;notices.push('现有要点转为对象标签；请填写共同目标。')}
  if(next.sceneTemplate){delete next.sceneTemplate;notices.push('旧版配色与重点改用模板统一风格；内容保留，可撤销。')}
  if(['title/basic','points/three','points/list','comparison/two','diagram/to-target','diagram/range'].includes(id)&&sceneVisuals(next).length){
   if(next.speechLinks?.focus.length||next.sourceCaptionBinding||next.sourceSpeech)throw new Error('请先解除源字幕或按句聚焦绑定，再转换为文字卡。')
   for(const key of ['visualSegments','imageArtifactId','videoArtifactId','focusIntervals','effects','sourceDurationSeconds','keepSourceAudio','sourceVolume'] as const)delete next[key]
   next.sourceStartSeconds=0;next.zoom=1;next.playbackRate=1;delete next.crop
   notices.push('画面素材与取景将不显示；原文件仍保存在项目素材中，可撤销。')
  }
  if(id==='metric/hero'&&scene.cardSpec?.templateId!=='metric/hero')notices.push('数字初值为 0；请填写真实数值与单位，再确认应用。')
 }
 return {scene:assertStudioScene(next),notices}
}
export function cardTemplateScene(scene:StudioScene,choice:CardTemplateChoice,spec?:CardSpec):StudioScene{return planCardTemplate(scene,choice,spec).scene}
export function cardShowsBullets(scene:StudioScene):boolean {
 return scene.cardSpec?!['demo/recording','media/sequence','diagram/to-target','diagram/range'].includes(scene.cardSpec.templateId):!sceneVisuals(scene).length||Boolean(scene.sceneTemplate)
}
export function cardBulletLimit(scene:StudioScene):number {
 return scene.cardSpec?.version===2?(['diagram/to-target','diagram/range'].includes(scene.cardSpec.templateId)?0:1):scene.cardSpec?['title/basic','metric/hero','evidence/screenshot','diagram/image'].includes(scene.cardSpec.templateId)?1:['demo/recording','media/sequence'].includes(scene.cardSpec.templateId)?0:3:3
}
