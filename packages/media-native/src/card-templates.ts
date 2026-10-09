import {finiteNumber,mediaRecord} from './media-contract.js'
import type {CompositionScene} from './composition-contract.js'
import {sceneVisuals} from './scene-visuals.js'
import {assertDetailedCard,detailedCardSchemas,cardSourcePins} from './card-details.js'
import type {DetailedCardSpec} from './card-details.js'

type BasicTemplateId='title/basic'|'points/three'|'points/list'|'comparison/two'|'metric/hero'|'evidence/screenshot'|'demo/recording'|'diagram/image'|'media/sequence'
export type CardTemplateId=BasicTemplateId|DetailedCardSpec['templateId']
export type CardMotion='none'|'fade-in'|'reveal-items'|'count-up'|'focus'|'slow-push'|'wipe'
type OrdinaryTemplateId=Exclude<BasicTemplateId,'metric/hero'>
export type CardSpec={version:1;templateId:OrdinaryTemplateId;motion?:CardMotion}|{version:1;templateId:'metric/hero';motion?:CardMotion;value:number;decimals:0|1|2;unit:string}|DetailedCardSpec
export interface CardTemplateDefinition {
 id:CardTemplateId;version:1|2;category:'title'|'points'|'comparison'|'metric'|'evidence'|'demo'|'diagram'|'media';name:string;purpose:string
 slots:readonly string[];motions:readonly CardMotion[];example:readonly string[]
}
/** Trusted definitions shared by native rendering, model catalog and GUI. No executable user templates. */
export const CARD_TEMPLATES:readonly CardTemplateDefinition[]=[
 {id:'title/basic',version:1,category:'title',name:'标题',purpose:'开场、章节、结尾',slots:['title','bullets[0]?'],motions:['none','fade-in'],example:['一个新的研究方向','从原始材料开始']},
 {id:'points/three',version:1,category:'points',name:'三要点',purpose:'三个并列结论',slots:['title','bullets[0..2]'],motions:['none','fade-in','reveal-items'],example:['三个结论','看原文','查范围','保留来源']},
 {id:'points/list',version:1,category:'points',name:'要点列表',purpose:'兼容一至三项列表',slots:['title','bullets[0..2]?'],motions:['none','fade-in','reveal-items'],example:['要点','第一项','第二项']},
 {id:'comparison/two',version:1,category:'comparison',name:'两项对比',purpose:'两个对象的同维度差异',slots:['title','bullets[0..1]'],motions:['none','fade-in'],example:['表达方式','原始主张','适用范围']},
 {id:'metric/hero',version:1,category:'metric',name:'数字',purpose:'突出一个数量，公式和范围用图解',slots:['value','decimals','unit','title','bullets[0]?'],motions:['none','fade-in','count-up'],example:['关键数量','722','篇']},
 {id:'evidence/screenshot',version:1,category:'evidence',name:'证据',purpose:'原文画面；来源由 Studio 的原始来源字段保存',slots:['visual','title','bullets[0]?','sources'],motions:['none','focus','slow-push'],example:['原始依据','官方页面截图']},
 {id:'demo/recording',version:1,category:'demo',name:'演示',purpose:'真实页面操作，聚焦不代表连续鼠标轨迹',slots:['video','sourceStartSeconds','title'],motions:['none','focus'],example:['查看原文','页面操作录屏']},
 {id:'diagram/image',version:1,category:'diagram',name:'图解',purpose:'单张机制或关系图，图内对象不独立编辑',slots:['image','title','bullets[0]?'],motions:['none','focus','slow-push'],example:['理解关系','关系示意图']},
 {id:'media/sequence',version:1,category:'media',name:'素材',purpose:'一至八个顺序图片或视频片段',slots:['visualSegments','title'],motions:['none','slow-push'],example:['情景画面','图片或视频']},
 {id:'evidence/reading',version:2,category:'evidence',name:'证据阅读',purpose:'有界整页与细节阅读',slots:['visual','reading.targets','sources'],motions:['none'],example:['阅读原文']},
 {id:'evidence/highlight',version:2,category:'evidence',name:'原句重点',purpose:'实际源像素反白、框线或底色',slots:['visual','highlights','sources'],motions:['none'],example:['原句重点']},
 {id:'evidence/translation',version:2,category:'evidence',name:'原文 / 译文',purpose:'原句与编辑译文分栏',slots:['visual','quote','sources'],motions:['none'],example:['原文与译文']},
 {id:'evidence/person-quote',version:2,category:'evidence',name:'人物引述',purpose:'人物固定槽与可核对引述',slots:['visual','quote','person','sources'],motions:['none'],example:['人物引述']},
 {id:'metric/backdrop',version:2,category:'metric',name:'背景数字',purpose:'数量退回静态依据',slots:['value','decimals','unit','phase','holdSeconds','visual?','sources'],motions:['none','fade-in','count-up'],example:['数字与依据']},
 {id:'title/emphasis',version:2,category:'title',name:'关键词强调',purpose:'整句淡入或擦入，可带静态依据',slots:['title','visual?','sources'],motions:['none','fade-in','wipe'],example:['关键词']},
 {id:'diagram/to-target',version:2,category:'diagram',name:'共同目标',purpose:'二至三个对象指向一个目标',slots:['objects','target','relation'],motions:['none','reveal-items'],example:['共同目标']},
 {id:'diagram/range',version:2,category:'diagram',name:'范围关系',purpose:'数值比例或明确非比例示意',slots:['range'],motions:['none'],example:['范围与条件']}
]
export function cardTemplate(id:CardTemplateId):CardTemplateDefinition {
 const template=CARD_TEMPLATES.find(item=>item.id===id)
 if(!template)throw new TypeError('CARD_TEMPLATE: 未知模板。')
 return template
}
const ordinary=CARD_TEMPLATES.filter(item=>item.version===1&&item.id!=='metric/hero').map(item=>({
 type:'object',additionalProperties:false,required:['version','templateId'],properties:{version:{const:1},templateId:{const:item.id},motion:{enum:item.motions}}
}))
export const cardSpecSchema={oneOf:[...detailedCardSchemas,...ordinary,{type:'object',additionalProperties:false,required:['version','templateId','value','decimals','unit'],properties:{version:{const:1},templateId:{const:'metric/hero'},motion:{enum:['none','fade-in','count-up']},value:{type:'number',minimum:0,maximum:999999999.99,multipleOf:.01},decimals:{enum:[0,1,2]},unit:{type:'string',maxLength:8}}}]}
export function assertCardSpec(raw:unknown):CardSpec {
 const v=mediaRecord(raw);if(v.version===2)return assertDetailedCard(raw)
 const definition=CARD_TEMPLATES.find(item=>item.id===v.templateId)
 if(!definition||v.version!==1)throw new TypeError('CARD_TEMPLATE: 模板或版本不支持。')
 const allowed=definition.id==='metric/hero'?['version','templateId','motion','value','decimals','unit']:['version','templateId','motion']
 if(Object.keys(v).some(key=>!allowed.includes(key)))throw new TypeError('CARD_TEMPLATE: 模板不接受额外参数。')
 if(v.motion!==undefined&&!definition.motions.includes(v.motion as CardMotion))throw new TypeError('CARD_MOTION: 此模板不支持所选动效。')
 const motion=v.motion===undefined?{}:{motion:v.motion as CardMotion}
 if(definition.id!=='metric/hero')return {version:1,templateId:definition.id as OrdinaryTemplateId,...motion}
 const value=finiteNumber(v.value,'card value',0,999999999.99),decimals=finiteNumber(v.decimals,'card decimals',0,2,true) as 0|1|2
 if(typeof v.unit!=='string'||v.unit.length>8||/[\u0000-\u001f]/.test(v.unit))throw new TypeError('CARD_METRIC: 单位最多八个字符。')
 // Compare the published representation; never silently round an input to fit a display.
 if(Number(value.toFixed(decimals))!==value)throw new TypeError('CARD_METRIC: 数值与小数位不一致；请明确调整数值或小数位。')
 return {version:1,templateId:'metric/hero',...motion,value,decimals,unit:v.unit}
}
export function assertCardContent(scene:CompositionScene,spec:CardSpec):void {
 if(scene.sceneTemplate)throw new TypeError('CARD_TEMPLATE: cardSpec 与旧 sceneTemplate 不能同时编辑。')
 const visuals=sceneVisuals(scene),count=scene.bullets.length,id=spec.templateId
 const fail=(message:string):never=>{throw new TypeError('CARD_CONTENT: '+message)}
 if(spec.version===2){
  if(['evidence/reading','evidence/highlight','evidence/translation','evidence/person-quote','diagram/image'].includes(id)&&(!visuals.length||visuals.some(v=>!v.imageArtifactId)))fail('此变体需要静态源图片。')
  if(['metric/backdrop','title/emphasis'].includes(id)&&(visuals.length>1||visuals.some(v=>!v.imageArtifactId)))fail('背景最多一张静态图。')
  if(id==='title/emphasis'&&scene.title.length>20)fail('关键词最多 20 字符。')
  if(id==='metric/backdrop'&&spec.phase==='to-evidence'){if(!visuals.length)fail('退回依据需要真实背景图。');if(spec.holdSeconds+1.6>(scene.presentationWindow?.durationSeconds??scene.durationSeconds))fail('退回依据需要保留至少一秒阅读。')}
  if(['diagram/to-target','diagram/range'].includes(id)&&(visuals.length||count))fail('结构化图解使用专用节点/范围槽，不叠加画面或要点。')
  if(count>1)fail('此变体最多一条短说明。')
  if('reading'in spec&&spec.reading&&visuals.some(v=>v.focusIntervals?.length||v.zoom!==1))fail('阅读配方不能覆盖已有手工聚焦或缩放，请先确认移除。')
  const pins=cardSourcePins(spec);for(const pin of pins)if(!visuals.some(v=>v.imageArtifactId===pin.artifactId))fail('重点的源素材已更换，请重新框选。')
  const duration=scene.presentationWindow?.durationSeconds??scene.durationSeconds
  if('highlights'in spec&&spec.highlights?.some(h=>h.endSeconds>duration+.001))fail('重点时段超过原镜头时长。')
  return
 }

 if(['title/basic','points/three','points/list','comparison/two'].includes(id)&&visuals.length)fail('此文字模板不显示素材；请先确认转换并移除画面引用。')
 if(id==='points/three'&&count!==3)fail('三要点需要恰好三项。')
 if(id==='comparison/two'&&count!==2)fail('两项对比需要恰好两项。')
 if(['title/basic','metric/hero','evidence/screenshot','diagram/image'].includes(id)&&count>1)fail('此模板最多一条短说明。')
 if(['demo/recording','media/sequence'].includes(id)&&count)fail('此模板不显示要点；请确认转换或改用其他模板。')
 if(['evidence/screenshot','demo/recording','diagram/image','media/sequence'].includes(id)&&!visuals.length)fail('此模板需要实际画面素材。')
 if(id==='diagram/image'&&(visuals.length!==1||!visuals[0].imageArtifactId))fail('首版图解需要一张图片。')
 if(id==='demo/recording'&&visuals.some(item=>!item.videoArtifactId))fail('演示需要录屏视频。')
 if(spec.motion==='slow-push'&&(visuals.some(item=>!item.imageArtifactId)||!visuals.length))fail('缓慢推近只适用于静态图片。')
 if(spec.motion==='slow-push'&&visuals.some(item=>item.focusIntervals?.length||item.zoom!==1))fail('缓慢推近不能与已有聚焦或缩放竞争。')
 if(spec.motion==='focus'&&!visuals.some(item=>item.focusIntervals?.length))fail('请先设置聚焦区间。')
}
/** Original presentation seconds, not piece-local seconds. Export and preview seek identically. */
export function cardMetricText(spec:Extract<CardSpec,{templateId:'metric/hero'|'metric/backdrop'}>,presentationSeconds:number):string {
 const progress=spec.motion==='count-up'?Math.max(0,Math.min(1,presentationSeconds/1.2)):1
 const scaled=Math.round(spec.value*10**spec.decimals*progress)/10**spec.decimals
 return scaled.toFixed(spec.decimals)+spec.unit
}
/** A rendering projection, never persisted as a second sceneTemplate authority. */
export function cardPaintScene(scene:CompositionScene):CompositionScene {
 const card=scene.cardSpec
 if(!card)return scene
 const kind=card.templateId==='points/three'?'summary':card.templateId==='comparison/two'?'comparison':(['evidence/screenshot','diagram/image','evidence/reading','evidence/highlight'].includes(card.templateId))&&scene.bullets.length?'screenshot':undefined
 const duration=scene.presentationWindow?.durationSeconds??scene.durationSeconds
 return {...scene,showSceneNumber:false,label:'',...(kind?{sceneTemplate:{kind:kind as 'summary'|'comparison'|'screenshot'}}:{}),...(['title/basic','title/emphasis'].includes(card.templateId)?{title:'',bullets:[]}:{}),...(['metric/hero','metric/backdrop','evidence/translation','evidence/person-quote'].includes(card.templateId)?{bullets:[]}:{}),...(card.motion==='reveal-items'?{bulletRevealSeconds:scene.bulletRevealSeconds??scene.bullets.map((_,i)=>i*Math.min(1.5,duration/Math.max(1,scene.bullets.length)))}:{})}
}
